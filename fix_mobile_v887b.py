#!/usr/bin/env python3
"""
ASGARD CRM v8.8.7b — Fix back navigation + schedule calendar grid
1. Router error handler: add "Назад" button instead of only "На главную"
2. OfficeSchedulePage: proper calendar grid with horizontal scroll + sticky ФИО
"""

import re, shutil, os
from datetime import datetime

BASE = '/var/www/asgard-crm/public/assets'
RENDERS = f'{BASE}/js/mobile_renders.js'
ROUTER = f'{BASE}/js/router.js'
CSS = f'{BASE}/css/mobile_premium.css'
INDEX = '/var/www/asgard-crm/public/index.html'
BACKUP_DIR = '/var/www/asgard-crm/backups'

ts = datetime.now().strftime('%Y%m%d_%H%M%S')

def backup(path):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    dst = f'{BACKUP_DIR}/v887b_{os.path.basename(path)}_{ts}'
    shutil.copy2(path, dst)
    print(f'  Backup: {dst}')

def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)


# ═══════════════════════════════════════════════════════════════
# 1. Router — add "Назад" button to error handler
# ═══════════════════════════════════════════════════════════════
print('\n=== router.js — error handler ===')
backup(ROUTER)
router = read(ROUTER)

old_error = '<a href="#/home" style="color:#9bd">На главную</a><a href="#/diag" style="color:#9bd">Диагностика</a>'
new_error = '<a href="javascript:void(0)" onclick="history.back()" style="color:#9bd;cursor:pointer">← Назад</a><a href="#/home" style="color:#9bd">На главную</a><a href="#/diag" style="color:#9bd">Диагностика</a>'

if old_error in router:
    router = router.replace(old_error, new_error)
    print('  Added "Назад" button to error handler')
else:
    print('  SKIP: error handler pattern not found')

write(ROUTER, router)


# ═══════════════════════════════════════════════════════════════
# 2. OfficeSchedulePage — calendar grid with scroll + sticky ФИО
# ═══════════════════════════════════════════════════════════════
print('\n=== mobile_renders.js — OfficeSchedule calendar grid ===')
backup(RENDERS)
js = read(RENDERS)

# Find and replace the entire AsgardOfficeSchedulePage patch
old_schedule_start = "  /* OFFICE SCHEDULE — мобильный вид графика офиса */"
old_schedule_end = "  /* STAFF SCHEDULE — мобильный вид графика рабочих */"

if old_schedule_start in js and old_schedule_end in js:
    idx_start = js.index(old_schedule_start)
    idx_end = js.index(old_schedule_end)

    new_schedule = """  /* OFFICE SCHEDULE — мобильный вид графика офиса (v8.8.7b calendar grid) */
  patchModule('AsgardOfficeSchedulePage', async function({ layout, title }) {
    var auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }

    /* ── Data ── */
    var staff = [];
    try { staff = await AsgardDB.all('staff') || []; } catch(e) { console.warn('[MobileRender]', e.message || e); }
    staff.sort(function(a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'ru'); });

    if (!staff.length) {
      /* Seed staff from users if empty */
      try {
        var users = await AsgardDB.all('users') || [];
        for (var ui = 0; ui < users.length; ui++) {
          var u = users[ui];
          if (!u.is_active) continue;
          await AsgardDB.add('staff', { user_id: u.id, name: u.name || u.login, role_tag: u.role || '', created_at: new Date().toISOString() });
        }
        staff = await AsgardDB.all('staff') || [];
        staff.sort(function(a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'ru'); });
      } catch(e) { console.warn('[MobileRender] seed error', e); }
    }

    var allPlan = [];
    try { allPlan = await AsgardDB.all('staff_plan') || []; } catch(e) { console.warn('[MobileRender]', e.message || e); }

    var STATUS = [
      { code: 'оф', label: 'В офисе', color: '#3b82f6' },
      { code: 'уд', label: 'Удалёнка', color: '#0ea5e9' },
      { code: 'бн', label: 'На больничном', color: '#ef4444' },
      { code: 'сс', label: 'За свой счёт', color: '#f59e0b' },
      { code: 'км', label: 'Командировка', color: '#a855f7' },
      { code: 'пг', label: 'Встреча/переговоры', color: '#22c55e' },
      { code: 'уч', label: 'Учёба', color: '#10b981' },
      { code: 'ск', label: 'Склад', color: '#94a3b8' },
      { code: 'вх', label: 'Выходной', color: '#334155' }
    ];
    var colorMap = {};
    STATUS.forEach(function(s) { colorMap[s.code] = s.color; });

    var now = new Date();
    var viewYear = now.getFullYear();
    var viewMonth = now.getMonth();

    function ymd(d) {
      var x = new Date(d);
      return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    }
    function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
    function isWeekend(d) { var g = d.getDay(); return g === 0 || g === 6; }

    var MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

    function buildGrid() {
      var numDays = daysInMonth(viewYear, viewMonth);
      var todayIso = ymd(now);
      var staffIds = staff.map(function(s) { return s.id; });
      var startIso = viewYear + '-' + String(viewMonth + 1).padStart(2, '0') + '-01';
      var endIso = viewYear + '-' + String(viewMonth + 1).padStart(2, '0') + '-' + String(numDays).padStart(2, '0');

      /* Build plan lookup */
      var planMap = {};
      allPlan.forEach(function(p) {
        if (!p || !p.date) return;
        if (staffIds.indexOf(p.staff_id) === -1) return;
        var d = ymd(p.date);
        if (d < startIso || d > endIso) return;
        planMap[p.staff_id + '|' + d] = p.status_code || '';
      });

      /* Legend */
      var legend = '<div class="m-sched-legend">';
      STATUS.forEach(function(s) {
        legend += '<span class="m-sched-legend-item"><span class="m-sched-legend-dot" style="background:' + s.color + '"></span>' + esc(s.label) + '</span>';
      });
      legend += '</div>';

      /* Month nav */
      var nav = '<div class="m-sched-nav">';
      nav += '<button class="m-sched-nav-btn" id="schedPrev">Назад</button>';
      nav += '<span class="m-sched-month">' + MONTHS_RU[viewMonth] + ' ' + viewYear + '</span>';
      nav += '<button class="m-sched-nav-btn" id="schedNext">Вперёд</button>';
      nav += '</div>';

      /* Table */
      var table = '<div class="m-sched-scroll">';
      table += '<table class="m-sched-table">';

      /* Header row: ФИО + days */
      table += '<thead><tr><th class="m-sched-name-col">Сотрудник</th>';
      for (var d = 1; d <= numDays; d++) {
        var dt = new Date(viewYear, viewMonth, d);
        var wk = isWeekend(dt);
        var iso = ymd(dt);
        var cls = wk ? ' m-sched-wk' : '';
        if (iso === todayIso) cls += ' m-sched-today';
        table += '<th class="m-sched-day-col' + cls + '">' + d + '</th>';
      }
      table += '</tr></thead>';

      /* Body rows */
      table += '<tbody>';
      staff.forEach(function(s) {
        table += '<tr>';
        table += '<td class="m-sched-name-col">' + esc(s.name || '—') + '</td>';
        for (var d = 1; d <= numDays; d++) {
          var dt = new Date(viewYear, viewMonth, d);
          var iso = ymd(dt);
          var wk = isWeekend(dt);
          var key = s.id + '|' + iso;
          var code = planMap[key] || '';
          if (!code && wk) code = 'вх';
          var bg = code && colorMap[code] ? 'background:' + colorMap[code] + '80;' : '';
          var cls = wk ? ' m-sched-wk' : '';
          if (iso === todayIso) cls += ' m-sched-today';
          table += '<td class="m-sched-cell' + cls + '" style="' + bg + '"></td>';
        }
        table += '</tr>';
      });
      table += '</tbody></table></div>';

      /* Scroll indicator */
      var indicator = '<div class="m-sched-scroll-hint">← листай →</div>';

      return nav + legend + indicator + table;
    }

    var body = '<div class="m-page" data-mobile-native="1">';
    body += '<div class="m-section-title" style="font-size:20px;font-weight:700;margin-bottom:4px">График Дружины • Офис</div>';
    body += '<div class="m-section-subtitle" style="color:var(--t2);font-size:13px;margin-bottom:16px;font-style:italic">Порядок в строю — ясность в делах.</div>';
    body += '<div id="schedGrid">' + buildGrid() + '</div>';
    body += '</div>';

    await layout(body, { title: title || 'График Дружины • Офис' });

    /* Month navigation */
    function bindNav() {
      var prev = document.getElementById('schedPrev');
      var next = document.getElementById('schedNext');
      if (prev) prev.addEventListener('click', function() {
        viewMonth--;
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        document.getElementById('schedGrid').innerHTML = buildGrid();
        bindNav();
      });
      if (next) next.addEventListener('click', function() {
        viewMonth++;
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        document.getElementById('schedGrid').innerHTML = buildGrid();
        bindNav();
      });
    }
    bindNav();
  });

"""

    js = js[:idx_start] + new_schedule + js[idx_end:]
    print('  Replaced OfficeSchedulePage with calendar grid')
else:
    print('  WARNING: Could not find schedule block markers')


write(RENDERS, js)
print(f'  Written mobile_renders.js ({len(js)} bytes)')


# ═══════════════════════════════════════════════════════════════
# 3. CSS — schedule grid styles
# ═══════════════════════════════════════════════════════════════
print('\n=== mobile_premium.css — schedule grid CSS ===')
backup(CSS)
css = read(CSS)

schedule_css = """

/* ═══════════════════════════════════════════════════════════════
   v8.8.7b — Schedule Calendar Grid (mobile)
   ═══════════════════════════════════════════════════════════════ */

/* Month navigation */
.m-sched-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  margin-bottom: 8px;
}
.m-sched-month {
  font-size: 18px;
  font-weight: 700;
  color: var(--gold, #D4A843);
}
.m-sched-nav-btn {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.1);
  color: var(--t1, #fff);
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.m-sched-nav-btn:active {
  background: rgba(255,255,255,0.15);
}

/* Legend */
.m-sched-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding: 8px 0 12px;
}
.m-sched-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--t2, #aaa);
}
.m-sched-legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

/* Scroll hint */
.m-sched-scroll-hint {
  text-align: center;
  font-size: 11px;
  color: var(--t3, #666);
  padding: 4px 0;
  opacity: 0.7;
}

/* Scrollable table container */
.m-sched-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.02);
  /* Scroll shadow indicator */
  background-image:
    linear-gradient(to right, rgba(13,17,23,1) 0%, transparent 20px),
    linear-gradient(to left, rgba(13,17,23,1) 0%, transparent 20px);
  background-attachment: local, local;
  background-position: left center, right center;
  background-size: 20px 100%, 20px 100%;
  background-repeat: no-repeat;
}

/* Table */
.m-sched-table {
  display: table !important;
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-size: 12px;
}
.m-sched-table thead, .m-sched-table tbody, .m-sched-table tr {
  display: table-row !important;
  width: auto !important;
  table-layout: auto !important;
}
.m-sched-table thead {
  display: table-header-group !important;
}
.m-sched-table tbody {
  display: table-row-group !important;
}

/* Sticky first column (employee name) */
.m-sched-name-col {
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--bg, #0D1117);
  min-width: 130px;
  max-width: 160px;
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-right: 1px solid rgba(255,255,255,0.1);
  color: var(--t1, #fff);
}
thead .m-sched-name-col {
  font-weight: 700;
  color: var(--gold, #D4A843);
  z-index: 3;
  background: var(--bg, #0D1117);
}

/* Day columns */
.m-sched-day-col {
  padding: 6px 0;
  min-width: 32px;
  text-align: center;
  font-size: 11px;
  font-weight: 500;
  color: var(--t2, #aaa);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

/* Data cells */
.m-sched-cell {
  min-width: 32px;
  height: 32px;
  padding: 2px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  border-right: 1px solid rgba(255,255,255,0.03);
}

/* Weekend styling */
.m-sched-wk {
  background: rgba(255,255,255,0.02);
}

/* Today highlight */
.m-sched-today {
  box-shadow: inset 0 0 0 1.5px var(--gold, #D4A843);
}

/* Zebra striping */
.m-sched-table tbody tr:nth-child(even) .m-sched-name-col {
  background: rgba(255,255,255,0.015);
}
.m-sched-table tbody tr:nth-child(even) .m-sched-cell {
  background-color: rgba(255,255,255,0.015);
}

/* Light theme */
[data-theme="light"] .m-sched-name-col {
  background: #fff;
  color: #1a1a2e;
}
[data-theme="light"] thead .m-sched-name-col {
  background: #fff;
  color: var(--gold-d, #8B6914);
}
[data-theme="light"] .m-sched-scroll {
  border-color: #e2e8f0;
  background-image:
    linear-gradient(to right, #fff 0%, transparent 20px),
    linear-gradient(to left, #fff 0%, transparent 20px);
}
[data-theme="light"] .m-sched-cell {
  border-color: #e2e8f0;
}
"""

if 'v8.8.7b' not in css:
    css += schedule_css
    print('  Added v8.8.7b schedule grid CSS')
else:
    print('  SKIP: v8.8.7b already present')

write(CSS, css)


# ═══════════════════════════════════════════════════════════════
# 4. Validation
# ═══════════════════════════════════════════════════════════════
print('\n=== Validation ===')
import subprocess

for f in [RENDERS, ROUTER]:
    r = subprocess.run(['node', '-c', f], capture_output=True, text=True)
    if r.returncode == 0:
        print(f'  ✓ {os.path.basename(f)} — syntax OK')
    else:
        print(f'  ✗ {os.path.basename(f)} — ERROR: {r.stderr[:200]}')

# Verify schedule grid is present
final = read(RENDERS)
if 'm-sched-table' in final:
    print('  ✓ Schedule grid present')
else:
    print('  ✗ Schedule grid NOT found')

if 'history.back()' in read(ROUTER):
    print('  ✓ Router has "Назад" button')
else:
    print('  ✗ Router missing "Назад"')

print('\n=== DONE ===')
print('Run: systemctl restart asgard-crm')
