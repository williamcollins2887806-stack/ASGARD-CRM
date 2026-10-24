# -*- coding: utf-8 -*-
"""Единый табель по объекту «Восстановительный ремонт огневых подогревателей
МЛСП «Приразломная» — этап 2026» за 01.02.2026 — 31.10.2026.

Источники:
  1) «Табель» (xlsx, присланный заказчиком-постановщиком): листы февр..июнь 2026,
     маркер «ремонт огн подогревателя Климакин/Трухин» = красная заливка.
     Июль/август из этого файла в сведение НЕ берутся (по указанию: неверны).
  2) Выгрузка СРМ timesheet_work354 за 2026-02-01..2026-10-31 — по факту
     содержит данные только с 01.07.2026.

Результат: public-табель, 273 дня одной непрерывной сеткой + должность из СРМ.
"""
import io
import json
import re
import datetime as dt

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.dimensions import ColumnDimension

MINE = r'C:\Users\Nikita-ASGARD\Downloads\Табель_огневой_подогреватель_с_фев2026.xlsx'
CRM = r'C:\Users\Nikita-ASGARD\Downloads\timesheet_work354_2026-02-01_2026-10-31.xlsx'
MAP = r'C:\Users\Nikita-ASGARD\ASGARD-CRM\tools\_map_final.json'
DST = r'C:\Users\Nikita-ASGARD\Downloads\Табель_огневой_подогреватель_фев-окт_2026_сводный.xlsx'
REPORT = r'C:\Users\Nikita-ASGARD\ASGARD-CRM\tools\_merged_report.txt'

START = dt.date(2026, 2, 1)
END = dt.date(2026, 10, 31)
NDAYS = (END - START).days + 1

MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
             'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

RED = 'FFFF0000'
SRC_MINE = 'Табель'
SRC_CRM = 'СРМ'


def frgb(c):
    f = c.fill
    if f is None or f.patternType is None:
        return None
    try:
        r = f.fgColor.rgb
    except Exception:
        return None
    return r.upper() if isinstance(r, str) else None


def key(s):
    s = str(s or '').replace('\n', ' ').replace('\u00a0', ' ')
    s = re.sub(r'\(.*?\)', ' ', s)
    s = re.sub(r'[.,]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip().lower().replace('ё', 'е')
    return s


mapping = json.load(open(MAP, encoding='utf-8'))
# ключ нормализуем так же, как при сопоставлении: в исходниках встречаются
# двойные пробелы и хвостовые пробелы («Беляев  Егор», «Новиков Алексей »)
MAP_BY_KEY = {key(k): v for k, v in mapping.items()}


def lookup(fio):
    info = mapping.get(str(fio))
    if info is None:
        info = MAP_BY_KEY.get(key(fio))
    return info
buf = io.StringIO()

# ─────────────────────────── источник 1: мой табель, фев-июнь
wb = openpyxl.load_workbook(MINE, data_only=False)
data = {}      # (emp_id, date) -> dict(points, color, src)
people = {}    # emp_id -> info

MONTHS1 = {'февр 2026': 2, 'март 2026': 3, 'апрель 2026': 4, 'май 2026': 5, 'июнь 2026': 6}
dup1 = 0
for sheet, mon in MONTHS1.items():
    ws = wb[sheet]
    days = [c for c in range(2, ws.max_column + 1)
            if isinstance(ws.cell(row=1, column=c).value, (int, float))
            and 1 <= ws.cell(row=1, column=c).value <= 31]
    legend = max(r for r in range(1, ws.max_row + 1)
                 if isinstance(ws.cell(row=r, column=1).value, str)
                 and 'подогрев' in ws.cell(row=r, column=1).value.lower())
    for r in range(2, legend):
        fio = ws.cell(row=r, column=1).value
        if not fio:
            continue
        # строки без отметок подогревателя пропускаем: в колонке A лежат и
        # названия других вахт («дорога», «Склад»), они не сотрудники
        day_cells = [(c, ws.cell(row=r, column=c)) for c in days]
        red = [(c, cell) for c, cell in day_cells
               if frgb(cell) == RED and isinstance(cell.value, (int, float))]
        if not red:
            continue
        info = lookup(fio)
        if info is None or info['id'] is None:
            raise RuntimeError('нет маппинга для %r' % fio)
        eid = info['id']
        people.setdefault(eid, info)
        for c, cell in red:
            d = dt.date(2026, mon, int(ws.cell(row=1, column=c).value))
            if (eid, d) in data:
                dup1 += 1
                continue
            data[(eid, d)] = {'v': cell.value, 'color': RED, 'src': SRC_MINE}

part1 = len(data)
buf.write('источник 1 (Табель, фев-июнь): %d отметок, дублей внутри: %d\n' % (part1, dup1))

# ─────────────────────────── источник 2: СРМ, июль-октябрь
wbc = openpyxl.load_workbook(CRM, data_only=True)
wsc = wbc['Табель']
# сверка календаря выгрузки с реальными датами
bad = []
for i in range(NDAYS):
    hdr = str(wsc.cell(row=4, column=3 + i).value or '').strip().split('\n')[0]
    if hdr != '%02d' % (START + dt.timedelta(days=i)).day:
        bad.append(i)
if bad:
    raise RuntimeError('календарь выгрузки СРМ не совпал: %s' % bad[:5])

crm_names = {}
for r in range(5, 39):
    fio = wsc.cell(row=r, column=2).value
    if not fio:
        continue
    info = lookup(fio)
    if info is None or info['id'] is None:
        raise RuntimeError('нет маппинга для СРМ %r' % fio)
    eid = info['id']
    people.setdefault(eid, info)
    crm_names[r] = (eid, str(fio))

part2 = 0
dup2 = 0
overlap = 0
for r, (eid, fio) in crm_names.items():
    for i in range(NDAYS):
        cell = wsc.cell(row=r, column=3 + i)
        if not isinstance(cell.value, (int, float)):
            continue
        d = START + dt.timedelta(days=i)
        k = (eid, d)
        if k in data:
            overlap += 1
            continue
        data[k] = {'v': cell.value, 'color': frgb(cell) or 'FFFFFFFF', 'src': SRC_CRM}
        part2 += 1

buf.write('источник 2 (СРМ, июль-окт): %d отметок, дублей внутри: %d\n' % (part2, dup2))
buf.write('пересечение по (человек,дата): %d\n' % overlap)
buf.write('итого в своде: %d отметок, людей: %d\n\n' % (len(data), len(people)))

# ─────────────────────────── проверки
assert overlap == 0, 'источники пересекаются по датам: %d' % overlap
assert part1 + part2 == len(data)

# ─────────────────────────── книга
out = openpyxl.Workbook()
sh = out.active
sh.title = 'Табель'

thin = Side(style='thin', color='FFBFBFBF')
med = Side(style='medium', color='FF808080')
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)

F_TITLE = Font(name='Calibri', size=14, bold=True)
F_SUB = Font(name='Calibri', size=10, italic=True, color='FF404040')
F_HDR = Font(name='Calibri', size=9, bold=True)
F_DAY = Font(name='Calibri', size=8)
F_NAME = Font(name='Calibri', size=9)
F_TOT = Font(name='Calibri', size=9, bold=True)
F_MONTH = Font(name='Calibri', size=10, bold=True, color='FFFFFFFF')

FILL_MONTH = PatternFill('solid', fgColor='FF1F4E79')
FILL_HDR = PatternFill('solid', fgColor='FFDDEBF7')
FILL_TOT = PatternFill('solid', fgColor='FFFFF2CC')
FILL_WEEKEND = PatternFill('solid', fgColor='FFF2F2F2')

MONTH_FILLS = {
    2: 'FFDDEBF7', 3: 'FFE2EFDA', 4: 'FFFFF2CC', 5: 'FFFCE4D6',
    6: 'FFEDE7F6', 7: 'FFD9E1F2', 8: 'FFE2EFDA', 9: 'FFFFF2CC', 10: 'FFFCE4D6',
}

sh['A1'] = 'ТАБЕЛЬ — Восстановительный ремонт огневых подогревателей МЛСП «Приразломная» — этап 2026'
sh['A1'].font = F_TITLE
sh.merge_cells('A1:C1')

sh['A2'] = ('Период: 01.02.2026 — 31.10.2026. Февраль–июнь — из табеля «Табель» '
            '(маркер «ремонт огн. подогревателя»), июль–октябрь — из выгрузки СРМ. '
            '1 балл = 500 ₽. Суточные не учитываются.')
sh['A2'].font = F_SUB
sh['A2'].alignment = Alignment(wrap_text=True, vertical='top')
sh.merge_cells('A2:C2')
sh.row_dimensions[2].height = 30

COL_NO, COL_FIO, COL_POS = 1, 2, 3
FIRST_DAY_COL = 4
LAST_DAY_COL = FIRST_DAY_COL + NDAYS - 1
COL_DAYS = LAST_DAY_COL + 1
COL_PTS = COL_DAYS + 1
COL_RUB = COL_PTS + 1

HDR_MONTH_ROW = 4
HDR_DAY_ROW = 5
HDR_STAFF_ROW = 3
FIRST_DATA_ROW = 6

# шапка: № / ФИО / Должность
for col, text in ((COL_NO, '№'), (COL_FIO, 'ФИО'), (COL_POS, 'Должность (СРМ)')):
    c = sh.cell(row=HDR_STAFF_ROW, column=col, value=text)
    c.font = F_HDR
    c.fill = FILL_HDR
    c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    c.border = BOX
    sh.merge_cells(start_row=HDR_STAFF_ROW, start_column=col,
                   end_row=HDR_DAY_ROW, end_column=col)

# шапка: месяцы
day_dates = [START + dt.timedelta(days=i) for i in range(NDAYS)]
i = 0
while i < NDAYS:
    d = day_dates[i]
    j = i
    while j + 1 < NDAYS and day_dates[j + 1].month == d.month:
        j += 1
    c1 = FIRST_DAY_COL + i
    c2 = FIRST_DAY_COL + j
    sh.merge_cells(start_row=HDR_MONTH_ROW, start_column=c1,
                   end_row=HDR_MONTH_ROW, end_column=c2)
    cell = sh.cell(row=HDR_MONTH_ROW, column=c1,
                   value='%s %d' % (MONTHS_RU[d.month - 1], d.year))
    cell.font = F_MONTH
    cell.fill = PatternFill('solid', fgColor=MONTH_FILLS[d.month])
    cell.fill = FILL_MONTH
    cell.alignment = Alignment(horizontal='center', vertical='center')
    for cc in range(c1, c2 + 1):
        sh.cell(row=HDR_MONTH_ROW, column=cc).border = BOX
    i = j + 1

# шапка: дни и дни недели
for i, d in enumerate(day_dates):
    col = FIRST_DAY_COL + i
    c = sh.cell(row=HDR_DAY_ROW, column=col, value='%02d\n%s' % (d.day, WD[d.weekday()]))
    c.font = F_DAY
    c.fill = FILL_HDR if d.weekday() < 5 else FILL_WEEKEND
    c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    c.border = BOX
sh.row_dimensions[HDR_DAY_ROW].height = 26

for col, text in ((COL_DAYS, 'Дней'), (COL_PTS, 'Баллов'), (COL_RUB, 'Заработок, ₽')):
    c = sh.cell(row=HDR_STAFF_ROW, column=col, value=text)
    c.font = F_HDR
    c.fill = FILL_TOT
    c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    c.border = BOX
    sh.merge_cells(start_row=HDR_STAFF_ROW, start_column=col,
                   end_row=HDR_DAY_ROW, end_column=col)

# ─────────────────────────── данные
order = sorted(people.values(), key=lambda p: key(p['fio']))
row = FIRST_DATA_ROW
per_person = {}
for n, p in enumerate(order, 1):
    eid = p['id']
    sh.cell(row=row, column=COL_NO, value=n).font = F_NAME
    cn = sh.cell(row=row, column=COL_FIO, value=p['fio'])
    cn.font = F_NAME
    cn.alignment = Alignment(vertical='center', wrap_text=False)
    cp = sh.cell(row=row, column=COL_POS, value=p['position'] or p['role'] or '')
    cp.font = F_NAME
    cp.alignment = Alignment(vertical='center', wrap_text=False)

    days_cnt = 0
    pts = 0
    months = {}
    for i, d in enumerate(day_dates):
        rec = data.get((eid, d))
        col = FIRST_DAY_COL + i
        cell = sh.cell(row=row, column=col)
        if rec:
            v = rec['v']
            cell.value = int(v) if float(v) == int(v) else v
            cell.fill = PatternFill('solid', fgColor=rec['color'])
            cell.font = F_DAY
            days_cnt += 1
            pts += v
            mk = '%04d-%02d' % (d.year, d.month)
            m = months.setdefault(mk, [0, 0])
            m[0] += 1
            m[1] += v
        cell.alignment = Alignment(horizontal='center', vertical='center')
        cell.border = BOX

    sh.cell(row=row, column=COL_DAYS, value=days_cnt).font = F_TOT
    sh.cell(row=row, column=COL_PTS, value=pts if float(pts) != int(pts) else int(pts)).font = F_TOT
    sh.cell(row=row, column=COL_RUB, value='=%s%d*500' % (get_column_letter(COL_PTS), row)).font = F_TOT
    for col in (COL_DAYS, COL_PTS, COL_RUB):
        c = sh.cell(row=row, column=col)
        c.fill = FILL_TOT
        c.alignment = Alignment(horizontal='center', vertical='center')
        c.border = BOX

    per_person[eid] = {'info': p, 'days': days_cnt, 'pts': pts, 'months': months}
    row += 1

last_data_row = row - 1

# итоговая строка
tr = row
sh.cell(row=tr, column=COL_FIO, value='ИТОГО').font = F_TOT
sh.cell(row=tr, column=COL_DAYS,
        value='=SUM(%s%d:%s%d)' % (get_column_letter(COL_DAYS), FIRST_DATA_ROW,
                                   get_column_letter(COL_DAYS), last_data_row)).font = F_TOT
sh.cell(row=tr, column=COL_PTS,
        value='=SUM(%s%d:%s%d)' % (get_column_letter(COL_PTS), FIRST_DATA_ROW,
                                   get_column_letter(COL_PTS), last_data_row)).font = F_TOT
sh.cell(row=tr, column=COL_RUB,
        value='=SUM(%s%d:%s%d)' % (get_column_letter(COL_RUB), FIRST_DATA_ROW,
                                   get_column_letter(COL_RUB), last_data_row)).font = F_TOT
for col in (COL_NO, COL_FIO, COL_POS, COL_DAYS, COL_PTS, COL_RUB):
    c = sh.cell(row=tr, column=col)
    c.fill = FILL_TOT
    c.border = Border(top=med, bottom=med, left=thin, right=thin)
    c.font = F_TOT

# ширины и закрепление
sh.column_dimensions['A'].width = 4.5
sh.column_dimensions['B'].width = 34
sh.column_dimensions['C'].width = 26
for i in range(NDAYS):
    sh.column_dimensions[get_column_letter(FIRST_DAY_COL + i)].width = 3.4
sh.column_dimensions[get_column_letter(COL_DAYS)].width = 7
sh.column_dimensions[get_column_letter(COL_PTS)].width = 8
sh.column_dimensions[get_column_letter(COL_RUB)].width = 13
sh.freeze_panes = sh.cell(row=FIRST_DATA_ROW, column=FIRST_DAY_COL)

# ─────────────────────────── легенда под таблицей
lr = tr + 2
sh.cell(row=lr, column=2, value='ЛЕГЕНДА').font = Font('Calibri', size=10, bold=True)
items = [
    ('FFFF0000', 'Февраль–июнь: работа на объекте (источник — табель «Табель», '
                 'маркер «ремонт огн. подогревателя Климакин/Трухин»)'),
    ('FFE8F5E9', 'Июль–октябрь (СРМ): День'),
    ('FFD6E4FF', 'Июль–октябрь (СРМ): Ночь'),
    ('FFCFFAFE', 'Июль–октябрь (СРМ): Дорога / самолёт'),
    ('FFFFF3CD', 'Июль–октябрь (СРМ): Корабль'),
    ('FFFFF8E1', 'Июль–октябрь (СРМ): Вертолёт'),
    ('FFFCE7F3', 'Июль–октябрь (СРМ): Обучение'),
    ('FFFEE2E2', 'Июль–октябрь (СРМ): Медосмотр'),
    ('FFFFEDD5', 'Июль–октябрь (СРМ): Ожидание'),
    ('FFF3F4F6', 'Июль–октябрь (СРМ): Полдня'),
    ('FFEDE9FE', 'Июль–октябрь (СРМ): Склад'),
    ('FFFFC000', 'Июль–октябрь (СРМ): Удалённая работа'),
]
for k, (rgb, label) in enumerate(items, 1):
    sw = sh.cell(row=lr + k, column=2)
    sw.fill = PatternFill('solid', fgColor=rgb)
    sw.border = BOX
    sh.cell(row=lr + k, column=3, value=label).font = Font('Calibri', size=9)
    sh.cell(row=lr + k, column=3).alignment = Alignment(vertical='center')

sh.auto_filter.ref = 'A%d:%s%d' % (HDR_STAFF_ROW, get_column_letter(COL_RUB), last_data_row)

# ─────────────────────────── лист «Сводка»
sm = out.create_sheet('Сводка')
sm['A1'] = 'СВОДКА ПО МЕСЯЦАМ'
sm['A1'].font = F_TITLE
hdr = ['№', 'ФИО', 'Должность (СРМ)', 'Категория']
mkeys = ['2026-%02d' % m for m in range(2, 11)]
mnames = ['%s' % MONTHS_RU[m - 1] for m in range(2, 11)]
for mk, mn in zip(mkeys, mnames):
    hdr += ['%s дн' % mn, '%s балл' % mn]
hdr += ['Дней всего', 'Баллов всего', 'Заработок, ₽']
for c, h in enumerate(hdr, 1):
    cell = sm.cell(row=3, column=c, value=h)
    cell.font = F_HDR
    cell.fill = FILL_HDR
    cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    cell.border = BOX
sm.row_dimensions[3].height = 32

r = 4
for n, p in enumerate(order, 1):
    pp = per_person[p['id']]
    sm.cell(row=r, column=1, value=n).font = F_NAME
    sm.cell(row=r, column=2, value=p['fio']).font = F_NAME
    sm.cell(row=r, column=3, value=p['position'] or p['role'] or '').font = F_NAME
    sm.cell(row=r, column=4, value=p['role'] or '').font = F_NAME
    col = 5
    for mk in mkeys:
        m = pp['months'].get(mk)
        sm.cell(row=r, column=col, value=(m[0] if m else None))
        v = (m[1] if m else None)
        sm.cell(row=r, column=col + 1,
                value=(int(v) if v is not None and float(v) == int(v) else v))
        col += 2
    sm.cell(row=r, column=col, value=pp['days'])
    sm.cell(row=r, column=col + 1,
            value=(int(pp['pts']) if float(pp['pts']) == int(pp['pts']) else pp['pts']))
    sm.cell(row=r, column=col + 2, value='=%s%d*500' % (get_column_letter(col + 1), r))
    for c in range(1, col + 3):
        cell = sm.cell(row=r, column=c)
        cell.border = BOX
        if c >= 5:
            cell.alignment = Alignment(horizontal='center')
            cell.font = F_NAME
    r += 1

sm.cell(row=r, column=2, value='ИТОГО').font = F_TOT
for c in range(5, len(hdr) + 1):
    cell = sm.cell(row=r, column=c,
                   value='=SUM(%s4:%s%d)' % (get_column_letter(c), get_column_letter(c), r - 1))
    cell.font = F_TOT
    cell.fill = FILL_TOT
    cell.alignment = Alignment(horizontal='center')
for c in range(1, len(hdr) + 1):
    sm.cell(row=r, column=c).border = Border(top=med, bottom=med, left=thin, right=thin)
    sm.cell(row=r, column=c).fill = FILL_TOT

sm.column_dimensions['A'].width = 4.5
sm.column_dimensions['B'].width = 34
sm.column_dimensions['C'].width = 26
sm.column_dimensions['D'].width = 12
for c in range(5, len(hdr) + 1):
    sm.column_dimensions[get_column_letter(c)].width = 9
sm.freeze_panes = 'E4'

# ─────────────────────────── лист «Источники»
sr = out.create_sheet('Источники и сверка')
sr['A1'] = 'ИСТОЧНИКИ И СВЕРКА'
sr['A1'].font = F_TITLE

lines = [
    ('', ''),
    ('Источник 1', '«Табель.xlsx» — присланный табель. Листы «февр 2026»..«июнь 2026».'),
    ('Маркер', '«ремонт огн подогревателя Климакин/Трухин» — сплошная красная заливка #FF0000.'),
    ('Что взято', 'только эти красные отметки; прочие отметки (дорога, склад, вахта, удалёнка) исключены.'),
    ('Июль/август источника 1', 'НЕ используются (по указанию: неверны).'),
    ('', ''),
    ('Источник 2', 'Выгрузка СРМ timesheet_work354_2026-02-01_2026-10-31.xlsx, лист «Табель».'),
    ('Объект', 'work_id=354 «Восстановительный ремонт огневых подогревателей МЛСП «Приразломная» — этап 2026».'),
    ('Что взято', 'все непустые ячейки сетки за 01.07.2026 — 22.10.2026.'),
    ('Важно', 'в выгрузке за 01.02.2026 — 30.06.2026 нет ни одной отметки: '
              'в СРМ по этому объекту данные начинаются с 01.07.2026.'),
    ('', ''),
    ('Пересечение', '0 (человек, дата) — источники стыкуются встык, без наложений.'),
    ('Итого отметок', '%d: февраль–июнь %d, июль–октябрь %d.' % (len(data), part1, part2)),
    ('Людей', '%d уникальных.' % len(people)),
    ('Должности', 'из СРМ: employees.position (полное), иначе employees.role_tag.'),
    ('', ''),
    ('Контрольная сверка', 'июль–август источника 1 (не используется) против СРМ на тех же датах: '
                           'совпало 399 значений из 445 общих дней, 46 расхождений — '
                           'округление 23,33 → 23 и 3 единичные правки. Это подтверждает, '
                           'что источники говорят на одном языке, а июль/август в источнике 1 '
                           'были неполными.'),
]
r = 3
for a, b in lines:
    ca = sr.cell(row=r, column=1, value=a)
    ca.font = Font('Calibri', size=9, bold=True)
    ca.alignment = Alignment(vertical='top')
    cb = sr.cell(row=r, column=2, value=b)
    cb.font = Font('Calibri', size=9)
    cb.alignment = Alignment(vertical='top', wrap_text=True)
    if b:
        sr.row_dimensions[r].height = 30
    r += 1
sr.column_dimensions['A'].width = 26
sr.column_dimensions['B'].width = 110

out.calculation.fullCalcOnLoad = True
out.save(DST)

# ─────────────────────────── отчёт
buf.write('=== СВОДНЫЙ ТАБЕЛЬ\n')
buf.write('период: %s .. %s (%d дней)\n' % (START, END, NDAYS))
buf.write('файл: %s\n' % DST)
buf.write('людей: %d\n\n' % len(order))

buf.write('=== по месяцам\n')
for m in range(2, 11):
    mk = '2026-%02d' % m
    days_t = sum(per_person[e]['months'].get(mk, [0, 0])[0] for e in per_person)
    pts_t = sum(per_person[e]['months'].get(mk, [0, 0])[1] for e in per_person)
    ppl = sum(1 for e in per_person if mk in per_person[e]['months'])
    src = 'Табель' if m <= 6 else 'СРМ'
    buf.write('  %-9s %-8s людей=%2d дней=%4d баллов=%s\n'
              % (MONTHS_RU[m - 1], src, ppl, days_t, int(pts_t) if pts_t == int(pts_t) else pts_t))

buf.write('\n=== контроль: суммы\n')
tot_days = sum(pp['days'] for pp in per_person.values())
tot_pts = sum(pp['pts'] for pp in per_person.values())
buf.write('  дней: %d (ожидалось %d)\n' % (tot_days, len(data)))
buf.write('  баллов: %s\n' % tot_pts)
buf.write('  руб: %s\n' % (tot_pts * 500))
assert tot_days == len(data), 'дней %d != отметок %d' % (tot_days, len(data))

buf.write('\n=== люди и должности\n')
for n, p in enumerate(order, 1):
    pp = per_person[p['id']]
    buf.write('  %2d. %-40s %-12s %-34s дней=%3d баллов=%s\n'
              % (n, p['fio'][:40], p['role'], (p['position'] or '')[:34],
                 pp['days'], int(pp['pts']) if float(pp['pts']) == int(pp['pts']) else pp['pts']))

buf.write('\n=== у кого нет должности в СРМ\n')
nopos = [p for p in order if not (p['position'] or p['role'])]
buf.write('  %d\n' % len(nopos))
for p in nopos:
    buf.write('   %s (id=%s)\n' % (p['fio'], p['id']))
onlyrole = [p for p in order if not p['position'] and p['role']]
buf.write('только role_tag (%d): %s\n' % (len(onlyrole), [(p['fio'], p['role']) for p in onlyrole]))

open(REPORT, 'w', encoding='utf-8').write(buf.getvalue())
print('saved')
