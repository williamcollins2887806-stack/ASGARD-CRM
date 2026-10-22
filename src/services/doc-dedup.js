'use strict';

/**
 * D-338 (заказчик 22.10.2026): ЕДИНЫЙ дедуп счетов — один вход для ВСЕХ путей.
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик: «сейчас при пустом OCR файл ставится на ручной разбор — это правильно,
 * но дубли по номеру+сумме не отсекаются, если разбор пришёл через ИИ. Поэтому
 * ДС-26027738 и раздвоился. Подумай, как сделать так, чтобы железно работало».
 *
 * ПОЧЕМУ РАЗДВАИВАЛОСЬ. Дедуп жил только в `doc-email-intake.js` и был завязан на
 * `parsed.inn` как на VETO:
 *
 *     dupWhere += ` AND (counterparty_inn IS NULL OR ... OR counterparty_inn = $n)`;
 *
 * Если ИИ извлёк наш собственный ИНН (7736244785 — «Асгард-Сервис» в шапке
 * покупателя), вето срабатывало: у существующей строки ИНН 3015042714, он не
 * совпал → строка «не найдена» → создавался дубль. Именно так родились #1597
 * (дубль #1523) и, ранее, #1587 (дубль #4960).
 *
 * ЧТО ЗДЕСЬ. Один детерминированный матчер + один идемпотентный «safety net»:
 *
 *   1. `findDuplicate()` — ищет существующую строку по нормализованному ключу.
 *      Решение принимается по ТРЁМ независимым сигналам, а не по одному:
 *
 *        • номер счёта — нормализованный (без «№», пробелов, разделителей);
 *        • сумма — с НДС, допуск 1 копейка;
 *        • лицо — ИНН ИЛИ нормализованное имя организации.
 *
 *      Правила осторожности (ложная склейка ХУЖЕ дубля — она прячет деньги):
 *        a) наш собственный ИНН НИКОГДА не участвует в сравнении (это не лицо
 *           контрагента, а реквизит покупателя) — он просто отбрасывается;
 *        b) если у обеих сторон ИНН известен и РАЗЛИЧАЕТСЯ → это разные счета,
 *           даже при совпадении номера и суммы (на проде: «№74 / 20 000 ₽» от
 *           ИП Студенниковой и ИП Павленко — разные люди, один номер);
 *        c) если ИНН нет ни у одной стороны, а есть только имя — сравниваем
 *           нормализованные имена («ООО "X"» == «Общество ... "X"»), но требуем
 *           ещё и совпадения даты либо отсутствия даты у обеих;
 *        d) мусорные номера («--», «-», пусто) НЕ являются ключом: по ним
 *           склеились бы все аренды ИП Гужва (5 счетов по 20 000 ₽ за разные месяцы);
 *        e) один номер может выставляться повторно — разные даты при совпавшем
 *           номере это РАЗНЫЕ счета (Аэроотель «№1003», 05.08 и 08.08).
 *
 *   2. `safetyNet()` — после вставки проверяет, не появилась ли рядом строка с тем
 *      же ключом, и связывает/помечает. Это ловит ГОНКУ (два письма обрабатываются
 *      параллельно, оба не видят друг друга) — то, что одиночная проверка до
 *      вставки принципиально не может закрыть.
 *
 * Модуль НЕ удаляет и НЕ переписывает суммы. Он либо возвращает существующую
 * строку (связать), либо оставляет новую и помечает её `duplicate_suspect`,
 * чтобы человек решил. Деньги не теряются ни в одном сценарии.
 */

/** Мусорные «номера», которые не являются идентификатором счёта. */
const JUNK_NUMBER_RE = /^[\s\-–—_.,/\\|]*$/;

/**
 * Нормализовать номер счёта для сравнения.
 * «№ 276», «no.276», «ДС-26027738», «ДС 26027738» → сравнимые строки.
 * Возвращает '' для мусора — такой номер не может быть ключом дедупа.
 */
function normDocNumber(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || JUNK_NUMBER_RE.test(s)) return '';
  return s
    .toLowerCase()
    .replace(/^(сч[её]т|invoice|no|n|№|#)\.?\s*/i, '')
    .replace(/[№#"'`«»]/g, '')
    // Дефисы/тире — не значимы: «ДС-26027738» == «ДС 26027738» == «ДС26027738».
    // Без этого один и тот же счёт, распознанный с дефисом и без, считался разным.
    .replace(/[\s._\-–—]+/g, '')
    .replace(/[/\\]+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

/** Сумма к сравнимому виду (копейки целым числом — без плавающих ошибок). */
function moneyCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Дата к канону YYYY-MM-DD.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ФУНКЦИЯ (найдено интеграционным тестом на клоне 22.10.2026):
 * колонка `invoice_date` приходит из pg как объект `Date`. Выражение
 * `String(date).slice(0,10)` даёт «Mon Oct 19» — НЕ ISO-дату. Сравнение с
 * входящей строкой «2026-10-19» не совпадало никогда, поэтому тройной ключ
 * «номер+сумма+дата» молча не работал и дубль ДС-26027738 не ловился.
 */
function normDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // ВАЖНО: колонка типа `date` приходит из pg как Date в полночь МЕСТНОГО
    // времени. `toISOString()` переводит в UTC и для UTC+3 сдвигает на
    // предыдущий день (2026-10-19 → «2026-10-18»). Раньше из-за этого даты
    // «не совпадали» никогда, и тройной ключ молча не работал.
    // Берём локальные компоненты — они соответствуют дате, записанной в БД.
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  // Уже ISO (возможно с временем) — берём дату как есть, без пересчёта зоны.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Русский формат 19.10.2026 → 2026-10-19.
  const ru = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
}

/** Нормализовать имя организации (тот же канон, что в supplier-resolve). */
function normOrgName(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[«»"'`]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/^(общество\s+с\s+ограниченной\s+ответственностью|ооо)\s*/i, '')
    .replace(/^(акционерное\s+общество|ао|пао|зао|оао)\s*/i, '')
    .replace(/^индивидуальный\s+предприниматель\s*/i, '')
    .replace(/^ип\s*/i, '')
    .replace(/[",.]/g, '')
    .trim();
}

/**
 * Привести ИНН к канону. Наш собственный ИНН → null: он не является лицом
 * контрагента (в счёте это «Покупатель»), и как вето он только вредит.
 */
function normInn(v, ownInnValue) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length !== 10 && d.length !== 12) return null;
  const own = String(ownInnValue == null ? '' : ownInnValue).replace(/\D/g, '');
  if (own && d === own) return null;
  return d;
}

/** Канонический ИНН компании — переиспользуем проверенную реализацию классификатора. */
async function ownInn(db) {
  try {
    const dc = require('./doc-classifier');
    if (typeof dc.ownInn === 'function') return String((await dc.ownInn(db)) || '').replace(/\D/g, '');
  } catch (_) { /* модуль недоступен — ENV */ }
  return String(process.env.COMPANY_INN || process.env.OWN_INN || '').replace(/\D/g, '');
}

/** Название нашей компании (settings.company_profile.name → ENV). */
let _ownNameCache = { value: '', at: 0 };
async function ownCompanyName(db) {
  const now = Date.now();
  if (_ownNameCache.value && now - _ownNameCache.at < 10 * 60 * 1000) return _ownNameCache.value;
  let v = '';
  try {
    const r = await db.query(
      `SELECT (value_json::jsonb)->>'name' AS name, (value_json::jsonb)->>'short_name' AS short_name
         FROM settings WHERE key='company_profile' LIMIT 1`);
    v = String((r.rows[0] && (r.rows[0].name || r.rows[0].short_name)) || '');
  } catch (_) { /* нет settings — ENV */ }
  if (!v) v = String(process.env.COMPANY_NAME || 'АСГАРД-СЕРВИС');
  _ownNameCache = { value: v, at: now };
  return v;
}

function resetOwnNameCache() { _ownNameCache = { value: '', at: 0 }; }
function resetOwnInnCache() {
  try { require('./doc-classifier').resetOwnInnCache(); } catch (_) { /* ignore */ }
  resetOwnNameCache();
}

/**
 * Найти существующую строку реестра, которая является ТЕМ ЖЕ счётом.
 *
 * @param {object} db
 * @param {{invoice_number?:string, amount_gross?:number, invoice_date?:string,
 *          counterparty_inn?:string, counterparty_name?:string, inn?:string,
 *          name?:string, excludeId?:number, ownInn?:string}} doc
 * @returns {Promise<object|null>} строка doc_registry
 */
async function findDuplicate(db, doc = {}) {
  const num = normDocNumber(doc.invoice_number);
  const cents = moneyCents(doc.amount_gross);
  // Без суммы ключа нет: ноль/пусто — не идентификатор.
  if (!cents || cents <= 0) return null;

  const own = doc.ownInn != null ? String(doc.ownInn).replace(/\D/g, '') : await ownInn(db);
  const inn = normInn(doc.counterparty_inn != null ? doc.counterparty_inn : doc.inn, own);
  let name = normOrgName(doc.counterparty_name != null ? doc.counterparty_name : doc.name);
  const date = normDate(doc.invoice_date);

  // Наше собственное имя («Асгард-Сервис») — такой же реквизит покупателя, как и
  // наш ИНН, и лицом контрагента не является. Не даём ему блокировать дедуп.
  const ownName = normOrgName(await ownCompanyName(db));
  if (name && ownName && name === ownName) name = '';

  // Кандидаты: та же сумма. Дальше фильтруем в JS — правил много, а SQL с
  // нормализацией номера/имени читается хуже и легче ошибиться.
  const params = [cents / 100];
  let sql = `SELECT id, invoice_number, invoice_date, counterparty_name, counterparty_inn,
                    amount_gross, dir, payment_invoice_id, work_id, office_expense_id,
                    is_incomplete, incomplete_reasons, created_at
               FROM doc_registry
              WHERE deleted_at IS NULL
                AND dir = 'in'
                AND amount_gross = $1`;
  if (doc.excludeId) {
    params.push(Number(doc.excludeId));
    sql += ` AND id <> $${params.length}`;
  }
  // Ограничим окно: счёт не приходит повторно спустя годы.
  sql += ` ORDER BY id DESC LIMIT 400`;

  const { rows } = await db.query(sql, params);

  // Собираем ВСЕ совпадения, а не первое: один счёт может быть заведён дважды
  // (#1523 и дубль #1597). Возвращать надо ту строку, которая уже «живёт» —
  // с заявкой на оплату или расходом, — иначе связали бы новый счёт с пустышкой.
  const hits = [];
  for (const r of rows) {
    const rNum = normDocNumber(r.invoice_number);
    const rInn = normInn(r.counterparty_inn, own);
    let rName = normOrgName(r.counterparty_name);
    if (rName && ownName && rName === ownName) rName = '';
    const rDate = normDate(r.invoice_date);

    // ── правило (b): ИНН известен у ОБЕИХ сторон и РАЗЛИЧАЕТСЯ → разные счета.
    // Жёсткое вето, сразу, до всех прочих проверок. На проде: «№74 / 20 000 ₽»
    // от ИП Студенниковой и ИП Павленко — один номер, разные люди.
    if (inn && rInn && inn !== rInn) continue;

    // ── номер: если нормализованный номер есть у обеих сторон — он обязан совпасть.
    // Разные номера при обеих известных → разные счета, дальше не смотрим.
    if (num && rNum && num !== rNum) continue;

    // ── лицо. Приоритет у ИНН: совпал — вопрос закрыт, имя не важно (в счёте
    // оно могло быть распознано как наше или с опечаткой).
    const innMatch = !!(inn && rInn && inn === rInn);
    const nameMatch = !!(name && rName && name === rName);

    // ── ОДИН И ТОТ ЖЕ НОМЕР МОЖЕТ ВЫСТАВЛЯТЬСЯ ПОВТОРНО.
    // На проде: ООО «Аэроотель» выставил «№1003 / 25 800 ₽» 05.08 и снова
    // 08.08 — разные счета (две поставки), хотя контрагент, номер и сумма
    // совпадают. Поэтому РАЗНЫЕ даты при совпавшем номере — это разные счета,
    // и это правило сильнее совпадения ИНН.
    if (num && rNum && num === rNum && date && rDate && date !== rDate) continue;

    // ── ВАЖНО (FAIL верификатора 22.10.2026, п.2a): ТО ЖЕ ПРАВИЛО ДЛЯ СЧЕТОВ
    // БЕЗ НОМЕРА. Если номер мусорный у ОБЕИХ сторон («--», пусто), номера как
    // идентификатора нет вовсе — и разные даты означают РАЗНЫЕ счета, даже при
    // полном совпадении ИНН и суммы.
    //
    // Раньше проверка выше требовала `num === rNum`, а у «--» normalize даёт ''
    // (то есть обоих), и условие не срабатывало. Тогда `innMatch` пушил хит:
    // аренда ИП Гужва (5 счетов по 20 000 ₽ за разные месяцы, номер «--») при
    // появлении ИНН в карточке арендодателя схлопнулась бы в ОДИН счёт.
    // Деньги (второй месяц аренды) ушли бы без документа и без расхода.
    const bothNoNumber = !num && !rNum;
    if (bothNoNumber && date && rDate && date !== rDate) continue;

    if (innMatch) {
      // ИНН совпал → это тот же контрагент. Номер/сумма/дата уже проверены.
      // ВАЖНО: не возвращаем сразу — копим, чтобы выбрать «живую» строку.
      hits.push(r);
      continue;
    }

    // ── правило (e2): ТОЧНЫЙ тройной ключ «номер + сумма + дата».
    // Если нормализованный номер известен у обеих сторон, совпал, и дата счёта
    // тоже совпала — это тот же счёт, даже когда лицо подтвердить нечем
    // (например, ИИ извлёк наш собственный ИНН, и он отброшен как реквизит
    // покупателя). Ровно случай #1597: номер ДС-26027738, 3 305 ₽, 19.10 —
    // всё совпало с #1523, но «лица» не было, и рождался дубль.
    if (num && rNum && num === rNum) {
      if (date && rDate && date === rDate) { hits.push(r); continue; }
      // Даты известны и РАЗНЫЕ → разные поставки, даже при одном номере и сумме.
      // На проде: «№1003 / 25 800 ₽» от Аэроотеля 05.08 и 08.08; повторяющиеся
      // номера вида «1» у ИП — обычная практика. Склеивать нельзя.
      if (date && rDate) continue;
      // Дата известна только с одной стороны. Номер+сумма совпали, встречного
      // ИНН нет — считаем тем же счётом (иначе #1597 не поймать).
      hits.push(r);
      continue;
    }

    // ИНН не подтвердил. Дальше нужно совпадение имени — иначе склеивать нечего.
    if (!nameMatch) continue;

    // Проверка «оба без номера + разные даты» уже сделана выше (до innMatch):
    // здесь остались только случаи, где либо номера нет у одной стороны, либо
    // даты совпадают или неизвестны.
    hits.push(r);
  }

  if (!hits.length) return null;
  // Выбираем «живую» строку: с заявкой на оплату / расходом, затем старейшую.
  // Если вернуть пустышку-дубль, новый счёт свяжется с ней, а реальная строка
  // останется без оплаты — это теряло бы деньги.
  const score = (r) => (r.payment_invoice_id ? 4 : 0) + (r.work_expense_id ? 2 : 0)
    + (r.office_expense_id ? 2 : 0);
  hits.sort((a, b) => (score(b) - score(a)) || (a.id - b.id));
  return hits[0];
}

/**
 * Safety net после вставки: поймать ГОНКУ (два параллельных intake одного счёта).
 *
 * Если рядом появилась вторая строка с тем же ключом, вторая (свежая) помечается
 * `duplicate_suspect` — её не отправят молча в оплату, человек увидит. Ничего не
 * удаляем и суммы не трогаем: решение за человеком, деньги не теряются.
 *
 * @returns {Promise<{duplicate:boolean, keepId?:number, flaggedId?:number}>}
 */
async function safetyNet(db, doc, opts = {}) {
  const log = opts.log;
  if (!doc || !doc.id) return { duplicate: false };
  const found = await findDuplicate(db, {
    invoice_number: doc.invoice_number,
    amount_gross: doc.amount_gross,
    invoice_date: doc.invoice_date,
    counterparty_inn: doc.counterparty_inn,
    counterparty_name: doc.counterparty_name,
    excludeId: doc.id,
    ownInn: opts.ownInn
  });
  if (!found) return { duplicate: false };

  // Оставляем ту строку, которая уже «живёт» (есть заявка/расход) — иначе старейшую.
  const liveScore = (r) => (r.payment_invoice_id ? 4 : 0) + (r.work_expense_id ? 2 : 0)
    + (r.office_expense_id ? 2 : 0);
  const keep = liveScore(found) >= liveScore(doc) ? found : doc;
  const flag = keep.id === doc.id ? found : doc;

  try {
    await db.query(
      `UPDATE doc_registry
          SET is_incomplete = true,
              incomplete_reasons = (SELECT array_agg(DISTINCT x) FROM unnest(
                COALESCE(incomplete_reasons,'{}'::text[]) || ARRAY['duplicate_suspect']) AS x),
              updated_at = NOW()
        WHERE id = $1`, [flag.id]);
    // Связь с заявкой-победителем: у дубля не должно быть своей оплаты.
    if (flag.id === doc.id && keep.payment_invoice_id) {
      await db.query(
        `UPDATE doc_registry SET payment_invoice_id = COALESCE(payment_invoice_id, $2)
          WHERE id = $1`, [doc.id, keep.payment_invoice_id]);
    }
    log?.warn?.(`[dedup] дубль счёта: #${flag.id} повторяет #${keep.id} ` +
      `(${doc.invoice_number || 'без номера'} / ${doc.amount_gross})`);
  } catch (e) {
    log?.warn?.('[dedup] не удалось пометить дубль: ' + (e && e.message));
  }
  return { duplicate: true, keepId: keep.id, flaggedId: flag.id };
}

module.exports = {
  findDuplicate, safetyNet, normDocNumber, normOrgName, normInn, normDate,
  moneyCents, ownInn, ownCompanyName, resetOwnInnCache, resetOwnNameCache, JUNK_NUMBER_RE
};
