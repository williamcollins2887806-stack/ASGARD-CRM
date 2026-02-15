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
        tenderQuery += ' WHERE pm_id = $1';
        params.push(userId);
      }
      tenderQuery += ' GROUP BY tender_status';

      const tenders = await db.query(tenderQuery, params);
      stats.tendersTotal = 0;
      stats.tendersByStatus = {};
      tenders.rows.forEach(r => {
        stats.tendersByStatus[r.tender_status || 'Без статуса'] = parseInt(r.cnt);
        stats.tendersTotal += parseInt(r.cnt);
      });

      // За месяц
      let recentQuery = 'SELECT COUNT(*) as cnt FROM tenders WHERE created_at > NOW() - INTERVAL \'30 days\'';
      if (isPM(role) && !hasFullAccess(role)) {
        recentQuery += ' AND pm_id = $1';
        const recent = await db.query(recentQuery, [userId]);
        stats.tendersLastMonth = parseInt(recent.rows[0].cnt || 0);
      } else {
        const recent = await db.query(recentQuery);
        stats.tendersLastMonth = parseInt(recent.rows[0].cnt || 0);
      }
    }

    // РАБОТЫ
    if (hasFullAccess(role) || isPM(role) || isBUH(role)) {
      let worksQuery = 'SELECT COUNT(*) as total, COALESCE(SUM(contract_sum), 0) as sum FROM works';
      let params = [];

      if (isPM(role) && !hasFullAccess(role)) {
        worksQuery += ' WHERE pm_id = $1';
        params.push(userId);
      }

      const works = await db.query(worksQuery, params);
      stats.worksTotal = parseInt(works.rows[0].total);
      stats.worksSum = parseFloat(works.rows[0].sum || 0);

      // Активные работы
      let activeQuery = 'SELECT COUNT(*) as cnt FROM works WHERE work_status NOT IN (\'Работы сдали\', \'Отменено\')';
      if (isPM(role) && !hasFullAccess(role)) {
        activeQuery += ' AND pm_id = $1';
        const active = await db.query(activeQuery, [userId]);
        stats.worksActive = parseInt(active.rows[0].cnt || 0);
      } else {
        const active = await db.query(activeQuery);
        stats.worksActive = parseInt(active.rows[0].cnt || 0);
      }
    }

    // СОТРУДНИКИ (только HR и директора)
    if (hasFullAccess(role) || isHR(role)) {
      const employees = await db.query('SELECT COUNT(*) as total FROM employees');
      stats.employeesTotal = parseInt(employees.rows[0].total);

      // По подразделениям
      const byDept = await db.query(`
        SELECT department, COUNT(*) as cnt FROM employees
        WHERE department IS NOT NULL
        GROUP BY department ORDER BY cnt DESC LIMIT 5
      `);
      stats.employeesByDept = byDept.rows;
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
               WHERE (customer_name ILIKE $1 OR tender_title ILIKE $1 OR CAST(id AS TEXT) = $2)`;
    let params = ['%' + query + '%', query];

    if (isPM(role) && !hasFullAccess(role)) {
      sql += ' AND pm_id = $3';
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
    let sql = `SELECT id, work_number, work_title, customer_name, work_status, contract_sum, work_end_plan
               FROM works
               WHERE (work_title ILIKE $1 OR customer_name ILIKE $1 OR work_number ILIKE $1)`;
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
      SELECT id, full_name, position, phone, department
      FROM employees
      WHERE full_name ILIKE $1 OR position ILIKE $1 OR department ILIKE $1
      ORDER BY full_name LIMIT 10
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
    let sql = `SELECT id, work_number, work_title, customer_name, work_end_plan
               FROM works
               WHERE work_status NOT IN ('Работы сдали', 'Отменено')
               AND work_end_plan IS NOT NULL
               AND work_end_plan >= CURRENT_DATE
               AND work_end_plan <= CURRENT_DATE + INTERVAL '14 days'`;

    if (isPM(role) && !hasFullAccess(role)) {
      sql += ' AND pm_id = $1';
      const results = await db.query(sql + ' ORDER BY work_end_plan LIMIT 10', [user.id]);
      return results.rows;
    }

    const results = await db.query(sql + ' ORDER BY work_end_plan LIMIT 10');
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
          const date = new Date(d.work_end_plan).toLocaleDateString('ru-RU');
          return `• ${d.work_number || '№' + d.id} "${d.work_title}" — до ${date}`;
        }).join('\n');
    } else {
      additionalData = '\n[Ближайших дедлайнов нет]';
    }
  }

  // ТКП / коммерческое предложение
  if (lowerMsg.match(/ткп|коммерческ|предложени/i)) {
    additionalData = `\n[Запрос на ТКП]
Шаблон ТКП:
1. Заголовок: "Коммерческое предложение на [услуги]"
2. Описание работ
3. Сроки выполнения
4. Стоимость (с НДС и без)
5. Условия оплаты
6. Срок действия предложения
7. Контакты`;
  }

  return { additionalData, results };
}

// ═══════════════════════════════════════════════════════════════════════════
// СИСТЕМНЫЙ ПРОМПТ
// ═══════════════════════════════════════════════════════════════════════════

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

  } else if (isPM(role)) {
    const statusList = Object.entries(stats.tendersByStatus || {})
      .map(([k, v]) => `  • ${k}: ${v}`)
      .join('\n') || '  Нет данных';

    section = `ТВОИ ТЕНДЕРЫ: ${stats.tendersTotal || 0}
${statusList}

ТВОИ РАБОТЫ: ${stats.worksTotal || 0} (активных: ${stats.worksActive || 0})
Сумма контрактов: ${((stats.worksSum || 0) / 1000000).toFixed(2)} млн ₽`;

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
    return 'У тебя ПОЛНЫЙ доступ ко всем данным системы. Можешь отвечать на любые вопросы.';
  }

  const restrictions = [];

  if (isPM(role)) {
    restrictions.push(`Показывай ТОЛЬКО данные РП "${userName}"`);
    restrictions.push('НЕ раскрывай тендеры и работы других руководителей проектов');
    restrictions.push('НЕ раскрывай зарплаты сотрудников');
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
ООО «Асгард Сервис» — российская сервисная компания нефтегазового сектора.
Основной объект: МЛСП «Приразломная» (Арктика, Печорское море).
Услуги: техническое обслуживание трубопроводов, HVAC, химическая чистка,
монтажные работы, диагностика, антикоррозионная защита.
Сотрудники имеют специализированные допуски: газоопасные работы, работы на высоте,
МЛСП, НАКС, замкнутые пространства, электробезопасность, промышленная безопасность.
</company>

<crm_data>
${buildDataSection(stats, role)}
</crm_data>

<role_restrictions>
${buildRestrictions(role, userName)}
</role_restrictions>

<capabilities>
1. Отвечать на вопросы по данным CRM — используй конкретные цифры из раздела crm_data
2. Анализировать загруженные документы (ТЗ, КП, договоры, чертежи, таблицы)
3. Генерировать документы: ТКП, деловые письма, отчёты, сопроводительные
4. Рекомендации по тендерам на основе истории с заказчиком
5. Помощь с расчётами, аналитикой, планированием
6. Навигация по CRM — объяснять как пользоваться функциями системы
</capabilities>

<rules>
- Отвечай развёрнуто, профессионально, с конкретными данными
- При ответах о тендерах/работах — указывай номер, заказчика, статус
- Если данных недостаточно — скажи что именно нужно уточнить
- Форматируй ответы: заголовки (##), списки (-), **жирный** для важного, таблицы при необходимости
- Финансовые суммы — с разделителями тысяч и указанием валюты (₽)
- НИКОГДА не выдумывай данные. Если информации нет — скажи прямо
- СТРОГО соблюдай ограничения роли из раздела role_restrictions
- Поддерживай деловой, но дружелюбный тон
- При анализе файлов — давай структурированный отчёт с выводами
- Можешь использовать уместные отсылки к скандинавской мифологии
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
