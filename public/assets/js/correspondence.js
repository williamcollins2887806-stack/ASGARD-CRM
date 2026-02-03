// Stage 16: Корреспонденция — входящие/исходящие письма
// Автонумерация исходящих, реестр, фильтры
// RBAC: только OFFICE_MANAGER, DIRECTOR_*, ADMIN

window.AsgardCorrespondencePage = (function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;

  // Направления
  const DIRECTIONS = {
    incoming: { label: 'Входящее', icon: '📥', color: '#3b82f6' },
    outgoing: { label: 'Исходящее', icon: '📤', color: '#22c55e' }
  };

  // Типы документов
  const DOC_TYPES = [
    { key: 'letter', label: 'Письмо', icon: '✉️' },
    { key: 'request', label: 'Запрос', icon: '❓' },
    { key: 'response', label: 'Ответ', icon: '💬' },
    { key: 'contract', label: 'Договор', icon: '📜' },
    { key: 'act', label: 'Акт', icon: '📋' },
    { key: 'invoice', label: 'Счёт', icon: '💰' },
    { key: 'claim', label: 'Претензия', icon: '⚠️' },
    { key: 'notification', label: 'Уведомление', icon: '📢' },
    { key: 'other', label: 'Прочее', icon: '📄' }
  ];

  const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

  function isoNow(){ return new Date().toISOString(); }
  function today(){ return new Date().toISOString().slice(0,10); }

  function getDocTypeInfo(key){
    return DOC_TYPES.find(t => t.key === key) || { label: key, icon: '📄' };
  }

  // === RBAC: Разрешённые роли ===
  const ALLOWED_ROLES = ["ADMIN", "OFFICE_MANAGER", "DIRECTOR_COMM", "DIRECTOR_GEN", "DIRECTOR_DEV"];
  
  function hasAccess(user){
    if(!user) return false;
    // Проверяем основную роль
    if(ALLOWED_ROLES.includes(user.role)) return true;
    // Проверяем массив ролей (если есть)
    if(Array.isArray(user.roles)){
      return user.roles.some(r => ALLOWED_ROLES.includes(r));
    }
    return false;
  }

  // === Формат номера исходящего: АС-ИСХ-YYYY-000001 ===
  async function generateOutgoingNumber(){
    const year = new Date().getFullYear();
    const prefix = `АС-ИСХ-${year}-`;
    
    let items = [];
    try { items = await AsgardDB.all('correspondence'); } catch(e){}
    
    // Получаем стартовый номер из настроек (если есть)
    let startNum = 1;
    try {
      const settings = await AsgardDB.get('settings', 'core');
      if(settings?.correspondence_start_number){
        startNum = parseInt(settings.correspondence_start_number, 10) || 1;
      }
    } catch(e){}
    
    // Ищем максимальный номер за текущий год
    const outgoing = items.filter(i => 
      i.direction === 'outgoing' && 
      i.number && 
      i.number.startsWith(prefix)
    );
    
    let maxNum = startNum - 1; // Начинаем со стартового
    outgoing.forEach(i => {
      const match = i.number.match(/АС-ИСХ-\d{4}-(\d{6})/);
      if(match){
        const num = parseInt(match[1], 10);
        if(num > maxNum) maxNum = num;
      }
    });
    
    const nextNum = String(maxNum + 1).padStart(6, '0');
    return `АС-ИСХ-${year}-${nextNum}`;
  }

  // === Аудит ===
  async function audit(userId, action, entityId, details){
    try {
      await AsgardDB.add('audit_log', {
        actor_user_id: userId,
        entity_type: 'correspondence',
        entity_id: entityId,
        action: action,
        payload: details,
        created_at: isoNow()
      });
    } catch(e){ console.warn('Audit error:', e); }
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash = "#/welcome"; return; }
    const user = auth.user;

    // === RBAC: Проверка доступа ===
    if(!hasAccess(user)){
      toast("Доступ запрещён", "Раздел доступен только офис-менеджерам и директорам", "err");
      location.hash = "#/welcome";
      return;
    }

    // Загрузка данных
    let items = [];
    try { items = await AsgardDB.all('correspondence'); } catch(e){}
    const users = await AsgardDB.all('users');
    const usersMap = new Map(users.map(u => [u.id, u]));

    // Текущий год
    const now = new Date();
    const currentYear = now.getFullYear();

    // Фильтры
    let filters = {
      year: currentYear,
      month: '',
      direction: '',
      docType: '',
      search: ''
    };

    function filterItems(){
      return items.filter(item => {
        const date = item.date ? new Date(item.date) : null;
        if(!date) return false;
        if(filters.year && date.getFullYear() !== Number(filters.year)) return false;
        if(filters.month !== '' && date.getMonth() !== Number(filters.month)) return false;
        if(filters.direction && item.direction !== filters.direction) return false;
        if(filters.docType && item.doc_type !== filters.docType) return false;
        if(filters.search){
          const s = filters.search.toLowerCase();
          const match = 
            (item.subject || '').toLowerCase().includes(s) ||
            (item.counterparty || '').toLowerCase().includes(s) ||
            (item.number || '').toLowerCase().includes(s);
          if(!match) return false;
        }
        return true;
      }).sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')));
    }

    function calcStats(list){
      const incoming = list.filter(i => i.direction === 'incoming').length;
      const outgoing = list.filter(i => i.direction === 'outgoing').length;
      const byType = {};
      DOC_TYPES.forEach(t => { byType[t.key] = 0; });
      list.forEach(i => {
        if(byType[i.doc_type] !== undefined) byType[i.doc_type]++;
      });
      return { incoming, outgoing, total: list.length, byType };
    }

    function renderPage(){
      const filtered = filterItems();
      const stats = calcStats(filtered);

      const body = `
        <style>
          /* Stage 16: Premium Viking UI */
          .corr-header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px; }
          .corr-header-actions { display:flex; gap:10px; }
          
          /* KPI Cards with Viking flair */
          .corr-kpi { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:24px; }
          .corr-kpi-card { 
            position:relative;
            background: linear-gradient(135deg, rgba(13,20,40,.6) 0%, rgba(13,20,40,.4) 100%);
            border: 1px solid rgba(242,208,138,.15);
            border-radius:16px; 
            padding:18px;
            overflow:hidden;
            transition: all .3s ease;
          }
          .corr-kpi-card::before {
            content:'';
            position:absolute;
            top:0; left:0; right:0;
            height:3px;
            background: linear-gradient(90deg, var(--red), var(--gold), var(--blue));
            opacity:.6;
          }
          .corr-kpi-card:hover {
            border-color: rgba(242,208,138,.35);
            transform: translateY(-2px);
            box-shadow: 0 12px 40px rgba(0,0,0,.3);
          }
          .corr-kpi-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:1.5px; font-weight:700; }
          .corr-kpi-value { font-size:32px; font-weight:900; color:var(--gold); margin-top:8px; text-shadow: 0 2px 10px rgba(242,208,138,.3); }
          .corr-kpi-icon { position:absolute; right:14px; top:50%; transform:translateY(-50%); font-size:42px; opacity:.15; }
          
          /* Filters bar */
          .corr-filters { 
            display:flex; flex-wrap:wrap; gap:12px; 
            margin-bottom:20px; padding:16px; 
            background: linear-gradient(135deg, rgba(13,20,40,.5), rgba(13,20,40,.3));
            border: 1px solid rgba(148,163,184,.12);
            border-radius:14px;
            align-items:flex-end;
          }
          .corr-filter { display:flex; flex-direction:column; gap:5px; min-width:140px; }
          .corr-filter label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; font-weight:700; }
          .corr-filter select, .corr-filter input { 
            padding:10px 14px; border-radius:10px; 
            border:1px solid rgba(148,163,184,.18); 
            background: rgba(13,20,40,.6); 
            color:var(--text); font-size:13px;
            transition: all .2s ease;
          }
          .corr-filter select:focus, .corr-filter input:focus {
            border-color: rgba(242,208,138,.4);
            box-shadow: 0 0 0 3px rgba(242,208,138,.1);
            outline:none;
          }
          
          /* Table with Viking styling */
          .corr-table { width:100%; border-collapse:separate; border-spacing:0 8px; }
          .corr-table th { 
            font-size:10px; color:var(--muted); font-weight:800; 
            text-align:left; padding:10px 14px; 
            text-transform:uppercase; letter-spacing:1px;
            border-bottom: 2px solid rgba(242,208,138,.2);
          }
          .corr-table td { 
            padding:14px; 
            background: linear-gradient(135deg, rgba(13,20,40,.5), rgba(13,20,40,.35));
            border:1px solid rgba(148,163,184,.1);
            transition: all .2s ease;
          }
          .corr-table tr td:first-child { border-radius:12px 0 0 12px; border-left:3px solid transparent; }
          .corr-table tr td:last-child { border-radius:0 12px 12px 0; }
          .corr-table tr:hover td { 
            background: rgba(59,130,246,.08);
            border-color: rgba(242,208,138,.2);
          }
          .corr-table tr:hover td:first-child { border-left-color: var(--gold); }
          
          /* Direction badge */
          .corr-dir { 
            display:inline-flex; align-items:center; gap:6px;
            padding:5px 10px; border-radius:8px; 
            font-size:11px; font-weight:700;
          }
          .corr-dir.incoming { background:rgba(59,130,246,.15); color:#60a5fa; }
          .corr-dir.outgoing { background:rgba(34,197,94,.15); color:#4ade80; }
          
          /* Type badge */
          .corr-type { font-size:12px; display:flex; align-items:center; gap:4px; }
          
          /* Number styling */
          .corr-number { 
            font-family:var(--mono); font-size:12px; font-weight:700;
            color:var(--gold); 
            background: rgba(242,208,138,.1);
            padding:3px 8px; border-radius:6px;
          }
          
          /* Subject */
          .corr-subject { font-weight:600; }
          .corr-counterparty { font-size:12px; color:var(--muted); margin-top:3px; }
          
          /* Date */
          .corr-date { color:var(--muted); font-size:12px; }
          
          /* Actions */
          .corr-actions { display:flex; gap:6px; }
          .corr-btn { 
            padding:6px 10px; border-radius:8px; 
            border:1px solid rgba(148,163,184,.18); 
            background: rgba(13,20,40,.5); 
            color:var(--text); font-size:12px; cursor:pointer;
            transition: all .2s ease;
          }
          .corr-btn:hover { 
            border-color: rgba(242,208,138,.4);
            transform: translateY(-1px);
          }
          
          /* Empty state */
          .corr-empty { 
            text-align:center; padding:60px 20px; 
            color:var(--muted);
            background: linear-gradient(135deg, rgba(13,20,40,.4), rgba(13,20,40,.2));
            border-radius:16px;
            border: 1px dashed rgba(148,163,184,.2);
          }
          .corr-empty-icon { font-size:64px; margin-bottom:16px; opacity:.5; }
          
          /* Count badge */
          .corr-count { font-size:13px; color:var(--muted); margin-bottom:12px; display:flex; align-items:center; gap:8px; }
          .corr-count::before { content:'ᚱ'; font-size:14px; color:var(--gold); opacity:.6; }
          
          /* Rune divider */
          .rune-divider {
            text-align:center;
            margin:20px 0;
            color: rgba(169,183,208,.3);
            font-size:12px;
            letter-spacing:8px;
          }
          
          /* Attachment placeholder */
          .corr-attach { 
            display:inline-flex; align-items:center; gap:6px;
            padding:4px 8px; border-radius:6px;
            background: rgba(100,116,139,.15);
            color: var(--muted);
            font-size:11px;
            cursor:not-allowed;
            opacity:.6;
          }
        </style>

        <div class="panel">
          <div class="corr-header">
            <div>
              <h2 class="page-title" style="margin:0">Корреспонденция</h2>
              <div class="help" style="margin-top:8px">Реестр входящих и исходящих документов</div>
            </div>
            <div class="corr-header-actions">
              <button class="btn" id="btnAddIncoming">📥 Входящее</button>
              <button class="btn" id="btnAddOutgoing">📤 Исходящее</button>
            </div>
          </div>

          <div class="corr-kpi">
            <div class="corr-kpi-card">
              <div class="corr-kpi-label">Всего документов</div>
              <div class="corr-kpi-value">${stats.total}</div>
              <div class="corr-kpi-icon">📋</div>
            </div>
            <div class="corr-kpi-card">
              <div class="corr-kpi-label">Входящие</div>
              <div class="corr-kpi-value" style="color:#60a5fa">${stats.incoming}</div>
              <div class="corr-kpi-icon">📥</div>
            </div>
            <div class="corr-kpi-card">
              <div class="corr-kpi-label">Исходящие</div>
              <div class="corr-kpi-value" style="color:#4ade80">${stats.outgoing}</div>
              <div class="corr-kpi-icon">📤</div>
            </div>
          </div>

          <div class="corr-filters">
            <div class="corr-filter">
              <label>Год</label>
              <select id="f_year">
                ${[currentYear, currentYear-1, currentYear-2].map(y => 
                  `<option value="${y}" ${filters.year == y ? 'selected' : ''}>${y}</option>`
                ).join('')}
              </select>
            </div>
            <div class="corr-filter">
              <label>Месяц</label>
              <select id="f_month">
                <option value="">Все</option>
                ${MONTHS.map((m, i) => `<option value="${i}" ${filters.month === String(i) ? 'selected' : ''}>${m}</option>`).join('')}
              </select>
            </div>
            <div class="corr-filter">
              <label>Направление</label>
              <select id="f_direction">
                <option value="">Все</option>
                <option value="incoming" ${filters.direction === 'incoming' ? 'selected' : ''}>📥 Входящие</option>
                <option value="outgoing" ${filters.direction === 'outgoing' ? 'selected' : ''}>📤 Исходящие</option>
              </select>
            </div>
            <div class="corr-filter">
              <label>Тип</label>
              <select id="f_docType">
                <option value="">Все</option>
                ${DOC_TYPES.map(t => `<option value="${t.key}" ${filters.docType === t.key ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}
              </select>
            </div>
            <div class="corr-filter" style="flex:1; min-width:200px">
              <label>Поиск</label>
              <input id="f_search" placeholder="Тема, контрагент, номер..." value="${esc(filters.search)}"/>
            </div>
          </div>

          <div class="corr-count">Найдено: ${filtered.length} документов</div>

          ${filtered.length ? `
            <table class="corr-table">
              <thead>
                <tr>
                  <th style="width:100px">Направление</th>
                  <th style="width:90px">Дата</th>
                  <th style="width:130px">Номер</th>
                  <th>Тема / Контрагент</th>
                  <th style="width:100px">Тип</th>
                  <th style="width:80px"></th>
                </tr>
              </thead>
              <tbody>
                ${filtered.slice(0, 50).map(item => {
                  const dir = DIRECTIONS[item.direction] || DIRECTIONS.incoming;
                  const dtype = getDocTypeInfo(item.doc_type);
                  const creator = usersMap.get(Number(item.created_by));
                  
                  return `
                    <tr data-id="${item.id}">
                      <td><span class="corr-dir ${item.direction}">${dir.icon} ${dir.label}</span></td>
                      <td class="corr-date">${esc(item.date || '—')}</td>
                      <td><span class="corr-number">${esc(item.number || '—')}</span></td>
                      <td>
                        <div class="corr-subject">${esc(item.subject || 'Без темы')}</div>
                        <div class="corr-counterparty">${esc(item.counterparty || '—')}</div>
                      </td>
                      <td class="corr-type">${dtype.icon} ${dtype.label}</td>
                      <td>
                        <div class="corr-actions">
                          <button class="corr-btn" data-view="${item.id}">👁</button>
                          <button class="corr-btn" data-edit="${item.id}">✎</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
            ${filtered.length > 50 ? `<div class="help" style="text-align:center; margin-top:12px">Показано 50 из ${filtered.length}. Уточните фильтры.</div>` : ''}
          ` : `
            <div class="corr-empty">
              <div class="corr-empty-icon">📬</div>
              <div style="font-size:18px; font-weight:700; margin-bottom:8px">Нет документов</div>
              <div>Добавьте входящий или исходящий документ</div>
            </div>
          `}
          
          <div class="rune-divider">ᚱ ᚨ ᚷ ᚾ ᚨ ᚱ</div>
        </div>
      `;

      layout(body, { title: title || "Корреспонденция" }).then(bindEvents);
    }

    function bindEvents(){
      // Фильтры
      $('#f_year')?.addEventListener('change', e => { filters.year = e.target.value; renderPage(); });
      $('#f_month')?.addEventListener('change', e => { filters.month = e.target.value; renderPage(); });
      $('#f_direction')?.addEventListener('change', e => { filters.direction = e.target.value; renderPage(); });
      $('#f_docType')?.addEventListener('change', e => { filters.docType = e.target.value; renderPage(); });
      $('#f_search')?.addEventListener('input', e => { filters.search = e.target.value; renderPage(); });

      // Добавить входящее
      $('#btnAddIncoming')?.addEventListener('click', () => openAddModal('incoming'));
      
      // Добавить исходящее
      $('#btnAddOutgoing')?.addEventListener('click', () => openAddModal('outgoing'));

      // Просмотр
      $$('[data-view]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.view);
          const item = await AsgardDB.get('correspondence', id);
          if(item) openViewModal(item);
        });
      });

      // Редактирование
      $$('[data-edit]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.edit);
          const item = await AsgardDB.get('correspondence', id);
          if(item) openEditModal(item);
        });
      });
    }

    async function openAddModal(direction){
      const isOutgoing = direction === 'outgoing';
      const autoNumber = isOutgoing ? await generateOutgoingNumber() : '';
      const dir = DIRECTIONS[direction];

      const html = `
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px">
          <span style="font-size:24px">${dir.icon}</span>
          <span style="font-weight:700">${dir.label} документ</span>
        </div>
        <div class="formrow">
          <div><label>Дата</label><input id="corr_date" type="date" value="${today()}"/></div>
          <div>
            <label>Номер ${isOutgoing ? '(авто: АС-ИСХ-ГГГГ-NNNNNN)' : ''}</label>
            <input id="corr_number" value="${esc(autoNumber)}" ${isOutgoing ? 'readonly style="background:rgba(212,175,55,.15);color:#D4AF37;font-weight:600"' : ''}/>
          </div>
          <div><label>Тип документа</label>
            <select id="corr_type">
              ${DOC_TYPES.map(t => `<option value="${t.key}">${t.icon} ${t.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Тема</label><input id="corr_subject" placeholder="О чём документ..."/></div>
        </div>
        <div class="formrow">
          <div><label>${isOutgoing ? 'Получатель' : 'Отправитель'}</label><input id="corr_counterparty" placeholder="Организация или ФИО"/></div>
          <div><label>Контактное лицо</label><input id="corr_contact" placeholder="ФИО"/></div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Примечание</label><textarea id="corr_note" rows="2" placeholder="Дополнительная информация..."></textarea></div>
        </div>
        <div style="margin-top:12px">
          <button class="btn ghost" disabled style="opacity:0.5;cursor:not-allowed">📎 Добавить вложение</button>
          <span class="help" style="margin-left:8px">Доступно в серверной версии</span>
        </div>
        <hr class="hr"/>
        <div style="display:flex; gap:10px">
          <button class="btn" id="btnSaveCorr">Сохранить</button>
        </div>
      `;

      showModal(`Новый документ`, html);

      $('#btnSaveCorr')?.addEventListener('click', async () => {
        const subject = $('#corr_subject')?.value?.trim();
        if(!subject){ toast('Ошибка', 'Укажите тему документа', 'err'); return; }

        const item = {
          direction,
          date: $('#corr_date')?.value || today(),
          number: $('#corr_number')?.value?.trim() || '',
          doc_type: $('#corr_type')?.value || 'letter',
          subject,
          counterparty: $('#corr_counterparty')?.value?.trim() || '',
          contact_person: $('#corr_contact')?.value?.trim() || '',
          note: $('#corr_note')?.value?.trim() || '',
          created_by: user.id,
          created_at: isoNow(),
          updated_at: isoNow()
        };

        const id = await AsgardDB.add('correspondence', item);
        
        // Аудит: создание документа
        await audit(user.id, 'create', id, {
          direction: item.direction,
          number: item.number,
          subject: item.subject,
          counterparty: item.counterparty
        });
        
        toast('Документ', 'Успешно добавлен');
        items = await AsgardDB.all('correspondence');
        renderPage();
      });
    }

    function openEditModal(item){
      const isOutgoing = item.direction === 'outgoing';
      const dir = DIRECTIONS[item.direction];

      const html = `
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px">
          <span style="font-size:24px">${dir.icon}</span>
          <span style="font-weight:700">${dir.label} #${item.id}</span>
        </div>
        <div class="formrow">
          <div><label>Дата</label><input id="corr_date" type="date" value="${item.date || ''}"/></div>
          <div><label>Номер</label><input id="corr_number" value="${esc(item.number || '')}"/></div>
          <div><label>Тип документа</label>
            <select id="corr_type">
              ${DOC_TYPES.map(t => `<option value="${t.key}" ${item.doc_type === t.key ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Тема</label><input id="corr_subject" value="${esc(item.subject || '')}"/></div>
        </div>
        <div class="formrow">
          <div><label>${isOutgoing ? 'Получатель' : 'Отправитель'}</label><input id="corr_counterparty" value="${esc(item.counterparty || '')}"/></div>
          <div><label>Контактное лицо</label><input id="corr_contact" value="${esc(item.contact_person || '')}"/></div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Примечание</label><textarea id="corr_note" rows="2">${esc(item.note || '')}</textarea></div>
        </div>
        <div style="margin-top:12px">
          <span class="corr-attach">📎 + Добавить вложение (скоро)</span>
        </div>
        <hr class="hr"/>
        <div style="display:flex; gap:10px; justify-content:space-between">
          <button class="btn" id="btnUpdateCorr">Сохранить изменения</button>
          <button class="btn red" id="btnDeleteCorr">Удалить</button>
        </div>
      `;

      showModal(`Редактировать документ`, html);

      $('#btnUpdateCorr')?.addEventListener('click', async () => {
        const subject = $('#corr_subject')?.value?.trim();
        if(!subject){ toast('Ошибка', 'Укажите тему документа', 'err'); return; }

        const oldNumber = item.number;
        const newNumber = $('#corr_number')?.value?.trim() || '';
        
        item.date = $('#corr_date')?.value || today();
        item.number = newNumber;
        item.doc_type = $('#corr_type')?.value || 'letter';
        item.subject = subject;
        item.counterparty = $('#corr_counterparty')?.value?.trim() || '';
        item.contact_person = $('#corr_contact')?.value?.trim() || '';
        item.note = $('#corr_note')?.value?.trim() || '';
        item.updated_at = isoNow();
        item.updated_by = user.id;

        await AsgardDB.put('correspondence', item);
        
        // Аудит: обновление документа
        const changes = { subject: item.subject, counterparty: item.counterparty };
        
        // Отдельный аудит при присвоении номера исходящему
        if(item.direction === 'outgoing' && newNumber && newNumber !== oldNumber){
          await audit(user.id, 'assign_number', item.id, {
            old_number: oldNumber || null,
            new_number: newNumber
          });
        }
        
        await audit(user.id, 'update', item.id, changes);
        
        toast('Документ', 'Обновлён');
        items = await AsgardDB.all('correspondence');
        renderPage();
      });

      $('#btnDeleteCorr')?.addEventListener('click', async () => {
        if(!confirm('Удалить документ?')) return;
        
        // Аудит: удаление
        await audit(user.id, 'delete', item.id, { subject: item.subject, number: item.number });
        
        await AsgardDB.del('correspondence', item.id);
        toast('Документ', 'Удалён');
        items = await AsgardDB.all('correspondence');
        renderPage();
      });
    }

    function openViewModal(item){
      const dir = DIRECTIONS[item.direction];
      const dtype = getDocTypeInfo(item.doc_type);
      const creator = usersMap.get(Number(item.created_by));
      const isOutgoing = item.direction === 'outgoing';

      const html = `
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px">
          <span style="font-size:32px">${dir.icon}</span>
          <div>
            <div style="font-weight:800; font-size:18px">${esc(item.subject || 'Без темы')}</div>
            <div style="color:var(--muted); font-size:13px">${dir.label} • ${dtype.icon} ${dtype.label}</div>
          </div>
        </div>
        
        <div class="formrow">
          <div><label>Номер</label><div class="corr-number" style="display:inline-block">${esc(item.number || '—')}</div></div>
          <div><label>Дата</label><div class="help">${esc(item.date || '—')}</div></div>
        </div>
        <hr class="hr"/>
        <div class="formrow">
          <div><label>${isOutgoing ? 'Получатель' : 'Отправитель'}</label><div class="help" style="font-weight:600">${esc(item.counterparty || '—')}</div></div>
          <div><label>Контактное лицо</label><div class="help">${esc(item.contact_person || '—')}</div></div>
        </div>
        ${item.note ? `
          <hr class="hr"/>
          <div><label>Примечание</label><div class="help">${esc(item.note)}</div></div>
        ` : ''}
        <hr class="hr"/>
        <div class="help" style="font-size:11px; color:var(--muted)">
          Создал: ${esc(creator?.name || '—')} • ${item.created_at ? new Date(item.created_at).toLocaleString('ru-RU') : '—'}
        </div>
      `;

      showModal(`Документ #${item.id}`, html);
    }

    renderPage();
  }

  return { render, generateOutgoingNumber };
})();
