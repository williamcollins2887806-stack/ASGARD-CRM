#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
SQL = """
SELECT id, login, name, role FROM users
WHERE LOWER(name) LIKE '%андрос%' OR LOWER(login) LIKE '%andro%' OR LOWER(login) LIKE '%андр%';

SELECT t.id, t.calculator_kind, calc.name AS calc_name, cb.name AS created_by,
       rev.is_final, rev.analysis_finalized_at, rev.finalized_by_user_id, fin.name AS finalized_by,
       rev.started_by_user_id, st.name AS started_by, rev.calculator_user_id, rc.name AS rev_calc
FROM tenders t
LEFT JOIN users calc ON calc.id = t.calculator_user_id
LEFT JOIN users cb ON cb.id = t.created_by
LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
LEFT JOIN users fin ON fin.id = rev.finalized_by_user_id
LEFT JOIN users st ON st.id = rev.started_by_user_id
LEFT JOIN users rc ON rc.id = rev.calculator_user_id
WHERE t.id = 1868;

SELECT action, created_at, u.name FROM tender_rp_review_log l
JOIN tender_rp_reviews r ON r.id = l.review_id
LEFT JOIN users u ON u.id = l.actor_user_id
WHERE r.tender_id = 1868 ORDER BY l.created_at;
"""
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)
sftp = c.open_sftp()
with sftp.file("/tmp/q.sql","w") as f: f.write(SQL)
sftp.close()
_, o, _ = c.exec_command("sudo -u postgres psql -d asgard_crm -f /tmp/q.sql", timeout=30)
print(o.read().decode())
c.close()
