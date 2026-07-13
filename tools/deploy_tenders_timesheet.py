#!/usr/bin/env python3
"""Deploy: registry docs upload + timesheet training/helicopter (V284)."""
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
    "migrations/V284__timesheet_training_helicopter.sql",
    "migrations/V284__timesheet_training_helicopter_down.sql",
    "migrations/run.js",
    "src/routes/timesheet-v2.js",
    "src/routes/field-stages.js",
    "src/routes/tenders-registry.js",
    "src/routes/files.js",
    "public/assets/js/registry_api.js",
    "public/assets/js/registry_tab.js",
    "public/assets/js/registry_detail.js",
    "public/assets/js/rp_review_modal.js",
    "public/assets/js/timesheet-v2.js",
    "public/assets/js/admin-timesheet-settings.js",
    "public/assets/js/app.js",
    "public/assets/css/timesheet-types-tokens.css",
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


def build_v2():
    v2 = ROOT / "public" / "desktop-v2-src"
    if os.environ.get("SKIP_V2_BUILD") == "1":
        print("=== Skip desktop-v2 build (SKIP_V2_BUILD=1) ===")
        return
    print("=== Build desktop-v2 ===")
    npm = "npm.cmd" if os.name == "nt" else "npm"
    subprocess.run([npm, "run", "build"], cwd=str(v2), check=True, shell=(os.name == "nt"))


def main():
    if not KEY.exists():
        print(f"ERROR: SSH key not found: {KEY}", file=sys.stderr)
        sys.exit(1)

    build_v2()

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== Upload files ===")
    for rel in UPLOAD:
        local = ROOT / rel
        if not local.exists():
            print("SKIP missing", rel)
            continue
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print("  uploaded", rel)

    v2_out = ROOT / "public" / "v2"
    if v2_out.is_dir():
        n = upload_tree(sftp, v2_out, f"{PROJECT}/public/v2")
        print(f"  uploaded public/v2 ({n} files)")
    else:
        print("ERROR: public/v2 missing after build", file=sys.stderr)
        sys.exit(1)

    m_app = ROOT / "public" / "mobile-app" / "src" / "pages" / "timesheet" / "TimesheetMobile.jsx"
    if m_app.exists():
        remote = f"{PROJECT}/public/mobile-app/src/pages/timesheet/TimesheetMobile.jsx"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(m_app), remote)
        print("  uploaded mobile TimesheetMobile.jsx (source; rebuild mobile bundle separately if needed)")

    sftp.close()

    def run(cmd, timeout=180):
        print(f"$ {cmd[:220]}")
        _, o, e = c.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", errors="replace").strip()
        err = e.read().decode("utf-8", errors="replace").strip()
        if out:
            print(out)
        if err:
            print(err)
        return out, err

    print("\n=== Migrations (npm run migrate) ===")
    run(
        f"cd {PROJECT} && "
        "DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=asgard_crm DB_USER=asgard DB_PASSWORD=123456789 "
        "node migrations/run.js",
        timeout=300,
    )

    print("\n=== Verify V284 position_points ===")
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "
        "\"SELECT type, points FROM position_points WHERE type IN ('training','helicopter') ORDER BY type;\""
    )

    print("\n=== Restart asgard-crm ===")
    run("systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm")

    print("\n=== Health ===")
    run("curl -s http://localhost:3000/api/version")

    c.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
