#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scoped deploy: Ting visual v4 + soft mute chrome + shell 20.28.478.

One SSH pipe (tar | ssh tar) — no scp/paramiko. Retries on banner timeout.
"""
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

VER = "20.28.480"
STAMP = time.strftime("%Y%m%d-%H%M%S")
REMOTE = "/var/www/asgard-crm"
HOST = "92.242.61.184"
USER = "root"
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/assets/css/ting.css",
    "public/assets/css/ting-tv.css",
    "public/assets/js/ting_page.js",
    "public/assets/js/ting_session.js",
    "public/assets/js/huginn_ting.js",
    "public/ting-tv/index.html",
    "public/ting/index.html",
]

NEEDLES = [
    ("public/sw.js", "20.28.480", "shell"),
    ("public/assets/css/ting.css", "aspect-ratio: 16 / 9", "tiles-16-9"),
    ("public/assets/css/ting.css", "min-width: 0", "grid-minwidth"),
    ("public/assets/js/ting_page.js", "syncCountChip", "count-chip"),
    ("public/assets/js/ting_page.js", "softRoomChrome", "soft-chrome"),
    ("public/assets/js/ting_page.js", "hasLiveStage", "live-stage"),
]


def md5(p: Path) -> str:
    h = hashlib.md5()
    h.update(p.read_bytes())
    return h.hexdigest()


def ssh_argv() -> list[str]:
    return [
        "ssh",
        "-i", str(KEY),
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=25",
        "-o", "ServerAliveInterval=10",
        f"{USER}@{HOST}",
    ]


def run_ssh(cmd: str, check: bool = True, retries: int = 5, input_bytes: bytes | None = None) -> str:
    print(f"$ {cmd[:220]}")
    last_err = ""
    for attempt in range(1, retries + 1):
        r = subprocess.run(
            ssh_argv() + [cmd],
            input=input_bytes,
            capture_output=True,
            encoding=None if input_bytes is not None else "utf-8",
            errors="replace" if input_bytes is None else None,
        )
        if input_bytes is not None:
            out = (r.stdout or b"").decode("utf-8", "replace").rstrip()
            err = (r.stderr or b"").decode("utf-8", "replace").rstrip()
        else:
            out = (r.stdout or "").rstrip()
            err = (r.stderr or "").rstrip()
        if r.returncode == 0:
            if out:
                print(out)
            if err:
                print(err, file=sys.stderr)
            return out
        last_err = err or f"exit {r.returncode}"
        print(f"  ssh attempt {attempt}/{retries} failed: {last_err[:160]}", file=sys.stderr)
        time.sleep(10 * attempt)
    if check:
        raise SystemExit(f"remote fail after retries: {cmd} :: {last_err}")
    return ""


def build_tar_bytes() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    return buf.getvalue()


def main() -> int:
    assert_ok(expect_version=VER, deploy_gate=False)

    wipe = (ROOT / "public/assets/js/ting_page.js").read_text(encoding="utf-8")
    if "paintTiles(root, [])" in wipe and "softRoomChrome" not in wipe:
        raise SystemExit("ABORT: hard wipe without softRoomChrome")
    if "syncCountChip" not in wipe or "function softRoomChrome" not in wipe:
        raise SystemExit("ABORT: syncCountChip/softRoomChrome missing")

    css = (ROOT / "public/assets/css/ting.css").read_text(encoding="utf-8")
    if "aspect-ratio: 16 / 9" not in css or "min-width: 0" not in css:
        raise SystemExit("ABORT: ting.css missing 16:9 / min-width:0")

    print("=== ting_live_guard --ssh ===")
    if ting_live_guard.check(ssh=True) != 0:
        raise SystemExit("ting_live_guard BLOCK")

    if not KEY.exists():
        raise SystemExit(f"missing key {KEY}")
    missing = [f for f in FILES if not (ROOT / f).exists()]
    if missing:
        raise SystemExit(f"missing files: {missing}")

    snap = f"/root/snapshots/asgard-crm-pre-ting-v4-{STAMP}"
    # один ssh: snapshot всех файлов
    snap_cmds = [f"mkdir -p {snap}"] + [
        f"cp -a {REMOTE}/{rel} {snap}/ 2>/dev/null || true" for rel in FILES
    ]
    run_ssh(" && ".join(snap_cmds))
    print(f"SNAPSHOT {snap}")

    payload = build_tar_bytes()
    print(f"TAR {len(payload)} bytes → stdin pipe")
    run_ssh(f"tar -xzf - -C {REMOTE}", input_bytes=payload, retries=6)

    run_ssh(
        "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm"
    )

    for rel, needle, label in NEEDLES:
        remote = f"{REMOTE}/{rel}"
        py = (
            "python3 - <<'PY'\n"
            f"p={remote!r}\n"
            f"n={needle!r}\n"
            "t=open(p,encoding='utf-8',errors='replace').read()\n"
            "print('OK' if n in t else 'FAIL', n[:48])\n"
            "raise SystemExit(0 if n in t else 1)\n"
            "PY"
        )
        run_ssh(py)
        print(f"PROOF {label}")

    for rel in FILES:
        h = md5(ROOT / rel)
        out = run_ssh(f"md5sum {REMOTE}/{rel} | awk '{{print $1}}'")
        if (out or "").strip() != h:
            raise SystemExit(f"MD5 mismatch {rel}: local={h} remote={(out or '').strip()}")
        print(f"MD5 OK {rel}")

    print(f"=== DONE ting-visual-v4-{STAMP} shell={VER} ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
