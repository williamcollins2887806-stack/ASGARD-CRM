/**
 * АСГАРД CRM — Mail Settings (Фаза 8)
 * Страница настроек почты: аккаунты, правила, шаблоны, лог синхронизации
 * Доступ: ADMIN, DIRECTOR_GEN
 *
 * Зависимости: AsgardUI, AsgardAuth
 */
window.AsgardMailSettingsPage = (function(){
  const { $, $$, esc, toast, formatDate } = AsgardUI;

  const SETTINGS_ROLES = ['ADMIN', 'DIRECTOR_GEN'];

  let activeTab = 'accounts';
  let accounts = [];
  let rules = [];
  let tplList = [];
  let syncLogs = [];

  // ═══════════════════════════════════════════════════════════════════
  // API
  // ═══════════════════════════════════════════════════════════════════
  async function apiFetch(url, options = {}) {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + (auth?.token || '') };
    if (options.body) headers['Content-Type'] = 'application/json';
    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Ошибка' }));
      throw new Error(err.error || 'Ошибка');
    }
    return resp.json();
  }

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  async function render({ layout }) {
    layout.innerHTML = `
    <div style="max-width:1100px; margin:0 auto; padding:20px;">
      <h1 style="color:var(--text-main); font-size:22px; margin:0 0 16px;">Настройки почты</h1>

      <!-- Tabs -->
      <div style="display:flex; gap:4px; border-bottom:2px solid var(--border); margin-bottom:16px;">
        <button class="ms-tab" data-tab="accounts" style="${tabStyle('accounts')}">Аккаунты</button>
        <button class="ms-tab" data-tab="rules" style="${tabStyle('rules')}">Классификация</button>
        <button class="ms-tab" data-tab="templates" style="${tabStyle('templates')}">Шаблоны</button>
        <button class="ms-tab" data-tab="sync" style="${tabStyle('sync')}">Лог синхронизации</button>
      </div>

      <div id="ms-content"></div>
    </div>`;

    layout.querySelectorAll('.ms-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        layout.querySelectorAll('.ms-tab').forEach(b => b.style.cssText = tabStyle(b.dataset.tab));
        renderTab();
      });
    });

    await renderTab();
  }

  function tabStyle(tab) {
    const active = activeTab === tab;
    return `padding:8px 16px; border:none; border-bottom:2px solid ${active ? 'var(--primary)' : 'transparent'}; background:transparent; color:${active ? 'var(--primary)' : 'var(--text-muted)'}; cursor:pointer; font-size:13px; font-weight:${active ? '600' : '400'}; margin-bottom:-2px;`;
  }

  async function renderTab() {
    const content = $('#ms-content');
    if (!content) return;

    content.innerHTML = '<div style="padding:20px; color:var(--text-muted);">Загрузка...</div>';

    try {
      switch (activeTab) {
        case 'accounts': await renderAccounts(content); break;
        case 'rules': await renderRules(content); break;
        case 'templates': await renderTemplates(content); break;
        case 'sync': await renderSyncLog(content); break;
      }
    } catch (e) {
      content.innerHTML = `<div style="padding:20px; color:var(--red);">${esc(e.message)}</div>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ACCOUNTS TAB
  // ═══════════════════════════════════════════════════════════════════
  async function renderAccounts(container) {
    const data = await apiFetch('/api/mailbox/accounts');
    accounts = data.accounts || [];

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <span style="color:var(--text-muted); font-size:13px;">${accounts.length} аккаунтов</span>
        <button id="ms-add-account" style="padding:6px 16px; background:var(--primary); color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:13px;">+ Добавить аккаунт</button>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${accounts.map(a => `
          <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:8px; padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <div>
                <strong style="color:var(--text-main);">${esc(a.name)}</strong>
                <span style="color:var(--text-muted); font-size:12px; margin-left:8px;">${esc(a.email_address)}</span>
                ${a.is_active ? '<span style="color:var(--green); font-size:11px; margin-left:8px;">Активен</span>' : '<span style="color:var(--red); font-size:11px; margin-left:8px;">Неактивен</span>'}
              </div>
              <div style="display:flex; gap:4px;">
                <button class="ms-sync-btn" data-id="${a.id}" style="padding:4px 10px; border-radius:4px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-main); cursor:pointer; font-size:12px;">Синхронизировать</button>
                <button class="ms-edit-acc-btn" data-id="${a.id}" style="padding:4px 10px; border-radius:4px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-main); cursor:pointer; font-size:12px;">Редактировать</button>
                <button class="ms-del-acc-btn" data-id="${a.id}" style="padding:4px 10px; border-radius:4px; border:1px solid var(--border); background:var(--bg-deep); color:var(--red); cursor:pointer; font-size:12px;">Удалить</button>
              </div>
            </div>
            <div style="display:flex; gap:24px; font-size:12px; color:var(--text-muted);">
              <span>IMAP: ${esc(a.imap_host || 'не настроен')}:${a.imap_port || ''}</span>
              <span>SMTP: ${esc(a.smtp_host || 'не настроен')}:${a.smtp_port || ''}</span>
              <span>Интервал: ${a.sync_interval_sec || 120}с</span>
              <span>Последняя синхр.: ${a.last_sync_at ? new Date(a.last_sync_at).toLocaleString('ru-RU') : 'никогда'}</span>
            </div>
            ${a.last_sync_error ? `<div style="color:var(--red); font-size:11px; margin-top:4px;">Ошибка: ${esc(a.last_sync_error)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;

    container.querySelector('#ms-add-account')?.addEventListener('click', () => openAccountModal());
    container.querySelectorAll('.ms-edit-acc-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const acc = accounts.find(a => a.id === parseInt(btn.dataset.id));
        if (acc) openAccountModal(acc);
      });
    });
    container.querySelectorAll('.ms-sync-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Синхронизация...';
        try {
          const result = await apiFetch(`/api/mailbox/accounts/${btn.dataset.id}/sync`, { method: 'POST' });
          toast(`Синхронизация: ${result.newCount || 0} новых`);
          renderTab();
        } catch (e) { toast(e.message, 'error'); }
        finally { btn.disabled = false; btn.textContent = 'Синхронизировать'; }
      });
    });
    container.querySelectorAll('.ms-del-acc-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Деактивировать аккаунт?')) return;
        try {
          await apiFetch(`/api/mailbox/accounts/${btn.dataset.id}`, { method: 'DELETE' });
          toast('Аккаунт деактивирован');
          renderTab();
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  }

  function openAccountModal(existing = null) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9100;display:flex;align-items:center;justify-content:center;';

    const a = existing || {};
    overlay.innerHTML = `
    <div style="width:600px;max-width:95vw;max-height:85vh;background:var(--bg-card);border-radius:12px;border:1px solid var(--border);overflow-y:auto;">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;">
        <h3 style="margin:0;color:var(--text-main);">${existing ? 'Редактирование аккаунта' : 'Новый аккаунт'}</h3>
        <button class="modal-close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:20px;">&times;</button>
      </div>
      <div style="padding:20px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label style="font-size:12px;color:var(--text-muted);">Название *</label>
            <input id="acc-name" value="${esc(a.name || '')}" style="${inputStyle()}">
          </div>
          <div style="flex:1;">
            <label style="font-size:12px;color:var(--text-muted);">Email *</label>
            <input id="acc-email" value="${esc(a.email_address || '')}" style="${inputStyle()}">
          </div>
        </div>

        <div style="font-size:13px;color:var(--text-main);font-weight:600;margin-top:8px;">IMAP (получение)</div>
        <div style="display:flex;gap:8px;">
          <div style="flex:2;"><label style="font-size:12px;color:var(--text-muted);">Хост</label><input id="acc-imap-host" value="${esc(a.imap_host || '')}" style="${inputStyle()}"></div>
          <div style="flex:1;"><label style="font-size:12px;color:var(--text-muted);">Порт</label><input id="acc-imap-port" type="number" value="${a.imap_port || 993}" style="${inputStyle()}"></div>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;"><label style="font-size:12px;color:var(--text-muted);">Пользователь</label><input id="acc-imap-user" value="${esc(a.imap_user || '')}" style="${inputStyle()}"></div>
          <div style="flex:1;"><label style="font-size:12px;color:var(--text-muted);">Пароль</label><input id="acc-imap-pass" type="password" placeholder="${existing ? '(оставьте пустым)' : ''}" style="${inputStyle()}"></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <label style="font-size:12px;color:var(--text-muted);">Папка:</label>
          <input id="acc-imap-folder" value="${esc(a.imap_folder || 'INBOX')}" style="${inputStyle()};width:140px;">
          <label style="font-size:12px;color:var(--text-main);cursor:pointer;"><input type="checkbox" id="acc-imap-tls" ${a.imap_tls !== false ? 'checked' : ''}> TLS</label>
          <button id="acc-test-imap" style="padding:4px 12px;border-radius:4px;border:1px solid var(--border);background:var(--bg-deep);color:var(--text-main);cursor:pointer;font-size:12px;">Тест IMAP</button>
        </div>

        <div style="font-size:13px;color:var(--text-main);font-weight:600;margin-top:8px;">SMTP (отправка)</div>
        <div style="display:flex;gap:8px;">
          <div style="flex:2;"><label style="font-size:12px;color:var(--text-muted);">Хост</label><input id="acc-smtp-host" value="${esc(a.smtp_host || '')}" style="${inputStyle()}"></div>
          <div style="flex:1;"><label style="font-size:12px;color:var(--text-muted);">Порт</label><input id="acc-smtp-port" type="number" value="${a.smtp_port || 587}" style="${inputStyle()}"></div>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;"><label style="font-size:12px;color:var(--text-muted);">Пользователь</label><input id="acc-smtp-user" value="${esc(a.smtp_user || '')}" style="${inputStyle()}"></div>
          <div style="flex:1;"><label style="font-size:12px;color:var(--text-muted);">Пароль</label><input id="acc-smtp-pass" type="password" placeholder="${existing ? '(оставьте пустым)' : ''}" style="${inputStyle()}"></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <label style="font-size:12px;color:var(--text-muted);">Имя отправителя:</label>
          <input id="acc-smtp-from-name" value="${esc(a.smtp_from_name || 'ООО «Асгард Сервис»')}" style="${inputStyle()};flex:1;">
          <label style="font-size:12px;color:var(--text-main);cursor:pointer;"><input type="checkbox" id="acc-smtp-tls" ${a.smtp_tls !== false ? 'checked' : ''}> TLS</label>
          <button id="acc-test-smtp" style="padding:4px 12px;border-radius:4px;border:1px solid var(--border);background:var(--bg-deep);color:var(--text-main);cursor:pointer;font-size:12px;">Тест SMTP</button>
        </div>

        <div style="font-size:13px;color:var(--text-main);font-weight:600;margin-top:8px;">Синхронизация</div>
        <div style="display:flex;gap:12px;align-items:center;">
          <label style="font-size:12px;color:var(--text-main);cursor:pointer;"><input type="checkbox" id="acc-sync-enabled" ${a.sync_enabled !== false ? 'checked' : ''}> Включена</label>
          <label style="font-size:12px;color:var(--text-muted);">Интервал (сек):</label>
          <input id="acc-sync-interval" type="number" value="${a.sync_interval_sec || 120}" style="${inputStyle()};width:80px;">
          <label style="font-size:12px;color:var(--text-muted);">Макс. писем:</label>
          <input id="acc-sync-max" type="number" value="${a.sync_max_emails || 200}" style="${inputStyle()};width:80px;">
        </div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;">
        <button class="modal-close" style="padding:8px 16px;border-radius:6px;border:1px solid var(--border);background:var(--bg-deep);color:var(--text-main);cursor:pointer;">Отмена</button>
        <button id="acc-save" style="padding:8px 20px;border-radius:6px;border:none;background:var(--primary);color:#fff;cursor:pointer;font-weight:600;">Сохранить</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);

    overlay.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Test IMAP
    overlay.querySelector('#acc-test-imap')?.addEventListener('click', async () => {
      try {
        const result = await apiFetch('/api/mailbox/accounts/test-imap', {
          method: 'POST',
          body: {
            imap_host: $('#acc-imap-host')?.value,
            imap_port: parseInt($('#acc-imap-port')?.value || '993'),
            imap_user: $('#acc-imap-user')?.value,
            imap_pass: $('#acc-imap-pass')?.value,
            imap_tls: $('#acc-imap-tls')?.checked,
            imap_folder: $('#acc-imap-folder')?.value || 'INBOX'
          }
        });
        if (result.success) toast(`IMAP OK: ${result.messages} писем, ${result.unseen} непрочитанных`);
        else toast('IMAP ошибка: ' + result.error, 'error');
      } catch (e) { toast(e.message, 'error'); }
    });

    // Test SMTP
    overlay.querySelector('#acc-test-smtp')?.addEventListener('click', async () => {
      try {
        const result = await apiFetch('/api/mailbox/accounts/test-smtp', {
          method: 'POST',
          body: {
            smtp_host: $('#acc-smtp-host')?.value,
            smtp_port: parseInt($('#acc-smtp-port')?.value || '587'),
            smtp_user: $('#acc-smtp-user')?.value,
            smtp_pass: $('#acc-smtp-pass')?.value,
            smtp_tls: $('#acc-smtp-tls')?.checked
          }
        });
        if (result.success) toast('SMTP подключение успешно');
        else toast('SMTP ошибка: ' + result.error, 'error');
      } catch (e) { toast(e.message, 'error'); }
    });

    // Save
    overlay.querySelector('#acc-save')?.addEventListener('click', async () => {
      const body = {
        name: $('#acc-name')?.value,
        email_address: $('#acc-email')?.value,
        imap_host: $('#acc-imap-host')?.value,
        imap_port: parseInt($('#acc-imap-port')?.value || '993'),
        imap_user: $('#acc-imap-user')?.value,
        imap_tls: $('#acc-imap-tls')?.checked,
        imap_folder: $('#acc-imap-folder')?.value || 'INBOX',
        smtp_host: $('#acc-smtp-host')?.value,
        smtp_port: parseInt($('#acc-smtp-port')?.value || '587'),
        smtp_user: $('#acc-smtp-user')?.value,
        smtp_tls: $('#acc-smtp-tls')?.checked,
        smtp_from_name: $('#acc-smtp-from-name')?.value,
        sync_enabled: $('#acc-sync-enabled')?.checked,
        sync_interval_sec: parseInt($('#acc-sync-interval')?.value || '120'),
        sync_max_emails: parseInt($('#acc-sync-max')?.value || '200')
      };

      const imapPass = $('#acc-imap-pass')?.value;
      const smtpPass = $('#acc-smtp-pass')?.value;
      if (imapPass) body.imap_pass = imapPass;
      if (smtpPass) body.smtp_pass = smtpPass;

      if (!body.name || !body.email_address) {
        toast('Заполните название и email', 'error');
        return;
      }

      try {
        if (existing) {
          await apiFetch(`/api/mailbox/accounts/${existing.id}`, { method: 'PUT', body });
        } else {
          await apiFetch('/api/mailbox/accounts', { method: 'POST', body });
        }
        toast('Аккаунт сохранён');
        overlay.remove();
        renderTab();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // RULES TAB
  // ═══════════════════════════════════════════════════════════════════
  async function renderRules(container) {
    const data = await apiFetch('/api/mailbox/classification-rules');
    rules = data.rules || [];

    const RULE_TYPES = { domain: 'Домен', keyword_subject: 'Ключ.слово (тема)', keyword_body: 'Ключ.слово (тело)', header: 'Заголовок', from_pattern: 'От кого', combined: 'Комбинированное' };
    const CLASS_COLORS = { direct_request: '#22c55e', platform_tender: '#eab308', newsletter: '#94a3b8', internal: '#3b82f6', spam: '#ef4444' };

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="color:var(--text-muted);font-size:13px;">${rules.length} правил</span>
        <div style="display:flex;gap:8px;">
          <button id="ms-test-classify" style="padding:6px 16px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-main);cursor:pointer;font-size:13px;">Тестировать</button>
          <button id="ms-add-rule" style="padding:6px 16px;background:var(--primary);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">+ Правило</button>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="border-bottom:2px solid var(--border);">
          <th style="text-align:left;padding:8px;color:var(--text-muted);">Тип</th>
          <th style="text-align:left;padding:8px;color:var(--text-muted);">Паттерн</th>
          <th style="text-align:left;padding:8px;color:var(--text-muted);">Режим</th>
          <th style="text-align:left;padding:8px;color:var(--text-muted);">Классификация</th>
          <th style="text-align:center;padding:8px;color:var(--text-muted);">Уверен.</th>
          <th style="text-align:center;padding:8px;color:var(--text-muted);">Приор.</th>
          <th style="text-align:center;padding:8px;color:var(--text-muted);">Совпад.</th>
          <th style="text-align:center;padding:8px;color:var(--text-muted);">Акт.</th>
          <th style="text-align:right;padding:8px;color:var(--text-muted);">Действия</th>
        </tr></thead>
        <tbody>
          ${rules.map(r => `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:6px 8px;color:var(--text-main);">${RULE_TYPES[r.rule_type] || r.rule_type}</td>
            <td style="padding:6px 8px;color:var(--text-main);max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${esc(r.pattern)}">${esc(r.pattern)}</td>
            <td style="padding:6px 8px;color:var(--text-muted);">${r.match_mode}</td>
            <td style="padding:6px 8px;"><span style="color:${CLASS_COLORS[r.classification] || '#64748b'};font-weight:600;">${r.classification}</span></td>
            <td style="padding:6px 8px;text-align:center;color:var(--text-main);">${r.confidence}%</td>
            <td style="padding:6px 8px;text-align:center;color:var(--text-main);">${r.priority}</td>
            <td style="padding:6px 8px;text-align:center;color:var(--text-muted);">${r.times_matched || 0}</td>
            <td style="padding:6px 8px;text-align:center;">${r.is_active ? '<span style="color:var(--green);">Да</span>' : '<span style="color:var(--red);">Нет</span>'}</td>
            <td style="padding:6px 8px;text-align:right;">
              <button class="ms-del-rule" data-id="${r.id}" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-deep);color:var(--red);cursor:pointer;font-size:11px;">Удалить</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;

    container.querySelector('#ms-add-rule')?.addEventListener('click', () => openRuleModal());
    container.querySelector('#ms-test-classify')?.addEventListener('click', openTestClassifyModal);
    container.querySelectorAll('.ms-del-rule').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить правило?')) return;
        try {
          await apiFetch(`/api/mailbox/classification-rules/${btn.dataset.id}`, { method: 'DELETE' });
          toast('Правило удалено');
          renderTab();
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  }

  function openRuleModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9100;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
    <div style="width:480px;max-width:95vw;background:var(--bg-card);border-radius:12px;border:1px solid var(--border);">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;">
        <h3 style="margin:0;color:var(--text-main);">Новое правило</h3>
        <button class="modal-close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:20px;">&times;</button>
      </div>
      <div style="padding:20px;display:flex;flex-direction:column;gap:10px;">
        <div>
          <label style="font-size:12px;color:var(--text-muted);">Тип правила</label>
          <select id="rule-type" style="${inputStyle()}">
            <option value="domain">Домен</option>
            <option value="keyword_subject">Ключевое слово (тема)</option>
            <option value="keyword_body">Ключевое слово (тело)</option>
            <option value="header">Заголовок</option>
            <option value="from_pattern">От кого</option>
            <option value="combined">Комбинированное</option>
          </select>
        </div>
        <div><label style="font-size:12px;color:var(--text-muted);">Паттерн *</label><input id="rule-pattern" style="${inputStyle()}"></div>
        <div>
          <label style="font-size:12px;color:var(--text-muted);">Режим</label>
          <select id="rule-match" style="${inputStyle()}">
            <option value="contains">Содержит</option>
            <option value="exact">Точное совпадение</option>
            <option value="starts_with">Начинается с</option>
            <option value="ends_with">Заканчивается на</option>
            <option value="regex">Regex</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-muted);">Классификация *</label>
          <select id="rule-class" style="${inputStyle()}">
            <option value="direct_request">Прямой запрос</option>
            <option value="platform_tender">Тендерная площадка</option>
            <option value="newsletter">Рассылка</option>
            <option value="internal">Внутренняя</option>
            <option value="spam">Спам</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;"><label style="font-size:12px;color:var(--text-muted);">Уверенность (%)</label><input id="rule-conf" type="number" value="80" min="0" max="100" style="${inputStyle()}"></div>
          <div style="flex:1;"><label style="font-size:12px;color:var(--text-muted);">Приоритет</label><input id="rule-prio" type="number" value="50" style="${inputStyle()}"></div>
        </div>
        <div><label style="font-size:12px;color:var(--text-muted);">Описание</label><input id="rule-desc" style="${inputStyle()}"></div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;">
        <button class="modal-close" style="padding:8px 16px;border-radius:6px;border:1px solid var(--border);background:var(--bg-deep);color:var(--text-main);cursor:pointer;">Отмена</button>
        <button id="rule-save" style="padding:8px 20px;border-radius:6px;border:none;background:var(--primary);color:#fff;cursor:pointer;font-weight:600;">Создать</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#rule-save')?.addEventListener('click', async () => {
      const pattern = $('#rule-pattern')?.value;
      if (!pattern) { toast('Укажите паттерн', 'error'); return; }
      try {
        await apiFetch('/api/mailbox/classification-rules', {
          method: 'POST',
          body: {
            rule_type: $('#rule-type')?.value,
            pattern,
            match_mode: $('#rule-match')?.value,
            classification: $('#rule-class')?.value,
            confidence: parseInt($('#rule-conf')?.value || '80'),
            priority: parseInt($('#rule-prio')?.value || '50'),
            description: $('#rule-desc')?.value || ''
          }
        });
        toast('Правило создано');
        overlay.remove();
        renderTab();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  function openTestClassifyModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9100;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
    <div style="width:480px;max-width:95vw;background:var(--bg-card);border-radius:12px;border:1px solid var(--border);">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;">
        <h3 style="margin:0;color:var(--text-main);">Тест классификации</h3>
        <button class="modal-close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:20px;">&times;</button>
      </div>
      <div style="padding:20px;display:flex;flex-direction:column;gap:10px;">
        <div><label style="font-size:12px;color:var(--text-muted);">Email отправителя</label><input id="tc-from" placeholder="test@zakupki.gov.ru" style="${inputStyle()}"></div>
        <div><label style="font-size:12px;color:var(--text-muted);">Тема</label><input id="tc-subject" placeholder="Запрос котировок" style="${inputStyle()}"></div>
        <div><label style="font-size:12px;color:var(--text-muted);">Текст</label><textarea id="tc-body" rows="3" style="${inputStyle()};resize:vertical;"></textarea></div>
        <div id="tc-result" style="display:none; padding:10px; background:var(--bg-deep); border-radius:6px;"></div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;">
        <button class="modal-close" style="padding:8px 16px;border-radius:6px;border:1px solid var(--border);background:var(--bg-deep);color:var(--text-main);cursor:pointer;">Закрыть</button>
        <button id="tc-run" style="padding:8px 20px;border-radius:6px;border:none;background:var(--secondary);color:#fff;cursor:pointer;font-weight:600;">Проверить</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#tc-run')?.addEventListener('click', async () => {
      try {
        const result = await apiFetch('/api/mailbox/classification-rules/test', {
          method: 'POST',
          body: {
            from_email: $('#tc-from')?.value || '',
            subject: $('#tc-subject')?.value || '',
            body_text: $('#tc-body')?.value || ''
          }
        });
        const resDiv = $('#tc-result');
        if (resDiv) {
          resDiv.style.display = 'block';
          resDiv.innerHTML = `<strong style="color:var(--text-main);">Результат:</strong> <span style="font-weight:600;">${result.type}</span> (уверенность: ${result.confidence}%, правило: ${result.rule_id || 'нет'})`;
        }
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // TEMPLATES TAB
  // ═══════════════════════════════════════════════════════════════════
  async function renderTemplates(container) {
    const data = await apiFetch('/api/mailbox/templates');
    tplList = data.templates || [];

    const CAT_LABELS = { document: 'Документы', tender: 'Тендеры', notification: 'Уведомления', finance: 'Финансы', hr: 'HR', custom: 'Другое' };

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="color:var(--text-muted);font-size:13px;">${tplList.length} шаблонов</span>
        <button id="ms-add-tpl" style="padding:6px 16px;background:var(--primary);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">+ Шаблон</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${tplList.map(t => `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong style="color:var(--text-main);font-size:13px;">${esc(t.name)}</strong>
              <span style="font-size:11px;color:var(--text-muted);margin-left:8px;">[${esc(t.code)}]</span>
              <span style="font-size:11px;color:var(--text-muted);margin-left:8px;">${CAT_LABELS[t.category] || t.category}</span>
              ${t.use_letterhead ? '<span style="font-size:10px;color:var(--primary);margin-left:8px;">Бланк</span>' : ''}
              ${t.is_system ? '<span style="font-size:10px;color:var(--blue);margin-left:4px;">Системный</span>' : ''}
            </div>
            <button class="ms-del-tpl" data-id="${t.id}" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-deep);color:var(--red);cursor:pointer;font-size:11px;">Удалить</button>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelector('#ms-add-tpl')?.addEventListener('click', () => {
      toast('Добавление шаблонов через API: POST /api/mailbox/templates', 'info');
    });
    container.querySelectorAll('.ms-del-tpl').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Деактивировать шаблон?')) return;
        try {
          await apiFetch(`/api/mailbox/templates/${btn.dataset.id}`, { method: 'DELETE' });
          toast('Шаблон деактивирован');
          renderTab();
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // SYNC LOG TAB
  // ═══════════════════════════════════════════════════════════════════
  async function renderSyncLog(container) {
    const data = await apiFetch('/api/mailbox/sync-log?limit=100');
    syncLogs = data.logs || [];

    const statusColors = { running: 'var(--amber)', success: 'var(--green)', error: 'var(--red)', partial: '#f59e0b' };

    container.innerHTML = `
      <div style="margin-bottom:12px;color:var(--text-muted);font-size:13px;">${syncLogs.length} записей</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="border-bottom:2px solid var(--border);">
          <th style="text-align:left;padding:8px;color:var(--text-muted);">Дата</th>
          <th style="text-align:left;padding:8px;color:var(--text-muted);">Аккаунт</th>
          <th style="text-align:left;padding:8px;color:var(--text-muted);">Тип</th>
          <th style="text-align:center;padding:8px;color:var(--text-muted);">Статус</th>
          <th style="text-align:center;padding:8px;color:var(--text-muted);">Получено</th>
          <th style="text-align:center;padding:8px;color:var(--text-muted);">Новых</th>
          <th style="text-align:center;padding:8px;color:var(--text-muted);">Ошибок</th>
          <th style="text-align:right;padding:8px;color:var(--text-muted);">Время (мс)</th>
        </tr></thead>
        <tbody>
          ${syncLogs.map(l => `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:6px 8px;color:var(--text-main);">${l.started_at ? new Date(l.started_at).toLocaleString('ru-RU') : ''}</td>
            <td style="padding:6px 8px;color:var(--text-main);">${esc(l.account_name || '')} <span style="color:var(--text-muted);font-size:11px;">${esc(l.email_address || '')}</span></td>
            <td style="padding:6px 8px;color:var(--text-muted);">${l.sync_type}</td>
            <td style="padding:6px 8px;text-align:center;"><span style="color:${statusColors[l.status] || 'var(--text-muted)'}; font-weight:600;">${l.status}</span></td>
            <td style="padding:6px 8px;text-align:center;color:var(--text-main);">${l.emails_fetched || 0}</td>
            <td style="padding:6px 8px;text-align:center;color:var(--green);">${l.emails_new || 0}</td>
            <td style="padding:6px 8px;text-align:center;color:${(l.errors_count || 0) > 0 ? 'var(--red)' : 'var(--text-muted)'};">${l.errors_count || 0}</td>
            <td style="padding:6px 8px;text-align:right;color:var(--text-muted);">${l.duration_ms || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════
  function inputStyle() {
    return 'width:100%;padding:6px 10px;background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;color:var(--text-main);font-size:13px;';
  }

  return { render };
})();
