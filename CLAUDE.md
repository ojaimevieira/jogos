# Guia do agente — Achadora

Este arquivo é lido automaticamente pelo Claude Code. Ele descreve **como atualizar o
catálogo da Achadora** quando o dono manda uma foto/produto. Siga este fluxo.

## O que é o quê neste repositório

- **`achadora/`** — o projeto de verdade: PWA de catálogo de perfumes (compara preços
  entre lojas de Ciudad del Este). É aqui que todo trabalho de produto acontece.
- **`index.html` na raiz** — um joguinho de nave, sem relação com a Achadora. Não mexer
  a menos que pedido explicitamente.

## Modelo de dados do catálogo

O catálogo é publicado junto do app e versionado. Três tipos de registro, todos com
`source: 'catalog'` (o app marca isso no sync; não precisa pôr nos arquivos):

- **Produto** — `{ id, name, brandId, category, volume, notes, image, createdAt, updatedAt }`
  - `image` é um data-URL **base64 JPEG** (`data:image/jpeg;base64,...`). É o padrão visual.
  - `brandId` referencia uma **Marca** (não guarda o nome). O app resolve o nome na leitura.
- **Marca** — `{ id, name }` (entidade própria, como a loja). `id` determinístico derivado do
  nome: `brand-<slug>` (ex.: `brand-lattafa`, `brand-al-wataniah`). Mesmo nome → mesmo id em
  qualquer aparelho/seed, então nunca duplica.
- **Loja** — `{ id, name, address, lat, lng }` (lat/lng podem faltar; o app geocodifica).
- **Preço** — `{ id, productId, storeId, value, currency, date, createdAt }` (`currency` = `USD`).

### Arquivos

| Arquivo | Conteúdo |
|---|---|
| `achadora/catalog.json` | Manifesto: `version` + lista de `sources` (arquivos de produtos). |
| `achadora/seed-lojas.json` | As lojas (`stores`). |
| `achadora/seed-lattafa.json` | `brands` + produtos + preços da marca Lattafa. |
| `achadora/seed-alwataniah.json` | `brands` + produtos + preços da marca Al Wataniah. |

Cada seed de marca declara a própria marca num array `brands: [{ id, name }]`, e os produtos
referenciam pelo `brandId`. Uma marca nova = um novo `seed-<marca>.json` (mesmo formato:
`brands` + `products` + `prices`) listado em `catalog.json`.

### ⚠️ O que dispara o sync no app

O app (`achadora/app.js`, `syncCatalog`) **só** sincroniza quando
`catalog.json.version` for **maior** que a versão já baixada no aparelho. Os campos
`version` dentro dos `seed-*.json` são informativos. **Sempre incremente
`catalog.json.version` ao publicar** — senão a mudança não chega no celular.

## Fluxo: adicionar/atualizar um produto

1. **Identifique a marca** → escolha o `seed-<marca>.json` (ou crie um novo e registre em
   `catalog.json` → `sources`). Garanta que a marca esteja no array `brands` do seed
   (`id` = `brand-<slug>`); o produto referencia esse `id` via `brandId`.
2. **Produto**: adicione o objeto em `products` com `brandId` (não ponha `brand` por extenso).
   `id` único e estável (padrão `<marca>-NNN`).
   - **Foto**: o padrão é base64 JPEG embutido em `image`. Prefira a foto que o dono
     mandar. Reduza/comprima para JPEG antes de embutir (manter os arquivos leves).
3. **Loja**: o dono diz a loja.
   - Se a loja **já existe** em `seed-lojas.json`, reutilize o `id` dela.
   - Se **não existe**, crie uma nova entrada em `seed-lojas.json` (`name` + `address`;
     `lat`/`lng` podem ficar de fora — o app geocodifica pelo endereço).
4. **Preço**: adicione em `prices` do mesmo seed da marca, com `productId`, `storeId`,
   `value`, `currency:"USD"`, `date`.
5. **Publique**: incremente `catalog.json.version` (e, por organização, o `version` do
   seed editado). Commit + push.

## Compras Paraguai — fonte de referência (limitações reais)

`comprasparaguai.com.br` é a **primeira fonte** de pesquisa de preços/lojas. Mas o site
**bloqueia acesso automatizado** (HTTP 403 / anti-bot): `WebFetch` e `curl` direto **não
funcionam** nas páginas dele.

O que **funciona**: a ferramenta **`WebSearch` com `allowed_domains:
["comprasparaguai.com.br"]`**. O Google indexa o site, então a busca devolve a página de
comparação do produto, faixa de preço, número de lojas e até páginas de oferta por loja
(o nome da loja costuma aparecer no título — ex.: "na loja Elegancia Company").

Fluxo quando o dono **não** manda os dados:
1. `WebSearch` no produto restrito a `comprasparaguai.com.br`.
2. Veja as lojas que ofertam. Se **alguma já estiver no nosso `seed-lojas.json`**, dê
   **preferência** a ela. Senão, use a **mais barata** (só vale a pena se a página listar
   várias lojas; com uma ou duas, não compensa).
3. Adicione essa loja (se nova) + o preço.

**Imagem**: o `WebFetch` retorna 403 em **todos** os sites de perfume e e-commerce testados
(Compras Paraguai, Lattafa oficial, Amazon, Fragrantica, etc.) — não tente buscar imagem
automaticamente, é perda de tempo. O fluxo correto é:

1. **Peça ao dono uma foto limpa** do produto (fundo branco/neutro = padrão do catálogo).
2. Se o dono só tiver foto de loja, use-a — mas avise que ficará fora do padrão.
3. Nunca use foto de loja sem avisar.

Quando faltar dado que a busca não resolve (preço exato, tabela completa de lojas, foto),
**pergunte ao dono** em vez de chutar.

## Convenções

- Linguagem do projeto e dos commits: **português (pt-BR)**.
- Branch de trabalho: a indicada na tarefa. Commit + push ao concluir; **não** abrir PR
  sem o dono pedir.
- Rodar local: `cd achadora && python3 -m http.server 8000`.
