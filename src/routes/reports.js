/**
 * Reports Routes - Analytics, Export & Auto-Reports
 * 
 * Автоотчёты:
 * - Месячный (1-го числа каждого месяца)
 * - Квартальный (1-го числа после квартала)
 * - Годовой (1 января)
 */
const ExcelJS = require('exceljs');

async function routes(fastify, options) {
  const db = fastify.db;

  // === ROOT LIST ===
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    return {
      reports: [
        { type: 'monthly', label: 'Месячный отчёт', url: '/api/reports/monthly' },
        { type: 'quarterly', label: 'Квартальный отчёт', url: '/api/reports/generate/quarterly' },
        { type: 'yearly', label: 'Годовой отчёт', url: '/api/reports/generate/yearly' },
        { type: 'dashboard', label: 'Дашборд', url: '/api/reports/dashboard' },
        { type: 'pm-performance', label: 'Эффективность PM', url: '/api/reports/pm-performance' },
        { type: 'funnel', label: 'Воронка', url: '/api/reports/funnel' }
      ]
    };
  });

  // === АВТООТЧЁТЫ ===

  // Генерация месячного отчёта
  fastify.get('/generate/monthly', { preHandler: [fastify.authenticate] }, async (request) => {
    const { year, month } = request.query;
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;
    
    const report = await generateMonthlyReport(db, y, m);
    return report;
  });
  
  // Генерация квартального отчёта
  fastify.get('/generate/quarterly', { preHandler: [fastify.authenticate] }, async (request) => {
    const { year, quarter } = request.query;
    const y = parseInt(year) || new Date().getFullYear();
    const q = parseInt(quarter) || Math.ceil((new Date().getMonth() + 1) / 3);
    
    const report = await generateQuarterlyReport(db, y, q);
    return report;
  });
  
  // Генерация годового отчёта
  fastify.get('/generate/yearly', { preHandler: [fastify.authenticate] }, async (request) => {
    const { year } = request.query;
    const y = parseInt(year) || new Date().getFullYear();
    
    const report = await generateYearlyReport(db, y);
    return report;
  });
  
  // Скачивание отчёта в Excel
  fastify.get('/download/:type', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { type } = request.params;
    const { year, month, quarter, format = 'xlsx' } = request.query;
    
    let report;
    let filename;
    
    const y = parseInt(year) || new Date().getFullYear();
    
    if (type === 'monthly') {
      const m = parseInt(month) || new Date().getMonth() + 1;
      report = await generateMonthlyReport(db, y, m);
      filename = `report_${y}_${String(m).padStart(2,'0')}`;
    } else if (type === 'quarterly') {
      const q = parseInt(quarter) || Math.ceil((new Date().getMonth() + 1) / 3);
      report = await generateQuarterlyReport(db, y, q);
      filename = `report_${y}_Q${q}`;
    } else if (type === 'yearly') {
      report = await generateYearlyReport(db, y);
      filename = `report_${y}`;
    } else {
      return reply.code(400).send({ error: 'Неверный тип отчёта' });
    }
    
    if (format === 'xlsx') {
      const buffer = await generateExcel(report, type);
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${filename}.xlsx"`)
        .send(buffer);
    } else {
      return report;
    }
  });
  
  // Запуск авто-отчётов (вызывается cron или вручную)
  fastify.post('/auto-generate', { preHandler: [fastify.authenticate] }, async (request) => {
    if (request.user.role !== 'ADMIN') {
      return { error: 'Недостаточно прав' };
    }
    
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    
    const results = [];
    
    // 1-го числа — месячный отчёт за прошлый месяц
    if (day === 1) {
      const lastMonth = month === 1 ? 12 : month - 1;
      const lastYear = month === 1 ? year - 1 : year;
      
      const report = await generateMonthlyReport(db, lastYear, lastMonth);
      await saveReport(db, report, 'monthly');
      await notifyAdmins(db, fastify, 'monthly', `${lastMonth}.${lastYear}`);
      results.push({ type: 'monthly', period: `${lastMonth}.${lastYear}` });
    }
    
    // 1 апреля, июля, октября, января — квартальный
    if (day === 1 && [1, 4, 7, 10].includes(month)) {
      const lastQuarter = month === 1 ? 4 : Math.floor((month - 1) / 3);
      const qYear = month === 1 ? year - 1 : year;
      
      const report = await generateQuarterlyReport(db, qYear, lastQuarter);
      await saveReport(db, report, 'quarterly');
      await notifyAdmins(db, fastify, 'quarterly', `Q${lastQuarter} ${qYear}`);
      results.push({ type: 'quarterly', period: `Q${lastQuarter} ${qYear}` });
    }
    
    // 1 января — годовой
    if (day === 1 && month === 1) {
      const report = await generateYearlyReport(db, year - 1);
      await saveReport(db, report, 'yearly');
      await notifyAdmins(db, fastify, 'yearly', `${year - 1}`);
      results.push({ type: 'yearly', period: `${year - 1}` });
    }
    
    return { generated: results };
  });
  
  // Список сохранённых отчётов
  fastify.get('/saved', { preHandler: [fastify.authenticate] }, async (request) => {
    const result = await db.query(`
      SELECT * FROM saved_reports ORDER BY created_at DESC LIMIT 50
    `);
    return { reports: result.rows };
  });

  // Dashboard summary
  fastify.get('/dashboard', { preHandler: [fastify.authenticate] }, async (request) => {
    const { year, period } = request.query;
    const currentYear = year || new Date().getFullYear();

    const [tenders, works, expenses, incomes] = await Promise.all([
      db.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')) as won,
          COUNT(*) FILTER (WHERE tender_status IN ('Проиграли', 'Отказ', 'Клиент отказался')) as lost,
          COALESCE(SUM(tender_price), 0) as total_sum,
          COALESCE(SUM(tender_price) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')), 0) as won_sum
        FROM tenders
        WHERE EXTRACT(YEAR FROM created_at) = $1
      `, [currentYear]),
      
      db.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE work_status = 'Завершена') as completed,
          COALESCE(SUM(contract_sum), 0) as total_sum
        FROM works
        WHERE EXTRACT(YEAR FROM created_at) = $1
      `, [currentYear]),
      
      db.query(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM work_expenses
        WHERE EXTRACT(YEAR FROM date) = $1
      `, [currentYear]),
      
      db.query(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM incomes
        WHERE EXTRACT(YEAR FROM date) = $1
      `, [currentYear])
    ]);

    return {
      year: currentYear,
      tenders: tenders.rows[0],
      works: works.rows[0],
      expenses: parseFloat(expenses.rows[0].total),
      incomes: parseFloat(incomes.rows[0].total),
      profit: parseFloat(incomes.rows[0].total) - parseFloat(expenses.rows[0].total)
    };
  });

  // Monthly breakdown
  fastify.get('/monthly', { preHandler: [fastify.authenticate] }, async (request) => {
    const { year } = request.query;
    const currentYear = year || new Date().getFullYear();

    const result = await db.query(`
      SELECT 
        EXTRACT(MONTH FROM date) as month,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expenses,
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as incomes
      FROM (
        SELECT date, amount, 'expense' as type FROM work_expenses WHERE EXTRACT(YEAR FROM date) = $1
        UNION ALL
        SELECT date, amount, 'expense' as type FROM office_expenses WHERE EXTRACT(YEAR FROM date) = $1
        UNION ALL
        SELECT date, amount, 'income' as type FROM incomes WHERE EXTRACT(YEAR FROM date) = $1
      ) combined
      GROUP BY EXTRACT(MONTH FROM date)
      ORDER BY month
    `, [currentYear]);

    const months = Array(12).fill(null).map((_, i) => ({
      month: i + 1,
      expenses: 0,
      incomes: 0
    }));

    for (const row of result.rows) {
      const idx = parseInt(row.month, 10) - 1;
      months[idx] = {
        month: parseInt(row.month, 10),
        expenses: parseFloat(row.expenses),
        incomes: parseFloat(row.incomes)
      };
    }

    return { year: currentYear, months };
  });

  // PM performance
  fastify.get('/pm-performance', { preHandler: [fastify.authenticate] }, async (request) => {
    const { year } = request.query;
    const currentYear = year || new Date().getFullYear();

    const result = await db.query(`
      SELECT 
        u.id,
        u.name,
        COUNT(DISTINCT t.id) as tenders_count,
        COUNT(DISTINCT t.id) FILTER (WHERE t.tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')) as won_count,
        COUNT(DISTINCT w.id) as works_count,
        COALESCE(SUM(w.contract_sum), 0) as total_sum
      FROM users u
      LEFT JOIN tenders t ON t.responsible_pm_id = u.id AND EXTRACT(YEAR FROM t.created_at) = $1
      LEFT JOIN works w ON w.pm_id = u.id AND EXTRACT(YEAR FROM w.created_at) = $1
      WHERE u.is_active = true AND EXISTS (SELECT 1 FROM works w2 WHERE w2.pm_id = u.id)
      GROUP BY u.id, u.name
      ORDER BY total_sum DESC
    `, [currentYear]);

    return { year: currentYear, pms: result.rows };
  });

  // Funnel stats
  fastify.get('/funnel', { preHandler: [fastify.authenticate] }, async (request) => {
    const { period } = request.query;

    let whereClause = '1=1';
    const params = [];
    if (period) {
      whereClause = 'period = $1';
      params.push(period);
    }

    const result = await db.query(`
      SELECT 
        tender_status,
        COUNT(*) as count,
        COALESCE(SUM(tender_price), 0) as sum
      FROM tenders
      WHERE ${whereClause}
      GROUP BY tender_status
      ORDER BY count DESC
    `, params);

    return { stages: result.rows };
  });

  // Export to Excel (basic)
  fastify.get('/export/tenders', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { period, format = 'json' } = request.query;

    let sql = 'SELECT * FROM tenders';
    const params = [];
    if (period) {
      sql += ' WHERE period = $1';
      params.push(period);
    }
    sql += ' ORDER BY id DESC';

    const result = await db.query(sql, params);

    if (format === 'csv') {
      const headers = Object.keys(result.rows[0] || {});
      const csv = [
        headers.join(';'),
        ...result.rows.map(row => headers.map(h => `"${(row[h] ?? '').toString().replace(/"/g, '""')}"`).join(';'))
      ].join('\n');

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="tenders.csv"')
        .send('\ufeff' + csv);
      return;
    }

    return { tenders: result.rows };
  });

  // PM analytics — performance metrics for project managers
  fastify.get('/pm-analytics', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const isPM = user.role === 'PM' || user.role === 'HEAD_PM';
    const isAdmin = ['ADMIN', 'DIR', 'FIN_DIR', 'DIRECTOR_GEN', 'DIRECTOR_COM', 'DIRECTOR_DEV'].includes(user.role);

    if (!isPM && !isAdmin) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    try {
      // If PM - own stats only, if admin - all PMs
      const needFilter = isPM && !isAdmin;
      const params = needFilter ? [user.id] : [];
      const pmFilter = needFilter ? 'AND w.responsible_pm_id = $1' : '';
      
      const stats = await db.query(`
        SELECT 
          COUNT(*) as total_works,
          COUNT(*) FILTER (WHERE w.status = 'completed') as completed,
          COUNT(*) FILTER (WHERE w.status = 'in_progress') as in_progress,
          COUNT(*) FILTER (WHERE w.status = 'overdue' OR (w.end_date_plan IS NOT NULL AND w.end_date_plan < CURRENT_DATE AND w.status != 'completed')) as overdue,
          COALESCE(SUM(CASE WHEN w.status = 'completed' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) * 100, 0) as completion_rate
        FROM works w
        WHERE 1=1 ${pmFilter}
      `, params);

      const userFilter = needFilter ? 'AND u.id = $1' : '';
      const pmList = await db.query(`
        SELECT 
          u.id, u.name, u.login,
          COUNT(w.id) as total_works,
          COUNT(w.id) FILTER (WHERE w.status = 'completed') as completed,
          COUNT(w.id) FILTER (WHERE w.status = 'in_progress') as active
        FROM users u
        LEFT JOIN works w ON w.responsible_pm_id = u.id
        WHERE u.is_active = true AND (u.role IN ('PM', 'HEAD_PM', 'DIRECTOR_DEV', 'DIRECTOR_GEN', 'CHIEF_ENGINEER', 'HR') OR EXISTS (SELECT 1 FROM works w2 WHERE w2.pm_id = u.id))
        ${userFilter}
        GROUP BY u.id, u.name, u.login
        ORDER BY total_works DESC
      `, params);

      return {
        success: true,
        summary: stats.rows[0],
        managers: pmList.rows
      };
    } catch(err) {
      fastify.log.error({err}, 'PM analytics error');
      return reply.code(500).send({ error: 'Ошибка генерации аналитики' });
    }
  });

  // TO analytics — performance metrics for tender officers
  fastify.get('/to-analytics', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const isTO = user.role === 'TO' || user.role === 'HEAD_TO';
    const isAdmin = ['ADMIN', 'DIR', 'FIN_DIR', 'DIRECTOR_GEN', 'DIRECTOR_COM', 'DIRECTOR_DEV'].includes(user.role);

    if (!isTO && !isAdmin) {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    try {
      const needFilter = isTO && !isAdmin;
      const params = needFilter ? [user.id] : [];
      const toFilter = needFilter ? 'AND t.created_by_user_id = $1' : '';

      const stats = await db.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE t.tender_status = 'Выиграли') as won,
          COUNT(*) FILTER (WHERE t.tender_status = 'Проиграли') as lost,
          COUNT(*) FILTER (WHERE t.tender_status IN ('В работе', 'Новый', 'Согласование ТКП', 'ТКП согласовано')) as active,
          COALESCE(SUM(CASE WHEN t.tender_status = 'Выиграли' THEN t.tender_price ELSE 0 END), 0) as sum_won,
          CASE WHEN COUNT(*) FILTER (WHERE t.tender_status IN ('Выиграли', 'Проиграли')) > 0
            THEN ROUND(COUNT(*) FILTER (WHERE t.tender_status = 'Выиграли')::numeric / COUNT(*) FILTER (WHERE t.tender_status IN ('Выиграли', 'Проиграли')) * 100, 1)
            ELSE 0
          END as conversion
        FROM tenders t
        WHERE 1=1 ${toFilter}
      `, params);

      const userFilter = needFilter ? 'AND u.id = $1' : '';
      const toList = await db.query(`
        SELECT
          u.id, u.name, u.login,
          COUNT(t.id) as total,
          COUNT(t.id) FILTER (WHERE t.tender_status = 'Выиграли') as won,
          COUNT(t.id) FILTER (WHERE t.tender_status = 'Проиграли') as lost,
          COALESCE(SUM(CASE WHEN t.tender_status = 'Выиграли' THEN t.tender_price ELSE 0 END), 0) as sum_won
        FROM users u
        LEFT JOIN tenders t ON t.created_by_user_id = u.id
        WHERE u.role IN ('TO', 'HEAD_TO') AND u.is_active = true
        ${userFilter}
        GROUP BY u.id, u.name, u.login
        ORDER BY won DESC
      `, params);

      return {
        success: true,
        summary: stats.rows[0],
        managers: toList.rows
      };
    } catch(err) {
      fastify.log.error({err}, 'TO analytics error');
      return reply.code(500).send({ error: 'Ошибка генерации аналитики ТО' });
    }
  });

}

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

async function generateMonthlyReport(db, year, month) {
  const startDate = `${year}-${String(month).padStart(2,'0')}-01`;
  const endDate = month === 12 
    ? `${year + 1}-01-01` 
    : `${year}-${String(month + 1).padStart(2,'0')}-01`;
  
  const monthNames = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  
  const report = {
    type: 'monthly',
    period: `${monthNames[month]} ${year}`,
    period_code: `${year}-${String(month).padStart(2,'0')}`,
    generated_at: new Date().toISOString(),
    data: {}
  };
  
  // Тендеры
  const tenders = await db.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE tender_status = 'Новый') as new,
      COUNT(*) FILTER (WHERE tender_status = 'В работе') as in_work,
      COUNT(*) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')) as won,
      COUNT(*) FILTER (WHERE tender_status IN ('Проиграли', 'Отказ', 'Клиент отказался')) as lost,
      COALESCE(SUM(tender_price), 0) as total_sum,
      COALESCE(SUM(tender_price) FILTER (WHERE tender_status IN ('Выиграли', 'Контракт', 'Клиент согласился')), 0) as won_sum
    FROM tenders
    WHERE created_at >= $1 AND created_at < $2
  `, [startDate, endDate]);
  report.data.tenders = tenders.rows[0];
  
  // Работы
  const works = await db.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE work_status = 'В работе') as active,
      COUNT(*) FILTER (WHERE work_status = 'Завершена') as completed,
      COALESCE(SUM(contract_sum), 0) as total_sum
    FROM works
    WHERE created_at >= $1 AND created_at < $2
  `, [startDate, endDate]);
  report.data.works = works.rows[0];
  
  // Доходы
  const incomes = await db.query(`
    SELECT 
      COALESCE(SUM(amount), 0) as total,
      COUNT(*) as count,
      COALESCE(SUM(amount) FILTER (WHERE type = 'advance'), 0) as advance,
      COALESCE(SUM(amount) FILTER (WHERE type = 'payment'), 0) as payment,
      COALESCE(SUM(amount) FILTER (WHERE type = 'final'), 0) as final
    FROM incomes
    WHERE date >= $1 AND date < $2
  `, [startDate, endDate]);
  report.data.incomes = incomes.rows[0];
  
  // Расходы
  const workExpenses = await db.query(`
    SELECT 
      COALESCE(SUM(amount), 0) as total,
      COUNT(*) as count
    FROM work_expenses
    WHERE date >= $1 AND date < $2
  `, [startDate, endDate]);
  
  const officeExpenses = await db.query(`
    SELECT 
      COALESCE(SUM(amount), 0) as total,
      COUNT(*) as count,
      category,
      COALESCE(SUM(amount), 0) as cat_sum
    FROM office_expenses
    WHERE date >= $1 AND date < $2
    GROUP BY category
  `, [startDate, endDate]);
  
  const totalOffice = officeExpenses.rows.reduce((sum, r) => sum + parseFloat(r.cat_sum || 0), 0);
  
  report.data.expenses = {
    work: parseFloat(workExpenses.rows[0]?.total || 0),
    office: totalOffice,
    total: parseFloat(workExpenses.rows[0]?.total || 0) + totalOffice,
    by_category: {}
  };
  
  officeExpenses.rows.forEach(r => {
    report.data.expenses.by_category[r.category || 'other'] = parseFloat(r.cat_sum || 0);
  });
  
  // Итоговая прибыль
  report.data.profit = parseFloat(report.data.incomes.total) - report.data.expenses.total;
  
  // Топ заказчики
  const topCustomers = await db.query(`
    SELECT customer_name, COUNT(*) as count, COALESCE(SUM(tender_price), 0) as sum
    FROM tenders
    WHERE created_at >= $1 AND created_at < $2 AND customer_name IS NOT NULL
    GROUP BY customer_name
    ORDER BY sum DESC
    LIMIT 5
  `, [startDate, endDate]);
  report.data.top_customers = topCustomers.rows;
  
  return report;
}

async function generateQuarterlyReport(db, year, quarter) {
  const months = quarter === 1 ? [1,2,3] : quarter === 2 ? [4,5,6] : quarter === 3 ? [7,8,9] : [10,11,12];
  
  const report = {
    type: 'quarterly',
    period: `${quarter} квартал ${year}`,
    period_code: `${year}-Q${quarter}`,
    generated_at: new Date().toISOString(),
    data: {
      tenders: { total: 0, won: 0, lost: 0, total_sum: 0, won_sum: 0 },
      works: { total: 0, completed: 0, total_sum: 0 },
      incomes: { total: 0 },
      expenses: { total: 0 },
      profit: 0
    },
    months: []
  };
  
  for (const m of months) {
    const monthReport = await generateMonthlyReport(db, year, m);
    report.months.push(monthReport);
    
    report.data.tenders.total += parseInt(monthReport.data.tenders?.total || 0);
    report.data.tenders.won += parseInt(monthReport.data.tenders?.won || 0);
    report.data.tenders.lost += parseInt(monthReport.data.tenders?.lost || 0);
    report.data.tenders.total_sum += parseFloat(monthReport.data.tenders?.total_sum || 0);
    report.data.tenders.won_sum += parseFloat(monthReport.data.tenders?.won_sum || 0);
    report.data.works.total += parseInt(monthReport.data.works?.total || 0);
    report.data.works.completed += parseInt(monthReport.data.works?.completed || 0);
    report.data.works.total_sum += parseFloat(monthReport.data.works?.total_sum || 0);
    report.data.incomes.total += parseFloat(monthReport.data.incomes?.total || 0);
    report.data.expenses.total += parseFloat(monthReport.data.expenses?.total || 0);
  }
  
  report.data.profit = report.data.incomes.total - report.data.expenses.total;
  
  return report;
}

async function generateYearlyReport(db, year) {
  const report = {
    type: 'yearly',
    period: `${year} год`,
    period_code: `${year}`,
    generated_at: new Date().toISOString(),
    data: {
      tenders: { total: 0, won: 0, lost: 0, total_sum: 0, won_sum: 0 },
      works: { total: 0, completed: 0, total_sum: 0 },
      incomes: { total: 0 },
      expenses: { total: 0 },
      profit: 0
    },
    quarters: []
  };
  
  for (let q = 1; q <= 4; q++) {
    const qReport = await generateQuarterlyReport(db, year, q);
    report.quarters.push(qReport);
    
    report.data.tenders.total += qReport.data.tenders.total;
    report.data.tenders.won += qReport.data.tenders.won;
    report.data.tenders.lost += qReport.data.tenders.lost;
    report.data.tenders.total_sum += qReport.data.tenders.total_sum;
    report.data.tenders.won_sum += qReport.data.tenders.won_sum;
    report.data.works.total += qReport.data.works.total;
    report.data.works.completed += qReport.data.works.completed;
    report.data.works.total_sum += qReport.data.works.total_sum;
    report.data.incomes.total += qReport.data.incomes.total;
    report.data.expenses.total += qReport.data.expenses.total;
  }
  
  report.data.profit = report.data.incomes.total - report.data.expenses.total;
  
  return report;
}

async function generateExcel(report, type) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Отчёт');
  
  // Заголовок
  sheet.mergeCells('A1:E1');
  sheet.getCell('A1').value = `Отчёт за ${report.period}`;
  sheet.getCell('A1').font = { bold: true, size: 16 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };
  
  let row = 3;
  
  // Тендеры
  sheet.getCell(`A${row}`).value = 'ТЕНДЕРЫ';
  sheet.getCell(`A${row}`).font = { bold: true };
  row++;
  sheet.getCell(`A${row}`).value = 'Всего';
  sheet.getCell(`B${row}`).value = report.data.tenders?.total || 0;
  row++;
  sheet.getCell(`A${row}`).value = 'Выиграно';
  sheet.getCell(`B${row}`).value = report.data.tenders?.won || 0;
  row++;
  sheet.getCell(`A${row}`).value = 'Проиграно';
  sheet.getCell(`B${row}`).value = report.data.tenders?.lost || 0;
  row++;
  sheet.getCell(`A${row}`).value = 'Сумма выигранных';
  sheet.getCell(`B${row}`).value = parseFloat(report.data.tenders?.won_sum || 0);
  sheet.getCell(`B${row}`).numFmt = '#,##0.00 ₽';
  row += 2;
  
  // Работы
  sheet.getCell(`A${row}`).value = 'РАБОТЫ';
  sheet.getCell(`A${row}`).font = { bold: true };
  row++;
  sheet.getCell(`A${row}`).value = 'Всего';
  sheet.getCell(`B${row}`).value = report.data.works?.total || 0;
  row++;
  sheet.getCell(`A${row}`).value = 'Завершено';
  sheet.getCell(`B${row}`).value = report.data.works?.completed || 0;
  row++;
  sheet.getCell(`A${row}`).value = 'Сумма контрактов';
  sheet.getCell(`B${row}`).value = parseFloat(report.data.works?.total_sum || 0);
  sheet.getCell(`B${row}`).numFmt = '#,##0.00 ₽';
  row += 2;
  
  // Финансы
  sheet.getCell(`A${row}`).value = 'ФИНАНСЫ';
  sheet.getCell(`A${row}`).font = { bold: true };
  row++;
  sheet.getCell(`A${row}`).value = 'Доходы';
  sheet.getCell(`B${row}`).value = parseFloat(report.data.incomes?.total || 0);
  sheet.getCell(`B${row}`).numFmt = '#,##0.00 ₽';
  sheet.getCell(`B${row}`).font = { color: { argb: '228B22' } };
  row++;
  sheet.getCell(`A${row}`).value = 'Расходы';
  sheet.getCell(`B${row}`).value = parseFloat(report.data.expenses?.total || 0);
  sheet.getCell(`B${row}`).numFmt = '#,##0.00 ₽';
  sheet.getCell(`B${row}`).font = { color: { argb: 'FF0000' } };
  row++;
  sheet.getCell(`A${row}`).value = 'Прибыль';
  sheet.getCell(`B${row}`).value = parseFloat(report.data.profit || 0);
  sheet.getCell(`B${row}`).numFmt = '#,##0.00 ₽';
  sheet.getCell(`B${row}`).font = { bold: true };
  
  // Ширина колонок
  sheet.getColumn('A').width = 25;
  sheet.getColumn('B').width = 20;
  
  return await workbook.xlsx.writeBuffer();
}

async function saveReport(db, report, type) {
  try {
    await db.query(`
      INSERT INTO saved_reports (type, period, period_code, data, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (period_code) DO UPDATE SET data = $4, created_at = NOW()
    `, [type, report.period, report.period_code, JSON.stringify(report)]);
  } catch(e) {
    console.error('saveReport error:', e);
  }
}

async function notifyAdmins(db, fastify, type, period) {
  const titles = {
    monthly: '📊 Месячный отчёт готов',
    quarterly: '📊 Квартальный отчёт готов',
    yearly: '📊 Годовой отчёт готов'
  };
  
  const admins = await db.query(`
    SELECT id FROM users WHERE role IN ('ADMIN', 'DIR', 'FIN_DIR') AND is_active = true
  `);
  
  for (const admin of admins.rows) {
    // Уведомление на сайте
    await db.query(`
      INSERT INTO notifications (user_id, title, message, type, link, is_read, created_at)
      VALUES ($1, $2, $3, 'report', $4, false, NOW())
    `, [admin.id, titles[type], `Отчёт за ${period} готов к просмотру и скачиванию`, `#/reports?type=${type}`]);
    
    // Telegram
    try {
      const telegram = require('../services/telegram');
      await telegram.sendNotification(admin.id, 
        `📊 *${titles[type]}*\n\nОтчёт за ${period} готов!\nСкачайте в разделе "Отчёты" в CRM.`
      );
    } catch(e) {}
  }
}

module.exports = routes;
