#!/usr/bin/env python3
import io
import sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=key, timeout=30)

cmds = [
    # nginx 409/4xx for staff/field today
    r"""grep -E '17/Jul/2026' /var/log/nginx/access.log | grep -E 'planned-engagements|/crew|/available|/field/manage' | grep -E ' (409|400|403|500) ' | tail -n 80""",
    r"""grep -E '17/Jul/2026|16/Jul/2026' /var/log/nginx/access.log /var/log/nginx/access.log.1 2>/dev/null | grep -E 'planned-engagements|/crew' | grep -E ' (409|400|403|500|201|200) ' | tail -n 120""",
    # audit / readiness log for gorshkov today
    r"""sudo -u postgres psql -d asgard_crm -c "
SELECT id, employee_id, old_status, new_status, comment, source, changed_by, created_at
FROM worker_readiness_log
WHERE employee_id = 63 AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY id DESC LIMIT 30;" """,
    r"""sudo -u postgres psql -d asgard_crm -c "
SELECT id, actor_user_id, entity_type, entity_id, action, payload_json, created_at
FROM audit_log
WHERE created_at >= NOW() - INTERVAL '2 days'
  AND (
    actor_user_id = 3460
    OR (payload_json::text ILIKE '%горшков%')
    OR (payload_json::text ILIKE '%\"employee_id\": 63%' OR payload_json::text ILIKE '%\"employee_id\":63%')
    OR entity_id IN (63, 354, 404)
  )
ORDER BY id DESC LIMIT 40;" """,
    # work titles + pm for 354/404
    r"""sudo -u postgres psql -d asgard_crm -c "
SELECT w.id, left(w.work_title,80), w.pm_id, u.name AS pm_name, w.work_status
FROM works w LEFT JOIN users u ON u.id=w.pm_id
WHERE w.id IN (354,404);" """,
    # real app errors excluding IMAP noise
    r"""journalctl -u asgard-crm --since '24 hours ago' --no-pager -o cat | grep -iE 'error|exception|failed| EREQ|Unhandled|TypeError|ReferenceError' | grep -viE 'IMAP|MimirCron|LogMonitor|already_processed|errored=0|favicon|Deprecation|node_modules|Diagnostic' | sort | uniq -c | sort -rn | head -60""",
    # HTTP status summary for staff endpoints
    r"""grep -E '17/Jul/2026' /var/log/nginx/access.log | grep -oE '\"(GET|PUT|POST|DELETE) [^ ]+ HTTP/[^\"]+\" [0-9]+' | awk '{print $NF,$2}' | grep -E 'planned-engagement|/api/field/|/api/staff/' | sort | uniq -c | sort -rn | head -40""",
]
for cmd in cmds:
    print("====", cmd[:90].replace("\n", " "), "====")
    _, o, e = c.exec_command(cmd, timeout=180)
    print(o.read().decode("utf-8", errors="replace")[:10000])
    err = e.read().decode("utf-8", errors="replace").strip()
    if err:
        print("STDERR:", err[:1500])
c.close()
