# -*- coding: utf-8 -*-
"""Независимая проверка нормализации сводного табеля."""
import io
import datetime as dt
from collections import Counter

import openpyxl

SRC = r'C:\Users\Nikita-ASGARD\Downloads\Табель_огневой_подогреватель_фев-окт_2026_сводный.BACKUP.xlsx'
DST = r'C:\Users\Nikita-ASGARD\Downloads\Табель_огневой_подогреватель_фев-окт_2026_сводный.xlsx'
OUT = r'C:\Users\Nikita-ASGARD\ASGARD-CRM\tools\_normalize_verify.txt'

KEEP = {6, 7, 12}
NEW = 11
GREEN = 'FF92D050'
POSITIONS = {'ПТО', 'Монтажник (слесарь/жестянщик)', 'Мастер ответственный',
             'Мастер', 'Сварщик', 'Руководитель проекта'}

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


def num(v):
    return int(v) if isinstance(v, float) and v == int(v) else v


old = openpyxl.load_workbook(SRC)
new = openpyxl.load_workbook(DST)
wo, wn = old['Табель'], new['Табель']

NDAYS = 273
day_cols = list(range(4, 4 + NDAYS))
COL_DAYS, COL_PTS, COL_RUB = day_cols[-1] + 1, day_cols[-1] + 2, day_cols[-1] + 3

# границы
tot_o = next(r for r in range(6, wo.max_row + 1) if str(wo.cell(row=r, column=2).value or '').strip() == 'ИТОГО')
tot_n = next(r for r in range(6, wn.max_row + 1) if str(wn.cell(row=r, column=2).value or '').strip() == 'ИТОГО')
ok('строки данных не сдвинулись', tot_o == tot_n, '%d vs %d' % (tot_o, tot_n))
last = tot_o - 1

# ── 1. баллы: поэлементно old -> new
bad_val, bad_color, kept_cnt, repl_cnt = [], [], Counter(), 0
exp = {}
for r in range(6, last + 1):
    for c in day_cols:
        ov = wo.cell(row=r, column=c).value
        nv = wn.cell(row=r, column=c).value
        if not isinstance(ov, (int, float)):
            if nv is not None:
                bad_val.append((r, c, 'было пусто', nv))
            continue
        o = num(ov)
        want = o if o in KEEP else NEW
        exp[(r, c)] = want
        if num(nv) != want:
            bad_val.append((wo.cell(row=r, column=c).coordinate, o, nv))
        if o in KEEP:
            kept_cnt[o] += 1
        else:
            repl_cnt += 1
            if frgb(wn.cell(row=r, column=c)) != GREEN:
                bad_color.append((wo.cell(row=r, column=c).coordinate, frgb(wn.cell(row=r, column=c))))
ok('все значения приведены по правилу', not bad_val, str(bad_val[:6]))
ok('все заменённые — зелёные', not bad_color, str(bad_color[:6]))
ok('6/7/12 сохранены', all(v > 0 for v in [kept_cnt[6], kept_cnt[7], kept_cnt[12]]), str(dict(kept_cnt)))

# цвета сохранённых не перекрашены в зелёный
bad_keep_color = []
for r in range(6, last + 1):
    for c in day_cols:
        ov = wo.cell(row=r, column=c).value
        if isinstance(ov, (int, float)) and num(ov) in KEEP:
            if frgb(wn.cell(row=r, column=c)) == GREEN:
                bad_keep_color.append(wo.cell(row=r, column=c).coordinate)
ok('6/7/12 не перекрашены в зелёный', not bad_keep_color, str(bad_keep_color[:6]))

buf.write('заменено: %d, сохранено: %s, всего: %d\n'
          % (repl_cnt, dict(kept_cnt), repl_cnt + sum(kept_cnt.values())))
ok('число ячеек не изменилось', len(exp) == 3121, str(len(exp)))

# новых значений в файле не появилось
present = Counter()
for r in range(6, last + 1):
    for c in day_cols:
        v = wn.cell(row=r, column=c).value
        if isinstance(v, (int, float)):
            present[num(v)] += 1
ok('в сетке только 11 и 6/7/12', set(present) <= ({NEW} | KEEP), str(dict(present)))

# ── 2. должности
poss = {}
r = 6
while r <= last:
    fio = str(wn.cell(row=r, column=2).value or '').strip()
    pos = str(wn.cell(row=r, column=3).value or '').strip()
    poss[fio] = pos
    r += 1
ok('ровно 6 видов должностей', len(set(poss.values())) == 6, str(sorted(set(poss.values()))))
ok('только из согласованного списка', set(poss.values()) == POSITIONS,
   str(set(poss.values()) - POSITIONS))
ok('у всех должность заполнена', all(poss.values()), str([k for k, v in poss.items() if not v][:5]))
ok('52 человека', len(poss) == 52, str(len(poss)))

cnt = Counter(poss.values())
buf.write('\nраспределение должностей:\n')
for p in sorted(POSITIONS, key=lambda x: -cnt.get(x, 0)):
    buf.write('  %-34s %2d\n' % (p, cnt.get(p, 0)))
ok('сумма по должностям = 52', sum(cnt.values()) == 52, str(sum(cnt.values())))

# ── 3. итоги строк
bad_tot = []
for r in range(6, last + 1):
    nums = [v for v in (wn.cell(row=r, column=c).value for c in day_cols)
            if isinstance(v, (int, float))]
    d = wn.cell(row=r, column=COL_DAYS).value
    p = wn.cell(row=r, column=COL_PTS).value
    if d != len(nums):
        bad_tot.append((r, 'дней', d, len(nums)))
    if p is None or abs(float(p) - sum(nums)) > 1e-9:
        bad_tot.append((r, 'баллов', p, sum(nums)))
    rub = wn.cell(row=r, column=COL_RUB).value
    if rub != '=%s%d*500' % (openpyxl.utils.get_column_letter(COL_PTS), r):
        bad_tot.append((r, 'руб', rub))
ok('итоги строк пересчитаны', not bad_tot, str(bad_tot[:6]))

# ── 4. Сводка соответствует Табелю
sm = new['Сводка']
sm_rows = {}
r = 4
while True:
    fio = sm.cell(row=r, column=2).value
    if not fio or str(fio).strip() == 'ИТОГО':
        break
    sm_rows[str(fio).strip()] = r
    r += 1
sm_tot = r

mism = []
for row in range(6, last + 1):
    fio = str(wn.cell(row=row, column=2).value or '').strip()
    rr = sm_rows.get(fio)
    if rr is None:
        mism.append((fio, 'нет на Сводке'))
        continue
    if str(sm.cell(row=rr, column=3).value or '').strip() != poss[fio]:
        mism.append((fio, 'должность', sm.cell(row=rr, column=3).value, poss[fio]))
    # сумма по месяцам
    msum = sum(v for v in (sm.cell(row=rr, column=c).value
                           for c in range(6, 24, 2)) if isinstance(v, (int, float)))
    tsum = sum(v for v in (wn.cell(row=row, column=c).value for c in day_cols)
               if isinstance(v, (int, float)))
    if abs(msum - tsum) > 1e-9:
        mism.append((fio, 'сумма месяцев', msum, tsum))
    if sm.cell(row=rr, column=23).value != len([1 for c in day_cols
                                                if isinstance(wn.cell(row=row, column=c).value, (int, float))]):
        mism.append((fio, 'дней всего', sm.cell(row=rr, column=23).value))
    if abs(float(sm.cell(row=rr, column=24).value) - tsum) > 1e-9:
        mism.append((fio, 'баллов всего', sm.cell(row=rr, column=24).value, tsum))
ok('Сводка сходится с Табелем', not mism, str(mism[:6]))

# итог Сводки = итог Табеля по значениям
tot_pts_new = sum(v for r2 in range(6, last + 1)
                  for v in (wn.cell(row=r2, column=c).value for c in day_cols)
                  if isinstance(v, (int, float)))
buf.write('\nбаллов всего: %s (было %s)\n'
          % (tot_pts_new, sum(num(wo.cell(row=r2, column=c).value)
                              for r2 in range(6, last + 1) for c in day_cols
                              if isinstance(wo.cell(row=r2, column=c).value, (int, float)))))
ok('баллов ровно 33920', tot_pts_new == 33920, str(tot_pts_new))

# ── 5. легенда
leg = []
for rr in range(tot_n + 1, wn.max_row + 1):
    v = wn.cell(row=rr, column=3).value
    if v:
        leg.append((frgb(wn.cell(row=rr, column=2)), str(v)))
buf.write('\nлегенда:\n')
for rgb, t in leg:
    buf.write('  %-10s %s\n' % (rgb, t))
ok('легенда описывает 11 и 6/7/12', len(leg) == 4 and any('11' in t for _, t in leg),
   str(len(leg)))
ok('зелёный свотч в легенде', any(rgb == GREEN for rgb, _ in leg), str([r for r, _ in leg]))

# ── 6. лист Источников дополнен
sr = new['Источники и сверка']
flat = ' '.join(str(sr.cell(row=i, column=j).value or '')
                for i in range(1, sr.max_row + 1) for j in (1, 2))
ok('в «Источниках» описана нормализация',
   'Нормализация баллов' in flat and 'Нормализация должностей' in flat)

buf.write('\n=== ГЕЙТ\n')
for name, st, det in checks:
    buf.write('  [%s] %-44s %s\n' % (st, name, det[:100]))
buf.write('\nИТОГ: %s\n' % ('PASS' if not fails else 'FAIL: %s' % fails))

open(OUT, 'w', encoding='utf-8').write(buf.getvalue())
print('PASS' if not fails else 'FAIL')
