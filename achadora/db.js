// Achadora — camada de banco de dados (IndexedDB, 100% local no aparelho)
// Três "tabelas": products (produtos), stores (lojas) e prices (preços por loja).

const DB_NAME = 'achadora';
const DB_VERSION = 1;
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('products')) {
        const s = db.createObjectStore('products', { keyPath: 'id' });
        s.createIndex('category', 'category', { unique: false });
        s.createIndex('favorite', 'favorite', { unique: false });
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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
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

// ---- API de alto nível usada pela interface ----
const DB = {
  // Produtos
  async listProducts() {
    const products = await getAll('products');
    return products.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },
  getProduct: (id) => get('products', id),
  saveProduct(p) {
    if (!p.id) {
      p.id = uid();
      p.createdAt = Date.now();
    }
    p.updatedAt = Date.now();
    return put('products', p);
  },
  async deleteProduct(id) {
    // remove também os preços ligados ao produto
    const prices = await getByIndex('prices', 'productId', id);
    await Promise.all(prices.map((pr) => del('prices', pr.id)));
    return del('products', id);
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
    }
    return put('prices', pr);
  },
  deletePrice: (id) => del('prices', id),

  // Backup / restauração
  async exportAll() {
    const [products, stores, prices] = await Promise.all([
      getAll('products'),
      getAll('stores'),
      getAll('prices'),
    ]);
    return { version: DB_VERSION, exportedAt: new Date().toISOString(), products, stores, prices };
  },
  async importAll(data) {
    const db = await openDB();
    const t = db.transaction(['products', 'stores', 'prices'], 'readwrite');
    (data.products || []).forEach((p) => t.objectStore('products').put(p));
    (data.stores || []).forEach((s) => t.objectStore('stores').put(s));
    (data.prices || []).forEach((p) => t.objectStore('prices').put(p));
    return txDone(t);
  },
};

window.DB = DB;
window.uid = uid;
