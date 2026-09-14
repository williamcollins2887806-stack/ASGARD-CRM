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
SELECT t.id, t.registry_status, t.calculator_kind, t.calculator_user_id,
       rev.analysis_finalized_at IS NOT NULL AS analysis_done, rev.is_final
FROM tenders t
LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
WHERE t.id = 15
   OR (t.calculator_kind = 'to' AND COALESCE(t.registry_status, 'рассмотрение') = 'рассмотрение'
       AND (rev.analysis_finalized_at IS NULL OR rev.id IS NULL))
ORDER BY t.id
"""
cmd = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"{sql.strip()}\""
_, o, e = c.exec_command(cmd, timeout=60)
print(o.read().decode("utf-8", errors="replace"))
print(e.read().decode("utf-8", errors="replace"))
c.close()
