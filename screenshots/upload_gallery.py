import paramiko
import os
import glob

KEY_PATH = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
HOST = '92.242.61.184'
USER = 'root'
LOCAL_DIR = 'C:/Users/Nikita-ASGARD/ASGARD-CRM/screenshots'
REMOTE_DIR = '/var/www/asgard-crm/public/e2e-screenshots'

# V6 run screenshots (last successful run)
V6_FILES = [
    '02_pm_calcs.png',
    '03_estimates.png',
    '03b_estimate_card.png',
    '03c_approved.png',
    '05_work_card.png',
    '05b_staff_filled.png',
    '05c_staff_requested.png',
    '06_actions_menu.png',
    '07_field_module.png',
    '08_field_crew.png',
    '08_field_logistics.png',
    '08_field_dashboard.png',
    '08_field_timesheet.png',
    '08_field_packing.png',
    '09_personnel.png',
    '10_tenders_final.png',
    '11_works_final.png',
    '99_final.png',
]

# Also include earlier screenshots from v3/v5 runs that show tender creation
EARLIER_FILES = [
    '01_tenders_page.png',
    '01b_tender_card.png',
    '02_after_handoff.png',
]

ALL_FILES = EARLIER_FILES + V6_FILES

# HTML gallery
HTML = '''<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>E2E Test Screenshots — ASGARD CRM</title>
<style>
  body { background: #1a1a2e; color: #eee; font-family: -apple-system, sans-serif; margin: 0; padding: 20px; }
  h1 { text-align: center; color: #D4A843; }
  .summary { background: #16213e; padding: 20px; border-radius: 12px; margin: 20px auto; max-width: 800px; }
  .summary h2 { color: #D4A843; margin-top: 0; }
  .ok { color: #4caf50; }
  .fail { color: #f44336; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 30px; max-width: 1400px; margin: 0 auto; }
  .card { background: #16213e; border-radius: 12px; overflow: hidden; }
  .card h3 { padding: 15px 20px 5px; margin: 0; color: #D4A843; font-size: 16px; }
  .card p { padding: 0 20px 10px; margin: 0; color: #aaa; font-size: 13px; }
  .card img { width: 100%; display: block; cursor: pointer; transition: transform 0.2s; }
  .card img:hover { transform: scale(1.02); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
  .badge-ok { background: #1b5e20; color: #4caf50; }
  .badge-fail { background: #b71c1c; color: #ef5350; }
  .badge-warn { background: #e65100; color: #ff9800; }
</style>
</head>
<body>
<h1>⚔ E2E Test — ASGARD CRM</h1>
<div class="summary">
  <h2>Результаты прогона v6 (04.04.2026)</h2>
  <pre style="font-size:14px; line-height:1.8">
<span class="ok">✅</span> 0. Login
<span class="ok">✅</span> 1. Handoff (Передать в просчёт) — уже выполнено ранее (v5)
<span class="ok">✅</span> 2. Create Estimate (ID:2) — через API (pm-calcs пуст, <span class="badge badge-warn">БАГ</span>)
<span class="ok">✅</span> 3. Approve Estimate (ID:2) — статус «Согласовано»
<span class="ok">✅</span> 4. Work (ID:1) — найдена существующая
<span class="ok">✅</span> 5. Open Work Card + Staff Request
<span class="ok">✅</span> 6. Field Module — 5 табов (crew, logistics, dashboard, timesheet, packing)
<span class="ok">✅</span> 7. Personnel — поиск Андросов

<b>Объекты:</b> Tender #2 → Estimate #2 → Work #1
  </pre>
  <h3>Найденные баги</h3>
  <p><span class="badge badge-fail">БАГ 1</span> PM Calcs (#/pm-calcs) — 0 строк для ADMIN при наличии тендера с handoff_at</p>
  <p><span class="badge badge-warn">БАГ 2</span> PAGE_ERR «Ошибка обработки запроса» при сохранении работы</p>
  <p><span class="badge badge-warn">БАГ 3</span> Оверлей #asgard-action-menu-overlay не закрывается после открытия полевого модуля</p>
</div>

<div class="grid">
'''

DESCRIPTIONS = {
    '01_tenders_page.png': ('1. Страница тендеров', 'Список тендеров с тендером #2 (ПАО ЛУКОЙЛ-Нефтехим, статус Новый)'),
    '01b_tender_card.png': ('1b. Карточка тендера #2', 'Форма тендера открыта — Тип, РП, ТЕГ, Даты, Цена'),
    '02_after_handoff.png': ('2. После «Передать в просчёт»', 'Карточка тендера с тостом о требовании документов (v5)'),
    '02_pm_calcs.png': ('2. PM Calcs — пусто', 'БАГ: Карта Похода • Просчёты показывает 0 строк для ADMIN'),
    '03_estimates.png': ('3. Свод Расчётов', 'Список просчётов — 2 записи (ПАО ЛУКОЙЛ-Нефтехим)'),
    '03b_estimate_card.png': ('3b. Карточка просчёта', 'Детали просчёта: цена ТКП, себестоимость, РП'),
    '03c_approved.png': ('3c. Просчёт согласован', 'Статус «Согласовано» (зелёный бейдж), цена 4 850 000'),
    '05_work_card.png': ('5. Карточка работы #1', 'Форма работы: стоимость, аванс, себестоимость, численность, заявка HR'),
    '05b_staff_filled.png': ('5b. Заявка на персонал', 'Заполнены: Мастера, Слесари, ПТО, Промывщики, вахта, ротация'),
    '05c_staff_requested.png': ('5c. Запрос рабочих отправлен', 'После нажатия «Запросить рабочих»'),
    '06_actions_menu.png': ('6. Меню «⚡ Действия»', 'Секции: Осмотр, Финансы, Планирование, Полевой модуль, Оборудование'),
    '07_field_module.png': ('6b. Полевой модуль — действия', 'Меню действий с кнопкой «Полевой модуль» (Бригада, логистика, дашборд, табель)'),
    '08_field_crew.png': ('7. Полевой модуль — Бригада', 'Таб «Бригада»: ФИО, Роль, Тариф, Баллы, кнопка «Запустить Field»'),
    '08_field_logistics.png': ('7b. Полевой модуль — Логистика', 'Таб «Логистика»'),
    '08_field_dashboard.png': ('7c. Полевой модуль — Дашборд', '4 метрики: на объекте, чекинов, часов, заработок'),
    '08_field_timesheet.png': ('7d. Полевой модуль — Табель', 'Диапазон дат, кнопки Загрузить/Выгрузить Excel'),
    '08_field_packing.png': ('7e. Полевой модуль — Сборы', 'Таб «Сборы»'),
    '09_personnel.png': ('8. Персонал', 'Страница #/personnel — поиск «Андросов»'),
    '10_tenders_final.png': ('9. Тендеры — финал', 'Финальное состояние страницы тендеров'),
    '11_works_final.png': ('10. Работы — финал', 'Финальное состояние страницы работ'),
    '99_final.png': ('11. Финальный скриншот', 'Последний скриншот прогона'),
}

for f in ALL_FILES:
    title, desc = DESCRIPTIONS.get(f, (f, ''))
    HTML += f'''
  <div class="card">
    <h3>{title}</h3>
    <p>{desc}</p>
    <a href="{f}" target="_blank"><img src="{f}" alt="{title}" loading="lazy"></a>
  </div>
'''

HTML += '''
</div>
<p style="text-align:center; color:#666; margin-top:40px">Generated by E2E test runner • ASGARD CRM</p>
</body>
</html>
'''

# Connect and upload
key = paramiko.Ed25519Key.from_private_key_file(KEY_PATH)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, pkey=key, timeout=30)
sftp = ssh.open_sftp()

# Create remote dir
try:
    sftp.mkdir(REMOTE_DIR)
except:
    pass

# Upload index.html
index_path = os.path.join(LOCAL_DIR, 'index.html')
with open(index_path, 'w', encoding='utf-8') as f:
    f.write(HTML)
sftp.put(index_path, f'{REMOTE_DIR}/index.html')
print('Uploaded index.html')

# Upload screenshots
for fname in ALL_FILES:
    local = os.path.join(LOCAL_DIR, fname)
    if os.path.exists(local):
        remote = f'{REMOTE_DIR}/{fname}'
        sftp.put(local, remote)
        print(f'Uploaded {fname} ({os.path.getsize(local)//1024}KB)')
    else:
        print(f'SKIP {fname} (not found)')

sftp.close()
ssh.close()
print('\nDone! Gallery at: https://asgard-crm.ru/e2e-screenshots/')
