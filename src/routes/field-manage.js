/**
 * ASGARD Field — Project Management API (PM / Admin)
 * ═══════════════════════════════════════════════════════════════
 * POST /projects/:work_id/activate    — activate field project
 * GET  /tariffs                       — tariff grid
 * POST /projects/:work_id/crew        — assign crew with tariffs
 * POST /projects/:work_id/send-invites — SMS invites to crew
 * POST /projects/:work_id/broadcast   — broadcast message
 * GET  /projects/:work_id/dashboard   — live dashboard
 * GET  /projects/:work_id/timesheet   — timesheet export
 * GET  /projects/:work_id/progress    — progress from reports
 */

const ExcelJS = require('exceljs');
const MangoService = require('../services/mango');
const { createNotification } = require('../services/notify');
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
        WHERE ea.work_id = $1 AND ea.is_active = true AND (ea.sms_sent = false OR ea.sms_sent IS NULL)
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

        const city = work[0].city ? `, ${work[0].city}` : '';
        const smsText = `ASGARD: Вы назначены на проект "${work[0].work_title}"${city}. Ваш ЛК: https://asgard-crm.ru/field`;

        try {
          const resp = await mango.sendSms(MANGO_SMS_FROM, member.phone, smsText);
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

      // Total crew
      const { rows: crewCount } = await db.query(
        `SELECT COUNT(*) as total_crew FROM employee_assignments WHERE work_id = $1 AND is_active = true`,
        [workId]
      );

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
        total_crew: parseInt(crewCount[0].total_crew),
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
        SELECT fc.employee_id, e.fio, fc.date, fc.shift,
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

        // Collect all dates
        const allDates = new Set();
        timesheet.forEach(emp => (emp.days || []).forEach(d => allDates.add(d.date)));
        const dates = [...allDates].sort();

        const wb = new ExcelJS.Workbook();
        wb.creator = 'АСГАРД CRM';
        wb.created = new Date();
        const ws = wb.addWorksheet('Табель');

        // Title
        ws.mergeCells(1, 1, 1, dates.length + 6);
        ws.getCell('A1').value = `ТАБЕЛЬ — ${workTitle}`;
        ws.getCell('A1').font = { bold: true, size: 14 };

        ws.mergeCells(2, 1, 2, dates.length + 6);
        ws.getCell('A2').value = `Период: ${dateFrom || '—'} — ${dateTo || '—'} · Суточные: ${perDiem} ₽/день`;
        ws.getCell('A2').font = { size: 10, italic: true, color: { argb: 'FF666666' } };

        // Header row
        const headers = ['№', 'ФИО'];
        dates.forEach(d => {
          const day = new Date(d + 'T00:00:00');
          headers.push(String(day.getDate()).padStart(2, '0') + '.' + String(day.getMonth() + 1).padStart(2, '0'));
        });
        headers.push('Дней', 'Часов', 'Заработок', 'Суточные', 'ИТОГО');

        const headerRow = ws.addRow(headers);
        headerRow.number = 4;
        ws.getRow(4).values = headers;
        ws.getRow(4).font = { bold: true, size: 10 };
        ws.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5E8F0' } };
        ws.getRow(4).eachCell(c => { c.border = { bottom: { style: 'thin' } }; c.alignment = { horizontal: 'center' }; });

        // Column widths
        ws.getColumn(1).width = 5;
        ws.getColumn(2).width = 30;
        for (let i = 0; i < dates.length; i++) ws.getColumn(i + 3).width = 7;
        ws.getColumn(dates.length + 3).width = 7;
        ws.getColumn(dates.length + 4).width = 9;
        ws.getColumn(dates.length + 5).width = 12;
        ws.getColumn(dates.length + 6).width = 12;
        ws.getColumn(dates.length + 7).width = 14;

        // Data rows
        let grandHours = 0, grandEarned = 0, grandPd = 0, grandTotal = 0;
        timesheet.forEach((emp, idx) => {
          const dayMap = {};
          (emp.days || []).forEach(d => { dayMap[d.date] = d; });

          const vals = [idx + 1, emp.fio || '—'];
          dates.forEach(d => {
            const day = dayMap[d];
            vals.push(day ? parseFloat(day.hours_paid || day.hours_worked || 0) : '');
          });
          vals.push(emp.days_count || 0);
          vals.push(emp.total_paid_hours || emp.total_hours || 0);
          vals.push(emp.total_earned || 0);
          vals.push(emp.per_diem_total || 0);
          vals.push(emp.grand_total || 0);

          const row = ws.addRow(vals);
          row.getCell(vals.length).font = { bold: true };
          row.getCell(vals.length).numFmt = '#,##0 "₽"';
          row.getCell(vals.length - 1).numFmt = '#,##0 "₽"';
          row.getCell(vals.length - 2).numFmt = '#,##0 "₽"';

          grandHours += emp.total_paid_hours || emp.total_hours || 0;
          grandEarned += emp.total_earned || 0;
          grandPd += emp.per_diem_total || 0;
          grandTotal += emp.grand_total || 0;
        });

        // Totals row
        const totals = ['', 'ИТОГО'];
        dates.forEach(() => totals.push(''));
        totals.push(timesheet.reduce((s, e) => s + (e.days_count || 0), 0));
        totals.push(Math.round(grandHours * 100) / 100);
        totals.push(Math.round(grandEarned));
        totals.push(Math.round(grandPd));
        totals.push(Math.round(grandTotal));
        const totalRow = ws.addRow(totals);
        totalRow.font = { bold: true };
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
        totalRow.getCell(totals.length).numFmt = '#,##0 "₽"';
        totalRow.getCell(totals.length - 1).numFmt = '#,##0 "₽"';
        totalRow.getCell(totals.length - 2).numFmt = '#,##0 "₽"';

        const buffer = await wb.xlsx.writeBuffer();
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', `attachment; filename="timesheet_${workId}_${Date.now()}.xlsx"`);
        return reply.send(Buffer.from(buffer));
      }

      return { timesheet, per_diem_rate: perDiem };
    } catch (err) {
      fastify.log.error('[field-manage] timesheet error:', err);
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
}

module.exports = routes;
