#!/usr/bin/env python3
"""Deploy: director tender approval gate (V286) + TKP mandatory + UI."""
import io
import os
import subprocess
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

UPLOAD = [
    "migrations/V286__rp_director_review.sql",
    "src/routes/pm-duty.js",
    "src/routes/tenders-registry.js",
    "src/services/rp-review-notify.js",
    "src/services/rp-review-thread-notify.js",
    "public/assets/js/registry_api.js",
    "public/assets/js/registry_tab.js",
    "public/assets/js/rp_review_modal.js",
    "public/assets/js/director_tender_approvals.js",
    "public/assets/js/app.js",
    "public/index.html",
    "public/sw.js",
]

UPLOAD_DIRS = [
    ("public/desktop-v2", "public/desktop-v2"),
    ("public/mobile-app/dist", "public/mobile-app/dist"),
]


def ensure_dir(sftp, remote_dir):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def upload_tree(sftp, local_dir: Path, remote_dir: str):
    ensure_dir(sftp, remote_dir)
    count = 0
    for item in local_dir.rglob("*"):
        if not item.is_file():
            continue
        rel = item.relative_to(local_dir).as_posix()
        remote = f"{remote_dir}/{rel}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(item), remote)
        count += 1
    return count


def build_frontends():
    if os.environ.get("SKIP_V2_BUILD") == "1":
        print("=== Skip builds (SKIP_V2_BUILD=1) ===")
        return
    npm = "npm.cmd" if os.name == "nt" else "npm"
    print("=== Build desktop-v2 ===")
    subprocess.run([npm, "run", "build"], cwd=str(ROOT / "public" / "desktop-v2-src"), check=True, shell=(os.name == "nt"))
    print("=== Build mobile-app ===")
    subprocess.run([npm, "run", "build"], cwd=str(ROOT / "public" / "mobile-app"), check=True, shell=(os.name == "nt"))


def main():
    if not KEY.exists():
        print(f"ERROR: SSH key not found: {KEY}", file=sys.stderr)
        sys.exit(1)

    build_frontends()

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== Upload files ===")
    for rel in UPLOAD:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel.replace(chr(92), '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print(f"  {rel}")

    for local_rel, remote_rel in UPLOAD_DIRS:
        local = ROOT / local_rel
        if local.is_dir():
            n = upload_tree(sftp, local, f"{PROJECT}/{remote_rel}")
            print(f"  {local_rel}/ ({n} files)")

    sftp.close()

    def run(cmd):
        print(f"$ {cmd[:200]}")
        _, o, e = c.exec_command(cmd, timeout=180)
        out = o.read().decode("utf-8", errors="replace")
        err = e.read().decode("utf-8", errors="replace")
        if out.strip():
            print(out.strip())
        if err.strip():
            print("ERR:", err.strip())

    print("=== Restart PM2 ===")
    run(f"cd {PROJECT} && pm2 restart asgard-crm --update-env")

    c.close()
    print("Deploy upload done. Run tools/_run_v286_prod.py for migration if needed.")


if __name__ == "__main__":
    main()
