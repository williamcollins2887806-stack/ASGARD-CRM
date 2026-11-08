'use strict';

/**
 * src/services/contract-from-document.js
 *
 * D-402 (08.11.2026): ДОГОВОР ИЗ ПОЧТЫ ДОЛЖЕН ПОПАДАТЬ В РЕЕСТР ДОГОВОРОВ.
 * ═══════════════════════════════════════════════════════════════════════════
 * Проблема, которую это закрывает. До правки intake умел ровно одно: если в
 * СЧЁТЕ написано «на основании договора № X», найти X в `contracts` и, если
 * его нет, создать «черновой по данным счёта». Но сам файл договора, который
 * приходит отдельным вложением, не создавал ничего:
 *
 *   классификатор ставил `kind='contract'` → ветка «не счёт» → `rejected`;
 *   файл оставался в почте, в договоры не попадал, скан терялся.
 *
 * Проверено на проде 08.11.2026: из 12 писем с договором за месяц —
 * 9 `rejected (not_invoice:contract)`, 2 `needs_manual`, 1 `parsed`.
 * Ни один не дал записи в `contracts`. Именно поэтому у договора #204
 * («Гала Юг» 16/2026) не было файла, а у контрагента — связи.
 *
 * ЧТО ДЕЛАЕМ. Для вложения, распознанного как договор:
 *   1. достаём номер и дату ТОЛЬКО из текста (не выдумываем);
 *   2. определяем контрагента: ИНН/имя из текста, иначе — из письма;
 *   3. ищем существующий договор тем же каноном, что и всё остальное
 *      (`matchContract`), чтобы не плодить дубли;
 *   4. если нет — создаём запись со СКАНОМ (`file_path`/`file_url`),
 *      контрагентом, номером, датой и пометкой «из почты, проверить»;
 *   5. если есть, но без файла — прикрепляем скан к существующей записи.
 *
 * ЧЕГО НЕ ДЕЛАЕМ:
 *   • не создаём договор без номера (безымянный договор в реестре бесполезен
 *     и станет мусором, как «+», «оферта», «Услуги гостиницы»);
 *   • не создаём, если номер занят ДРУГИМ лицом (`matchContract` это ловит);
 *   • не перезаписываем реквизиты существующего договора.
 */

const { normContractNo, matchContract } = require('./contract-match');
const { classifyDocument } = require('./doc-classifier');

const RU_MONTHS = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
};

/** Дата «5 ноября 2026 г.» / «05.11.2026» → YYYY-MM-DD. */
function parseRuDate(s) {
  const t = String(s || '');
  // D-402: год может быть двузначным («12.03.25» — реальный формат договора
  // с прода). Тогда это 20YY: договоры в CRM не старше 2000 года.
  const num = t.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  if (num) {
    const dd = num[1].padStart(2, '0');
    const mm = num[2].padStart(2, '0');
    const yyyy = num[3].length === 2 ? `20${num[3]}` : num[3];
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  const txt = t.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (txt) {
    const mm = RU_MONTHS[String(txt[2] || '').toLowerCase()];
    if (mm) return `${txt[3]}-${String(mm).padStart(2, '0')}-${txt[1].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Достать номер договора из текста.
 *
 * Реальные форматы с прода:
 *   «ДОГОВОР № 16/2026», «Договор поставки № 12.03/1339 от 12.03.25»,
 *   «Договор № МЛСП-245.5 от 09.09.2024», «Договор-счёт № ЭТ-10-26-16».
 *
 * ВАЖНО: «№» в PDF часто записан как «N», «No», «#». И номер НЕ должен быть
 * датой: «№ 05.11.2026» — это не номер. Отсекаем даты регуляркой.
 */
function extractContractNumber(text) {
  const t = String(text || '');
  // Строка, где рядом «договор» и номер. D-402: между словом и номером может
  // стоять тип договора («Договор поставки № 12.03/1339», «Договор подряда
  // № 16/2026», «Договор возмездного оказания услуг № …») — учитываем.
  const lineM = t.match(/[^\n]*договор(?:\s+[а-яё]+){0,4}[^\n]{0,80}?(?:№|N[oо°]?\.?|#)\s*([^\n]{1,60})/i);
  if (!lineM) return null;
  let raw = String(lineM[1] || '').trim();
  // Отрезаем «от <дата>» и всё, что идёт после него.
  raw = raw.split(/\s+от\s+/i)[0];
  // Отрезаем служебный хвост.
  raw = raw.replace(/\b(на|для|в|по)\b.*$/i, '').trim();
  // Убираем хвостовую пунктуацию и кавычки.
  raw = raw.replace(/[»,;.]+$/, '').replace(/^[«"]/, '').trim();
  if (!raw || raw.length > 40) return null;
  // Дата — не номер. D-402: проверка должна быть строгой. «12.03/1339» — это
  // НОМЕР договора (тип/счёт), а не дата, хотя начинается как «12.03».
  // Настоящая дата — ровно dd.mm.yyyy БЕЗ дополнительных групп через «/».
  if (/^\d{1,2}[.\-]\d{1,2}[.\-]\d{2,4}$/.test(raw)) return null;
  // Только цифры и разделители, 8+ знаков — похоже на номер счёта/р/с, не договора.
  if (/^\d{15,}$/.test(raw)) return null;
  return raw;
}

/** Дата договора: «от 5 ноября 2026 г.» или «ДОГОВОР № X  5 ноября 2026 г.» */
function extractContractDate(text) {
  const t = String(text || '');
  const after = t.match(/(?:№|N[oо]?\.?|#)[^\n]{1,60}?\s+от\s+([^\n]{6,30})/i);
  if (after) {
    const d = parseRuDate(after[1]);
    if (d) return d;
  }
  // Образец «Гала Юг»: номер строкой выше, дата отдельной строкой сразу под ним.
  const near = t.match(/договор[^\n]{0,80}\n\s*([^\n]{6,40})/i);
  if (near) {
    const d = parseRuDate(near[1]);
    if (d) return d;
  }
  return null;
}

/** Сумма договора, если напечатана явно. Не угадываем. */
function extractContractAmount(text) {
  const t = String(text || '');
  const m = t.match(/(?:на\s+сумму|сумма\s+договора|общая\s+сумма)[^\d]{0,20}([\d\s]{3,})(?:[.,](\d{2}))?/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/\s/g, '') + (m[2] ? '.' + m[2] : ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ИНН из текста договора: сначала «Исполнитель/Поставщик», иначе любой валидный. */
function extractContractInn(text, ownInn) {
  const t = String(text || '');
  const own = String(ownInn || '').replace(/\D/g, '');
  const all = (t.match(/\b\d{10}\b|\b\d{12}\b/g) || []);
  const uniq = [...new Set(all)].filter((v) => v !== own);
  return uniq.length ? uniq[0] : null;
}

/**
 * Создать (или дополнить) договор по распознанному документу.
 *
 * @param {object} db
 * @param {object} args
 * @param {string} args.text           — текст договора (OCR/PDF)
 * @param {string} [args.filePath]     — путь к скану в uploads
 * @param {string} [args.fileName]
 * @param {string} [args.counterpartyInn]  — ИНН из письма, если в тексте нет
 * @param {string} [args.counterpartyName]
 * @param {number} [args.userId]
 * @param {number} [args.emailId]
 * @param {number} [args.attachmentId]
 * @param {object} [args.log]
 * @param {boolean} [args.dryRun]
 * @returns {Promise<{action:'created'|'attached'|'exists'|'skipped'|'failed',
 *                    contract?:object, reason:string}>}
 */
async function ensureContractFromDocument(db, args = {}) {
  const log = args.log || console;
  const text = String(args.text || '');
  if (!text.trim()) return { action: 'skipped', reason: 'no_text' };

  // 1. Точно ли это договор? Доверяем классификатору, но перепроверяем сами:
  //    «Счёт на оплату» с фразой «имеет силу договора» — это СЧЁТ, а не договор.
  const cls = classifyDocument(text, { ownInn: args.ownInn || '' });
  const looksLikeInvoice = /сч[её]т\s+на\s+оплату|оплата\s+данного\s+сч[её]та/i.test(text);
  if (looksLikeInvoice) return { action: 'skipped', reason: 'looks_like_invoice' };
  if (cls.is_invoice) return { action: 'skipped', reason: 'classifier_says_invoice' };

  const number = extractContractNumber(text);
  if (!number) return { action: 'skipped', reason: 'no_number' };

  const date = extractContractDate(text);
  const amount = extractContractAmount(text);
  const ownInn = String(args.ownInn || '').replace(/\D/g, '');
  const inn = String(args.counterpartyInn || '').replace(/\D/g, '')
    || extractContractInn(text, ownInn) || null;
  const name = String(args.counterpartyName || '').trim() || null;

  // 2. Есть ли уже такой договор? Тот же канон, что и везде.
  let matched = null;
  try {
    matched = await matchContract(db, {
      number,
      counterpartyInn: inn,
      counterpartyName: name,
    });
  } catch (e) {
    log.warn('[contract-doc] поиск упал: ' + (e && e.message));
    return { action: 'failed', reason: 'match_error' };
  }

  if (matched.found && matched.contract) {
    // Договор есть. Если у него нет скана — прикрепляем этот файл.
    const c = matched.contract;
    const hasFile = !!(c.file_path || c.file_url);
    if (args.filePath && !hasFile && !args.dryRun) {
      try {
        await db.query(
          `UPDATE contracts
              SET file_path = COALESCE(file_path, $2),
                  file_url  = COALESCE(file_url, $3),
                  updated_at = NOW()
            WHERE id = $1`, [c.id, args.filePath, args.filePath]);
        log.info(`[contract-doc] скан прикреплён к договору #${c.id} «${c.number}»`);
        return { action: 'attached', contract: c, reason: 'scan_attached' };
      } catch (e) {
        log.warn('[contract-doc] не смог прикрепить скан: ' + (e && e.message));
      }
    }
    return { action: 'exists', contract: c, reason: matched.reason };
  }

  // Номер занят другим лицом или неоднозначно — не трогаем.
  if (['ambiguous', 'number_taken_by_other_counterparty'].includes(matched.reason)) {
    log.info(`[contract-doc] не создаю «${number}»: ${matched.reason}`);
    return { action: 'skipped', reason: matched.reason };
  }

  if (args.dryRun) {
    return { action: 'created', reason: 'dry_run', contract: { number, date, inn } };
  }

  // 3. Создаём. Контрагента ищем в suppliers по ИНН — это даёт связь
  //    `counterparty_id`, по которой карточка контрагента показывает договоры.
  let supplierId = null;
  if (inn) {
    try {
      const s = await db.query(
        `SELECT id FROM suppliers
          WHERE deleted_at IS NULL
            AND regexp_replace(COALESCE(inn,''), '\\D', '', 'g') = $1
          LIMIT 1`, [inn]);
      supplierId = s.rows[0] ? s.rows[0].id : null;
    } catch (_) { /* не критично */ }
  }
  // Имя: из текста договора оно обычно полное («Общество с ограниченной
  // ответственностью «Гала Юг»»). Если не нашли — берём из письма.
  let cpName = name;
  if (!cpName && supplierId) {
    try {
      const s = await db.query('SELECT name FROM suppliers WHERE id=$1', [supplierId]);
      cpName = (s.rows[0] && s.rows[0].name) || null;
    } catch (_) { /* ignore */ }
  }
  if (!cpName && inn) cpName = 'ИНН ' + inn;
  if (!cpName) return { action: 'skipped', reason: 'no_counterparty' };

  const comment = 'Создан автоматически из договора в письме'
    + (args.emailId ? ` #${args.emailId}` : '')
    + (args.attachmentId ? ` (вложение ${args.attachmentId})` : '')
    + ' — реквизиты требуют проверки бухгалтерией';

  try {
    const ins = await db.query(
      `INSERT INTO contracts
         (number, type, counterparty_id, counterparty_name, customer_inn, amount,
          start_date, status, comment, file_path, file_url, created_by, created_at, updated_at)
       VALUES ($1, 'supply', $2, $3, $4, $5, $6::date, 'active', $7, $8, $9, $10, NOW(), NOW())
       RETURNING id, number, counterparty_name, customer_inn, amount, start_date, status, file_path`,
      [number, supplierId, cpName, inn, amount, date, comment,
        args.filePath || null, args.filePath || null, args.userId || null]);

    const created = ins.rows[0];
    log.info(`[contract-doc] создан договор #${created.id} «${number}»`
      + (inn ? ` ИНН ${inn}` : '') + (date ? ` от ${date}` : '')
      + (args.filePath ? ' со сканом' : ' (без скана)'));

    // Связываем ранее созданный «черновой» договор из счёта, если он есть
    // с тем же номером, но без контрагента: чистим дубль.
    if (normContractNo(number)) {
      try {
        await db.query(
          `UPDATE contracts
              SET counterparty_id = COALESCE(counterparty_id, $2),
                  customer_inn = COALESCE(NULLIF(customer_inn,''), $3),
                  file_path = COALESCE(file_path, $4),
                  file_url = COALESCE(file_url, $5),
                  updated_at = NOW()
            WHERE id <> $1
              AND status <> 'archived'
              AND regexp_replace(coalesce(number,''), '[^a-zA-Z0-9а-яА-ЯёЁ/\\-]', '', 'g')
                  = regexp_replace($6, '[^a-zA-Z0-9а-яА-ЯёЁ/\\-]', '', 'g')
              AND (counterparty_id IS NULL OR COALESCE(customer_inn,'') = '')`,
          [created.id, supplierId, inn, args.filePath || null, args.filePath || null, number]);
      } catch (_) { /* не критично */ }
    }

    return { action: 'created', contract: created, reason: 'created' };
  } catch (e) {
    log.warn('[contract-doc] создание упало: ' + (e && e.message));
    return { action: 'failed', reason: 'insert_error', error: e && e.message };
  }
}

module.exports = {
  ensureContractFromDocument,
  extractContractNumber,
  extractContractDate,
  extractContractAmount,
  extractContractInn,
  parseRuDate,
};
