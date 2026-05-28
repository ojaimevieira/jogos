# Extrair conversa compartilhada do ChatGPT

> **Por que isto existe:** o ambiente remoto do assistente bloqueia o acesso a
> `chatgpt.com` (a allowlist do proxy retorna `403 host_not_allowed`). Então a
> extração precisa rodar na **sua máquina**, que tem internet normal. Use
> qualquer um dos métodos abaixo.

Link alvo: `https://chatgpt.com/share/699f8edb-71f0-8003-a1c2-bfb725708d7c`

---

## Método 1 — Script Python (recomendado)

Não precisa instalar nada além do Python 3.8+.

```bash
python3 tools/extract_chatgpt_share.py \
  "https://chatgpt.com/share/699f8edb-71f0-8003-a1c2-bfb725708d7c" \
  -o conversa.md --json conversa.json
```

- `conversa.md`  → conversa na íntegra, formatada em Markdown.
- `conversa.json` → JSON bruto (caso queira processar depois).

Se a saída não for usada, ele imprime no terminal (stdout).

---

## Método 2 — Console do navegador (mais infalível)

Funciona mesmo se a OpenAI mudar a API, porque pega os dados já carregados
na página.

1. Abra o link no navegador.
2. Pressione **F12** → aba **Console**.
3. Cole e rode:

```js
(() => {
  const el = document.getElementById('__NEXT_DATA__');
  const data = JSON.parse(el.textContent)
                 .props.pageProps.serverResponse.data;
  const map = data.mapping;
  let root = Object.keys(map).find(k => map[k].parent === null);
  let out = `# ${data.title || 'Conversa ChatGPT'}\n\n`;
  const labels = {user:'👤 Usuário', assistant:'🤖 ChatGPT', system:'⚙️ Sistema', tool:'🔧 Ferramenta'};
  (function walk(id){
    const n = map[id]; if(!n) return;
    const m = n.message;
    if (m && m.content && m.content.parts) {
      const role = m.author?.role || '?';
      const txt = m.content.parts.map(p => typeof p === 'string' ? p : '').join('\n').trim();
      const hidden = m.metadata?.is_visually_hidden_from_conversation;
      if (txt && !hidden) out += `## ${labels[role]||role}\n\n${txt}\n\n---\n\n`;
    } else if (m && m.content && m.content.content_type === 'code') {
      out += '```\n' + (m.content.text||'') + '\n```\n\n---\n\n';
    }
    (n.children||[]).forEach(walk);
  })(root);
  // baixa o arquivo
  const blob = new Blob([out], {type:'text/markdown'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'conversa.md';
  a.click();
  console.log(out);
})();
```

Isso baixa `conversa.md` e também imprime tudo no console.

---

## Método 3 — Fallback offline (HTML salvo)

Se nada acima funcionar (rede corporativa, etc.):

1. Abra o link no navegador.
2. **Ctrl+S** → salve como "Página da Web, completa" (`pagina.html`).
3. Rode:

```bash
python3 tools/extract_chatgpt_share.py --from-html pagina.html -o conversa.md
```

---

## Problemas comuns

- **`403` / `host_not_allowed`**: você está rodando em rede bloqueada (como o
  ambiente do assistente). Rode na sua máquina ou use o Método 2.
- **`Não encontrei __NEXT_DATA__`**: a página não terminou de carregar, ou o
  link expirou/foi removido. Confirme que o link abre no navegador.
- **Conversa incompleta**: o link de share só contém o que o autor compartilhou
  até o ponto em que gerou o link.
