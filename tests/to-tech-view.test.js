'use strict';

/**
 * Тесты: что видит ТО в карточке просчёта.
 *
 * ── Требование (09.11.2026) ────────────────────────────────────────────────
 * «В конце работы все просчёты должны быть закрыты и отправлены ТО. В них
 * ТО должен видеть бригаду, МТР и сроки работ».
 *
 * Раньше в карточке ТО были только чипы «срок · бригада · МТР» — по ним
 * нельзя ни спланировать работы, ни заказать материалы. Теперь под чипами
 * раскрываются таблицы состава бригады и перечня МТР.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'public', 'assets', 'js', 'to_calcs.js');
const src = fs.readFileSync(JS, 'utf8');

// Реальные модули в песочнице: проверяем поведение, а не текст исходника.
const { loadBrowserModule } = require('./_browser-module');
let toCalcs = null;
let rpTechPlanUi = null;
try { toCalcs = loadBrowserModule('public/assets/js/to_calcs.js', 'AsgardToCalcsPage'); } catch (_) { toCalcs = null; }
try { rpTechPlanUi = loadBrowserModule('public/assets/js/rp-tech-plan-ui.js', 'AsgardTechPlanUI'); } catch (_) { rpTechPlanUi = null; }

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('FAIL ' + name + ' — ' + e.message);
  }
}

/** Исполняет techDetailsHtml в минимальном окружении. */
function render(plan) {
  const m = /function techDetailsHtml\(plan\) \{[\s\S]*?\n  \}/.exec(src);
  assert.ok(m, 'функция techDetailsHtml не найдена');
  const esc = `
    function escHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  `;
  const factory = new Function('plan', esc + m[0] + '\nreturn techDetailsHtml(plan);');
  return factory(plan);
}

// ── 1. Проводка ────────────────────────────────────────────────────────────
check('карточка ТО вызывает techDetailsHtml', () => {
  assert.ok(/techDetailsHtml\(plan\)/.test(src), 'подробности не подключаются');
});

// ── 2. Бригада ─────────────────────────────────────────────────────────────
check('ТО видит состав бригады по ролям', () => {
  const html = render({
    crew: [
      { role: 'Слесарь', count: 4, shifts_per_day: 2 },
      { role: 'Мастер / бригадир', count: 1, shifts_per_day: 2 },
      { role: 'ИТР (РП)', count: 1, shifts_per_day: 2 }
    ],
    schedule: { work_days: 12 }
  });
  assert.ok(html.includes('Бригада'), 'нет заголовка бригады');
  assert.ok(html.includes('Слесарь'), 'нет слесарей');
  assert.ok(html.includes('Мастер'), 'нет мастера');
  assert.ok(html.includes('ИТР'), 'нет ИТР');
});

check('ТО видит число людей и человеко-смены', () => {
  const html = render({ crew: [{ role: 'Слесарь', count: 4, shifts_per_day: 2 }] });
  assert.ok(html.includes('4'), 'нет числа людей');
  assert.ok(html.includes('8'), 'нет человеко-смен (4 × 2)');
});

// ── 3. Сроки ───────────────────────────────────────────────────────────────
check('ТО видит срок работ', () => {
  const html = render({ schedule: { work_days: 12 }, crew: [] });
  assert.ok(html.includes('12'), 'нет числа суток');
  assert.ok(html.includes('сут'), 'нет единицы срока');
});

check('ТО видит дату начала и число бригад', () => {
  const html = render({ schedule: { work_days: 10, start_date: '2026-11-15', crews: 2 }, crew: [] });
  assert.ok(html.includes('2026-11-15'), 'нет даты начала');
  assert.ok(html.includes('2'), 'нет числа бригад');
});

// ── 4. МТР ─────────────────────────────────────────────────────────────────
check('ТО видит перечень МТР с количеством', () => {
  const html = render({
    mtr: [
      { name: 'Ингибитор коррозии', qty: 25, unit: 'кг', note: 'для промывки' },
      { name: 'Ветошь', qty: 10, unit: 'кг' }
    ],
    crew: []
  });
  assert.ok(html.includes('Ингибитор коррозии'), 'нет материала');
  assert.ok(html.includes('25'), 'нет количества');
  assert.ok(html.includes('для промывки'), 'нет назначения');
});

check('ТО видит, если материалы не указаны', () => {
  const html = render({ crew: [], mtr: [] });
  // Пустой техплан без сроков — блок не нужен вовсе.
  assert.strictEqual(html, '', 'пустой план не должен рисовать таблицы');
});

check('много МТР — показываются первые 12 и счётчик остальных', () => {
  const mtr = [];
  for (let k = 1; k <= 20; k += 1) mtr.push({ name: 'Материал ' + k, qty: k, unit: 'кг' });
  const html = render({ mtr, crew: [] });
  assert.ok(html.includes('и ещё 8'), 'нет счётчика остальных');
});

// ── 5. Экранирование ───────────────────────────────────────────────────────
check('значения экранируются', () => {
  const html = render({
    crew: [{ role: '<script>alert(1)</script>', count: 1 }]
  });
  assert.ok(!html.includes('<script>alert'), 'не экранировано');
});

  check('пустой tech_json не скрывает данные сметы', () => {
    // На проде tech_json = {} у ВСЕХ карточек. `{}` истинно в JS, поэтому
    // readPlan уходил в ветку техплана и возвращал пустоту — вкладка ТО
    // выглядела пустой при заполненной смете (верификатор 09.11.2026).
    const plan = rpTechPlanUi.readPlan({
      tech_json: {},
      asgard_smeta: {
        crew: [{ role: 'Слесарь', count: 4, shifts_per_day: 2 }],
        mtr: [{ name: 'Реагент', qty: 10, unit: 'л' }],
        schedule: { work_days: 7 },
        params: { work_days: 7 }
      }
    }, {
      crew: [{ role: 'Слесарь', count: 4, shifts_per_day: 2 }],
      mtr: [{ name: 'Реагент', qty: 10, unit: 'л' }],
      schedule: { work_days: 7 },
      params: { work_days: 7 },
      totals: { man_hours: 480 }
    });
    assert.ok(Array.isArray(plan.crew) && plan.crew.length > 0, 'бригада потеряна при пустом tech_json');
    assert.ok(Array.isArray(plan.mtr) && plan.mtr.length > 0, 'МТР потерян при пустом tech_json');
  });

  /** Тело функции techDetailsHtml (до следующей функции верхнего уровня). */
  function techDetailsBody() {
    const s = fs.readFileSync(JS, 'utf8');
    const start = s.indexOf('function techDetailsHtml');
    const end = s.indexOf('\n  function ', start + 10);
    return s.slice(start, end > 0 ? end : start + 4000);
  }

  check('дата начала читается как start_plan', () => {
    // Канон сервера — start_plan (asgard-smeta.js:168, rp-tech-plan.js:77).
    // Раньше карточка ТО читала только start_date и дату начала не показывала
    // никогда.
    const body = techDetailsBody();
    assert.ok(/sch\.start_plan/.test(body),
      'techDetailsHtml не читает start_plan — дата начала снова пропадёт');
  });

  check('дата начала экранируется (нет сырого тега)', () => {
    const body = techDetailsBody();
    assert.ok(/escHtml\(\s*String\(start\)/.test(body),
      'значение даты начала не экранируется — сырой тег пройдёт в HTML');
  });

  const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
