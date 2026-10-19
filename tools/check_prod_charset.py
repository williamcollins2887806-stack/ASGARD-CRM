"""Гейт кодировки: сравнить файлы на проде с локальными (UTF-8, mojibake).

Запуск:
    python tools/check_prod_charset.py                       # ключевые файлы
    python tools/check_prod_charset.py --all                 # все из git
"""
import subprocess
import sys
import urllib.request
from pathlib import Path

PROD = "http://92.242.61.184"
# SSL на проде самоподписанный — для read-only проверки кодировки это допустимо
import ssl
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE
KEY_FILES = [
    "index.html",
    "sw.js",
    "assets/js/app.js",
    "assets/js/theme.js",
    "assets/js/auth.js",
    "assets/js/custom_dashboard.js",
    "assets/css/light-theme.css",
    "assets/css/light-glass.css",
    "assets/css/light-buttons.css",
    "assets/css/light-contrast-fix.css",
    "assets/css/design-tokens.css",
    "assets/css/app.css",
]
MOJI = ("\u2568", "\u2564", "\u2565")
BAD_SEQ = ("\u0442\u0424\u0410", "\u0440\u040e", "\u0401\u042f\u042b")


def fetch(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "charset-gate"})
    with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
        return r.read()


def analyse(raw: bytes):
    try:
        text = raw.decode("utf-8")
        err = None
    except UnicodeDecodeError as e:
        text = raw.decode("utf-8", "replace")
        err = str(e)[:60]
    fffd = text.count("\ufffd")
    moji = sum(text.count(m) for m in MOJI)
    seq = sum(text.count(s) for s in BAD_SEQ)
    return {"err": err, "fffd": fffd, "moji": moji, "seq": seq,
            "bad": bool(err or fffd or moji > 2 or seq > 0)}


def main():
    files = KEY_FILES
    if "--all" in sys.argv:
        out = subprocess.run(["git", "ls-files", "public"], capture_output=True, text=True).stdout
        files = [f[len("public/"):] for f in out.splitlines()
                 if f.startswith("public/") and f.split(".")[-1] in ("js", "css", "html", "json")]

    bad = []
    for f in files:
        local = Path("public") / f
        if not local.exists():
            print(f"  SKIP {f} (нет локально)")
            continue
        try:
            raw = fetch(f"{PROD}/{f}")
        except Exception as e:
            print(f"  ERR  {f}: {str(e)[:60]}")
            continue
        a = analyse(raw)
        lsize = local.stat().st_size
        same = len(raw) == lsize
        status = "BAD " if a["bad"] else "ok  "
        if a["bad"]:
            bad.append((f, a))
        print(f"  {status} {f:44} prod={len(raw):>7} local={lsize:>7} "
              f"{'same' if same else 'DIFF'}  moji={a['moji']:>4} seq={a['seq']:>3} fffd={a['fffd']:>2}")

    print(f"\nфайлов с дефектом кодировки на проде: {len(bad)}")
    for f, a in bad:
        print(f"   {f}: moji={a['moji']} seq={a['seq']} fffd={a['fffd']}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
