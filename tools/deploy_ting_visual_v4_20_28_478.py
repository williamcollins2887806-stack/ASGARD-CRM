#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scoped deploy: Ting visual v4 + soft mute chrome + shell 20.28.478."""
from __future__ import annotations

import hashlib
import subprocess
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from shell_guard import assert_ok  # noqa: E402
import ting_live_guard  # noqa: E402

VER = "20.28.478"
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
    ("public/sw.js", "20.28.478", "shell"),
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


def run_local(cmd: list[str]) -> None:
    print("+", " ".join(cmd))
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode != 0:
        raise SystemExit(f"local fail: {cmd}")


def main() -> int:
    import paramiko

    assert_ok(expect_version=VER, deploy_gate=True)

    wipe = ROOT / "public" / "assets" / "js" / "ting_page.js"
    text = wipe.read_text(encoding="utf-8")
    if "paintTiles(root, [])" in text and "softRoomChrome" not in text:
        raise SystemExit("ABORT: hard wipe without softRoomChrome")
    if "syncCountChip" not in text:
        raise SystemExit("ABORT: syncCountChip missing")
    if "function softRoomChrome" not in text:
        raise SystemExit("ABORT: softRoomChrome missing")

    css = (ROOT / "public/assets/css/ting.css").read_text(encoding="utf-8")
    if "aspect-ratio: 16 / 9" not in css:
        raise SystemExit("ABORT: 16:9 tiles missing in ting.css")
    if "min-width: 0" not in css:
        raise SystemExit("ABORT: min-width:0 missing (grid blowout)")

    print("=== ting_live_guard --ssh ===")
    if ting_live_guard.check(ssh=True) != 0:
        raise SystemExit("ting_live_guard BLOCK")

    if not KEY.exists():
        raise SystemExit(f"missing key {KEY}")

    missing = [f for f in FILES if not (ROOT / f).exists()]
    if missing:
        raise SystemExit(f"missing files: {missing}")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, key_filename=str(KEY), timeout=30)

    def run(cmd: str) -> tuple[int, str, str]:
        print(f"$ {cmd}")
        _i, o, e = ssh.exec_command(cmd)
        code = o.channel.recv_exit_status()
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        if out.strip():
            print(out.rstrip())
        if err.strip():
            print(err.rstrip(), file=sys.stderr)
        if code != 0:
            raise SystemExit(f"remote fail ({code}): {cmd}")
        return code, out, err

    snap = f"/root/snapshots/asgard-crm-pre-ting-v4-{STAMP}"
    run(f"mkdir -p {snap}")
    for rel in FILES:
        run(f"cp -a {REMOTE}/{rel} {snap}/ 2>/dev/null || true")
    print(f"SNAPSHOT {snap}")

    tar_path = ROOT / f".deploy/ting-v4-{STAMP}.tar.gz"
    tar_path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)

    remote_tar = f"/tmp/ting-v4-{STAMP}.tar.gz"
    sftp = ssh.open_sftp()
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run("systemctl restart asgard-crm")
    run("sleep 2; systemctl is-active asgard-crm")

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
        run(py)
        print(f"PROOF {label}")

    for rel in FILES:
        p = ROOT / rel
        h = md5(p)
        _c, out, _ = run(f"md5sum {REMOTE}/{rel} | awk '{{print $1}}'")
        if (out or "").strip() != h:
            raise SystemExit(f"MD5 mismatch {rel}")
        print(f"MD5 OK {rel}")

    print(f"=== DONE ting-visual-v4-{STAMP} shell={VER} ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
