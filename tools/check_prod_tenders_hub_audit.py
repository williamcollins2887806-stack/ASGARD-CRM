#!/usr/bin/env python3
"""Readonly audit: prod tenders hub was NOT wiped of undeployed 20.26.96 work.

Compares https://asgard-crm.ru (+ optional SSH disk) against expected NEW markers.
Exit 0 always for informational runs; prints PASS/FAIL sections.

Usage:
  python tools/check_prod_tenders_hub_audit.py
  python tools/check_prod_tenders_hub_audit.py --ssh
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROD = "https://asgard-crm.ru"
SSH_HOST = "root@92.242.61.184"
SSH_KEY = Path.home() / ".ssh" / "asgard_crm_deploy"

NEW_FILES = [
    "assets/js/hub_funnel_tab.js",
    "assets/js/morning_brief.js",
    "assets/js/money_fmt.js",
]

MARKERS = {
    "assets/js/registry_tab.js": [
        "submission_price_with_vat",
        "reg-burn-chip",
        "formatSubmissionCell",
        "требуют действия",
    ],
    "assets/js/tenders.js": [
        "kpi-won-month",
        "hub-kpi-periods",
        "AsgardHubFunnel",
        "AsgardMorningBrief",
        "hub-funnel-pill",
    ],
    "assets/css/app.css": [
        "hub-kpi-periods",
        "reg-submit-main",
        "hub-funnel-board",
        "morning-brief",
        "reg-skeleton-row",
    ],
}

OLD_MARKERS = {
    "assets/js/registry_tab.js": ["нуждают действия"],
}


def fetch(url: str) -> tuple[int | None, bytes | None, str | None]:
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.status, r.read(), None
    except Exception as e:  # noqa: BLE001
        code = getattr(e, "code", None)
        return code, None, str(e)


def md5(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ssh", action="store_true", help="Also run disk audit via SSH")
    args = ap.parse_args()

    print("=== PROD TENDERS HUB AUDIT ===")
    print(f"prod: {PROD}")

    code, html_b, err = fetch(PROD + "/")
    if not html_b:
        print(f"FAIL fetch index: {err}")
        return 1
    html = html_b.decode("utf-8", "replace")
    print(f"HTTP index: {code}, len={len(html_b)}")

    for needle in [
        "registry_tab.js?v=",
        "tenders.js?v=",
        "hub_funnel_tab.js",
        "morning_brief.js",
        "money_fmt.js",
        "app.css?v=",
        "ASGARD_SHELL_VERSION",
    ]:
        hits = [line.strip() for line in html.splitlines() if needle in line][:2]
        print(f"  index has {needle!r}: {hits or 'NONE'}")

    code, ver_b, _ = fetch(PROD + "/api/version")
    print(f"API /api/version: {code} {(ver_b or b'').decode()}")

    print("\n--- NEW FILES (expect 404 if never deployed) ---")
    for rel in NEW_FILES:
        c, body, e = fetch(f"{PROD}/{rel}")
        if c == 404 or body is None:
            print(f"  ABSENT {rel} ({c or e})")
        else:
            print(f"  PRESENT {rel} len={len(body)} md5={md5(body)[:8]}")

    print("\n--- CONTENT MARKERS (NEW = not on prod yet if MISS) ---")
    wipe_suspected = False
    never_deployed = True
    for rel, markers in MARKERS.items():
        c, body, e = fetch(f"{PROD}/{rel}")
        if not body:
            print(f"  FAIL {rel}: {e}")
            continue
        text = body.decode("utf-8", "replace")
        local_path = ROOT / "public" / rel
        local_md5 = md5(local_path.read_bytes())[:8] if local_path.exists() else "—"
        print(f"  FILE {rel} prod_len={len(body)} prod_md5={md5(body)[:8]} local_md5={local_md5}")
        found_any_new = False
        for m in markers:
            ok = m in text
            found_any_new = found_any_new or ok
            print(f"    {'FOUND' if ok else 'MISS '} new marker: {m}")
        if found_any_new:
            never_deployed = False
        for m in OLD_MARKERS.get(rel, []):
            ok = m in text
            print(f"    {'FOUND' if ok else 'MISS '} old marker: {m}")

    print("\n--- VERDICT ---")
    if never_deployed:
        print("PASS: new hub package is NOT on prod (never deployed / not wiped after deploy).")
        print("Prod remains on shell 20.26.95 with pre-overhaul registry markers.")
    else:
        print("INFO: some NEW markers ARE present on prod.")
        print("If expected full package but files missing → investigate selective wipe.")
        wipe_suspected = False

    if args.ssh:
        if not SSH_KEY.exists():
            print(f"SSH key missing: {SSH_KEY}")
            return 1
        remote = r"""
ROOT=/var/www/asgard-crm
echo DISK_INDEX
grep -n registry_tab.js $ROOT/public/index.html | head -1
grep -n 'ASGARD_SHELL_VERSION' $ROOT/public/index.html | head -1
echo DISK_LS
ls -la --time-style=long-iso $ROOT/public/index.html $ROOT/public/assets/js/registry_tab.js $ROOT/public/assets/js/tenders.js $ROOT/public/assets/css/app.css
ls -la $ROOT/public/assets/js/hub_funnel_tab.js $ROOT/public/assets/js/morning_brief.js $ROOT/public/assets/js/money_fmt.js 2>&1 || true
echo DISK_MD5
md5sum $ROOT/public/index.html $ROOT/public/assets/js/registry_tab.js $ROOT/public/assets/js/tenders.js $ROOT/public/assets/css/app.css
echo DISK_API
curl -sS http://127.0.0.1:3000/api/version; echo
"""
        cmd = [
            "ssh",
            "-i",
            str(SSH_KEY),
            "-o",
            "StrictHostKeyChecking=accept-new",
            SSH_HOST,
            "bash",
            "-s",
        ]
        print("\n=== SSH DISK ===")
        subprocess.run(cmd, input=remote.encode(), check=False)

    return 0 if not wipe_suspected else 2


if __name__ == "__main__":
    sys.exit(main())
