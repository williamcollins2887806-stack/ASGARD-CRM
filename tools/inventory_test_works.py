#!/usr/bin/env python3
"""Inventory test garbage works on prod."""
import io, sys
from pathlib import Path
import paramiko
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("92.242.61.184", username="root", pkey=key, timeout=30)

patterns = [
    "CASH-STMT-%",
    "BULK-SE-%",
    "MANUAL-%",
    "HEAD_TO can write works",
    "TO should not write works",
    "XSS body onload",
    "<marquee%",
    "<script>%",
    "'; SELECT version();--",
    "TEST_AUTO_%",
    "Unauth work creation",
    "patch test",
    "XML content-type test",
    "Octet-stream test",
]

def psql(sql):
    cmd = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"{sql}\""
    _, o, e = c.exec_command(cmd, timeout=120)
    return o.read().decode("utf-8", errors="replace")

print("=== Count by pattern ===")
for p in patterns:
    sql = f"SELECT COUNT(*) FROM works WHERE deleted_at IS NULL AND work_title LIKE '{p.replace(chr(39), chr(39)+chr(39))}'"
    if "%" not in p:
        sql = f"SELECT COUNT(*) FROM works WHERE deleted_at IS NULL AND work_title = '{p.replace(chr(39), chr(39)+chr(39))}'"
    out = psql(sql).strip().split("\n")[-2].strip() if True else ""
    print(f"{p}: {out}")

print("\n=== All test-like works (sample) ===")
sql = """
SELECT id, work_title, work_status, tender_id, pm_id, created_at::date
FROM works
WHERE deleted_at IS NULL
  AND (
    work_title LIKE 'CASH-STMT-%'
    OR work_title LIKE 'BULK-SE-%'
    OR work_title LIKE 'MANUAL-%'
    OR work_title IN ('HEAD_TO can write works', 'TO should not write works', 'XSS body onload')
    OR work_title LIKE '<marquee%'
    OR work_title LIKE '<script>%'
    OR work_title = '''; SELECT version();--'
    OR work_title LIKE 'TEST_AUTO_%'
  )
ORDER BY id
LIMIT 80
"""
print(psql(sql))

sql2 = "SELECT COUNT(*) FROM works WHERE deleted_at IS NULL AND (work_title LIKE 'CASH-STMT-%' OR work_title LIKE 'BULK-SE-%' OR work_title LIKE 'MANUAL-%' OR work_title IN ('HEAD_TO can write works', 'TO should not write works', 'XSS body onload') OR work_title LIKE '<marquee%' OR work_title LIKE '<script>%' OR work_title = '''; SELECT version();--' OR work_title LIKE 'TEST_AUTO_%')"
print("\n=== TOTAL matching ===")
print(psql(sql2))
c.close()
