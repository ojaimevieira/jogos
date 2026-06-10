// Achadora — camada de banco de dados (IndexedDB, 100% local no aparelho)
//
// Modelo de dados (padrão ouro — separação por DONO do dado):
//
//   CATÁLOGO (você é o dono; o app só lê; um "Sincronizar" pode sobrescrever):
//     products  — produtos (perfumes etc.)            { id, name, brand, ..., source }
//     stores    — lojas                               { id, name, address, lat, lng, source }
//     prices    — preços observados                   { id, productId, storeId, value, ..., source }
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
const DB_VERSION = 3;
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

// Junta um produto de catálogo com o estado do usuário (favorito + anotação pessoal),
// para a interface continuar enxergando `favorite` e `userNote` no mesmo objeto.
function withUser(p, up) {
  if (!p) return p;
  return { ...p, favorite: !!(up && up.favorite), userNote: (up && up.note) || '' };
}

// ---- API de alto nível usada pela interface ----
const DB = {
  // Produtos (sempre devolvidos já com o estado do usuário embutido)
  async listProducts() {
    const [products, ups] = await Promise.all([getAll('products'), getAll('userProducts')]);
    const byId = Object.fromEntries(ups.map((u) => [u.id, u]));
    return products
      .map((p) => withUser(p, byId[p.id]))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },
  async getProduct(id) {
    const [p, up] = await Promise.all([get('products', id), get('userProducts', id)]);
    return withUser(p, up);
  },
  // Salva os dados intrínsecos do produto. Estado do usuário (favorite/userNote)
  // é removido aqui de propósito — vive em userProducts.
  saveProduct(p) {
    const { favorite, userNote, ...rec } = p;
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
  saveStore(s) {
    if (!s.id) {
      s.id = uid();
      s.createdAt = Date.now();
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
    const productIds = new Set(incomingProducts.map((p) => p.id));

    const [existingProducts, existingStores, existingPrices] = await Promise.all([
      getAll('products'), getAll('stores'), getAll('prices'),
    ]);
    const storeIds = new Set(existingStores.map((s) => s.id));

    const db = await openDB();
    const t = db.transaction(['products', 'stores', 'prices'], 'readwrite');
    const P = t.objectStore('products');
    const S = t.objectStore('stores');
    const PR = t.objectStore('prices');

    // Produtos: upsert dos de catálogo; remove os de catálogo que saíram.
    incomingProducts.forEach((p) => P.put({ ...p, source: 'catalog' }));
    existingProducts.forEach((p) => {
      if (p.source === 'catalog' && !productIds.has(p.id)) P.delete(p.id);
    });

    // Preços: substitui o conjunto de preços de catálogo; preserva os do usuário.
    existingPrices.forEach((pr) => { if (pr.source === 'catalog') PR.delete(pr.id); });
    incomingPrices.forEach((pr) => PR.put({ ...pr, source: 'catalog' }));

    // Lojas: só cria as novas (não apaga lat/lng/endereço de lojas existentes).
    incomingStores.forEach((s) => { if (!storeIds.has(s.id)) S.put({ ...s, source: 'catalog' }); });

    await txDone(t);

    const removed = existingProducts.filter((p) => p.source === 'catalog' && !productIds.has(p.id));
    return { upserted: incomingProducts.length, removed: removed.length };
  },

  // Backup / restauração (backup COMPLETO — catálogo + dados do usuário)
  async exportAll() {
    const [products, stores, prices, lists, userProducts, meta] = await Promise.all([
      getAll('products'), getAll('stores'), getAll('prices'),
      getAll('lists'), getAll('userProducts'), getAll('meta'),
    ]);
    return {
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      products, stores, prices, lists, userProducts, meta,
    };
  },
  // Restaura um backup completo — sobrescreve com o estado exato do arquivo.
  async importAll(data) {
    const db = await openDB();
    const t = db.transaction(['products', 'stores', 'prices', 'lists', 'userProducts', 'meta'], 'readwrite');
    (data.products || []).forEach((p) => t.objectStore('products').put(p));
    (data.stores || []).forEach((s) => t.objectStore('stores').put(s));
    (data.prices || []).forEach((p) => t.objectStore('prices').put(p));
    (data.lists || []).forEach((l) => t.objectStore('lists').put(l));
    (data.userProducts || []).forEach((u) => t.objectStore('userProducts').put(u));
    (data.meta || []).forEach((m) => t.objectStore('meta').put(m));
    return txDone(t);
  },
};

window.DB = DB;
window.uid = uid;
