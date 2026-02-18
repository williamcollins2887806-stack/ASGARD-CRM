// Stage 18: Жильё и авиабилеты
// Расходы на проживание и транспорт с привязкой к проекту/сотруднику

window.AsgardTravelPage = (function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;

  // Типы расходов
  const EXPENSE_TYPES = [
    { key: 'housing', label: 'Жильё', icon: '🏠', color: 'var(--info)' },
    { key: 'flight', label: 'Авиабилет', icon: '✈️', color: 'var(--purple)' },
    { key: 'train', label: 'Ж/Д билет', icon: '🚂', color: 'var(--cyan)' },
    { key: 'hotel', label: 'Гостиница', icon: '🏨', color: 'var(--amber)' },
    { key: 'transfer', label: 'Трансфер', icon: '🚐', color: 'var(--ok)' }
  ];

  function isoNow(){ return new Date().toISOString(); }
  function today(){ return new Date().toISOString().slice(0,10); }

  function getTypeInfo(key){
    return EXPENSE_TYPES.find(t => t.key === key) || { label: key, icon: '💰', color: 'var(--t3)' };
  }

  function fmtMoney(n){
    return new Intl.NumberFormat('ru-RU', {style:'currency', currency:'RUB', maximumFractionDigits:0}).format(n||0);
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash = "#/login"; return; }
    const user = auth.user;

    // Роли с доступом
    const allowedRoles = ["ADMIN", "OFFICE_MANAGER", "HR", "PM", "DIRECTOR_COMM", "DIRECTOR_GEN", "DIRECTOR_DEV", "DIRECTOR"];
    if(!allowedRoles.includes(user.role)){
      toast("Доступ", "Раздел недоступен", "err");
      location.hash = "#/home";
      return;
    }

    // Загружаем данные
    let items = [];
    try { items = await AsgardDB.all('travel_expenses'); } catch(e){}
    
    const works = await AsgardDB.all('works');
    const employees = await AsgardDB.all('employees');
    const users = await AsgardDB.all('users');
    
    const worksMap = new Map(works.map(w => [w.id, w]));
    const employeesMap = new Map(employees.map(e => [e.id, e]));
    const usersMap = new Map(users.map(u => [u.id, u]));

    // Текущий год
    const currentYear = new Date().getFullYear();
    let filters = { year: currentYear, month: '', type: '', search: '' };

    function filterItems(){
      return items.filter(item => {
        const date = item.date ? new Date(item.date) : null;
        if(!date) return false;
        if(filters.year && date.getFullYear() !== Number(filters.year)) return false;
        if(filters.month !== '' && date.getMonth() !== Number(filters.month)) return false;
        if(filters.type && item.expense_type !== filters.type) return false;
        if(filters.search){
          const s = filters.search.toLowerCase();
          const work = worksMap.get(item.work_id);
          const emp = employeesMap.get(item.employee_id);
          const match = 
            (item.description || '').toLowerCase().includes(s) ||
            (item.supplier || '').toLowerCase().includes(s) ||
            (work?.work_title || '').toLowerCase().includes(s) ||
            (emp?.fio || '').toLowerCase().includes(s);
          if(!match) return false;
        }
        return true;
      }).sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')));
    }

    function calcStats(list){
      let total = 0;
      const byType = {};
      EXPENSE_TYPES.forEach(t => { byType[t.key] = 0; });
      list.forEach(item => {
        total += Number(item.amount) || 0;
        if(byType[item.expense_type] !== undefined){
          byType[item.expense_type] += Number(item.amount) || 0;
        }
      });
      return { total, count: list.length, byType };
    }

    function renderPage(){
      const filtered = filterItems();
      const stats = calcStats(filtered);

      const body = `
        <style>
          .travel-header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px; }
          
          .travel-kpi { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:24px; }
          .travel-kpi-card {
            position:relative;
            background: linear-gradient(135deg, rgba(13,20,40,.6), rgba(13,20,40,.4));
            border:1px solid rgba(148,163,184,.15);
            border-radius:6px;
            padding:16px;
            overflow:hidden;
            transition: all .3s ease;
          }
          .travel-kpi-card::before {
            content:'';
            position:absolute;
            top:0; left:0; right:0;
            height:3px;
            background: var(--card-accent, var(--gold));
            opacity:.6;
          }
          .travel-kpi-card:hover { transform:translateY(-2px); border-color:rgba(242,208,138,.3); }
          .travel-kpi-label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; font-weight:700; }
          .travel-kpi-value { font-size:24px; font-weight:900; margin-top:6px; }
          .travel-kpi-icon { position:absolute; right:12px; top:50%; transform:translateY(-50%); font-size:32px; opacity:.2; }
          
          .travel-filters {
            display:flex; flex-wrap:wrap; gap:12px;
            margin-bottom:20px; padding:16px;
            background:rgba(13,20,40,.4);
            border:1px solid rgba(148,163,184,.1);
            border-radius:6px;
            align-items:flex-end;
          }
          .travel-filter { display:flex; flex-direction:column; gap:4px; min-width:130px; }
          .travel-filter label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; font-weight:700; }
          .travel-filter select, .travel-filter input {
            padding:10px 12px; border-radius:6px;
            border:1px solid rgba(148,163,184,.18);
            background:rgba(13,20,40,.6);
            color:var(--text); font-size:13px;
          }
          
          .travel-table { width:100%; border-collapse:separate; border-spacing:0 8px; }
          .travel-table th {
            font-size:10px; color:var(--muted); font-weight:800;
            text-align:left; padding:10px 12px;
            text-transform:uppercase; letter-spacing:1px;
          }
          .travel-table td {
            padding:14px 12px;
            background:linear-gradient(135deg, rgba(13,20,40,.5), rgba(13,20,40,.35));
            border:1px solid rgba(148,163,184,.1);
            transition: all .2s ease;
          }
          .travel-table tr td:first-child { border-radius:6px 0 0 6px; }
          .travel-table tr td:last-child { border-radius:0 6px 6px 0; }
          .travel-table tr:hover td { background:rgba(59,130,246,.08); border-color:rgba(242,208,138,.2); }
          
          .travel-type {
            display:inline-flex; align-items:center; gap:6px;
            padding:4px 10px; border-radius:6px;
            font-size:12px; font-weight:700;
          }
          
          .travel-amount { font-weight:800; color:var(--gold); font-size:15px; }
          
          .travel-link { color:var(--blue); font-size:12px; }
          .travel-link:hover { text-decoration:underline; }
          
          .travel-actions { display:flex; gap:6px; }
          .travel-btn {
            padding:6px 10px; border-radius:6px;
            border:1px solid rgba(148,163,184,.18);
            background:rgba(13,20,40,.5);
            color:var(--text); font-size:12px; cursor:pointer;
            transition: all .2s ease;
          }
          .travel-btn:hover { border-color:rgba(242,208,138,.4); }
          
          .travel-empty {
            text-align:center; padding:60px 20px;
            background:rgba(13,20,40,.3);
            border:1px dashed rgba(148,163,184,.2);
            border-radius:6px;
            color:var(--muted);
          }
          .travel-empty-icon { font-size:64px; margin-bottom:16px; opacity:.5; }
        </style>

        <div class="panel">
          <div class="travel-header">
            <div>
              <h2 class="page-title" style="margin:0">Жильё и билеты</h2>
              <div class="help" style="margin-top:8px">Расходы на проживание и транспорт сотрудников</div>
            </div>
            <button class="btn" id="btnAddTravel">➕ Добавить расход</button>
          </div>

          <div class="travel-kpi">
            <div class="travel-kpi-card" style="--card-accent:var(--gold-l)">
              <div class="travel-kpi-label">Всего расходов</div>
              <div class="travel-kpi-value" style="color:var(--gold)">${fmtMoney(stats.total)}</div>
              <div class="travel-kpi-icon">💰</div>
            </div>
            ${EXPENSE_TYPES.slice(0,4).map(t => {
              const amt = stats.byType[t.key] || 0;
              return `
                <div class="travel-kpi-card" style="--card-accent:${t.color}">
                  <div class="travel-kpi-label">${t.label}</div>
                  <div class="travel-kpi-value" style="color:${t.color}">${fmtMoney(amt)}</div>
                  <div class="travel-kpi-icon">${t.icon}</div>
                </div>
              `;
            }).join('')}
          </div>

          <div class="travel-filters">
            <div class="travel-filter">
              <label>Год</label>
              <select id="f_year">
                ${[currentYear, currentYear-1, currentYear-2].map(y => 
                  `<option value="${y}" ${filters.year == y ? 'selected' : ''}>${y}</option>`
                ).join('')}
              </select>
            </div>
            <div class="travel-filter">
              <label>Месяц</label>
              <select id="f_month">
                <option value="">Все</option>
                ${['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'].map((m,i) => 
                  `<option value="${i}">${m}</option>`
                ).join('')}
              </select>
            </div>
            <div class="travel-filter">
              <label>Тип</label>
              <select id="f_type">
                <option value="">Все</option>
                ${EXPENSE_TYPES.map(t => `<option value="${t.key}">${t.icon} ${t.label}</option>`).join('')}
              </select>
            </div>
            <div class="travel-filter" style="flex:1; min-width:180px">
              <label>Поиск</label>
              <input id="f_search" placeholder="Проект, сотрудник, описание..."/>
            </div>
          </div>

          <div class="help" style="margin-bottom:12px; color:var(--muted)">Найдено: ${filtered.length} записей</div>

          ${filtered.length ? `
            <table class="travel-table">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th>Дата</th>
                  <th>Сумма</th>
                  <th>Проект / Сотрудник</th>
                  <th>Описание</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${filtered.slice(0,50).map(item => {
                  const t = getTypeInfo(item.expense_type);
                  const work = worksMap.get(item.work_id);
                  const emp = employeesMap.get(item.employee_id);
                  
                  return `
                    <tr data-id="${item.id}">
                      <td>
                        <span class="travel-type" style="background:${t.color}22; color:${t.color}">
                          ${t.icon} ${t.label}
                        </span>
                      </td>
                      <td>${item.date || '—'}</td>
                      <td class="travel-amount">${fmtMoney(item.amount)}</td>
                      <td>
                        ${work ? `<a class="travel-link" href="#/pm-works?id=${work.id}">${esc(work.work_title || 'Проект #'+work.id)}</a>` : ''}
                        ${emp ? `<div style="font-size:12px; color:var(--muted)">${esc(emp.fio || '')}</div>` : ''}
                        ${!work && !emp ? '<span style="color:var(--muted)">—</span>' : ''}
                      </td>
                      <td style="max-width:200px">
                        <div style="font-size:13px">${esc(item.description || '—')}</div>
                        ${item.supplier ? `<div style="font-size:11px; color:var(--muted)">${esc(item.supplier)}</div>` : ''}
                      </td>
                      <td>
                        <div class="travel-actions">
                          <button class="travel-btn" data-edit="${item.id}">✎</button>
                          <button class="travel-btn" data-del="${item.id}">🗑</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
            ${filtered.length > 50 ? `<div class="help" style="text-align:center; margin-top:12px">Показано 50 из ${filtered.length}</div>` : ''}
          ` : `
            <div class="travel-empty">
              <div class="travel-empty-icon">🗺️</div>
              <div style="font-size:18px; font-weight:700; margin-bottom:8px">Нет расходов</div>
              <div>Добавьте расходы на жильё или билеты</div>
            </div>
          `}
        </div>
      `;

      layout(body, { title: title || "Жильё и билеты" }).then(bindEvents);
    }

    function bindEvents(){
      // Фильтры
      $('#f_year')?.addEventListener('change', e => { filters.year = e.target.value; renderPage(); });
      $('#f_month')?.addEventListener('change', e => { filters.month = e.target.value; renderPage(); });
      $('#f_type')?.addEventListener('change', e => { filters.type = e.target.value; renderPage(); });
      $('#f_search')?.addEventListener('input', e => { filters.search = e.target.value; renderPage(); });

      // Добавить
      $('#btnAddTravel')?.addEventListener('click', () => openEditModal(null));

      // Редактировать
      $$('[data-edit]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.edit);
          const item = items.find(x => x.id === id);
          if(item) openEditModal(item);
        });
      });

      // Удалить
      $$('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.del);
          if(!confirm('Удалить расход?')) return;
          await AsgardDB.del('travel_expenses', id);
          items = await AsgardDB.all('travel_expenses');
          toast('Удалено', 'Расход удалён');
          renderPage();
        });
      });
    }

    function openEditModal(item){
      const isNew = !item;
      const modalTitle = isNew ? 'Новый расход' : 'Редактирование';

      const html = `
        <div class="formrow">
          <div><label>Тип расхода</label>
            <select id="te_type">
              ${EXPENSE_TYPES.map(t => 
                `<option value="${t.key}" ${item?.expense_type === t.key ? 'selected' : ''}>${t.icon} ${t.label}</option>`
              ).join('')}
            </select>
          </div>
          <div><label>Дата</label><input type="date" id="te_date" value="${item?.date || today()}"/></div>
          <div><label>Сумма, ₽</label><input type="number" id="te_amount" value="${item?.amount || ''}" placeholder="0"/></div>
        </div>
        <div class="formrow">
          <div><label>Проект (работа)</label>
            <select id="te_work">
              <option value="">— Не привязано —</option>
              ${works.filter(w => w.work_status !== 'Работы сдали').map(w => 
                `<option value="${w.id}" ${item?.work_id === w.id ? 'selected' : ''}>${esc(w.work_title || 'Проект #'+w.id)}</option>`
              ).join('')}
            </select>
          </div>
          <div><label>Сотрудник</label>
            <select id="te_emp">
              <option value="">— Не привязано —</option>
              ${employees.map(e => 
                `<option value="${e.id}" ${item?.employee_id === e.id ? 'selected' : ''}>${esc(e.fio || 'Сотрудник #'+e.id)}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="formrow">
          <div style="grid-column:1/-1"><label>Описание</label>
            <input id="te_desc" value="${esc(item?.description || '')}" placeholder="Авиабилет Москва-Сочи, проживание 5 ночей..."/>
          </div>
        </div>
        <div class="formrow">
          <div><label>Поставщик / Агент</label><input id="te_supplier" value="${esc(item?.supplier || '')}" placeholder="Booking, Aviasales..."/></div>
          <div><label>№ документа</label><input id="te_doc" value="${esc(item?.doc_number || '')}" placeholder="Номер брони/билета"/></div>
        </div>
        <div class="formrow">
          <div><label>Период (с)</label><input type="date" id="te_from" value="${item?.date_from || ''}"/></div>
          <div><label>Период (по)</label><input type="date" id="te_to" value="${item?.date_to || ''}"/></div>
        </div>
        <hr class="hr"/>
        <div style="display:flex; gap:10px">
          <button class="btn" id="btnSaveTravel">${isNew ? 'Добавить' : 'Сохранить'}</button>
        </div>
      `;

      showModal(modalTitle, html);

      $('#btnSaveTravel')?.addEventListener('click', async () => {
        const amount = Number($('#te_amount')?.value) || 0;
        if(amount <= 0){ toast('Ошибка', 'Укажите сумму', 'err'); return; }

        const data = {
          expense_type: $('#te_type')?.value || 'housing',
          date: $('#te_date')?.value || today(),
          amount,
          work_id: Number($('#te_work')?.value) || null,
          employee_id: Number($('#te_emp')?.value) || null,
          description: $('#te_desc')?.value?.trim() || '',
          supplier: $('#te_supplier')?.value?.trim() || '',
          doc_number: $('#te_doc')?.value?.trim() || '',
          date_from: $('#te_from')?.value || null,
          date_to: $('#te_to')?.value || null,
          updated_at: isoNow()
        };

        if(isNew){
          data.created_by = user.id;
          data.created_at = isoNow();
          await AsgardDB.add('travel_expenses', data);
          toast('Добавлено', 'Расход сохранён');
        } else {
          Object.assign(item, data);
          await AsgardDB.put('travel_expenses', item);
          toast('Сохранено', 'Изменения сохранены');
        }

        items = await AsgardDB.all('travel_expenses');
        renderPage();
      });
    }

    renderPage();
  }

  return { render, EXPENSE_TYPES };
})();
