#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy ASGARD-CRM на прод 18-19.10.2026 (shell 20.28.225).

Модель: локальный репозиторий = source of truth -> tar + scp -> распаковка.
Git на проде "грязный" (это норма), НЕ трогаем.

Порядок (важен):
  0. БЭКАП БД + КОДА (свежий, этим заходом) + pre-flight гейты
  1. snapshot текущего состояния прода
  2. КОД: tar (src/, public/m, public/assets, public/index.html, public/sw.js, tools/, migrations/)
  3. МИГРАЦИИ: точечно 17 (tools/migrate_targeted.js) на asgard_crm
  4. systemctl restart asgard-crm
  5. POST-CHECKS

Запуск: python tools/deploy_2026_10_18.py            # dry-run (только печатает план)
        python tools/deploy_2026_10_18.py --apply    # выполнить
"""
from __future__ import annotations

import io
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import shell_guard  # noqa: E402

VER = "20.28.226"
HOST = "92.242.61.184"
USER = "root"
KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
DRY = "--apply" not in sys.argv

# Что везём. public/m — свежая сборка мобильного; public/v2 не трогаем (не пересобирали).
TAR_PATHS = [
    "src",
    "migrations",
    "tools/migrate_targeted.js",
    "public/assets",
    "public/m",
    "public/index.html",
    "public/sw.js",
    "public/h",
]


def ssh(cmd: str, timeout: int = 900) -> tuple[int, str]:
    p = subprocess.run(
        ["ssh", "-i", KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=45",
         "-o", "ServerAliveInterval=20", f"{USER}@{HOST}", cmd],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
    )
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def scp(local: str, remote: str) -> int:
    p = subprocess.run(
        ["scp", "-i", KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=45",
         "-o", "ServerAliveInterval=20", local, f"{USER}@{HOST}:{remote}"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1200,
    )
    if p.returncode != 0:
        print(p.stderr)
    return p.returncode


def step(n: str, title: str) -> None:
    print(f"\n{'─' * 70}\n{n}. {title}\n{'─' * 70}")


def main() -> int:
    print("=" * 70)
    print(f"ДЕПЛОЙ ASGARD-CRM   shell {VER}   {'DRY-RUN' if DRY else 'ПРИМЕНЕНИЕ'}")
    print(f"время: {STAMP}")
    print("=" * 70)

    # ── 0a. pre-flight гейты ──
    step("0a", "PRE-FLIGHT: shell_guard")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER)

    step("0b", "PRE-FLIGHT: verify_index_tags")
    r = subprocess.run(["node", str(ROOT / "tools" / "verify_index_tags.js")],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = (r.stdout or "").strip().split("\n")[-1]
    print("  " + tail)
    if r.returncode != 0:
        print("❌ verify_index_tags красный — стоп")
        return 1

    step("0c", "PRE-FLIGHT: audit_silent_reverts (прод-уникальные правки)")
    r = subprocess.run(["node", str(ROOT / "tools" / "audit_silent_reverts.js")],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
    out = (r.stdout or "")
    tail = "\n".join(out.strip().split("\n")[-3:])
    print("  " + tail.replace("\n", "\n  "))
    if "PROD_HANDEDIT=0" not in out and "ИТОГ: OK" not in out:
        print("⚠️  аудит не подтвердил PROD_HANDEDIT=0 — проверь отчёт перед выкаткой")

    # ── 0d. бэкап ──
    step("0d", "БЭКАП БД + КОДА (свежий)")
    bdir = f"/root/backups/deploy-{STAMP}"
    bck = f"""set -e
mkdir -p {bdir}
sudo -u postgres pg_dump -d asgard_crm -Fc --no-owner --no-privileges > {bdir}/asgard_crm.dump
sudo -u postgres pg_dump -d asgard_crm --no-owner --no-privileges | gzip -c > {bdir}/asgard_crm.sql.gz
cd /var/www && tar czf {bdir}/app-code.tar.gz --exclude=asgard-crm/node_modules --exclude=asgard-crm/uploads --exclude=asgard-crm/.git --exclude=asgard-crm/tmp asgard-crm
sudo -u postgres psql -d asgard_crm -tAc "SELECT name FROM migrations ORDER BY name" > {bdir}/migrations.applied.txt
sudo -u postgres psql -d asgard_crm -tAc "SELECT 'tables='||COUNT(*) FROM pg_tables WHERE schemaname='public'" > {bdir}/counters.txt
cd {bdir} && md5sum ./* > MANIFEST.md5
du -sh {bdir}
ls -la {bdir}
"""
    if DRY:
        print("  (dry-run) команда бэкапа:\n" + "\n".join("    " + l for l in bck.splitlines()))
    else:
        rc, out = ssh(bck)
        print(out)
        if rc != 0:
            print("❌ бэкап не удался — СТОП")
            return 1
        rc, out = ssh(f"cd {bdir} && md5sum -c MANIFEST.md5 2>&1 | grep -c OK")
        print(f"  контрольных сумм OK: {out.strip()}")

    # ── 1. snapshot ──
    step("1", "SNAPSHOT состояния прода")
    if DRY:
        print("  (dry-run)")
    else:
        rc, out = ssh(f"mkdir -p /root/snapshots && cd {REMOTE} && tar czf /root/snapshots/pre-deploy-{STAMP}.tar.gz "
                      f"src public/index.html public/sw.js 2>/dev/null; ls -la /root/snapshots/pre-deploy-{STAMP}.tar.gz")
        print(out)

    # ── 2. код: tar ──
    step("2", "КОД: сборка tar и передача")
    tmp = Path(tempfile.gettempdir()) / f"asgard-deploy-{STAMP}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tf:
        for rel in TAR_PATHS:
            p = ROOT / rel
            if not p.exists():
                print(f"  ⚠️  нет пути: {rel}")
                continue
            tf.add(str(p), arcname=rel)
    size_mb = tmp.stat().st_size / 1024 / 1024
    print(f"  tar: {tmp}  ({size_mb:.1f} МБ)")
    if DRY:
        print("  (dry-run) далее: scp tar -> распаковка в " + REMOTE)
    else:
        for attempt in range(1, 6):
            if scp(str(tmp), f"/tmp/{tmp.name}") == 0:
                break
            print(f"  scp попытка {attempt} не прошла, повтор…")
        else:
            print("❌ не удалось передать tar — СТОП")
            return 1
        rc, out = ssh(f"cd {REMOTE} && cp public/index.html /tmp/index.html.pre-{STAMP} && "
                      f"tar xzf /tmp/{tmp.name} -C {REMOTE} && echo 'распаковано' && "
                      f"chmod 644 public/index.html public/sw.js public/m/index.html && "
                      f"rm -f /tmp/{tmp.name}")
        print(out)
        if rc != 0 or "распаковано" not in out:
            print("❌ распаковка не удалась — СТОП")
            return 1

    # ── 3. миграции ──
    step("3", "МИГРАЦИИ: 17 точечно (tools/migrate_targeted.js)")
    mig = (f"cd {REMOTE} && MIGRATIONS_DIR={REMOTE}/migrations DB_NAME=asgard_crm DB_USER=asgard "
           f"DB_PASSWORD=123456789 DB_HOST=localhost node tools/migrate_targeted.js --apply")
    if DRY:
        print("  (dry-run) сначала план:")
        rc, out = ssh(f"cd {REMOTE} && MIGRATIONS_DIR={REMOTE}/migrations node tools/migrate_targeted.js 2>&1 | tail -25")
        print(out)
    else:
        rc, out = ssh(mig + " 2>&1 | tail -30")
        print(out)
        if rc != 0:
            print("❌ миграции упали — СТОП (код уже выкачен, БД откатится вручную из бэкапа)")
            return 1

    # ── 4. рестарт ──
    step("4", "РЕСТАРТ сервиса")
    if DRY:
        print("  (dry-run) systemctl restart asgard-crm")
    else:
        rc, out = ssh("systemctl restart asgard-crm && sleep 6 && systemctl is-active asgard-crm")
        print(out)
        if "active" not in out:
            print("❌ сервис не поднялся — смотри journalctl")
            return 1

    # ── 5. post-checks ──
    step("5", "POST-CHECKS")
    checks = f"""cd {REMOTE}
echo '--- версия оболочки ---'
grep -o "ASGARD_SHELL_VERSION = '[0-9.]*'" public/index.html | head -1
grep -o "const SHELL_VERSION = '[0-9.]*'" public/sw.js | head -1
echo '--- применено миграций ---'
sudo -u postgres psql -d asgard_crm -tAc "SELECT COUNT(*) FROM migrations"
echo '--- объекты выплат ---'
sudo -u postgres psql -d asgard_crm -tAc "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('payout_batches','payout_batch_items','payout_plans','payout_plan_items')"
echo '--- сварщик max ---'
sudo -u postgres psql -d asgard_crm -tAc "SELECT MAX(points) FROM field_tariff_grid WHERE category='mlsp' AND position_name LIKE 'Сварщик%'"
echo '--- файлы выплат на месте ---'
for f in src/routes/payout-plan.js src/routes/payout-cart.js src/lib/payout-approval-gate.js public/assets/js/payout-plan.js public/assets/css/payout-approval.css; do
  [ -f "$f" ] && echo "  OK  $f" || echo "  НЕТ $f"
done
echo '--- API отвечает ---'
curl -s -o /dev/null -w 'payout-plan: %{{http_code}}\n' http://127.0.0.1:3000/api/payout-plan/2026/9
curl -s -o /dev/null -w 'health: %{{http_code}}\n' http://127.0.0.1:3000/api/health
echo '--- ошибки в логе за 3 мин ---'
journalctl -u asgard-crm --since '3 min ago' --no-pager 2>/dev/null | grep -ciE 'error|fail' || true
"""
    if DRY:
        print("  (dry-run) проверки будут выполнены после выкатки")
    else:
        rc, out = ssh(checks)
        print(out)

    print("\n" + "=" * 70)
    print(f"{'DRY-RUN завершён — ничего не менялось' if DRY else 'ДЕПЛОЙ ЗАВЕРШЁН'}")
    print(f"бэкап: {bdir if not DRY else '/root/backups/deploy-' + STAMP}")
    print("=" * 70)
    tmp.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
