#!/usr/bin/env python3
"""Deploy desktop PIN idle lock 10→30 min + shell 20.27.50."""
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
    "public/assets/js/session-guard.js",
    "public/sw.js",
    "public/index.html",
]


def run(c, cmd, timeout=120):
    print("====", cmd[:180].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-6000:] if len(out) > 6000 else out)
    if err.strip():
        print("STDERR:", err[:1500])
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
        "tar -czf /root/snapshots/asgard-crm-pre-deploy-pin-idle-30-$(date +%Y%m%d-%H%M%S).tgz "
        "-C /var/www asgard-crm/public/assets/js/session-guard.js "
        "asgard-crm/public/sw.js asgard-crm/public/index.html && "
        "ls -lt /root/snapshots/asgard-crm-pre-deploy-pin-idle-30-* | head -2",
    )

    print("=== UPLOAD ===")
    sftp = c.open_sftp()
    for rel in FILES:
        local = ROOT / rel
        sftp.put(str(local), f"{PROJECT}/{rel}")
        print(f"  ok {rel}")
    sftp.close()

    print("=== MARKERS ===")
    run(
        c,
        "grep -n 'IDLE_TIMEOUT' /var/www/asgard-crm/public/assets/js/session-guard.js | head -2; "
        "grep -o \"SHELL_VERSION = '[^']*'\" /var/www/asgard-crm/public/sw.js; "
        "grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" /var/www/asgard-crm/public/index.html; "
        "grep -o 'session-guard.js?v=[^\"]*' /var/www/asgard-crm/public/index.html",
    )

    print("=== RESTART (optional for static, but refresh nginx cache none) ===")
    run(c, "systemctl is-active asgard-crm; curl -s -o /dev/null -w 'HOME=%{http_code}\\n' http://127.0.0.1:3000/")

    c.close()
    print("DONE — ask users hard-refresh / accept SW update banner")


if __name__ == "__main__":
    main()
