#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: страница выплат (#/payouts) + мобильный баннер + city/V389.

Порядок (source of truth = рабочее дерево):
  0. shell_guard (оболочка + deploy-gate — HEAD == .last-verified)
  1. snapshot прода /root/snapshots/
  2. миграции V385–V389 на проде (идемпотентно, psql -f через stdin)
  3. tar+scp кода: src/, migrations/, public/assets, public/m, public/v2, public/index.html, public/sw.js
  4. systemctl restart asgard-crm
  5. post-checks: health, новые колонки, страница выполняется, /m отдаёт баннер

Запуск: python tools/deploy_payouts_20_28_210.py
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

VER = "20.28.203"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

MIGRATIONS = [
    "migrations/V385__payouts_worker_payments_fields.sql",
    "migrations/V385__payouts_worker_payments_fields_down.sql",
    "migrations/V386__payout_confirmation_codes.sql",
    "migrations/V386__payout_confirmation_codes_down.sql",
    "migrations/V387__payouts_settings_grant.sql",
    "migrations/V387__payouts_settings_grant_down.sql",
    "migrations/V388__payout_code_channel_none.sql",
    "migrations/V388__payout_code_channel_none_down.sql",
    "migrations/V389__employee_city_split.sql",
    "migrations/V389__employee_city_split_down.sql",
]
# Только up-миграции применяем на проде
MIGRATIONS_UP = [m for m in MIGRATIONS if not m.endswith("_down.sql")]

# Код-каталоги/файлы (tar)
TAR_PATHS = [
    "src",
    "migrations",
    "public/assets/js",
    "public/assets/css",
    "public/m",
    "public/v2",
    "public/index.html",
    "public/sw.js",
]


def load_pkey(path: str):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
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

    for rel in TAR_PATHS + MIGRATIONS_UP:
        if not (ROOT / rel).exists():
            raise SystemExit(f"missing: {rel}")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd, check=True, timeout=600, stdin_data=None):
        print(f"$ {cmd[:180]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        if stdin_data is not None:
            _i.write(stdin_data)
            _i.channel.shutdown_write()
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:4000])
        if err.strip():
            print(err.rstrip()[:2000], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd[:120]}")
        return out

    # ── 1. snapshot ──
    print("=== 1. SNAPSHOT ===")
    snap = f"/root/snapshots/asgard-payouts-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} src migrations public/index.html public/sw.js public/m public/v2 2>/dev/null || true")
    print(f"snapshot: {snap}")

    # ── 2. миграции на проде ──
    print("=== 2. МИГРАЦИИ (V385–V389) ===")
    for rel in MIGRATIONS_UP:
        sql = (ROOT / rel).read_text(encoding="utf-8")
        print(f"-- apply {Path(rel).name}")
        run(f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f -",
            stdin_data=sql.encode("utf-8"), check=True)

    # ── 3. tar + scp кода ──
    print("=== 3. CODE tar+scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-payouts-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_PATHS:
            p = ROOT / rel
            tar.add(str(p), arcname=rel)
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-payouts-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run(f"find {REMOTE}/public/m -type f -exec chmod 644 {{}} \\; ; find {REMOTE}/public/m -type d -exec chmod 755 {{}} \\;")

    # ── 4. рестарт ──
    print("=== 4. RESTART ===")
    run("systemctl restart asgard-crm")
    run("sleep 4; systemctl is-active asgard-crm")

    # ── 5. post-checks ──
    print("=== 5. POST-CHECKS ===")
    run("for i in 1 2 3 4 5 6 7 8; do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
        "echo \"health try $i: $code\"; [ \"$code\" = \"200\" ] && break; sleep 3; done")
    # колонки на проде
    run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        "\"SELECT 'wp_new_cols='||count(*) FROM information_schema.columns WHERE table_name='worker_payments' AND column_name IN ('payout_platform','confirmation_status','payout_batch_id');\"")
    run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        "\"SELECT 'codes_table='||count(*) FROM information_schema.tables WHERE table_name='payout_confirmation_codes';\"")
    run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        "\"SELECT 'city_cols='||count(*) FROM information_schema.columns WHERE table_name='employees' AND column_name IN ('city_legacy','city_source','city_updated_at');\"")
    run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc \"SELECT 'grant='||value_json FROM settings WHERE key='payout_manager_user_ids';\"")
    # страница/бандлы отдаются
    run("curl -s -o /dev/null -w 'root:%{http_code} ' http://127.0.0.1:3000/ ; "
        "curl -s -o /dev/null -w 'm:%{http_code} ' http://127.0.0.1:3000/m/index.html ; "
        "curl -s -o /dev/null -w 'v2:%{http_code}\\n' http://127.0.0.1:3000/v2/index.html")
    run(f"grep -o 'index-[A-Za-z0-9_-]*\\.js' {REMOTE}/public/m/index.html | head -1")
    run(f"grep -rl 'произведена выплата' {REMOTE}/public/m/assets/ | head -2 || echo 'BANNER MISSING'")
    run(f"grep -c 'payouts.js' {REMOTE}/public/index.html")

    print(f"\n=== DONE. Rollback: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
