#!/usr/bin/env python3
"""
v8.8.5 — PREMIUM POLISH + Loading fix + SEO meta tags
Based on detailed 44-screenshot pixel audit.

Fixes:
1.  CSS: Stat card number overflow — auto-shrink for long numbers
2.  CSS: Section title word-break — no mid-word breaks
3.  CSS: Category/finance text wrapping
4.  CSS: Quick action label overflow
5.  CSS: Filter pill truncation
6.  CSS: Card spacing, shadows, stat borders
7.  CSS: m-content bottom padding
8.  JS:  mStats auto-sizing (xs class)
9.  JS:  moneyCompact() for billion-scale numbers
10. HTML: Inline loading screen (no more blue screen)
11. HTML: Open Graph + SEO meta tags for Yandex
12. JS:  Loading delay 2.5s → 0.8s
"""
import subprocess, re

CSS = '/var/www/asgard-crm/public/assets/css/mobile_premium.css'
UI = '/var/www/asgard-crm/public/assets/js/mobile_ui.js'
RENDERS = '/var/www/asgard-crm/public/assets/js/mobile_renders.js'
APP = '/var/www/asgard-crm/public/assets/js/app.js'
INDEX = '/var/www/asgard-crm/public/index.html'

fixes = []

print("=" * 60)
print("v8.8.5 PREMIUM POLISH + LOADING + SEO")
print("=" * 60)

# ═══════════════════════════════════════════════════════════
# 1. CSS: Premium polish
# ═══════════════════════════════════════════════════════════
print("\n--- 1. CSS Premium Polish ---")
with open(CSS, 'r') as f:
    css = f.read()

# Remove old fix blocks
for marker in ['/* === v8.8.3 fixes === */', '/* === v8.8.4 comprehensive fixes === */']:
    idx = css.find(marker)
    if idx >= 0:
        css = css[:idx].rstrip()
        print(f"  [OK] Removed old block: {marker[:35]}")

NEW_CSS = """

/* ═══════════════════════════════════════════════════════════════════
   v8.8.5 PREMIUM POLISH — Sber/Yandex/Telegram quality level
   ═══════════════════════════════════════════════════════════════════ */

/* --- APP BAR: title truncation --- */
.m-app-bar .m-title,
.m-app-bar-title {
  font-size: min(15px, 3.8vw) !important;
  max-width: calc(100vw - 110px) !important;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.02em;
}

/* --- STAT CARDS --- */
.m-stat-card {
  border-top: 2px solid var(--stat-accent, rgba(212,165,116,0.5)) !important;
  border-left: none !important;
  border-right: none !important;
  border-bottom: none !important;
  border-radius: 12px !important;
  padding: 12px 8px 10px !important;
  min-width: 0 !important;
  overflow: hidden;
}
.m-stat-value {
  font-size: min(28px, 6.5vw) !important;
  line-height: 1.1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.m-stat-value-md { font-size: min(18px, 4.2vw) !important; }
.m-stat-value-sm { font-size: min(14px, 3.4vw) !important; letter-spacing: -0.03em; }
.m-stat-value-xs { font-size: min(11px, 2.8vw) !important; letter-spacing: -0.04em; }
.m-stat-label {
  font-size: 10px !important;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255,255,255,0.55);
  margin-top: 4px;
}
.m-stat-label-sm { font-size: 8px !important; }
.m-stat-icon { margin-bottom: 6px; }
.m-stat-icon svg { width: 18px !important; height: 18px !important; }

/* --- BIG NUMBER --- */
.m-big-number-value {
  font-size: min(36px, 8vw) !important;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

/* --- SECTION HEADERS: no mid-word breaks --- */
.m-section-header h3,
.m-section-header .m-section-title,
.m-section-pro .m-section-header {
  word-break: normal !important;
  overflow-wrap: break-word;
  hyphens: none !important;
  -webkit-hyphens: none !important;
  line-height: 1.3;
}

/* --- CATEGORY / FINANCE ITEMS --- */
.m-category-name,
.m-section-pro-title,
.m-section-pro-subtitle {
  overflow-wrap: break-word;
  word-break: normal;
  hyphens: auto;
  -webkit-hyphens: auto;
  line-height: 1.3;
}
.m-category-right-value,
.m-category-amount {
  font-size: min(14px, 3.5vw);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
  max-width: 55%;
  font-variant-numeric: tabular-nums;
}
.m-section-pro .m-category-name {
  max-width: 45%;
  min-width: 0;
}

/* --- WIDGET VALUE --- */
.m-widget-value {
  font-size: min(20px, 4.5vw) !important;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}

/* --- QUICK ACTION LABELS --- */
.m-quick-action-label {
  font-size: 10px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 56px;
  text-align: center;
  line-height: 1.2;
}

/* --- FILTER PILLS: horizontal scroll --- */
.m-filter-bar {
  display: flex;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  gap: 8px;
  padding: 0 16px;
  scrollbar-width: none;
}
.m-filter-bar::-webkit-scrollbar { display: none; }
.m-filter-pill {
  font-size: 13px !important;
  white-space: nowrap;
  padding: 7px 14px !important;
  flex-shrink: 0;
  border-radius: 20px;
}

/* --- CARDS --- */
.m-card { margin-bottom: 12px; }
.m-card-fields { gap: 8px 14px; }
.m-card-field-label {
  font-size: 10px;
  min-width: 50px;
  color: rgba(255,255,255,0.45);
  letter-spacing: 0.05em;
}
.m-card-field-value {
  font-size: 13px;
  overflow-wrap: break-word;
  word-break: normal;
  line-height: 1.35;
}
.m-card-title {
  overflow-wrap: break-word;
  word-break: normal;
  hyphens: none;
}

/* --- CHART Y-axis --- */
.m-chart-y-label {
  font-size: 10px !important;
  min-width: 48px;
  text-align: right;
  padding-right: 4px;
  white-space: nowrap;
}
.m-bar-chart { padding-left: 52px !important; }

/* --- TAB BAR --- */
.m-bottom-nav {
  padding-bottom: env(safe-area-inset-bottom, 0px) !important;
  box-shadow: 0 -1px 0 rgba(255,255,255,0.06);
}

/* --- PAGE CONTENT padding --- */
.m-content {
  padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)) !important;
  min-height: calc(100vh - 56px);
}
.m-page { padding-bottom: 24px; }

/* --- SEARCH INPUT --- */
.m-search-input,
input[placeholder*="Поиск"],
input[placeholder*="поиск"] {
  border-radius: 12px !important;
  font-size: 15px;
}

/* --- EMPTY STATE --- */
.m-empty { padding: 48px 24px !important; text-align: center; }
.m-empty-icon { opacity: 0.25; margin-bottom: 16px; }
.m-empty-icon svg { width: 56px !important; height: 56px !important; }
.m-empty-text { font-size: 14px; color: rgba(255,255,255,0.35); line-height: 1.4; }

/* --- STATUS BADGES --- */
.m-badge {
  flex-shrink: 0;
  white-space: nowrap;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* --- PROFILE QUICK ACTIONS --- */
.m-profile-quick-action span,
.m-profile-quick-action-label {
  font-size: 10px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 64px;
  display: block;
  text-align: center;
}

/* --- SCHEDULE TABLE --- */
.m-schedule-table { font-size: 13px; }
.m-schedule-table th, .m-schedule-table td {
  padding: 8px 4px;
  min-width: 28px;
  text-align: center;
}
.m-schedule-table td:first-child, .m-schedule-table th:first-child {
  text-align: left;
  min-width: 120px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- GRADIENT BUTTON --- */
.m-btn-gradient {
  background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%) !important;
  border: none !important;
  border-radius: 24px !important;
  padding: 12px 24px !important;
  font-size: 14px !important;
  font-weight: 600;
  box-shadow: 0 4px 14px rgba(124,58,237,0.3);
}

/* --- LOADING SCREEN: full width --- */
#app.loading-mode {
  width: 100vw !important;
  max-width: 100vw !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* --- BIOMETRIC ERROR: hide --- */
.m-toast[data-biometric-err] { display: none !important; }

/* --- INLINE LOADING SCREEN (before JS loads) --- */
.asgard-preloader {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  width: 100vw; height: 100vh;
  background: #0D1117;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  z-index: 99999;
  gap: 24px;
}
.asgard-preloader img {
  width: 120px;
  height: 120px;
  object-fit: contain;
  animation: m-pulse 2s ease-in-out infinite;
}
.asgard-preloader-text {
  color: rgba(255,255,255,0.4);
  font-size: 13px;
  font-family: Inter, -apple-system, sans-serif;
  letter-spacing: 0.5px;
}
.asgard-preloader-spinner {
  width: 32px; height: 32px;
  border: 3px solid rgba(255,255,255,0.1);
  border-top-color: rgba(212,165,116,0.8);
  border-radius: 50%;
  animation: m-preloader-spin 1s linear infinite;
}
@keyframes m-preloader-spin {
  to { transform: rotate(360deg); }
}

/* --- TYPOGRAPHY REFINEMENT --- */
@media (max-width: 768px) {
  .m-mono, [data-mono="1"] {
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }
  body {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }
  .m-card, .m-stat-card, .m-quick-action, .m-filter-pill, .m-btn, .m-bottom-nav {
    -webkit-user-select: none;
    user-select: none;
  }
}

/* --- PTR --- */
.m-ptr-indicator {
  transition: height 0.15s ease, opacity 0.15s ease;
}
"""

css += NEW_CSS
print("  [OK] v8.8.5 premium CSS added")
fixes.append("CSS premium")

with open(CSS, 'w') as f:
    f.write(css)

# ═══════════════════════════════════════════════════════════
# 2. mobile_ui.js: mStats xs class
# ═══════════════════════════════════════════════════════════
print("\n--- 2. mStats auto-shrink xs ---")
with open(UI, 'r') as f:
    ui = f.read()

# Add xs class for very long values
old_sm = "if (valStr.length > 10) valClass += ' m-stat-value-sm';"
new_sm = "if (valStr.length > 8) valClass += ' m-stat-value-sm';\n      if (valStr.length > 12) valClass += ' m-stat-value-xs';"

if old_sm in ui and 'm-stat-value-xs' not in ui:
    ui = ui.replace(old_sm, new_sm)
    print("  [OK] Added m-stat-value-xs")
    fixes.append("mStats xs")
elif 'm-stat-value-xs' in ui:
    print("  [SKIP] Already has xs class")
else:
    # Try adjusting thresholds
    if "valStr.length > 6" in ui:
        ui = ui.replace("valStr.length > 6", "valStr.length > 5")
        print("  [OK] Adjusted md threshold 6→5")
    print("  [INFO] xs class might need manual review")

with open(UI, 'w') as f:
    f.write(ui)
r = subprocess.run(['node', '-c', UI], capture_output=True, text=True, timeout=10)
print(f"  Syntax: {'PASS' if r.returncode == 0 else 'FAIL: ' + r.stderr[:200]}")

# ═══════════════════════════════════════════════════════════
# 3. mobile_renders.js: moneyCompact + use it in stats
# ═══════════════════════════════════════════════════════════
print("\n--- 3. moneyCompact for stat cards ---")
with open(RENDERS, 'r') as f:
    renders = f.read()

# Add moneyCompact function
if 'moneyCompact' not in renders:
    money_idx = renders.find("function money(")
    if money_idx > 0:
        func_end = renders.find("\n  }", money_idx)
        if func_end > 0:
            insert_pos = func_end + 4
            compact = """

  function moneyCompact(v) {
    if (v == null || v === '' || isNaN(Number(v))) return '\\u2014';
    var n = Number(v);
    if (n === 0) return '0 \\u20BD';
    var abs = Math.abs(n);
    var sign = n < 0 ? '-' : '';
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1).replace('.0', '') + ' \\u043C\\u043B\\u0440\\u0434 \\u20BD';
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1).replace('.0', '') + ' \\u043C\\u043B\\u043D \\u20BD';
    if (abs >= 1e4) return sign + (abs / 1e3).toFixed(0) + ' \\u0442\\u044B\\u0441 \\u20BD';
    return money(v);
  }"""
            renders = renders[:insert_pos] + compact + renders[insert_pos:]
            print("  [OK] moneyCompact() added")
            fixes.append("moneyCompact")
else:
    print("  [SKIP] moneyCompact already exists")

# Use moneyCompact in stat card sums
replacements = [
    ("{ label: 'Сумма', value: money(totalAmount),", "{ label: 'Сумма', value: moneyCompact(totalAmount),"),
    ("{ title: 'Выиграно', value: money(wonSum),", "{ title: 'Выиграно', value: moneyCompact(wonSum),"),
]
for old, new in replacements:
    if old in renders:
        renders = renders.replace(old, new)
        print(f"  [OK] → moneyCompact: {old[:35]}...")
        fixes.append("compact stat")

with open(RENDERS, 'w') as f:
    f.write(renders)
r = subprocess.run(['node', '-c', RENDERS], capture_output=True, text=True, timeout=10)
print(f"  Syntax: {'PASS' if r.returncode == 0 else 'FAIL: ' + r.stderr[:200]}")

# ═══════════════════════════════════════════════════════════
# 4. app.js: Reduce loading delay 2.5s → 0.8s
# ═══════════════════════════════════════════════════════════
print("\n--- 4. Loading delay reduction ---")
with open(APP, 'r') as f:
    app = f.read()

old_delay = "await new Promise(r => setTimeout(r, 2500));"
new_delay = "await new Promise(r => setTimeout(r, 800));"
if old_delay in app:
    app = app.replace(old_delay, new_delay)
    print("  [OK] Loading delay 2500ms → 800ms")
    fixes.append("fast loading")
else:
    # Try other variations
    import re as re2
    match = re2.search(r'setTimeout\(r,\s*(\d{4,})\)', app)
    if match and int(match.group(1)) > 1000:
        old_ms = match.group(0)
        new_ms = 'setTimeout(r, 800)'
        app = app.replace(old_ms, new_ms)
        print(f"  [OK] Loading delay {match.group(1)}ms → 800ms")
        fixes.append("fast loading")
    else:
        print("  [SKIP] Loading delay pattern not found")

with open(APP, 'w') as f:
    f.write(app)
r = subprocess.run(['node', '-c', APP], capture_output=True, text=True, timeout=10)
print(f"  Syntax: {'PASS' if r.returncode == 0 else 'FAIL: ' + r.stderr[:200]}")

# ═══════════════════════════════════════════════════════════
# 5. index.html: Inline preloader + OG meta tags + cache busters
# ═══════════════════════════════════════════════════════════
print("\n--- 5. index.html: preloader + SEO ---")
with open(INDEX, 'r') as f:
    idx_html = f.read()

# 5a. Add Open Graph meta tags
if 'og:title' not in idx_html:
    og_tags = """
  <!-- Open Graph / SEO -->
  <meta property="og:type" content="website"/>
  <meta property="og:title" content="АСГАРД CRM — Управление тендерами и проектами"/>
  <meta property="og:description" content="CRM система АСГАРД-СЕРВИС для управления тендерами, работами, персоналом и финансами. Автоматизация бизнес-процессов строительной компании."/>
  <meta property="og:image" content="https://asgard-crm.ru/assets/img/icon-512.png"/>
  <meta property="og:image:width" content="512"/>
  <meta property="og:image:height" content="512"/>
  <meta property="og:url" content="https://asgard-crm.ru/"/>
  <meta property="og:site_name" content="АСГАРД CRM"/>
  <meta property="og:locale" content="ru_RU"/>
  <meta name="twitter:card" content="summary"/>
  <meta name="twitter:title" content="АСГАРД CRM — Управление тендерами и проектами"/>
  <meta name="twitter:description" content="CRM система АСГАРД-СЕРВИС для управления тендерами, работами, персоналом и финансами."/>
  <meta name="twitter:image" content="https://asgard-crm.ru/assets/img/icon-512.png"/>"""

    # Insert after existing description meta tag
    desc_tag = '<meta name="description"'
    desc_idx = idx_html.find(desc_tag)
    if desc_idx > 0:
        line_end = idx_html.find('\n', desc_idx)
        idx_html = idx_html[:line_end] + og_tags + idx_html[line_end:]
        print("  [OK] Open Graph meta tags added")
        fixes.append("OG tags")
    else:
        print("  [WARN] Could not find description meta tag")
else:
    print("  [SKIP] OG tags already exist")

# 5b. Improve description
old_desc = 'content="CRM система АСГАРД-СЕРВИС для управления тендерами, работами и персоналом"'
new_desc = 'content="АСГАРД CRM — система управления тендерами, работами, персоналом и финансами строительной компании АСГАРД-СЕРВИС. Автоматизация бизнес-процессов, аналитика, AI-ассистент."'
if old_desc in idx_html:
    idx_html = idx_html.replace(old_desc, new_desc)
    print("  [OK] Description improved")
    fixes.append("description")

# 5c. Add inline preloader inside #app div
old_app_div = '<div id="app"><noscript>Для работы требуется JavaScript.</noscript></div>'
new_app_div = '''<div id="app">
    <div class="asgard-preloader" id="asgardPreloader">
      <img src="assets/img/logo.png" alt="АСГАРД" width="120" height="120"/>
      <div class="asgard-preloader-spinner"></div>
      <div class="asgard-preloader-text">АСГАРД CRM</div>
    </div>
    <noscript>Для работы требуется JavaScript.</noscript>
  </div>'''

if old_app_div in idx_html:
    idx_html = idx_html.replace(old_app_div, new_app_div)
    print("  [OK] Inline preloader added")
    fixes.append("preloader")
elif 'asgard-preloader' in idx_html:
    print("  [SKIP] Preloader already exists")
else:
    print("  [WARN] Could not find #app div pattern")

# 5d. Update cache busters
for fname in ['mobile_renders.js', 'mobile_ui.js', 'mobile_premium.css', 'app.js']:
    pattern = fname.replace('.', r'\.') + r'\?v=[^"\'&]*'
    replacement = fname + '?v=8.8.5'
    idx_html = re.sub(pattern, replacement, idx_html)

print("  [OK] Cache busters → 8.8.5")
fixes.append("cache busters")

with open(INDEX, 'w') as f:
    f.write(idx_html)

# ═══════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════
print(f"\n{'=' * 60}")
print(f"DONE: {len(fixes)} fixes applied")
print(f"Fixes: {', '.join(fixes)}")
print(f"{'=' * 60}")
print("\nRestart: systemctl restart asgard-crm")
