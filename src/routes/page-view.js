'use strict';

/**
 * ASGARD CRM — учёт заходов на страницы (D-274).
 *
 * Лёгкая телеметрия для tools/pages-inventory. Клиент на каждом рендере страницы
 * шлёт GET /api/page-view?page=<ключ> (ключ = хэш-роут без ведущего «/»).
 * Веб-сервер пишет 200-запрос в access.log, tools/pages-inventory/extract-logs.sh
 * считает входы по page=.
 *
 * Роль прежнего /api/hints?page=<ключ> передана сюда: тот эндпоинт на каждый
 * переход выполнял пакет SQL-запросов, хотя его ответ для учёта не нужен.
 * Здесь SQL НЕ выполняется — только проверка токена.
 *
 * Ответ намеренно не отражает page: неэкранированный ввод не попадает в тело.
 */

const PAGE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function pageViewRoutes(fastify) {
  fastify.get('/page-view', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const page = request.query.page || '';
    // Ключ валидируем, но в ответ не возвращаем — тело фиксированное.
    return { ok: true, valid: PAGE_KEY_RE.test(page) };
  });
}

module.exports = pageViewRoutes;
