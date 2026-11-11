'use strict';
/**
 * V483b-бэкфилл: каноническое имя контрагента и добор пустых ИНН.
 *
 * РАЗРЕШЕНО заказчиком 11.11.2026.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ПРАВИЛА ТАКИЕ ОСТОРОЖНЫЕ (проверено сухим прогоном на проде):
 *
 * Первая версия меняла имя ВЕЗДЕ, где оно расходилось с карточкой. Прогон
 * показал, что это испортило бы данные:
 *
 *   1. «Обособленное подразделение ООО "Благоустройство Запсиба" в г. Архангельск»
 *      → «ООО "БЛАГОУСТРОЙСТВО ЗАПСИБА"»: теряется ПОДРАЗДЕЛЕНИЕ, а оно в
 *      документах значимо (счёт выставило подразделение, не головной офис).
 *   2. «Филиал "Астраханское УООП" ООО "Газпром питание"» → мангл с пропавшими
 *      пробелами.
 *   3. 22 документа имеют ИНН, ОТЛИЧНЫЙ от карточки (`supplier_id` привязан, но
 *      это другое юрлицо: «АэроОтель» Архангельск 2901264958 против карточки
 *      Томска 7014049295, «Удачный выбор», «Экопром»). Подставить ИНН карточки —
 *      значит соврать в платёжке.
 *
 * Поэтому бэкфилл делает ТОЛЬКО безопасное:
 *   • имя меняется, только если оно отличается ОТ КАРТОЧКИ ЛИШЬ регистром,
 *     кавычками и пробелами (79 строк на проде) — смысл не меняется;
 *   • строки с признаками подразделения («обособленное подразделение»,
 *     «филиал», «представительство») НЕ трогаются вовсе;
 *   • ИНН добирается ТОЛЬКО там, где он пуст (39 в реестре, 70 в заявках) —
 *     существующий ИНН не перезаписывается никогда.
 *
 * Чего НЕ делает: не склеивает и не удаляет строки.
 *
 * Режимы: по умолчанию СУХОЙ прогон. С --apply пишет (в транзакции).
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Запуск:
 *   node tools/backfill-supplier-name.js            # план
 *   node tools/backfill-supplier-name.js --apply    # применить
 */
const { Pool } = require('pg');
const { normOrgName } = require('../src/services/supplier-resolve');

const APPLY = process.argv.includes('--apply');
const DB = process.env.DB_NAME || 'asgard_crm';

const db = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: DB,
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
});

/**
 * Ключ «безопасного равенства»: регистр, кавычки и лишние пробелы не в счёт.
 * Если два имени равны по этому ключу — замена не меняет СМЫСЛ названия.
 */
function looseKey(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[«»"'`“”„‟‘’]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,.()])\s*/g, '$1')
    .trim();
}

/** Строки с подразделением: имя карточки их НЕ заменяет. */
const SUBDIVISION_RE = /(обособленн\w*\s+подразделен|филиал|представительств)/i;

/**
 * Совпадают ли имена по СУТИ: снимаем организационную форму (префикс и
 * суффикс), кавычки, регистр, пробелы. Пример, ради которого это нужно:
 * «Интернет Решения, ООО» и «ООО "ИНТЕРНЕТ РЕШЕНИЯ"» — один контрагент,
 * просто форма стоит с разных сторон (заказчик 11.11.2026).
 * Разные названия («Учебный Комбинат» vs «УК») НЕ сойдутся: сокращение — это
 * уже другой текст, и подменять его молча нельзя.
 */
function sameEntity(a, b) {
  return normOrgName(a) === normOrgName(b) && normOrgName(a).length >= 3;
}

(async () => {
  console.log(`БД: ${DB} | режим: ${APPLY ? 'ПРИМЕНИТЬ' : 'ПЛАН (ничего не пишем)'}\n`);

  // ─── 1. План по именам ────────────────────────────────────────────────
  const pairs = await db.query(
    `SELECT d.id, d.counterparty_name AS was, s.name AS card,
            d.counterparty_inn AS doc_inn, s.inn AS card_inn
       FROM doc_registry d
       JOIN suppliers s ON s.id = d.supplier_id
      WHERE d.deleted_at IS NULL
        AND coalesce(trim(s.name),'') <> ''
        AND coalesce(trim(d.counterparty_name),'') <> ''
        AND trim(d.counterparty_name) <> trim(s.name)`);

  const safe = [];
  const safeByForm = [];
  const skippedSubdivision = [];
  const skippedDifferentMeaning = [];

  for (const r of pairs.rows) {
    if (SUBDIVISION_RE.test(r.was)) { skippedSubdivision.push(r); continue; }
    // Тип 1: отличается только регистр/кавычки/пробелы.
    if (looseKey(r.was) === looseKey(r.card)) { safe.push(r); continue; }
    // Тип 2: отличается позиция организационной формы («Интернет Решения, ООО»).
    if (sameEntity(r.was, r.card)) { safeByForm.push(r); continue; }
    skippedDifferentMeaning.push(r);
  }

  console.log('=== ИМЕНА ===');
  console.log(`  тип 1 (регистр/кавычки/пробелы): ${safe.length}`);
  for (const r of safe.slice(0, 8)) {
    console.log(`    «${r.was}» → «${r.card}»`);
  }
  if (safe.length > 8) console.log(`    … и ещё ${safe.length - 8}`);

  console.log(`\n  тип 2 (форма ООО в другом месте): ${safeByForm.length}`);
  for (const r of safeByForm) {
    console.log(`    «${r.was}» → «${r.card}»`);
  }

  console.log(`\n  ПРОПУЩЕНО — подразделение/филиал: ${skippedSubdivision.length}`);
  for (const r of skippedSubdivision.slice(0, 5)) {
    console.log(`    «${r.was}» (карточка: «${r.card}») — НЕ меняем`);
  }

  console.log(`\n  ПРОПУЩЕНО — имя по смыслу другое: ${skippedDifferentMeaning.length}`);
  for (const r of skippedDifferentMeaning.slice(0, 6)) {
    console.log(`    «${r.was}» vs «${r.card}» — НЕ меняем`);
  }

  // ─── 2. План по ИНН ───────────────────────────────────────────────────
  const innDoc = await db.query(
    `SELECT count(*)::int AS n
       FROM doc_registry d JOIN suppliers s ON s.id = d.supplier_id
      WHERE d.deleted_at IS NULL
        AND coalesce(trim(d.counterparty_inn),'') = ''
        AND coalesce(trim(s.inn),'') <> ''`);
  const innPay = await db.query(
    `SELECT count(*)::int AS n
       FROM payment_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
      WHERE coalesce(trim(pi.counterparty_inn),'') = ''
        AND coalesce(trim(s.inn),'') <> ''`);
  // Контрольный счётчик: документы, где ИНН УЖЕ есть и отличается — их НЕ трогаем.
  const innConflict = await db.query(
    `SELECT count(*)::int AS n
       FROM doc_registry d JOIN suppliers s ON s.id = d.supplier_id
      WHERE d.deleted_at IS NULL
        AND coalesce(trim(d.counterparty_inn),'') <> ''
        AND coalesce(trim(s.inn),'') <> ''
        AND regexp_replace(d.counterparty_inn,'\\D','','g')
            <> regexp_replace(s.inn,'\\D','','g')`);

  console.log('\n=== ИНН ===');
  console.log(`  доберём в реестре: ${innDoc.rows[0].n}`);
  console.log(`  доберём в заявках: ${innPay.rows[0].n}`);
  console.log(`  НЕ трогаем (ИНН уже есть и другой — другое юрлицо): ${innConflict.rows[0].n}`);

  // План по именам в ЗАЯВКАХ — те же правила, что для реестра.
  const payPairsPlan = await db.query(
    `SELECT pi.supplier_name AS was, s.name AS card, count(*)::int AS n
       FROM payment_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
      WHERE coalesce(trim(s.name),'') <> ''
        AND coalesce(trim(pi.supplier_name),'') <> ''
        AND trim(pi.supplier_name) <> trim(s.name)
      GROUP BY 1,2 ORDER BY 3 DESC`);
  let paySafe = 0; let paySkip = 0;
  for (const r of payPairsPlan.rows) {
    if (SUBDIVISION_RE.test(r.was)) { paySkip += r.n; continue; }
    if (looseKey(r.was) === looseKey(r.card) || sameEntity(r.was, r.card)) paySafe += r.n;
    else paySkip += r.n;
  }
  console.log(`\n=== ИМЕНА В ЗАЯВКАХ ===`);
  console.log(`  безопасных к замене: ${paySafe}`);
  console.log(`  пропущено (подразделение / другое по смыслу): ${paySkip}`);

  if (!APPLY) {
    console.log('\nСухой прогон. Для применения: --apply');
    await db.end();
    return;
  }

  // ─── Применение ───────────────────────────────────────────────────────
  console.log('\n--- применение ---');
  await db.query('BEGIN');
  try {
    let namesUpdated = 0;
    for (const r of [...safe, ...safeByForm]) {
      const u = await db.query(
        `UPDATE doc_registry SET counterparty_name=$2, updated_at=NOW()
          WHERE id=$1 AND deleted_at IS NULL
            AND trim(counterparty_name) = trim($3)`,
        [r.id, String(r.card).trim(), String(r.was)]);
      namesUpdated += u.rowCount;
    }
    console.log(`имена в реестре: ${namesUpdated}`);

    const u2 = await db.query(
      `UPDATE doc_registry d SET counterparty_inn = trim(s.inn), updated_at = NOW()
         FROM suppliers s
        WHERE s.id = d.supplier_id AND d.deleted_at IS NULL
          AND coalesce(trim(d.counterparty_inn),'') = ''
          AND coalesce(trim(s.inn),'') <> ''`);
    console.log(`ИНН в реестре: ${u2.rowCount}`);

    const u3 = await db.query(
      `UPDATE payment_invoices pi SET counterparty_inn = trim(s.inn), updated_at = NOW()
         FROM suppliers s
        WHERE s.id = pi.supplier_id
          AND coalesce(trim(pi.counterparty_inn),'') = ''
          AND coalesce(trim(s.inn),'') <> ''`);
    console.log(`ИНН в заявках: ${u3.rowCount}`);

    // V483b: ИМЯ в заявке — то же правило, что для реестра (тип 1 и тип 2),
    // с теми же запретами. Без этого остаётся расхождение: в реестре
    // «ООО "ИНТЕРНЕТ РЕШЕНИЯ"», в заявке «Интернет Решения, ООО».
    const payPairs = await db.query(
      `SELECT pi.id, pi.supplier_name AS was, s.name AS card
         FROM payment_invoices pi
         JOIN suppliers s ON s.id = pi.supplier_id
        WHERE coalesce(trim(s.name),'') <> ''
          AND coalesce(trim(pi.supplier_name),'') <> ''
          AND trim(pi.supplier_name) <> trim(s.name)`);
    let payNames = 0;
    for (const r of payPairs.rows) {
      if (SUBDIVISION_RE.test(r.was)) continue;
      if (looseKey(r.was) !== looseKey(r.card) && !sameEntity(r.was, r.card)) continue;
      const u = await db.query(
        `UPDATE payment_invoices SET supplier_name=$2, updated_at=NOW()
          WHERE id=$1 AND trim(supplier_name)=trim($3)`,
        [r.id, String(r.card).trim(), String(r.was)]);
      payNames += u.rowCount;
    }
    console.log(`имя в заявках: ${payNames}`);

    await db.query('COMMIT');
    console.log('COMMIT — применено');
  } catch (e) {
    await db.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
    await db.end();
    process.exit(1);
  }

  await db.end();
})().catch((e) => { console.error('ERR', e.message); db.end(); process.exit(1); });
