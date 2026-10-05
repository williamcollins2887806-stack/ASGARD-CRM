#!/usr/bin/env python3
# Deploy Doc Hub delta + run manual CP fix + audit on prod
from __future__ import annotations
from pathlib import Path
import paramiko

ROOT = Path(__file__).resolve().parents[1]
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
OUT = ROOT / "tools" / "_tmp_deploy_manual_out.txt"

FILES = [
    "public/assets/js/doc-hub.js",
    "public/assets/css/doc-hub.css",
    "public/index.html",
    "public/sw.js",
    "src/routes/doc-registry.js",
    "tools/doc-hub-registry-audit.js",
    "tools/doc-hub-cp-normalize.js",
    "tools/doc-hub-dedupe-apply.js",
    "tools/doc-hub-manual-cp-fix.js",
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
    chunks = [f">> {cmd}"]
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    chunks.append(stdout.read().decode("utf-8", "replace"))
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if err.strip():
        chunks.append("ERR " + err[-2000:])
    chunks.append(f"exit {code}")
    return code, "\n".join(chunks)


def main():
    log = []
    ssh = connect()
    sftp = ssh.open_sftp()
    for rel in FILES:
        lp = ROOT / rel
        rp = f"{REMOTE}/{rel}"
        log.append(f"put {rel} ({lp.stat().st_size})")
        sftp.put(str(lp), rp)
    sftp.close()

    code, out = run(ssh, "systemctl restart asgard-crm.service && sleep 2 && systemctl is-active asgard-crm.service")
    log.append(out)
    code, out = run(
        ssh,
        "cd /var/www/asgard-crm && set -a && . ./.env && set +a && node tools/doc-hub-manual-cp-fix.js --apply",
        timeout=300,
    )
    log.append(out)
    code, out = run(
        ssh,
        "cd /var/www/asgard-crm && set -a && . ./.env && set +a && node tools/doc-hub-dedupe-apply.js --apply && node tools/doc-hub-registry-audit.js",
        timeout=180,
    )
    log.append(out)
    code, out = run(
        ssh,
        "grep -o '20\\.28\\.[0-9]*' /var/www/asgard-crm/public/sw.js | head -1; "
        "head -35 /var/www/asgard-crm/tests/reports/doc-hub-excel/manual-cp-fix.md; "
        "head -25 /var/www/asgard-crm/tests/reports/doc-hub-excel/registry-audit.md",
    )
    log.append(out)
    ssh.close()
    OUT.write_text("\n".join(log), encoding="utf-8")
    print("wrote", OUT, "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
