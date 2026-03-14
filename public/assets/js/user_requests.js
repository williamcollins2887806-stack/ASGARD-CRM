// Stage 18b + Mail: Управление пользователями + Управление почтой
// Создание, блокировка, сброс пароля, привязка/создание почты

window.AsgardUserRequestsPage = (function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;

  const ROLES_LIST = [
    { key: 'TO', label: 'TO — Тендерный отдел' },
    { key: 'PM', label: 'PM — Руководитель проекта' },
    { key: 'HR', label: 'HR — Персонал + PM' },
    { key: 'BUH', label: 'BUH — Бухгалтерия' },
    { key: 'OFFICE_MANAGER', label: 'OFFICE_MANAGER — Офис-менеджер' },
    { key: 'WAREHOUSE', label: 'WAREHOUSE — Кладовщик' },
    { key: 'PROC', label: 'PROC — Закупки' },
    { key: 'DIRECTOR_COMM', label: 'DIRECTOR_COMM — Коммерческий директор' },
    { key: 'DIRECTOR_GEN', label: 'DIRECTOR_GEN — Генеральный директор' },
    { key: 'DIRECTOR_DEV', label: 'DIRECTOR_DEV — Директор разработки + PM' },
    { key: 'HEAD_TO', label: 'HEAD_TO — Рук. тендерного отдела' },
    { key: 'HEAD_PM', label: 'HEAD_PM — Рук. технического отдела' },
    { key: 'CHIEF_ENGINEER', label: 'CHIEF_ENGINEER — Главный инженер' },
    { key: 'HR_MANAGER', label: 'HR_MANAGER — HR-менеджер' }
  ];

  function today(){ return new Date().toISOString().slice(0,10); }

  function timeAgo(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'только что';
    if (diff < 3600) return Math.floor(diff / 60) + ' мин назад';
    if (diff < 86400) return Math.floor(diff / 3600) + ' ч назад';
    if (diff < 604800) return Math.floor(diff / 86400) + ' дн назад';
    return d.toLocaleDateString('ru-RU');
  }

  function authHeaders() {
    const a = AsgardAuth.getAuth();
    return { 'Authorization': 'Bearer ' + (a?.token || ''), 'Content-Type': 'application/json' };
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash = "#/login"; return; }
    const user = auth.user;

    const allowed = ["ADMIN", "DIRECTOR_COMM", "DIRECTOR_GEN", "DIRECTOR_DEV", "DIRECTOR"];
    if(!allowed.includes(user.role)){
      toast("Доступ", "Только для директоров", "err");
      location.hash = "#/home";
      return;
    }

    const isAdmin = user.role === "ADMIN";
    const canManageMail = ["ADMIN", "DIRECTOR_GEN"].includes(user.role);

    let allUsers = [];
    async function loadUsers() {
      const resp = await fetch('/api/users', { headers: authHeaders() });
      allUsers = (await resp.json()).users || [];
    }
    await loadUsers();

    function renderPage(){
      const active = allUsers.filter(u => u.is_active && !u.is_blocked);
      const blocked = allUsers.filter(u => u.is_blocked);

      const body = `
        <style>
          .ur-header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px; }
          .ur-tabs { display:flex; gap:8px; margin-bottom:20px; }
          .ur-tab { padding:10px 18px; border-radius:6px; background:rgba(13,20,40,.4); border:1px solid rgba(148,163,184,.15); color:var(--muted); font-weight:700; cursor:pointer; transition: all .2s ease; }
          .ur-tab:hover { border-color:rgba(242,208,138,.3); }
          .ur-tab.active { background:linear-gradient(135deg, rgba(242,208,138,.2), rgba(242,208,138,.1)); border-color:rgba(242,208,138,.4); color:var(--gold); }
          .ur-tab .count { display:inline-flex; align-items:center; justify-content:center; min-width:20px; height:20px; margin-left:8px; padding:0 6px; background:rgba(59,130,246,.6); color:#fff; border-radius:999px; font-size:11px; font-weight:900; }
          .ur-tab.active .count { background:var(--gold); color:#000; }
          .ur-tab .count.red { background:rgba(239,68,68,.8); }
          .ur-list { display:grid; gap:12px; }
          .ur-card { background: linear-gradient(135deg, rgba(13,20,40,.6), rgba(13,20,40,.4)); border:1px solid rgba(148,163,184,.15); border-radius:6px; padding:16px 20px; display:grid; grid-template-columns:1fr auto; gap:16px; align-items:start; transition: all .3s ease; }
          .ur-card:hover { border-color:rgba(242,208,138,.25); }
          .ur-card.blocked { opacity:.6; border-color:rgba(239,68,68,.3); }
          .ur-info h3 { margin:0 0 6px; font-size:16px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
          .ur-role { font-size:10px; padding:3px 8px; border-radius:6px; background:rgba(59,130,246,.2); color:var(--info-t); font-weight:800; }
          .ur-role.admin { background:rgba(239,68,68,.2); color:var(--err-t); }
          .ur-role.director { background:rgba(242,208,138,.2); color:var(--gold); }
          .ur-meta { display:flex; flex-wrap:wrap; gap:12px; color:var(--muted); font-size:12px; }
          .ur-meta span { display:flex; align-items:center; gap:4px; }
          .ur-actions { display:flex; gap:8px; flex-wrap:wrap; }
          .ur-actions .btn { padding:8px 12px; font-size:12px; }
          .ur-empty { text-align:center; padding:60px 20px; background:rgba(13,20,40,.3); border:1px dashed rgba(148,163,184,.2); border-radius:6px; color:var(--muted); }
          .ur-empty-icon { font-size:64px; margin-bottom:16px; opacity:.5; }
          .ur-search { display:flex; gap:12px; margin-bottom:16px; padding:12px; background:rgba(13,20,40,.3); border-radius:6px; align-items:center; }
          .ur-search input { flex:1; padding:10px 14px; border-radius:6px; border:1px solid rgba(148,163,184,.15); background:rgba(13,20,40,.5); color:var(--text); font-size:14px; }

          /* Mail status section */
          .ur-mail { display:flex; align-items:center; gap:8px; margin-top:10px; padding:10px 12px; border-radius:6px; background:rgba(13,20,40,.5); border:1px solid rgba(148,163,184,.1); flex-wrap:wrap; font-size:13px; }
          .ur-mail-icon { font-size:16px; flex-shrink:0; }
          .ur-mail-addr { color:var(--text); font-weight:600; font-family:var(--mono); font-size:12px; }
          .ur-mail-badge { display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:800; }
          .ur-mail-badge.green { background:rgba(34,197,94,.15); color:#22c55e; }
          .ur-mail-badge.red { background:rgba(239,68,68,.15); color:#ef4444; }
          .ur-mail-badge.gray { background:rgba(148,163,184,.15); color:var(--muted); }
          .ur-mail-sync { color:var(--muted); font-size:11px; }
          .ur-mail-error { color:#ef4444; font-size:11px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .ur-mail-none { color:var(--muted); font-style:italic; }
          .ur-mail-actions { display:flex; gap:4px; margin-left:auto; }
          .ur-mail-actions .btn { padding:4px 10px; font-size:11px; }

          /* Bind mail modal */
          .bind-advanced { display:none; margin-top:12px; padding:12px; background:rgba(13,20,40,.3); border-radius:6px; border:1px solid rgba(148,163,184,.1); }
          .bind-advanced.show { display:block; }
          .bind-test-result { margin-top:12px; padding:12px; border-radius:6px; font-size:13px; }
          .bind-test-result.ok { background:rgba(34,197,94,.1); border:1px solid rgba(34,197,94,.3); color:#22c55e; }
          .bind-test-result.err { background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.3); color:#ef4444; }
          .bind-test-result.loading { background:rgba(59,130,246,.1); border:1px solid rgba(59,130,246,.3); color:var(--info-t); }

          .yandex-preview { margin:12px 0; padding:12px; background:rgba(59,130,246,.08); border-radius:6px; border:1px solid rgba(59,130,246,.2); font-family:var(--mono); font-size:14px; color:var(--info-t); text-align:center; }
        </style>

        <div class="panel">
          <div class="ur-header">
            <div>
              <h2 class="page-title" style="margin:0">Управление пользователями</h2>
              <div class="help" style="margin-top:8px">Создание, блокировка, сброс пароля, управление почтой</div>
            </div>
            <button class="btn" id="btnAddUser">+ Создать пользователя</button>
          </div>

          <div class="ur-search">
            <input id="userSearch" placeholder="Поиск по имени или логину..."/>
          </div>

          <div class="ur-tabs">
            <div class="ur-tab active" data-tab="active">Активные <span class="count">${active.length}</span></div>
            <div class="ur-tab" data-tab="blocked">Заблокированные <span class="count red">${blocked.length}</span></div>
          </div>

          <div id="tabActive" class="ur-list">
            ${active.length ? active.map(u => renderUserCard(u, false)).join('') : '<div class="ur-empty"><div class="ur-empty-icon">👥</div><div>Нет активных пользователей</div></div>'}
          </div>

          <div id="tabBlocked" class="ur-list" style="display:none">
            ${blocked.length ? blocked.map(u => renderUserCard(u, true)).join('') : '<div class="ur-empty"><div class="ur-empty-icon">🔓</div><div>Нет заблокированных пользователей</div></div>'}
          </div>
        </div>
      `;

      layout(body, { title: title || "Пользователи" }).then(bindEvents);
    }

    function renderMailSection(u) {
      if (!canManageMail) {
        // Non-admin: just show status
        if (u.mail_address) {
          return `<div class="ur-mail"><span class="ur-mail-icon">📧</span><span class="ur-mail-addr">${esc(u.mail_address)}</span></div>`;
        }
        return '';
      }

      if (!u.email_account_id) {
        // State A: no mail configured
        return `
          <div class="ur-mail">
            <span class="ur-mail-icon">📧</span>
            <span class="ur-mail-none">Почта не настроена</span>
            <div class="ur-mail-actions">
              <button class="btn mini" data-bind-yandex="${u.id}" title="Привязать через Яндекс 360 Admin API (без пароля сотрудника)">Привязать корп.</button>
              <button class="btn mini ghost" data-bind-mail="${u.id}" title="Ввести email и пароль вручную">Вручную</button>
              <button class="btn mini amber" data-create-yandex="${u.id}">Создать ящик</button>
            </div>
          </div>`;
      }

      if (u.mail_sync_error) {
        // State C: mail with error
        return `
          <div class="ur-mail" style="border-color:rgba(239,68,68,.2)">
            <span class="ur-mail-icon">📧</span>
            <span class="ur-mail-addr">${esc(u.mail_address)}</span>
            <span class="ur-mail-badge red">Ошибка</span>
            <span class="ur-mail-error" title="${esc(u.mail_sync_error)}">${esc(u.mail_sync_error)}</span>
            <div class="ur-mail-actions">
              <button class="btn mini" data-mail-test="${u.id}">Проверить</button>
              <button class="btn mini ghost" data-mail-settings="${u.id}">Настройки</button>
              <button class="btn mini ghost" data-disconnect-mail="${u.id}" style="color:var(--red)">Отключить</button>
            </div>
          </div>`;
      }

      // State B: mail active
      const syncAgo = timeAgo(u.mail_last_sync);
      return `
        <div class="ur-mail" style="border-color:rgba(34,197,94,.15)">
          <span class="ur-mail-icon">📧</span>
          <span class="ur-mail-addr">${esc(u.mail_address)}</span>
          <span class="ur-mail-badge green">Активна</span>
          ${syncAgo ? `<span class="ur-mail-sync">Синхр: ${syncAgo}</span>` : ''}
          <div class="ur-mail-actions">
            <button class="btn mini ghost" data-mail-settings="${u.id}">Настройки</button>
            <button class="btn mini ghost" data-disconnect-mail="${u.id}" style="color:var(--red)">Отключить</button>
          </div>
        </div>`;
    }

    function renderUserCard(u, isBlocked){
      const isTargetAdmin = u.role === "ADMIN";
      const isDirector = u.role?.startsWith("DIRECTOR");
      const canBlock = isAdmin || (!isTargetAdmin && !isBlocked);
      const canReset = isAdmin || !isTargetAdmin;
      const roleClass = isTargetAdmin ? 'admin' : (isDirector ? 'director' : '');

      return `
        <div class="ur-card ${isBlocked ? 'blocked' : ''}" data-id="${u.id}">
          <div class="ur-info">
            <h3>
              ${esc(u.name || u.login)}
              <span class="ur-role ${roleClass}">${u.role}</span>
              ${u.must_change_password ? '<span style="color:var(--amber); font-size:11px">Не сменил пароль</span>' : ''}
            </h3>
            <div class="ur-meta">
              <span>👤 ${esc(u.login)}</span>
              <span>📅 ${u.employment_date ? new Date(u.employment_date).toLocaleDateString('ru-RU') : '—'}</span>
              <span>🎂 ${u.birth_date ? new Date(u.birth_date).toLocaleDateString('ru-RU') : '—'}</span>
              ${u.last_login_at ? `<span>🕐 ${new Date(u.last_login_at).toLocaleDateString('ru-RU')}</span>` : '<span style="color:var(--amber)">Не входил</span>'}
              ${isBlocked ? `<span style="color:var(--red)">Заблокирован: ${esc(u.block_reason || '')}</span>` : ''}
            </div>
            ${!isBlocked ? renderMailSection(u) : ''}
          </div>
          <div class="ur-actions">
            ${isBlocked ? `
              <button class="btn" data-unblock="${u.id}">Разблокировать</button>
            ` : `
              <button class="btn ghost" data-edit="${u.id}">Ред.</button>
              ${canReset ? `<button class="btn ghost" data-reset="${u.id}">Сброс пароля</button>` : ''}
              ${canBlock && u.id !== user.id ? `<button class="btn ghost" data-block="${u.id}" style="color:var(--red)">Блок</button>` : ''}
            `}
          </div>
        </div>
      `;
    }

    function bindEvents(){
      // Tabs
      $$('.ur-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          $$('.ur-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const tabName = tab.dataset.tab;
          $('#tabActive').style.display = tabName === 'active' ? 'grid' : 'none';
          $('#tabBlocked').style.display = tabName === 'blocked' ? 'grid' : 'none';
        });
      });

      // Search
      $('#userSearch')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        $$('.ur-card').forEach(card => {
          const text = card.textContent.toLowerCase();
          card.style.display = text.includes(q) ? 'grid' : 'none';
        });
      });

      // Create user
      $('#btnAddUser')?.addEventListener('click', openCreateUserModal);

      // Edit
      $$('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => {
          const u = allUsers.find(x => x.id === Number(btn.dataset.edit));
          if (u) openEditUserModal(u);
        });
      });

      // Reset password
      $$('[data-reset]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = Number(btn.dataset.reset);
          const u = allUsers.find(x => x.id === userId);
          if (!u || !confirm(`Сбросить пароль для ${u.name}?`)) return;
          try {
            const result = await AsgardAuth.resetPassword(userId, user.id);
            showModal('Пароль сброшен', `
              <div style="text-align:center">
                <div style="font-size:48px; margin-bottom:16px">🔑</div>
                <div style="font-size:16px; margin-bottom:16px">${esc(u.name)}</div>
                <div style="background:rgba(242,208,138,.15); padding:16px; border-radius:6px; margin-bottom:16px">
                  <div style="font-size:12px; color:var(--muted); margin-bottom:8px">Новый временный пароль:</div>
                  <div style="font-size:24px; font-weight:900; font-family:var(--mono); color:var(--gold); letter-spacing:2px">${result.tempPassword}</div>
                </div>
                <div style="font-size:12px; color:var(--muted)">Сообщите пароль сотруднику.</div>
              </div>
            `);
            await loadUsers();
          } catch(e) { toast('Ошибка', e.message, 'err'); }
        });
      });

      // Block
      $$('[data-block]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const u = allUsers.find(x => x.id === Number(btn.dataset.block));
          if (!u) return;
          const reason = prompt(`Причина блокировки ${u.name}:`, 'Заблокирован администратором');
          if (reason === null) return;
          try {
            await AsgardAuth.blockUser(Number(btn.dataset.block), user.id, reason);
            toast('Заблокирован', `${u.name} заблокирован`);
            await loadUsers(); renderPage();
          } catch(e) { toast('Ошибка', e.message, 'err'); }
        });
      });

      // Unblock
      $$('[data-unblock]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const u = allUsers.find(x => x.id === Number(btn.dataset.unblock));
          if (!u || !confirm(`Разблокировать ${u.name}?`)) return;
          try {
            await AsgardAuth.unblockUser(Number(btn.dataset.unblock), user.id);
            toast('Разблокирован', `${u.name} разблокирован`);
            await loadUsers(); renderPage();
          } catch(e) { toast('Ошибка', e.message, 'err'); }
        });
      });

      // ═══════════════════════════════════════════════════════════════
      // MAIL MANAGEMENT EVENTS
      // ═══════════════════════════════════════════════════════════════

      // Bind via Yandex 360 Admin API (no employee password needed)
      $$('[data-bind-yandex]').forEach(btn => {
        btn.addEventListener('click', () => {
          const u = allUsers.find(x => x.id === Number(btn.dataset.bindYandex));
          if (u) openBindYandexModal(u);
        });
      });

      // Bind existing mail (manual)
      $$('[data-bind-mail]').forEach(btn => {
        btn.addEventListener('click', () => {
          const u = allUsers.find(x => x.id === Number(btn.dataset.bindMail));
          if (u) openBindEmailModal(u);
        });
      });

      // Create Yandex mailbox
      $$('[data-create-yandex]').forEach(btn => {
        btn.addEventListener('click', () => {
          const u = allUsers.find(x => x.id === Number(btn.dataset.createYandex));
          if (u) openCreateYandexModal(u);
        });
      });

      // Mail settings
      $$('[data-mail-settings]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const u = allUsers.find(x => x.id === Number(btn.dataset.mailSettings));
          if (!u) return;
          try {
            const resp = await fetch(`/api/users/${u.id}/email-account`, { headers: authHeaders() });
            const data = await resp.json();
            if (data.account) openMailSettingsModal(u, data.account);
            else toast('Ошибка', 'Аккаунт не найден', 'err');
          } catch(e) { toast('Ошибка', e.message, 'err'); }
        });
      });

      // Test mail connection
      $$('[data-mail-test]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = Number(btn.dataset.mailTest);
          btn.disabled = true; btn.textContent = '...';
          try {
            const resp = await fetch(`/api/users/${userId}/email-account/test`, {
              method: 'POST', headers: authHeaders()
            });
            const data = await resp.json();
            if (data.success) {
              toast('Подключение', 'IMAP подключение успешно', 'ok');
            } else {
              toast('Ошибка', data.imap?.error || data.error || 'Ошибка подключения', 'err');
            }
          } catch(e) { toast('Ошибка', e.message, 'err'); }
          finally { btn.disabled = false; btn.textContent = 'Проверить'; }
        });
      });

      // Disconnect mail
      $$('[data-disconnect-mail]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const u = allUsers.find(x => x.id === Number(btn.dataset.disconnectMail));
          if (!u) return;
          if (!confirm(`Отключить почту ${u.mail_address || ''} от ${u.name}?\n\nВсе письма и папки этого пользователя будут удалены!`)) return;
          try {
            const resp = await fetch(`/api/users/${u.id}/email-account`, {
              method: 'DELETE', headers: authHeaders()
            });
            const data = await resp.json();
            if (resp.ok) {
              toast('Готово', `Почта ${u.mail_address || ''} отключена`);
              await loadUsers(); renderPage();
            } else {
              toast('Ошибка', data.error || 'Не удалось отключить', 'err');
            }
          } catch(e) { toast('Ошибка', e.message, 'err'); }
        });
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // MODAL: Привязать существующую почту
    // ═══════════════════════════════════════════════════════════════════
    function openBindEmailModal(u) {
      const html = `
        <div style="margin-bottom:16px; color:var(--muted); font-size:13px">
          Привязать существующий почтовый ящик к пользователю <strong style="color:var(--text)">${esc(u.name)}</strong>.
          <br/>По умолчанию настройки для Яндекс Почты.
        </div>

        <div class="formrow">
          <div><label>Email *</label><input id="bm_email" type="email" placeholder="user@asgard-service.com"/></div>
          <div><label>Пароль от почты *</label><input id="bm_password" type="password" placeholder="Пароль для IMAP/SMTP"/></div>
        </div>

        <div style="margin:8px 0">
          <a href="#" id="bm_toggle_advanced" style="color:var(--info-t); font-size:12px; text-decoration:none">Расширенные настройки (IMAP/SMTP)</a>
        </div>

        <div class="bind-advanced" id="bm_advanced">
          <div class="formrow">
            <div><label>IMAP хост</label><input id="bm_imap_host" value="imap.yandex.ru"/></div>
            <div><label>IMAP порт</label><input id="bm_imap_port" type="number" value="993"/></div>
          </div>
          <div class="formrow">
            <div><label>SMTP хост</label><input id="bm_smtp_host" value="smtp.yandex.ru"/></div>
            <div><label>SMTP порт</label><input id="bm_smtp_port" type="number" value="465"/></div>
          </div>
          <div class="formrow">
            <div><label>Отображаемое имя</label><input id="bm_display_name" value="${esc(u.name)}" placeholder="Имя Фамилия"/></div>
            <div></div>
          </div>
        </div>

        <div id="bm_test_result"></div>

        <hr class="hr"/>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn" id="btnTestMail">Проверить подключение</button>
          <button class="btn amber" id="btnBindMail" disabled>Привязать</button>
        </div>
      `;

      showModal('Привязать почту — ' + esc(u.name), html);

      // Toggle advanced
      $('#bm_toggle_advanced')?.addEventListener('click', (e) => {
        e.preventDefault();
        $('#bm_advanced')?.classList.toggle('show');
      });

      // Test connection
      $('#btnTestMail')?.addEventListener('click', async () => {
        const email = $('#bm_email')?.value?.trim();
        const password = $('#bm_password')?.value;
        if (!email || !password) { toast('Ошибка', 'Укажите email и пароль', 'err'); return; }

        const resultDiv = $('#bm_test_result');
        resultDiv.className = 'bind-test-result loading';
        resultDiv.textContent = 'Проверка подключения...';
        $('#btnTestMail').disabled = true;

        try {
          const resp = await fetch(`/api/users/${u.id}/email-account/test`, {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({
              email_address: email, password,
              imap_host: $('#bm_imap_host')?.value || 'imap.yandex.ru',
              imap_port: Number($('#bm_imap_port')?.value) || 993,
              smtp_host: $('#bm_smtp_host')?.value || 'smtp.yandex.ru',
              smtp_port: Number($('#bm_smtp_port')?.value) || 465
            })
          });
          const data = await resp.json();

          if (data.success) {
            resultDiv.className = 'bind-test-result ok';
            resultDiv.innerHTML = '✓ IMAP: OK &nbsp; ✓ SMTP: OK — Подключение успешно!';
            $('#btnBindMail').disabled = false;
          } else {
            const errors = [];
            if (!data.imap?.ok) errors.push('IMAP: ' + (data.imap?.error || 'ошибка'));
            if (!data.smtp?.ok) errors.push('SMTP: ' + (data.smtp?.error || 'ошибка'));
            resultDiv.className = 'bind-test-result err';
            resultDiv.textContent = errors.join(' | ') || 'Ошибка подключения';
            $('#btnBindMail').disabled = true;
          }
        } catch(e) {
          resultDiv.className = 'bind-test-result err';
          resultDiv.textContent = 'Ошибка: ' + e.message;
        } finally {
          $('#btnTestMail').disabled = false;
        }
      });

      // Bind mail
      $('#btnBindMail')?.addEventListener('click', async () => {
        const email = $('#bm_email')?.value?.trim();
        const password = $('#bm_password')?.value;
        if (!email || !password) { toast('Ошибка', 'Укажите email и пароль', 'err'); return; }

        const btn = $('#btnBindMail');
        btn.disabled = true; btn.textContent = 'Привязка...';

        try {
          const resp = await fetch(`/api/users/${u.id}/email-account`, {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({
              email_address: email,
              imap_password: password,
              smtp_password: password,
              imap_host: $('#bm_imap_host')?.value || 'imap.yandex.ru',
              imap_port: Number($('#bm_imap_port')?.value) || 993,
              smtp_host: $('#bm_smtp_host')?.value || 'smtp.yandex.ru',
              smtp_port: Number($('#bm_smtp_port')?.value) || 465,
              display_name: $('#bm_display_name')?.value?.trim() || u.name
            })
          });
          const data = await resp.json();

          if (resp.ok && data.success) {
            toast('Готово', `Почта ${email} привязана к ${u.name}`);
            AsgardUI.hideModal();
            await loadUsers(); renderPage();
          } else {
            toast('Ошибка', data.error || 'Не удалось привязать', 'err');
            btn.disabled = false; btn.textContent = 'Привязать';
          }
        } catch(e) {
          toast('Ошибка', e.message, 'err');
          btn.disabled = false; btn.textContent = 'Привязать';
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // MODAL: Создать Яндекс-ящик
    // ═══════════════════════════════════════════════════════════════════
    function openCreateYandexModal(u) {
      const suggestedNickname = (u.login || '').toLowerCase().replace(/[^a-z0-9._-]/g, '');

      const html = `
        <div style="margin-bottom:16px; color:var(--muted); font-size:13px">
          Создать новый почтовый ящик в Яндекс 360 для <strong style="color:var(--text)">${esc(u.name)}</strong>
          и автоматически привязать к CRM.
        </div>

        <div class="formrow">
          <div><label>Логин (nickname) *</label><input id="ym_nickname" value="${esc(suggestedNickname)}" placeholder="i.ivanov"/></div>
          <div><label>Пароль *</label><input id="ym_password" type="password" placeholder="Мин. 8 символов"/></div>
        </div>

        <div class="yandex-preview" id="ym_preview">${esc(suggestedNickname)}@asgard-service.com</div>

        <div style="font-size:12px; color:var(--muted); margin-bottom:16px">
          Ящик будет создан в домене Яндекс 360 вашей организации.
          Пароль также будет использоваться для IMAP/SMTP.
        </div>

        <hr class="hr"/>
        <div style="display:flex; gap:10px">
          <button class="btn amber" id="btnCreateYandex">Создать и привязать</button>
        </div>
      `;

      showModal('Создать Яндекс-ящик — ' + esc(u.name), html);

      // Live preview
      $('#ym_nickname')?.addEventListener('input', (e) => {
        const nick = e.target.value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
        $('#ym_preview').textContent = (nick || '???') + '@asgard-service.com';
      });

      // Create
      $('#btnCreateYandex')?.addEventListener('click', async () => {
        const nickname = $('#ym_nickname')?.value?.trim();
        const password = $('#ym_password')?.value;

        if (!nickname || nickname.length < 2) { toast('Ошибка', 'Логин минимум 2 символа', 'err'); return; }
        if (!password || password.length < 8) { toast('Ошибка', 'Пароль минимум 8 символов', 'err'); return; }

        const btn = $('#btnCreateYandex');
        btn.disabled = true; btn.textContent = 'Создание...';

        try {
          const resp = await fetch(`/api/users/${u.id}/email-account/create-yandex`, {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ nickname, password })
          });
          const data = await resp.json();

          if (resp.ok && data.success) {
            showModal('Ящик создан', `
              <div style="text-align:center">
                <div style="font-size:48px; margin-bottom:16px">✉️</div>
                <div style="font-size:18px; font-weight:700; margin-bottom:8px">${esc(data.email)}</div>
                <div style="color:var(--muted); margin-bottom:20px">Ящик создан и привязан к ${esc(u.name)}</div>
                <div style="background:rgba(34,197,94,.1); padding:16px; border-radius:6px; color:#22c55e; font-size:14px">
                  Пользователь может войти в «Моя Почта» в CRM или через mail.yandex.ru
                </div>
              </div>
            `);
            await loadUsers(); renderPage();
          } else {
            toast('Ошибка', data.error || 'Не удалось создать ящик', 'err');
            btn.disabled = false; btn.textContent = 'Создать и привязать';
          }
        } catch(e) {
          toast('Ошибка', e.message, 'err');
          btn.disabled = false; btn.textContent = 'Создать и привязать';
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // MODAL: Привязать корпоративный ящик (через Яндекс 360 Admin API)
    // ═══════════════════════════════════════════════════════════════════
    function openBindYandexModal(u) {
      const suggestedEmail = u.email || (u.login ? u.login.toLowerCase().replace(/[^a-z0-9._-]/g, '') + '@asgard-service.com' : '');

      const html = `
        <div style="margin-bottom:16px; color:var(--muted); font-size:13px">
          Привязать существующий корпоративный ящик к <strong style="color:var(--text)">${esc(u.name)}</strong>
          через Яндекс 360 Admin API.
        </div>

        <div class="formrow">
          <div style="flex:1">
            <label>Email корпоративного ящика *</label>
            <input id="by_email" value="${esc(suggestedEmail)}" placeholder="i.ivanov@asgard-service.com"/>
          </div>
        </div>

        <div style="background:rgba(234,179,8,.08); border:1px solid rgba(234,179,8,.2); border-radius:8px; padding:12px 16px; margin:16px 0; font-size:13px; color:var(--amber)">
          <strong>Внимание:</strong> Пароль сотрудника в Яндекс будет сброшен на автоматически сгенерированный.
          Сотрудник сможет войти в почту только через CRM («Моя Почта») или запросив новый пароль у администратора.
        </div>

        <hr class="hr"/>
        <div style="display:flex; gap:10px">
          <button class="btn primary" id="btnBindYandex">Привязать через Яндекс 360</button>
        </div>

        <div id="by_result" style="margin-top:12px"></div>
      `;

      showModal('Привязать корп. ящик — ' + esc(u.name), html);

      $('#btnBindYandex')?.addEventListener('click', async () => {
        const email = $('#by_email')?.value?.trim();
        if (!email || !email.includes('@')) {
          toast('Ошибка', 'Укажите корректный email', 'err'); return;
        }

        const btn = $('#btnBindYandex');
        const resultDiv = $('#by_result');
        btn.disabled = true; btn.textContent = 'Привязка...';
        if (resultDiv) resultDiv.innerHTML = '<div class="bind-test-result loading">Поиск в Яндекс 360 и сброс пароля...</div>';

        try {
          const resp = await fetch('/api/users/' + u.id + '/email-account/bind-yandex', {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          const data = await resp.json();

          if (resp.ok && data.success) {
            if (resultDiv) resultDiv.innerHTML = '<div class="bind-test-result ok">Ящик привязан!</div>';
            toast('Готово', data.email + ' привязан к ' + u.name, 'ok');
            setTimeout(async () => { await loadUsers(); renderPage(); }, 600);
            setTimeout(() => { const m = document.querySelector('.modal-overlay'); if (m) m.remove(); }, 1500);
          } else {
            if (resultDiv) resultDiv.innerHTML = '<div class="bind-test-result err">' + esc(data.error || 'Неизвестная ошибка') + '</div>';
            btn.disabled = false; btn.textContent = 'Привязать через Яндекс 360';
          }
        } catch(e) {
          if (resultDiv) resultDiv.innerHTML = '<div class="bind-test-result err">' + esc(e.message) + '</div>';
          btn.disabled = false; btn.textContent = 'Привязать через Яндекс 360';
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // MODAL: Настройки почты
    // ═══════════════════════════════════════════════════════════════════
    function openMailSettingsModal(u, acc) {
      const html = `
        <div style="margin-bottom:16px; color:var(--muted); font-size:13px">
          Настройки почтового аккаунта <strong style="color:var(--text)">${esc(acc.email_address)}</strong>
          для ${esc(u.name)}.
        </div>

        <div class="formrow">
          <div><label>Email</label><input value="${esc(acc.email_address)}" disabled style="opacity:.6"/></div>
          <div><label>Отображаемое имя</label><input id="ms_display" value="${esc(acc.display_name || '')}"/></div>
        </div>

        <div class="formrow">
          <div><label>IMAP хост</label><input id="ms_imap_host" value="${esc(acc.imap_host || 'imap.yandex.ru')}"/></div>
          <div><label>IMAP порт</label><input id="ms_imap_port" type="number" value="${acc.imap_port || 993}"/></div>
        </div>

        <div class="formrow">
          <div><label>SMTP хост</label><input id="ms_smtp_host" value="${esc(acc.smtp_host || 'smtp.yandex.ru')}"/></div>
          <div><label>SMTP порт</label><input id="ms_smtp_port" type="number" value="${acc.smtp_port || 465}"/></div>
        </div>

        <div class="formrow">
          <div><label>Новый IMAP пароль</label><input id="ms_imap_pass" type="password" placeholder="Оставьте пустым если не менять"/></div>
          <div><label>Новый SMTP пароль</label><input id="ms_smtp_pass" type="password" placeholder="Оставьте пустым если не менять"/></div>
        </div>

        <div class="formrow">
          <div style="grid-column:1/-1">
            <label>HTML-подпись</label>
            <textarea id="ms_signature" rows="4" style="width:100%; resize:vertical; padding:10px; border-radius:6px; border:1px solid rgba(148,163,184,.15); background:rgba(13,20,40,.5); color:var(--text); font-size:13px">${esc(acc.signature_html || '')}</textarea>
          </div>
        </div>

        <div style="font-size:12px; color:var(--muted); margin-bottom:8px">
          Статус: ${acc.is_active ? '<span style="color:#22c55e">Активен</span>' : '<span style="color:#ef4444">Неактивен</span>'}
          ${acc.last_sync_at ? ' | Последняя синхр: ' + timeAgo(acc.last_sync_at) : ''}
          ${acc.last_sync_error ? ' | <span style="color:#ef4444">Ошибка: ' + esc(acc.last_sync_error) + '</span>' : ''}
        </div>

        <hr class="hr"/>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn" id="btnSaveMailSettings">Сохранить</button>
          <button class="btn ghost" id="btnTestSaved">Проверить подключение</button>
        </div>
        <div id="ms_test_result"></div>
      `;

      showModal('Настройки почты — ' + esc(u.name), html);

      // Save
      $('#btnSaveMailSettings')?.addEventListener('click', async () => {
        const body = {
          display_name: $('#ms_display')?.value?.trim() || null,
          signature_html: $('#ms_signature')?.value || null,
          imap_host: $('#ms_imap_host')?.value?.trim() || null,
          imap_port: Number($('#ms_imap_port')?.value) || null,
          smtp_host: $('#ms_smtp_host')?.value?.trim() || null,
          smtp_port: Number($('#ms_smtp_port')?.value) || null
        };
        const imapPass = $('#ms_imap_pass')?.value;
        const smtpPass = $('#ms_smtp_pass')?.value;
        if (imapPass) body.imap_password = imapPass;
        if (smtpPass) body.smtp_password = smtpPass;

        // Remove nulls
        Object.keys(body).forEach(k => { if (body[k] === null) delete body[k]; });

        if (Object.keys(body).length === 0) { toast('Нет изменений', '', 'warn'); return; }

        const btn = $('#btnSaveMailSettings');
        btn.disabled = true; btn.textContent = 'Сохранение...';

        try {
          const resp = await fetch(`/api/users/${u.id}/email-account`, {
            method: 'PUT', headers: authHeaders(),
            body: JSON.stringify(body)
          });
          const data = await resp.json();

          if (resp.ok && data.success) {
            toast('Сохранено', 'Настройки почты обновлены');
            AsgardUI.hideModal();
            await loadUsers(); renderPage();
          } else {
            toast('Ошибка', data.error || 'Не удалось сохранить', 'err');
            btn.disabled = false; btn.textContent = 'Сохранить';
          }
        } catch(e) {
          toast('Ошибка', e.message, 'err');
          btn.disabled = false; btn.textContent = 'Сохранить';
        }
      });

      // Test saved account
      $('#btnTestSaved')?.addEventListener('click', async () => {
        const resultDiv = $('#ms_test_result');
        resultDiv.className = 'bind-test-result loading';
        resultDiv.textContent = 'Проверка...';
        try {
          const resp = await fetch(`/api/users/${u.id}/email-account/test`, {
            method: 'POST', headers: authHeaders()
          });
          const data = await resp.json();
          if (data.success || data.imap?.ok) {
            resultDiv.className = 'bind-test-result ok';
            resultDiv.textContent = '✓ Подключение успешно';
          } else {
            resultDiv.className = 'bind-test-result err';
            resultDiv.textContent = data.imap?.error || data.error || 'Ошибка подключения';
          }
        } catch(e) {
          resultDiv.className = 'bind-test-result err';
          resultDiv.textContent = e.message;
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // MODAL: Создать пользователя
    // ═══════════════════════════════════════════════════════════════════
    function openCreateUserModal(){
      const html = `
        <div style="margin-bottom:16px; color:var(--muted); font-size:13px">
          После создания пользователю будет отправлен временный пароль в Telegram (если указан ID).<br/>
          При первом входе он должен сменить пароль и установить PIN.
          <br/><br/>
          <strong style="color:var(--text)">Почту можно привязать позже</strong> через кнопку «Привязать» или «Создать ящик» в карточке пользователя.
        </div>
        <div class="formrow">
          <div><label>Логин *</label><input id="cu_login" placeholder="ivanov"/></div>
          <div><label>Имя *</label><input id="cu_name" placeholder="Иванов И.И."/></div>
        </div>
        <div class="formrow">
          <div><label>Роль *</label>
            <select id="cu_role">${ROLES_LIST.map(r => `<option value="${r.key}">${r.label}</option>`).join('')}</select>
          </div>
          <div><label>Телефон</label><input id="cu_phone" placeholder="+7..."/></div>
        </div>
        <div class="formrow">
          <div><label>Дата рождения *</label><input type="date" id="cu_birth"/></div>
          <div><label>Дата трудоустройства</label><input type="date" id="cu_emp" value="${today()}"/></div>
        </div>
        <div class="formrow">
          <div><label>Email <span style="color:var(--muted); font-size:11px">(необязательно)</span></label><input id="cu_email" placeholder="user@company.ru"/></div>
          <div><label>Telegram Chat ID</label><input id="cu_telegram" placeholder="123456789"/></div>
        </div>
        <div style="margin:12px 0; padding:12px; background:rgba(59,130,246,.1); border-radius:6px; font-size:12px; color:var(--muted)">
          💡 Чтобы узнать Telegram Chat ID, попросите сотрудника написать боту @asgard_crm_bot команду /start
        </div>
        <hr class="hr"/>
        <div style="display:flex; gap:10px">
          <button class="btn" id="btnConfirmCreate">Создать пользователя</button>
        </div>
      `;

      showModal('Новый пользователь', html);

      $('#btnConfirmCreate')?.addEventListener('click', async () => {
        const login = $('#cu_login')?.value?.trim();
        const name = $('#cu_name')?.value?.trim();
        const role = $('#cu_role')?.value;
        const phone = $('#cu_phone')?.value?.trim() || '';
        const birth = $('#cu_birth')?.value;
        const emp = $('#cu_emp')?.value;
        const email = $('#cu_email')?.value?.trim() || '';
        const telegram = $('#cu_telegram')?.value?.trim() || '';

        if (!login || login.length < 3) { toast('Ошибка', 'Логин минимум 3 символа', 'err'); return; }
        if (!name) { toast('Ошибка', 'Укажите имя', 'err'); return; }
        if (!birth) { toast('Ошибка', 'Укажите дату рождения', 'err'); return; }

        try {
          const result = await AsgardAuth.createUser({
            login, name, role, phone, email,
            telegram_chat_id: telegram,
            birth_date: birth, employment_date: emp
          }, user.id);

          const telegramSent = telegram ? 'Пароль отправлен в Telegram!' : 'Сообщите пароль сотруднику вручную.';
          showModal('Пользователь создан', `
            <div style="text-align:center">
              <div style="font-size:48px; margin-bottom:16px">✅</div>
              <div style="font-size:18px; font-weight:700; margin-bottom:16px">${esc(name)}</div>
              <div style="margin-bottom:20px; color:var(--muted)">Роль: ${role}</div>
              <div style="background:rgba(242,208,138,.15); padding:16px; border-radius:6px; margin-bottom:16px">
                <div style="font-size:12px; color:var(--muted); margin-bottom:8px">Временный пароль:</div>
                <div style="font-size:24px; font-weight:900; font-family:var(--mono); color:var(--gold); letter-spacing:2px">${result.tempPassword}</div>
              </div>
              <div style="font-size:13px; color:${telegram ? 'var(--green)' : 'var(--amber)'}">
                ${telegram ? '✅' : '⚠️'} ${telegramSent}
              </div>
              <div style="font-size:12px; color:var(--muted); margin-top:12px">
                Почту можно привязать в карточке пользователя
              </div>
            </div>
          `);
          await loadUsers(); renderPage();
        } catch(e) { toast('Ошибка', e.message, 'err'); }
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // MODAL: Редактировать пользователя
    // ═══════════════════════════════════════════════════════════════════
    async function openEditUserModal(u){
      const bdate = u.birth_date ? String(u.birth_date).slice(0,10) : "";
      const edate = u.employment_date ? String(u.employment_date).slice(0,10) : "";
      const roleOpts = ROLES_LIST.map(r =>
        '<option value="' + r.key + '"' + (r.key === u.role ? ' selected' : '') + '>' + r.label + '</option>'
      ).join("");

      let h = '<div style="margin-bottom:16px;color:var(--muted);font-size:13px">Изменения автоматически обновляются во всех модулях.</div>';
      h += '<div class="formrow"><div><label>Логин</label><input id="eu_login" value="' + esc(u.login) + '" disabled style="opacity:.6"/></div>';
      h += '<div><label>Имя</label><input id="eu_name" value="' + esc(u.name || "") + '"/></div></div>';
      h += '<div class="formrow"><div><label>Отчество</label><input id="eu_patronymic" value="' + esc(u.patronymic || "") + '" placeholder="Александрович"/></div><div></div></div>';
      h += '<div class="formrow"><div><label>Роль</label><select id="eu_role" ' + (isAdmin ? "" : "disabled") + '>' + roleOpts + '</select></div>';
      h += '<div><label>Телефон</label><input id="eu_phone" value="' + esc(u.phone || "") + '" placeholder="+7..."/></div></div>';
      h += '<div class="formrow"><div><label>Дата рождения</label><input type="date" id="eu_birth" value="' + bdate + '"/></div>';
      h += '<div><label>Дата трудоустройства</label><input type="date" id="eu_emp" value="' + edate + '"/></div></div>';
      h += '<div class="formrow"><div><label>Email</label><input id="eu_email" value="' + esc(u.email || "") + '" placeholder="user@company.ru"/></div>';
      h += '<div><label>Telegram Chat ID</label><input id="eu_telegram" value="' + esc(u.telegram_chat_id || "") + '" placeholder="123456789"/></div></div>';
      h += '<hr class="hr"/><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="btnSaveUser">Сохранить</button><button class="btn ghost" id="btnCancelEdit">Отмена</button>';
      if (u.email) h += '<button class="btn amber" id="btnSendCreds" style="margin-left:auto">Отправить учётные данные</button>';
      h += '</div>';

      showModal("Редактирование: " + esc(u.name || u.login), h);

      $("#btnCancelEdit")?.addEventListener("click", () => AsgardUI.hideModal());

      // Send credentials
      const btnCreds = $("#btnSendCreds");
      if (btnCreds) {
        btnCreds.addEventListener("click", async () => {
          if (!confirm("Сбросить пароль и отправить на " + (u.email || "?") + "?")) return;
          btnCreds.disabled = true; btnCreds.textContent = "Отправка...";
          try {
            const resp = await fetch("/api/users/" + u.id + "/send-credentials", {
              method: "POST", headers: { 'Authorization': 'Bearer ' + (AsgardAuth.getAuth()?.token || '') }
            });
            const r = await resp.json();
            if (resp.ok && r.success) {
              toast("Отправлено", r.message || "Письмо отправлено", "ok");
              if (r.tempPassword) {
                showModal("Новый пароль", '<div style="text-align:center"><div style="font-size:48px;margin-bottom:16px">✉️</div><div style="margin-bottom:12px;color:var(--muted)">Временный пароль:</div><div style="font-size:24px;font-weight:900;font-family:var(--mono);color:var(--gold);letter-spacing:2px;background:rgba(242,208,138,.15);padding:16px;border-radius:8px">' + esc(r.tempPassword) + '</div></div>');
              }
            } else {
              toast("Ошибка", r.message || r.error || "Не удалось отправить", "err");
              if (r.tempPassword) {
                showModal("Пароль сброшен", '<div style="text-align:center"><div style="color:var(--amber);margin-bottom:12px">Email не отправлен, но пароль сброшен</div><div style="font-size:24px;font-weight:900;font-family:var(--mono);color:var(--gold);letter-spacing:2px;background:rgba(242,208,138,.15);padding:16px;border-radius:8px">' + esc(r.tempPassword) + '</div></div>');
              }
            }
          } catch(e) { toast("Ошибка", e.message, "err"); }
          finally { btnCreds.disabled = false; btnCreds.textContent = "Отправить учётные данные"; }
        });
      }

      // Save user
      $("#btnSaveUser")?.addEventListener("click", async () => {
        const body = {
          name: $("#eu_name")?.value?.trim(),
          email: $("#eu_email")?.value?.trim() || null,
          phone: $("#eu_phone")?.value?.trim() || null,
          birth_date: $("#eu_birth")?.value || null,
          employment_date: $("#eu_emp")?.value || null,
          telegram_chat_id: $("#eu_telegram")?.value?.trim() || null,
          patronymic: $("#eu_patronymic")?.value?.trim() || null
        };
        if (isAdmin) body.role = $("#eu_role")?.value;
        if (!body.name) { toast("Ошибка", "Укажите имя", "err"); return; }

        const btn = $("#btnSaveUser");
        btn.disabled = true; btn.textContent = "Сохранение...";

        try {
          const resp = await fetch("/api/users/" + u.id, {
            method: "PUT", headers: authHeaders(),
            body: JSON.stringify(body)
          });
          const r = await resp.json();
          if (resp.ok && r.user) {
            toast("Сохранено", "Данные обновлены");
            AsgardUI.hideModal();
            await loadUsers(); renderPage();
          } else {
            toast("Ошибка", r.error || "Не удалось сохранить", "err");
            btn.disabled = false; btn.textContent = "Сохранить";
          }
        } catch(e) {
          toast("Ошибка", e.message, "err");
          btn.disabled = false; btn.textContent = "Сохранить";
        }
      });
    }

    renderPage();
  }

  return { render };
})();
