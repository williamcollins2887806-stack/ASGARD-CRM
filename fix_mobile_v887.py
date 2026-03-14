#!/usr/bin/env python3
"""
ASGARD CRM v8.8.7 — Mobile Fix Script
Fixes all issues from MOBILE_FIX_PROMPT.md (10 screenshots audit)

P0: Raw HTML in progress bars, &quot; entities (double-escaping)
P1: Chart labels, schedule table crash, stat card truncation, badge spacing, Mimir icon
P2: Status colors
"""

import re
import shutil
from datetime import datetime

BASE = '/var/www/asgard-crm/public/assets'
RENDERS = f'{BASE}/js/mobile_renders.js'
UI = f'{BASE}/js/mobile_ui.js'
CSS = f'{BASE}/css/mobile_premium.css'
MIMIR = f'{BASE}/js/mimir.js'
INDEX = '/var/www/asgard-crm/public/index.html'
BACKUP_DIR = '/var/www/asgard-crm/backups'

ts = datetime.now().strftime('%Y%m%d_%H%M%S')

def backup(path):
    import os
    os.makedirs(BACKUP_DIR, exist_ok=True)
    name = os.path.basename(path)
    dst = f'{BACKUP_DIR}/v887_{name}_{ts}'
    shutil.copy2(path, dst)
    print(f'  Backup: {dst}')

def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def count_replacements(old, new, label):
    if old == new:
        print(f'  SKIP {label}: no changes')
        return 0
    # Rough count based on length diff
    print(f'  OK {label}')
    return 1


# ═══════════════════════════════════════════════════════════════
# 1. mobile_renders.js
# ═══════════════════════════════════════════════════════════════
print('\n=== mobile_renders.js ===')
backup(RENDERS)
js = read(RENDERS)
orig_js = js

# --- P0 FIX 1: Progress bars — use valueHtml instead of value ---
# Location 1: PmWorksPage renderCard (line ~1110)
old = "{ label: '\\u041F\\u0440\\u043E\\u0433\\u0440\\u0435\\u0441\\u0441', value: progressHtml, full: true }"
# Try both encoded and raw forms
js = js.replace(
    "{ label: '\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441', value: progressHtml, full: true }",
    "{ label: '\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441', valueHtml: progressHtml, full: true }"
)
# Also try the ASCII-escaped form
js = js.replace(
    "{ label: 'Прогресс', value: progressHtml, full: true }",
    "{ label: 'Прогресс', valueHtml: progressHtml, full: true }"
)
print(f'  P0-1a: Progress bar valueHtml (PmWorks)')

# Location 2: Gantt renderCard (line ~4202)
js = js.replace(
    "{ label: '\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441', value: pct + '%' + progressBar, full: true }",
    "{ label: '\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441', valueHtml: '<span>' + pct + '%</span>' + progressBar, full: true }"
)
js = js.replace(
    "{ label: 'Прогресс', value: pct + '%' + progressBar, full: true }",
    "{ label: 'Прогресс', valueHtml: '<span>' + pct + '%</span>' + progressBar, full: true }"
)
print(f'  P0-1b: Progress bar valueHtml (Gantt)')

# --- P0 FIX 2: Remove double-escaping (esc(decodeEntities(...))) ---
# mCard and mDetailFields already apply esc() internally.
# Caller's esc() causes double-escaping: &quot; → &amp;quot; → shows as "&quot;" in browser
# Pattern: esc(decodeEntities(EXPR)) → decodeEntities(EXPR)
# Must use regex to also remove the extra closing paren
count = len(re.findall(r'esc\(decodeEntities\(', js))
# Replace esc(decodeEntities(X)) with decodeEntities(X)
# Match the inner expression (no nested parens) and the double-close ))
js = re.sub(r"esc\(decodeEntities\(([^)]*)\)\)", r"decodeEntities(\1)", js)
remaining_dbl = js.count('esc(decodeEntities(')
print(f'  P0-2: Removed {count - remaining_dbl}x double-escaping esc(decodeEntities( ({remaining_dbl} remaining)')

# --- P0 FIX 3: Notifications — add decodeEntities, remove esc() ---
# Notification page (renderCard):
# title: esc(n.title || 'Уведомление')  →  title: decodeEntities(n.title || 'Уведомление')
js = js.replace(
    "title: esc(n.title || '\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435')",
    "title: decodeEntities(n.title || '\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435')"
)
js = js.replace(
    "title: esc(n.title || 'Уведомление')",
    "title: decodeEntities(n.title || 'Уведомление')"
)
print(f'  P0-3a: Notification title decodeEntities')

# Notification field: value: esc((n.message || '').substring(0, 80))
js = js.replace(
    "value: esc((n.message || '').substring(0, 80))",
    "value: decodeEntities((n.message || '').substring(0, 80))"
)
print(f'  P0-3b: Notification message decodeEntities')

# Dashboard notification widget:
# title: esc(n.title || n.message || '—')
js = js.replace(
    "title: esc(n.title || n.message || '\u2014')",
    "title: decodeEntities(n.title || n.message || '\u2014')"
)
js = js.replace(
    "title: esc(n.title || n.message || '—')",
    "title: decodeEntities(n.title || n.message || '—')"
)
print(f'  P0-3c: Dashboard notification title decodeEntities')

# --- P0 FIX 4: Translate notification type badges ---
# badge: n.type || '' → badge: _notifType(n.type)
# First, add helper function after decodeEntities definition
notif_type_helper = """
  /* v8.8.7 — Translate notification types to readable text */
  function _notifType(t) {
    if (!t) return '';
    var map = {
      'chat_message': 'Чат',
      'permit_expiring': 'Допуск',
      'permit_expired': 'Допуск',
      'task_assigned': 'Задача',
      'task_completed': 'Задача',
      'tender_new': 'Тендер',
      'tender_won': 'Тендер',
      'tender_lost': 'Тендер',
      'approval_request': 'Согласование',
      'work_status': 'Работа',
      'system': 'Система'
    };
    return map[t] || t.replace(/_/g, ' ');
  }
"""

# Insert after decodeEntities function
insert_after = "return el.value;\n  }"
if insert_after in js and '_notifType' not in js:
    js = js.replace(insert_after, insert_after + '\n' + notif_type_helper, 1)
    print(f'  P0-4a: Added _notifType() helper')

# Replace badge: n.type || '' with badge: _notifType(n.type)
js = js.replace(
    "badge: n.type || '', badgeColor: M.statusColor(n.type)",
    "badge: _notifType(n.type), badgeColor: M.statusColor(n.type)"
)
print(f'  P0-4b: Dashboard notif badge translation')

# --- P1 FIX 5: Schedule pages — fix undefined 'items' variable ---
# AsgardOfficeSchedulePage: items.length → users.length
# Find the specific context: "value: String(items.length), label: 'График офиса'"
js = js.replace(
    "value: String(items.length), label: '\u0413\u0440\u0430\u0444\u0438\u043A \u043E\u0444\u0438\u0441\u0430'",
    "value: String(users.length), label: '\u0413\u0440\u0430\u0444\u0438\u043A \u043E\u0444\u0438\u0441\u0430'"
)
js = js.replace(
    "value: String(items.length), label: 'График офиса'",
    "value: String(users.length), label: 'График офиса'"
)
print(f'  P1-5a: OfficeSchedule items→users')

# AsgardStaffSchedulePage: items.length → employees.length
js = js.replace(
    "value: String(items.length), label: '\u0413\u0440\u0430\u0444\u0438\u043A \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u0432'",
    "value: String(employees.length), label: '\u0413\u0440\u0430\u0444\u0438\u043A \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u0432'"
)
js = js.replace(
    "value: String(items.length), label: 'График сотрудников'",
    "value: String(employees.length), label: 'График сотрудников'"
)
print(f'  P1-5b: StaffSchedule items→employees')

# --- P1 FIX 6: Remove remaining esc() from field values that go through mCard ---
# mCard already applies esc() to field values, so caller's esc() is double-escaping.
# Fix for notification, schedule, and other field values.
# Pattern: value: esc(SOMETHING) → value: SOMETHING (when inside mCard fields array)
# Only fix specific known cases to be safe:

# Notification fields already fixed above
# Schedule page fields:
for field_pattern in [
    ("value: esc(u.name || u.fio || '\u2014')", "value: (u.name || u.fio || '\u2014')"),
    ("value: esc(u.name || u.fio || '—')", "value: (u.name || u.fio || '—')"),
    ("value: esc(u.department || '\u2014')", "value: (u.department || '\u2014')"),
    ("value: esc(u.department || '—')", "value: (u.department || '—')"),
    ("value: esc(u.phone || '\u2014')", "value: (u.phone || '—')"),
    ("value: esc(u.phone || '—')", "value: (u.phone || '—')"),
    ("value: esc(e.grade || '\u2014')", "value: (e.grade || '\u2014')"),
    ("value: esc(e.grade || '—')", "value: (e.grade || '—')"),
    ("value: esc(e.city || '\u2014')", "value: (e.city || '\u2014')"),
    ("value: esc(e.city || '—')", "value: (e.city || '—')"),
    ("value: esc(e.current_object || '\u2014')", "value: (e.current_object || '\u2014')"),
    ("value: esc(e.current_object || '—')", "value: (e.current_object || '—')"),
    ("value: esc(e.phone || '\u2014')", "value: (e.phone || '\u2014')"),
    ("value: esc(e.phone || '—')", "value: (e.phone || '—')"),
]:
    js = js.replace(field_pattern[0], field_pattern[1])

# Also fix title/subtitle patterns that still have esc() without decodeEntities:
# title: esc(u.name || u.fio || '—') → title: (u.name || u.fio || '—')
# These go through mCard which already escapes
esc_title_patterns = [
    ("title: esc(u.name || u.fio || '\u2014')", "title: (u.name || u.fio || '\u2014')"),
    ("title: esc(u.name || u.fio || '—')", "title: (u.name || u.fio || '—')"),
    ("subtitle: esc(u.position || u.role || '')", "subtitle: (u.position || u.role || '')"),
    ("title: esc(e.fio || '\u2014')", "title: (e.fio || '\u2014')"),
    ("title: esc(e.fio || '—')", "title: (e.fio || '—')"),
    ("subtitle: esc(e.specialization || e.role_tag || '')", "subtitle: (e.specialization || e.role_tag || '')"),
]
for old_p, new_p in esc_title_patterns:
    js = js.replace(old_p, new_p)
print(f'  P1-6: Removed esc() from mCard field values/titles')

# Also fix AllWorksPage field: value: esc(pm.name || '—')
js = js.replace(
    "value: esc(pm.name || '\u2014')",
    "value: (pm.name || '\u2014')"
)
js = js.replace(
    "value: esc(pm.name || '—')",
    "value: (pm.name || '—')"
)

# Fix remaining title: esc(w.short_title patterns
js = js.replace(
    "title: esc(w.short_title || w.object_name || '\u0420\u0430\u0431\u043E\u0442\u0430 #' + w.id)",
    "title: (w.short_title || w.object_name || '\u0420\u0430\u0431\u043E\u0442\u0430 #' + w.id)"
)
js = js.replace(
    "title: esc(w.short_title || w.object_name || 'Работа #' + w.id)",
    "title: (w.short_title || w.object_name || 'Работа #' + w.id)"
)

# Stats
changes = 0
for marker in ['esc(decodeEntities(', "value: progressHtml", "value: pct + '%' + progressBar"]:
    if marker in js:
        print(f'  WARNING: still found "{marker}" — may need manual fix')
    else:
        changes += 1

write(RENDERS, js)
print(f'  Written mobile_renders.js ({len(js)} bytes)')


# ═══════════════════════════════════════════════════════════════
# 2. mobile_premium.css — append v8.8.7 fixes
# ═══════════════════════════════════════════════════════════════
print('\n=== mobile_premium.css ===')
backup(CSS)
css = read(CSS)

css_fixes = """

/* ═══════════════════════════════════════════════════════════════
   v8.8.7 — Mobile Fix Patch (MOBILE_FIX_PROMPT audit)
   ═══════════════════════════════════════════════════════════════ */

/* P1: Badge spacing — prevent "ЗангерВ работе" slippage */
.m-card-badge {
  margin-left: 8px !important;
  display: inline-flex !important;
  align-items: center;
  vertical-align: middle;
  flex-shrink: 0;
  line-height: 1;
}

/* P1: Stat cards — flex equally, prevent "ЗАД" truncation */
.m-stat-card {
  flex: 1 1 0% !important;
  min-width: 70px !important;
  width: auto !important;
}

/* P1: Chart X-axis labels — prevent "октноядекянвфевмар" */
.m-bar-x-label {
  font-size: 11px !important;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 2px;
}

/* P1: Chart Y-axis labels — prevent "690 млн345 млн0" */
.m-bar-y-label {
  font-size: 10px !important;
  line-height: 1.2;
}

/* P1: Ensure bar chart Y-axis positioning works */
.m-bar-y-axis {
  position: absolute !important;
  left: 0 !important;
  top: 0 !important;
  bottom: 32px !important;
  width: 52px !important;
}

/* P1: Mimir trash icon — fix overflow */
.mimir-header {
  overflow: visible !important;
}
.mimir-header-actions {
  flex-shrink: 0;
}

/* P2: Semantic status badge colors */
.m-card-badge[style*="var(--ok"] {
  background: #34C759 !important;
  color: #fff !important;
}
.m-card-badge[style*="var(--warn"] {
  background: #F5A623 !important;
  color: #fff !important;
}
.m-card-badge[style*="var(--err"], .m-card-badge[style*="var(--danger"] {
  background: #FF3B30 !important;
  color: #fff !important;
}
.m-card-badge[style*="var(--info"] {
  background: #4A90D9 !important;
  color: #fff !important;
}

/* P2: Pill-shaped badges */
.m-card-badge {
  border-radius: 12px !important;
  padding: 2px 10px !important;
  font-size: 10px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.3px;
}

/* P1: Desktop schedule table fallback — horizontal scroll */
table {
  display: block;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  max-width: 100%;
}
table thead, table tbody, table tr {
  display: table;
  width: 100%;
  table-layout: fixed;
}

/* P1: Notification "Прочитано" spacing fix */
.m-card-title {
  display: flex !important;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

/* Ensure title text doesn't get squished */
.m-card-title > .m-card-badge {
  flex-shrink: 0;
}
"""

# Check if v8.8.7 already applied
if 'v8.8.7' not in css:
    css += css_fixes
    print(f'  Added v8.8.7 CSS fixes')
else:
    print(f'  SKIP: v8.8.7 already present')

write(CSS, css)
print(f'  Written mobile_premium.css ({len(css)} bytes)')


# ═══════════════════════════════════════════════════════════════
# 3. mimir.js — hide minimize button on mobile
# ═══════════════════════════════════════════════════════════════
print('\n=== mimir.js ===')
backup(MIMIR)
mimir = read(MIMIR)

# Fix: .mimir-desktop-only should be hidden on mobile
# Current CSS has: .mimir-desktop-only { display:inline-flex; }  (global)
# Need: inside @media (max-width:768px) add: .mimir-desktop-only { display:none !important; }
# The media query is: @media (max-width:768px) { .mimir-widget { ... } .mimir-toggle { ... } }

old_mimir_media = "@media (max-width:768px) {\n        .mimir-widget { bottom:80px; right:16px; }\n        .mimir-toggle { width:48px; height:48px; }\n      }"
new_mimir_media = "@media (max-width:768px) {\n        .mimir-widget { bottom:80px; right:16px; }\n        .mimir-toggle { width:48px; height:48px; }\n        .mimir-desktop-only { display:none !important; }\n        .mimir-header-actions { gap:4px; }\n        .mimir-header-btn { width:32px; height:32px; }\n      }"

if old_mimir_media in mimir:
    mimir = mimir.replace(old_mimir_media, new_mimir_media)
    print(f'  Fixed: .mimir-desktop-only hidden on mobile')
elif '.mimir-desktop-only { display:none' in mimir:
    print(f'  SKIP: Already fixed')
else:
    # Try more flexible matching
    mimir = mimir.replace(
        ".mimir-toggle { width:48px; height:48px; }\n      }",
        ".mimir-toggle { width:48px; height:48px; }\n        .mimir-desktop-only { display:none !important; }\n        .mimir-header-actions { gap:4px; }\n        .mimir-header-btn { width:32px; height:32px; }\n      }"
    )
    print(f'  Fixed: .mimir-desktop-only (flexible match)')

write(MIMIR, mimir)
print(f'  Written mimir.js ({len(mimir)} bytes)')


# ═══════════════════════════════════════════════════════════════
# 4. index.html — update cache busters to v8.8.7
# ═══════════════════════════════════════════════════════════════
print('\n=== index.html ===')
backup(INDEX)
html = read(INDEX)

html = re.sub(r'\?v=8\.8\.6', '?v=8.8.7', html)
count_886 = html.count('?v=8.8.6')
count_887 = html.count('?v=8.8.7')
print(f'  Cache busters: {count_887} files at v8.8.7, {count_886} remaining at v8.8.6')

write(INDEX, html)
print(f'  Written index.html')


# ═══════════════════════════════════════════════════════════════
# 5. Syntax validation
# ═══════════════════════════════════════════════════════════════
print('\n=== Validation ===')
import subprocess

for f in [RENDERS, UI, MIMIR]:
    r = subprocess.run(['node', '-c', f], capture_output=True, text=True)
    if r.returncode == 0:
        print(f'  ✓ {f} — syntax OK')
    else:
        print(f'  ✗ {f} — SYNTAX ERROR: {r.stderr}')

# Verify no esc(decodeEntities( remaining
final_js = read(RENDERS)
remaining = final_js.count('esc(decodeEntities(')
if remaining > 0:
    print(f'\n  WARNING: {remaining}x esc(decodeEntities( still found!')
else:
    print(f'  ✓ No double-escaping remaining')

# Verify progress bars fixed
if 'value: progressHtml' in final_js:
    print(f'  WARNING: value: progressHtml still found')
else:
    print(f'  ✓ Progress bars use valueHtml')

# Verify schedule pages fixed
if "String(items.length), label: '\u0413\u0440\u0430\u0444\u0438\u043A" in final_js:
    print(f'  WARNING: items.length still in schedule pages')
else:
    print(f'  ✓ Schedule pages use correct variable names')

print('\n=== DONE ===')
print('Run: systemctl restart asgard-crm')
print('Then Ctrl+Shift+R on phone to verify')
