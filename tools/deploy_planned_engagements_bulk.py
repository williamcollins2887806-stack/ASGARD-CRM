#!/usr/bin/env python3
"""Deploy planned-engagements.js (bulk route missing on prod -> 404)."""
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
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-planned-bulk-{TAG}"
REL = "src/routes/planned-engagements.js"


def run(c, cmd, timeout=180):
    print("====", cmd[:200])
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-6000:])
    if err.strip():
        print("STDERR:", err[:1500])
    if code != 0:
        raise SystemExit(f"FAILED {code}")
    return out


def main():
    local = ROOT / REL
    text = local.read_text(encoding="utf-8")
    if "fastify.post('/bulk'" not in text:
        raise SystemExit("no bulk route in local file")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    run(c, f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz {REL} && ls -lh {SNAP}.tgz")
    remote = f"{PROJECT}/{REL}"
    digest = hashlib.md5(local.read_bytes()).hexdigest()
    sftp.put(str(local), remote)
    with sftp.file(remote, "rb") as rf:
        rmd5 = hashlib.md5(rf.read()).hexdigest()
    print("md5", "OK" if rmd5 == digest else "FAIL", digest)
    if rmd5 != digest:
        raise SystemExit("md5 fail")

    run(c, f"grep -n \"fastify.post('/bulk'\" {remote}")
    run(
        c,
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm "
        "&& curl -sS -o /tmp/pe.json -w '%{http_code}' -X POST http://127.0.0.1:3000/api/staff/planned-engagements/bulk "
        "-H 'Content-Type: application/json' -d '{}' && echo && head -c 120 /tmp/pe.json && echo",
    )
    sftp.close()
    c.close()
    print("DONE", SNAP + ".tgz")


if __name__ == "__main__":
    main()
