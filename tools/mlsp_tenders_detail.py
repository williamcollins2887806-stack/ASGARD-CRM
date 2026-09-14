#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

IDS = "776,863,1237,1439,1579,1733,1734,1750,1751,1781,1826,1841"

SQL = f"""
SELECT id, registry_no, period, registry_status, tender_status, customer_name,
       tender_title, tender_price, submission_price, created_by, calculator_user_id,
       responsible_pm_id, work_assigned_pm_id, created_at::date
FROM tenders WHERE id IN ({IDS}) ORDER BY id;

SELECT t.id, rev.id AS rev_id, rev.is_final, rev.analysis_finalized_at,
       rev.director_review_status, rev.work_price, rev.calculator_user_id
FROM tenders t
LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
WHERE t.id IN ({IDS}) ORDER BY t.id;
"""

def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
    c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root", pkey=key, timeout=30)
    cmd = f'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "{SQL.strip()}"'
    _, o, e = c.exec_command(cmd, timeout=120)
    print(o.read().decode("utf-8", errors="replace"))
    if e.read().strip(): print("ERR", e.read())
    c.close()

if __name__ == "__main__":
    main()
