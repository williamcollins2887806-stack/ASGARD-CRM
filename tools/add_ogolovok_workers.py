#!/usr/bin/env python3
"""Повторный поиск ненайденных из импорта + создание рабочих Оголовка."""
import io
import json
import re
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
REPORT = Path(__file__).resolve().parent / "planned_import_report.json"
CREATED_BY = 3460
WORK_OGOLOVOK = 406

NOT_FOUND = [
    "Забродин К.П.",
    "Пономарев А.В.",
    "Новиков А",
    "Максимов Н.В.",
    "Гусев А.М.",
    "Гусев В.Д",
    "Моисеев М",
    "Забелин Е. А.",
    "Духаев И.З.",
    "Нохрин Р.А.",
    "БайрамкуловН.П.",
    "Ермошин Артем",
]

# Полные ФИО для создания (Оголовок)
CREATE = [
    {
        "fio": "Байрамкулов Назир Паширович",
        "role_tag": "слесарь",
        "clothing_size": "46 (M)",
        "shoe_size": "39-40",
        "height": 155,
        "headwear_size": "стандарт",
        "readiness_status": "ready",
    },
    {
        "fio": "Нохрин Рамазан Алифбекович",
        "role_tag": "слесарь",
        "clothing_size": "48 (M)",
        "shoe_size": "43",
        "headwear_size": "стандарт",
        "readiness_status": "ready",
    },
    {
        "fio": "Духаев Ислам Зияудинович",
        "role_tag": "слесарь",
        "clothing_size": "46-48 (S-M)",
        "shoe_size": "43",
        "headwear_size": "стандарт",
        "readiness_status": "ready",
    },
    {
        "fio": "Забелин Евгений Алексеевич",
        "role_tag": "слесарь",
        "clothing_size": "46 (S)",
        "shoe_size": "41",
        "headwear_size": "стандарт",
        "readiness_status": "ready",
    },
    {
        "fio": "Ермошин Артём Степанович",
        "role_tag": "слесарь",
        "readiness_status": "ready",
    },
]


def norm_fio(s: str) -> str:
    s = re.sub(r"\s+", " ", str(s or "").strip().lower()).replace("ё", "е")
    return s


def ssh_psql(sql: str) -> str:
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root", pkey=key, timeout=30)
    cmd = 'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -F"|" -c "' + sql.replace('"', '\\"') + '"'
    _, o, e = c.exec_command(cmd, timeout=120)
    out = o.read().decode("utf-8", errors="replace").strip()
    err = e.read().decode("utf-8", errors="replace").strip()
    c.close()
    if err and "ERROR" in err.upper():
        raise RuntimeError(err)
    return out


def search_fio(query: str) -> list[dict]:
    fam = norm_fio(query).split()[0] if query else ""
    sql = f"""
      SELECT id, fio, phone, clothing_size, shoe_size, height, headwear_size
      FROM employees
      WHERE LOWER(REPLACE(fio,'ё','е')) LIKE '%{fam}%'
      ORDER BY fio LIMIT 20;
    """
    rows = []
    for line in ssh_psql(sql).splitlines():
        if not line.strip():
            continue
        p = line.split("|")
        rows.append({
            "id": int(p[0]),
            "fio": p[1],
            "phone": p[2] if len(p) > 2 else "",
            "clothing_size": p[3] if len(p) > 3 else "",
            "shoe_size": p[4] if len(p) > 4 else "",
            "height": p[5] if len(p) > 5 else "",
            "headwear_size": p[6] if len(p) > 6 else "",
        })
    return rows


def create_employee(emp: dict) -> int:
    cols = ["fio", "role_tag", "is_active", "readiness_status", "created_at"]
    vals = [
        "'" + emp["fio"].replace("'", "''") + "'",
        "'" + str(emp.get("role_tag", "слесарь")).replace("'", "''") + "'",
        "true",
        "'" + str(emp.get("readiness_status", "ready")) + "'",
        "now()",
    ]
    for field in ("clothing_size", "shoe_size", "headwear_size", "phone"):
        if emp.get(field):
            cols.append(field)
            vals.append("'" + str(emp[field]).replace("'", "''") + "'")
    if emp.get("height"):
        cols.append("height")
        vals.append(str(int(emp["height"])))

    sql = (
        "INSERT INTO employees (" + ", ".join(cols) + ") VALUES ("
        + ", ".join(vals) + ") RETURNING id;"
    )
    out = ssh_psql(sql)
    first = (out.splitlines()[0] if out else "").strip()
    return int(first.split("|")[0])


def set_plan(employee_id: int, work_id: int, planned_from=None, planned_to=None):
    sql = f"""
    BEGIN;
    UPDATE employee_planned_engagements SET status='cancelled', cancelled_at=now(), cancelled_by={CREATED_BY}
      WHERE employee_id={employee_id} AND status='active';
    INSERT INTO employee_planned_engagements (employee_id, work_id, planned_from, planned_to, note, status, created_by)
    VALUES ({employee_id}, {work_id},
      {f"'{planned_from}'" if planned_from else 'NULL'},
      {f"'{planned_to}'" if planned_to else 'NULL'},
      'Импорт Оголовок', 'active', {CREATED_BY});
    COMMIT;
    """
    ssh_psql(sql)


def main():
    print("=== Повторный поиск в CRM ===\n")
    results = {}
    for name in NOT_FOUND:
        hits = search_fio(name)
        results[name] = hits
        print(f"{name:32} → {len(hits)} совпадений")
        for h in hits[:3]:
            print(f"    #{h['id']} {h['fio']} | {h.get('phone') or '—'}")

    print("\n=== Создание рабочих Оголовка ===\n")
    created = []
    for emp in CREATE:
        # проверка дубликата
        fam = norm_fio(emp["fio"]).split()[0]
        existing = search_fio(fam)
        exact = [x for x in existing if norm_fio(x["fio"]) == norm_fio(emp["fio"])]
        # Ермошин Артём — совпадение с #89 по фамилии+имени
        if not exact and "ермошин" in norm_fio(emp["fio"]):
            partial = [x for x in existing if "ермошин" in norm_fio(x["fio"]) and "артем" in norm_fio(x["fio"])]
            if len(partial) == 1:
                exact = partial
        if exact:
            eid = exact[0]["id"]
            print(f"Уже есть: {emp['fio']} → #{eid}")
        else:
            eid = create_employee(emp)
            print(f"Создан: {emp['fio']} → #{eid}")
        set_plan(eid, WORK_OGOLOVOK)
        created.append({"fio": emp["fio"], "id": eid})
        print(f"  План на work #{WORK_OGOLOVOK} проставлен")

    out = Path(__file__).resolve().parent / "ogolovok_created.json"
    out.write_text(json.dumps({"search": results, "created": created}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nОтчёт: {out}")


if __name__ == "__main__":
    main()
