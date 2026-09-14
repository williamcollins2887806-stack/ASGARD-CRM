#!/usr/bin/env python3
import io
import sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
AID = 112

cmds = [
    f"""sudo -u postgres psql -d asgard_crm -c "
SELECT status, COUNT(*) cnt
FROM email_sync_log WHERE account_id={AID} AND started_at > NOW() - INTERVAL '7 days'
GROUP BY status ORDER BY cnt DESC;" """,
    f"""sudo -u postgres psql -d asgard_crm -c "
SELECT id, status, duration_ms, started_at, completed_at,
       LEFT(COALESCE(last_sync_error, error_details::text, ''), 120) AS err
FROM (
  SELECT l.*, a.last_sync_error
  FROM email_sync_log l
  LEFT JOIN email_accounts a ON a.id = l.account_id
  WHERE l.account_id={AID} AND l.status != 'success'
  ORDER BY l.id DESC LIMIT 20
) t;" """,
    f"""sudo -u postgres psql -d asgard_crm -c "
SELECT COUNT(*) AS emails FROM emails WHERE account_id={AID};" """,
    f"journalctl -u asgard-crm --since '7 days ago' --no-pager | grep 'Sync error account #{AID}' | tail -25",
    f"journalctl -u asgard-crm --since '7 days ago' --no-pager | grep 'Sync error account #{AID}' | wc -l",
    f"journalctl -u asgard-crm --since '7 days ago' --no-pager | grep 'Sync account #{AID}' | wc -l",
    "timeout 8 bash -c 'echo | openssl s_client -connect imap.yandex.ru:993 -servername imap.yandex.ru 2>&1' | head -5",
]

key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", pkey=key, timeout=30)
for cmd in cmds:
    print("---", cmd.strip()[:100], "---")
    _, o, e = c.exec_command(cmd, timeout=120)
    out = o.read().decode("utf-8", "replace").strip()
    err = e.read().decode("utf-8", "replace").strip()
    if out: print(out)
    if err: print("STDERR:", err)
    print()
c.close()
