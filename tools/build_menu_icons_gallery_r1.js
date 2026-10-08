#!/usr/bin/env node
/**
 * Menu icons R1: inventory, export current, fetch solid icons, gallery.html
 * Does NOT touch public/ CRM assets.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_design', 'menu-icons-r1');
const APP_JS = path.join(ROOT, 'public', 'assets', 'js', 'app.js');
const NAV_ICONS_DIR = path.join(ROOT, 'public', 'assets', 'icons', 'nav');

const NAV_GROUPS = [
  { id: 'home', label: 'Главная', desc: 'Очаг, дашборды, календарь' },
  { id: 'tenders', label: 'Тендеры', desc: 'Сага, контрагенты, просчёты' },
  { id: 'works', label: 'Работы', desc: 'Проекты, Гантт, канбан' },
  { id: 'finance', label: 'Финансы', desc: 'Казна, счета, касса' },
  { id: 'resources', label: 'Ресурсы', desc: 'Склад, закупки, договоры' },
  { id: 'personnel', label: 'Персонал', desc: 'Дружина, табели, HR' },
  { id: 'comm', label: 'Коммуникации', desc: 'Хугинн, звонки, почта' },
  { id: 'analytics', label: 'Аналитика', desc: 'KPI, хроники, карты' },
  { id: 'system', label: 'Система', desc: 'Настройки, бэкап, сервер' },
];

const RIGHT_RAIL = [
  { id: 'mimir', label: 'Мимир', desc: 'AI-чат и группа Мимир', tab: 'mimir' },
  { id: 'huginn', label: 'Хугинн', desc: 'Корпоративный мессенджер', tab: 'huginn' },
  { id: 'ting', label: 'Тинг', desc: 'Видеосовещания LiveKit', tab: 'ting' },
  { id: 'phone', label: 'Телефон', desc: 'Softphone PBX в доке', tab: 'phone' },
];

/** Unique heroicons-solid (24) name per slug — no duplicates */
const SLUG_ICON = {
  // groups
  'group-home': 'home-modern',
  'group-tenders': 'clipboard-document-list',
  'group-works': 'wrench-screwdriver',
  'group-finance': 'banknotes',
  'group-resources': 'cube',
  'group-personnel': 'user-group',
  'group-comm': 'chat-bubble-left-right',
  'group-analytics': 'chart-bar-square',
  'group-system': 'cog-6-tooth',
  // right
  'right-mimir': 'sparkles',
  'right-huginn': 'chat-bubble-oval-left-ellipsis',
  'right-ting': 'video-camera',
  'right-phone': 'phone',
  // left routes
  home: 'building-library',
  dashboard: 'presentation-chart-line',
  'my-dashboard': 'squares-2x2',
  'big-screen': 'desktop-computer',
  'command-map': 'map',
  calendar: 'calendar',
  birthdays: 'cake',
  tasks: 'check-circle',
  help: 'hand-raised',
  tenders: 'document-text',
  customers: 'building-office-2',
  'pm-calculations': 'document-search',
  calculator: 'calculator',
  'bonus-approval': 'gift',
  'pm-works': 'briefcase',
  readiness: 'signal',
  'all-works': 'rectangle-stack',
  'gantt-calcs': 'chart-bar',
  'gantt-works': 'template',
  'tasks-admin': 'clipboard-document-check',
  kanban: 'view-columns',
  'personal-kanban-v3': 'squares-plus',
  'director-inbox': 'inbox-arrow-down',
  'director-tender-approvals': 'shield-check',
  finances: 'collection',
  billing: 'receipt-tax',
  'buh-registry': 'table-cells',
  'doc-hub': 'folder-open',
  'office-expenses': 'building-storefront',
  cash: 'cash',
  'cash-admin': 'lock-closed',
  'approval-payment': 'credit-card',
  'my-timesheet': 'clock',
  'self-employed': 'identification',
  'one-time-pay': 'bolt',
  'reports-payroll': 'document-chart-bar',
  tkp: 'document-duplicate',
  'pass-requests': 'key',
  procurement: 'shopping-cart',
  'my-procurement': 'shopping-bag',
  'suppliers-catalog': 'tag',
  assembly: 'puzzle-piece',
  'warehouse-v2': 'archive-box',
  'my-equipment': 'wrench',
  correspondence: 'envelope',
  contracts: 'document-check',
  seals: 'finger-print',
  proxies: 'document-minus',
  personnel: 'users',
  'hr-requests': 'user-plus',
  collections: 'bookmark-square',
  permits: 'shield-exclamation',
  'nd-permits': 'bolt-slash',
  'permit-applications': 'clipboard',
  training: 'academic-cap',
  'office-academy': 'book-open',
  'office-schedule': 'calendar-days',
  'workers-schedule': 'user-circle',
  'hr-rating': 'star',
  travel: 'paper-airplane',
  timesheet: 'clipboard-document-list',
  'timesheet-warehouse': 'archive-box-arrow-down',
  'timesheet-medical': 'heart',
  'timesheet-travel': 'truck',
  'site-crew': 'map-pin',
  'payroll-dashboard': 'receipt-refund',
  'official-employees': 'check-badge',
  'training-board': 'light-bulb',
  'pm-balance': 'scale',
  messenger: 'chat-bubble-bottom-center-text',
  meetings: 'microphone',
  ting: 'play',
  alerts: 'bell-alert',
  telegram: 'chat-bubble-left-ellipsis',
  telephony: 'phone-arrow-up-right',
  'call-reports': 'speaker-wave',
  analytics: 'chart-pie',
  'user-requests': 'user-remove',
  settings: 'adjustments-horizontal',
  'admin-timesheet-settings': 'cog-8-tooth',
  backup: 'cloud-arrow-down',
  sync: 'arrow-path',
  diag: 'beaker',
  'system-panel': 'server-stack',
  'to-analytics': 'trending-up',
  'pm-analytics': 'presentation-chart-bar',
  'readiness-board': 'clipboard-document',
  'engineer-dashboard': 'cpu-chip',
  'pm-prizes': 'badge-check',
  'gamification-dashboard': 'lightning-bolt',
  'gamification-leaderboard': 'fire',
  'gamification-admin': 'command-line',
  'object-map': 'globe-alt',
  'my-mail': 'at-symbol',
  mailbox: 'inbox-stack',
  'mail-settings': 'envelope-open',
  integrations: 'link',
};

function routeToSlug(r) {
  return r.replace(/^\//, '').replace(/\//g, '-');
}

function parseNavItems() {
  const src = fs.readFileSync(APP_JS, 'utf8');
  const start = src.indexOf('const NAV=[');
  if (start < 0) throw new Error('NAV not found');
  let depth = 0;
  let i = src.indexOf('[', start);
  const begin = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  const block = src.slice(begin, i);
  const nav = [];
  const chunks = block.split(/\},\s*\n/);
  for (let chunk of chunks) {
    chunk = chunk.replace(/^\s*\{?/, '{').replace(/\}?\s*$/, '}');
    if (!chunk.includes('r:')) continue;
    const get = (key) => {
      const mm = chunk.match(new RegExp(`${key}:"([^"]*)"`));
      return mm ? mm[1] : undefined;
    };
    const item = {
      r: get('r'),
      l: get('l'),
      d: get('d'),
      i: get('i'),
      p: get('p'),
      g: get('g'),
      navHide: /navHide\s*:\s*true/.test(chunk),
    };
    if (item.r && item.l) nav.push(item);
  }
  return nav.filter((n) => !n.navHide);
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function fetchSolidIcons(names) {
  const unique = [...new Set(names)];
  const chunks = [];
  for (let i = 0; i < unique.length; i += 40) {
    chunks.push(unique.slice(i, i + 40));
  }
  const map = {};
  const prefix = 'heroicons-solid';
  for (const chunk of chunks) {
    const url = `https://api.iconify.design/${prefix}.json?icons=${chunk.join(',')}`;
    const data = await fetchJson(url);
    const icons = data.icons || data;
    for (const [short, val] of Object.entries(icons)) {
      if (short === 'prefix' || short === 'lastModified' || short === 'aliases') continue;
      if (val && typeof val === 'object' && val.body) map[short] = val;
    }
  }
  return map;
}

function iconifyToSvg(body, iconData) {
  const vb = iconData?.left != null ? `${iconData.left} ${iconData.top} ${iconData.width} ${iconData.height}` : '0 0 24 24';
  const inner = body.replace(/currentColor/g, 'currentColor').replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="currentColor" aria-hidden="true">\n${inner.trim()}\n</svg>\n`;
}

function copyCurrentIcon(iconKey, destName) {
  const src = path.join(NAV_ICONS_DIR, `${iconKey}.svg`);
  const dest = path.join(OUT, 'current', destName);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    return true;
  }
  return false;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

async function main() {
  mkdirp(path.join(OUT, 'current'));
  mkdirp(path.join(OUT, 'new'));

  const navVisible = parseNavItems();
  const entries = [];

  for (const g of NAV_GROUPS) {
    const slug = `group-${g.id}`;
    entries.push({
      kind: 'group',
      slug,
      file: `left-${slug}.svg`,
      label: g.label,
      desc: g.desc,
      route: `— (rail группа ${g.id})`,
      group: g.id,
      iconKey: null,
      side: 'left',
    });
  }

  for (const n of navVisible) {
    const slug = routeToSlug(n.r);
    entries.push({
      kind: 'item',
      slug,
      file: `left-${slug}.svg`,
      label: n.l,
      desc: n.d,
      route: n.r,
      group: n.g,
      iconKey: n.i,
      side: 'left',
    });
  }

  for (const r of RIGHT_RAIL) {
    const slug = `right-${r.id}`;
    entries.push({
      kind: 'right',
      slug,
      file: `${slug}.svg`,
      label: r.label,
      desc: r.desc,
      route: `#hg-tab=${r.tab}`,
      group: 'comm',
      iconKey: r.id,
      side: 'right',
    });
  }

  const iconNames = entries.map((e) => {
    const name = SLUG_ICON[e.slug];
    if (!name) throw new Error(`Missing SLUG_ICON for ${e.slug}`);
    return name;
  });

  console.log(`Fetching ${[...new Set(iconNames)].length} unique heroicons-solid…`);
  const iconPack = await fetchSolidIcons(iconNames);

  for (const e of entries) {
    const iname = SLUG_ICON[e.slug];
    const data = iconPack[iname];
    if (!data?.body) {
      console.warn(`WARN: no icon data for ${iname} (${e.slug}), using fallback circle`);
      const fallback = '<circle cx="12" cy="12" r="8" fill="currentColor"/>';
      fs.writeFileSync(path.join(OUT, 'new', e.file), iconifyToSvg(fallback, { left: 0, top: 0, width: 24, height: 24 }));
    } else {
      fs.writeFileSync(path.join(OUT, 'new', e.file), iconifyToSvg(data.body, data));
    }

    if (e.iconKey && e.side === 'left') {
      copyCurrentIcon(e.iconKey, e.file.replace('.svg', `-was-${e.iconKey}.svg`));
    }
    if (e.kind === 'group') {
      fs.writeFileSync(
        path.join(OUT, 'current', e.file.replace('.svg', '-was-inline-stroke.svg')),
        '<!-- inline stroke SVG in app.js NAV_GROUPS -->\n'
      );
    }
    if (e.kind === 'right') {
      fs.writeFileSync(
        path.join(OUT, 'current', e.file.replace('.svg', '-was-lucide-stroke.svg')),
        '<!-- Lucide stroke in huginn_icons.js -->\n'
      );
    }
  }

  const invLines = [
    '# Menu icons inventory (R1)',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Total cards: **${entries.length}** (${NAV_GROUPS.length} groups + ${navVisible.length} nav items + ${RIGHT_RAIL.length} right)`,
    '',
    '| Side | Slug | Label | Description | Route | Group | Old icon | New file | Heroicon |',
    '|------|------|-------|-------------|-------|-------|----------|----------|----------|',
  ];

  for (const e of entries) {
    invLines.push(
      `| ${e.side} | \`${e.slug}\` | ${e.label} | ${e.desc} | \`${e.route}\` | ${e.group} | ${e.iconKey || 'inline'} | \`${e.file}\` | ${SLUG_ICON[e.slug]} |`
    );
  }

  fs.writeFileSync(path.join(OUT, 'inventory.md'), invLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify(entries, null, 2), 'utf8');

  const cardsJson = JSON.stringify(entries);
  const gallery = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>ASGARD CRM — иконки меню R1 (было / стало)</title>
<style>
  :root {
    --bg: #f4f5f7;
    --card: #fff;
    --text: #2d3748;
    --muted: #718096;
    --charcoal: #3d4451;
    --rail: #eef0f3;
    --accent: #00b4d8;
    --accent2: #ff6b35;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, Segoe UI, sans-serif; background: var(--bg); color: var(--text); }
  header { padding: 20px 24px; background: #1a1a1a; color: #fff; }
  header h1 { margin: 0 0 8px; font-size: 1.25rem; }
  header p { margin: 0; opacity: .85; font-size: .9rem; }
  .ref { display: flex; gap: 16px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
  .ref img { height: 120px; border-radius: 8px; border: 1px solid #444; }
  .toolbar { padding: 16px 24px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; background: var(--card); border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 10; }
  .toolbar input, .toolbar select { padding: 8px 12px; border: 1px solid #cbd5e0; border-radius: 8px; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; padding: 24px; }
  .card { background: var(--card); border-radius: 12px; border: 1px solid #e2e8f0; padding: 16px; }
  .card h3 { margin: 0 0 4px; font-size: 1rem; }
  .meta { font-size: 12px; color: var(--muted); margin-bottom: 12px; line-height: 1.4; }
  .compare { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .pane { background: var(--rail); border-radius: 10px; padding: 12px; text-align: center; }
  .pane label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-bottom: 8px; }
  .ico-row { display: flex; justify-content: center; gap: 16px; align-items: center; min-height: 56px; }
  .ico-row img, .ico-row object { width: 32px; height: 32px; color: var(--charcoal); }
  .ico-active { width: 44px; height: 44px; border-radius: 50%; background: var(--accent); display: flex; align-items: center; justify-content: center; }
  .ico-active img { width: 24px; height: 24px; filter: brightness(0) invert(1); }
  .file-id { margin-top: 10px; font-family: ui-monospace, monospace; font-size: 11px; color: #4a5568; word-break: break-all; }
  .badge { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 999px; background: #edf2f7; margin-right: 6px; }
  .badge.right { background: #e6fffa; color: #234e52; }
  .badge.group { background: #feebc8; color: #7b341e; }
  footer { padding: 24px; text-align: center; color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>Иконки меню ASGARD CRM — раунд 1</h1>
  <p>Solid heroicons-style · ${entries.length} карточек · CRM не изменён</p>
  <div class="ref">
    <span>Референс стиля:</span>
    <img src="reference-style.png" alt="reference"/>
  </div>
</header>
<div class="toolbar">
  <input type="search" id="q" placeholder="Поиск по названию…" style="min-width:220px"/>
  <select id="side"><option value="">Все стороны</option><option value="left">Левое</option><option value="right">Правое</option></select>
  <select id="group"><option value="">Все группы</option>${NAV_GROUPS.map((g) => `<option value="${g.id}">${g.label}</option>`).join('')}</select>
  <span id="count"></span>
</div>
<div class="grid" id="grid"></div>
<footer>Открыть локально: file или <code>npx serve _design/menu-icons-r1</code> · Папка new/</footer>
<script>
const ENTRIES = ${cardsJson};
function wasPath(e) {
  if (e.kind === 'group') return null;
  if (e.side === 'right') return null;
  if (e.iconKey) return 'current/' + e.file.replace('.svg', '-was-' + e.iconKey + '.svg');
  return null;
}
function render() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  const side = document.getElementById('side').value;
  const group = document.getElementById('group').value;
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  let n = 0;
  for (const e of ENTRIES) {
    if (side && e.side !== side) continue;
    if (group && e.group !== group) continue;
    if (q && !(e.label + e.desc + e.route + e.slug).toLowerCase().includes(q)) continue;
    n++;
    const el = document.createElement('article');
    el.className = 'card';
    const kindBadge = e.kind === 'group' ? '<span class="badge group">rail группа</span>' : e.kind === 'right' ? '<span class="badge right">правый rail</span>' : '<span class="badge">' + e.group + '</span>';
    const was = wasPath(e);
    const wasHtml = was
      ? '<img src="' + was + '" alt="было" style="color:var(--charcoal)"/>'
      : '<span style="font-size:11px;color:#a0aec0">stroke / inline<br/>см. CRM</span>';
    el.innerHTML = kindBadge +
      '<h3>' + e.label + '</h3>' +
      '<div class="meta">' + e.desc + '<br/><code>' + e.route + '</code></div>' +
      '<div class="compare">' +
        '<div class="pane"><label>Было</label><div class="ico-row">' + wasHtml + '</div></div>' +
        '<div class="pane"><label>Стало</label><div class="ico-row">' +
          '<img src="new/' + e.file + '" alt="стало"/>' +
          '<div class="ico-active" title="active state"><img src="new/' + e.file + '" alt=""/></div>' +
        '</div></div>' +
      '</div>' +
      '<div class="file-id">' + e.file + ' · ' + e.slug + '</div>';
    grid.appendChild(el);
  }
  document.getElementById('count').textContent = 'Показано: ' + n;
}
document.getElementById('q').oninput = render;
document.getElementById('side').onchange = render;
document.getElementById('group').onchange = render;
render();
</script>
</body>
</html>
`;

  fs.writeFileSync(path.join(OUT, 'gallery.html'), gallery, 'utf8');

  const rubric = `# Rubric — верификатор иконок R1

## Референс
- Solid fill, charcoal (#3d4451), мягкие формы
- Active: белая иконка на цветном круге (cyan/orange)
- Единый визуальный вес 24×24

## На каждую карточку
1. **Стиль** — solid, не outline? PASS/FAIL
2. **24px** — читается в rail? PASS/FAIL
3. **Смысл** — метафора совпадает с пунктом меню? PASS/FAIL
4. **Отличимость** — не путается с соседом в той же группе? PASS/FAIL
5. **Референс** — визуально в семействе референса? PASS/FAIL

Итог: PASS только если все 5 = PASS. Иначе REDO + одна причина.

## Файлы
- Галерея: \`gallery.html\`
- Новые SVG: \`new/*.svg\`
- Реестр: \`inventory.md\`
`;

  fs.writeFileSync(path.join(OUT, 'verifier-rubric.md'), rubric, 'utf8');

  console.log(`Done: ${entries.length} icons → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
