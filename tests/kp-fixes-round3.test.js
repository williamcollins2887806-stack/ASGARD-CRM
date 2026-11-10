'use strict';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'x';
const assert = require('assert');
const AdmZip = require('adm-zip');
const full = require('../src/services/tkp-full-kp');
const quick = require('../src/services/mimir-tkp-quick');
const smeta = require('../src/services/asgard-smeta');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ ok: false }); console.log('FAIL ' + name + ' — ' + e.message); }
}

// ── 1. Итоги короткого КП ───────────────────────────────────────────────────
const SHORT = {
  id: 1, kp_variant: 'classic', customer_name: 'ООО Тест', total_sum: 1000000,
  created_at: new Date().toISOString(),
  items: JSON.stringify({
    items: [
      { name: 'Гидроструйная чистка', unit: 'м²', qty: 1000, price: 800, total: 800000 },
      { name: 'Хим. промывка', unit: 'компл', qty: 1, price: 200000, total: 200000 }
    ],
    vat_pct: 22, subtotal: 1000000
  })
};
const CO = { name: 'ООО «АСГАРД-Сервис»', director_name: 'Кудряшов Олег Сергеевич' };

function textOf(buf) {
  const z = new AdmZip(buf);
  return z.readAsText('word/document.xml').replace(/<[^>]+>/g, ' ');
}

check('короткое КП печатает реальные итоги, а не нули', () => {
  const t = textOf(full.generateFullKpDocxBuffer(SHORT, CO, { variant: 'classic' }));
  assert.ok(!/0,00\s*руб/.test(t) || !/ИТОГО БЕЗ НДС\s*0,00/.test(t), 'в документе нулевые итоги');
  // 1 000 000 без НДС, 220 000 НДС, 1 220 000 с НДС
  assert.ok(/1\s?000\s?000/.test(t), 'нет суммы без НДС 1 000 000: ' + t.slice(0, 300));
  assert.ok(/1\s?220\s?000/.test(t), 'нет суммы с НДС 1 220 000');
});

check('calcTotals понимает items.payload', () => {
  const r = full.calcTotals({}, 22, {
    items: [{ qty: 2, price: 500, total: 1000 }], subtotal: 1000
  });
  assert.strictEqual(r.subtotal, 1000, 'subtotal=' + r.subtotal);
  assert.strictEqual(r.vatSum, 220, 'vat=' + r.vatSum);
  assert.strictEqual(r.total, 1220, 'total=' + r.total);
});

check('calcTotals не ломает полное КП (apparatus приоритетнее)', () => {
  const r = full.calcTotals({ apparatus: [{ amount_no_vat: 5000 }] }, 22, {
    items: [{ qty: 1, price: 999999, total: 999999 }]
  });
  assert.strictEqual(r.subtotal, 5000, 'apparatus должен быть приоритетным: ' + r.subtotal);
});

// ── 2. PDF уважает variant ─────────────────────────────────────────────────
check('PDF получает variant (иначе Word ≠ PDF)', () => {
  const src = require('fs').readFileSync('src/services/tkp-full-kp.js', 'utf8');
  const pdfFn = src.slice(src.indexOf('async function generateFullKpPdfBuffer'));
  const head = pdfFn.slice(0, 1200);
  assert.ok(/variant:\s*opts\.variant === 'classic' \? 'classic' : 'full'/.test(head),
    'generateFullKpPdfBuffer не пробрасывает variant в DOCX');
});

// ── 3. ИТР не удваивается на пути из анализа ────────────────────────────────
check('ИТР = 1 смена даже при режиме объекта 2 смены', () => {
  const est = smeta.recalcAsgardSmeta({
    params: { work_days: 10, shifts_per_day: 2, shift_hours: 12 },
    crew: [
      { code: 'itr', role: 'ИТР (РП)', count: 1, shifts_per_day: 1, shifts_locked: true },
      { code: 'worker', role: 'Слесарь', count: 4 }
    ]
  });
  const a1 = est.rows.find((r) => r.code === 'A1');
  const a3 = est.rows.find((r) => r.code === 'A3');
  assert.strictEqual(a1.qty, 10, 'ИТР задвоен: ' + a1.qty + ' (ожидание 10 = 1×10×1)');
  assert.strictEqual(a3.qty, 80, 'рабочий: ' + a3.qty + ' (ожидание 80 = 4×10×2)');
  // 10×1×12 + 4×10×2×12 = 120 + 960 = 1080
  assert.strictEqual(est.totals.man_hours, 1080, 'man_hours=' + est.totals.man_hours);
});

// ── 4. Роли не утекают ─────────────────────────────────────────────────────
check('все роли бригады фильтруются, включая Водителя', () => {
  const roles = ['ИТР', 'Мастер / бригадир', 'Рабочий', 'Слесарь', 'Наблюдающий',
    'Химик', 'ПТО / приёмка', 'Сварщик', 'Монтажник', 'Изолировщик',
    'Водитель', 'Машинист', 'Стропальщик'];
  const items = roles.map((n) => ({ name: n, qty: 10, price: 10000, total: 100000, section: 'A' }));
  items.push({ name: 'Гидроструйная чистка АВО', qty: 1000, price: 800, total: 800000, unit: 'м²' });
  const out = quick.buildClientItems({
    items,
    totals: { price_no_vat: 5000000, markup_multiplier: 1.75 }
  });
  const leaked = out.filter((x) => roles.some((r) => String(x.name).toLowerCase() === r.toLowerCase()));
  assert.deepStrictEqual(leaked.map((x) => x.name), [], 'утекли роли: ' + leaked.map((x) => x.name).join(', '));
  const sum = out.reduce((s, i) => s + (Number(i.total) || 0), 0);
  assert.ok(Math.abs(sum - 5000000) < 2, 'Σ строк ≠ цене КП: ' + sum);
});

check('фильтр по секции A ловит роль с любым названием', () => {
  const out = quick.buildClientItems({
    items: [
      { name: 'Слесарь-обходчик 6 разряда', qty: 10, price: 9000, total: 90000, section: 'A' },
      { name: 'Работа по ТЗ', qty: 1, price: 100, total: 100, section: 'E' }
    ],
    totals: { price_no_vat: 1000, markup_multiplier: 1 }
  });
  const bad = out.filter((x) => /Слесарь-обходчик/.test(String(x.name)));
  assert.deepStrictEqual(bad, [], 'роль из секции A утекла');
});

const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
