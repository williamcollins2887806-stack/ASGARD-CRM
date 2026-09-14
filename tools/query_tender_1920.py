#!/usr/bin/env python3
import paramiko
from pathlib import Path

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=key, timeout=30)

queries = {
    "tender": """
SELECT t.id, t.registry_no, t.registry_status, t.tender_status, t.customer_name,
       t.created_by, t.created_by_user_id, t.calculator_user_id,
       u1.name AS created_by_name, u1.role AS created_by_role,
       u2.name AS created_by_user_name, u2.role AS created_by_user_role,
       u3.name AS calculator_name
FROM tenders t
LEFT JOIN users u1 ON u1.id = t.created_by
LEFT JOIN users u2 ON u2.id = t.created_by_user_id
LEFT JOIN users u3 ON u3.id = t.calculator_user_id
WHERE t.id = 1920;
""",
    "review": """
SELECT r.decision, r.is_final, r.analysis_finalized_at, r.started_by_user_id,
       u.name AS started_by_name, r.finalized_at, r.to_notify_at
FROM tender_rp_reviews r
LEFT JOIN users u ON u.id = r.started_by_user_id
WHERE r.tender_id = 1920;
""",
    "users": """
SELECT id, name, role, email FROM users
WHERE name ILIKE '%елис%' OR name ILIKE '%androsov%' OR name ILIKE '%андросов%';
""",
    "log": """
SELECT l.action, l.user_id, u.name, u.role, l.created_at
FROM tender_rp_review_log l
LEFT JOIN users u ON u.id = l.user_id
WHERE l.tender_id = 1920 ORDER BY l.created_at DESC LIMIT 20;
""",
    "messages": """
SELECT m.id, m.user_id, u.name, u.role, left(m.body,80) AS body, m.created_at
FROM tender_rp_review_messages m
LEFT JOIN users u ON u.id = m.user_id
WHERE m.tender_id = 1920 ORDER BY m.created_at DESC LIMIT 10;
""",
    "notifications": """
SELECT n.id, n.user_id, u.name, u.email, left(n.title,60), left(n.message,80), n.created_at
FROM notifications n
LEFT JOIN users u ON u.id = n.user_id
WHERE n.message ILIKE '%1920%' OR n.title ILIKE '%1920%'
ORDER BY n.created_at DESC LIMIT 15;
""",
}

for label, sql in queries.items():
    _, o, e = c.exec_command(
        f"sudo -u postgres psql -d asgard_crm -c \"{sql.replace(chr(10), ' ')}\"",
        timeout=30,
    )
    print(f"\n=== {label.upper()} ===")
    print(o.read().decode("utf-8", errors="replace"))
    err = e.read().decode("utf-8", errors="replace").strip()
    if err:
        print("ERR:", err)

c.close()
