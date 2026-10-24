# -*- coding: utf-8 -*-
"""Сводный табель: только рабочие дни «11 часов».

Дорожные отметки 6 / 7 / 10 / 12 удаляются из табеля — это дорога, не работа.
Остаются только зелёные 11. 1 человек-день = 11 человеко-часов (НЕ 12).

Строятся листы:
  «Анализ по дням»    — дата / день недели / должность / человек / ч-ч
  «Анализ по месяцам» — месяц / должность / человек / ч-ч / дней с работой
Пересобираются итоги в «Табеле» и лист «Сводка».
"""
import io
import datetime as dt
from collections import defaultdict

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

P = r'C:\Users\Nikita-ASGARD\Downloads\Табель_огневой_подогреватель_фев-окт_2026_сводный.xlsx'
REPORT = r'C:\Users\Nikita-ASGARD\ASGARD-CRM\tools\_analysis_report.txt'

GREEN = 'FF92D050'
ROAD = (6, 7, 10, 12)
HOURS = 11                      # часов за один человек-день
START = dt.date(2026, 2, 1)
NDAYS = 273
FIRST_DATA_ROW = 6
LAST_DATA_ROW = 57

POSITIONS = ['ПТО', 'Монтажник (слесарь/жестянщик)', 'Мастер ответственный',
             'Мастер', 'Сварщик', 'Руководитель проекта']
MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
             'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

thin = Side(style='thin', color='FFBFBFBF')
med = Side(style='medium', color='FF808080')
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
F_TITLE = Font(name='Calibri', size=14, bold=True)
F_SUB = Font(name='Calibri', size=10, italic=True, color='FF404040')
F_HDR = Font(name='Calibri', size=9, bold=True, color='FFFFFFFF')
F_TXT = Font(name='Calibri', size=9)
F_BOLD = Font(name='Calibri', size=9, bold=True)
FILL_HDR = PatternFill('solid', fgColor='FF1F4E79')
FILL_TOT = PatternFill('solid', fgColor='FFFFF2CC')
FILL_MONTH = PatternFill('solid', fgColor='FFDDEBF7')
FILL_WEEKEND = PatternFill('solid', fgColor='FFF2F2F2')
FILL_GREEN = PatternFill('solid', fgColor=GREEN)

buf = io.StringIO()
wb = openpyxl.load_workbook(P)
sh = wb['Табель']

DAY_COLS = list(range(4, 4 + NDAYS))
LAST = DAY_COLS[-1]
COL_DAYS, COL_H, COL_RUB = LAST + 1, LAST + 2, LAST + 3

# ─── 1. убрать дорожные отметки 6/7/10/12
removed = defaultdict(int)
for r in range(FIRST_DATA_ROW, LAST_DATA_ROW + 1):
    for c in DAY_COLS:
        cell = sh.cell(row=r, column=c)
        v = cell.value
        if isinstance(v, (int, float)) and v in ROAD:
            removed[v] += 1
            cell.value = None
            cell.fill = PatternFill(fill_type=None)

buf.write('=== 1. УДАЛЕНО ДОРОЖНЫХ ОТМЕТОК\n')
for v in sorted(removed):
    buf.write('  %-3s x%d\n' % (v, removed[v]))
buf.write('всего удалено: %d\n' % sum(removed.values()))

# ─── 2. всё, что осталось, — 11 ч и зелёное
odd = defaultdict(int)
fixed = 0
for r in range(FIRST_DATA_ROW, LAST_DATA_ROW + 1):
    for c in DAY_COLS:
        cell = sh.cell(row=r, column=c)
        v = cell.value
        if v is None:
            continue
        if v != HOURS:
            odd[v] += 1
            cell.value = HOURS
            fixed += 1
        cell.fill = FILL_GREEN
        cell.font = Font(name='Calibri', size=8)
        cell.alignment = Alignment(horizontal='center', vertical='center')

buf.write('\n=== 2. ПРИВЕДЕНИЕ К 11 Ч\n')
buf.write('нестандартных значений найдено: %s\n' % dict(odd))
buf.write('исправлено: %d\n' % fixed)

# ─── 3. данные
people = []
for r in range(FIRST_DATA_ROW, LAST_DATA_ROW + 1):
    fio = str(sh.cell(row=r, column=2).value or '').strip()
    pos = str(sh.cell(row=r, column=3).value or '').strip()
    if fio:
        people.append({'row': r, 'fio': fio, 'pos': pos})

day_pos = defaultdict(lambda: [0, 0])   # (pos, date) -> [чел, часы]
person_day = defaultdict(dict)          # date -> {fio: (pos, часы)}
row_stat = {}

for p in people:
    d_cnt = 0
    h_sum = 0
    months = defaultdict(lambda: [0, 0])
    for i, c in enumerate(DAY_COLS):
        v = sh.cell(row=p['row'], column=c).value
        if not isinstance(v, (int, float)):
            continue
        d = START + dt.timedelta(days=i)
        rec = day_pos[(p['pos'], d)]
        rec[0] += 1
        rec[1] += v
        person_day[d][p['fio']] = (p['pos'], v)
        d_cnt += 1
        h_sum += v
        mm = months['%04d-%02d' % (d.year, d.month)]
        mm[0] += 1
        mm[1] += v
    row_stat[p['row']] = {'days': d_cnt, 'hours': h_sum, 'months': dict(months)}
    sh.cell(row=p['row'], column=COL_DAYS).value = d_cnt
    sh.cell(row=p['row'], column=COL_H).value = h_sum
    sh.cell(row=p['row'], column=COL_RUB).value = '=%s%d*500' % (get_column_letter(COL_H), p['row'])

sh.cell(row=3, column=COL_H).value = 'Часов'
sh.cell(row=3, column=COL_RUB).value = 'Стоимость, ₽'

tot_row = LAST_DATA_ROW + 1
for col in (COL_DAYS, COL_H, COL_RUB):
    sh.cell(row=tot_row, column=col).value = '=SUM(%s%d:%s%d)' % (
        get_column_letter(col), FIRST_DATA_ROW, get_column_letter(col), LAST_DATA_ROW)

dates = sorted(person_day)
total_cells = sum(s['days'] for s in row_stat.values())
total_hours = sum(s['hours'] for s in row_stat.values())

buf.write('\n=== 3. ДАННЫЕ\n')
buf.write('человек: %d\n' % len(people))
buf.write('ячеек-дней: %d\n' % total_cells)
buf.write('человеко-часов: %d\n' % total_hours)
buf.write('проверка 11 x ячеек: %d\n' % (total_cells * HOURS))
buf.write('дней с работой: %d (%s .. %s)\n' % (len(dates), dates[0], dates[-1]))

# ─── 4. подпись и легенда
sh['A2'] = ('Период: 01.02.2026 — 31.10.2026. В клетке — рабочий день на объекте: %d часов. '
            'Дорожные дни (переезды, корабль, вертолёт, обучение) в табель не входят. '
            '1 час = 500 ₽.' % HOURS)
sh['A2'].font = F_SUB

for rr in range(60, sh.max_row + 1):
    for cc in (2, 3):
        sh.cell(row=rr, column=cc).value = None
        sh.cell(row=rr, column=cc).fill = PatternFill(fill_type=None)
sh.cell(row=60, column=2, value='ЛЕГЕНДА').font = Font('Calibri', size=10, bold=True)
sw = sh.cell(row=61, column=2)
sw.fill = FILL_GREEN
sw.border = BOX
sh.cell(row=61, column=3,
        value='%d ч — рабочий день на объекте (1 человек-день = %d человеко-часов)'
              % (HOURS, HOURS)).font = F_TXT
sh.cell(row=62, column=3,
        value='Дорога, переезды, корабль, вертолёт, обучение и медосмотр не входят').font = F_TXT

# ─── 5. «Анализ по дням»
for name in ('Анализ по дням', 'Анализ по месяцам'):
    if name in wb.sheetnames:
        del wb[name]
ad = wb.create_sheet('Анализ по дням', 1)

ad['A1'] = 'АНАЛИЗ ПО ДНЯМ — человек и человеко-часы по должностям'
ad['A1'].font = F_TITLE
ad['A2'] = ('%s — %s. Только рабочие дни на объекте: 1 человек-день = %d ч. '
            'Дорожные дни не учитываются.' % (dates[0].strftime('%d.%m.%Y'),
                                              dates[-1].strftime('%d.%m.%Y'), HOURS))
ad['A2'].font = F_SUB
ad.merge_cells('A2:G2')

for c, h in enumerate(['Дата', 'День недели', 'Должность', 'Человек', 'ч/ч',
                       'Итого человек', 'Итого ч/ч'], 1):
    cell = ad.cell(row=4, column=c, value=h)
    cell.font = F_HDR
    cell.fill = FILL_HDR
    cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    cell.border = BOX
ad.row_dimensions[4].height = 30

r = 5
day_totals = []
for d in dates:
    rows_here = [(pos, day_pos[(pos, d)][0], day_pos[(pos, d)][1])
                 for pos in POSITIONS if day_pos.get((pos, d), [0])[0]]
    if not rows_here:
        continue
    n_all = sum(x[1] for x in rows_here)
    h_all = sum(x[2] for x in rows_here)
    day_totals.append((d, n_all, h_all))

    start_row = r
    for pos, n, h in rows_here:
        ad.cell(row=r, column=1, value=d.strftime('%d.%m.%Y')).font = F_TXT
        wd = ad.cell(row=r, column=2, value=WD[d.weekday()])
        wd.font = F_TXT
        ad.cell(row=r, column=3, value=pos).font = F_TXT
        for cc, val in ((4, n), (5, h)):
            cell = ad.cell(row=r, column=cc, value=val)
            cell.font = F_TXT
            cell.alignment = Alignment(horizontal='center')
        for c in range(1, 8):
            ad.cell(row=r, column=c).border = BOX
        if d.weekday() >= 5:
            wd.fill = FILL_WEEKEND
        r += 1
    end_row = r - 1

    if end_row > start_row:
        for col in (1, 2, 6, 7):
            ad.merge_cells(start_row=start_row, start_column=col,
                           end_row=end_row, end_column=col)
    for cc, val in ((6, n_all), (7, h_all)):
        cell = ad.cell(row=start_row, column=cc, value=val)
        cell.font = F_BOLD
        cell.fill = FILL_TOT
        cell.alignment = Alignment(horizontal='center', vertical='center')
    ad.cell(row=start_row, column=1).alignment = Alignment(vertical='center')
    ad.cell(row=start_row, column=2).alignment = Alignment(horizontal='center', vertical='center')
    for rr in range(start_row, end_row + 1):
        for cc in (1, 2, 6, 7):
            ad.cell(row=rr, column=cc).border = BOX

ad.cell(row=r, column=3, value='ИТОГО').font = F_BOLD
ad.cell(row=r, column=4, value=sum(x[1] for x in day_totals)).font = F_BOLD
ad.cell(row=r, column=5, value=sum(x[2] for x in day_totals)).font = F_BOLD
for cc in range(1, 8):
    cell = ad.cell(row=r, column=cc)
    cell.fill = FILL_TOT
    cell.border = Border(top=med, bottom=med, left=thin, right=thin)
    if cc >= 4:
        cell.alignment = Alignment(horizontal='center')

ad.column_dimensions['A'].width = 12
ad.column_dimensions['B'].width = 12
ad.column_dimensions['C'].width = 32
ad.column_dimensions['D'].width = 10
ad.column_dimensions['E'].width = 9
ad.column_dimensions['F'].width = 14
ad.column_dimensions['G'].width = 12
ad.freeze_panes = 'A5'

# ─── 6. «Анализ по месяцам»
am = wb.create_sheet('Анализ по месяцам', 2)
am['A1'] = 'АНАЛИЗ ПО МЕСЯЦАМ — человек и человеко-часы по должностям'
am['A1'].font = F_TITLE
am['A2'] = 'Уникальных человек — различных ФИО с хотя бы одной рабочей отметкой за месяц. 1 человек-день = %d ч.' % HOURS
am['A2'].font = F_SUB
am.merge_cells('A2:F2')

per_month = {('2026-%02d' % m): {pos: {'people': set(), 'hours': 0, 'days': 0}
                                 for pos in POSITIONS} for m in range(2, 11)}
for (pos, d), (n, h) in day_pos.items():
    rec = per_month['%04d-%02d' % (d.year, d.month)][pos]
    rec['hours'] += h
    rec['days'] += 1
for d, mp in person_day.items():
    mk = '%04d-%02d' % (d.year, d.month)
    for fio, (pos, _) in mp.items():
        per_month[mk][pos]['people'].add(fio)

for c, h in enumerate(['Месяц', 'Должность', 'Человек', 'ч/ч', 'Дней с работой',
                       'Средне в день, ч/ч'], 1):
    cell = am.cell(row=4, column=c, value=h)
    cell.font = F_HDR
    cell.fill = FILL_HDR
    cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    cell.border = BOX
am.row_dimensions[4].height = 30

r = 5
month_summary = []
for m in range(2, 11):
    mk = '2026-%02d' % m
    rows_here = [(pos, len(per_month[mk][pos]['people']),
                  per_month[mk][pos]['hours'], per_month[mk][pos]['days'])
                 for pos in POSITIONS if per_month[mk][pos]['people']]
    if not rows_here:
        continue
    m_people = set()
    for pos in POSITIONS:
        m_people |= per_month[mk][pos]['people']
    m_hours = sum(x[2] for x in rows_here)
    m_days = sum(x[3] for x in rows_here)
    month_summary.append((m, len(m_people), m_hours, m_days))

    start_row = r
    for pos, n, h, dw in rows_here:
        am.cell(row=r, column=1, value='%s %d' % (MONTHS_RU[m - 1], 2026)).font = F_TXT
        am.cell(row=r, column=2, value=pos).font = F_TXT
        am.cell(row=r, column=3, value=n).font = F_TXT
        am.cell(row=r, column=4, value=h).font = F_TXT
        am.cell(row=r, column=5, value=dw).font = F_TXT
        am.cell(row=r, column=6, value=round(h / dw, 1) if dw else 0).font = F_TXT
        for c in range(1, 7):
            cell = am.cell(row=r, column=c)
            cell.border = BOX
            if c >= 3:
                cell.alignment = Alignment(horizontal='center')
        r += 1
    end_row = r - 1
    if end_row > start_row:
        am.merge_cells(start_row=start_row, start_column=1, end_row=end_row, end_column=1)
        for rr in range(start_row, end_row + 1):
            am.cell(row=rr, column=1).border = BOX
    am.cell(row=start_row, column=1).alignment = Alignment(vertical='center')

    am.cell(row=r, column=2, value='Итого за %s' % MONTHS_RU[m - 1]).font = F_BOLD
    am.cell(row=r, column=3, value=len(m_people)).font = F_BOLD
    am.cell(row=r, column=4, value=m_hours).font = F_BOLD
    am.cell(row=r, column=5, value=m_days).font = F_BOLD
    for c in range(1, 7):
        cell = am.cell(row=r, column=c)
        cell.fill = FILL_MONTH
        cell.border = Border(top=med, bottom=med, left=thin, right=thin)
        if c >= 3:
            cell.alignment = Alignment(horizontal='center')
    r += 1

am.cell(row=r + 1, column=2, value='ВСЕГО ЗА ПЕРИОД').font = F_BOLD
am.cell(row=r + 1, column=3, value=len({f for dd in person_day.values() for f in dd})).font = F_BOLD
am.cell(row=r + 1, column=4, value=sum(x[2] for x in month_summary)).font = F_BOLD
am.cell(row=r + 1, column=5, value=sum(x[3] for x in month_summary)).font = F_BOLD
for c in range(1, 7):
    cell = am.cell(row=r + 1, column=c)
    cell.fill = FILL_TOT
    cell.border = Border(top=med, bottom=med, left=thin, right=thin)
    if c >= 3:
        cell.alignment = Alignment(horizontal='center')

am.column_dimensions['A'].width = 18
am.column_dimensions['B'].width = 34
for col in 'CDEF':
    am.column_dimensions[col].width = 14
am.freeze_panes = 'A5'

# ─── 7. «Сводка»
sm = wb['Сводка']
sm.cell(row=3, column=4).value = 'Исходно (СРМ)'
sm_rows = {}
r = 4
while True:
    fio = sm.cell(row=r, column=2).value
    if not fio or str(fio).strip() == 'ИТОГО':
        break
    sm_rows[str(fio).strip()] = r
    r += 1
sm_tot = r

col = 5
for m in range(2, 11):
    sm.cell(row=3, column=col).value = '%s дн' % MONTHS_RU[m - 1]
    sm.cell(row=3, column=col + 1).value = '%s ч' % MONTHS_RU[m - 1]
    col += 2
TOT_D, TOT_H, TOT_R = col, col + 1, col + 2
sm.cell(row=3, column=TOT_D).value = 'Дней всего'
sm.cell(row=3, column=TOT_H).value = 'Часов всего'
sm.cell(row=3, column=TOT_R).value = 'Стоимость, ₽'

for p in people:
    rr = sm_rows.get(p['fio'])
    if rr is None:
        raise RuntimeError('нет строки в Сводке: %r' % p['fio'])
    st = row_stat[p['row']]
    sm.cell(row=rr, column=3).value = p['pos']
    col = 5
    for m in range(2, 11):
        mm = st['months'].get('2026-%02d' % m)
        sm.cell(row=rr, column=col).value = (mm[0] if mm else None)
        sm.cell(row=rr, column=col + 1).value = (mm[1] if mm else None)
        col += 2
    sm.cell(row=rr, column=TOT_D).value = st['days']
    sm.cell(row=rr, column=TOT_H).value = st['hours']
    sm.cell(row=rr, column=TOT_R).value = '=%s%d*500' % (get_column_letter(TOT_H), rr)
    for c in range(3, TOT_R + 1):
        cell = sm.cell(row=rr, column=c)
        cell.border = BOX
        if c >= 5:
            cell.alignment = Alignment(horizontal='center')

for c in range(5, TOT_R + 1):
    sm.cell(row=sm_tot, column=c).value = '=SUM(%s4:%s%d)' % (
        get_column_letter(c), get_column_letter(c), sm_tot - 1)

# ─── 8. «Источники»
sr = wb['Источники и сверка']
for rr in range(sr.max_row, 0, -1):
    if str(sr.cell(row=rr, column=1).value or '').startswith(('Нормализация', 'Что считается',
                                                             'Что исключено', 'Итог', 'Расчёт')):
        sr.cell(row=rr, column=1).value = None
        sr.cell(row=rr, column=2).value = None
r = sr.max_row
while r > 1 and not (sr.cell(row=r, column=1).value or sr.cell(row=r, column=2).value):
    r -= 1
rows = [
    ('', ''),
    ('Что считается', 'только рабочие дни на объекте — зелёные отметки %d ч. '
                      '1 человек-день = %d человеко-часов.' % (HOURS, HOURS)),
    ('Что исключено', 'дорожные дни (6 — дорога, 7 — полдня, 10 и 12 — корабль/перелёты): '
                      'это дорога, а не часы работ. Удалено %d отметок.'
        % sum(removed.values())),
    ('Итог', '%d человеко-часов, %d человек-дней, %d человек.'
        % (total_hours, total_cells, len(people))),
    ('Расчёт', '1 час = 500 ₽. «Стоимость» = Часов × 500.'),
]
r += 2
for a, b in rows:
    ca = sr.cell(row=r, column=1, value=a)
    ca.font = Font('Calibri', size=9, bold=True)
    ca.alignment = Alignment(vertical='top')
    cb = sr.cell(row=r, column=2, value=b)
    cb.font = Font('Calibri', size=9)
    cb.alignment = Alignment(vertical='top', wrap_text=True)
    sr.row_dimensions[r].height = 32
    r += 1

wb.calculation.fullCalcOnLoad = True
wb.save(P)

# ─── 9. отчёт
buf.write('\n=== 4. ПО МЕСЯЦАМ\n')
for m, n, h, dw in month_summary:
    buf.write('  %-10s человек=%2d  ч/ч=%5d  дней-человек=%3d\n' % (MONTHS_RU[m - 1], n, h, dw))
buf.write('\n=== 5. КОНТРОЛЬ\n')
buf.write('сумма по строкам:  %d\n' % total_hours)
buf.write('сумма по месяцам:  %d\n' % sum(x[2] for x in month_summary))
buf.write('сумма по дням:     %d\n' % sum(x[2] for x in day_totals))
buf.write('11 x человек-дней: %d\n' % (total_cells * HOURS))
buf.write('дней в графике:    %d\n' % len(day_totals))
buf.write('\n=== 6. ПРИМЕРЫ ДНЕЙ\n')
for d, n, h in day_totals[:4] + day_totals[-3:]:
    parts = ['%s: %d чел / %d ч/ч' % (pos, day_pos[(pos, d)][0], day_pos[(pos, d)][1])
             for pos in POSITIONS if day_pos.get((pos, d), [0])[0]]
    buf.write('  %s (%s) всего %d чел, %d ч/ч | %s\n'
              % (d.strftime('%d.%m.%Y'), WD[d.weekday()], n, h, '; '.join(parts)))
open(REPORT, 'w', encoding='utf-8').write(buf.getvalue())
print('saved')
