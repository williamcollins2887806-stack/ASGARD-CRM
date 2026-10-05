#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy rail badge color fix (shell 20.28.81). Explicit file list only.

  python tools/deploy_rail_badges_20_28_81.py
"""
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

VER = "20.28.81"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/css/huginn_dock.css",
    "public/assets/js/huginn_dock.js",
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
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    css = (ROOT / "public/assets/css/huginn_dock.css").read_text(encoding="utf-8")
    if "hg-tg-badge" not in css or 'background: var(--hg-accent)' in css.split(".hg-rail-badge")[1][:400]:
        # soft check: red badge present
        if "hg-tg-badge, var(--hg-danger" not in css:
            raise SystemExit("badge CSS missing red --hg-tg-badge")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    if f"ASGARD_SHELL_VERSION = '{VER}'" not in idx:
        raise SystemExit("index shell version mismatch")
    js = (ROOT / "public/assets/js/huginn_dock.js").read_text(encoding="utf-8")
    if 'data-rail-badge="ting"' not in js:
        raise SystemExit("ting rail badge slot missing")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True) -> str:
        print(f"$ {cmd}")
        _i, o, e = ssh.exec_command(cmd, timeout=300)
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

    snap = f"/root/snapshots/asgard-crm-pre-deploy-rail-badges-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js "
        "public/assets/css/huginn_dock.css public/assets/js/huginn_dock.js".format(
            snap=snap, remote=REMOTE
        )
    )
    print(f"snapshot: {snap}")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-rail-badges-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    # static only — no restart required, but harmless
    run(
        f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {REMOTE}/public/index.html | head -1; "
        f"grep -o \"SHELL_VERSION = '[^']*'\" {REMOTE}/public/sw.js | head -1; "
        f"grep -c 'hg-tg-badge' {REMOTE}/public/assets/css/huginn_dock.css; "
        f"grep -c 'data-rail-badge=\\\"ting\\\"' {REMOTE}/public/assets/js/huginn_dock.js; "
        f"grep -c 'ting-gold' {REMOTE}/public/assets/css/huginn_dock.css || true"
    )
    # ensure rail badge block is red not gold
    run(
        f"python3 - <<'PY'\n"
        f"import pathlib\n"
        f"p=pathlib.Path('{REMOTE}/public/assets/css/huginn_dock.css')\n"
        f"t=p.read_text(encoding='utf-8')\n"
        f"i=t.find('.hg-rail-badge {{')\n"
        f"chunk=t[i:i+350]\n"
        f"assert 'hg-tg-badge' in chunk or 'hg-danger' in chunk, chunk[:200]\n"
        f"assert 'hg-accent' not in chunk.split('}}')[0], chunk[:200]\n"
        f"print('badge_css:RED_OK')\n"
        f"PY"
    )
    ssh.close()
    print(f"=== DONE rail badges {VER} ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
