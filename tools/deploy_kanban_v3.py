#!/usr/bin/env python3
"""Deploy personal-kanban v3 fixes + V285 to production."""
import io
import os
import re
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
    "public/assets/css/light-theme.css",
    "src/index.js",
    "src/routes/pre_tenders.js",
    "src/routes/personal-kanban.js",
    "src/services/personal-kanban-reminder-notify.js",
    "src/services/personal-kanban-reminders-cron.js",
    "src/services/pre-tender-doc-folders.js",
    "migrations/V285__reminder_contact_fields.sql",
    "nginx.conf",
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


def patch_prod_nginx(c):
    """Ensure client_max_body_size and proxy_request_buffering off on /api/."""
    cmds = [
        "NG=$(ls /etc/nginx/sites-enabled/*asgard* /etc/nginx/conf.d/*asgard* 2>/dev/null | head -1); "
        "if [ -z \"$NG\" ]; then NG=/etc/nginx/sites-enabled/default; fi; echo \"nginx file: $NG\"; cat \"$NG\"",
    ]
    _, o, _ = c.exec_command(cmds[0], timeout=30)
    conf = o.read().decode("utf-8", "replace")
    print("--- prod nginx snippet (location /api/) ---")
    for line in conf.splitlines():
        if "location" in line or "client_max_body" in line or "proxy_request_buffering" in line or "proxy_pass" in line:
            print(line)

    patch_script = r"""
set -e
NG=$(ls /etc/nginx/sites-enabled/*asgard* /etc/nginx/conf.d/*asgard* 2>/dev/null | head -1)
if [ -z "$NG" ]; then NG=/etc/nginx/sites-enabled/default; fi
cp "$NG" "${NG}.bak-kanban-$(date +%Y%m%d%H%M)"
python3 - <<'PY'
from pathlib import Path
import re, os
ng = os.environ.get('NG')
path = Path(ng)
text = path.read_text(encoding='utf-8')
changed = False
if 'client_max_body_size' not in text:
    text = text.replace('http {', 'http {\n    client_max_body_size 200m;', 1)
    changed = True
if re.search(r'location\s+/api/', text) and 'proxy_request_buffering off' not in text:
    text = re.sub(
        r'(location\s+/api/\s*\{)',
        r'\1\n        client_max_body_size 200m;\n        proxy_request_buffering off;',
        text,
        count=1,
    )
    changed = True
if changed:
    path.write_text(text, encoding='utf-8')
    print('patched', ng)
else:
    print('nginx already ok', ng)
PY
nginx -t && systemctl reload nginx && echo nginx_reload_ok
"""
    env = "NG=$(ls /etc/nginx/sites-enabled/*asgard* /etc/nginx/conf.d/*asgard* 2>/dev/null | head -1); "
    _, o, e = c.exec_command(
        env + "export NG; " + patch_script.replace("os.environ.get('NG')", "os.environ['NG']"),
        timeout=60,
    )
    out = (o.read() + e.read()).decode("utf-8", "replace")
    print(out)


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    print("=== Upload kanban files ===")
    for rel in UPLOAD:
        local = ROOT / rel
        if not local.exists():
            print("SKIP (missing)", rel)
            continue
        remote = f"{PROJECT}/{rel.replace(os.sep, '/')}"
        ensure_dir(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        print("  uploaded", rel)
    sftp.close()

    print("\n=== Migration V285 ===")
    mig = f"{PROJECT}/migrations/V285__reminder_contact_fields.sql"
    _, o, e = c.exec_command(
        f"sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 -f {mig}",
        timeout=60,
    )
    out = o.read().decode().strip()
    err = e.read().decode().strip()
    if out:
        print(out)
    if err and "ERROR" in err.upper() and "already exists" not in err.lower():
        print("migration err:", err)
    else:
        print("migration V285: ok")

    print("\n=== Restart asgard-crm ===")
    _, o, e = c.exec_command("systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm", timeout=60)
    print("service:", (o.read() + e.read()).decode().strip())

    print("\n=== Nginx upload tuning ===")
    try:
        patch_prod_nginx(c)
    except Exception as ex:
        print("nginx patch skipped:", ex)

    print("\n=== Verify markers ===")
    _, o, _ = c.exec_command(
        "grep personal_kanban /var/www/asgard-crm/public/index.html; "
        "grep -c '_stkSize\\|pk3-sticky-board\\|_uploadDocFiles' /var/www/asgard-crm/public/assets/js/personal_kanban.js; "
        "curl -s http://localhost:3000/api/version",
        timeout=30,
    )
    print(o.read().decode().strip())

    c.close()
    print("\ndone")


if __name__ == "__main__":
    main()
