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
    body = `<div class="grid">${products.map((p, i) => productCard(p, summaries[i])).join('')}</div>`;
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

function productCard(p, summary) {
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
      <button class="fav" data-id="${p.id}">${p.favorite ? '❤️' : '🤍'}</button>
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

// ---------- lojas ----------
async function renderStores() {
  const stores = await DB.listStores();
  const items = stores.length
    ? stores.map((s) => `
        <div class="list-item">
          <div>
            <div class="t">🏪 ${esc(s.name)}</div>
            ${s.address ? `<div class="s">${esc(s.address)}</div>` : ''}
          </div>
          <button class="icon-btn" data-edit="${s.id}">✏️</button>
        </div>`).join('')
    : `<div class="empty"><div class="big">🏪</div><p>Nenhuma loja salva.<br>Adicione uma pra reutilizar nos cadastros.</p></div>`;

  app.innerHTML = `
    <header class="app-header">
      <h1>✨ Achadora</h1>
      <div class="subtitle">Lojas</div>
    </header>
    <main>
      ${items}
      <button class="btn secondary" id="add-store" style="margin-top:8px">+ Nova loja</button>
    </main>
  `;
  $('#add-store').addEventListener('click', () => openStoreForm());
  app.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openStoreForm(b.dataset.edit)));
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
  const bg = openSheet(`
    <h2>${id ? 'Editar loja' : 'Nova loja'}</h2>
    <label class="field"><span>Nome da loja</span>
      <input class="input" id="st-name" value="${esc(store.name)}" placeholder="Ex.: Perfumaria Centro"></label>
    <label class="field"><span>Endereço (opcional)</span>
      <input class="input" id="st-addr" value="${esc(store.address || '')}" placeholder="Rua, bairro, cidade"></label>
    <button class="btn" id="st-save">Salvar</button>
    ${id ? '<button class="btn danger" id="st-del" style="margin-top:10px">Excluir loja</button>' : ''}
  `);
  $('#st-save', bg).addEventListener('click', async () => {
    const name = $('#st-name', bg).value.trim();
    if (!name) return toast('Dê um nome pra loja');
    await DB.saveStore({ ...store, name, address: $('#st-addr', bg).value.trim() });
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

      <div class="row" style="margin-top:18px">
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
    await DB.importAll(data);
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
