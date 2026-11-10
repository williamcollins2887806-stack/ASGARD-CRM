#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting 4K + auto-quality + per-participant low-speed video hiding (20.28.499)."""
from __future__ import annotations

import hashlib
import io
import subprocess
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from shell_guard import assert_ok  # noqa: E402
import ting_live_guard  # noqa: E402

VER = "20.28.499"
REMOTE = "/var/www/asgard-crm"
HOST = "root@92.242.61.184"
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/ting/index.html",
    "public/ting-tv/index.html",
    "public/assets/js/ting_page.js",
    "public/assets/js/ting_room_core.js",
    "public/assets/css/ting.css",
]

NEEDLES = [
    ("public/sw.js", VER, "shell"),
    ("public/ting-tv/index.html", "?v=" + VER, "tv assets versioned"),
    ("public/ting-tv/index.html", "cameraPresets", "tv 4K preset ladder"),
    ("public/ting-tv/index.html", "VideoQuality.MEDIUM", "tv auto quality"),
    ("public/assets/js/ting_room_core.js", "hiddenIds", "per-participant hide"),
    ("public/assets/js/ting_page.js", "ideal: 3840", "crm 4K capture"),
    ("public/ting/index.html", "h2160", "guest 4K"),
]


def ssh(cmd: str, check: bool = True, tries: int = 6, stdin: bytes | None = None) -> str:
    last = ""
    for i in range(1, tries + 1):
        r = subprocess.run(
            ["ssh", "-i", str(KEY), "-o", "BatchMode=yes",
             "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=25", HOST, cmd],
            input=stdin, capture_output=True,
        )
        out = (r.stdout or b"").decode("utf-8", "replace").strip()
        err = (r.stderr or b"").decode("utf-8", "replace").strip()
        if r.returncode == 0:
            if out:
                print(out)
            if err:
                print(err, file=sys.stderr)
            return out
        last = err or f"exit {r.returncode}"
        print(f"  ssh {i}/{tries}: {last[:110]}", file=sys.stderr)
        time.sleep(min(45, 8 * i))
    if check:
        raise SystemExit(f"ssh fail: {cmd[:80]} :: {last}")
    return ""


def main() -> int:
    assert_ok(expect_version=VER, deploy_gate=False)

    for rel, needle, label in NEEDLES:
        t = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if needle not in t:
            raise SystemExit(f"NEEDLE FAIL {rel} :: {label}")

    print("=== ting_live_guard ===")
    live = ting_live_guard.check(ssh=True) != 0
    if live:
        print("WARN: live rooms — заливаем БЕЗ restart (все файлы статические)")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    payload = buf.getvalue()
    print(f"tar {len(payload)} bytes")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    snap = f"/root/snapshots/asgard-crm-pre-ting-4k-{stamp}"
    ssh(f"mkdir -p {snap} && cd {REMOTE} && tar -czf {snap}/pre.tgz {' '.join(FILES)}")
    print(f"SNAPSHOT {snap}")

    restart = "systemctl restart asgard-crm; sleep 2; systemctl is-active asgard-crm; " if not live else ""
    ssh(f"set -e; tar -xzf - -C {REMOTE}; {restart}echo DEPLOYED", stdin=payload)

    checks = ",".join(f"({rel!r},{n!r})" for rel, n, _l in NEEDLES)
    ssh(
        "python3 - <<'PY'\n"
        f"checks=[{checks}]\nbase={REMOTE!r}\n"
        "import sys\nbad=0\n"
        "for rel,n in checks:\n"
        "  t=open(base+'/'+rel,encoding='utf-8',errors='replace').read()\n"
        "  ok=n in t\n"
        "  print(('OK' if ok else 'FAIL'), rel, n[:44])\n"
        "  bad+=(0 if ok else 1)\n"
        "sys.exit(bad)\nPY"
    )
    print("PROOF ok")

    md5_out = ssh("md5sum " + " ".join(f"{REMOTE}/{rel}" for rel in FILES), tries=8)
    remote = {}
    for line in md5_out.splitlines():
        p = line.split()
        if len(p) >= 2:
            remote[p[1]] = p[0]
    for rel in FILES:
        h = hashlib.md5((ROOT / rel).read_bytes()).hexdigest()
        rh = remote.get(f"{REMOTE}/{rel}", "")
        print(f"MD5 {'OK' if rh == h else 'FAIL'} {rel}")
        if rh != h:
            raise SystemExit(f"MD5 mismatch {rel}")

    print(f"=== DONE ting-4k shell={VER} ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
