#!/usr/bin/env python3
import io
import os
import subprocess
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"


def ensure_dir(sftp, remote_dir):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def main():
    subprocess.check_call([sys.executable, str(ROOT / "tools" / "sync_cache_version.py")], cwd=str(ROOT))
    # vite build may already be done; try again if needed
    v2 = ROOT / "public" / "desktop-v2-src"
    if (v2 / "package.json").exists():
        print("Building desktop-v2...")
        subprocess.check_call(["npm", "run", "build"], cwd=str(v2), shell=os.name == "nt")

    upload = [
        "public/index.html",
        "public/sw.js",
        "public/assets/js/hub_funnel_tab.js",
        "src/routes/tenders-hub.js",
    ]
    for p in (ROOT / "public" / "v2").rglob("*"):
        if p.is_file() and "node_modules" not in p.parts:
            upload.append(str(p.relative_to(ROOT)).replace("\\", "/"))

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()
    print(f"=== Upload {len(upload)} files ===")
    for rel in upload:
        local = ROOT / rel
        if not local.exists():
            print("SKIP", rel)
            continue
        remote = f"{PROJECT}/{rel}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print(" ok", rel)
    sftp.close()

    _, o, e = c.exec_command(
        "node --check /var/www/asgard-crm/src/routes/tenders-hub.js; "
        "systemctl restart asgard-crm; sleep 3; systemctl is-active asgard-crm",
        timeout=90,
    )
    print(o.read().decode("utf-8", "replace"))
    err = e.read().decode("utf-8", "replace").strip()
    if err:
        print("STDERR:", err)
    c.close()
    print("DONE funnel fix deploy")


if __name__ == "__main__":
    main()
