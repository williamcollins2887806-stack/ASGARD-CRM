#!/usr/bin/env python3
"""Check create-work readiness + DB constraints for MLSP tenders."""
import io, sys, json
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

QUERIES = [
    ("Works unique on tender_id", """
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'works' AND indexdef ILIKE '%tender_id%';
"""),
    ("MLSP tenders work state", """
SELECT t.id, t.registry_no, t.registry_status, t.tender_status,
       t.work_assigned_pm_id,
       EXISTS(SELECT 1 FROM works w WHERE w.tender_id=t.id AND w.deleted_at IS NULL) AS has_work_row,
       (SELECT w.id FROM works w WHERE w.tender_id=t.id AND w.deleted_at IS NULL LIMIT 1) AS work_id,
       t.tender_price, t.submission_price, t.site_id AS tender_site_id,
       LENGTH(COALESCE(t.tender_title,'')) AS title_len,
       t.customer_name IS NOT NULL AS has_customer
FROM tenders t
WHERE t.deleted_at IS NULL AND t.id IN (776,1579,1439,1237,1750,1924,1925,1733)
ORDER BY t.id;
"""),
    ("Works columns check", """
SELECT w.id, w.tender_id, w.pm_id, w.work_title IS NOT NULL AS has_title,
       w.customer_name IS NOT NULL AS has_customer, w.site_id, w.object_name,
       w.work_kind, w.work_status
FROM works w
WHERE w.id IN (354,402,403,404,405,406,407) AND w.deleted_at IS NULL ORDER BY w.id;
"""),
    ("Tender 776 review + price", """
SELECT t.id, t.tender_price, t.submission_price, r.id review_id, r.is_final, r.work_price
FROM tenders t LEFT JOIN tender_rp_reviews r ON r.tender_id=t.id WHERE t.id=776;
"""),
    ("Site 1152", """
SELECT id, name, place FROM sites WHERE id=1152;
"""),
]

def run_sql(c, sql):
    cmd = 'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "' + sql.strip().replace('"', '\\"') + '"'
    _, o, e = c.exec_command(cmd, timeout=60)
    return o.read().decode("utf-8", errors="replace") + e.read().decode("utf-8", errors="replace")

def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
    c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root", pkey=key, timeout=30)
    for title, sql in QUERIES:
        print(f"\n=== {title} ===")
        print(run_sql(c, sql))
    c.close()

if __name__ == "__main__":
    main()
