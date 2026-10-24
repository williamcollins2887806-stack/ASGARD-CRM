"""Копия табеля: только отметки 'ремонт огн подогревателя' (красная заливка),
листы с февраля 2026 включительно.

Алгоритм:
 1. Копируем исходник, удаляем все листы, кроме февр..август 2026.
 2. На каждом листе:
    - блок дней = колонки с номерами 1..31 в строке 1 (реально B..AF или B..AE);
    - колонки итогов = где в исходнике стоят =SUM(...) и *=500 (обычно AG, AH);
    - строка маркера = строка легенды с текстом 'подогрев', её цвет = цвет отметки;
    - всё, что в области данных (от первого дня до колонки перед итогами) не имеет
      этого цвета, — очищается (значение и заливка);
    - итоги пересобираются формулами по СВОЕЙ строке (в исходнике они местами
      сдвинуты на строку вниз).
 3. Легенду не трогаем.
"""
import io
import shutil
from collections import Counter

import openpyxl
from openpyxl.cell.cell import MergedCell
from openpyxl.utils import get_column_letter
from openpyxl.styles import PatternFill

SRC = r'C:\Users\Nikita-ASGARD\Downloads\Табель.xlsx'
DST = r'C:\Users\Nikita-ASGARD\Downloads\Табель_огневой_подогреватель_с_фев2026.xlsx'
REPORT = r'C:\Users\Nikita-ASGARD\ASGARD-CRM\tools\_tabel_ogon_report.txt'

KEEP = ['февр 2026', 'март 2026', 'апрель 2026', 'май 2026',
        'июнь 2026', 'июль 2026', 'август 2026']

NOFILL = PatternFill(fill_type=None)


def fill_rgb(cell):
    f = cell.fill
    if f is None or f.patternType is None:
        return None
    try:
        rgb = f.fgColor.rgb
    except Exception:
        return None
    return rgb.upper() if isinstance(rgb, str) else None


def find_marker(ws):
    """(legend_row, rgb, text) — строка легенды про огневой подогреватель."""
    for r in range(1, ws.max_row + 1):
        v = ws.cell(row=r, column=1).value
        if isinstance(v, str) and 'подогрев' in v.lower():
            rgb = fill_rgb(ws.cell(row=r, column=1))
            if rgb is None:
                raise RuntimeError('%s: у строки подогревателя нет заливки' % ws.title)
            return r, rgb, v
    raise RuntimeError('%s: не найдена строка про подогреватель' % ws.title)


def day_cols(ws):
    cols = [c for c in range(2, ws.max_column + 1)
            if isinstance(ws.cell(row=1, column=c).value, (int, float))
            and 1 <= ws.cell(row=1, column=c).value <= 31]
    if not cols:
        raise RuntimeError('%s: нет шапки дней' % ws.title)
    # только непрерывный блок, начинающийся с дня 1
    if ws.cell(row=1, column=cols[0]).value != 1:
        raise RuntimeError('%s: первый столбец дней не 1' % ws.title)
    block = [cols[0]]
    for c in cols[1:]:
        if c != block[-1] + 1:
            break
        block.append(c)
    return block


def summary_cols(ws, after_col):
    """Колонки итогов: где стоят =SUM(...) и *=500 (правее дней)."""
    sum_c, rub_c = None, None
    for c in range(after_col + 1, ws.max_column + 2):
        for r in range(2, min(ws.max_row, 40) + 1):
            v = ws.cell(row=r, column=c).value
            if isinstance(v, str):
                if sum_c is None and v.startswith('=SUM('):
                    sum_c = c
                if rub_c is None and '*500' in v:
                    rub_c = c
    return sum_c, rub_c


shutil.copy2(SRC, DST)
wb = openpyxl.load_workbook(DST)

missing = [n for n in KEEP if n not in wb.sheetnames]
if missing:
    raise RuntimeError('нет листов: %s' % missing)
removed = [n for n in list(wb.sheetnames) if n not in KEEP]
for n in removed:
    wb.remove(wb[n])

buf = io.StringIO()
buf.write('ИСХОДНИК : %s\n' % SRC)
buf.write('КОПИЯ    : %s\n' % DST)
buf.write('Удалено листов: %d\n' % len(removed))
buf.write('Оставлено     : %s\n\n' % KEEP)

grand = 0
for name in KEEP:
    ws = wb[name]
    legend_row, target, target_text = find_marker(ws)
    days = day_cols(ws)
    first_col, last_col = days[0], days[-1]
    sum_c, rub_c = summary_cols(ws, last_col)
    if sum_c is None or rub_c is None:
        raise RuntimeError('%s: не найдены колонки итогов' % name)
    first_row, last_row = 2, legend_row - 1

    per_row = {}
    dropped = 0
    notes_dropped = 0
    skipped_merged = 0
    # чистим весь мусор от первого дня до колонки перед итогами
    for r in range(first_row, last_row + 1):
        for c in range(first_col, sum_c):
            cell = ws.cell(row=r, column=c)
            if isinstance(cell, MergedCell):
                skipped_merged += 1
                continue
            if c in days and fill_rgb(cell) == target:
                if isinstance(cell.value, (int, float)):
                    per_row.setdefault(r, []).append((c, cell.value))
                else:
                    per_row.setdefault(r, [])
            else:
                if cell.value is not None:
                    dropped += 1
                cell.value = None
                cell.fill = NOFILL
        if per_row.get(r):
            ws.cell(row=r, column=sum_c).value = '=SUM(%s%d:%s%d)' % (
                get_column_letter(first_col), r, get_column_letter(last_col), r)
            ws.cell(row=r, column=rub_c).value = '=%s%d*500' % (get_column_letter(sum_c), r)
        else:
            ws.cell(row=r, column=sum_c).value = None
            ws.cell(row=r, column=rub_c).value = None

    # за итоговыми колонками — только служебные заметки (удержания и пр.), их убираем
    for r in range(1, last_row + 1):
        for c in range(rub_c + 1, ws.max_column + 1):
            cell = ws.cell(row=r, column=c)
            if isinstance(cell, MergedCell):
                continue
            if cell.value is not None:
                notes_dropped += 1
                cell.value = None

    kept = sum(len(v) for v in per_row.values() if v)
    grand += kept
    buf.write('==================== %s\n' % name)
    buf.write('  маркер: строка %d %s -> %s (%r)\n' % (legend_row, target, 'PASS', target_text))
    buf.write('  дни: %s..%s (%d столбцов), итоги: %s / %s\n'
              % (get_column_letter(first_col), get_column_letter(last_col), len(days),
                 get_column_letter(sum_c), get_column_letter(rub_c)))
    buf.write('  строки данных: %d..%d\n' % (first_row, last_row))
    buf.write('  оставлено отметок: %d, сотрудников: %d, стёрто прочих значений: %d, заметок: %d\n'
              % (kept, len([r for r, v in per_row.items() if v]), dropped, notes_dropped))
    for r in sorted(per_row):
        cells = per_row[r]
        if not cells:
            continue
        nm = ws.cell(row=r, column=1).value
        d = [c - first_col + 1 for c, _ in cells]
        s = sum(v for _, v in cells)
        buf.write('    r%-4d %-40s дней=%2d дни=%d-%d сумма=%s\n'
                  % (r, str(nm)[:40].replace('\n', ' '), len(d), min(d), max(d),
                     int(s) if s == int(s) else round(s, 2)))

buf.write('\nИТОГО отметок: %d на %d листах\n' % (grand, len(KEEP)))
buf.write('Листы: %s\n' % wb.sheetnames)

wb.save(DST)
open(REPORT, 'w', encoding='utf-8').write(buf.getvalue())
print('saved')
