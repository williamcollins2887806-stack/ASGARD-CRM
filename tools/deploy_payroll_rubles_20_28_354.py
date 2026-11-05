#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: payroll баллы→рубли (V451/V452 + API/UI + /m + shell 20.28.354).

Порядок: shell_guard → snapshot → V451/V452 SQL → tar+scp → restart → health → markers → Nov probe.
Откат файлов: tar -xzf <snap> -C /var/www/asgard-crm && systemctl restart asgard-crm
Откат схемы: migrations/V452__*_down.sql затем V451__*_down.sql
"""
from __future__ import annotations

import hashlib
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko  # noqa: E402
import shell_guard  # noqa: E402

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
VER = "20.28.354"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

# Файлы (не каталоги). Каталоги public/m и public/v2 добавляются отдельно.
TAR_FILES = [
    "migrations/V451__payroll_rubles_no_points.sql",
    "migrations/V451__payroll_rubles_no_points_down.sql",
    "migrations/V452__nov_points_like_amounts_to_rub.sql",
    "migrations/V452__nov_points_like_amounts_to_rub_down.sql",
    "src/lib/field-assignment-rate.js",
    "src/lib/field-timesheet-roster.js",
    "src/routes/field-manage.js",
    "src/routes/field-worker.js",
    "src/routes/global-timesheet.js",
    "src/routes/timesheet-v2.js",
    "src/routes/worker-payments.js",
    "src/services/estimateChat.js",
    "src/services/mimir-auto-estimate.js",
    "src/services/mimir-data.js",
    "public/assets/js/money_compact.js",
    "public/assets/js/admin-timesheet-settings.js",
    "public/assets/js/app.js",
    "public/assets/js/employee.js",
    "public/assets/js/field-tab.js",
    "public/assets/js/field-tariffs.js",
    "public/assets/js/payments-report.js",
    "public/assets/js/payroll.js",
    "public/assets/js/timesheet-v2.js",
    "public/assets/js/work_report.js",
    "public/field-help.html",
    "public/field/help.html",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]

TAR_DIRS = [
    "public/m",
    "public/v2",
]

MARKERS = [
    ("src/lib/field-assignment-rate.js", "manual_extra_rub", "SSoT manual_extra_rub"),
    ("src/lib/field-assignment-rate.js", "day_rate_rub", "SSoT day_rate_rub"),
    ("src/routes/timesheet-v2.js", "rate_rub", "timesheet-v2 rate_rub"),
    ("src/routes/field-manage.js", "manual_extra_rub", "field-manage rub"),
    ("public/assets/js/money_compact.js", "fmtCompactRub", "money_compact"),
    ("public/assets/js/field-tab.js", "fmtCompactRub", "field-tab compact"),
    ("public/assets/js/timesheet-v2.js", "fmtCompactRub", "timesheet-v2 compact"),
    ("public/sw.js", f"SHELL_VERSION = '{VER}'", f"shell {VER}"),
    ("public/index.html", f"ASGARD_SHELL_VERSION = '{VER}'", f"index shell {VER}"),
    ("public/index.html", f"money_compact.js?v={VER}", "money_compact cache bust"),
    ("migrations/V451__payroll_rubles_no_points.sql", "manual_extra_rub", "V451 column"),
    ("migrations/V452__nov_points_like_amounts_to_rub.sql", "amount_earned <= 99", "V452 threshold"),
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


def md5(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def main() -> int:
    for rel in TAR_FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing file: {rel}")
    for rel in TAR_DIRS:
        if not (ROOT / rel).is_dir():
            raise SystemExit(f"missing dir: {rel}")
        idx = ROOT / rel / "index.html"
        if not idx.is_file():
            raise SystemExit(f"missing {rel}/index.html — build first")

    print("=== LOCAL MARKERS ===")
    for rel, needle, label in MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if needle not in text:
            raise SystemExit(f"локально нет маркера: {label}")
        print(f"  OK {label}")

    print("=== SHELL GUARD ===")
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for attempt in range(1, 6):
        try:
            ssh.connect(
                SSH_HOST,
                username=SSH_USER,
                pkey=key,
                timeout=45,
                banner_timeout=70,
                auth_timeout=70,
            )
            print(f"ssh: connected (attempt {attempt})")
            break
        except Exception as e:
            print(f"ssh: attempt {attempt} failed: {e}")
            if attempt == 5:
                raise SystemExit("ssh: cannot connect")
            time.sleep(4)

    def run(cmd, check=True, timeout=600):
        print(f"$ {cmd[:240]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:8000])
        if err.strip():
            print(err.rstrip()[:2000], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd[:140]}")
        return out

    sftp = ssh.open_sftp()

    print("=== 1. SNAPSHOT ===")
    snap = f"/root/snapshots/asgard-payroll-rubles-{STAMP}.tgz"
    run("mkdir -p /root/snapshots")
    snap_list = " ".join(TAR_FILES + TAR_DIRS)
    run(f"tar -czf {snap} -C {REMOTE} {snap_list} 2>/dev/null || true", check=False)
    run(f"ls -lh {snap}", check=False)
    print(f"snapshot: {snap}")

    print("=== 2. APPLY V451 + V452 ===")
    for mig in (
        "migrations/V451__payroll_rubles_no_points.sql",
        "migrations/V452__nov_points_like_amounts_to_rub.sql",
    ):
        remote_sql = f"/tmp/{Path(mig).name}"
        sftp.put(str(ROOT / mig), remote_sql)
        out = run(
            f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {remote_sql}; "
            f"echo __SQL_EXIT__:$?; rm -f {remote_sql}",
            check=False,
            timeout=900,
        )
        if "__SQL_EXIT__:0" not in out.replace("\r", ""):
            raise SystemExit(f"migration failed: {mig}")

    chk = run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -Atc "
        "\"SELECT count(*) FROM information_schema.columns WHERE table_name='employee_assignments' "
        "AND column_name IN ('manual_extra_rub','day_rate_rub');\"",
    )
    cols = (chk or "").strip().splitlines()[-1] if chk else "0"
    if cols != "2":
        raise SystemExit(f"V451 columns expected 2, got {cols}")
    print(f"  V451 columns: {cols}/2 OK")

    print("=== 3. tar + scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-payroll-rubles-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_FILES:
            tar.add(str(ROOT / rel), arcname=rel.replace("\\", "/"))
        for rel in TAR_DIRS:
            tar.add(str(ROOT / rel), arcname=rel.replace("\\", "/"))
    remote_tar = f"/tmp/asgard-payroll-rubles-{STAMP}.tar.gz"
    print(f"local tar: {tar_path} ({tar_path.stat().st_size // 1024} KB)")
    sftp.put(str(tar_path), remote_tar)
    run(f"ls -lh {remote_tar}")
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}", timeout=900)
    run(
        f"find {REMOTE}/public/m {REMOTE}/public/v2 -type f -exec chmod 644 {{}} \\; ; "
        f"find {REMOTE}/public/m {REMOTE}/public/v2 -type d -exec chmod 755 {{}} \\;",
        check=False,
    )

    print("=== 4. MD5 verify (files only) ===")
    for rel in TAR_FILES:
        local_md5 = md5((ROOT / rel).read_bytes())
        with sftp.file(f"{REMOTE}/{rel}", "rb") as rf:
            remote_md5 = md5(rf.read())
        ok = local_md5 == remote_md5
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  {local_md5[:10]}")
        if not ok:
            raise SystemExit(f"md5 mismatch: {rel}")

    print("=== 5. RESTART + HEALTH ===")
    run("systemctl restart asgard-crm")
    healthy = False
    for i in range(1, 16):
        time.sleep(2)
        out = run(
            "systemctl is-active asgard-crm; "
            "curl -sS -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:3000/api/health || true",
            check=False,
        )
        if "active" in out and "http=200" in out:
            healthy = True
            print(f"health OK on try {i}")
            break
    if not healthy:
        raise SystemExit("service not healthy after restart")

    print("=== 6. REMOTE MARKERS ===")
    for rel, needle, label in MARKERS:
        if rel.startswith("migrations/"):
            # миграции уже применены; файл мог остаться только локально в tar
            pass
        esc = needle.replace("\\", "\\\\").replace("'", "'\\''")
        out = run(f"grep -F -c -- '{esc}' {REMOTE}/{rel} || true", check=False)
        cnt = (out or "").strip().splitlines()[-1] if out else "0"
        print(f"  marker {label}: count={cnt}")
        if cnt == "0":
            raise SystemExit(f"remote marker missing: {label}")

    print("=== 7. NOV CHECKINS PROBE ===")
    probe = r"""
SELECT
  count(*) AS nov_rows,
  count(*) FILTER (WHERE amount_earned IS NOT NULL AND amount_earned > 0 AND amount_earned <= 99) AS still_points_like,
  count(*) FILTER (WHERE amount_earned IS NOT NULL AND amount_earned > 99) AS rub_like,
  round(coalesce(min(amount_earned) FILTER (WHERE amount_earned > 0), 0)::numeric, 2) AS min_amt,
  round(coalesce(max(amount_earned), 0)::numeric, 2) AS max_amt,
  round(coalesce(avg(amount_earned) FILTER (WHERE amount_earned > 0), 0)::numeric, 2) AS avg_amt
FROM field_checkins
WHERE date >= '2026-11-01'
  AND coalesce(status, 'completed') <> 'cancelled';

SELECT
  count(*) AS points_like_day_rate
FROM field_checkins
WHERE date >= '2026-11-01'
  AND coalesce(status, 'completed') <> 'cancelled'
  AND day_rate IS NOT NULL AND day_rate > 0 AND day_rate <= 99;

SELECT date, employee_id, amount_earned, day_rate, status
FROM field_checkins
WHERE date >= '2026-11-01'
  AND coalesce(status, 'completed') <> 'cancelled'
ORDER BY date DESC, id DESC
LIMIT 12;
"""
    remote_probe = f"/tmp/probe-nov-payroll-{STAMP}.sql"
    with sftp.file(remote_probe, "w") as f:
        f.write(probe)
    out = run(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {remote_probe}; "
        f"echo __PROBE_EXIT__:$?; rm -f {remote_probe}",
        check=False,
    )
    if "__PROBE_EXIT__:0" not in out.replace("\r", ""):
        raise SystemExit("nov probe failed")

    # жёсткий гейт: после V452 не должно остаться amount≤99
    still = run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -Atc "
        "\"SELECT count(*) FROM field_checkins WHERE date >= '2026-11-01' "
        "AND coalesce(status,'completed') <> 'cancelled' "
        "AND amount_earned IS NOT NULL AND amount_earned > 0 AND amount_earned <= 99;\"",
    )
    still_n = (still or "").strip().splitlines()[-1] if still else "?"
    print(f"  still_points_like amount<=99: {still_n}")
    if still_n != "0":
        raise SystemExit(f"Nov still has points-like amounts: {still_n}")

    sftp.close()
    ssh.close()
    print(f"\nDONE deploy payroll rubles {VER}")
    print(f"snapshot: {snap}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
