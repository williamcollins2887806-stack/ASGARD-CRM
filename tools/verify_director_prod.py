#!/usr/bin/env python3
"""Verify director tender approval deployment on production."""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8")

HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
BASE = "https://asgard-crm.ru"


def ssh_run(c, cmd, timeout=60):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace").strip()
    err = e.read().decode("utf-8", "replace").strip()
    return out, err


def http_get(path, headers=None):
    req = urllib.request.Request(BASE + path, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read(500).decode("utf-8", "replace")
    except urllib.error.HTTPError as ex:
        body = ex.read(300).decode("utf-8", "replace")
        return ex.code, body


def main():
    results = []

    # --- SSH checks ---
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)

    checks = [
        ("migration_v286", f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c \"SELECT 1 FROM migrations WHERE name='V286__rp_director_review';\"", "1"),
        ("service_active", "systemctl is-active asgard-crm", "active"),
        ("pm_duty_queue", f"grep -c 'director-review-queue' {PROJECT}/src/routes/pm-duty.js", None),
        ("pm_duty_tkp", f"grep -c 'rp-review/tkp' {PROJECT}/src/routes/pm-duty.js", None),
        ("vanilla_js", f"test -f {PROJECT}/public/assets/js/director_tender_approvals.js && echo OK", "OK"),
        ("app_route", f"grep -c 'director-tender-approvals' {PROJECT}/public/assets/js/app.js", None),
        ("index_script", f"grep -c 'director_tender_approvals' {PROJECT}/public/index.html", None),
        ("shell_version_sw", f"grep SHELL_VERSION {PROJECT}/public/sw.js", "20.26.86"),
        ("director_seen_table", "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c \"SELECT to_regclass('public.tender_registry_director_seen');\"", "tender_registry_director_seen"),
        ("pending_count", "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c \"SELECT COUNT(*) FROM tender_rp_reviews WHERE director_review_status='pending';\"", None),
    ]

    for name, cmd, expect in checks:
        out, err = ssh_run(c, cmd)
        val = out or err
        ok = True
        if expect is not None:
            ok = expect in val
        elif name in ("pm_duty_queue", "pm_duty_tkp", "app_route", "index_script"):
            ok = val.isdigit() and int(val) > 0
        results.append({"check": name, "ok": ok, "value": val[:200]})

    # mobile bundle grep
    out, _ = ssh_run(c, f"grep -rl 'director-tender-approvals' {PROJECT}/public/mobile-app/dist/assets/*.js 2>/dev/null | wc -l")
    results.append({"check": "mobile_bundle_route", "ok": out.strip().isdigit() and int(out.strip()) > 0, "value": out.strip()})

    # desktop v2 bundle (route string in lazy chunk)
    out, _ = ssh_run(c, f"grep -rl 'director-tender-approvals' {PROJECT}/public/v2/assets/*.js 2>/dev/null | wc -l")
    results.append({"check": "desktop_v2_bundle", "ok": out.strip().isdigit() and int(out.strip()) > 0, "value": out.strip()})

    c.close()

    # --- HTTP public assets ---
    for path in [
        "/assets/js/director_tender_approvals.js",
        "/assets/js/rp_review_modal.js",
        "/assets/js/registry_api.js",
        "/sw.js",
    ]:
        code, body = http_get(path)
        ok = code == 200
        snippet = ""
        if path.endswith("director_tender_approvals.js") and ok:
            snippet = "AsgardDirectorTenderApprovalsPage" in body
            ok = ok and snippet
        if path.endswith("sw.js") and ok:
            ok = "20.26.86" in body
        results.append({"check": f"http_{path}", "ok": ok, "value": f"status={code}" + (", has_marker" if snippet else "")})

    # --- API without auth (expect 401) ---
    for path in [
        "/api/tenders/director-review-queue",
        "/api/tenders/director-review-queue/count",
    ]:
        code, body = http_get(path)
        ok = code in (401, 403)
        results.append({"check": f"api_{path}", "ok": ok, "value": f"status={code} (auth required)"})

    # print report
    print("=== PRODUCTION VERIFICATION: Director Tender Approvals ===\n")
    failed = []
    for r in results:
        mark = "OK" if r["ok"] else "FAIL"
        print(f"[{mark}] {r['check']}: {r['value']}")
        if not r["ok"]:
            failed.append(r["check"])

    print()
    if failed:
        print(f"FAILED ({len(failed)}): {', '.join(failed)}")
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    main()
