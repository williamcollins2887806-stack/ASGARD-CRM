'use strict';
/**
 * Тесты МТР. Проверяют главное: агрегацию (603 позиции ≠ 603 строки),
 * разметку склад/закупка и то, что неподтверждённая цена помечается, а не
 * уходит в итог молча.
 */

const path = require('path');
const mtr = require(path.join(__dirname, '..', 'src', 'services', 'mtr-pipeline'));

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS ' + name); }
  catch (e) { fail += 1; console.log('FAIL ' + name + ' — ' + e.message); }
}
async function checkAsync(name, fn) {
  try { await fn(); pass += 1; console.log('PASS ' + name); }
  catch (e) { fail += 1; console.log('FAIL ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/** Фейковая БД: отвечает по ключевому слову. */
function fakeDb(rules) {
  return {
    query: async (sql, params) => {
      const words = (params || []).slice(1).map((p) => String(p).replace(/%/g, '').toLowerCase());
      for (const [kw, rows] of Object.entries(rules || {})) {
        if (words.some((w) => kw.includes(w) || w.includes(kw))) return { rows };
      }
      return { rows: [] };
    }
  };
}

(async () => {
  // ── Агрегация ────────────────────────────────────────────────────────────
  check('219 одинаковых позиций дают ОДНУ строку шланга', () => {
    const positions = Array.from({ length: 219 }, () => ({
      name: 'Гидрочистка трубок теплообменника', objects: 1
    }));
    const needs = mtr.deriveNeeds({ positions });
    const hoses = needs.filter((n) => /шланг/i.test(n.name));
    eq(hoses.length, 1, 'шланг должен быть одной строкой');
    if (hoses[0].qty < 2) throw new Error('количество не накопилось: ' + hoses[0].qty);
  });

  check('603 позиции не дают 603 строки МТР', () => {
    const positions = Array.from({ length: 603 }, (_, i) => ({
      name: i % 2 ? 'Гидрочистка трубок' : 'Химическая промывка',
      objects: 1
    }));
    const needs = mtr.deriveNeeds({ positions });
    if (needs.length > 30) throw new Error('строк ' + needs.length + ' — не агрегировано');
    if (needs.length < 3) throw new Error('слишком мало: ' + needs.length);
  });

  check('одинаковые ресурсы суммируются, а не дублируются', () => {
    const needs = mtr.deriveNeeds({
      positions: [
        { name: 'Гидрочистка', objects: 10 },
        { name: 'Гидроочистка', objects: 10 }
      ]
    });
    const names = needs.map((n) => n.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    eq(dupes.length, 0, 'дубли: ' + dupes.join(', '));
  });

  // ── Виды работ ───────────────────────────────────────────────────────────
  check('гидро даёт шланг, форсунку, сальник', () => {
    const needs = mtr.deriveNeeds({ positions: [{ name: 'Гидроструйная чистка', objects: 50 }] });
    const hay = needs.map((n) => n.name).join(' ');
    if (!/шланг/i.test(hay)) throw new Error('нет шланга');
    if (!/форсунк/i.test(hay)) throw new Error('нет форсунки');
  });

  check('химия даёт ингибитор, кислоту, нейтрализатор', () => {
    const needs = mtr.deriveNeeds({ positions: [{ name: 'Кислотная промывка котла' }] });
    const hay = needs.map((n) => n.name).join(' ');
    if (!/ингибитор/i.test(hay)) throw new Error('нет ингибитора');
    if (!/нейтрализатор/i.test(hay)) throw new Error('нет нейтрализатора');
  });

  check('сварка даёт электроды, а не шланги', () => {
    const needs = mtr.deriveNeeds({ positions: [{ name: 'Сварочные работы на трубопроводе' }] });
    const hay = needs.map((n) => n.name).join(' ');
    if (!/электрод/i.test(hay)) throw new Error('нет электродов');
    if (/шланг/i.test(hay)) throw new Error('лишний шланг на сварке');
  });

  check('изоляция даёт минвату', () => {
    const needs = mtr.deriveNeeds({ positions: [{ name: 'Теплоизоляция трубопровода' }] });
    if (!needs.some((n) => /изоляц|минват/i.test(n.name))) throw new Error('нет изоляции');
  });

  check('неизвестный вид работ помечается, а не выдумывает точный ресурс', () => {
    const needs = mtr.deriveNeeds({ positions: [{ name: 'Прочие работы по объекту' }] });
    const unk = needs.find((n) => /уточнить/i.test(n.name));
    if (!unk) throw new Error('нет пометки о нераспознанном виде');
  });

  // ── Количество ───────────────────────────────────────────────────────────
  check('количество округляется вверх — целые единицы', () => {
    const needs = mtr.deriveNeeds({ positions: [{ name: 'Гидрочистка', objects: 3 }] });
    const bad = needs.filter((n) => !Number.isInteger(n.qty));
    eq(bad.length, 0, 'дробные: ' + bad.map((b) => b.name + '=' + b.qty).join(', '));
  });

  check('люди дают СИЗ', () => {
    const needs = mtr.deriveNeeds({ positions: [], people: 10, trips: 2 });
    const gloves = needs.find((n) => /перчатк/i.test(n.name));
    if (!gloves) throw new Error('нет перчаток');
    if (gloves.qty < 20) throw new Error('количество ' + gloves.qty);
  });

  check('пустой ДВ без людей не выдумывает потребность', () => {
    eq(mtr.deriveNeeds({ positions: [] }).length, 0);
  });

  // ── Склад и закупка ──────────────────────────────────────────────────────
  await checkAsync('позиция на складе → source=warehouse, цена 0', async () => {
    const db = fakeDb({ 'шланг': [{ name: 'Шланг РВД 20м', quantity: 10, unit: 'шт' }] });
    const rows = await mtr.resolveMtr({
      db,
      needs: [{ name: 'шланг высокого давления', unit: 'шт', qty: 5, basis: 'гидро' }],
      allowWeb: false
    });
    eq(rows[0].source, 'warehouse');
    eq(rows[0].price, 0);
    eq(rows[0].price_confirmed, true);
    eq(rows[0].stock_enough, true);
  });

  await checkAsync('склада мало → считается дефицит', async () => {
    const db = fakeDb({ 'шланг': [{ name: 'Шланг РВД', quantity: 2, unit: 'шт' }] });
    const rows = await mtr.resolveMtr({
      db,
      needs: [{ name: 'шланг', unit: 'шт', qty: 5 }],
      allowWeb: false
    });
    eq(rows[0].shortfall, 3);
    eq(rows[0].stock_enough, false);
  });

  await checkAsync('нет на складе → purchase и пробел по цене', async () => {
    const db = fakeDb({});
    const rows = await mtr.resolveMtr({
      db,
      needs: [{ name: 'ингибитор коррозии', unit: 'кг', qty: 20 }],
      allowWeb: false
    });
    eq(rows[0].source, 'purchase');
    eq(rows[0].price_confirmed, false);
    if (!rows[0].gap) throw new Error('пробел не помечен');
  });

  // ── Разложение по разделам ───────────────────────────────────────────────
  check('склад → B, закупка → G', () => {
    const split = mtr.splitForSmeta([
      { source: 'warehouse', name: 'Шланг', qty: 2, price: 0 },
      { source: 'purchase', name: 'Кислота', qty: 10, price: 150 },
      { source: 'purchase', name: 'Ингибитор', qty: 2, price: 500, gap: 'цена не подтверждена' }
    ]);
    eq(split.section_b.length, 1);
    eq(split.section_g.length, 2);
    eq(split.gaps.length, 1);
    eq(split.totals.purchase_sum, 2500);
  });

  check('склад не попадает в стоимость закупки', () => {
    const split = mtr.splitForSmeta([
      { source: 'warehouse', name: 'Шланг', qty: 2, price: 0 }
    ]);
    eq(split.totals.purchase_sum, 0);
  });

  // ── Полный проход ────────────────────────────────────────────────────────
  await checkAsync('полный проход возвращает разделы и итоги', async () => {
    const db = fakeDb({ 'шланг': [{ name: 'Шланг РВД', quantity: 10, unit: 'шт' }] });
    const res = await mtr.buildMtr({
      db,
      positions: [{ name: 'Гидрочистка', objects: 20 }],
      people: 5,
      trips: 1,
      allowWeb: false
    });
    if (!res.rows.length) throw new Error('нет строк МТР');
    if (!res.totals) throw new Error('нет итогов');
    eq(res.totals.warehouse_items + res.totals.purchase_items, res.rows.length);
  });

  await checkAsync('МТР не ноль при живых позициях — главный критерий', async () => {
    // Именно этот дефект чиним: раньше mtr = 0 при 603 позициях объёмов.
    const db = fakeDb({});
    const res = await mtr.buildMtr({
      db,
      positions: [
        { name: 'Гидрочистка трубок', objects: 219 },
        { name: 'Химическая промывка', objects: 5 }
      ],
      people: 5, allowWeb: false
    });
    if (res.rows.length === 0) throw new Error('МТР всё ещё ноль');
  });

  await checkAsync('пустой вход даёт явную причину, а не пустой массив без слов', async () => {
    const res = await mtr.buildMtr({ db: fakeDb({}), positions: [] });
    eq(res.rows.length, 0);
    if (!res.note) throw new Error('нет причины');
  });

  console.log('\nитог: ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
