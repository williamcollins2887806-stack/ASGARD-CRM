#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Doc Hub visual+quarters assets + run dedupe/CP-normalize on prod."""
from __future__ import annotations

import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"

FILES = [
    ("public/assets/js/doc-hub.js", f"{REMOTE}/public/assets/js/doc-hub.js"),
    ("public/assets/css/doc-hub.css", f"{REMOTE}/public/assets/css/doc-hub.css"),
    ("public/index.html", f"{REMOTE}/public/index.html"),
    ("public/sw.js", f"{REMOTE}/public/sw.js"),
    ("src/routes/doc-registry.js", f"{REMOTE}/src/routes/doc-registry.js"),
    ("tools/doc-hub-registry-audit.js", f"{REMOTE}/tools/doc-hub-registry-audit.js"),
    ("tools/doc-hub-cp-normalize.js", f"{REMOTE}/tools/doc-hub-cp-normalize.js"),
    ("tools/doc-hub-dedupe-apply.js", f"{REMOTE}/tools/doc-hub-dedupe-apply.js"),
]


def connect():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = None
    for loader in (
        getattr(paramiko, "Ed25519Key", None),
        getattr(paramiko, "ECDSAKey", None),
        paramiko.RSAKey,
    ):
        if not loader:
            continue
        try:
            pkey = loader.from_private_key_file(SSH_KEY)
            break
        except Exception:
            pass
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=pkey, timeout=30)
    return ssh


def run(ssh, cmd, timeout=600):
    print(">>", cmd)
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out[-4000:])
    if err.strip():
        print("STDERR:", err[-2000:])
    print("exit", code)
    return code, out, err


def main():
    ssh = connect()
    sftp = ssh.open_sftp()
    for local, remote in FILES:
        lp = ROOT / local
        print("put", local, "->", remote, "bytes", lp.stat().st_size)
        sftp.put(str(lp), remote)
    sftp.close()

    # Restart API so doc-registry quarter filters load
    run(ssh, "cd /var/www/asgard-crm && (pm2 restart asgard-crm || systemctl restart asgard-crm || true)")
    time.sleep(3)
    run(ssh, "curl -s -o /dev/null -w '%{http_code}' https://asgard-crm.ru/ | head -1")

    # Dedupe + normalize on prod DB (uses prod .env via dotenv from tools/)
    run(
        ssh,
        "cd /var/www/asgard-crm && node tools/doc-hub-dedupe-apply.js --apply",
        timeout=120,
    )
    run(
        ssh,
        "cd /var/www/asgard-crm && set -a && . ./.env && set +a && node tools/doc-hub-cp-normalize.js --apply",
        timeout=900,
    )
    run(
        ssh,
        "cd /var/www/asgard-crm && set -a && . ./.env && set +a && node tools/doc-hub-registry-audit.js",
        timeout=120,
    )
    # Smoke shell version + doc-hub asset
    run(
        ssh,
        "grep -o '20\\.28\\.[0-9]*' /var/www/asgard-crm/public/sw.js | head -1; "
        "test -f /var/www/asgard-crm/public/assets/js/doc-hub.js && echo doc-hub.js_ok; "
        "grep -n 'quarter' /var/www/asgard-crm/src/routes/doc-registry.js | head -3",
    )
    ssh.close()
    print("DONE deploy+prod-normalize")


if __name__ == "__main__":
    main()
