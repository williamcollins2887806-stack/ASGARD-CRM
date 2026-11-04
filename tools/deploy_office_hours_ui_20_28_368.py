#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hotfix: show fact hours in office schedule cells + dash hints (20.28.368)."""
from __future__ import annotations
import hashlib, sys, tarfile, tempfile, time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko, shell_guard  # noqa: E402

SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE, VER = "/var/www/asgard-crm", "20.28.368"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
FILES = [
    "public/assets/js/office_schedule.js",
    "public/assets/css/app.css",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
]

def load_pkey(path):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
        if loader is None: continue
        try: return loader.from_private_key_file(path)
        except Exception: continue
    raise SystemExit("no key")

def md5(b): return hashlib.md5(b).hexdigest()

def main():
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing {rel}")
    sw = (ROOT / "public/sw.js").read_text(encoding="utf-8")
    if f"SHELL_VERSION = '{VER}'" not in sw:
        raise SystemExit("bad shell")
    head = (ROOT / "tests/reports/.last-verified")
    import subprocess
    h = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=str(ROOT), text=True).strip()
    head.write_text(h + "\n", encoding="utf-8")
    shell_guard.assert_ok(expect_version=VER, deploy_gate=True)

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45, banner_timeout=70, auth_timeout=70)

    def run(cmd, check=True):
        print("$", cmd[:200])
        _i, o, e = ssh.exec_command(cmd, timeout=180)
        out, err = o.read().decode("utf-8", "replace"), e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip(): print(out[:2000])
        if err.strip(): print(err[:500], file=sys.stderr)
        if check and code != 0: raise SystemExit(f"exit {code}")
        return out

    sftp = ssh.open_sftp()
    run("mkdir -p /root/snapshots")
    run(f"tar -czf /root/snapshots/asgard-office-ui-{STAMP}.tgz -C {REMOTE} {' '.join(FILES)} 2>/dev/null || true", check=False)
    tar_path = Path(tempfile.gettempdir()) / f"office-ui-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(str(ROOT / rel), arcname=rel)
    remote = f"/tmp/office-ui-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote)
    run(f"tar -xzf {remote} -C {REMOTE} && rm -f {remote}")
    for rel in FILES:
        local = md5((ROOT / rel).read_bytes())
        with sftp.file(f"{REMOTE}/{rel}", "rb") as rf:
            if md5(rf.read()) != local:
                raise SystemExit(f"md5 {rel}")
        print("OK", rel)

    # crm_activity_since = сегодня МСК, чтобы подсказки были честными
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -h 127.0.0.1 -v ON_ERROR_STOP=1 -c "
        "\"UPDATE settings SET value_json = jsonb_set(COALESCE(value_json::jsonb,'{}'::jsonb), '{crm_activity_since}', "
        "to_jsonb(to_char((NOW() AT TIME ZONE 'Europe/Moscow')::date, 'YYYY-MM-DD'))) "
        "WHERE key='skud';\""
    )

    # static assets — restart not strictly required, but bump SW needs clients to refresh
    run("systemctl reload asgard-crm || systemctl restart asgard-crm", check=False)
    time.sleep(2)
    run("curl -sS -m 5 http://127.0.0.1:3000/api/health || true", check=False)
    run(f"grep -E \"SHELL_VERSION = '{VER}'\" {REMOTE}/public/sw.js | head -1")
    print("DEPLOY OK", VER)
    sftp.close(); ssh.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
