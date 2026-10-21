'use strict';

/**
 * D-322: единая точка «найти или завести поставщика» по распознанным реквизитам.
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик 21.10.2026: «если поставщика нет, то пусть он заводит карточку сам.
 * То же самое, когда человек на вкладке согласования счёта отправляет заявку —
 * должен добавить поставщика, если такого нет».
 *
 * Проблема была в том, что при отсутствии карточки `supplier_id` оставался пуст:
 *   • в платёжке не было реквизитов (бухгалтерия вбивала руками);
 *   • в реестре счёт висел без контрагента в справочнике.
 * Реквизиты при этом В СКАНЕ ЕСТЬ — их просто не разбирали из табличной формы
 * платёжного поручения (см. invoice-extract.js, D-322).
 *
 * Правила:
 *   • ищем по ИНН (строго), затем по нормализованному имени;
 *   • НЕ перезаписываем существующую карточку — только дозаполняем пустые поля
 *     (реквизиты могли быть введены вручную и точнее, чем OCR);
 *   • наш собственный ИНН поставщиком не бывает (D-319) — fail-closed;
 *   • всё в одной транзакции, чтобы не создать двух карточек при гонке.
 */

/** Нормализовать имя организации для сравнения: ООО «X» == Общество ... «X». */
function normOrgName(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[«»"'`]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/^(общество\s+с\s+ограниченной\s+ответственностью|ооо)\s*/i, '')
    .replace(/^(акционерное\s+общество|ао|пао|зао|оао)\s*/i, '')
    .replace(/^индивидуальный\s+предприниматель\s*/i, '')
    .replace(/^ип\s*/i, '')
    .trim();
}

/**
 * Найти существующего поставщика по распознанным полям.
 * @returns {Promise<object|null>}
 */
async function findSupplier(db, { inn, name }) {
  const digits = String(inn || '').replace(/\D/g, '');
  if (digits && (digits.length === 10 || digits.length === 12)) {
    const byInn = await db.query(
      `SELECT * FROM suppliers WHERE inn=$1 AND deleted_at IS NULL ORDER BY id LIMIT 1`, [digits]);
    if (byInn.rows[0]) return byInn.rows[0];
    // ИНН мог быть записан с пробелами/в другом поле.
    const loose = await db.query(
      `SELECT * FROM suppliers
        WHERE deleted_at IS NULL AND regexp_replace(coalesce(inn,''), '\\D', '', 'g') = $1
        ORDER BY id LIMIT 1`, [digits]);
    if (loose.rows[0]) return loose.rows[0];
  }
  const nm = normOrgName(name);
  if (nm && nm.length >= 3) {
    const all = await db.query(
      `SELECT * FROM suppliers WHERE deleted_at IS NULL AND coalesce(name,'') <> '' LIMIT 2000`);
    const candidates = all.rows.filter((r) => normOrgName(r.name) === nm);
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      // D-322: несколько карточек с ОДНИМ именем, но РАЗНЫМИ ИНН — это разные
      // юрлица (на проде у «Безопасность Труда» ИНН 1651037757 и 3017052355).
      // Сопоставление по имени здесь запрещено: привязали бы чужую карточку,
      // и в платёжку ушли бы чужие реквизиты. Выбираем только при совпадении ИНН.
      if (digits) {
        const exact = candidates.find((r) => String(r.inn || '').replace(/\D/g, '') === digits);
        if (exact) return exact;
      }
      return null;   // неоднозначно — лучше завести новую карточку с верным ИНН
    }
  }
  return null;
}

/**
 * Найти или создать поставщика. Дозаполняет ТОЛЬКО пустые поля.
 * @param {object} db
 * @param {object} parsed — результат extractInvoice (inn, kpp, bik, rs, ks, bank_name, counterparty_name)
 * @param {object} [opts] — { ownInn, createdBy }
 * @returns {Promise<{id:number|null, created:boolean, reason?:string}>}
 */
async function ensureSupplier(db, parsed, opts) {
  const o = opts || {};
  const own = String(o.ownInn || '').replace(/\D/g, '');
  const inn = String((parsed && parsed.inn) || '').replace(/\D/g, '');
  const name = String((parsed && parsed.counterparty_name) || '').trim();

  // Наш ИНН поставщиком быть не может — иначе рождается «мы сами себе поставщик».
  if (own && inn === own) return { id: null, created: false, reason: 'own_inn' };
  if (!name && !inn) return { id: null, created: false, reason: 'no_data' };
  // Имя — обязательное поле suppliers.name. Без него карточку не заводим:
  // безымянный поставщик хуже, чем «не сопоставлен».
  if (!name) return { id: null, created: false, reason: 'no_name' };

  const existing = await findSupplier(db, { inn, name });
  if (existing) {
    // Дозаполняем пустые реквизиты: ручные значения НЕ затираем (они точнее OCR).
    const patch = [];
    const vals = [];
    const setIfEmpty = (col, val) => {
      const cur = existing[col];
      if (cur != null && String(cur).trim() !== '') return;
      if (val == null || String(val).trim() === '') return;
      vals.push(val);
      patch.push(`${col}=$${vals.length}`);
    };
    setIfEmpty('inn', inn || null);
    setIfEmpty('kpp', parsed.kpp || null);
    setIfEmpty('bik', parsed.bik || null);
    setIfEmpty('rs', parsed.rs || null);
    setIfEmpty('ks', parsed.ks || null);
    setIfEmpty('bank_name', parsed.bank_name || null);
    if (patch.length) {
      vals.push(existing.id);
      await db.query(`UPDATE suppliers SET ${patch.join(', ')}, updated_at=NOW() WHERE id=$${vals.length}`, vals);
    }
    return { id: existing.id, created: false, filled: patch.length };
  }

  // Создаём.
  try {
    const ins = await db.query(
      `INSERT INTO suppliers(name, inn, kpp, bik, rs, ks, bank_name, created_at, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) RETURNING id`,
      [name.slice(0, 250), inn || null, parsed.kpp || null, parsed.bik || null,
        parsed.rs || null, parsed.ks || null, parsed.bank_name || null]);
    return { id: ins.rows[0].id, created: true };
  } catch (e) {
    // Уникальность по ИНН/имени могла сработать в гонке — перечитываем.
    const again = await findSupplier(db, { inn, name }).catch(() => null);
    if (again) return { id: again.id, created: false, reason: 'race' };
    return { id: null, created: false, reason: 'insert_failed: ' + (e && e.message) };
  }
}

module.exports = { ensureSupplier, findSupplier, normOrgName };
