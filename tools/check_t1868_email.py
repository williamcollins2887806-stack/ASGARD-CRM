#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"

SQL = """
\\echo '=== Tender 1868 review ==='
SELECT rev.is_final, rev.decision, rev.to_notify_at, rev.finalized_by_user_id,
       fin.name AS finalized_by, rev.updated_at
FROM tender_rp_reviews rev
LEFT JOIN users fin ON fin.id = rev.finalized_by_user_id
WHERE rev.tender_id = 1868;

\\echo '=== TO owner (created_by) ==='
SELECT t.created_by, u.name, u.email, u.role
FROM tenders t
LEFT JOIN users u ON u.id = t.created_by
WHERE t.id = 1868;

\\echo '=== Review log (last 10) ==='
SELECT l.action, l.created_at, u.name, l.payload_json::text
FROM tender_rp_review_log l
JOIN tender_rp_reviews r ON r.id = l.review_id
LEFT JOIN users u ON u.id = l.actor_user_id
WHERE r.tender_id = 1868
ORDER BY l.created_at DESC
LIMIT 10;

\\echo '=== In-app notifications for TO owner ==='
SELECT n.id, n.title, n.message, n.created_at, n.is_read
FROM notifications n
JOIN tenders t ON t.id = 1868
WHERE n.user_id = t.created_by
ORDER BY n.created_at DESC
LIMIT 5;

\\echo '=== Outbound emails (recent, tender/segezh) ==='
SELECT id, subject, to_emails, snippet, email_date, sent_by_user_id
FROM emails
WHERE direction = 'outbound'
  AND (
    subject ILIKE '%1868%'
    OR subject ILIKE '%сегеж%'
    OR subject ILIKE '%отчёт%рп%'
    OR subject ILIKE '%анализ%рп%'
    OR body_text ILIKE '%#1868%'
  )
ORDER BY id DESC
LIMIT 10;

\\echo '=== Any outbound emails last 30 min ==='
SELECT id, subject, to_emails, email_date
FROM emails
WHERE direction = 'outbound'
  AND email_date > NOW() - INTERVAL '30 minutes'
ORDER BY id DESC
LIMIT 15;
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)
sftp = c.open_sftp()
with sftp.file("/tmp/check_email.sql", "w") as f:
    f.write(SQL)
sftp.close()
_, o, e = c.exec_command("sudo -u postgres psql -d asgard_crm -f /tmp/check_email.sql", timeout=60)
print(o.read().decode("utf-8", errors="replace"))
err = e.read().decode("utf-8", errors="replace")
if err.strip():
    print("ERR:", err[:800])
# journal for mail errors
_, o2, _ = c.exec_command(
    "journalctl -u asgard-crm --since '30 min ago' --no-pager 2>/dev/null | grep -iE 'rp-review email|email notify|sendMail|notify failed' | tail -20",
    timeout=30,
)
j = o2.read().decode("utf-8", errors="replace").strip()
if j:
    print("\n=== Service log (mail) ===\n", j)
c.close()
