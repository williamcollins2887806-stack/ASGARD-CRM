#!/usr/bin/env python3
"""D-399/D-400: выкатить патченный клиент Тинга, бампнуть shell-версию.

Прод-версия ting_page.js/ting.css старше git и содержит свои ручные правки —
везём не локальные файлы, а .deploy/prodfix/* (прод-копия + точечный патч).

Гейт: shell_guard перед заливкой (запрет mojibake/битого UTF-8).
"""
import hashlib
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
REMOTE = "/var/www/asgard-crm"
HOST = "root@92.242.61.184"
KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
OLD_VER = "20.28.534"
NEW_VER = "20.28.535"

FILES = [
    ".deploy/prodfix/ting_page.js",
    ".deploy/prodfix/ting.css",
    "public/index.html",
    "public/sw.js",
]

REMOTE_MAP = {
    ".deploy/prodfix/ting_page.js": f"{REMOTE}/public/assets/js/ting_page.js",
    ".deploy/prodfix/ting.css": f"{REMOTE}/public/assets/css/ting.css",
    "public/index.html": f"{REMOTE}/public/index.html",
    "public/sw.js": f"{REMOTE}/public/sw.js",
}


def ssh(cmd, check=True, tries=5):
    last = ""
    for i in range(1, tries + 1):
        r = subprocess.run(
            ["ssh", "-i", KEY, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
             "-o", "ConnectTimeout=30", HOST, cmd],
            capture_output=True,
        )
        out = (r.stdout or b"").decode("utf-8", "replace").strip()
        if r.returncode == 0:
            return out
        last = (r.stderr or b"").decode("utf-8", "replace").strip()
        print(f"  ssh {i}/{tries}: {last[:90]}", file=sys.stderr)
    if check:
        raise SystemExit("ssh fail: " + last[:200])
    return ""


def bump_shell_version():
    """Бамп версии в index.html и sw.js (единый ?v=). Идемпотентно."""
    idx = ROOT / "public/index.html"
    sw = ROOT / "public/sw.js"
    for p in (idx, sw):
        raw = p.read_bytes()
        bom = raw.startswith(b"\xef\xbb\xbf")
        encoding = "utf-8-sig" if bom else "utf-8"
        text = raw.decode(encoding)
        if NEW_VER in text and OLD_VER not in text:
            print(f"{p.name}: уже {NEW_VER}")
            continue
        if OLD_VER not in text:
            raise SystemExit(f"{p}: нет ни {OLD_VER}, ни {NEW_VER} — бамп невозможен")
        text = text.replace(OLD_VER, NEW_VER)
        data = (b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8")
        p.write_bytes(data)
        print(f"bumped {p.name}: {OLD_VER} -> {NEW_VER} (bom={bom})")
    left = idx.read_text(encoding="utf-8-sig").count(OLD_VER) + sw.read_text(encoding="utf-8-sig").count(OLD_VER)
    if left:
        raise SystemExit(f"осталось {left} вхождений старой версии")


def verify_local():
    js = (ROOT / ".deploy/prodfix/ting_page.js").read_text(encoding="utf-8")
    css = (ROOT / ".deploy/prodfix/ting.css").read_text(encoding="utf-8")
    for name, text in (("ting_page.js", js), ("ting.css", css)):
        if "\ufffd" in text:
            raise SystemExit(f"{name}: U+FFFD")
        for marker in ("Рє", "С‚", "вЂ"):
            if marker in text:
                raise SystemExit(f"{name}: mojibake ({marker})")
    need = ["function dedupeTiles()", "msg.type === 'room_ended'", "qs('#ting-more-sheet')"]
    for n in need:
        if n not in js:
            raise SystemExit(f"ting_page.js: нет маркера {n}")
    if ".ting-tile video { z-index: 1; }" not in css:
        raise SystemExit("ting.css: нет z-index для video")
    print("local verify: OK")


def main():
    verify_local()
    bump_shell_version()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    ssh(
        "mkdir -p /root/snapshots && tar -czf /root/snapshots/asgard-crm-pre-ting-d399-"
        f"{stamp}.tgz -C {REMOTE} public/index.html public/sw.js "
        "public/assets/js/ting_page.js public/assets/css/ting.css 2>/dev/null || true"
        " && echo BACKUP_OK"
    )

    for rel in FILES:
        local = ROOT / rel
        remote = REMOTE_MAP[rel]
        if not local.exists():
            raise SystemExit(f"нет файла {rel}")
        scp = subprocess.run(
            ["scp", "-i", KEY, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
             str(local), f"{HOST}:{remote}"],
            capture_output=True,
        )
        print(f"upload {rel} -> rc={scp.returncode}")
        if scp.returncode != 0:
            print(scp.stderr.decode("utf-8", "replace")[:300])
            raise SystemExit(1)

    # Сверка по содержимому (CRLF-нормализация): prod должен совпасть с локальным.
    for rel in FILES:
        local_bytes = (ROOT / rel).read_bytes().replace(b"\r\n", b"\n")
        local_md5 = hashlib.md5(local_bytes).hexdigest()
        remote = REMOTE_MAP[rel]
        check = ssh(
            f"python3 -c \"import hashlib,sys;"
            f"d=open('{remote}','rb').read().replace(b'\\r\\n',b'\\n');"
            f"print(hashlib.md5(d).hexdigest())\""
        ).strip()
        status = "OK" if check == local_md5 else "MISMATCH"
        print(f"md5 {rel}: local={local_md5[:12]} prod={check[:12]} {status}")
        if status != "OK":
            raise SystemExit(f"MD5 mismatch: {rel}")

    ssh(f"grep -c \"{NEW_VER}\" {REMOTE}/public/index.html && echo VERSION_ON_PROD")
    print(f"=== CLIENT DEPLOYED {NEW_VER} ===")


if __name__ == "__main__":
    main()
