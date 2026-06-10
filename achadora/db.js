// Achadora — camada de banco de dados (IndexedDB, 100% local no aparelho)
//
// Modelo de dados (padrão ouro — separação por DONO do dado):
//
//   CATÁLOGO (você é o dono; o app só lê; um "Sincronizar" pode sobrescrever):
//     products  — produtos (perfumes etc.)            { id, name, brandId, ..., source }
//     brands    — marcas (entidade própria)           { id, name, source }
//     stores    — lojas (id determinístico: store-<slug>) { id, name, address, lat, lng, source }
//     prices    — preços observados                   { id, productId, storeId, value, ..., source }
//
//   Marca é entidade de primeira classe (como loja): o produto referencia
//   `brandId`; o nome vive só na marca (fonte única). A leitura resolve o nome
//   e devolve `.brand` pronto, então a interface continua lendo `p.brand`.
//
//   DADOS DO USUÁRIO (o usuário é o dono; o sync NUNCA toca):
//     userProducts — favorito + anotação pessoal      { id: productId, favorite, note }
//     lists        — listas de desejos / orçamentos   { id, name, items: [...] }
//
//   CONTROLE:
//     meta — versão do catálogo já sincronizada       { id: 'catalog', version, syncedAt }
//
// Cada registro de catálogo leva `source`: 'catalog' (veio do catálogo publicado)
// ou 'user' (o próprio usuário cadastrou). O sync só mexe no que é 'catalog',
// então favoritos, anotações, listas e cadastros do usuário ficam intocados —
// sem gatilho, sem lista de "campos a preservar", sem risco de conflito.

const DB_NAME = 'achadora';
const DB_VERSION = 5;

// Coleções que entram no backup completo. Fonte ÚNICA usada por exportAll e
// importAll — acrescentar uma store aqui já a inclui nos dois lados, sem remendo.
const BACKUP_STORES = ['products', 'brands', 'stores', 'prices', 'lists', 'userProducts', 'meta'];

// Slug a partir do nome (sem acento/caixa). Base dos ids determinísticos:
// o mesmo nome gera o mesmo id em qualquer aparelho/seed, então o sync e o
// find-or-create reconciliam sozinhos — sem registro duplicado.
const slugify = (name) => String(name || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// Ids estáveis de marca e de loja, derivados do nome. Mesmo nome → mesmo id.
const brandSlug = (name) => 'brand-' + slugify(name);
const storeSlug = (name) => 'store-' + slugify(name);
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;
      const oldVersion = e.oldVersion;

      if (!db.objectStoreNames.contains('products')) {
        const s = db.createObjectStore('products', { keyPath: 'id' });
        s.createIndex('category', 'category', { unique: false });
      }
      if (!db.objectStoreNames.contains('stores')) {
        const s = db.createObjectStore('stores', { keyPath: 'id' });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains('prices')) {
        const s = db.createObjectStore('prices', { keyPath: 'id' });
        s.createIndex('productId', 'productId', { unique: false });
        s.createIndex('storeId', 'storeId', { unique: false });
      }
      // v2: listas de desejos / orçamentos (itens embutidos na própria lista)
      if (!db.objectStoreNames.contains('lists')) {
        db.createObjectStore('lists', { keyPath: 'id' });
      }

      // v3: separa o estado do usuário do catálogo + etiqueta de origem.
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains('userProducts')) {
          db.createObjectStore('userProducts', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'id' });
        }
        migrateToV3(tx);
      }

      // v4: marca vira entidade própria (store `brands`); produtos passam a
      // referenciar `brandId` em vez de guardar o nome.
      if (oldVersion < 4) {
        if (!db.objectStoreNames.contains('brands')) {
          const s = db.createObjectStore('brands', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
        }
        migrateToV4(tx);
      }

      // v5: a loja passa a ter id determinístico derivado do nome
      // (`store-<slug>`), igual à marca. Desfaz lojas duplicadas.
      if (oldVersion < 5) {
        migrateToV5(tx);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

// Migração v2 -> v3 (roda dentro da transação de upgrade):
// - move `favorite` de cada produto para a store `userProducts`;
// - marca tudo que já existia como source:'user' (nunca será apagado por um sync;
//   quando o catálogo publicado trouxer o mesmo id, o upsert reconcilia para 'catalog').
function migrateToV3(tx) {
  const userProducts = tx.objectStore('userProducts');
  tx.objectStore('products').openCursor().onsuccess = (ev) => {
    const cur = ev.target.result;
    if (!cur) return;
    const p = cur.value;
    if (p.favorite) userProducts.put({ id: p.id, favorite: true, note: '' });
    delete p.favorite; // o estado do usuário agora vive só em userProducts
    if (!p.source) p.source = 'user';
    cur.update(p);
    cur.continue();
  };
  for (const name of ['stores', 'prices']) {
    tx.objectStore(name).openCursor().onsuccess = (ev) => {
      const cur = ev.target.result;
      if (!cur) return;
      if (!cur.value.source) { cur.value.source = 'user'; cur.update(cur.value); }
      cur.continue();
    };
  }
}

// Migração v3 -> v4: extrai a marca (string) de cada produto para a store
// `brands` e troca por `brandId`. Marcas iguais (ignorando acento/caixa)
// colapsam no mesmo id determinístico — desfaz duplicatas que já existissem.
function migrateToV4(tx) {
  const brands = tx.objectStore('brands');
  const seen = new Set();
  tx.objectStore('products').openCursor().onsuccess = (ev) => {
    const cur = ev.target.result;
    if (!cur) return;
    const p = cur.value;
    const name = (p.brand || '').trim();
    if (name) {
      const id = brandSlug(name);
      if (!seen.has(id)) {
        seen.add(id);
        // a marca herda a origem do produto (catálogo vs. cadastro do usuário)
        brands.put({ id, name, source: p.source || 'user', createdAt: Date.now(), updatedAt: Date.now() });
      }
      p.brandId = id;
    }
    delete p.brand; // o nome agora vive só na entidade brand
    cur.update(p);
    cur.continue();
  };
}

// Migração v4 -> v5: a loja passa a ter id determinístico derivado do nome
// (`store-<slug>`), igual à marca. Lojas com o mesmo nome (ignorando acento/
// caixa) colapsam no mesmo id — desfaz as duplicatas criadas quando um cadastro
// do usuário e o catálogo traziam a mesma loja com ids diferentes. Os preços
// são re-apontados para o id canônico da loja.
function migrateToV5(tx) {
  const storesOS = tx.objectStore('stores');
  const pricesOS = tx.objectStore('prices');
  const all = [];
  storesOS.openCursor().onsuccess = (ev) => {
    const cur = ev.target.result;
    if (cur) { all.push(cur.value); cur.continue(); return; }

    // agrupa por id canônico (slug do nome); mescla o melhor de cada campo
    const canonical = {}; // canonId -> registro mesclado
    const remap = {};     // idAntigo -> canonId
    for (const s of all) {
      const canonId = slugify(s.name) ? storeSlug(s.name) : s.id; // sem nome: mantém id
      remap[s.id] = canonId;
      const acc = canonical[canonId] || { id: canonId, name: s.name, address: '', source: 'user' };
      if (!acc.address && s.address) acc.address = s.address;
      if (acc.lat == null && s.lat != null) { acc.lat = s.lat; acc.lng = s.lng; } // preserva o pino
      if (s.source === 'catalog') acc.source = 'catalog';
      if (s.createdAt && (acc.createdAt == null || s.createdAt < acc.createdAt)) acc.createdAt = s.createdAt;
      canonical[canonId] = acc;
    }

    // reescreve as lojas: limpa e grava só os registros canônicos
    storesOS.clear().onsuccess = () => {
      Object.values(canonical).forEach((s) => storesOS.put(s));
    };

    // re-aponta os preços para o id canônico da loja
    pricesOS.openCursor().onsuccess = (e2) => {
      const c2 = e2.target.result;
      if (!c2) return;
      const pr = c2.value;
      const canon = remap[pr.storeId];
      if (canon && canon !== pr.storeId) { pr.storeId = canon; c2.update(pr); }
      c2.continue();
    };
  };
}

function reqToPromise(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function txDone(t) {
  return new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

async function getAll(store) {
  const db = await openDB();
  return reqToPromise(db.transaction(store).objectStore(store).getAll());
}

async function get(store, id) {
  const db = await openDB();
  return reqToPromise(db.transaction(store).objectStore(store).get(id));
}

async function put(store, obj) {
  const db = await openDB();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).put(obj);
  await txDone(t);
  return obj;
}

async function del(store, id) {
  const db = await openDB();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).delete(id);
  return txDone(t);
}

async function getByIndex(store, index, value) {
  const db = await openDB();
  return reqToPromise(db.transaction(store).objectStore(store).index(index).getAll(value));
}

const uid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  Date.now().toString(36) + Math.random().toString(36).slice(2);

// Junta um produto de catálogo com o estado do usuário (favorito + anotação)
// e resolve o nome da marca a partir do `brandId` (fonte única na store brands).
// A interface continua enxergando `favorite`, `userNote` e `brand` no objeto.
// Mantém fallback ao `p.brand` legado, caso algum registro antigo não migre.
function withUser(p, up, brandsById) {
  if (!p) return p;
  const brand = (brandsById && brandsById[p.brandId] && brandsById[p.brandId].name) || p.brand || '';
  return { ...p, brand, favorite: !!(up && up.favorite), userNote: (up && up.note) || '' };
}

// ---- API de alto nível usada pela interface ----
const DB = {
  // Produtos (já com estado do usuário e nome da marca resolvidos)
  async listProducts() {
    const [products, ups, brands] = await Promise.all([
      getAll('products'), getAll('userProducts'), getAll('brands'),
    ]);
    const byId = Object.fromEntries(ups.map((u) => [u.id, u]));
    const brandsById = Object.fromEntries(brands.map((b) => [b.id, b]));
    return products
      .map((p) => withUser(p, byId[p.id], brandsById))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },
  async getProduct(id) {
    const [p, up] = await Promise.all([get('products', id), get('userProducts', id)]);
    const b = p && p.brandId ? await get('brands', p.brandId) : null;
    return withUser(p, up, b ? { [b.id]: b } : null);
  },
  // Salva os dados intrínsecos do produto. `brand` (nome) e estado do usuário
  // são removidos de propósito: a marca vive como `brandId`, o resto em userProducts.
  saveProduct(p) {
    const { favorite, userNote, brand, ...rec } = p;
    if (!rec.id) {
      rec.id = uid();
      rec.createdAt = Date.now();
      rec.source = rec.source || 'user';
    }
    rec.updatedAt = Date.now();
    return put('products', rec);
  },
  async deleteProduct(id) {
    const prices = await getByIndex('prices', 'productId', id);
    await Promise.all(prices.map((pr) => del('prices', pr.id)));
    await del('userProducts', id).catch(() => {});
    return del('products', id);
  },

  // Marcas (entidade própria)
  async listBrands() {
    const brands = await getAll('brands');
    return brands.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  },
  getBrand: (id) => get('brands', id),
  // Encontra a marca pelo nome (id determinístico) ou cria uma nova. Devolve o id.
  // Mesma grafia ignorando acento/caixa → mesmo id → sem duplicata.
  async resolveBrand(name) {
    const clean = (name || '').trim();
    if (!clean) return null;
    const id = brandSlug(clean);
    if (!id || id === 'brand-') return null;
    const existing = await get('brands', id);
    if (existing) return id; // já existe: preserva a grafia canônica
    await put('brands', { id, name: clean, source: 'user', createdAt: Date.now(), updatedAt: Date.now() });
    return id;
  },
  async saveBrand(b) {
    if (!b.id) b.id = brandSlug(b.name);
    b.updatedAt = Date.now();
    if (!b.createdAt) b.createdAt = Date.now();
    b.source = b.source || 'user';
    return put('brands', b);
  },
  deleteBrand: (id) => del('brands', id),

  // Estado do usuário sobre um produto (favorito / anotação pessoal)
  async toggleFavorite(productId) {
    const up = (await get('userProducts', productId)) || { id: productId, note: '' };
    up.favorite = !up.favorite;
    await put('userProducts', up);
    return up.favorite;
  },
  async setUserNote(productId, note) {
    const up = (await get('userProducts', productId)) || { id: productId, favorite: false };
    up.note = note || '';
    return put('userProducts', up);
  },

  // Lojas
  async listStores() {
    const stores = await getAll('stores');
    return stores.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  },
  getStore: (id) => get('stores', id),
  // Find-or-create: sem id, deriva do nome (`store-<slug>`). Mesmo nome → mesmo
  // id → reconcilia com o catálogo sem duplicar. Editar preserva o id (não
  // recalcula no rename, pra não órfãos os preços que apontam pra loja).
  saveStore(s) {
    if (!s.id) {
      s.id = slugify(s.name) ? storeSlug(s.name) : uid();
      if (!s.createdAt) s.createdAt = Date.now();
      s.source = s.source || 'user';
    }
    return put('stores', s);
  },
  deleteStore: (id) => del('stores', id),

  // Preços
  pricesByProduct: (productId) => getByIndex('prices', 'productId', productId),
  savePrice(pr) {
    if (!pr.id) {
      pr.id = uid();
      pr.createdAt = Date.now();
      pr.source = pr.source || 'user';
    }
    return put('prices', pr);
  },
  deletePrice: (id) => del('prices', id),

  // Listas de desejos / orçamentos — { id, name, storeId?, items: [{ productId, qty }] }
  async listLists() {
    const lists = await getAll('lists');
    return lists.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  getList: (id) => get('lists', id),
  saveList(l) {
    if (!l.id) {
      l.id = uid();
      l.createdAt = Date.now();
    }
    if (!Array.isArray(l.items)) l.items = [];
    l.updatedAt = Date.now();
    return put('lists', l);
  },
  deleteList: (id) => del('lists', id),

  // ---- Versão do catálogo já sincronizada ----
  async getCatalogVersion() {
    const m = await get('meta', 'catalog');
    return (m && m.version) || 0;
  },
  setCatalogVersion(version) {
    return put('meta', { id: 'catalog', version, syncedAt: new Date().toISOString() });
  },

  // ---- Sincronização do catálogo (conflito-zero) ----
  // Recebe a UNIÃO de todos os produtos/lojas/preços do catálogo publicado e:
  //   - faz upsert dos registros de catálogo (marcados source:'catalog');
  //   - remove registros 'catalog' que sumiram do catálogo (produto descontinuado);
  //   - NUNCA toca em registros 'user' (cadastros do usuário) nem em userProducts/lists.
  // Lojas: só adiciona novas; nunca sobrescreve uma loja que já existe (preserva
  // a geolocalização/endereço que o usuário ajustou).
  async syncCatalog(data) {
    const incomingProducts = data.products || [];
    const incomingStores = data.stores || [];
    const incomingPrices = data.prices || [];
    const incomingBrands = data.brands || [];
    const productIds = new Set(incomingProducts.map((p) => p.id));
    const brandIds = new Set(incomingBrands.map((b) => b.id));

    const [existingProducts, existingStores, existingPrices, existingBrands] = await Promise.all([
      getAll('products'), getAll('stores'), getAll('prices'), getAll('brands'),
    ]);
    const storeById = Object.fromEntries(existingStores.map((s) => [s.id, s]));

    const db = await openDB();
    const t = db.transaction(['products', 'stores', 'prices', 'brands'], 'readwrite');
    const P = t.objectStore('products');
    const S = t.objectStore('stores');
    const PR = t.objectStore('prices');
    const B = t.objectStore('brands');

    // Marcas: upsert das de catálogo; remove as de catálogo que saíram.
    incomingBrands.forEach((b) => B.put({ ...b, source: 'catalog' }));
    existingBrands.forEach((b) => {
      if (b.source === 'catalog' && !brandIds.has(b.id)) B.delete(b.id);
    });

    // Produtos: upsert dos de catálogo; remove os de catálogo que saíram.
    incomingProducts.forEach((p) => P.put({ ...p, source: 'catalog' }));
    existingProducts.forEach((p) => {
      if (p.source === 'catalog' && !productIds.has(p.id)) P.delete(p.id);
    });

    // Preços: substitui o conjunto de preços de catálogo; preserva os do usuário.
    existingPrices.forEach((pr) => { if (pr.source === 'catalog') PR.delete(pr.id); });
    incomingPrices.forEach((pr) => PR.put({ ...pr, source: 'catalog' }));

    // Lojas: o catálogo é dono de nome/endereço; a localização (lat/lng) é do
    // aparelho (geocodificada ou ajustada pelo usuário). Atualiza nome/endereço,
    // mas preserva o pino existente — só usa coordenada do catálogo se ele trouxer.
    incomingStores.forEach((s) => {
      const prev = storeById[s.id];
      const merged = { ...s, source: 'catalog' };
      if (prev && s.lat == null && prev.lat != null) {
        merged.lat = prev.lat;
        merged.lng = prev.lng;
      }
      S.put(merged);
    });

    await txDone(t);

    const removed = existingProducts.filter((p) => p.source === 'catalog' && !productIds.has(p.id));
    return { upserted: incomingProducts.length, removed: removed.length };
  },

  // Backup / restauração (backup COMPLETO — catálogo + dados do usuário).
  // Itera sobre BACKUP_STORES: a lista de coleções é a única fonte de verdade.
  async exportAll() {
    const all = await Promise.all(BACKUP_STORES.map((name) => getAll(name)));
    const data = { version: DB_VERSION, exportedAt: new Date().toISOString() };
    BACKUP_STORES.forEach((name, i) => { data[name] = all[i]; });
    return data;
  },
  // Restaura um backup: regrava (upsert) cada registro do arquivo numa única
  // transação. NÃO apaga o que já existe no aparelho — só adiciona/atualiza, então
  // importar nunca destrói cadastros mais novos. Devolve a contagem por coleção.
  async importAll(data) {
    if (!data || typeof data !== 'object') throw new Error('arquivo ilegível');
    const present = BACKUP_STORES.filter((name) => Array.isArray(data[name]));
    if (!present.length) throw new Error('não parece um backup da Achadora');
    const db = await openDB();
    const t = db.transaction(BACKUP_STORES, 'readwrite');
    const counts = {};
    for (const name of BACKUP_STORES) {
      const records = Array.isArray(data[name]) ? data[name] : [];
      const os = t.objectStore(name);
      records.forEach((rec) => os.put(rec));
      counts[name] = records.length;
    }
    await txDone(t);
    return counts;
  },
};

window.DB = DB;
window.uid = uid;
