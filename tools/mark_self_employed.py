"""
Скрипт сопоставляет контрактников из export_contractors_18_06.xlsx с employees в БД
и отмечает is_self_employed=true для найденных.
Также сохраняет «Оставшийся лимит» — пока в se_yearly_used_initial = max(0, 2_400_000 - остаток).
(Если пользователь уточнит что это другой лимит — пересчитаем.)
"""
import sys, io, json, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import openpyxl

XLSX = r'C:\Users\Nikita-ASGARD\Downloads\export_contractors_18_06.xlsx'
YEARLY_LIMIT = 2_400_000

def norm_phone(p):
    if not p: return ''
    d = re.sub(r'\D', '', str(p))
    if d.startswith('8') and len(d) == 11: d = '7' + d[1:]
    if len(d) == 10: d = '7' + d
    return d

def norm_fio(f):
    return re.sub(r'\s+', ' ', str(f).strip()).lower()

def parse_amount(s):
    if s is None: return 0
    if isinstance(s, (int, float)): return float(s)
    s = str(s).replace('\xa0', ' ').replace(' ', '').replace(',', '.')
    try: return float(s)
    except: return 0

wb = openpyxl.load_workbook(XLSX, data_only=True)
ws = wb.active

contractors = []
for row in ws.iter_rows(min_row=2, values_only=True):
    if not row or not row[1]:
        continue
    phone, fio, limit = row[0], row[1], row[2]
    contractors.append({
        'phone_raw': phone,
        'phone_norm': norm_phone(phone),
        'fio_raw': fio,
        'fio_norm': norm_fio(fio),
        'limit_raw': limit,
        'limit_amount': parse_amount(limit),
    })

print(f'Прочитано контрактников: {len(contractors)}')

# Сохраним JSON для передачи на сервер
out_path = r'C:\Users\Nikita-ASGARD\ASGARD-CRM\tools\contractors.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(contractors, f, ensure_ascii=False, indent=2)
print(f'Сохранено в: {out_path}')
print()
print('Пример первых 5:')
for c in contractors[:5]:
    print(f"  {c['fio_norm']:40} | {c['phone_norm']:12} | {c['limit_amount']:>12.2f}")
