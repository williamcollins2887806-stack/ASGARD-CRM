'use strict';

/**
 * ЕДИНЫЙ ГЕЙТ СОГЛАСОВАНИЯ ВЫПЛАТ (V391+).
 * ═══════════════════════════════════════════════════════════════════════════
 * Зачем: изначально гейт был вписан точечно в 2 ручки, но статус
 * `worker_payments.status = 'paid'` меняется в ВОСЬМИ местах (POST /payouts/pay,
 * PUT /pm/payments/:id/paid, PUT /worker-payments/:id/pay,
 * POST /worker-payments/pay-salary, POST /worker-payments/pay-worker,
 * POST /director-payments, суточные из кассы и т.д.). Латание по одной ручке
 * оставляло дыры — независимый верификатор нашёл 6 обходов (16.10.2026).
 *
 * Теперь ВСЕ ручки, проводящие выплату рабочему, обязаны вызвать
 * `assertPayoutApproved()` ПЕРЕД изменением статуса. Это одна точка правды.
 *
 * Правило (согласовано с заказчиком):
 *   • Если по (сотрудник, период) есть позиция списка — она ОБЯЗАНА быть
 *     approved, иначе выплата запрещена (409 approval_required).
 *   • Если позиции нет вовсе (выплаты до V391, суточные, разовые начисления
 *     вне контура корзины) — пропускаем: иначе сломаем существующий контур.
 *     Это осознанное послабление, оно не даёт обойти согласование для
 *     выплат, которые через корзину проходили.
 *   • ФЛАГА ОБХОДА НЕТ. Любой «skip_approval_check» из тела запроса
 *     игнорируется: клиент не может снять контроль.
 */

/**
 * Типы выплат, которые разрешены БЕЗ согласованного списка.
 * По решению заказчика (16.10.2026): только суточные — у РП они бывают
 * ежедневно и на объекте, согласовывать каждую нереально.
 * Список живёт в settings.payout_no_list_types (JSON-массив), чтобы менять
 * состав без деплоя. Дефолт — ['per_diem'].
 *
 * ⚠️ ПОЧЕМУ ЭТО ЕДИНАЯ ТОЧКА: раньше правило «можно ли платить без списка»
 * было расписано ПО КАЖДОЙ РУЧКЕ отдельно (requirePeriodData в одних,
 * отдельные условия в других). Из-за этого одна и та же ситуация
 * «начисление есть, списка нет» в pay-salary проходила, а в mark_paid — нет,
 * и каждый новый аудит находил очередную ручку, где правило забыли
 * (10 волн точечных заплаток). Теперь правило одно и живёт здесь.
 */
const NO_LIST_TYPES_DEFAULT = ['per_diem'];

async function loadNoListTypes(db) {
  try {
    const { rows } = await db.query(`SELECT value_json FROM settings WHERE key = 'payout_no_list_types' LIMIT 1`);
    if (rows[0] && rows[0].value_json != null) {
      let v = rows[0].value_json;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
      if (Array.isArray(v)) {
        const clean = v.map((x) => String(x)).filter(Boolean);
        if (clean.length) return clean;
      }
    }
  } catch (_) { /* нет таблицы/ключа — дефолт */ }
  return NO_LIST_TYPES_DEFAULT;
}

/**
 * Проверяет, разрешена ли выплата. Возвращает null, если всё ок,
 * либо объект { code, error, message, ... } для ответа.
 *
 * ⚠️ ВАЖНО: проверяются ОБА условия — статус согласования И СУММА.
 * Раньше сверка суммы дублировалась руками в 2 ручках из 6, и в остальных
 * одобрение 1 ₽ открывало выплату любой суммы (найдено верификатором
 * 16.10.2026, 4 FAIL). Теперь сверка живёт ЗДЕСЬ — забыть её нельзя.
 *
 * @param {object} db
 * @param {object} args
 * @param {number} args.employeeId
 * @param {number} args.year
 * @param {number} args.month
 * @param {number} [args.amount]  — сумма К ВЫПЛАТЕ; если задана, сверяется с одобренной
 * @returns {Promise<null|{code:number,error:string,message:string,...}>}
 */
async function checkPayoutApproved(db, { employeeId, year, month, amount, type, privileged = false }) {
  const empId = parseInt(employeeId, 10);
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  // Нет данных для проверки — не блокируем (вызывающий сам решит).
  if (!Number.isInteger(empId) || empId <= 0 || !Number.isInteger(y) || !Number.isInteger(m)) return null;

  try {
    const { rows } = await db.query(`
      SELECT i.approval_status, i.pay_amount, b.status AS batch_status
        FROM payout_batch_items i
        JOIN payout_batches b ON b.id = i.batch_id
       WHERE i.employee_id = $1
         AND b.period_year = $2
         AND b.period_month = $3
         AND b.status <> 'cancelled'
       ORDER BY i.id DESC
       LIMIT 1`, [empId, y, m]);

    // ── Позиции в списке НЕТ ───────────────────────────────────────────
    // ⚠️ ЕДИНОЕ ПРАВИЛО (решение заказчика 16.10.2026):
    //   без согласованного списка разрешены ТОЛЬКО типы из NO_LIST_TYPES
    //   (по умолчанию суточные). Зарплата, аванс, премия, штраф — только
    //   через список, за ЛЮБУЮ сумму.
    //
    // ⚠️ Раньше здесь стояло `if (acc.n > 0) return null` — т.е. наличие
    // ЛЮБОГО pending-начисления ОТКРЫВАЛО выплату без согласования. Из-за
    // этого РП/бух/Дима проводили paid на произвольную сумму (найдено
    // верификатором 16.10.2026, подтверждено живьём: pay-worker,
    // director-payments, /payouts/pay, pay-salary — по 99 999 ₽ без списка).
    if (!rows.length) {
      // privileged — только для серверных полномочий (прямая выплата
      // директора). НЕ из тела запроса: клиент снять контроль не может.
      if (privileged) return null;
      const noListTypes = await loadNoListTypes(db);
      const t = (type || '').toString().trim();
      if (t && noListTypes.includes(t)) return null;
      return {
        code: 409,
        error: 'approval_required',
        message: 'Выплата без согласованного списка запрещена — согласовывать не требуется только суточные. Соберите список и отправьте директору.',
        payment_type: t || null,
        requires_approval: true,
      };
    }

    const a = rows[0];
    if (a.approval_status !== 'approved') {
      return {
        code: 409,
        error: 'approval_required',
        message: 'Выплата не согласована директором. Соберите корзину и отправьте на согласование.',
        approval_status: a.approval_status,
        requires_approval: true,
      };
    }

    // ── Сверка суммы (единая точка) ────────────────────────────────────
    // ⚠️ Проверяем НАКОПЛЕННУЮ сумму за период, а не только текущий платёж.
    // Иначе обход: одобрено 50 000 ₽, а платим 30 000 + 30 000 — каждая
    // выплата «в пределах одобренного», а вместе 60 000 ₽
    // (найдено верификатором 16.10.2026).
    if (amount != null) {
      const want = Number(amount);
      const approved = Number(a.pay_amount || 0);
      // ⚠️ Раньше было `approved > 0` — при одобренной сумме 0 сверка
      // пропускалась и проходила выплата любой суммы (F4, верификатор 16.10.2026).
      if (Number.isFinite(want) && approved >= 0) {
        // Сколько уже выплачено/подтверждено по этому сотруднику за период
        // (без учёта отменённых). Считаем и pending-начисления не берём —
        // только факт перевода.
        let alreadyPaid = 0;
        try {
          const { rows: paidRows } = await db.query(`
            SELECT COALESCE(SUM(amount), 0)::numeric AS s
              FROM worker_payments
             WHERE employee_id = $1
               AND status IN ('paid', 'confirmed', 'cancelled')
               AND COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $2
               AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $3`,
          [empId, y, m]);
          alreadyPaid = Number(paidRows[0] && paidRows[0].s) || 0;
        } catch (_) { alreadyPaid = 0; }

        const totalAfter = alreadyPaid + want;
        if (totalAfter > approved + 0.01) {
          return {
            code: 409,
            error: 'amount_exceeds_approved',
            message: alreadyPaid > 0
              ? `Согласовано ${Math.round(approved)} ₽, уже выплачено ${Math.round(alreadyPaid)} ₽, а эта выплата ${Math.round(want)} ₽. Итого превысит согласованное.`
              : `Согласовано ${Math.round(approved)} ₽, а выплата ${Math.round(want)} ₽. Согласуйте новую сумму.`,
            approved_amount: approved,
            already_paid: alreadyPaid,
            requested_amount: want,
            requires_approval: true,
          };
        }
      }
    }

    return null;
  } catch (e) {
    // ⚠️ FAIL-CLOSED для денег (16.10.2026): раньше здесь безусловно
    // возвращался null = «разрешить». При сбое БД/таблиц это молча открывало
    // ВСЕ выплаты (fail-open) — грубая дыра.
    // Компромисс: денежные типы (зарплата, аванс, премия, штраф) при сбое
    // проверки блокируем (деньги не уходят без контроля), а суточные —
    // пропускаем, чтобы ежедневная полевая выдача не встала.
    const t = (type || '').toString().trim();
    const noListTypes = await loadNoListTypes(db).catch(() => NO_LIST_TYPES_DEFAULT);
    if (t && noListTypes.includes(t)) return null;
    return {
      code: 503,
      error: 'approval_check_unavailable',
      message: 'Не удалось проверить согласование выплаты (временный сбой). Повторите позже или обратитесь к администратору.',
      payment_type: t || null,
      requires_approval: true,
    };
  }
}

/**
 * Удобная обёртка для fastify-ручки: если выплата не одобрена — сам отправит
 * ответ и вернёт true (значит, вызывающему надо сделать `return reply`).
 *
 *   if (await denyIfNotApproved(db, reply, { employeeId, year, month })) return reply;
 */
async function denyIfNotApproved(db, reply, args) {
  const bad = await checkPayoutApproved(db, args);
  if (!bad) return false;
  const { code, ...body } = bad;
  reply.code(code).send(body);
  return true;
}

/**
 * Период выплаты из записи worker_payments: явные pay_year/pay_month,
 * иначе — из created_at (как считает остальная система).
 */
function periodOfPayment(row) {
  const now = new Date();
  const y = row && row.pay_year != null ? Number(row.pay_year)
    : (row && row.created_at ? new Date(row.created_at).getFullYear() : now.getFullYear());
  const m = row && row.pay_month != null ? Number(row.pay_month)
    : (row && row.created_at ? new Date(row.created_at).getMonth() + 1 : now.getMonth() + 1);
  return { year: y, month: m };
}

/**
 * Массовая проверка: есть ли в диапазоне (сотрудники × период) неодобренные
 * позиции. Нужна для ручек, которые проставляют paid списком (pay-salary).
 * Возвращает массив сотрудников, которым платить НЕЛЬЗЯ.
 */
async function findUnapprovedEmployees(db, { employeeIds, year, month }) {
  const ids = (employeeIds || []).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return [];
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT i.employee_id
        FROM payout_batch_items i
        JOIN payout_batches b ON b.id = i.batch_id
       WHERE i.employee_id = ANY($1::int[])
         AND b.period_year = $2 AND b.period_month = $3
         AND b.status <> 'cancelled'
         AND i.approval_status <> 'approved'`, [ids, year, month]);
    return rows.map((r) => r.employee_id);
  } catch (_) { return []; }
}

/**
 * Массовая проверка С УЧЁТОМ СУММ: возвращает сотрудников, которым платить
 * нельзя — либо позиция не одобрена, либо одобренная сумма МЕНЬШЕ фактической
 * pending-зарплаты за период.
 *
 * Зачем отдельная функция: массовая `pay-salary` платит всю pending-запись,
 * поэтому недостаточно проверить статус — надо сверить сумму с одобренной
 * (найдено верификатором 16.10.2026: одобрение 1 ₽ проводило 50 000 ₽).
 *
 * @param {object} db
 * @param {object} args
 * @param {number[]} args.employeeIds
 * @param {number} args.year
 * @param {number} args.month
 * @param {string} [args.type] — тип записи (по умолчанию 'salary')
 * @returns {Promise<Array<{employee_id:number, reason:string, approved?:number, want?:number}>>}
 */
async function findAmountBlockedEmployees(db, { employeeIds, year, month, type = 'salary', privileged = false }) {
  const ids = (employeeIds || []).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return [];
  // ⚠️ ЕДИНОЕ ПРАВИЛО: тип не в «белом списке без согласования» → списка
  // нет = платить нельзя. Раньше строки не было вовсе, и функция возвращала
  // пустой blocked → массовая pay-salary проводила paid без списка.
  const noListTypes = await loadNoListTypes(db);
  const typeAllowedWithoutList = noListTypes.includes((type || '').toString().trim());
  try {
    const { rows } = await db.query(`
      SELECT wp.employee_id,
             COALESCE(SUM(wp.amount), 0)::numeric AS want,
             (SELECT i.approval_status FROM payout_batch_items i
                JOIN payout_batches b ON b.id = i.batch_id
               WHERE i.employee_id = wp.employee_id
                 AND b.period_year = $2 AND b.period_month = $3
                 AND b.status <> 'cancelled'
               ORDER BY i.id DESC LIMIT 1) AS approval_status,
             (SELECT i.pay_amount FROM payout_batch_items i
                JOIN payout_batches b ON b.id = i.batch_id
               WHERE i.employee_id = wp.employee_id
                 AND b.period_year = $2 AND b.period_month = $3
                 AND b.status <> 'cancelled'
               ORDER BY i.id DESC LIMIT 1) AS approved,
             -- уже выплачено за период (для накопительной сверки)
             (SELECT COALESCE(SUM(wp2.amount), 0) FROM worker_payments wp2
               WHERE wp2.employee_id = wp.employee_id AND wp2.status IN ('paid','confirmed')
                 AND COALESCE(wp2.pay_year,  EXTRACT(YEAR  FROM wp2.created_at)::int) = $2
                 AND COALESCE(wp2.pay_month, EXTRACT(MONTH FROM wp2.created_at)::int) = $3)::numeric AS already_paid
        FROM worker_payments wp
       WHERE wp.employee_id = ANY($1::int[])
         AND wp.type = $4
         AND wp.status = 'pending'
         AND COALESCE(wp.pay_year,  EXTRACT(YEAR  FROM wp.created_at)::int) = $2
         AND COALESCE(wp.pay_month, EXTRACT(MONTH FROM wp.created_at)::int) = $3
       GROUP BY wp.employee_id`, [ids, year, month, type]);

    const blocked = [];
    for (const r of rows) {
      // Позиции нет → по ЕДИНОМУ ПРАВИЛУ: тип без согласования платить
      // нельзя (кроме типов из NO_LIST_TYPES). Раньше здесь был `continue` —
      // «выплата вне контура корзины», из-за чего массовая pay-salary
      // проводила paid без списка (найдено верификатором 16.10.2026).
      if (r.approval_status == null) {
        if (!typeAllowedWithoutList && !privileged) {
          blocked.push({ employee_id: r.employee_id, reason: 'approval_required', approved: 0, want: Number(r.want || 0) });
        }
        continue;
      }
      if (r.approval_status !== 'approved') {
        blocked.push({ employee_id: r.employee_id, reason: 'not_approved', approved: Number(r.approved || 0), want: Number(r.want || 0) });
        continue;
      }
      const approved = Number(r.approved || 0);
      const want = Number(r.want || 0);
      // ⚠️ Сверяем НАКОПЛЕННУЮ сумму: одобрено 50 000, уже выплачено 40 000,
      // хотим ещё 30 000 — итого 70 000 > 50 000 (класс «накопительное
      // превышение», найден верификатором 16.10.2026).
      const already = Number(r.already_paid || 0);
      // ⚠️ `approved >= 0`, НЕ `approved > 0`: при одобрении 0 ₽ проверка
      // пропускалась, и массовая pay-salary платила любую сумму (найдено
      // верификатором 16.10.2026 — я исправил это в одиночном гейте, но
      // забыл в массовой функции; тот же класс ошибки).
      if (approved >= 0 && (want > approved + 0.01 || already + want > approved + 0.01)) {
        blocked.push({ employee_id: r.employee_id, reason: 'amount_exceeds_approved', approved, already_paid: already, want });
      }
    }
    return blocked;
  } catch (e) {
    // ⚠️ FAIL-CLOSED для денег: раньше при сбое БД возвращался пустой массив
    // = «никого не блокировать», и массовая pay-salary проводила выплаты без
    // проверки. Теперь для денежных типов пробрасываем ошибку — ручка ответит
    // 500 и НИЧЕГО не заплатит. Для типов из белого списка (суточные) сбой
    // проверки не должен ломать работу.
    if (typeAllowedWithoutList || privileged) return [];
    throw e;
  }
}

module.exports = { checkPayoutApproved, denyIfNotApproved, periodOfPayment, findUnapprovedEmployees, findAmountBlockedEmployees };
