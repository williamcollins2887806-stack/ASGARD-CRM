#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Точечная выкатка оболочки: public/index.html + public/sw.js (бамп 20.28.205).

Зачем: без бампа SHELL_VERSION service worker отдавал рабочим/Диме закэшированный
старый public/assets/js/payouts.js — предпросмотр баннера в модалке не показывался,
а в /m/ не приходили фикс Химцеха и баннер починки.

Шаги:
  0. shell_guard (deploy-gate: HEAD == .last-verified)
  1. snapshot прод-файлов в /root/snapshots/
  2. scp index.html + sw.js из рабочего дерева (прод не патчим)
  3. проверка: версии на проде == 20.28.205, HTTP отдаёт новый ?v=
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import shell_guard  # noqa: E402
import paramiko

VER = "20.28.205"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = ["public/index.html", "public/sw.js"]


def run(ssh, cmd, quiet=False):
    _in, out, err = ssh.exec_command(cmd, timeout=180)
    o = out.read().decode("utf-8", "replace")
    e = err.read().decode("utf-8", "replace")
    code = out.channel.recv_exit_status()
    if not quiet:
        print(f"$ {cmd}\n{o}{e}".rstrip())
    return code, o, e


def main():
    print(f"═══ deploy shell only → {VER} ═══")
    # 0. Гейт
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)
    print("[0/3] shell_guard OK")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, key_filename=SSH_KEY, timeout=30)
    sftp = ssh.open_sftp()

    # 1. Snapshot
    snapdir = f"/root/snapshots/asgard-shell-{STAMP}"
    run(ssh, f"mkdir -p {snapdir} && cp -a {REMOTE}/public/index.html {REMOTE}/public/sw.js {snapdir}/ && ls -la {snapdir}", quiet=True)
    print(f"[1/3] snapshot: {snapdir}")

    # 2. scp
    for rel in FILES:
        local = ROOT / rel
        assert local.is_file(), f"нет файла {local}"
        remote = f"{REMOTE}/{rel}"
        sftp.put(str(local), remote)
        print(f"[2/3] uploaded {rel} ({local.stat().st_size} B)")

    sftp.close()

    # 3. Проверка
    print("[3/3] post-checks")
    run(ssh, f"grep -o \"SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/sw.js | head -1")
    run(ssh, f"grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/index.html | head -1")
    run(ssh, f"grep -o 'payouts.js?v=[0-9.]*' {REMOTE}/public/index.html | head -1")
    run(ssh, "curl -s http://127.0.0.1:3000/ | grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" | head -1")
    run(ssh, "curl -s http://127.0.0.1:3000/sw.js | grep -o \"SHELL_VERSION = '[0-9.]*'\" | head -1")
    # мобильный баннер и фикс игры на месте?
    run(ssh, f"grep -c 'asgard_chemlab_fixed_v1' {REMOTE}/public/m/assets/index-*.js")
    ssh.close()
    print(f"═══ DONE {VER}. Откат: cp -a {snapdir}/* {REMOTE}/public/ ═══")


if __name__ == "__main__":
    main()
