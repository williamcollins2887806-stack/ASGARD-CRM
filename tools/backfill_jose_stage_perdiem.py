#!/usr/bin/env python3
"""Report + optional soft-link of José/TO stage marks to unique active assignment.

Does NOT invent fake work_id when ambiguous.
Does NOT create worker_payments (accrual is formula-only via getPerDiemDays).
"""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"

SQL_REPORT = r"""
-- Stage days that count for per diem (any type)
SELECT
  COUNT(*) FILTER (WHERE work_id IS NULL) AS orphan_rows,
  COUNT(*) FILTER (WHERE work_id IS NOT NULL) AS with_work,
  COUNT(*) AS total_active_stages
FROM field_trip_stages
WHERE COALESCE(status,'active') NOT IN ('cancelled','rejected')
  AND stage_type IN ('warehouse','medical','travel','ship','training','helicopter','waiting');

SELECT stage_type, COUNT(*) FILTER (WHERE work_id IS NULL) AS orphan,
       COUNT(*) AS total
FROM field_trip_stages
WHERE COALESCE(status,'active') NOT IN ('cancelled','rejected')
  AND stage_type IN ('warehouse','medical','travel','ship','training','helicopter','waiting')
GROUP BY 1 ORDER BY 1;
"""

SQL_SOFT_LINK = r"""
-- Soft-link orphan stages to unique active assignment (exactly 1 active work)
WITH candidates AS (
  SELECT fts.id AS stage_id, ea.work_id
  FROM field_trip_stages fts
  JOIN LATERAL (
    SELECT work_id
    FROM employee_assignments
    WHERE employee_id = fts.employee_id
      AND COALESCE(is_active, true) = true
  ) ea ON true
  WHERE fts.work_id IS NULL
    AND COALESCE(fts.status,'active') NOT IN ('cancelled','rejected')
    AND fts.stage_type IN ('warehouse','medical','travel','ship','training','helicopter','waiting')
),
unique_ones AS (
  SELECT stage_id, MIN(work_id) AS work_id
  FROM candidates
  GROUP BY stage_id
  HAVING COUNT(DISTINCT work_id) = 1
)
UPDATE field_trip_stages fts
SET work_id = u.work_id, updated_at = NOW()
FROM unique_ones u
WHERE fts.id = u.stage_id
RETURNING fts.id, fts.employee_id, fts.stage_type, fts.date_from, fts.work_id;
"""


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)

    def run(sql, label):
        print(f"=== {label} ===")
        _, o, e = c.exec_command(
            f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 <<'SQL'\n{sql}\nSQL",
            timeout=120,
        )
        print(o.read().decode())
        err = e.read().decode()
        if err:
            print("stderr:", err[-1500:])

    run(SQL_REPORT, "BEFORE report")
    run(SQL_SOFT_LINK, "Soft-link unique orphans")
    run(SQL_REPORT, "AFTER report")
    c.close()
    print("DONE — accrual comes from getPerDiemDays after backend deploy (no payment backfill)")


if __name__ == "__main__":
    main()
