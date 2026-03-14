#!/usr/bin/env python3
"""
ASGARD CRM v8.8.7c — Fix "Ещё" back navigation
1. PTR: use replaceState instead of clearing hash (avoids history pollution)
2. Header: add "←" back button on sub-pages (non-tab routes)
3. Tab bar: re-tapping "Ещё" when on sub-page does history.back() instead of new push
"""

import re, shutil, os, subprocess
from datetime import datetime

BASE = '/var/www/asgard-crm/public/assets'
APP = f'{BASE}/js/app.js'
MOBILE = f'{BASE}/js/mobile.js'
CSS = f'{BASE}/css/mobile_premium.css'
INDEX = '/var/www/asgard-crm/public/index.html'
BACKUP_DIR = '/var/www/asgard-crm/backups'

ts = datetime.now().strftime('%Y%m%d_%H%M%S')

def backup(path):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    dst = f'{BACKUP_DIR}/v887c_{os.path.basename(path)}_{ts}'
    shutil.copy2(path, dst)
    print(f'  Backup: {dst}')

def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)


# ═══════════════════════════════════════════════════════════════
# 1. mobile.js — Fix Pull-to-Refresh history pollution
# ═══════════════════════════════════════════════════════════════
print('\n=== mobile.js — Fix PTR ===')
backup(MOBILE)
mobile = read(MOBILE)

# The old PTR does: location.hash = '' → setTimeout → location.hash = hash
# This adds 2 extra entries to history. Replace with replaceState approach.
old_ptr = """var hash = window.location.hash;
        // Принудительно перезагружаем маршрут
        window.location.hash = '';
        setTimeout(function () {
            window.location.hash = hash;"""

new_ptr = """var hash = window.location.hash;
        // Принудительно перезагружаем маршрут (replaceState чтобы не загрязнять history)
        var tempHash = '#/__ptr_reload__';
        history.replaceState(null, '', tempHash);
        setTimeout(function () {
            history.replaceState(null, '', hash);
            window.dispatchEvent(new HashChangeEvent('hashchange'));"""

if old_ptr in mobile:
    mobile = mobile.replace(old_ptr, new_ptr)
    print('  Fixed PTR: using replaceState instead of clearing hash')
else:
    print('  SKIP: PTR pattern not found')
    # Try alternate pattern
    alt_old = "window.location.hash = '';\n          setTimeout(function () {\n            window.location.hash = hash;"
    if alt_old in mobile:
        alt_new = "history.replaceState(null, '', '#/__ptr_reload__');\n          setTimeout(function () {\n            history.replaceState(null, '', hash);\n            window.dispatchEvent(new HashChangeEvent('hashchange'));"
        mobile = mobile.replace(alt_old, alt_new)
        print('  Fixed PTR (alt pattern): using replaceState')
    else:
        print('  WARNING: Could not find PTR pattern at all')

write(MOBILE, mobile)


# ═══════════════════════════════════════════════════════════════
# 2. app.js — Add back button in header + smart tab re-tap
# ═══════════════════════════════════════════════════════════════
print('\n=== app.js — Header back button + smart tab ===')
backup(APP)
app = read(APP)

# 2a. Replace the logo in header with a conditional back/logo button
# The current header is:
#   <a class="m-brand" href="#/home">
#     <img src="${logo}" alt="АСГАРД"/>
#   </a>
#   <h1 class="m-title">${esc(title||"")}</h1>

# Main tab routes (when on these, show logo; otherwise show back button)
TAB_ROUTES = "'/home','/dashboard','/my-dashboard','/tasks','/kanban','/reminders','/approvals','/my-mail','/chat','/pm-works','/all-works','/more','/welcome','/login'"

old_header = """<header class="m-header">
          <a class="m-brand" href="#/home">
            <img src="${logo}" alt="АСГАРД"/>
          </a>
          <h1 class="m-title">${esc(title||"")}</h1>"""

new_header = """<header class="m-header">
          ${([""" + TAB_ROUTES + """].includes(cur))
            ? '<a class="m-brand" href="#/home"><img src="' + logo + '" alt="АСГАРД"/></a>'
            : '<button class="m-back-btn" id="btnMobileBack" aria-label="Назад"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>'}
          <h1 class="m-title">${esc(title||"")}</h1>"""

if old_header in app:
    app = app.replace(old_header, new_header)
    print('  Added conditional back button in header')
else:
    print('  WARNING: Could not find header pattern')

# 2b. Add click handler for the back button (after layout renders)
# Find the existing event binding section (after btnMobileNotif, btnMobileMimir)
old_mimir_handler = """const btnMobileMimir = document.getElementById('btnMobileMimir');
      if (btnMobileMimir) btnMobileMimir.addEventListener('click', () => { if(window.AsgardMimir) { AsgardMimir.init(); AsgardMimir.open(); } else location.hash = '#/chat'; });"""

new_mimir_handler = old_mimir_handler + """
      const btnMobileBack = document.getElementById('btnMobileBack');
      if (btnMobileBack) btnMobileBack.addEventListener('click', () => { history.back(); });"""

if old_mimir_handler in app:
    app = app.replace(old_mimir_handler, new_mimir_handler)
    print('  Added back button click handler')
else:
    print('  WARNING: Could not find Mimir handler pattern for back button insertion')

# 2c. Smart tab re-tap: when "Ещё" is active and user taps it again, go back
# Current tab links are: <a class="m-tab ..." href="${t.route}" data-tab="${t.id}">
# We need to intercept tab clicks where the target tab is already active
# Add event delegation on the tab bar

old_tab_hash = """window.__ASG_MOBILE_HASH__ = () => {
        const newCur = AsgardRouter.current();
        const newGroup = getMobileTabGroup(newCur);
        // Haptic feedback on navigation
        if (navigator.vibrate) navigator.vibrate(10);
        document.querySelectorAll('.m-tab').forEach(tab => {
          tab.classList.toggle('active', tab.dataset.tab === newGroup);
        });
        // Update chat unread badge
        updateChatTabBadge();
      };
      window.addEventListener('hashchange', window.__ASG_MOBILE_HASH__);"""

new_tab_hash = """window.__ASG_MOBILE_HASH__ = () => {
        const newCur = AsgardRouter.current();
        const newGroup = getMobileTabGroup(newCur);
        // Haptic feedback on navigation
        if (navigator.vibrate) navigator.vibrate(10);
        document.querySelectorAll('.m-tab').forEach(tab => {
          tab.classList.toggle('active', tab.dataset.tab === newGroup);
        });
        // Update chat unread badge
        updateChatTabBadge();
      };
      window.addEventListener('hashchange', window.__ASG_MOBILE_HASH__);

      // v8.8.7c — Smart tab re-tap: if tapping the already-active tab group,
      // navigate to that tab's root route instead of pushing duplicate history
      const tabbar = document.getElementById('mTabbar');
      if (tabbar && !tabbar.dataset.smartTap) {
        tabbar.dataset.smartTap = '1';
        tabbar.addEventListener('click', (e) => {
          const tab = e.target.closest('.m-tab');
          if (!tab) return;
          const tabId = tab.dataset.tab;
          const curRoute = AsgardRouter.current();
          const curGroup = getMobileTabGroup(curRoute);
          if (tabId === curGroup && curRoute !== tab.getAttribute('href').replace('#','')) {
            // User is on a sub-page of this tab group, tapping the tab goes to tab root
            e.preventDefault();
            location.hash = tab.getAttribute('href');
          }
        });
      }"""

if old_tab_hash in app:
    app = app.replace(old_tab_hash, new_tab_hash)
    print('  Added smart tab re-tap handler')
else:
    print('  WARNING: Could not find tab hash handler pattern')

write(APP, app)


# ═══════════════════════════════════════════════════════════════
# 3. CSS — Back button styles
# ═══════════════════════════════════════════════════════════════
print('\n=== mobile_premium.css — Back button styles ===')
backup(CSS)
css = read(CSS)

back_btn_css = """

/* ═══════════════════════════════════════════════════════════════
   v8.8.7c — Mobile back button in header
   ═══════════════════════════════════════════════════════════════ */

.m-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: rgba(255,255,255,0.06);
  border-radius: 10px;
  color: var(--t1, #fff);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: all 0.2s ease;
  flex-shrink: 0;
  padding: 0;
}
.m-back-btn:active {
  background: rgba(212,168,67,0.15);
  transform: scale(0.92);
}
.m-back-btn svg {
  width: 22px;
  height: 22px;
}

[data-theme="light"] .m-back-btn {
  background: rgba(0,0,0,0.05);
  color: #1a1a2e;
}
[data-theme="light"] .m-back-btn:active {
  background: rgba(0,0,0,0.1);
}
"""

if 'v8.8.7c' not in css:
    css += back_btn_css
    print('  Added back button CSS')
else:
    print('  SKIP: v8.8.7c already present')

write(CSS, css)


# ═══════════════════════════════════════════════════════════════
# 4. Cache busters
# ═══════════════════════════════════════════════════════════════
print('\n=== Cache busters ===')
idx = read(INDEX)
idx = idx.replace('v=8.8.7b', 'v=8.8.7c')
write(INDEX, idx)
count = idx.count('v=8.8.7c')
print(f'  Updated {count} cache busters to v=8.8.7c')


# ═══════════════════════════════════════════════════════════════
# 5. Validation
# ═══════════════════════════════════════════════════════════════
print('\n=== Validation ===')

for f in [APP, MOBILE]:
    r = subprocess.run(['node', '-c', f], capture_output=True, text=True)
    if r.returncode == 0:
        print(f'  ✓ {os.path.basename(f)} — syntax OK')
    else:
        print(f'  ✗ {os.path.basename(f)} — SYNTAX ERROR: {r.stderr[:300]}')

# Verify changes
final_app = read(APP)
final_mobile = read(MOBILE)

if 'btnMobileBack' in final_app:
    print('  ✓ Back button in header')
else:
    print('  ✗ Back button NOT found')

if 'smartTap' in final_app:
    print('  ✓ Smart tab re-tap')
else:
    print('  ✗ Smart tab re-tap NOT found')

if 'replaceState' in final_mobile:
    print('  ✓ PTR uses replaceState')
else:
    print('  ✗ PTR still uses location.hash')

print('\n=== DONE ===')
print('Run: systemctl restart asgard-crm')
