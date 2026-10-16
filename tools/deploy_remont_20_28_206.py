#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Выкатка оболочки 20.28.206: скрытие страниц, снятие баннера CRM 2.0, сдвиг правых панелей.

Изменённые файлы (прод не патчим — везём из рабочего дерева):
  public/index.html      — баннер CRM 2.0 скрыт
  public/sw.js           — SHELL_VERSION 20.28.206
  public/assets/js/app.js        — шторка «Страница на ремонте» + снятие кнопки CRM 2.0
  public/assets/css/huginn_dock.css — сдвиг правых панелей под док

Шаги:
  0. shell_guard (оболочка цела + deploy-gate: HEAD == .last-verified)
  1. snapshot прод-файлов в /root/snapshots/
  2. scp файлов из рабочего дерева
  3. post-checks: версии на проде, HTTP отдаёт новый ?v=, маркеры правок
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

VER = "20.28.207"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/js/app.js",
    "public/assets/css/huginn_dock.css",
    "public/h/index.html",
    "public/h/sw.js",
]


def run(ssh, cmd, quiet=False):
    _in, out, err = ssh.exec_command(cmd, timeout=180)
    o = out.read().decode("utf-8", "replace")
    e = err.read().decode("utf-8", "replace")
    code = out.channel.recv_exit_status()
    if not quiet:
        print(f"$ {cmd}\n{o}{e}".rstrip())
    return code, o, e


def main():
    print(f"═══ deploy shell → {VER} (hidden pages + no CRM 2.0 banner + right panels) ═══")
    # 0. Гейт
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)
    print("[0/3] shell_guard OK")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, key_filename=SSH_KEY, timeout=30)
    sftp = ssh.open_sftp()

    # 1. Snapshot
    snapdir = f"/root/snapshots/asgard-remont-{STAMP}"
    run(ssh, f"mkdir -p {snapdir} && cd {REMOTE} && cp -a {' '.join(FILES)} {snapdir}/ && ls -la {snapdir} | wc -l", quiet=True)
    print(f"[1/3] snapshot: {snapdir}")

    # 2. scp из рабочего дерева
    for rel in FILES:
        local = ROOT / rel
        assert local.is_file(), f"нет файла {local}"
        sftp.put(str(local), f"{REMOTE}/{rel}")
        print(f"[2/3] uploaded {rel} ({local.stat().st_size} B)")

    sftp.close()

    # 3. Проверка на проде
    print("[3/3] post-checks")
    run(ssh, f"grep -o \"SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/sw.js | head -1")
    run(ssh, f"grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" {REMOTE}/public/index.html | head -1")
    run(ssh, f"grep -c 'MAINTENANCE_PAGES' {REMOTE}/public/assets/js/app.js")
    run(ssh, f"grep -c 'hg-dock-open :is(.cr-d.drawer' {REMOTE}/public/assets/css/huginn_dock.css")
    run(ssh, f"grep -o 'id=\"asgard-v2-banner\" hidden' {REMOTE}/public/index.html | head -1")
    run(ssh, "curl -s http://127.0.0.1:3000/ | grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" | head -1")
    run(ssh, "curl -s http://127.0.0.1:3000/assets/js/app.js | grep -c 'MAINTENANCE_PAGES'")
    ssh.close()
    print(f"═══ DONE {VER} ═══")
    print(f"Откат: cd {REMOTE} && cp -a {snapdir}/* . && systemctl restart asgard-crm")


if __name__ == "__main__":
    main()
