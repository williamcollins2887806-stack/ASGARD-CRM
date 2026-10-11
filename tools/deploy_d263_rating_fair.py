#!/usr/bin/env python3
"""Деплой D-263: честный рейтинг РП (shell 20.28.183 → 20.28.184).

Явный список файлов. Важно: в рабочем дереве параллельно работала чужая сессия
(телефония) и уже выкатила свою часть — её файлы НЕ трогаем.

  * frontend: pm_duty.js + оболочка (index.html, sw.js, h/*)
  * backend:  pm-analysis-rating.js → systemctl restart asgard-crm
  * после заливки: разовый пересчёт снапшотов рейтинга (иначе UI покажет старые
    числа до cron 03:00 МСК), только для активных РП
"""
import hashlib
import io
import sys
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
SHELL_V = "20.28.184"

STATIC = [
    "public/assets/js/pm_duty.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]
BACKEND = [
    "src/services/pm-analysis-rating.js",
]
FILES = STATIC + BACKEND


def md5b(b):
    return hashlib.md5(b).hexdigest()


def run(c, cmd, timeout=180):
    print("====", cmd[:150].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out:
        print(out if len(out) <= 15000 else out[-15000:])
    if err.strip():
        print("STDERR:", err[:3000])
    return out


def main():
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"MISSING LOCAL: {rel}")
    sw = (ROOT / "public/sw.js").read_text(encoding="utf-8")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    rating = (ROOT / "src/services/pm-analysis-rating.js").read_text(encoding="utf-8")
    if f"SHELL_VERSION = '{SHELL_V}'" not in sw:
        raise SystemExit("LOCAL sw.js не на " + SHELL_V)
    if f"ASGARD_SHELL_VERSION = '{SHELL_V}'" not in idx or f"?v={SHELL_V}" not in idx:
        raise SystemExit("LOCAL index.html не на " + SHELL_V)
    for needle in ("isWorkingRegistryStatus", "MIN_MEASURABLE_HOURS", "COLLAB_PENDING_CREDIT"):
        if needle not in rating:
            raise SystemExit("LOCAL рейтинг без " + needle)
    for rel in FILES:
        if "\ufffd" in (ROOT / rel).read_text(encoding="utf-8"):
            raise SystemExit("U+FFFD в " + rel)
    print("preflight local: OK")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    snap = f"/root/snapshots/asgard-crm-pre-deploy-d263-rating-{stamp}"
    print(f"\n### SNAPSHOT → {snap}")
    run(c, f"mkdir -p {snap} && " + " && ".join(
        f"(cp -a {PROJECT}/{rel} {snap}/{rel.replace('/', '__')}.bak 2>/dev/null || echo 'NO {rel}')"
        for rel in FILES
    ) + f" && ls -1 {snap} | wc -l")

    print("\n### PROD BEFORE")
    run(c, f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1; systemctl is-active asgard-crm")

    print("\n### UPLOAD")
    for rel in FILES:
        data = (ROOT / rel).read_bytes()
        sftp.put(str(ROOT / rel), f"{PROJECT}/{rel}")
        print(f"  ↑ {rel} md5={md5b(data)} size={len(data)}")

    print("\n### BACKEND RESTART")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm")

    print("\n### POST-DEPLOY md5")
    bad = []
    for rel in FILES:
        local = md5b((ROOT / rel).read_bytes())
        try:
            remote = md5b(sftp.file(f"{PROJECT}/{rel}", "r").read())
        except IOError:
            bad.append(rel)
            print(f"  NOFILE {rel}")
            continue
        if local != remote:
            bad.append(rel)
        print(f"  {'OK    ' if local == remote else 'MISMATCH'} {rel}")

    print("\n### ПЕРЕСЧЁТ СНАПШОТОВ РЕЙТИНГА (разово, чтобы UI не ждал cron 03:00)")
    probe = """
const { Pool } = require('pg');
const rating = require('/var/www/asgard-crm/src/services/pm-analysis-rating.js');
(async () => {
  const p = new Pool({ user: 'asgard', password: '123456789', host: '127.0.0.1', database: 'asgard_crm' });
  const ids = await rating.listPmUserIds(p);
  let ok = 0;
  for (const id of ids) { try { await rating.upsertSnapshots(p, id, new Date()); ok++; } catch (e) {} }
  const r = await p.query("SELECT score,grade,components_json->'collab'->>'pending' AS pending FROM pm_analysis_rating_daily WHERE user_id=3474 AND window_kind='d30' ORDER BY as_of_date DESC LIMIT 1");
  console.log('recomputed', ok + '/' + ids.length, '| Androsov d30', JSON.stringify(r.rows[0] || null));
  await p.end();
})();
"""
    sftp.putfo(io.BytesIO(probe.encode("utf-8")), f"{PROJECT}/_rating_recalc.js")
    run(c, f"cd {PROJECT} && node _rating_recalc.js 2>&1")
    c.exec_command(f"rm -f {PROJECT}/_rating_recalc.js")

    print("\n### PROD AFTER")
    run(c,
        f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1; "
        f"systemctl is-active asgard-crm; "
        f"curl -s http://127.0.0.1:3000/api/version | head -c 120")

    sftp.close()
    c.close()
    print(f"\nSNAPSHOT: {snap}")
    print("BAD FILES:", bad if bad else "нет — все md5 совпали")
    if bad:
        raise SystemExit("ДЕПЛОЙ НЕПОЛНЫЙ: " + ", ".join(bad))


if __name__ == "__main__":
    main()
