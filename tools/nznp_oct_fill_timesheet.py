#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Дозаполнение табеля НЗНП (work_id=424) за октябрь 2026 по Excel Яковлева.

Источник: tools/_nznp_oct_excel.json (лист «Табель октябрь»).
По умолчанию dry-run на asgard_crm. Запись: --apply --allow-prod.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import psycopg2
import psycopg2.extras

WORK_ID = 424
YEAR, MONTH = 2026, 10
POINT_VALUE = 500.0
NOTE = "nznp-excel-oct-2026 yakovlev fill"
ENTERED_BY = 3466  # Яковлев Антон (РП)

# Excel ФИО → employee_id
EMP_MAP = {
    "Яковлев Антон Анатольевич": 9939,
    "Климакин Дмитрий Владимирович": 130,
    "Фомина Екатерина Дмитриевна": 331,
    "Погребняков Сергей Владимирович": 237,
    "Дьяченко Владислав Владимирович": 82,
    "Андрющенко Константин Евгеньевич": 9869,
    "Горшков Иван Александрович": 63,
    "Державин Алексей Михайлович": 10211,
    "Емельяненко Николай Евгеньевич": 85,
    "Круглов Николай Александрович": 10030,
    "Крючкин Сергей Владимирович": 150,
    "Пономарев Алексей Владимирович": 241,
    "Портнов Андрей Александрович": 247,
    "Якупов Ильяс Ильясович": 376,
}

# Кого добавить в бригаду (роль)
CREW_ADD = {
    9939: "project_lead",  # Яковлев
    130: "project_lead",   # Климакин
}

ROOT = Path(__file__).resolve().parent
EXCEL_JSON = ROOT / "_nznp_oct_excel.json"


def connect(dbname: str):
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "127.0.0.1"),
        port=int(os.environ.get("PGPORT", "5432")),
        user=os.environ.get("PGUSER", "asgard"),
        password=os.environ.get("PGPASSWORD", "123456789"),
        dbname=dbname,
    )


def assert_db(dbname: str, allow_prod: bool):
    if dbname == "asgard_crm_test":
        return
    if dbname == "asgard_crm" and allow_prod:
        return
    raise SystemExit(f"REFUSE: db={dbname!r}. Нужен asgard_crm_test или --allow-prod")


def load_excel():
    data = json.loads(EXCEL_JSON.read_text(encoding="utf-8"))
    out = {}
    for fio, days in data.items():
        parsed = {}
        for d, v in days.items():
            day = int(d)
            if isinstance(v, str):
                parsed[day] = v.strip().lower()
            else:
                parsed[day] = float(v)
        out[fio] = parsed
    return out


def infer_shift(pts: float, existing_shift: str | None) -> str:
    if existing_shift == "night":
        return "night"
    if abs(pts - 6.0) < 0.05:
        return "travel"
    return "day"


def hours_for(shift: str) -> float:
    if shift in ("travel", "road", "standby"):
        return 0.0
    return 11.0


def ensure_crew(cur, apply: bool):
    actions = []
    for eid, role in CREW_ADD.items():
        cur.execute(
            """
            SELECT id, is_active, field_role FROM employee_assignments
             WHERE employee_id=%s AND work_id=%s
             ORDER BY id DESC LIMIT 1
            """,
            (eid, WORK_ID),
        )
        row = cur.fetchone()
        if row and row["is_active"]:
            actions.append({"employee_id": eid, "action": "already_active", "asg": row["id"]})
            continue
        if row:
            actions.append({"employee_id": eid, "action": "reactivate", "asg": row["id"], "role": role})
            if apply:
                cur.execute(
                    """
                    UPDATE employee_assignments SET
                      is_active=true, field_role=%s,
                      departure_date=NULL, departure_reason=NULL,
                      inactivity_warned_at=NULL, inactivity_auto_departed_at=NULL,
                      updated_at=NOW()
                    WHERE id=%s
                    """,
                    (role, row["id"]),
                )
        else:
            actions.append({"employee_id": eid, "action": "insert", "role": role})
            if apply:
                cur.execute(
                    """
                    INSERT INTO employee_assignments (
                      employee_id, work_id, field_role, is_active,
                      date_from, manual_extra_points, combo_tariff_ids, manual_extra_rub,
                      created_at, updated_at
                    ) VALUES (
                      %s, %s, %s, true,
                      %s::date, 0, '{}'::int[], 0,
                      NOW(), NOW()
                    )
                    """,
                    (eid, WORK_ID, role, date(YEAR, MONTH, 1)),
                )
    return actions


def load_assignments(cur):
    cur.execute(
        """
        SELECT ea.id AS assignment_id, ea.employee_id, e.fio, ea.is_active
          FROM employee_assignments ea
          JOIN employees e ON e.id=ea.employee_id
         WHERE ea.work_id=%s
         ORDER BY ea.is_active DESC, ea.id DESC
        """,
        (WORK_ID,),
    )
    by_emp = {}
    for r in cur.fetchall():
        if r["employee_id"] not in by_emp:
            by_emp[r["employee_id"]] = dict(r)
    return by_emp


def load_checkins(cur):
    cur.execute(
        """
        SELECT id, employee_id, date, shift, amount_earned, status
          FROM field_checkins
         WHERE work_id=%s
           AND date BETWEEN %s AND %s
           AND status <> 'cancelled'
        """,
        (WORK_ID, date(YEAR, MONTH, 1), date(YEAR, MONTH, 31)),
    )
    by = defaultdict(dict)
    for r in cur.fetchall():
        by[r["employee_id"]][r["date"].day] = dict(r)
    return by


def load_stages(cur, employee_ids):
    cur.execute(
        """
        SELECT id, employee_id, work_id, stage_type, date_from, date_to,
               amount_earned, tariff_points, rate_per_day, status
          FROM field_trip_stages
         WHERE employee_id = ANY(%s)
           AND date_from BETWEEN %s AND %s
           AND COALESCE(status,'active') NOT IN ('rejected','cancelled')
        """,
        (list(employee_ids), date(YEAR, MONTH, 1), date(YEAR, MONTH, 31)),
    )
    by = defaultdict(dict)
    for r in cur.fetchall():
        # одна активная отметка на день (берём первую)
        d = r["date_from"].day
        if d not in by[r["employee_id"]]:
            by[r["employee_id"]][d] = dict(r)
    return by


def pts_of(amount) -> float:
    if amount is None:
        return 0.0
    return round(float(amount) / POINT_VALUE, 2)


def build_plan(excel, assignments, checkins, stages):
    updates = []
    creates = []
    stage_upserts = []
    cancels = []
    report = []

    for fio, days in excel.items():
        eid = EMP_MAP.get(fio)
        row = {
            "fio": fio,
            "employee_id": eid,
            "ok": 0,
            "fix": 0,
            "create": 0,
            "remote": 0,
            "cancel_extra": 0,
            "errors": [],
        }
        if not eid:
            row["errors"].append("no_emp_map")
            report.append(row)
            continue
        asg = assignments.get(eid)
        if not asg or not asg.get("is_active"):
            # для Яковлева/Климакина ensure_crew сделает active до apply
            if eid not in CREW_ADD:
                row["errors"].append("no_active_assignment")
                report.append(row)
                continue

        ci = checkins.get(eid, {})
        st = stages.get(eid, {})

        for day, want in sorted(days.items()):
            d = date(YEAR, MONTH, day)
            if isinstance(want, str):
                # «р» → remote 0₽
                existing_ci = ci.get(day)
                existing_st = st.get(day)
                if existing_ci:
                    cancels.append(
                        {
                            "kind": "checkin",
                            "id": existing_ci["id"],
                            "employee_id": eid,
                            "day": day,
                            "reason": "replace_with_remote",
                        }
                    )
                if existing_st and existing_st["stage_type"] == "remote" and pts_of(existing_st.get("amount_earned")) == 0:
                    row["ok"] += 1
                    continue
                stage_upserts.append(
                    {
                        "employee_id": eid,
                        "assignment_id": asg["assignment_id"] if asg else None,
                        "day": day,
                        "date": d.isoformat(),
                        "existing_stage_id": existing_st["id"] if existing_st else None,
                        "cancel_stage_id": existing_st["id"]
                        if existing_st and existing_st["stage_type"] != "remote"
                        else None,
                    }
                )
                row["remote"] += 1
                continue

            want_pts = float(want)
            amount = round(want_pts * POINT_VALUE, 2)
            existing_ci = ci.get(day)
            existing_st = st.get(day)

            # если день закрыт stage (travel и т.п.) с нужными баллами — ок
            if not existing_ci and existing_st:
                got = pts_of(existing_st.get("amount_earned"))
                if abs(got - want_pts) < 0.05 and (
                    (want_pts == 6 and existing_st["stage_type"] == "travel")
                    or existing_st["stage_type"] in ("travel", "remote", "office")
                ):
                    row["ok"] += 1
                    continue
                # иначе stage мешает — отменим и поставим checkin
                cancels.append(
                    {
                        "kind": "stage",
                        "id": existing_st["id"],
                        "employee_id": eid,
                        "day": day,
                        "reason": "replace_with_checkin",
                    }
                )

            if existing_ci:
                got = pts_of(existing_ci.get("amount_earned"))
                shift = infer_shift(want_pts, existing_ci.get("shift"))
                if abs(got - want_pts) < 0.05 and existing_ci.get("shift") == shift:
                    row["ok"] += 1
                    continue
                # если баллы ок, но shift другой при pts!=6 — не трогаем shift night
                if abs(got - want_pts) < 0.05:
                    row["ok"] += 1
                    continue
                updates.append(
                    {
                        "checkin_id": existing_ci["id"],
                        "employee_id": eid,
                        "day": day,
                        "date": d.isoformat(),
                        "got": got,
                        "want": want_pts,
                        "shift": shift,
                        "hours": hours_for(shift),
                        "amount": amount,
                    }
                )
                row["fix"] += 1
            else:
                shift = infer_shift(want_pts, None)
                creates.append(
                    {
                        "employee_id": eid,
                        "assignment_id": (asg or {}).get("assignment_id"),
                        "day": day,
                        "date": d.isoformat(),
                        "want": want_pts,
                        "shift": shift,
                        "hours": hours_for(shift),
                        "amount": amount,
                    }
                )
                row["create"] += 1

        # лишние checkin на этой работе, которых нет в Excel
        for day, c in ci.items():
            if day not in days:
                cancels.append(
                    {
                        "kind": "checkin",
                        "id": c["id"],
                        "employee_id": eid,
                        "day": day,
                        "reason": "not_in_excel",
                        "pts": pts_of(c.get("amount_earned")),
                    }
                )
                row["cancel_extra"] += 1

        report.append(row)
    return report, updates, creates, stage_upserts, cancels


def apply_changes(cur, assignments, updates, creates, stage_upserts, cancels):
    stats = {"updated": 0, "created": 0, "remote": 0, "cancelled": 0, "errors": []}

    for it in cancels:
        try:
            if it["kind"] == "checkin":
                cur.execute(
                    """
                    UPDATE field_checkins
                       SET status='cancelled', updated_at=NOW(),
                           note=COALESCE(note,'') || ' | ' || %s
                     WHERE id=%s AND work_id=%s AND status<>'cancelled'
                    RETURNING id
                    """,
                    (NOTE + " cancel:" + it["reason"], it["id"], WORK_ID),
                )
            else:
                cur.execute(
                    """
                    UPDATE field_trip_stages
                       SET status='cancelled', updated_at=NOW(),
                           note=COALESCE(note,'') || ' | ' || %s
                     WHERE id=%s
                       AND COALESCE(status,'active') NOT IN ('rejected','cancelled')
                    RETURNING id
                    """,
                    (NOTE + " cancel:" + it["reason"], it["id"]),
                )
            if cur.fetchone():
                stats["cancelled"] += 1
        except Exception as e:
            stats["errors"].append({"cancel": it, "error": str(e)})

    for it in updates:
        try:
            cur.execute(
                """
                UPDATE field_checkins SET
                  shift=%s,
                  day_rate=%s,
                  amount_earned=%s,
                  hours_worked=%s,
                  hours_paid=%s,
                  entered_by_user_id=%s,
                  note=%s,
                  updated_at=NOW()
                WHERE id=%s AND work_id=%s AND employee_id=%s AND status<>'cancelled'
                RETURNING id
                """,
                (
                    it["shift"],
                    it["amount"],
                    it["amount"],
                    it["hours"],
                    it["hours"],
                    ENTERED_BY,
                    NOTE,
                    it["checkin_id"],
                    WORK_ID,
                    it["employee_id"],
                ),
            )
            if cur.fetchone():
                stats["updated"] += 1
        except Exception as e:
            stats["errors"].append({"update": it, "error": str(e)})

    for it in creates:
        asg_id = it.get("assignment_id")
        if not asg_id:
            asg = assignments.get(it["employee_id"])
            asg_id = asg and asg.get("assignment_id")
        if not asg_id:
            stats["errors"].append({"create": it, "error": "no_assignment"})
            continue
        # foreign day?
        cur.execute(
            """
            SELECT id, work_id FROM field_checkins
             WHERE employee_id=%s AND date=%s::date AND status<>'cancelled'
             LIMIT 1
            """,
            (it["employee_id"], it["date"]),
        )
        ex = cur.fetchone()
        if ex and ex["work_id"] != WORK_ID:
            stats["errors"].append(
                {"create": it, "error": f"foreign_work:{ex['work_id']}"}
            )
            continue
        if ex and ex["work_id"] == WORK_ID:
            # уже появился — обновим
            cur.execute(
                """
                UPDATE field_checkins SET
                  shift=%s, day_rate=%s, amount_earned=%s,
                  hours_worked=%s, hours_paid=%s,
                  entered_by_user_id=%s, note=%s, updated_at=NOW()
                WHERE id=%s
                """,
                (
                    it["shift"],
                    it["amount"],
                    it["amount"],
                    it["hours"],
                    it["hours"],
                    ENTERED_BY,
                    NOTE,
                    ex["id"],
                ),
            )
            stats["updated"] += 1
            continue
        try:
            cur.execute(
                """
                INSERT INTO field_checkins (
                  work_id, employee_id, assignment_id, date, shift,
                  checkin_at, hours_worked, hours_paid, day_rate, amount_earned,
                  status, checkin_source, checkin_by, entered_by_user_id, note
                ) VALUES (
                  %s, %s, %s, %s::date, %s,
                  (%s::date + TIME '08:00')::timestamptz, %s, %s, %s, %s,
                  'completed', 'pm_manual', %s, %s, %s
                )
                RETURNING id
                """,
                (
                    WORK_ID,
                    it["employee_id"],
                    asg_id,
                    it["date"],
                    it["shift"],
                    it["date"],
                    it["hours"],
                    it["hours"],
                    it["amount"],
                    it["amount"],
                    ENTERED_BY,
                    ENTERED_BY,
                    NOTE,
                ),
            )
            if cur.fetchone():
                stats["created"] += 1
        except Exception as e:
            stats["errors"].append({"create": it, "error": str(e)})

    for it in stage_upserts:
        try:
            if it.get("cancel_stage_id"):
                cur.execute(
                    """
                    UPDATE field_trip_stages
                       SET status='cancelled', updated_at=NOW(),
                           note=COALESCE(note,'') || ' | ' || %s
                     WHERE id=%s
                    """,
                    (NOTE + " replace→remote", it["cancel_stage_id"]),
                )
            if it.get("existing_stage_id") and not it.get("cancel_stage_id"):
                cur.execute(
                    """
                    UPDATE field_trip_stages SET
                      stage_type='remote',
                      work_id=%s,
                      tariff_points=0,
                      rate_per_day=0,
                      amount_earned=0,
                      status='completed',
                      source='manual',
                      entered_by_user_id=%s,
                      created_by=%s,
                      note=%s,
                      updated_at=NOW()
                    WHERE id=%s
                    RETURNING id
                    """,
                    (WORK_ID, ENTERED_BY, ENTERED_BY, NOTE, it["existing_stage_id"]),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO field_trip_stages (
                      employee_id, work_id, assignment_id, stage_type,
                      date_from, date_to, days_count,
                      tariff_points, rate_per_day, amount_earned,
                      status, source, created_by, entered_by_user_id, note
                    ) VALUES (
                      %s, %s, %s, 'remote',
                      %s::date, %s::date, 1,
                      0, 0, 0,
                      'completed', 'manual', %s, %s, %s
                    )
                    RETURNING id
                    """,
                    (
                        it["employee_id"],
                        WORK_ID,
                        it.get("assignment_id"),
                        it["date"],
                        it["date"],
                        ENTERED_BY,
                        ENTERED_BY,
                        NOTE,
                    ),
                )
            if cur.fetchone():
                stats["remote"] += 1
        except Exception as e:
            stats["errors"].append({"remote": it, "error": str(e)})

    return stats


def verify(cur, excel):
    cur.execute(
        """
        SELECT employee_id, date, amount_earned
          FROM field_checkins
         WHERE work_id=%s AND date BETWEEN %s AND %s AND status='completed'
        """,
        (WORK_ID, date(YEAR, MONTH, 1), date(YEAR, MONTH, 31)),
    )
    ci = defaultdict(dict)
    for r in cur.fetchall():
        ci[r["employee_id"]][r["date"].day] = pts_of(r["amount_earned"])

    cur.execute(
        """
        SELECT employee_id, date_from, stage_type, amount_earned
          FROM field_trip_stages
         WHERE employee_id = ANY(%s)
           AND date_from BETWEEN %s AND %s
           AND COALESCE(status,'active') NOT IN ('rejected','cancelled')
        """,
        (list(EMP_MAP.values()), date(YEAR, MONTH, 1), date(YEAR, MONTH, 31)),
    )
    st = defaultdict(dict)
    for r in cur.fetchall():
        st[r["employee_id"]][r["date_from"].day] = {
            "type": r["stage_type"],
            "pts": pts_of(r["amount_earned"]),
        }

    rows = []
    all_ok = True
    for fio, days in excel.items():
        eid = EMP_MAP[fio]
        excel_total = round(sum(v for v in days.values() if not isinstance(v, str)), 2)
        crm_total = round(sum(ci.get(eid, {}).values()), 2)
        # remote days count
        remote_days = [d for d, v in days.items() if isinstance(v, str)]
        remote_ok = 0
        remote_miss = []
        for d in remote_days:
            s = st.get(eid, {}).get(d)
            if s and s["type"] == "remote":
                remote_ok += 1
            else:
                remote_miss.append(d)
        mism = []
        for d, v in days.items():
            if isinstance(v, str):
                continue
            got = ci.get(eid, {}).get(d)
            if got is None:
                # maybe stage
                s = st.get(eid, {}).get(d)
                got = s["pts"] if s else None
            if got is None or abs(got - float(v)) >= 0.05:
                mism.append({"day": d, "want": v, "got": got})
        ok = not mism and not remote_miss and abs(crm_total - excel_total) < 0.05
        if not ok:
            all_ok = False
        rows.append(
            {
                "fio": fio,
                "excel_total": excel_total,
                "crm_total": crm_total,
                "remote_ok": remote_ok,
                "remote_miss": remote_miss,
                "mism_count": len(mism),
                "mism_sample": mism[:5],
                "ok": ok,
            }
        )
    return all_ok, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="asgard_crm")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--allow-prod", action="store_true")
    args = ap.parse_args()
    assert_db(args.db, args.allow_prod)

    excel = load_excel()
    conn = connect(args.db)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            crew_actions = ensure_crew(cur, apply=False)
            if args.apply:
                ensure_crew(cur, apply=True)
                conn.commit()

            assignments = load_assignments(cur)
            # после ensure_crew перечитать
            if args.apply:
                assignments = load_assignments(cur)

            checkins = load_checkins(cur)
            stages = load_stages(cur, EMP_MAP.values())
            report, updates, creates, stage_upserts, cancels = build_plan(
                excel, assignments, checkins, stages
            )

            summary = {
                "work_id": WORK_ID,
                "db": args.db,
                "apply": args.apply,
                "crew": crew_actions,
                "people": report,
                "counts": {
                    "updates": len(updates),
                    "creates": len(creates),
                    "remotes": len(stage_upserts),
                    "cancels": len(cancels),
                },
            }

            if not args.apply:
                print(json.dumps(summary, ensure_ascii=False, indent=2))
                print("DRY-RUN only. Для записи: --apply --allow-prod", file=sys.stderr)
                return

            # resolve assignment_ids for creates after crew ensure
            for it in creates:
                if not it.get("assignment_id"):
                    asg = assignments.get(it["employee_id"])
                    if asg:
                        it["assignment_id"] = asg["assignment_id"]
            for it in stage_upserts:
                if not it.get("assignment_id"):
                    asg = assignments.get(it["employee_id"])
                    if asg:
                        it["assignment_id"] = asg["assignment_id"]

            stats = apply_changes(cur, assignments, updates, creates, stage_upserts, cancels)
            conn.commit()
            ok, verify_rows = verify(cur, excel)
            out = {
                "summary_counts": summary["counts"],
                "apply_stats": stats,
                "verify_ok": ok,
                "verify": verify_rows,
            }
            print(json.dumps(out, ensure_ascii=False, indent=2))
            if not ok or stats["errors"]:
                sys.exit(2)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
