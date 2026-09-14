#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy early-checkin morning fix + V328 + refresh (no mobile rebuild needed)."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/var/www/asgard-crm"
VERSION = "20.27.99"

FILES = [
    "src/services/seasonalChecker.js",
    "src/routes/field-checkin.js",
    "migrations/V328__early_checkin_morning_threshold.sql",
]


def main():
    # bump shell version locally then upload
    for rel in ("public/sw.js", "public/index.html"):
        p = ROOT / rel
        txt = p.read_text(encoding="utf-8")
        txt2 = txt.replace("20.27.98", VERSION)
        if txt2 == txt and VERSION not in txt:
            print("WARN: version string 20.27.98 not found in", rel)
        p.write_text(txt2, encoding="utf-8")
        FILES.append(rel)

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    def run(cmd, timeout=300):
        print("====", cmd[:220])
        _, o, e = c.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        if out.strip():
            print(out[-6000:] if len(out) > 6000 else out)
        if err.strip():
            print("STDERR:", err[:2000])
        return out

    run(
        f"mkdir -p /root/snapshots && tar czf /root/snapshots/asgard-crm-pre-earlyfix-{VERSION}-$(date +%Y%m%d-%H%M%S).tar.gz "
        f"-C {PROJECT} src/services/seasonalChecker.js src/routes/field-checkin.js public/sw.js public/index.html || true"
    )

    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        print("PUT", rel)
        sftp.put(str(local), remote)

    run(f"sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 -f {PROJECT}/migrations/V328__early_checkin_morning_threshold.sql")
    run("systemctl restart asgard-crm")
    run("sleep 2; systemctl is-active asgard-crm; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")

    # verify threshold in deployed file
    run(f"grep -n \"Moscow') < \" {PROJECT}/src/services/seasonalChecker.js | head -5")
    run(f"grep -n 'localHourNow <' {PROJECT}/src/routes/field-checkin.js | head -5")

    sftp.close()
    c.close()
    print("DEPLOYED", VERSION)


if __name__ == "__main__":
    main()
