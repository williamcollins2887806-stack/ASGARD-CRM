#!/usr/bin/env python3
"""Deploy RP-review thread ACL: all TO/PM can chat; email TO only to creator."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

FILES = [
    "src/routes/pm-duty.js",
    "src/services/rp-review-thread-notify.js",
]


def run(c, cmd, timeout=120):
    print("====", cmd[:200].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-8000:] if len(out) > 8000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code})")
    return out


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)

    print("=== SNAPSHOT ===")
    run(
        c,
        "mkdir -p /root/snapshots && "
        "tar -czf /root/snapshots/asgard-crm-pre-deploy-thread-acl-$(date +%Y%m%d-%H%M%S).tgz "
        "-C /var/www asgard-crm/src/routes/pm-duty.js "
        "asgard-crm/src/services/rp-review-thread-notify.js && "
        "ls -lt /root/snapshots/asgard-crm-pre-deploy-thread-acl-* | head -3",
    )

    print("=== UPLOAD ===")
    sftp = c.open_sftp()
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        sftp.put(str(local), remote)
        print(f"  ok {rel} ({local.stat().st_size} bytes)")
    sftp.close()

    print("=== MARKERS ===")
    run(
        c,
        "grep -n \"все ТО и все РП\" /var/www/asgard-crm/src/routes/pm-duty.js | head -3; "
        "grep -n \"Почта ТО/HEAD_TO\" /var/www/asgard-crm/src/services/rp-review-thread-notify.js | head -3",
    )

    print("=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm")

    print("=== HTTP ===")
    run(c, "curl -s -o /dev/null -w 'HOME=%{http_code}\\n' http://127.0.0.1:3000/")

    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
