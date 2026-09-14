#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=key, timeout=30)
sql = """
SELECT t.id, t.registry_no, t.customer_name, t.registry_status,
       t.calculator_kind, t.calculator_user_id,
       rev.analysis_finalized_at IS NOT NULL AS analysis_done
FROM tenders t
LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
WHERE t.registry_no = 15 OR t.id = 1915
"""
cmd = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"{sql.strip()}\""
_, o, _ = c.exec_command(cmd, timeout=60)
print(o.read().decode("utf-8", errors="replace"))
sql2 = """
SELECT COUNT(*) FROM tenders t
LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
WHERE t.deleted_at IS NULL AND COALESCE(t.registry_status,'рассмотрение')='рассмотрение'
  AND COALESCE(t.calculator_kind,'')='to'
  AND (rev.analysis_finalized_at IS NULL OR rev.id IS NULL)
"""
cmd2 = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -c \"{sql2.strip()}\""
_, o, _ = c.exec_command(cmd2, timeout=60)
print("TO-self before analysis remaining:", o.read().decode().strip())
c.close()
