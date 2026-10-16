'use strict';

/**
 * Единая матрица видимости строк реестра документов (doc_registry).
 * ═══════════════════════════════════════════════════════════════════════════
 * Класс дефекта S1/S2 (верификатор 16.10.2026): до этого файла:
 *   • `scope=all` мог запросить ЛЮБОЙ из ALLOWED → видел все 1512 строк;
 *   • `GET /:id` и все `/:id/*` (quick/upload/parse-catalog/link-expense/delete)
 *     проверяли только роль, но НЕ принадлежность строки (IDOR);
 *   • `/export-1c` вообще не применял фильтр видимости.
 *
 * Здесь одна точка правды: `visibilitySql()` добавляет в params нужные
 * значения и возвращает SQL-фрагмент (начинается с ` AND ...`) для алиаса `d`.
 * Фрагмент применяется к `/`, `/kpi`, `/facets`, `/export-xlsx`, `/export-1c`,
 * `/import-1c`, а `assertDocVisible()` используется во всех `/:id/*`.
 *
 * Правила (согласованы с заказчиком 12–16.10.2026):
 *   • ADMIN, BUH, DIRECTOR_*, OFFICE_MANAGER — видят всё (`scope=all` доступен
 *     всем из этого набора; `scope=mine` сужает до своих);
 *   • PROC и TO — общий пул «закупки + ТО» (Баринов ↔ Морозов видят друг друга);
 *   • HEAD_TO — своё + все строки всех TO;
 *   • WAREHOUSE — только «складское» (spend_kind=warehouse / расходники /
 *     собственность АСГАРД / уже в складской цепочке / контрагент из списка);
 *     офисные расходы и клиентские — НЕ показываем; fallback — не показывать;
 *   • PM, HEAD_PM и остальные — только своё (doc_owner_id или pm_id).
 */

const FULL_VISIBILITY = new Set([
  'ADMIN', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR',
  'OFFICE_MANAGER',
]);

const PROC_TO_POOL = `(SELECT id FROM users WHERE role IN ('PROC','TO'))`;
const TO_POOL = `(SELECT id FROM users WHERE role = 'TO')`;

function hasFullVisibility(role) {
  return FULL_VISIBILITY.has(String(role || '').toUpperCase());
}

/** Доступен ли переключатель «Показать все» (scope=all) для роли. */
function canUseScopeAll(role) {
  return hasFullVisibility(role);
}

/**
 * SQL-фрагмент видимости для алиаса `d` (doc_registry).
 * Мутирует `params` (добавляет нужные bind-значения) и возвращает строку,
 * начинающуюся с ` AND ...` (либо '' если видно всё).
 *
 * @param {Array} params   — массив параметров запроса (мутируется)
 * @param {string} role
 * @param {number} userId
 * @param {{scope?: string}} [opts]
 * @returns {string}
 */
function visibilitySql(params, role, userId, opts = {}) {
  const r = String(role || '').toUpperCase();
  const scopeAll = String(opts.scope || 'mine').toLowerCase() === 'all';

  if (hasFullVisibility(r)) {
    // Привилегированные: scope=all → без ограничения; mine → только свои.
    if (scopeAll) return '';
    params.push(userId);
    return ` AND (d.doc_owner_id=$${params.length} OR d.pm_id=$${params.length})`;
  }

  if (r === 'PROC' || r === 'TO') {
    // Общий пул «закупки + ТО» (видят друг друга).
    return ` AND (d.doc_owner_id IN ${PROC_TO_POOL} OR d.pm_id IN ${PROC_TO_POOL})`;
  }

  if (r === 'HEAD_TO') {
    params.push(userId);
    const i = params.length;
    return ` AND (d.doc_owner_id=$${i} OR d.pm_id=$${i}` +
      ` OR d.doc_owner_id IN ${TO_POOL} OR d.pm_id IN ${TO_POOL})`;
  }

  if (r === 'WAREHOUSE') {
    // Только складское. Офисные и клиентские — исключаем всегда.
    // N-остаток: НЕ кастуем value_json к jsonb (битый JSON давал 500) —
    // извлекаем строки-элементы регуляркой (никогда не бросает исключение).
    return ` AND ((d.spend_kind = 'warehouse'` +
      ` OR d.purpose_consumables IS TRUE` +
      ` OR d.purpose_asgard IS TRUE` +
      ` OR d.wh_status <> 'none'` +
      ` OR d.counterparty_name = ANY (SELECT (regexp_matches(s.value_json, '"((?:[^"\\\\]|\\\\.)*)"', 'g'))[1]` +
      `   FROM settings s WHERE s.key='doc_wh_counterparties' AND s.value_json IS NOT NULL))` +
      ` AND d.spend_kind <> 'office'` +
      ` AND d.purpose_customer IS NOT TRUE)`;
  }

  // PM, HEAD_PM, HR и прочие — только своё.
  params.push(userId);
  return ` AND (d.doc_owner_id=$${params.length} OR d.pm_id=$${params.length})`;
}

/**
 * Доступна ли конкретная строка пользователю. Использовать во всех `/:id/*`.
 * ВАЖНО: для прямой ссылки (карточка/drawer) scope НЕ учитываем — если роль
 * в принципе видит всё (ADMIN/BUH/директора/офис), она должна открыть строку
 * даже в режиме «только мои» (иначе список и карточка расходятся).
 * @returns {Promise<boolean>}
 */
async function assertDocVisible(db, { role, userId }, docId) {
  const id = parseInt(docId, 10);
  if (!Number.isFinite(id)) return false;
  const params = [id];
  const vis = visibilitySql(params, role, userId, { scope: 'all' });
  const { rows } = await db.query(
    `SELECT 1 FROM doc_registry d WHERE d.id=$1 AND d.deleted_at IS NULL${vis} LIMIT 1`,
    params
  );
  return rows.length > 0;
}

module.exports = {
  FULL_VISIBILITY,
  hasFullVisibility,
  canUseScopeAll,
  visibilitySql,
  assertDocVisible,
};
