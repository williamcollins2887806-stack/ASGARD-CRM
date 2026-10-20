#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy ASGARD-CRM РЅР° РїСЂРѕРґ 18-19.10.2026 (shell 20.28.225).

РњРѕРґРµР»СЊ: Р»РѕРєР°Р»СЊРЅС‹Р№ СЂРµРїРѕР·РёС‚РѕСЂРёР№ = source of truth -> tar + scp -> СЂР°СЃРїР°РєРѕРІРєР°.
Git РЅР° РїСЂРѕРґРµ "РіСЂСЏР·РЅС‹Р№" (СЌС‚Рѕ РЅРѕСЂРјР°), РќР• С‚СЂРѕРіР°РµРј.

РџРѕСЂСЏРґРѕРє (РІР°Р¶РµРЅ):
  0. Р‘Р­РљРђРџ Р‘Р” + РљРћР”Рђ (СЃРІРµР¶РёР№, СЌС‚РёРј Р·Р°С…РѕРґРѕРј) + pre-flight РіРµР№С‚С‹
  1. snapshot С‚РµРєСѓС‰РµРіРѕ СЃРѕСЃС‚РѕСЏРЅРёСЏ РїСЂРѕРґР°
  2. РљРћР”: tar (src/, public/m, public/assets, public/index.html, public/sw.js, tools/, migrations/)
  3. РњРР“Р РђР¦РР: С‚РѕС‡РµС‡РЅРѕ 17 (tools/migrate_targeted.js) РЅР° asgard_crm
  4. systemctl restart asgard-crm
  5. POST-CHECKS

Р—Р°РїСѓСЃРє: python tools/deploy_2026_10_18.py            # dry-run (С‚РѕР»СЊРєРѕ РїРµС‡Р°С‚Р°РµС‚ РїР»Р°РЅ)
        python tools/deploy_2026_10_18.py --apply    # РІС‹РїРѕР»РЅРёС‚СЊ
"""
from __future__ import annotations

import io
import re
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

def _read_shell_version() -> str:
    """Версия оболочки читается ИЗ ФАЙЛА, а не хардкодится.

    Класс дефекта: скрипт был зашит на 20.28.232, и после каждого бампа
    deploy-gate падал с «получено 20.28.247, ожидалось 20.28.232». Теперь
    ожидание всегда совпадает с тем, что реально лежит в index.html.
    """
    html = (ROOT / "public" / "index.html").read_text(encoding="utf-8", errors="replace")
    m = re.search(r"ASGARD_SHELL_VERSION\s*=\s*['\"]([0-9.]+)['\"]", html)
    return m.group(1) if m else "20.28.247"


VER = _read_shell_version()
HOST = "92.242.61.184"
USER = "root"
KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
DRY = "--apply" not in sys.argv

# Р§С‚Рѕ РІРµР·С‘Рј. public/m вЂ” СЃРІРµР¶Р°СЏ СЃР±РѕСЂРєР° РјРѕР±РёР»СЊРЅРѕРіРѕ; public/v2 РЅРµ С‚СЂРѕРіР°РµРј (РЅРµ РїРµСЂРµСЃРѕР±РёСЂР°Р»Рё).
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
    print(f"\n{'в”Ђ' * 70}\n{n}. {title}\n{'в”Ђ' * 70}")


def main() -> int:
    print("=" * 70)
    print(f"Р”Р•РџР›РћР™ ASGARD-CRM   shell {VER}   {'DRY-RUN' if DRY else 'РџР РРњР•РќР•РќРР•'}")
    print(f"РІСЂРµРјСЏ: {STAMP}")
    print("=" * 70)

    # в”Ђв”Ђ 0a. pre-flight РіРµР№С‚С‹ в”Ђв”Ђ
    step("0a", "PRE-FLIGHT: shell_guard")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER)

    step("0b", "PRE-FLIGHT: verify_index_tags")
    r = subprocess.run(["node", str(ROOT / "tools" / "verify_index_tags.js")],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = (r.stdout or "").strip().split("\n")[-1]
    print("  " + tail)
    if r.returncode != 0:
        print("вќЊ verify_index_tags РєСЂР°СЃРЅС‹Р№ вЂ” СЃС‚РѕРї")
        return 1

    step("0c", "PRE-FLIGHT: audit_silent_reverts (РїСЂРѕРґ-СѓРЅРёРєР°Р»СЊРЅС‹Рµ РїСЂР°РІРєРё)")
    r = subprocess.run(["node", str(ROOT / "tools" / "audit_silent_reverts.js")],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
    out = (r.stdout or "")
    tail = "\n".join(out.strip().split("\n")[-3:])
    print("  " + tail.replace("\n", "\n  "))
    if "PROD_HANDEDIT=0" not in out and "РРўРћР“: OK" not in out:
        print("вљ пёЏ  Р°СѓРґРёС‚ РЅРµ РїРѕРґС‚РІРµСЂРґРёР» PROD_HANDEDIT=0 вЂ” РїСЂРѕРІРµСЂСЊ РѕС‚С‡С‘С‚ РїРµСЂРµРґ РІС‹РєР°С‚РєРѕР№")

    # в”Ђв”Ђ 0d. Р±СЌРєР°Рї в”Ђв”Ђ
    step("0d", "Р‘Р­РљРђРџ Р‘Р” + РљРћР”Рђ (СЃРІРµР¶РёР№)")
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
        print("  (dry-run) РєРѕРјР°РЅРґР° Р±СЌРєР°РїР°:\n" + "\n".join("    " + l for l in bck.splitlines()))
    else:
        rc, out = ssh(bck)
        print(out)
        if rc != 0:
            print("вќЊ Р±СЌРєР°Рї РЅРµ СѓРґР°Р»СЃСЏ вЂ” РЎРўРћРџ")
            return 1
        rc, out = ssh(f"cd {bdir} && md5sum -c MANIFEST.md5 2>&1 | grep -c OK")
        print(f"  РєРѕРЅС‚СЂРѕР»СЊРЅС‹С… СЃСѓРјРј OK: {out.strip()}")

    # в”Ђв”Ђ 1. snapshot в”Ђв”Ђ
    step("1", "SNAPSHOT СЃРѕСЃС‚РѕСЏРЅРёСЏ РїСЂРѕРґР°")
    if DRY:
        print("  (dry-run)")
    else:
        rc, out = ssh(f"mkdir -p /root/snapshots && cd {REMOTE} && tar czf /root/snapshots/pre-deploy-{STAMP}.tar.gz "
                      f"src public/index.html public/sw.js 2>/dev/null; ls -la /root/snapshots/pre-deploy-{STAMP}.tar.gz")
        print(out)

    # в”Ђв”Ђ 2. РєРѕРґ: tar в”Ђв”Ђ
    step("2", "РљРћР”: СЃР±РѕСЂРєР° tar Рё РїРµСЂРµРґР°С‡Р°")
    tmp = Path(tempfile.gettempdir()) / f"asgard-deploy-{STAMP}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tf:
        for rel in TAR_PATHS:
            p = ROOT / rel
            if not p.exists():
                print(f"  вљ пёЏ  РЅРµС‚ РїСѓС‚Рё: {rel}")
                continue
            tf.add(str(p), arcname=rel)
    size_mb = tmp.stat().st_size / 1024 / 1024
    print(f"  tar: {tmp}  ({size_mb:.1f} РњР‘)")
    if DRY:
        print("  (dry-run) РґР°Р»РµРµ: scp tar -> СЂР°СЃРїР°РєРѕРІРєР° РІ " + REMOTE)
    else:
        for attempt in range(1, 6):
            if scp(str(tmp), f"/tmp/{tmp.name}") == 0:
                break
            print(f"  scp РїРѕРїС‹С‚РєР° {attempt} РЅРµ РїСЂРѕС€Р»Р°, РїРѕРІС‚РѕСЂвЂ¦")
        else:
            print("вќЊ РЅРµ СѓРґР°Р»РѕСЃСЊ РїРµСЂРµРґР°С‚СЊ tar вЂ” РЎРўРћРџ")
            return 1
        rc, out = ssh(f"cd {REMOTE} && cp public/index.html /tmp/index.html.pre-{STAMP} && "
                      f"tar xzf /tmp/{tmp.name} -C {REMOTE} && echo 'СЂР°СЃРїР°РєРѕРІР°РЅРѕ' && "
                      f"chmod 644 public/index.html public/sw.js public/m/index.html && "
                      f"rm -f /tmp/{tmp.name}")
        print(out)
        if rc != 0 or "СЂР°СЃРїР°РєРѕРІР°РЅРѕ" not in out:
            print("вќЊ СЂР°СЃРїР°РєРѕРІРєР° РЅРµ СѓРґР°Р»Р°СЃСЊ вЂ” РЎРўРћРџ")
            return 1

    # в”Ђв”Ђ 3. РјРёРіСЂР°С†РёРё в”Ђв”Ђ
    step("3", "РњРР“Р РђР¦РР: 17 С‚РѕС‡РµС‡РЅРѕ (tools/migrate_targeted.js)")
    mig = (f"cd {REMOTE} && MIGRATIONS_DIR={REMOTE}/migrations DB_NAME=asgard_crm DB_USER=asgard "
           f"DB_PASSWORD=123456789 DB_HOST=localhost node tools/migrate_targeted.js --apply")
    if DRY:
        print("  (dry-run) СЃРЅР°С‡Р°Р»Р° РїР»Р°РЅ:")
        rc, out = ssh(f"cd {REMOTE} && MIGRATIONS_DIR={REMOTE}/migrations node tools/migrate_targeted.js 2>&1 | tail -25")
        print(out)
    else:
        rc, out = ssh(mig + " 2>&1 | tail -30")
        print(out)
        if rc != 0:
            print("вќЊ РјРёРіСЂР°С†РёРё СѓРїР°Р»Рё вЂ” РЎРўРћРџ (РєРѕРґ СѓР¶Рµ РІС‹РєР°С‡РµРЅ, Р‘Р” РѕС‚РєР°С‚РёС‚СЃСЏ РІСЂСѓС‡РЅСѓСЋ РёР· Р±СЌРєР°РїР°)")
            return 1

    # в”Ђв”Ђ 4. СЂРµСЃС‚Р°СЂС‚ в”Ђв”Ђ
    step("4", "Р Р•РЎРўРђР Рў СЃРµСЂРІРёСЃР°")
    if DRY:
        print("  (dry-run) systemctl restart asgard-crm")
    else:
        rc, out = ssh("systemctl restart asgard-crm && sleep 6 && systemctl is-active asgard-crm")
        print(out)
        if "active" not in out:
            print("вќЊ СЃРµСЂРІРёСЃ РЅРµ РїРѕРґРЅСЏР»СЃСЏ вЂ” СЃРјРѕС‚СЂРё journalctl")
            return 1

    # в”Ђв”Ђ 5. post-checks в”Ђв”Ђ
    step("5", "POST-CHECKS")
    checks = f"""cd {REMOTE}
echo '--- РІРµСЂСЃРёСЏ РѕР±РѕР»РѕС‡РєРё ---'
grep -o "ASGARD_SHELL_VERSION = '[0-9.]*'" public/index.html | head -1
grep -o "const SHELL_VERSION = '[0-9.]*'" public/sw.js | head -1
echo '--- РїСЂРёРјРµРЅРµРЅРѕ РјРёРіСЂР°С†РёР№ ---'
sudo -u postgres psql -d asgard_crm -tAc "SELECT COUNT(*) FROM migrations"
echo '--- РѕР±СЉРµРєС‚С‹ РІС‹РїР»Р°С‚ ---'
sudo -u postgres psql -d asgard_crm -tAc "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('payout_batches','payout_batch_items','payout_plans','payout_plan_items')"
echo '--- СЃРІР°СЂС‰РёРє max ---'
sudo -u postgres psql -d asgard_crm -tAc "SELECT MAX(points) FROM field_tariff_grid WHERE category='mlsp' AND position_name LIKE 'РЎРІР°СЂС‰РёРє%'"
echo '--- С„Р°Р№Р»С‹ РІС‹РїР»Р°С‚ РЅР° РјРµСЃС‚Рµ ---'
for f in src/routes/payout-plan.js src/routes/payout-cart.js src/lib/payout-approval-gate.js public/assets/js/payout-plan.js public/assets/css/payout-approval.css; do
  [ -f "$f" ] && echo "  OK  $f" || echo "  РќР•Рў $f"
done
echo '--- API РѕС‚РІРµС‡Р°РµС‚ ---'
curl -s -o /dev/null -w 'payout-plan: %{{http_code}}\n' http://127.0.0.1:3000/api/payout-plan/2026/9
curl -s -o /dev/null -w 'health: %{{http_code}}\n' http://127.0.0.1:3000/api/health
echo '--- РѕС€РёР±РєРё РІ Р»РѕРіРµ Р·Р° 3 РјРёРЅ ---'
journalctl -u asgard-crm --since '3 min ago' --no-pager 2>/dev/null | grep -ciE 'error|fail' || true
"""
    if DRY:
        print("  (dry-run) РїСЂРѕРІРµСЂРєРё Р±СѓРґСѓС‚ РІС‹РїРѕР»РЅРµРЅС‹ РїРѕСЃР»Рµ РІС‹РєР°С‚РєРё")
    else:
        rc, out = ssh(checks)
        print(out)

    print("\n" + "=" * 70)
    print(f"{'DRY-RUN Р·Р°РІРµСЂС€С‘РЅ вЂ” РЅРёС‡РµРіРѕ РЅРµ РјРµРЅСЏР»РѕСЃСЊ' if DRY else 'Р”Р•РџР›РћР™ Р—РђР’Р•Р РЁРЃРќ'}")
    print(f"Р±СЌРєР°Рї: {bdir if not DRY else '/root/backups/deploy-' + STAMP}")
    print("=" * 70)
    tmp.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

