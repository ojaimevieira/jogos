# ✨ Achadora

App de catálogo de garimpo: cadastre produtos que você encontra nas lojas
(começando por **perfumes**), compare preços entre lojas e salve seus favoritos.

## Como funciona

- **100% no seu aparelho** — os dados ficam salvos no navegador (IndexedDB),
  sem login e funcionando offline. Nada vai pra internet.
- **Instalável** — abra no celular e use "Adicionar à tela de início" pra usar
  como um app de verdade (PWA).
- **Backup** — exporte/importe um arquivo `.json` na aba 💾 pra não perder os
  dados ao trocar de aparelho ou limpar o navegador.

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
