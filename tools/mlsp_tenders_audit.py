#!/usr/bin/env python3
"""Audit MLSP Приразломная tenders and works on production CRM."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SQL_USERS = r"""
SELECT id, name, login, role FROM users
WHERE name ILIKE '%трухин%' OR name ILIKE '%андросов%' OR name ILIKE '%климакин%'
   OR name ILIKE '%хосе%' OR name ILIKE '%вилявисенсио%'
   OR login IN ('hv','a.trukhin','n.androsov','d.klimakin')
ORDER BY id;
"""

SQL_TENDERS = r"""
SELECT t.id, t.registry_no, t.period, t.registry_status, t.tender_status,
       LEFT(t.tender_title, 90) AS title,
       t.responsible_pm_id, t.calculator_user_id, t.created_by,
       t.work_assigned_pm_id, t.tender_price, t.submission_price,
       w.id AS work_id, LEFT(w.work_title, 70) AS work_title, w.pm_id AS work_pm_id, w.work_status
FROM tenders t
LEFT JOIN works w ON w.tender_id = t.id AND w.deleted_at IS NULL
WHERE t.deleted_at IS NULL
  AND (
    t.tender_title ILIKE '%приразлом%'
    OR t.customer_name ILIKE '%шельф%'
    OR t.tender_title ILIKE '%млсп%'
  )
  AND (
    t.tender_title ILIKE '%подогреват%'
    OR t.tender_title ILIKE '%теплообмен%'
    OR t.tender_title ILIKE '%химическ%промыв%'
    OR t.tender_title ILIKE '%промывк%'
    OR t.tender_title ILIKE '%деаэратор%'
    OR t.tender_title ILIKE '%каусорб%'
    OR t.tender_title ILIKE '%факельн%'
    OR t.tender_title ILIKE '%оголов%'
    OR t.tender_title ILIKE '%емкост%'
    OR t.tender_title ILIKE '%танк%'
    OR t.tender_title ILIKE '%буров%'
    OR t.tender_title ILIKE '%восстановительн%'
    OR t.tender_title ILIKE '%технологическ%комплекс%'
  )
ORDER BY t.id;
"""

SQL_WORKS = r"""
SELECT w.id, w.tender_id, LEFT(w.work_title, 90) AS work_title, w.work_status, w.pm_id, u.name AS pm_name
FROM works w
LEFT JOIN users u ON u.id = w.pm_id
WHERE w.deleted_at IS NULL
  AND (
    w.work_title ILIKE '%приразлом%'
    OR w.work_title ILIKE '%млсп%'
    OR w.work_title ILIKE '%подогреват%'
    OR w.work_title ILIKE '%деаэратор%'
    OR w.work_title ILIKE '%каусорб%'
    OR w.work_title ILIKE '%оголов%'
    OR w.work_title ILIKE '%емкост%'
    OR w.work_title ILIKE '%танк%'
    OR w.work_title ILIKE '%буров%'
    OR w.work_title ILIKE '%восстановительн%'
    OR w.work_title ILIKE '%теплообмен%'
  )
ORDER BY w.id;
"""


def run_sql(client, sql, label):
    print(f"\n=== {label} ===")
    cmd = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"{sql.strip()}\""
    _, stdout, stderr = client.exec_command(cmd, timeout=120)
    print(stdout.read().decode("utf-8", errors="replace"))
    err = stderr.read().decode("utf-8", errors="replace")
    if err.strip():
        print("STDERR:", err)


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("92.242.61.184", username="root", pkey=key, timeout=30)
    run_sql(client, SQL_USERS, "USERS")
    run_sql(client, SQL_TENDERS, "TENDERS")
    run_sql(client, SQL_WORKS, "WORKS")
    client.close()


if __name__ == "__main__":
    main()
