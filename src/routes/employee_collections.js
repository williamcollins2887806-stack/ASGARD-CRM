// ASGARD CRM — Employee Collections API (Подборки сотрудников)
const HR_ROLES = ["ADMIN", "HR", "HR_MANAGER", "DIRECTOR_GEN", "DIRECTOR_COMM", "DIRECTOR_DEV"];

async function routes(fastify, options) {
  const db = fastify.pg || fastify.db;

  // GET /api/employee-collections — list all active collections
  fastify.get("/", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!HR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: "Недостаточно прав" });
    }
    const result = await db.query(`
      SELECT ec.*, u.name as created_by_name,
        (SELECT COUNT(*) FROM employee_collection_items eci WHERE eci.collection_id = ec.id) as employee_count
      FROM employee_collections ec
      LEFT JOIN users u ON u.id = ec.created_by
      WHERE ec.is_active = true
      ORDER BY ec.updated_at DESC
    `);
    return { success: true, collections: result.rows };
  });

  // GET /api/employee-collections/:id — get collection with employees
  fastify.get("/:id", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!HR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: "Недостаточно прав" });
    }
    const { id } = request.params;
    const col = await db.query("SELECT * FROM employee_collections WHERE id = $1 AND is_active = true", [id]);
    if (!col.rows[0]) return reply.code(404).send({ error: "Подборка не найдена" });

    const items = await db.query(`
      SELECT e.id, e.fio, e.full_name, e.role_tag, e.phone, e.email, e.city, e.rating_avg, e.is_active, e.grade,
             eci.added_at, u.name as added_by_name
      FROM employee_collection_items eci
      JOIN employees e ON e.id = eci.employee_id
      LEFT JOIN users u ON u.id = eci.added_by
      WHERE eci.collection_id = $1
      ORDER BY e.fio
    `, [id]);

    return { success: true, collection: col.rows[0], employees: items.rows };
  });

  // POST /api/employee-collections — create collection
  fastify.post("/", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!HR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: "Недостаточно прав" });
    }
    const { name, description } = request.body || {};
    if (!name || !name.trim()) return reply.code(400).send({ error: "Укажите название подборки" });

    const result = await db.query(
      "INSERT INTO employee_collections (name, description, created_by) VALUES ($1, $2, $3) RETURNING *",
      [name.trim(), (description || "").trim(), request.user.id]
    );
    return { success: true, collection: result.rows[0] };
  });

  // PUT /api/employee-collections/:id — update collection
  fastify.put("/:id", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!HR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: "Недостаточно прав" });
    }
    const { id } = request.params;
    const { name, description } = request.body || {};
    if (!name || !name.trim()) return reply.code(400).send({ error: "Укажите название подборки" });

    const result = await db.query(
      "UPDATE employee_collections SET name = $1, description = $2, updated_at = NOW() WHERE id = $3 AND is_active = true RETURNING *",
      [name.trim(), (description || "").trim(), id]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: "Подборка не найдена" });
    return { success: true, collection: result.rows[0] };
  });

  // DELETE /api/employee-collections/:id — soft-delete
  fastify.delete("/:id", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!HR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: "Недостаточно прав" });
    }
    const { id } = request.params;
    await db.query("UPDATE employee_collections SET is_active = false, updated_at = NOW() WHERE id = $1", [id]);
    return { success: true };
  });

  // POST /api/employee-collections/:id/employees — add employees
  fastify.post("/:id/employees", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!HR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: "Недостаточно прав" });
    }
    const { id } = request.params;
    const { employee_ids } = request.body || {};
    if (!Array.isArray(employee_ids) || !employee_ids.length) {
      return reply.code(400).send({ error: "Укажите сотрудников" });
    }

    const col = await db.query("SELECT id FROM employee_collections WHERE id = $1 AND is_active = true", [id]);
    if (!col.rows[0]) return reply.code(404).send({ error: "Подборка не найдена" });

    let added = 0;
    for (const empId of employee_ids) {
      try {
        await db.query(
          "INSERT INTO employee_collection_items (collection_id, employee_id, added_by) VALUES ($1, $2, $3) ON CONFLICT (collection_id, employee_id) DO NOTHING",
          [id, empId, request.user.id]
        );
        added++;
      } catch (e) { /* skip invalid employee_id */ }
    }

    await db.query("UPDATE employee_collections SET updated_at = NOW() WHERE id = $1", [id]);
    return { success: true, added };
  });

  // DELETE /api/employee-collections/:id/employees/:empId — remove employee
  fastify.delete("/:id/employees/:empId", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    if (!HR_ROLES.includes(request.user.role)) {
      return reply.code(403).send({ error: "Недостаточно прав" });
    }
    const { id, empId } = request.params;
    await db.query("DELETE FROM employee_collection_items WHERE collection_id = $1 AND employee_id = $2", [id, empId]);
    await db.query("UPDATE employee_collections SET updated_at = NOW() WHERE id = $1", [id]);
    return { success: true };
  });
}

module.exports = routes;
