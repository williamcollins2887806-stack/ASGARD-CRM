/**
 * ASGARD Field — Project Management API (PM / Admin)
 * ═══════════════════════════════════════════════════════════════
 * POST /projects/:work_id/activate    — activate field project
 * GET  /tariffs                       — tariff grid
 * POST /tariffs                       — create tariff (ADMIN)
 * PUT  /tariffs/:id                   — update tariff (ADMIN)
 * DELETE /tariffs/:id                 — delete tariff (ADMIN)
 * POST /projects/:work_id/crew        — assign crew with tariffs
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
const MangoService = require('../services/mango');
const { createNotification } = require('../services/notify');
const { getWorkerFinances } = require('../lib/worker-finances');
const MANGO_SMS_FROM = process.env.MANGO_SMS_EXTENSION || '101';

const MANAGE_ROLES = ['PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

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
        shift_start_reminder, daily_report_reminder, rounding_rule, rounding_step
      } = req.body || {};

      if (!workId) return reply.code(400).send({ error: 'Укажите work_id' });

      // Check work exists
      const { rows: work } = await db.query(`SELECT id, work_title FROM works WHERE id = $1`, [workId]);
      if (work.length === 0) return reply.code(404).send({ error: 'Проект не найден' });

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
            activated_at = NOW(), activated_by = $15,
            updated_at = NOW()
          WHERE work_id = $1
        `, [workId, report_template_id || null, site_category || null,
            schedule_type || null, shift_hours || null, per_diem != null ? per_diem : null,
            geo_lat || null, geo_lng || null, geo_radius || null,
            geo_required != null ? geo_required : null,
            shift_start_reminder || null, daily_report_reminder || null,
            rounding_rule || null, rounding_step || null, userId]);
      } else {
        await db.query(`
          INSERT INTO field_project_settings (work_id, is_active, activated_at, activated_by,
            report_template_id, site_category, schedule_type, shift_hours, per_diem,
            object_lat, object_lng, geo_radius_meters, geo_required,
            shift_start_reminder, daily_report_reminder, rounding_rule, rounding_step)
          VALUES ($1, true, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `, [workId, userId,
            report_template_id || null, site_category || 'ground',
            schedule_type || 'shift', shift_hours || 11, per_diem || 0,
            geo_lat || null, geo_lng || null, geo_radius || 500,
            geo_required || false,
            shift_start_reminder || null, daily_report_reminder || null,
            rounding_rule || 'half_up', rounding_step || 0.5]);
      }

      return { ok: true, work_id: workId };
    } catch (err) {
      fastify.log.error('[field-manage] activate error:', err);
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
      fastify.log.error('[field-manage] tariffs error:', err);
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

      for (const emp of employees) {
        const { employee_id, field_role, tariff_id, combination_tariff_id, shift_type } = emp;

        if (!employee_id) continue;

        // Validate tariff
        let baseRate = 0;
        let basePoints = 0;
        let comboRate = 0;

        if (tariff_id) {
          const { rows: tariff } = await db.query(
            `SELECT * FROM field_tariff_grid WHERE id = $1 AND is_active = true`, [tariff_id]
          );
          if (tariff.length === 0) {
            results.push({ employee_id, error: 'Тариф не найден' });
            continue;
          }
          // Category validation
          if (tariff[0].category !== siteCategory && tariff[0].category !== 'special') {
            results.push({ employee_id, error: `Категория тарифа (${tariff[0].category}) не совпадает с проектом (${siteCategory})` });
            continue;
          }
          baseRate = parseFloat(tariff[0].rate_per_shift);
          basePoints = tariff[0].points;
        }

        if (combination_tariff_id) {
          const { rows: combo } = await db.query(
            `SELECT * FROM field_tariff_grid WHERE id = $1 AND is_combinable = true AND is_active = true`, [combination_tariff_id]
          );
          if (combo.length > 0) {
            comboRate = parseFloat(combo[0].rate_per_shift);
          }
        }

        const totalRate = baseRate + comboRate;
        const perDiem = emp.per_diem != null ? emp.per_diem : projectPerDiem;

        // Upsert assignment
        const { rows: existing } = await db.query(
          `SELECT id FROM employee_assignments WHERE employee_id = $1 AND work_id = $2 LIMIT 1`,
          [employee_id, workId]
        );

        if (existing.length > 0) {
          await db.query(`
            UPDATE employee_assignments SET
              field_role = $3, tariff_id = $4, tariff_points = $5,
              combination_tariff_id = $6, per_diem = $7, shift_type = $8,
              is_active = true, updated_at = NOW()
            WHERE employee_id = $1 AND work_id = $2
          `, [employee_id, workId, field_role || 'worker', tariff_id || null,
              basePoints || null, combination_tariff_id || null, perDiem, shift_type || 'day']);
        } else {
          await db.query(`
            INSERT INTO employee_assignments (employee_id, work_id, field_role, tariff_id,
              tariff_points, combination_tariff_id, per_diem, shift_type, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
          `, [employee_id, workId, field_role || 'worker', tariff_id || null,
              basePoints || null, combination_tariff_id || null, perDiem, shift_type || 'day']);
        }

        // Update employees.day_rate for backward compatibility
        if (totalRate > 0) {
          await db.query(`UPDATE employees SET day_rate = $1 WHERE id = $2`, [totalRate, employee_id]);
        }

        results.push({ employee_id, field_role: field_role || 'worker', day_rate: totalRate, per_diem: perDiem, ok: true });
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

      return { results, count: results.filter(r => r.ok).length };
    } catch (err) {
      fastify.log.error('[field-manage] crew error:', err);
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
      fastify.log.error('[field-manage] send-invites error:', err);
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
      fastify.log.error('[field-manage] send-max-invites error:', err);
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
      fastify.log.error('[field-manage] broadcast error:', err);
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
      fastify.log.error('[field-manage] dashboard error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /projects/:work_id/timesheet — timesheet
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

      // Get all checkins for project
      const { rows: checkins } = await db.query(`
        SELECT fc.id, fc.employee_id, e.fio, fc.date, fc.shift,
               fc.checkin_at, fc.checkout_at, fc.hours_worked, fc.hours_paid,
               fc.day_rate, fc.amount_earned, fc.status, fc.checkin_source
        FROM field_checkins fc
        JOIN employees e ON e.id = fc.employee_id
        WHERE fc.work_id = $1 AND fc.status != 'cancelled' ${dateFilter}
        ORDER BY e.fio, fc.date
      `, params);

      // Get project settings for per_diem
      const { rows: settings } = await db.query(
        `SELECT per_diem, shift_hours FROM field_project_settings WHERE work_id = $1`, [workId]
      );
      const perDiem = parseFloat(settings[0]?.per_diem || 0);

      // Group by employee
      const byEmployee = {};
      for (const row of checkins) {
        if (!byEmployee[row.employee_id]) {
          byEmployee[row.employee_id] = {
            employee_id: row.employee_id,
            fio: row.fio,
            days: [],
            total_hours: 0,
            total_paid_hours: 0,
            total_earned: 0,
            days_count: 0,
          };
        }
        const emp = byEmployee[row.employee_id];
        emp.days.push({
          id: row.id,
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
      }

      const timesheet = Object.values(byEmployee).map(emp => ({
        ...emp,
        per_diem_total: emp.days_count * perDiem,
        grand_total: Math.round((emp.total_earned + emp.days_count * perDiem) * 100) / 100,
        total_hours: Math.round(emp.total_hours * 100) / 100,
        total_paid_hours: Math.round(emp.total_paid_hours * 100) / 100,
        total_earned: Math.round(emp.total_earned * 100) / 100,
      }));

      // ── XLSX export ──
      if (req.query.format === 'xlsx') {
        const { rows: workInfo } = await db.query(`SELECT work_title FROM works WHERE id = $1`, [workId]);
        const workTitle = workInfo[0]?.work_title || `Работа #${workId}`;

        // point_value из тарифа (для пересчёта: баллы = day_rate / point_value)
        let pointValue = 500;
        try {
          const pvRes = await db.query(`
            SELECT ft.point_value FROM employee_assignments ea
            JOIN field_tariff_grid ft ON ft.id = ea.tariff_id
            WHERE ea.work_id = $1 AND ft.point_value > 0 LIMIT 1`, [workId]);
          if (pvRes.rows[0]?.point_value) pointValue = parseFloat(pvRes.rows[0].point_value);
        } catch (_) {}

        // Генерируем ВСЕ даты от dateFrom до dateTo (не только с checkin'ами)
        const dates = [];
        if (dateFrom && dateTo) {
          const cur = new Date(dateFrom + 'T00:00:00');
          const end = new Date(dateTo + 'T00:00:00');
          while (cur <= end) {
            dates.push(cur.toISOString().slice(0, 10));
            cur.setDate(cur.getDate() + 1);
          }
        } else {
          const allDates = new Set();
          timesheet.forEach(emp => (emp.days || []).forEach(d => allDates.add(String(d.date).slice(0,10))));
          dates.push(...[...allDates].sort());
        }

        const DAY_NAMES = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
        const TOTAL_COLS = 5; // Дней | Баллов | Заработок | Суточные | ИТОГО
        const totalCols = 2 + dates.length + TOTAL_COLS;

        const wb = new ExcelJS.Workbook();
        wb.creator = 'АСГАРД CRM';
        wb.created = new Date();
        const ws = wb.addWorksheet('Табель');

        // ── Строка 1: заголовок ──
        ws.mergeCells(1, 1, 1, totalCols);
        const t1 = ws.getCell('A1');
        t1.value = `ТАБЕЛЬ — ${workTitle}`;
        t1.font = { bold: true, size: 14, color: { argb: 'FF1A2B4A' } };
        t1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5E8F0' } };
        t1.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 28;

        // ── Строка 2: период + суточные ──
        ws.mergeCells(2, 1, 2, totalCols);
        const t2 = ws.getCell('A2');
        t2.value = `Период: ${dateFrom || '—'} — ${dateTo || '—'}  |  Суточные: ${perDiem} ₽/смену  |  1 балл = ${pointValue} ₽`;
        t2.font = { size: 10, italic: true, color: { argb: 'FF555555' } };
        t2.alignment = { horizontal: 'center' };
        ws.getRow(2).height = 16;

        // ── Строка 3: легенда ──
        ws.mergeCells(3, 1, 3, totalCols);
        const t3 = ws.getCell('A3');
        t3.value = 'Д — дневная смена (белый)  |  Н — ночная смена (синий)  |  цифра = количество баллов';
        t3.font = { size: 9, color: { argb: 'FF888888' } };
        t3.alignment = { horizontal: 'center' };
        ws.getRow(3).height = 14;

        // ── Строка 4: заголовки столбцов ──
        ws.getRow(4).height = 30;
        const hdrStyle = {
          font: { bold: true, size: 10, color: { argb: 'FF1A2B4A' } },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB8D4E8' } },
          alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
          border: { top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } }
        };
        ws.getCell(4, 1).value = '№'; Object.assign(ws.getCell(4, 1), hdrStyle);
        ws.getCell(4, 2).value = 'ФИО'; Object.assign(ws.getCell(4, 2), { ...hdrStyle, alignment: { ...hdrStyle.alignment, horizontal: 'left' } });
        dates.forEach((d, i) => {
          const dt = new Date(d + 'T00:00:00');
          const dayNum = String(dt.getDate()).padStart(2, '0');
          const dayName = DAY_NAMES[dt.getDay()];
          const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
          const cell = ws.getCell(4, 3 + i);
          cell.value = `${dayNum}\n${dayName}`;
          Object.assign(cell, {
            ...hdrStyle,
            font: { ...hdrStyle.font, color: { argb: isWeekend ? 'FFCC0000' : 'FF1A2B4A' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: isWeekend ? 'FFFDE8E8' : 'FFB8D4E8' } }
          });
        });
        const summaryHdrs = ['Дней', 'Баллов', 'Заработок', 'Суточные', 'ИТОГО'];
        summaryHdrs.forEach((h, i) => {
          const cell = ws.getCell(4, 3 + dates.length + i);
          cell.value = h;
          Object.assign(cell, {
            ...hdrStyle,
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 4 ? 'FFD4A843' : 'FFB8D4E8' } },
            font: { ...hdrStyle.font, color: { argb: i === 4 ? 'FF1A2B4A' : 'FF1A2B4A' } }
          });
        });

        // ── Ширины столбцов ──
        ws.getColumn(1).width = 5;
        ws.getColumn(2).width = 32;
        for (let i = 0; i < dates.length; i++) ws.getColumn(3 + i).width = 6;
        ws.getColumn(3 + dates.length).width = 7;      // Дней
        ws.getColumn(4 + dates.length).width = 9;      // Баллов
        ws.getColumn(5 + dates.length).width = 14;     // Заработок
        ws.getColumn(6 + dates.length).width = 12;     // Суточные
        ws.getColumn(7 + dates.length).width = 16;     // ИТОГО

        // ── Данные сотрудников ──
        let grandDays = 0, grandPoints = 0, grandEarned = 0, grandPd = 0, grandTotal = 0;
        const dataStartRow = 5;

        timesheet.forEach((emp, idx) => {
          const rowNum = dataStartRow + idx;
          const dayMap = {};
          (emp.days || []).forEach(d => { dayMap[String(d.date).slice(0, 10)] = d; });

          const isEven = idx % 2 === 0;
          const rowBg = isEven ? 'FFFFFFFF' : 'FFF7FAFD';

          // № и ФИО
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

          // Ячейки по дням
          dates.forEach((d, i) => {
            const day = dayMap[d];
            const cell = ws.getCell(rowNum, 3 + i);
            if (day) {
              const pts = Math.round(parseFloat(day.day_rate || 0) / pointValue) || 0;
              const isNight = day.shift === 'night';
              cell.value = pts > 0 ? (isNight ? `Н${pts}` : `Д${pts}`) : (isNight ? 'Н' : 'Д');
              // Ночная — синеватый фон, дневная — светло-зелёный
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isNight ? 'FFD6E4FF' : 'FFE8F5E9' } };
              cell.font = { size: 9, bold: pts >= 18, color: { argb: isNight ? 'FF1E40AF' : 'FF166534' } };
              cell.note = `${isNight ? 'Ночная' : 'Дневная'} смена\n${pts} балл. × ${pointValue} ₽ = ${pts * pointValue} ₽`;
            } else {
              const dt = new Date(d + 'T00:00:00');
              const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isWeekend ? 'FFFDE8E8' : rowBg } };
              cell.value = '';
            }
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = { left: { style: 'hair' }, right: { style: 'hair' } };
          });

          // Итоговые ячейки
          const daysCount = emp.days_count || 0;
          const totalPoints = Math.round((emp.total_earned || 0) / pointValue);
          const earned = Math.round(emp.total_earned || 0);
          const pd = Math.round(emp.per_diem_total || 0);
          const total = Math.round(emp.grand_total || 0);

          grandDays += daysCount;
          grandPoints += totalPoints;
          grandEarned += earned;
          grandPd += pd;
          grandTotal += total;

          const summaryCol = 3 + dates.length;
          const summaryVals = [daysCount, totalPoints, earned, pd, total];
          summaryVals.forEach((v, si) => {
            const cell = ws.getCell(rowNum, summaryCol + si);
            cell.value = v;
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: si === 4 ? 'FFFFF9E6' : rowBg } };
            if (si >= 2) { cell.numFmt = '#,##0 "₽"'; }
            if (si === 4) { cell.font = { bold: true, size: 10, color: { argb: 'FF92610A' } }; }
            else { cell.font = { size: 10 }; }
            cell.border = { left: { style: si === 0 ? 'medium' : 'hair' }, right: { style: si === 4 ? 'medium' : 'hair' } };
          });

          ws.getRow(rowNum).height = 18;
          // Боковые границы строки
          ws.getCell(rowNum, 1).border = { left: { style: 'medium' } };
          ws.getCell(rowNum, totalCols).border = { right: { style: 'medium' } };
        });

        // ── Итоговая строка ──
        const totalRowNum = dataStartRow + timesheet.length;
        ws.getRow(totalRowNum).height = 22;
        ws.mergeCells(totalRowNum, 1, totalRowNum, 2 + dates.length);
        const totalLabel = ws.getCell(totalRowNum, 1);
        totalLabel.value = 'ИТОГО ПО ОБЪЕКТУ:';
        totalLabel.font = { bold: true, size: 11, color: { argb: 'FF1A2B4A' } };
        totalLabel.alignment = { horizontal: 'right', vertical: 'middle' };
        totalLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };

        const grandVals = [grandDays, grandPoints, grandEarned, grandPd, grandTotal];
        grandVals.forEach((v, si) => {
          const cell = ws.getCell(totalRowNum, 3 + dates.length + si);
          cell.value = v;
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.font = { bold: true, size: 11, color: { argb: si === 4 ? 'FF92610A' : 'FF1A2B4A' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: si === 4 ? 'FFD4A843' : 'FFFFF3CD' } };
          if (si >= 2) cell.numFmt = '#,##0 "₽"';
          cell.border = {
            top: { style: 'medium' }, bottom: { style: 'medium' },
            left: { style: si === 0 ? 'medium' : 'thin' }, right: { style: si === 4 ? 'medium' : 'thin' }
          };
        });

        // ── Freeze panes: закрепить строки 1-4 и столбец ФИО ──
        ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 4 }];

        const buffer = await wb.xlsx.writeBuffer();
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        const fname = encodeURIComponent(`Табель_${workTitle.replace(/[^\wа-яА-Я ]/g, '')}_${dateFrom||''}–${dateTo||''}.xlsx`);
        reply.header('Content-Disposition', `attachment; filename*=UTF-8''${fname}`);
        return reply.send(Buffer.from(buffer));
      }

      return { timesheet, per_diem_rate: perDiem };
    } catch (err) {
      fastify.log.error('[field-manage] timesheet error:', err);
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
      fastify.log.error('[field-manage] create tariff error:', err);
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
      fastify.log.error('[field-manage] update tariff error:', err);
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
      fastify.log.error('[field-manage] delete tariff error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /projects/:work_id/checkin — create checkin
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/projects/:work_id/checkin', roleCheck, async (req, reply) => {
    try {
      const workId = parseInt(req.params.work_id);
      const { employee_id, date, shift, hours_worked, hours_paid, day_rate,
              amount_earned, status, note } = req.body || {};
      if (!employee_id || !date) {
        return reply.code(400).send({ error: 'employee_id и date обязательны' });
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
      const pts = day_rate != null ? day_rate : 0;
      const amt = amount_earned != null ? amount_earned : pts;
      // checkin_at is NOT NULL — default to start of the date
      const checkinAt = date + 'T08:00:00';
      const { rows } = await db.query(`
        INSERT INTO field_checkins (work_id, employee_id, assignment_id, date, shift,
          checkin_at, hours_worked, hours_paid, day_rate, amount_earned, status,
          checkin_source, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual', $12)
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
            updated_at = NOW()
        RETURNING *
      `, [workId, employee_id, assignmentId, date, shift || 'day', checkinAt,
          hours_worked || 11, hours_paid || 11, pts, amt,
          status || 'completed', note || null]);
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
      const { shift, hours_worked, hours_paid, day_rate, amount_earned, status, note } = req.body || {};
      const { rows } = await db.query(`
        UPDATE field_checkins SET
          shift = COALESCE($3, shift),
          hours_worked = COALESCE($4, hours_worked),
          hours_paid = COALESCE($5, hours_paid),
          day_rate = COALESCE($6, day_rate),
          amount_earned = COALESCE($7, amount_earned),
          status = COALESCE($8, status),
          note = COALESCE($9, note),
          updated_at = NOW()
        WHERE id = $1 AND work_id = $2
        RETURNING *
      `, [id, workId, shift || null, hours_worked != null ? hours_worked : null,
          hours_paid != null ? hours_paid : null, day_rate != null ? day_rate : null,
          amount_earned != null ? amount_earned : null, status || null, note !== undefined ? note : null]);
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
      const { rowCount } = await db.query(
        `UPDATE field_checkins SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND work_id = $2`,
        [id, workId]
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'Запись не найдена' });
      return { ok: true };
    } catch (err) {
      fastify.log.error('[field-manage] delete checkin error:', err);
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
      fastify.log.error('[field-manage] progress error:', err);
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
      fastify.log.error('[field-manage] departure-preview error:', err);
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

      const depDate = departure_date || new Date().toISOString().slice(0, 10);

      const { rowCount } = await db.query(`
        UPDATE employee_assignments
        SET departure_date = $1, departure_reason = $2, is_active = false, updated_at = NOW()
        WHERE work_id = $3 AND employee_id = $4 AND is_active = true
          AND (departure_date IS NULL)
      `, [depDate, reason || null, workId, empId]);

      if (!rowCount) return reply.code(404).send({ error: 'Назначение не найдено или уже отмечен отъезд' });

      // Get employee name for notification
      const { rows: empRows } = await db.query(`SELECT fio FROM employees WHERE id = $1`, [empId]);
      const { rows: workRows } = await db.query(`SELECT work_title FROM works WHERE id = $1`, [workId]);

      fastify.log.info(`[departure] ${empRows[0]?.fio || empId} departed from work #${workId} (${workRows[0]?.work_title}), reason: ${reason || 'не указана'}`);

      return { ok: true, departure_date: depDate };
    } catch (err) {
      fastify.log.error('[field-manage] departure error:', err);
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

      const { rowCount } = await db.query(`
        UPDATE employee_assignments
        SET departure_date = NULL, departure_reason = NULL, is_active = true, updated_at = NOW()
        WHERE work_id = $1 AND employee_id = $2
          AND (departure_date IS NOT NULL OR is_active = false)
      `, [workId, empId]);

      if (!rowCount) return reply.code(404).send({ error: 'Назначение не найдено или работник уже активен' });

      const { rows: empRows } = await db.query(`SELECT fio FROM employees WHERE id = $1`, [empId]);
      fastify.log.info(`[return] ${empRows[0]?.fio || empId} returned to work #${workId}`);

      return { ok: true };
    } catch (err) {
      fastify.log.error('[field-manage] return error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });
}

module.exports = routes;
