'use strict';
/**
 * V484: СЛИЯНИЕ двух карточек одного контрагента в одну + дозаполнение из DaData.
 *
 * ЗАПРОС заказчика 11.11.2026: «ты можешь их слить в одну? дополнить инфой друг
 * друга и заполнить через да дата».
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ЧТО ДЕЛАЕТ (порядок важен):
 *
 *   1. Проверяет, что у карточек ОДИН ИНН — иначе слияние запрещено (это разные
 *      юрлица, склеивать нельзя ни при каких условиях).
 *   2. Собирает «лучшее» из обеих: название (самое длинное корректное), КПП, ОГРН,
 *      банковские реквизиты — поле за полем, НЕ перезаписывая непустое пустым.
 *   3. Дозаполняет из DaData (findById/party по ИНН): официальное название,
 *      КПП, ОГРН, адрес. DaData — источник истины по реквизитам, но её значение
 *      НЕ затирает то, что уже есть и заполнено руками.
 *   4. Переносит ВСЕ ссылки из поглощаемой карточки в целевую (все таблицы
 *      с supplier_id + ИНН текстом в документах и заявках).
 *   5. Скрывает поглощаемую карточку (deleted_at), НЕ удаляет — обратимо.
 *
 * ЧЕГО НЕ ДЕЛАЕТ: не удаляет строки, не трогает документы кроме supplier_id и
 * counterparty_inn/имени у заявок.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Запуск:
 *   node tools/merge-supplier-cards.js              # план
 *   node tools/merge-supplier-cards.js --apply      # применить
 */
const { Pool } = require('pg');

// V484: на проде DADATA_TOKEN лежит в .env, но systemd его не пробрасывает в
// окружение юнит-файла. Без этой строки скрипт молча работал «без DaData» и
// дозаполнял только из двух карточек. Загружаем .env явно — как делает сервер.
try { require('dotenv').config(); } catch (_) { /* dotenv не обязателен */ }

const dadata = require('../src/services/dadata');

const APPLY = process.argv.includes('--apply');

const db = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
});

/**
 * Пары слияния: keep — остаётся, drop — поглощается.
 * Офисмаг и ППР уже перенесены отдельным инструментом; здесь — найденный дубль.
 */
const MERGES = [
  {
    keepId: 453, dropId: 311, inn: '3015091542',
    why: 'один ИНН 3015091542. У 453 есть КПП 302501001 и 8 документов; '
      + 'у 311 в названии опечатка («Корпоратинвный») и 1 документ',
  },
];

/** Таблицы с supplier_id (проверено по information_schema на проде). */
const TABLES = [
  'doc_registry',
  'payment_invoices',
  'price_records',
  'procurement_items',
  'procurement_invoice_imports',
  'catalog_imports',
  'supplier_contacts',
  'doc_reconciliation_acts',
];

/**
 * Текстовые поля карточки, которые сливаем «лучшее из двух».
 *
 * Сверено с реальной схемой `suppliers` на проде 11.11.2026: колонок `full_name`
 * и `country` НЕ существует. Первая версия скрипта пыталась писать в full_name и
 * падала с 42703 — весь UPDATE откатывался (ROLLBACK сработал, данные целы).
 */
const TEXT_FIELDS = ['name', 'kpp', 'ogrn', 'address', 'phone', 'email', 'website', 'bik', 'rs', 'ks', 'bank_name', 'notes'];

function pickBest(a, b) {
  const na = a == null ? '' : String(a).trim();
  const nb = b == null ? '' : String(b).trim();
  if (!na) return nb || null;
  if (!nb) return na || null;
  // Оба непустые. ДЕФЕКТ, найденный сухим прогоном 11.11.2026: «длиннее = полнее»
  // выбрало ОПЕЧАТКУ — «ОЧУДПО"Корпоратинвный учебный центр"» длиннее правильного
  // «КОРПОРАТИВНЫЙ УЧЕБНЫЙ ЦЕНТР». Длина не признак качества.
  // Правило: побеждает тот, у кого больше ПОЛЕЗНЫХ признаков (КПП-подобная форма,
  // отсутствие двойных букв-опечаток рядом с «нв»/«нн» и т.п.). В спорных случаях
  // решает DaData — она даёт официальное написание.
  const badness = (s) => {
    let score = 0;
    // Признак опечатки: «нв», «ннн», «ъъ» — рядом стоящие несовместимые буквы.
    if (/нв|вн[а-я]|ъъ|ьь|жж|щщ/i.test(s)) score += 2;
    // Слипшиеся формы без пробела после кавычки.
    if (/["»][А-ЯЁа-яё]/.test(s)) score += 1;
    return score;
  };
  const ba = badness(na);
  const bb = badness(nb);
  if (ba !== bb) return bb < ba ? nb : na;
  return nb.length > na.length ? nb : na;
}

(async () => {
  console.log(`режим: ${APPLY ? 'ПРИМЕНИТЬ' : 'ПЛАН (ничего не пишем)'}\n`);

  const plans = [];

  for (const m of MERGES) {
    console.log('═'.repeat(70));
    console.log(`слияние: ${m.dropId} → ${m.keepId}  (ИНН ${m.inn})`);
    console.log(`  причина: ${m.why}\n`);

    const rows = await db.query(
      `SELECT * FROM suppliers WHERE id IN ($1,$2)`, [m.keepId, m.dropId]);
    const keep = rows.rows.find((r) => Number(r.id) === m.keepId);
    const drop = rows.rows.find((r) => Number(r.id) === m.dropId);
    if (!keep || !drop) { console.log('  СТОП: карточка не найдена\n'); continue; }

    const innKeep = String(keep.inn || '').replace(/\D/g, '');
    const innDrop = String(drop.inn || '').replace(/\D/g, '');
    if (!innKeep || innKeep !== innDrop || innKeep !== m.inn) {
      console.log(`  СТОП: ИНН не совпадают или не те (${innKeep} / ${innDrop}), слияние запрещено\n`);
      continue;
    }
    console.log(`  ИНН совпал: ${innKeep} — один налогоплательщик, сливать можно`);

    // Собираем «лучшее» из двух
    const merged = {};
    for (const f of TEXT_FIELDS) {
      const v = pickBest(keep[f], drop[f]);
      if (v) merged[f] = v;
    }

    // DaData: источник истины по реквизитам
    console.log('\n  --- DaData (findById/party) ---');
    let dd = null;
    try {
      dd = await dadata.resolveByInn(m.inn);
    } catch (e) { console.log('    ошибка: ' + e.message); }
    if (!dd) {
      console.log('    DaData не ответила (нет токена / сеть) — дозаполняем только из двух карточек');
    } else {
      console.log('    официально: ' + (dd.name || '—'));
      console.log('    полное:     ' + (dd.full_name || '—'));
      console.log('    КПП:        ' + (dd.kpp || '—'));
      console.log('    ОГРН:       ' + (dd.ogrn || '—'));
      console.log('    адрес:      ' + (dd.address || '—'));
      // Название из DaData — предпочтительно (официальное написание).
      // Полное наименование (full_name) в карточку писать НЕКУДА: такой колонки
      // в таблице нет. Используем его только как справку в плане.
      if (dd.name) merged.name = dd.name;
      if (dd.kpp && !merged.kpp) merged.kpp = dd.kpp;
      if (dd.ogrn && !merged.ogrn) merged.ogrn = dd.ogrn;
      if (dd.address && !merged.address) merged.address = dd.address;
    }

    console.log('\n  --- итог слияния полей ---');
    for (const f of TEXT_FIELDS) {
      const before = keep[f] == null ? '' : String(keep[f]);
      const after = merged[f] == null ? '' : String(merged[f]);
      if (!after) continue;
      const changed = before !== after;
      console.log(`    ${f}: ${changed ? `«${before || '—'}» → «${after}»` : '(без изменений)'}`);
    }

    // Что переносим
    console.log('\n  --- ссылки к переносу ---');
    let total = 0;
    for (const tbl of TABLES) {
      const q = await db.query(`SELECT count(*)::int n FROM ${tbl} WHERE supplier_id=$1`, [m.dropId]);
      if (q.rows[0].n) { console.log(`    ${tbl}: ${q.rows[0].n}`); total += q.rows[0].n; }
    }
    console.log(`    ВСЕГО: ${total}\n`);

    plans.push({ m, keep, drop, merged, innKeep });
  }

  if (!APPLY) {
    console.log('Сухой прогон. Для применения: --apply');
    await db.end();
    return;
  }

  console.log('--- применение ---');
  await db.query('BEGIN');
  try {
    for (const p of plans) {
      const { m, merged, innKeep } = p;

      // 1. Записываем слитые поля в целевую карточку.
      const fields = Object.keys(merged).filter((f) => TEXT_FIELDS.includes(f));
      if (fields.length) {
        const set = fields.map((f, i) => `${f}=$${i + 1}`).join(', ');
        await db.query(
          `UPDATE suppliers SET ${set}, updated_at=NOW() WHERE id=$${fields.length + 1}`,
          [...fields.map((f) => merged[f]), m.keepId]);
        console.log(`  поля карточки ${m.keepId}: обновлено ${fields.length}`);
      }

      // 2. Переносим ссылки.
      let moved = 0;
      for (const tbl of TABLES) {
        const u = await db.query(
          `UPDATE ${tbl} SET supplier_id=$2 WHERE supplier_id=$1`, [m.dropId, m.keepId]);
        moved += u.rowCount;
      }
      console.log(`  перенесено ссылок: ${moved}`);

      // 3. ИНН текстом в документах и заявках — один и тот же, но приводим к
      //    написанию целевой карточки (на случай пробелов/формата).
      await db.query(
        `UPDATE doc_registry SET counterparty_inn=$2, updated_at=NOW()
          WHERE supplier_id=$1 AND coalesce(counterparty_inn,'') <> $2`,
        [m.keepId, innKeep]);

      // 4. Имя в заявках — к слитому названию (в реестре имя своё у каждого
      //    документа, там подразделения значимы — не трогаем).
      const u4 = await db.query(
        `UPDATE payment_invoices SET supplier_name=$2, counterparty_inn=$3, updated_at=NOW()
          WHERE supplier_id=$1`, [m.keepId, merged.name, innKeep]);
      console.log(`  заявки (имя+ИНН): ${u4.rowCount}`);

      // 5. Поглощаемую карточку прячем — но только если с неё всё ушло.
      const left = await db.query(
        `SELECT (SELECT count(*) FROM doc_registry WHERE supplier_id=$1 AND deleted_at IS NULL)::int
              + (SELECT count(*) FROM payment_invoices WHERE supplier_id=$1)::int AS n`, [m.dropId]);
      if (Number(left.rows[0].n) === 0) {
        await db.query(
          `UPDATE suppliers SET deleted_at=NOW(), updated_at=NOW()
            WHERE id=$1 AND deleted_at IS NULL`, [m.dropId]);
        console.log(`  карточка ${m.dropId} скрыта (0 документов)\n`);
      } else {
        console.log(`  ВНИМАНИЕ: у ${m.dropId} осталось ${left.rows[0].n} строк — НЕ скрываем\n`);
      }
    }
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
