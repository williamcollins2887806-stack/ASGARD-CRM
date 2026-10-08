/**
 * ASGARD Field — Project Management API (PM / Admin)
 * ═══════════════════════════════════════════════════════════════
 * POST /projects/:work_id/activate    — activate field project
 * GET  /tariffs                       — tariff grid
 * POST /tariffs                       — create tariff (ADMIN)
 * PUT  /tariffs/:id                   — update tariff (ADMIN)
 * DELETE /tariffs/:id                 — delete tariff (ADMIN)
 * POST /projects/:work_id/crew        — assign crew with tariffs
 * DELETE /projects/:work_id/crew/:employee_id — hard-remove from brigade
 * POST /projects/:work_id/send-invites — SMS invites to crew
 * POST /projects/:work_id/broadcast   — broadcast message
 * GET  /projects/:work_id/dashboard   — live dashboard
 * GET  /projects/:work_id/timesheet   — timesheet export
 * POST /projects/:work_id/checkin     — create checkin
 * PUT  /projects/:work_id/checkin/:id — update checkin
 * DELETE /projects/:work_id/checkin/:id — delete checkin
 * GET  /projects/:work_id/progress    — progress from reports
 */

const ExcelJS = require('exceljs');
const tsExcelStyle = require('../services/timesheet-excel-style');
const MangoService = require('../services/mango');
const { createNotification } = require('../services/notify');
const { getWorkerFinances } = require('../lib/worker-finances');
const { logError } = require('../lib/log-error');
const { assertNoStageConflict, labelOf } = require('../lib/timesheet-day-conflict');
const { clearPlannedOnCrewAssign } = require('../lib/planned-engagement-auto');
const { loadFieldTimesheetRoster } = require('../lib/field-timesheet-roster');
const MANGO_SMS_FROM = process.env.MANGO_SMS_EXTENSION || '101';

const MANAGE_ROLES = ['PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

// Lock helper
function getLockLib() {
  try { return require('../lib/timesheet-locks'); } catch (_) {}
  try { return require('./timesheet-v2'); } catch (_) {}
  return null;
}
async function assertNotLockedSafe(fastify, viewer, ctx) {
  const lib = getLockLib();
  if (!lib || typeof lib.assertNotLocked !== 'function') return;
  await lib.assertNotLocked(fastify, viewer, ctx);
}
function tryDateParts(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) {
    const d = new Date(dateStr);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
}
function scopeForRole(role) {
  if (role === 'PM' || role === 'HEAD_PM') return 'pm';
  if (role === 'TO' || role === 'HEAD_TO') return 'medical';
  return 'global';
}

async function routes(fastify, options) {
  const db = fastify.db;
  const mango = new MangoService();
  const roleCheck = { preHandler: [fastify.requireRoles(MANAGE_ROLES)] };

  // Helper: log SMS
  async function logSms(empId, phone, text, status, response, workId, sentBy) {
    try {
      await db.query(`
        INSERT INTO field_sms_log (employee_id, phone, message_type, message_text, status, mango_response, work_id, sent_by)
        VALUES ($1, $2, 'invite', $3, $4, $5, $6, $7)
      `, [empId, phone, text, status, JSON.stringify(response), workId, sentBy]);
    } catch (_) {}
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST /projects/:work_id/activate — activate field for project
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/projects/:work_id/activate', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const userId = req.user.id;
      const {
        report_template_id, site_category, schedule_type, shift_hours,
        per_diem, geo_lat, geo_lng, geo_radius, geo_required,
        shift_start_reminder, daily_report_reminder, rounding_rule, rounding_step,
        per_diem_on_checkins, role_base_rates
      } = req.body || {};

      if (!workId) return reply.code(400).send({ error: 'Укажите work_id' });

      // Check work exists
      const { rows: work } = await db.query(`SELECT id, work_title FROM works WHERE id = $1`, [workId]);
      if (work.length === 0) return reply.code(404).send({ error: 'Проект не найден' });

      const pdOnCheckins = per_diem_on_checkins == null ? null : !!per_diem_on_checkins;
      const roleRatesJson = role_base_rates != null ? JSON.stringify(role_base_rates) : null;

      // Upsert project settings
      const { rows: existing } = await db.query(
        `SELECT id FROM field_project_settings WHERE work_id = $1`, [workId]
      );

      if (existing.length > 0) {
        await db.query(`
          UPDATE field_project_settings SET
            is_active = true,
            report_template_id = COALESCE($2, report_template_id),
            site_category = COALESCE($3, site_category),
            schedule_type = COALESCE($4, schedule_type),
            shift_hours = COALESCE($5, shift_hours),
            per_diem = COALESCE($6, per_diem),
            object_lat = COALESCE($7, object_lat),
            object_lng = COALESCE($8, object_lng),
            geo_radius_meters = COALESCE($9, geo_radius_meters),
            geo_required = COALESCE($10, geo_required),
            shift_start_reminder = COALESCE($11, shift_start_reminder),
            daily_report_reminder = COALESCE($12, daily_report_reminder),
            rounding_rule = COALESCE($13, rounding_rule),
            rounding_step = COALESCE($14, rounding_step),
            per_diem_on_checkins = COALESCE($16, per_diem_on_checkins),
            role_base_rates = COALESCE($17::jsonb, role_base_rates),
            activated_at = NOW(), activated_by = $15,
            updated_at = NOW()
          WHERE work_id = $1
        `, [workId, report_template_id || null, site_category || null,
            schedule_type || null, shift_hours || null, per_diem != null ? per_diem : null,
            geo_lat || null, geo_lng || null, geo_radius || null,
            geo_required != null ? geo_required : null,
            shift_start_reminder || null, daily_report_reminder || null,
            rounding_rule || null, rounding_step || null, userId, pdOnCheckins,
            roleRatesJson]);
      } else {
        await db.query(`
          INSERT INTO field_project_settings (work_id, is_active, activated_at, activated_by,
            report_template_id, site_category, schedule_type, shift_hours, per_diem,
            object_lat, object_lng, geo_radius_meters, geo_required,
            shift_start_reminder, daily_report_reminder, rounding_rule, rounding_step,
            per_diem_on_checkins, role_base_rates)
          VALUES ($1, true, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
        `, [workId, userId,
            report_template_id || null, site_category || 'ground',
            schedule_type || 'shift', shift_hours || 11, per_diem != null ? per_diem : 0,
            geo_lat || null, geo_lng || null, geo_radius || 500,
            geo_required || false,
            shift_start_reminder || null, daily_report_reminder || null,
            rounding_rule || 'half_up', rounding_step || 0.5,
            pdOnCheckins != null ? pdOnCheckins : true,
            roleRatesJson]);
      }

      // Ставка на проекте — источник правды для бригады: синхронизируем назначения,
      // иначе COALESCE(ea.per_diem, …) продолжает брать старое значение у людей.
      if (per_diem != null && Number.isFinite(Number(per_diem))) {
        await db.query(
          `UPDATE employee_assignments SET per_diem = $2, updated_at = NOW() WHERE work_id = $1`,
          [workId, Number(per_diem)]
        );
      }

      return { ok: true, work_id: workId };
    } catch (err) {
      logError(fastify, '[field-manage] activate error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /tariffs — tariff grid
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/tariffs', roleCheck, async (req, reply) => {
    try {
      const category = req.query.category;

      let sql = `SELECT * FROM field_tariff_grid WHERE is_active = true`;
      const params = [];

      if (category && category !== 'all') {
        sql += ` AND (category = $1 OR category = 'special')`;
        params.push(category);
      }

      sql += ` ORDER BY category, sort_order`;

      const { rows } = await db.query(sql, params);

      const tariffs = rows.filter(r => r.category !== 'special');
      const specials = rows.filter(r => r.category === 'special');

      return { tariffs, specials, point_value: 500 };
    } catch (err) {
      logError(fastify, '[field-manage] tariffs error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET/PUT /projects/:work_id/role-base-rates — базовые ставки по ролям
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/projects/:work_id/role-base-rates', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id, 10);
      if (!workId) return reply.code(400).send({ error: 'Укажите work_id' });
      const { rows } = await db.query(
        `SELECT site_category, role_base_rates, is_active, per_diem
         FROM field_project_settings WHERE work_id = $1`,
        [workId]
      );
      if (!rows.length) {
        return {
          work_id: workId,
          site_category: 'ground',
          role_base_rates: null,
          is_active: false,
          per_diem: 0
        };
      }
      return {
        work_id: workId,
        site_category: rows[0].site_category || 'ground',
        role_base_rates: rows[0].role_base_rates || null,
        is_active: !!rows[0].is_active,
        per_diem: rows[0].per_diem != null ? Number(rows[0].per_diem) : 0
      };
    } catch (err) {
      logError(fastify, '[field-manage] role-base-rates GET error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  fastify.put('/projects/:work_id/role-base-rates', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id, 10);
      if (!workId) return reply.code(400).send({ error: 'Укажите work_id' });
      const body = req.body || {};
      const siteCategory = body.site_category || null;
      const roleBaseRates = body.role_base_rates != null ? body.role_base_rates : null;

      const { rows: work } = await db.query(`SELECT id FROM works WHERE id = $1`, [workId]);
      if (!work.length) return reply.code(404).send({ error: 'Проект не найден' });

      const { rows: existing } = await db.query(
        `SELECT id FROM field_project_settings WHERE work_id = $1`, [workId]
      );

      if (existing.length) {
        await db.query(`
          UPDATE field_project_settings SET
            role_base_rates = COALESCE($2::jsonb, role_base_rates),
            site_category = COALESCE($3, site_category),
            updated_at = NOW()
          WHERE work_id = $1
        `, [
          workId,
          roleBaseRates != null ? JSON.stringify(roleBaseRates) : null,
          siteCategory
        ]);
      } else {
        await db.query(`
          INSERT INTO field_project_settings
            (work_id, is_active, site_category, role_base_rates, activated_at, activated_by)
          VALUES ($1, false, $2, $3::jsonb, NULL, NULL)
        `, [
          workId,
          siteCategory || 'ground',
          roleBaseRates != null ? JSON.stringify(roleBaseRates) : null
        ]);
      }

      const { rows } = await db.query(
        `SELECT site_category, role_base_rates, is_active FROM field_project_settings WHERE work_id = $1`,
        [workId]
      );
      return {
        ok: true,
        work_id: workId,
        site_category: rows[0]?.site_category || siteCategory || 'ground',
        role_base_rates: rows[0]?.role_base_rates || roleBaseRates,
        is_active: !!rows[0]?.is_active
      };
    } catch (err) {
      logError(fastify, '[field-manage] role-base-rates PUT error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /projects/:work_id/crew — assign crew with tariffs
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/projects/:work_id/crew', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const { employees } = req.body || {};

      if (!Array.isArray(employees) || employees.length === 0) {
        return reply.code(400).send({ error: 'Укажите массив employees' });
      }

      // Get project settings for category validation
      const { rows: settings } = await db.query(
        `SELECT site_category, per_diem FROM field_project_settings WHERE work_id = $1`, [workId]
      );
      const siteCategory = settings[0]?.site_category || 'ground';
      const projectPerDiem = settings[0]?.per_diem || 0;

      const results = [];
      const { resolveAssignmentRates } = require('../lib/field-assignment-rate');

      const {
        FIELD_CREW_ROLE_VALUES,
        isValidFieldRole
      } = require('../lib/employee-role-tags');

      for (const emp of employees) {
        const { employee_id, tariff_id, combination_tariff_id, shift_type } = emp;
        const combo_tariff_ids = emp.combo_tariff_ids;
        const manual_extra_points = emp.manual_extra_points;

        if (!employee_id) continue;

        let field_role = emp.field_role || 'worker';
        if (!isValidFieldRole(field_role)) {
          results.push({
            employee_id,
            error: `Недопустимая роль: ${field_role}. Допустимо: ${FIELD_CREW_ROLE_VALUES.join(', ')}`
          });
          continue;
        }

        const rates = await resolveAssignmentRates(db, {
          tariff_id,
          combination_tariff_id,
          combo_tariff_ids,
          manual_extra_points
        });
        if (rates.error) {
          results.push({ employee_id, error: rates.error });
          continue;
        }

        if (rates.tariffRow
            && rates.tariffRow.category !== siteCategory
            && rates.tariffRow.category !== 'special') {
          results.push({
            employee_id,
            error: `Категория тарифа (${rates.tariffRow.category}) не совпадает с проектом (${siteCategory})`
          });
          continue;
        }

        const totalRate = rates.totalRate;
        const totalPoints = rates.totalPoints;
        const primaryComboId = rates.primaryComboId;
        const comboIds = rates.comboIds;
        const manualPts = rates.manualPoints;
        const perDiem = emp.per_diem != null ? emp.per_diem : projectPerDiem;

        // Upsert assignment
        const { rows: existing } = await db.query(
          `SELECT id FROM employee_assignments WHERE employee_id = $1 AND work_id = $2 LIMIT 1`,
          [employee_id, workId]
        );

        if (existing.length > 0) {
          // keep_inactive: обновить тариф уехавшему, не возвращая на объект
          const keepInactive = !!emp.keep_inactive;
          await db.query(`
            UPDATE employee_assignments SET
              field_role = $3, tariff_id = $4, tariff_points = $5,
              combination_tariff_id = $6, per_diem = $7, shift_type = $8,
              combo_tariff_ids = $10::int[], manual_extra_points = $11,
              is_active = CASE WHEN $9::boolean THEN is_active ELSE true END,
              updated_at = NOW()
            WHERE employee_id = $1 AND work_id = $2
          `, [employee_id, workId, field_role || 'worker', tariff_id || null,
              totalPoints || null, primaryComboId, perDiem, shift_type || 'day',
              keepInactive, comboIds, manualPts]);
        } else {
          await db.query(`
            INSERT INTO employee_assignments (employee_id, work_id, field_role, tariff_id,
              tariff_points, combination_tariff_id, per_diem, shift_type, is_active,
              combo_tariff_ids, manual_extra_points)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9::int[], $10)
          `, [employee_id, workId, field_role || 'worker', tariff_id || null,
              totalPoints || null, primaryComboId, perDiem, shift_type || 'day',
              comboIds, manualPts]);
        }

        // Update employees.day_rate for backward compatibility
        if (totalRate > 0) {
          await db.query(`UPDATE employees SET day_rate = $1 WHERE id = $2`, [totalRate, employee_id]);
        }

        results.push({
          employee_id,
          field_role: field_role || 'worker',
          day_rate: totalRate,
          tariff_points: totalPoints,
          manual_extra_points: manualPts,
          combo_tariff_ids: comboIds,
          per_diem: perDiem,
          ok: true
        });

        // Автоснятие плана: прибыл на план ИЛИ ушёл на третий объект вместо плана
        if (!emp.keep_inactive) {
          try {
            await clearPlannedOnCrewAssign(db, employee_id, workId, {
              userId: req.user?.id || null,
            });
          } catch (peErr) {
            fastify.log.warn(`[field-manage] planned clear failed emp=${employee_id}: ${peErr.message}`);
          }
        }
      }

      // Авто-SMS с приглашением в MAX чат для новых рабочих
      try {
        const max = require('../services/max-messenger');
        const { rows: workMaxRows } = await db.query(
          'SELECT max_chat_id, max_invite_link, work_title FROM works WHERE id = $1', [workId]
        );
        const workData = workMaxRows[0];
        if (workData?.max_chat_id && max.isEnabled()) {
          const addedIds = results.filter(r => r.ok).map(r => r.employee_id);
          if (addedIds.length > 0) {
            const { rows: empRows } = await db.query(
              `SELECT id, fio, phone FROM employees WHERE id = ANY($1::int[])`, [addedIds]
            );
            const inviteLink = workData.max_invite_link || await max.getChatInviteLink(workData.max_chat_id);
            const mango = require('../services/mango');
            for (const emp of empRows) {
              if (!emp.phone) continue;
              const phone = emp.phone.replace(/\D/g, '');
              if (!phone) continue;
              const smsText = inviteLink
                ? `АСГАРД: Вас назначили на объект «${workData.work_title}». Вступите в рабочий чат MAX: ${inviteLink}`
                : `АСГАРД: Вас назначили на объект «${workData.work_title}». Откройте мессенджер MAX и найдите чат объекта.`;
              try {
                await mango.sendSms(phone, smsText);
                await db.query(
                  `UPDATE employee_assignments SET max_invite_sent_at=NOW(), max_invite_status='sms_sent'
                   WHERE employee_id=$1 AND work_id=$2`,
                  [emp.id, workId]
                );
                fastify.log.info(`[MAX] SMS invite sent to ${emp.fio} (${phone})`);
              } catch (smsErr) {
                fastify.log.warn(`[MAX] SMS failed for employee ${emp.id}:`, smsErr.message);
                await db.query(
                  `UPDATE employee_assignments SET max_invite_status='failed' WHERE employee_id=$1 AND work_id=$2`,
                  [emp.id, workId]
                );
              }
            }
          }
        }
      } catch (maxErr) {
        fastify.log.warn('[MAX] crew invite error:', maxErr.message);
      }

      // Email РП: в бригаду добавлены рабочие
      try {
        const { rows: workPm } = await db.query(`
          SELECT w.work_title, w.pm_id, u.name AS pm_name, u.email AS pm_email
          FROM works w LEFT JOIN users u ON u.id = w.pm_id WHERE w.id = $1
        `, [workId]);
        const wp = workPm[0];
        const okIds = results.filter((r) => r.ok).map((r) => r.employee_id);
        if (wp?.pm_id && okIds.length) {
          const { rows: names } = await db.query(
            `SELECT id, COALESCE(fio, full_name) AS fio FROM employees WHERE id = ANY($1::int[])`,
            [okIds]
          );
          const list = names.map((n) => n.fio).join(', ');
          const { createNotification } = require('../services/notify');
          await createNotification(db, {
            user_id: wp.pm_id,
            title: `В бригаду добавлен(ы) рабочий`,
            message: `«${wp.work_title || workId}»: ${list}`,
            type: 'crew',
            link: `#/works?id=${workId}`
          });
          if (wp.pm_email) {
            const { sendCrmEmail } = require('../services/crm-mailer');
            await sendCrmEmail(db, null, {
              to: wp.pm_email,
              subject: `АСГАРД CRM: в бригаду добавлен(ы) — ${list.slice(0, 80)}`,
              text: `Здравствуйте${wp.pm_name ? `, ${wp.pm_name}` : ''}!\n\nПо вашей работе «${wp.work_title || workId}» в бригаду добавлен(ы):\n${list}\n\n— АСГАРД CRM`,
              html: `<p>По вашей работе <strong>${wp.work_title || workId}</strong> в бригаду добавлен(ы):</p><p>${list}</p>`
            });
          }
        }
      } catch (mailErr) {
        fastify.log.warn('[field-manage] crew email: ' + mailErr.message);
      }

      return { results, count: results.filter(r => r.ok).length };
    } catch (err) {
      logError(fastify, '[field-manage] crew error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /projects/:work_id/send-invites — SMS invites
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/projects/:work_id/send-invites', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const userId = req.user.id;
      const { employee_ids } = req.body || {};

      const { rows: work } = await db.query(`SELECT work_title, city FROM works WHERE id = $1`, [workId]);
      if (work.length === 0) return reply.code(404).send({ error: 'Проект не найден' });

      // Get crew to invite
      let sql = `
        SELECT ea.employee_id, ea.id as assignment_id, e.fio, e.phone
        FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        WHERE ea.work_id = $1 AND ea.is_active = true
          AND (ea.departure_date IS NULL OR ea.departure_date > CURRENT_DATE)
          AND (ea.sms_sent = false OR ea.sms_sent IS NULL)
      `;
      const params = [workId];

      if (Array.isArray(employee_ids) && employee_ids.length > 0) {
        sql += ` AND ea.employee_id = ANY($2)`;
        params.push(employee_ids);
      }

      const { rows: crew } = await db.query(sql, params);

      let sent = 0;
      let failed = 0;

      for (const member of crew) {
        if (!member.phone) { failed++; continue; }

        // Normalize phone: remove spaces/dashes/parens/+, replace leading 8 with 7
        const normalizedPhone = String(member.phone)
          .replace(/[\s\-\(\)\+]/g, '')
          .replace(/^8/, '7');
        if (!/^7\d{10}$/.test(normalizedPhone)) { failed++; continue; }

        const city = work[0].city ? `, ${work[0].city}` : '';
        const smsText = `ASGARD: Вы назначены на проект "${work[0].work_title}"${city}. Ваш ЛК: https://asgard-crm.ru/field`;

        try {
          const resp = await mango.sendSms(MANGO_SMS_FROM, normalizedPhone, smsText);
          await logSms(member.employee_id, member.phone, smsText, 'sent', resp, workId, userId);
          await db.query(
            `UPDATE employee_assignments SET sms_sent = true, sms_sent_at = NOW() WHERE id = $1`,
            [member.assignment_id]
          );
          sent++;
        } catch (smsErr) {
          await logSms(member.employee_id, member.phone, smsText, 'failed', { error: smsErr.message }, workId, userId);
          failed++;
        }
      }

      return { sent, failed, total: crew.length };
    } catch (err) {
      logError(fastify, '[field-manage] send-invites error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /projects/:work_id/send-max-invites — SMS с приглашением в MAX-чат
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/projects/:work_id/send-max-invites', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const { employee_ids } = req.body || {};

      const max = require('../services/max-messenger');
      if (!max.isEnabled()) {
        return reply.code(400).send({ error: 'MAX_BOT_TOKEN не задан в .env' });
      }

      const workRes = await db.query(
        'SELECT id, work_title, max_chat_id, max_invite_link FROM works WHERE id = $1',
        [workId]
      );
      const workData = workRes.rows[0];
      if (!workData?.max_chat_id) {
        return reply.code(400).send({ error: 'У работы нет MAX-чата. Создайте чат при создании работы.' });
      }

      let inviteLink = workData.max_invite_link;
      if (!inviteLink) {
        inviteLink = await max.getChatInviteLink(workData.max_chat_id);
        if (inviteLink) {
          await db.query('UPDATE works SET max_invite_link=$1 WHERE id=$2', [inviteLink, workId]);
        }
      }

      const params = [workId];
      let whereEmp = '';
      if (employee_ids && employee_ids.length > 0) {
        whereEmp = ` AND ea.employee_id = ANY($2)`;
        params.push(employee_ids);
      }
      const { rows: emps } = await db.query(`
        SELECT ea.employee_id, ea.max_invite_status, e.phone, e.fio
        FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        WHERE ea.work_id = $1 AND ea.is_active = true AND ea.departure_date IS NULL
          AND ea.max_invite_status != 'joined'
        ${whereEmp}
      `, params);

      let sent = 0, failed = 0, skipped = 0;
      for (const emp of emps) {
        if (!emp.phone) { skipped++; continue; }
        const smsText = inviteLink
          ? `АСГАРД: Вступите в рабочий чат MAX по объекту «${workData.work_title}»: ${inviteLink}`
          : `АСГАРД: Вас добавили на объект «${workData.work_title}». Откройте приложение MAX и найдите рабочий чат.`;
        try {
          await mango.sendSms(emp.phone, smsText);
          await db.query(
            `UPDATE employee_assignments SET max_invite_sent_at=NOW(), max_invite_status='sms_sent'
             WHERE employee_id=$1 AND work_id=$2`,
            [emp.employee_id, workId]
          );
          sent++;
        } catch (e) {
          fastify.log.warn(`[MAX invite] SMS failed for emp ${emp.employee_id}:`, e.message);
          failed++;
        }
      }

      return reply.send({ ok: true, sent, failed, skipped });
    } catch (err) {
      logError(fastify, '[field-manage] send-max-invites error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /projects/:work_id/broadcast — broadcast message
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/projects/:work_id/broadcast', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const userId = req.user.id;
      const { message, employee_ids, channel } = req.body || {};

      if (!message) return reply.code(400).send({ error: 'Укажите message' });

      // Get crew
      let sql = `
        SELECT ea.employee_id, e.fio, e.phone, e.user_id
        FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        WHERE ea.work_id = $1 AND ea.is_active = true
          AND (ea.departure_date IS NULL OR ea.departure_date > CURRENT_DATE)
      `;
      const params = [workId];

      if (Array.isArray(employee_ids) && employee_ids.length > 0) {
        sql += ` AND ea.employee_id = ANY($2)`;
        params.push(employee_ids);
      }

      const { rows: crew } = await db.query(sql, params);
      let sentSms = 0;
      let sentPush = 0;

      for (const member of crew) {
        // SMS
        if ((channel === 'sms' || channel === 'both') && member.phone) {
          try {
            await mango.sendSms(MANGO_SMS_FROM, member.phone, `ASGARD: ${message}`);
            await logSms(member.employee_id, member.phone, message, 'sent', null, workId, userId);
            sentSms++;
          } catch (_) {}
        }

        // Push / notification
        if ((channel === 'push' || channel === 'both') && member.user_id) {
          try {
            await createNotification(db, {
              user_id: member.user_id,
              title: 'Объявление по проекту',
              message,
              type: 'field_broadcast',
              link: `/works/${workId}`
            });
            sentPush++;
          } catch (_) {}
        }
      }

      return { sent_sms: sentSms, sent_push: sentPush, total_crew: crew.length };
    } catch (err) {
      logError(fastify, '[field-manage] broadcast error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /projects/:work_id/dashboard — live dashboard
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/projects/:work_id/dashboard', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);

      // Online now (checked in today, not checked out)
      const { rows: online } = await db.query(`
        SELECT fc.employee_id, e.fio, fc.checkin_at
        FROM field_checkins fc
        JOIN employees e ON e.id = fc.employee_id
        WHERE fc.work_id = $1 AND fc.date = CURRENT_DATE AND fc.status = 'active'
        ORDER BY fc.checkin_at
      `, [workId]);

      // Today totals
      const { rows: todayStats } = await db.query(`
        SELECT COUNT(*) as today_count,
               COALESCE(SUM(hours_worked), 0) as today_hours,
               COALESCE(SUM(amount_earned), 0) as today_earned
        FROM field_checkins
        WHERE work_id = $1 AND date = CURRENT_DATE AND status != 'cancelled'
      `, [workId]);

      // Crew list + count
      const { rows: crewList } = await db.query(`
        SELECT ea.employee_id, e.fio AS employee_name, ea.field_role, ea.tariff_id,
               ftg.position_name AS tariff_name, ftg.points, ftg.rate_per_shift, ftg.point_value,
               ea.per_diem, ea.shift_type, ea.date_from, ea.date_to,
               ea.combination_tariff_id, ea.is_active
        FROM employee_assignments ea
        JOIN employees e ON e.id = ea.employee_id
        LEFT JOIN field_tariff_grid ftg ON ftg.id = ea.tariff_id
        WHERE ea.work_id = $1 AND ea.is_active = true
          AND (ea.departure_date IS NULL OR ea.departure_date > CURRENT_DATE)
        ORDER BY e.fio
      `, [workId]);

      // Progress from reports
      const { rows: progressData } = await db.query(`
        SELECT fps.report_template_id, rt.progress_field, rt.progress_unit, rt.progress_total
        FROM field_project_settings fps
        LEFT JOIN field_report_templates rt ON rt.id = fps.report_template_id
        WHERE fps.work_id = $1
      `, [workId]);

      let progress = null;
      if (progressData[0]?.progress_field) {
        const field = progressData[0].progress_field;
        const { rows: sum } = await db.query(`
          SELECT COALESCE(SUM((report_data->>$2)::numeric), 0) as done
          FROM field_daily_reports
          WHERE work_id = $1 AND status != 'rejected'
        `, [workId, field]);
        progress = {
          done: parseFloat(sum[0].done) || 0,
          total: progressData[0].progress_total,
          pct: progressData[0].progress_total ? Math.round((parseFloat(sum[0].done) / progressData[0].progress_total) * 100) : null,
          unit: progressData[0].progress_unit,
        };
      }

      // Week summary (last 7 days)
      const { rows: weekSummary } = await db.query(`
        SELECT date, COUNT(*) as workers, COALESCE(SUM(hours_worked), 0) as hours,
               COALESCE(SUM(amount_earned), 0) as earned
        FROM field_checkins
        WHERE work_id = $1 AND date >= CURRENT_DATE - INTERVAL '7 days' AND status != 'cancelled'
        GROUP BY date ORDER BY date
      `, [workId]);

      return {
        online_now: online,
        today_count: parseInt(todayStats[0].today_count),
        total_crew: crewList.length,
        crew: crewList,
        today_hours: parseFloat(todayStats[0].today_hours),
        today_earned: parseFloat(todayStats[0].today_earned),
        progress,
        week_summary: weekSummary,
      };
    } catch (err) {
      logError(fastify, '[field-manage] dashboard error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /projects/:work_id/timesheet — timesheet
  // 25.06.2026 FIX:
  //   • Возвращаем ВСЕХ рабочих из бригады (employee_assignments), а не только
  //     тех у кого уже есть чекин — иначе при первом чекине одного человека
  //     остальные «исчезали» с таблицы (баг #4: пустая бригада видна, но как
  //     только один отметится — другие пропадают).
  //   • Кроме «своих» чекинов добавляем foreign_days — чекины тех же
  //     рабочих на ДРУГИХ работах в том же периоде. UI рендерит их как
  //     заблокированные ячейки с подсказкой «занят у РП X на работе Y».
  //     Раньше РП видел просто пустую ячейку и мог случайно поставить
  //     свой чекин поверх (см. инцидент Климакин 23.06 → Пономарёв work=353).
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/projects/:work_id/timesheet', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const dateFrom = req.query.from;
      const dateTo = req.query.to;

      let dateFilter = '';
      const params = [workId];
      let idx = 2;

      if (dateFrom) {
        dateFilter += ` AND fc.date >= $${idx}`;
        params.push(dateFrom);
        idx++;
      }
      if (dateTo) {
        dateFilter += ` AND fc.date <= $${idx}`;
        params.push(dateTo);
        idx++;
      }

      // Get all checkins for project (свои)
      const { rows: checkins } = await db.query(`
        SELECT fc.id, fc.employee_id, e.fio, fc.date, fc.shift,
               fc.checkin_at, fc.checkout_at, fc.hours_worked, fc.hours_paid,
               fc.day_rate, fc.amount_earned, fc.status, fc.checkin_source
        FROM field_checkins fc
        JOIN employees e ON e.id = fc.employee_id
        WHERE fc.work_id = $1 AND fc.status != 'cancelled' ${dateFilter}
        ORDER BY e.fio, fc.date
      `, params);

      // Roster за период: бригада ∪ пересечение назначения с месяцем ∪ отметки ∪ план.
      // (раньше брали ВСЕ когда-либо назначенные → уехавшие болтались во всех месяцах.)
      const roster = await loadFieldTimesheetRoster(db, workId, dateFrom || null, dateTo || null);
      const rosterIds = roster.map((r) => r.employee_id);

      // Чужие чекины этих рабочих в том же периоде — для подсветки в UI
      let foreign = [];
      if (rosterIds.length) {
        let foreignFilter = '';
        const foreignParams = [workId, rosterIds];
        let fidx = 3;
        if (dateFrom) { foreignFilter += ` AND fc.date >= $${fidx}`; foreignParams.push(dateFrom); fidx++; }
        if (dateTo)   { foreignFilter += ` AND fc.date <= $${fidx}`; foreignParams.push(dateTo);   fidx++; }
        const fr = await db.query(`
          SELECT fc.id, fc.employee_id, fc.work_id, fc.date, fc.shift,
                 fc.day_rate, fc.amount_earned, fc.status, fc.checkin_source,
                 w.work_title, u.name AS pm_fio, w.pm_id
            FROM field_checkins fc
            LEFT JOIN works w ON w.id = fc.work_id
            LEFT JOIN users u ON u.id = w.pm_id
           WHERE fc.work_id <> $1
             AND fc.status = 'completed'
             AND fc.employee_id = ANY($2::int[])
             ${foreignFilter}
        `, foreignParams);
        foreign = fr.rows;
      }

      // Get project settings for per_diem
      const { rows: settings } = await db.query(
        `SELECT per_diem, shift_hours, site_category, per_diem_on_checkins FROM field_project_settings WHERE work_id = $1`, [workId]
      );
      const perDiem = parseFloat(settings[0]?.per_diem || 0);
      const siteCategory = settings[0]?.site_category || 'ground';
      // Флаг: суточные за смены на объекте (false → только этапы)
      const checkinsCountForPerDiem = settings[0]?.per_diem_on_checkins !== false;

      // Group by employee — стартуем с roster периода
      const byEmployee = {};
      for (const c of roster) {
        byEmployee[c.employee_id] = {
          employee_id: c.employee_id,
          fio: c.fio,
          days: [],
          foreign_days: [],
          total_hours: 0,
          total_paid_hours: 0,
          total_earned: 0,
          days_count: 0,
          per_diem_days: 0,
          roster_reasons: c.roster_reasons || [],
          planned_info: c.planned_info || null,
          is_planned_only: !!c.is_planned_only,
        };
      }
      for (const row of checkins) {
        if (!byEmployee[row.employee_id]) {
          // На всякий: отметка в периоде, но не попал в SQL roster (редко)
          byEmployee[row.employee_id] = {
            employee_id: row.employee_id,
            fio: row.fio,
            days: [],
            foreign_days: [],
            total_hours: 0,
            total_paid_hours: 0,
            total_earned: 0,
            days_count: 0,
            per_diem_days: 0,
            roster_reasons: ['marks'],
            planned_info: null,
            is_planned_only: false,
          };
        }
        const emp = byEmployee[row.employee_id];
        emp.days.push({
          id: row.id,
          kind: 'checkin',
          date: row.date,
          shift: row.shift,
          hours_worked: parseFloat(row.hours_worked || 0),
          hours_paid: parseFloat(row.hours_paid || 0),
          day_rate: parseFloat(row.day_rate || 0),
          amount: parseFloat(row.amount_earned || 0),
          status: row.status,
          source: row.checkin_source,
        });
        emp.total_hours += parseFloat(row.hours_worked || 0);
        emp.total_paid_hours += parseFloat(row.hours_paid || 0);
        emp.total_earned += parseFloat(row.amount_earned || 0);
        emp.days_count++;
        if (checkinsCountForPerDiem && perDiem > 0) emp.per_diem_days++;
      }
      for (const f of foreign) {
        const emp = byEmployee[f.employee_id];
        if (!emp) continue;
        emp.foreign_days.push({
          id: f.id,
          date: f.date,
          shift: f.shift,
          work_id: f.work_id,
          work_title: f.work_title,
          pm_id: f.pm_id,
          pm_fio: f.pm_fio,
          source: f.checkin_source,
        });
      }

      // 07.08.2026: этапы (дорога/корабль/вертолёт/…) в полевом табеле.
      // ТОЛЬКО work_id = эта работа. Этапы без объекта (work_id IS NULL) — «вне объекта»,
      // в полевой табель работы не попадают (иначе полмесяца на A / полмесяца на B
      // тянуло бы чужие/общие этапы в обе дружины).
      // Смена на дату побеждает этап при показе (без двойного счёта).
      const STAGE_SHIFT = {
        travel: 'road', ship: 'ship', helicopter: 'helicopter',
        waiting: 'standby', warehouse: 'warehouse', medical: 'medical', training: 'training'
      };
      const stageParams = [workId];
      let stageDateFilter = '';
      let sidx = 2;
      if (dateFrom) {
        stageDateFilter += ` AND COALESCE(fts.date_to, fts.date_from) >= $${sidx}::date`;
        stageParams.push(dateFrom);
        sidx++;
      }
      if (dateTo) {
        stageDateFilter += ` AND fts.date_from <= $${sidx}::date`;
        stageParams.push(dateTo);
        sidx++;
      }
      const { rows: stages } = await db.query(`
        SELECT fts.id, fts.employee_id, e.fio, fts.stage_type,
               fts.date_from, fts.date_to, fts.days_count,
               fts.tariff_points, fts.rate_per_day, fts.amount_earned,
               fts.work_id, fts.status, fts.source
          FROM field_trip_stages fts
          JOIN employees e ON e.id = fts.employee_id
         WHERE COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
           AND fts.stage_type IN ('travel','ship','helicopter','waiting','warehouse','medical','training')
           AND fts.work_id = $1
           ${stageDateFilter}
         ORDER BY e.fio, fts.date_from, fts.id
      `, stageParams);

      function ymdOnly(v) {
        if (!v) return null;
        if (typeof v === 'string') return v.slice(0, 10);
        try { return new Date(v).toISOString().slice(0, 10); } catch (_) { return null; }
      }
      function eachYmd(fromYmd, toYmd, fn) {
        const cur = new Date(fromYmd + 'T12:00:00Z');
        const end = new Date(toYmd + 'T12:00:00Z');
        while (cur <= end) {
          fn(cur.toISOString().slice(0, 10));
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }

      for (const s of stages) {
        let emp = byEmployee[s.employee_id];
        if (!emp) {
          byEmployee[s.employee_id] = {
            employee_id: s.employee_id,
            fio: s.fio,
            days: [],
            foreign_days: [],
            total_hours: 0,
            total_paid_hours: 0,
            total_earned: 0,
            days_count: 0,
            per_diem_days: 0,
            roster_reasons: ['marks'],
            planned_info: null,
            is_planned_only: false,
          };
          emp = byEmployee[s.employee_id];
        }
        let fromY = ymdOnly(s.date_from);
        let toY = ymdOnly(s.date_to) || fromY;
        if (!fromY) continue;
        if (dateFrom && fromY < dateFrom) fromY = dateFrom;
        if (dateTo && toY > dateTo) toY = dateTo;
        if (fromY > toY) continue;

        const spanDays = Math.max(1, Math.round(
          (new Date(ymdOnly(s.date_to) || ymdOnly(s.date_from) + 'T12:00:00Z') -
            new Date(ymdOnly(s.date_from) + 'T12:00:00Z')) / 86400000
        ) + 1);
        const perDayAmt = Number(s.amount_earned || 0) / Math.max(1, Number(s.days_count || spanDays));
        const shift = STAGE_SHIFT[s.stage_type] || 'road';

        eachYmd(fromY, toY, (dayYmd) => {
          const hasCheckin = emp.days.some((d) =>
            ymdOnly(d.date) === dayYmd && d.kind !== 'stage'
          );
          if (hasCheckin) return; // смена побеждает этап
          if (emp.days.some((d) => ymdOnly(d.date) === dayYmd)) return;

          emp.days.push({
            id: null,
            stage_id: s.id,
            kind: 'stage',
            date: dayYmd,
            shift,
            stage_type: s.stage_type,
            hours_worked: 0,
            hours_paid: 0,
            day_rate: perDayAmt,
            amount: perDayAmt,
            status: s.status,
            source: 'stage',
            work_id: s.work_id
          });
          emp.total_earned += perDayAmt;
          emp.days_count++;
          if (perDiem > 0) emp.per_diem_days++;
        });
      }

      const timesheet = Object.values(byEmployee).map(emp => {
        const pdDays = emp.per_diem_days || 0;
        return {
          ...emp,
          per_diem_days: pdDays,
          per_diem_total: pdDays * perDiem,
          grand_total: Math.round((emp.total_earned + pdDays * perDiem) * 100) / 100,
          total_hours: Math.round(emp.total_hours * 100) / 100,
          total_paid_hours: Math.round(emp.total_paid_hours * 100) / 100,
          total_earned: Math.round(emp.total_earned * 100) / 100,
        };
      });

      // ── XLSX export ──
      if (req.query.format === 'xlsx') {
        const includePerDiem = String(req.query.include_per_diem == null ? '1' : req.query.include_per_diem) !== '0';
        const { rows: workInfo } = await db.query(`SELECT work_title FROM works WHERE id = $1`, [workId]);
        const workTitle = workInfo[0]?.work_title || `Работа #${workId}`;

        let pointValue = 500;
        try {
          const pvRes = await db.query(`
            SELECT ft.point_value FROM employee_assignments ea
            JOIN field_tariff_grid ft ON ft.id = ea.tariff_id
            WHERE ea.work_id = $1 AND ft.point_value > 0 LIMIT 1`, [workId]);
          if (pvRes.rows[0]?.point_value) pointValue = parseFloat(pvRes.rows[0].point_value);
        } catch (_) {}

        // Все строки roster (бригада / был / отметки / план), не только с ячейками
        const exportSheet = timesheet.slice();

        const dates = [];
        if (dateFrom && dateTo) {
          const cur = new Date(dateFrom + 'T00:00:00Z');
          const end = new Date(dateTo + 'T00:00:00Z');
          while (cur <= end) {
            dates.push(cur.toISOString().slice(0, 10));
            cur.setUTCDate(cur.getUTCDate() + 1);
          }
        } else {
          const allDates = new Set();
          exportSheet.forEach((emp) => (emp.days || []).forEach((d) => allDates.add(String(d.date).slice(0, 10))));
          dates.push(...[...allDates].sort());
        }

        const colLetter = (n) => {
          let s = '';
          let x = n;
          while (x > 0) {
            const m = (x - 1) % 26;
            s = String.fromCharCode(65 + m) + s;
            x = Math.floor((x - 1) / 26);
          }
          return s;
        };

        const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const summaryHdrs = includePerDiem
          ? ['Дней', 'Баллов', 'Заработок', 'Суточные', 'ИТОГО']
          : ['Дней', 'Баллов', 'Заработок', 'ИТОГО'];
        const TOTAL_COLS = summaryHdrs.length;
        const totalCols = 2 + dates.length + TOTAL_COLS;

        const wb = new ExcelJS.Workbook();
        wb.creator = 'АСГАРД CRM';
        wb.created = new Date();
        const ws = wb.addWorksheet('Табель');
        const C = tsExcelStyle.CHROME;

        // Row 1 title
        tsExcelStyle.applyTitleRow(ws, totalCols, `ТАБЕЛЬ — ${workTitle}`);

        // Row 2: period + params (B2 = point_value, D2 = per_diem for formulas)
        ws.getCell('A2').value = `Период: ${dateFrom || '—'} — ${dateTo || '—'}`;
        ws.getCell('A2').font = { size: 10, italic: true, color: { argb: C.FONT_MUTED } };
        ws.getCell('C2').value = '1 балл, ₽';
        ws.getCell('C2').font = { size: 9, color: { argb: C.FONT_MUTED } };
        ws.getCell('D2').value = pointValue;
        ws.getCell('D2').font = { bold: true, size: 10 };
        ws.getCell('D2').numFmt = '0';
        if (includePerDiem) {
          ws.getCell('E2').value = 'Суточные, ₽/смену';
          ws.getCell('E2').font = { size: 9, color: { argb: C.FONT_MUTED } };
          ws.getCell('F2').value = perDiem;
          ws.getCell('F2').font = { bold: true, size: 10 };
          ws.getCell('F2').numFmt = '0';
        } else {
          ws.getCell('E2').value = 'Суточные не учитываются';
          ws.getCell('E2').font = { size: 9, italic: true, color: { argb: 'FF888888' } };
        }
        ws.getRow(2).height = 18;

        // Row 3 spacer (legend goes below table)
        ws.getRow(3).height = 8;

        // Row 4 headers
        ws.getRow(4).height = 30;
        const numHdr = ws.getCell(4, 1);
        numHdr.value = '№';
        tsExcelStyle.applyHeaderCell(numHdr);
        const fioHdr = ws.getCell(4, 2);
        fioHdr.value = 'ФИО';
        tsExcelStyle.applyHeaderCell(fioHdr, { alignment: { horizontal: 'left', vertical: 'middle', wrapText: true } });
        dates.forEach((d, i) => {
          const dt = new Date(d + 'T00:00:00');
          const dayNum = String(dt.getDate()).padStart(2, '0');
          const dayName = DAY_NAMES[dt.getDay()];
          const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
          const cell = ws.getCell(4, 3 + i);
          cell.value = `${dayNum}\n${dayName}`;
          tsExcelStyle.applyHeaderCell(cell, { weekend: isWeekend });
        });
        summaryHdrs.forEach((h, i) => {
          const cell = ws.getCell(4, 3 + dates.length + i);
          cell.value = h;
          const isTotal = i === summaryHdrs.length - 1;
          tsExcelStyle.applyHeaderCell(cell);
          if (isTotal) {
            cell.fill = tsExcelStyle.solidFill(C.FILL_TOTAL_ACCENT);
            cell.font = { bold: true, size: 10, color: { argb: C.FONT_ACCENT } };
          }
        });

        ws.getColumn(1).width = 5;
        ws.getColumn(2).width = 32;
        for (let i = 0; i < dates.length; i++) ws.getColumn(3 + i).width = 6;
        for (let i = 0; i < TOTAL_COLS; i++) {
          ws.getColumn(3 + dates.length + i).width = i >= 2 ? 14 : 8;
        }

        const dataStartRow = 5;
        const firstDayCol = 3;
        const lastDayCol = 2 + dates.length;
        const firstDayL = colLetter(firstDayCol);
        const lastDayL = colLetter(lastDayCol);

        exportSheet.forEach((emp, idx) => {
          const rowNum = dataStartRow + idx;
          const dayMap = {};
          (emp.days || []).forEach((d) => { dayMap[String(d.date).slice(0, 10)] = d; });
          const isEven = idx % 2 === 0;
          const rowBg = isEven ? 'FFFFFFFF' : 'FFF7FAFD';

          const numCell = ws.getCell(rowNum, 1);
          numCell.value = idx + 1;
          numCell.alignment = { horizontal: 'center', vertical: 'middle' };
          numCell.font = { size: 10, color: { argb: 'FF888888' } };
          numCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };

          const fioCell = ws.getCell(rowNum, 2);
          fioCell.value = emp.fio || '—';
          fioCell.font = { size: 10, bold: true };
          fioCell.alignment = { vertical: 'middle' };
          fioCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };

          dates.forEach((d, i) => {
            const day = dayMap[d];
            const cell = ws.getCell(rowNum, 3 + i);
            if (day) {
              const pts = Math.round(parseFloat(day.day_rate || 0) / pointValue) || 0;
              tsExcelStyle.applyShiftCell(cell, pts, day.shift);
            } else {
              const dt = new Date(d + 'T00:00:00');
              const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isWeekend ? 'FFFDE8E8' : rowBg } };
              cell.value = null;
              cell.alignment = { horizontal: 'center', vertical: 'middle' };
            }
            cell.border = { left: { style: 'hair' }, right: { style: 'hair' } };
          });

          const daysCol = 3 + dates.length;
          const ptsCol = daysCol + 1;
          const earnCol = daysCol + 2;
          const daysL = colLetter(daysCol);
          const ptsL = colLetter(ptsCol);
          const earnL = colLetter(earnCol);
          const dayRange = `${firstDayL}${rowNum}:${lastDayL}${rowNum}`;

          const cDays = ws.getCell(rowNum, daysCol);
          cDays.value = { formula: `COUNT(${dayRange})` };
          cDays.alignment = { horizontal: 'right', vertical: 'middle' };
          cDays.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
          cDays.font = { size: 10 };
          cDays.border = { left: { style: 'medium' } };

          const cPts = ws.getCell(rowNum, ptsCol);
          cPts.value = { formula: `SUM(${dayRange})` };
          cPts.alignment = { horizontal: 'right', vertical: 'middle' };
          cPts.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
          cPts.font = { size: 10 };

          const cEarn = ws.getCell(rowNum, earnCol);
          cEarn.value = { formula: `${ptsL}${rowNum}*$D$2` };
          cEarn.numFmt = '#,##0 "₽"';
          cEarn.alignment = { horizontal: 'right', vertical: 'middle' };
          cEarn.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
          cEarn.font = { size: 10 };

          if (includePerDiem) {
            const pdCol = earnCol + 1;
            const totCol = earnCol + 2;
            const pdL = colLetter(pdCol);
            const cPd = ws.getCell(rowNum, pdCol);
            // Если суточные только за этапы — число из SSoT, иначе формула COUNT×ставка
            if (!checkinsCountForPerDiem) {
              cPd.value = Number(emp.per_diem_days || 0) * perDiem;
            } else {
              cPd.value = { formula: `${daysL}${rowNum}*$F$2` };
            }
            cPd.numFmt = '#,##0 "₽"';
            cPd.alignment = { horizontal: 'right', vertical: 'middle' };
            cPd.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
            cPd.font = { size: 10 };

            const cTot = ws.getCell(rowNum, totCol);
            cTot.value = { formula: `${earnL}${rowNum}+${pdL}${rowNum}` };
            cTot.numFmt = '#,##0 "₽"';
            cTot.alignment = { horizontal: 'right', vertical: 'middle' };
            cTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9E6' } };
            cTot.font = { bold: true, size: 10, color: { argb: 'FF92610A' } };
            cTot.border = { right: { style: 'medium' } };
          } else {
            const totCol = earnCol + 1;
            const cTot = ws.getCell(rowNum, totCol);
            cTot.value = { formula: `${earnL}${rowNum}` };
            cTot.numFmt = '#,##0 "₽"';
            cTot.alignment = { horizontal: 'right', vertical: 'middle' };
            cTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9E6' } };
            cTot.font = { bold: true, size: 10, color: { argb: 'FF92610A' } };
            cTot.border = { right: { style: 'medium' } };
          }

          ws.getRow(rowNum).height = 18;
        });

        const totalRowNum = dataStartRow + exportSheet.length;
        const dataEndRow = Math.max(dataStartRow, totalRowNum - 1);
        ws.getRow(totalRowNum).height = 22;
        if (dates.length > 0) {
          ws.mergeCells(totalRowNum, 1, totalRowNum, 2 + dates.length);
        } else {
          ws.mergeCells(totalRowNum, 1, totalRowNum, 2);
        }
        const totalLabel = ws.getCell(totalRowNum, 1);
        totalLabel.value = exportSheet.length
          ? 'ИТОГО ПО ОБЪЕКТУ:'
          : 'ИТОГО ПО ОБЪЕКТУ: (нет отметок за период)';
        totalLabel.font = { bold: true, size: 11, color: { argb: 'FF1A2B4A' } };
        totalLabel.alignment = { horizontal: 'right', vertical: 'middle' };
        totalLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };

        if (exportSheet.length) {
          for (let si = 0; si < TOTAL_COLS; si++) {
            const col = 3 + dates.length + si;
            const L = colLetter(col);
            const cell = ws.getCell(totalRowNum, col);
            cell.value = { formula: `SUM(${L}${dataStartRow}:${L}${dataEndRow})` };
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            const isTot = si === TOTAL_COLS - 1;
            cell.font = { bold: true, size: 11, color: { argb: isTot ? 'FF92610A' : 'FF1A2B4A' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isTot ? 'FFD4A843' : 'FFFFF3CD' } };
            if (si >= 2) cell.numFmt = '#,##0 "₽"';
            cell.border = {
              top: { style: 'medium' }, bottom: { style: 'medium' },
              left: { style: si === 0 ? 'medium' : 'thin' },
              right: { style: isTot ? 'medium' : 'thin' }
            };
          }
        }

        ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 4 }];

        // Легенда под таблицей на том же листе
        tsExcelStyle.appendLegendBelow(ws, totalRowNum + 1, { colSpan: Math.min(10, Math.max(6, totalCols)) });

        const buffer = await wb.xlsx.writeBuffer();
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        const fname = encodeURIComponent(`Табель_${workTitle.replace(/[^\wа-яА-Я ]/g, '')}_${dateFrom || ''}–${dateTo || ''}.xlsx`);
        reply.header('Content-Disposition', `attachment; filename*=UTF-8''${fname}`);
        return reply.send(Buffer.from(buffer));
      }

      return { timesheet, per_diem_rate: perDiem };
    } catch (err) {
      logError(fastify, '[field-manage] timesheet error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /tariffs — create tariff (ADMIN only)
  // ─────────────────────────────────────────────────────────────────────
  const adminCheck = { preHandler: [fastify.requireRoles(['ADMIN'])] };

  fastify.post('/tariffs', adminCheck, async (req, reply) => {
    try {
      const { category, position_name, points, rate_per_shift, point_value,
              sort_order, is_combinable, requires_approval, notes } = req.body || {};
      if (!category || !position_name) {
        return reply.code(400).send({ error: 'category и position_name обязательны' });
      }
      const { rows } = await db.query(`
        INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift,
          point_value, sort_order, is_active, is_combinable, requires_approval, notes)
        VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9)
        RETURNING *
      `, [category, position_name, points || 0, rate_per_shift || 0,
          point_value || 500, sort_order || 0, is_combinable || false,
          requires_approval || false, notes || null]);
      return { ok: true, tariff: rows[0] };
    } catch (err) {
      logError(fastify, '[field-manage] create tariff error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUT /tariffs/:id — update tariff (ADMIN only)
  // ─────────────────────────────────────────────────────────────────────
  fastify.put('/tariffs/:id', adminCheck, async (req, reply) => {
    try {
      const id = parseInt(req.params.id);
      const { category, position_name, points, rate_per_shift, point_value,
              sort_order, is_active, is_combinable, requires_approval, notes } = req.body || {};
      const { rows } = await db.query(`
        UPDATE field_tariff_grid SET
          category = COALESCE($2, category),
          position_name = COALESCE($3, position_name),
          points = COALESCE($4, points),
          rate_per_shift = COALESCE($5, rate_per_shift),
          point_value = COALESCE($6, point_value),
          sort_order = COALESCE($7, sort_order),
          is_active = COALESCE($8, is_active),
          is_combinable = COALESCE($9, is_combinable),
          requires_approval = COALESCE($10, requires_approval),
          notes = COALESCE($11, notes),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id, category || null, position_name || null, points != null ? points : null,
          rate_per_shift != null ? rate_per_shift : null, point_value != null ? point_value : null,
          sort_order != null ? sort_order : null, is_active != null ? is_active : null,
          is_combinable != null ? is_combinable : null, requires_approval != null ? requires_approval : null,
          notes !== undefined ? notes : null]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Тариф не найден' });
      return { ok: true, tariff: rows[0] };
    } catch (err) {
      logError(fastify, '[field-manage] update tariff error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // DELETE /tariffs/:id — soft-delete tariff (ADMIN only)
  // ─────────────────────────────────────────────────────────────────────
  fastify.delete('/tariffs/:id', adminCheck, async (req, reply) => {
    try {
      const id = parseInt(req.params.id);
      const { rowCount } = await db.query(
        `UPDATE field_tariff_grid SET is_active = false, updated_at = NOW() WHERE id = $1`, [id]
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'Тариф не найден' });
      return { ok: true };
    } catch (err) {
      logError(fastify, '[field-manage] delete tariff error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /projects/:work_id/checkin — create checkin
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/projects/:work_id/checkin', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const { employee_id, date, shift: shiftRaw, hours_worked, hours_paid, day_rate,
              amount_earned, status, note, confirm_overwrite: confirmOverwrite } = req.body || {};
      if (!employee_id || !date) {
        return reply.code(400).send({ error: 'employee_id и date обязательны' });
      }
      // 23.06.2026 BUG-FIX (🟡 T-shift-aliases): legacy-эндпоинт принимал shift
      // 'as is' → клиенты, шлющие 'road'/'standby' (план миграции V145), получали
      // запись с шифтом, который timesheet-v2.js трактует, а 'half' молча
      // превращается в 'day'. Нормализуем синонимы к канону field_checkins:
      // 'road'→'travel', 'standby'→'waiting' (см. validation 04-timesheet R-03/R-04).
      const SHIFT_ALIASES = { road: 'travel', standby: 'waiting' };
      const shift = SHIFT_ALIASES[shiftRaw] || shiftRaw;

      // Period lock
      try {
        const { year, month } = tryDateParts(date);
        await assertNotLockedSafe(fastify, { id: req.user.id, role: req.user.role }, {
          year, month, scope_hint: scopeForRole(req.user.role), work_id: workId, employee_id, date
        });
      } catch (lockErr) {
        if (lockErr && lockErr.code === 'period_locked') {
          return reply.code(423).send({ error: 'period_locked', lock: lockErr.lock || null });
        }
        throw lockErr;
      }

      // Lookup assignment_id для employee_id + work_id
      const { rows: assignRows } = await db.query(`
        SELECT id FROM employee_assignments
        WHERE employee_id = $1 AND work_id = $2
        ORDER BY is_active DESC, id DESC
        LIMIT 1
      `, [employee_id, workId]);

      if (assignRows.length === 0) {
        return reply.code(400).send({
          error: 'Сотрудник не назначен на этот объект',
          details: `employee_id=${employee_id}, work_id=${workId} → assignment not found`
        });
      }

      const assignmentId = assignRows[0].id;

      // 07.08.2026: конфликт с этапами (дорога/вертолёт/…) на ту же дату.
      // Без этого полевой табель и «Маршруты» писали в разные таблицы молча → двойной счёт.
      {
        const blocked = await assertNoStageConflict(db, {
          employeeId: employee_id,
          date,
          confirmOverwrite: !!confirmOverwrite,
          actionLabel: labelOf(shift || 'day')
        });
        if (blocked) return reply.code(409).send(blocked);
      }

      // 25.06.2026 FIX «коллизия чужой работы»: если у этого employee_id уже
      // есть НЕ-cancelled чекин на ту же дату, но на ДРУГОЙ работе — отказ.
      // Раньше другой РП мог поверх перезаписать чекин рабочего, забрав его
      // себе (см. инцидент Климакин 23.06 → Пономарёв на work=353 вместо
      // работы Андросова work=11). Контекст в edit_reason.
      const { rows: otherWorkCheckins } = await db.query(`
        SELECT fc.id, fc.work_id, fc.checkin_source, fc.entered_by_user_id,
               w.work_title, w.pm_id,
               u.name AS pm_fio
          FROM field_checkins fc
          LEFT JOIN works w ON w.id = fc.work_id
          LEFT JOIN users u ON u.id = w.pm_id
         WHERE fc.employee_id = $1
           AND fc.date = $2::date
           AND fc.work_id <> $3
           AND fc.status <> 'cancelled'
         LIMIT 1
      `, [employee_id, date, workId]);
      if (otherWorkCheckins.length > 0) {
        const other = otherWorkCheckins[0];
        // ADMIN/DIRECTOR — могут перебить (для нештатных кейсов)
        const role = req.user.role;
        const canForce = role === 'ADMIN' || (role && role.startsWith('DIRECTOR_'));
        if (!canForce) {
          return reply.code(409).send({
            error: 'worker_busy_on_other_work',
            message: 'Этот рабочий уже отмечен в эту дату на другой работе. ' +
                     'Если он реально был у вас — попросите РП «' + (other.pm_fio || '—') +
                     '» снять свою отметку.',
            other: {
              checkin_id: other.id,
              work_id: other.work_id,
              work_title: other.work_title,
              pm_id: other.pm_id,
              pm_fio: other.pm_fio,
              source: other.checkin_source
            }
          });
        }
      }

      const pts = day_rate != null ? day_rate : 0;
      const amt = amount_earned != null ? amount_earned : pts;
      // checkin_at is NOT NULL — default to start of the date
      const checkinAt = date + 'T08:00:00';
      const { rows } = await db.query(`
        INSERT INTO field_checkins (work_id, employee_id, assignment_id, date, shift,
          checkin_at, hours_worked, hours_paid, day_rate, amount_earned, status,
          checkin_source, note, entered_by_user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual', $12, $13)
        ON CONFLICT (employee_id, date, work_id) WHERE status != 'cancelled'
          DO UPDATE SET
            assignment_id = EXCLUDED.assignment_id,
            shift = EXCLUDED.shift,
            checkin_at = EXCLUDED.checkin_at,
            hours_worked = EXCLUDED.hours_worked,
            hours_paid = EXCLUDED.hours_paid,
            day_rate = EXCLUDED.day_rate,
            amount_earned = EXCLUDED.amount_earned,
            status = EXCLUDED.status,
            checkin_source = EXCLUDED.checkin_source,
            note = COALESCE(EXCLUDED.note, field_checkins.note),
            entered_by_user_id = EXCLUDED.entered_by_user_id,
            updated_at = NOW()
        RETURNING *
      `, [workId, employee_id, assignmentId, date, shift || 'day', checkinAt,
          // 27.06.2026 FIX: часы дефолтятся по типу смены, а не жёстко 11.
          // road/standby/waiting = 0 (не работа), half = 6, day/night = 11.
          // Раньше manual ввод РП без указания часов всегда давал 11, и в
          // tooltip директора показывалось «11 ч» для дороги/ожидания.
          (Number.isFinite(Number(hours_worked))
            ? Number(hours_worked)
            : ({ day: 11, night: 11, half: 6, road: 0, standby: 0, waiting: 0 }[shift || 'day'] ?? 11)),
          (Number.isFinite(Number(hours_paid))
            ? Number(hours_paid)
            : ({ day: 11, night: 11, half: 6, road: 0, standby: 0, waiting: 0 }[shift || 'day'] ?? 11)),
          pts, amt,
          status || 'completed', note || null, req.user.id]);
      try {
        await db.query(`
          UPDATE employee_assignments
             SET inactivity_warned_at = NULL, updated_at = NOW()
           WHERE employee_id = $1 AND work_id = $2
             AND departure_date IS NULL AND COALESCE(is_active,true)=true
             AND inactivity_warned_at IS NOT NULL
        `, [employee_id, workId]);
      } catch (_) { /* V316 column may be missing on old deploys */ }
      return { ok: true, checkin: rows[0] };
    } catch (err) {
      fastify.log.error({ err }, '[field-manage] create checkin error');
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUT /projects/:work_id/checkin/:id — update checkin
  // ─────────────────────────────────────────────────────────────────────
  fastify.put('/projects/:work_id/checkin/:id', roleCheck, async (req, reply) => {
    try {
      const id = parseInt(req.params.id);
      const workId = parseInt(req.params.work_id);
      const { shift: shiftRaw, hours_worked, hours_paid, day_rate, amount_earned, status, note,
              confirm_overwrite: confirmOverwrite } = req.body || {};
      // 23.06.2026 BUG-FIX (🟡 T-shift-aliases): тот же маппинг что в POST.
      // 'road'→'travel', 'standby'→'waiting'.
      const SHIFT_ALIASES = { road: 'travel', standby: 'waiting' };
      const shift = SHIFT_ALIASES[shiftRaw] || shiftRaw;
      // Period lock — берём дату из чекина
      try {
        const { rows: ci0 } = await db.query(`SELECT date, employee_id, status FROM field_checkins WHERE id=$1`, [id]);
        if (!ci0.length) return reply.code(404).send({ error: 'Запись не найдена' });
        const lockDate = ci0[0] && ci0[0].date ? (typeof ci0[0].date === 'string' ? ci0[0].date.slice(0, 10) : new Date(ci0[0].date).toISOString().slice(0, 10)) : null;
        const empId = ci0[0].employee_id;
        const { year, month } = tryDateParts(lockDate);
        await assertNotLockedSafe(fastify, { id: req.user.id, role: req.user.role }, {
          year, month, scope_hint: scopeForRole(req.user.role), work_id: workId, employee_id: empId, date: lockDate
        });
        // Конфликт с этапами — только при реактивации cancelled→completed
        // (обычная правка баллов не должна каждый раз предлагать снести вертолёт).
        const reactivating = ci0[0].status === 'cancelled'
          && (status == null || status === 'completed');
        if (reactivating) {
          const blocked = await assertNoStageConflict(db, {
            employeeId: empId,
            date: lockDate,
            confirmOverwrite: !!confirmOverwrite,
            actionLabel: labelOf(shift || 'day')
          });
          if (blocked) return reply.code(409).send(blocked);
        }
      } catch (lockErr) {
        if (lockErr && lockErr.code === 'period_locked') {
          return reply.code(423).send({ error: 'period_locked', lock: lockErr.lock || null });
        }
        throw lockErr;
      }
      const { rows } = await db.query(`
        UPDATE field_checkins SET
          shift = COALESCE($3, shift),
          hours_worked = COALESCE($4, hours_worked),
          hours_paid = COALESCE($5, hours_paid),
          day_rate = COALESCE($6, day_rate),
          amount_earned = COALESCE($7, amount_earned),
          status = COALESCE($8, status),
          note = COALESCE($9, note),
          entered_by_user_id = $10,
          updated_at = NOW()
        WHERE id = $1 AND work_id = $2
        RETURNING *
      `, [id, workId, shift || null, hours_worked != null ? hours_worked : null,
          hours_paid != null ? hours_paid : null, day_rate != null ? day_rate : null,
          amount_earned != null ? amount_earned : null, status || null, note !== undefined ? note : null,
          req.user.id]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Запись не найдена' });
      return { ok: true, checkin: rows[0] };
    } catch (err) {
      fastify.log.error({ err }, '[field-manage] update checkin error');
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // DELETE /projects/:work_id/checkin/:id — cancel checkin
  // ─────────────────────────────────────────────────────────────────────
  fastify.delete('/projects/:work_id/checkin/:id', roleCheck, async (req, reply) => {
    try {
      const id = parseInt(req.params.id);
      const workId = parseInt(req.params.work_id);
      // Period lock — берём дату из чекина
      try {
        const { rows: ci0 } = await db.query(`SELECT date, employee_id FROM field_checkins WHERE id=$1`, [id]);
        const lockDate = ci0[0] && ci0[0].date ? (typeof ci0[0].date === 'string' ? ci0[0].date.slice(0, 10) : new Date(ci0[0].date).toISOString().slice(0, 10)) : null;
        const { year, month } = tryDateParts(lockDate);
        await assertNotLockedSafe(fastify, { id: req.user.id, role: req.user.role }, {
          year, month, scope_hint: scopeForRole(req.user.role), work_id: workId, employee_id: ci0[0] && ci0[0].employee_id, date: lockDate
        });
      } catch (lockErr) {
        if (lockErr && lockErr.code === 'period_locked') {
          return reply.code(423).send({ error: 'period_locked', lock: lockErr.lock || null });
        }
        throw lockErr;
      }
      const { rowCount } = await db.query(
        `UPDATE field_checkins
            SET status = 'cancelled', entered_by_user_id = $3, updated_at = NOW()
          WHERE id = $1 AND work_id = $2`,
        [id, workId, req.user.id]
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'Запись не найдена' });
      return { ok: true };
    } catch (err) {
      logError(fastify, '[field-manage] delete checkin error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /projects/:work_id/progress — progress from daily reports
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/projects/:work_id/progress', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);

      const { rows: template } = await db.query(`
        SELECT rt.progress_field, rt.progress_unit, rt.progress_total
        FROM field_project_settings fps
        JOIN field_report_templates rt ON rt.id = fps.report_template_id
        WHERE fps.work_id = $1
      `, [workId]);

      if (template.length === 0 || !template[0].progress_field) {
        return { progress: null, message: 'Шаблон отчёта не настроен или не имеет поля прогресса' };
      }

      const field = template[0].progress_field;

      const { rows: daily } = await db.query(`
        SELECT date, COALESCE((report_data->>$2)::numeric, 0) as value,
               author_id, status
        FROM field_daily_reports
        WHERE work_id = $1 AND status != 'rejected'
        ORDER BY date
      `, [workId, field]);

      const totalDone = daily.reduce((sum, d) => sum + parseFloat(d.value), 0);

      return {
        progress: {
          done: totalDone,
          total: template[0].progress_total,
          pct: template[0].progress_total ? Math.round((totalDone / template[0].progress_total) * 100) : null,
          unit: template[0].progress_unit,
        },
        daily,
      };
    } catch (err) {
      logError(fastify, '[field-manage] progress error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /projects/:work_id/departure-preview/:employee_id
  //   Financial summary before departure confirmation
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/projects/:work_id/departure-preview/:employee_id', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const empId = parseInt(req.params.employee_id);

      // Employee info
      const { rows: empRows } = await db.query(
        `SELECT id, fio, phone, position FROM employees WHERE id = $1`, [empId]
      );
      if (!empRows.length) return reply.code(404).send({ error: 'Сотрудник не найден' });

      // Assignment info
      const { rows: assignRows } = await db.query(`
        SELECT ea.id, ea.date_from, ea.per_diem, ea.departure_date, ea.departure_reason,
               ftg.position_name, ftg.rate_per_shift
        FROM employee_assignments ea
        LEFT JOIN field_tariff_grid ftg ON ftg.id = ea.tariff_id
        WHERE ea.work_id = $1 AND ea.employee_id = $2 AND ea.is_active = true
        ORDER BY ea.created_at DESC LIMIT 1
      `, [workId, empId]);

      // Financial data from SSoT
      const finances = await getWorkerFinances(db, empId, { workId, logger: fastify.log });

      // Days on site
      const dateFrom = assignRows[0]?.date_from;
      let daysOnSite = 0;
      if (dateFrom) {
        const start = new Date(dateFrom);
        const now = new Date();
        daysOnSite = Math.max(0, Math.ceil((now - start) / (1000 * 60 * 60 * 24)));
      }

      return {
        employee: empRows[0],
        assignment: assignRows[0] || null,
        days_on_site: daysOnSite,
        finances: finances.error ? null : finances,
        finances_error: finances.error || null,
      };
    } catch (err) {
      logError(fastify, '[field-manage] departure-preview error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /projects/:work_id/departure/:employee_id
  //   Mark worker as departed
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/projects/:work_id/departure/:employee_id', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const empId = parseInt(req.params.employee_id);
      const { reason, departure_date } = req.body || {};

      // Дата убытия по умолчанию = последняя отметка на этой работе
      // (смена ИЛИ этап дорога/корабль/вертолёт/…), не «сегодня» и не только смена.
      let depDate = departure_date || null;
      if (!depDate) {
        const { rows: lastRows } = await db.query(`
          SELECT GREATEST(
            COALESCE((
              SELECT MAX(fc.date)::date FROM field_checkins fc
               WHERE fc.employee_id = $1 AND fc.work_id = $2 AND fc.status = 'completed'
            ), '1900-01-01'::date),
            COALESCE((
              SELECT MAX(COALESCE(fts.date_to, fts.date_from))::date
                FROM field_trip_stages fts
               WHERE fts.employee_id = $1 AND fts.work_id = $2
                 AND COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
            ), '1900-01-01'::date)
          ) AS last_mark
        `, [empId, workId]);
        const lm = lastRows[0]?.last_mark ? String(lastRows[0].last_mark).slice(0, 10) : null;
        depDate = (lm && lm !== '1900-01-01') ? lm : new Date().toISOString().slice(0, 10);
      }

      const { rowCount } = await db.query(`
        UPDATE employee_assignments
        SET departure_date = $1, departure_reason = $2, is_active = false, updated_at = NOW()
        WHERE work_id = $3 AND employee_id = $4 AND is_active = true
          AND (departure_date IS NULL)
      `, [depDate, reason || null, workId, empId]);

      if (!rowCount) return reply.code(404).send({ error: 'Назначение не найдено или уже отмечен отъезд' });

      try {
        await db.query(`
          UPDATE site_crew_removal_requests
          SET status = 'cancelled', updated_at = NOW()
          WHERE work_id = $1 AND employee_id = $2 AND status = 'warned'
        `, [workId, empId]);
      } catch (_) { /* table may not exist yet on old deploys */ }

      // Снят с объекта → сбросить готовность в 'unknown' (если был 'on_site'),
      // чтобы рабочему снова показался вопрос «готов на объект?». Не трогаем явные ready/not_ready/archive.
      try {
        await db.query(
          `UPDATE employees
             SET readiness_status = 'unknown', readiness_updated_at = NOW()
           WHERE id = $1 AND COALESCE(readiness_status,'') IN ('on_site','')`,
          [empId]
        );
      } catch (rErr) { fastify.log.warn('[departure] readiness reset: ' + rErr.message); }

      // Get employee name for notification
      const { rows: empRows } = await db.query(`SELECT fio FROM employees WHERE id = $1`, [empId]);
      const { rows: workRows } = await db.query(`SELECT work_title FROM works WHERE id = $1`, [workId]);

      fastify.log.info(`[departure] ${empRows[0]?.fio || empId} departed from work #${workId} (${workRows[0]?.work_title}), reason: ${reason || 'не указана'}`);

      return { ok: true, departure_date: depDate };
    } catch (err) {
      logError(fastify, '[field-manage] departure error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // DELETE /projects/:work_id/crew/:employee_id
  //   Hard-remove from brigade (as if never assigned). Soft leave = departure.
  // ─────────────────────────────────────────────────────────────────────
  fastify.delete('/projects/:work_id/crew/:employee_id', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id, 10);
      const empId = parseInt(req.params.employee_id, 10);
      if (!workId || !empId) {
        return reply.code(400).send({ error: 'work_id и employee_id обязательны' });
      }

      const { rows: assignRows } = await db.query(
        `SELECT id FROM employee_assignments WHERE work_id = $1 AND employee_id = $2`,
        [workId, empId]
      );
      if (!assignRows.length) {
        return reply.code(404).send({ error: 'Назначение не найдено' });
      }
      const assignmentIds = assignRows.map((r) => r.id);

      // stages: detach FK (логистику Хосе оставляем)
      await db.query(
        `UPDATE field_trip_stages SET assignment_id = NULL, updated_at = NOW()
         WHERE assignment_id = ANY($1::int[])`,
        [assignmentIds]
      );

      // checkins: assignment_id NOT NULL → удаляем смены на этом объекте
      const { rowCount: checkinsDeleted } = await db.query(
        `DELETE FROM field_checkins
          WHERE work_id = $1 AND employee_id = $2`,
        [workId, empId]
      );

      const { rowCount: deleted } = await db.query(
        `DELETE FROM employee_assignments WHERE work_id = $1 AND employee_id = $2`,
        [workId, empId]
      );

      try {
        await db.query(`
          UPDATE site_crew_removal_requests
          SET status = 'cancelled', updated_at = NOW()
          WHERE work_id = $1 AND employee_id = $2 AND status = 'warned'
        `, [workId, empId]);
      } catch (_) { /* optional table */ }

      const { rows: empRows } = await db.query(`SELECT fio FROM employees WHERE id = $1`, [empId]);
      fastify.log.info(
        `[crew-hard-delete] ${empRows[0]?.fio || empId} removed from work #${workId} ` +
        `(assignments=${deleted}, checkins=${checkinsDeleted || 0}) by user ${req.user?.id}`
      );

      return {
        ok: true,
        deleted_assignments: deleted,
        deleted_checkins: checkinsDeleted || 0
      };
    } catch (err) {
      logError(fastify, '[field-manage] crew hard-delete error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /projects/:work_id/return/:employee_id
  //   Cancel departure — worker returns to site
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/projects/:work_id/return/:employee_id', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const empId  = parseInt(req.params.employee_id);

      // Нельзя «вернуть» работника на закрытую/удалённую работу
      const { rows: [wk] } = await db.query('SELECT work_status, deleted_at FROM works WHERE id = $1', [workId]);
      if (!wk || wk.deleted_at) return reply.code(404).send({ error: 'Работа не найдена' });
      { const { isClosedOrCancelled } = require('../helpers/work-status');
        if (isClosedOrCancelled(wk.work_status || '')) {
          return reply.code(409).send({ error: `Работа в статусе «${wk.work_status}» — вернуть работника нельзя` });
        } }

      const { rowCount } = await db.query(`
        UPDATE employee_assignments
        SET departure_date = NULL, departure_reason = NULL, is_active = true, updated_at = NOW()
        WHERE work_id = $1 AND employee_id = $2
          AND (departure_date IS NOT NULL OR is_active = false)
      `, [workId, empId]);

      if (!rowCount) return reply.code(404).send({ error: 'Назначение не найдено или работник уже активен' });

      // Вернулся на объект → снова «на объекте» (если не было явного ready/not_ready)
      try {
        await db.query(
          `UPDATE employees SET readiness_status = 'on_site', last_work_id = $2, readiness_updated_at = NOW()
           WHERE id = $1 AND COALESCE(readiness_status,'') IN ('unknown','ready','')`,
          [empId, workId]
        );
      } catch (rErr) { fastify.log.warn('[return] readiness set: ' + rErr.message); }

      const { rows: empRows } = await db.query(`SELECT fio FROM employees WHERE id = $1`, [empId]);
      fastify.log.info(`[return] ${empRows[0]?.fio || empId} returned to work #${workId}`);

      return { ok: true };
    } catch (err) {
      logError(fastify, '[field-manage] return error', err, req);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
