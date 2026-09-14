#!/usr/bin/env python3
"""
Дозаполнение подтверждённых планов привлечения (prod).

  python tools/apply_confirmed_plans.py --dry-run
  python tools/apply_confirmed_plans.py --apply
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from datetime import date, datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
REPORT = Path(__file__).resolve().parent / "planned_import_report.json"
SSH_KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
CREATED_BY = 3460

# Подтверждённые сопоставления (Шепеткин #356 — без work_id, пропускаем)
CONFIRMED = [
    {"employee_id": 241, "work_id": 404, "excel_row": 14, "label": "Пономарев А.В."},
    {"employee_id": 68, "work_id": 404, "excel_row": 23, "label": "Гусев А.М."},  # row 23 в отчёте
    {"employee_id": 69, "work_id": 405, "excel_row": 34, "label": "Гусев В.Д"},
    {"employee_id": 35, "work_id": 404, "excel_row": 13, "label": "Блазуцкий И.И."},
]


def load_report_rows() -> dict[int, dict]:
    data = json.loads(REPORT.read_text(encoding="utf-8"))
    return {item["row"]: item for item in data if isinstance(item, dict) and "row" in item}


def build_plans(report_by_row: dict[int, dict]) -> list[dict]:
    plans = []
    for c in CONFIRMED:
        row = report_by_row.get(c["excel_row"])
        if not row:
            plans.append({**c, "status": "row_not_found", "planned_from": None, "planned_to": None})
            continue
        plans.append({
            **c,
            "project_raw": row.get("project_raw") or "",
            "planned_from": row.get("planned_from"),
            "planned_to": row.get("planned_to"),
            "employee_fio_db": row.get("employee_fio_db"),
            "work_title_db": row.get("work_title_db"),
            "status": "ok",
            "notes": [],
        })
    return plans


def check_prod(client: paramiko.SSHClient, plans: list[dict]) -> None:
    for p in plans:
        if p["status"] != "ok":
            continue
        eid, wid = p["employee_id"], p["work_id"]
        q_emp = (
            f"SELECT id, fio, readiness_status FROM employees WHERE id={eid} AND is_active=true;"
        )
        q_on_site = f"""
        SELECT ea.work_id FROM employee_assignments ea
        WHERE ea.employee_id={eid}
          AND COALESCE(ea.is_active, true)=true
          AND ea.departure_date IS NULL
        LIMIT 1;
        """
        q_existing = f"""
        SELECT pe.work_id, pe.planned_from, pe.planned_to
        FROM employee_planned_engagements pe
        WHERE pe.employee_id={eid} AND pe.status='active'
        LIMIT 1;
        """
        for label, sql in [("emp", q_emp), ("on_site", q_on_site), ("plan", q_existing)]:
            cmd = f'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -F"|" -c "{sql.strip()}"'
            _, stdout, _ = client.exec_command(cmd, timeout=30)
            out = stdout.read().decode("utf-8", errors="replace").strip()
            if label == "emp":
                if not out:
                    p["status"] = "employee_not_found"
                    p["notes"].append("сотрудник не найден в prod")
                else:
                    parts = out.split("|")
                    p["employee_fio_db"] = parts[1] if len(parts) > 1 else p.get("employee_fio_db")
            elif label == "on_site" and out:
                on_wid = int(out.split("|")[0])
                p["on_site_work_id"] = on_wid
                if on_wid == wid:
                    p["status"] = "skipped_on_site"
                    p["notes"].append(f"уже on_site на work#{wid}")
            elif label == "plan" and out:
                parts = out.split("|")
                p["existing_plan"] = {
                    "work_id": int(parts[0]),
                    "planned_from": parts[1] if len(parts) > 1 and parts[1] else None,
                    "planned_to": parts[2] if len(parts) > 2 and parts[2] else None,
                }


def apply_plans(client: paramiko.SSHClient, plans: list[dict]) -> int:
    applied = 0
    today = datetime.now().date().isoformat()
    for p in plans:
        if p["status"] != "ok":
            continue
        pf = f"'{p['planned_from']}'" if p.get("planned_from") else "NULL"
        pt = f"'{p['planned_to']}'" if p.get("planned_to") else "NULL"
        note = f"Подтверждённый план Excel row {p['excel_row']} ({today})"
        sql = f"""
        BEGIN;
        UPDATE employee_planned_engagements
          SET status='cancelled', cancelled_at=now(), cancelled_by={CREATED_BY}, updated_at=now()
          WHERE employee_id={p['employee_id']} AND status='active';
        INSERT INTO employee_planned_engagements
          (employee_id, work_id, planned_from, planned_to, note, status, created_by)
        VALUES (
          {p['employee_id']},
          {p['work_id']},
          {pf},
          {pt},
          '{note}',
          'active',
          {CREATED_BY}
        );
        INSERT INTO worker_readiness_log
          (employee_id, old_status, new_status, comment, source, changed_by)
        SELECT id, readiness_status, readiness_status,
               'planned_set: work #{p['work_id']} ({p.get("label", "")})', 'hr', {CREATED_BY}
        FROM employees WHERE id={p['employee_id']};
        COMMIT;
        """
        cmd = f'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -c "{sql.strip()}"'
        _, stdout, stderr = client.exec_command(cmd, timeout=60)
        err = stderr.read().decode("utf-8", errors="replace")
        if err and "ERROR" in err.upper():
            p["status"] = "apply_error"
            p["notes"].append(err[:300])
        else:
            p["status"] = "applied"
            applied += 1
    return applied


def print_report(plans: list[dict]) -> None:
    print(f"\n=== Подтверждённые планы: {len(plans)} ===\n")
    for p in plans:
        pf = p.get("planned_from") or "—"
        pt = p.get("planned_to") or "—"
        print(
            f"  {p.get('label','?'):22} emp#{p['employee_id']:5} → work#{p['work_id']} "
            f"| row {p['excel_row']} | {pf} … {pt} | {p['status']}"
        )
        for n in p.get("notes") or []:
            print(f"      ⚠ {n}")
        if p.get("existing_plan"):
            ex = p["existing_plan"]
            print(f"      (был план work#{ex['work_id']} {ex.get('planned_from') or '—'} … {ex.get('planned_to') or '—'})")


def main():
    parser = argparse.ArgumentParser(description="Применить подтверждённые планы привлечения")
    parser.add_argument("--dry-run", action="store_true", help="Только отчёт")
    parser.add_argument("--apply", action="store_true", help="Записать в prod БД")
    args = parser.parse_args()

    if not REPORT.exists():
        print(f"Отчёт не найден: {REPORT}")
        sys.exit(1)
    if not args.dry_run and not args.apply:
        print("Укажите --dry-run или --apply")
        sys.exit(1)

    report_by_row = load_report_rows()
    plans = build_plans(report_by_row)

    if not SSH_KEY.exists():
        print(f"SSH key not found: {SSH_KEY}")
        sys.exit(1)

    key = paramiko.Ed25519Key.from_private_key_file(str(SSH_KEY))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", pkey=key, timeout=30)

    check_prod(client, plans)
    print_report(plans)

    if args.apply:
        n = apply_plans(client, plans)
        print(f"\n=== Применено: {n} ===\n")
        print_report(plans)

    client.close()


if __name__ == "__main__":
    main()
