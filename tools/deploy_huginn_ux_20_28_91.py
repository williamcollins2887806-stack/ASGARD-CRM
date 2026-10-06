#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Huginn dock UX: no seed ghosts, messenger→right dock, Mimir in dock (shell 20.28.91)."""
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

VER = "20.28.91"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/js/app.js",
    "public/assets/js/huginn_dock.js",
    "public/assets/js/huginn_icons.js",
    "public/assets/css/huginn_dock.css",
    "public/assets/js/phone_ui.js",
    "public/assets/css/phone.css",
]


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
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    print("shell_guard: OK")

    dock = (ROOT / "public/assets/js/huginn_dock.js").read_text(encoding="utf-8")
    if "padChatListToTen" in dock and "Анализ тендеров" in dock and "_seed: true" in dock:
        # old seed payload must be gone
        if "seedRows" in dock:
            raise SystemExit("huginn_dock still has seedRows fillers")
    if "location.hash = '#/messenger'" in dock:
        raise SystemExit("huginn_dock still navigates to #/messenger")
    app = (ROOT / "public/assets/js/app.js").read_text(encoding="utf-8")
    if "AsgardChatGroups.render" in app:
        raise SystemExit("app.js still renders left AsgardChatGroups for /messenger")
    if "openHuginnRoute" not in app:
        raise SystemExit("app.js missing openHuginnRoute")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    if f"ASGARD_SHELL_VERSION = '{VER}'" not in idx:
        raise SystemExit("index version mismatch")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 300) -> str:
        print(f"$ {cmd[:240]}")
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

    snap = f"/root/snapshots/asgard-crm-pre-huginn-ux-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js public/assets/js/app.js "
        "public/assets/js/huginn_dock.js public/assets/js/huginn_icons.js "
        "public/assets/css/huginn_dock.css public/assets/js/phone_ui.js "
        "public/assets/css/phone.css 2>/dev/null || true".format(snap=snap, remote=REMOTE)
    )
    print(f"snapshot: {snap}")

    stage = Path(tempfile.mkdtemp(prefix="huginn-ux-"))
    for rel in FILES:
        dest = stage / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes((ROOT / rel).read_bytes())
        print(f"  staged {rel}")

    tar_path = Path(tempfile.gettempdir()) / f"huginn-ux-{VER}-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(stage / rel, arcname=rel)
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/huginn-ux-{VER}-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run("systemctl restart asgard-crm")
    run("systemctl is-active asgard-crm")
    run(
        f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {REMOTE}/public/index.html | head -1"
    )
    run(
        f"grep -c openHuginnRoute {REMOTE}/public/assets/js/app.js; "
        f"grep -c seedRows {REMOTE}/public/assets/js/huginn_dock.js || true"
    )

    ssh.close()
    print("=== DEPLOY OK ===", VER)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
