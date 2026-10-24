'use strict';

/**
 * D-369 (заказчик 23.10.2026): сводный эндпоинт «Мои заявки» для мобильной
 * страницы.
 * ═══════════════════════════════════════════════════════════════════════════
 * ЗАЧЕМ ОТДЕЛЬНЫЙ РОУТ, А НЕ КЛИЕНТСКАЯ СКЛЕЙКА. Заказчик: «мобильный фронт
 * должен показывать ровно то, что показывает десктоп». Если мобилка начнёт
 * склеивать два запроса сама, списки неизбежно разойдутся: на десктопе правят
 * фильтр или добавляют поле — на телефоне останется старая картина.
 *
 * Поэтому здесь ОДИН ответ с двумя разделами, и оба считаются тем же кодом,
 * что и десктопные роуты:
 *   • `invoices`  — из `services/my-invoices.js`, который использует и
 *                   `GET /api/payment-invoices/my` (десктопная вкладка);
 *   • `purchases` — та же выборка, что `GET /api/procurement`, с тем же
 *                   серверным сужением по роли (`canViewAll`).
 *
 * РОЛИ — те же, что у десктопного `/my-procurement` (public/assets/js/app.js:2395):
 * PM, HEAD_PM, WAREHOUSE, ADMIN, PROC, TO, HEAD_TO, BUH, OFFICE_MANAGER, DIRECTOR_*.
 * Остальным отдаём 403 — прямой заход с телефона не должен открывать то, чего
 * у них нет на десктопе.
 */

const MY_REQUESTS_ROLES = [
  'PM', 'HEAD_PM', 'WAREHOUSE', 'ADMIN', 'PROC', 'TO', 'HEAD_TO',
  'BUH', 'OFFICE_MANAGER',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
];

/** Роли, у которых на десктопе есть вкладка заявок на закупку. */
const PURCHASE_ROLES = [
  'PM', 'HEAD_PM', 'PROC', 'ADMIN', 'WAREHOUSE', 'TO', 'HEAD_TO',
  'BUH', 'OFFICE_MANAGER',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
];

module.exports = async function myRequestsRoutes(fastify, opts) {
  const { db } = fastify;

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const role = String((req.user && req.user.role) || '');
    if (!MY_REQUESTS_ROLES.includes(role)) {
      return reply.code(403).send({ error: 'Нет доступа к разделу «Мои заявки»' });
    }

    const { myInvoices } = require('../services/my-invoices');

    // ── 1. Счета на согласование (главное для мобилки) ──────────────────
    let invoices;
    try {
      // `all=1` — только привилегированным: им нужна сводка по компании,
      // как на десктопе. Рядовой сотрудник видит только свои.
      const all = String((req.query && req.query.all) || '') === '1';
      invoices = await myInvoices(db, req.user, { all });
    } catch (e) {
      req.log.error('[my-requests] invoices: ' + (e && e.message));
      return reply.code(500).send({ error: 'Не удалось получить счета', detail: e && e.message });
    }

    // ── 2. Заявки на закупку (заглушка на мобилке, но данные честные) ────
    let purchases = { items: [], total: 0, available: false };
    if (PURCHASE_ROLES.includes(role)) {
      purchases.available = true;
      try {
        // Читаем ту же таблицу и с тем же сужением, что GET /api/procurement.
        // Отдельный лёгкий запрос: мобилке не нужны позиции и история, только
        // шапка заявки — иначе ответ распухает в разы.
        //
        // Правило скопировано из routes/procurement.js:10 (READ_ALL_ROLES) и
        // должно меняться вместе с ним: «видят все заявки» — директора, закупки,
        // бухгалтерия, HEAD_PM и склад. Остальные — только свои (pm_id = я).
        const READ_ALL = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
          'PROC', 'BUH', 'HEAD_PM', 'WAREHOUSE'];
        const canAll = READ_ALL.includes(role);

        const params = [];
        let where = '';
        if (!canAll) {
          params.push(req.user.id);
          where = ` WHERE pr.pm_id = $1`;
        }
        const { rows } = await db.query(
          `SELECT pr.id, pr.title, pr.status, pr.priority, pr.created_at,
                  pr.total_sum, pr.work_id, w.work_title,
                  (SELECT COUNT(*)::int FROM procurement_items pi
                    WHERE pi.procurement_id = pr.id AND pi.parent_item_id IS NULL) AS items_count
             FROM procurement_requests pr
             LEFT JOIN works w ON w.id = pr.work_id
             ${where}
            ORDER BY pr.id DESC
            LIMIT 50`, params);
        purchases = {
          items: rows.map((x) => ({
            id: x.id,
            title: x.title || x.work_title || `Заявка #${x.id}`,
            status: x.status,
            priority: x.priority,
            work_title: x.work_title || null,
            total_sum: Number(x.total_sum) || 0,
            items_count: Number(x.items_count) || 0,
            created_at: x.created_at
          })),
          total: rows.length,
          available: true
        };
      } catch (e) {
        // Закупки не должны валить страницу: счета — главное. Отдаём пусто и
        // помечаем, что раздел недоступен, мобилка покажет заглушку.
        req.log.warn('[my-requests] purchases: ' + (e && e.message));
        purchases = { items: [], total: 0, available: true, error: true };
      }
    }

    return {
      role,
      scope: invoices.scope,
      invoices,
      purchases,
      generated_at: new Date().toISOString()
    };
  });

  /** Справочник для мобилки: какие этапы бывают и как их подписывать. */
  fastify.get('/stages', { preHandler: [fastify.authenticate] }, async () => ({
    stages: [
      { code: 'draft', label: 'Черновик', hint: 'Ещё не отправлен директору' },
      { code: 'dir', label: 'У директора', hint: 'Ждёт решения' },
      { code: 'buh', label: 'У бухгалтерии', hint: 'Согласован, ждёт оплаты' },
      { code: 'paid', label: 'Оплачен', hint: 'Платёж проведён' },
      { code: 'rejected', label: 'Возвращён', hint: 'Директор вернул на доработку' },
      { code: 'expired', label: 'В архиве', hint: 'Не согласован за 7 дней' }
    ]
  }));
};

module.exports.MY_REQUESTS_ROLES = MY_REQUESTS_ROLES;
module.exports.PURCHASE_ROLES = PURCHASE_ROLES;
