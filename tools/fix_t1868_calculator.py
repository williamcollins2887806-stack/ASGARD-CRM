#!/usr/bin/env python3
"""Fix calculator on #1868 to Androsov (PM who closed analysis)."""
import io, sys
from pathlib import Path
import paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
SQL = """
UPDATE tenders SET calculator_user_id = 3474, calculator_kind = 'pm', updated_at = NOW() WHERE id = 1868;
UPDATE tender_rp_reviews SET
  calculator_user_id = 3474,
  analysis_finalized_by_user_id = COALESCE(analysis_finalized_by_user_id, 3474),
  to_notify_at = COALESCE(to_notify_at, analysis_finalized_at),
  updated_at = NOW()
WHERE tender_id = 1868;
SELECT t.calculator_user_id AS t_calc, rev.calculator_user_id AS rev_calc, calc.name
FROM tenders t
JOIN tender_rp_reviews rev ON rev.tender_id = t.id
LEFT JOIN users calc ON calc.id = rev.calculator_user_id
WHERE t.id = 1868;
"""
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)
sftp = c.open_sftp()
with sftp.file("/tmp/fix_calc.sql","w") as f: f.write(SQL)
sftp.close()
_, o, _ = c.exec_command("sudo -u postgres psql -d asgard_crm -f /tmp/fix_calc.sql", timeout=30)
print(o.read().decode())
c.close()
