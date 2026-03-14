#!/usr/bin/env python3
"""
v8.8.6 Premium Polish — Sber/Yandex/Telegram level
Fixes ~30 visual issues found in 44-screenshot audit.
"""
import subprocess, os, sys, re, shutil
from datetime import datetime

ROOT = '/var/www/asgard-crm'
CSS  = f'{ROOT}/public/assets/css/mobile_premium.css'
UI   = f'{ROOT}/public/assets/js/mobile_ui.js'
REND = f'{ROOT}/public/assets/js/mobile_renders.js'
APP  = f'{ROOT}/public/assets/js/app.js'
HTML = f'{ROOT}/public/index.html'

BACKUP_DIR = f'{ROOT}/backups/v886_{datetime.now().strftime("%Y%m%d_%H%M%S")}'

def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  WARN: {cmd}\n  stderr: {r.stderr.strip()}")
    return r.stdout.strip()

def backup(path):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    dst = os.path.join(BACKUP_DIR, os.path.basename(path))
    shutil.copy2(path, dst)
    print(f"  Backup: {dst}")

def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def check_js(path):
    r = subprocess.run(f'node -c "{path}"', shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  SYNTAX ERROR in {path}: {r.stderr.strip()}")
        return False
    print(f"  Syntax OK: {os.path.basename(path)}")
    return True

# ============================================================
# 1. DATABASE: Fix user name "Modified" → real name
# ============================================================
def fix_database():
    print("\n[1] DATABASE: Fix user name")
    cmd = '''PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "UPDATE users SET name = 'Андросов Никита Андреевич' WHERE id = 1 AND (name = 'Modified' OR name IS NULL OR name = '');"'''
    out = run(cmd)
    print(f"  Result: {out}")

# ============================================================
# 2. CSS: Premium polish block
# ============================================================
def fix_css():
    print("\n[2] CSS: Premium polish v8.8.6")
    backup(CSS)
    content = read(CSS)

    block = '''
/* ===================================================================
   v8.8.6 — Premium Polish (Sber/Yandex/Telegram level)
   =================================================================== */

/* 2.1-2.2 Stat cards — clean Sber style, no red/gold borders */
.m-stat-card {
  background: rgba(255,255,255,.04) !important;
  border: 1px solid rgba(255,255,255,.06) !important;
  border-radius: 16px !important;
  box-shadow: 0 2px 8px rgba(0,0,0,.15);
  cursor: pointer;
}
.m-stat-card::before { display: none !important; }
.m-stat-card::after { display: none !important; }
.m-stat-card:active {
  transform: scale(0.96);
  background: rgba(255,255,255,.06) !important;
}
.m-stat-card .m-stat-value {
  font-weight: 700;
  letter-spacing: -0.02em;
}

/* 2.3 Tab bar — level 5 */
.m-tabbar,
.m-bottom-nav {
  background: rgba(13,17,23,.95) !important;
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-top: 0.5px solid rgba(255,255,255,.08) !important;
  box-shadow: none !important;
  padding: 6px 0 env(safe-area-inset-bottom, 8px) !important;
}
.m-tab,
.m-bottom-nav a {
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 4px 0;
  position: relative;
}
.m-tab svg,
.m-bottom-nav a svg {
  width: 22px;
  height: 22px;
  stroke-width: 1.6;
  opacity: 0.5;
  transition: all 0.25s ease;
}
.m-tab.active svg,
.m-bottom-nav a.active svg {
  opacity: 1;
  stroke-width: 2;
}
.m-tab span:last-child,
.m-tab-label,
.m-bottom-nav a span {
  font-size: 10px !important;
  font-weight: 500;
  opacity: 0.5;
  transition: opacity 0.25s ease;
}
.m-tab.active span:last-child,
.m-tab.active .m-tab-label,
.m-bottom-nav a.active span {
  opacity: 1;
  font-weight: 600;
  color: var(--gold) !important;
}
/* Active tab dot indicator */
.m-tab.active::before,
.m-bottom-nav a.active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 2px;
  border-radius: 1px;
  background: var(--gold);
  opacity: 0.8;
}
/* Mimir tab ring — thinner/elegant */
.m-tab-mimir {
  box-shadow: 0 0 0 1.5px rgba(212,168,67,.3) !important;
  border-radius: 50%;
}

/* 2.4 Text overflow fixes */
.m-section-title {
  word-break: break-word;
  hyphens: auto;
  -webkit-hyphens: auto;
}
.m-stat-label {
  word-break: break-word;
  white-space: normal !important;
  line-height: 1.3;
}
.m-quick-action-label {
  font-size: 10px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 56px;
  text-align: center;
  line-height: 1.2;
}
.m-big-number-int {
  font-size: min(32px, 8vw) !important;
  word-break: break-all;
}

/* 2.5 Charts — more contrast */
.m-chart-bar {
  background: rgba(212,168,67,.35) !important;
  min-width: 12px;
  border-radius: 4px 4px 0 0;
}
.m-chart-bar.active,
.m-chart-bar:last-child {
  background: var(--gold) !important;
}
.m-chart-label {
  color: var(--t2) !important;
  font-size: 11px !important;
}
.m-chart-axis {
  color: rgba(255,255,255,.3) !important;
}

/* 2.6 Add buttons — subtle gold theme */
.m-full-width-btn,
.m-add-btn {
  background: linear-gradient(135deg, rgba(212,168,67,.15), rgba(212,168,67,.05)) !important;
  border: 1px solid rgba(212,168,67,.25) !important;
  color: var(--gold) !important;
  border-radius: 12px !important;
}
.m-full-width-btn:active,
.m-add-btn:active {
  background: linear-gradient(135deg, rgba(212,168,67,.25), rgba(212,168,67,.1)) !important;
}

/* 2.7 Empty states — improved */
.m-empty {
  padding: 48px 20px !important;
  text-align: center;
}
.m-empty-icon {
  font-size: 48px;
  opacity: 0.3;
  margin-bottom: 16px;
}
.m-empty-text {
  font-size: 15px !important;
  color: var(--t2) !important;
  line-height: 1.5;
}

/* 2.8 Cards — no hard borders (Telegram style) */
.m-card {
  background: rgba(255,255,255,.03) !important;
  border: 1px solid rgba(255,255,255,.05) !important;
  border-radius: 14px !important;
}
.m-card:active {
  background: rgba(255,255,255,.05) !important;
}

/* Clickable stat cards cursor */
.m-stat-card[data-href] {
  cursor: pointer;
}
.m-stat-card[data-href]:hover {
  background: rgba(255,255,255,.06) !important;
}

/* Quick action clickable */
.m-quick-action[data-href] {
  cursor: pointer;
}
'''
    content += block
    write(CSS, content)
    print("  CSS block appended")

# ============================================================
# 3. JS mobile_ui.js: mQuickActions + mStats with data-href
# ============================================================
def fix_mobile_ui():
    print("\n[3] JS: mobile_ui.js — mQuickActions + mStats data-href")
    backup(UI)
    content = read(UI)

    # 3.1 mQuickActions — support href via data-href
    old_qa = '''html += '<div class="m-quick-action" ' + (item.onClick ? 'onclick="' + item.onClick + '"' : '') + '>';'''
    new_qa = '''html += '<div class="m-quick-action"' + (item.href ? ' data-href="' + esc(item.href) + '"' : (item.onClick ? ' onclick="' + item.onClick + '"' : '')) + '>';'''

    if old_qa in content:
        content = content.replace(old_qa, new_qa)
        print("  mQuickActions: replaced onclick with data-href support")
    else:
        print("  WARN: mQuickActions onclick pattern not found")

    # 3.2 mStats — add data-href support
    old_stat = '''html += '<div class="m-stat-card"' + colorStyle + '>';'''
    new_stat = '''html += '<div class="m-stat-card"' + colorStyle + (s.href ? ' data-href="' + esc(s.href) + '"' : '') + '>';'''

    if old_stat in content:
        content = content.replace(old_stat, new_stat)
        print("  mStats: added data-href support")
    else:
        print("  WARN: mStats stat-card pattern not found")

    # 3.3 Add delegated click handler for data-href (at end of IIFE, before closing)
    # Find the pattern where exports are assigned: W.mQuickActions = mQuickActions;
    handler_code = '''
  // v8.8.6 — Delegated click handler for data-href navigation
  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-href]');
    if (el && (el.classList.contains('m-quick-action') || el.classList.contains('m-stat-card'))) {
      e.preventDefault();
      e.stopPropagation();
      location.hash = el.getAttribute('data-href');
    }
  });
'''
    marker = 'W.mQuickActions = mQuickActions;'
    if marker in content:
        content = content.replace(marker, marker + handler_code)
        print("  Added delegated click handler for data-href")
    else:
        print("  WARN: W.mQuickActions marker not found")

    write(UI, content)

# ============================================================
# 4. JS mobile_renders.js: fixes
# ============================================================
def fix_mobile_renders():
    print("\n[4] JS: mobile_renders.js — data fixes")
    backup(REND)
    content = read(REND)

    # 4.1 Dashboard quick actions — use href instead of onClick
    replacements = [
        (
            '''{ label: 'Задачи', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>', onClick: "location.hash=\\'#/tasks\\'" }''',
            '''{ label: 'Задачи', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>', href: '#/tasks' }'''
        ),
        (
            '''{ label: 'Тендеры', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/></svg>', onClick: "location.hash=\\'#/tenders\\'" }''',
            '''{ label: 'Тендеры', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/></svg>', href: '#/tenders' }'''
        ),
        (
            '''{ label: 'Работы', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>', onClick: "location.hash=\\'#/pm-works\\'" }''',
            '''{ label: 'Работы', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>', href: '#/pm-works' }'''
        ),
        (
            '''{ label: 'Счета', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>', onClick: "location.hash=\\'#/invoices\\'" }''',
            '''{ label: 'Счета', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>', href: '#/invoices' }'''
        ),
        (
            '''{ label: 'Почта', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>', onClick: "location.hash=\\'#/my-mail\\'" }''',
            '''{ label: 'Почта', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>', href: '#/my-mail' }'''
        ),
        (
            '''{ label: 'Персонал', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', onClick: "location.hash=\\'#/personnel\\'" }''',
            '''{ label: 'Персонал', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', href: '#/personnel' }'''
        ),
    ]

    for old, new in replacements:
        if old in content:
            content = content.replace(old, new)
            label = new.split("label: '")[1].split("'")[0]
            print(f"  Quick action '{label}': onClick → href")
        else:
            print(f"  WARN: Quick action pattern not found (may have different escaping)")

    # 4.2 Dashboard stats — add href
    # Тендеры stat card
    old_tenders_stat = "{ label: 'Тендеры', value: activeTenders, icon: '<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\"/><rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\"/></svg>', color: 'var(--gold)' }"
    new_tenders_stat = "{ label: 'Тендеры', value: activeTenders, icon: '<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\"/><rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\"/></svg>', color: 'var(--gold)', href: '#/tenders' }"

    if old_tenders_stat in content:
        content = content.replace(old_tenders_stat, new_tenders_stat)
        print("  Stat 'Тендеры': added href")
    else:
        print("  WARN: Тендеры stat pattern not found — trying regex")
        content = re.sub(
            r"(\{\s*label:\s*'Тендеры',\s*value:\s*activeTenders,[^}]+color:\s*'var\(--gold\)'\s*)\}",
            r"\1, href: '#/tenders' }",
            content
        )

    # Работы stat card
    old_works_stat = "{ label: 'Работы', value: activeWorks, icon: '<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z\"/></svg>', color: 'var(--info)' }"
    new_works_stat = "{ label: 'Работы', value: activeWorks, icon: '<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z\"/></svg>', color: 'var(--info)', href: '#/pm-works' }"

    if old_works_stat in content:
        content = content.replace(old_works_stat, new_works_stat)
        print("  Stat 'Работы': added href")
    else:
        print("  WARN: Работы stat pattern not found — trying regex")
        content = re.sub(
            r"(\{\s*label:\s*'Работы',\s*value:\s*activeWorks,[^}]+color:\s*'var\(--info\)'\s*)\}",
            r"\1, href: '#/pm-works' }",
            content
        )

    # Задачи stat card
    content = re.sub(
        r"(\{\s*label:\s*'Задачи',\s*value:\s*tasks\.length,[^}]+color:\s*'var\(--ok-t\)'\s*)\}",
        r"\1, href: '#/tasks' }",
        content
    )
    print("  Stat 'Задачи': added href (regex)")

    # 4.3 decodeEntities coverage — wrap work_title/subtitle where missing
    # Line 1102: subtitle: esc(w.work_title || w.tender_title || ''),
    old_sub1 = "subtitle: esc(w.work_title || w.tender_title || ''),"
    new_sub1 = "subtitle: esc(decodeEntities(w.work_title || w.tender_title || '')),"
    if old_sub1 in content:
        content = content.replace(old_sub1, new_sub1)
        print("  decodeEntities: wrapped work_title/tender_title subtitle")

    # Line 1183: subtitle: esc(w.work_title || ''),
    old_sub2 = "subtitle: esc(w.work_title || ''),"
    new_sub2 = "subtitle: esc(decodeEntities(w.work_title || '')),"
    content = content.replace(old_sub2, new_sub2)
    print("  decodeEntities: wrapped work_title subtitles")

    # 4.4 PM Analytics "Неизвестен" — fix pmId type conversion
    old_pm = "var pm = byId[pmId] || {};\n        var s = pmStats[pmId];\n        return { pmId: pmId, name: pm.name || 'Неизвестен'"
    new_pm = "var pm = byId[pmId] || byId[Number(pmId)] || {};\n        var s = pmStats[pmId];\n        return { pmId: pmId, name: pm.name || 'Неизвестен'"
    if old_pm in content:
        content = content.replace(old_pm, new_pm)
        print("  PM Analytics: added Number(pmId) fallback for byId lookup")
    else:
        # Try alternate pattern
        content = re.sub(
            r'(var pm = byId\[pmId\]) \|\| \{\};',
            r'\1 || byId[Number(pmId)] || {};',
            content
        )
        print("  PM Analytics: added Number(pmId) fallback (regex)")

    write(REND, content)

# ============================================================
# 5. Cache busters in index.html
# ============================================================
def fix_cache_busters():
    print("\n[5] Cache busters → v=8.8.6")
    backup(HTML)
    content = read(HTML)

    # Replace specific version patterns
    content = content.replace('?v=8.8.5b', '?v=8.8.6')
    content = content.replace('?v=8.8.5', '?v=8.8.6')
    content = content.replace('?v=8.8.4', '?v=8.8.6')
    content = content.replace('?v=8.8.1', '?v=8.8.6')

    write(HTML, content)
    print("  All version tags updated to 8.8.6")

# ============================================================
# MAIN
# ============================================================
def main():
    print("=" * 60)
    print("  v8.8.6 Premium Polish — Applying fixes")
    print("=" * 60)
    print(f"  Backup dir: {BACKUP_DIR}")

    # Check files exist
    for f in [CSS, UI, REND, APP, HTML]:
        if not os.path.exists(f):
            print(f"  ERROR: {f} not found!")
            sys.exit(1)

    fix_database()
    fix_css()
    fix_mobile_ui()
    fix_mobile_renders()
    fix_cache_busters()

    # Syntax check
    print("\n[6] Syntax check")
    ok = True
    for f in [UI, REND, APP]:
        if not check_js(f):
            ok = False

    if not ok:
        print("\n  !!! SYNTAX ERRORS DETECTED — check above !!!")
        print("  Backups in:", BACKUP_DIR)
        sys.exit(1)

    print("\n" + "=" * 60)
    print("  v8.8.6 applied successfully!")
    print("  Restart: systemctl restart asgard-crm")
    print("  Clear cache: Ctrl+Shift+R on mobile")
    print("=" * 60)

if __name__ == '__main__':
    main()
