'use strict';

/**
 * src/services/obs-contract-match.js
 *
 * Определить, к какому ОБС-договору (subcontract_agreements) относится счёт.
 *
 * ЗАЧЕМ. Лимит существенности считается по конкретному договору субподряда.
 * Пока `subcontract_id` у счёта пуст, лимит не расходуется — на проде так
 * «потерялись» 40 657,88 ₽ (счета #1603 и #1604), и КР320п26 показывал
 * расход 0 из 1,5 млн.
 *
 * ЧТО СЧИТАЕМ ОСНОВАНИЕМ.
 * `contract_label` — единственное поле, где пришло основание из самого счёта.
 * Но там же часто стоит договор ПОСТАВЩИКА (`12.03/1339`, `БПТ/26-039`), а не
 * наш ОБС-договор. Поэтому ищем ТОЛЬКО совпадение с номером ОБС-договора:
 * не нашли — возвращаем `null` и оставляем на ручную привязку. Угадывать
 * нельзя: неверная привязка израсходует чужой лимит, а это уже вопрос денег.
 *
 * Нормализация номера — общая с `contract-match.js` (normContractNo), чтобы
 * «КР320п26», «№ КР-320 п26» и «кр320п26» сравнивались одинаково.
 */

const { normContractNo } = require('./contract-match');

/** Сколько символов минимум должно совпасть, чтобы номер считался тем же. */
const MIN_FUZZY = 5;

/**
 * Нормализация для ОБС: общий канон + без дефисов.
 * В базе встречаются и «КР320п26», и «КР-433п26» — без снятия `-`
 * точное совпадение ломается на случайной постановке дефиса в счёте.
 */
function normObsNo(v) {
  return normContractNo(v).replace(/-/g, '');
}

/**
 * Найти ОБС-договор по основанию из счёта.
 *
 * @param {object} db
 * @param {{contractLabel?:string, counterpartyInn?:string, workId?:number}} basis
 * @returns {Promise<{found:boolean, contract?:object, reason:string, candidates?:Array}>}
 */
async function matchObsContract(db, basis = {}) {
  const raw = String(basis.contractLabel || '').trim();
  if (!raw) return { found: false, reason: 'no_label' };

  // В contract_label иногда склеены два основания:
  // «КР320п26 от 04.05.2026; 26-16/2 от 16.02.2026» (счёт А-2127).
  // Берём каждый фрагмент отдельно, иначе нормализация склеит их в кашу.
  const parts = raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const probes = [...new Set(parts.map((p) => normObsNo(p)).filter(Boolean))];
  if (!probes.length) return { found: false, reason: 'no_number' };

  // Все действующие ОБС-договоры — их единицы, поэтому тянем целиком и
  // сравниваем в JS. Так проще держать одинаковую нормализацию с контрактом
  // и не зависеть от regexp в SQL (там кириллица ведёт себя иначе).
  const res = await db.query(
    `SELECT a.id, a.number, a.customer_name, a.customer_inn, a.counterparty_id,
            a.work_id, a.limit_amount, a.is_active
       FROM subcontract_agreements a
      WHERE a.is_active = TRUE
      ORDER BY a.id`
  ).catch(() => ({ rows: [] }));

  const rows = res.rows || [];
  if (!rows.length) return { found: false, reason: 'no_contracts' };

  // 1. Точное совпадение нормализованного номера.
  const exact = [];
  for (const a of rows) {
    const an = normObsNo(a.number);
    if (!an) continue;
    if (probes.includes(an)) exact.push(a);
  }
  if (exact.length === 1) return { found: true, contract: exact[0], reason: 'exact' };
  if (exact.length > 1) return { found: false, reason: 'ambiguous', candidates: exact };

  // 2. Вхождение номера договора в основание (в счёте могли дописать
  //    «оплата по КР320п26 от ...»). Требуем достаточно длинный номер,
  //    иначе «26» цепляет всё подряд — та же ошибка, что в contract-match.
  const contains = [];
  for (const a of rows) {
    const an = normObsNo(a.number);
    if (!an || an.length < MIN_FUZZY) continue;
    if (probes.some((p) => p.length >= MIN_FUZZY && p.includes(an))) contains.push(a);
  }
  if (contains.length === 1) return { found: true, contract: contains[0], reason: 'contains' };
  if (contains.length > 1) return { found: false, reason: 'ambiguous', candidates: contains };

  // Раньше здесь был fallback `single_for_work`: «единственный ОБС на объекте
  // → берём его». Это опасно: в `contract_label` часто стоит договор
  // ПОСТАВЩИКА (`БПТ/26-039`, `12.03/1339`), а не наш ОБС. При одном
  // действующем договоре на объекте intake молча съедал чужой лимит.
  // Автопривязка — только по номеру ОБС-договора; иначе — ручная.

  return { found: false, reason: 'not_found', candidates: rows };
}

/**
 * Подставить `subcontract_id` в строку реестра, если договор определился
 * однозначно. Ничего не пишет, если:
 *   • привязка уже есть (ручной выбор человека сильнее эвристики);
 *   • счёт не ОБС (`payment_source !== 'obs'`) — лимит регулирует только ОБС;
 *   • договор не найден или найдено несколько.
 *
 * @param {object} db
 * @param {number} docId
 * @returns {Promise<{linked:boolean, subcontract_id?:number, reason:string}>}
 */
async function linkObsContract(db, docId) {
  const id = Number(docId) || 0;
  if (!id) return { linked: false, reason: 'no_doc' };

  const r = await db.query(
    `SELECT id, contract_label, counterparty_inn, work_id, payment_source, subcontract_id
       FROM doc_registry
      WHERE id = $1 AND deleted_at IS NULL`, [id]);
  const doc = r.rows[0];
  if (!doc) return { linked: false, reason: 'not_found' };
  if (doc.payment_source !== 'obs') return { linked: false, reason: 'not_obs' };
  if (doc.subcontract_id != null) return { linked: false, reason: 'already_linked' };

  const m = await matchObsContract(db, {
    contractLabel: doc.contract_label,
    counterpartyInn: doc.counterparty_inn,
    workId: doc.work_id,
  });
  if (!m.found) return { linked: false, reason: m.reason };

  // Лимит выработан — не привязываем молча: письмо по такому договору всё
  // равно запрещено (409 в PATCH /:id/subcontract). Пусть решает человек.
  const st = await db.query(
    `SELECT exhausted, remaining FROM subcontract_limit_state($1)`, [m.contract.id]
  ).catch(() => ({ rows: [] }));
  if (st.rows[0] && st.rows[0].exhausted) {
    return { linked: false, reason: 'limit_exhausted', subcontract_id: m.contract.id };
  }

  await db.query(
    `UPDATE doc_registry
        SET subcontract_id = $2, updated_at = NOW()
      WHERE id = $1 AND subcontract_id IS NULL`, [id, m.contract.id]);

  return { linked: true, subcontract_id: m.contract.id, reason: m.reason };
}

module.exports = { matchObsContract, linkObsContract };
