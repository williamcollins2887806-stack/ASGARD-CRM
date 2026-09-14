#!/usr/bin/env python3
import io, sys
from pathlib import Path
import paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

QUERIES = [
    ("Tenders detail", """
SELECT t.id, t.registry_no, t.registry_status, t.period,
       to_char(t.created_at,'YYYY-MM-DD') created,
       cb.name creator, calc.name calculator,
       to_char(t.won_at,'YYYY-MM-DD') won
FROM tenders t
LEFT JOIN users cb ON cb.id=t.created_by
LEFT JOIN users calc ON calc.id=t.calculator_user_id
WHERE t.id IN (776,1579,1439,1237,1750,1924,1925) ORDER BY t.id
"""),
    ("RP Reviews", """
SELECT r.tender_id, r.is_final, r.work_price, r.director_review_status,
       d.name director, calc.name calculator
FROM tender_rp_reviews r
LEFT JOIN users d ON d.id=r.director_review_by_user_id
LEFT JOIN users calc ON calc.id=r.calculator_user_id
WHERE r.tender_id IN (776,1579,1439,1237,1750,1924,1925) ORDER BY r.tender_id
"""),
    ("Works", """
SELECT w.id, w.tender_id, LEFT(w.work_title,55) title, u.name pm, w.contract_value
FROM works w JOIN users u ON u.id=w.pm_id
WHERE w.tender_id IN (776,1579,1439,1237,1750,1924,1925) AND w.deleted_at IS NULL
ORDER BY w.tender_id
"""),
]

def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
    c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root", pkey=key, timeout=30)
    for title, sql in QUERIES:
        print(f"\n=== {title} ===")
        cmd = 'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "' + sql.strip().replace('"', '\\"') + '"'
        _, o, _ = c.exec_command(cmd, timeout=60)
        print(o.read().decode("utf-8", errors="replace"))
    c.close()

if __name__ == "__main__":
    main()
