'use strict';

const { VOICE_OPERATOR_SYSTEM, VOICE_OPERATOR_USER } = require('../prompts/voice-secretary-prompt');

/**
 * ASGARD CRM — AI Voice Operator
 * Полноценный AI-оператор первой линии.
 * Отвечает на ВСЕ входящие звонки, ведёт диалог, маршрутизирует.
 */

/* ── Таблица сотрудников (загружается из БД) ─── */
const ROLE_DESCRIPTIONS = {
  HEAD_TO: 'Начальник тендерного отдела',
  TO: 'Тендерный специалист',
  PM: 'Руководитель проекта',
  HEAD_PM: 'Начальник проектного отдела',
  PROC: 'Отдел закупок',
  BUH: 'Бухгалтерия',
  CHIEF_ENGINEER: 'Главный инженер',
  WAREHOUSE: 'Склад',
  OFFICE_MANAGER: 'Офис-менеджер',
  DIRECTOR_GEN: 'Генеральный директор',
  DIRECTOR_COMM: 'Коммерческий директор',
  DIRECTOR_DEV: 'Директор по развитию',
};

const FIRST_LINE_ROLES = ['HEAD_TO', 'TO'];
const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

class VoiceAgent {
  constructor(speechKit, aiProvider, db) {
    this.speechKit = speechKit;
    this.aiProvider = aiProvider;
    this.db = db;
    this.maxTurns = 8;
    this._employeeCache = null;
    this._employeeCacheTime = 0;
    this.onEvent = null; // callback(type, data) — для live-мониторинга
    this.getPendingTransfer = null; // callback() — проверка CRM-команды на перевод
    // Кэш часто используемых фраз — синтезируем при первом вызове
    this._phraseCache = new Map();
    this._cacheDir = '/var/lib/asterisk/sounds/asgard';
  }

  _emit(type, data) {
    if (typeof this.onEvent === 'function') {
      try { this.onEvent(type, data || {}); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Основной обработчик входящего звонка
   */
  async handleIncoming(channel, callerNumber) {
    const context = await this._buildContext(callerNumber);

    // Прогреваем кэш при первом звонке (не блокирует — async)
    this.warmupCache().catch(e => console.warn('[VoiceAgent] Cache warmup error:', e.message));

    // Звонит наш сотрудник — персональное приветствие
    if (context.isInternal) {
      const name = (context.internalCaller.display_name || context.internalCaller.name || '').split(' ')[0];
      this._emit('greeting', { text: `Внутренний звонок: ${context.internalCaller.name}`, internal: true });
      await this._speak(channel, `Здравствуйте, ${name}! Куда вас соединить?`);
      return this._runConversation(channel, context, []);
    }

    // Приветствие
    if (context.clientName && context.responsibleManager && context.isFullWorkHours) {
      // Известный клиент с менеджером в рабочее время
      this._emit('greeting', { text: `Здравствуйте, ${context.clientName}! Соединяю с менеджером.`, client: context.clientName, company: context.clientCompany });
      await this._speak(channel,
        `Здравствуйте, ${context.clientName}! Компания Асга+рд Се+рвис. Сейчас соединю вас с вашим менеджером, ${context.responsibleManager}. Одну минуточку.`
      );
      return {
        action: 'route',
        route_to: context.managerPhone,
        route_name: context.responsibleManager,
        intent: 'known_client',
        collected_data: { company: context.clientCompany },
        fallback_phones: this._getFirstLinePhones(context.employees),
        conversationHistory: []
      };
    }

    // Стандартное приветствие
    this._emit('greeting', { text: 'Здравствуйте! Компания Асгард Сервис. Чем могу помочь?' });
    await this._speak(channel, 'Здравствуйте! Компания Асга+рд Се+рвис. Чем могу помочь?');

    // Нерабочее время (глубокая ночь / выходные)
    if (context.timeMode === 'off') {
      await this._speak(channel,
        'Сейчас нерабочее время. Наши часы работы — с девяти до восемнадцати, понедельник — пятница. ' +
        'Оставьте сообщение, и мы перезвоним в ближайший рабочий день.'
      );
      this._emit('after_hours', { text: 'Нерабочее время — запись сообщения' });
      return { action: 'record', intent: 'after_hours', conversationHistory: [] };
    }

    // Диалог с AI
    return this._runConversation(channel, context, []);
  }

  /**
   * Цикл диалога с ИИ
   * Отдельный метод, чтобы можно было вернуться после неудачного перевода
   */
  async _runConversation(channel, context, conversationHistory) {
    let collectedData = {};
    let lastIntent = 'unknown';

    for (let turn = conversationHistory.length; turn < this.maxTurns; turn++) {
      // Проверяем CRM-инициированный перевод
      if (typeof this.getPendingTransfer === 'function') {
        const pt = this.getPendingTransfer();
        if (pt) {
          this._emit('transfer_announce', { name: pt.name, phone: pt.phone });
          
          // Polite transfer announcement with employee name
          let announcement;
          if (pt.name) {
            const phrases = [
              `Прошу прощения за ожидание, сейчас соединю вас с ${pt.name}.`,
              `Одну секунду, перевожу вас на ${pt.name}.`,
              `Благодарю за ожидание! Соединяю вас с ${pt.name}.`,
            ];
            announcement = phrases[Math.floor(Math.random() * phrases.length)];
          } else {
            announcement = 'Прошу прощения за ожидание, сейчас соединю вас со специалистом.';
          }
          
          await this._speak(channel, announcement);
          return {
            action: 'route',
            route_to: pt.phone,
            route_name: pt.name || 'Перевод из CRM',
            intent: 'crm_transfer',
            collected_data: collectedData,
            fallback_phones: this._getFirstLinePhones(context.employees),
            conversationHistory
          };
        }
      }
      this._emit('listening', { turn });
      const clientText = await this._listenAndRecognize(channel);

      if (!clientText) {
        if (turn === 0) {
          await this._speak(channel, 'Алло? Я вас слушаю.');
          continue;
        }
        // Тишина — возможно клиент ждёт
        if (turn <= 1) {
          await this._speak(channel, 'Простите, не расслышал. Подскажите, чем могу помочь?');
          continue;
        }
        // Повторная тишина
        await this._speak(channel, 'Извините, не слышу вас. Если хотите, перезвоните нам позже. До свидания!');
        return { action: 'hangup', intent: 'silence', collected_data: collectedData, conversationHistory };
      }

      conversationHistory.push({ role: 'client', text: clientText });
      this._emit('client_speech', { text: clientText, turn });

      // Генерируем ответ AI
      this._emit('ai_thinking', { turn });
      const response = await this.generateResponse({
        ...context,
        conversationHistory,
        lastClientMessage: clientText
      });

      if (!response) {
        // AI не ответил — fallback на первую линию с объявлением
        await this._speak(channel, 'Секундочку, соединяю вас со специалистом.');
        return {
          action: 'route',
          route_to: this._getFirstLinePhones(context.employees)[0],
          route_name: 'специалист первой линии',
          intent: 'fallback',
          fallback_phones: this._getFirstLinePhones(context.employees),
          conversationHistory
        };
      }

      // Обновляем собранные данные
      if (response.collected_data) {
        collectedData = { ...collectedData, ...response.collected_data };
      }
      lastIntent = response.intent || lastIntent;

      // Сотрудник просит соединить с клиентом — ищем номер в CRM
      if (context.isInternal && response.intent === 'internal_to_customer' && response.action === 'route') {
        const query = (response.collected_data && (response.collected_data.company || response.collected_data.contact_person)) || '';
        if (query && !response.route_to) {
          const customers = await this._findCustomerPhone(query);
          if (customers.length === 1) {
            response.route_to = customers[0].phone.replace(/[^0-9]/g, '');
            response.route_name = `${customers[0].contact_person || customers[0].name} (${customers[0].name})`;
          } else if (customers.length > 1) {
            const names = customers.map(c => `${c.name} — ${c.contact_person || 'нет контакта'}`).join(', ');
            response.action = 'continue';
            response.text = `Нашёл несколько: ${names}. Кого именно?`;
          } else {
            response.action = 'continue';
            response.text = `Не нашёл клиента "${query}" в базе. Уточните название или имя контактного лица.`;
          }
        }
      }

      // Произносим ответ
      await this._speak(channel, response.text);
      conversationHistory.push({ role: 'secretary', text: response.text });
      this._emit('ai_response', { text: response.text, action: response.action, route_to: response.route_to, route_name: response.route_name });

      // Выполняем действие
      if (response.action === 'route') {
        this._emit('transfer_announce', { name: response.route_name, phone: response.route_to });
        return {
          action: 'route',
          route_to: response.route_to,
          route_name: response.route_name,
          intent: lastIntent,
          collected_data: collectedData,
          fallback_phones: this._getFirstLinePhones(context.employees),
          conversationHistory,
          context // сохраняем контекст для возврата при неудаче
        };
      }

      if (response.action === 'record') {
        return {
          action: 'record',
          intent: lastIntent,
          collected_data: collectedData,
          conversationHistory
        };
      }

      if (response.action === 'hangup') {
        return {
          action: 'hangup',
          intent: lastIntent,
          collected_data: collectedData,
          conversationHistory
        };
      }

      // continue — следующий ход диалога
    }

    // Максимум ходов — предупреждаем и переводим
    await this._speak(channel, 'Сейчас соединю вас со специалистом, который поможет подробнее. Одну минутку.');
    return {
      action: 'route',
      route_to: this._getFirstLinePhones(context.employees)[0],
      route_name: 'специалист',
      intent: lastIntent,
      collected_data: collectedData,
      fallback_phones: this._getFirstLinePhones(context.employees),
      conversationHistory
    };
  }

  /**
   * Обработка неудачного перевода — возвращает клиента к AI
   * Вызывается из AGI-сервера когда Dial завершился без ANSWER
   */
  async handleTransferFailed(channel, callerNumber, failedName, conversationHistory, originalContext) {
    // Восстанавливаем контекст или строим заново
    const context = originalContext || await this._buildContext(callerNumber);

    // Добавляем системное сообщение в историю
    conversationHistory.push({
      role: 'system',
      text: `Перевод не удался: ${failedName} не ответил(а). Предложи клиенту альтернативы.`
    });

    // Спрашиваем AI что делать
    const response = await this.generateResponse({
      ...context,
      conversationHistory,
      lastClientMessage: `[СИСТЕМА: Перевод на ${failedName} не удался — не ответил]`
    });

    if (response) {
      // AI предложит альтернативы
      this._emit('ai_response', { text: response.text, action: response.action, context: 'transfer_failed_recovery' });
      await this._speak(channel, response.text);
      conversationHistory.push({ role: 'secretary', text: response.text });

      if (response.action === 'route') {
        // AI предложил другого сотрудника
        return response;
      }
      if (response.action === 'record') {
        return { ...response, conversationHistory };
      }
      if (response.action === 'hangup') {
        return { ...response, conversationHistory };
      }

      // continue — продолжаем диалог
      return this._runConversation(channel, context, conversationHistory);
    }

    // Fallback — если AI не ответил
    await this._speak(channel,
      `К сожалению, ${failedName} сейчас не может ответить. Оставьте сообщение, и мы перезвоним.`
    );
    return { action: 'record', intent: 'transfer_failed', conversationHistory };
  }

  /**
   * Генерация ответа через Claude API (streaming для скорости)
   * Стримит токены и парсит JSON сразу по завершении — быстрее чем complete()
   */
  async generateResponse(context) {
    try {
      const systemPrompt = VOICE_OPERATOR_SYSTEM(context);
      const userPrompt = VOICE_OPERATOR_USER(context);

      // Пробуем streaming — быстрее чем complete() за счёт убранного HTTP overhead
      if (typeof this.aiProvider.stream === 'function' && typeof this.aiProvider.parseStream === 'function') {
        return await this._generateResponseStream(systemPrompt, userPrompt);
      }

      // Fallback на complete() если streaming недоступен
      const response = await this.aiProvider.complete({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 400,
        temperature: 0.3
      });

      const text = typeof response === 'string' ? response : (response.text || response.content || '');
      return this._parseResponse(text);
    } catch (err) {
      console.error('[VoiceAgent] AI error:', err.message);
      return null;
    }
  }

  /**
   * Streaming версия generateResponse
   * AI отдаёт токены по мере генерации → собираем → парсим JSON сразу
   * Выигрыш ~1-1.5с за счёт отсутствия HTTP buffering overhead
   */
  async _generateResponseStream(systemPrompt, userPrompt) {
    const startTime = Date.now();

    try {
      const streamResponse = await this.aiProvider.stream({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 400,
        temperature: 0.3
      });

      const parser = this.aiProvider.parseStream(streamResponse);
      let fullText = '';

      for await (const event of parser) {
        if (event.type === 'text') {
          fullText += event.content;
        }
        if (event.type === 'error') {
          console.error('[VoiceAgent] AI stream error:', event.message);
          break;
        }
        if (event.type === 'done') {
          break;
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(`[VoiceAgent] AI stream response: ${fullText.length} chars, ${elapsed}ms`);

      if (!fullText) return null;
      return this._parseResponse(fullText);
    } catch (err) {
      console.error('[VoiceAgent] AI stream error:', err.message);

      // Fallback на complete() при ошибке стриминга
      try {
        const response = await this.aiProvider.complete({
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          maxTokens: 400,
          temperature: 0.3
        });
        const text = typeof response === 'string' ? response : (response.text || response.content || '');
        return this._parseResponse(text);
      } catch (fallbackErr) {
        console.error('[VoiceAgent] AI fallback also failed:', fallbackErr.message);
        return null;
      }
    }
  }

  /**
   * Построение контекста звонка
   */
  async _buildContext(callerNumber) {
    const employees = await this._getEmployees();
    const { normalizePhone } = require('./mango');
    const normalized = normalizePhone(callerNumber);

    // Проверяем, не звонит ли наш сотрудник
    let internalCaller = null;
    for (const emp of employees) {
      if (emp.fallback_mobile) {
        const empPhone = emp.fallback_mobile.replace(/[^0-9]/g, '');
        if (empPhone.length >= 10 && normalized.slice(-10) === empPhone.slice(-10)) {
          internalCaller = emp;
          break;
        }
      }
    }

    let clientName = null;
    let clientCompany = null;
    let clientInn = null;
    let responsibleManager = null;
    let managerPhone = null;
    let lastTender = null;
    let lastCall = null;
    let dadataInfo = null;

    // 1. Ищем в customers по номеру
    try {
      const customer = await this.db.query(
        `SELECT name, inn, contact_person FROM customers
         WHERE phone LIKE $1 OR phone LIKE $2 LIMIT 1`,
        [`%${normalized.slice(-10)}%`, `%${callerNumber.slice(-10)}%`]
      );

      if (customer.rows.length) {
        clientCompany = customer.rows[0].name;
        clientName = customer.rows[0].contact_person || clientCompany;
        clientInn = customer.rows[0].inn;

        // Ищем ответственного PM
        const tender = await this.db.query(
          `SELECT t.id, t.name, t.pm_id, u.name as pm_name, ucs.fallback_mobile
           FROM tenders t
           LEFT JOIN users u ON u.id = t.pm_id
           LEFT JOIN user_call_status ucs ON ucs.user_id = t.pm_id
           WHERE t.inn = $1 AND t.pm_id IS NOT NULL
           ORDER BY t.created_at DESC LIMIT 1`,
          [customer.rows[0].inn]
        );

        if (tender.rows.length) {
          responsibleManager = tender.rows[0].pm_name;
          managerPhone = tender.rows[0].fallback_mobile;
          lastTender = `${tender.rows[0].name} (ID: ${tender.rows[0].id})`;
        }
      }
    } catch (e) {
      console.error('[VoiceAgent] CRM lookup error:', e.message);
    }

    // 2. Ищем в call_history
    if (!clientName) {
      try {
        const prevCall = await this.db.query(
          `SELECT ch.client_inn, c.name as client_name, c.contact_person,
                  ch.dadata_region, ch.dadata_operator, ch.ai_summary
           FROM call_history ch
           LEFT JOIN customers c ON c.inn = ch.client_inn
           WHERE ch.from_number LIKE $1 AND ch.client_inn IS NOT NULL
           ORDER BY ch.created_at DESC LIMIT 1`,
          [`%${normalized.slice(-10)}%`]
        );
        if (prevCall.rows.length && prevCall.rows[0].client_name) {
          clientCompany = prevCall.rows[0].client_name;
          clientName = prevCall.rows[0].contact_person || clientCompany;
          clientInn = prevCall.rows[0].client_inn;
          dadataInfo = [prevCall.rows[0].dadata_region, prevCall.rows[0].dadata_operator].filter(Boolean).join(', ');
        }
      } catch (e) { /* ignore */ }
    }

    // 3. DaData info
    if (!dadataInfo) {
      try {
        const dd = await this.db.query(
          `SELECT dadata_region, dadata_operator FROM call_history
           WHERE from_number LIKE $1 AND dadata_region IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`,
          [`%${normalized.slice(-10)}%`]
        );
        if (dd.rows.length) {
          dadataInfo = [dd.rows[0].dadata_region, dd.rows[0].dadata_operator].filter(Boolean).join(', ');
        }
      } catch (e) { /* ignore */ }
    }

    // 4. Последний звонок
    try {
      const lc = await this.db.query(
        `SELECT created_at, ai_summary FROM call_history
         WHERE from_number LIKE $1 ORDER BY created_at DESC LIMIT 1`,
        [`%${normalized.slice(-10)}%`]
      );
      if (lc.rows.length) {
        const d = new Date(lc.rows[0].created_at);
        lastCall = d.toLocaleDateString('ru-RU') + (lc.rows[0].ai_summary ? ': ' + lc.rows[0].ai_summary.slice(0, 80) : '');
      }
    } catch (e) { /* ignore */ }

    // 5. Режим работы
    const now = new Date();
    const mskHour = now.getUTCHours() + 3;
    const mskDay = now.getUTCDay();
    const hour = mskHour >= 0 ? mskHour : mskHour + 24;
    const isWeekday = mskDay >= 1 && mskDay <= 5;

    let timeMode = 'off';
    let isFullWorkHours = false;
    if (isWeekday && hour >= 9 && hour < 24) {
      timeMode = 'full';
      isFullWorkHours = true;
    } else if (isWeekday && ((hour >= 7 && hour < 9) || (hour >= 24 && hour < 25))) {
      timeMode = 'extended';
    }

    const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

    let timeModeDesc = '';
    if (timeMode === 'full') {
      timeModeDesc = 'РЕЖИМ: Рабочее время. Переводы разрешены.';
    } else if (timeMode === 'extended') {
      timeModeDesc = 'РЕЖИМ: Расширенное время. Переводить ТОЛЬКО заказчиков по СРОЧНОМУ вопросу.';
    } else {
      timeModeDesc = 'РЕЖИМ: Нерабочее время. НЕ переводить. Только запись сообщения.';
    }

    const employeeList = this._formatEmployeeList(employees, !!internalCaller);
    const availableEmployees = this._formatAvailableEmployees(employees, timeMode, !!internalCaller);

    return {
      callerNumber,
      internalCaller,
      isInternal: !!internalCaller,
      clientName,
      clientCompany,
      clientInn,
      responsibleManager,
      managerPhone,
      lastTender,
      lastCall,
      dadataInfo,
      isFullWorkHours,
      timeMode,
      timeModeDesc,
      currentTime: `${String(hour).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')} МСК`,
      dayOfWeek: days[mskDay],
      employeeList,
      availableEmployees,
      employees
    };
  }

  /**
   * Поиск телефона клиента/контрагента по названию компании или имени контактного лица
   */
  async _findCustomerPhone(query) {
    try {
      const res = await this.db.query(
        `SELECT name, phone, contact_person, inn FROM customers
         WHERE is_active = true AND phone IS NOT NULL AND phone != ''
           AND (name ILIKE $1 OR contact_person ILIKE $1 OR inn = $2)
         ORDER BY updated_at DESC NULLS LAST LIMIT 5`,
        [`%${query}%`, query]
      );
      return res.rows;
    } catch (e) {
      console.error('[VoiceAgent] Customer phone lookup error:', e.message);
      return [];
    }
  }

  /**
   * Загрузка сотрудников из БД (с кэшем 5 мин)
   */
  async _getEmployees() {
    const now = Date.now();
    if (this._employeeCache && (now - this._employeeCacheTime) < 300000) {
      return this._employeeCache;
    }

    try {
      const { rows } = await this.db.query(`
        SELECT u.id, u.name, u.role, ucs.display_name, ucs.fallback_mobile,
               ucs.accepting, ucs.busy, ucs.is_duty
        FROM users u
        LEFT JOIN user_call_status ucs ON ucs.user_id = u.id
        WHERE u.is_active = true
        ORDER BY u.role, u.name
      `);

      this._employeeCache = rows;
      this._employeeCacheTime = now;
      return rows;
    } catch (e) {
      console.error('[VoiceAgent] Employees load error:', e.message);
      return this._employeeCache || [];
    }
  }

  /**
   * Форматирование списка сотрудников для промпта
   */
  _formatEmployeeList(employees, isInternal) {
    if (!employees || !employees.length) return '(нет данных)';

    const lines = [];
    const byRole = {};
    for (const emp of employees) {
      if (!isInternal && DIRECTOR_ROLES.includes(emp.role)) continue;
      if (!byRole[emp.role]) byRole[emp.role] = [];
      byRole[emp.role].push(emp);
    }

    lines.push('ПЕРВАЯ ЛИНИЯ (приём звонков):');
    for (const role of FIRST_LINE_ROLES) {
      for (const emp of (byRole[role] || [])) {
        const phone = emp.fallback_mobile || '';
        const desc = ROLE_DESCRIPTIONS[emp.role] || emp.role;
        lines.push(`  • ${emp.display_name || emp.name} — ${desc}, тел: ${phone}`);
      }
    }

    lines.push('');
    lines.push('СПЕЦИАЛИСТЫ:');
    for (const role of ['PROC', 'BUH', 'HEAD_PM', 'CHIEF_ENGINEER', 'WAREHOUSE', 'OFFICE_MANAGER']) {
      for (const emp of (byRole[role] || [])) {
        const phone = emp.fallback_mobile || '';
        const desc = ROLE_DESCRIPTIONS[emp.role] || emp.role;
        lines.push(`  • ${emp.display_name || emp.name} — ${desc}, тел: ${phone}`);
      }
    }

    if (byRole['PM'] && byRole['PM'].length) {
      lines.push('');
      lines.push('РУКОВОДИТЕЛИ ПРОЕКТОВ (PM):');
      for (const emp of byRole['PM']) {
        const phone = emp.fallback_mobile || '';
        lines.push(`  • ${emp.display_name || emp.name} — PM, тел: ${phone}`);
      }
    }

    if (isInternal) {
      lines.push('');
      lines.push('ДИРЕКТОРА:');
      for (const role of DIRECTOR_ROLES) {
        for (const emp of (byRole[role] || [])) {
          const phone = emp.fallback_mobile || '';
          const desc = ROLE_DESCRIPTIONS[emp.role] || emp.role;
          lines.push(`  • ${emp.display_name || emp.name} — ${desc}, тел: ${phone}`);
        }
      }
    } else {
      lines.push('');
      lines.push('ДИРЕКТОРА (Кудряшов О.С., Гажилиев О.В., Сторожев А.А.) — НЕ ПЕРЕВОДИТЬ напрямую!');
    }

    return lines.join('\n');
  }

  /**
   * Список доступных сотрудников для текущего перевода
   */
  _formatAvailableEmployees(employees, timeMode, isInternal) {
    if (!isInternal && timeMode === 'off') return 'Нерабочее время — переводы недоступны.';

    const available = employees.filter(e =>
      (isInternal || !DIRECTOR_ROLES.includes(e.role)) &&
      e.role !== 'ADMIN' &&
      e.fallback_mobile
    );

    if (timeMode === 'extended') {
      const firstLine = available.filter(e => FIRST_LINE_ROLES.includes(e.role));
      return firstLine.map(e => `${e.display_name || e.name} (${ROLE_DESCRIPTIONS[e.role]}): ${e.fallback_mobile}`).join('\n');
    }

    return available.map(e => `${e.display_name || e.name} (${ROLE_DESCRIPTIONS[e.role] || e.role}): ${e.fallback_mobile}`).join('\n');
  }

  /**
   * Получить телефоны первой линии для fallback
   */
  _getFirstLinePhones(employees) {
    if (!employees) return [];
    return employees
      .filter(e => FIRST_LINE_ROLES.includes(e.role) && e.fallback_mobile)
      .sort((a, b) => (a.role === 'HEAD_TO' ? -1 : 1))
      .map(e => e.fallback_mobile.replace(/[^0-9]/g, ''));
  }

  /**
   * Парсинг JSON-ответа от AI
   */
  _parseResponse(text) {
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    try {
      const data = JSON.parse(cleaned);

      let routeTo = data.route_to || null;
      if (routeTo && typeof routeTo === 'string') {
        routeTo = routeTo.replace(/[^0-9]/g, '');
        if (routeTo.startsWith('8') && routeTo.length === 11) {
          routeTo = '7' + routeTo.slice(1);
        }
        if (routeTo.length !== 11) routeTo = null;
      }

      return {
        text: String(data.text || '').slice(0, 300),
        action: ['route', 'record', 'hangup', 'continue'].includes(data.action) ? data.action : 'continue',
        route_to: routeTo,
        route_name: data.route_name || null,
        intent: data.intent || 'unknown',
        collected_data: data.collected_data || {},
        reason: data.reason || null
      };
    } catch (err) {
      return { text: cleaned.slice(0, 200), action: 'continue', route_to: null, intent: 'unknown', collected_data: {} };
    }
  }

  /**
   * Преобразование текста в SSML для естественного звучания
   */
  _textToSsml(text) {
    let ssml = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Естественные паузы
    ssml = ssml.replace(/\.\s+/g, '. <break time="350ms"/> ');
    ssml = ssml.replace(/!\s+/g, '! <break time="350ms"/> ');
    ssml = ssml.replace(/\?\s+/g, '? <break time="400ms"/> ');
    ssml = ssml.replace(/,\s+/g, ', <break time="150ms"/> ');
    ssml = ssml.replace(/\s—\s/g, ' <break time="200ms"/> ');

    return '<speak>' + ssml + '</speak>';
  }

  /**
   * Прогрев кэша TTS — синтезируем частые фразы заранее
   * Вызывается при первом звонке, не блокирует
   */
  async warmupCache() {
    if (this._cacheWarmedUp) return;
    this._cacheWarmedUp = true;

    const phrases = [
      'Здравствуйте! Компания Асга+рд Се+рвис. Чем могу помочь?',
      'Алло? Я вас слушаю.',
      'Простите, не расслышал. Подскажите, чем могу помочь?',
      'Извините, не слышу вас. Если хотите, перезвоните нам позже. До свидания!',
      'Секундочку, соединяю вас со специалистом.',
      'Сейчас соединю вас со специалистом, который поможет подробнее. Одну минутку.',
      'Сейчас нерабочее время. Наши часы работы — с девяти до восемнадцати, понедельник — пятница. Оставьте сообщение, и мы перезвоним в ближайший рабочий день.',
      'К сожалению, прямое соединение с руководством не предусмотрено. Подскажите ваш вопрос, я передам информацию.',
      'Куда вас соединить?',
    ];

    console.log(`[VoiceAgent] Warming up TTS cache (${phrases.length} phrases)...`);

    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');

    if (!fs.existsSync(this._cacheDir)) {
      fs.mkdirSync(this._cacheDir, { recursive: true });
    }

    let cached = 0;
    for (const phrase of phrases) {
      try {
        // Для кэша используем plain text без ударений
        const plainPhrase = phrase.replace(/\+/g, '');
        const hash = crypto.createHash('md5').update(plainPhrase).digest('hex').slice(0, 12);
        const filePath = path.join(this._cacheDir, `tts_${hash}.opus`);

        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100) {
          this._phraseCache.set(plainPhrase, path.join(this._cacheDir, `tts_${hash}`));
          cached++;
          continue;
        }

        const audioBuffer = await this.speechKit.synthesizeSmart(phrase, {
          voice: 'dasha',
          role: 'friendly',
          emotion: 'good',
          speed: '1.0',
          ssml: false
        });

        fs.writeFileSync(filePath, audioBuffer);
        this._phraseCache.set(plainPhrase, path.join(this._cacheDir, `tts_${hash}`));
        cached++;
      } catch (e) {
        console.warn(`[VoiceAgent] Cache warmup failed for: "${phrase.slice(0, 40)}..."`, e.message);
      }
    }

    console.log(`[VoiceAgent] TTS cache ready: ${cached}/${phrases.length} phrases`);
  }

  /**
   * Синтез речи и воспроизведение (с кэшем)
   */
  async _speak(channel, text) {
    if (!this.speechKit || !this.speechKit.isConfigured()) {
      console.log('[VoiceAgent] TTS (skip):', text);
      return;
    }

    try {
      const crypto = require('crypto');
      const fs = require('fs');
      const path = require('path');
      const hash = crypto.createHash('md5').update(text).digest('hex').slice(0, 12);
      const dir = this._cacheDir || '/var/lib/asterisk/sounds/asgard';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `tts_${hash}`);

      // Проверяем кэш — мгновенное воспроизведение
      if (this._phraseCache && this._phraseCache.has(text)) {
        const cachedPath = this._phraseCache.get(text);
        if (channel && typeof channel.streamFile === 'function') {
          await channel.streamFile(cachedPath);
        }
        return;
      }

      // Проверяем файл на диске (мог быть синтезирован ранее)
      if (fs.existsSync(filePath + '.opus') && fs.statSync(filePath + '.opus').size > 100) {
        if (channel && typeof channel.streamFile === 'function') {
          await channel.streamFile(filePath);
        }
        return;
      }

      // Синтезируем: v3 dasha/friendly → v1 alena/good fallback
      const audioBuffer = await this.speechKit.synthesizeSmart(text, {
        voice: 'dasha',
        role: 'friendly',
        emotion: 'good',
        speed: '1.0',
        ssml: false
      });

      fs.writeFileSync(filePath + '.opus', audioBuffer);

      if (channel && typeof channel.streamFile === 'function') {
        await channel.streamFile(filePath);
      }
    } catch (err) {
      console.error('[VoiceAgent] TTS error:', err.message);
    }
  }

  /**
   * Запись речи клиента и распознавание
   */
  async _listenAndRecognize(channel) {
    if (!channel || typeof channel.recordFile !== 'function') return null;
    if (!this.speechKit || !this.speechKit.isConfigured()) return null;

    try {
      const tmpFile = `/tmp/agi_rec_${Date.now()}`;
      const recorded = await channel.recordFile(tmpFile, "wav", "#", 12000, 0, false, 1.5);
      if (!recorded) return null;

      const fs = require('fs');
      const wavPath = tmpFile + '.wav';
      if (!fs.existsSync(wavPath)) return null;

      const stat = fs.statSync(wavPath);
      if (stat.size < 1000) return null;

      const text = await this.speechKit.recognizeShort(wavPath, {
        audioEncoding: 'lpcm',
        sampleRate: 8000
      });

      try { fs.unlinkSync(wavPath); } catch (e) { /* ignore */ }

      return text && text.trim() ? text.trim() : null;
    } catch (err) {
      console.error('[VoiceAgent] STT error:', err.message);
      return null;
    }
  }
}

module.exports = VoiceAgent;
