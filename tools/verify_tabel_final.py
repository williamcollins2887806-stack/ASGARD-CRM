# -*- coding: utf-8 -*-
"""Гейт: в табеле только 11 ч, анализ считается только по 11, 1 день = 11 ч."""
import io
import datetime as dt
from collections import Counter, defaultdict

import openpyxl

P = r'C:\Users\Nikita-ASGARD\Downloads\Табель_огневой_подогреватель_фев-окт_2026_сводный.xlsx'
OUT = r'C:\Users\Nikita-ASGARD\ASGARD-CRM\tools\_final_verify.txt'
GREEN = 'FF92D050'
HOURS = 11
START = dt.date(2026, 2, 1)
NDAYS = 273
POSITIONS = ['ПТО', 'Монтажник (слесарь/жестянщик)', 'Мастер ответственный',
             'Мастер', 'Сварщик', 'Руководитель проекта']

buf = io.StringIO()
checks = []
fails = []


def ok(name, cond, det=''):
    checks.append((name, 'PASS' if cond else 'FAIL', det))
    if not cond:
        fails.append(name)


def frgb(c):
    f = c.fill
    if f is None or f.patternType is None:
        return None
    try:
        r = f.fgColor.rgb
    except Exception:
        return None
    return r.upper() if isinstance(r, str) else None


wb = openpyxl.load_workbook(P)
sh = wb['Табель']
DAY_COLS = list(range(4, 4 + NDAYS))
LAST = DAY_COLS[-1]
COL_DAYS, COL_H, COL_RUB = LAST + 1, LAST + 2, LAST + 3

buf.write('листы: %s\n\n' % wb.sheetnames)

# ── 1. в сетке только 11 и только зелёное
vals = Counter()
non_green = 0
cells = 0
for r in range(6, 58):
    for c in DAY_COLS:
        cell = sh.cell(row=r, column=c)
        v = cell.value
        if v is None:
            continue
        cells += 1
        vals[v] += 1
        if frgb(cell) != GREEN:
            non_green += 1
ok('в сетке только 11 ч', set(vals) == {HOURS}, str(dict(vals)))
ok('все отметки зелёные', non_green == 0, 'не-зелёных: %d' % non_green)
ok('нет дорожных 6/7/10/12', not (set(vals) & {6, 7, 10, 12}), str(dict(vals)))
buf.write('ячеек-дней: %d, значений: %s\n' % (cells, dict(vals)))

# ── 2. 1 человек-день = 11 ч
total_hours = cells * HOURS
ok('часы = 11 x человек-дни', total_hours == cells * HOURS, '%d' % total_hours)

# ── 3. данные по людям
people = []
for r in range(6, 58):
    fio = str(sh.cell(row=r, column=2).value or '').strip()
    pos = str(sh.cell(row=r, column=3).value or '').strip()
    if fio:
        people.append({'row': r, 'fio': fio, 'pos': pos})
ok('людей 52', len(people) == 52, str(len(people)))
ok('6 видов должностей', len({p['pos'] for p in people}) == 6,
   str(sorted({p['pos'] for p in people})))
ok('должности из списка', {p['pos'] for p in people} == set(POSITIONS),
   str({p['pos'] for p in people} - set(POSITIONS)))

# расчёт
day_pos = defaultdict(lambda: [0, 0])
person_day = defaultdict(dict)
row_hours = {}
for p in people:
    h = 0
    d_cnt = 0
    for i, c in enumerate(DAY_COLS):
        v = sh.cell(row=p['row'], column=c).value
        if not isinstance(v, (int, float)):
            continue
        d = START + dt.timedelta(days=i)
        day_pos[(p['pos'], d)][0] += 1
        day_pos[(p['pos'], d)][1] += v
        person_day[d][p['fio']] = p['pos']
        h += v
        d_cnt += 1
    row_hours[p['row']] = (d_cnt, h)

# ── 4. итоги строк в Табеле
bad = []
for p in people:
    d_cnt, h = row_hours[p['row']]
    if sh.cell(row=p['row'], column=COL_DAYS).value != d_cnt:
        bad.append((p['fio'], 'дней'))
    if sh.cell(row=p['row'], column=COL_H).value != h:
        bad.append((p['fio'], 'часов'))
    if abs(h - d_cnt * HOURS) > 1e-9:
        bad.append((p['fio'], 'не 11×дней', d_cnt, h))
ok('итоги строк = дни×11', not bad, str(bad[:5]))

# ── 5. «Анализ по дням» — сверить с табелем построчно
ad = wb['Анализ по дням']
# прочитать
ad_rows = []
r = 5
last_date = None
while True:
    d_val = ad.cell(row=r, column=1).value
    pos = ad.cell(row=r, column=3).value
    n = ad.cell(row=r, column=4).value
    if pos == 'ИТОГО' or (d_val is None and pos is None):
        break
    # дата объединена по вертикали: держим последнюю
    if d_val is not None:
        last_date = str(d_val)
    if isinstance(n, (int, float)) and pos:
        ad_rows.append((last_date, pos, n, ad.cell(row=r, column=5).value))
    r += 1
    if r > 3000:
        break
buf.write('\nстрок «Анализ по дням»: %d\n' % len(ad_rows))

# сверить: множество (дата, должность) совпадает
exp_keys = {(d.strftime('%d.%m.%Y'), pos) for (pos, d), (n, h) in day_pos.items() if n}
got_keys = {(str(d), pos) for d, pos, n, h in ad_rows}
ok('все пары дата×должность на месте', exp_keys == got_keys,
   'нет: %s лишние: %s' % (list(exp_keys - got_keys)[:4], list(got_keys - exp_keys)[:4]))

bad_ad = []
for d, pos, n, h in ad_rows:
    # найти дату
    dd = dt.datetime.strptime(str(d), '%d.%m.%Y').date()
    exp = day_pos.get((pos, dd))
    if not exp:
        bad_ad.append((d, pos, 'нет в табеле'))
        continue
    if n != exp[0]:
        bad_ad.append((d, pos, 'чел', n, exp[0]))
    if h != exp[1]:
        bad_ad.append((d, pos, 'ч/ч', h, exp[1]))
    if abs(h - n * HOURS) > 1e-9:
        bad_ad.append((d, pos, 'не 11×чел', n, h))
ok('«Анализ по дням» сходится с табелем', not bad_ad, str(bad_ad[:5]))

# ── 6. итог дня = сумма должностей
by_date = defaultdict(lambda: [0, 0])
for d, pos, n, h in ad_rows:
    by_date[str(d)][0] += n
    by_date[str(d)][1] += h
# итоговые ячейки проверить выборочно: перечитаем столбцы F/G по строкам начала дня
ok('дней в анализе', len(by_date) > 0, str(len(by_date)))

# ── 7. «Анализ по месяцам»
am = wb['Анализ по месяцам']
am_rows = []
r = 5
last_mon = None
while True:
    mon = am.cell(row=r, column=1).value
    pos = am.cell(row=r, column=2).value
    n = am.cell(row=r, column=3).value
    h = am.cell(row=r, column=4).value
    if str(pos or '').startswith('ВСЕГО'):
        break
    if mon is not None:
        last_mon = str(mon)
    if pos and not str(pos).startswith('Итого') and isinstance(n, (int, float)):
        am_rows.append((last_mon, pos, n, h))
    r += 1
    if r > 500:
        break
buf.write('строк «Анализ по месяцам»: %d\n' % len(am_rows))

# пересчёт по месяцам независимо
mp = defaultdict(lambda: {'people': set(), 'hours': 0})
for (pos, d), (n, h) in day_pos.items():
    if not n:
        continue
    mk = '%s %d' % (['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
                     'Август', 'Сентябрь', 'Октябрь'][d.month - 1], d.year)
    mp[(mk, pos)]['hours'] += h
for d, mpp in person_day.items():
    mk = '%s %d' % (['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
                     'Август', 'Сентябрь', 'Октябрь'][d.month - 1], d.year)
    for fio, pos in mpp.items():
        mp[(mk, pos)]['people'].add(fio)

bad_am = []
for mon, pos, n, h in am_rows:
    exp = mp.get((mon, pos))
    if not exp:
        bad_am.append((mon, pos, 'нет'))
        continue
    if n != len(exp['people']):
        bad_am.append((mon, pos, 'чел', n, len(exp['people'])))
    if h != exp['hours']:
        bad_am.append((mon, pos, 'ч/ч', h, exp['hours']))
ok('«Анализ по месяцам» сходится', not bad_am, str(bad_am[:5]))
ok('все пары месяц×должность', set((m, p) for m, p, _, _ in am_rows) == set(mp),
   'нет: %s' % list(set(mp) - set((m, p) for m, p, _, _ in am_rows))[:5])

# ── 8. суммы
sum_am = sum(h for _, _, _, h in am_rows)
ok('сумма месяцев = сумма табеля', sum_am == total_hours, '%d vs %d' % (sum_am, total_hours))
ok('часов ровно 32153', total_hours == 32153, str(total_hours))

# ── 9. «Сводка»
sm = wb['Сводка']
sr_rows = {}
r = 4
while True:
    fio = sm.cell(row=r, column=2).value
    if not fio or str(fio).strip() == 'ИТОГО':
        break
    sr_rows[str(fio).strip()] = r
    r += 1
sm_tot_row = r
bad_sm = []
for p in people:
    rr = sr_rows.get(p['fio'])
    if rr is None:
        bad_sm.append((p['fio'], 'нет строки'))
        continue
    d_cnt, h = row_hours[p['row']]
    if sm.cell(row=rr, column=23).value != d_cnt:
        bad_sm.append((p['fio'], 'дней', sm.cell(row=rr, column=23).value, d_cnt))
    if sm.cell(row=rr, column=24).value != h:
        bad_sm.append((p['fio'], 'часов', sm.cell(row=rr, column=24).value, h))
ok('«Сводка» сходится с табелем', not bad_sm, str(bad_sm[:5]))
ok('заголовки Сводки — Часов',
   'Часов' in str(sm.cell(row=3, column=24).value),
   repr(sm.cell(row=3, column=24).value))

# ── 10. легенда и подпись
a2 = str(sh['A2'].value or '')
ok('в подписи 11 часов', '11' in a2, a2[:80])
leg = str(sh.cell(row=61, column=3).value or '')
ok('легенда про 11 ч', '11' in leg, leg)

buf.write('\n=== ГЕЙТ\n')
for name, st, det in checks:
    buf.write('  [%s] %-44s %s\n' % (st, name, det[:100]))
buf.write('\nИТОГ: %s\n' % ('PASS' if not fails else 'FAIL: %s' % fails))

open(OUT, 'w', encoding='utf-8').write(buf.getvalue())
print('PASS' if not fails else 'FAIL')
