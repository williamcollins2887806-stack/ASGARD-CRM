"""Проверка кодировки и mojibake в файлах фронта (D-142b).

Ищет:
  1) невалидный UTF-8;
  2) U+FFFD;
  3) классический двойной перекодир: «╨»/«╤»/«тФА»/«тАФ» вплотную к буквам.
"""
import sys
from pathlib import Path

# признак дефекта: символы псевдографики вплотную к русской букве
MOJI = ["\u2568", "\u2564", "\u2565", "\u2560", "\u2550"]


def check(path: Path):
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
        bad_utf8 = None
    except UnicodeDecodeError as e:
        text = raw.decode("utf-8", "replace")
        bad_utf8 = str(e)

    fffd = text.count("\ufffd")
    # «тФА», «тАФ», «ЁЯЫбя» — характерные последовательности cp1251->utf8->cp1251
    markers = 0
    for m in ("\u0442\u0424\u0410", "\u0442\u0410\u0424", "\u0401\u042f\u042b"):
        markers += text.count(m)
    # псевдографика вплотную к кириллице
    near = 0
    for i, ch in enumerate(text):
        if ch in MOJI:
            prev = text[i - 1] if i > 0 else ""
            nxt = text[i + 1] if i + 1 < len(text) else ""
            if ("\u0400" <= prev <= "\u04ff") or ("\u0400" <= nxt <= "\u04ff"):
                near += 1
    return {
        "path": str(path),
        "bytes": len(raw),
        "utf8_error": bad_utf8,
        "fffd": fffd,
        "markers": markers,
        "near": near,
        "defect": bool(bad_utf8 or fffd or markers > 2 or near > 0),
    }


def main():
    roots = sys.argv[1:] or ["public", "src"]
    bad = []
    scanned = 0
    for root in roots:
        base = Path(root)
        if base.is_file():
            files = [base]
        else:
            files = [p for p in base.rglob("*")
                     if p.is_file()
                     and p.suffix in (".js", ".jsx", ".css", ".html", ".json", ".sql", ".md")]
        for p in files:
            if any(x in p.parts for x in ("node_modules", "dist", "vendor", "_prod_blocks_backup", ".min.")):
                continue
            scanned += 1
            r = check(p)
            if r["defect"]:
                bad.append(r)

    print(f"просканировано файлов: {scanned}")
    print(f"с дефектами: {len(bad)}\n")
    for r in bad[:40]:
        print(f"  {r['path']}")
        print(f"     U+FFFD={r['fffd']}  маркеры={r['markers']}  рядом={r['near']}  utf8={r['utf8_error'] or 'ok'}")
    if len(bad) > 40:
        print(f"  … ещё {len(bad) - 40}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
