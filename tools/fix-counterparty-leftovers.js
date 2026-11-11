'use strict';
/**
 * V483c: точечный разбор остатков после основного бэкфилла.
 *
 * РАЗРЕШЕНО заказчиком 11.11.2026 (выбраны все пять действий).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * КОНТЕКСТ. Основной бэкфилл (tools/backfill-supplier-name.js) привёл имена к
 * карточке там, где это безопасно, и намеренно пропустил 12 строк. Разбор
 * показал, что из 12 только 4 пропущены правильно, а 8 — перестраховка:
 * у них ИНН документа СОВПАДАЕТ с ИНН карточки, спорить не о чем.
 *
 * Что делает этот инструмент (каждый пункт — отдельная команда):
 *
 *   1. names8    — 8 имён, где ИНН совпал (ПРАБО, Магистр, ОССП, ЭТП ГПБ,
 *                  РЖД-Медицина Махачкала, Воропаева). Правило: меняем ТОЛЬКО
 *                  если ИНН документа == ИНН карточки и оба непустые, ЛИБО
 *                  оба пустые (тогда сравнение по нормализованному имени).
 *   2. link5     — привязать документы без supplier_id, где ИНН документа
 *                  однозначно указывает на ОДНУ карточку.
 *   3. inn_fill  — заполнить ИНН в карточках, где он пуст, взяв из документов
 *                  (донорство: сам документ уже привязан к этой карточке).
 *   4. dupes     — показать (не удалять!) дубли карточек с 0 документов.
 *   5. ofismag   — показать Офисмаг/ППР с раскладкой документов (решает человек).
 *
 * НИЧЕГО НЕ УДАЛЯЕТ И НЕ СЛИВАЕТ. Слияние карточек — отдельное решение: за ним
 * стоят платёжки и история. Здесь только имена, привязки и пустые поля.
 *
 * Режим: по умолчанию СУХОЙ прогон. С --apply пишет (в транзакции).
 *
 * Запуск:
 *   node tools/fix-counterparty-leftovers.js             # план
 *   node tools/fix-counterparty-leftovers.js --apply     # применить
 *   node tools/fix-counterparty-leftovers.js dupes       # только показать дубли
 */
const { Pool } = require('pg');
const { normOrgName } = require('../src/services/supplier-resolve');

const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.find((a) => ['names8', 'link5', 'inn_fill', 'dupes', 'ofismag'].includes(a));

const db = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
});

/**
 * Признаки подразделения: имя карточки их НЕ заменяет.
 *
 * ДВА дефекта этой защиты, найденных 11.11.2026:
 *
 * 1. `\w` в JS — только латиница и цифры, кириллицу он НЕ покрывает.
 *    `обособленн\w*` не ловил «Обособленное подразделение»: защита была
 *    фиктивной. Нужен явный класс [а-яё].
 *
 * 2. Слова искались только в НАЗВАНИИ, а филиал Газпрома в счетах называется
 *    «АСТРАХАНСКОЕ УПРАВЛЕНИЕ ПО ОРГАНИЗАЦИИ ОБЩЕСТВЕННОГО ПИТАНИЯ» — без
 *    «филиала». Из-за этого документ 163 переименовали в «ООО "ГАЗПРОМ
 *    ПИТАНИЕ"», и стало непонятно, ЧЬЁ это управление. Заказчик поймал верно.
 *    Поэтому добавлены структурные слова: управление, департамент, отделение,
 *    участок, цех, магазин, пункт.
 *
 * Плюс отдельная проверка в коде: если у документа seller_name содержит признак
 * подразделения — имя тоже не трогаем (там истина из самого счёта).
 */
const SUBDIVISION_RE = new RegExp(
  // «обособленное подразделение» в любом падеже и с любыми пробелами:
  // [а-яё]* вместо \w* (кириллица), [^а-яё]* вместо \s+ (пробелы и кавычки).
  '(обособленн[а-яё]*[^а-яё]+подразделен'
  + '|филиал|представительств'
  + '|управлени[ея]|департамент|отделени[ея]|участок|цех|магазин|пункт)',
  'i'
);

/**
 * Магистр: карточка с ИНН 9728132048 — это ООО «УК "МАГИСТР"» (управляющая
 * компания). «Учебный Комбинат "Магистр"» — другое юрлицо, внесённое под чужой
 * ИНН. Переименовывать его в УК нельзя: совпадение ИНН здесь ложное.
 */
const POISONED_INN = new Set(['9728132048']);

(async () => {
  const log = (...a) => console.log(...a);

  // ─── 1. Восемь имён, где я перестраховался ─────────────────────────────
  let names8 = [];
  if (!ONLY || ONLY === 'names8') {
    const rows = await db.query(
      `SELECT d.id, d.counterparty_name AS was, s.name AS card,
              regexp_replace(coalesce(d.counterparty_inn,''),'\\D','','g') AS inn_doc,
              regexp_replace(coalesce(s.inn,''),'\\D','','g') AS inn_card,
              d.supplier_id
         FROM doc_registry d
         JOIN suppliers s ON s.id = d.supplier_id
        WHERE d.deleted_at IS NULL
          AND coalesce(trim(s.name),'') <> ''
          AND coalesce(trim(d.counterparty_name),'') <> ''
          AND trim(d.counterparty_name) <> trim(s.name)`);

    for (const r of rows.rows) {
      if (SUBDIVISION_RE.test(r.was)) continue;            // подразделение — в реестре нужно
      if (POISONED_INN.has(r.inn_card)) continue;          // Магистр — ложный ИНН
      const bothInn = r.inn_doc && r.inn_card;
      const sameInn = bothInn && r.inn_doc === r.inn_card;
      const bothEmpty = !r.inn_doc && !r.inn_card && normOrgName(r.was) === normOrgName(r.card);
      if (sameInn || bothEmpty) names8.push(r);
    }

    log('=== 1. ИМЕНА (ИНН совпал — перестраховка была лишней) ===');
    for (const r of names8) {
      log(`  «${r.was}» → «${r.card}»  [ИНН ${r.inn_doc || '—'}]`);
    }
    log(`  всего: ${names8.length}\n`);
  }

  // ─── 2. Документы без карточки, где ИНН однозначен ─────────────────────
  let link5 = [];
  if (!ONLY || ONLY === 'link5') {
    const rows = await db.query(
      `SELECT d.id, d.counterparty_name, d.counterparty_inn,
              array_agg(s.id) AS card_ids, array_agg(s.name) AS card_names
         FROM doc_registry d
         JOIN suppliers s
           ON s.deleted_at IS NULL
          AND regexp_replace(coalesce(s.inn,''),'\\D','','g')
            = regexp_replace(coalesce(d.counterparty_inn,''),'\\D','','g')
        WHERE d.deleted_at IS NULL AND d.dir='in' AND d.supplier_id IS NULL
          AND coalesce(trim(d.counterparty_inn),'') <> ''
          AND coalesce(trim(s.inn),'') <> ''
        GROUP BY d.id, d.counterparty_name, d.counterparty_inn`);
    // Только однозначные: одна карточка на этот ИНН.
    link5 = rows.rows.filter((r) => new Set(r.card_ids).size === 1);
    const ambiguous = rows.rows.filter((r) => new Set(r.card_ids).size > 1);

    log('=== 2. ДОКУМЕНТЫ БЕЗ КАРТОЧКИ (ИНН однозначен) ===');
    for (const r of link5) {
      log(`  #${r.id} «${r.counterparty_name}» (ИНН ${r.counterparty_inn}) → карточка ${r.card_ids[0]} «${r.card_names[0]}»`);
    }
    log(`  всего: ${link5.length}`);
    if (ambiguous.length) {
      log(`  НЕ трогаем (ИНН ведёт на несколько карточек): ${ambiguous.length}`);
      for (const r of ambiguous.slice(0, 5)) log(`    #${r.id} «${r.counterparty_name}»`);
    }
    log('');
  }

  // ─── 3. ИНН в карточках, где он пуст (донорство из документов) ─────────
  let innFill = [];
  if (!ONLY || ONLY === 'inn_fill') {
    const rows = await db.query(
      `SELECT s.id AS card_id, s.name AS card_name,
              min(regexp_replace(d.counterparty_inn,'\\D','','g')) AS inn,
              count(*)::int AS docs,
              count(DISTINCT regexp_replace(d.counterparty_inn,'\\D','','g')) AS inn_variants
         FROM suppliers s
         JOIN doc_registry d ON d.supplier_id = s.id AND d.deleted_at IS NULL
        WHERE s.deleted_at IS NULL
          AND coalesce(trim(s.inn),'') = ''
          AND coalesce(trim(d.counterparty_inn),'') <> ''
        GROUP BY s.id, s.name`);
    // Только если все документы карточки дают ОДИН ИНН — иначе не знаем, какой верный.
    innFill = rows.rows.filter((r) => Number(r.inn_variants) === 1 && r.inn
      && (r.inn.length === 10 || r.inn.length === 12));

    log('=== 3. ИНН В КАРТОЧКАХ (пусто → из документов) ===');
    for (const r of innFill) {
      log(`  карточка ${r.card_id} «${r.card_name}» → ИНН ${r.inn} (документов: ${r.docs})`);
    }
    log(`  всего: ${innFill.length}`);
    const skip = rows.rows.length - innFill.length;
    if (skip > 0) log(`  НЕ трогаем (разные ИНН в документах карточки): ${skip}`);
    log('');
  }

  // ─── 4. Пустые дубли карточек (только показываем) ──────────────────────
  if (!ONLY || ONLY === 'dupes') {
    const rows = await db.query(
      `SELECT lower(regexp_replace(regexp_replace(coalesce(name,''), '[^а-яa-z0-9]', '', 'gi'), '\\s+', ' ', 'g')) AS klyuch,
              array_agg(id ORDER BY id) AS ids,
              array_agg(name ORDER BY id) AS names,
              array_agg(coalesce(NULLIF(inn,''),'—') ORDER BY id) AS inns,
              array_agg((SELECT count(*) FROM doc_registry d
                          WHERE d.supplier_id = s.id AND d.deleted_at IS NULL) ORDER BY id) AS doc_counts
         FROM suppliers s
        WHERE deleted_at IS NULL AND coalesce(trim(name),'') <> ''
        GROUP BY 1 HAVING count(*) > 1`);
    log('=== 4. ДУБЛИ КАРТОЧЕК (НЕ удаляем — показываем) ===');
    if (!rows.rows.length) log('  (нет)');
    for (const r of rows.rows) {
      const details = r.ids.map((id, i) => `${id}:«${r.names[i]}» [ИНН ${r.inns[i]}] док=${r.doc_counts[i]}`);
      const emptyDupes = r.ids.filter((_, i) => Number(r.doc_counts[i]) === 0);
      log(`  ${details.join('  ||  ')}`);
      if (emptyDupes.length) {
        log(`    └ пустые карточки (0 документов): ${emptyDupes.join(', ')} — кандидаты на деактивацию, НЕ удаление`);
      } else {
        log('    └ ВСЕ карточки с документами — нужно решение человека');
      }
    }
    log('');
  }

  // ─── 5. Офисмаг и ППР: разные ИНН, оба активны ─────────────────────────
  if (!ONLY || ONLY === 'ofismag') {
    const rows = await db.query(
      `SELECT s.id, s.name, coalesce(NULLIF(s.inn,''),'—') AS inn,
              (SELECT count(*) FROM doc_registry d
                WHERE d.supplier_id = s.id AND d.deleted_at IS NULL) AS docs,
              (SELECT max(d.invoice_date) FROM doc_registry d
                WHERE d.supplier_id = s.id AND d.deleted_at IS NULL) AS last_doc
         FROM suppliers s
        WHERE s.deleted_at IS NULL
          AND (s.name ILIKE '%офисмаг%' OR s.name ILIKE '%ппр%')
        ORDER BY s.name, s.id`);
    log('=== 5. ОФИСМАГ и ППР: два разных ИНН на одно имя ===');
    log('  Это НЕ дубли по ошибке ввода: ИНН разные. Либо два юрлица, либо один');
    log('  ошибочный. Решает человек — какие реквизиты верные для платёжек.');
    for (const r of rows.rows) {
      log(`  карточка ${r.id} «${r.name}» ИНН ${r.inn}: документов ${r.docs}, последний ${r.last_doc ? String(r.last_doc).slice(0, 10) : '—'}`);
    }
    log('');
  }

  if (!APPLY) {
    log('Сухой прогон. Для применения: --apply');
    await db.end();
    return;
  }

  // ─── Применение ────────────────────────────────────────────────────────
  log('--- применение ---');
  await db.query('BEGIN');
  try {
    let n1 = 0;
    for (const r of names8) {
      const u = await db.query(
        `UPDATE doc_registry SET counterparty_name=$2, updated_at=NOW()
          WHERE id=$1 AND deleted_at IS NULL AND trim(counterparty_name)=trim($3)`,
        [r.id, String(r.card).trim(), String(r.was)]);
      n1 += u.rowCount;
    }
    log(`имена: ${n1}`);

    let n2 = 0;
    for (const r of link5) {
      const u = await db.query(
        `UPDATE doc_registry SET supplier_id=$2, updated_at=NOW()
          WHERE id=$1 AND deleted_at IS NULL AND supplier_id IS NULL`,
        [r.id, r.card_ids[0]]);
      n2 += u.rowCount;
    }
    log(`привязано документов: ${n2}`);

    let n3 = 0;
    for (const r of innFill) {
      const u = await db.query(
        `UPDATE suppliers SET inn=$2, updated_at=NOW()
          WHERE id=$1 AND deleted_at IS NULL AND coalesce(trim(inn),'')=''`,
        [r.card_id, r.inn]);
      n3 += u.rowCount;
    }
    log(`ИНН в карточках: ${n3}`);

    await db.query('COMMIT');
    log('COMMIT — применено');
  } catch (e) {
    await db.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
    await db.end();
    process.exit(1);
  }

  await db.end();
})().catch((e) => { console.error('ERR', e.message); db.end(); process.exit(1); });
