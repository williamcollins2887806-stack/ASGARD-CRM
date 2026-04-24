import paramiko
import os
import base64
import tempfile

KEY_PATH = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
HOST = '92.242.61.184'
USER = 'root'
LOCAL_DIR = 'C:/Users/Nikita-ASGARD/ASGARD-CRM/screenshots'
REMOTE_DIR = '/var/www/asgard-crm/public/e2e-screenshots'

ALL_FILES = [
    ('01_tenders_page.png', '1. Страница тендеров', 'Тендер #2 в таблице'),
    ('01b_tender_card.png', '1b. Карточка тендера #2', 'Форма тендера'),
    ('02_after_handoff.png', '2. После Передачи', 'Toast: ссылка на документы нужна (v5)'),
    ('02_pm_calcs.png', '2b. PM Calcs (БАГ)', 'Пусто для ADMIN — 0 строк'),
    ('03_estimates.png', '3. Свод Расчётов', '2 просчёта в списке'),
    ('03b_estimate_card.png', '3b. Карточка просчёта', 'Детали просчёта'),
    ('03c_approved.png', '3c. Согласовано', 'Зелёный бейдж «Согласовано»'),
    ('05_work_card.png', '5. Карточка работы #1', 'Стоимость, аванс, себестоимость'),
    ('05b_staff_filled.png', '5b. Заявка на персонал', 'Мастера, Слесари, ПТО, Промывщики'),
    ('05c_staff_requested.png', '5c. Запрос отправлен', 'После «Запросить рабочих»'),
    ('06_actions_menu.png', '6. Меню Действия', 'Осмотр, Финансы, Полевой модуль'),
    ('07_field_module.png', '6b. Field — Действия', 'Кнопка «Полевой модуль»'),
    ('08_field_crew.png', '7a. Бригада', 'Добавить сотрудника, SMS, Запустить Field'),
    ('08_field_logistics.png', '7b. Логистика', 'Таб логистика'),
    ('08_field_dashboard.png', '7c. Дашборд', '4 метрики: объект, чекины, часы, заработок'),
    ('08_field_timesheet.png', '7d. Табель', 'Даты, Загрузить, Excel'),
    ('08_field_packing.png', '7e. Сборы', 'Таб сборы'),
    ('09_personnel.png', '8. Персонал', 'Поиск Андросов'),
    ('10_tenders_final.png', '9. Тендеры финал', 'Финальное состояние'),
    ('11_works_final.png', '10. Работы финал', 'Финальное состояние'),
    ('99_final.png', '11. Финал', 'Последний скриншот'),
]

# Build HTML with embedded base64 images
html_parts = ['''<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>E2E Screenshots — ASGARD CRM</title>
<style>
body{background:#1a1a2e;color:#eee;font-family:-apple-system,sans-serif;margin:0;padding:20px}
h1{text-align:center;color:#D4A843;font-size:24px}
.s{background:#16213e;padding:20px;border-radius:12px;margin:20px auto;max-width:900px}
.s h2{color:#D4A843;margin-top:0}
.ok{color:#4caf50}.fail{color:#f44336}.warn{color:#ff9800}
.g{max-width:1400px;margin:0 auto}
.c{background:#16213e;border-radius:12px;overflow:hidden;margin-bottom:30px}
.c h3{padding:15px 20px 5px;margin:0;color:#D4A843;font-size:16px}
.c p{padding:0 20px 10px;margin:0;color:#aaa;font-size:13px}
.c img{width:100%;display:block;cursor:zoom-in}
.b{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:bold}
.bf{background:#b71c1c;color:#ef5350}.bw{background:#e65100;color:#ff9800}
</style>
</head>
<body>
<h1>⚔ E2E Test — ASGARD CRM</h1>
<div class="s">
<h2>Результаты v6 (04.04.2026)</h2>
<pre style="font-size:14px;line-height:1.8">
<span class="ok">✅</span> 0. Login
<span class="ok">✅</span> 1. Handoff (Передать в просчёт)
<span class="ok">✅</span> 2. Create Estimate (ID:2) <span class="bw">pm-calcs пуст — БАГ</span>
<span class="ok">✅</span> 3. Approve Estimate — «Согласовано»
<span class="ok">✅</span> 4. Work (ID:1)
<span class="ok">✅</span> 5. Work Card + Staff Request
<span class="ok">✅</span> 6. Field Module (5 табов)
<span class="ok">✅</span> 7. Personnel
</pre>
<h3>Баги</h3>
<p><span class="b bf">БАГ 1</span> PM Calcs — 0 строк для ADMIN</p>
<p><span class="b bw">БАГ 2</span> PAGE_ERR при сохранении работы</p>
<p><span class="b bw">БАГ 3</span> Оверлей actions menu не закрывается</p>
</div>
<div class="g">
''']

for fname, title, desc in ALL_FILES:
    fpath = os.path.join(LOCAL_DIR, fname)
    if not os.path.exists(fpath):
        print(f'SKIP {fname}')
        continue

    with open(fpath, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()

    size_kb = os.path.getsize(fpath) // 1024
    print(f'{fname} ({size_kb}KB)')

    html_parts.append(f'''<div class="c">
<h3>{title}</h3>
<p>{desc}</p>
<img src="data:image/png;base64,{b64}" alt="{title}" loading="lazy">
</div>
''')

html_parts.append('''</div>
<p style="text-align:center;color:#666;margin-top:40px">E2E test runner • ASGARD CRM • 04.04.2026</p>
</body></html>''')

html_content = ''.join(html_parts)
print(f'\nHTML size: {len(html_content)//1024}KB')

# Save locally
local_html = os.path.join(LOCAL_DIR, 'gallery.html')
with open(local_html, 'w', encoding='utf-8') as f:
    f.write(html_content)
print(f'Saved locally: {local_html}')

# Upload via paramiko SFTP (single file, bigger timeout)
print('Connecting to server...')
key = paramiko.Ed25519Key.from_private_key_file(KEY_PATH)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, pkey=key, timeout=30)

# Create dir
ssh.exec_command(f'mkdir -p {REMOTE_DIR}', timeout=10)
import time; time.sleep(2)

# Use SFTP for single file
sftp = ssh.open_sftp()
sftp.get_channel().settimeout(120)  # 2 min timeout for big file
sftp.put(local_html, f'{REMOTE_DIR}/index.html')
print('Uploaded!')

# Verify
stdin, stdout, stderr = ssh.exec_command(f'ls -la {REMOTE_DIR}/index.html', timeout=10)
print(stdout.read().decode().strip())

sftp.close()
ssh.close()
print(f'\n✅ Gallery: https://asgard-crm.ru/e2e-screenshots/')
