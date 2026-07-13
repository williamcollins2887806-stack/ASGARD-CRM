#!/usr/bin/env python3
"""Deploy registry v3 to prod — без перезапуска сервиса."""
import io
import os
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY_PATH = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

FILES = [
    "migrations/V278__registry_loss_fields.sql",
    "src/routes/pm-duty.js",
    "src/routes/tenders-registry.js",
    "public/assets/js/loss_reason_modal.js",
    "public/assets/js/registry_detail.js",
    "public/assets/js/registry_api.js",
    "public/assets/js/registry_tab.js",
    "public/assets/js/rp_review_modal.js",
    "public/assets/js/pm_duty.js",
    "public/assets/js/app.js",
    "public/assets/js/tenders.js",
    "public/assets/css/app.css",
    "public/index.html",
    "public/sw.js",
    "public/desktop-v2-src/src/pages/Tenders/RegistryTab.jsx",
    "public/desktop-v2-src/src/pages/Tenders/modals/RegistryLossModal.jsx",
    "public/desktop-v2-src/src/pages/Tenders/modals/RegistryDetailModal.jsx",
    "public/desktop-v2-src/src/pages/PmDuty/index.jsx",
]


def ensure_remote_dir(sftp, remote_dir):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def upload_tree(sftp, local_dir: Path, remote_dir: str):
    ensure_remote_dir(sftp, remote_dir)
    for item in local_dir.rglob("*"):
        rel = item.relative_to(local_dir).as_posix()
        remote = f"{remote_dir}/{rel}"
        if item.is_dir():
            ensure_remote_dir(sftp, remote)
        else:
            ensure_remote_dir(sftp, os.path.dirname(remote))
            sftp.put(str(item), remote)
            print(f"  v2 {rel}")


def main():
    if not KEY_PATH.exists():
        print(f"ERROR: key not found: {KEY_PATH}", file=sys.stderr)
        sys.exit(1)

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY_PATH))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = client.open_sftp()

    print("=== Upload files ===")
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            print(f"SKIP missing {rel}")
            continue
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_remote_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print(f"  {rel}")

    v2 = ROOT / "public" / "v2"
    if v2.is_dir():
        print("=== Upload public/v2 ===")
        upload_tree(sftp, v2, f"{PROJECT}/public/v2")
    else:
        print("WARN: public/v2 not found — run npm run build in desktop-v2-src")

    sftp.close()

    def run(cmd, timeout=120):
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", errors="replace").strip()
        err = stderr.read().decode("utf-8", errors="replace").strip()
        return out, err

    print("\n=== Migration V278 ===")
    mig = ROOT / "migrations/V278__registry_loss_fields.sql"
    mig_remote = f"{PROJECT}/migrations/V278__registry_loss_fields.sql"
    out, err = run(
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f {mig_remote} 2>&1"
    )
    print(out or err or "(ok)")

    print("\n=== Verify loss columns ===")
    out, _ = run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "
        "\"SELECT column_name FROM information_schema.columns "
        "WHERE table_name='tenders' AND column_name IN ('loss_winner_price','loss_reasons');\""
    )
    print(out)

    print("\n=== Done (без restart) ===")
    client.close()


if __name__ == "__main__":
    main()
