#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: phone canonicalization (steps 1+3) — src/lib/phone.js + route writers + auth lookup.

Step 2 (data migration for employees) already applied directly on prod.
Shell version NOT touched. Snapshot first, verify after.
"""
from __future__ import annotations

import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import shell_guard  # noqa: E402
import paramiko

VER = "20.28.186"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "src/lib/phone.js",
    "src/routes/staff.js",
    "src/routes/field-worker.js",
    "src/routes/customers.js",
    "src/routes/suppliers.js",
    "src/routes/users.js",
    "src/routes/huginn_ext.js",
    "src/routes/integrations.js",
    "src/routes/field-auth.js",
]


def load_pkey(path: str):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    print("shell_guard: OK")
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd, check=True, timeout=600):
        print(f"$ {cmd[:200]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip())
        if err.strip():
            print(err.rstrip(), file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd}")
        return out

    snap = f"/root/snapshots/asgard-phone-canon-{STAMP}.tgz"
    existing = " ".join(f for f in FILES if run(f"test -f {REMOTE}/{f} && echo yes", check=False).strip() == "yes")
    run("mkdir -p /root/snapshots && tar -czf {snap} -C {remote} {files}".format(
        snap=snap, remote=REMOTE, files=existing or "."))
    print(f"snapshot: {snap}")

    sftp = ssh.open_sftp()
    for rel in FILES:
        remote_path = f"{REMOTE}/{rel}"
        # ensure dir exists
        run(f"mkdir -p $(dirname {remote_path})", check=False)
        sftp.put(str(ROOT / rel), remote_path)
        print(f"put {rel}")
    sftp.close()

    # syntax check all
    run("cd {r} && ok=1 && for f in {files}; do node --check \"$f\" || ok=0; done && "
        "echo SYNTAX_OK=$ok".format(r=REMOTE, files=" ".join(FILES)))

    run("systemctl restart asgard-crm")
    run("sleep 3; systemctl is-active asgard-crm")

    print("=== POST CHECKS ===")
    run(f"ls -la {REMOTE}/src/lib/phone.js")
    run("cd {r} && grep -l 'require(.*lib/phone' src/routes/staff.js src/routes/customers.js "
        "src/routes/suppliers.js src/routes/users.js src/routes/huginn_ext.js "
        "src/routes/integrations.js src/routes/field-worker.js; "
        "grep -c 'regexp_replace(COALESCE(e.phone' src/routes/field-auth.js".format(r=REMOTE))
    run("curl -s -o /dev/null -w 'health:%{http_code}\\n' http://127.0.0.1:3000/api/version")
    run("curl -s -o /dev/null -w 'm-index:%{http_code}\\n' http://127.0.0.1:3000/m/index.html")

    print(f"\n=== DONE. Rollback: tar -xzf {snap} -C {REMOTE} && systemctl restart asgard-crm ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
