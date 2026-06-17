/**
 * Global Timesheet API
 * ═══════════════════════════════════════════════════════════════════════════
 * Prefix: /api/timesheet
 *
 * GET  /global/:year/:month         — общий табель за месяц
 * GET  /global/:year/:month/export  — Excel (xlsx) через ExcelJS
 * PUT  /global/entry                — добавить отметку (1 день = 1 отметка)
 * GET  /workers/search?q=...        — поиск рабочих для модалки «+ Добавить»
 *
 * Просмотр: ADMIN, DIRECTOR_*, TO, HEAD_TO, WAREHOUSE, PROC, BUH, HR, HR_MANAGER
 * Редактирование:
 *   ADMIN/DIRECTOR_*  — все типы
 *   TO/HEAD_TO        — только 'medical'
 *   WAREHOUSE         — только 'warehouse'
 *   PROC/BUH/HR/HR_MANAGER — read-only (включая Excel-выгрузку)
 *
 * Типы:
 *   day / night → field_checkins (требуется work_id + employee_assignment NOT NULL)
 *   warehouse / medical / waiting / travel → field_trip_stages (work_id может быть NULL)
 *
 * Один день = одна отметка: PUT 409 если на дату уже есть completed checkin
 * ИЛИ активная запись field_trip_stages у этого employee.
 */

const VIEW_ROLES = [
  'ADMIN',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'TO', 'HEAD_TO',
  'WAREHOUSE',
  'PROC', 'BUH',
  'HR', 'HR_MANAGER'
];

const STAGE_TYPES = ['warehouse', 'medical', 'waiting', 'travel'];
const SHIFT_TYPES = ['day', 'night'];

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function fmtDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  return String(d);
}

function canEditType(role, type) {
  if (role === 'ADMIN' || role.startsWith('DIRECTOR_')) return true;
  if ((role === 'TO' || role === 'HEAD_TO') && type === 'medical') return true;
  if (role === 'WAREHOUSE' && type === 'warehouse') return true;
  return false;
}

async function routes(fastify, options) {
  const db = fastify.db;

  // ─── GET /global/:year/:month ─────────────────────────────────────────────
  fastify.get('/global/:year/:month', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const year  = parseInt(request.params.year, 10);
    const month = parseInt(request.params.month, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return reply.code(400).send({ error: 'Bad year/month' });
    }
    const dim = daysInMonth(year, month);
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const periodEnd   = `${year}-${String(month).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;

    // Чекины (только completed — SSoT, см. memory feedback_field_checkins_status)
    const { rows: checkins } = await db.query(`
      SELECT
        fc.employee_id, fc.work_id, fc.date, fc.shift, fc.hours_worked, fc.amount_earned,
        e.fio, e.role_tag, e.full_name,
        w.work_title
      FROM field_checkins fc
      LEFT JOIN employees e ON e.id = fc.employee_id
      LEFT JOIN works w     ON w.id = fc.work_id
      WHERE fc.date >= $1 AND fc.date <= $2
        AND fc.status = 'completed'
    `, [periodStart, periodEnd]);

    // Этапы командировки (medical/warehouse/waiting/travel — work_id может быть NULL)
    const { rows: stages } = await db.query(`
      SELECT
        fts.employee_id, fts.work_id, fts.date_from, fts.date_to, fts.days_count,
        fts.stage_type, fts.amount_earned, fts.status,
        e.fio, e.role_tag, e.full_name,
        w.work_title
      FROM field_trip_stages fts
      LEFT JOIN employees e ON e.id = fts.employee_id
      LEFT JOIN works w     ON w.id = fts.work_id
      WHERE COALESCE(fts.status, 'active') NOT IN ('rejected','cancelled')
        AND fts.date_from <= $2
        AND COALESCE(fts.date_to, fts.date_from) >= $1
    `, [periodStart, periodEnd]);

    // Группировка: ключ = employee_id × work_id (или 0 если NULL — «Без объекта»)
    // Каждая (emp, work) → одна строка в табеле с entries{YYYY-MM-DD: {type, amount, hours}}
    const rowMap = {}; // key = `${empId}_${workKey}`
    function ensureRow(empId, fio, position, roleTag, workId, workTitle) {
      const wKey = workId || 0;
      const key = `${empId}_${wKey}`;
      if (!rowMap[key]) {
        rowMap[key] = {
          employee_id: empId,
          fio: fio || '—',
          position: position || roleTag || '',
          role_tag: roleTag || '',
          work_id: workId || null,
          work_title: workTitle || 'Без объекта',
          entries: {},
          total_days: 0,
          total_amount: 0
        };
      }
      return rowMap[key];
    }

    for (const c of checkins) {
      const row = ensureRow(c.employee_id, c.fio || c.full_name, c.role_tag, c.role_tag, c.work_id, c.work_title);
      const dStr = fmtDate(c.date);
      if (row.entries[dStr]) continue; // уже занято
      row.entries[dStr] = {
        type: c.shift || 'day',
        amount: Number(c.amount_earned || 0),
        hours: Number(c.hours_worked || 0)
      };
      row.total_days += 1;
      row.total_amount += Number(c.amount_earned || 0);
    }

    for (const s of stages) {
      const row = ensureRow(s.employee_id, s.fio || s.full_name, s.role_tag, s.role_tag, s.work_id, s.work_title);
      const from = new Date(s.date_from);
      const to   = s.date_to ? new Date(s.date_to) : from;
      const startMs = Math.max(from.getTime(), new Date(periodStart).getTime());
      const endMs   = Math.min(to.getTime(), new Date(periodEnd).getTime());
      const oneDay  = 24 * 60 * 60 * 1000;
      const dCount  = Math.max(1, Math.round((endMs - startMs) / oneDay) + 1);
      const perDay  = Number(s.amount_earned || 0) / Math.max(1, Number(s.days_count || dCount));
      for (let t = startMs; t <= endMs; t += oneDay) {
        const dStr = fmtDate(new Date(t));
        if (row.entries[dStr]) continue;
        row.entries[dStr] = {
          type: s.stage_type,
          amount: perDay,
          hours: 0
        };
        row.total_days += 1;
        row.total_amount += perDay;
      }
    }

    const workers = Object.values(rowMap).sort((a, b) => {
      const t = (a.work_title || '').localeCompare(b.work_title || '');
      if (t !== 0) return t;
      return (a.fio || '').localeCompare(b.fio || '');
    });

    const uniqueEmps = new Set(workers.map(w => w.employee_id));

    return {
      year, month,
      days_in_month: dim,
      workers,
      total: {
        workers: uniqueEmps.size,
        days: workers.reduce((s, w) => s + w.total_days, 0),
        amount: workers.reduce((s, w) => s + w.total_amount, 0)
      }
    };
  });

  // ─── GET /workers/search?q=... — поиск рабочих для модалки «+ Добавить» ──
  fastify.get('/workers/search', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const q = String(request.query.q || '').trim();
    if (q.length < 2) return { workers: [] };
    const like = '%' + q.toLowerCase() + '%';
    const { rows } = await db.query(`
      SELECT e.id AS employee_id, e.fio, e.full_name, e.phone, e.role_tag
      FROM employees e
      WHERE (
          LOWER(COALESCE(e.fio,''))          LIKE $1
          OR LOWER(COALESCE(e.full_name,'')) LIKE $1
          OR LOWER(COALESCE(e.phone,''))     LIKE $1
        )
      ORDER BY COALESCE(e.fio, e.full_name) ASC
      LIMIT 30
    `, [like]);
    return {
      workers: rows.map(r => ({
        employee_id: r.employee_id,
        fio: r.fio || r.full_name || '—',
        phone: r.phone || '',
        position: r.role_tag || ''
      }))
    };
  });

  // ─── GET /global/:year/:month/export — реальный Excel xlsx ────────────────
  fastify.get('/global/:year/:month/export', {
    preHandler: [
      async (request, reply) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.requireRoles(VIEW_ROLES)
    ]
  }, async (request, reply) => {
    try {
      const ExcelJS = require('exceljs');
      const year  = parseInt(request.params.year, 10);
      const month = parseInt(request.params.month, 10);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return reply.code(400).send({ error: 'Bad year/month' });
      }

      // Реюз бизнес-логики GET /global/:year/:month — через inject
      const proxy = await fastify.inject({
        method: 'GET',
        url: `/api/timesheet/global/${year}/${month}`,
        headers: request.headers
      });
      if (proxy.statusCode !== 200) {
        return reply.code(proxy.statusCode).send(proxy.body);
      }
      const data = JSON.parse(proxy.body);
      const workers = data.workers || [];

      const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
      const mName = monthNames[month - 1] || '';
      const lastDay = data.days_in_month || daysInMonth(year, month);

      const wb = new ExcelJS.Workbook();
      wb.creator = 'АСГАРД CRM';
      wb.created = new Date();
      const ws = wb.addWorksheet('Табель');

      const totalCols = 2 + lastDay + 2; // ФИО | Объект | дни... | Итого дней | Итого ₽
      const DAY_NAMES_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

      // Цвета клеток по типу
      const TYPE_FILL = {
        day:       'FFB8E6B8',  // зелёный
        night:     'FFADD8E6',  // голубой
        warehouse: 'FFFFE4B5',  // песочный
        medical:   'FFFFB6C1',  // розовый
        travel:    'FFFFE066',  // жёлтый
        waiting:   'FFD3D3D3'   // серый
      };
      const TYPE_LABEL = {
        day: 'Д', night: 'Н', warehouse: 'С', medical: 'М', travel: '🚗', waiting: '⏳'
      };

      const thin = { style: 'thin' };
      const thinBorder = { top: thin, bottom: thin, left: thin, right: thin };

      // Заголовок
      ws.mergeCells(1, 1, 1, totalCols);
      const t = ws.getCell(1, 1);
      t.value = `ТАБЕЛЬ — ${mName} ${year}`;
      t.font = { bold: true, size: 14, color: { argb: 'FF1A2B4A' } };
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5E8F0' } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 28;

      // Легенда
      ws.mergeCells(2, 1, 2, totalCols);
      const lg = ws.getCell(2, 1);
      lg.value = '🟢 Д — день · 🔵 Н — ночь · 🟡 С — склад · 🌸 М — медосмотр · 🟨 🚗 — дорога · ⏳ — ожидание · Выходные подсвечены';
      lg.font = { size: 9, color: { argb: 'FF666666' } };
      lg.alignment = { horizontal: 'center' };
      ws.getRow(2).height = 14;

      // Шапка таблицы (строка 3)
      const hdr = ws.getRow(3);
      hdr.height = 32;
      const hdrBaseFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB8D4E8' } };

      const c1 = hdr.getCell(1); c1.value = 'ФИО'; c1.font = { bold: true, size: 10 }; c1.fill = hdrBaseFill; c1.alignment = { horizontal: 'left', vertical: 'middle' }; c1.border = thinBorder;
      const c2 = hdr.getCell(2); c2.value = 'Объект'; c2.font = { bold: true, size: 10 }; c2.fill = hdrBaseFill; c2.alignment = { horizontal: 'left', vertical: 'middle' }; c2.border = thinBorder;

      for (let d = 1; d <= lastDay; d++) {
        const dt = new Date(year, month - 1, d);
        const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
        const cell = hdr.getCell(2 + d);
        cell.value = `${d}\n${DAY_NAMES_SHORT[dt.getDay()]}`;
        cell.font = { bold: true, size: 9, color: { argb: isWeekend ? 'FFCC0000' : 'FF1A2B4A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isWeekend ? 'FFFDE8E8' : 'FFB8D4E8' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = thinBorder;
      }
      const cDays = hdr.getCell(2 + lastDay + 1); cDays.value = 'Дней'; cDays.font = { bold: true, size: 10 }; cDays.fill = hdrBaseFill; cDays.alignment = { horizontal: 'center', vertical: 'middle' }; cDays.border = thinBorder;
      const cAmt  = hdr.getCell(2 + lastDay + 2); cAmt.value = 'Сумма ₽'; cAmt.font = { bold: true, size: 10 }; cAmt.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4A843' } }; cAmt.alignment = { horizontal: 'center', vertical: 'middle' }; cAmt.border = thinBorder;

      // Ширины
      ws.getColumn(1).width = 26;
      ws.getColumn(2).width = 22;
      for (let d = 1; d <= lastDay; d++) ws.getColumn(2 + d).width = 4.5;
      ws.getColumn(2 + lastDay + 1).width = 8;
      ws.getColumn(2 + lastDay + 2).width = 14;

      // Заморозка
      ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];

      // Данные
      let rowIdx = 4;
      let sumDays = 0, sumAmount = 0;
      const daySums = new Array(lastDay).fill(0);

      for (const w of workers) {
        const r = ws.getRow(rowIdx);
        r.height = 18;
        const fio = r.getCell(1); fio.value = w.fio; fio.font = { size: 10, bold: true }; fio.border = thinBorder;
        const obj = r.getCell(2); obj.value = w.work_title || 'Без объекта'; obj.font = { size: 10 }; obj.border = thinBorder;

        for (let d = 1; d <= lastDay; d++) {
          const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const entry = (w.entries || {})[key];
          const dt = new Date(year, month - 1, d);
          const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
          const cell = r.getCell(2 + d);
          if (entry && entry.type) {
            cell.value = TYPE_LABEL[entry.type] || entry.type;
            const fillColor = TYPE_FILL[entry.type] || 'FFEEEEEE';
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
            cell.font = { size: 10, bold: true };
            if (Number(entry.amount) > 0) daySums[d - 1] += Number(entry.amount);
          } else if (isWeekend) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E8' } };
          }
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = thinBorder;
        }

        const td = r.getCell(2 + lastDay + 1);
        td.value = w.total_days || 0;
        td.font = { size: 10, bold: true };
        td.alignment = { horizontal: 'center', vertical: 'middle' };
        td.border = thinBorder;

        const ta = r.getCell(2 + lastDay + 2);
        ta.value = Math.round(Number(w.total_amount || 0));
        ta.numFmt = '#,##0 "₽"';
        ta.font = { size: 10, bold: true, color: { argb: 'FF92610A' } };
        ta.alignment = { horizontal: 'right', vertical: 'middle' };
        ta.border = thinBorder;

        sumDays += Number(w.total_days || 0);
        sumAmount += Number(w.total_amount || 0);
        rowIdx++;
      }

      // Итоговая строка
      if (workers.length > 0) {
        const tot = ws.getRow(rowIdx);
        tot.height = 22;
        ws.mergeCells(rowIdx, 1, rowIdx, 2);
        const lab = tot.getCell(1);
        lab.value = 'ИТОГО:';
        lab.font = { bold: true, size: 11 };
        lab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
        lab.alignment = { horizontal: 'right', vertical: 'middle' };
        lab.border = thinBorder;
        for (let d = 1; d <= lastDay; d++) {
          const cell = tot.getCell(2 + d);
          const v = daySums[d - 1];
          if (v > 0) cell.value = Math.round(v);
          cell.numFmt = '#,##0';
          cell.font = { bold: true, size: 9 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = thinBorder;
        }
        const td = tot.getCell(2 + lastDay + 1);
        td.value = sumDays;
        td.font = { bold: true, size: 11 };
        td.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
        td.alignment = { horizontal: 'center', vertical: 'middle' };
        td.border = thinBorder;

        const ta = tot.getCell(2 + lastDay + 2);
        ta.value = Math.round(sumAmount);
        ta.numFmt = '#,##0 "₽"';
        ta.font = { bold: true, size: 11, color: { argb: 'FF92610A' } };
        ta.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4A843' } };
        ta.alignment = { horizontal: 'right', vertical: 'middle' };
        ta.border = thinBorder;
      }

      const buf = await wb.xlsx.writeBuffer();
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const fname = encodeURIComponent(`Табель_${mName}_${year}.xlsx`);
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${fname}`);
      return reply.send(Buffer.from(buf));
    } catch (err) {
      fastify.log.error('[global-timesheet] export error: ' + err.message);
      return reply.code(500).send({ error: 'Ошибка экспорта' });
    }
  });

  // ─── PUT /global/entry — добавить отметку ─────────────────────────────────
  fastify.put('/global/entry', { preHandler: [fastify.requireRoles(VIEW_ROLES)] }, async (request, reply) => {
    const role = request.user.role;
    const { employee_id, work_id, date, type, amount, hours, note } = request.body || {};
    if (!employee_id || !date || !type) {
      return reply.code(400).send({ error: 'employee_id, date, type обязательны' });
    }
    if (!SHIFT_TYPES.includes(type) && !STAGE_TYPES.includes(type)) {
      return reply.code(400).send({ error: 'Неизвестный type: ' + type });
    }
    if (!canEditType(role, type)) {
      return reply.code(403).send({ error: 'Недостаточно прав для типа: ' + type });
    }

    // Проверка employee существует
    const { rows: emp } = await db.query('SELECT id FROM employees WHERE id = $1', [employee_id]);
    if (!emp.length) return reply.code(404).send({ error: 'Сотрудник не найден' });

    // Один день = одна отметка: проверка и checkin и stage
    const { rows: existingCi } = await db.query(`
      SELECT id FROM field_checkins
      WHERE employee_id = $1 AND date = $2 AND status = 'completed'
      LIMIT 1
    `, [employee_id, date]);
    if (existingCi.length) {
      return reply.code(409).send({ error: 'На эту дату уже есть completed чекин' });
    }
    const { rows: existingStage } = await db.query(`
      SELECT id FROM field_trip_stages
      WHERE employee_id = $1
        AND date_from <= $2::date
        AND COALESCE(date_to, date_from) >= $2::date
        AND COALESCE(status, 'active') NOT IN ('rejected','cancelled')
      LIMIT 1
    `, [employee_id, date]);
    if (existingStage.length) {
      return reply.code(409).send({ error: 'На эту дату уже есть отметка' });
    }

    // day/night → field_checkins (требуется work_id + assignment_id)
    if (SHIFT_TYPES.includes(type)) {
      if (!work_id) return reply.code(400).send({ error: 'work_id обязателен для day/night' });
      // Найти assignment_id (NOT NULL constraint в field_checkins, V088)
      const { rows: assign } = await db.query(`
        SELECT id FROM employee_assignments
        WHERE employee_id = $1 AND work_id = $2 AND is_active = true
        ORDER BY id DESC LIMIT 1
      `, [employee_id, work_id]);
      if (!assign.length) {
        return reply.code(400).send({ error: 'У рабочего нет активного назначения на эту работу' });
      }
      const { rows: [ci] } = await db.query(`
        INSERT INTO field_checkins
          (employee_id, work_id, assignment_id, date, shift, status, checkin_at, amount_earned, hours_worked, checkin_source, checkin_by, note)
        VALUES ($1, $2, $3, $4, $5, 'completed', NOW(), $6, $7, 'admin', $8, $9)
        RETURNING *
      `, [employee_id, work_id, assign[0].id, date, type, amount || null, hours || null, request.user.id, note || null]);
      return { ok: true, entry: ci, kind: 'checkin' };
    }

    // warehouse/medical/waiting/travel → field_trip_stages (work_id может быть NULL)
    const { rows: [st] } = await db.query(`
      INSERT INTO field_trip_stages
        (employee_id, work_id, stage_type, date_from, date_to, days_count, tariff_points, rate_per_day, amount_earned, status, created_by, note)
      VALUES ($1, $2, $3, $4, $4, 1, 0, $5, $6, 'active', $7, $8)
      RETURNING *
    `, [employee_id, work_id || null, type, date, amount || 0, amount || 0, request.user.id, note || null]);
    return { ok: true, entry: st, kind: 'stage' };
  });
}

module.exports = routes;
