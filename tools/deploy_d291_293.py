#!/usr/bin/env python3
"""Деплой D-291/292/293: белый экран, AI-объёмы, ТКП."""
import sys, os, subprocess, time
from pathlib import Path
import paramiko

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"

UPLOAD = [
    "public/index.html",
    "public/sw.js",
    "public/assets/js/components/doc-preview-modal.js",
    "public/assets/js/personal_kanban.js",
    "public/assets/js/tkp-page.js",
    "src/routes/pre_tenders.js",
    "src/routes/tkp.js",
    "src/routes/tkp_quick.js",
    "src/services/pre-tender-service.js",
    "src/services/ai-provider.js",
    "src/services/mimir-tkp-quick.js",
    "src/services/mimir-auto-estimate.js",
    "src/routes/mimir.js",
]


def connect():
    for _ in range(6):
        try:
            c = paramiko.SSHClient()
            c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            c.connect(HOST, username="root", pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)),
                      timeout=30, banner_timeout=40, auth_timeout=30)
            return c
        except Exception:
            time.sleep(4)
    return None


def ensure_dir(sftp, remote_dir):
    cur = ""
    for p in remote_dir.strip("/").split("/"):
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def main():
    subprocess.check_call([sys.executable, str(ROOT / "tools" / "sync_cache_version.py")], cwd=str(ROOT))

    c = connect()
    if c is None:
        raise SystemExit("ssh unavailable")
    sftp = c.open_sftp()
    for rel in UPLOAD:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print(" ok", rel)
    sftp.close()

    def run(cmd, timeout=120):
        _, o, e = c.exec_command(cmd, timeout=timeout)
        return (o.read() + e.read()).decode("utf-8", "replace")

    print(run("cd /var/www/asgard-crm && for f in src/routes/pre_tenders.js src/routes/tkp.js src/services/pre-tender-service.js; do node --check $f || exit 1; done && echo SYNTAX_OK"))
    print(run("systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm"))
    print(run("grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" /var/www/asgard-crm/public/index.html"))
    c.close()


if __name__ == "__main__":
    main()
