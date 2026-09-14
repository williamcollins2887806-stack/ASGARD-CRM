#!/usr/bin/env python3
"""Deploy offline-guard null-safe fix (shell 20.27.94)."""
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
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-offline-guard-{TAG}"
VER = "20.27.94"
FILES = [
    "public/assets/js/offline-guard.js",
    "public/index.html",
    "public/sw.js",
]


def run(c, cmd, timeout=120):
    print("====", cmd[:200])
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-4000:])
    if err.strip():
        print("STDERR:", err[:1000])
    if code != 0:
        raise SystemExit(f"FAIL {code}")
    return out


def main():
    for rel in FILES:
        if not (ROOT / rel).exists():
            raise SystemExit("missing " + rel)
    text = (ROOT / "public/assets/js/offline-guard.js").read_text(encoding="utf-8")
    if "if (overlay) overlay.classList.add('visible')" not in text:
        raise SystemExit("offline-guard fix missing")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    run(c, f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP}.tgz {' '.join(FILES)} && ls -lh {SNAP}.tgz")
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        digest = hashlib.md5(local.read_bytes()).hexdigest()
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            ok = hashlib.md5(rf.read()).hexdigest() == digest
        print("OK" if ok else "FAIL", rel)
        if not ok:
            raise SystemExit("md5")

    # banner optional
    remote_sql = f"/tmp/app_update_{VER.replace('.', '_')}.sql"
    sql = (
        f"INSERT INTO app_updates (version, title, changes, target) VALUES ("
        f"'{VER}', 'Фикс offline-guard', "
        f"'[\"Защита от classList на null при восстановлении связи\"]'::jsonb, 'desktop') "
        f"ON CONFLICT (version) DO UPDATE SET title=EXCLUDED.title, changes=EXCLUDED.changes, published_at=now();"
    )
    with sftp.file(remote_sql, "w") as f:
        f.write(sql)
    run(c, f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {remote_sql} && rm -f {remote_sql}")
    run(c, f"grep -o \"SHELL_VERSION = '[^']*'\" {PROJECT}/public/sw.js")
    # frontend-only — restart not strictly required but refresh version endpoint from memory may be stale until restart
    run(c, "systemctl restart asgard-crm && sleep 2 && curl -sS http://127.0.0.1:3000/api/version")

    sftp.close()
    c.close()
    print("DONE", SNAP)


if __name__ == "__main__":
    main()
