#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Huginn visual wave (shell 20.28.80) from FEATURE_COMMIT blobs + V366.

  python tools/deploy_huginn_visual_20_28_80.py
"""
from __future__ import annotations

import subprocess
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

VER = "20.28.80"
FEATURE_COMMIT = "4879b84c44bdb137e0ce9fb75b927c6eae1f9213"
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
    "src/routes/chat_groups.js",
    "src/routes/huginn_ext.js",
    "src/services/huginn-ai-editor.js",
    "src/services/huginn-folders.js",
    "migrations/V366__huginn_folders_ai.sql",
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


def git_show(commit: str, rel: str) -> bytes:
    return subprocess.run(
        ["git", "-C", str(ROOT), "show", f"{commit}:{rel}"],
        check=True,
        capture_output=True,
    ).stdout


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print(f"shell_guard: OK; feature={FEATURE_COMMIT[:12]} shell={VER}")

    stage = Path(tempfile.mkdtemp(prefix="huginn-vw-"))
    for rel in FILES:
        dest = stage / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(git_show(FEATURE_COMMIT, rel))
        print(f"  staged {rel}")

    tar_path = Path(tempfile.gettempdir()) / f"huginn-visual-{VER}-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(stage / rel, arcname=rel)
    print(f"tar: {tar_path} ({tar_path.stat().st_size} bytes)")

    pkey = load_pkey(SSH_KEY)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(SSH_HOST, username=SSH_USER, pkey=pkey, timeout=30)
    try:
        snap = f"/root/snapshots/asgard-crm-pre-deploy-huginn-vw-{STAMP}"
        print(f"=== 1. SNAPSHOT {snap} ===")
        _, stdout, stderr = client.exec_command(
            f"mkdir -p /root/snapshots && tar -C {REMOTE} -czf {snap}.tgz "
            f"public/index.html public/sw.js public/assets/css/huginn_dock.css "
            f"public/assets/js/huginn_dock.js src/routes/chat_groups.js "
            f"src/routes/huginn_ext.js 2>/dev/null; echo SNAP_OK"
        )
        print(stdout.read().decode()[-200:])

        sftp = client.open_sftp()
        remote_tar = f"/tmp/huginn-visual-{VER}.tar.gz"
        sftp.put(str(tar_path), remote_tar)
        sftp.close()
        print(f"=== 2. UPLOADED {remote_tar} ===")

        cmds = f"""
set -e
cd {REMOTE}
tar -xzf {remote_tar}
# apply V366 if not applied
export PGPASSWORD=123456789
if ! psql -U asgard -d asgard_crm -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='huginn_chat_folders'" | grep -q 1; then
  psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f migrations/V366__huginn_folders_ai.sql
  echo MIG_V366_APPLIED
else
  echo MIG_V366_SKIP
fi
systemctl restart asgard-crm
sleep 2
systemctl is-active asgard-crm
curl -sS -o /dev/null -w 'HTTP %{{http_code}}\\n' http://127.0.0.1:3000/api/health || true
grep -o "ASGARD_SHELL_VERSION = '[^']*'" public/index.html | head -1
grep -o "SHELL_VERSION = '[^']*'" public/sw.js | head -1
test -f src/services/huginn-ai-editor.js && echo AI_EDITOR_OK
test -f src/services/huginn-folders.js && echo FOLDERS_OK
rm -f {remote_tar}
echo DEPLOY_DONE
"""
        print("=== 3. EXTRACT + MIGRATE + RESTART ===")
        _, stdout, stderr = client.exec_command(cmds, timeout=120)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        print(out)
        if err.strip():
            print("STDERR:", err[-500:])
        if "DEPLOY_DONE" not in out:
            raise SystemExit("deploy failed: no DEPLOY_DONE")
        if "active" not in out:
            raise SystemExit("service not active")
    finally:
        client.close()

    print("=== DONE huginn visual 20.28.80 ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
