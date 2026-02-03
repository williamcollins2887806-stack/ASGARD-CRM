/**
 * АСГАРД CRM — Мимир AI (Улучшенный)
 * 
 * Функции:
 * - Вопросы по тендерам, работам, финансам
 * - Загрузка файлов для анализа
 * - Генерация ТКП
 * - ОГРАНИЧЕНИЯ ПО РОЛЯМ — сотрудники видят только свои данные
 */
window.AsgardMimirAI = (function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  
  // Роли и их права доступа
  const ROLE_PERMISSIONS = {
    ADMIN: {
      can_see_all_tenders: true,
      can_see_all_works: true,
      can_see_all_finances: true,
      can_see_all_employees: true,
      can_see_profits: true,
      can_see_salaries: true
    },
    DIRECTOR_GEN: {
      can_see_all_tenders: true,
      can_see_all_works: true,
      can_see_all_finances: true,
      can_see_all_employees: true,
      can_see_profits: true,
      can_see_salaries: true
    },
    DIRECTOR_COMM: {
      can_see_all_tenders: true,
      can_see_all_works: true,
      can_see_all_finances: true,
      can_see_all_employees: false,
      can_see_profits: true,
      can_see_salaries: false
    },
    FIN_DIR: {
      can_see_all_tenders: true,
      can_see_all_works: true,
      can_see_all_finances: true,
      can_see_all_employees: false,
      can_see_profits: true,
      can_see_salaries: true
    },
    PM: {
      can_see_all_tenders: false, // Только свои
      can_see_all_works: false,   // Только свои
      can_see_all_finances: false,
      can_see_all_employees: false,
      can_see_profits: false,
      can_see_salaries: false
    },
    TO: {
      can_see_all_tenders: true,  // ТО видит все тендеры
      can_see_all_works: false,
      can_see_all_finances: false,
      can_see_all_employees: false,
      can_see_profits: false,
      can_see_salaries: false
    },
    HR: {
      can_see_all_tenders: false,
      can_see_all_works: false,
      can_see_all_finances: false,
      can_see_all_employees: true,
      can_see_profits: false,
      can_see_salaries: false
    },
    BUH: {
      can_see_all_tenders: false,
      can_see_all_works: true,
      can_see_all_finances: true,
      can_see_all_employees: false,
      can_see_profits: false,
      can_see_salaries: true
    }
  };
  
  // Получить права пользователя
  function getPermissions(role) {
    return ROLE_PERMISSIONS[role] || {
      can_see_all_tenders: false,
      can_see_all_works: false,
      can_see_all_finances: false,
      can_see_all_employees: false,
      can_see_profits: false,
      can_see_salaries: false
    };
  }
  
  // Фильтрация данных по правам
  async function getFilteredData(dataType, user) {
    const perms = getPermissions(user.role);
    
    switch (dataType) {
      case 'tenders': {
        const tenders = await AsgardDB.all('tenders') || [];
        if (perms.can_see_all_tenders) return tenders;
        // Только свои тендеры (где пользователь — РП)
        return tenders.filter(t => t.responsible_pm_id === user.id);
      }
      
      case 'works': {
        const works = await AsgardDB.all('works') || [];
        if (perms.can_see_all_works) return works;
        return works.filter(w => w.pm_id === user.id);
      }
      
      case 'finances': {
        if (!perms.can_see_all_finances && !perms.can_see_profits) {
          return { error: 'Нет доступа к финансовой информации' };
        }
        
        const incomes = await AsgardDB.all('incomes') || [];
        const expenses = await AsgardDB.all('work_expenses') || [];
        
        // Если нет права видеть прибыль — не показываем итоги
        if (!perms.can_see_profits) {
          return { 
            incomes: incomes.length, 
            expenses: expenses.length,
            note: 'Детальная информация о прибыли недоступна для вашей роли'
          };
        }
        
        const totalIncome = incomes.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
        const totalExpense = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
        
        return { totalIncome, totalExpense, profit: totalIncome - totalExpense };
      }
      
      case 'employees': {
        const employees = await AsgardDB.all('employees') || [];
        if (!perms.can_see_all_employees) {
          return { error: 'Нет доступа к информации о сотрудниках' };
        }
        
        // Скрываем зарплаты если нет права
        if (!perms.can_see_salaries) {
          return employees.map(e => ({
            ...e,
            salary: '[скрыто]',
            rate: '[скрыто]'
          }));
        }
        
        return employees;
      }
      
      default:
        return [];
    }
  }
  
  // Анализ вопроса и определение типа запроса
  function analyzeQuestion(question) {
    const q = question.toLowerCase();
    
    const patterns = {
      tenders: ['тендер', 'заявк', 'закупк', 'конкурс', 'аукцион', 'ткп'],
      works: ['работ', 'объект', 'проект', 'выполнен', 'сдали', 'активн'],
      finances: ['финанс', 'доход', 'расход', 'прибыл', 'выручк', 'оплат', 'счёт', 'счет', 'деньг'],
      employees: ['сотрудник', 'работник', 'персонал', 'команд', 'штат', 'зарплат'],
      customers: ['клиент', 'заказчик', 'контрагент', 'покупател'],
      statistics: ['статистик', 'аналитик', 'отчёт', 'отчет', 'итог', 'сколько', 'количеств'],
      help: ['помощь', 'помоги', 'как', 'что умеешь', 'возможност']
    };
    
    const detected = [];
    for (const [type, keywords] of Object.entries(patterns)) {
      if (keywords.some(kw => q.includes(kw))) {
        detected.push(type);
      }
    }
    
    return detected.length > 0 ? detected : ['general'];
  }
  
  // Генерация контекста для AI на основе прав
  async function buildContext(user, questionTypes) {
    const context = {
      user: {
        name: user.name || user.login,
        role: user.role,
        id: user.id
      },
      data: {},
      restrictions: []
    };
    
    const perms = getPermissions(user.role);
    
    // Добавляем ограничения
    if (!perms.can_see_all_tenders) {
      context.restrictions.push('Пользователь видит только свои тендеры');
    }
    if (!perms.can_see_all_works) {
      context.restrictions.push('Пользователь видит только свои работы');
    }
    if (!perms.can_see_profits) {
      context.restrictions.push('ЗАПРЕЩЕНО показывать информацию о прибыли');
    }
    if (!perms.can_see_salaries) {
      context.restrictions.push('ЗАПРЕЩЕНО показывать зарплаты сотрудников');
    }
    if (!perms.can_see_all_employees) {
      context.restrictions.push('ЗАПРЕЩЕНО показывать информацию о других сотрудниках');
    }
    
    // Загружаем данные в зависимости от вопроса
    for (const type of questionTypes) {
      switch (type) {
        case 'tenders':
          context.data.tenders = await getFilteredData('tenders', user);
          break;
        case 'works':
          context.data.works = await getFilteredData('works', user);
          break;
        case 'finances':
          context.data.finances = await getFilteredData('finances', user);
          break;
        case 'employees':
          context.data.employees = await getFilteredData('employees', user);
          break;
        case 'customers':
          context.data.customers = await AsgardDB.all('customers') || [];
          break;
        case 'statistics':
          // Базовая статистика
          const tenders = await getFilteredData('tenders', user);
          const works = await getFilteredData('works', user);
          context.data.stats = {
            tenders_count: Array.isArray(tenders) ? tenders.length : 0,
            works_count: Array.isArray(works) ? works.length : 0
          };
          if (perms.can_see_profits) {
            const finances = await getFilteredData('finances', user);
            if (!finances.error) {
              context.data.stats.finances = finances;
            }
          }
          break;
      }
    }
    
    return context;
  }
  
  // Отправка запроса к AI
  async function sendToAI(question, context, attachments = []) {
    try {
      const auth = await AsgardAuth.getAuth();
      
      // Формируем системный промпт с ограничениями
      const systemPrompt = `Ты — Мимир, AI-ассистент CRM системы АСГАРД-СЕРВИС.
Ты помогаешь сотрудникам с вопросами по тендерам, работам, клиентам и финансам.

ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ:
- Имя: ${context.user.name}
- Роль: ${context.user.role}
- ID: ${context.user.id}

${context.restrictions.length > 0 ? `
СТРОГИЕ ОГРАНИЧЕНИЯ (НЕЛЬЗЯ НАРУШАТЬ):
${context.restrictions.map(r => '- ' + r).join('\n')}

Если пользователь спрашивает информацию, к которой у него нет доступа, вежливо объясни, что эти данные доступны только руководителям.
` : ''}

ДОСТУПНЫЕ ДАННЫЕ:
${JSON.stringify(context.data, null, 2).slice(0, 10000)}

Отвечай на русском языке, кратко и по делу. Используй числа и факты из предоставленных данных.
Не придумывай данные, которых нет в контексте.`;

      const response = await fetch('/api/mimir/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (auth?.token || '')
        },
        body: JSON.stringify({
          message: question,
          systemPrompt: systemPrompt,
          attachments: attachments
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        return { success: true, response: data.response || data.message };
      } else {
        const error = await response.json();
        return { success: false, error: error.message || 'Ошибка AI' };
      }
    } catch (e) {
      console.error('Mimir AI error:', e);
      return { success: false, error: e.message };
    }
  }
  
  // Интерфейс чата с Мимиром
  async function openChat() {
    const auth = await AsgardAuth.getAuth();
    if (!auth?.user) {
      toast('Ошибка', 'Требуется авторизация', 'err');
      return;
    }
    
    const user = auth.user;
    const perms = getPermissions(user.role);
    
    // Подсказки в зависимости от роли
    const suggestions = [];
    // Тендеры и работы могут смотреть все (свои данные)
    suggestions.push('Покажи мои тендеры за этот месяц');
    suggestions.push('Какие работы сейчас активны?');
    if (perms.can_see_profits) {
      suggestions.push('Какая прибыль за этот квартал?');
    }
    suggestions.push('Сколько тендеров мы выиграли?');
    
    const html = `
      <div class="mimir-chat">
        <div class="mimir-messages" id="mimirMessages">
          <div class="mimir-message assistant">
            <div class="mimir-avatar">🧙</div>
            <div class="mimir-content">
              <div class="mimir-name">Мимир</div>
              <div class="mimir-text">
                Приветствую, <b>${esc(user.name || user.login)}</b>! Я Мимир — хранитель знаний Асгарда.
                Спроси меня о тендерах, работах или клиентах.
                ${!perms.can_see_profits ? '<br><small class="muted">Финансовая информация доступна руководителям.</small>' : ''}
              </div>
            </div>
          </div>
        </div>
        
        <div class="mimir-suggestions" id="mimirSuggestions">
          ${suggestions.map(s => `<button class="mimir-suggestion">${esc(s)}</button>`).join('')}
        </div>
        
        <div class="mimir-input-area">
          <div class="mimir-attachments" id="mimirAttachments"></div>
          <div class="mimir-input-row">
            <button class="btn ghost" id="mimirAttachBtn" title="Прикрепить файл">📎</button>
            <input type="text" class="inp mimir-input" id="mimirInput" placeholder="Задайте вопрос Мимиру..."/>
            <button class="btn primary" id="mimirSendBtn">➤</button>
          </div>
        </div>
      </div>
    `;
    
    showModal('🧙 Мимир — AI Ассистент', html, { width: '600px' });
    
    const messages = $('#mimirMessages');
    const input = $('#mimirInput');
    const sendBtn = $('#mimirSendBtn');
    let attachments = [];
    
    // Отправка сообщения
    async function sendMessage() {
      const question = input.value.trim();
      if (!question) return;
      
      // Добавляем сообщение пользователя
      messages.innerHTML += `
        <div class="mimir-message user">
          <div class="mimir-content">
            <div class="mimir-text">${esc(question)}</div>
            ${attachments.length > 0 ? `<div class="mimir-files">${attachments.map(a => `📎 ${esc(a.name)}`).join(', ')}</div>` : ''}
          </div>
        </div>
      `;
      
      input.value = '';
      input.disabled = true;
      sendBtn.disabled = true;
      
      // Индикатор загрузки
      messages.innerHTML += `
        <div class="mimir-message assistant" id="mimirLoading">
          <div class="mimir-avatar">🧙</div>
          <div class="mimir-content">
            <div class="mimir-text"><span class="typing">Думаю...</span></div>
          </div>
        </div>
      `;
      messages.scrollTop = messages.scrollHeight;
      
      // Анализируем вопрос
      const questionTypes = analyzeQuestion(question);
      
      // Строим контекст
      const context = await buildContext(user, questionTypes);
      
      // Отправляем AI
      const result = await sendToAI(question, context, attachments);
      
      // Удаляем индикатор
      $('#mimirLoading')?.remove();
      
      // Добавляем ответ
      if (result.success) {
        messages.innerHTML += `
          <div class="mimir-message assistant">
            <div class="mimir-avatar">🧙</div>
            <div class="mimir-content">
              <div class="mimir-name">Мимир</div>
              <div class="mimir-text">${formatAIResponse(result.response)}</div>
            </div>
          </div>
        `;
      } else {
        messages.innerHTML += `
          <div class="mimir-message assistant error">
            <div class="mimir-avatar">⚠️</div>
            <div class="mimir-content">
              <div class="mimir-text">Извини, возникла ошибка: ${esc(result.error)}</div>
            </div>
          </div>
        `;
      }
      
      messages.scrollTop = messages.scrollHeight;
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
      
      // Очищаем вложения
      attachments = [];
      $('#mimirAttachments').innerHTML = '';
    }
    
    // Форматирование ответа AI
    function formatAIResponse(text) {
      if (!text) return '';
      
      // Экранируем HTML
      let formatted = esc(text);
      
      // Markdown-подобное форматирование
      formatted = formatted
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
      
      return formatted;
    }
    
    // События
    sendBtn.addEventListener('click', sendMessage);
    
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    
    // Подсказки
    $$('.mimir-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.textContent;
        $('#mimirSuggestions').style.display = 'none';
        input.focus();
      });
    });
    
    // Вложения
    $('#mimirAttachBtn')?.addEventListener('click', () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv';
      fileInput.multiple = true;
      
      fileInput.addEventListener('change', () => {
        for (const file of fileInput.files) {
          if (file.size > 10 * 1024 * 1024) {
            toast('Ошибка', 'Файл слишком большой (макс. 10 МБ)', 'err');
            continue;
          }
          
          attachments.push({
            name: file.name,
            type: file.type,
            file: file
          });
        }
        
        renderAttachments();
      });
      
      fileInput.click();
    });
    
    function renderAttachments() {
      $('#mimirAttachments').innerHTML = attachments.map((a, i) => `
        <div class="mimir-attachment">
          📎 ${esc(a.name)}
          <button class="btn mini ghost" data-remove-attach="${i}">✕</button>
        </div>
      `).join('');
      
      $$('[data-remove-attach]').forEach(btn => {
        btn.addEventListener('click', () => {
          attachments.splice(parseInt(btn.dataset.removeAttach), 1);
          renderAttachments();
        });
      });
    }
    
    input.focus();
  }
  
  // CSS для чата
  const style = document.createElement('style');
  style.textContent = `
    .mimir-chat {
      display: flex;
      flex-direction: column;
      height: 500px;
    }
    
    .mimir-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    
    .mimir-message {
      display: flex;
      gap: 12px;
      max-width: 85%;
    }
    
    .mimir-message.user {
      align-self: flex-end;
      flex-direction: row-reverse;
    }
    
    .mimir-message.assistant {
      align-self: flex-start;
    }
    
    .mimir-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--bg-elevated);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
    }
    
    .mimir-content {
      background: var(--bg-elevated);
      border-radius: 12px;
      padding: 10px 14px;
    }
    
    .mimir-message.user .mimir-content {
      background: var(--primary);
      color: #fff;
    }
    
    .mimir-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    
    .mimir-text {
      line-height: 1.5;
    }
    
    .mimir-text code {
      background: var(--bg-main);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
    }
    
    .mimir-files {
      font-size: 12px;
      margin-top: 8px;
      opacity: 0.8;
    }
    
    .mimir-suggestions {
      padding: 8px 16px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      border-top: 1px solid var(--border);
    }
    
    .mimir-suggestion {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 6px 12px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .mimir-suggestion:hover {
      background: var(--primary-glow);
      border-color: var(--primary);
    }
    
    .mimir-input-area {
      padding: 12px 16px;
      border-top: 1px solid var(--border);
    }
    
    .mimir-attachments {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    
    .mimir-attachment {
      background: var(--bg-elevated);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .mimir-input-row {
      display: flex;
      gap: 8px;
    }
    
    .mimir-input {
      flex: 1;
    }
    
    .typing {
      animation: typing 1.5s infinite;
    }
    
    @keyframes typing {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `;
  document.head.appendChild(style);
  
  return {
    openChat,
    sendToAI,
    buildContext,
    getFilteredData,
    getPermissions,
    analyzeQuestion,
    ROLE_PERMISSIONS
  };
})();
