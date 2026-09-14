#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy autumn season fix: backend + migration + /m build."""
import io
import sys
import tarfile
import tempfile
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/var/www/asgard-crm"
VERSION = "20.27.98"

FILES = [
    "src/services/seasonalChecker.js",
    "src/services/questProgress.js",
    "src/routes/field-seasonal.js",
    "src/routes/field-gamification.js",
    "migrations/V327__autumn_2026_season_and_quest_fix.sql",
    "migrations/V327__autumn_2026_season_and_quest_fix_down.sql",
    "public/sw.js",
    "public/index.html",
]


def main():
    # 1) build mobile
    import subprocess
    print("=== BUILD mobile-app ===")
    r = subprocess.run(
        ["npm", "run", "build"],
        cwd=str(ROOT / "public" / "mobile-app"),
        capture_output=True,
        text=True,
        shell=True,
    )
    print(r.stdout[-2000:] if r.stdout else "")
    if r.returncode != 0:
        print(r.stderr[-3000:])
        raise SystemExit("build failed")

    # mirror dist -> public/m
    subprocess.run(
        ["robocopy", str(ROOT / "public" / "mobile-app" / "dist"), str(ROOT / "public" / "m"),
         "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"],
        shell=True,
    )
    index_html = (ROOT / "public" / "m" / "index.html").read_text(encoding="utf-8")
    if "index-" not in index_html:
        raise SystemExit("m/index.html missing chunk")
    print("m index ok")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    def run(cmd, timeout=300):
        print("====", cmd[:200])
        _, o, e = c.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        if out.strip():
            print(out[-8000:] if len(out) > 8000 else out)
        if err.strip():
            print("STDERR:", err[:3000])
        return out

    # snapshot
    run(
        f"mkdir -p /root/snapshots && tar czf /root/snapshots/asgard-crm-pre-autumn-{VERSION}-$(date +%Y%m%d-%H%M%S).tar.gz "
        f"-C {PROJECT} src/services/seasonalChecker.js src/services/questProgress.js "
        f"src/routes/field-seasonal.js src/routes/field-gamification.js public/m/index.html public/sw.js public/index.html "
        f"2>/dev/null; ls -lt /root/snapshots | head -3"
    )

    # upload backend files
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        run(f"mkdir -p $(dirname {remote})")
        sftp.put(str(local), remote)
        print("UP", rel)

    # upload m tar
    tmp_tar = Path(tempfile.gettempdir()) / "asgard_m_autumn98.tar"
    with tarfile.open(tmp_tar, "w") as tar:
        tar.add(ROOT / "public" / "m", arcname="m")
    print("TAR", tmp_tar.stat().st_size)
    sftp.put(str(tmp_tar), "/tmp/asgard_m_autumn98.tar")
    run(
        f"cd {PROJECT}/public && cp -a m m.bak-autumn-$(date +%H%M%S) && "
        "rm -rf m && tar -xf /tmp/asgard_m_autumn98.tar && "
        "test -f m/index.html && grep -o 'index-[^\"]*\\.js' m/index.html | head -1 && "
        "ls m/assets/avatars/ranks | head -3"
    )

    # migration
    run(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V327__autumn_2026_season_and_quest_fix.sql"
    )

    # restart
    run("systemctl restart asgard-crm && sleep 5 && curl -sS http://127.0.0.1:3000/api/version")

    # verify SQL
    run(r"""
export PGPASSWORD=123456789
psql -U asgard -d asgard_crm <<'EOSQL'
\echo === SEASONS NOW ===
SELECT slug, season_name, starts_at::date, ends_at::date, is_active,
       (starts_at<=NOW() AND ends_at>=NOW()) AS in_window,
       reward_type, reward_value
FROM seasonal_challenges ORDER BY starts_at;

\echo === AUTUMN TASKS ===
SELECT t.slug, t.name, t.action_type, t.target_value
FROM seasonal_challenge_tasks t
JOIN seasonal_challenges c ON c.id=t.challenge_id
WHERE c.slug='autumn_2026' ORDER BY t.sort_order;

\echo === SEASONAL QUESTS ===
SELECT id, name, is_active, season_end, reward_amount
FROM gamification_quests WHERE quest_type='seasonal' ORDER BY is_active DESC, id;

\echo === SPIN_AT SMOKE (must not error) ===
SELECT COUNT(*) AS spins FROM gamification_spins
WHERE spin_at >= '2026-09-01' AND spin_at < '2026-12-01';
EOSQL
""")

    # bulk refresh via node one-liner on server
    run(r"""
cd /var/www/asgard-crm && node -e "
const db=require('./src/services/db');
const {refreshAllActiveSeasonWorkers}=require('./src/services/seasonalChecker');
(async()=>{
  const r=await refreshAllActiveSeasonWorkers(db,{limit:600});
  console.log(JSON.stringify(r));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
"
""")

    # app update notice
    sql = f"""
INSERT INTO app_updates (version, title, changes, target) VALUES (
  '{VERSION}',
  'Осень 2026 — сезон снова работает',
  '[{{"icon":"🍂","text":"Открыт сезон Осень 2026: смены, уроки, колесо, стрик"}},{{"icon":"🩹","text":"Починили учёт спинов Колеса — испытания снова считаются"}},{{"icon":"⚔️","text":"Обновили сезонные квесты: весна убрана, осень за руны"}}]'::jsonb,
  'field'
) ON CONFLICT (version) DO UPDATE SET title=EXCLUDED.title, changes=EXCLUDED.changes, published_at=NOW();
"""
    tmp = Path(tempfile.gettempdir()) / "u98.sql"
    tmp.write_text(sql, encoding="utf-8")
    sftp.put(str(tmp), "/tmp/u98.sql")
    run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/u98.sql")

    # final HTTP checks
    run(
        "curl -sS -o /dev/null -w 'm=%{http_code}\\n' http://127.0.0.1:3000/m/; "
        "grep -o 'index-[^\"]*\\.js' /var/www/asgard-crm/public/m/index.html | head -1; "
        "grep -c 'spin_at' /var/www/asgard-crm/src/services/seasonalChecker.js; "
        "grep -c 'spun_at' /var/www/asgard-crm/src/services/seasonalChecker.js || true"
    )

    sftp.close()
    c.close()
    tmp_tar.unlink(missing_ok=True)
    tmp.unlink(missing_ok=True)
    print("DONE", VERSION)


if __name__ == "__main__":
    main()
