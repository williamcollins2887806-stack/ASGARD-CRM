#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Выкатка 4 бэкенд-файлов для выравнивания git == прод (shell 20.28.118).

Проверки перед заливкой:
  0. shell_guard --expect-version --deploy-gate
  1. снапшот прод-версий 4 файлов
  2. локальные файлы существуют и синтаксически валидны (проверяется вызывающим)
  3. tar + scp + extract
  4. systemctl restart asgard-crm + is-active
  5. md5sum сверка залитого
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

VER = "20.28.118"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "src/index.js",
    "src/lib/upload-ext.js",
    "src/services/call-pipeline.js",
    "src/services/chat-voice-stt.js",
    "src/services/huginn-ai-editor.js",
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

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 600) -> str:
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

    # 1. Снапшот прод-версий 4 файлов
    snap = f"/root/snapshots/asgard-crm-pre-backend-sync-{STAMP}.tgz"
    file_args = " ".join(FILES)
    run(f"mkdir -p /root/snapshots && cd {REMOTE} && tar -czf {snap} {file_args} 2>/dev/null || true")
    print(f"snapshot: {snap}")

    # 2. Сверка: что сейчас на проде
    print("=== ПРОД ДО ===")
    run(f"cd {REMOTE} && md5sum {' '.join(FILES)}")

    # 3. tar + scp
    stage = Path(tempfile.mkdtemp(prefix="be-sync-"))
    for rel in FILES:
        dest = stage / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes((ROOT / rel).read_bytes())

    tar_path = Path(tempfile.gettempdir()) / f"be-sync-{VER}-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(stage / rel, arcname=rel)

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/be-sync-{VER}-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    # 4. extract + restart
    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run("systemctl restart asgard-crm")
    run("sleep 4 && systemctl is-active asgard-crm")

    # 5. Проверка
    print("=== ПРОД ПОСЛЕ ===")
    run(f"cd {REMOTE} && md5sum {' '.join(FILES)}")

    ssh.close()
    print("=== BACKEND DEPLOY OK ===", VER)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
