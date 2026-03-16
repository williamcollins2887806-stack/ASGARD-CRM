/**
 * ASGARD CRM — Mobile v3 / Настройки Telegram
 * Сессия 13 (Окно A) — 15.03.2026
 * Только ADMIN: токен бота, webhook, тест, шаблоны, привязка пользователей
 */
var TelegramPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;
    var user = Store.get('user') || {};

    var page = el('div', { style: { background: t.bg, paddingBottom: '100px' } });

    page.appendChild(M.Header({
      title: 'Telegram',
      subtitle: 'СИСТЕМА',
      back: true,
      backHref: '/settings',
    }));

    if (user.role !== 'ADMIN') {
      page.appendChild(M.Empty({ text: 'Доступ только для администратора', icon: '🔒' }));
      return page;
    }

    var contentWrap = el('div');
    contentWrap.replaceChildren(M.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(contentWrap);

    // ── Load telegram settings ──
    setTimeout(function () {
      API.fetch('/settings/telegram').catch(function () { return {}; }).then(function (tgSettings) {
        var cfg = {};
        if (tgSettings && tgSettings.value_json) {
          try { cfg = JSON.parse(tgSettings.value_json); } catch (_) {}
        } else if (tgSettings && typeof tgSettings === 'object') {
          cfg = tgSettings;
        }

        API.fetch('/users').catch(function () { return []; }).then(function (users) {
          var userList = API.extractRows(users);
          contentWrap.replaceChildren();
          renderTelegram(contentWrap, cfg, userList);
        });
      });
    }, 0);

    function renderTelegram(container, cfg, userList) {
      // ═══ 1. Токен бота ═══
      var tokenMasked = { v: true };
      var tokenSection = makeSection('🤖', 'Токен бота', 0);
      var tokenBody = tokenSection.body;

      var tokenDisplay = el('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
        },
      });
      var tokenText = el('div', {
        style: {
          ...DS.font('sm'),
          color: t.text,
          flex: 1,
          fontFamily: 'monospace',
          wordBreak: 'break-all',
        },
        textContent: maskToken(cfg.bot_token || ''),
      });
      tokenDisplay.appendChild(tokenText);

      var toggleBtn = el('button', {
        style: {
          padding: '6px 12px', borderRadius: '8px',
          border: '1px solid ' + t.border, background: t.surface,
          color: t.blue, fontSize: '12px', fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
        },
        textContent: 'Показать',
      });
      toggleBtn.addEventListener('click', function () {
        tokenMasked.v = !tokenMasked.v;
        tokenText.textContent = tokenMasked.v ? maskToken(cfg.bot_token || '') : (cfg.bot_token || 'Не задан');
        toggleBtn.textContent = tokenMasked.v ? 'Показать' : 'Скрыть';
      });
      tokenDisplay.appendChild(toggleBtn);
      tokenBody.appendChild(tokenDisplay);

      // Edit token button
      var editTokenWrap = el('div', { style: { padding: '0 16px 12px' } });
      editTokenWrap.appendChild(M.FullWidthBtn({
        label: 'Изменить токен',
        variant: 'secondary',
        onClick: function () { openEditToken(cfg); },
      }));
      tokenBody.appendChild(editTokenWrap);
      container.appendChild(tokenSection.wrap);

      // ═══ 2. Webhook ═══
      var whSection = makeSection('🔗', 'Webhook URL', 1);
      var whBody = whSection.body;
      var webhookUrl = cfg.webhook_url || (window.location.origin + '/api/telegram/webhook');
      whBody.appendChild(el('div', {
        style: { ...DS.font('sm'), color: t.text, padding: '12px 16px', fontFamily: 'monospace', wordBreak: 'break-all' },
        textContent: webhookUrl,
      }));
      var whBtnWrap = el('div', { style: { padding: '0 16px 12px', display: 'flex', gap: '8px' } });
      whBtnWrap.appendChild(M.FullWidthBtn({
        label: 'Копировать',
        variant: 'secondary',
        onClick: function () {
          navigator.clipboard.writeText(webhookUrl).then(function () {
            M.Toast({ message: 'Скопировано', type: 'success' });
          });
        },
      }));
      whBody.appendChild(whBtnWrap);
      container.appendChild(whSection.wrap);

      // ═══ 3. Тест отправки ═══
      var testSection = makeSection('📤', 'Тест отправки', 2);
      var testBody = testSection.body;
      var testBtnWrap = el('div', { style: { padding: '12px 16px' } });
      testBtnWrap.appendChild(M.FullWidthBtn({
        label: 'Отправить тестовое сообщение',
        onClick: function () {
          M.Toast({ message: 'Отправка...', type: 'info' });
          API.fetch('/settings/telegram', {
            method: 'PUT',
            body: { action: 'test' },
          }).then(function () {
            M.Toast({ message: 'Тестовое сообщение отправлено', type: 'success' });
          }).catch(function () {
            M.Toast({ message: 'Ошибка отправки', type: 'error' });
          });
        },
      }));
      testBody.appendChild(testBtnWrap);
      container.appendChild(testSection.wrap);

      // ═══ 4. Шаблоны сообщений ═══
      var tplSection = makeSection('📝', 'Шаблоны сообщений', 3);
      var tplBody = tplSection.body;

      var templates = [
        { key: 'tender_new', name: 'Новый тендер' },
        { key: 'tender_handoff', name: 'Передача на просчёт' },
        { key: 'bonus_request', name: 'Запрос премии' },
        { key: 'permit_expiring', name: 'Истекает разрешение' },
        { key: 'seal_transfer', name: 'Передача печати' },
        { key: 'contract_expiring', name: 'Истекает договор' },
        { key: 'bank_income', name: 'Поступление на счёт' },
      ];

      templates.forEach(function (tpl, i) {
        var row = el('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: i < templates.length - 1 ? '1px solid ' + t.border : 'none',
            cursor: 'pointer',
          },
        });
        row.appendChild(el('div', { style: { ...DS.font('base'), color: t.text } }, tpl.name));
        row.appendChild(el('span', { style: { ...DS.font('sm'), color: t.textTer } }, '›'));
        row.addEventListener('click', function () {
          openTemplateEditor(tpl, cfg);
        });
        tplBody.appendChild(row);
      });
      container.appendChild(tplSection.wrap);

      // ═══ 5. Привязка пользователей ═══
      var usersSection = makeSection('👥', 'Привязка пользователей', 4);
      var usersBody = usersSection.body;

      if (!userList.length) {
        usersBody.appendChild(M.Empty({ text: 'Нет пользователей', icon: '👤' }));
      } else {
        userList.forEach(function (u, i) {
          var row = el('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderBottom: i < userList.length - 1 ? '1px solid ' + t.border : 'none',
            },
          });
          row.appendChild(M.Avatar({ name: u.name || 'Пользователь', size: 36 }));
          var info = el('div', { style: { flex: 1, minWidth: 0 } });
          info.appendChild(el('div', { style: { ...DS.font('base'), color: t.text } }, u.name || u.login));
          info.appendChild(el('div', { style: { ...DS.font('xs'), color: t.textSec } }, u.login || ''));
          row.appendChild(info);
          row.appendChild(M.Badge({
            text: u.telegram_chat_id ? 'Привязан' : 'Нет',
            color: u.telegram_chat_id ? 'success' : 'neutral',
          }));
          usersBody.appendChild(row);
        });
      }
      container.appendChild(usersSection.wrap);
    }

    // ═══ HELPERS ═══

    function maskToken(token) {
      if (!token) return 'Не задан';
      if (token.length <= 10) return '••••••••';
      return token.substring(0, 5) + '•'.repeat(Math.min(20, token.length - 10)) + token.substring(token.length - 5);
    }

    function makeSection(icon, title, idx) {
      var wrap = el('div', {
        style: {
          margin: '8px 20px 0',
          borderRadius: '16px',
          overflow: 'hidden',
          border: '1px solid ' + t.border,
          background: t.surface,
          ...DS.anim(idx * 0.05),
        },
      });
      var header = el('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '16px',
        },
      });
      header.appendChild(el('span', { style: { fontSize: '18px' } }, icon));
      header.appendChild(el('div', { style: { ...DS.font('md'), color: t.text } }, title));
      wrap.appendChild(header);
      var body = el('div', { style: { borderTop: '1px solid ' + t.border } });
      wrap.appendChild(body);
      return { wrap: wrap, body: body };
    }

    function openEditToken(cfg) {
      var content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'bot_token', label: 'Токен бота', value: cfg.bot_token || '' },
        ],
        submitLabel: 'Сохранить',
        onSubmit: function (data) {
          API.fetch('/settings/telegram', {
            method: 'PUT',
            body: { bot_token: data.bot_token },
          }).then(function () {
            cfg.bot_token = data.bot_token;
            M.Toast({ message: 'Токен сохранён', type: 'success' });
            Router.navigate('/telegram', { replace: true });
          }).catch(function () {
            M.Toast({ message: 'Ошибка сохранения', type: 'error' });
          });
        },
      }));
      M.BottomSheet({ title: 'Изменить токен', content: content });
    }

    function openTemplateEditor(tpl, cfg) {
      var templates = cfg.templates || {};
      var current = templates[tpl.key] || '';
      var content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'template', label: tpl.name, type: 'textarea', value: current },
        ],
        submitLabel: 'Сохранить шаблон',
        onSubmit: function (data) {
          templates[tpl.key] = data.template;
          API.fetch('/settings/telegram', {
            method: 'PUT',
            body: { templates: templates },
          }).then(function () {
            M.Toast({ message: 'Шаблон сохранён', type: 'success' });
          }).catch(function () {
            M.Toast({ message: 'Ошибка сохранения', type: 'error' });
          });
        },
      }));
      M.BottomSheet({ title: 'Шаблон: ' + tpl.name, content: content });
    }

    return page;
  },
};

Router.register('/telegram', TelegramPage);
