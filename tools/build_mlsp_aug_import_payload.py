# -*- coding: utf-8 -*-
"""Build JSON payload for August MLSP timesheet import (no DB writes)."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import build_jul_aug_timesheet as b

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "_mlsp_aug_import_payload.json"
SKIP = {104}  # Иванейкин
POINT_VALUE = 500


def ymd(d: date) -> str:
    return d.isoformat()


def num_points(val):
    if val is None or val == "":
        return None
    try:
        n = float(val)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return int(n) if n == int(n) else n


def main():
    b.PE_BY = b.load_pe()
    colored = b.load_colored()
    checkins = b.load_checkins()
    stages = b.load_stages()
    jul_days = [date(2026, 7, d) for d in range(1, 32)]
    aug_days = list(range(1, 32))

    people = []
    skipped = []
    for n, short, eid, full in b.FIO_MAP:
        if eid in SKIP:
            skipped.append({"eid": eid, "short": short, "full": full, "reason": "Иванейкин — не вносим"})
            continue
        cp = colored[n]
        proposed, action, flag, note, first_plat, last_plat, src = b.propose(
            n, short, eid, full, cp, stages
        )
        dep_crm = b.crm_homebound_start(eid, stages, last_plat)
        still_on = bool(last_plat == 31)
        leave = date(2026, 8, dep_crm) if dep_crm else (
            None if still_on else (date(2026, 8, last_plat) if last_plat else None)
        )

        jul_by_work = {}
        for d in jul_days:
            _lab, _col, wid = b.jul_kind(eid, d, checkins, stages)
            if wid and wid != 353:
                jul_by_work.setdefault(wid, []).append(d)

        aug_shifts = []
        aug_by_work = {}
        for day in aug_days:
            val, _col, wid = b.aug_cell(cp, day, eid, proposed, checkins, stages)
            if not wid:
                continue
            pts = num_points(val)
            d = date(2026, 8, day)
            aug_by_work.setdefault(wid, []).append(d)
            if pts is None:
                continue
            aug_shifts.append({
                "date": ymd(d),
                "work_id": int(wid),
                "points": pts,
                "amount": int(pts * POINT_VALUE),
            })

        asg = b.CRM_ASG.get(eid) or {}
        last_work = proposed
        if not last_work and aug_by_work:
            last_d = max(d for ds in aug_by_work.values() for d in ds)
            for w, ds in aug_by_work.items():
                if last_d in ds:
                    last_work = w

        assignments = []
        works = sorted(set(jul_by_work) | set(aug_by_work))
        for wid in works:
            jul_ds = jul_by_work.get(wid) or []
            aug_ds = aug_by_work.get(wid) or []
            july_closed_this = (
                asg.get("work") == wid
                and asg.get("dep")
                and asg["dep"] < "2026-08-01"
            )
            if july_closed_this:
                if not aug_ds:
                    continue
                days = sorted(aug_ds)
                new_tour = True
            else:
                days = sorted(jul_ds + aug_ds)
                new_tour = False
            if not days:
                continue
            d0, d1 = days[0], days[-1]
            is_last = wid == last_work
            row = {
                "work_id": int(wid),
                "date_from": ymd(d0),
                "new_tour": new_tour,
            }
            if is_last and still_on:
                row.update(date_to=None, active=True, departure_date=None, reason=None)
            elif is_last:
                end = leave or d1
                row.update(
                    date_to=ymd(end),
                    active=False,
                    departure_date=ymd(end),
                    reason="съезд МЛСП (табель авг 2026)",
                )
            else:
                row.update(
                    date_to=ymd(d1),
                    active=False,
                    departure_date=ymd(d1),
                    reason=f"перевод на {last_work}" if last_work else "перевод с объекта",
                )
            assignments.append(row)

        people.append({
            "eid": eid,
            "short": short,
            "full": full,
            "proposed": proposed,
            "flag": flag,
            "still_on": still_on,
            "leave_date": ymd(leave) if leave else None,
            "first_plat": first_plat,
            "last_plat": last_plat,
            "assignments": assignments,
            "checkins": aug_shifts,
        })

    payload = {
        "point_value": POINT_VALUE,
        "skip": skipped,
        "people": people,
        "note": "backfill табель Хосе 08.2026",
        "merge_overlapping_stays": True,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    n_ci = sum(len(p["checkins"]) for p in people)
    n_as = sum(len(p["assignments"]) for p in people)
    print(f"people={len(people)} skip={len(skipped)} checkins={n_ci} assignment_rows={n_as}")
    print("saved", OUT)


if __name__ == "__main__":
    main()
