/**
 * ASGARD CRM - Mimir AI Assistant Routes v2.0
 * 
 * Полный функционал:
 * - Вопросы по тендерам, работам, финансам
 * - Загрузка и анализ файлов
 * - Генерация ТКП
 * - Умные рекомендации
 * - Ограничения по ролям
 */

const path = require('path');
const fs = require('fs');

async function mimirRoutes(fastify, options) {
  
  const YANDEX_FOLDER_ID = process.env.YANDEX_FOLDER_ID || 'b1gunu8t45scpkejj3u8';
  const YANDEX_API_KEY = process.env.YANDEX_API_KEY || 'REPLACE_WITH_YOUR_YANDEX_API_KEY';
  const YANDEX_GPT_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
  
  // Роли с полным доступом
  const FULL_ACCESS_ROLES = ['ADMIN', 'DIR', 'FIN_DIR', 'DIRECTOR', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  
  function hasFullAccess(role) { return FULL_ACCESS_ROLES.includes(role); }
  function isPM(role) { return role === 'PM' || role === 'MANAGER'; }
  function isTO(role) { return role === 'TO'; }
  function isHR(role) { return role === 'HR'; }
  function isBUH(role) { return role === 'BUH' || role === 'ACCOUNTANT'; }
  
  // ============================================
  // ПОЛУЧЕНИЕ ДАННЫХ ИЗ БД С УЧЁТОМ РОЛЕЙ
  // ============================================
  
  async function getDbStats(user) {
    const db = fastify.db;
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
          recentQuery += ' AND responsible_pm_id = $1';
          const recent = await db.query(recentQuery, [userId]);
          stats.tendersLastMonth = parseInt(recent.rows[0].cnt || 0);
        } else {
          const recent = await db.query(recentQuery);
          stats.tendersLastMonth = parseInt(recent.rows[0].cnt || 0);
        }
      }
      
      // РАБОТЫ
      if (hasFullAccess(role) || isPM(role)) {
        let worksQuery = 'SELECT COUNT(*) as total, COALESCE(SUM(contract_sum), 0) as sum FROM works';
        let params = [];
        
        if (isPM(role) && !hasFullAccess(role)) {
          worksQuery += ' WHERE pm_id = $1';
          params.push(userId);
        }
        
        const works = await db.query(worksQuery, params);
        stats.worksTotal = parseInt(works.rows[0].total);
        stats.worksSum = parseFloat(works.rows[0].sum || 0);
      }
      
      // СОТРУДНИКИ (только HR и директора)
      if (hasFullAccess(role) || isHR(role)) {
        const employees = await db.query('SELECT COUNT(*) as total FROM employees');
        stats.employeesTotal = parseInt(employees.rows[0].total);
      }
      
      // ФИНАНСЫ (только директора и бухгалтерия)
      if (hasFullAccess(role) || isBUH(role)) {
        try {
          const incomes = await db.query('SELECT COALESCE(SUM(amount), 0) as total FROM incomes');
          const expenses = await db.query('SELECT COALESCE(SUM(amount), 0) as total FROM work_expenses');
          stats.totalIncome = parseFloat(incomes.rows[0].total || 0);
          stats.totalExpenses = parseFloat(expenses.rows[0].total || 0);
          stats.profit = stats.totalIncome - stats.totalExpenses;
        } catch(e) {}
        
        // Просроченные счета
        try {
          const overdue = await db.query(`
            SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount - paid_amount), 0) as sum 
            FROM invoices 
            WHERE status NOT IN ('paid', 'cancelled') AND due_date < CURRENT_DATE
          `);
          stats.overdueInvoices = parseInt(overdue.rows[0].cnt || 0);
          stats.overdueSum = parseFloat(overdue.rows[0].sum || 0);
        } catch(e) {}
      }
      
    } catch (e) {
      fastify.log.error('DB stats error:', e.message);
    }
    
    return stats;
  }
  
  // Поиск тендеров
  async function searchTenders(query, user) {
    const db = fastify.db;
    const role = user?.role || 'USER';
    const userId = user?.id;
    
    try {
      let sql = `SELECT id, customer_name, tender_title, tender_status, period FROM tenders
                 WHERE (customer_name ILIKE $1 OR tender_title ILIKE $1)`;
      let params = ['%' + query + '%'];

      if (isPM(role) && !hasFullAccess(role)) {
        sql += ' AND responsible_pm_id = $2';
        params.push(userId);
      }
      
      sql += ' ORDER BY id DESC LIMIT 10';
      const results = await db.query(sql, params);
      return results.rows;
    } catch (e) {
      return [];
    }
  }
  
  // Поиск работ
  async function searchWorks(query, user) {
    const db = fastify.db;
    const role = user?.role || 'USER';
    const userId = user?.id;
    
    if (!hasFullAccess(role) && !isPM(role)) return [];
    
    try {
      let sql = `SELECT id, work_number, work_title, customer_name, work_status, contract_sum FROM works 
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
  
  // Поиск сотрудников
  async function searchEmployees(query, user) {
    const db = fastify.db;
    const role = user?.role || 'USER';
    
    if (!hasFullAccess(role) && !isHR(role)) return [];
    
    try {
      const results = await db.query(`
        SELECT id, full_name, position, phone FROM employees 
        WHERE full_name ILIKE $1 OR position ILIKE $1
        ORDER BY full_name LIMIT 10
      `, ['%' + query + '%']);
      return results.rows;
    } catch (e) {
      return [];
    }
  }
  
  // Получить просроченные счета
  async function getOverdueInvoices(user) {
    const db = fastify.db;
    const role = user?.role || 'USER';
    
    if (!hasFullAccess(role) && !isBUH(role) && !isPM(role)) return [];
    
    try {
      let sql = `SELECT id, invoice_number, customer_name, total_amount, paid_amount, due_date 
                 FROM invoices WHERE status NOT IN ('paid', 'cancelled') AND due_date < CURRENT_DATE`;
      
      if (isPM(role) && !hasFullAccess(role)) {
        sql += ` AND work_id IN (SELECT id FROM works WHERE pm_id = $1)`;
        const results = await db.query(sql, [user.id]);
        return results.rows;
      }
      
      const results = await db.query(sql + ' ORDER BY due_date LIMIT 10');
      return results.rows;
    } catch (e) {
      return [];
    }
  }
  
  // Получить ближайшие дедлайны
  async function getUpcomingDeadlines(user) {
    const db = fastify.db;
    const role = user?.role || 'USER';
    
    if (!hasFullAccess(role) && !isPM(role)) return [];
    
    try {
      let sql = `SELECT id, work_number, work_title, customer_name, work_end_plan 
                 FROM works WHERE work_status NOT IN ('Работы сдали', 'Отменено')
                 AND work_end_plan >= CURRENT_DATE AND work_end_plan <= CURRENT_DATE + INTERVAL '14 days'`;
      
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
  
  // ============================================
  // СИСТЕМНЫЙ ПРОМПТ
  // ============================================
  
  async function buildSystemPrompt(user) {
    const stats = await getDbStats(user);
    const role = user?.role || 'USER';
    const userName = user?.name || user?.login || 'Воин';
    
    const today = new Date().toLocaleDateString('ru-RU', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    });
    
    let dataSection = '';
    let restrictionsSection = '';
    
    if (hasFullAccess(role)) {
      const statusList = Object.entries(stats.tendersByStatus || {})
        .map(([k,v]) => '  • ' + k + ': ' + v)
        .join('\n') || '  Нет данных';
      
      dataSection = `
📊 ТЕНДЕРЫ: ${stats.tendersTotal || 0} всего
По статусам:
${statusList}

👥 СОТРУДНИКОВ: ${stats.employeesTotal || 0}
📋 РАБОТ: ${stats.worksTotal || 0} (сумма: ${((stats.worksSum || 0) / 1000000).toFixed(1)} млн ₽)
📈 За месяц: ${stats.tendersLastMonth || 0} новых тендеров
${stats.profit !== undefined ? `
💰 ФИНАНСЫ:
  Доходы: ${((stats.totalIncome || 0) / 1000000).toFixed(1)} млн ₽
  Расходы: ${((stats.totalExpenses || 0) / 1000000).toFixed(1)} млн ₽
  Прибыль: ${((stats.profit || 0) / 1000000).toFixed(1)} млн ₽
  ⚠️ Просрочено счетов: ${stats.overdueInvoices || 0} на ${((stats.overdueSum || 0) / 1000).toFixed(0)} тыс ₽` : ''}`;
      
      restrictionsSection = 'У тебя ПОЛНЫЙ доступ ко всем данным системы.';
      
    } else if (isPM(role)) {
      const statusList = Object.entries(stats.tendersByStatus || {})
        .map(([k,v]) => '  • ' + k + ': ' + v)
        .join('\n') || '  Нет данных';
      
      dataSection = `
📊 ТВОИ ТЕНДЕРЫ: ${stats.tendersTotal || 0}
${statusList}
📋 ТВОИХ РАБОТ: ${stats.worksTotal || 0}`;
      
      restrictionsSection = `ВАЖНО: Показываешь только данные РП "${userName}".
НЕ раскрывай: тендеры/работы других РП, зарплаты, общую прибыль.`;
      
    } else if (isTO(role)) {
      const statusList = Object.entries(stats.tendersByStatus || {})
        .map(([k,v]) => '  • ' + k + ': ' + v)
        .join('\n') || '  Нет данных';
      
      dataSection = `📊 ТЕНДЕРЫ: ${stats.tendersTotal || 0}\n${statusList}`;
      restrictionsSection = 'Показываешь только тендеры. НЕ раскрывай финансы и персонал.';
      
    } else if (isHR(role)) {
      dataSection = `👥 СОТРУДНИКОВ: ${stats.employeesTotal || 0}`;
      restrictionsSection = 'Показываешь только персонал. НЕ раскрывай финансы и тендеры.';
      
    } else if (isBUH(role)) {
      dataSection = `💰 Доходы: ${((stats.totalIncome || 0) / 1000000).toFixed(1)} млн ₽
Расходы: ${((stats.totalExpenses || 0) / 1000000).toFixed(1)} млн ₽
Просрочено: ${stats.overdueInvoices || 0} счетов`;
      restrictionsSection = 'Показываешь только финансы.';
    } else {
      dataSection = 'Ограниченный доступ.';
      restrictionsSection = 'Отвечаешь только на общие вопросы.';
    }
    
    return `Сегодня: ${today}.
Пользователь: ${userName} (роль: ${role})

Ты — Мимир, ИИ-помощник CRM "АСГАРД" (ООО «Асгард Сервис»).

═══════════════════════════════════════
ДОСТУПНЫЕ ДАННЫЕ:
═══════════════════════════════════════
${dataSection}
═══════════════════════════════════════

${restrictionsSection}

Компания: обслуживание нефтегазовых платформ, основной объект — "Приразломная" (Арктика).

Модули: Дашборд, Тендеры, Сметы, Работы, Персонал, Договоры, Финансы, Счета, Акты, Календарь.

КОМАНДЫ:
- "найди тендер X" → поиск тендеров
- "найди работу X" → поиск работ  
- "просроченные счета" → список неоплаченных
- "дедлайны" → ближайшие сроки
- "помоги с ТКП" → шаблон предложения

Правила: кратко (2-4 предложения), точные цифры, уважай ограничения ролей, викингский стиль уместно.`;
  }

  // ============================================
  // ОБРАБОТКА ЗАПРОСОВ
  // ============================================
  
  async function processQuery(message, user) {
    const lowerMsg = (message || '').toLowerCase();
    let additionalData = '';
    let results = null;
    
    // Поиск тендеров
    if (lowerMsg.match(/найди|поиск|покажи.*тендер/i)) {
      const searchQuery = message.replace(/найди|поиск|покажи|тендер|тендеры|по|на|у|от/gi, '').trim();
      if (searchQuery.length >= 2) {
        const found = await searchTenders(searchQuery, user);
        if (found.length > 0) {
          results = found;
          additionalData = '\n[Найдено тендеров: ' + found.length + ']';
        } else {
          additionalData = '\n[Тендеры по "' + searchQuery + '" не найдены]';
        }
      }
    }
    
    // Поиск работ
    if (lowerMsg.match(/найди|поиск|покажи.*работ/i)) {
      const searchQuery = message.replace(/найди|поиск|покажи|работ|работу|работы|по|на|у|от/gi, '').trim();
      if (searchQuery.length >= 2) {
        const found = await searchWorks(searchQuery, user);
        if (found.length > 0) {
          results = found;
          additionalData = '\n[Найдено работ: ' + found.length + ']';
        } else {
          additionalData = '\n[Работы по "' + searchQuery + '" не найдены]';
        }
      }
    }
    
    // Поиск сотрудников
    if (lowerMsg.match(/найди|поиск.*сотрудник|персонал/i)) {
      const searchQuery = message.replace(/найди|поиск|покажи|сотрудник|сотрудника|персонал|по|на|у|от/gi, '').trim();
      if (searchQuery.length >= 2) {
        const found = await searchEmployees(searchQuery, user);
        if (found.length > 0) {
          results = found;
          additionalData = '\n[Найдено сотрудников: ' + found.length + ']';
        } else if (hasFullAccess(user?.role) || isHR(user?.role)) {
          additionalData = '\n[Сотрудники по "' + searchQuery + '" не найдены]';
        } else {
          additionalData = '\n[Нет доступа к персоналу]';
        }
      }
    }
    
    // Просроченные счета
    if (lowerMsg.match(/просроч|неоплач|долг|задолжен/i)) {
      const overdue = await getOverdueInvoices(user);
      if (overdue.length > 0) {
        results = overdue;
        additionalData = '\n[Просроченных счетов: ' + overdue.length + ']';
      } else {
        additionalData = '\n[Просроченных счетов нет]';
      }
    }
    
    // Дедлайны
    if (lowerMsg.match(/дедлайн|срок|заканчива|ближайш/i)) {
      const deadlines = await getUpcomingDeadlines(user);
      if (deadlines.length > 0) {
        results = deadlines;
        additionalData = '\n[Ближайших дедлайнов: ' + deadlines.length + ']';
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

  // ============================================
  // ЭНДПОИНТЫ
  // ============================================
  
  // Главный чат
  fastify.post('/chat', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { message, context } = request.body;
    const user = request.user;
    
    if (!message || message.length < 1) {
      return reply.code(400).send({ success: false, message: 'Пустое сообщение' });
    }
    
    try {
      // Обработка запроса
      const { additionalData, results } = await processQuery(message, user);
      
      let userMessage = message;
      if (context) userMessage = '[Раздел: ' + context + ']\n' + userMessage;
      if (additionalData) userMessage += additionalData;
      
      const systemPrompt = await buildSystemPrompt(user);
      
      const response = await fetch(YANDEX_GPT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Api-Key ' + YANDEX_API_KEY,
          'x-folder-id': YANDEX_FOLDER_ID
        },
        body: JSON.stringify({
          modelUri: 'gpt://' + YANDEX_FOLDER_ID + '/yandexgpt-lite/latest',
          completionOptions: { stream: false, temperature: 0.6, maxTokens: 600 },
          messages: [
            { role: 'system', text: systemPrompt },
            { role: 'user', text: userMessage }
          ]
        })
      });
      
      if (!response.ok) {
        fastify.log.error('Yandex GPT error: ' + response.status);
        return reply.code(502).send({
          success: false,
          message: 'Колодец мудрости временно недоступен.'
        });
      }
      
      const data = await response.json();
      const aiResponse = data.result?.alternatives?.[0]?.message?.text 
        || 'Руны молчат. Попробуй перефразировать.';
      
      return {
        success: true,
        response: aiResponse,
        results: results,
        userRole: user?.role
      };
      
    } catch (error) {
      fastify.log.error('Mimir error: ' + error.message);
      return reply.code(500).send({
        success: false,
        message: 'Ошибка. Один из воронов заблудился...'
      });
    }
  });
  
  // Анализ файлов
  fastify.post('/analyze', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const parts = request.parts ? request.parts() : null;
    
    let message = '';
    let context = '';
    let fileInfo = [];
    
    try {
      if (parts) {
        for await (const part of parts) {
          if (part.file) {
            const chunks = [];
            for await (const chunk of part.file) {
              chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            fileInfo.push({
              name: part.filename,
              size: buffer.length,
              type: part.mimetype
            });
          } else {
            if (part.fieldname === 'message') message = part.value;
            if (part.fieldname === 'context') context = part.value;
          }
        }
      }
    } catch(e) {
      fastify.log.error('File parse error:', e.message);
    }
    
    const fileDesc = fileInfo.length > 0 
      ? 'Получены файлы: ' + fileInfo.map(f => f.name + ' (' + (f.size/1024).toFixed(1) + ' КБ)').join(', ')
      : '';
    
    const systemPrompt = await buildSystemPrompt(user);
    const userMessage = (message || 'Проанализируй файл') + '\n\n' + fileDesc;
    
    try {
      const response = await fetch(YANDEX_GPT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Api-Key ' + YANDEX_API_KEY,
          'x-folder-id': YANDEX_FOLDER_ID
        },
        body: JSON.stringify({
          modelUri: 'gpt://' + YANDEX_FOLDER_ID + '/yandexgpt-lite/latest',
          completionOptions: { stream: false, temperature: 0.5, maxTokens: 600 },
          messages: [
            { role: 'system', text: systemPrompt + '\n\nПользователь загрузил файлы. Опиши что можно сделать с этими файлами в CRM.' },
            { role: 'user', text: userMessage }
          ]
        })
      });
      
      if (!response.ok) {
        return { success: true, response: 'Файлы получены: ' + fileInfo.map(f => f.name).join(', ') + '. Что с ними сделать?' };
      }
      
      const data = await response.json();
      return {
        success: true,
        response: data.result?.alternatives?.[0]?.message?.text || 'Файлы получены. Чем помочь?',
        files: fileInfo
      };
    } catch(e) {
      return { success: true, response: 'Файлы получены. Задай вопрос по ним.' };
    }
  });
  
  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', service: 'Mimir AI v2', timestamp: new Date().toISOString() };
  });
  
  // Статистика
  fastify.get('/stats', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const stats = await getDbStats(request.user);
    return { success: true, userRole: request.user?.role, stats };
  });
  
  // Поиск
  fastify.get('/search', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { q, type } = request.query;
    if (!q || q.length < 2) return { success: false, results: [] };
    
    let results = [];
    if (type === 'works') results = await searchWorks(q, request.user);
    else if (type === 'employees') results = await searchEmployees(q, request.user);
    else results = await searchTenders(q, request.user);
    
    return { success: true, count: results.length, results };
  });
  
  // ============================================
  // ФИНАНСОВАЯ АНАЛИТИКА
  // ============================================
  
  fastify.get('/finance-stats', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    const role = user?.role || 'USER';
    
    // Проверка доступа
    const FULL_ACCESS = ['ADMIN', 'DIR', 'FIN_DIR', 'DIRECTOR', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
    if (!FULL_ACCESS.includes(role) && role !== 'BUH' && role !== 'ACCOUNTANT') {
      return { success: false, message: 'Нет доступа к финансовой информации' };
    }
    
    const db = fastify.db;
    const stats = {};
    
    try {
      // Просроченные счета
      const overdue = await db.query(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as sum
        FROM invoices
        WHERE status NOT IN ('paid', 'cancelled') AND due_date < CURRENT_DATE
      `);
      stats.overdueInvoices = {
        count: parseInt(overdue.rows[0]?.cnt || 0),
        sum: parseFloat(overdue.rows[0]?.sum || 0)
      };
      
      // Топ должников
      const debtors = await db.query(`
        SELECT customer_name, COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as debt
        FROM invoices
        WHERE status NOT IN ('paid', 'cancelled')
        GROUP BY customer_name
        HAVING SUM(total_amount - COALESCE(paid_amount, 0)) > 0
        ORDER BY debt DESC
        LIMIT 5
      `);
      stats.topDebtors = debtors.rows;
      
      // Ожидаемые поступления (на этой неделе)
      const expected = await db.query(`
        SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as sum
        FROM invoices
        WHERE status NOT IN ('paid', 'cancelled')
          AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
      `);
      stats.expectedThisWeek = parseFloat(expected.rows[0]?.sum || 0);
      
      return { success: true, stats };
    } catch(e) {
      fastify.log.error('Finance stats error:', e.message);
      return { success: false, message: 'Ошибка получения данных' };
    }
  });
  
  // ============================================
  // АНАЛИТИКА РАБОТ
  // ============================================
  
  fastify.get('/works-analytics', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    const role = user?.role || 'USER';
    const userId = user?.id;
    
    const FULL_ACCESS = ['ADMIN', 'DIR', 'DIRECTOR', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
    const isPM = role === 'PM' || role === 'MANAGER';
    
    if (!FULL_ACCESS.includes(role) && !isPM) {
      return { success: false, message: 'Нет доступа к аналитике работ' };
    }
    
    const db = fastify.db;
    const stats = {};
    
    try {
      let whereClause = '';
      let params = [];
      
      if (isPM && !FULL_ACCESS.includes(role)) {
        params.push(userId);
        whereClause = ` WHERE pm_id = $${params.length}`;
      }
      
      // Работы по статусам
      const byStatus = await db.query(`
        SELECT work_status, COUNT(*) as cnt
        FROM works ${whereClause || 'WHERE 1=1'}
        GROUP BY work_status
      `, params);
      stats.byStatus = byStatus.rows;
      
      // Ближайшие дедлайны
      const deadlines = await db.query(`
        SELECT id, work_number, work_title, customer_name, work_end_plan
        FROM works
        ${whereClause || 'WHERE 1=1'}
          AND work_end_plan IS NOT NULL
          AND work_status NOT IN ('Работы сдали', 'Отменено')
        ORDER BY work_end_plan ASC
        LIMIT 5
      `, params);
      stats.upcomingDeadlines = deadlines.rows;
      
      return { success: true, stats };
    } catch(e) {
      fastify.log.error('Works analytics error:', e.message);
      return { success: false, message: 'Ошибка получения данных' };
    }
  });
  
  // ============================================
  // РЕКОМЕНДАЦИЯ ПО ТЕНДЕРУ
  // ============================================
  
  fastify.get('/tender-recommendation/:id', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const db = fastify.db;
    const tenderId = request.params.id;
    
    try {
      const tender = await db.query('SELECT * FROM tenders WHERE id = $1', [tenderId]);
      if (tender.rows.length === 0) {
        return { success: false, message: 'Тендер не найден' };
      }
      
      const t = tender.rows[0];
      
      // История с этим заказчиком
      const history = await db.query(`
        SELECT tender_status, COUNT(*) as cnt
        FROM tenders WHERE customer_name = $1
        GROUP BY tender_status
      `, [t.customer_name]);
      
      const wonCount = parseInt(history.rows.find(r => r.tender_status === 'Клиент согласился')?.cnt || 0);
      const totalCount = history.rows.reduce((s, r) => s + parseInt(r.cnt), 0);
      const winRate = totalCount > 0 ? Math.round((wonCount / totalCount) * 100) : 0;
      
      // Рекомендация
      let recommendation = '';
      let score = 0;
      
      if (totalCount === 0) {
        recommendation = '🆕 Новый клиент. Требуется качественное КП.';
        score = 50;
      } else if (winRate >= 60) {
        recommendation = '🟢 Высокие шансы! Клиент лоялен, конверсия ' + winRate + '%';
        score = 85;
      } else if (winRate >= 30) {
        recommendation = '🟡 Средние шансы. Конверсия ' + winRate + '%. Подготовь конкурентное КП.';
        score = 60;
      } else {
        recommendation = '🔴 Низкие шансы. Конверсия ' + winRate + '%. Оцени целесообразность участия.';
        score = 30;
      }
      
      return {
        success: true,
        tender: { id: t.id, customer_name: t.customer_name, tender_title: t.tender_title },
        history: { total: totalCount, won: wonCount, winRate },
        recommendation,
        score
      };
    } catch(e) {
      return { success: false, message: 'Ошибка анализа' };
    }
  });
  
  // ============================================
  // ГЕНЕРАЦИЯ ТКП
  // ============================================
  
  fastify.post('/generate-tkp', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { tender_id, work_title, customer_name, services, total_sum, deadline } = request.body;
    
    try {
      const prompt = `Составь краткое коммерческое предложение (ТКП) для заказчика.

Заказчик: ${customer_name || 'Не указан'}
Название работ: ${work_title || 'Не указано'}
Перечень услуг: ${services || 'Сервисные работы'}
Ориентировочная сумма: ${total_sum ? total_sum + ' руб.' : 'По запросу'}
Срок выполнения: ${deadline || 'По согласованию'}

О компании:
- ООО «Асгард Сервис» — российская сервисная компания
- Опыт работы на платформе «Приразломная» в Арктике
- Квалифицированные специалисты с допусками
- Собственное оборудование

Формат:
1. Приветствие (1-2 предложения)
2. Описание услуг (2-3 предложения)
3. Преимущества (3-4 пункта кратко)
4. Условия и стоимость
5. Контакты

Пиши кратко, деловым стилем.`;

      const response = await fetch(YANDEX_GPT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Api-Key ' + YANDEX_API_KEY,
          'x-folder-id': YANDEX_FOLDER_ID
        },
        body: JSON.stringify({
          modelUri: 'gpt://' + YANDEX_FOLDER_ID + '/yandexgpt-lite/latest',
          completionOptions: { stream: false, temperature: 0.7, maxTokens: 1500 },
          messages: [{ role: 'user', text: prompt }]
        })
      });
      
      if (!response.ok) {
        return reply.code(502).send({ success: false, message: 'Ошибка генерации' });
      }
      
      const data = await response.json();
      const tkpText = data.result?.alternatives?.[0]?.message?.text || '';
      
      return { success: true, tkp: tkpText };
    } catch (error) {
      fastify.log.error('TKP generation error:', error.message);
      return reply.code(500).send({ success: false, message: 'Ошибка генерации ТКП' });
    }
  });
}

module.exports = mimirRoutes;
