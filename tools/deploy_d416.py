#!/usr/bin/env python3
"""D-416: выкатить клиентские правки веб-Тинга.

Заливаются ТОЛЬКО файлы этой задачи: ting_page.js, ting_media_profile.js,
ting.css, index.html, sw.js. Файлы параллельной сессии (app.css,
rp_calc_modal.js, rp-calc-modal.css) не трогаем.
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
VER = "20.28.556"

FILES = [
    "public/assets/js/ting_page.js",
    "public/assets/js/ting_media_profile.js",
    "public/assets/css/ting.css",
    "public/index.html",
    "public/sw.js",
]


def ssh(cmd, check=True, tries=5):
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


def verify_local():
    page = (ROOT / FILES[0]).read_text(encoding="utf-8")
    prof = (ROOT / FILES[1]).read_text(encoding="utf-8")
    css = (ROOT + "/" + FILES[2]).read_text(encoding="utf-8") if False else (ROOT / FILES[2]).read_text(encoding="utf-8")
    need = {
        "adaptiveStream screen": "pixelDensity: 'screen'" in page,
        "quality auto": "videoQualityLadder.set(key, 'auto')" in page,
        "balanced": "degradationPreference: 'balanced'" in prof,
        "нет backdrop у чата": "backdrop-filter: blur(22px)" not in css,
    }
    bad = [k for k, v in need.items() if not v]
    for k, v in need.items():
        print(("PASS " if v else "FAIL ") + k)
    if bad:
        raise SystemExit("локальная проверка не пройдена: " + ", ".join(bad))


def main():
    verify_local()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    ssh("mkdir -p /root/snapshots && tar -czf "
        f"/root/snapshots/asgard-crm-pre-d416-{stamp}.tgz -C {REMOTE} "
        + " ".join(FILES) + " 2>/dev/null || true && echo BACKUP_OK")

    for rel in FILES:
        scp = subprocess.run(
            ["scp", "-i", KEY, "-o", "BatchMode=yes",
             "-o", "StrictHostKeyChecking=accept-new",
             str(ROOT / rel), f"{HOST}:{REMOTE}/{rel}"],
            capture_output=True,
        )
        print(f"upload {rel} -> rc={scp.returncode}")
        if scp.returncode != 0:
            print(scp.stderr.decode("utf-8", "replace")[:300])
            raise SystemExit(1)

    for rel in FILES:
        want = md5_norm((ROOT / rel).read_bytes())
        got = ssh(
            f"python3 -c \"import hashlib;d=open('{REMOTE}/{rel}','rb').read();"
            f"print(hashlib.md5(d.replace(b'\\r\\n',b'\\n')).hexdigest())\""
        ).strip()
        if want != got:
            raise SystemExit(f"MD5 mismatch {rel}: {want[:12]} != {got[:12]}")
        print(f"md5 ok {Path(rel).name}")

    ssh("systemctl restart asgard-crm; sleep 6; systemctl is-active asgard-crm")
    print(f"=== D-416 DEPLOYED {VER} ===")


if __name__ == "__main__":
    main()
