/**
 * АСГАРД CRM — Telegram интеграция
 * Этап 35
 * 
 * Возможности:
 * 1. Настройки бота (токен, webhook URL)
 * 2. Отправка уведомлений через Telegram Bot API
 * 3. Парсинг банковских SMS (ручной ввод)
 * 4. Шаблоны сообщений
 * 5. Привязка Telegram ID к пользователям
 */
window.AsgardTelegram = (function(){
  
  // Шаблоны сообщений
  const MESSAGE_TEMPLATES = {
    tender_new: {
      name: 'Новый тендер',
      template: '🆕 *Новый тендер*\n\n📋 {tender_title}\n🏢 {customer_name}\n💰 {tender_price}\n📅 Дедлайн: {docs_deadline}'
    },
    tender_handoff: {
      name: 'Передача на просчёт',
      template: '📤 *Передача на просчёт*\n\n📋 {tender_title}\n🏢 {customer_name}\n👤 РП: {pm_name}'
    },
    bonus_request: {
      name: 'Запрос премии',
      template: '💰 *Запрос на согласование премий*\n\n📋 {work_title}\n👤 РП: {pm_name}\n💵 Сумма: {total_amount}'
    },
    permit_expiring: {
      name: 'Истекает разрешение',
      template: '⚠️ *Истекает разрешение*\n\n👤 {employee_name}\n📜 {permit_type}\n📅 До: {expiry_date}'
    },
    seal_transfer: {
      name: 'Передача печати',
      template: '🔄 *Передача печати*\n\n🔏 {seal_name}\n👤 Кому: {to_name}\n📝 Цель: {purpose}'
    },
    contract_expiring: {
      name: 'Истекает договор',
      template: '📄 *Истекает договор*\n\n📋 {contract_number}\n🏢 {counterparty_name}\n📅 До: {end_date}'
    },
    bank_income: {
      name: 'Поступление на счёт',
      template: '💵 *Поступление*\n\n💰 {amount}\n🏢 {sender}\n📝 {purpose}'
    }
  };

  // Паттерны для парсинга банковских SMS
  const BANK_SMS_PATTERNS = [
    // Сбербанк
    {
      bank: 'Сбербанк',
      pattern: /(?:Зачисление|Перевод)\s+(\d[\d\s,.]+)\s*(?:руб|р\.?)\s*(?:от\s+)?(.+?)(?:\s+Баланс|\s*$)/i,
      groups: { amount: 1, sender: 2 }
    },
    // Альфа-Банк
    {
      bank: 'Альфа-Банк',
      pattern: /Пополнение\s+(\d[\d\s,.]+)\s*(?:RUB|руб)\s*(?:от\s+)?(.+)/i,
      groups: { amount: 1, sender: 2 }
    },
    // Тинькофф
    {
      bank: 'Тинькофф',
      pattern: /Пополнение\s+\+(\d[\d\s,.]+)\s*(?:₽|руб|р)\s*(.+)/i,
      groups: { amount: 1, sender: 2 }
    },
    // Универсальный
    {
      bank: 'Универсальный',
      pattern: /(?:зачисл|пополн|перевод)[а-яё]*\s*[:\s]+(\d[\d\s,.]+)\s*(?:руб|р\.?|₽)/i,
      groups: { amount: 1 }
    }
  ];

  // Получить настройки Telegram
  async function getSettings() {
    try {
      const s = await AsgardDB.get('settings', 'telegram');
      return s ? JSON.parse(s.value_json || '{}') : {};
    } catch(e) {
      return {};
    }
  }

  // Сохранить настройки
  async function saveSettings(settings) {
    try {
      await AsgardDB.put('settings', {
        key: 'telegram',
        value_json: JSON.stringify(settings),
        updated_at: new Date().toISOString()
      });
      return true;
    } catch(e) {
      console.error('Failed to save Telegram settings:', e);
      return false;
    }
  }

  // Отправить сообщение через Telegram Bot API
  async function sendMessage(chatId, text, options = {}) {
    const settings = await getSettings();
    if (!settings.bot_token) {
      console.warn('Telegram bot token not configured');
      return { ok: false, error: 'Bot token not configured' };
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${settings.bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: options.parseMode || 'Markdown',
          disable_web_page_preview: true,
          ...options
        })
      });

      const result = await response.json();
      return result;
    } catch(e) {
      console.error('Telegram send error:', e);
      return { ok: false, error: e.message };
    }
  }

  // Отправить уведомление пользователю (если привязан Telegram)
  async function notifyUser(userId, templateKey, data) {
    const settings = await getSettings();
    if (!settings.bot_token || !settings.enabled) return false;

    // Получаем пользователя
    const user = await AsgardDB.get('users', userId);
    if (!user || !user.telegram_chat_id) return false;

    // Формируем сообщение
    const template = MESSAGE_TEMPLATES[templateKey];
    if (!template) return false;

    let text = template.template;
    for (const [key, value] of Object.entries(data || {})) {
      text = text.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '—');
    }

    return await sendMessage(user.telegram_chat_id, text);
  }

  // Парсить банковское SMS
  function parseBankSMS(smsText) {
    for (const pattern of BANK_SMS_PATTERNS) {
      const match = smsText.match(pattern.pattern);
      if (match) {
        const result = {
          bank: pattern.bank,
          raw: smsText
        };
        
        if (pattern.groups.amount && match[pattern.groups.amount]) {
          result.amount = parseFloat(match[pattern.groups.amount].replace(/\s/g, '').replace(',', '.'));
        }
        if (pattern.groups.sender && match[pattern.groups.sender]) {
          result.sender = match[pattern.groups.sender].trim();
        }
        
        return result;
      }
    }
    
    return null;
  }

  // Рендер страницы настроек Telegram
  async function renderSettings({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    
    const user = auth.user;
    if (user.role !== 'ADMIN') {
      AsgardUI.toast('Доступ', 'Только для администратора', 'err');
      location.hash = '#/home';
      return;
    }

    const settings = await getSettings();
    const users = await AsgardDB.getAll('users') || [];

    const html = `
      <div class="panel">
        <h3 style="margin-bottom:16px">🤖 Telegram интеграция</h3>
        
        <details open style="margin-bottom:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--blue)"></span> Настройки бота</summary>
          <div class="formrow" style="margin-top:12px">
            <div style="grid-column:1/-1">
              <label>Токен бота</label>
              <input type="password" id="tgBotToken" class="inp" value="${esc(settings.bot_token || '')}" placeholder="123456789:ABCdefGHI..."/>
              <div class="help">Получите у @BotFather в Telegram</div>
            </div>
            <div>
              <label>Webhook URL (опционально)</label>
              <input type="url" id="tgWebhook" class="inp" value="${esc(settings.webhook_url || '')}" placeholder="https://your-server.com/api/tg"/>
            </div>
            <div>
              <label><input type="checkbox" id="tgEnabled" ${settings.enabled ? 'checked' : ''}/> Включить уведомления</label>
            </div>
          </div>
          <div style="margin-top:12px">
            <button class="btn" id="btnSaveTgSettings">Сохранить настройки</button>
            <button class="btn ghost" id="btnTestTg" style="margin-left:8px">Тест отправки</button>
          </div>
        </details>

        <details open style="margin-bottom:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--red)"></span> Диагностика и отправка</summary>
          <div id="tgDiagnostics" style="margin-top:12px;padding:12px;background:var(--bg-card);border-radius:12px">
            <div class="help">Загрузка...</div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn primary" id="btnFlushTelegram">📤 Отправить ВСЕ непрочитанные в Telegram</button>
            <button class="btn ghost" id="btnCheckTgStatus">🔍 Проверить статус</button>
          </div>
        </details>

        <details style="margin-bottom:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--green)"></span> Привязка пользователей</summary>
          <div class="tbl-wrap" style="margin-top:12px">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Роль</th>
                  <th>Telegram Chat ID</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${users.map(u => `
                  <tr data-id="${u.id}">
                    <td>${esc(u.name || u.login)}</td>
                    <td>${esc(u.role)}</td>
                    <td>
                      <input type="text" class="inp tgChatId" value="${esc(u.telegram_chat_id || '')}" placeholder="123456789" style="width:150px"/>
                    </td>
                    <td>
                      <button class="btn mini ghost btnSaveUser">💾</button>
                      <button class="btn mini ghost btnSendPassword" title="Отправить пароль">🔑</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div class="help" style="margin-top:8px">
            Chat ID можно узнать у бота @userinfobot или через /start у вашего бота
          </div>
        </details>

        <details style="margin-bottom:16px">
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--amber)"></span> Парсер банковских SMS</summary>
          <div style="margin-top:12px">
            <label>Вставьте SMS от банка:</label>
            <textarea id="bankSms" class="inp" rows="3" placeholder="Пример: Зачисление 50000 руб. от ООО РОМАШКА Баланс: 150000р"></textarea>
            <button class="btn" id="btnParseSms" style="margin-top:8px">Распознать</button>
          </div>
          <div id="smsResult" style="margin-top:12px"></div>
        </details>

        <details>
          <summary class="kpi" style="cursor:pointer"><span class="dot" style="background:var(--purple)"></span> Шаблоны сообщений</summary>
          <div style="margin-top:12px">
            ${Object.entries(MESSAGE_TEMPLATES).map(([key, t]) => `
              <div class="card" style="margin-bottom:8px;padding:12px">
                <div style="font-weight:600">${esc(t.name)}</div>
                <pre style="font-size:12px;background:var(--bg-elevated);padding:8px;border-radius:6px;margin-top:8px;white-space:pre-wrap">${esc(t.template)}</pre>
              </div>
            `).join('')}
          </div>
        </details>
      </div>
    `;

    await layout(html, { title: title || 'Telegram интеграция' });

    // Сохранение настроек
    document.getElementById('btnSaveTgSettings')?.addEventListener('click', async () => {
      const newSettings = {
        bot_token: document.getElementById('tgBotToken').value.trim(),
        webhook_url: document.getElementById('tgWebhook').value.trim(),
        enabled: document.getElementById('tgEnabled').checked,
        updated_at: new Date().toISOString()
      };
      
      if (await saveSettings(newSettings)) {
        AsgardUI.toast('Сохранено', 'Настройки Telegram сохранены', 'ok');
      } else {
        AsgardUI.toast('Ошибка', 'Не удалось сохранить', 'err');
      }
    });

    // Тест отправки
    document.getElementById('btnTestTg')?.addEventListener('click', async () => {
      const chatId = prompt('Введите Chat ID для теста:');
      if (!chatId) return;
      
      const result = await sendMessage(chatId, '✅ *Тест АСГАРД CRM*\n\nУведомления работают!');
      if (result.ok) {
        AsgardUI.toast('Успех', 'Тестовое сообщение отправлено', 'ok');
      } else {
        AsgardUI.toast('Ошибка', result.error || result.description || 'Ошибка отправки', 'err');
      }
    });

    // Сохранение Chat ID пользователя
    document.querySelectorAll('.btnSaveUser').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const userId = Number(row.dataset.id);
        const chatId = row.querySelector('.tgChatId').value.trim();
        
        const user = await AsgardDB.get('users', userId);
        if (user) {
          user.telegram_chat_id = chatId || null;
          await AsgardDB.put('users', user);
          AsgardUI.toast('Сохранено', `Chat ID для ${user.name || user.login} обновлён`, 'ok');
        }
      });
    });

    // Отправка пароля через Telegram
    document.querySelectorAll('.btnSendPassword').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const userId = Number(row.dataset.id);
        const userName = row.querySelector('td').textContent;
        
        if (!confirm(`Отправить временный пароль пользователю ${userName} в Telegram?`)) return;
        
        try {
          const auth = await AsgardAuth.getAuth();
          const response = await fetch('/api/auth/send-telegram-password', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + auth.token
            },
            body: JSON.stringify({ userId })
          });
          
          const result = await response.json();
          
          if (response.ok && result.success) {
            AsgardUI.toast('Успех', result.message, 'ok');
          } else {
            AsgardUI.toast('Ошибка', result.error || 'Не удалось отправить пароль', 'err');
          }
        } catch (e) {
          AsgardUI.toast('Ошибка', 'Ошибка сети', 'err');
        }
      });
    });

    // Парсер SMS
    document.getElementById('btnParseSms')?.addEventListener('click', () => {
      const sms = document.getElementById('bankSms').value;
      const result = parseBankSMS(sms);
      
      const resultDiv = document.getElementById('smsResult');
      if (result) {
        resultDiv.innerHTML = `
          <div class="card" style="padding:12px;border-left:4px solid var(--green)">
            <div>✅ Распознано: <strong>${esc(result.bank)}</strong></div>
            ${result.amount ? `<div>💰 Сумма: <strong>${result.amount.toLocaleString('ru-RU')} ₽</strong></div>` : ''}
            ${result.sender ? `<div>🏢 Отправитель: <strong>${esc(result.sender)}</strong></div>` : ''}
            <div style="margin-top:8px">
              <button class="btn mini" id="btnCreateIncome">Создать поступление →</button>
            </div>
          </div>
        `;
        
        document.getElementById('btnCreateIncome')?.addEventListener('click', () => {
          // TODO: интеграция с модулем поступлений
          AsgardUI.toast('В разработке', 'Автосоздание поступления будет добавлено', 'warn');
        });
      } else {
        resultDiv.innerHTML = `
          <div class="card" style="padding:12px;border-left:4px solid var(--red)">
            ❌ Не удалось распознать SMS. Попробуйте другой формат.
          </div>
        `;
      }
    });

    // ─── Диагностика Telegram ────────────────────────────────────────────
    async function checkTgStatus() {
      const diagDiv = document.getElementById('tgDiagnostics');
      if (!diagDiv) return;
      diagDiv.innerHTML = '<div class="help">Проверка...</div>';

      try {
        const auth = await AsgardAuth.getAuth();
        const resp = await fetch('/api/notifications/telegram-status', {
          headers: { 'Authorization': 'Bearer ' + auth.token }
        });
        const data = await resp.json();

        diagDiv.innerHTML = `
          <div style="display:grid;gap:8px">
            <div>${data.bot_active ? '✅' : '❌'} Бот: <b>${data.bot_active ? 'Активен' : 'НЕ ЗАПУЩЕН'}</b></div>
            <div>${data.bot_token_set ? '✅' : '❌'} Токен: <b>${data.bot_token_set ? 'Установлен' : 'НЕ УСТАНОВЛЕН (нужен TELEGRAM_BOT_TOKEN в .env)'}</b></div>
            <div>👥 Привязанных пользователей: <b>${data.linked_count || 0}</b></div>
            <div>📬 Всего непрочитанных: <b>${data.total_unread || 0}</b></div>
            ${data.linked_users && data.linked_users.length > 0
              ? '<div style="margin-top:4px"><b>Привязанные:</b> ' + data.linked_users.map(u => u.name).join(', ') + '</div>'
              : '<div style="color:var(--red);margin-top:4px">⚠️ Ни один пользователь не привязал Telegram. Каждому нужно написать боту /link свой_email</div>'
            }
          </div>
        `;
      } catch (e) {
        diagDiv.innerHTML = '<div style="color:var(--red)">❌ Ошибка: ' + esc(e.message) + '</div>';
      }
    }
    checkTgStatus();

    document.getElementById('btnCheckTgStatus')?.addEventListener('click', checkTgStatus);

    // ─── Массовая отправка в Telegram ──────────────────────────────────
    document.getElementById('btnFlushTelegram')?.addEventListener('click', async () => {
      if (!confirm('Отправить ВСЕ непрочитанные уведомления привязанным пользователям в Telegram?')) return;

      try {
        const auth = await AsgardAuth.getAuth();
        const resp = await fetch('/api/notifications/flush-telegram', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + auth.token
          }
        });
        const data = await resp.json();

        if (data.error) {
          AsgardUI.toast('Ошибка', data.error, 'err');
        } else {
          AsgardUI.toast('Готово', `Отправлено: ${data.sent}, Ошибок: ${data.failed || 0}`, 'ok');
        }
        checkTgStatus();
      } catch (e) {
        AsgardUI.toast('Ошибка', 'Сетевая ошибка: ' + e.message, 'err');
      }
    });
  }

  // Helpers
  function esc(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  return {
    getSettings,
    saveSettings,
    sendMessage,
    notifyUser,
    parseBankSMS,
    renderSettings,
    MESSAGE_TEMPLATES,
    BANK_SMS_PATTERNS
  };
})();
