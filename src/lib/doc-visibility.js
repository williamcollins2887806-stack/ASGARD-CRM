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

/**
 * D-379: пересекающиеся зоны видимости (Пираев ↔ офис АГПЗ).
 *
 * Проблема, которую решает: у строки реестра ОДИН `doc_owner_id`. Пираев и
 * АГПЗ работают на одном объекте, но это разные люди. Раньше счета Пираева
 * сливались в аккаунт АГПЗ, и он их не видел в своём реестре. Сменить
 * владельца нельзя — переписалась бы история и отчётность по АГПЗ.
 *
 * Поэтому видимость расширяется, а не переносится: владелец остаётся прежним,
 * а таблица `doc_registry_shared_view` добавляет второй круг. Правило
 * двустороннее — обе стороны видят документы друг друга.
 *
 * Настройка в settings, чтобы не хардкодить id: `doc_visibility_shared_groups`.
 * Здесь — только SQL-фрагмент, читается на каждом запросе вместе с остальными
 * условиями видимости (индекс по user_id).
 */
const SHARED_VIEW_SQL = `(SELECT s.doc_id FROM doc_registry_shared_view s WHERE s.user_id = $USER$)`;

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
 * D-382: доступен ли полный обзор реестра пользователю.
 * Учитывает и роль, и персональный флаг `users.doc_full_view`.
 * Асинхронно — флаг читается из БД; роуты вызывают по мере необходимости.
 *
 * @param {object} db
 * @param {{role?: string, userId?: number}} ctx
 * @returns {Promise<boolean>}
 */
async function canUseFullView(db, { role, userId }) {
  if (hasFullVisibility(role)) return true;
  const id = Number(userId) || 0;
  if (!id) return false;
  try {
    const r = await db.query('SELECT doc_full_view FROM users WHERE id=$1', [id]);
    return !!(r.rows[0] && r.rows[0].doc_full_view);
  } catch (_) {
    return false;
  }
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

  /**
   * D-382: персональный полный обзор реестра (`users.doc_full_view`).
   *
   * Диме (PM) нужен весь реестр для документооборота ОБС, но менять роль
   * нельзя: PM завязан на десятки проверок и отчётов по ответственности.
   * Поэтому флаг расширяет ТОЛЬКО видимость строк — права на действия
   * остаются ролевыми.
   *
   * Реализация через SQL-подзапрос, а не через `opts.fullView`: функция
   * вызывается в 30+ местах, и передавать флаг в каждое — значит рано или
   * поздно забыть одно. Один источник правды лучше.
   *
   * Условие вставляется как отдельная ветка OR: флаг только РАСШИРЯЕТ,
   * сузить роль он не может.
   */
  const fullViewSql = () => {
    if (!userId) return null;
    params.push(userId);
    return ` OR EXISTS (SELECT 1 FROM users vu WHERE vu.id = $${params.length} AND vu.doc_full_view)`;
  };

  /**
   * D-379: «видит ли пользователь эту строку по связи».
   * Добавляет userId в params (если ещё не добавлен) и возвращает фрагмент.
   * Применяется ВМЕСТЕ с обычным правилом роли — это расширение, не замена:
   * нельзя сузить то, что роль уже разрешает.
   */
  const sharedClause = (i) => ` OR d.id IN (SELECT s.doc_id FROM doc_registry_shared_view s WHERE s.user_id = $${i})`;

  if (hasFullVisibility(r)) {
    // Привилегированные: scope=all → без ограничения; mine → только свои
    // (плюс выданные по связи — иначе Пираев в «моих» не увидел бы счета АГПЗ).
    if (scopeAll) return '';
    params.push(userId);
    const i = params.length;
    return ` AND (d.doc_owner_id=$${i} OR d.pm_id=$${i}${sharedClause(i)}${fullViewSql()})`;
  }

  if (r === 'PROC' || r === 'TO') {
    // D-379: общий пул «закупки + ТО» остаётся, но к нему добавлены строки,
    // выданные этому пользователю по связи. Иначе Пираев (PROC) не увидел бы
    // счета, которые оформил офис АГПЗ на себя.
    params.push(userId);
    const i = params.length;
    return ` AND (d.doc_owner_id IN ${PROC_TO_POOL} OR d.pm_id IN ${PROC_TO_POOL}${sharedClause(i)}${fullViewSql()})`;
  }

  if (r === 'HEAD_TO') {
    params.push(userId);
    const i = params.length;
    return ` AND (d.doc_owner_id=$${i} OR d.pm_id=$${i}` +
      ` OR d.doc_owner_id IN ${TO_POOL} OR d.pm_id IN ${TO_POOL}${sharedClause(i)}${fullViewSql()})`;
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

  // PM, HEAD_PM, HR и прочие — только своё (+ выданное по связи, D-379,
  // + персональный полный обзор D-382).
  params.push(userId);
  const i = params.length;
  return ` AND (d.doc_owner_id=$${i} OR d.pm_id=$${i}${sharedClause(i)}${fullViewSql()})`;
}

/**
 * D-379: выдать видимость строки реестра участникам той же группы, что и
 * владелец. Вызывается ПОСЛЕ создания/смены владельца.
 *
 * Зачем: если счёт создан от Пираева, офис АГПЗ должен его видеть, и наоборот.
 * Без этого правила «в будущем падать на него» работало бы только для
 * инициатора, а вторая сторона теряла бы документ.
 *
 * Идемпотентно. Не бросает исключение: видимость — не критичнее самого
 * документа, при сбое пишем в лог и продолжаем.
 *
 * @param {object} db
 * @param {number} docId
 * @param {number} ownerId
 * @returns {Promise<number>} сколько связей добавлено
 */
async function grantSharedVisibility(db, docId, ownerId) {
  if (!docId || !ownerId) return 0;
  try {
    const r = await db.query(
      `INSERT INTO doc_registry_shared_view (doc_id, user_id, granted_by, reason)
       SELECT $1, u.uid, $2, 'D-379: auto shared group'
         FROM (
           SELECT jsonb_array_elements_text(g->'user_ids')::int AS uid
             FROM settings s
             CROSS JOIN LATERAL jsonb_array_elements(
               CASE WHEN s.value_json ~ '^\\s*\\['
                    THEN s.value_json::jsonb
                    ELSE '[]'::jsonb END
             ) AS g
            WHERE s.key = 'doc_visibility_shared_groups'
              AND (g->'user_ids') @> to_jsonb(ARRAY[$2::int])
         ) u
        WHERE u.uid <> $2
       ON CONFLICT (doc_id, user_id) DO NOTHING`,
      [docId, ownerId]
    );
    return r.rowCount || 0;
  } catch (e) {
    console.warn('[doc-visibility] grantSharedVisibility: ' + e.message);
    return 0;
  }
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
  canUseFullView,
  visibilitySql,
  assertDocVisible,
  grantSharedVisibility,
};
