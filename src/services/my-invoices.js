'use strict';

/**
 * D-369 (заказчик 23.10.2026): сервис «мои заявки» — единый источник для
 * мобильной страницы и для существующего `GET /api/payment-invoices/my`.
 * ═══════════════════════════════════════════════════════════════════════════
 * ЗАЧЕМ. Заказчик: «сделай на мобильном страницу Мои заявки для всех ролей,
 * покажи ровно то, что показывает десктоп». Значит мобилка не должна собирать
 * свой запрос — иначе списки разойдутся: на десктопе появится фильтр или новое
 * поле, а на телефоне останется старая картина.
 *
 * Поэтому вся выборка «моих счетов» живёт здесь, и её вызывают оба входа:
 *   • `GET /api/payment-invoices/my` (десктоп, вкладка «Счета на оплату»);
 *   • `GET /api/my-requests` (мобилка, новая страница).
 *
 * РОЛИ. Привилегированные (ADMIN, BUH, PROC, HEAD_PM, HEAD_TO, DIRECTOR_*)
 * видят все счета — им нужна сводка. Остальные (PM, TO, WAREHOUSE,
 * OFFICE_MANAGER) — только свои (`created_by = me`). Это то же правило, что
 * было в роуте, вынесено без изменений.
 */

/** Роли, которым доступна сводка по ВСЕМ счетам (не только своим). */
function seesAllInvoices(role) {
  const r = String(role || '');
  return ['ADMIN', 'BUH', 'PROC', 'HEAD_PM', 'HEAD_TO'].includes(r) || /^DIRECTOR/.test(r);
}

/** Человеческий этап счёта для карточки инициатора. */
function stageOf(x) {
  if (x.status === 'awaiting_dir') return { code: 'dir', label: 'У директора', cls: 'warn' };
  if (x.status === 'rejected') return { code: 'rejected', label: 'Возвращён', cls: 'err' };
  if (x.status === 'expired' || x.status === 'archived') return { code: 'expired', label: 'В архиве (не согласован)', cls: 'muted' };
  if (x.payment_status === 'paid' || x.status === 'paid') return { code: 'paid', label: 'Оплачен', cls: 'ok' };
  if (x.status === 'pending_payment') return { code: 'buh', label: 'У бухгалтерии', cls: 'info' };
  if (x.status === 'draft') return { code: 'draft', label: 'Черновик', cls: 'muted' };
  return { code: 'other', label: x.status || '—', cls: 'muted' };
}

/**
 * Список «моих» счетов на оплату.
 *
 * @param {object} db — pg Client/Pool
 * @param {{id:number, role:string}} user — текущий пользователь
 * @param {{all?:boolean, limit?:number}} [opts]
 *   all=true (только для привилегированных) — вернуть все счета, а не свои.
 * @returns {Promise<{items:Array, total:number, kpi:object, scope:'all'|'mine'}>}
 */
async function myInvoices(db, user, opts = {}) {
  const role = String((user && user.role) || '');
  const userId = user && user.id;
  const privileged = seesAllInvoices(role);
  // `all` уважаем ТОЛЬКО у привилегированных: иначе PM мог бы попросить ?all=1
  // и увидеть чужие счета. Это та же защита, что была в роуте.
  const wantAll = !!opts.all && privileged;
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 200, 1), 500);

  const params = [];
  let where = '';
  if (!wantAll) {
    params.push(userId);
    where = ' WHERE pi.created_by = $1';
  }

  const { rows } = await db.query(
    `SELECT pi.id, pi.supplier_name, pi.amount, pi.status, pi.payment_status, pi.pay_timing,
            pi.due_date, pi.created_at, pi.updated_at, pi.invoice_number, pi.invoice_date,
            pi.basis_text, pi.file_path, pi.file_name, pi.doc_registry_id,
            pi.contract_basis_number, pi.contract_missing, pi.work_hint,
            pi.vat_amount, pi.vat_rate, pi.amount_net,
              pi.spend_kind, pi.sf_due_at, pi.service_done_at, pi.sf_basis,
              pi.counterparty_inn,
            pi.initiator_intent, pi.pp_number, pi.payee_requisites,
            pi.approval_expires_at, pi.dir_approved_at, pi.buh_acted_at,
            pi.submitted_at, pi.batch_id, pi.created_by,
            pi.line_items_json,
            u.name AS initiator_name,
            d.work_id AS registry_work_id, w.work_title AS work_title,
            (SELECT count(*)::int FROM price_records pr WHERE pr.doc_registry_id = pi.doc_registry_id) AS lines_count
       FROM payment_invoices pi
       LEFT JOIN users u ON u.id = pi.created_by
       LEFT JOIN doc_registry d ON d.id = pi.doc_registry_id
       LEFT JOIN works w ON w.id = d.work_id
       ${where}
      ORDER BY
        CASE pi.status WHEN 'awaiting_dir' THEN 0 WHEN 'pending_payment' THEN 1
                       WHEN 'rejected' THEN 2 WHEN 'paid' THEN 3 ELSE 4 END,
        pi.id DESC
      LIMIT ${limit}`,
    params
  );

  const items = rows.map((x) => {
    // Число позиций: в реестре (price_records) ИЛИ в самой заявке (line_items_json).
    // У черновиков реестра ещё нет — там только line_items_json, и без этого
    // счётчик показывал 0 у свежего счёта, хотя позиции распознаны.
    let lines = Number(x.lines_count) || 0;
    if (!lines && Array.isArray(x.line_items_json)) lines = x.line_items_json.length;
    const base = { ...x };
    delete base.line_items_json;
    return {
      ...base,
      stage: stageOf(x),
      work_title: x.work_title || null,
      lines_count: lines,
      is_mine: Number(x.created_by) === Number(userId)
    };
  });

  // KPI — те же пять плиток, что на десктопе (procurement-page.js:1802-1842),
  // чтобы мобильная шапка и десктопная считали одинаково.
  const sum = (arr) => arr.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const byCode = (code) => items.filter((x) => x.stage.code === code);
  // ВАЖНО: плитки «Срочные» здесь сознательно нет. Поле `initiator_intent='urgent'`
  // читается в трёх местах (approval.js:427, approvalService.js:1315,
  // procurement-page.js:1799), но НЕ выставляется нигде при создании счёта —
  // на проде 0 из 41. Считать по нему KPI значило бы рисовать всегда ноль.
  const kpi = {
    total: items.length,
    total_sum: Math.round(sum(items) * 100) / 100,
    dir: byCode('dir').length,
    dir_sum: Math.round(sum(byCode('dir')) * 100) / 100,
    buh: byCode('buh').length,
    buh_sum: Math.round(sum(byCode('buh')) * 100) / 100,
    paid: byCode('paid').length,
    paid_sum: Math.round(sum(byCode('paid')) * 100) / 100,
    rejected: byCode('rejected').length,
    draft: byCode('draft').length,
    expired: byCode('expired').length
  };

  return { items, total: items.length, kpi, scope: wantAll ? 'all' : 'mine' };
}

module.exports = { myInvoices, seesAllInvoices, stageOf };
