#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy single Ting TV page (preview mic/cam split fallback). Static → no restart."""
from __future__ import annotations

import hashlib
import io
import subprocess
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REMOTE = "/var/www/asgard-crm"
HOST = "root@92.242.61.184"
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
FILES = ["public/ting-tv/index.html"]


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
        print(f"  ssh {i}/{tries}: {last[:100]}", file=sys.stderr)
        time.sleep(min(40, 8 * i))
    if check:
        raise SystemExit(f"ssh fail: {cmd[:70]} :: {last}")
    return ""


def main() -> int:
    text = (ROOT / FILES[0]).read_text(encoding="utf-8", errors="replace")
    for needle in ("Микрофон и камера недоступны", "micIsPublishing", "VideoQuality.HIGH"):
        if needle not in text:
            raise SystemExit(f"NEEDLE FAIL: {needle}")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    payload = buf.getvalue()
    print(f"tar {len(payload)} bytes")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    snap = f"/root/snapshots/asgard-crm-pre-ting-tv-{stamp}"
    ssh(f"mkdir -p {snap} && cp -a {REMOTE}/public/ting-tv/index.html {snap}/")
    print(f"SNAPSHOT {snap}")

    ssh(f"set -e; tar -xzf - -C {REMOTE}; echo DEPLOYED", stdin=payload)

    h = hashlib.md5((ROOT / FILES[0]).read_bytes()).hexdigest()
    rh = ssh(f"md5sum {REMOTE}/{FILES[0]} | awk '{{print $1}}'").strip()
    print(f"MD5 {'OK' if rh == h else 'FAIL'} {FILES[0]}")
    if rh != h:
        raise SystemExit("MD5 mismatch")
    print("=== DONE ting-tv page ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
