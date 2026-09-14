#!/usr/bin/env python3
"""Deploy crew FIO format: Surname FirstName PatronymicInitial."""
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
    "public/assets/js/components/cr-employee-picker.js",
    "public/assets/css/cr-components.css",
    "public/assets/js/field-tab.js",
    "public/index.html",
    "public/sw.js",
]


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
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)

    print("=== SNAPSHOT ===")
    run(
        c,
        "mkdir -p /root/snapshots && "
        "tar -czf /root/snapshots/asgard-crm-pre-deploy-crew-fio-$(date +%Y%m%d-%H%M%S).tgz "
        "-C /var/www "
        "asgard-crm/public/assets/js/components/cr-employee-picker.js "
        "asgard-crm/public/assets/css/cr-components.css "
        "asgard-crm/public/assets/js/field-tab.js "
        "asgard-crm/public/index.html asgard-crm/public/sw.js && "
        "ls -lt /root/snapshots/asgard-crm-pre-deploy-crew-fio-* | head -2",
    )

    print("=== UPLOAD ===")
    sftp = c.open_sftp()
    for rel in FILES:
        local = ROOT / rel
        sftp.put(str(local), f"{PROJECT}/{rel}")
        print("  ok", rel)
    sftp.close()

    print("=== MARKERS ===")
    run(
        c,
        "grep -n '_formatShortFio\\|Иванов Иван' /var/www/asgard-crm/public/assets/js/components/cr-employee-picker.js | head -5; "
        "grep -n 'max-width: 280px' /var/www/asgard-crm/public/assets/css/cr-components.css | head -2; "
        "grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" /var/www/asgard-crm/public/index.html; "
        "grep -o \"SHELL_VERSION = '[^']*'\" /var/www/asgard-crm/public/sw.js",
    )

    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
