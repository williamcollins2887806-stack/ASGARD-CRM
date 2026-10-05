#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Upload merged Excel JSON + run dry-run/apply against prod localhost API."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
REMOTE_DIR = f"{REMOTE}/tests/reports/doc-hub-excel"
LOCAL_MERGED = ROOT / "tests" / "reports" / "doc-hub-excel" / "merged-rows.json"
DRY_ONLY = "--dry-run-only" in sys.argv


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


def run(ssh, cmd: str, timeout: int = 600) -> tuple[int, str, str]:
    print("$", cmd[:200])
    _i, out, err = ssh.exec_command(cmd, timeout=timeout)
    rc = out.channel.recv_exit_status()
    so = out.read().decode("utf-8", "replace")
    se = err.read().decode("utf-8", "replace")
    if so.strip():
        print(so[-4000:])
    if se.strip():
        print("STDERR:", se[-2000:])
    return rc, so, se


def main() -> int:
    if not LOCAL_MERGED.exists():
        print("missing", LOCAL_MERGED)
        return 2

    ssh = connect()
    sftp = ssh.open_sftp()

    # Ensure excel service + apply tool are current on prod
    for rel in (
        "src/services/doc-registry-excel.js",
        "tools/doc-hub-excel-apply.js",
        "tools/doc-hub-excel-rowcheck.js",
    ):
        local = ROOT / rel
        remote = f"{REMOTE}/{rel}"
        print("upload", rel)
        sftp.put(str(local), remote)

    run(ssh, f"mkdir -p {REMOTE_DIR}")
    print("upload merged-rows.json", LOCAL_MERGED.stat().st_size)
    sftp.put(str(LOCAL_MERGED), f"{REMOTE_DIR}/merged-rows.json")

    # Mint admin JWT on server
    mint = r"""node -e "
require('dotenv').config({path:'/var/www/asgard-crm/.env'});
const jwt=require('jsonwebtoken');
const {Client}=require('pg');
(async()=>{
  const c=new Client({host:process.env.DB_HOST||'127.0.0.1',database:process.env.DB_NAME||'asgard_crm',user:process.env.DB_USER||'asgard',password:process.env.DB_PASSWORD||'123456789'});
  await c.connect();
  const {rows}=await c.query(\"SELECT id, login, role, name FROM users WHERE role='ADMIN' AND COALESCE(is_active,true)=true ORDER BY id LIMIT 1\");
  const u=rows[0];
  const token=jwt.sign({id:u.id,login:u.login,role:u.role,name:u.name,pinVerified:true}, process.env.JWT_SECRET, {expiresIn:'4h'});
  process.stdout.write(token);
  await c.end();
})().catch(e=>{console.error(e);process.exit(1);});
" """
    rc, token, se = run(ssh, f"cd {REMOTE} && {mint}", timeout=60)
    if rc != 0 or not token.strip():
        print("mint token failed")
        return 1
    token = token.strip().splitlines()[-1].strip()
    print("token len", len(token))

    # Restart not strictly required for service file if already loaded — reload node
    run(ssh, "systemctl restart asgard-crm || pm2 restart asgard-crm || true", timeout=90)
    time.sleep(3)
    run(ssh, "curl -sf http://127.0.0.1:3000/api/health | head -c 200", timeout=30)

    flag = "--dry-run-only" if DRY_ONLY else ""
    cmd = (
        f"cd {REMOTE} && "
        f"DOC_HUB_TOKEN='{token}' TEST_BASE_URL=http://127.0.0.1:3000 DOC_HUB_APPLY_CHUNK=150 "
        f"node tools/doc-hub-excel-apply.js {REMOTE_DIR}/merged-rows.json {flag}"
    )
    rc, so, se = run(ssh, cmd, timeout=1800)
    if rc != 0:
        print("apply failed", rc)
        return rc

    # Download results
    for name in ("dry-run.json", "apply-result.json", "post-apply-fix.md"):
        rpath = f"{REMOTE_DIR}/{name}"
        lpath = ROOT / "tests" / "reports" / "doc-hub-excel" / name
        try:
            sftp.get(rpath, str(lpath))
            print("got", name)
        except Exception as e:
            print("skip get", name, e)

    if not DRY_ONLY:
        # quick count
        run(
            ssh,
            "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
            "\"SELECT COUNT(*) AS docs FROM doc_registry WHERE deleted_at IS NULL;\"",
            timeout=30,
        )

    sftp.close()
    ssh.close()
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
