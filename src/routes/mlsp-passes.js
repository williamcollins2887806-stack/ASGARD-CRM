'use strict';

/**
 * МЛСП · пропуска и транспорт
 * Prefix: /api/mlsp-passes
 */

const { evaluateApplication, registrySignal, ymd, addDays, fmtRu } = require('../services/mlsp-passes-rules');
const { buildApplicationExcel, buildPreviewMatrix, filenameFor } = require('../services/mlsp-passes-excel');
const dadata = require('../services/dadata');

const VIEW_ROLES = [
  'ADMIN', 'HR', 'HR_MANAGER', 'OFFICE_MANAGER', 'PM', 'HEAD_PM',
  'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'
];
const WRITE_ROLES = VIEW_ROLES;

/** Канон ЕГРЮЛ (проверено): ГНШ 7725610285, Снабжение 5501072608, Аврора 5190087937 */
const GNSH_NAME = 'ООО «Газпром нефть шельф»';
const GNSH_INN = '7725610285';
const SUPPLY_NAME = 'ООО «Газпромнефть-Снабжение»';
const SUPPLY_INN = '5501072608';
const AURORA_NAME = 'АО «Аврора Логистика»';
const AURORA_INN = '5190087937';

function parseIds(body) {
  const raw = body?.employee_ids || body?.people_ids || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
}

async function loadPack(db) {
  const { rows } = await db.query(
    `SELECT code, label, severity, sort_order, is_active
       FROM mlsp_requirement_pack
      WHERE is_active = true
      ORDER BY sort_order, code`
  );
  return rows;
}

async function loadEmployeesRich(db, ids) {
  if (!ids.length) return [];
  const { rows: emps } = await db.query(
    `SELECT e.id, e.fio, e.phone, e.position, e.birth_date, e.birth_place,
            e.passport_series, e.passport_number, e.passport_date, e.passport_issued,
            e.registration_address, e.department
       FROM employees e
      WHERE e.id = ANY($1::int[])`,
    [ids]
  );

  let permits = [];
  try {
    const r = await db.query(
      `SELECT ep.employee_id, ep.expiry_date, ep.issue_date, ep.document_number,
              pt.code, pt.name
         FROM employee_permits ep
         JOIN permit_types pt ON pt.id = ep.type_id
        WHERE ep.employee_id = ANY($1::int[])
          AND COALESCE(ep.is_active, true) = true`,
      [ids]
    );
    permits = r.rows;
  } catch (e) {
    console.warn('[mlsp-passes] permits query:', e.message);
  }

  let stays = [];
  try {
    const r = await db.query(
      `SELECT s.*
         FROM mlsp_stays s
        WHERE s.employee_id = ANY($1::int[])
          AND s.actual_departed_at IS NULL
        ORDER BY s.arrived_at DESC`,
      [ids]
    );
    stays = r.rows;
  } catch (e) {
    console.warn('[mlsp-passes] stays query:', e.message);
  }

  const stayByEmp = {};
  for (const s of stays) {
    if (!stayByEmp[s.employee_id]) {
      stayByEmp[s.employee_id] = {
        ...s,
        is_open: true,
        days_on_platform: s.arrived_at
          ? Math.max(0, Math.round((Date.now() - new Date(s.arrived_at)) / 86400000))
          : null
      };
    }
  }

  const permByEmp = {};
  for (const p of permits) {
    (permByEmp[p.employee_id] || (permByEmp[p.employee_id] = [])).push(p);
  }

  const byId = Object.fromEntries(emps.map((e) => [e.id, e]));
  return ids.map((id) => {
    const e = byId[id];
    if (!e) return null;
    const plist = permByEmp[id] || [];
    const fsb = plist.find((p) => String(p.code).toUpperCase() === 'FSB');
    return {
      ...e,
      org: 'ООО «АСГАРД-Сервис»',
      permits: plist,
      mlsp_stay: stayByEmp[id] || null,
      fsb_doc: fsb
        ? [fsb.document_number, fsb.expiry_date && fmtRu(fsb.expiry_date)].filter(Boolean).join(' · ')
        : '',
      permits_text: fsb ? 'пропуск ФСБ' : ''
    };
  }).filter(Boolean);
}

async function nextOutgoing(db, client) {
  const q = client || db;
  const { rows } = await q.query(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
       FROM mlsp_outgoing_registry
      WHERE series = '141603'`
  );
  const seq = Number(rows[0].next_seq) || 1;
  const number = `141603/${String(seq).padStart(2, '0')}`;
  return { series: '141603', seq, number };
}

async function loadContractMeta(db, contractNumber) {
  if (!contractNumber) return null;
  const { rows } = await db.query(
    `SELECT * FROM mlsp_contract_meta WHERE contract_number = $1`,
    [contractNumber]
  );
  if (rows[0]) return rows[0];
  // fallback: contracts table
  let c;
  try {
    c = await db.query(
      `SELECT id, number, counterparty_name, customer_name, customer_inn, end_date, start_date, subject
         FROM contracts
        WHERE number = $1
        LIMIT 1`,
      [contractNumber]
    );
  } catch (e) {
    console.warn('[mlsp-passes] contracts lookup:', e.message);
    return { contract_number: contractNumber };
  }
  if (!c.rows[0]) return { contract_number: contractNumber };
  return {
    contract_id: c.rows[0].id,
    contract_number: c.rows[0].number,
    counterparty_name: c.rows[0].counterparty_name || c.rows[0].customer_name,
    end_date: c.rows[0].end_date,
    subject: c.rows[0].subject
  };
}

function enrichRegistryRow(row) {
  const sig = registrySignal(row);
  const planned = ymd(row.planned_ready) || (ymd(row.request_date) ? addDays(ymd(row.request_date), 45) : null);
  return {
    ...row,
    request_date: ymd(row.request_date),
    planned_ready: planned,
    curator_confirm_date: ymd(row.curator_confirm_date),
    issued_date: ymd(row.issued_date),
    signal: sig.signal,
    signal_label: sig.label,
    overdue_days: sig.overdue_days
  };
}

async function routes(fastify) {
  const db = fastify.db;

  // ── Dashboard pulse ──────────────────────────────────────────
  fastify.get('/pulse', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async () => {
    const reg = await db.query(`SELECT * FROM mlsp_pass_registry`);
    const items = reg.rows.map(enrichRegistryRow);
    const next = await nextOutgoing(db);
    let legs = { rows: [{ n: 0 }] };
    try {
      legs = await db.query(
        `SELECT COUNT(*)::int AS n FROM mlsp_transport_legs
          WHERE leg_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`
      );
    } catch (e) {
      console.warn('[mlsp-passes] legs pulse:', e.message);
    }
    return {
      registry: {
        total: items.length,
        breach: items.filter((i) => i.signal === 'breach').length,
        no_confirm: items.filter((i) => i.signal === 'no_confirm').length,
        due_soon: items.filter((i) => i.signal === 'due_soon').length,
        in_work: items.filter((i) => ['Подана', 'Подтверждена', 'В работе'].includes(i.status)).length
      },
      next_outgoing: next.number,
      legs_next_7d: legs.rows[0]?.n || 0
    };
  });

  // ── Contracts meta + CRM contracts for GNSH ──────────────────
  fastify.get('/contracts', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async () => {
    const meta = await db.query(`SELECT * FROM mlsp_contract_meta ORDER BY contract_number`);
    const crm = await db.query(
      `SELECT id, number, counterparty_name, customer_name, customer_inn, subject,
              start_date, end_date, status, amount
         FROM contracts
        WHERE number ILIKE 'ГНШ-%'
           OR counterparty_name ILIKE '%шельф%'
           OR customer_name ILIKE '%шельф%'
        ORDER BY number`
    ).catch((e) => {
      request.log.warn(e, 'contracts GNSH list');
      return { rows: [] };
    });
    return { meta: meta.rows, contracts: crm.rows };
  });

  // Ensure counterparties + GNSH contracts exist in CRM
  fastify.post('/ensure-counterparties', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request) => {
    const created = { customers: [], contracts: [] };

    async function upsertCustomer(inn, name) {
      let existing;
      try {
        existing = await db.query(
          `SELECT inn, name FROM customers
            WHERE inn = $1 OR name ILIKE $2
            LIMIT 1`,
          [inn, '%' + name.replace(/[«»"]/g, '') + '%']
        );
      } catch (e) {
        request.log.warn(e, 'customers lookup ' + inn);
        existing = { rows: [] };
      }
      if (existing.rows[0]) return existing.rows[0];
      const ins = await db.query(
        `INSERT INTO customers (inn, name, full_name)
         VALUES ($1, $2, $2)
         ON CONFLICT (inn) DO UPDATE SET name = EXCLUDED.name
         RETURNING inn, name`,
        [inn, name]
      ).catch(async (e) => {
        // maybe different PK
        request.log.warn(e, 'customers upsert');
        return { rows: [{ inn, name, skipped: true }] };
      });
      created.customers.push(ins.rows[0]);
      return ins.rows[0];
    }

    // DaData — уточняем названия по ИНН, если токен есть
    const parties = [
      { inn: GNSH_INN, fallback: GNSH_NAME },
      { inn: SUPPLY_INN, fallback: SUPPLY_NAME },
      { inn: AURORA_INN, fallback: AURORA_NAME }
    ];
    for (const p of parties) {
      let name = p.fallback;
      try {
        const hit = await dadata.resolveByInn(p.inn);
        if (hit?.name) name = hit.name;
      } catch (e) {
        request.log.warn({ err: e.message, inn: p.inn }, 'dadata resolve');
      }
      await upsertCustomer(p.inn, name);
    }

    const { rows: meta } = await db.query(`SELECT * FROM mlsp_contract_meta`);
    for (const m of meta) {
      let exists;
      try {
        exists = await db.query(
          `SELECT id, number FROM contracts WHERE number = $1 LIMIT 1`,
          [m.contract_number]
        );
      } catch (e) {
        request.log.warn(e, 'contract exists ' + m.contract_number);
        exists = { rows: [] };
      }
      if (exists.rows[0]) {
        try {
          await db.query(
            `UPDATE mlsp_contract_meta SET contract_id = $1, updated_at = NOW() WHERE id = $2`,
            [exists.rows[0].id, m.id]
          );
        } catch (e) {
          request.log.warn(e, 'meta link ' + m.contract_number);
        }
        continue;
      }
      const ins = await db.query(
        `INSERT INTO contracts (
           number, type, counterparty_id, counterparty_name, customer_inn, customer_name,
           subject, end_date, status, comment, created_at
         ) VALUES (
           $1, 'customer', $2, $3, $2, $3,
           $4, $5, 'active',
           'Создан из модуля МЛСП · пропуска (договоры ГНШ)',
           NOW()
         ) RETURNING id, number`,
        [
          m.contract_number,
          GNSH_INN,
          GNSH_NAME,
          'Работы / услуги на МЛСП «Приразломная»',
          m.end_date || null
        ]
      ).catch((e) => {
        request.log.warn(e, 'contract insert ' + m.contract_number);
        return { rows: [] };
      });
      if (ins.rows[0]) {
        created.contracts.push(ins.rows[0]);
        await db.query(
          `UPDATE mlsp_contract_meta SET contract_id = $1, counterparty_inn = $2, updated_at = NOW() WHERE id = $3`,
          [ins.rows[0].id, GNSH_INN, m.id]
        );
      }
    }
    return { ok: true, created };
  });

  // ── People search (Дружина) with permit chips ────────────────
  fastify.get('/people', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request) => {
    const q = String(request.query.q || '').trim();
    const limit = Math.min(Number(request.query.limit) || 40, 100);
    const params = [];
    let sql = `
      SELECT e.id, e.fio, e.phone, e.position, e.birth_date, e.passport_date,
             e.passport_series, e.passport_number, e.registration_address
        FROM employees e
       WHERE COALESCE(e.is_active, true) = true
         AND COALESCE(e.readiness_status, '') <> 'archive'`;
    if (q) {
      params.push('%' + q.replace(/\s+/g, '%') + '%');
      sql += ` AND (e.fio ILIKE $${params.length} OR e.phone ILIKE $${params.length})`;
    }
    params.push(limit);
    sql += ` ORDER BY e.fio LIMIT $${params.length}`;
    const { rows } = await db.query(sql, params);
    const ids = rows.map((r) => r.id);
    const rich = ids.length ? await loadEmployeesRich(db, ids) : [];
    const map = Object.fromEntries(rich.map((r) => [r.id, r]));
    const pack = await loadPack(db);
    return {
      items: rows.map((r) => {
        const full = map[r.id] || r;
        const evalOne = evaluateApplication({
          appType: 'flight',
          people: [full],
          dateFrom: ymd(new Date()),
          pack
        });
        return {
          ...full,
          chip_blocks: evalOne.blocks.length,
          chip_warnings: evalOne.warnings.length,
          blocks: evalOne.blocks,
          warnings: evalOne.warnings.filter((w) => ['FSB', 'MLSP_PASS', 'passport_soon'].includes(w.code))
        };
      })
    };
  });

  // ── Validate selection ───────────────────────────────────────
  fastify.post('/validate', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request) => {
    const body = request.body || {};
    const ids = parseIds(body);
    const people = await loadEmployeesRich(db, ids);
    // allow inline people snapshots
    if (Array.isArray(body.people) && body.people.length && !ids.length) {
      people.push(...body.people);
    }
    const meta = await loadContractMeta(db, body.contract_number);
    const pack = await loadPack(db);
    const openReg = await db.query(
      `SELECT * FROM mlsp_pass_registry
        WHERE status NOT IN ('Готова', 'Сорвана')`
    );
    let legs = { rows: [] };
    if (ids.length) {
      try {
        legs = await db.query(
          `SELECT * FROM mlsp_transport_legs
            WHERE employee_id = ANY($1::int[])
              AND leg_date BETWEEN $2::date - 2 AND $3::date + 2`,
          [ids, body.date_from || new Date(), body.date_to || body.date_from || new Date()]
        );
      } catch (e) {
        console.warn('[mlsp-passes] validate legs:', e.message);
      }
    }

    const result = evaluateApplication({
      appType: body.app_type || body.type || 'flight',
      people,
      dateFrom: body.date_from,
      dateTo: body.date_to,
      direction: body.direction,
      pack,
      openRegistry: openReg.rows,
      otherLegs: legs.rows,
      contractMeta: meta || {},
      contractNumber: body.contract_number,
      mvz: body.mvz || meta?.mvz
    });
    return { ...result, people, contract: meta };
  });

  // ── Applications CRUD ────────────────────────────────────────
  fastify.get('/applications', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request) => {
    const type = request.query.type || null;
    const params = [];
    let sql = `SELECT * FROM mlsp_applications WHERE status <> 'cancelled'`;
    if (type) {
      params.push(type);
      sql += ` AND app_type = $${params.length}`;
    }
    sql += ` ORDER BY created_at DESC LIMIT 200`;
    const { rows } = await db.query(sql, params);
    return { items: rows };
  });

  fastify.get('/applications/:id', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const { rows } = await db.query(`SELECT * FROM mlsp_applications WHERE id = $1`, [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return rows[0];
  });

  fastify.post('/applications', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const body = request.body || {};
    const appType = body.app_type || body.type;
    if (!appType) return reply.code(400).send({ error: 'Нужен app_type' });

    const ids = parseIds(body);
    const people = await loadEmployeesRich(db, ids);
    const meta = await loadContractMeta(db, body.contract_number);
    const pack = await loadPack(db);
    const openReg = await db.query(`SELECT * FROM mlsp_pass_registry WHERE status NOT IN ('Готова','Сорвана')`);
    const validation = evaluateApplication({
      appType,
      people,
      dateFrom: body.date_from,
      dateTo: body.date_to,
      direction: body.direction,
      pack,
      openRegistry: openReg.rows,
      contractMeta: meta || {},
      contractNumber: body.contract_number,
      mvz: body.mvz || meta?.mvz
    });

    const force = !!body.force;
    if (!validation.ok && !force) {
      return reply.code(422).send({
        error: 'Есть блокирующие замечания',
        ...validation
      });
    }
    if (validation.warnings.length && !body.accept_warnings && !force) {
      // warnings alone don't block create — only export; allow draft
    }

    let outgoing = body.outgoing_number || null;
    if (appType === 'pass_mlsp' && !outgoing) {
      const n = await nextOutgoing(db);
      outgoing = n.number;
    }

    const peopleSnap = people.map((p) => ({
      id: p.id,
      fio: p.fio,
      phone: p.phone,
      position: p.position,
      birth_date: ymd(p.birth_date),
      birth_place: p.birth_place,
      passport_series: p.passport_series,
      passport_number: p.passport_number,
      passport_date: ymd(p.passport_date),
      passport_issued: p.passport_issued,
      registration_address: p.registration_address,
      department: p.department,
      order_number: p.order_number,
      order_date: ymd(p.order_date),
      labor_term: p.labor_term,
      org: p.org,
      mvz: body.mvz || meta?.mvz || null,
      curator: body.curator || meta?.curator || null,
      contract_number: body.contract_number || meta?.contract_number,
      fsb_doc: p.fsb_doc,
      permits_text: p.permits_text,
      mode: p.mode,
      vehicle: p.vehicle,
      leg_direction: p.leg_direction
    }));

    const { rows } = await db.query(
      `INSERT INTO mlsp_applications (
         app_type, status, contract_id, contract_number, curator, ship_curator, mvz,
         route_text, date_from, date_to, direction, transport, outgoing_number,
         subject_text, purpose_text, pass_kind, payload, people, warnings, blocks, created_by
       ) VALUES (
         $1,'draft',$2,$3,$4,$5,$6,
         $7,$8,$9,$10,$11,$12,
         $13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20
       ) RETURNING *`,
      [
        appType,
        meta?.contract_id || body.contract_id || null,
        body.contract_number || meta?.contract_number || null,
        body.curator || meta?.curator || null,
        body.ship_curator || meta?.ship_curator || null,
        body.mvz || meta?.mvz || null,
        body.route_text || null,
        body.date_from || null,
        body.date_to || null,
        body.direction || null,
        body.transport || (appType === 'ship' ? 'ship' : appType === 'flight' ? 'plane' : null),
        outgoing,
        body.subject_text || null,
        body.purpose_text || null,
        body.pass_kind || null,
        JSON.stringify(body.payload || {}),
        JSON.stringify(peopleSnap),
        JSON.stringify(validation.warnings),
        JSON.stringify(validation.blocks),
        request.user?.id || null
      ]
    );
    return { item: rows[0], validation };
  });

  // ── Export excel ─────────────────────────────────────────────
  fastify.get('/applications/:id/excel', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const { rows } = await db.query(`SELECT * FROM mlsp_applications WHERE id = $1`, [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const app = rows[0];
    const force = String(request.query.force || '') === '1';
    const blocks = Array.isArray(app.blocks) ? app.blocks : [];
    if (blocks.length && !force) {
      return reply.code(422).send({ error: 'Есть BLOCK — исправьте или force=1', blocks });
    }
    const buf = await buildApplicationExcel({
      ...app,
      people: app.people || [],
      contract_end: (await loadContractMeta(db, app.contract_number))?.end_date
    });
    await db.query(
      `UPDATE mlsp_applications
          SET status = CASE WHEN status = 'draft' THEN 'exported' ELSE status END,
              exported_at = COALESCE(exported_at, NOW()),
              updated_at = NOW()
        WHERE id = $1`,
      [app.id]
    );
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${filenameFor(app)}"`)
      .send(buf);
  });

  // Preview: матрица листа как после выгрузки (паритет с Excel)
  fastify.get('/applications/:id/preview', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const { rows } = await db.query(`SELECT * FROM mlsp_applications WHERE id = $1`, [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const app = rows[0];
    const meta = await loadContractMeta(db, app.contract_number);
    const matrix = await buildPreviewMatrix({
      ...app,
      people: app.people || [],
      contract_end: meta?.end_date
    });
    return {
      app_type: app.app_type,
      outgoing_number: app.outgoing_number,
      contract_number: app.contract_number,
      date_from: ymd(app.date_from),
      date_to: ymd(app.date_to),
      route_text: app.route_text,
      people: app.people,
      blocks: app.blocks,
      warnings: app.warnings,
      fsb_form_draft: app.app_type === 'pass_fsb',
      sheet: matrix
    };
  });

  // Preview без сохранения заявки (черновик генератора)
  fastify.post('/preview-draft', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const body = request.body || {};
    const ids = parseIds(body);
    const people = await loadEmployeesRich(db, ids);
    const missing = ids.filter((id) => !people.find((p) => p && p.id === id));
    if (missing.length) return reply.code(400).send({ error: 'Сотрудники не найдены', missing });
    const meta = await loadContractMeta(db, body.contract_number);
    const app = {
      app_type: body.app_type,
      contract_number: body.contract_number || '',
      curator: body.curator || meta?.curator || '',
      ship_curator: body.ship_curator || meta?.ship_curator || body.curator || '',
      mvz: body.mvz || meta?.mvz || '',
      date_from: body.date_from,
      date_to: body.date_to || null,
      direction: body.direction || 'inbound',
      transport: body.transport || 'plane',
      route_text: body.route_text || '',
      purpose_text: body.purpose_text || '',
      subject_text: body.subject_text || '',
      pass_kind: body.pass_kind || '',
      outgoing_number: body.outgoing_number || null,
      contract_end: meta?.end_date || null,
      people: people.map((p) => ({
        ...p,
        curator: body.curator || meta?.curator || '',
        contract_number: body.contract_number || '',
        mvz: body.mvz || meta?.mvz || p.mvz || ''
      })),
      payload: body.payload || {}
    };
    const matrix = await buildPreviewMatrix(app);
    return { sheet: matrix, people_count: people.length };
  });

  // Finalize MLSP pass → outgoing registry + pass registry row
  fastify.post('/applications/:id/register-pass', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const { rows } = await db.query(`SELECT * FROM mlsp_applications WHERE id = $1`, [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const app = rows[0];
    if (app.app_type !== 'pass_mlsp') return reply.code(400).send({ error: 'Только для pass_mlsp' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      let number = app.outgoing_number;
      let seq = null;
      if (!number) {
        const n = await nextOutgoing(db, client);
        number = n.number;
        seq = n.seq;
      } else {
        const m = /\/(\d+)$/.exec(number);
        seq = m ? Number(m[1]) : null;
      }
      if (seq != null) {
        await client.query(
          `INSERT INTO mlsp_outgoing_registry (series, seq, number, issued_at, contract_number, note, application_id, created_by)
           VALUES ('141603', $1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7)
           ON CONFLICT (number) DO NOTHING`,
          [seq, number, app.date_from, app.contract_number, request.body?.note || null, app.id, request.user?.id || null]
        );
      }
      const reqDate = ymd(request.body?.request_date) || ymd(app.date_from) || ymd(new Date());
      const { rows: reg } = await client.query(
        `INSERT INTO mlsp_pass_registry (
           responsible_name, contract_number, request_no, request_date, planned_ready,
           curator, status, application_id, outgoing_number, people_count, comment, created_by
         ) VALUES (
           $1,$2,$3,$4::date,($4::date + 45),$5,'Подана',$6,$7,$8,$9,$10
         ) RETURNING *`,
        [
          request.body?.responsible_name || request.user?.name || 'Хосе',
          app.contract_number,
          request.body?.request_no || null,
          reqDate,
          app.curator,
          app.id,
          number,
          Array.isArray(app.people) ? app.people.length : 0,
          request.body?.comment || null,
          request.user?.id || null
        ]
      );
      await client.query(
        `UPDATE mlsp_applications SET outgoing_number = $1, status = 'sent', updated_at = NOW() WHERE id = $2`,
        [number, app.id]
      );
      await client.query('COMMIT');
      return { outgoing: number, registry: enrichRegistryRow(reg[0]) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // After transport export — write legs for summary / plaques
  fastify.post('/applications/:id/publish-legs', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const { rows } = await db.query(`SELECT * FROM mlsp_applications WHERE id = $1`, [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const app = rows[0];
    if (!['flight', 'ship'].includes(app.app_type)) {
      return reply.code(400).send({ error: 'Только flight/ship' });
    }
    const transport = app.transport || (app.app_type === 'ship' ? 'ship' : 'plane');
    const people = app.people || [];
    let n = 0;
    for (const p of people) {
      const dir = p.leg_direction || (app.direction === 'outbound' ? 'outbound' : 'inbound');
      const legDate = ymd(app.date_from) || ymd(new Date());
      await db.query(
        `INSERT INTO mlsp_transport_legs (
           application_id, employee_id, fio, leg_date, direction, transport,
           route_text, contract_number, curator, position, source
         ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,'app')`,
        [
          app.id, p.id || null, p.fio, legDate, dir, transport,
          app.route_text, app.contract_number, app.curator || p.curator, p.position
        ]
      );
      n += 1;
    }
    return { ok: true, inserted: n };
  });

  // ── Pass registry ────────────────────────────────────────────
  fastify.get('/registry', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async () => {
    const { rows } = await db.query(`SELECT * FROM mlsp_pass_registry ORDER BY request_date DESC NULLS LAST, id DESC`);
    return { items: rows.map(enrichRegistryRow) };
  });

  fastify.patch('/registry/:id', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const body = request.body || {};
    const fields = [];
    const params = [];
    const map = {
      responsible_name: 'responsible_name',
      contract_number: 'contract_number',
      request_no: 'request_no',
      request_date: 'request_date',
      curator: 'curator',
      curator_confirm_date: 'curator_confirm_date',
      status: 'status',
      issued_date: 'issued_date',
      comment: 'comment',
      people_count: 'people_count',
      outgoing_number: 'outgoing_number'
    };
    for (const [k, col] of Object.entries(map)) {
      if (body[k] !== undefined) {
        params.push(body[k]);
        fields.push(`${col} = $${params.length}`);
      }
    }
    if (body.request_date !== undefined) {
      params.push(body.request_date);
      fields.push(`planned_ready = ($${params.length}::date + 45)`);
    }
    if (!fields.length) return reply.code(400).send({ error: 'Нет полей' });
    params.push(request.params.id);
    const { rows } = await db.query(
      `UPDATE mlsp_pass_registry SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return enrichRegistryRow(rows[0]);
  });

  fastify.post('/registry', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request) => {
    const b = request.body || {};
    const reqDate = ymd(b.request_date) || ymd(new Date());
    const { rows } = await db.query(
      `INSERT INTO mlsp_pass_registry (
         responsible_name, contract_number, request_no, request_date, planned_ready,
         curator, curator_confirm_date, status, comment, people_count, outgoing_number, created_by
       ) VALUES ($1,$2,$3,$4::date,($4::date+45),$5,$6,COALESCE($7,'Подана'),$8,$9,$10,$11)
       RETURNING *`,
      [
        b.responsible_name || 'Хосе', b.contract_number, b.request_no, reqDate,
        b.curator, b.curator_confirm_date || null, b.status || 'Подана',
        b.comment || null, b.people_count || null, b.outgoing_number || null,
        request.user?.id || null
      ]
    );
    return enrichRegistryRow(rows[0]);
  });

  // ── Transport board ──────────────────────────────────────────
  fastify.get('/board', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request) => {
    const from = ymd(request.query.from) || ymd(new Date());
    const to = ymd(request.query.to) || addDays(from, 30);
    const { rows } = await db.query(
      `SELECT l.*, e.id AS emp_id
         FROM mlsp_transport_legs l
         LEFT JOIN employees e ON e.id = l.employee_id
        WHERE l.leg_date BETWEEN $1::date AND $2::date
        ORDER BY l.leg_date ASC, l.fio`,
      [from, to]
    );
    const today = ymd(new Date());
    const groups = { today: [], week: [], later: [] };
    for (const r of rows) {
      const d = ymd(r.leg_date);
      const item = {
        ...r,
        leg_date: d,
        direction_label: r.direction === 'outbound' ? 'съезжает' : 'заезжает',
        transport_label: r.transport === 'ship' ? 'корабль' : (r.transport === 'helicopter' ? 'вертолёт' : 'самолёт')
      };
      if (d === today) groups.today.push(item);
      else if (d <= addDays(today, 7)) groups.week.push(item);
      else groups.later.push(item);
    }
    return { from, to, groups, items: rows };
  });

  // Upcoming legs for employee card plaque
  fastify.get('/upcoming/:employeeId', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request) => {
    const days = Math.min(Number(request.query.days) || 14, 60);
    const { rows } = await db.query(
      `SELECT * FROM mlsp_transport_legs
        WHERE employee_id = $1
          AND leg_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $2::int
        ORDER BY leg_date ASC
        LIMIT 5`,
      [request.params.employeeId, days]
    );
    return {
      items: rows.map((r) => ({
        ...r,
        leg_date: ymd(r.leg_date),
        direction_label: r.direction === 'outbound' ? 'Съезжает' : 'Заезжает',
        transport_label: r.transport === 'ship' ? 'корабль' : (r.transport === 'helicopter' ? 'вертолёт' : 'самолёт')
      }))
    };
  });

  // History search
  fastify.get('/history', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request) => {
    const q = String(request.query.q || '').trim();
    const params = [];
    let sql = `SELECT * FROM mlsp_transport_legs WHERE 1=1`;
    if (q) {
      params.push('%' + q + '%');
      sql += ` AND (fio ILIKE $${params.length} OR route_text ILIKE $${params.length} OR contract_number ILIKE $${params.length})`;
    }
    if (request.query.direction) {
      params.push(request.query.direction);
      sql += ` AND direction = $${params.length}`;
    }
    sql += ` ORDER BY leg_date DESC LIMIT 500`;
    const { rows } = await db.query(sql, params);
    return { items: rows.map((r) => ({ ...r, leg_date: ymd(r.leg_date) })) };
  });

  async function importFlightItems(items) {
    let n = 0;
    for (const it of items) {
      const fio = it.fio;
      if (!fio) continue;
      const dir = /с млсп/i.test(it.direction || '') ? 'outbound' : 'inbound';
      const legDate = ymd(it.date) || ymd(new Date());
      await db.query(
        `INSERT INTO mlsp_transport_legs (
           fio, leg_date, direction, transport, route_text, contract_number, curator, position, source
         ) VALUES ($1,$2::date,$3,'plane',$4,$5,$6,$7,'history_import')`,
        [fio, legDate, dir, it.route || null, it.contract || null, it.curator || null, it.position || null]
      );
      n += 1;
    }
    return n;
  }

  // Import flight history from JSON body (one-shot from Excel extract)
  fastify.post('/history/import', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request) => {
    const items = Array.isArray(request.body?.items) ? request.body.items : [];
    const n = await importFlightItems(items);
    return { ok: true, inserted: n };
  });

  // Import 219 flights from seed file on disk (deployed with module)
  fastify.post('/history/import-seed', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (request, reply) => {
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      path.join(__dirname, '../../.deploy/mlsp-plan-extract/flights_seed.json'),
      path.join(__dirname, '../../templates/mlsp/flights_seed.json')
    ];
    let items = null;
    let used = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        items = JSON.parse(fs.readFileSync(p, 'utf8'));
        used = p;
        break;
      }
    }
    if (!Array.isArray(items)) {
      return reply.code(404).send({ error: 'Файл flights_seed.json не найден на сервере' });
    }
    // не дублируем, если уже импортировали
    const { rows: cnt } = await db.query(
      `SELECT COUNT(*)::int AS n FROM mlsp_transport_legs WHERE source = 'history_import'`
    );
    if (cnt[0].n >= items.length) {
      return { ok: true, inserted: 0, skipped: true, existing: cnt[0].n, file: used };
    }
    const n = await importFlightItems(items);
    return { ok: true, inserted: n, file: used };
  });

  // Outgoing next
  fastify.get('/outgoing/next', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async () => nextOutgoing(db));

  fastify.get('/pack', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async () => {
    const rows = await loadPack(db);
    return { items: rows };
  });

  // Reglament text for UI
  fastify.get('/reglament', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async () => ({
    title: 'Регламент отправки заявок на пропуска (МЛСП)',
    steps: [
      'В письме вместе с заявкой: «Прошу подтвердить получение заявки и сообщить дату её направления на проверку».',
      'Нет ответа на следующий день — звонок куратору + повторный письменный запрос.',
      'Нет подтверждения через 3 рабочих дня — письменное обращение в ГНШ напрямую.',
      'Кто подал заявку — тот и ведёт её до выдачи пропуска. В реестр — в день отправки.',
      'Плановая готовность = дата заявки + 45 дней.',
      'Контроль: 30-й день — статус-чек; 42–45-й — фиксация срыва.'
    ],
    statuses: ['Подана', 'Подтверждена', 'В работе', 'Готова', 'Сорвана'],
    signals: [
      { code: 'issued', label: 'выдан' },
      { code: 'breach', label: 'срыв N дн.' },
      { code: 'due_soon', label: 'до срока ≤7 дн.' },
      { code: 'no_confirm', label: 'нет подтв. куратора' },
      { code: 'ok', label: 'в норме' }
    ]
  }));
}

module.exports = routes;
