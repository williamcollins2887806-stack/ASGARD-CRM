#!/usr/bin/env python3
"""READ-ONLY диагностика: почему пропал блок «⚫ Уехали / убраны с объекта».

Запросы только SELECT. Ничего не пишет в БД и не трогает файлы на проде.
"""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"

SQL = r"""
\echo === WORKS (Азот / Огневой подогреватель / 354) ===
SELECT id, work_title, work_status, pm_id, start_plan, end_plan, end_fact
FROM works
WHERE deleted_at IS NULL
  AND (id = 354 OR work_title ILIKE '%огнев%подогрев%' OR work_title ILIKE '%азот%')
ORDER BY id;

\echo === FIELD SETTINGS этих работ ===
SELECT fps.work_id, fps.site_category, fps.is_active,
       w.work_title
FROM field_project_settings fps
JOIN works w ON w.id = fps.work_id
WHERE w.deleted_at IS NULL
  AND (w.id = 354 OR w.work_title ILIKE '%огнев%подогрев%' OR w.work_title ILIKE '%азот%')
ORDER BY fps.work_id;

\echo === ASSIGNMENTS разбивка по работе: активные / is_active=false / departure_date ===
SELECT ea.work_id,
       COUNT(*) AS всего,
       COUNT(*) FILTER (WHERE COALESCE(ea.is_active,true) = true AND ea.departure_date IS NULL) AS active_ok,
       COUNT(*) FILTER (WHERE COALESCE(ea.is_active,true) = false) AS is_active_false,
       COUNT(*) FILTER (WHERE ea.departure_date IS NOT NULL) AS with_departure,
       COUNT(*) FILTER (WHERE COALESCE(ea.is_active,true) = true AND ea.departure_date IS NOT NULL) AS active_but_departed
FROM employee_assignments ea
JOIN works w ON w.id = ea.work_id
WHERE w.deleted_at IS NULL
  AND (w.id = 354 OR w.work_title ILIKE '%огнев%подогрев%' OR w.work_title ILIKE '%азот%')
GROUP BY ea.work_id
ORDER BY ea.work_id;

\echo === ASSIGNMENTS 354 подробно (кто «уехал») ===
SELECT ea.id, ea.employee_id, e.fio, ea.is_active, ea.departure_date,
       LEFT(COALESCE(ea.departure_reason,''), 60) AS reason, ea.date_from
FROM employee_assignments ea
JOIN employees e ON e.id = ea.employee_id
WHERE ea.work_id = 354
ORDER BY ea.is_active DESC NULLS FIRST, ea.departure_date NULLS LAST, e.fio;

\echo === БОГДАНОВИЧ ===
SELECT id, fio, readiness_status, readiness_updated_at
FROM employees
WHERE fio ILIKE '%богданович%';

\echo === ЯКОВЛЕВ (РП) ===
SELECT id, name, login, role, email FROM users WHERE name ILIKE '%яковлев%' OR login ILIKE '%yakovlev%';

\echo === READINESS смен по 354 (если колонка есть) ===
SELECT column_name FROM information_schema.columns
WHERE table_name = 'employee_assignments' ORDER BY ordinal_position;
"""


def run(client, sql):
    remote = "/tmp/asgard_diag_crew.sql"
    sftp = client.open_sftp()
    with sftp.file(remote, "w") as f:
        f.write(sql)
    sftp.close()
    _, o, e = client.exec_command(f"sudo -u postgres psql -d asgard_crm -f {remote}", timeout=90)
    return o.read().decode(), e.read().decode()


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    out, err = run(c, SQL)
    print(out)
    if err.strip():
        print("--- stderr ---")
        print(err[:2000])
    c.close()


if __name__ == "__main__":
    main()
