#!/usr/bin/env python3
"""Upload cache-busted shell + key fixes to prod (no restart)."""
import io
import os
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]

UPLOAD = [
    "public/index.html",
    "public/sw.js",
    "public/offline.html",
    "public/assets/css/app.css",
    "public/assets/css/rp-review-modal.css",
    "public/assets/js/app.js",
    "public/assets/js/ui.js",
    "public/assets/js/personnel.js",
    "public/assets/js/employee.js",
    "public/assets/js/registry_tab.js",
    "public/assets/js/registry_detail.js",
    "public/assets/js/registry_api.js",
    "public/assets/js/rp_review_modal.js",
    "public/assets/js/components/doc-preview-modal.js",
    "public/assets/js/loss_reason_modal.js",
    "public/assets/js/pm_duty.js",
    "public/assets/js/tenders.js",
    "public/assets/js/permits.js",
    "public/registry-action-mockup.html",
    "public/rp-review-modal-mockup.html",
    "src/index.js",
    "src/routes/field-gamification.js",
    "src/services/call-report-generator.js",
    "src/routes/tenders-registry.js",
    "migrations/V279__rp_review_analysis_phase.sql",
    "migrations/V280__rp_review_report_file.sql",
    "migrations/V281__registry_review_notify_seen.sql",
    "src/services/rp-review-notify.js",
    "src/services/rp-review-thread-notify.js",
    "tools/backfill_analysis_phase.js",
    "tools/backfill_registry_no.js",
    "tools/fix_stuck_calculator_after_analysis.js",
    "tools/fix_premature_calculator_assignment.js",
    "migrations/V283__registry_no_and_review_thread.sql",
    "src/routes/pm-duty.js",
    "src/routes/personal-kanban.js",
    "src/services/tender-registry-helpers.js",
    "src/routes/staff.js",
    "src/routes/worker-readiness.js",
    "src/routes/permits.js",
]

V2_DIR = "public/v2"
M_DIR = "public/m"


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
        rel = item.relative_to(local_dir).as_posix()
        remote = f"{remote_dir}/{rel}"
        if item.is_dir():
            ensure_dir(sftp, remote)
        else:
            ensure_dir(sftp, os.path.dirname(remote))
            sftp.put(str(item), remote)
            count += 1
    return count


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()
    for rel in UPLOAD:
        local = ROOT / rel
        if not local.exists():
            print("SKIP", rel)
            continue
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print("  uploaded", rel)
    v2_local = ROOT / V2_DIR
    if v2_local.is_dir():
        n = upload_tree(sftp, v2_local, f"{PROJECT}/{V2_DIR}")
        print(f"  uploaded public/v2 ({n} files)")
    else:
        print("WARN: public/v2 missing — run npm run build in desktop-v2-src")
    m_local = ROOT / M_DIR
    if m_local.is_dir():
        n = upload_tree(sftp, m_local, f"{PROJECT}/{M_DIR}")
        print(f"  uploaded public/m ({n} files)")
    else:
        print("WARN: public/m missing — run npm run build in public/mobile-app")
    sftp.close()
    print("\n=== Restart asgard-crm ===")
    _, o, e = c.exec_command("systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm", timeout=60)
    status = o.read().decode().strip()
    err = e.read().decode().strip()
    print("service:", status or err or "(unknown)")
    mig = f"{PROJECT}/migrations/V279__rp_review_analysis_phase.sql"
    print("\n=== Migration V279 ===")
    _, o, e = c.exec_command(
        f"sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 -f {mig}",
        timeout=60,
    )
    out = o.read().decode().strip()
    err = e.read().decode().strip()
    if out:
        print(out)
    if err and "ERROR" in err.upper():
        print("migration err:", err)
    else:
        print("migration V279: ok")
    mig280 = f"{PROJECT}/migrations/V280__rp_review_report_file.sql"
    print("\n=== Migration V280 ===")
    _, o, e = c.exec_command(
        f"sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 -f {mig280}",
        timeout=60,
    )
    out280 = o.read().decode().strip()
    err280 = e.read().decode().strip()
    if out280:
        print(out280)
    if err280 and "ERROR" in err280.upper():
        print("migration V280 err:", err280)
    else:
        print("migration V280: ok")
    mig281 = f"{PROJECT}/migrations/V281__registry_review_notify_seen.sql"
    print("\n=== Migration V281 ===")
    _, o, e = c.exec_command(
        f"sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 -f {mig281}",
        timeout=60,
    )
    out281 = o.read().decode().strip()
    err281 = e.read().decode().strip()
    if out281:
        print(out281)
    if err281 and "ERROR" in err281.upper():
        print("migration V281 err:", err281)
    else:
        print("migration V281: ok")
    mig283 = f"{PROJECT}/migrations/V283__registry_no_and_review_thread.sql"
    print("\n=== Migration V283 ===")
    _, o, e = c.exec_command(
        f"sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 -f {mig283}",
        timeout=120,
    )
    out283 = o.read().decode().strip()
    err283 = e.read().decode().strip()
    if out283:
        print(out283)
    if err283 and "ERROR" in err283.upper():
        print("migration V283 err:", err283)
    else:
        print("migration V283: ok")
    _, o, _ = c.exec_command(
        f"cd {PROJECT} && DATABASE_URL=postgresql://asgard:123456789@localhost/asgard_crm node tools/backfill_registry_no.js",
        timeout=120,
    )
    bf2 = o.read().decode().strip()
    if bf2:
        print("backfill registry_no:", bf2[:800])
    _, o, _ = c.exec_command(
        f"cd {PROJECT} && DATABASE_URL=postgresql://asgard:123456789@localhost/asgard_crm node tools/backfill_analysis_phase.js",
        timeout=120,
    )
    bf = o.read().decode().strip()
    if bf:
        print("backfill:", bf[:800])
    _, o, e = c.exec_command(
        f"cd {PROJECT} && DATABASE_URL=postgresql://asgard:123456789@localhost/asgard_crm node tools/fix_stuck_calculator_after_analysis.js",
        timeout=120,
    )
    fix_out = o.read().decode().strip()
    fix_err = e.read().decode().strip()
    if fix_out:
        print("fix stuck calculator:", fix_out[:800])
    if fix_err:
        print("fix err:", fix_err[:400])
    _, o, e = c.exec_command(
        f"cd {PROJECT} && DATABASE_URL=postgresql://asgard:123456789@localhost/asgard_crm node tools/fix_premature_calculator_assignment.js",
        timeout=120,
    )
    pre_out = o.read().decode().strip()
    pre_err = e.read().decode().strip()
    if pre_out:
        print("fix premature calculator:", pre_out[:800])
    if pre_err:
        print("fix premature err:", pre_err[:400])
    _, o, _ = c.exec_command("curl -s http://localhost:3000/api/version", timeout=30)
    print("api/version:", o.read().decode().strip())
    with open(ROOT / "public" / "sw.js", encoding="utf-8") as f:
        import re
        sw_ver = re.search(r"SHELL_VERSION\s*=\s*'([^']+)'", f.read())
    if sw_ver:
        print("local SHELL_VERSION:", sw_ver.group(1))
    _, o, _ = c.exec_command(
        "grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" /var/www/asgard-crm/public/index.html | head -1",
        timeout=30,
    )
    print("prod index.html:", o.read().decode().strip())
    c.close()
    print("done")


if __name__ == "__main__":
    main()
