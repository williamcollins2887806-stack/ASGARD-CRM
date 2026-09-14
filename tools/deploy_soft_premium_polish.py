#!/usr/bin/env python3
"""Deploy soft-premium polish: kanban + registry + contacts phone2 + reject parity."""
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
    "public/assets/js/personal_kanban.js",
    "public/assets/js/customers.js",
    "public/assets/js/registry_tab.js",
    "public/assets/js/rp_review_modal.js",
    "public/assets/css/light-theme.css",
    "public/assets/css/app.css",
    "src/routes/customers.js",
]

# Prefer shipping built desktop-v2 + mobile bundles if present
OPTIONAL_GLOBS = [
    "public/desktop-v2/**",
    "public/m/**",
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


def collect_optional():
    files = []
    # desktop-v2 dist typically copied into public/desktop-v2
    for base in ("public/v2", "public/m"):
        d = ROOT / base
        if not d.is_dir():
            continue
        for p in d.rglob("*"):
            if p.is_file() and "node_modules" not in p.parts:
                files.append(str(p.relative_to(ROOT)).replace("\\", "/"))
    return files


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    upload = list(UPLOAD)
    # Also upload source patches that React build embeds — plus built assets
    for rel in [
        "public/desktop-v2-src/src/pages/Tenders/registryTabHelpers.js",
        "public/desktop-v2-src/src/pages/Tenders/RegistryTab.jsx",
        "public/desktop-v2-src/src/pages/Tenders/api.js",
        "public/desktop-v2-src/src/pages/Tenders/modals/RpReviewModal.jsx",
        "public/desktop-v2-src/src/pages/Tenders/registry-tab.css",
        "public/desktop-v2-src/src/pages/Tenders/tenders.css",
        "public/desktop-v2-src/src/pages/Customers/contactsHelpers.js",
        "public/desktop-v2-src/src/pages/Customers/CustomerEditModal.jsx",
        "public/desktop-v2-src/src/pages/Customers/CustomerDetailModal.jsx",
        "public/desktop-v2-src/src/pages/Customers/CustomerContactEditModal.jsx",
        "public/mobile-app/src/api/tendersRegistry.js",
        "public/mobile-app/src/components/tenders/RegistryDetailSheet.jsx",
        "public/mobile-app/src/pages/Customers.jsx",
    ]:
        if (ROOT / rel).exists():
            upload.append(rel)

    upload.extend(collect_optional())
    # unique preserve order
    seen = set()
    final = []
    for r in upload:
        if r not in seen:
            seen.add(r)
            final.append(r)

    print("=== Upload (%d files) ===" % len(final))
    for rel in final:
        local = ROOT / rel
        if not local.exists():
            print("SKIP", rel)
            continue
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print("  ok", rel)
    sftp.close()

    print("\n=== Restart ===")
    _, o, e = c.exec_command(
        "systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm",
        timeout=60,
    )
    print((o.read() + e.read()).decode().strip())
    c.close()
    print("DONE soft-premium 20.26.96")


if __name__ == "__main__":
    main()
