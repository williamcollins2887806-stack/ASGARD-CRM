"""Скачать Inter (latin + cyrillic) и локальный кириллический serif для заголовков.

Локальные public/assets/fonts/inter*.woff2 содержат ТОЛЬКО латиницу (231 глиф,
0 кириллических) — русский текст во всём CRM рисовался системным Segoe UI,
а заголовки «Зал Ярла» (Cinzel) — Times New Roman. Отсюда «мыло».
"""
import re
import urllib.request
from pathlib import Path

OUT = Path("public/assets/fonts")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

WEIGHTS = [400, 500, 600, 700]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def css_for(family: str, weights, axes: str = "") -> str:
    fam = family.replace(" ", "+")
    w = ";".join(str(x) for x in weights)
    url = f"https://fonts.googleapis.com/css2?family={fam}:wght@{w}{axes}&display=swap"
    return fetch(url).decode("utf-8")


def download_subsets(family: str, weights, wanted, slug: str) -> list:
    """Скачать нужные unicode-range субсеты и вернуть @font-face-блоки."""
    css = css_for(family, weights)
    blocks = re.findall(r"/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*\{[^}]+\})", css)
    saved = []
    for label, block in blocks:
        if label not in wanted:
            continue
        weight = re.search(r"font-weight:\s*(\d+)", block).group(1)
        src = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
        urange = re.search(r"unicode-range:\s*([^;]+);", block).group(1).strip()

        name = f"{slug}-{weight}-{label}.woff2"
        data = fetch(src)
        (OUT / name).write_bytes(data)
        saved.append((name, weight, urange, len(data)))
    return saved


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    inter = download_subsets("Inter", WEIGHTS, {"latin", "latin-ext", "cyrillic", "cyrillic-ext"}, "inter")
    print(f"Inter: {len(inter)} файлов")
    for name, weight, urange, size in inter:
        print(f"  {name}  w{weight}  {size // 1024} КБ")

    lines = [
        "/* Inter с КИРИЛЛИЦЕЙ (self-hosted). Прежние inter*.woff2 были latin-only:",
        "   231 глиф, 0 кириллических -> русский текст падал в системный Segoe UI",
        "   и выглядел «мыльным». Источник: Google Fonts, Inter v20, OFL-1.1. */",
        "",
    ]
    for name, weight, urange, _ in inter:
        lines += [
            "@font-face {",
            "  font-family: 'Inter';",
            "  font-style: normal;",
            f"  font-weight: {weight};",
            "  font-display: swap;",
            f"  src: url(/assets/fonts/{name}) format('woff2');",
            f"  unicode-range: {urange};",
            "}",
        ]
    (OUT / "fonts.css").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("fonts.css перезаписан")


if __name__ == "__main__":
    main()
