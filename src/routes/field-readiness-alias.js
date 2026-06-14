// Backwards-compat alias: старый мобильный бандл зовёт /api/field/readiness*,
// фактические хендлеры живут в field-worker под /api/field/worker/readiness*.
// Прокидываем как 308 — axios/fetch автоматически следуют редиректу.
async function routes(fastify) {
  const redirect = (target) => async (req, reply) => {
    reply.code(308).header('Location', target).send();
  };
  fastify.get('/',            redirect('/api/field/worker/readiness'));
  fastify.get('/can-update',  redirect('/api/field/worker/readiness/can-update'));
  fastify.put('/',            redirect('/api/field/worker/readiness'));
}
module.exports = routes;
