#!/usr/bin/env python3
"""Deploy tenders hub 20.26.97 to prod via SFTP (no git reset --hard)."""
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
VER = "20.26.97"

FILES = [
    # shell / cache
    "public/index.html",
    "public/sw.js",
    "public/offline.html",
    # hub CSS/JS
    "public/assets/css/app.css",
    "public/assets/js/money_fmt.js",
    "public/assets/js/hub_funnel_tab.js",
    "public/assets/js/morning_brief.js",
    "public/assets/js/registry_tab.js",
    "public/assets/js/registry_api.js",
    "public/assets/js/registry_detail.js",
    "public/assets/js/tenders.js",
    "public/assets/js/app.js",
    "public/assets/js/platform_tenders.js",
    "public/assets/js/pm_duty.js",
    "public/assets/js/rp_review_modal.js",
    # backend + migration
    "src/routes/tenders-registry.js",
    "src/services/tender-registry-helpers.js",
    "migrations/V293__tender_submission_amount.sql",
    # react sources (also ship built public/v2)
    "public/desktop-v2-src/src/lib/money.js",
    "public/desktop-v2-src/src/pages/Tenders/index.jsx",
    "public/desktop-v2-src/src/pages/Tenders/RegistryTab.jsx",
    "public/desktop-v2-src/src/pages/Tenders/registryTabHelpers.js",
    "public/desktop-v2-src/src/pages/Tenders/registry-tab.css",
    "public/desktop-v2-src/src/pages/Tenders/tenders.css",
    "public/desktop-v2-src/src/pages/Tenders/KpiCards.jsx",
    "public/desktop-v2-src/src/pages/Tenders/AlertBar.jsx",
    "public/desktop-v2-src/src/pages/Tenders/FunnelHubTab.jsx",
    "public/desktop-v2-src/src/pages/Tenders/MorningBriefHost.jsx",
    "public/desktop-v2-src/src/pages/Tenders/morning-brief.css",
    "public/desktop-v2-src/src/pages/Tenders/CustomerSuggestCell.jsx",
    "public/desktop-v2-src/src/pages/Tenders/modals/RegistryDetailModal.jsx",
    "public/desktop-v2-src/src/pages/Tenders/modals/RegistryLossModal.jsx",
    "public/desktop-v2-src/src/App.jsx",
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
    n = 0
    for item in local_dir.rglob("*"):
        rel = item.relative_to(local_dir).as_posix()
        remote = f"{remote_dir}/{rel}"
        if item.is_dir():
            ensure_dir(sftp, remote)
        else:
            ensure_dir(sftp, os.path.dirname(remote))
            sftp.put(str(item), remote)
            n += 1
    return n


def run(client, cmd, timeout=180):
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    code = stdout.channel.recv_exit_status()
    return code, out, err


def main():
    if not KEY.exists():
        print(f"ERROR: missing key {KEY}", file=sys.stderr)
        sys.exit(1)

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = client.open_sftp()

    print(f"=== Upload hub package {VER} ===")
    missing = []
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            missing.append(rel)
            print(f"  SKIP missing {rel}")
            continue
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print(f"  OK {rel}")

    v2 = ROOT / "public" / "v2"
    if v2.is_dir():
        n = upload_tree(sftp, v2, f"{PROJECT}/public/v2")
        print(f"  OK public/v2 ({n} files)")
    else:
        print("  WARN public/v2 missing")

    sftp.close()

    print("\n=== Migration V293 ===")
    code, out, err = run(
        client,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {PROJECT}/migrations/V293__tender_submission_amount.sql",
        timeout=60,
    )
    print(out or "(no stdout)")
    if err:
        print("stderr:", err)
    if code != 0:
        print(f"WARN migration exit {code}")

    print("\n=== Restart asgard-crm ===")
    code, out, err = run(
        client,
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm "
        "&& curl -sS http://127.0.0.1:3000/api/version",
        timeout=90,
    )
    print(out)
    if err:
        print("stderr:", err)

    print("\n=== app_updates banner ===")
    changes = (
        "Хаб тендеров: колонка Подача с НДС; KPI неделя/месяц; воронка на хабе; "
        "утренний брифинг; статус «подались» с суммой; polish реестра"
    )
    sql = (
        "INSERT INTO app_updates (version, changes, created_at) VALUES "
        f"('v{VER}', '{changes}', NOW());"
    )
    code, out, err = run(
        client,
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"{sql}\"",
        timeout=30,
    )
    print(out or err or f"exit {code}")

    print("\n=== Disk spot-check ===")
    code, out, err = run(
        client,
        "ROOT=/var/www/asgard-crm; "
        "grep -n ASGARD_SHELL_VERSION $ROOT/public/index.html | head -1; "
        "grep -n hub_funnel_tab $ROOT/public/index.html | head -1; "
        "grep -n morning_brief $ROOT/public/index.html | head -1; "
        "grep -n money_fmt $ROOT/public/index.html | head -1; "
        "ls -la $ROOT/public/assets/js/hub_funnel_tab.js "
        "$ROOT/public/assets/js/morning_brief.js "
        "$ROOT/public/assets/js/money_fmt.js; "
        "grep -c submission_price_with_vat $ROOT/public/assets/js/registry_tab.js; "
        "grep -c kpi-won-month $ROOT/public/assets/js/tenders.js; "
        "grep SHELL_VERSION $ROOT/public/sw.js | head -1",
        timeout=30,
    )
    print(out)
    if err:
        print("stderr:", err)

    client.close()
    if missing:
        print(f"\nMissing locally ({len(missing)}): {missing[:8]}")
    print("\nDONE")


if __name__ == "__main__":
    main()
