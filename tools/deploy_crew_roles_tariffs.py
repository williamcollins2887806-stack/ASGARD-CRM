#!/usr/bin/env python3
"""Deploy welder/PTO crew roles + tariff grid + numbering. Shell 20.27.52."""
import io
import os
import sys
import tarfile
import tempfile
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

BACKEND = [
    "src/lib/employee-role-tags.js",
    "src/routes/field-manage.js",
]

STATIC = [
    "public/assets/js/field-tab.js",
    "public/assets/js/personnel.js",
    "public/index.html",
    "public/sw.js",
]

MIG = "migrations/V313__field_tariff_welder_pto.sql"


def run(c, cmd, timeout=180):
    print("====", cmd[:200].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-8000:] if len(out) > 8000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:120]}")
    return out


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== SNAPSHOT ===")
    run(
        c,
        "mkdir -p /root/snapshots && "
        "SNAP=/root/snapshots/asgard-crm-pre-deploy-crew-roles-$(date +%Y%m%d-%H%M%S).tgz && "
        "(tar -czf \"$SNAP\" -C /var/www "
        "asgard-crm/src/routes/field-manage.js "
        "asgard-crm/public/assets/js/field-tab.js "
        "asgard-crm/public/assets/js/personnel.js "
        "asgard-crm/public/index.html asgard-crm/public/sw.js "
        "asgard-crm/public/v2 || true) && "
        "ls -lt /root/snapshots/asgard-crm-pre-deploy-crew-roles-* | head -2",
    )

    print("=== MIGRATION V313 ===")
    sftp.put(str(ROOT / MIG), f"/tmp/V313__field_tariff_welder_pto.sql")
    run(
        c,
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        "-f /tmp/V313__field_tariff_welder_pto.sql",
    )
    run(
        c,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
SELECT category,
       COUNT(*) FILTER (WHERE position_name LIKE 'Сварщик (%') AS welder,
       COUNT(*) FILTER (WHERE position_name LIKE 'ПТО (%') AS pto
FROM field_tariff_grid
WHERE is_active AND category IN ('mlsp','ground','ground_hard','warehouse')
GROUP BY category ORDER BY category;
" """,
    )

    print("=== UPLOAD BACKEND + STATIC ===")
    for rel in BACKEND + STATIC:
        local = ROOT / rel
        sftp.put(str(local), f"{PROJECT}/{rel}")
        print("  ok", rel)

    print("=== UPLOAD v2 (tar) ===")
    v2_local = ROOT / "public" / "v2"
    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = tmp.name
    with tarfile.open(tar_path, "w:gz") as tar:
        tar.add(str(v2_local), arcname="v2")
    remote_tar = "/tmp/asgard-v2-crew-roles.tgz"
    sftp.put(tar_path, remote_tar)
    os.unlink(tar_path)
    run(
        c,
        f"tar -xzf {remote_tar} -C {PROJECT}/public && "
        f"ls -lt {PROJECT}/public/v2/assets/*.js | head -3",
    )

    print("=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm")

    print("=== MARKERS ===")
    run(
        c,
        "grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" /var/www/asgard-crm/public/index.html; "
        "grep -n \"welder\\|mapRoleTagToFieldRole\\|row-num\" /var/www/asgard-crm/public/assets/js/field-tab.js | head -8; "
        "grep -n \"isValidFieldRole\\|welder\" /var/www/asgard-crm/src/routes/field-manage.js | head -5; "
        "grep -n \"ПТО\" /var/www/asgard-crm/src/lib/employee-role-tags.js | head -3",
    )

    sftp.close()
    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
