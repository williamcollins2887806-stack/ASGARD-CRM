'use strict';
/**
 * ASGARD Field — «нет потерь» (no-loss) верификатор ЮЗАБИЛИТИ.
 *
 * Задача: при переносе вёрстки НЕЛЬЗЯ потерять ни кнопку, ни текст, ни поле.
 * Скрипт снимает слепок экрана (все интерактивные элементы + весь видимый
 * текст + поля ввода), сохраняет baseline и потом сравнивает: если после
 * правки что-то ИСЧЕЗЛО — FAIL с точным перечнем.
 *
 * Режимы:
 *   node tools/verify-field-no-loss.js --baseline          # снять слепок всех экранов
 *   node tools/verify-field-no-loss.js --check             # сравнить с baseline (FAIL при потере)
 *   node tools/verify-field-no-loss.js --check --only=FieldMoney
 *
 * Baseline: tests/reports/field-screen-baseline.json
 * Авторизация и локальный бэкенд — как в verify-field-screens.js.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function arg(n, d) { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; }
const BASE = arg('base', 'http://127.0.0.1:5173');
const EMP = Number(arg('emp', '14'));
const PIN = arg('pin', '1488');
const ONLY = arg('only', '');
const MODE = process.argv.includes('--baseline') ? 'baseline' : 'check';
const OUT = path.join(__dirname, '..', 'tests', 'reports', 'field-screen-baseline.json');

/** Экраны рабочего: ключ = имя для отчёта, url, маркер готовности (текст на экране). */
const SCREENS = [
  ['FieldHome', '/m/field/home', 'Добрый'],
  ['FieldShift', '/m/field/shift', 'Смена'],
  ['FieldTimesheet', '/m/field/timesheet', 'Табель'],
  ['FieldMoney', '/m/field/money', 'деньги'],
  ['FieldEarnings', '/m/field/earnings', ''],
  ['FieldEarningsMonthly', '/m/field/earnings/monthly', ''],
  ['FieldFunds', '/m/field/funds', ''],
  ['FieldMyWorks', '/m/field/my-works', 'Мои проекты'],
  ['FieldCrew', '/m/field/crew', ''],
  ['FieldCrewStages', '/m/field/crew-stages', ''],
  ['FieldLogistics', '/m/field/logistics', ''],
  ['FieldReport', '/m/field/report', ''],
  ['FieldIncidents', '/m/field/incidents', ''],
  ['FieldPhotos', '/m/field/photos', ''],
  ['FieldPacking', '/m/field/packing', ''],
  ['FieldAssembly', '/m/field/assembly', ''],
  ['FieldReceiving', '/m/field/receiving', ''],
  ['FieldStages', '/m/field/stages', ''],
  ['FieldDiary', '/m/field/diary', ''],
  ['FieldReadiness', '/m/field/readiness', ''],
  ['FieldJourney', '/m/field/journey', ''],
  ['FieldProfile', '/m/field/profile', ''],
  ['FieldAchievements', '/m/field/achievements', ''],
  ['FieldLeaderboard', '/m/field/leaderboard', ''],
  ['FieldSeasonal', '/m/field/seasonal', ''],
  ['FieldQuests', '/m/field/quests', ''],
  ['FieldShop', '/m/field/shop', ''],
  ['FieldInventory', '/m/field/inventory', ''],
  ['FieldAcademy', '/m/field/academy', ''],
  ['FieldAcademyLibrary', '/m/field/academy/library', ''],
  ['WheelOfNorns', '/m/field/wheel', ''],
  ['PipelineGame', '/m/field/pipeline', ''],
  ['ChemLabGame', '/m/field/chemlab', ''],
];

/** Слепок: интерактив + текст + поля. Нормализуем (trim, схлопываем пробелы). */
const SNAPSHOT_FN = () => {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const btns = [...document.querySelectorAll('button, [role="button"], a[href]')]
    .map((e) => norm(e.textContent))
    .filter((t) => t.length > 0 && t.length < 120);
  const inputs = [...document.querySelectorAll('input, textarea, select')]
    .map((e) => `${e.tagName.toLowerCase()}:${e.type || ''}:${norm(e.placeholder || e.name || e.id)}`);
  const headings = [...document.querySelectorAll('h1,h2,h3,h4')].map((e) => norm(e.textContent)).filter(Boolean);
  // «значимый» текст: абзацы/строки с содержимым (для проверки потери информации)
  const texts = [...document.querySelectorAll('p, span, div, li, td, th, label, small, strong, em')]
    .filter((e) => e.children.length === 0)
    .map((e) => norm(e.textContent))
    .filter((t) => t.length >= 3 && t.length < 160);
  return {
    buttons: uniq(btns),
    inputs: uniq(inputs),
    headings: uniq(headings),
    texts: uniq(texts),
    counts: {
      buttons: btns.length,
      inputs: inputs.length,
      headings: headings.length,
      texts: texts.length,
    },
  };
};

async function main() {
  const r = await fetch(`${BASE}/api/field/auth/pin-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: EMP, pin: PIN }),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.token) { console.error('FAIL: нет токена авторизации'); process.exit(2); }

  const list = ONLY ? SCREENS.filter(([n]) => n === ONLY) : SCREENS;
  const browser = await chromium.launch({ headless: true });
  const snapshots = {};

  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 900 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    });
    await ctx.addInitScript(({ t, th, emp }) => {
      localStorage.setItem('field_token', t);
      localStorage.setItem('field_employee', JSON.stringify(emp));
      localStorage.setItem('field_has_pin', '1');
      localStorage.setItem('field_redesign_2026_seen', '1');
      localStorage.setItem('field_auth_epoch', '6');
      localStorage.setItem('asgard_theme', th);
    }, { t: d.token, th: theme, emp: d.employee || {} });

    const page = await ctx.newPage();
    for (const [name, url, marker] of list) {
      try {
        await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        if (marker) {
          await page.waitForFunction((m) => document.body.innerText.includes(m), marker, { timeout: 12000 }).catch(() => {});
        }
        await page.waitForTimeout(1800);
        // прокрутка до низа — чтобы отрендерились лениво появляющиеся блоки
        await page.evaluate(async () => {
          const step = window.innerHeight;
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((res) => setTimeout(res, 120));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(600);
        const snap = await page.evaluate(SNAPSHOT_FN);
        snapshots[`${name}:${theme}`] = snap;
      } catch (e) {
        snapshots[`${name}:${theme}`] = { error: String(e.message).slice(0, 120) };
      }
    }
    await ctx.close();
  }
  await browser.close();

  if (MODE === 'baseline') {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ captured_at: new Date().toISOString(), base: BASE, screens: snapshots }, null, 2), 'utf8');
    console.log(`# Baseline снят: ${Object.keys(snapshots).length} снимков → ${path.relative(path.join(__dirname, '..'), OUT)}`);
    const bad = Object.entries(snapshots).filter(([, s]) => s.error || (s.texts && s.texts.length < 3));
    if (bad.length) {
      console.log(`\nВнимание, пустые/ошибочные снимки (${bad.length}):`);
      for (const [k, s] of bad) console.log(`  ${k}: ${s.error || 'текста < 3'}`);
    }
    return;
  }

  // ── CHECK: сравниваем с baseline, любая ПОТЕРЯ = FAIL ──
  if (!fs.existsSync(OUT)) { console.error('FAIL: нет baseline. Запусти с --baseline'); process.exit(2); }
  const base = JSON.parse(fs.readFileSync(OUT, 'utf8')).screens;
  const losses = [];
  for (const key of Object.keys(base)) {
    const b = base[key];
    const n = snapshots[key];
    if (!n) continue;
    if (b.error || n.error) continue;
    for (const field of ['buttons', 'inputs', 'headings', 'texts']) {
      const missing = (b[field] || []).filter((x) => !(n[field] || []).includes(x));
      if (missing.length) losses.push({ key, field, missing });
    }
  }

  if (!losses.length) {
    console.log('# No-loss: OK — ни одна кнопка/текст/поле не потеряны');
    return;
  }
  console.error(`# No-loss: FAIL — потеряно в ${losses.length} местах\n`);
  for (const l of losses.slice(0, 40)) {
    console.error(`[${l.key}] ${l.field}: −${l.missing.length}`);
    for (const m of l.missing.slice(0, 8)) console.error(`   · ${m}`);
  }
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
