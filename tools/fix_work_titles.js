'use strict';

/**
 * D-332: почистить мусорные названия работ, созданные ТОР-парсером.
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик 21.10.2026: «откуда ты эти работы взял? почему пропал нормальный
 * список работ?»
 *
 * В списке выбора было «краснодар», «Работа #1940», а у одной работы название
 * целиком из служебных строк:
 *   «Сроки работ: 2026-10-16 — 2026-10-18\n\nОбъём: 0.03 м³\n\nПасивация маслопровода»
 * Суть работы — в ПОСЛЕДНЕЙ содержательной строке. Такие названия портят и
 * списки, и отчёты, и поиск.
 *
 * Запуск: node tools/fix_work_titles.js [--apply]
 */

const path = process.cwd();
require(path + '/node_modules/dotenv').config({ path: path + '/.env' });
const { Client } = require(path + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');

/** Служебные строки, которые не являются названием работы. */
const SERVICE_LINE = /^(сроки работ|объём|объем|стоимость|итого|сумма|дата|период|место|адрес)\s*[:\-]/i;

function cleanTitle(raw) {
  const s = String(raw || '');
  if (!s) return '';
  // Разбиваем по пустым строкам и по одиночным переводам — парсер мешал оба.
  const parts = s.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const meaningful = parts.filter((x) => !SERVICE_LINE.test(x));
  const pick = meaningful.length ? meaningful[meaningful.length - 1] : '';
  return pick.replace(/\s+/g, ' ').trim();
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();

  const rows = (await c.query(`SELECT id, work_title, object_name FROM works WHERE deleted_at IS NULL`)).rows;
  console.log('всего работ:', rows.length);

  const broken = [];
  for (const w of rows) {
    const raw = String(w.work_title || '');
    const hasNl = /\n/.test(raw);
    const hasService = raw.split(/\n+/).some((l) => SERVICE_LINE.test(l.trim()));
    const tooLong = raw.length > 200;
    if (hasNl || hasService || tooLong) {
      broken.push({ ...w, cleaned: cleanTitle(raw) });
    }
  }

  console.log('работ с мусорным названием:', broken.length);
  for (const b of broken) {
    console.log(`\n #${b.id}`);
    console.log(`   было:   ${JSON.stringify(String(b.work_title).slice(0, 120))}`);
    console.log(`   станет: ${JSON.stringify(b.cleaned.slice(0, 120))}`);
    if (b.object_name) console.log(`   object_name: ${JSON.stringify(b.object_name)}`);
  }

  // Отдельно: object_name как город в нижнем регистре — не трогаем (это гео),
  // но фиксируем для внимания.
  const cities = rows.filter((w) => {
    const o = String(w.object_name || '').trim();
    return o && o.length < 12 && o === o.toLowerCase();
  });
  if (cities.length) {
    console.log('\nobject_name выглядит как город (не меняем, это гео-подсказка):');
    for (const w of cities) console.log(` #${w.id} object_name=${JSON.stringify(w.object_name)} | ${String(w.work_title).slice(0, 50)}`);
  }

  if (APPLY && broken.length) {
    console.log('\n=== ПРИМЕНЯЮ ===');
    for (const b of broken) {
      if (!b.cleaned) {
        console.log(` #${b.id}: после чистки пусто — пропуск`);
        continue;
      }
      await c.query('UPDATE works SET work_title = $2, updated_at = NOW() WHERE id = $1', [b.id, b.cleaned]);
      console.log(` #${b.id} → ${JSON.stringify(b.cleaned.slice(0, 80))}`);
    }
  } else if (broken.length) {
    console.log('\n(dry-run) запустите с --apply');
  }

  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
