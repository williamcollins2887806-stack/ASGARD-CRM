'use strict';
/**
 * ASGARD Field — front-end verifiers (Фаза S5 + покрытие поверхностей).
 *
 * Пять независимых проверок, каждая даёт PASS/FAIL и exit 1 при провале.
 * Запуск:
 *   node tools/field-front-verify.js            # все проверки, человекочитаемо
 *   node tools/field-front-verify.js --json     # машинный JSON
 *   node tools/field-front-verify.js --only=legacy
 *
 * Проверки:
 *   legacy   — старая дизайн-система не используется (руны/Cinzel/звёзды/эмодзи-иконки/
 *              хардкод-палитра вне токенов/`--fa-*`/aurora/rune-*)
 *   stubs    — нет заглушек (TODO/FIXME/«потом»/mock/lorem/Заглушка/placeholder-компоненты)
 *   coverage — каждая поверхность (страница/компонент) подключена к дизайн-системе
 *   surfaces — реестр поверхностей: ни одной новой hand-rolled (fixed/`<style>`/alert)
 *   budget   — бюджеты бандла после npm run build (главный чанк / vendor / assets)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'mobile-app', 'src');
const DIST = path.join(ROOT, 'public', 'mobile-app', 'dist');
const FIELD = path.join(SRC, 'pages', 'field');
const COMP = path.join(SRC, 'components', 'field');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const AS_JSON = process.argv.includes('--json');

/* ── Реестр поверхностей: что обязано быть на новой системе ───────────────── */
/** Экраны рабочего приложения (роуты /field/*). */
const FIELD_SCREENS = [
  'FieldHome', 'FieldShift', 'FieldTimesheet', 'FieldMoney', 'FieldEarnings',
  'FieldEarningsMonthly', 'FieldFunds', 'FieldMyWorks', 'FieldCrew', 'FieldCrewStages',
  'FieldLogistics', 'FieldReport', 'FieldIncidents', 'FieldPhotos', 'FieldPacking',
  'FieldAssembly', 'FieldPalletBuilder', 'FieldReceiving', 'FieldStages', 'FieldPermits',
  'FieldPermitDetail', 'FieldReadiness', 'FieldDiary', 'FieldProfile', 'FieldJourney',
  // Чертоги Мимира + летописи + руны (академия и геймификация)
  'FieldAcademy', 'FieldAcademyLibrary', 'FieldAcademyQuiz', 'FieldLesson',
  // Геймификация
  'FieldAchievements', 'FieldLeaderboard', 'FieldHall', 'FieldSeasonal', 'FieldQuests',
  'FieldShop', 'FieldInventory',
  // Игры
  'WheelOfNorns', 'PipelineGame', 'ChemLabGame',
  // Вход
  'FieldWelcome', 'FieldLogin', 'FieldPinSetup', 'FieldPinEntry',
];

/** Компоненты полевого слоя, которые обязаны быть на новой системе. */
const FIELD_COMPONENTS = [
  'AcademyBanners', 'NornsPauseBanner', 'DisputeForm', 'QRScanner',
  'RankUpCeremony', 'LessonInteractive', 'VikingAvatar3D',
];

/** Приложение директора по согласованиям. */
const DIRECTOR_SCREENS = ['Approvals', 'TenderApprovals'];

/** Игровые полотна — исключение: canvas/3D внутри, но обёртка обязана быть системной. */
const CANVAS_EXEMPT = new Set(['ChemLabGame', 'PipelineGame', 'WheelOfNorns', 'FieldHall']);

/* ── Проверка 1: старая дизайн-система ───────────────────────────────────── */
const LEGACY_PATTERNS = [
  { id: 'cinzel', re: /Cinzel/i, why: 'старый шрифт Cinzel (рунический serif)' },
  { id: 'fa-vars', re: /--fa-[\w-]+/, why: 'палитра входа --fa-* (старая система)' },
  { id: 'rune-deco', re: /\brune-decoration\b|\brune-particle\b|runeFloat|norseShimmer/, why: 'рунные декорации' },
  { id: 'aurora', re: /\baurora-bg\b|northernLights/, why: 'северное сияние (старая система)' },
  { id: 'starfield', re: /\bstarfield\b|star-field|welcomeRuneDrift|fa-star|fa-stars/, why: 'звёздное поле/руны на входе' },
  { id: 'emoji-icon', re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, why: 'эмодзи вместо иконок' },
  { id: 'old-gold', re: /#c8a84e|#c8a84b|#D4A843|#d4a843/, why: 'старое золото вне токенов' },
  { id: 'old-bg', re: /#0a0a0c|#0b0e1a|#080d1f|#141828|#1a2040/, why: 'старые фоновые hex вне токенов' },
];

/* ── Проверка 6: ЛОГОТИПЫ НЕЛЬЗЯ МЕНЯТЬ (заказчик 16.10.2026) ───────────────
   ASGARD CRM и ASGARD Сервис — официальные файлы. Нельзя ни перерисовывать
   самодельными SVG, ни заменять щитом дизайн-системы, ни перезаписывать файл.
   Официальные: public/mobile-app/public/asgard-logo.png (+ копии в public/assets/img).
   Файл логотипа обязан существовать и иметь неизменную подпись (sha256). */
const LOGO_FILES = [
  { path: 'public/mobile-app/public/asgard-logo.png', kind: 'ASGARD CRM (mobile)' },
  { path: 'public/assets/img/asgard_logo.png', kind: 'ASGARD CRM (desktop)' },
  { path: 'public/assets/img/logo.png', kind: 'ASGARD CRM (logo)' },
  { path: 'public/assets/img/logo-transparent.png', kind: 'ASGARD CRM (transparent)' },
];
/* sha256 официальных логотипов — «замок». Любая перерисовка/подмена = FAIL.
   Если логотип обновляет сам заказчик, хэш обновляется осознанно и явно. */
const LOGO_SHA256 = '7a1dfd650356da755cf619655b139789cd2e007e0ea5111ef6837f833280be23';

function checkLogos() {
  const crypto = require('crypto');
  const problems = [];
  const details = [];
  for (const l of LOGO_FILES) {
    const abs = path.join(ROOT, l.path);
    if (!fs.existsSync(abs)) { details.push({ ...l, exists: false }); continue; }
    const buf = fs.readFileSync(abs);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    details.push({ ...l, exists: true, bytes: buf.length, isPng, sha });
    if (!isPng) problems.push(`${l.path}: не PNG (логотип подменён/перерисован)`);
    if (sha !== LOGO_SHA256) problems.push(`${l.path}: sha256 изменился (${sha.slice(0, 12)}…) — логотип править нельзя`);
  }

  // Щит дизайн-системы в роли логотипа: там, где есть официальный лого,
  // не должно быть самодельного Shield/BrandShield.
  const files = [...walk(FIELD), ...walk(COMP)];
  for (const f of files) {
    const src = readSafe(f);
    if (!src) continue;
    if (/(?:BrandShield|from '@\/components\/field\/ui'[\s\S]*?\bShield\b)/.test(src) && /asgard-logo|AsgardLogo/.test(src)) {
      problems.push(`${rel(f)}: самодельный щит рядом с официальным логотипом — щит в роли лого запрещён`);
    }
  }
  return { name: 'logos', pass: problems.length === 0, total: LOGO_FILES.length, problems, details };
}

/* ── Проверка 2: заглушки ─────────────────────────────────────────────────── */
const STUB_PATTERNS = [
  { id: 'todo', re: /\b(TODO|FIXME|XXX|HACK)\b/, why: 'TODO/FIXME/HACK' },
  { id: 'later', re: /потом\s+(додела|сдела|допиш|поправ)|доделать позже|временно\s+не/i, why: '«потом доделаем»' },
  { id: 'lorem', re: /lorem ipsum|Lorem Ipsum/i, why: 'lorem ipsum' },
  { id: 'mock', re: /\bMOCK_|mockData|fakeData|dummyData|hardcodedData\b/, why: 'mock/dummy-данные' },
  { id: 'coming-soon', re: /coming soon|скоро появится|в разработке(?!\s*\/\s*внедрение)/i, why: '«скоро появится»' },
  { id: 'stub-comp', re: /заглушк/i, why: '«заглушка» в тексте' },
  { id: 'placeholder-only', re: /:\s*(?:null|\(\)\s*=>\s*null)\s*[,}]?\s*\/\/\s*(?:stub|заглушк)/i, why: 'stub-компонент' },
];

/* ── Проверка 4: новые hand-rolled поверхности ───────────────────────────── */
const SURFACE_BASELINE = {
  handRolledOverlay: 26,
  inlineStyleTag: 17,
  nativeDialog: 3,
};

function walk(dir, acc = []) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(jsx|js|css)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }
function readSafe(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; }
function countMatches(src, re) { const m = src.match(re); return m ? m.length : 0; }

/** Строки файла без комментариев — чтобы не ловить «руны» в пояснениях. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (mm) => mm.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (mm, p1) => p1 + ' '.repeat(mm.length - p1.length));
}

/* ══ Проверка 1 ═══════════════════════════════════════════════════════════ */
function checkLegacy() {
  const files = [...walk(FIELD), ...walk(COMP), path.join(SRC, 'layouts', 'FieldLayout.jsx'),
    path.join(SRC, 'styles', 'field-auth.css')].filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  const hits = [];
  for (const f of files) {
    const src = stripComments(readSafe(f));
    const lines = src.split(/\r?\n/);
    for (const pat of LEGACY_PATTERNS) {
      lines.forEach((line, i) => {
        if (pat.re.test(line)) hits.push({ file: rel(f), line: i + 1, kind: pat.id, why: pat.why, text: line.trim().slice(0, 120) });
      });
    }
  }
  return { name: 'legacy', pass: hits.length === 0, total: hits.length, hits: hits.slice(0, 60) };
}

/* ══ Проверка 2 ═══════════════════════════════════════════════════════════ */
function checkStubs() {
  const files = [...walk(FIELD), ...walk(COMP), walk(path.join(SRC, 'pages', 'director')),
    path.join(SRC, 'layouts', 'FieldLayout.jsx')].filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  const hits = [];
  for (const f of files) {
    const lines = readSafe(f).split(/\r?\n/);
    for (const pat of STUB_PATTERNS) {
      lines.forEach((line, i) => {
        if (pat.re.test(line)) hits.push({ file: rel(f), line: i + 1, kind: pat.id, why: pat.why, text: line.trim().slice(0, 120) });
      });
    }
  }
  return { name: 'stubs', pass: hits.length === 0, total: hits.length, hits: hits.slice(0, 60) };
}

/* ══ Проверка 3: покрытие поверхностей ════════════════════════════════════ */
function checkCoverage() {
  const missing = [];
  for (const name of FIELD_SCREENS) {
    const p = path.join(FIELD, `${name}.jsx`);
    if (!fs.existsSync(p)) missing.push({ surface: `pages/field/${name}.jsx`, reason: 'файл не найден' });
  }
  for (const name of FIELD_COMPONENTS) {
    const p = path.join(COMP, `${name}.jsx`);
    if (!fs.existsSync(p)) missing.push({ surface: `components/field/${name}.jsx`, reason: 'файл не найден' });
  }
  for (const name of DIRECTOR_SCREENS) {
    const p = path.join(SRC, 'pages', 'director', `${name}.jsx`);
    if (!fs.existsSync(p)) missing.push({ surface: `pages/director/${name}.jsx`, reason: 'файл не найден' });
  }
  // Каждая зарегистрированная поверхность должна быть достижима из App.jsx (роут).
  const app = readSafe(path.join(SRC, 'App.jsx'));
  const unrouted = [];
  for (const name of FIELD_SCREENS) {
    if (CANVAS_EXEMPT.has(name)) continue;
    if (!app.includes(name)) unrouted.push({ surface: name, reason: 'нет ссылки в App.jsx (роут)' });
  }
  for (const name of DIRECTOR_SCREENS) {
    if (!app.includes(name)) unrouted.push({ surface: `director/${name}`, reason: 'нет ссылки в App.jsx (роут)' });
  }
  const total = FIELD_SCREENS.length + FIELD_COMPONENTS.length + DIRECTOR_SCREENS.length;
  const fail = missing.length + unrouted.length;
  return {
    name: 'coverage', pass: fail === 0, total, covered: total - missing.length, missing, unrouted,
  };
}

/* ══ Проверка 4: реестр поверхностей (нет роста долга) ════════════════════ */
function checkSurfaces() {
  const files = [...walk(FIELD), ...walk(COMP), path.join(SRC, 'layouts', 'FieldLayout.jsx')].filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  let handRolledOverlay = 0, inlineStyleTag = 0, nativeDialog = 0;
  const offenders = { overlay: [], styleTag: [], dialog: [] };
  for (const f of files) {
    const src = readSafe(f);
    const lines = src.split(/\r?\n/);
    const ov = countMatches(src, /position:\s*['"]fixed['"]/g);
    const st = countMatches(src, /<style[\s>]/g);
    const dg = countMatches(src, /(?:^|[^.\w])(?:window\.)?(?:alert|confirm)\s*\(/gm) - countMatches(src, /function\s+(?:alert|confirm)\s*\(/g);
    handRolledOverlay += ov; inlineStyleTag += st; nativeDialog += dg;
    if (ov) offenders.overlay.push({ file: rel(f), n: ov });
    if (st) offenders.styleTag.push({ file: rel(f), n: st });
    if (dg) offenders.dialog.push({ file: rel(f), n: dg });
  }
  const over = [];
  if (handRolledOverlay > SURFACE_BASELINE.handRolledOverlay) over.push(`handRolledOverlay ${handRolledOverlay} > ${SURFACE_BASELINE.handRolledOverlay}`);
  if (inlineStyleTag > SURFACE_BASELINE.inlineStyleTag) over.push(`inlineStyleTag ${inlineStyleTag} > ${SURFACE_BASELINE.inlineStyleTag}`);
  if (nativeDialog > SURFACE_BASELINE.nativeDialog) over.push(`nativeDialog ${nativeDialog} > ${SURFACE_BASELINE.nativeDialog}`);
  return {
    name: 'surfaces', pass: over.length === 0,
    counts: { handRolledOverlay, inlineStyleTag, nativeDialog },
    baseline: SURFACE_BASELINE, over, offenders, remaining: (SURFACE_BASELINE.handRolledOverlay - handRolledOverlay) + (SURFACE_BASELINE.inlineStyleTag - inlineStyleTag) + (SURFACE_BASELINE.nativeDialog - nativeDialog),
  };
}

/* ══ Проверка 5: бюджеты бандла ═══════════════════════════════════════════ */
const BUDGET_KB = {
  entryChunk: 350,      // главный (index-*) чанк
  anyVendorChunk: 800,  // ни один vendor-чанк не должен быть монстром
  totalJs: 3000,        // вся JS-сборка
  assetsNonJs: 3000,    // медиа/модели: 27 МБ → цель ≤3 МБ
};

function checkBudget() {
  if (!fs.existsSync(DIST)) {
    return { name: 'budget', pass: false, skipped: true, reason: 'dist/ нет — сначала npm run build' };
  }
  const assetsDir = path.join(DIST, 'assets');
  const js = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js')) : [];
  const sizes = js.map((f) => ({ f, kb: Math.round(fs.statSync(path.join(assetsDir, f)).size / 1024) }))
    .sort((a, b) => b.kb - a.kb);
  const entry = sizes.find((s) => /^index-/.test(s.f));
  const vendor = sizes.filter((s) => /^vendor-/.test(s.f));
  const totalJs = sizes.reduce((t, s) => t + s.kb, 0);

  // не-JS ассеты (модели .glb и пр.)
  let assetsNonJs = 0;
  const walkAll = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkAll(p);
      else if (!/\.(js|css|html|map)$/.test(e.name)) assetsNonJs += fs.statSync(p).size;
    }
  };
  walkAll(DIST);
  assetsNonJs = Math.round(assetsNonJs / 1024);

  const fails = [];
  if (!entry) fails.push('не найден главный чанк index-*.js');
  else if (entry.kb > BUDGET_KB.entryChunk) fails.push(`главный чанк ${entry.kb} КБ > ${BUDGET_KB.entryChunk} КБ`);
  const bigVendor = vendor.filter((v) => v.kb > BUDGET_KB.anyVendorChunk);
  if (bigVendor.length) fails.push(`vendor-чанк > ${BUDGET_KB.anyVendorChunk} КБ: ${bigVendor.map((v) => `${v.f}=${v.kb}`).join(', ')}`);
  if (totalJs > BUDGET_KB.totalJs) fails.push(`всего JS ${totalJs} КБ > ${BUDGET_KB.totalJs} КБ`);
  if (assetsNonJs > BUDGET_KB.assetsNonJs) fails.push(`не-JS ассеты ${assetsNonJs} КБ > ${BUDGET_KB.assetsNonJs} КБ`);

  return {
    name: 'budget', pass: fails.length === 0, fails,
    entry: entry ? entry.kb : null, totalJs, assetsNonJs, budget: BUDGET_KB,
    top: sizes.slice(0, 10),
  };
}

/* ══ Раннер ═══════════════════════════════════════════════════════════════ */
const ALL = { legacy: checkLegacy, stubs: checkStubs, coverage: checkCoverage, surfaces: checkSurfaces, budget: checkBudget, logos: checkLogos };
const checks = ONLY ? { [ONLY]: ALL[ONLY] } : ALL;

const results = [];
for (const [name, fn] of Object.entries(checks)) {
  if (!fn) { console.error(`unknown check: ${name}`); process.exit(2); }
  results.push(fn());
}

if (AS_JSON) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log('# ASGARD Field — front-end verifiers\n');
  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    console.log(`## ${r.name}: ${mark}`);
    if (r.name === 'coverage') console.log(`  покрытие: ${r.covered}/${r.total}`);
    if (r.name === 'surfaces') console.log(`  counts: ${JSON.stringify(r.counts)} baseline ${JSON.stringify(r.baseline)}`);
    if (r.name === 'budget' && r.entry) console.log(`  главный чанк: ${r.entry} КБ · всего JS: ${r.totalJs} КБ · не-JS ассеты: ${r.assetsNonJs} КБ`);
    if (r.name === 'logos') for (const d of r.details) console.log(`  ${d.exists ? 'OK' : 'MISSING'} ${d.path} (${d.kind})${d.bytes ? ` · ${d.bytes} Б` : ''}`);
    const list = r.hits || r.fails || r.over || r.problems || [];
    for (const h of list.slice(0, 25)) console.log(`  - ${typeof h === 'string' ? h : `${h.file}:${h.line || ''} [${h.kind || h.reason || ''}] ${h.text || h.surface || ''}`}`);
    if (r.missing?.length) for (const m of r.missing.slice(0, 25)) console.log(`  - MISSING ${m.surface}: ${m.reason}`);
    if (r.unrouted?.length) for (const m of r.unrouted.slice(0, 25)) console.log(`  - UNROUTED ${m.surface}: ${m.reason}`);
    console.log('');
  }
}

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`FAIL: ${failed.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('OK — all front-end verifiers green');
