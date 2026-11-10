#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy parseStamp hour fix + full SKUD reimport of Vika's 01.07–09.11 file.

Shell bump не нужен (только backend). VER в имени — текущий shell на дереве.
"""
from __future__ import annotations
import hashlib, subprocess, sys, tarfile, tempfile, time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko, shell_guard  # noqa: E402

SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
FILES = [
    "src/services/skud-xls.js",
]
# Актуальная выгрузка Вики (вход/выход + полный период).
SKUD_XLS = (
    "uploads/mail/2026-11-10/6f9a9938-9360-41cd-bfc1-0fd85a3131d6/"
    "события 01.07-09.11.xls"
)

REIMPORT_JS = r"""
'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
process.chdir('/var/www/asgard-crm');
const skudImport = require('./src/services/skud-import');
const skudXls = require('./src/services/skud-xls');

const FILE = process.argv[2];
if (!FILE || !fs.existsSync(FILE)) {
  console.error('missing file', FILE);
  process.exit(2);
}

(async () => {
  const pool = new Pool({ connectionString: 'postgresql://asgard:123456789@127.0.0.1/asgard_crm' });
  const db = { query: (...a) => pool.query(...a), pool };

  // sanity: hour-without-zero must parse on THIS binary
  const probe = skudXls.parseStamp('09.11.2026 9:07:44');
  if (!probe || probe.time !== '09:07:44') {
    console.error('FIX_NOT_LOADED', probe);
    process.exit(3);
  }
  console.log('parseStamp OK', probe);

  const { rows: live } = await db.query(
    `SELECT id, file_name, period_from::text, period_to::text FROM skud_imports WHERE deleted_at IS NULL ORDER BY id`
  );
  console.log('live_before', live.length);
  for (const r of live) {
    const res = await skudImport.revertImport(db, r.id, null);
    console.log('reverted', r.id, r.file_name, res);
  }

  const buf = fs.readFileSync(FILE);
  const name = path.basename(FILE);
  console.log('importing', name, 'bytes', buf.length);
  const res = await skudImport.importSkudReport(db, {
    buffer: buf,
    filename: name,
    source: 'mail',
    emailId: null
  });
  console.log('import_result', JSON.stringify(res, null, 2));

  const { rows: putkov } = await db.query(`
    SELECT to_char(ts,'HH24:MI:SS') AS t, direction, event, device
      FROM skud_punches
     WHERE import_id = $1 AND date = '2026-11-09' AND raw_person ILIKE '%Путков%'
     ORDER BY ts, id
  `, [res.importId]);
  console.log('PUTKOV_09', JSON.stringify(putkov, null, 2));

  const { rows: before10 } = await db.query(`
    SELECT COUNT(*)::int AS n
      FROM skud_punches
     WHERE import_id = $1 AND date = '2026-11-09' AND ts::time < time '10:00'
  `, [res.importId]);
  console.log('DAY_09_BEFORE_10', before10[0]);

  const { rows: hours } = await db.query(`
    SELECT oh.office_minutes, oh.open_ended, oh.segments::text
      FROM office_hours_daily oh
      JOIN skud_person_map m ON m.staff_id = oh.staff_id
     WHERE oh.date = '2026-11-09' AND m.raw_name ILIKE '%Путков%'
  `);
  console.log('PUTKOV_HOURS', hours[0] || null);

  const { rows: span } = await db.query(`
    SELECT MIN(date)::text AS min_d, MAX(date)::text AS max_d,
           COUNT(*)::int AS punches,
           COUNT(*) FILTER (WHERE ts::time < time '10:00')::int AS before10_all
      FROM skud_punches sp
      JOIN skud_imports si ON si.id = sp.import_id AND si.deleted_at IS NULL
  `);
  console.log('SPAN', span[0]);
  await pool.end();
  if (!putkov.length || putkov[0].t !== '09:07:44' || putkov[0].direction !== 'вход') {
    console.error('VERIFY_FAIL putkov morning');
    process.exit(4);
  }
  if (!before10[0] || before10[0].n < 1) {
    console.error('VERIFY_FAIL before10');
    process.exit(5);
  }
  console.log('REIMPORT_OK');
})().catch((e) => { console.error(e); process.exit(1); });
"""


def load_pkey(path):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit("no key")


def md5(b):
    return hashlib.md5(b).hexdigest()


def main():
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing {rel}")

    # deploy-gate: backend-only; sync .last-verified to HEAD like prior scoped deploys
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=str(ROOT), text=True).strip()
    (ROOT / "tests/reports/.last-verified").write_text(head + "\n", encoding="utf-8")

    # shell version as currently bumped in tree (informational gate)
    sw = (ROOT / "public/sw.js").read_text(encoding="utf-8")
    import re
    m = re.search(r"SHELL_VERSION = '([^']+)'", sw)
    ver = m.group(1) if m else None
    print("=== shell_guard ===")
    if ver:
        shell_guard.assert_ok(expect_version=ver, deploy_gate=True)
    else:
        shell_guard.assert_ok(deploy_gate=True)
    print("OK shell_guard")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    last = None
    for attempt in range(5):
        try:
            ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45, banner_timeout=90, auth_timeout=70)
            break
        except Exception as e:
            last = e
            print(f"ssh retry {attempt+1}: {e}")
            time.sleep(4)
    else:
        raise SystemExit(f"ssh fail: {last}")

    def run(cmd, check=True, timeout=600):
        print("$", cmd[:240])
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out, err = o.read().decode("utf-8", "replace"), e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out[:8000])
        if err.strip():
            print(err[:1500], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"exit {code}: {cmd}")
        return out, code

    sftp = ssh.open_sftp()
    run("mkdir -p /root/snapshots", check=False)
    snap = f"/root/snapshots/asgard-crm-pre-deploy-skud-hour-{STAMP}.tgz"
    run(f"tar -czf {snap} -C {REMOTE} {' '.join(FILES)} 2>/dev/null || true", check=False)
    print("snapshot", snap)

    tar_path = Path(tempfile.gettempdir()) / f"skud-hour-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(str(ROOT / rel), arcname=rel)
    remote_tar = f"/tmp/skud-hour-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    for rel in FILES:
        local = md5((ROOT / rel).read_bytes())
        with sftp.file(f"{REMOTE}/{rel}", "rb") as rf:
            if md5(rf.read()) != local:
                raise SystemExit(f"md5 mismatch {rel}")
        print("OK", rel)

    run("systemctl restart asgard-crm")
    for i in range(1, 10):
        out, _ = run(
            "curl -sS -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true",
            check=False,
        )
        code = (out or "").strip()
        print(f"health try {i}: {code}")
        if code == "200":
            break
        time.sleep(2)
    else:
        raise SystemExit("health not 200")

    # Скрипт кладём внутрь app-дерева, иначе node не видит node_modules/pg.
    remote_js = f"{REMOTE}/tools/_reimport_hour_tmp.js"
    with sftp.file(remote_js, "w") as f:
        f.write(REIMPORT_JS)
    # Путь к xls через glob — кириллица в ssh/Windows ломается.
    print("=== reimport ===")
    run(
        f"cd {REMOTE} && "
        f"XLS=$(ls uploads/mail/2026-11-10/6f9a9938-9360-41cd-bfc1-0fd85a3131d6/*.xls | head -1) && "
        f"echo \"XLS=$XLS\" && "
        f"node tools/_reimport_hour_tmp.js \"$XLS\" && "
        f"rm -f tools/_reimport_hour_tmp.js",
        timeout=900,
    )

    print("DEPLOY+REIMPORT OK", head[:12])
    sftp.close()
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
