#!/usr/bin/env python3
"""
Extrator de conversas compartilhadas do ChatGPT (links chatgpt.com/share/...).

Por que este script existe:
  O ambiente remoto onde o assistente roda bloqueia o acesso a chatgpt.com
  (host fora da allowlist do proxy). Este script foi feito para rodar na SUA
  máquina, que tem acesso normal à internet, e extrair a conversa na íntegra.

Uso:
    python3 extract_chatgpt_share.py <URL_ou_ID> [-o saida.md] [--json saida.json]

Exemplos:
    python3 extract_chatgpt_share.py https://chatgpt.com/share/699f8edb-71f0-8003-a1c2-bfb725708d7c
    python3 extract_chatgpt_share.py 699f8edb-71f0-8003-a1c2-bfb725708d7c -o conversa.md

Requisitos: Python 3.8+ (somente biblioteca padrão). Sem dependências externas.
"""

import argparse
import gzip
import io
import json
import re
import sys
import urllib.request
import urllib.error
import zlib

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")


def normalize_id(arg: str) -> str:
    """Aceita URL completa ou apenas o ID e devolve o ID da conversa."""
    arg = arg.strip()
    m = re.search(r"/share/(?:e/)?([0-9a-fA-F-]{16,})", arg)
    if m:
        return m.group(1)
    # talvez seja só o id
    if re.fullmatch(r"[0-9a-fA-F-]{16,}", arg):
        return arg
    raise ValueError(f"Não consegui identificar o ID da conversa em: {arg!r}")


def _decode(resp) -> str:
    raw = resp.read()
    enc = (resp.headers.get("Content-Encoding") or "").lower()
    if enc == "gzip":
        raw = gzip.decompress(raw)
    elif enc == "deflate":
        try:
            raw = zlib.decompress(raw)
        except zlib.error:
            raw = zlib.decompress(raw, -zlib.MAX_WBITS)
    elif enc == "br":
        try:
            import brotli  # type: ignore
            raw = brotli.decompress(raw)
        except Exception:
            pass
    return raw.decode("utf-8", errors="replace")


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
        "Accept-Encoding": "gzip, deflate",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return _decode(resp)


def get_conversation_data(conv_id: str) -> dict:
    """
    Tenta duas estratégias:
      1) Endpoint de backend JSON (mais limpo).
      2) Parse do __NEXT_DATA__ embutido no HTML da página de share.
    """
    errors = []

    # Estratégia 1: API de backend
    api_url = f"https://chatgpt.com/backend-api/share/{conv_id}"
    try:
        txt = fetch(api_url)
        data = json.loads(txt)
        if isinstance(data, dict) and ("mapping" in data or "linear_conversation" in data):
            return data
    except Exception as e:  # noqa
        errors.append(f"backend-api: {e}")

    # Estratégia 2: HTML + __NEXT_DATA__
    page_url = f"https://chatgpt.com/share/{conv_id}"
    try:
        html = fetch(page_url)
        m = re.search(
            r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
            html, re.DOTALL)
        if m:
            next_data = json.loads(m.group(1))
            page_props = next_data.get("props", {}).get("pageProps", {})
            server = page_props.get("serverResponse", {})
            data = server.get("data")
            if isinstance(data, dict) and "mapping" in data:
                return data
            # Algumas variações
            if "mapping" in page_props:
                return page_props
        errors.append("HTML sem __NEXT_DATA__ utilizável")
    except Exception as e:  # noqa
        errors.append(f"html: {e}")

    raise RuntimeError("Falha ao obter dados da conversa.\n  " + "\n  ".join(errors))


def extract_text_from_message(message: dict) -> str:
    """Extrai o texto de um nó de mensagem, lidando com vários tipos de conteúdo."""
    if not message:
        return ""
    content = message.get("content", {}) or {}
    ctype = content.get("content_type")
    parts = content.get("parts")

    if ctype in ("text", "multimodal_text") and parts:
        out = []
        for p in parts:
            if isinstance(p, str):
                out.append(p)
            elif isinstance(p, dict):
                # imagens / anexos
                if p.get("content_type") == "image_asset_pointer":
                    out.append(f"[imagem: {p.get('asset_pointer','')}]")
                elif "text" in p:
                    out.append(p["text"])
        return "\n".join(out)

    if ctype == "code":
        return "```\n" + (content.get("text", "")) + "\n```"

    if ctype == "execution_output":
        return "```\n" + (content.get("text", "")) + "\n```"

    if parts:
        return "\n".join(str(p) for p in parts if isinstance(p, (str, int, float)))

    return ""


def linearize(data: dict):
    """Reconstrói a ordem da conversa percorrendo a árvore de mapping."""
    mapping = data.get("mapping", {})

    # Caso já exista uma ordem linear
    if data.get("linear_conversation"):
        nodes = data["linear_conversation"]
        for node in nodes:
            msg = node.get("message")
            if msg:
                yield msg
        return

    # Acha a raiz
    root = None
    for nid, node in mapping.items():
        if node.get("parent") is None:
            root = nid
            break
    if root is None and mapping:
        root = next(iter(mapping))

    # Caminha a partir da raiz pelos filhos
    ordered = []
    visited = set()

    def walk(nid):
        if nid in visited or nid not in mapping:
            return
        visited.add(nid)
        node = mapping[nid]
        msg = node.get("message")
        if msg:
            ordered.append(msg)
        for child in node.get("children", []):
            walk(child)

    walk(root)
    for msg in ordered:
        yield msg


ROLE_LABEL = {
    "user": "👤 Usuário",
    "assistant": "🤖 ChatGPT",
    "system": "⚙️ Sistema",
    "tool": "🔧 Ferramenta",
}


def to_markdown(data: dict) -> str:
    title = data.get("title") or "Conversa do ChatGPT"
    lines = [f"# {title}", ""]
    for msg in linearize(data):
        author = msg.get("author", {}) or {}
        role = author.get("role", "?")
        text = extract_text_from_message(msg).strip()
        if not text:
            continue
        # pula mensagens de sistema vazias/ocultas
        meta = msg.get("metadata", {}) or {}
        if role == "system" and meta.get("is_visually_hidden_from_conversation"):
            continue
        label = ROLE_LABEL.get(role, role)
        lines.append(f"## {label}")
        lines.append("")
        lines.append(text)
        lines.append("")
        lines.append("---")
        lines.append("")
    return "\n".join(lines)


def data_from_html(html: str) -> dict:
    """Extrai os dados da conversa a partir do HTML salvo da página de share."""
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html, re.DOTALL)
    if not m:
        raise RuntimeError("Não encontrei __NEXT_DATA__ no HTML fornecido.")
    next_data = json.loads(m.group(1))
    page_props = next_data.get("props", {}).get("pageProps", {})
    server = page_props.get("serverResponse", {})
    data = server.get("data")
    if isinstance(data, dict) and "mapping" in data:
        return data
    if "mapping" in page_props:
        return page_props
    raise RuntimeError("HTML não contém o mapping da conversa.")


def main():
    ap = argparse.ArgumentParser(description="Extrai conversa compartilhada do ChatGPT.")
    ap.add_argument("url", nargs="?", help="URL completa do share ou apenas o ID")
    ap.add_argument("-o", "--out", help="Arquivo .md de saída (padrão: stdout)")
    ap.add_argument("--json", help="Salva também o JSON bruto da conversa")
    ap.add_argument("--from-html", dest="from_html",
                    help="Extrai de um HTML salvo localmente (fallback offline)")
    args = ap.parse_args()

    if args.from_html:
        with open(args.from_html, encoding="utf-8", errors="replace") as f:
            html = f.read()
        try:
            data = data_from_html(html)
        except Exception as e:
            print(f"[x] {e}", file=sys.stderr)
            sys.exit(1)
        _emit(data, args)
        return

    if not args.url:
        ap.error("informe a URL/ID ou use --from-html")

    try:
        conv_id = normalize_id(args.url)
    except ValueError as e:
        print(f"Erro: {e}", file=sys.stderr)
        sys.exit(2)

    print(f"[i] ID da conversa: {conv_id}", file=sys.stderr)
    try:
        data = get_conversation_data(conv_id)
    except Exception as e:
        print(f"[x] {e}", file=sys.stderr)
        print("[!] Dica: abra o link no navegador, faça 'Salvar página como' (HTML completo)\n"
              "    e rode: python3 extract_chatgpt_share.py --from-html arquivo.html", file=sys.stderr)
        sys.exit(1)
    _emit(data, args)


def _emit(data: dict, args):

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"[i] JSON bruto salvo em {args.json}", file=sys.stderr)

    md = to_markdown(data)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"[ok] Conversa salva em {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(md)


if __name__ == "__main__":
    main()
