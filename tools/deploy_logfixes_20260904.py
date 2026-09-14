#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy logfixes: mlsp-stay-cron, telephony SMS alias, mimir-cron. No mobile rebuild."""
import io
import sys
import time
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/var/www/asgard-crm"
TAG = "logfixes-20260904"

FILES = [
    "src/services/mlsp-stay-cron.js",
    "src/routes/telephony.js",
    "src/services/mimir-cron.js",
]


def main():
    for rel in FILES:
        p = ROOT / rel
        if not p.is_file():
            raise SystemExit(f"missing {rel}")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    def run(cmd, timeout=120):
        print("====", cmd[:220])
        _, o, e = c.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        if out.strip():
            print(out[-8000:] if len(out) > 8000 else out)
        if err.strip():
            print("STDERR:", err[:2000])
        return out

    # 1) snapshot
    run(
        f"mkdir -p /root/snapshots && tar czf /root/snapshots/asgard-crm-pre-{TAG}-$(date +%Y%m%d-%H%M%S).tar.gz "
        f"-C {PROJECT} src/services/mlsp-stay-cron.js src/routes/telephony.js src/services/mimir-cron.js"
    )

    # 2) upload
    for rel in FILES:
        remote = f"{PROJECT}/{rel}"
        print("PUT", rel)
        sftp.put(str(ROOT / rel), remote)

    # 3) sanity on disk before restart
    run(f"grep -n 'u.employee_id' {PROJECT}/src/services/mlsp-stay-cron.js || echo 'OK: no users.employee_id'")
    run(f"grep -n 'employees e' {PROJECT}/src/services/mlsp-stay-cron.js | head -5")
    run(f"grep -n 'result/sms\\|events/sms' {PROJECT}/src/routes/telephony.js | head -10")
    run(f"grep -n 'aiBalanceExhausted' {PROJECT}/src/services/mimir-cron.js | head -5")

    # 4) restart
    run("systemctl restart asgard-crm")

    # 5) health-wait
    ok = False
    for i in range(1, 9):
        time.sleep(2)
        out = run(
            "systemctl is-active asgard-crm; "
            "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || echo fail"
        )
        if "active" in out and "200" in out:
            ok = True
            print(f"HEALTH OK on try {i}")
            break
    if not ok:
        raise SystemExit("health failed after restart")

    # 6) smoke SMS aliases (expect NOT 404; 400/403/401 without signature is fine)
    run(
        "curl -s -o /dev/null -w 'events_sms:%{http_code}\\n' -X POST "
        "http://127.0.0.1:3000/api/telephony/webhook/events/sms -H 'Content-Type: application/json' -d '{}'; "
        "curl -s -o /dev/null -w 'result_sms:%{http_code}\\n' -X POST "
        "http://127.0.0.1:3000/api/telephony/webhook/result/sms -H 'Content-Type: application/json' -d '{}'"
    )

    # 7) MLSP lookup must not error
    run(
        """sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 -c """
        """\"SELECT e.id AS emp_id, e.user_id FROM employees e """
        """WHERE e.id IN (SELECT employee_id FROM mlsp_stays WHERE actual_departed_at IS NULL) """
        """ORDER BY e.id LIMIT 10;\""""
    )

    # 8) journal recent errors
    run("journalctl -u asgard-crm -n 40 --no-pager | tail -40")

    sftp.close()
    c.close()
    print("DEPLOYED", TAG)


if __name__ == "__main__":
    main()
