#!/usr/bin/env python3
"""Fix Segezh #1868 price fields: split cost (no VAT) vs work price (with VAT)."""
import io
import sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"

SQL = """
UPDATE tender_rp_reviews
SET report_json = report_json
  || '{"cost_without_vat": 17990000, "price_range_min": null, "price_range_max": null}'::jsonb,
    updated_at = NOW()
WHERE tender_id = 1868;

SELECT work_price,
       report_json->>'cost_without_vat' AS cost_no_vat,
       report_json->>'price_range_min' AS range_min,
       report_json->>'price_range_max' AS range_max
FROM tender_rp_reviews WHERE tender_id = 1868;
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)
sftp = c.open_sftp()
with sftp.file("/tmp/fix_segezh_price.sql", "w") as f:
    f.write(SQL)
sftp.close()
_, o, e = c.exec_command("sudo -u postgres psql -d asgard_crm -f /tmp/fix_segezh_price.sql", timeout=30)
print(o.read().decode())
if e.read().decode().strip():
    print(e.read().decode())
c.close()
