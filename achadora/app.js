// Achadora — lógica da interface (vanilla JS, sem dependências)

const CATEGORIES = ['Perfumes', 'Maquiagem', 'Skincare', 'Cabelo', 'Outros'];
const CURRENCIES = [
  { code: 'BRL', label: 'R$ Real (BRL)' },
  { code: 'USD', label: '$ Dólar (USD)' },
  { code: 'EUR', label: '€ Euro (EUR)' },
  { code: 'ARS', label: '$ Peso Arg. (ARS)' },
  { code: 'PYG', label: '₲ Guarani (PYG)' },
  { code: 'UYU', label: '$ Peso Uru. (UYU)' },
];

function formatPrice(value, currency) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(value);
  } catch {
    return (currency || '') + ' ' + value.toFixed(2);
  }
}

function currencyOptions(selected) {
  return CURRENCIES.map((c) =>
    `<option value="${c.code}" ${(selected || 'BRL') === c.code ? 'selected' : ''}>${c.label}</option>`
  ).join('');
}

const state = {
  tab: 'catalogo',     // catalogo | favoritos | lojas
  search: '',
  category: 'Todos',   // chip de categoria (rápido)
  brands: [],          // marcas selecionadas no painel (vazio = todas)
  stores: [],          // ids de loja selecionados no painel (vazio = todas)
  lojasView: 'lista',  // lista | mapa
};

function activeFilterCount() {
  return state.brands.length + state.stores.length;
}
function clearFilters() {
  state.brands = []; state.stores = [];
}

// Marcas distintas presentes no banco (pra preencher o filtro)
async function distinctBrands() {
  const products = await DB.listProducts();
  return [...new Set(products.map((p) => p.brand).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

const app = document.getElementById('app');
const $ = (sel, root = document) => root.querySelector(sel);

// ---------- utilidades ----------
function toast(msg) {
  let t = $('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Comprime a foto pra não estourar o armazenamento do navegador
function compressImage(file, maxSize = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > height && width > maxSize) { height = (height * maxSize) / width; width = maxSize; }
      else if (height > maxSize) { width = (width * maxSize) / height; height = maxSize; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Resumo de preços de um produto: { best, count } (best = preço mais barato + loja)
async function priceSummary(productId) {
  const prices = await DB.pricesByProduct(productId);
  if (!prices.length) return { best: null, count: 0, prices: [] };
  prices.sort((a, b) => a.value - b.value);
  const best = prices[0];
  const store = best.storeId ? await DB.getStore(best.storeId) : null;
  return { best, bestStore: store, count: prices.length, prices };
}

// ---------- render principal ----------
async function render() {
  if (state.tab === 'lojas') return renderStores();
  if (state.tab === 'listas') return renderLists();
  return renderCatalog();
}

async function renderCatalog() {
  const onlyFav = state.tab === 'favoritos';
  let products = await DB.listProducts();

  if (onlyFav) products = products.filter((p) => p.favorite);
  if (state.category !== 'Todos') products = products.filter((p) => p.category === state.category);
  if (state.brands.length) products = products.filter((p) => state.brands.includes(p.brand || ''));
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    products = products.filter((p) =>
      `${p.name} ${p.brand || ''}`.toLowerCase().includes(q));
  }

  let summaries = await Promise.all(products.map((p) => priceSummary(p.id)));

  // filtro por loja: produto precisa ter preço em alguma loja selecionada
  if (state.stores.length) {
    const kept = products
      .map((p, i) => [p, summaries[i]])
      .filter(([, s]) => s.prices.some((pr) => state.stores.includes(pr.storeId)));
    products = kept.map((x) => x[0]);
    summaries = kept.map((x) => x[1]);
  }

  const stores = await DB.listStores();
  const storeName = Object.fromEntries(stores.map((s) => [s.id, s.name]));
  const count = activeFilterCount();

  // produtos que já estão em alguma lista (pra mostrar o selo na miniatura)
  const lists = await DB.listLists();
  const inAnyList = new Set();
  lists.forEach((l) => (l.items || []).forEach((it) => inAnyList.add(it.productId)));

  // chips de categoria (rolagem horizontal rápida)
  const catChips = ['Todos', ...CATEGORIES]
    .map((c) => `<button class="chip ${state.category === c ? 'active' : ''}" data-cat="${c}">${c}</button>`)
    .join('');

  // chips dos filtros ativos do painel (removíveis)
  const activeChips = [
    ...state.brands.map((b) => `<button class="achip" data-rm="brand" data-val="${esc(b)}">${esc(b)} ✕</button>`),
    ...state.stores.map((id) => `<button class="achip" data-rm="store" data-val="${esc(id)}">🏪 ${esc(storeName[id] || 'Loja')} ✕</button>`),
  ].join('');

  let body;
  if (!products.length) {
    const filtered = count > 0 || state.search.trim();
    body = `<div class="empty">
      <div class="big">${onlyFav ? '⭐' : '🔎'}</div>
      <p>${filtered
        ? 'Nenhum produto com esses filtros.<br>Tente afrouxar a busca.'
        : (onlyFav ? 'Nenhum favorito ainda.<br>Toque na estrela de um produto.' : 'Catálogo vazio.<br>Toque no + pra cadastrar o primeiro achado.')}</p>
    </div>`;
  } else {
    body = `<div class="grid">${products.map((p, i) => productCard(p, summaries[i], inAnyList.has(p.id))).join('')}</div>`;
  }

  app.innerHTML = `
    <header class="app-header">
      <h1>✨ Achadora</h1>
      <div class="subtitle">${onlyFav ? 'Seus favoritos' : 'Seu catálogo de garimpo'}</div>
    </header>
    <div class="search-row">
      <div class="search">
        🔍 <input id="search" placeholder="Buscar por nome ou marca" value="${esc(state.search)}" />
      </div>
      <button class="filter-btn ${count ? 'on' : ''}" id="filter-btn" aria-label="Filtros">
        🎛️${count ? `<span class="badge">${count}</span>` : ''}
      </button>
    </div>
    ${onlyFav ? '' : `<div class="chips">${catChips}</div>`}
    ${count ? `<div class="active-filters">${activeChips}<button class="achip clear" data-rm="all">Limpar</button></div>` : ''}
    <main>${body}</main>
    <button class="fab" id="fab" aria-label="Adicionar produto">+</button>
  `;

  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value;
    // re-render leve da lista sem perder o foco do input
    debouncedRerenderList();
  });
  $('#filter-btn').addEventListener('click', () => openFilterSheet());
  $('#fab').addEventListener('click', () => openProductForm());
  app.querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => { state.category = c.dataset.cat; render(); }));
  app.querySelectorAll('.active-filters .achip').forEach((b) =>
    b.addEventListener('click', () => {
      const { rm, val } = b.dataset;
      if (rm === 'all') clearFilters();
      else if (rm === 'brand') state.brands = state.brands.filter((x) => x !== val);
      else if (rm === 'store') state.stores = state.stores.filter((x) => x !== val);
      render();
    }));
  app.querySelectorAll('.card .fav').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(b.dataset.id); }));
  app.querySelectorAll('.card .inlist').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); openAddToList(b.dataset.id); }));
  app.querySelectorAll('.card[data-id]').forEach((c) =>
    c.addEventListener('click', () => openProductDetail(c.dataset.id)));
}

// Painel de filtros (Marca, Loja, Categoria) — abre de baixo pra cima
async function openFilterSheet() {
  const brands = await distinctBrands();
  const stores = await DB.listStores();
  const sel = { brands: new Set(state.brands), stores: new Set(state.stores) };

  const fchip = (val, label, group) =>
    `<button class="fchip ${sel[group].has(val) ? 'active' : ''}" data-group="${group}" data-val="${esc(val)}">${esc(label)}</button>`;

  const brandSec = brands.length
    ? `<div class="section-title">Marca</div><div class="fchips">${brands.map((b) => fchip(b, b, 'brands')).join('')}</div>` : '';
  const storeSec = stores.length
    ? `<div class="section-title">Loja</div><div class="fchips">${stores.map((s) => fchip(s.id, s.name, 'stores')).join('')}</div>` : '';

  const bg = openSheet(`
    <h2>Filtros</h2>
    ${brandSec}
    ${storeSec}
    <div class="row" style="margin-top:20px">
      <button class="btn secondary" id="f-clear">Limpar</button>
      <button class="btn" id="f-apply">Aplicar</button>
    </div>
  `);

  bg.querySelectorAll('.fchip').forEach((b) =>
    b.addEventListener('click', () => {
      const { group, val } = b.dataset;
      if (sel[group].has(val)) sel[group].delete(val); else sel[group].add(val);
      b.classList.toggle('active');
    }));
  $('#f-clear', bg).addEventListener('click', () => { clearFilters(); closeSheet(bg); render(); });
  $('#f-apply', bg).addEventListener('click', () => {
    state.brands = [...sel.brands];
    state.stores = [...sel.stores];
    closeSheet(bg);
    render();
  });
}

let _rerenderTimer;
function debouncedRerenderList() {
  clearTimeout(_rerenderTimer);
  _rerenderTimer = setTimeout(render, 220);
}

function productCard(p, summary, inList = false) {
  const thumb = p.image
    ? `<img class="thumb" src="${p.image}" alt="">`
    : `<div class="thumb placeholder">🧴</div>`;
  let price;
  if (summary.best) {
    price = `<div class="price">${formatPrice(summary.best.value, summary.best.currency)}
      <small>${summary.count > 1 ? `menor de ${summary.count} lojas` : esc(summary.bestStore?.name || 'preço único')}</small></div>`;
  } else {
    price = `<div class="price none">sem preço</div>`;
  }
  return `
    <div class="card" data-id="${p.id}">
      ${thumb}
      <div class="badges">
        <button class="fav" data-id="${p.id}">${p.favorite ? '❤️' : '🤍'}</button>
        <button class="inlist ${inList ? 'on' : ''}" data-id="${p.id}" aria-label="Adicionar a uma lista" title="${inList ? 'Já está em uma lista' : 'Adicionar a uma lista'}">🧾</button>
      </div>
      <div class="info">
        <div class="name">${esc(p.name)}</div>
        <div class="brand">${esc(p.brand || '—')}</div>
        ${price}
      </div>
    </div>`;
}

async function toggleFav(id) {
  const p = await DB.getProduct(id);
  if (!p) return;
  p.favorite = !p.favorite;
  await DB.saveProduct(p);
  render();
}

// ---------- mapa (Leaflet sob demanda + OpenStreetMap) ----------
let _leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.async = true;
    s.onload = () => (window.L ? resolve(window.L) : reject(new Error('leaflet')));
    s.onerror = () => reject(new Error('leaflet'));
    document.head.appendChild(s);
  });
  return _leafletPromise;
}

// garante que os ícones de pino carreguem (evita o clássico pino quebrado do Leaflet via CDN)
let _iconSet = false;
function setDefaultIcon(L) {
  if (_iconSet) return;
  _iconSet = true;
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });
}

function newMap(L, el, center, zoom) {
  const map = L.map(el).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  return map;
}

// geocodifica um endereço via Nominatim (OSM). Retorna {lat,lng} ou null.
async function geocodeAddress(q) {
  if (!q || !q.trim()) return null;
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q.trim());
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (e) {
    return null;
  }
}

// abre a loja no Google Maps (app nativo no celular)
function openMapsApp(store) {
  if (!store) return;
  const q = (store.lat != null && store.lng != null)
    ? `${store.lat},${store.lng}`
    : (store.address || store.name);
  window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q), '_blank');
}

// ---------- lojas ----------
async function renderStores() {
  const stores = await DB.listStores();
  const view = state.lojasView || 'lista';

  const toggle = `
    <div class="seg">
      <button class="seg-btn ${view === 'lista' ? 'on' : ''}" data-view="lista">📋 Lista</button>
      <button class="seg-btn ${view === 'mapa' ? 'on' : ''}" data-view="mapa">🗺️ Mapa</button>
    </div>`;

  let body;
  if (view === 'mapa') {
    body = `<div id="store-map" class="store-map"></div><div id="map-hint" class="map-hint"></div>`;
  } else if (stores.length) {
    body = stores.map((s) => `
        <div class="list-item">
          <div>
            <div class="t">🏪 ${esc(s.name)}</div>
            ${s.address ? `<div class="s">${esc(s.address)}</div>` : ''}
            <div class="s ${s.lat != null ? 'loc' : 'noloc'}">${s.lat != null ? '📍 localização marcada' : 'sem localização'}</div>
          </div>
          <div class="li-actions">
            ${(s.lat != null || s.address) ? `<button class="icon-btn" data-maps="${s.id}" title="Abrir no Google Maps">🧭</button>` : ''}
            <button class="icon-btn" data-edit="${s.id}">✏️</button>
          </div>
        </div>`).join('');
  } else {
    body = `<div class="empty"><div class="big">🏪</div><p>Nenhuma loja salva.<br>Adicione uma pra reutilizar nos cadastros.</p></div>`;
  }

  app.innerHTML = `
    <header class="app-header">
      <h1>✨ Achadora</h1>
      <div class="subtitle">Lojas</div>
    </header>
    ${toggle}
    <main>
      ${body}
      ${view === 'lista' ? '<button class="btn secondary" id="add-store" style="margin-top:8px">+ Nova loja</button>' : ''}
    </main>
  `;

  app.querySelectorAll('.seg-btn').forEach((b) =>
    b.addEventListener('click', () => { state.lojasView = b.dataset.view; render(); }));

  if (view === 'mapa') {
    initStoreMap(stores);
  } else {
    const add = $('#add-store');
    if (add) add.addEventListener('click', () => openStoreForm());
    app.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => openStoreForm(b.dataset.edit)));
    app.querySelectorAll('[data-maps]').forEach((b) =>
      b.addEventListener('click', async () => openMapsApp(await DB.getStore(b.dataset.maps))));
  }
}

async function initStoreMap(stores) {
  const located = stores.filter((s) => s.lat != null && s.lng != null);
  const hint = $('#map-hint');
  if (hint && !located.length) {
    hint.innerHTML = 'Nenhuma loja com localização ainda. Edite uma loja e marque o ponto (por endereço, GPS ou tocando no mapa).';
  }
  let L;
  try {
    L = await loadLeaflet();
  } catch (e) {
    const el = $('#store-map');
    if (el) el.innerHTML = '<div class="map-fail">Não consegui carregar o mapa (sem internet?).<br>Use o 🧭 na aba Lista pra abrir no Google Maps.</div>';
    return;
  }
  setDefaultIcon(L);
  const el = $('#store-map');
  if (!el) return;
  const center = located.length ? [located[0].lat, located[0].lng] : [-14.235, -51.925];
  const map = newMap(L, el, center, located.length ? 13 : 4);
  setTimeout(() => map.invalidateSize(), 200);

  const pts = [];
  located.forEach((s) => {
    const m = L.marker([s.lat, s.lng]).addTo(map);
    m.bindPopup(`<b>🏪 ${esc(s.name)}</b>${s.address ? '<br>' + esc(s.address) : ''}
      <br><a href="#" data-pop-maps="${s.id}">🧭 Google Maps</a>
      &nbsp;·&nbsp;<a href="#" data-pop-prod="${s.id}">ver produtos</a>`);
    pts.push([s.lat, s.lng]);
  });
  if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40] });

  map.on('popupopen', (e) => {
    const node = e.popup.getElement();
    const mapsLink = node.querySelector('[data-pop-maps]');
    const prodLink = node.querySelector('[data-pop-prod]');
    if (mapsLink) mapsLink.addEventListener('click', async (ev) => {
      ev.preventDefault();
      openMapsApp(await DB.getStore(mapsLink.dataset.popMaps));
    });
    if (prodLink) prodLink.addEventListener('click', (ev) => {
      ev.preventDefault();
      state.stores = [prodLink.dataset.popProd];
      state.tab = 'catalogo';
      document.querySelectorAll('.tabbar button').forEach((b) =>
        b.classList.toggle('active', b.dataset.tab === 'catalogo'));
      render();
    });
  });
}

// ---------- listas de desejos / orçamentos ----------

// Melhor preço de um produto numa loja específica; sem loja, o melhor preço geral.
function priceForStore(prices, storeId) {
  const pool = storeId ? prices.filter((p) => p.storeId === storeId) : prices;
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => a.value - b.value)[0];
}

// Resolve os itens de uma lista (produto + preço + subtotal) e os totais por moeda.
async function computeList(list) {
  const rows = [];
  for (const it of list.items || []) {
    const product = await DB.getProduct(it.productId);
    if (!product) continue; // produto foi removido do catálogo
    const prices = await DB.pricesByProduct(it.productId);
    const price = priceForStore(prices, list.storeId || null);
    const qty = it.qty || 1;
    rows.push({
      productId: it.productId, qty, product,
      unit: price ? price.value : null,
      currency: price ? price.currency : null,
      lineTotal: price ? price.value * qty : null,
    });
  }
  const totals = {};
  rows.forEach((r) => { if (r.lineTotal != null) totals[r.currency] = (totals[r.currency] || 0) + r.lineTotal; });
  return { rows, totals };
}

function totalsToStr(totals) {
  return Object.entries(totals).map(([c, v]) => formatPrice(v, c)).join(' + ') || '—';
}

async function renderLists() {
  const lists = await DB.listLists();
  const stores = await DB.listStores();
  const storeName = Object.fromEntries(stores.map((s) => [s.id, s.name]));

  let body;
  if (!lists.length) {
    body = `<div class="empty"><div class="big">🧾</div>
      <p>Nenhuma lista ainda.<br>Crie uma lista pra montar um orçamento com uma loja.</p></div>`;
  } else {
    const computed = await Promise.all(lists.map((l) => computeList(l)));
    body = lists.map((l, i) => {
      const count = (l.items || []).length;
      return `
        <div class="list-card" data-list="${l.id}">
          <div class="lc-main">
            <div class="lc-name">🧾 ${esc(l.name)}</div>
            <div class="lc-meta">${count} ${count === 1 ? 'item' : 'itens'}${l.storeId ? ' · 🏪 ' + esc(storeName[l.storeId] || 'Loja') : ''}</div>
          </div>
          <div class="lc-total">${totalsToStr(computed[i].totals)}</div>
        </div>`;
    }).join('');
  }

  app.innerHTML = `
    <header class="app-header">
      <h1>✨ Achadora</h1>
      <div class="subtitle">Listas de desejos</div>
    </header>
    <main>
      ${body}
      <button class="btn" id="new-list" style="margin-top:10px">+ Nova lista</button>
    </main>
  `;
  $('#new-list').addEventListener('click', () => openListForm());
  app.querySelectorAll('[data-list]').forEach((c) =>
    c.addEventListener('click', () => openListDetail(c.dataset.list)));
}

async function openListForm(existing) {
  const list = existing || { name: '', storeId: '', items: [] };
  const stores = await DB.listStores();
  const storeOptions = stores
    .map((s) => `<option value="${s.id}" ${list.storeId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const bg = openSheet(`
    <h2>${existing ? 'Editar lista' : 'Nova lista'}</h2>
    <label class="field"><span>Nome da lista</span>
      <input class="input" id="l-name" value="${esc(list.name)}" placeholder="Ex.: Orçamento Mega Eletrônicos"></label>
    <label class="field"><span>Loja do orçamento (opcional)</span>
      <select class="input" id="l-store">
        <option value="">— sem loja definida —</option>${storeOptions}
      </select></label>
    <p class="muted-note">Com uma loja definida, a lista usa os preços daquela loja e soma o total.</p>
    <button class="btn" id="l-save" style="margin-top:14px">Salvar</button>
  `);
  $('#l-save', bg).addEventListener('click', async () => {
    const name = $('#l-name', bg).value.trim();
    if (!name) return toast('Dê um nome pra lista');
    const saved = await DB.saveList({ ...list, name, storeId: $('#l-store', bg).value || null });
    closeSheet(bg);
    toast('Lista salva');
    if (existing) render(); else openListDetail(saved.id);
  });
}

async function openListDetail(id) {
  const list = await DB.getList(id);
  if (!list) return;
  const stores = await DB.listStores();
  const storeName = Object.fromEntries(stores.map((s) => [s.id, s.name]));
  const { rows } = await computeList(list);

  const itemRows = rows.length
    ? rows.map((r) => `
        <div class="li-row" data-row="${r.productId}">
          ${r.product.image ? `<img class="li-thumb" src="${r.product.image}" alt="">` : '<div class="li-thumb placeholder">🧴</div>'}
          <div class="li-info">
            <div class="li-name">${esc(r.product.name)}</div>
            <div class="li-price">${r.unit != null
              ? formatPrice(r.unit, r.currency) + ' <span class="muted">un.</span>'
              : '<span class="muted">sem preço' + (list.storeId ? ' nesta loja' : '') + '</span>'}</div>
          </div>
          <div class="li-qty">
            <button class="qbtn" data-dec="${r.productId}">−</button>
            <span class="qval" data-qty="${r.productId}">${r.qty}</span>
            <button class="qbtn" data-inc="${r.productId}">+</button>
          </div>
          <button class="li-del" data-rm="${r.productId}" aria-label="Remover">🗑️</button>
        </div>`).join('')
    : '<p class="muted-note">Lista vazia. Toque em "Adicionar produtos".</p>';

  const bg = openSheet(`
    <div class="detail">
      <h2>🧾 ${esc(list.name)}</h2>
      <div class="brand">${list.storeId ? '🏪 ' + esc(storeName[list.storeId] || 'Loja') : 'Sem loja definida'}</div>
      <div class="li-list">${itemRows}</div>
      ${rows.length ? `<div class="li-total"><span>Total</span><strong>—</strong></div>` : ''}
      <button class="btn secondary" id="l-add" style="margin-top:12px">+ Adicionar produtos</button>
      <div class="row" style="margin-top:10px">
        <button class="btn secondary" id="l-edit">✏️ Editar</button>
        <button class="btn" id="l-pdf">📄 Exportar PDF</button>
      </div>
      <button class="btn danger" id="l-del" style="margin-top:10px">Excluir lista</button>
    </div>
  `);

  // modelo mutável pra atualizar quantidades/total sem reabrir a folha
  const model = rows;
  const updateTotal = () => {
    const totals = {};
    model.forEach((r) => { if (r.lineTotal != null) totals[r.currency] = (totals[r.currency] || 0) + r.lineTotal; });
    const el = $('.li-total strong', bg);
    if (el) el.textContent = totalsToStr(totals);
  };
  updateTotal();

  const persist = async (mutate) => {
    const l = await DB.getList(id);
    mutate(l);
    await DB.saveList(l);
  };
  const changeQty = (productId, delta) => {
    const r = model.find((x) => x.productId === productId);
    if (!r) return;
    r.qty = Math.max(1, r.qty + delta);
    r.lineTotal = r.unit != null ? r.unit * r.qty : null;
    const q = $(`[data-qty="${productId}"]`, bg);
    if (q) q.textContent = r.qty;
    updateTotal();
    persist((l) => { const it = (l.items || []).find((x) => x.productId === productId); if (it) it.qty = r.qty; });
  };
  bg.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => changeQty(b.dataset.inc, +1)));
  bg.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => changeQty(b.dataset.dec, -1)));
  bg.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    const pid = b.dataset.rm;
    const i = model.findIndex((x) => x.productId === pid);
    if (i >= 0) model.splice(i, 1);
    const rowEl = $(`.li-row[data-row="${pid}"]`, bg);
    if (rowEl) rowEl.remove();
    updateTotal();
    await persist((l) => { l.items = (l.items || []).filter((x) => x.productId !== pid); });
    if (!model.length) { closeSheet(bg); openListDetail(id); }
  }));
  $('#l-add', bg).addEventListener('click', () => openProductPicker(id, bg));
  $('#l-edit', bg).addEventListener('click', async () => { closeSheet(bg); openListForm(await DB.getList(id)); });
  $('#l-pdf', bg).addEventListener('click', () => exportListPDF(id));
  $('#l-del', bg).addEventListener('click', async () => {
    if (!confirm('Excluir esta lista?')) return;
    await DB.deleteList(id);
    closeSheet(bg);
    toast('Lista excluída');
    render();
  });
}

// Seletor de produtos pra adicionar numa lista (toca pra incluir/remover)
async function openProductPicker(listId, parentBg) {
  const list = await DB.getList(listId);
  const inList = new Set((list.items || []).map((x) => x.productId));
  const products = await DB.listProducts();
  let q = '';

  const bg = openSheet(`
    <h2>Adicionar produtos</h2>
    <div class="search" style="margin:0 0 10px"><input id="pick-search" placeholder="🔍 Buscar por nome ou marca"></div>
    <div class="pick-list" id="pick-list"></div>
    <button class="btn" id="pick-done" style="margin-top:12px">Concluir</button>
  `);

  const renderPick = () => {
    const ql = q.trim().toLowerCase();
    const filtered = (ql ? products.filter((p) => `${p.name} ${p.brand || ''}`.toLowerCase().includes(ql)) : products).slice(0, 80);
    const host = $('#pick-list', bg);
    host.innerHTML = filtered.map((p) => `
      <div class="pick-row ${inList.has(p.id) ? 'on' : ''}" data-pick="${p.id}">
        ${p.image ? `<img class="li-thumb" src="${p.image}" alt="">` : '<div class="li-thumb placeholder">🧴</div>'}
        <div class="li-info"><div class="li-name">${esc(p.name)}</div><div class="li-price muted">${esc(p.brand || '')}</div></div>
        <div class="pick-check">${inList.has(p.id) ? '✓' : '+'}</div>
      </div>`).join('') || '<p class="muted-note">Nada encontrado.</p>';
    host.querySelectorAll('[data-pick]').forEach((row) =>
      row.addEventListener('click', async () => {
        const pid = row.dataset.pick;
        const l = await DB.getList(listId);
        l.items = l.items || [];
        if (inList.has(pid)) { l.items = l.items.filter((x) => x.productId !== pid); inList.delete(pid); }
        else { l.items.push({ productId: pid, qty: 1 }); inList.add(pid); }
        await DB.saveList(l);
        row.classList.toggle('on', inList.has(pid));
        $('.pick-check', row).textContent = inList.has(pid) ? '✓' : '+';
      }));
  };
  $('#pick-search', bg).addEventListener('input', (e) => { q = e.target.value; renderPick(); });
  $('#pick-done', bg).addEventListener('click', () => { closeSheet(bg); closeSheet(parentBg); openListDetail(listId); });
  renderPick();
}

// Adicionar um produto a uma lista (a partir do detalhe do produto)
async function openAddToList(productId) {
  const lists = await DB.listLists();
  const opts = lists.map((l) =>
    `<button class="btn secondary list-pick" data-l="${l.id}" style="margin-top:8px">🧾 ${esc(l.name)}</button>`).join('');
  const bg = openSheet(`
    <h2>Adicionar à lista</h2>
    ${lists.length ? opts : '<p class="muted-note">Você ainda não tem listas. Crie a primeira:</p>'}
    <button class="btn" id="atl-new" style="margin-top:12px">+ Nova lista com este produto</button>
  `);
  bg.querySelectorAll('.list-pick').forEach((b) => b.addEventListener('click', async () => {
    const l = await DB.getList(b.dataset.l);
    l.items = l.items || [];
    if (l.items.some((x) => x.productId === productId)) toast('Já está nessa lista');
    else { l.items.push({ productId, qty: 1 }); await DB.saveList(l); toast('Adicionado à lista ✨'); }
    closeSheet(bg);
    render(); // atualiza o selo 🧾 na miniatura
  }));
  $('#atl-new', bg).addEventListener('click', async () => {
    const name = prompt('Nome da nova lista:');
    if (name && name.trim()) {
      await DB.saveList({ name: name.trim(), storeId: null, items: [{ productId, qty: 1 }] });
      toast('Lista criada com o produto ✨');
    }
    closeSheet(bg);
    render();
  });
}

// Exporta a lista como PDF imprimindo um iframe isolado e autossuficiente.
// Mais robusto no celular do que depender de @media print na página viva.
async function exportListPDF(id) {
  const list = await DB.getList(id);
  if (!list) return;
  const stores = await DB.listStores();
  const storeName = Object.fromEntries(stores.map((s) => [s.id, s.name]));
  const { rows, totals } = await computeList(list);
  const dateStr = new Date().toLocaleDateString('pt-BR');

  const rowsHtml = rows.map((r) => `
    <tr>
      <td>${esc(r.product.name)}${r.product.volume ? ` <span class="vol">${esc(r.product.volume)}</span>` : ''}</td>
      <td class="num">${r.qty}</td>
      <td class="num">${r.unit != null ? formatPrice(r.unit, r.currency) : '—'}</td>
      <td class="num">${r.lineTotal != null ? formatPrice(r.lineTotal, r.currency) : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="4">Lista vazia.</td></tr>';

  const docHtml = `<!DOCTYPE html><html lang="pt-br"><head><meta charset="utf-8">
    <title>${esc(list.name)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 24px; }
      h1 { margin: 0 0 4px; font-size: 22px; }
      .sub { color: #555; font-size: 13px; margin-bottom: 18px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
      th { border-bottom: 2px solid #333; text-transform: uppercase; font-size: 11px; color: #555; }
      .num { text-align: right; white-space: nowrap; }
      .vol { color: #777; font-size: 11px; }
      .total { display: flex; justify-content: space-between; margin-top: 16px;
        padding-top: 10px; border-top: 2px solid #333; font-size: 17px; font-weight: 700; }
      .foot { margin-top: 28px; color: #999; font-size: 11px; text-align: center; }
    </style></head><body>
      <h1>${esc(list.name)}</h1>
      <div class="sub">${list.storeId ? esc(storeName[list.storeId] || 'Loja') + ' · ' : ''}${dateStr}</div>
      <table>
        <thead><tr><th>Produto</th><th class="num">Qtd</th><th class="num">Preço un.</th><th class="num">Subtotal</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="total"><span>Total</span><span>${totalsToStr(totals)}</span></div>
      <div class="foot">Gerado pela Achadora · ${dateStr}</div>
    </body></html>`;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;';
  document.body.appendChild(iframe);

  const fire = () => {
    const cw = iframe.contentWindow;
    try { cw.focus(); cw.print(); } catch (e) { toast('Não foi possível abrir a impressão'); }
    // remove o iframe depois que o diálogo fecha (com folga de segurança)
    let removed = false;
    const done = () => { if (removed) return; removed = true; iframe.remove(); };
    cw.addEventListener('afterprint', done);
    setTimeout(done, 60000);
  };

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(docHtml);
  doc.close();
  // dá um tempinho pro layout/fonte assentarem antes de imprimir
  if (doc.readyState === 'complete') setTimeout(fire, 120);
  else iframe.onload = () => setTimeout(fire, 120);
}

// ---------- folha inferior genérica ----------
function openSheet(html) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        <div class="sheet-head-spacer"></div>
        <div class="grabber"></div>
        <button class="sheet-close" aria-label="Fechar">✕</button>
      </div>
      <div class="sheet-body">${html}</div>
    </div>`;
  const sheet = $('.sheet', bg);

  // fecha tocando no fundo escuro
  bg.addEventListener('click', (e) => { if (e.target === bg) closeSheet(bg); });
  // fecha no botão ✕
  $('.sheet-close', bg).addEventListener('click', () => closeSheet(bg));
  // fecha no Esc (desktop)
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(bg); };
  document.addEventListener('keydown', onKey);
  bg._onKey = onKey;

  // arrastar pra baixo pra fechar (a partir da alça/cabeçalho)
  enableDragToClose(bg, sheet);

  // animação de entrada
  requestAnimationFrame(() => bg.classList.add('show'));
  document.body.appendChild(bg);
  // segunda chamada de rAF garante a transição mesmo recém-anexado
  requestAnimationFrame(() => bg.classList.add('show'));
  return bg;
}

function closeSheet(bg) {
  if (!bg || bg._closing) return;
  bg._closing = true;
  if (bg._onKey) document.removeEventListener('keydown', bg._onKey);
  bg.classList.remove('show');
  bg.classList.add('closing');
  const done = () => bg.remove();
  bg.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 320); // fallback se a transição não disparar
}

// Permite arrastar a folha pra baixo (alça/cabeçalho) e soltar pra fechar
function enableDragToClose(bg, sheet) {
  const head = $('.sheet-head', bg);
  let startY = 0, dy = 0, dragging = false;

  const onStart = (e) => {
    dragging = true;
    startY = (e.touches ? e.touches[0].clientY : e.clientY);
    dy = 0;
    sheet.style.transition = 'none';
  };
  const onMove = (e) => {
    if (!dragging) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    dy = Math.max(0, y - startY);
    sheet.style.transform = `translateY(${dy}px)`;
    if (e.cancelable) e.preventDefault();
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    if (dy > 110) {
      closeSheet(bg);
    } else {
      sheet.style.transform = '';
    }
  };

  head.addEventListener('touchstart', onStart, { passive: true });
  head.addEventListener('touchmove', onMove, { passive: false });
  head.addEventListener('touchend', onEnd);
  head.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
}

// ---------- formulário de loja ----------
async function openStoreForm(id) {
  const store = id ? await DB.getStore(id) : { name: '', address: '' };
  let picked = (store.lat != null && store.lng != null) ? { lat: store.lat, lng: store.lng } : null;

  const bg = openSheet(`
    <h2>${id ? 'Editar loja' : 'Nova loja'}</h2>
    <label class="field"><span>Nome da loja</span>
      <input class="input" id="st-name" value="${esc(store.name)}" placeholder="Ex.: Perfumaria Centro"></label>
    <label class="field"><span>Endereço (opcional)</span>
      <input class="input" id="st-addr" value="${esc(store.address || '')}" placeholder="Rua, bairro, cidade"></label>

    <div class="section-title">Localização no mapa</div>
    <div class="row">
      <button class="btn secondary" type="button" id="st-find">🔎 Buscar pelo endereço</button>
      <button class="btn secondary" type="button" id="st-geo">📍 Minha localização</button>
    </div>
    <div id="pick-map" class="pick-map"></div>
    <div class="muted-note" id="st-coords">${picked
      ? '📍 ' + picked.lat.toFixed(5) + ', ' + picked.lng.toFixed(5)
      : 'Busque pelo endereço, use o GPS, ou toque no mapa pra marcar o ponto.'}</div>

    <button class="btn" id="st-save" style="margin-top:14px">Salvar</button>
    ${id ? '<button class="btn danger" id="st-del" style="margin-top:10px">Excluir loja</button>' : ''}
  `);

  // mapa de seleção (carrega o Leaflet sob demanda)
  (async () => {
    let L;
    try {
      L = await loadLeaflet();
    } catch (e) {
      const el = $('#pick-map', bg);
      if (el) el.innerHTML = '<div class="map-fail">Mapa indisponível (sem internet). Você ainda pode salvar a loja sem localização.</div>';
      return;
    }
    setDefaultIcon(L);
    const el = $('#pick-map', bg);
    if (!el) return;
    const center = picked ? [picked.lat, picked.lng] : [-14.235, -51.925];
    const map = newMap(L, el, center, picked ? 15 : 4);
    setTimeout(() => map.invalidateSize(), 250);

    let marker = null;
    const updateCoords = () => {
      const c = $('#st-coords', bg);
      if (c && picked) c.textContent = '📍 ' + picked.lat.toFixed(5) + ', ' + picked.lng.toFixed(5);
    };
    const setPin = (lat, lng, zoom) => {
      picked = { lat, lng };
      if (marker) {
        marker.setLatLng([lat, lng]);
      } else {
        marker = L.marker([lat, lng], { draggable: true }).addTo(map);
        marker.on('dragend', () => { const p = marker.getLatLng(); picked = { lat: p.lat, lng: p.lng }; updateCoords(); });
      }
      if (zoom) map.setView([lat, lng], zoom);
      updateCoords();
    };
    if (picked) setPin(picked.lat, picked.lng);
    map.on('click', (e) => setPin(e.latlng.lat, e.latlng.lng));

    $('#st-geo', bg).addEventListener('click', () => {
      if (!navigator.geolocation) return toast('GPS indisponível');
      toast('Buscando sua localização…');
      navigator.geolocation.getCurrentPosition(
        (pos) => setPin(pos.coords.latitude, pos.coords.longitude, 16),
        () => toast('Não consegui pegar o GPS'),
        { enableHighAccuracy: true, timeout: 10000 });
    });
    $('#st-find', bg).addEventListener('click', async () => {
      const q = $('#st-addr', bg).value.trim();
      if (!q) return toast('Digite o endereço primeiro');
      toast('Procurando endereço…');
      const r = await geocodeAddress(q);
      if (!r) return toast('Endereço não encontrado');
      setPin(r.lat, r.lng, 16);
    });
  })();

  $('#st-save', bg).addEventListener('click', async () => {
    const name = $('#st-name', bg).value.trim();
    if (!name) return toast('Dê um nome pra loja');
    await DB.saveStore({
      ...store, name,
      address: $('#st-addr', bg).value.trim(),
      lat: picked ? picked.lat : null,
      lng: picked ? picked.lng : null,
    });
    closeSheet(bg);
    toast('Loja salva');
    render();
  });
  if (id) $('#st-del', bg).addEventListener('click', async () => {
    await DB.deleteStore(id);
    closeSheet(bg);
    toast('Loja excluída');
    render();
  });
}

// ---------- formulário de produto ----------
async function openProductForm(existing) {
  const product = existing || { name: '', brand: '', category: 'Perfumes', volume: '', notes: '', image: null };
  const stores = await DB.listStores();
  const storeOptions = stores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const catOptions = CATEGORIES.map((c) => `<option value="${c}" ${product.category === c ? 'selected' : ''}>${c}</option>`).join('');

  const bg = openSheet(`
    <h2>${existing ? 'Editar produto' : 'Novo produto'}</h2>
    <div class="photo-pick" id="photo">
      ${product.image ? `<img src="${product.image}" alt="">` : '<div class="ic">📷</div><div>Tirar / escolher foto</div>'}
    </div>
    <input type="file" id="photo-input" accept="image/*" capture="environment" hidden>

    <label class="field"><span>Nome do produto *</span>
      <input class="input" id="p-name" value="${esc(product.name)}" placeholder="Ex.: Sauvage EDT"></label>
    <div class="row">
      <label class="field"><span>Marca</span>
        <input class="input" id="p-brand" value="${esc(product.brand || '')}" placeholder="Ex.: Dior"></label>
      <label class="field"><span>Tamanho</span>
        <input class="input" id="p-volume" value="${esc(product.volume || '')}" placeholder="100 ml"></label>
    </div>
    <label class="field"><span>Categoria</span>
      <select class="input" id="p-cat">${catOptions}</select></label>

    ${existing ? '' : `
    <div class="section-title">Preço (opcional)</div>
    <label class="field"><span>Loja</span>
      <select class="input" id="p-store">
        <option value="">— selecione —</option>${storeOptions}
        <option value="__new">+ Nova loja…</option>
      </select></label>
    <div class="row">
      <label class="field"><span>Moeda</span>
        <select class="input" id="p-currency">${currencyOptions('BRL')}</select></label>
      <label class="field"><span>Preço nesta loja</span>
        <input class="input" id="p-price" inputmode="decimal" placeholder="0,00"></label>
    </div>
    `}

    <label class="field"><span>Anotações</span>
      <textarea class="input" id="p-notes" placeholder="Cheirou bem, promoção, etc.">${esc(product.notes || '')}</textarea></label>

    <button class="btn" id="p-save">Salvar</button>
  `);

  // foto
  let imageData = product.image || null;
  $('#photo', bg).addEventListener('click', () => $('#photo-input', bg).click());
  $('#photo-input', bg).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    imageData = await compressImage(file);
    $('#photo', bg).innerHTML = `<img src="${imageData}" alt="">`;
  });

  // loja nova inline
  const storeSel = $('#p-store', bg);
  if (storeSel) storeSel.addEventListener('change', async () => {
    if (storeSel.value === '__new') {
      const name = prompt('Nome da nova loja:');
      storeSel.value = '';
      if (name && name.trim()) {
        const s = await DB.saveStore({ name: name.trim() });
        const opt = document.createElement('option');
        opt.value = s.id; opt.textContent = s.name;
        storeSel.insertBefore(opt, storeSel.lastElementChild);
        storeSel.value = s.id;
      }
    }
  });

  $('#p-save', bg).addEventListener('click', async () => {
    const name = $('#p-name', bg).value.trim();
    if (!name) return toast('O nome é obrigatório');
    const saved = await DB.saveProduct({
      ...product,
      name,
      brand: $('#p-brand', bg).value.trim(),
      volume: $('#p-volume', bg).value.trim(),
      category: $('#p-cat', bg).value,
      notes: $('#p-notes', bg).value.trim(),
      image: imageData,
    });
    // preço inicial (só no cadastro novo)
    if (!existing) {
      const priceVal = parsePrice($('#p-price', bg).value);
      const storeId = $('#p-store', bg).value;
      const currency = $('#p-currency', bg).value || 'BRL';
      if (priceVal != null) {
        await DB.savePrice({ productId: saved.id, storeId: storeId || null, value: priceVal, currency, date: Date.now() });
      }
    }
    closeSheet(bg);
    toast('Produto salvo ✨');
    render();
  });
}

function parsePrice(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

// ---------- detalhe do produto + tabela de preços ----------
async function openProductDetail(id) {
  const p = await DB.getProduct(id);
  if (!p) return;
  const summary = await priceSummary(id);
  const stores = await DB.listStores();
  const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));

  const sorted = [...summary.prices].sort((a, b) => a.value - b.value);
  const priceRows = sorted.length
    ? sorted.map((pr, i) => `
        <div class="price-row ${i === 0 && sorted.length > 1 ? 'best' : ''}">
          <div>
            <div class="store">${esc(pr.storeId ? (storeMap[pr.storeId] || 'Loja') : 'Sem loja')}</div>
            <div class="meta">${new Date(pr.date || pr.createdAt).toLocaleDateString('pt-BR')}</div>
          </div>
          <div style="text-align:right">
            <div class="val">${formatPrice(pr.value, pr.currency)}</div>
            ${i === 0 && sorted.length > 1 ? '<div class="best-tag">MAIS BARATO</div>' : ''}
            <button class="btn-ghost" data-delprice="${pr.id}">remover</button>
          </div>
        </div>`).join('')
    : '<p class="muted-note">Nenhum preço cadastrado. Adicione o preço em uma loja abaixo.</p>';

  const hero = p.image
    ? `<img class="detail-hero" src="${p.image}" alt="">`
    : `<div class="detail-hero placeholder">🧴</div>`;

  const bg = openSheet(`
    <div class="detail">
      ${hero}
      <h2>${esc(p.name)} ${p.favorite ? '❤️' : ''}</h2>
      <div class="brand">${esc(p.brand || '—')}</div>
      <div>
        <span class="tag">${esc(p.category || 'Outros')}</span>
        ${p.volume ? `<span class="tag">${esc(p.volume)}</span>` : ''}
      </div>
      ${p.notes ? `<p class="muted-note" style="margin-top:12px">📝 ${esc(p.notes)}</p>` : ''}

      <div class="section-title">Comparativo de preços</div>
      <div class="price-table">${priceRows}</div>
      <button class="btn secondary" id="add-price" style="margin-top:6px">+ Adicionar preço em loja</button>

      <button class="btn secondary" id="addlist-btn" style="margin-top:14px">🧾 Adicionar a uma lista</button>
      <div class="row" style="margin-top:10px">
        <button class="btn secondary" id="fav-btn">${p.favorite ? '❤️ Favorito' : '🤍 Favoritar'}</button>
        <button class="btn secondary" id="edit-btn">✏️ Editar</button>
      </div>
      <button class="btn danger" id="del-btn" style="margin-top:10px">Excluir produto</button>
    </div>
  `);

  $('#fav-btn', bg).addEventListener('click', async () => { await toggleFav(id); closeSheet(bg); openProductDetail(id); });
  $('#edit-btn', bg).addEventListener('click', async () => { closeSheet(bg); openProductForm(await DB.getProduct(id)); });
  $('#del-btn', bg).addEventListener('click', async () => {
    if (!confirm('Excluir este produto e seus preços?')) return;
    await DB.deleteProduct(id);
    closeSheet(bg);
    toast('Produto excluído');
    render();
  });
  $('#add-price', bg).addEventListener('click', () => openPriceForm(id, bg));
  $('#addlist-btn', bg).addEventListener('click', () => openAddToList(id));
  bg.querySelectorAll('[data-delprice]').forEach((b) =>
    b.addEventListener('click', async () => {
      await DB.deletePrice(b.dataset.delprice);
      closeSheet(bg);
      openProductDetail(id);
    }));
}

async function openPriceForm(productId, parentBg) {
  const stores = await DB.listStores();
  const storeOptions = stores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const bg = openSheet(`
    <h2>Preço em loja</h2>
    <label class="field"><span>Loja</span>
      <select class="input" id="pf-store">
        <option value="">— sem loja —</option>${storeOptions}
        <option value="__new">+ Nova loja…</option>
      </select></label>
    <div class="row">
      <label class="field"><span>Moeda</span>
        <select class="input" id="pf-currency">${currencyOptions('BRL')}</select></label>
      <label class="field"><span>Preço</span>
        <input class="input" id="pf-price" inputmode="decimal" placeholder="0,00"></label>
    </div>
    <button class="btn" id="pf-save">Salvar preço</button>
  `);
  const sel = $('#pf-store', bg);
  sel.addEventListener('change', async () => {
    if (sel.value === '__new') {
      const name = prompt('Nome da nova loja:');
      sel.value = '';
      if (name && name.trim()) {
        const s = await DB.saveStore({ name: name.trim() });
        const opt = document.createElement('option');
        opt.value = s.id; opt.textContent = s.name;
        sel.insertBefore(opt, sel.lastElementChild);
        sel.value = s.id;
      }
    }
  });
  $('#pf-save', bg).addEventListener('click', async () => {
    const value = parsePrice($('#pf-price', bg).value);
    if (value == null) return toast('Informe um preço válido');
    const currency = $('#pf-currency', bg).value || 'BRL';
    await DB.savePrice({ productId, storeId: sel.value || null, value, currency, date: Date.now() });
    closeSheet(bg);
    closeSheet(parentBg);
    toast('Preço adicionado');
    openProductDetail(productId);
  });
}

// ---------- backup ----------
async function exportBackup() {
  const data = await DB.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `achadora-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup exportado');
}
function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await DB.importAll(data);
      toast('Backup importado ✨');
      render();
    } catch (e) {
      toast('Arquivo inválido');
    }
  };
  input.click();
}

// Carrega o catálogo pronto da Lattafa (hospedado junto do app)
async function loadSeed(file, label) {
  try {
    toast('Carregando ' + label + '…');
    const res = await fetch(file + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.products || !data.products.length) throw new Error('arquivo vazio');
    await DB.mergeCatalog(data);
    // volta pra aba Catálogo (sem filtros) pra garantir que os produtos apareçam
    state.tab = 'catalogo';
    clearFilters();
    state.search = '';
    document.querySelectorAll('.tabbar button').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === 'catalogo'));
    await render();
    toast(data.products.length + ' perfumes carregados ✨');
  } catch (e) {
    toast('Erro ao carregar: ' + (e.message || e));
  }
}

// ---------- navegação ----------
function setTab(tab) {
  if (tab === 'backup') {
    const bg = openSheet(`
      <h2>Backup dos dados</h2>
      <p class="muted-note">Seus dados ficam só neste aparelho. Exporte de vez em quando pra não perder, e importe ao trocar de celular.</p>
      <button class="btn" id="bk-exp" style="margin-top:14px">⬇️ Exportar backup</button>
      <button class="btn secondary" id="bk-imp" style="margin-top:10px">⬆️ Importar backup</button>
      <div class="section-title">Catálogos prontos</div>
      <p class="muted-note">Adiciona perfumes já cadastrados (com foto e dados). Pode rodar mais de uma vez sem duplicar.</p>
      <button class="btn secondary" id="bk-lattafa" style="margin-top:10px">🌹 Carregar catálogo Lattafa (143 perfumes)</button>
      <button class="btn secondary" id="bk-alwataniah" style="margin-top:10px">🌙 Carregar catálogo Al Wataniah (43 perfumes)</button>
    `);
    $('#bk-exp', bg).addEventListener('click', () => { exportBackup(); closeSheet(bg); });
    $('#bk-imp', bg).addEventListener('click', () => { importBackup(); closeSheet(bg); });
    $('#bk-lattafa', bg).addEventListener('click', () => {
      if (confirm('Adicionar 143 perfumes Lattafa ao seu catálogo?')) {
        loadSeed('seed-lattafa.json', 'Lattafa');
        closeSheet(bg);
      }
    });
    $('#bk-alwataniah', bg).addEventListener('click', () => {
      if (confirm('Adicionar 43 perfumes Al Wataniah ao seu catálogo?')) {
        loadSeed('seed-alwataniah.json', 'Al Wataniah');
        closeSheet(bg);
      }
    });
    return;
  }
  state.tab = tab;
  if (tab === 'favoritos') clearFilters();
  document.querySelectorAll('.tabbar button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === tab));
  render();
}

document.querySelectorAll('.tabbar button').forEach((b) =>
  b.addEventListener('click', () => setTab(b.dataset.tab)));

// registra o service worker (modo offline / instalável)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

render();
