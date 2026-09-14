#!/usr/bin/env python3
import io
import json
import sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
SHELL = "20.27.31"

def run(c, cmd, timeout=120, allow_fail=False):
    print("====", cmd[:220].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-15000:] if len(out) > 15000 else out)
    if err.strip():
        print("STDERR:", err[:3000])
    if code != 0 and not allow_fail:
        raise SystemExit(f"FAILED ({code})")
    return code, out

def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    changes = [
        "Мимир-Quick опционально в анализе и просчёте РП",
        "Параллельные личные черновики РП — финал пишет хозяин фазы",
        "Optimistic lock финала + confirm для ADMIN/HEAD override",
        "Shell 20.27.31"
    ]
    sql = (
        "INSERT INTO app_updates (version, title, changes, target)\n"
        f"VALUES ('v{SHELL}', 'RP-review: Мимир и совместные черновики',\n"
        f"  '{json.dumps(changes, ensure_ascii=False)}'::jsonb, 'desktop')\n"
        "ON CONFLICT (version) DO UPDATE\n"
        "SET title = EXCLUDED.title, changes = EXCLUDED.changes, published_at = NOW();\n"
    )
    remote_sql = "/tmp/_banner_v20_27_31.sql"
    with sftp.file(remote_sql, "w") as f:
        f.write(sql)
    print("=== BANNER ===")
    run(c, f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {remote_sql}")

    print("\n=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm")

    print("\n=== SMOKE ===")
    run(
        c,
        f"curl -s -o /dev/null -w 'HOME=%{{http_code}}\\n' http://127.0.0.1:3000/; "
        f"curl -s -o /dev/null -w 'MODAL=%{{http_code}}\\n' 'http://127.0.0.1:3000/assets/js/rp_review_modal.js?v={SHELL}'; "
        f"curl -s -o /dev/null -w 'MIMIR=%{{http_code}}\\n' 'http://127.0.0.1:3000/assets/js/mimir_quick_wizard.js?v={SHELL}'; "
        f"curl -s -o /dev/null -w 'MYDRAFT=%{{http_code}}\\n' http://127.0.0.1:3000/api/tenders/1/rp-review/my-draft; "
        f"curl -s http://127.0.0.1:3000/api/version; echo; "
        f"grep -oP \"ASGARD_SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/index.html | head -1; "
        f"test -f {PROJECT}/src/routes/rp-review-collab.js && echo COLLAB=yes; "
        f"grep -c REVIEW_CONFLICT {PROJECT}/src/routes/pm-duty.js; "
        f"grep -c expected_updated_at {PROJECT}/public/assets/js/rp_review_modal.js; "
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        f"\"SELECT 'drafts='||to_regclass('public.tender_rp_review_participant_drafts');\"; "
        f"journalctl -u asgard-crm -n 80 --no-pager | tail -80",
        timeout=90,
    )
    sftp.close()
    c.close()
    print("\nDEPLOY_FINISH_OK")

if __name__ == "__main__":
    main()
