#!/usr/bin/env python3
"""Deploy remaining local≠prod files: backend + vanilla frontend."""
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

BACKEND = [
    "src/routes/tenders-registry.js",
    "src/routes/cash.js",
    "src/routes/data.js",
    "src/routes/hints.js",
    "src/routes/letter.js",
    "src/services/correspondence.js",
    "src/services/pre-tender-service.js",
]

FRONTEND = [
    "public/assets/js/custom_dashboard.js",
    "public/assets/js/director_inbox.js",
    "public/assets/js/estimate_report.js",
    "public/assets/css/components.css",
    "public/assets/css/responsive.css",
]

UPLOAD_DIRS = [
    ("public/v2", "public/v2"),
    ("public/m", "public/m"),
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


def upload_files(sftp, files):
    for rel in files:
        local = ROOT / rel
        if not local.exists():
            print(f"SKIP missing {rel}")
            continue
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print(f"  uploaded {rel}")


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


def sync_mobile_to_m():
  """vite outDir=dist, prod serves /m/ from public/m."""
  import shutil

  src = ROOT / "public" / "mobile-app" / "dist"
  dst = ROOT / "public" / "m"
  if not src.is_dir():
    print("WARN: mobile-app/dist missing")
    return
  if dst.exists():
    shutil.rmtree(dst)
  shutil.copytree(src, dst)
  print(f"  synced {src} -> {dst}")


def build_frontends():
    if os.environ.get("SKIP_V2_BUILD") == "1":
        print("=== Skip builds (SKIP_V2_BUILD=1) ===")
        return
    npm = "npm.cmd" if os.name == "nt" else "npm"
    print("=== Build desktop-v2 ===")
    subprocess.run(
        [npm, "run", "build"],
        cwd=str(ROOT / "public" / "desktop-v2-src"),
        check=True,
        shell=(os.name == "nt"),
    )
    print("=== Build mobile-app ===")
    subprocess.run(
        [npm, "run", "build"],
        cwd=str(ROOT / "public" / "mobile-app"),
        check=True,
        shell=(os.name == "nt"),
    )
    print("=== Sync mobile dist -> public/m ===")
    sync_mobile_to_m()


def smoke(c):
    def run(cmd, timeout=60):
        _, o, e = c.exec_command(cmd, timeout=timeout)
        return (o.read() + e.read()).decode("utf-8", "replace").strip()

    print("\n=== Smoke checks ===")
    print("service:", run("systemctl is-active asgard-crm"))
    print("api/version:", run("curl -s http://localhost:3000/api/version"))
    code = run("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/tenders/director-review-queue")
    print("director-review-queue:", code, "(expect 401)")
    v2 = run("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/v2/")
    m = run("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/m/")
    print("/v2/:", v2, "/m/:", m)
    logs = run("journalctl -u asgard-crm -n 30 --no-pager | grep -i error | tail -5 || true")
    if logs:
        print("recent errors:\n", logs)
    else:
        print("recent errors: none")


def main():
    if not KEY.exists():
        print(f"ERROR: SSH key not found: {KEY}", file=sys.stderr)
        sys.exit(1)

    do_build = os.environ.get("DEPLOY_V2_MOBILE") == "1"
    if do_build:
        build_frontends()

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== Upload backend ===")
    upload_files(sftp, BACKEND)

    print("\n=== Upload vanilla frontend ===")
    upload_files(sftp, FRONTEND)

    if do_build:
        print("\n=== Upload v2 + mobile ===")
        for local_rel, remote_rel in UPLOAD_DIRS:
            local = ROOT / local_rel
            if not local.is_dir():
                print(f"WARN: {local_rel} missing — run build first")
                continue
            n = upload_tree(sftp, local, f"{PROJECT}/{remote_rel}")
            print(f"  uploaded {remote_rel} ({n} files)")

    sftp.close()

    print("\n=== Restart asgard-crm ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm",
        timeout=90,
    )
    status = (o.read() + e.read()).decode("utf-8", "replace").strip()
    print("service:", status)
    if "active" not in status:
        print("ERROR: service did not restart", file=sys.stderr)
        c.close()
        sys.exit(1)

    smoke(c)
    c.close()
    print("\n=== Deploy remaining diff: done ===")


if __name__ == "__main__":
    main()
