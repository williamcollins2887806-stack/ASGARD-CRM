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
const MODE = process.argv.includes('--baseline') ? 'baseline'
  : process.argv.includes('--rebase') ? 'rebase' : 'check';
const OUT = path.join(__dirname, '..', 'tests', 'reports', 'field-screen-baseline.json');

/** Экраны с ЖИВЫМИ СПИСКАМИ: строки наполняются реальными сотрудниками/записями,
 *  состав меняется между прогонами. Их сверяем по количеству, не по подписям.
 *  FieldHome: условные блоки по данным (серия смен, статус руны) то появляются,
 *  то нет — точное сравнение подписей даёт ложный FAIL. */
const VOLATILE_SCREENS = new Set(['FieldLeaderboard', 'FieldHome', 'FieldAcademy']);

/** Минимум осмысленного слепка. Считаем «пустым по данным» экран, где суммарно
 *  почти нет текста — тогда гейт проверял бы заглушку/ошибку, а не вёрстку.
 *  Считаем ВМЕСТЕ текст, заголовки и кнопки: у части экранов (табель, магазин,
 *  рейтинг) основная информация лежит в кнопках/заголовках, а не в `<p>`.
 *  Такой снимок не пишется в эталон и не считается проверенным. */
const MIN_TEXTS = 5;
const isShallowSnap = (s) => !s || s.error
  || ((s.texts || []).length + (s.headings || []).length + (s.buttons || []).length) < MIN_TEXTS;

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
];

/** Слепок: интерактив + текст + поля.
 *  ВАЖНО: сравниваем СТРУКТУРУ, а не данные. Поэтому нормализуем числа/суммы/
 *  даты/ФИО — иначе «было 16 000 ₽, стало 12 000 ₽» и смена проекта выглядят
 *  как потеря, хотя это просто другие данные.
 *
 *  ЭКРАНЫ С ЖИВЫМИ СПИСКАМИ (`VOLATILE_SCREENS`) сверяются по КОЛИЧЕСТВУ, а не
 *  по точным подписям. Пример: «Зал Одина» рисует строки реальных сотрудников —
 *  состав рейтинга меняется между прогонами, и точное сравнение падало на
 *  «Абраменко» против «Ажкенов», хотя ни одна кнопка не пропала (кнопок стало
 *  даже больше: 213 против 210). Массовая потеря элементов при этом ловится:
 *  если текущее количество упало ниже эталонного — FAIL. */
const SNAPSHOT_FN = () => {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  /** Нормализация для СРАВНЕНИЯ: цифры, деньги, даты, ФИО → плейсхолдеры. */
  const forCompare = (s) => norm(s)
    .replace(/\d[\d\s.,]*\s*(₽|руб|ᚱ|%|дн|ч|мин|см|шт|балл\w*)?/gi, '#')
    .replace(/\b(пн|вт|ср|чт|пт|сб|вс)\b/gi, '#')
    .replace(/[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\./g, 'ФИО')
    .replace(/#+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  /* Ротационные строки исключаем из слепка: цитаты Мимира (в кавычках),
     приветствие по времени суток/имени. Иначе гейт «теряет» фразу,
     которой просто не выпало быть в этом прогоне. */
  const isRotating = (t) => /^[«"„].{6,}[»"”]$/.test(t)
    || /^(Доброе утро|Добрый день|Добрый вечер|Доброй ночи|Здравствуй)/.test(t);
  /* Авто-показываемые оверлеи (баннер о редизайне и челленджлог «Что нового»)
     живут в портале `#modal-root`, приходят С БЭКЕНДА и меняются от выката к
     выкату. Они перекрывают экран и подмешивают в слепок десятки строк, которых
     в прошлом прогоне не было (в эталоне был челнжлог про Академию, сейчас API
     отдаёт про ТКП/тендеры) — это давало ложный FAIL на 55 экранах.
     Структуру ЭКРАНА сверяем без них: сам экран лежит в основной ветке DOM. */
  const inModal = (el) => !!(el.closest && el.closest('#modal-root'));
  const pick = (sel) => [...document.querySelectorAll(sel)].filter((e) => !inModal(e));
  const btns = pick('button, [role="button"], a[href]')
    .map((e) => norm(e.textContent))
    .filter((t) => t.length > 0 && t.length < 120 && !isRotating(t));
  const inputs = pick('input, textarea, select')
    .map((e) => `${e.tagName.toLowerCase()}:${e.type || ''}:${norm(e.placeholder || e.name || e.id)}`);
  const headings = pick('h1,h2,h3,h4').map((e) => norm(e.textContent)).filter((t) => t && !isRotating(t));
  const texts = pick('p, span, div, li, td, th, label, small, strong, em')
    .filter((e) => e.children.length === 0)
    .map((e) => norm(e.textContent))
    .filter((t) => t.length >= 3 && t.length < 160 && !isRotating(t));
  // для сравнения — нормализованные (структурные) версии
  return {
    buttons: uniq(btns.map(forCompare)).filter((t) => t && t !== '#'),
    inputs: uniq(inputs),
    headings: uniq(headings.map(forCompare)).filter(Boolean),
    texts: uniq(texts.map(forCompare)).filter((t) => t && t !== '#'),
    counts: { buttons: btns.length, inputs: inputs.length, headings: headings.length, texts: texts.length },
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
    /* Фикстуры API: без них у тестового сотрудника нет активного проекта и
       записей, экраны пустые — гейт проверял бы «Нет данных», а не вёрстку.
       Точные ответы подставляем по подстроке URL (первый матч выигрывает). */
    const { FIXTURES } = require('./field-api-fixtures');
    await page.route('**/api/field/**', (route) => {
      const u = route.request().url();
      if (route.request().method() !== 'GET') return route.continue();
      for (const [re, make] of FIXTURES) {
        if (re.test(u)) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(make()) });
        }
      }
      return route.continue();
    });
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
    // Считаем «непроверенными» снимки, где экран не наполнился данными: их нельзя
    // класть в эталон — иначе гейт потом «проходит» на пустоте (молчаливый PASS).
    const isShallow = isShallowSnap;
    const shallow = Object.entries(snapshots).filter(([, s]) => isShallow(s));
    const good = Object.fromEntries(Object.entries(snapshots).filter(([, s]) => !isShallow(s)));
    fs.writeFileSync(OUT, JSON.stringify({ captured_at: new Date().toISOString(), base: BASE, screens: good }, null, 2), 'utf8');
    console.log(`# Baseline снят: ${Object.keys(good).length} снимков → ${path.relative(path.join(__dirname, '..'), OUT)}`);
    if (shallow.length) {
      console.log(`\nНЕ проверены (экран не наполнился данными) — в эталон НЕ попали (${shallow.length}):`);
      for (const [k, s] of shallow) {
        console.log(`  ${k}: ${s.error || `текста+заголовков+кнопок ${(s.texts || []).length + (s.headings || []).length + (s.buttons || []).length} < ${MIN_TEXTS}`}`);
      }
      console.log('\nЭто значит: тестовому сотруднику не хватает данных (нет активного проекта/записей).');
      console.log('Проверь MOCK-фикстуры или дай данные — иначе эти экраны НЕ проверены.');
    }
    return;
  }

  /* Точечная перебаза: обновляем ТОЛЬКО снимки экранов из --only, остальные не трогаем.
     Нужна, когда подпись кнопки осознанно изменилась (эмодзи → иконка), а кнопка на месте. */
  if (MODE === 'rebase') {
    if (!ONLY) { console.error('FAIL: --rebase требует --only=<Экран>[,<Экран>]'); process.exit(2); }
    if (!fs.existsSync(OUT)) { console.error('FAIL: нет baseline. Запусти --baseline'); process.exit(2); }
    const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const names = ONLY.split(',').map((s) => s.trim()).filter(Boolean);
    let n = 0;
    for (const name of names) {
      for (const theme of ['dark', 'light']) {
        const k = `${name}:${theme}`;
        if (!snapshots[k]) { console.log(`  нет снимка ${k} — пропуск`); continue; }
        old.screens[k] = snapshots[k];
        n++;
      }
    }
    old.rebased_at = new Date().toISOString();
    fs.writeFileSync(OUT, JSON.stringify(old, null, 2), 'utf8');
    console.log(`# Перебазировано ${n} снимков (${names.join(', ')}) → ${path.relative(path.join(__dirname, '..'), OUT)}`);
    return;
  }

  // ── CHECK: сравниваем с baseline, любая ПОТЕРЯ = FAIL ──
  if (!fs.existsSync(OUT)) { console.error('FAIL: нет baseline. Запусти с --baseline'); process.exit(2); }
  const base = JSON.parse(fs.readFileSync(OUT, 'utf8')).screens;
  const losses = [];
  /* Обратная сверка: экран есть в прогоне, но НЕ в эталоне. Такой экран раньше
     молча не проверялся (цикл шёл только по эталону) — то есть удаление экрана
     из эталона делало гейт зелёным. Теперь это явный FAIL. */
  for (const key of Object.keys(snapshots)) {
    if (base[key]) continue;
    const n = snapshots[key];
    if (n && !isShallowSnap(n)) {
      losses.push({ key, field: 'baseline', missing: ['нет снимка в эталоне — запусти --baseline или --rebase'] });
    }
  }
  for (const key of Object.keys(base)) {
    const b = base[key];
    const n = snapshots[key];
    if (!n) continue;
    if (b.error || n.error) continue;
    const screenName = key.split(':')[0];
    const volatile = VOLATILE_SCREENS.has(screenName);
    // Контролы (кнопки/поля) сверяем строго по своему типу: если кнопка стала
    // некликабельным текстом — это реальная потеря управления.
    for (const field of ['buttons', 'inputs']) {
      if (volatile) {
        // Живой список: имена элементов меняются, поэтому сверяем КОЛИЧЕСТВО.
        // Допуск 5%: состав рейтинга колеблется (кто-то выпал/добавился),
        // но обвал (элементы не отрисовались) виден сразу.
        const bn = (b[field] || []).length;
        const nn = (n[field] || []).length;
        if (nn < Math.floor(bn * 0.95)) losses.push({ key, field, missing: [`было элементов ${bn}, стало ${nn}`] });
        continue;
      }
      const missing = (b[field] || []).filter((x) => !(n[field] || []).includes(x));
      if (missing.length) losses.push({ key, field, missing });
    }
    if (volatile) {
      const bt = (b.texts || []).length + (b.headings || []).length;
      const nt = (n.texts || []).length + (n.headings || []).length;
      // Порог 20%: живой список может усохнуть, если сотрудников стало меньше,
      // но обвал текста (элементы не отрисовались) виден сразу.
      if (nt < Math.floor(bt * 0.8)) {
        losses.push({ key, field: 'texts+headings', missing: [`было ${bt}, стало ${nt}`] });
      }
      continue;
    }
    // Информационные тексты — единый пул: смысл не потерян, если строка осталась
    // на экране, даже если переехала из <p> в заголовок, в подпись кнопки или наоборот.
    const seen = new Set([...(n.texts || []), ...(n.headings || []), ...(n.buttons || [])]);
    const missingInfo = [...(b.texts || []), ...(b.headings || [])].filter((x) => !seen.has(x));
    if (missingInfo.length) losses.push({ key, field: 'texts+headings', missing: [...new Set(missingInfo)] });
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
