// Achadora — lógica da interface (vanilla JS, sem dependências)

// Categorias-semente. A lista real é aberta: cresce conforme você cadastra
// produtos com categorias novas (ex.: "Celular"). Usada só como sugestão/base.
const CATEGORIES = ['Perfumes'];
const GENDERS = ['Masculino', 'Feminino', 'Unissex'];

// Reúne as categorias conhecidas (sementes + as já usadas nos produtos), únicas
// e ordenadas em pt-BR. Serve pros chips do catálogo e pras sugestões do form.
function categoriesFrom(products) {
  const set = new Set(CATEGORIES);
  for (const p of products) if (p.category) set.add(p.category);
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
const PAGE_SIZE = 24;   // quantos produtos por página (botão "Ver mais" revela o resto)
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
  genders: [],         // gêneros selecionados no painel (vazio = todos)
  stores: [],          // ids de loja selecionados no painel (vazio = todas)
  priceMin: null,      // preço mínimo (null = sem limite)
  priceMax: null,      // preço máximo (null = sem limite)
  priceSort: null,     // null | 'asc' | 'desc'
  lojasView: 'lista',  // lista | mapa
  visible: PAGE_SIZE,  // quantos produtos estão renderizados agora (paginação incremental)
};

// Assinatura da última consulta renderizada e cache da lista completa já filtrada/ordenada.
// Servem à paginação: quando a consulta muda, zera a página; o "Ver mais" só anexa.
let _lastQuerySig = null;
let _catalogCache = null;

function activeFilterCount() {
  return state.brands.length + state.genders.length + state.stores.length +
    (state.priceMin != null || state.priceMax != null ? 1 : 0) +
    (state.priceSort != null ? 1 : 0);
}
function clearFilters() {
  state.brands = []; state.genders = []; state.stores = [];
  state.priceMin = null; state.priceMax = null;
  state.priceSort = null;
}

// Marcas distintas presentes no banco (pra preencher o filtro)
async function distinctBrands() {
  const products = await DB.listProducts();
  return [...new Set(products.map((p) => p.brand).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Normaliza pra comparar nomes de marca (sem acento/caixa). A unificação de
// verdade é feita no banco por id determinístico (DB.resolveBrand); aqui só
// usamos pra exibir a grafia canônica já existente enquanto o form está aberto.
const normBrand = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const app = document.getElementById('app');
const $ = (sel, root = document) => root.querySelector(sel);

// Atualiza `host` a partir de uma string HTML reaproveitando os <img> de mesmo
// `src` que já estão na tela, em vez de recriá-los. Recriar um <img> base64 força
// o navegador a decodificar a imagem de novo, e o quadro em branco até a
// decodificação terminar é o que causa a "piscada" quando uma camada reaparece
// (modal/página fechando expõe a de baixo, repintada pelo onResume) ou quando o
// catálogo é repintado após uma ação. Transplantar o nó vivo preserva o bitmap; o
// resto da árvore é trocado de uma vez (atômico, sem quadro em branco). Use no
// lugar de `host.innerHTML = ...` em telas que mostram imagens.
function setHtml(host, html) {
  const next = host.cloneNode(false); // mesmo contexto de parsing, fora da árvore
  next.innerHTML = html;

  const reusable = new Map(); // src -> fila de <img> vivos reaproveitáveis
  for (const img of host.querySelectorAll('img')) {
    if (!reusable.has(img.src)) reusable.set(img.src, []);
    reusable.get(img.src).push(img);
  }
  for (const fresh of next.querySelectorAll('img')) {
    const queue = reusable.get(fresh.src);
    if (!queue || !queue.length) continue;
    const live = queue.shift();
    // sincroniza atributos (classe, alt…) sem tocar no src → sem nova decodificação
    for (const { name, value } of fresh.attributes) {
      if (name !== 'src' && live.getAttribute(name) !== value) live.setAttribute(name, value);
    }
    fresh.replaceWith(live);
  }
  host.replaceChildren(...next.childNodes);
}

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

// ---------- IA: autopreenchimento pela foto (Google Gemini / AI Studio) ----------
// A chave fica só NESTE aparelho (localStorage) — nunca no Git, nunca no bundle.
// O cadastro é uma ferramenta do dono; o usuário final do catálogo jamais passa
// por aqui, então a chave não precisa de backend pra ficar protegida. Se um dia
// outras pessoas cadastrarem, troca-se só a URL por um proxy (Cloudflare Worker).
const AI_KEY_STORAGE = 'achadora.geminiKey';
// Linha "flash-lite" (a mais barata e multimodal) via alias "-latest": fica
// sempre no flash-lite atual, então não quebra quando o Google aposenta uma
// versão. Sobra pra tarefa (ler 4 campos de um rótulo é OCR leve).
const AI_MODEL = 'gemini-flash-lite-latest';

const getAiKey = () => (localStorage.getItem(AI_KEY_STORAGE) || '').trim();
function setAiKey(k) {
  if (k && k.trim()) localStorage.setItem(AI_KEY_STORAGE, k.trim());
  else localStorage.removeItem(AI_KEY_STORAGE);
}

// Pergunta/edita a chave do AI Studio (prompt simples, como a "nova loja").
// Retorna true se o usuário não cancelou.
function configureAiKey() {
  const current = getAiKey();
  const msg = current
    ? 'Chave do Google AI Studio (Gemini).\nDeixe em branco para remover:'
    : 'Cole sua chave do Google AI Studio (Gemini).\nPegue em aistudio.google.com → "Get API key".\nEla fica salva só neste aparelho.';
  const val = prompt(msg, current);
  if (val === null) return false; // cancelou
  setAiKey(val);
  toast(val.trim() ? 'Chave salva neste aparelho ✨' : 'Chave removida');
  return true;
}

// Comprime a foto e devolve só o base64 (sem o prefixo data-URL), num tamanho
// MAIOR que o de armazenamento: rótulo de perfume tem texto miúdo e a leitura
// melhora com mais resolução. A imagem guardada no produto continua leve.
async function imageBase64ForAi(file) {
  const dataUrl = await compressImage(file, 1280, 0.85);
  return dataUrl.split(',')[1];
}

// Manda a foto pro Gemini e devolve { name, brand, volume, gender } com o que
// estiver LEGÍVEL no rótulo. A IA é instruída a reconhecer (logo estilizado,
// nome em árabe), mas a NÃO inventar: campo sem certeza volta vazio. Lança erro
// (com código curto) se a chamada falhar — quem chama trata e cai no manual.
async function analyzeProductImage(file) {
  const key = getAiKey();
  if (!key) throw new Error('sem-chave');
  const data = await imageBase64ForAi(file);

  const prompt = [
    'Você cataloga produtos a partir da FOTO da embalagem/etiqueta.',
    'Extraia SOMENTE o que está visível e legível. Pode reconhecer logos e',
    'romanizar texto em árabe, mas NÃO pesquise nem invente: se um campo não dá',
    'pra ler com certeza, devolva "".',
    'Campos:',
    '- name: nome/modelo do produto como aparece. Se for perfume e a concentração',
    '  aparecer (EDT, EDP, Parfum, Eau Fraiche...), inclua no fim. Ex.: "Asad EDP",',
    '  "Galaxy A17".',
    '- brand: a marca/fabricante, sempre em letras latinas.',
    '- category: o tipo de produto, em uma palavra em português. Ex.: "Perfumes",',
    '  "Celular", "Tênis", "Relógio". Sem certeza, devolva "".',
    '- volume: SÓ se for perfume ou líquido, o tamanho como está no frasco. Ex.:',
    '  "100 ml". Para outros produtos, devolva "".',
    '- gender: SÓ para perfume ou roupa, traduza para exatamente "Masculino",',
    '  "Feminino" ou "Unissex". Sem indício no rótulo, devolva "".',
    '- price: se houver ETIQUETA DE PREÇO visível, só o número (use ponto',
    '  decimal, ex.: "45" ou "45.90"). Sem etiqueta de preço, devolva "".',
    '- currency: a moeda do preço, um destes códigos: BRL, USD, EUR, ARS, PYG,',
    '  UYU. Pistas: "R$"=BRL, "US$"/"USD"=USD, "€"=EUR, "₲"/"Gs"/"G$"=PYG.',
    '  Um "$" sozinho, sem outra pista, trate como USD (padrão de Ciudad del',
    '  Este). Sem preço/moeda visível, devolva "".',
  ].join('\n');

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data } },
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          brand: { type: 'string' },
          category: { type: 'string' },
          volume: { type: 'string' },
          gender: { type: 'string' },
          price: { type: 'string' },
          currency: { type: 'string' },
        },
        required: ['name', 'brand', 'category', 'volume', 'gender', 'price', 'currency'],
      },
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // O Gemini devolve { error: { message, status } }; mostramos o motivo real.
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch {}
    console.error('[IA] HTTP', res.status, detail);
    if (res.status === 400 && /api.?key|api_key_invalid/i.test(detail)) throw new Error('chave-invalida');
    if (res.status === 403) throw new Error('chave-invalida');
    if (res.status === 404) throw new Error('modelo: ' + (detail || res.status));
    if (res.status === 429) throw new Error('limite: cota da IA esgotada por agora');
    throw new Error(detail ? `IA ${res.status}: ${detail}` : 'falha-' + res.status);
  }
  const json = await res.json();
  // pega a primeira parte que tenha texto (o modelo pode emitir "thought" antes)
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text).find(Boolean);
  if (!text) throw new Error('sem-resposta');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('resposta-invalida'); }
  // casa o gênero sem depender da capitalização ("masculino" → "Masculino")
  const g = (parsed.gender || '').trim().toLowerCase();
  // moeda só vale se for um dos códigos que o app conhece
  const cur = (parsed.currency || '').trim().toUpperCase();
  const currency = CURRENCIES.some((c) => c.code === cur) ? cur : '';
  return {
    name: (parsed.name || '').trim(),
    brand: (parsed.brand || '').trim(),
    category: (parsed.category || '').trim(),
    volume: (parsed.volume || '').trim(),
    gender: GENDERS.find((x) => x.toLowerCase() === g) || '',
    price: (parsed.price || '').trim(),
    currency,
  };
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

  // Paginação incremental: se a consulta (aba/busca/filtros) mudou, volta à 1ª página.
  // O "Ver mais" só altera state.visible, não a assinatura — então não reseta.
  const querySig = JSON.stringify([
    state.tab, state.search.trim(), state.category,
    state.brands, state.genders, state.stores,
    state.priceMin, state.priceMax, state.priceSort,
  ]);
  if (querySig !== _lastQuerySig) { state.visible = PAGE_SIZE; _lastQuerySig = querySig; }

  let products = await DB.listProducts();
  const allCategories = categoriesFrom(products); // antes de filtrar: catálogo inteiro

  if (onlyFav) products = products.filter((p) => p.favorite);
  if (state.category !== 'Todos') products = products.filter((p) => p.category === state.category);
  if (state.brands.length) products = products.filter((p) => state.brands.includes(p.brand || ''));
  if (state.genders.length) products = products.filter((p) => state.genders.includes(p.gender));
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

  // filtro por faixa de preço: usa o menor preço cadastrado do produto
  if (state.priceMin != null || state.priceMax != null) {
    const kept = products
      .map((p, i) => [p, summaries[i]])
      .filter(([, s]) => {
        if (!s.best) return false; // sem preço não entra na faixa
        const v = s.best.value;
        if (state.priceMin != null && v < state.priceMin) return false;
        if (state.priceMax != null && v > state.priceMax) return false;
        return true;
      });
    products = kept.map((x) => x[0]);
    summaries = kept.map((x) => x[1]);
  }

  // ordenação por preço
  if (state.priceSort) {
    const paired = products.map((p, i) => [p, summaries[i]]);
    paired.sort(([, a], [, b]) => {
      const av = a.best?.value ?? Infinity;
      const bv = b.best?.value ?? Infinity;
      return state.priceSort === 'asc' ? av - bv : bv - av;
    });
    products = paired.map((x) => x[0]);
    summaries = paired.map((x) => x[1]);
  }

  const stores = await DB.listStores();
  const storeName = Object.fromEntries(stores.map((s) => [s.id, s.name]));
  const count = activeFilterCount();

  // produtos que já estão em alguma lista (pra mostrar o selo na miniatura)
  const lists = await DB.listLists();
  const inAnyList = new Set();
  lists.forEach((l) => (l.items || []).forEach((it) => inAnyList.add(it.productId)));

  // chips de categoria (rolagem horizontal rápida)
  const catChips = ['Todos', ...allCategories]
    .map((c) => `<button class="chip ${state.category === c ? 'active' : ''}" data-cat="${c}">${c}</button>`)
    .join('');

  // chips dos filtros ativos do painel (removíveis)
  const priceChipLabel = (state.priceMin != null || state.priceMax != null)
    ? (state.priceMin != null && state.priceMax != null
        ? `${formatPrice(state.priceMin)} – ${formatPrice(state.priceMax)}`
        : (state.priceMin != null
            ? `≥ ${formatPrice(state.priceMin)}`
            : `≤ ${formatPrice(state.priceMax)}`))
    : null;
  const activeChips = [
    ...state.brands.map((b) => `<button class="achip" data-rm="brand" data-val="${esc(b)}">${esc(b)} ✕</button>`),
    ...state.genders.map((g) => `<button class="achip" data-rm="gender" data-val="${esc(g)}">${esc(g)} ✕</button>`),
    ...state.stores.map((id) => `<button class="achip" data-rm="store" data-val="${esc(id)}">🏪 ${esc(storeName[id] || 'Loja')} ✕</button>`),
    ...(priceChipLabel ? [`<button class="achip" data-rm="price">💰 ${esc(priceChipLabel)} ✕</button>`] : []),
    ...(state.priceSort ? [`<button class="achip" data-rm="sort">${state.priceSort === 'asc' ? '↑ Menor preço' : '↓ Maior preço'} ✕</button>`] : []),
  ].join('');

  // guarda a lista completa filtrada/ordenada pra o "Ver mais" anexar sem recomputar
  _catalogCache = { products, summaries, inAnyList };

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
    const shown = Math.min(state.visible, products.length);
    const cards = products.slice(0, shown)
      .map((p, i) => productCard(p, summaries[i], inAnyList.has(p.id))).join('');
    body = `<div class="grid">${cards}</div>${catalogFooter(shown, products.length)}`;
  }

  setHtml(app, `
    <header class="app-header">
      <h1>✨ Achadora</h1>
      <div class="subtitle">${onlyFav ? 'Seus favoritos' : 'Seu catálogo de garimpo'}</div>
    </header>
    <div class="search-row">
      <div class="search">
        🔍 <input id="search" placeholder="Buscar por nome ou marca" value="${esc(state.search)}" />
      </div>
      <button class="filter-btn ${count ? 'on' : ''}" id="filter-btn" aria-label="Filtros">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>${count ? `<span class="badge">${count}</span>` : ''}
      </button>
    </div>
    ${onlyFav || allCategories.length <= 1 ? '' : `<div class="chips">${catChips}</div>`}
    ${count ? `<div class="active-filters">${activeChips}<button class="achip clear" data-rm="all">Limpar</button></div>` : ''}
    <main>${body}</main>
  `);

  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value;
    // re-render leve da lista sem perder o foco do input
    debouncedRerenderList();
  });
  $('#filter-btn').addEventListener('click', () => openFilterSheet());
  app.querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => { state.category = c.dataset.cat; render(); }));
  app.querySelectorAll('.active-filters .achip').forEach((b) =>
    b.addEventListener('click', () => {
      const { rm, val } = b.dataset;
      if (rm === 'all') clearFilters();
      else if (rm === 'brand') state.brands = state.brands.filter((x) => x !== val);
      else if (rm === 'gender') state.genders = state.genders.filter((x) => x !== val);
      else if (rm === 'store') state.stores = state.stores.filter((x) => x !== val);
      else if (rm === 'price') { state.priceMin = null; state.priceMax = null; }
      else if (rm === 'sort') { state.priceSort = null; }
      render();
    }));
  bindCards(app);
  const verMais = $('#ver-mais');
  if (verMais) verMais.addEventListener('click', appendMore);
}

// Liga os eventos dos cards de produto dentro de `root` (a grade inteira no render
// normal, ou só os cards recém-anexados pelo "Ver mais").
function bindCards(root) {
  root.querySelectorAll('.card .fav').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(b.dataset.id); }));
  root.querySelectorAll('.card .inlist').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); openAddToList(b.dataset.id); }));
  root.querySelectorAll('.card[data-id]').forEach((c) =>
    c.addEventListener('click', () => openProductDetail(c.dataset.id)));
}

// Rodapé do catálogo: "X de Y" + botão "Ver mais" enquanto houver itens ocultos.
function catalogFooter(shown, total) {
  if (!total) return '';
  const remaining = total - shown;
  const counter = `<span class="count">${shown} de ${total} ${total === 1 ? 'produto' : 'produtos'}</span>`;
  const button = remaining > 0
    ? `<button class="btn secondary" id="ver-mais">Ver mais ${Math.min(PAGE_SIZE, remaining)} de ${remaining}</button>`
    : '';
  return `<div class="load-more" id="catalog-foot">${counter}${button}</div>`;
}

// "Ver mais": anexa a próxima página à grade existente (sem re-render, preservando o
// scroll) e atualiza o rodapé. Usa o cache da última lista filtrada/ordenada.
function appendMore() {
  if (!_catalogCache) return;
  const { products, summaries, inAnyList } = _catalogCache;
  const grid = app.querySelector('.grid');
  const foot = app.querySelector('#catalog-foot');
  if (!grid) return;
  const from = state.visible;
  state.visible = Math.min(state.visible + PAGE_SIZE, products.length);

  const tmp = document.createElement('div');
  tmp.innerHTML = products.slice(from, state.visible)
    .map((p, i) => productCard(p, summaries[from + i], inAnyList.has(p.id))).join('');
  bindCards(tmp);
  while (tmp.firstChild) grid.appendChild(tmp.firstChild);

  if (foot) {
    foot.outerHTML = catalogFooter(state.visible, products.length);
    const verMais = app.querySelector('#ver-mais');
    if (verMais) verMais.addEventListener('click', appendMore);
  }
}

// Painel de filtros (Marca, Loja, Categoria) — abre de baixo pra cima
async function openFilterSheet() {
  const brands = await distinctBrands();
  const stores = await DB.listStores();
  const sel = { brands: new Set(state.brands), genders: new Set(state.genders), stores: new Set(state.stores) };

  const fchip = (val, label, group) =>
    `<button class="fchip ${sel[group].has(val) ? 'active' : ''}" data-group="${group}" data-val="${esc(val)}">${esc(label)}</button>`;

  const genderSec = `<div class="section-title">Gênero</div><div class="fchips">${GENDERS.map((g) => fchip(g, g, 'genders')).join('')}</div>`;
  const brandSec = brands.length
    ? `<div class="section-title">Marca</div><div class="fchips">${brands.map((b) => fchip(b, b, 'brands')).join('')}</div>` : '';
  const storeSec = stores.length
    ? `<div class="section-title">Loja</div><div class="fchips">${stores.map((s) => fchip(s.id, s.name, 'stores')).join('')}</div>` : '';

  const priceSec = `<div class="section-title">Faixa de preço</div>
    <div class="price-range">
      <input type="number" inputmode="decimal" min="0" step="0.01" id="f-price-min" placeholder="Mín. (R$)" value="${state.priceMin != null ? state.priceMin : ''}" />
      <span class="price-range-sep">—</span>
      <input type="number" inputmode="decimal" min="0" step="0.01" id="f-price-max" placeholder="Máx. (R$)" value="${state.priceMax != null ? state.priceMax : ''}" />
    </div>
    <div class="section-title" style="margin-top:14px">Ordenar por preço</div>
    <div class="fchips">
      <button class="fchip sort-btn ${state.priceSort === 'asc' ? 'active' : ''}" data-sort="asc">↑ Menor primeiro</button>
      <button class="fchip sort-btn ${state.priceSort === 'desc' ? 'active' : ''}" data-sort="desc">↓ Maior primeiro</button>
    </div>`;

  const bg = openSheet(`
    <h2>Filtros</h2>
    ${genderSec}
    ${brandSec}
    ${storeSec}
    ${priceSec}
    <div class="row" style="margin-top:20px">
      <button class="btn secondary" id="f-clear">Limpar</button>
      <button class="btn" id="f-apply">Aplicar</button>
    </div>
  `);

  let selSort = state.priceSort;

  bg.querySelectorAll('.fchip:not(.sort-btn)').forEach((b) =>
    b.addEventListener('click', () => {
      const { group, val } = b.dataset;
      if (sel[group].has(val)) sel[group].delete(val); else sel[group].add(val);
      b.classList.toggle('active');
    }));
  bg.querySelectorAll('.sort-btn').forEach((b) =>
    b.addEventListener('click', () => {
      const chosen = b.dataset.sort;
      selSort = selSort === chosen ? null : chosen;
      bg.querySelectorAll('.sort-btn').forEach((x) => x.classList.toggle('active', x.dataset.sort === selSort));
    }));
  $('#f-clear', bg).addEventListener('click', () => { clearFilters(); popLayer(); render(); });
  $('#f-apply', bg).addEventListener('click', () => {
    state.brands = [...sel.brands];
    state.genders = [...sel.genders];
    state.stores = [...sel.stores];
    const min = parseFloat($('#f-price-min', bg).value);
    const max = parseFloat($('#f-price-max', bg).value);
    state.priceMin = isNaN(min) ? null : min;
    state.priceMax = isNaN(max) ? null : max;
    // se inverteram os limites, troca pra não zerar o resultado
    if (state.priceMin != null && state.priceMax != null && state.priceMin > state.priceMax) {
      [state.priceMin, state.priceMax] = [state.priceMax, state.priceMin];
    }
    state.priceSort = selSort;
    popLayer();
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
    ? `<img class="thumb" src="${p.image}" alt="" loading="lazy" decoding="async">`
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
  await DB.toggleFavorite(id);
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
            <div class="s ${s.lat != null ? 'loc' : 'noloc'}">${s.lat != null ? '📍 ' + s.lat.toFixed(5) + ', ' + s.lng.toFixed(5) : 'sem localização'}</div>
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
    toast('Lista salva');
    render(); // mantém a página Listas (atrás) em dia
    if (existing) {
      popLayer(); // volta pro detalhe da lista, que se atualiza no onResume
    } else {
      // troca o formulário (modal) pela página de detalhe da nova lista
      replaceTop('page', (el) => paintListDetail(el, saved.id), { onResume: (el) => paintListDetail(el, saved.id) });
    }
  });
}

async function openListDetail(id) {
  pushPage((el) => paintListDetail(el, id), { onResume: (el) => paintListDetail(el, id) });
}

// (Re)desenha a página de detalhe da lista dentro de `bg`. Usada na abertura e no
// onResume — ao voltar de um produto ou do seletor, a lista reflete o estado novo.
async function paintListDetail(bg, id) {
  const list = await DB.getList(id);
  if (!list) { popLayer(); return; }
  if (bg._closing) return;
  const titleEl = $('.page-title', bg);
  if (titleEl) titleEl.textContent = '🧾 ' + list.name;
  const stores = await DB.listStores();
  const storeName = Object.fromEntries(stores.map((s) => [s.id, s.name]));
  const { rows } = await computeList(list);
  if (bg._closing) return;

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

  setHtml($('.page-body', bg), `
    <div class="detail">
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

  // modelo mutável pra atualizar quantidades/total sem repintar a folha inteira
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
  bg.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); changeQty(b.dataset.inc, +1); }));
  bg.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); changeQty(b.dataset.dec, -1); }));
  bg.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const pid = b.dataset.rm;
    const i = model.findIndex((x) => x.productId === pid);
    if (i >= 0) model.splice(i, 1);
    const rowEl = $(`.li-row[data-row="${pid}"]`, bg);
    if (rowEl) rowEl.remove();
    updateTotal();
    await persist((l) => { l.items = (l.items || []).filter((x) => x.productId !== pid); });
    if (!model.length) paintListDetail(bg, id); // repinta no estado "lista vazia"
  }));
  bg.querySelectorAll('.li-row[data-row]').forEach((row) =>
    row.addEventListener('click', () => openProductDetail(row.dataset.row)));
  $('#l-add', bg).addEventListener('click', () => openProductPicker(id));
  $('#l-edit', bg).addEventListener('click', async () => openListForm(await DB.getList(id)));
  $('#l-pdf', bg).addEventListener('click', () => exportListPDF(id));
  $('#l-del', bg).addEventListener('click', async () => {
    if (!confirm('Excluir esta lista?')) return;
    await DB.deleteList(id);
    popLayer();
    toast('Lista excluída');
    render();
  });
}

// Seletor de produtos pra adicionar numa lista (toca pra incluir/remover)
async function openProductPicker(listId) {
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
    setHtml(host, filtered.map((p) => `
      <div class="pick-row ${inList.has(p.id) ? 'on' : ''}" data-pick="${p.id}">
        ${p.image ? `<img class="li-thumb" src="${p.image}" alt="">` : '<div class="li-thumb placeholder">🧴</div>'}
        <div class="li-info"><div class="li-name">${esc(p.name)}</div><div class="li-price muted">${esc(p.brand || '')}</div></div>
        <div class="pick-check">${inList.has(p.id) ? '✓' : '+'}</div>
      </div>`).join('') || '<p class="muted-note">Nada encontrado.</p>');
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
  // Concluir volta pro detalhe da lista (embaixo na pilha), que se atualiza no onResume
  $('#pick-done', bg).addEventListener('click', () => popLayer());
  renderPick();
}

// Seletor de marca — a fonte única é a store `brands` (entidade própria, como a
// loja). Lista as marcas do banco, filtra pela busca e oferece criar uma nova
// explicitamente quando o texto não casa com nenhuma. Devolve a marca escolhida
// (objeto { id, name }) ou null (= sem marca) pelo callback `onPick`. Espelha o
// seletor de produtos + o "+ Nova loja" do formulário.
async function openBrandPicker(currentId, onPick) {
  const brands = await DB.listBrands();
  let q = '';

  const bg = openSheet(`
    <h2>Marca</h2>
    <div class="search" style="margin:0 0 10px">
      <input id="brand-search" placeholder="🔍 Buscar ou criar marca" autocomplete="off">
    </div>
    <div class="pick-list" id="brand-pick"></div>
  `);

  const choose = async (brand) => { await onPick(brand); popLayer(); };

  const renderList = () => {
    const ql = normBrand(q);
    const filtered = ql ? brands.filter((b) => normBrand(b.name).includes(ql)) : brands;
    const hasExact = !!ql && brands.some((b) => normBrand(b.name) === ql);
    const host = $('#brand-pick', bg);

    // "Sem marca" só quando há uma marca escolhida pra limpar; "Criar" quando o
    // texto digitado não corresponde exatamente a nenhuma marca existente.
    const clearRow = currentId
      ? `<div class="pick-row" data-clear="1">
           <div class="li-info"><div class="li-name muted">✕ Sem marca</div></div></div>` : '';
    const createRow = (q.trim() && !hasExact)
      ? `<div class="pick-row create" data-create="1">
           <div class="li-info"><div class="li-name">+ Criar marca “${esc(q.trim())}”</div></div>
           <div class="pick-check">+</div></div>` : '';
    const rows = filtered.map((b) => `
      <div class="pick-row ${b.id === currentId ? 'on' : ''}" data-brand="${esc(b.id)}">
        <div class="li-info"><div class="li-name">${esc(b.name)}</div></div>
        <div class="pick-check">${b.id === currentId ? '✓' : ''}</div>
      </div>`).join('');

    host.innerHTML = clearRow + createRow + rows
      || '<p class="muted-note">Nenhuma marca cadastrada ainda. Digite acima para criar a primeira.</p>';

    const createEl = $('[data-create]', host);
    if (createEl) createEl.addEventListener('click', async () => {
      const id = await DB.resolveBrand(q.trim());
      choose((await DB.getBrand(id)) || { id, name: q.trim() });
    });
    const clearEl = $('[data-clear]', host);
    if (clearEl) clearEl.addEventListener('click', () => choose(null));
    host.querySelectorAll('[data-brand]').forEach((row) =>
      row.addEventListener('click', () => choose(brands.find((b) => b.id === row.dataset.brand))));
  };

  const input = $('#brand-search', bg);
  input.addEventListener('input', (e) => { q = e.target.value; renderList(); });
  // Enter cria a marca digitada quando não há correspondência exata
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!q.trim() || brands.some((b) => normBrand(b.name) === normBrand(q))) return;
    const cr = $('[data-create]', bg);
    if (cr) cr.click();
  });
  renderList();
}

// Seletor de categoria — mesma UX do seletor de marca, mas opera em strings simples.
function openCategoryPicker(currentCat, catList, onPick) {
  let q = '';
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  const bg = openSheet(`
    <h2>Categoria</h2>
    <div class="search" style="margin:0 0 10px">
      <input id="cat-search" placeholder="🔍 Buscar ou criar categoria" autocomplete="off">
    </div>
    <div class="pick-list" id="cat-pick"></div>
  `);

  const choose = (cat) => { onPick(cat); popLayer(); };

  const renderList = () => {
    const ql = norm(q);
    const filtered = ql ? catList.filter((c) => norm(c).includes(ql)) : catList;
    const hasExact = !!ql && catList.some((c) => norm(c) === ql);
    const host = $('#cat-pick', bg);

    const clearRow = currentCat
      ? `<div class="pick-row" data-clear="1">
           <div class="li-info"><div class="li-name muted">✕ Sem categoria</div></div></div>` : '';
    const createRow = (q.trim() && !hasExact)
      ? `<div class="pick-row create" data-create="1">
           <div class="li-info"><div class="li-name">+ Criar categoria "${esc(q.trim())}"</div></div>
           <div class="pick-check">+</div></div>` : '';
    const rows = filtered.map((c) => `
      <div class="pick-row ${c === currentCat ? 'on' : ''}" data-cat="${esc(c)}">
        <div class="li-info"><div class="li-name">${esc(c)}</div></div>
        <div class="pick-check">${c === currentCat ? '✓' : ''}</div>
      </div>`).join('');

    host.innerHTML = clearRow + createRow + rows
      || '<p class="muted-note">Nenhuma categoria ainda. Digite acima para criar.</p>';

    const createEl = $('[data-create]', host);
    if (createEl) createEl.addEventListener('click', () => choose(q.trim()));
    const clearEl = $('[data-clear]', host);
    if (clearEl) clearEl.addEventListener('click', () => choose(''));
    host.querySelectorAll('[data-cat]').forEach((row) =>
      row.addEventListener('click', () => choose(row.dataset.cat)));
  };

  const input = $('#cat-search', bg);
  input.addEventListener('input', (e) => { q = e.target.value; renderList(); });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const norm2 = norm(q);
    if (!q.trim() || catList.some((c) => norm(c) === norm2)) return;
    const cr = $('[data-create]', bg);
    if (cr) cr.click();
  });
  renderList();
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
    popLayer();
    render(); // atualiza o selo 🧾 na miniatura
  }));
  $('#atl-new', bg).addEventListener('click', async () => {
    const name = prompt('Nome da nova lista:');
    if (name && name.trim()) {
      await DB.saveList({ name: name.trim(), storeId: null, items: [{ productId, qty: 1 }] });
      toast('Lista criada com o produto ✨');
    }
    popLayer();
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

// ---------- pilha de navegação (páginas + modais) ----------
// Toda camada sobreposta é uma PÁGINA (desliza da direita, ‹ voltar, swipe da
// borda esquerda, opaca — pra navegar na hierarquia: detalhe de produto/lista) ou
// um MODAL/bottom sheet (sobe de baixo, fundo escurecido, arrasta pra baixo, ✕ —
// pra tarefas: formulário, filtro, seletor, "adicionar a"). É uma pilha única
// atrelada ao histórico: o Voltar (inclusive do Android) desempilha o topo, seja
// página ou modal. TODO fechamento passa por `popLayer` → histórico →
// `_removeTopLayer`, mantendo DOM e histórico em sync. O flag `_closing` evita que
// um duplo-toque dispare dois history.back e pule dois níveis de uma vez.
const navStack = [];
const NAV_BASE_Z = 41; // acima da tabbar (25) e do FAB (30)
function topLayer() { return navStack[navStack.length - 1] || null; }

function sheetHeadHtml(nested) {
  const back = nested ? '<button class="sheet-back" aria-label="Voltar">‹ Voltar</button>' : '';
  const close = nested ? '' : '<button class="sheet-close" aria-label="Fechar">✕</button>';
  return `<div class="sheet-head">
      <div class="sh-side sh-left">${back}</div>
      <div class="grabber"></div>
      <div class="sh-side sh-right">${close}</div>
    </div>`;
}

// Monta e empilha uma camada. `kind`: 'page' | 'sheet'. `build(el)` preenche o
// corpo e liga os eventos. `pushHistory` é falso só na troca em lugar (replaceTop).
// `opts.onResume(el)` roda quando a camada volta a ser o topo (uma filha fechou).
function _mountLayer(kind, build, opts = {}, { pushHistory = true } = {}) {
  const el = document.createElement('div');
  const below = topLayer();
  if (kind === 'page') {
    el.className = 'page-layer';
    el.innerHTML = `<div class="page">
        <header class="page-head">
          <button class="page-back" aria-label="Voltar">‹</button>
          <div class="page-title">${esc(opts.title || '')}</div>
        </header>
        <div class="page-body"></div>
      </div>`;
  } else {
    el.className = 'sheet-bg';
    el.innerHTML = `<div class="sheet">${sheetHeadHtml(navStack.length > 0)}<div class="sheet-body"></div></div>`;
    // sob um modal, outro modal não escurece de novo (evita backdrops somados)
    if (below && below._kind === 'sheet') below.classList.add('under');
  }
  el._kind = kind;
  el._opts = opts;
  el.style.zIndex = NAV_BASE_Z + navStack.length;
  navStack.push(el);
  if (pushHistory) history.pushState({ navDepth: navStack.length }, '');

  // gestos de fechar → voltar um nível pelo histórico
  if (kind === 'sheet') {
    el.addEventListener('click', (e) => { if (e.target === el) popLayer(); });
    const closeBtn = $('.sheet-close', el);
    if (closeBtn) closeBtn.addEventListener('click', () => popLayer());
    const backBtn = $('.sheet-back', el);
    if (backBtn) backBtn.addEventListener('click', () => popLayer());
    enableDragToClose(el, $('.sheet', el));
  } else {
    $('.page-back', el).addEventListener('click', () => popLayer());
    enableSwipeBack(el);
  }
  const onKey = (e) => { if (e.key === 'Escape' && topLayer() === el) popLayer(); };
  document.addEventListener('keydown', onKey);
  el._onKey = onKey;

  build(el); // preenche conteúdo + handlers (já com o DOM montado)

  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  return el;
}

// Abre um modal (bottom sheet). Mantém a assinatura antiga: html + opts.
function openSheet(html, opts = {}) {
  return _mountLayer('sheet', (el) => { $('.sheet-body', el).innerHTML = html; }, opts);
}

// Empurra uma página. `paint(el)` preenche `.page-body` e liga os eventos.
function pushPage(paint, opts = {}) {
  return _mountLayer('page', (el) => paint(el), opts);
}

// Troca a camada do topo no lugar (reaproveita a entrada de histórico, sem novo
// nível). Serve pra "formulário (modal) → tela de detalhe (página)".
function replaceTop(kind, build, opts = {}) {
  const old = navStack.pop();
  if (old) {
    if (old._onKey) document.removeEventListener('keydown', old._onKey);
    old.remove();
  }
  return _mountLayer(kind, build, opts, { pushHistory: false });
}

// Fecha o topo. Só dispara o histórico; quem remove o DOM é o popstate.
function popLayer() {
  const top = topLayer();
  if (!top || top._closing) return;
  top._closing = true;
  history.back();
}

// Remoção real do topo — chamado exclusivamente pelo popstate.
function _removeTopLayer() {
  const el = navStack.pop();
  if (!el) return;
  // O Voltar do browser dispara o popstate sem passar por popLayer(), então a
  // flag _closing precisa ser garantida aqui — senão uma pintura async ainda em
  // andamento (ex.: paintProductDetail) conclui e altera o DOM do elemento em
  // transição de fechamento, causando a piscada. Este é o ponto comum a todos
  // os modos de fechar (botão interno, swipe, gesto e Voltar do browser).
  el._closing = true;
  if (el._onKey) document.removeEventListener('keydown', el._onKey);
  el.classList.remove('show');
  el.classList.add('closing');
  const done = () => el.remove();
  el.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 360); // fallback se a transição não disparar
  // a nova camada do topo é "retomada" (atualiza o conteúdo) e volta a escurecer
  const top = topLayer();
  if (top) {
    top.classList.remove('under');
    if (top._opts && typeof top._opts.onResume === 'function') top._opts.onResume(top);
  }
  // Transição "fecha esta camada → abre a próxima" (ex.: scanner → detalhe/cadastro).
  // Roda DEPOIS do popstate ter assentado o histórico, então a camada de destino
  // pode empilhar com history.pushState sem corromper a profundidade da pilha.
  if (el._onRemove) { const fn = el._onRemove; el._onRemove = null; fn(); }
}

// Fecha a camada do topo e, quando ela sair de vez, executa `action` (que pode
// abrir novas camadas). Evita o gambito frágil de popLayer() + abrir em seguida,
// que dispararia history.back e history.pushState no mesmo tique.
function popThen(action) {
  const top = topLayer();
  if (!top) { action(); return; }
  const prev = top._onRemove;
  top._onRemove = () => { if (prev) prev(); action(); };
  popLayer();
}

window.addEventListener('popstate', () => {
  if (navStack.length) _removeTopLayer();
});

// Swipe da borda esquerda pra voltar (gesto padrão de páginas no mobile).
function enableSwipeBack(el) {
  let startX = 0, startY = 0, dx = 0, tracking = false, decided = false, horizontal = false;
  const onStart = (e) => {
    const t = e.touches ? e.touches[0] : e;
    if (t.clientX > 28) return; // só começa bem na borda esquerda
    tracking = true; decided = false; horizontal = false;
    startX = t.clientX; startY = t.clientY; dx = 0;
    el.style.transition = 'none';
  };
  const onMove = (e) => {
    if (!tracking) return;
    const t = e.touches ? e.touches[0] : e;
    const mx = t.clientX - startX, my = t.clientY - startY;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = true;
      horizontal = Math.abs(mx) > Math.abs(my);
      if (!horizontal) { tracking = false; el.style.transition = ''; return; } // é scroll
    }
    dx = Math.max(0, mx);
    el.style.transform = `translateX(${dx}px)`;
    if (e.cancelable) e.preventDefault();
  };
  const onEnd = () => {
    if (!tracking) return;
    tracking = false;
    el.style.transition = '';
    if (horizontal && dx > 90) {
      el.style.transform = 'translateX(100%)';
      popLayer();
    } else {
      el.style.transform = '';
    }
  };
  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchmove', onMove, { passive: false });
  el.addEventListener('touchend', onEnd);
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
      sheet.style.transform = 'translateY(100%)'; // continua deslizando pra baixo
      popLayer();
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
    popLayer();
    toast('Loja salva');
    render();
  });
  if (id) $('#st-del', bg).addEventListener('click', async () => {
    await DB.deleteStore(id);
    popLayer();
    toast('Loja excluída');
    render();
  });
}

// ---------- formulário de produto ----------
// `draft` (opcional, só p/ cadastro NOVO) traz campos já lidos pela IA no scanner
// + a foto comprimida, pra abrir o form preenchido. O usuário revisa e salva.
async function openProductForm(existing, draft = null) {
  const product = existing || {
    name: draft?.name || '', brand: '', category: draft?.category || '',
    gender: draft?.gender || '', volume: draft?.volume || '',
    userNote: '', image: draft?.image || null,
  };
  const stores = await DB.listStores();
  const brandList = await DB.listBrands(); // entidade-fonte (store `brands`) p/ casar a marca da IA
  const storeOptions = stores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  // marca escolhida: id da entidade + nome pra exibir. Nome sem id = pendente (vira marca no save).
  let selectedBrandId = product.brandId || null;
  let selectedBrandName = product.brand || '';
  // marca vinda do scan: casa com a entidade existente (id determinístico) ou
  // deixa o nome pendente pra virar marca nova no save.
  if (!existing && draft && draft.brand) {
    const match = brandList.find((b) => normBrand(b.name) === normBrand(draft.brand));
    selectedBrandId = match ? match.id : null;
    selectedBrandName = match ? match.name : draft.brand.trim();
  }
  // categoria usa o mesmo padrão do seletor de marca: sheet com busca + criar.
  const allProducts = await DB.listProducts();
  const catList = categoriesFrom(allProducts);
  let selectedCat = product.category || '';
  const genderOptions = GENDERS.map((g) => `<option value="${g}" ${product.gender === g ? 'selected' : ''}>${g}</option>`).join('');

  const bg = openSheet(`
    <h2>${existing ? 'Editar produto' : 'Novo produto'}</h2>
    <div class="photo-pick" id="photo">
      <div class="photo-inner" id="photo-inner">
        ${product.image
          ? `<img src="${product.image}" alt="">`
          : `<button type="button" class="photo-opt" id="photo-opt-file">
               <span class="ic">🖼️</span><span>Galeria</span>
             </button>
             <div class="photo-divider"></div>
             <button type="button" class="photo-opt" id="photo-opt-cam">
               <span class="ic">📷</span><span>Câmera</span>
             </button>`}
      </div>
    </div>
    <input type="file" id="photo-input" accept="image/*" hidden>
    <input type="file" id="camera-input" accept="image/*" capture="environment" hidden>
    <button type="button" class="btn secondary ai-fill" id="ai-fill" disabled>✨ Preencher pela foto</button>
    <div class="ai-hint" id="ai-config">⚙️ Configurar chave da IA</div>

    <label class="field"><span>Nome do produto *</span>
      <input class="input" id="p-name" value="${esc(product.name)}" placeholder="Ex.: Sauvage EDT"></label>
    <div class="row">
      <div class="field"><span>Marca</span>
        <div class="input select-like" id="p-brand" role="button" tabindex="0">
          <span id="p-brand-label" class="${selectedBrandName ? '' : 'ph'}">${selectedBrandName ? esc(selectedBrandName) : 'Selecionar marca'}</span>
          <span class="chev">▾</span>
        </div></div>
      <label class="field"><span>Tamanho</span>
        <input class="input" id="p-volume" value="${esc(product.volume || '')}" placeholder="100 ml"></label>
    </div>
    <div class="row">
      <div class="field"><span>Categoria</span>
        <div class="input select-like" id="p-cat" role="button" tabindex="0">
          <span id="p-cat-label" class="${selectedCat ? '' : 'ph'}">${selectedCat ? esc(selectedCat) : 'Selecionar categoria'}</span>
          <span class="chev">▾</span>
        </div></div>
      <label class="field"><span>Gênero</span>
        <select class="input" id="p-gender">
          <option value="">— não definido —</option>${genderOptions}
        </select></label>
    </div>

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
      <textarea class="input" id="p-notes" placeholder="Cheirou bem, promoção, etc.">${esc(product.userNote || '')}</textarea></label>

    <button class="btn" id="p-save">Salvar</button>
  `);

  // foto — dois botões simétricos na caixa (galeria / câmera); com foto, caixa toda troca
  let imageData = product.image || null;
  let currentFile = null;
  const aiBtn = $('#ai-fill', bg);

  // preço/moeda lidos pela IA no scanner (esses campos só existem no cadastro novo)
  if (!existing && draft) {
    if (draft.price) { const pe = $('#p-price', bg); if (pe) pe.value = draft.price; }
    if (draft.currency) { const ce = $('#p-currency', bg); if (ce) ce.value = draft.currency; }
  }

  function bindPhotoOpts() {
    const optFile = $('#photo-opt-file', bg);
    const optCam = $('#photo-opt-cam', bg);
    if (optFile) optFile.addEventListener('click', () => $('#photo-input', bg).click());
    if (optCam) optCam.addEventListener('click', () => $('#camera-input', bg).click());
    // quando já tem imagem, clicar em qualquer lugar troca pela galeria
    if (!optFile) $('#photo', bg).addEventListener('click', () => $('#photo-input', bg).click());
  }
  bindPhotoOpts();

  async function onPhotoChosen(e) {
    const file = e.target.files[0];
    if (!file) return;
    currentFile = file;
    imageData = await compressImage(file);
    $('#photo-inner', bg).innerHTML = `<img src="${imageData}" alt="">`;
    if (aiBtn) aiBtn.disabled = false;
    if (getAiKey()) runAiFill();
  }
  $('#photo-input', bg).addEventListener('change', onPhotoChosen);
  $('#camera-input', bg).addEventListener('change', onPhotoChosen);

  // IA: lê a foto e preenche só os campos AINDA vazios (você revisa e salva).
  $('#ai-config', bg).addEventListener('click', () => configureAiKey());
  if (aiBtn) aiBtn.addEventListener('click', runAiFill);
  async function runAiFill() {
    if (!currentFile) return toast('Escolha ou tire uma foto primeiro');
    if (!getAiKey() && (!configureAiKey() || !getAiKey())) return;
    const label = aiBtn.textContent;
    aiBtn.disabled = true; aiBtn.textContent = '✨ Lendo a foto…';
    try {
      const info = await analyzeProductImage(currentFile);
      const fillIfEmpty = (sel, val) => {
        if (!val) return false;
        const el = $(sel, bg);
        if (el && !el.value.trim()) { el.value = val; return true; }
        return false;
      };
      let n = 0;
      if (fillIfEmpty('#p-name', info.name)) n++;
      if (info.category && !selectedCat) { selectedCat = info.category; updateCatField(); n++; }
      // marca: só preenche se ainda não houver escolha. Casa com a entidade
      // existente (id determinístico) ou deixa o nome pendente p/ criar no save.
      if (info.brand && !selectedBrandId && !selectedBrandName) {
        const match = brandList.find((b) => normBrand(b.name) === normBrand(info.brand));
        selectedBrandId = match ? match.id : null;
        selectedBrandName = match ? match.name : info.brand.trim();
        updateBrandField();
        n++;
      }
      if (fillIfEmpty('#p-volume', info.volume)) n++;
      if (fillIfEmpty('#p-price', info.price)) n++; // campos de preço só existem no cadastro novo
      const gsel = $('#p-gender', bg);
      if (info.gender && gsel && !gsel.value) { gsel.value = info.gender; n++; }
      // moeda tem default (BRL); se a IA detectou uma, aplica
      const csel = $('#p-currency', bg);
      if (info.currency && csel) { csel.value = info.currency; if (info.price) n++; }
      toast(n ? `Preenchi ${n} campo(s) pela foto — confira ✨` : 'Não consegui ler dados do rótulo');
    } catch (err) {
      console.error('[IA] falha ao preencher', err);
      const msgs = {
        'sem-chave': 'Configure a chave da IA primeiro',
        'chave-invalida': 'Chave inválida — confira no AI Studio',
        'sem-resposta': 'A IA não retornou dados',
        'resposta-invalida': 'Resposta da IA ilegível',
      };
      // TypeError = fetch bloqueado (rede/CORS); o resto já vem com motivo real.
      const fallback = err instanceof TypeError
        ? 'Rede bloqueou a chamada à IA (CORS/conexão)'
        : (err.message || 'Falha ao consultar a IA');
      toast(msgs[err.message] || fallback);
    } finally {
      aiBtn.disabled = false; aiBtn.textContent = label;
    }
  }

  // marca: seletor sobre a entidade (lista do banco + criar nova). Sem datalist.
  const brandLabel = $('#p-brand-label', bg);
  function updateBrandField() {
    brandLabel.textContent = selectedBrandName || 'Selecionar marca';
    brandLabel.classList.toggle('ph', !selectedBrandName);
  }
  const openBrand = () => openBrandPicker(selectedBrandId, (brand) => {
    selectedBrandId = brand ? brand.id : null;
    selectedBrandName = brand ? brand.name : '';
    updateBrandField();
  }).catch((err) => { console.error('[marca]', err); toast('Erro ao abrir marcas'); });
  const brandField = $('#p-brand', bg);
  brandField.addEventListener('click', openBrand);
  brandField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBrand(); }
  });

  // categoria: mesmo padrão do seletor de marca
  const catFieldLabel = $('#p-cat-label', bg);
  function updateCatField() {
    catFieldLabel.textContent = selectedCat || 'Selecionar categoria';
    catFieldLabel.classList.toggle('ph', !selectedCat);
  }
  const openCat = () => openCategoryPicker(selectedCat, catList, (cat) => {
    selectedCat = cat;
    updateCatField();
  });
  const catField = $('#p-cat', bg);
  catField.addEventListener('click', openCat);
  catField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCat(); }
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
    // marca já escolhida no seletor (id da entidade); nome pendente vira marca nova aqui
    const brandId = selectedBrandId || (selectedBrandName ? await DB.resolveBrand(selectedBrandName) : null);
    const saved = await DB.saveProduct({
      ...product,
      name,
      brandId,
      volume: $('#p-volume', bg).value.trim(),
      category: selectedCat || 'Outros',
      gender: $('#p-gender', bg).value || null,
      image: imageData,
    });
    // anotação pessoal vive separada do catálogo (não é tocada por sync)
    await DB.setUserNote(saved.id, $('#p-notes', bg).value.trim());
    // preço inicial (só no cadastro novo)
    if (!existing) {
      const priceVal = parsePrice($('#p-price', bg).value);
      const storeId = $('#p-store', bg).value;
      const currency = $('#p-currency', bg).value || 'BRL';
      if (priceVal != null) {
        await DB.savePrice({ productId: saved.id, storeId: storeId || null, value: priceVal, currency, date: Date.now() });
      }
    }
    popLayer(); // volta pro detalhe (se veio de Editar) ou pra página, que se atualizam
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
async function openProductDetail(id, opts = {}) {
  pushPage((el) => paintProductDetail(el, id), { onResume: (el) => paintProductDetail(el, id) });
  // vindo do scanner com produto já existente: abre o form de preço por cima,
  // pronto pra registrar o preço novo (o detalhe se atualiza ao fechar).
  if (opts.addPrice) openPriceForm(id);
}

// (Re)desenha a página de detalhe do produto dentro de `bg`. Usada na abertura e
// no onResume — voltar do formulário/preço reflete favoritos, edições e preços novos.
async function paintProductDetail(bg, id) {
  const p = await DB.getProduct(id);
  if (!p) { popLayer(); return; }
  if (bg._closing) return;
  const titleEl = $('.page-title', bg);
  if (titleEl) titleEl.innerHTML = `${esc(p.name)} ${p.favorite ? '❤️' : ''}`;
  const summary = await priceSummary(id);
  const stores = await DB.listStores();
  if (bg._closing) return;
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

  setHtml($('.page-body', bg), `
    <div class="detail">
      ${hero}
      <div class="brand">${esc(p.brand || '—')}</div>
      <div>
        <span class="tag">${esc(p.category || 'Outros')}</span>
        ${p.gender ? `<span class="tag">${esc(p.gender)}</span>` : ''}
        ${p.volume ? `<span class="tag">${esc(p.volume)}</span>` : ''}
      </div>
      ${p.notes ? `<p class="muted-note" style="margin-top:12px">ℹ️ ${esc(p.notes)}</p>` : ''}
      ${p.userNote ? `<p class="muted-note" style="margin-top:6px">📝 ${esc(p.userNote)}</p>` : ''}

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

  $('#fav-btn', bg).addEventListener('click', async () => { await toggleFav(id); paintProductDetail(bg, id); });
  $('#edit-btn', bg).addEventListener('click', async () => openProductForm(await DB.getProduct(id)));
  $('#del-btn', bg).addEventListener('click', async () => {
    if (!confirm('Excluir este produto e seus preços?')) return;
    await DB.deleteProduct(id);
    popLayer();
    toast('Produto excluído');
    render();
  });
  $('#add-price', bg).addEventListener('click', () => openPriceForm(id));
  $('#addlist-btn', bg).addEventListener('click', () => openAddToList(id));
  bg.querySelectorAll('[data-delprice]').forEach((b) =>
    b.addEventListener('click', async () => {
      await DB.deletePrice(b.dataset.delprice);
      paintProductDetail(bg, id); // repinta a tabela de preços no lugar
    }));
}

async function openPriceForm(productId) {
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
    popLayer(); // volta pro detalhe do produto, que repinta a tabela no onResume
    toast('Preço adicionado');
  });
}

// ---------- scanner (câmera ao vivo + leitura por IA) ----------
// Fluxo: abre a câmera com moldura → captura (ou galeria) → lê a etiqueta pela IA
// → produto já existe: abre o detalhe dele com o form de preço pronto; senão abre
// o cadastro já preenchido. Sem chave de IA (ou leitura falha), vai direto ao
// cadastro com a foto anexada. É o reaproveitamento do que já existe, automatizado.
let _scanStream = null;
function stopScanStream() {
  if (_scanStream) {
    _scanStream.getTracks().forEach((t) => t.stop());
    _scanStream = null;
  }
}

function openScanner() {
  const layer = pushPage((el) => buildScanner(el), { title: '' });
  layer.classList.add('scanner-layer');
  // desliga a câmera em qualquer modo de fechar (botão, swipe, Voltar do Android)
  layer._onRemove = stopScanStream;
}

function buildScanner(layer) {
  $('.page-body', layer).innerHTML = `
    <div class="scan-view" id="scan-view">
      <video id="scan-video" playsinline autoplay muted></video>
      <div class="scan-frame"><span></span><span></span><span></span><span></span></div>
      <div class="scan-hint">Enquadre a etiqueta do produto</div>
    </div>
    <div class="scan-controls">
      <button class="scan-side" id="scan-gallery" aria-label="Escolher da galeria">🖼️</button>
      <button class="scan-shutter" id="scan-shutter" aria-label="Tirar foto"></button>
      <button class="scan-side" id="scan-manual" aria-label="Cadastrar sem foto">✏️</button>
    </div>
    <input type="file" id="scan-file" accept="image/*" hidden>
  `;

  const video = $('#scan-video', layer);
  const shutter = $('#scan-shutter', layer);
  const fileInput = $('#scan-file', layer);

  // liga a câmera traseira; falhou (permissão negada / sem câmera) → galeria + manual
  (async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no-cam');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      });
      if (layer._closing) { stream.getTracks().forEach((t) => t.stop()); return; }
      _scanStream = stream;
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch (e) {
      showScanFallback(layer);
    }
  })();

  shutter.addEventListener('click', async () => {
    if (!_scanStream) return;
    shutter.disabled = true;
    const blob = await captureFrame(video);
    if (blob) processScan(layer, blob);
    else shutter.disabled = false;
  });
  $('#scan-gallery', layer).addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processScan(layer, file);
  });
  $('#scan-manual', layer).addEventListener('click', () => popThen(() => openProductForm()));
}

// câmera indisponível: troca a vista pela orientação de galeria/manual e some o disparo
function showScanFallback(layer) {
  stopScanStream();
  const view = $('#scan-view', layer);
  if (view) view.innerHTML = `
    <div class="scan-fallback">
      <div class="big">📷</div>
      <div>Não consegui abrir a câmera.<br>Use a galeria 🖼️ ou cadastre sem foto ✏️.</div>
    </div>`;
  const shutter = $('#scan-shutter', layer);
  if (shutter) shutter.style.display = 'none';
}

// congela um quadro do vídeo num JPEG (Blob) pra leitura e armazenamento
function captureFrame(video) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.92));
}

function showScanBusy(layer) {
  const view = $('#scan-view', layer);
  if (!view || $('.scan-busy', view)) return;
  const busy = document.createElement('div');
  busy.className = 'scan-busy';
  busy.innerHTML = '<div class="scan-spinner"></div><div>Lendo a foto…</div>';
  view.appendChild(busy);
}

// lê a foto pela IA, decide o destino e transiciona o scanner pra ele
async function processScan(layer, fileOrBlob) {
  stopScanStream();
  showScanBusy(layer);

  let info = null;
  if (getAiKey()) {
    try {
      info = await analyzeProductImage(fileOrBlob);
    } catch (err) {
      console.error('[scan] IA falhou', err);
      toast(err instanceof TypeError
        ? 'Sem internet pra ler a foto — preencha os dados'
        : 'Não consegui ler a foto — preencha os dados');
    }
  } else {
    toast('Configure a chave da IA (⚙️) pra leitura automática');
  }

  const imageData = await compressImage(fileOrBlob);

  // sem leitura útil: cadastro novo só com a foto anexada
  if (!info || (!info.name && !info.brand)) {
    popThen(() => openProductForm(null, { image: imageData }));
    return;
  }

  const draft = {
    name: info.name, brand: info.brand, category: info.category,
    volume: info.volume, gender: info.gender,
    price: info.price, currency: info.currency, image: imageData,
  };

  const products = await DB.listProducts();
  const sameName = (p) => info.name && normBrand(p.name) === normBrand(info.name);
  const sameBrand = (p) => info.brand && normBrand(p.brand) === normBrand(info.brand);
  const overlap = (a, b) => {
    const x = normBrand(a), y = normBrand(b);
    return !!x && !!y && (x.includes(y) || y.includes(x));
  };

  // exato: nome bate (e marca também, se a IA leu) → abre direto pra adicionar preço
  const exact = products.filter((p) => sameName(p) && (!info.brand || sameBrand(p)));
  if (exact.length === 1) {
    const id = exact[0].id;
    popThen(() => openProductDetail(id, { addPrice: true }));
    return;
  }

  // parecidos: vários exatos, ou mesma marca + nome que se sobrepõe → confirmar
  const cands = (exact.length ? exact : products.filter((p) =>
    (info.brand ? sameBrand(p) : true) && overlap(p.name, info.name)
  )).slice(0, 6);

  if (cands.length) popThen(() => openScanMatch(draft, cands));
  else popThen(() => openProductForm(null, draft));
}

// produto parecido já existe: escolher um (→ adicionar preço) ou cadastrar como novo
function openScanMatch(draft, candidates) {
  const rows = candidates.map((p) => `
    <div class="pick-row" data-pick="${p.id}">
      ${p.image ? `<img class="li-thumb" src="${p.image}" alt="">` : '<div class="li-thumb placeholder">🧴</div>'}
      <div class="li-info">
        <div class="li-name">${esc(p.name)}</div>
        <div class="li-price muted">${esc(p.brand || '—')}</div>
      </div>
      <div class="pick-check">›</div>
    </div>`).join('');
  const bg = openSheet(`
    <h2>Já está no catálogo?</h2>
    <p class="muted-note">Li <strong>${esc(draft.name || draft.brand || 'o produto')}</strong> na foto. Se for um destes, toque pra adicionar o preço novo:</p>
    <div class="pick-list" style="margin-top:10px">${rows}</div>
    <div class="pick-row create" data-new="1" style="margin-top:6px">
      <div class="li-info"><div class="li-name">+ É um produto novo</div></div>
      <div class="pick-check">+</div>
    </div>
  `);
  bg.querySelectorAll('[data-pick]').forEach((row) =>
    row.addEventListener('click', () => popThen(() => openProductDetail(row.dataset.pick, { addPrice: true }))));
  $('[data-new]', bg).addEventListener('click', () => popThen(() => openProductForm(null, draft)));
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

// Geocodifica (no aparelho) as lojas que têm endereço mas ainda não têm pino.
// Respeita o limite do Nominatim (~1 req/s). Retorna quantas foram localizadas.
async function geocodeMissingStores() {
  const stores = await DB.listStores();
  const pending = stores.filter((s) => s.lat == null && s.address);
  let done = 0;
  for (const s of pending) {
    const r = await geocodeAddress(s.address);
    if (r) {
      await DB.saveStore({ ...s, lat: r.lat, lng: r.lng });
      done++;
    }
    await new Promise((res) => setTimeout(res, 1100));
  }
  return done;
}

// Sincroniza o catálogo publicado (manifesto catalog.json -> arquivos de produtos).
// Conflito-zero: só mexe nos registros de catálogo; favoritos, anotações, listas
// e cadastros do próprio usuário ficam intactos.
async function syncCatalog() {
  try {
    toast('Sincronizando…');
    const res = await fetch('catalog.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const manifest = await res.json();
    const local = await DB.getCatalogVersion();
    if ((manifest.version || 0) <= local) {
      toast('Catálogo já está atualizado ✓');
      return;
    }

    // baixa todos os arquivos do manifesto e junta tudo numa união só
    const union = { products: [], brands: [], stores: [], prices: [] };
    for (const src of manifest.sources || []) {
      const r = await fetch(src.file + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + src.file);
      const data = await r.json();
      union.products.push(...(data.products || []));
      union.brands.push(...(data.brands || []));
      union.stores.push(...(data.stores || []));
      union.prices.push(...(data.prices || []));
    }

    const result = await DB.syncCatalog(union);
    await DB.setCatalogVersion(manifest.version);

    // resolve endereços -> pino no mapa (no aparelho; o catálogo guarda só o endereço)
    await geocodeMissingStores();

    // volta pra aba Catálogo (sem filtros) pra garantir que os produtos apareçam
    state.tab = 'catalogo';
    clearFilters();
    state.search = '';
    document.querySelectorAll('.tabbar button').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === 'catalogo'));
    await render();

    const extra = result.removed ? ` · ${result.removed} removido(s)` : '';
    toast(`Catálogo atualizado ✨ ${result.upserted} produto(s)${extra}`);
  } catch (e) {
    toast('Erro ao sincronizar: ' + (e.message || e));
  }
}

// ---------- configurações (catálogo + backup + chave da IA) ----------
function openSettings() {
  const bg = openSheet(`
    <h2>Configurações</h2>
    <div class="section-title">Catálogo</div>
    <p class="muted-note">Pega as últimas informações publicadas (lojas, produtos e preços). Seus favoritos, anotações e listas não são alterados.</p>
    <button class="btn" id="bk-sync" style="margin-top:10px">🔄 Sincronizar catálogo</button>
    <div class="section-title">Backup dos seus dados</div>
    <p class="muted-note">Backup completo deste aparelho (inclui seus favoritos, anotações e listas). Exporte de vez em quando e importe ao trocar de celular.</p>
    <button class="btn secondary" id="bk-exp" style="margin-top:10px">⬇️ Exportar backup</button>
    <button class="btn secondary" id="bk-imp" style="margin-top:10px">⬆️ Importar backup</button>
    <div class="section-title">Leitura por IA</div>
    <p class="muted-note">Chave do Google AI Studio (Gemini) pra ler a etiqueta nas fotos do scanner. Fica salva só neste aparelho.</p>
    <button class="btn secondary" id="bk-ai" style="margin-top:10px">✨ Configurar chave da IA</button>
  `);
  $('#bk-sync', bg).addEventListener('click', () => { syncCatalog(); popLayer(); });
  $('#bk-exp', bg).addEventListener('click', () => { exportBackup(); popLayer(); });
  $('#bk-imp', bg).addEventListener('click', () => { importBackup(); popLayer(); });
  $('#bk-ai', bg).addEventListener('click', () => configureAiKey());
}

// ---------- navegação ----------
function setTab(tab) {
  state.tab = tab;
  if (tab === 'favoritos') clearFilters();
  document.querySelectorAll('.tabbar button[data-tab]').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === tab));
  render();
}

document.querySelectorAll('.tabbar button[data-tab]').forEach((b) =>
  b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#scan-btn').addEventListener('click', () => openScanner());
$('#settings-btn').addEventListener('click', () => openSettings());

// registra o service worker (modo offline / instalável)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

render();
