'use strict';

/**
 * D-322: исправить последствия первого прохода.
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. Заявка #17 привязалась к карточке #41 «ООО "БЕЗОПАСНОСТЬ ТРУДА"»
 *    с ИНН 1651037757, хотя в счёте ИНН 3017052355 — ДРУГОЕ юрлицо с тем же
 *    названием. Это опаснее пустого supplier_id: в платёжку ушли бы чужие
 *    реквизиты. Отвязываем и заводим правильную карточку.
 * 2. Карточка #461 «Распознаётся…» — мусор от старого потока (создавалась из
 *    заглушки). Помечаем удалённой (soft), чтобы не попадала в подсказки.
 * 3. Карточка #462 «Общество с ограниченной ответственностью "Безопасность
 *    Труда"» без ИНН — дубль-пустышка той же организации. Помечаем удалённой,
 *    реквизиты переносим в правильную карточку.
 *
 * Запуск: node tools/fix_suppliers_d322.js [--apply]
 */

const path = process.cwd();
require(path + '/node_modules/dotenv').config({ path: path + '/.env' });
const { Client } = require(path + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;

  console.log('=== 1. #17: проверка привязки ===');
  const p17 = (await q(`SELECT p.id, p.supplier_id, p.supplier_name, s.inn s_inn, s.name s_name
      FROM payment_invoices p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=17`))[0];
  console.log(`  заявка #17 → карточка #${p17.supplier_id} «${p17.s_name}» ИНН=${p17.s_inn || '-'}`);
  const WRONG = p17.s_inn && String(p17.s_inn) !== '3017052355';
  if (WRONG) {
    console.log('  ОШИБКА: ИНН карточки не совпадает со счётом (3017052355) — чужая организация');
    if (APPLY) {
      await c.query(`UPDATE payment_invoices SET supplier_id=NULL, updated_at=NOW() WHERE id=17`);
      console.log('  отвязано');
    }
  } else {
    console.log('  привязка корректна');
  }

  console.log('\n=== 2. мусорные карточки поставщиков ===');
  for (const r of await q(`SELECT id, name, inn FROM suppliers
      WHERE deleted_at IS NULL AND (name ILIKE '%Распознаётся%' OR (inn IS NULL AND name ILIKE '%Безопасность Труда%'))
      ORDER BY id`)) {
    const used = await q(`SELECT count(*)::int n FROM payment_invoices WHERE supplier_id=$1`, [r.id]);
    console.log(`  #${r.id} «${r.name}» ИНН=${r.inn || '-'} — заявок: ${used[0].n}`);
    if (APPLY && used[0].n === 0) {
      await c.query(`UPDATE suppliers SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [r.id]);
      console.log('     → помечена удалённой');
    }
  }

  console.log('\n=== 3. карточка «Безопасность Труда» с верным ИНН ===');
  const good = await q(`SELECT id, name, inn, bik, rs FROM suppliers
      WHERE deleted_at IS NULL AND regexp_replace(coalesce(inn,''),'\\D','','g')='3017052355'`);
  console.log('  найдено:', good.length, good.length ? JSON.stringify(good[0]) : '— не заведена');

  if (!APPLY) console.log('\n(dry-run) запустите с --apply');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
