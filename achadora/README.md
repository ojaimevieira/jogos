# ✨ Achadora

App de catálogo de garimpo: cadastre produtos que você encontra nas lojas
(começando por **perfumes**), compare preços entre lojas e salve seus favoritos.

## Como funciona

- **100% no seu aparelho** — os dados ficam salvos no navegador (IndexedDB),
  sem login e funcionando offline.
- **Instalável** — abra no celular e use "Adicionar à tela de início" pra usar
  como um app de verdade (PWA).
- **Catálogo sincronizável** — o catálogo (lojas, produtos e preços) é publicado
  junto do app e versionado. O botão **🔄 Sincronizar** baixa a última versão.
- **Backup** — exporte/importe um arquivo `.json` na aba 💾 pra não perder os
  dados ao trocar de aparelho ou limpar o navegador.

## Catálogo vs. dados do usuário (sem conflito)

Os dados têm **donos diferentes**, e isso é o que evita conflito ao sincronizar:

| Dado | Dono | Etiqueta | Sync sobrescreve? |
|---|---|---|---|
| Produtos, lojas, preços do catálogo | mantenedor | `source: 'catalog'` | sim |
| Produtos/lojas/preços que o usuário cadastrou | usuário | `source: 'user'` | **nunca** |
| Favoritos e anotações pessoais | usuário | store `userProducts` | **nunca** |
| Listas de desejos / orçamentos | usuário | store `lists` | **nunca** |

Como o estado do usuário vive em stores separadas (não dentro do registro do
produto), o `Sincronizar` simplesmente troca os registros `source: 'catalog'` —
**impossível** clobrar o que é do usuário, sem gatilho nem lista de exceções.

### Publicando uma atualização de catálogo

1. Edite/adicione um arquivo de produtos (mesmo formato dos `seed-*.json`).
2. Liste-o em `catalog.json` (campo `sources`).
3. Incremente `version` em `catalog.json`.
4. Faça push. O app sincroniza quando a `version` remota for maior que a baixada.

Produtos removidos do catálogo (descontinuados) somem no próximo sync; cadastros
do próprio usuário continuam intactos.

## Funcionalidades (fase 1 — MVP)

- 📷 Cadastro com foto (tira da câmera ou escolhe da galeria)
- 🏪 Lojas reutilizáveis (cadastra uma vez, reusa nos próximos)
- ⭐ Favoritos
- 💰 Tabela comparativa de preços por loja (destaca o mais barato)
- 🔎 Busca e filtro por categoria

## Próximas fases (ideias)

- 📸 **Foto → preenche sozinho**: reconhecimento do perfume por IA de visão
  (precisa de chave de API + um pequeno backend pra proteger a chave).
- ☁️ **Nuvem/sincronização** entre celular e computador (ex.: Supabase/Postgres).
- 🗺️ **Mapa** das lojas.

## Rodando localmente

É um site estático. Precisa ser servido por HTTP (o service worker e a câmera
não funcionam abrindo o arquivo direto). Por exemplo:

```bash
cd achadora
python3 -m http.server 8000
# abra http://localhost:8000
```

## Estrutura

| Arquivo | O quê |
|---|---|
| `index.html` | Estrutura da página e navegação |
| `styles.css` | Visual (tema escuro, mobile-first) |
| `db.js` | Banco de dados local (IndexedDB) |
| `app.js` | Telas e lógica do app |
| `sw.js` | Service worker (offline) |
| `manifest.json` | Configuração do app instalável |
