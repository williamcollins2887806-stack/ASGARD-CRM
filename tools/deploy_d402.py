#!/usr/bin/env python3
"""D-402: выкатить исправленную телеметрию + порог «низкой скорости».

Файлы ting_media_profile.js и ting_room_core.js на проде могут отличаться от
git (там исторически правят вручную), поэтому патчим ПРОД-копию точечно.
"""
import hashlib
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
REMOTE = "/var/www/asgard-crm"
HOST = "root@92.242.61.184"
KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
OLD_VER = "20.28.535"
NEW_VER = "20.28.536"

PATCH_DIR = ROOT / ".deploy" / "prodfix"
TARGETS = [
    ("ting_media_profile.js", "public/assets/js/ting_media_profile.js"),
    ("ting_room_core.js", "public/assets/js/ting_room_core.js"),
]
SHELL = [
    ("public/index.html", f"{REMOTE}/public/index.html"),
    ("public/sw.js", f"{REMOTE}/public/sw.js"),
]


def ssh(cmd, check=True, tries=4):
    last = ""
    for i in range(1, tries + 1):
        r = subprocess.run(
            ["ssh", "-i", KEY, "-o", "BatchMode=yes",
             "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=30", HOST, cmd],
            capture_output=True,
        )
        if r.returncode == 0:
            return (r.stdout or b"").decode("utf-8", "replace").strip()
        last = (r.stderr or b"").decode("utf-8", "replace").strip()
        print(f"  ssh {i}/{tries}: {last[:80]}", file=sys.stderr)
    if check:
        raise SystemExit("ssh fail: " + last[:150])
    return ""


def md5_norm(data: bytes) -> str:
    return hashlib.md5(data.replace(b"\r\n", b"\n")).hexdigest()


def bump_version():
    for rel in ("public/index.html", "public/sw.js"):
        p = ROOT / rel
        raw = p.read_bytes()
        bom = raw.startswith(b"\xef\xbb\xbf")
        text = raw.decode("utf-8-sig" if bom else "utf-8")
        if NEW_VER in text and OLD_VER not in text:
            print(f"{p.name}: уже {NEW_VER}")
            continue
        if OLD_VER not in text:
            raise SystemExit(f"{rel}: не найдена версия {OLD_VER}")
        text = text.replace(OLD_VER, NEW_VER)
        p.write_bytes((b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8"))
        print(f"bumped {p.name}: {OLD_VER} -> {NEW_VER}")


def main():
    # 1. Скачать прод-копии (в них могут быть ручные правки, которых нет в git).
    for name, _ in TARGETS:
        dst = PATCH_DIR / name
        scp = subprocess.run(
            ["scp", "-i", KEY, "-o", "BatchMode=yes",
             f"{HOST}:{REMOTE}/public/assets/js/{name}", str(dst)],
            capture_output=True,
        )
        if scp.returncode != 0:
            print(scp.stderr.decode("utf-8", "replace")[:300])
            raise SystemExit(f"не скачал {name}")
        print(f"downloaded {name}: {dst.stat().st_size} bytes")

    # 2. Патчи в прод-копии. ting_media_profile.js уже пропатчен и проверен
    #    отдельно (tools/_verify_prod_metrics.py); здесь только второй файл.
    patcher = subprocess.run([sys.executable, str(ROOT / "tools" / "_patch_402_rest.py")],
                             cwd=str(ROOT), capture_output=True, text=True)
    print((patcher.stdout or "").rstrip())
    if patcher.returncode != 0:
        print((patcher.stderr or "").rstrip())
        raise SystemExit("патч не применился")

    # 3. Бамп версии и выкладка.
    bump_version()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    ssh("mkdir -p /root/snapshots && tar -czf "
        f"/root/snapshots/asgard-crm-pre-d402-{stamp}.tgz -C {REMOTE} "
        "public/assets/js/ting_media_profile.js public/assets/js/ting_room_core.js "
        "public/index.html public/sw.js 2>/dev/null || true && echo BACKUP_OK")

    uploads = [(PATCH_DIR / n, f"{REMOTE}/public/assets/js/{n}") for n, _ in TARGETS]
    uploads += [(ROOT / rel, remote) for rel, remote in SHELL]

    for local, remote in uploads:
        scp = subprocess.run(
            ["scp", "-i", KEY, "-o", "BatchMode=yes",
             "-o", "StrictHostKeyChecking=accept-new", str(local), f"{HOST}:{remote}"],
            capture_output=True,
        )
        print(f"upload {local.name} -> rc={scp.returncode}")
        if scp.returncode != 0:
            print(scp.stderr.decode("utf-8", "replace")[:200])
            raise SystemExit(1)

    # 4. Сверка по содержимому.
    for local, remote in uploads:
        want = md5_norm(local.read_bytes())
        got = ssh(f"python3 -c \"import hashlib;d=open('{remote}','rb').read();"
                  f"print(hashlib.md5(d.replace(b'\\r\\n',b'\\n')).hexdigest())\"").strip()
        if want != got:
            raise SystemExit(f"MD5 mismatch {local.name}: {want[:12]} != {got[:12]}")
        print(f"md5 ok {local.name}")

    print(f"=== D-402 DEPLOYED {NEW_VER} ===")


if __name__ == "__main__":
    main()
