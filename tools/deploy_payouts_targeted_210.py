#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Точечная выкатка фиксов выплат/дружины (20.28.210).

Почему не полный tar: в дереве есть незакоммиченные правки ДРУГОЙ сессии
(public/assets/css/huginn_dock.css, public/assets/js/huginn_dock.js) с
prod-only строками (audit: PROD_HANDEDIT=2). Полный tar затёр бы их на проде.
Поэтому заливаем ТОЛЬКО файлы этого фикса.

Файлы:
  src/routes/payouts.js        — /preview и /employee/:id/monthly отдают получателя
  src/routes/staff.js          — create_payee не гасит is_self_employed
  src/lib/payout-notify.js     — таймаут отправки (выплата не ждёт Mango)
  public/assets/js/payouts.js  — модалка: блок «через получателя», СЗ-формула
  public/assets/js/employee.js — карточка дружины: payee + СЗ сосуществуют
  public/assets/css/payouts.css— стиль блока получателя
  public/index.html, public/sw.js — бамп версии 20.28.210
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

VER = "20.28.210"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "src/routes/payouts.js",
    "src/routes/staff.js",
    "src/lib/payout-notify.js",
    "public/assets/js/payouts.js",
    "public/assets/js/employee.js",
    "public/assets/css/payouts.css",
    "public/index.html",
    "public/sw.js",
]


def main():
    print(f"═══ targeted deploy → {VER} ═══")
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)
    print("[0/3] shell_guard OK")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, key_filename=SSH_KEY, timeout=30)
    sftp = ssh.open_sftp()

    snapdir = f"/root/snapshots/asgard-payouts-{STAMP}"
    for rel in FILES:
        d = str(Path(REMOTE) / Path(rel).parent).replace("\\", "/")
        ssh.exec_command(f"mkdir -p {snapdir}/{Path(rel).parent}")[1].channel.recv_exit_status()
    ssh.exec_command(f"for f in {' '.join(FILES)}; do mkdir -p {snapdir}/$(dirname $f); cp -a {REMOTE}/$f {snapdir}/$f 2>/dev/null; done")
    print(f"[1/3] snapshot: {snapdir}")

    for rel in FILES:
        local = ROOT / rel
        assert local.is_file(), f"нет файла {local}"
        sftp.put(str(local), f"{REMOTE}/{rel}")
        print(f"      ↑ {rel} ({local.stat().st_size} B)")
    sftp.close()

    print("[2/3] restart asgard-crm")
    _in, out, _err = ssh.exec_command("systemctl restart asgard-crm && sleep 5 && systemctl is-active asgard-crm", timeout=120)
    print("      " + out.read().decode().strip())

    print("[3/3] post-checks")
    checks = [
        "curl -s -o /dev/null -w 'health:%{http_code}\\n' http://127.0.0.1:3000/api/health",
        "grep -o \"SHELL_VERSION = '[0-9.]*'\" " + REMOTE + "/public/sw.js | head -1",
        "grep -o \"ASGARD_SHELL_VERSION = '[0-9.]*'\" " + REMOTE + "/public/index.html | head -1",
        "grep -c se_payee_fio " + REMOTE + "/src/routes/payouts.js",
        "grep -c po-payee " + REMOTE + "/public/assets/js/payouts.js",
        "grep -c PAYOUT_SEND_TIMEOUT_MS " + REMOTE + "/src/lib/payout-notify.js",
        "grep -c 'is_self_employed = true' " + REMOTE + "/src/routes/staff.js",
    ]
    for c in checks:
        _i, o, _e = ssh.exec_command(c)
        print("      " + o.read().decode("utf-8", "replace").strip())
    ssh.close()
    print(f"═══ DONE {VER}. Откат: cp -a {snapdir}/* {REMOTE}/ && systemctl restart asgard-crm ═══")


if __name__ == "__main__":
    main()
