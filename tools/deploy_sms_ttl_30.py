#!/usr/bin/env python3
"""Deploy SMS auth code TTL 5 → 30 min."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
REL = "src/routes/field-auth.js"


def run(c, cmd, timeout=120):
    print("====", cmd[:180].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-5000:] if len(out) > 5000 else out)
    if err.strip():
        print("STDERR:", err[:1500])
    if code != 0:
        raise SystemExit(f"FAILED ({code})")
    return out


def main():
    local = ROOT / REL
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)

    print("=== SNAPSHOT ===")
    run(
        c,
        "mkdir -p /root/snapshots && "
        "tar -czf /root/snapshots/asgard-crm-pre-deploy-sms-ttl-30-$(date +%Y%m%d-%H%M%S).tgz "
        f"-C /var/www asgard-crm/{REL} && "
        "ls -lt /root/snapshots/asgard-crm-pre-deploy-sms-ttl-30-* | head -2",
    )

    print("=== UPLOAD ===")
    sftp = c.open_sftp()
    sftp.put(str(local), f"{PROJECT}/{REL}")
    sftp.close()
    print(f"  ok {REL}")

    print("=== MARKER ===")
    run(c, "grep -n 'SMS_CODE_TTL_MIN' /var/www/asgard-crm/src/routes/field-auth.js | head -3")

    print("=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm")
    run(c, "curl -s -o /dev/null -w 'HOME=%{http_code}\\n' http://127.0.0.1:3000/")

    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
