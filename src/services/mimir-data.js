/**
 * ASGARD CRM - Mimir Data Service
 *
 * Сервис доступа к данным для AI-ассистента Мимир
 * Вынесенные функции из mimir.js для переиспользования
 * Включает ролевые ограничения и построение системного промпта
 */

'use strict';

// Роли с полным доступом ко всем данным
const FULL_ACCESS_ROLES = ['ADMIN', 'DIR', 'FIN_DIR', 'DIRECTOR', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

// ═══════════════════════════════════════════════════════════════════════════
// ХЕЛПЕРЫ РОЛЕЙ
// ═══════════════════════════════════════════════════════════════════════════

function hasFullAccess(role) {
  return FULL_ACCESS_ROLES.includes(role);
}

function isPM(role) {
  return role === 'PM' || role === 'MANAGER';
}

function isTO(role) {
  return role === 'TO';
}

function isHR(role) {
  return role === 'HR';
}

function isBUH(role) {
  return role === 'BUH' || role === 'ACCOUNTANT';
}

function getRoleTitle(role) {
  const titles = {
    ADMIN: 'Администратор',
    DIRECTOR_GEN: 'Генеральный директор',
    DIRECTOR_COMM: 'Коммерческий директор',
    DIRECTOR_DEV: 'Директор по развитию',
    FIN_DIR: 'Финансовый директор',
    DIR: 'Директор',
    DIRECTOR: 'Директор',
    PM: 'Руководитель проектов',
    MANAGER: 'Менеджер',
    TO: 'Тендерный отдел',
    HR: 'HR-менеджер',
    BUH: 'Бухгалтер',
    ACCOUNTANT: 'Бухгалтер',
    OFFICE_MANAGER: 'Офис-менеджер',
    WAREHOUSE: 'Склад',
    PROC: 'Закупки',
    ENGINEER: 'Инженер'
  };
  return titles[role] || role;
}

// ═══════════════════════════════════════════════════════════════════════════
// ПОЛУЧЕНИЕ ДАННЫХ ИЗ БД С УЧЁТОМ РОЛЕЙ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Получить статистику из БД с учётом ролей
 */
async function getDbStats(db, user) {
  const stats = {};
  const role = user?.role || 'USER';
  const userId = user?.id;

  try {
    // ТЕНДЕРЫ
    if (hasFullAccess(role) || isPM(role) || isTO(role)) {
      let tenderQuery = 'SELECT tender_status, COUNT(*) as cnt FROM tenders';
      let params = [];

      if (isPM(role) && !hasFullAccess(role)) {
        tenderQuery += ' WHERE responsible_pm_id = $1';
        params.push(userId);
      }
      tenderQuery += (params.length ? ' AND' : ' WHERE') + ' deleted_at IS NULL GROUP BY tender_status';

      const tenders = await db.query(tenderQuery, params);
      stats.tendersTotal = 0;
      stats.tendersByStatus = {};
      tenders.rows.forEach(r => {
        stats.tendersByStatus[r.tender_status || 'Без статуса'] = parseInt(r.cnt);
        stats.tendersTotal += parseInt(r.cnt);
      });

      // За месяц
      let recentQuery = 'SELECT COUNT(*) as cnt FROM tenders WHERE created_at > NOW() - INTERVAL \'30 days\' AND deleted_at IS NULL';
      if (isPM(role) && !hasFullAccess(role)) {
        recentQuery += ' AND responsible_pm_id = $1';
      }
      const recent = await db.query(recentQuery, isPM(role) && !hasFullAccess(role) ? [userId] : []);
      stats.tendersLastMonth = parseInt(recent.rows[0].cnt || 0);
    }

    // РАБОТЫ
    if (hasFullAccess(role) || isPM(role) || isBUH(role)) {
      let worksQuery = 'SELECT COUNT(*) as total, COALESCE(SUM(contract_value), 0) as sum FROM works WHERE deleted_at IS NULL';
      let params = [];

      if (isPM(role) && !hasFullAccess(role)) {
        worksQuery += ' AND pm_id = $1';
        params.push(userId);
      }

      const works = await db.query(worksQuery, params);
      stats.worksTotal = parseInt(works.rows[0].total);
      stats.worksSum = parseFloat(works.rows[0].sum || 0);

      // Активные работы
      let activeQuery = 'SELECT COUNT(*) as cnt FROM works WHERE deleted_at IS NULL AND work_status NOT IN (\'Работы сдали\', \'Отменено\')';
      if (isPM(role) && !hasFullAccess(role)) {
        activeQuery += ' AND pm_id = $1';
      }
      const active = await db.query(activeQuery, isPM(role) && !hasFullAccess(role) ? [userId] : []);
      stats.worksActive = parseInt(active.rows[0].cnt || 0);
    }

    // СОТРУДНИКИ (только HR и директора)
    if (hasFullAccess(role) || isHR(role)) {
      const employees = await db.query('SELECT COUNT(*) as total FROM employees');
      stats.employeesTotal = parseInt(employees.rows[0].total);

      // По должностям (position)
      try {
        const byDept = await db.query(`
          SELECT position as department, COUNT(*) as cnt FROM employees
          WHERE position IS NOT NULL
          GROUP BY position ORDER BY cnt DESC LIMIT 5
        `);
        stats.employeesByDept = byDept.rows;
      } catch (e) { stats.employeesByDept = []; }
    }

    // ФИНАНСЫ (только директора и бухгалтерия)
    if (hasFullAccess(role) || isBUH(role)) {
      try {
        const incomes = await db.query('SELECT COALESCE(SUM(amount), 0) as total FROM incomes');
        const expenses = await db.query('SELECT COALESCE(SUM(amount), 0) as total FROM work_expenses');
        stats.totalIncome = parseFloat(incomes.rows[0].total || 0);
        stats.totalExpenses = parseFloat(expenses.rows[0].total || 0);
        stats.profit = stats.totalIncome - stats.totalExpenses;
      } catch (e) { /* Table may not exist */ }

      // Просроченные счета
      try {
        const overdue = await db.query(`
          SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as sum
          FROM invoices
          WHERE status NOT IN ('paid', 'cancelled') AND due_date < CURRENT_DATE
        `);
        stats.overdueInvoices = parseInt(overdue.rows[0].cnt || 0);
        stats.overdueSum = parseFloat(overdue.rows[0].sum || 0);
      } catch (e) { /* Table may not exist */ }
    }

    // ОБОРУДОВАНИЕ/ТМЦ (директора, PM, инженеры)
    if (hasFullAccess(role) || isPM(role) || ['CHIEF_ENGINEER', 'WAREHOUSE', 'HEAD_PM'].includes(role)) {
      try {
        const eqByStatus = await db.query(`
          SELECT status, COUNT(*) as cnt FROM equipment
          GROUP BY status ORDER BY cnt DESC
        `);
        stats.equipmentByStatus = {};
        stats.equipmentTotal = 0;
        eqByStatus.rows.forEach(r => {
          stats.equipmentByStatus[r.status] = parseInt(r.cnt);
          stats.equipmentTotal += parseInt(r.cnt);
        });

        const eqActive = await db.query("SELECT COUNT(*) as cnt FROM equipment WHERE status NOT IN ('written_off')");
        stats.equipmentActive = parseInt(eqActive.rows[0]?.cnt) || 0;
      } catch (_) {}

      try {
        const eqCats = await db.query(`
          SELECT c.name, COUNT(*) as cnt
          FROM equipment e LEFT JOIN equipment_categories c ON c.id = e.category_id
          WHERE e.status NOT IN ('written_off')
          GROUP BY c.name ORDER BY cnt DESC LIMIT 5
        `);
        stats.equipmentCategories = eqCats.rows;
      } catch (_) {}
    }

    // ЗВОНКИ (директора)
    if (hasFullAccess(role)) {
      try {
        const callsRes = await db.query(`
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE ai_is_target = true) as target,
            COUNT(*) FILTER (WHERE call_type = 'inbound' AND duration_seconds < 5) as missed,
            ROUND(AVG(duration_seconds) FILTER (WHERE duration_seconds > 0)) as avg_dur
          FROM call_history WHERE created_at::date = CURRENT_DATE
        `);
        stats.calls_today = callsRes.rows[0] || {};
      } catch (_) {}

      try {
        const lastReportRes = await db.query(
          "SELECT summary_text, created_at FROM call_reports ORDER BY created_at DESC LIMIT 1"
        );
        if (lastReportRes.rows[0]) {
          stats.last_call_report = {
            summary: (lastReportRes.rows[0].summary_text || '').slice(0, 400),
            date: lastReportRes.rows[0].created_at
          };
        }
      } catch (_) {}
    }

  } catch (e) {
    console.error('DB stats error:', e.message);
  }

  return stats;
}

/**
 * Поиск тендеров
 */
async function searchTenders(db, query, user) {
  const role = user?.role || 'USER';
  const userId = user?.id;

  if (!hasFullAccess(role) && !isPM(role) && !isTO(role)) return [];

  try {
    let sql = `SELECT id, customer_name, tender_title, tender_status, period, created_at
               FROM tenders
               WHERE deleted_at IS NULL AND (customer_name ILIKE $1 OR tender_title ILIKE $1 OR CAST(id AS TEXT) = $2)`;
    let params = ['%' + query + '%', query];

    if (isPM(role) && !hasFullAccess(role)) {
      sql += ' AND responsible_pm_id = $3';
      params.push(userId);
    }

    sql += ' ORDER BY id DESC LIMIT 10';
    const results = await db.query(sql, params);
    return results.rows;
  } catch (e) {
    return [];
  }
}

/**
 * Поиск работ
 */
async function searchWorks(db, query, user) {
  const role = user?.role || 'USER';
  const userId = user?.id;

  if (!hasFullAccess(role) && !isPM(role) && !isBUH(role)) return [];

  try {
    let sql = `SELECT id, work_number, work_title, customer_name, work_status, contract_value, end_plan
               FROM works
               WHERE deleted_at IS NULL AND (work_title ILIKE $1 OR customer_name ILIKE $1 OR work_number ILIKE $1)`;
    let params = ['%' + query + '%'];

    if (isPM(role) && !hasFullAccess(role)) {
      sql += ' AND pm_id = $2';
      params.push(userId);
    }

    sql += ' ORDER BY id DESC LIMIT 10';
    const results = await db.query(sql, params);
    return results.rows;
  } catch (e) {
    return [];
  }
}

/**
 * Поиск сотрудников
 */
async function searchEmployees(db, query, user) {
  const role = user?.role || 'USER';

  if (!hasFullAccess(role) && !isHR(role)) return [];

  try {
    const results = await db.query(`
      SELECT id, full_name, fio, position, phone
      FROM employees
      WHERE full_name ILIKE $1 OR fio ILIKE $1 OR position ILIKE $1
      ORDER BY fio LIMIT 10
    `, ['%' + query + '%']);
    return results.rows;
  } catch (e) {
    return [];
  }
}

/**
 * Получить просроченные счета
 */
async function getOverdueInvoices(db, user) {
  const role = user?.role || 'USER';

  if (!hasFullAccess(role) && !isBUH(role) && !isPM(role)) return [];

  try {
    let sql = `SELECT id, invoice_number, customer_name, total_amount, paid_amount, due_date, work_id
               FROM invoices
               WHERE status NOT IN ('paid', 'cancelled') AND due_date < CURRENT_DATE`;

    if (isPM(role) && !hasFullAccess(role)) {
      sql += ` AND work_id IN (SELECT id FROM works WHERE pm_id = $1)`;
      const results = await db.query(sql + ' ORDER BY due_date LIMIT 10', [user.id]);
      return results.rows;
    }

    const results = await db.query(sql + ' ORDER BY due_date LIMIT 10');
    return results.rows;
  } catch (e) {
    return [];
  }
}

/**
 * Получить ближайшие дедлайны
 */
async function getUpcomingDeadlines(db, user) {
  const role = user?.role || 'USER';

  if (!hasFullAccess(role) && !isPM(role)) return [];

  try {
    let sql = `SELECT id, work_number, work_title, customer_name, end_plan
               FROM works
               WHERE deleted_at IS NULL
               AND work_status NOT IN ('Работы сдали', 'Отменено')
               AND end_plan IS NOT NULL
               AND end_plan >= CURRENT_DATE
               AND end_plan <= CURRENT_DATE + INTERVAL '14 days'`;

    if (isPM(role) && !hasFullAccess(role)) {
      sql += ' AND pm_id = $1';
      const results = await db.query(sql + ' ORDER BY end_plan LIMIT 10', [user.id]);
      return results.rows;
    }

    const results = await db.query(sql + ' ORDER BY end_plan LIMIT 10');
    return results.rows;
  } catch (e) {
    return [];
  }
}

/**
 * Обработка запроса - анализ сообщения и подгрузка нужных данных
 */
async function processQuery(db, message, user) {
  const lowerMsg = (message || '').toLowerCase();
  let additionalData = '';
  let results = null;
  let action = null;

  // Поиск тендеров
  if (lowerMsg.match(/найди|поиск|покажи.*тендер/i)) {
    const searchQuery = message.replace(/найди|поиск|покажи|тендер|тендеры|по|на|у|от/gi, '').trim();
    if (searchQuery.length >= 2) {
      const found = await searchTenders(db, searchQuery, user);
      if (found.length > 0) {
        results = found;
        additionalData = '\n[Найдено тендеров: ' + found.length + ']\n' +
          found.map(t => `• №${t.id} "${t.tender_title}" — ${t.customer_name} (${t.tender_status})`).join('\n');
      } else {
        additionalData = '\n[Тендеры по "' + searchQuery + '" не найдены]';
      }
    }
  }

  // Поиск работ
  if (lowerMsg.match(/найди|поиск|покажи.*работ/i)) {
    const searchQuery = message.replace(/найди|поиск|покажи|работ|работу|работы|по|на|у|от/gi, '').trim();
    if (searchQuery.length >= 2) {
      const found = await searchWorks(db, searchQuery, user);
      if (found.length > 0) {
        results = found;
        additionalData = '\n[Найдено работ: ' + found.length + ']\n' +
          found.map(w => `• ${w.work_number || '№' + w.id} "${w.work_title}" — ${w.customer_name} (${w.work_status})`).join('\n');
      } else {
        additionalData = '\n[Работы по "' + searchQuery + '" не найдены]';
      }
    }
  }

  // Поиск сотрудников
  if (lowerMsg.match(/найди|поиск.*сотрудник|персонал/i)) {
    const searchQuery = message.replace(/найди|поиск|покажи|сотрудник|сотрудника|персонал|по|на|у|от/gi, '').trim();
    if (searchQuery.length >= 2) {
      const found = await searchEmployees(db, searchQuery, user);
      if (found.length > 0) {
        results = found;
        additionalData = '\n[Найдено сотрудников: ' + found.length + ']\n' +
          found.map(e => `• ${e.full_name} — ${e.position || 'Должность не указана'}`).join('\n');
      } else if (hasFullAccess(user?.role) || isHR(user?.role)) {
        additionalData = '\n[Сотрудники по "' + searchQuery + '" не найдены]';
      } else {
        additionalData = '\n[Нет доступа к информации о персонале]';
      }
    }
  }

  // Просроченные счета
  if (lowerMsg.match(/просроч|неоплач|долг|задолжен/i)) {
    const overdue = await getOverdueInvoices(db, user);
    if (overdue.length > 0) {
      results = overdue;
      const totalDebt = overdue.reduce((sum, inv) =>
        sum + (parseFloat(inv.total_amount) - parseFloat(inv.paid_amount || 0)), 0);
      additionalData = '\n[Просроченных счетов: ' + overdue.length + ', сумма: ' +
        totalDebt.toLocaleString('ru-RU') + ' ₽]\n' +
        overdue.slice(0, 5).map(inv =>
          `• ${inv.invoice_number || '№' + inv.id} от ${inv.customer_name} — ` +
          `${(parseFloat(inv.total_amount) - parseFloat(inv.paid_amount || 0)).toLocaleString('ru-RU')} ₽`
        ).join('\n');
    } else {
      additionalData = '\n[Просроченных счетов нет]';
    }
  }

  // Дедлайны
  if (lowerMsg.match(/дедлайн|срок|заканчива|ближайш/i)) {
    const deadlines = await getUpcomingDeadlines(db, user);
    if (deadlines.length > 0) {
      results = deadlines;
      additionalData = '\n[Ближайших дедлайнов: ' + deadlines.length + ']\n' +
        deadlines.map(d => {
          const date = new Date(d.end_plan).toLocaleDateString('ru-RU');
          return `• ${d.work_number || '№' + d.id} "${d.work_title}" — до ${date}`;
        }).join('\n');
    } else {
      additionalData = '\n[Ближайших дедлайнов нет]';
    }
  }

  // ТКП / коммерческое предложение — определяем intent
  if (lowerMsg.match(/создай.*ткп|сделай.*ткп|генерируй.*ткп|ткп.*по.*тендер|ткп.*по.*работ|создай.*коммерческ|сделай.*предложени/i)) {
    let tenderId = null;
    let workId = null;
    const tenderMatch = message.match(/тендер[уе]?\s+(?:№\s*)?(\d+)/i) || message.match(/тендер[уе]?\s+(.{3,50})/i);
    const workMatch = message.match(/работ[еау]?\s+(?:№\s*)?(\d+)/i);

    if (tenderMatch) {
      const q = tenderMatch[1].trim();
      if (/^\d+$/.test(q)) {
        tenderId = parseInt(q);
      } else {
        const found = await searchTenders(db, q, user);
        if (found.length > 0) tenderId = found[0].id;
      }
    }
    if (workMatch && /^\d+$/.test(workMatch[1])) {
      workId = parseInt(workMatch[1]);
    }

    action = { type: 'CREATE_TKP', tender_id: tenderId, work_id: workId };
    additionalData = '\nПользователь просит создать ТКП. Ответь кратко что создаёшь черновик и попроси подождать.';
  }
  // Просто вопросы про ТКП
  else if (lowerMsg.match(/ткп|коммерческ|предложени/i)) {
    additionalData = '\n[Пользователь спрашивает про ТКП. Расскажи что умеешь создавать ТКП по тендерам и работам. Пример: "Создай ТКП по тендеру ЯНПЗ"]';
  }

  return { additionalData, results, action };
}

// ═══════════════════════════════════════════════════════════════════════════
// СИСТЕМНЫЙ ПРОМПТ
// ═══════════════════════════════════════════════════════════════════════════

function buildEquipmentSection(stats) {
  if (!stats.equipmentTotal) return '';
  const statusLabels = {
    available: 'Доступно', on_warehouse: 'На складе', issued: 'Выдано',
    repair: 'В ремонте', written_off: 'Списано', reserved: 'Зарезервировано', in_transit: 'В пути'
  };
  const statusList = Object.entries(stats.equipmentByStatus || {})
    .map(([k, v]) => `  • ${statusLabels[k] || k}: ${v}`)
    .join('\n');
  let text = `\n\nОБОРУДОВАНИЕ/ТМЦ: ${stats.equipmentTotal} всего (на балансе: ${stats.equipmentActive || 0})
По статусам:
${statusList}`;
  if (stats.equipmentCategories && stats.equipmentCategories.length > 0) {
    text += '\nПо категориям:\n' +
      stats.equipmentCategories.map(c => `  • ${c.name || 'Без категории'}: ${c.cnt}`).join('\n');
  }
  return text;
}

/**
 * Построить раздел данных для промпта
 */
function buildDataSection(stats, role) {
  let section = '';

  if (hasFullAccess(role)) {
    const statusList = Object.entries(stats.tendersByStatus || {})
      .map(([k, v]) => `  • ${k}: ${v}`)
      .join('\n') || '  Нет данных';

    section = `ТЕНДЕРЫ: ${stats.tendersTotal || 0} всего
По статусам:
${statusList}
За последний месяц: ${stats.tendersLastMonth || 0} новых

РАБОТЫ: ${stats.worksTotal || 0} всего (активных: ${stats.worksActive || 0})
Общая сумма контрактов: ${((stats.worksSum || 0) / 1000000).toFixed(2)} млн ₽

СОТРУДНИКИ: ${stats.employeesTotal || 0}

ФИНАНСЫ:
  Доходы: ${((stats.totalIncome || 0) / 1000000).toFixed(2)} млн ₽
  Расходы: ${((stats.totalExpenses || 0) / 1000000).toFixed(2)} млн ₽
  Прибыль: ${((stats.profit || 0) / 1000000).toFixed(2)} млн ₽
  Просроченных счетов: ${stats.overdueInvoices || 0} на ${((stats.overdueSum || 0) / 1000).toFixed(0)} тыс ₽`;

    // Звонки
    if (stats.calls_today) {
      const ct = stats.calls_today;
      section += `\n\nЗВОНКИ СЕГОДНЯ: всего ${ct.total || 0}, целевых ${ct.target || 0}, пропущенных ${ct.missed || 0}`;
      if (ct.avg_dur) section += `, средняя длительность ${ct.avg_dur} сек`;
    }
    if (stats.last_call_report) {
      section += `\nПоследний отчёт по звонкам: ${stats.last_call_report.summary}`;
    }

    // Оборудование/ТМЦ
    section += buildEquipmentSection(stats);

  } else if (isPM(role)) {
    const statusList = Object.entries(stats.tendersByStatus || {})
      .map(([k, v]) => `  • ${k}: ${v}`)
      .join('\n') || '  Нет данных';

    section = `ДАННЫЕ ТОЛЬКО ЭТОГО РП (НЕ всей компании!):

ТЕНДЕРЫ ЭТОГО РП: ${stats.tendersTotal || 0} (именно столько, не больше)
${statusList}

РАБОТЫ ЭТОГО РП: ${stats.worksTotal || 0} (активных: ${stats.worksActive || 0})
Сумма контрактов: ${((stats.worksSum || 0) / 1000000).toFixed(2)} млн ₽`;
    section += buildEquipmentSection(stats);

  } else if (isTO(role)) {
    const statusList = Object.entries(stats.tendersByStatus || {})
      .map(([k, v]) => `  • ${k}: ${v}`)
      .join('\n') || '  Нет данных';

    section = `ТЕНДЕРЫ: ${stats.tendersTotal || 0}
${statusList}
За месяц: ${stats.tendersLastMonth || 0} новых`;

  } else if (isHR(role)) {
    section = `СОТРУДНИКИ: ${stats.employeesTotal || 0}`;
    if (stats.employeesByDept && stats.employeesByDept.length > 0) {
      section += '\nПо подразделениям:\n' +
        stats.employeesByDept.map(d => `  • ${d.department}: ${d.cnt}`).join('\n');
    }

  } else if (isBUH(role)) {
    section = `РАБОТЫ: ${stats.worksTotal || 0}

ФИНАНСЫ:
  Доходы: ${((stats.totalIncome || 0) / 1000000).toFixed(2)} млн ₽
  Расходы: ${((stats.totalExpenses || 0) / 1000000).toFixed(2)} млн ₽
  Просроченных счетов: ${stats.overdueInvoices || 0} на ${((stats.overdueSum || 0) / 1000).toFixed(0)} тыс ₽`;

  } else if (['CHIEF_ENGINEER', 'WAREHOUSE'].includes(role)) {
    section = 'ОБОРУДОВАНИЕ/ТМЦ — основная зона ответственности.';
    section += buildEquipmentSection(stats);

  } else {
    section = 'Ограниченный доступ к данным.';
  }

  return section;
}

/**
 * Построить раздел ограничений для промпта
 */
function buildRestrictions(role, userName) {
  if (hasFullAccess(role)) {
    return 'У тебя ПО��НЫЙ доступ ко всем данным системы. Все цифры в crm_data — глобальная статистика компании.';
  }

  const restrictions = [];

  if (isPM(role)) {
    restrictions.push(`ВСЕ цифры в crm_data — это ТОЛЬКО данные РП "${userName}". Не говори "в компании" — говори "у тебя"`);
    restrictions.push('НЕ придумывай цифры. Если в crm_data написано 2 работы — значит 2, не 168');
    restrictions.push('НЕ ра��крывай тендеры и работы других руководителей проектов');
    restrictions.push('НЕ раскрыв��й зарплаты сотруд��иков');
    restrictions.push('НЕ раскрывай общую прибыль компании');
  } else if (isTO(role)) {
    restrictions.push('Показывай информацию только по тендерам');
    restrictions.push('НЕ раскрывай финансовую информацию');
    restrictions.push('НЕ раскрывай информацию о персонале и зарплатах');
  } else if (isHR(role)) {
    restrictions.push('Показывай информацию только о сотрудниках');
    restrictions.push('НЕ раскрывай финансовую информацию');
    restrictions.push('НЕ раскрывай информацию о тендерах и работах');
  } else if (isBUH(role)) {
    restrictions.push('Показывай информацию о финансах и работах');
    restrictions.push('НЕ раскрывай прибыль компании (только доходы и расходы)');
    restrictions.push('НЕ раскрывай информацию о персонале кроме ФОТ');
  } else {
    restrictions.push('Отвечай только на общие вопросы о работе CRM');
    restrictions.push('НЕ раскрывай никакую конфиденциальную информацию');
  }

  return 'СТРОГИЕ ОГРАНИЧЕНИЯ:\n' + restrictions.map(r => '- ' + r).join('\n');
}

/**
 * Построить системный промпт для AI
 */
async function buildSystemPrompt(db, user) {
  const stats = await getDbStats(db, user);
  const today = new Date().toLocaleDateString('ru-RU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const userName = user?.name || user?.login || 'Пользователь';
  const role = user?.role || 'USER';

  return `<role>
Ты — Мимир, AI-ассистент CRM-системы «АСГАРД» компании ООО «Асгард Сервис».
Мимир — хранитель мудрости из скандинавской мифологии, советник богов.
</role>

<context>
Дата: ${today}
Пользователь: ${userName} (ID: ${user?.id})
Роль: ${role} (${getRoleTitle(role)})
</context>

<company>
ООО «Асгард Сервис» — российская сервисная компания для нефтегаза и нефтехимии.
Основной объект: МЛСП «Приразломная» (Арктика, Печорское море).
Направления: химическая чистка теплообменного оборудования, гидродинамическая чистка (АВД),
HVAC (вентиляция/кондиционирование), монтажные работы, диагностика, антикоррозионная защита,
техническое обслуживание трубопроводов.
Ключевые клиенты: Газпромнефть, ЛУКОЙЛ, Роснефть, НОВАТЭК.
Сотрудники имеют специализированные допуски: газоопасные работы, работы на высоте,
МЛСП, НАКС, замкнутые пространства, электробезопасность, промышленная безопасность.

РУКОВОДСТВО КОМПАНИИ:
- Генеральный директор: Кудряшов Олег Сергеевич (login: ok)
- Коммерческий директор: Гажилиев Олег Викторович (login: go)
- Директор по развитию: Сторожев Андрей Александрович (login: a.storozhev)
- Главный инженер: Климакин Дмитрий Владимирович (login: d.klimakin)
- Руководитель отдела РП: Иванейкин Юрий Николаевич (login: iu.ivaneikin)
- Администратор CRM: Андросов Никита Андреевич (login: admin)
</company>

<crm_data>
${buildDataSection(stats, role)}
</crm_data>

<role_restrictions>
${buildRestrictions(role, userName)}
</role_restrictions>

<tariffs>
ТАРИФНАЯ СЕТКА ПРОСЧЁТОВ ООО «Асгард Сервис» (утверждена 01.10.2025):
Базовая единица: 1 балл = 500 ₽. Совмещение профессий: +1 балл к ставке.

МЛСП «Приразломная» (Арктика):
- Рабочий: 14-21 балл (7 000 - 10 500 ₽/смена)
- Мастер: 16-23 балла (8 000 - 11 500 ₽/смена)

Наземные работы (обычные):
- Рабочий: 11-14 баллов (5 500 - 7 000 ₽/смена), Мастер: 14-16 баллов (7 000 - 8 000 ₽/смена)
- Сменный мастер: 12 баллов (6 000 ₽/смена)

Наземные работы (тяжёлые):
- Рабочий: 13-16 баллов (6 500 - 8 000 ₽/смена), Мастер: 16-18 баллов (8 000 - 9 000 ₽/смена)
- Сменный мастер: 14 баллов (7 000 ₽/смена)

Склад:
- Рабочий: 10-12 баллов (5 000 - 6 000 ₽/смена), Мастер: 12-14 баллов (6 000 - 7 000 ₽/смена)

ИТР (инженер/РП): 10 000 ₽/смена — ФИКСИРОВАННАЯ, НЕ из тарифной сетки
Дни дороги: 3 000 ₽/чел/день (6 баллов × 500 ₽)

НАЧИСЛЕНИЯ:
- Налоги на ФОТ: 55%
- Накладные расходы: 15%
- Расходные материалы: 3%
- Непредвиденные расходы: 5%
- Пропуска и инструктаж: 3 000 ₽/чел
- Суточные: 1 000 ₽/чел/день
- Пайковые: 1 000 ₽/чел/день
- СИЗ рабочий: 5 000 ₽/чел, СИЗ ИТР: 7 000 ₽/чел
- Страхование: 2 000 ₽/чел
- Гостиница (Москва): 3 500 ₽/чел/день
- Билет Саратов-Москва: 12 000 ₽/чел
- Такси: 1 500 ₽/день
- Манипулятор: 5 000 ₽/день

ФОРМУЛА ПРОСЧЁТА:
1. ФОТ = (рабочие × ставка × дни) + (ИТР × 10000 × дни) + (мастер × ставка × дни) + (склад × 5000 × 2 дня) + (дорога × 3000 × дни дороги)
2. Налоги = ФОТ × 55%
3. Пропуска = кол-во × 3000
4. Текущие: СИЗ + амортизация + суточные + пайковые + проживание + билеты + страховка
5. Логистика: ГСМ (дистанция × расход), транспорт, такси
6. Химия/материалы: по объёму
7. Накладные = (всё кроме химии) × 15%
8. Расходные = (всё кроме химии) × 3%
9. Себестоимость = сумма всех блоков
10. Непредвиденные = себестоимость × 5%
11. Итого = себестоимость + непредвиденные + маржа
</tariffs>

<capabilities>
1. Отвечать на вопросы по данным CRM — используй конкретные цифры из crm_data и [ДАННЫЕ ИЗ БД]
2. Анализировать загруженные документы (ТЗ, КП, договоры, чертежи, таблицы)
3. Генерировать документы: ТКП, деловые письма, отчёты, сопроводительные
4. Рекомендации по тендерам на основе истории с заказчиком
5. Помощь с расчётами, аналитикой, планированием
6. Навигация по CRM — объяснять как пользоваться функциями системы
7. Аналитика звонков — данные о звонках, активность сотрудников, AI-инсайты из отчётов
8. Расчёт просчётов — используй тарифную сетку из раздела tariffs, считай конкретные суммы
9. Аналитика ТМЦ/оборудования — статусы, категории, перемещения, списания
</capabilities>

<data_access>
У тебя есть ПРЯМОЙ ДОСТУП к базе данных CRM через Text-to-SQL.
Если в сообщении пользователя есть раздел [ДАННЫЕ ИЗ БД] — это реальные данные из PostgreSQL.
Используй их для точных ответов с конкретными цифрами, именами, датами.
Если данных нет — используй агрегированную статистику из crm_data.
</data_access>

<rules>
- На ПРОСТЫЕ вопросы (кто, что, где, сколько) — КРАТКО: 2-4 предложения максимум
- На СЛОЖНЫЕ (расчёт, анализ, сравнение) — подробно, с цифрами и таблицами
- НИКОГДА не пиши "Что повелеваешь?", "Что ещё могу сделать?", "Обращайся!" в конце — просто ответь и остановись
- Не предлагай список своих услуг если не спрашивали
- При ответах о тендерах/работах — указывай номер, заказчика, статус
- Если данных недостаточно — скажи что именно нужно уточнить
- Форматируй: **жирный** для ключевых цифр, списки (-) для перечислений, таблицы при необходимости
- НЕ используй ### заголовки — они выглядят громоздко в чате
- Финансовые суммы: 1 234 567₽ (с разделителями и ₽)
- НИКОГДА не выдумывай данные. Если информации нет — скажи прямо
- Цифры в crm_data — ТОЧНЫЕ. Не округляй, не преувеличивай
- НЕ используй слово "конверсия" — говори "% выигранных" или "% целевых заявок"
- СТРОГО соблюдай ограничения роли из раздела role_restrictions
- Деловой, но дружелюбный тон. Можешь использовать уместные отсылки к скандинавской мифологии
</rules>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ЭКСПОРТ
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Константы
  FULL_ACCESS_ROLES,

  // Хелперы ролей
  hasFullAccess,
  isPM,
  isTO,
  isHR,
  isBUH,
  getRoleTitle,

  // Функции данных
  getDbStats,
  searchTenders,
  searchWorks,
  searchEmployees,
  getOverdueInvoices,
  getUpcomingDeadlines,
  processQuery,

  // Системный промпт
  buildSystemPrompt,
  buildDataSection,
  buildRestrictions
};
