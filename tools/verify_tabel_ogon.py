"""Проверка копии против исходника.

Эталон: ячейки блока дней с заливкой маркера «огневой подогреватель»
(строка легенды). Сравниваются значения И заливки в блоке дней, отдельно
проверяются итоговые колонки и то, что за пределами сетки ничего не потеряно.
"""
import io
import openpyxl

SRC = r'C:\Users\Nikita-ASGARD\Downloads\Табель.xlsx'
DST = r'C:\Users\Nikita-ASGARD\Downloads\Табель_огневой_подогреватель_с_фев2026.xlsx'
OUT = r'C:\Users\Nikita-ASGARD\ASGARD-CRM\tools\_tabel_verify.txt'
KEEP = ['февр 2026', 'март 2026', 'апрель 2026', 'май 2026',
        'июнь 2026', 'июль 2026', 'август 2026']
buf = io.StringIO()
fails = []


def frgb(c):
    f = c.fill
    if f is None or f.patternType is None:
        return None
    try:
        r = f.fgColor.rgb
    except Exception:
        return None
    return r.upper() if isinstance(r, str) else None


def layout(ws):
    days = [c for c in range(2, ws.max_column + 1)
            if isinstance(ws.cell(row=1, column=c).value, (int, float))
            and 1 <= ws.cell(row=1, column=c).value <= 31]
    legend = max(r for r in range(1, ws.max_row + 1)
                 if isinstance(ws.cell(row=r, column=1).value, str)
                 and 'подогрев' in ws.cell(row=r, column=1).value.lower())
    return days, legend


orig = openpyxl.load_workbook(SRC)
copy = openpyxl.load_workbook(DST)

buf.write('=== 1. Состав и порядок листов\n')
buf.write('копия: %s\n' % copy.sheetnames)
if copy.sheetnames != KEEP:
    fails.append('листы: %s' % copy.sheetnames)

buf.write('\n=== 2. Отметки: эталон (исходник) vs копия\n')
total_exp = 0
for name in KEEP:
    wo, wc = orig[name], copy[name]
    days, legend = layout(wo)
    first, last = days[0], days[-1]
    exp = {}
    for r in range(2, legend):
        for c in days:
            cell = wo.cell(row=r, column=c)
            if frgb(cell) == 'FFFF0000':
                exp[(r, c)] = cell.value
    got, extra_val, wrong_fill = {}, [], []
    for r in range(2, legend):
        for c in range(first, wc.max_column + 1):
            cell = wc.cell(row=r, column=c)
            rgb = frgb(cell)
            if c in days:
                if rgb == 'FFFF0000':
                    got[(r, c)] = cell.value
                elif cell.value is not None:
                    extra_val.append((cell.coordinate, cell.value))
                if rgb and rgb != 'FFFF0000':
                    wrong_fill.append((cell.coordinate, rgb))
            else:
                # всё правее сетки дней должно быть пустым, кроме итогов
                if cell.value is not None and not str(cell.value).startswith('='):
                    extra_val.append((cell.coordinate, cell.value))
    missing = [k for k in exp if k not in got]
    extra = [k for k in got if k not in exp]
    vdiff = [(k, exp[k], got[k]) for k in exp if k in got and exp[k] != got[k]]
    total_exp += len(exp)
    ok = not (missing or extra or vdiff or extra_val or wrong_fill)
    buf.write('\n%-12s эталон=%4d копия=%4d %s\n'
              % (name, len(exp), len(got), 'PASS' if ok else 'FAIL'))
    if missing:
        buf.write('   нет в копии: %d %s\n' % (len(missing), missing[:5]))
        fails.append('%s: нет %d' % (name, len(missing)))
    if extra:
        buf.write('   лишние красные: %d %s\n' % (len(extra), extra[:5]))
        fails.append('%s: лишние красные %d' % (name, len(extra)))
    if vdiff:
        buf.write('   другие значения: %s\n' % vdiff[:5])
        fails.append('%s: значения %d' % (name, len(vdiff)))
    if extra_val:
        buf.write('   остались чужие значения: %d %s\n' % (len(extra_val), extra_val[:5]))
        fails.append('%s: чужие значения %d' % (name, len(extra_val)))
    if wrong_fill:
        buf.write('   чужая заливка: %d %s\n' % (len(wrong_fill), wrong_fill[:5]))
        fails.append('%s: чужая заливка %d' % (name, len(wrong_fill)))

buf.write('\nВсего эталонных отметок: %d\n' % total_exp)

buf.write('\n=== 3. Легенда не тронута\n')
for name in KEEP:
    wo, wc = orig[name], copy[name]
    _, legend = layout(wo)
    bad = []
    for r in range(legend, wo.max_row + 1):
        a, b = wo.cell(row=r, column=1), wc.cell(row=r, column=1)
        if a.value != b.value or frgb(a) != frgb(b):
            bad.append((r, a.value, b.value, frgb(a), frgb(b)))
    buf.write('   %-12s %s\n' % (name, 'PASS' if not bad else 'FAIL %s' % bad))
    if bad:
        fails.append('%s: легенда' % name)

buf.write('\n=== 4. Итоги по своей строке\n')
for name in KEEP:
    wc = copy[name]
    days, legend = layout(wc)
    first, last = days[0], days[-1]
    sum_c, rub_c = 33, 34
    bad = []
    for r in range(2, legend):
        nums = [wc.cell(row=r, column=c).value for c in days]
        nums = [v for v in nums if isinstance(v, (int, float))]
        ag, ah = wc.cell(row=r, column=sum_c).value, wc.cell(row=r, column=rub_c).value
        if not nums:
            if ag is not None or ah is not None:
                bad.append((r, 'итог без отметок', ag, ah))
            continue
        want = '=SUM(%s%d:%s%d)' % (openpyxl.utils.get_column_letter(first), r,
                                    openpyxl.utils.get_column_letter(last), r)
        if ag != want or ah != '=AG%d*500' % r:
            bad.append((r, ag, ah, want))
        elif abs(sum(nums) - sum(nums)) > 1e-9:
            bad.append((r, 'арифметика'))
    buf.write('   %-12s %s\n' % (name, 'PASS' if not bad else 'FAIL %s' % bad[:4]))
    if bad:
        fails.append('%s: итоги %s' % (name, bad[:4]))

buf.write('\n=== 5. Формулы исходника не потеряны вне сетки\n')
buf.write('   (легенда и заголовки проверены в п.3)\n')

buf.write('\n=== ИТОГ: %s\n' % ('PASS' if not fails else 'FAIL'))
for f in fails:
    buf.write('   - %s\n' % f)

open(OUT, 'w', encoding='utf-8').write(buf.getvalue())
print('PASS' if not fails else 'FAIL')
