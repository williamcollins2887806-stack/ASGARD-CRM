# -*- coding: utf-8 -*-
"""July CRM + August Excel timesheet merge with bind/restore plan."""
from __future__ import annotations

import csv
import json
from datetime import date, timedelta
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = Path(r"C:\Users\Nikita-ASGARD\ASGARD-CRM\tools")
OUT = Path(r"C:\Users\Nikita-ASGARD\Downloads\табель_июль_август_2026_сверка.xlsx")

# Object colors — July CRM and August Excel use the same map.
# August «красный Хосе» is split by work; OP pink stays Excel-true.
C = {
    "road": "7030A0",
    "office": "70AD47",
    "ship": "00B0F0",
    "op": "D60093",
    "clean": "B0B0B0",  # unknown MLSP object
    "remote": "FFC000",
    "med": "F8CBAD",
    "wh": "C6E0B4",
    "wh_remote": "A9D08E",
    "w354": "D60093",
    "w403": "2874A6",  # blue — деаэратор
    "w404": "E67E22",  # orange — зачистка танков
    "w405": "1E8449",  # green — каусорб
    "w406": "148F77",  # teal — оголовок
    "w407": "C0392B",  # brick — ёмкостный парк
    "w418": "9A7D0A",  # olive — сводная
    "w353": "7F7F7F",
    "header": "1F4E79",
    "ask": "FFF2CC",
    "restore": "C6EFCE",
    "bind": "BDD7EE",
    "keep": "E2EFDA",
    "left": "FCE4D6",
    "white": "FFFFFF",
}

SOLID_WORKS = {403, 406, 407, 418}  # assignment is stronger than leftover 404 PE
# Живые бригады на проде 01.09: 404=0, 405=0, 403=1, 407=3, 406=5. 354/418 не кладём.
ASK_BIND = {196: 404, 197: 405, 255: 403}
PE_BY = {}
DARK_FILLS = {
    C["op"], C["w403"], C["w404"], C["w405"], C["w406"], C["w407"], C["w418"],
    C["road"], C["ship"], C["header"], "2E75B6", "C0007A",
}

WORK_TITLE = {
    354: "354 ОП подогреватели",
    403: "403 Деаэратор",
    404: "404 Зачистка танков",
    405: "405 Каусорб ФТО",
    406: "406 Оголовок ОФС",
    407: "407 Ёмкостный парк БК",
    418: "418 МЛСП сводная",
    353: "353 АВО (не МЛСП)",
}

FIO_MAP = [
    (1, "Трухин А.С.", 320, "Трухин Антон Сергеевич"),
    (2, "Китуашвили Н.С.", 128, "Китуашвили Никон Сергеевич"),
    (3, "Поворов Е.В.", 234, "Поваров Евгений Валерьевич"),
    (4, "Шмелев", 363, "Шмелев Александр Алексеевич"),
    (5, "Романов О.А", 266, "Романов Олег Алексеевич"),
    (6, "Горшков И.А.", 63, "Горшков Иван Александрович"),
    (7, "Ежков П.В.", 84, "Ежков Павел Владимирович"),
    (8, "Пономарев А.Е.", 240, "Пономарев Александр Евгеньевич"),
    (9, "Малков Н.В.", 177, "Малков Николай Владимирович"),
    (10, "Посявин А.М.", 248, "Посявин Андрей Михайлович"),
    (11, "Зарипов Д.Р.", 102, "Зарипов Дамир Раисович"),
    (12, "Соломинов М", 297, "Соломинов Максим Алексеевич"),
    (13, "Коваленко А.А.", 132, "Коваленко Александр Александрович"),
    (14, "Портнов А.А.", 247, "Портнов Андрей Александрович"),
    (15, "Долгов В.В.", 9886, "Долгов Вадим Викторович"),
    (16, "Коннов И", 137, "Коннов Игорь Андреевич"),
    (17, "Щедриков Д.С.", 367, "Щедриков Денис Сергеевич"),
    (18, "Соболев С", 294, "Соболев Сергей Валерьевич"),
    (19, "Новиков И", 213, "Новиков Игорь Олегович"),
    (20, "Ревазов Г.Н.", 261, "Ревазов Георгий Николаевич"),
    (21, "Закиров Н.Х.", 101, "Закиров Наиль Хамбалович"),
    (22, "Ахмеров Е", 20, "Ахмеров Евгений Жамильевич"),
    (23, "Беляев", 10080, "Беляев Егор Дмитриевич"),
    (24, "Шеповалов", 347, "Шаповалов Виталий Викторович"),
    (25, "Пономарев А.В.", 241, "Пономарев Алексей Владимирович"),
    (26, "Ахкямов Р.Р.", 18, "Ахкямов Радик Ринатович"),
    (27, "Попов А.А.", 244, "Попов Алексей Алексеевич"),
    (28, "Блазуцкий И.И", 35, "Блазуцкий Иван Иванович"),
    (29, "Гусев В.Д", 69, "Гусев Владимир Дмитриевич"),
    (30, "Новиков А", 212, "Новиков Алексей Валентинович"),
    (31, "Платошин К.", 233, "Платошин Константин Владимирович"),
    (32, "Максимов А.В.", 174, "Максимов Алексей Викторович"),
    (33, "Максимов Н.В.", 176, "Максимов Николай Викторович"),
    (34, "Моисеев А", 196, "Моисеев Александр Васильевич"),
    (35, "Моисеев М", 197, "Моисеев Михаил Васильевич"),
    (36, "Рабчук М", 255, "Рабчук Максим Анатольевич"),
    (37, "Жигин А.В.", 10025, "Жигин Александр Валерьевич"),
    (38, "Иванейкин Ю", 104, "Иванейкин Юрий Николаевич"),
    (39, "Земцов А.Н.", 10026, "Земцов Александр Николаевич"),
    (40, "Гусев А.М.", 68, "Гусев Алексей Михайлович"),
    (41, "Ермошин А", 89, "Ермошин Артем Степанович"),
    (42, "Забелин", 10167, "Забелин Евгений Алексеевич"),
    (43, "Нохрин", 10165, "Нохрин Рамазан Алифбекович"),
    (44, "Духаев", 10166, "Духаев Ислам Зияудинович"),
]

# CRM last MLSP assignment (jul-aug) and current active
CRM_ASG = {
    320: {"work": 418, "active": False, "dep": "2026-08-25", "reason": "автосъезд 25.08", "from": "2026-07-01"},
    128: {"work": 403, "active": False, "dep": "2026-07-15", "reason": "снят 15.07", "from": "2026-07-01"},
    234: {"work": 407, "active": False, "dep": "2026-07-18", "reason": "снят 18.07", "from": "2026-07-01"},
    363: {"work": 403, "active": False, "dep": "2026-07-18", "reason": "снят 18.07", "from": "2026-07-01"},
    266: {"work": 403, "active": True, "dep": None, "reason": "в бригаде", "from": "2026-07-01"},
    63: {"work": 407, "active": True, "dep": None, "reason": "в бригаде", "from": "2026-07-01"},
    84: {"work": 407, "active": False, "dep": "2026-07-18", "reason": "снят 18.07", "from": "2026-07-01"},
    240: {"work": 403, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08", "from": "2026-07-23"},
    177: {"work": 403, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08", "from": "2026-07-26"},
    248: {"work": 403, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08", "from": "2026-07-26"},
    102: {"work": 403, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08", "from": "2026-07-23"},
    297: {"work": 354, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08", "from": "2026-07-21"},
    132: {"work": 354, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08", "from": "2026-07-05"},
    247: {"work": 354, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08", "from": "2026-07-08"},
    9886: {"work": 407, "active": True, "dep": None, "reason": "в бригаде", "from": "2026-08-02"},
    137: {"work": 407, "active": True, "dep": None, "reason": "в бригаде", "from": "2026-08-02"},
    367: {"work": 354, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08 + план 404 active", "from": "2026-07-04"},
    294: {"work": None, "active": False, "dep": None, "reason": "не было назначения, план 404 снят", "from": None},
    213: {"work": 354, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08", "from": "2026-07-01"},
    261: {"work": 354, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08 + план 404 active", "from": "2026-07-05"},
    101: {"work": 354, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08 + план 404 active", "from": "2026-07-05"},
    20: {"work": None, "active": False, "dep": None, "reason": "не было назначения, план 404 снят", "from": None},
    10080: {"work": 354, "active": False, "dep": "2026-07-13", "reason": "убытие РП 13.07", "from": "2026-07-01"},
    347: {"work": None, "active": False, "dep": None, "reason": "не было назначения, план 404 снят", "from": None},
    241: {"work": 353, "active": False, "dep": "2026-07-24", "reason": "АВО до 24.07, план 404 снят", "from": None},
    18: {"work": 354, "active": False, "dep": "2026-07-13", "reason": "убытие РП 13.07", "from": "2026-07-01"},
    244: {"work": 354, "active": False, "dep": "2026-07-15", "reason": "убытие РП 15.07", "from": "2026-07-01"},
    35: {"work": None, "active": False, "dep": None, "reason": "не было назначения, план 404 снят", "from": None},
    69: {"work": 354, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08, план 405 active", "from": "2026-07-05"},
    212: {"work": None, "active": False, "dep": None, "reason": "не было назначения, план 405 снят", "from": None},
    233: {"work": None, "active": False, "dep": None, "reason": "не было назначения, план 405 снят", "from": None},
    174: {"work": 354, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08", "from": "2026-07-04"},
    176: {"work": 354, "active": False, "dep": "2026-08-24", "reason": "автосъезд 24.08", "from": "2026-07-04"},
    196: {"work": None, "active": False, "dep": None, "reason": "не было назначения и плана", "from": None},
    197: {"work": None, "active": False, "dep": None, "reason": "не было назначения и плана", "from": None},
    255: {"work": None, "active": False, "dep": None, "reason": "не было назначения и плана", "from": None},
    10025: {"work": None, "active": False, "dep": None, "reason": "не было назначения, план 404 снят", "from": None},
    104: {"work": None, "active": False, "dep": None, "reason": "не было назначения, план 405 снят", "from": None},
    10026: {"work": 353, "active": False, "dep": "2026-07-24", "reason": "АВО до 24.07, план 403 снят", "from": None},
    68: {"work": None, "active": False, "dep": None, "reason": "не было назначения, план 404 снят", "from": None},
    89: {"work": 406, "active": False, "dep": "2026-08-25", "reason": "ОП→оголовок 6.08, съехал 25.08", "from": "2026-07-01"},
    10167: {"work": 406, "active": True, "dep": None, "reason": "в бригаде оголовок", "from": None},
    10165: {"work": 406, "active": True, "dep": None, "reason": "в бригаде оголовок", "from": None},
    10166: {"work": 406, "active": True, "dep": None, "reason": "в бригаде оголовок", "from": None},
}

FONT = Font(name="Arial", size=9)
FONT_W = Font(name="Arial", size=8, bold=True, color="FFFFFF")
FONT_B = Font(name="Arial", size=9, bold=True, color="FFFFFF")
FONT_H = Font(name="Arial", size=12, bold=True, color="1F4E79")
THIN = Border(
    left=Side(style="thin", color="B0B0B0"),
    right=Side(style="thin", color="B0B0B0"),
    top=Side(style="thin", color="B0B0B0"),
    bottom=Side(style="thin", color="B0B0B0"),
)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)


def fill(hex6: str) -> PatternFill:
    return PatternFill("solid", fgColor=hex6)


def work_hex(wid):
    return {
        354: C["op"],
        403: C["w403"],
        404: C["w404"],
        405: C["w405"],
        406: C["w406"],
        407: C["w407"],
        418: C["w418"],
        353: C["w353"],
    }.get(wid)


def day_font(hex6):
    return FONT_W if hex6 in DARK_FILLS else FONT


def load_pe():
    by = {}
    path = ROOT / "jul_aug_pe.csv"
    if not path.exists():
        return by
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            by.setdefault(int(r["id"]), []).append(r)
    return by


def best_pe_work(eid):
    rows = PE_BY.get(eid) or []
    if not rows:
        return None
    active = [r for r in rows if r.get("status") == "active"]
    if active:
        w = int(active[-1]["work_id"])
        return w if w != 354 else None
    for r in reversed(rows):
        w = int(r["work_id"])
        if w in (403, 404, 405, 406, 407, 418):
            return w
    return None


def solid_assignment_work(eid):
    """Факт: человек стоял на 403/406/407/418 — это сильнее, чем массовый импорт плана 404."""
    asg = CRM_ASG.get(eid) or {}
    if asg.get("work") in SOLID_WORKS:
        return asg["work"]
    return None


def resolve_work(eid):
    """Куда красить августовский «красный» и кого куда привязывать."""
    if eid in ASK_BIND:
        return ASK_BIND[eid]
    solid = solid_assignment_work(eid)
    if solid:
        return solid
    if eid == 89:
        return 406
    pe = best_pe_work(eid)
    if pe:
        return pe
    return 404


def work_source(eid):
    if eid in ASK_BIND:
        return "живая бригада меньше всего (404=0, 405=0, 403=1)"
    if solid_assignment_work(eid):
        return "назначение CRM"
    if eid == 89:
        return "смены field 406"
    if best_pe_work(eid):
        return "план привлечения"
    return "ушёл с ОП → 404 по умолчанию"


def parse_d(s):
    if not s:
        return None
    return date.fromisoformat(s[:10])


def load_colored():
    rows = json.loads((ROOT / "_aug_colored.json").read_text(encoding="utf-8"))
    by_n = {p["n"]: p for p in rows}
    return by_n


def load_checkins():
    out = {}
    with (ROOT / "jul_aug_checkins.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            eid = int(r["emp_id"])
            d = parse_d(r["d"])
            out.setdefault(eid, {}).setdefault(d, []).append(r)
    return out


def load_stages():
    by = {}
    files = [
        (ROOT / "jul_aug_stages.csv", "emp_id"),
        (ROOT / "jul_aug_stages_aug.csv", "id"),
    ]
    for path, id_key in files:
        if not path.exists():
            continue
        with path.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if (r.get("status") or "").lower() in ("cancelled", "rejected"):
                    continue
                eid = int(r[id_key])
                d0 = parse_d(r["d_from"])
                d1 = parse_d(r["d_to"])
                rec = {
                    "emp_id": eid,
                    "stage_type": r["stage_type"],
                    "direction": (r.get("direction") or "").strip(),
                    "status": r.get("status") or "",
                    "d_from": d0,
                    "d_to": d1,
                    "work_id": r.get("work_id"),
                    "tariff_points": r.get("tariff_points") or r.get("pts"),
                }
                d = d0
                while d and d1 and d <= d1:
                    by.setdefault(eid, {}).setdefault(d, []).append(rec)
                    d += timedelta(days=1)
    return by


STAGE_STYLE = (
    ("ship", "суд", "ship"),
    ("helicopter", "вер", "road"),
    ("travel", "дор", "road"),
    ("medical", "мед", "med"),
    ("warehouse", "скл", "wh"),
    ("training", "уч", "med"),
)


def crm_stage_style(eid, d, stages):
    """Этап CRM (дорога/судно/вертолёт/…) бьёт смену. Return (label, color) or None."""
    st = (stages.get(eid) or {}).get(d) or []
    if not st:
        return None
    types = {x["stage_type"] for x in st}
    for stype, label, ckey in STAGE_STYLE:
        if stype in types:
            return label, C[ckey]
    return None


def crm_homebound_start(eid, stages, last_plat=None):
    """Последний from_site в августе после заезда. Одинокий from_site посреди Excel-вахты не считаем съездом."""
    events = []
    for d, rows in (stages.get(eid) or {}).items():
        if d.year != 2026 or d.month != 8:
            continue
        for x in rows:
            if x.get("direction") == "from_site":
                events.append((d.day, "from"))
            elif x.get("direction") == "to_site":
                events.append((d.day, "to"))
    events.sort()
    last_from = None
    for day, kind in events:
        if kind == "from":
            if last_from is None:
                last_from = day
        else:
            last_from = None
    if last_from and last_plat and last_from < last_plat:
        return None
    return last_from


def jul_kind(eid, d, checkins, stages):
    """Июль: этап CRM важнее смены. Return (label, color_hex, work_id)."""
    ov = crm_stage_style(eid, d, stages)
    if ov:
        return ov[0], ov[1], None
    ch = (checkins.get(eid) or {}).get(d) or []
    mlsp_ch = [x for x in ch if x.get("site_category") == "mlsp" and x.get("shift") in ("day", "night")]
    if mlsp_ch:
        wid = int(mlsp_ch[0]["work_id"]) if mlsp_ch[0]["work_id"] else None
        sh = "Д" if mlsp_ch[0]["shift"] == "day" else "Н"
        return sh, work_hex(wid) or C["clean"], wid
    other_ch = [x for x in ch if x.get("shift") in ("day", "night")]
    if other_ch:
        wid = int(other_ch[0]["work_id"]) if other_ch[0]["work_id"] else None
        return "Д", C["w353"], wid
    return None, None, None


def aug_cell(colored_person, day, eid, proposed, checkins, stages):
    info = (colored_person.get("days") or {}).get(str(day)) or {}
    kind = info.get("kind")
    val = info.get("v")
    d = date(2026, 8, day)
    ov = crm_stage_style(eid, d, stages)
    if ov:
        label, col = ov
        return label, col, None
    ch = (checkins.get(eid) or {}).get(d) or []
    mlsp_ch = [x for x in ch if x.get("site_category") == "mlsp" and x.get("shift") in ("day", "night")]
    if mlsp_ch and mlsp_ch[0].get("work_id"):
        wid = int(mlsp_ch[0]["work_id"])
        return val if val not in (None, "") else ("Д" if mlsp_ch[0]["shift"] == "day" else "Н"), work_hex(wid), wid
    if kind == "mlsp_op":
        return val, C["op"], 354
    if kind == "mlsp_clean":
        if proposed:
            return val, work_hex(proposed), proposed
        return val, C["clean"], None
    if kind == "road":
        return None, None, None
    if kind == "varandey_ship":
        return val, C["ship"], None
    if kind == "remote":
        return val, C["remote"], None
    if val not in (None, ""):
        return val, None, None
    return None, None, None


def platform_days_aug(colored_person, eid, stages):
    days = []
    for d_s, x in (colored_person.get("days") or {}).items():
        day = int(d_s)
        d = date(2026, 8, day)
        if crm_stage_style(eid, d, stages):
            continue
        if x.get("kind") in ("mlsp_op", "mlsp_clean"):
            days.append(day)
    return sorted(days)


def last_aug_kind_day(colored_person, kinds):
    found = [int(d) for d, x in (colored_person.get("days") or {}).items() if x.get("kind") in kinds]
    return max(found) if found else None


def propose(n, short, eid, full, colored_person, stages):
    asg = CRM_ASG.get(eid) or {}
    plat = platform_days_aug(colored_person, eid, stages)
    op = [int(d) for d, x in colored_person["days"].items() if x.get("kind") == "mlsp_op"]
    last_plat = max(plat) if plat else None
    first_plat = min(plat) if plat else None
    still_end = last_plat == 31
    switched_op = bool(op) and last_plat and last_plat > max(op)
    dep_crm = crm_homebound_start(eid, stages, last_plat)
    road_s = f"{dep_crm:02d}.08" if dep_crm else None

    crm_w = asg.get("work")
    proposed = resolve_work(eid)
    note = asg.get("reason") or ""
    src = work_source(eid)

    if eid == 89:
        proposed = 406
        note = (
            "1–5.08 ОП (розовый), с 6.08 оголовок. В CRM смены 406 с 6.08. "
            f"Дорога CRM с {road_s or '25.08'} — в активную бригаду не возвращать."
        )
        action = f"Вахта до {road_s or '25.08'} по CRM. Назначение 406 закрыто — ок."
        flag = "left"
        return proposed, action, flag, note, first_plat, last_plat, src

    if eid in (10167, 10165, 10166):
        proposed = 406
        extra = f" В CRM дорога с {road_s}." if road_s else ""
        action = "Уже в бригаде 406. В Excel почти пусто (8–11.08) — табель оголовка неполный." + extra
        flag = "keep"
        return proposed, action, flag, note, first_plat, last_plat, src

    if eid in (63, 266, 9886, 137) and asg.get("active"):
        proposed = crm_w
        extra = (
            f" В CRM есть from_site {road_s} при активном назначении — в табеле дорога по CRM."
            if road_s else ""
        )
        action = "Уже в бригаде. Восстановить вахту (смены field за август не заведены)." + extra
        flag = "keep"
        return proposed, action, flag, note, first_plat, last_plat, src

    inbound = {20, 10080, 241, 18, 244, 196, 197, 35, 212, 233, 10025, 104, 10026, 68, 347, 294, 255}
    if first_plat and eid in inbound:
        if still_end:
            action = (
                f"Задним числом добавить в бригаду {WORK_TITLE.get(proposed)} "
                f"с {first_plat:02d}.08 и оставить активным (на 31.08 ещё на МЛСП)."
            )
            flag = "bind"
        else:
            until = road_s or (f"{last_plat:02d}.08" if last_plat else "съезд")
            action = (
                f"Задним числом добавить в бригаду {WORK_TITLE.get(proposed)} "
                f"с {first_plat:02d}.08 по {until}, закрыть убытием {until}."
            )
            flag = "left"
        return proposed, action, flag, note, first_plat, last_plat, src

    if still_end and eid == 363:
        proposed = 403
        action = "ОТМЕНИТЬ снятие 18.07: в Excel 3–31.08 непрерывно на МЛСП. Вернуть в бригаду 403, восстановить/открыть вахту."
        flag = "restore"
        return proposed, action, flag, note, first_plat, last_plat, src

    if asg.get("dep") == "2026-08-24" and (last_plat or dep_crm):
        until = road_s or (f"{last_plat:02d}.08" if last_plat else "24.08")
        if switched_op and crm_w == 354:
            action = (
                f"Был на ОП 1–5.08, с 6.08 «чистка». Автоснятие 24.08 с {WORK_TITLE.get(crm_w)}. "
                f"Задним числом назначение на {WORK_TITLE.get(proposed)} с 06.08 по {until}, "
                f"закрыть убытием {until}."
            )
            flag = "left"
            return proposed, action, flag, note, first_plat, last_plat, src
        action = (
            f"Автоснятие 24.08 с {WORK_TITLE.get(crm_w)}. "
            f"Задним числом держать в бригаде {WORK_TITLE.get(proposed)} до {until}, "
            f"закрыть убытием {until} (дорога CRM)."
        )
        flag = "left"
        return proposed, action, flag, note, first_plat, last_plat, src

    # July leavers who returned in August then left ~25
    if asg.get("dep") and asg["dep"] <= "2026-07-18" and first_plat:
        extra = f", закрыть убытием {road_s}" if road_s else ""
        action = (
            f"Снят {asg['dep'][8:10]}.07. Задним числом добавить в бригаду {WORK_TITLE.get(proposed)} "
            f"с {first_plat:02d}.08"
            + (f" по {last_plat:02d}.08" if last_plat and last_plat < 31 else " (ещё на платформе)")
            + extra
            + "."
        )
        flag = "restore" if still_end else "bind"
        return proposed, action, flag, note, first_plat, last_plat, src

    if eid == 320:
        proposed = 418
        action = (
            f"Трухин: Excel чистка, дорога CRM с {road_s or '25.08'} (from_site 26.08), "
            "удалёнка 27–31. В бригаду не возвращать."
        )
        flag = "left"
        return proposed, action, flag, note, first_plat, last_plat, src

    if not plat:
        action = "В Excel почти нет смен МЛСП. Назначение не трогать без уточнения."
        flag = "ask"
        return proposed, action, flag, note, first_plat, last_plat, src

    action = "Сверить вручную."
    flag = "ask"
    return proposed, action, flag, note, first_plat, last_plat, src


def main():
    global PE_BY
    PE_BY = load_pe()
    colored = load_colored()
    checkins = load_checkins()
    stages = load_stages()
    jul_days = [date(2026, 7, d) for d in range(1, 32)]
    aug_days = list(range(1, 32))

    wb = Workbook()

    # ── Legend ──
    lg = wb.active
    lg.title = "Легенда"
    lg["A1"] = "Табель июль (CRM) + август (Excel Хосе) — сверка и план привязки"
    lg["A1"].font = FONT_H
    lg.merge_cells("A1:F1")
    lg["A2"] = (
        "Август: розовый ОП — Excel. Бывший красный разложен по работам. "
        "Если в CRM на день стоит дорога / судно / вертолёт / мед / склад — смену из ячейки убираю, ставлю этап."
    )
    lg["A2"].font = Font(name="Arial", size=9, italic=True, color="666666")
    lg.merge_cells("A2:F2")

    lg["A4"] = "Цвета дней"
    lg["A4"].font = FONT_B
    lg["A4"].fill = fill(C["header"])
    legend_rows = [
        (C["op"], "354 ОП подогреватели — розовый Excel «ремонт ОП» (1–5.08 у тех, кто ещё дочищал ОП)"),
        (C["w403"], "403 Деаэратор"),
        (C["w404"], "404 Зачистка танков"),
        (C["w405"], "405 Каусорб ФТО"),
        (C["w406"], "406 Оголовок ОФС"),
        (C["w407"], "407 Ёмкостный парк БК"),
        (C["w418"], "418 МЛСП сводная (Трухин)"),
        (C["clean"], "МЛСП, объект неясен (Моисеевы, Рабчук — нет плана)"),
        (C["road"], "Фиолетовый — дорога / вертолёт"),
        (C["ship"], "Голубой — Варандей, судно"),
        (C["remote"], "Жёлтый — удалённая работа"),
        (C["med"], "Персиковый — медкомиссия / обучение"),
        (C["wh"], "Салатовый — склад"),
        (C["office"], "Зелёный — офис"),
        (C["w353"], "Серый — АВО / не МЛСП"),
    ]
    lg["A4"].font = Font(name="Arial", size=9, bold=True, color="FFFFFF")
    r = 5
    for hex6, text in legend_rows:
        lg.cell(r, 1).fill = fill(hex6)
        lg.cell(r, 1).border = THIN
        lg.cell(r, 2, value=text).font = FONT
        lg.merge_cells(start_row=r, start_column=2, end_row=r, end_column=6)
        r += 1

    r += 1
    lg.cell(r, 1, value="Действие (лист Привязка)").fill = fill(C["header"])
    lg.cell(r, 1).font = Font(name="Arial", size=9, bold=True, color="FFFFFF")
    r += 1
    for hex6, text in [
        (C["keep"], "Уже в бригаде — вахту поправить по Excel"),
        (C["restore"], "Отменить автоснятие / вернуть в бригаду + восстановить вахту"),
        (C["bind"], "Привязать на работу (не было в бригаде) + открыть вахту"),
        (C["left"], "На платформе был, съехал по CRM (часто 24.08, не 25) — в активную бригаду не возвращать"),
        (C["ask"], "Нужно ваше решение — неясно куда"),
    ]:
        lg.cell(r, 1).fill = fill(hex6)
        lg.cell(r, 1).border = THIN
        lg.cell(r, 2, value=text).font = FONT
        lg.merge_cells(start_row=r, start_column=2, end_row=r, end_column=6)
        r += 1

    r += 2
    lg.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
    lg.cell(
        r,
        1,
        value=(
            "Табель: этап CRM (дор/суд/вер/мед/скл) всегда вместо смены, июль и август. "
            "План привязки — кого задним числом добавить в бригаду и до какой даты закрыть. "
            "Моисеев А → 404 (оставить активным), Моисеев М → 405 (активным), "
            "Рабчук → 403 с заезда по 24.08, закрыть убытием 24.08."
        ),
    ).font = Font(name="Arial", size=8, italic=True, color="666666")
    lg.cell(r, 1).alignment = Alignment(wrap_text=True, vertical="top")
    lg.row_dimensions[r].height = 36

    r += 2
    lg.cell(r, 1, value="Ермошин А. 1–5.08").font = FONT_B
    lg.cell(r, 1).fill = fill(C["header"])
    r += 1
    lg.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
    lg.cell(
        r,
        1,
        value="Да: в Excel 1–5.08 баллы 26 и розовый 354 ОП. С 6.08 Excel был красный — это 406 оголовок (бирюзовый). 25.08 дорога домой.",
    ).font = FONT
    lg.cell(r, 1).alignment = Alignment(wrap_text=True, vertical="top")
    lg.row_dimensions[r].height = 48

    lg.column_dimensions["A"].width = 14
    lg.column_dimensions["B"].width = 88
    for col in "CDEF":
        lg.column_dimensions[col].width = 14

    # ── Bind sheet first (compute proposals) ──
    proposals = {}
    for n, short, eid, full in FIO_MAP:
        cp = colored[n]
        proposals[eid] = propose(n, short, eid, full, cp, stages)

    flag_fill = {"keep": C["keep"], "restore": C["restore"], "bind": C["bind"], "left": C["left"], "ask": C["ask"]}

    # ── Состав по объектам ──
    roster = wb.create_sheet("Состав", 2)
    roster["A1"] = "Кого куда крашу в августе (бывший красный Хосе)"
    roster["A1"].font = FONT_H
    roster.merge_cells("A1:D1")
    for i, h in enumerate(["Объект", "Источник", "Excel ФИО", "CRM ФИО"], 1):
        cell = roster.cell(2, i, value=h)
        cell.font = FONT_B
        cell.fill = fill(C["header"])
        cell.border = THIN
    rr = 3
    order = [403, 404, 405, 406, 407, 418, None]
    for wid in order:
        for n, short, eid, full in FIO_MAP:
            proposed, action, flag, note, first_plat, last_plat, src = proposals[eid]
            if (proposed or None) != wid:
                continue
            hx = work_hex(wid) if wid else C["clean"]
            title = WORK_TITLE.get(wid, "СПРОСИТЬ") if wid else "СПРОСИТЬ"
            vals = [title, src, short, full]
            for c, v in enumerate(vals, 1):
                cell = roster.cell(rr, c, value=v)
                cell.font = day_font(hx) if c == 1 else FONT
                cell.border = THIN
                cell.fill = fill(hx if c == 1 else flag_fill.get(flag, C["white"]))
            rr += 1
    for i, w in enumerate([28, 28, 18, 36], 1):
        roster.column_dimensions[get_column_letter(i)].width = w
    roster.auto_filter.ref = f"A2:D{max(rr - 1, 2)}"
    roster.freeze_panes = "A3"

    bs = wb.create_sheet("Привязка")
    headers = [
        "№", "Excel ФИО", "CRM ФИО", "id", "CRM сейчас", "Excel август",
        "Куда привязать", "Откуда цвет", "Действие", "Платформа с", "Платформа по", "Комментарий CRM",
    ]
    for i, h in enumerate(headers, 1):
        cell = bs.cell(1, i, value=h)
        cell.font = FONT_B
        cell.fill = fill(C["header"])
        cell.alignment = CENTER
        cell.border = THIN
    bs.freeze_panes = "A2"
    bs.auto_filter.ref = "A1:L45"

    for row_i, (n, short, eid, full) in enumerate(FIO_MAP, 2):
        cp = colored[n]
        asg = CRM_ASG.get(eid) or {}
        proposed, action, flag, note, first_plat, last_plat, src = proposals[eid]
        op = [int(d) for d, x in cp["days"].items() if x.get("kind") == "mlsp_op"]
        excel_obj = []
        if op:
            excel_obj.append(f"ОП 1–{max(op):02d}.08")
        plat = platform_days_aug(cp, eid, stages)
        if plat:
            excel_obj.append(f"МЛСП {min(plat):02d}–{max(plat):02d}.08")
        crm_now = "в бригаде " + WORK_TITLE.get(asg.get("work"), "") if asg.get("active") else (asg.get("reason") or "нет")
        vals = [
            n, short, full, eid, crm_now, "; ".join(excel_obj) or "—",
            WORK_TITLE.get(proposed, "СПРОСИТЬ") if proposed else "СПРОСИТЬ",
            src, action, first_plat, last_plat, note,
        ]
        for c, v in enumerate(vals, 1):
            cell = bs.cell(row_i, c, value=v)
            cell.font = FONT
            cell.border = THIN
            cell.alignment = Alignment(wrap_text=True, vertical="center")
            cell.fill = fill(flag_fill[flag])
        if proposed:
            hx = work_hex(proposed)
            bind_cell = bs.cell(row_i, 7)
            bind_cell.fill = fill(hx)
            bind_cell.font = day_font(hx)
        bs.row_dimensions[row_i].height = 42

    widths = [5, 18, 32, 8, 36, 28, 24, 26, 70, 12, 12, 40]
    for i, w in enumerate(widths, 1):
        bs.column_dimensions[get_column_letter(i)].width = w
    bs.row_dimensions[1].height = 22

    # ── Timesheet ──
    ts = wb.create_sheet("Табель", 1)
    # cols: n, excel fio, crm fio, bind, then 31 jul, 31 aug
    meta = 4
    ts.merge_cells(start_row=1, start_column=1, end_row=2, end_column=1)
    ts.merge_cells(start_row=1, start_column=2, end_row=2, end_column=2)
    ts.merge_cells(start_row=1, start_column=3, end_row=2, end_column=3)
    ts.merge_cells(start_row=1, start_column=4, end_row=2, end_column=4)
    for i, h in enumerate(["№", "Excel", "CRM", "План"], 1):
        cell = ts.cell(1, i, value=h)
        cell.font = FONT_B
        cell.fill = fill(C["header"])
        cell.alignment = CENTER
        cell.border = THIN
        ts.cell(2, i).fill = fill(C["header"])
        ts.cell(2, i).border = THIN

    ts.merge_cells(start_row=1, start_column=meta + 1, end_row=1, end_column=meta + 31)
    cell = ts.cell(1, meta + 1, value="Июль 2026 — CRM")
    cell.font = FONT_B
    cell.fill = fill("2E75B6")
    cell.alignment = CENTER
    for c in range(meta + 1, meta + 32):
        ts.cell(1, c).fill = fill("2E75B6")
        ts.cell(1, c).border = THIN
        dcell = ts.cell(2, c, value=c - meta)
        dcell.font = FONT_B
        dcell.fill = fill("2E75B6")
        dcell.alignment = CENTER
        dcell.border = THIN

    ts.merge_cells(start_row=1, start_column=meta + 32, end_row=1, end_column=meta + 62)
    cell = ts.cell(1, meta + 32, value="Август 2026 — Excel Хосе, красный разложен по объектам")
    cell.font = FONT_B
    cell.fill = fill("C0007A")
    cell.alignment = CENTER
    for c in range(meta + 32, meta + 63):
        ts.cell(1, c).fill = fill("C0007A")
        ts.cell(1, c).border = THIN
        dcell = ts.cell(2, c, value=c - meta - 31)
        dcell.font = FONT_B
        dcell.fill = fill("C0007A")
        dcell.alignment = CENTER
        dcell.border = THIN

    ts.freeze_panes = "E3"
    ts.auto_filter.ref = "A2:BL46"

    for row_i, (n, short, eid, full) in enumerate(FIO_MAP, 3):
        cp = colored[n]
        proposed, action, flag, note, first_plat, last_plat, src = proposals[eid]
        plan = WORK_TITLE.get(proposed, "СПРОСИТЬ") if proposed else "СПРОСИТЬ"
        meta_vals = [n, short, full, plan]
        for c, v in enumerate(meta_vals, 1):
            cell = ts.cell(row_i, c, value=v)
            cell.font = FONT
            cell.border = THIN
            cell.fill = fill(flag_fill[flag])
            cell.alignment = Alignment(vertical="center", wrap_text=True)
        plan_cell = ts.cell(row_i, 4)
        if proposed:
            hx = work_hex(proposed)
            plan_cell.fill = fill(hx)
            plan_cell.font = day_font(hx)
            plan_cell.alignment = CENTER

        for i, d in enumerate(jul_days):
            label, col, wid = jul_kind(eid, d, checkins, stages)
            cell = ts.cell(row_i, meta + 1 + i, value=label)
            cell.font = day_font(col) if col else FONT
            cell.alignment = CENTER
            cell.border = THIN
            if col:
                cell.fill = fill(col)

        for day in aug_days:
            val, col, wid = aug_cell(cp, day, eid, proposed, checkins, stages)
            cell = ts.cell(row_i, meta + 31 + day, value=val)
            cell.font = day_font(col) if col else FONT
            cell.alignment = CENTER
            cell.border = THIN
            if col:
                cell.fill = fill(col)

        ts.row_dimensions[row_i].height = 18

    ts.column_dimensions["A"].width = 4
    ts.column_dimensions["B"].width = 16
    ts.column_dimensions["C"].width = 28
    ts.column_dimensions["D"].width = 22
    for c in range(5, 67):
        ts.column_dimensions[get_column_letter(c)].width = 4.0
    ts.row_dimensions[1].height = 20
    ts.sheet_view.showGridLines = False
    ts.page_setup.orientation = "landscape"
    ts.page_setup.fitToPage = True
    ts.page_setup.fitToWidth = 1
    ts.page_setup.fitToHeight = 1
    ts.sheet_properties.pageSetUpPr.fitToPage = True
    ts.print_title_rows = "1:2"
    ts.print_title_cols = "A:D"

    from collections import Counter, defaultdict
    people_aug = defaultdict(set)
    days_aug = defaultdict(int)
    people_jul = defaultdict(set)
    days_jul = defaultdict(int)
    for n, short, eid, full in FIO_MAP:
        proposed = proposals[eid][0]
        cp = colored[n]
        for d in jul_days:
            _lab, _col, wid = jul_kind(eid, d, checkins, stages)
            if wid:
                people_jul[wid].add(short)
                days_jul[wid] += 1
        for day in aug_days:
            _val, _col, wid = aug_cell(cp, day, eid, proposed, checkins, stages)
            if wid:
                people_aug[wid].add(short)
                days_aug[wid] += 1

    sm = wb.create_sheet("Численность", 3)
    sm["A1"] = "Сколько человек работало на каждой работе (по этому табелю)"
    sm["A1"].font = FONT_H
    sm.merge_cells("A1:F1")
    sm["A2"] = (
        "Август: день считается сменой на объекте (не дорога/судно/вертолёт). "
        "Кто был на ОП, потом на чистке — попадает в обе работы. "
        "Новиков А. 12.08 — смена 405, ошибочная дорога в CRM снята."
    )
    sm["A2"].font = Font(name="Arial", size=8, italic=True, color="666666")
    sm.merge_cells("A2:F2")
    for i, h in enumerate(["Работа", "Человек август", "Человеко-дней август", "Человек июль CRM", "ФИО август"], 1):
        cell = sm.cell(4, i, value=h)
        cell.font = FONT_B
        cell.fill = fill(C["header"])
        cell.border = THIN
        cell.alignment = CENTER
    sr = 5
    work_order = [354, 403, 404, 405, 406, 407, 418, 353]
    for wid in work_order:
        n_aug = len(people_aug.get(wid) or [])
        n_jul = len(people_jul.get(wid) or [])
        if n_aug == 0 and n_jul == 0:
            continue
        hx = work_hex(wid) or C["header"]
        names = ", ".join(sorted(people_aug.get(wid) or [], key=lambda s: s.lower()))
        vals = [WORK_TITLE.get(wid, str(wid)), n_aug, days_aug.get(wid, 0), n_jul, names]
        for c, v in enumerate(vals, 1):
            cell = sm.cell(sr, c, value=v)
            cell.border = THIN
            cell.font = day_font(hx) if c == 1 else FONT
            cell.alignment = Alignment(wrap_text=True, vertical="center")
            if c == 1:
                cell.fill = fill(hx)
        sm.row_dimensions[sr].height = 36
        sr += 1
    for i, w in enumerate([28, 16, 22, 18, 90], 1):
        sm.column_dimensions[get_column_letter(i)].width = w
    sm.freeze_panes = "A5"

    bs.page_setup.orientation = "landscape"
    bs.page_setup.fitToPage = True
    bs.page_setup.fitToWidth = 1
    bs.page_setup.fitToHeight = 1

    saved = OUT
    try:
        wb.save(OUT)
    except PermissionError:
        saved = OUT.with_name(OUT.stem + "_new" + OUT.suffix)
        wb.save(saved)
        print("original locked, saved", saved)
    print("saved", saved)

    from collections import Counter
    flags = Counter(proposals[eid][2] for *_, eid, _ in FIO_MAP)
    print("flags", dict(flags))
    lines = []
    for wid in work_order:
        names = sorted(people_aug.get(wid) or [])
        if not names:
            continue
        line = f"{wid}\t{len(names)}\t{days_aug[wid]}\t{', '.join(names)}"
        print("AUG", line)
        lines.append(line)
    (ROOT / "_headcount.txt").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
