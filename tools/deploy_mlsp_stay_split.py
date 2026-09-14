#!/usr/bin/env python3
"""Deploy MLSP stay home-split: from_site closes stay after 1-day cool, assignments stay."""
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
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-mlsp-split-{TAG}"
FILES = [
    "src/lib/mlsp-stay.js",
    "src/services/mlsp-stay-cron.js",
]


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(c, cmd, timeout=180):
    print("====", cmd[:220].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-8000:] if len(out) > 8000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:160]}")
    return out


def main():
    stay = (ROOT / FILES[0]).read_text(encoding="utf-8")
    if "HOME_SPLIT_COOLING_DAYS" not in stay or "backfillClosedStaySplits" not in stay:
        raise SystemExit("marker missing in mlsp-stay.js")
    if "closeAssignments: false" not in stay:
        raise SystemExit("marker missing: closeAssignments false")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    tar_list = " ".join(FILES)
    run(
        c,
        f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz {tar_list} && ls -lh {SNAP}.tgz",
    )

    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            remote_md5 = hashlib.md5(rf.read()).hexdigest()
        print(f"  {'OK' if remote_md5 == digest else 'FAIL'} {rel} {digest}")
        if remote_md5 != digest:
            raise SystemExit("md5 fail")

    run(c, f"grep -c HOME_SPLIT_COOLING_DAYS {PROJECT}/src/lib/mlsp-stay.js")
    run(
        c,
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm "
        "&& curl -sS http://127.0.0.1:3000/api/version",
    )

    # Apply split now, do not wait for 08:05 cron
    rec_js = r"""
const { Pool } = require('pg');
const mlsp = require('/var/www/asgard-crm/src/lib/mlsp-stay');
const pool = new Pool({ host: '127.0.0.1', user: 'asgard', password: '123456789', database: 'asgard_crm' });
const db = { query: (...a) => pool.query(...a) };
const log = { info: (...a) => console.log(...a), warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
mlsp.reconcileStays(db, log).then((r) => {
  console.log('RECONCILE', JSON.stringify(r));
  return pool.end();
}).catch((e) => { console.error(e); process.exit(1); });
"""
    rec_path = "/tmp/mlsp_reconcile_once.js"
    with sftp.file(rec_path, "w") as f:
        f.write(rec_js)
    run(c, f"cd {PROJECT} && node {rec_path}", timeout=120)

    run(
        c,
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"SELECT e.fio, s.id, s.arrived_at::date, s.planned_depart_at::date, "
        "s.actual_departed_at::date, s.departed_source, ea.is_active, ea.departure_date "
        "FROM employees e "
        "JOIN mlsp_stays s ON s.employee_id = e.id "
        "LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.work_id IN (403,407) "
        "WHERE e.id IN (63,266) ORDER BY e.fio, s.id;\"",
    )

    sftp.close()
    c.close()
    print("DONE snapshot=", SNAP + ".tgz")


if __name__ == "__main__":
    main()
