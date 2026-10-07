#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Huginn presence-strip fix (shell 20.28.111) — dock only."""
from __future__ import annotations

import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import shell_guard  # noqa: E402
import paramiko

VER = "20.28.111"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/js/huginn_dock.js",
    "public/assets/css/huginn_dock.css",
    "src/routes/huginn_ext.js",
]

NEEDLES_CSS = ["is-last", "--hg-msg-indent: 40px"]
NEEDLES_JS = ["hgPresenceWrap", "data-mnav=\"ting\"", "is-last", "hgInviteResult"]


def load_pkey(path: str):
    for loader in (
        getattr(paramiko, "Ed25519Key", None),
        getattr(paramiko, "ECDSAKey", None),
        paramiko.RSAKey,
    ):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard (shell only) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    print("shell_guard: OK")

    css = (ROOT / "public/assets/css/huginn_dock.css").read_text(encoding="utf-8")
    if "clip-path: url(#hg-tail" in css:
        raise SystemExit("css still uses SVG tail clip-path")
    for n in NEEDLES_CSS:
        if n not in css:
            raise SystemExit(f"css missing: {n}")
    js = (ROOT / "public/assets/js/huginn_dock.js").read_text(encoding="utf-8")
    for n in NEEDLES_JS:
        if n not in js:
            raise SystemExit(f"dock js missing: {n}")
    if (js.count("renderPresenceStrip()") < 4):
        raise SystemExit("renderPresenceStrip not wired into renderPanel/poll")
    ext = (ROOT / "src/routes/huginn_ext.js").read_text(encoding="utf-8")
    for n in ("channel === 'email'", "sendCrmEmail", "MANGO_SMS_FROM"):
        if n not in ext:
            raise SystemExit(f"huginn_ext missing: {n}")
    # NOTE: huginn_ext.js is included so the invite-delivery endpoint stays in sync;
    # it is idempotent to re-ship.

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 300) -> str:
        print(f"$ {cmd[:200]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip())
        if err.strip():
            print(err.rstrip(), file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd}")
        return out

    snap = f"/root/snapshots/asgard-crm-pre-huginn-bubbles-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js public/assets/js/huginn_dock.js "
        "public/assets/css/huginn_dock.css src/routes/huginn_ext.js 2>/dev/null || true".format(
            snap=snap, remote=REMOTE
        )
    )
    print(f"snapshot: {snap}")

    stage = Path(tempfile.mkdtemp(prefix="huginn-bub-"))
    for rel in FILES:
        dest = stage / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes((ROOT / rel).read_bytes())

    tar_path = Path(tempfile.gettempdir()) / f"huginn-bub-{VER}-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(stage / rel, arcname=rel)

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/huginn-bub-{VER}-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run("systemctl restart asgard-crm")
    run("systemctl is-active asgard-crm")
    run(f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {REMOTE}/public/index.html | head -1")
    run(
        f"grep -c 'is-last' {REMOTE}/public/assets/css/huginn_dock.css; "
        f"grep -c 'clip-path: url(#hg-tail' {REMOTE}/public/assets/css/huginn_dock.css || true; "
        f"grep -c 'hgPresenceWrap' {REMOTE}/public/assets/js/huginn_dock.js; "
        f"grep -c 'channel === ' {REMOTE}/src/routes/huginn_ext.js"
    )

    ssh.close()
    print("=== DEPLOY OK ===", VER)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
