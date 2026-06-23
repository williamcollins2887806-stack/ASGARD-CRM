'use strict';
/**
 * Унифицированный логгер для catch-блоков fastify-роутов.
 * Гарантирует, что в журнал попадёт stack trace (pino корректно сериализует err
 * только когда он в первом аргументе как поле объекта, не во втором).
 *
 * Применение:
 *   try { ... } catch (err) {
 *     logError(fastify, '[my-route] description', err, req);
 *     return reply.code(500).send({ error: 'Ошибка сервера' });
 *   }
 */
function logError(fastifyOrLog, tag, err, req) {
  const log = (fastifyOrLog && fastifyOrLog.log) || fastifyOrLog || console;
  const meta = {
    err: err,
    err_message: (err && err.message) || String(err),
    err_stack: (err && err.stack) || null,
    err_code: (err && err.code) || null,
  };
  if (req) {
    meta.req_url = req.url;
    meta.req_method = req.method;
    meta.req_id = req.id;
    if (req.user) meta.user_id = req.user.id;
    if (req.fieldEmployee) meta.field_employee_id = req.fieldEmployee.id;
  }
  log.error(meta, tag);
}

module.exports = { logError };
