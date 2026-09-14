#!/usr/bin/env python3
"""Pull last 24h asgard-crm logs related to Jose / Gorshkov / project assign."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"


def run(c, cmd, timeout=180):
    print("====", cmd[:100], "====")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    if out:
        print(out[-12000:] if len(out) > 12000 else out)
    if err.strip():
        print("STDERR:", err[:2000])


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)

    run(c, "journalctl -u asgard-crm --since '24 hours ago' --no-pager | wc -l")
    run(
        c,
        "journalctl -u asgard-crm --since '24 hours ago' --no-pager -o cat "
        "| grep -iE 'горшков|gorshkov|хосе|jose|уже на|уже назнач|planned-engagement|worker_busy|current.?project|/crew' "
        "| tail -n 100"
    )
    run(
        c,
        "journalctl -u asgard-crm --since '24 hours ago' --no-pager -o cat "
        "| grep -iE 'error|exception|failed| E |ERR' "
        "| grep -viE 'favicon|Deprecation|node_modules' "
        "| tail -n 150"
    )
    run(
        c,
        r"""sudo -u postgres psql -d asgard_crm -c "
SELECT id, name, login, role FROM users
WHERE name ILIKE '%хосе%' OR name ILIKE '%jose%' OR login ILIKE '%jose%'
   OR name ILIKE '%горшков%' OR name ILIKE '%gorshkov%'
ORDER BY id;"
"""
    )
    run(
        c,
        r"""sudo -u postgres psql -d asgard_crm -c "
SELECT e.id, e.full_name, e.status
FROM employees e
WHERE e.full_name ILIKE '%горшков%' OR e.full_name ILIKE '%gorshkov%'
LIMIT 10;"
"""
    )
    run(
        c,
        r"""sudo -u postgres psql -d asgard_crm -c "
SELECT ea.id, ea.employee_id, e.full_name, ea.work_id, w.work_title, ea.is_active, ea.departure_date, ea.date_from, ea.date_to, ea.updated_at
FROM employee_assignments ea
JOIN employees e ON e.id = ea.employee_id
LEFT JOIN works w ON w.id = ea.work_id
WHERE e.full_name ILIKE '%горшков%'
ORDER BY ea.id DESC
LIMIT 15;"
"""
    )
    run(
        c,
        r"""sudo -u postgres psql -d asgard_crm -c "
SELECT pe.id, pe.employee_id, e.full_name, pe.work_id, w.work_title, pe.status, pe.planned_from, pe.planned_to, pe.updated_at, pe.created_at
FROM employee_planned_engagements pe
JOIN employees e ON e.id = pe.employee_id
LEFT JOIN works w ON w.id = pe.work_id
WHERE e.full_name ILIKE '%горшков%'
ORDER BY pe.id DESC
LIMIT 15;"
"""
    )
    # HTTP access if nginx has it
    run(
        c,
        "ls -lt /var/log/nginx 2>/dev/null | head -10; "
        "zgrep -h 'planned-engagements\\|/crew\\|/available' /var/log/nginx/access.log /var/log/nginx/access.log.1 2>/dev/null "
        "| grep -E '17/Jul/2026|16/Jul/2026' | tail -n 80"
    )
    c.close()


if __name__ == "__main__":
    main()
