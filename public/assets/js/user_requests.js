// Stage 18b: Управление пользователями
// Создание, блокировка, сброс пароля

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
    { key: 'DIRECTOR_DEV', label: 'DIRECTOR_DEV — Директор разработки + PM' }
  ];

  function today(){ return new Date().toISOString().slice(0,10); }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash = "#/login"; return; }
    const user = auth.user;

    // Только Admin и директора
    const allowed = ["ADMIN", "DIRECTOR_COMM", "DIRECTOR_GEN", "DIRECTOR_DEV", "DIRECTOR"];
    if(!allowed.includes(user.role)){
      toast("Доступ", "Только для директоров", "err");
      location.hash = "#/home";
      return;
    }

    const isAdmin = user.role === "ADMIN";

    // Загружаем пользователей с сервера
    const auth2 = AsgardAuth.getAuth();
    let usersResp = await fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + auth2?.token } });
    let allUsers = (await usersResp.json()).users || [];
    
    // Фильтруем
    const activeUsers = allUsers.filter(u => u.is_active && !u.is_blocked);
    const blockedUsers = allUsers.filter(u => u.is_blocked);

    function renderPage(){
      // Пересчитываем после изменений
      const active = allUsers.filter(u => u.is_active && !u.is_blocked);
      const blocked = allUsers.filter(u => u.is_blocked);

      const body = `
        <style>
          .ur-header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px; }
          
          .ur-tabs { display:flex; gap:8px; margin-bottom:20px; }
          .ur-tab { 
            padding:10px 18px; border-radius:10px; 
            background:rgba(13,20,40,.4); 
            border:1px solid rgba(148,163,184,.15);
            color:var(--muted); font-weight:700; cursor:pointer;
            transition: all .2s ease;
          }
          .ur-tab:hover { border-color:rgba(242,208,138,.3); }
          .ur-tab.active { 
            background:linear-gradient(135deg, rgba(242,208,138,.2), rgba(242,208,138,.1));
            border-color:rgba(242,208,138,.4);
            color:var(--gold);
          }
          .ur-tab .count { 
            display:inline-flex; align-items:center; justify-content:center;
            min-width:20px; height:20px; margin-left:8px; padding:0 6px;
            background:rgba(59,130,246,.6); color:#fff; 
            border-radius:999px; font-size:11px; font-weight:900;
          }
          .ur-tab.active .count { background:var(--gold); color:#000; }
          .ur-tab .count.red { background:rgba(239,68,68,.8); }
          
          .ur-list { display:grid; gap:12px; }
          
          .ur-card {
            background: linear-gradient(135deg, rgba(13,20,40,.6), rgba(13,20,40,.4));
            border:1px solid rgba(148,163,184,.15);
            border-radius:14px;
            padding:16px 20px;
            display:grid;
            grid-template-columns:1fr auto;
            gap:16px;
            align-items:center;
            transition: all .3s ease;
          }
          .ur-card:hover {
            border-color:rgba(242,208,138,.25);
          }
          .ur-card.blocked {
            opacity:.6;
            border-color:rgba(239,68,68,.3);
          }
          
          .ur-info h3 { margin:0 0 6px; font-size:16px; display:flex; align-items:center; gap:8px; }
          .ur-role { 
            font-size:10px; padding:3px 8px; border-radius:6px; 
            background:rgba(59,130,246,.2); color:#60a5fa;
            font-weight:800;
          }
          .ur-role.admin { background:rgba(239,68,68,.2); color:#f87171; }
          .ur-role.director { background:rgba(242,208,138,.2); color:var(--gold); }
          
          .ur-meta { display:flex; flex-wrap:wrap; gap:12px; color:var(--muted); font-size:12px; }
          .ur-meta span { display:flex; align-items:center; gap:4px; }
          
          .ur-actions { display:flex; gap:8px; flex-wrap:wrap; }
          .ur-actions .btn { padding:8px 12px; font-size:12px; }
          
          .ur-empty {
            text-align:center; padding:60px 20px;
            background:rgba(13,20,40,.3);
            border:1px dashed rgba(148,163,184,.2);
            border-radius:16px;
            color:var(--muted);
          }
          .ur-empty-icon { font-size:64px; margin-bottom:16px; opacity:.5; }
          
          .ur-search { 
            display:flex; gap:12px; margin-bottom:16px; 
            padding:12px; background:rgba(13,20,40,.3); 
            border-radius:12px; align-items:center;
          }
          .ur-search input {
            flex:1; padding:10px 14px; border-radius:10px;
            border:1px solid rgba(148,163,184,.15);
            background:rgba(13,20,40,.5);
            color:var(--text); font-size:14px;
          }
        </style>

        <div class="panel">
          <div class="ur-header">
            <div>
              <h2 class="page-title" style="margin:0">Управление пользователями</h2>
              <div class="help" style="margin-top:8px">Создание, блокировка, сброс пароля</div>
            </div>
            <button class="btn" id="btnAddUser">➕ Создать пользователя</button>
          </div>

          <div class="ur-search">
            <input id="userSearch" placeholder="Поиск по имени или логину..."/>
          </div>

          <div class="ur-tabs">
            <div class="ur-tab active" data-tab="active">
              Активные <span class="count">${active.length}</span>
            </div>
            <div class="ur-tab" data-tab="blocked">
              Заблокированные <span class="count red">${blocked.length}</span>
            </div>
          </div>

          <div id="tabActive" class="ur-list">
            ${active.length ? active.map(u => renderUserCard(u, false)).join('') : `
              <div class="ur-empty">
                <div class="ur-empty-icon">👥</div>
                <div>Нет активных пользователей</div>
              </div>
            `}
          </div>

          <div id="tabBlocked" class="ur-list" style="display:none">
            ${blocked.length ? blocked.map(u => renderUserCard(u, true)).join('') : `
              <div class="ur-empty">
                <div class="ur-empty-icon">🔓</div>
                <div>Нет заблокированных пользователей</div>
              </div>
            `}
          </div>
        </div>
      `;

      layout(body, { title: title || "Пользователи" }).then(bindEvents);
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
              ${u.must_change_password ? '<span style="color:var(--amber); font-size:11px">⚠️ Не сменил пароль</span>' : ''}
            </h3>
            <div class="ur-meta">
              <span>👤 ${esc(u.login)}</span>
              <span>📅 ${u.employment_date || '—'}</span>
              <span>🎂 ${u.birth_date || '—'}</span>
              ${u.last_login_at ? `<span>🕐 ${new Date(u.last_login_at).toLocaleDateString('ru-RU')}</span>` : '<span style="color:var(--amber)">Не входил</span>'}
              ${isBlocked ? `<span style="color:var(--red)">🔒 ${esc(u.block_reason || 'Заблокирован')}</span>` : ''}
            </div>
          </div>
          <div class="ur-actions">
            ${isBlocked ? `
              <button class="btn" data-unblock="${u.id}">🔓 Разблокировать</button>
            ` : `
              ${canReset ? `<button class="btn ghost" data-reset="${u.id}">🔑 Сбросить пароль</button>` : ''}
              ${canBlock && u.id !== user.id ? `<button class="btn ghost" data-block="${u.id}" style="color:var(--red)">🔒 Блокировать</button>` : ''}
            `}
          </div>
        </div>
      `;
    }

    function bindEvents(){
      // Табы
      $$('.ur-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          $$('.ur-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          
          const tabName = tab.dataset.tab;
          $('#tabActive').style.display = tabName === 'active' ? 'grid' : 'none';
          $('#tabBlocked').style.display = tabName === 'blocked' ? 'grid' : 'none';
        });
      });

      // Поиск
      $('#userSearch')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        $$('.ur-card').forEach(card => {
          const name = card.querySelector('h3')?.textContent?.toLowerCase() || '';
          const login = card.querySelector('.ur-meta span')?.textContent?.toLowerCase() || '';
          card.style.display = (name.includes(q) || login.includes(q)) ? 'grid' : 'none';
        });
      });

      // Создать пользователя
      $('#btnAddUser')?.addEventListener('click', openCreateUserModal);

      // Сбросить пароль
      $$('[data-reset]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = Number(btn.dataset.reset);
          const u = allUsers.find(x => x.id === userId);
          if(!u) return;
          
          if(!confirm(`Сбросить пароль для ${u.name}?\nБудет сгенерирован новый временный пароль.`)) return;
          
          try {
            const result = await AsgardAuth.resetPassword(userId, user.id);
            showModal('Пароль сброшен', `
              <div style="text-align:center">
                <div style="font-size:48px; margin-bottom:16px">🔑</div>
                <div style="font-size:16px; margin-bottom:16px">${esc(u.name)}</div>
                <div style="background:rgba(242,208,138,.15); padding:16px; border-radius:12px; margin-bottom:16px">
                  <div style="font-size:12px; color:var(--muted); margin-bottom:8px">Новый временный пароль:</div>
                  <div style="font-size:24px; font-weight:900; font-family:var(--mono); color:var(--gold); letter-spacing:2px">${result.tempPassword}</div>
                </div>
                <div style="font-size:12px; color:var(--muted)">
                  Сообщите пароль сотруднику. При входе он должен сменить его и установить новый PIN.
                </div>
              </div>
            `);
            usersResp = await fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + auth2?.token } }); allUsers = (await usersResp.json()).users || [];
          } catch(e) {
            toast('Ошибка', e.message, 'err');
          }
        });
      });

      // Заблокировать
      $$('[data-block]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = Number(btn.dataset.block);
          const u = allUsers.find(x => x.id === userId);
          if(!u) return;
          
          const reason = prompt(`Причина блокировки ${u.name}:`, 'Заблокирован администратором');
          if(reason === null) return;
          
          try {
            await AsgardAuth.blockUser(userId, user.id, reason);
            toast('Заблокирован', `${u.name} заблокирован`);
            usersResp = await fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + auth2?.token } }); allUsers = (await usersResp.json()).users || [];
            renderPage();
          } catch(e) {
            toast('Ошибка', e.message, 'err');
          }
        });
      });

      // Разблокировать
      $$('[data-unblock]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = Number(btn.dataset.unblock);
          const u = allUsers.find(x => x.id === userId);
          if(!u) return;
          
          if(!confirm(`Разблокировать ${u.name}?`)) return;
          
          try {
            await AsgardAuth.unblockUser(userId, user.id);
            toast('Разблокирован', `${u.name} разблокирован`);
            usersResp = await fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + auth2?.token } }); allUsers = (await usersResp.json()).users || [];
            renderPage();
          } catch(e) {
            toast('Ошибка', e.message, 'err');
          }
        });
      });
    }

    function openCreateUserModal(){
      const html = `
        <div style="margin-bottom:16px; color:var(--muted); font-size:13px">
          После создания пользователю будет отправлен временный пароль в Telegram (если указан ID).<br/>
          При первом входе он должен сменить пароль и установить PIN.
        </div>
        <div class="formrow">
          <div><label>Логин *</label><input id="cu_login" placeholder="ivanov"/></div>
          <div><label>Имя *</label><input id="cu_name" placeholder="Иванов И.И."/></div>
        </div>
        <div class="formrow">
          <div><label>Роль *</label>
            <select id="cu_role">
              ${ROLES_LIST.map(r => `<option value="${r.key}">${r.label}</option>`).join('')}
            </select>
          </div>
          <div><label>Телефон</label><input id="cu_phone" placeholder="+7..."/></div>
        </div>
        <div class="formrow">
          <div><label>Дата рождения *</label><input type="date" id="cu_birth"/></div>
          <div><label>Дата трудоустройства</label><input type="date" id="cu_emp" value="${today()}"/></div>
        </div>
        <div class="formrow">
          <div><label>Email</label><input id="cu_email" placeholder="user@company.ru"/></div>
          <div><label>Telegram Chat ID</label><input id="cu_telegram" placeholder="123456789"/></div>
        </div>
        <div style="margin:12px 0; padding:12px; background:rgba(59,130,246,.1); border-radius:8px; font-size:12px; color:var(--muted)">
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

        if(!login || login.length < 3){ toast('Ошибка', 'Логин минимум 3 символа', 'err'); return; }
        if(!name){ toast('Ошибка', 'Укажите имя', 'err'); return; }
        if(!birth){ toast('Ошибка', 'Укажите дату рождения', 'err'); return; }

        try {
          const result = await AsgardAuth.createUser({
            login, name, role, phone, email,
            telegram_chat_id: telegram,
            birth_date: birth, employment_date: emp
          }, user.id);
          
          // Показываем временный пароль
          const telegramSent = telegram ? 'Пароль отправлен в Telegram!' : 'Сообщите пароль сотруднику вручную.';
          showModal('Пользователь создан', `
            <div style="text-align:center">
              <div style="font-size:48px; margin-bottom:16px">✅</div>
              <div style="font-size:18px; font-weight:700; margin-bottom:16px">${esc(name)}</div>
              <div style="margin-bottom:20px; color:var(--muted)">Роль: ${role}</div>
              <div style="background:rgba(242,208,138,.15); padding:16px; border-radius:12px; margin-bottom:16px">
                <div style="font-size:12px; color:var(--muted); margin-bottom:8px">Временный пароль:</div>
                <div style="font-size:24px; font-weight:900; font-family:var(--mono); color:var(--gold); letter-spacing:2px">${result.tempPassword}</div>
              </div>
              <div style="font-size:13px; color:${telegram ? 'var(--green)' : 'var(--amber)'}">
                ${telegram ? '✅' : '⚠️'} ${telegramSent}
              </div>
              <div style="font-size:12px; color:var(--muted); margin-top:12px">
                При первом входе сотрудник должен сменить пароль и установить PIN
              </div>
            </div>
          `);
          
          usersResp = await fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + auth2?.token } }); allUsers = (await usersResp.json()).users || [];
          renderPage();
        } catch(e){
          toast('Ошибка', e.message, 'err');
        }
      });
    }

    renderPage();
  }

  return { render };
})();
