#!/usr/bin/env python3
import io
import sys
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY)), timeout=30)

def run(cmd):
    _, o, e = c.exec_command(cmd, timeout=30)
    return (o.read() + e.read()).decode("utf-8", errors="replace").strip()

print("=== Files on disk ===")
print(run("ls -la /var/www/asgard-crm/uploads/rp_estimates/1868/"))
print(run("ls -la /var/www/asgard-crm/uploads/rp_reports/1868/"))

sql = """
SELECT rev.decision, rev.is_final, rev.work_price,
       ef.original_name, ef.download_url,
       rf.original_name, rf.download_url,
       rev.report_json->>'feasibility' AS feas,
       rev.report_json->>'duration_days' AS days,
       array_length(rev.missing_info_flags, 1) AS missing_cnt
FROM tender_rp_reviews rev
LEFT JOIN documents ef ON ef.id = rev.estimate_file_id
LEFT JOIN documents rf ON rf.id = rev.report_file_id
WHERE rev.tender_id = 1868;
"""
sftp = c.open_sftp()
with sftp.file("/tmp/verify_segezh.sql", "w") as f:
    f.write(sql)
sftp.close()
print("\n=== DB ===")
print(run("sudo -u postgres psql -d asgard_crm -f /tmp/verify_segezh.sql"))

est_url = run(
    "sudo -u postgres psql -d asgard_crm -t -A -c "
    "\"SELECT download_url FROM documents WHERE id = "
    "(SELECT estimate_file_id FROM tender_rp_reviews WHERE tender_id=1868);\""
)
rep_url = run(
    "sudo -u postgres psql -d asgard_crm -t -A -c "
    "\"SELECT download_url FROM documents WHERE id = "
    "(SELECT report_file_id FROM tender_rp_reviews WHERE tender_id=1868);\""
)
print("\n=== HTTP ===")
print("estimate:", run(f"curl -s -o /dev/null -w '%{{http_code}}' http://localhost:3000{est_url.strip()}"))
print("report:", run(f"curl -s -o /dev/null -w '%{{http_code}}' http://localhost:3000{rep_url.strip()}"))
c.close()
