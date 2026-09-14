window.AsgardCalendarPage = (function(){
  const {$, $$, esc, toast, showModal, closeModal} = AsgardUI;

  const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const DAYS_RU = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const PICKER_ID = 'cal-event-participants';

  const EVENT_TYPES = [
    {code: 'meeting', label: 'Совещание', color: 'var(--blue-l)'},
    {code: 'call', label: 'Звонок', color: 'var(--purple)'},
    {code: 'visit', label: 'Встреча с клиентом', color: 'var(--ok)'},
    {code: 'deadline', label: 'Дедлайн', color: 'var(--red)'},
    {code: 'reminder', label: 'Напоминание', color: 'var(--amber)'},
    {code: 'other', label: 'Другое', color: 'var(--t2)'}
  ];

  const RSVP_LABEL = { pending: 'ожидает', accepted: 'принято', declined: 'отказ', tentative: 'возможно' };

  function authHeaders() {
    const tok = (window.AsgardAuth && typeof AsgardAuth.getToken === 'function' && AsgardAuth.getToken())
      || localStorage.getItem('asgard_token')
      || '';
    return { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
  }

  async function api(method, path, body) {
    const r = await fetch(path, {
      method,
      headers: authHeaders(),
      cache: 'no-store',
      body: body != null ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }

  function ymd(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function firstDayOfWeek(year, month) {
    const d = new Date(year, month, 1).getDay();
    return d === 0 ? 6 : d - 1;
  }

  function startOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const shift = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - shift);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function parseDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function eventTypeInfo(code) {
    return EVENT_TYPES.find(t => t.code === code) || EVENT_TYPES[5];
  }

  function defaultEnd(time) {
    const [h, m] = String(time || '10:00').split(':').map(Number);
    const endH = Math.min(23, (h || 10) + 1);
    return `${String(endH).padStart(2,'0')}:${String(m||0).padStart(2,'0')}`;
  }

  async function loadFeed(from, to) {
    const qs = new URLSearchParams({ date_from: from, date_to: to, limit: '1000' });
    const j = await api('GET', '/api/calendar/feed?' + qs.toString());
    return j.items || j.events || [];
  }

  async function loadUsers() {
    try {
      const j = await api('GET', '/api/users?limit=500&is_active=true');
      return (j.users || []).filter(u => u.is_active !== false && u.name);
    } catch {
      return (await AsgardDB.all('users') || []).filter(u => u.is_active !== false && u.name);
    }
  }

  // ── Persist via API ──────────────────────────────────────────
  async function savePersonal(event) {
    const body = {
      title: event.title,
      date: event.date,
      time: event.time || '10:00',
      end_time: event.end_time || null,
      type: event.type || 'other',
      description: event.description || '',
      location: event.location || '',
      reminder_minutes: Number(event.reminder_minutes) || 0,
      participants: event.participants || null,
      recurrence: event.recurrence || null
    };
    if (event.id && !String(event.id).startsWith('m-')) {
      return api('PUT', '/api/calendar/' + event.id, body);
    }
    return api('POST', '/api/calendar', body);
  }

  async function saveMeeting(payload) {
    if (payload.meeting_id) {
      return api('PUT', '/api/meetings/' + payload.meeting_id, payload);
    }
    return api('POST', '/api/meetings', payload);
  }

  async function deleteItem(item) {
    if (item.source === 'meeting' || item.meeting_id) {
      await api('DELETE', '/api/meetings/' + (item.meeting_id || item.id));
    } else {
      await api('DELETE', '/api/calendar/' + item.id);
    }
  }

  function collectGuestsFromDom() {
    const rows = $$('#ev_guests_list .cal-guest-row');
    const out = [];
    rows.forEach(row => {
      const email = row.querySelector('[data-g=email]')?.value?.trim().toLowerCase();
      const name = row.querySelector('[data-g=name]')?.value?.trim() || null;
      if (email && email.includes('@')) out.push({ email, name });
    });
    return out;
  }

  function addGuestRow(listEl, guest) {
    const div = document.createElement('div');
    div.className = 'cal-guest-row formrow';
    div.style.cssText = 'grid-template-columns:1fr 1.2fr auto;gap:8px;align-items:end';
    div.innerHTML = `
      <div class="field"><label>Имя гостя</label>
        <input class="inp" data-g="name" value="${esc(guest?.name || '')}" placeholder="Иван" autocomplete="off"/></div>
      <div class="field"><label>Email *</label>
        <input class="inp" data-g="email" type="email" value="${esc(guest?.email || '')}" placeholder="guest@company.ru" autocomplete="off"/></div>
      <button type="button" class="btn ghost" data-g-remove title="Убрать">✕</button>`;
    div.querySelector('[data-g-remove]').addEventListener('click', () => div.remove());
    listEl.appendChild(div);
  }

  async function openEventModal(date, existingEvent = null) {
    return new Promise(async resolve => {
      const isEdit = !!existingEvent;
      const isMeeting = existingEvent && (existingEvent.source === 'meeting' || existingEvent.meeting_id);
      const ev = existingEvent || {
        date,
        time: '10:00',
        end_time: '11:00',
        type: 'meeting',
        title: '',
        description: '',
        location: '',
        conference_url: '',
        reminder_minutes: 30,
        recurrence_rule: 'NONE'
      };

      const timeStart = (ev.time || '10:00').toString().slice(0, 5);
      const timeEnd = (ev.end_time || defaultEnd(timeStart)).toString().slice(0, 5);
      const meetingTypes = new Set(['meeting', 'call', 'visit']);

      const html = `
        <div class="stack cal-compose" style="gap:0">
          <div class="cal-tabs" style="margin-bottom:12px">
            <button type="button" class="cal-tab active" data-tab="main">Встреча</button>
            <button type="button" class="cal-tab" data-tab="planner">Подбор времени</button>
          </div>

          <div id="ev_invite_banner" class="cal-invite-banner">
            <div><span class="muted">Когда</span><br/><b id="ev_banner_when">${esc(timeStart)}–${esc(timeEnd)}</b></div>
            <div><span class="muted">Кто</span><br/><b id="ev_banner_who">только вы</b></div>
            <div><span class="muted">Где</span><br/><b id="ev_banner_where">${esc(ev.conference_url || ev.location || 'не указано')}</b></div>
          </div>

          <div data-panel="main">
            <div class="cal-compose-section">
              <span class="cal-compose-label">Суть</span>
              <div class="field">
                <input id="ev_title" class="inp" value="${esc(ev.title || '')}" placeholder="Например: ВКС ТАБЕЛЬ" autocomplete="off" style="font-size:16px;font-weight:650"/>
              </div>
              <div class="cal-type-pills" id="ev_type_pills" style="margin-top:10px">
                ${EVENT_TYPES.map(t => `<button type="button" class="cal-type-pill${(ev.type||'meeting')===t.code?' on':''}" data-type="${t.code}" style="--pill-color:${t.color}">${esc(t.label)}</button>`).join('')}
              </div>
              <input type="hidden" id="ev_type" value="${esc(ev.type || 'meeting')}"/>
            </div>

            <div class="cal-compose-section">
              <span class="cal-compose-label">Когда</span>
              <div class="formrow" style="grid-template-columns:1.2fr 1fr 1fr">
                <div class="field">
                  <label for="ev_date">Дата</label>
                  <input id="ev_date" type="date" class="inp" value="${esc((ev.date || date || '').toString().slice(0,10))}"/>
                </div>
                <div class="field">
                  <label for="ev_time">Начало</label>
                  <input id="ev_time" type="time" class="inp" value="${esc(timeStart)}"/>
                </div>
                <div class="field">
                  <label for="ev_end">Конец</label>
                  <input id="ev_end" type="time" class="inp" value="${esc(timeEnd)}"/>
                </div>
              </div>
              <div class="cal-duration-hint" id="ev_duration_hint"></div>
              <div class="formrow" style="grid-template-columns:1fr 1fr;margin-top:10px">
                <div class="field"><label>Напоминание</label><div id="ev_reminder_w"></div></div>
                <div class="field"><label>Повтор</label><div id="ev_recur_w"></div></div>
              </div>
            </div>

            <div class="cal-compose-section">
              <span class="cal-compose-label">Где</span>
              <div class="formrow" style="grid-template-columns:1fr 1.2fr">
                <div class="field">
                  <label for="ev_location">Место</label>
                  <input id="ev_location" class="inp" value="${esc(ev.location || '')}" placeholder="Переговорная / адрес"/>
                </div>
                <div class="field">
                  <label for="ev_conference">Ссылка ВКС</label>
                  <div class="cal-vcs-field">
                    <input id="ev_conference" class="inp" value="${esc(ev.conference_url || '')}" placeholder="https://telemost… / zoom…"/>
                  </div>
                </div>
              </div>
            </div>

            <div class="cal-compose-section">
              <span class="cal-compose-label">Кто</span>
              <div class="field" style="margin-bottom:12px">
                <label>Сотрудники CRM</label>
                <div id="ev_picker_wrap"></div>
              </div>
              <div class="field">
                <div class="row between" style="align-items:center;margin-bottom:6px">
                  <label style="margin:0">Гости по email</label>
                  <button type="button" class="btn ghost" id="ev_add_guest">+ Гость</button>
                </div>
                <div id="ev_guests_list"></div>
                <div class="cal-guest-empty" id="ev_guests_empty">Клиенты и подрядчики без логина в CRM</div>
              </div>
            </div>

            <div class="cal-compose-section">
              <span class="cal-compose-label">Детали</span>
              <div class="field">
                <textarea id="ev_desc" class="inp" rows="3" placeholder="Повестка, материалы, что подготовить…">${esc(ev.description || '')}</textarea>
              </div>
              <label class="cal-send-toggle" style="margin-top:12px">
                <input type="checkbox" id="ev_send" checked/>
                <div>
                  <strong>Отправить приглашения</strong>
                  <span>Письмо с файлом ICS + уведомление в CRM и Telegram</span>
                </div>
              </label>
              ${isMeeting ? `<div class="cal-rsvp-bar" style="margin-top:12px">
                <span class="muted">Ваш ответ:</span>
                <b>${esc(RSVP_LABEL[ev.my_rsvp] || ev.my_rsvp || 'ожидает')}</b>
                <button type="button" class="cal-rsvp-btn" data-rsvp="accepted">Приму</button>
                <button type="button" class="cal-rsvp-btn" data-rsvp="tentative">Возможно</button>
                <button type="button" class="cal-rsvp-btn" data-rsvp="declined">Отказ</button>
              </div>` : ''}
            </div>
          </div>

          <div data-panel="planner" style="display:none">
            <div class="cal-compose-section">
              <span class="cal-compose-label">Общее окно</span>
              <div class="muted" style="margin-bottom:10px">Сначала выберите сотрудников на вкладке «Встреча». Сетка — занятость на день, слоты ниже — где свободны все.</div>
              <div class="formrow" style="grid-template-columns:1fr 1fr 1fr auto">
                <div class="field"><label>День сетки</label><input type="date" class="inp" id="pl_from" value="${esc((ev.date || date || '').toString().slice(0,10))}"/></div>
                <div class="field"><label>Искать до</label><input type="date" class="inp" id="pl_to" value="${esc(ymd(addDays(new Date(ev.date || date || Date.now()), 7)))}"/></div>
                <div class="field"><label>Минут</label><input type="number" class="inp" id="pl_dur" value="60" min="15" step="15"/></div>
                <div class="field" style="justify-content:flex-end"><label>&nbsp;</label><button type="button" class="btn primary" id="pl_find">Найти</button></div>
              </div>
              <div id="pl_grid" class="cal-planner" style="margin-top:12px"></div>
              <div id="pl_slots" class="stack" style="gap:8px;margin-top:12px"></div>
            </div>
          </div>

          <div class="row" style="gap:10px;justify-content:flex-end;margin-top:16px;padding-top:12px;border-top:1px solid var(--line,var(--border))">
            ${isEdit ? `<button class="btn red" data-act="delete">Удалить</button>` : ''}
            <button class="btn ghost" data-act="cancel">Отмена</button>
            <button class="btn primary" data-act="save">${isEdit ? 'Сохранить' : 'Создать встречу'}</button>
          </div>
        </div>
      `;

      showModal({
        title: isEdit ? 'Редактировать событие' : 'Новое событие',
        html,
        wide: true,
        onMount: async () => {
          const reminderOpts = [
            {value:'0',label:'Без напоминания'},{value:'5',label:'За 5 минут'},
            {value:'15',label:'За 15 минут'},{value:'30',label:'За 30 минут'},
            {value:'60',label:'За 1 час'},{value:'1440',label:'За 1 день'}
          ];
          const recurOpts = [
            {value:'NONE',label:'Не повторять'},
            {value:'DAILY',label:'Каждый день'},
            {value:'WEEKLY',label:'Каждую неделю'},
            {value:'MONTHLY',label:'Каждый месяц'}
          ];

          $('#ev_reminder_w')?.appendChild(CRSelect.create({
            id: 'ev_reminder', options: reminderOpts,
            value: String(ev.reminder_minutes ?? 30), dropdownClass: 'z-modal'
          }));
          $('#ev_recur_w')?.appendChild(CRSelect.create({
            id: 'ev_recur', options: recurOpts,
            value: ev.recurrence_rule || 'NONE', dropdownClass: 'z-modal'
          }));

          $$('.cal-type-pill').forEach(pill => {
            pill.addEventListener('click', () => {
              $$('.cal-type-pill').forEach(p => p.classList.toggle('on', p === pill));
              if ($('#ev_type')) $('#ev_type').value = pill.dataset.type;
            });
          });

          const updateBanner = () => {
            const t0 = $('#ev_time')?.value || '10:00';
            const t1 = $('#ev_end')?.value || defaultEnd(t0);
            const d = $('#ev_date')?.value || '';
            if ($('#ev_banner_when')) $('#ev_banner_when').textContent = `${d} · ${t0}–${t1}`;
            const loc = ($('#ev_conference')?.value || $('#ev_location')?.value || 'не указано').trim();
            if ($('#ev_banner_where')) $('#ev_banner_where').textContent = loc || 'не указано';
            const ids = window.CREmployeePicker ? CREmployeePicker.getSelected(PICKER_ID) : [];
            const guestsN = collectGuestsFromDom().length;
            const parts = [];
            if (ids.length) parts.push(ids.length + ' сотр.');
            if (guestsN) parts.push(guestsN + ' гост.');
            if ($('#ev_banner_who')) $('#ev_banner_who').textContent = parts.length ? parts.join(' + ') : 'только вы';
            const empty = $('#ev_guests_empty');
            if (empty) empty.style.display = ($('#ev_guests_list')?.children?.length ? 'none' : '');
            // duration
            const [h0, m0] = t0.split(':').map(Number);
            const [h1, m1] = t1.split(':').map(Number);
            const mins = (h1 * 60 + m1) - (h0 * 60 + m0);
            const hint = $('#ev_duration_hint');
            if (hint) {
              hint.textContent = mins > 0
                ? `Длительность: ${mins >= 60 ? Math.floor(mins/60) + ' ч ' : ''}${mins % 60 ? (mins % 60) + ' мин' : ''}`.trim()
                : 'Конец раньше начала — проверьте время';
              hint.style.color = mins > 0 ? '' : 'var(--red, var(--err))';
            }
          };
          ['ev_date','ev_time','ev_end','ev_location','ev_conference'].forEach(id => {
            $('#'+id)?.addEventListener('input', updateBanner);
            $('#'+id)?.addEventListener('change', updateBanner);
          });

          const users = await loadUsers();
          const wrap = $('#ev_picker_wrap');
          if (wrap && window.CREmployeePicker) {
            CREmployeePicker.destroy(PICKER_ID);
            const pickerEl = CREmployeePicker.create({
              id: PICKER_ID,
              employees: users.map(u => ({
                id: u.id,
                name: u.name || u.login,
                position: u.role || '',
                role: u.role || ''
              })),
              selected: ev._participant_ids || [],
              placeholder: 'Выберите участников…',
              showChips: true,
              maxChips: 5,
              fullWidth: true,
              title: 'Участники встречи',
              onChange: updateBanner
            });
            wrap.appendChild(pickerEl);
          }

          // Load existing meeting participants/guests
          if (isMeeting && ev.meeting_id) {
            try {
              const det = await api('GET', '/api/meetings/' + ev.meeting_id);
              const pids = (det.participants || []).map(p => p.user_id).filter(Boolean);
              if (window.CREmployeePicker) CREmployeePicker.setSelected(PICKER_ID, pids);
              (det.guests || []).forEach(g => addGuestRow($('#ev_guests_list'), g));
              updateBanner();
            } catch (_) { /* ignore */ }
          }

          $('#ev_add_guest')?.addEventListener('click', () => {
            addGuestRow($('#ev_guests_list'));
            updateBanner();
          });
          updateBanner();

          // Tabs
          $$('.cal-tab').forEach(tab => {
            tab.addEventListener('click', () => {
              $$('.cal-tab').forEach(t => t.classList.remove('active'));
              tab.classList.add('active');
              const name = tab.dataset.tab;
              $$('[data-panel]').forEach(p => {
                p.style.display = p.dataset.panel === name ? '' : 'none';
              });
            });
          });

          // RSVP buttons
          $$('[data-rsvp]').forEach(btn => {
            btn.addEventListener('click', async () => {
              if (!ev.meeting_id) return;
              try {
                await api('PUT', `/api/meetings/${ev.meeting_id}/rsvp`, { status: btn.dataset.rsvp });
                toast('Готово', 'Ответ сохранён', 'ok');
              } catch (e) {
                toast('Ошибка', e.message, 'err');
              }
            });
          });

          // Planner
          $('#pl_find')?.addEventListener('click', async () => {
            const ids = window.CREmployeePicker ? CREmployeePicker.getSelected(PICKER_ID) : [];
            if (!ids.length) {
              toast('Участники', 'Сначала выберите сотрудников', 'err');
              return;
            }
            const from = $('#pl_from')?.value;
            const to = $('#pl_to')?.value;
            const dur = parseInt($('#pl_dur')?.value || '60', 10);
            $('#pl_slots').innerHTML = '<div class="muted">Ищем…</div>';
            try {
              const avail = await api('GET',
                `/api/calendar/availability?user_ids=${ids.join(',')}&from=${from}&to=${to}`);
              renderPlannerGrid($('#pl_grid'), ids, users, avail, from, to);

              const found = await api('POST', '/api/calendar/find-time', {
                user_ids: ids,
                duration_minutes: dur,
                window_from: from + 'T00:00:00+03:00',
                window_to: to + 'T23:59:59+03:00',
                allow_missing: 0
              });
              const slots = found.slots || [];
              if (!slots.length) {
                $('#pl_slots').innerHTML = '<div class="cal-empty"><strong>Общих окон нет</strong>Расширьте даты или уберите занятого участника</div>';
                return;
              }
              $('#pl_slots').innerHTML = slots.slice(0, 12).map((s) => {
                const mskParts = (iso) => {
                  const fmt = new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Europe/Moscow',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', hour12: false
                  });
                  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
                  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
                };
                const a = mskParts(s.start);
                const b = mskParts(s.end);
                const label = `${a.date} · ${a.time}–${b.time}`;
                return `<button type="button" class="cal-slot-card" data-start="${esc(s.start)}" data-end="${esc(s.end)}">${esc(label)}<small>${s.blockers?.length ? 'с пропусками' : 'свободны все'}</small></button>`;
              }).join('');
              $$('.cal-slot-card').forEach(btn => {
                btn.addEventListener('click', () => {
                  const mskParts = (iso) => {
                    const fmt = new Intl.DateTimeFormat('en-GB', {
                      timeZone: 'Europe/Moscow',
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit', hour12: false
                    });
                    const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
                    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
                  };
                  const a = mskParts(btn.dataset.start);
                  const b = mskParts(btn.dataset.end);
                  if ($('#ev_date')) $('#ev_date').value = a.date;
                  if ($('#ev_time')) $('#ev_time').value = a.time;
                  if ($('#ev_end')) $('#ev_end').value = b.time;
                  updateBanner();
                  toast('Слот', 'Время подставлено в форму', 'ok');
                  $$('.cal-tab')[0]?.click();
                });
              });
            } catch (e) {
              $('#pl_slots').innerHTML = `<div class="muted">Ошибка: ${esc(e.message)}</div>`;
            }
          });

          $('#ev_title')?.focus();

          $$('[data-act]').forEach(btn => {
            btn.addEventListener('click', async () => {
              const act = btn.dataset.act;
              if (act === 'cancel') {
                if (window.CREmployeePicker) CREmployeePicker.destroy(PICKER_ID);
                closeModal();
                resolve(null);
                return;
              }
              if (act === 'delete') {
                if (!confirm('Удалить событие? Участникам уйдёт отмена.')) return;
                try {
                  await deleteItem(ev);
                  if (window.CREmployeePicker) CREmployeePicker.destroy(PICKER_ID);
                  closeModal();
                  resolve({ action: 'deleted' });
                } catch (e) {
                  toast('Ошибка', e.message, 'err');
                }
                return;
              }

              const title = ($('#ev_title')?.value || '').trim();
              if (!title) { toast('Ошибка', 'Введите название', 'err'); return; }
              const dateVal = $('#ev_date')?.value || date;
              const timeVal = $('#ev_time')?.value || '10:00';
              const endVal = $('#ev_end')?.value || defaultEnd(timeVal);
              const type = $('#ev_type')?.value || 'meeting';
              const reminder = parseInt(CRSelect.getValue('ev_reminder') || '30', 10);
              const recur = CRSelect.getValue('ev_recur') || 'NONE';
              const location = $('#ev_location')?.value || '';
              const conference = $('#ev_conference')?.value || '';
              const description = $('#ev_desc')?.value || '';
              const sendInvites = !!$('#ev_send')?.checked;
              const participantIds = window.CREmployeePicker ? CREmployeePicker.getSelected(PICKER_ID) : [];
              const guests = collectGuestsFromDom();

              const asMeeting = meetingTypes.has(type) && (participantIds.length > 0 || guests.length > 0 || isMeeting);

              try {
                btn.disabled = true;
                if (asMeeting) {
                  const startISO = `${dateVal}T${timeVal}:00`;
                  const endISO = `${dateVal}T${endVal}:00`;
                  const payload = {
                    title,
                    description,
                    location: location || null,
                    conference_url: conference || null,
                    start_time: startISO,
                    end_time: endISO,
                    participant_ids: participantIds,
                    guests,
                    send_invites: sendInvites,
                    notify_before_minutes: reminder || 15,
                    recurrence_rule: recur
                  };
                  if (isMeeting && ev.meeting_id) {
                    payload.meeting_id = ev.meeting_id;
                    await saveMeeting(payload);
                  } else {
                    await saveMeeting(payload);
                  }
                } else {
                  await savePersonal({
                    id: isEdit && !isMeeting ? ev.id : undefined,
                    title, date: dateVal, time: timeVal, end_time: endVal,
                    type, description, location: location || conference,
                    reminder_minutes: reminder,
                    participants: null,
                    recurrence: recur === 'NONE' ? null : recur
                  });
                }
                if (window.CREmployeePicker) CREmployeePicker.destroy(PICKER_ID);
                closeModal();
                resolve({ action: 'saved' });
              } catch (e) {
                btn.disabled = false;
                toast('Ошибка', e.message, 'err');
              }
            });
          });
        }
      });
    });
  }

  function renderPlannerGrid(el, ids, users, avail, from, to) {
    if (!el) return;
    const byId = new Map(users.map(u => [u.id, u]));
    const day = from; // heat for selected day
    // 9:00–18:00 step 30 → 18 cells
    const slots = [];
    for (let m = 9 * 60; m < 18 * 60; m += 30) {
      slots.push({ mins: m, label: `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}` });
    }
    const head = `<div class="cal-heat-head"><div>Сотрудник</div>${slots.map(s => `<div>${s.label}</div>`).join('')}</div>`;
    const rows = ids.map(id => {
      const name = byId.get(id)?.name || ('#' + id);
      const blocks = ((avail.users && avail.users[id]) || []).map(b => ({
        start: new Date(b.start).getTime(),
        end: new Date(b.end).getTime(),
        kind: b.kind
      }));
      const cells = slots.map(s => {
        const start = new Date(`${day}T${s.label}:00+03:00`).getTime();
        const end = start + 30 * 60000;
        const hit = blocks.find(b => start < b.end && b.start < end);
        let cls = 'free';
        if (hit) {
          if (hit.kind === 'day_off' || hit.kind === 'leave') cls = 'off';
          else if (hit.kind === 'offsite') cls = 'partial';
          else cls = 'busy';
        }
        return `<div class="cal-heat-cell ${cls}" data-uid="${id}" data-time="${s.label}" data-date="${day}" title="${esc(name)} ${s.label}"></div>`;
      }).join('');
      return `<div class="cal-heat-row"><div class="cal-heat-name" title="${esc(name)}">${esc(name)}</div>${cells}</div>`;
    }).join('');
    el.innerHTML = `<div class="muted" style="margin-bottom:8px">Сетка занятости · ${esc(day)} (зелёный — свободен)</div><div class="cal-heat">${head}${rows || ''}</div>`;
    el.querySelectorAll('.cal-heat-cell.free').forEach(cell => {
      cell.addEventListener('click', () => {
        const t0 = cell.dataset.time;
        const [hh, mm] = t0.split(':').map(Number);
        const endM = hh * 60 + mm + (parseInt($('#pl_dur')?.value || '60', 10));
        const t1 = `${String(Math.floor(endM/60)).padStart(2,'0')}:${String(endM%60).padStart(2,'0')}`;
        if ($('#ev_date')) $('#ev_date').value = cell.dataset.date;
        if ($('#ev_time')) $('#ev_time').value = t0;
        if ($('#ev_end')) $('#ev_end').value = t1;
        if ($('#pl_from')) $('#pl_from').value = cell.dataset.date;
        toast('Слот', `${t0}–${t1} подставлено`, 'ok');
      });
    });
  }

  function eventTopPx(time, hourStart, rowH) {
    const [h, m] = String(time || '09:00').slice(0,5).split(':').map(Number);
    return ((h - hourStart) * 60 + (m || 0)) / 60 * rowH;
  }
  function eventHeightPx(time, endTime, rowH) {
    const [h0, m0] = String(time || '09:00').slice(0,5).split(':').map(Number);
    let [h1, m1] = String(endTime || '').slice(0,5).split(':').map(Number);
    if (Number.isNaN(h1)) { h1 = h0 + 1; m1 = m0; }
    const mins = Math.max(30, (h1 * 60 + (m1 || 0)) - (h0 * 60 + (m0 || 0)));
    return mins / 60 * rowH;
  }

  // ── Views ────────────────────────────────────────────────────
  function renderMonthGrid(year, month, events, todayYmd) {
    const numDays = daysInMonth(year, month);
    const firstDay = firstDayOfWeek(year, month);
    const byDate = {};
    events.forEach(e => {
      const k = String(e.date).slice(0, 10);
      (byDate[k] = byDate[k] || []).push(e);
    });
    let cells = [];
    for (let i = 0; i < firstDay; i++) cells.push('<div class="cal-day empty"></div>');
    for (let d = 1; d <= numDays; d++) {
      const dateYmd = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = dateYmd === todayYmd;
      const dayEvents = byDate[dateYmd] || [];
      const isWeekend = ((firstDay + d - 1) % 7) >= 5;
      const eventsHtml = dayEvents.slice(0, 3).map(e => {
        const type = eventTypeInfo(e.type);
        const badge = e.source === 'meeting'
          ? '<span class="cal-badge-meeting">встреча</span>'
          : '<span class="cal-badge-personal">личное</span>';
        return `<div class="cal-event" style="--event-color:${type.color}" data-id="${esc(String(e.id))}" data-source="${esc(e.source || 'event')}" title="${esc(e.title)}">
          <span class="cal-event-time">${esc(e.time || '')}</span>
          ${badge}<span class="cal-event-title">${esc(e.title)}</span>
        </div>`;
      }).join('');
      const more = dayEvents.length > 3 ? `<div class="cal-more">+${dayEvents.length - 3} ещё</div>` : '';
      cells.push(`<div class="cal-day${isToday?' today':''}${isWeekend?' weekend':''}" data-date="${dateYmd}">
        <div class="cal-day-num">${d}</div>
        <div class="cal-day-events">${eventsHtml}${more}</div>
      </div>`);
    }
    while (cells.length % 7) cells.push('<div class="cal-day empty"></div>');
    return cells.join('');
  }

  function renderWeekGrid(cursor, events) {
    const start = startOfWeek(cursor);
    const hourStart = 8;
    const hourEnd = 21;
    const rowH = 48;
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDays(start, i));
    const todayKey = ymd(new Date());
    const now = new Date();
    const showNow = days.some(d => ymd(d) === todayKey);

    const head = `<div class="cal-week-cols"><div></div>${
      days.map(d => {
        const key = ymd(d);
        return `<div class="cal-week-dayhead${key===todayKey?' today':''}">${DAYS_RU[(d.getDay()+6)%7]}<span class="dnum">${d.getDate()}</span></div>`;
      }).join('')
    }</div>`;

    const gutters = Array.from({length: hourEnd - hourStart}, (_, i) => {
      const h = hourStart + i;
      return `<div style="height:${rowH}px;line-height:${rowH}px">${String(h).padStart(2,'0')}:00</div>`;
    }).join('');

    const cols = days.map(d => {
      const key = ymd(d);
      const dayEvents = events.filter(e => String(e.date).slice(0,10) === key);
      const blocks = dayEvents.map(e => {
        const type = eventTypeInfo(e.type);
        const top = Math.max(0, eventTopPx(e.time, hourStart, rowH));
        const height = Math.min(eventHeightPx(e.time, e.end_time, rowH), (hourEnd - hourStart) * rowH - top);
        return `<div class="cal-week-block" style="top:${top}px;height:${height}px;--event-color:${type.color}" data-id="${esc(String(e.id))}" data-source="${esc(e.source||'event')}">
          <span class="t">${esc(String(e.time||'').slice(0,5))}${e.end_time ? '–' + esc(String(e.end_time).slice(0,5)) : ''}</span>
          ${esc(e.title)}
        </div>`;
      }).join('');
      let nowLine = '';
      if (key === todayKey) {
        const top = eventTopPx(
          `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
          hourStart, rowH
        );
        if (top >= 0 && top <= (hourEnd - hourStart) * rowH) {
          nowLine = `<div class="cal-week-now" style="top:${top}px"></div>`;
        }
      }
      return `<div class="cal-week-col" data-date="${key}" style="height:${(hourEnd-hourStart)*rowH}px">${nowLine}${blocks}</div>`;
    }).join('');

    return `<div class="cal-week-timeline">
      ${head}
      <div class="cal-week-cols">
        <div class="cal-week-gutter">${gutters}</div>
        ${cols}
      </div>
    </div>`;
  }

  function renderDayList(cursor, events) {
    const key = ymd(cursor);
    const hourStart = 8;
    const hourEnd = 21;
    const rowH = 52;
    const list = events
      .filter(e => String(e.date).slice(0,10) === key)
      .sort((a, b) => String(a.time||'').localeCompare(String(b.time||'')));

    const hours = Array.from({length: hourEnd - hourStart}, (_, i) => {
      const h = hourStart + i;
      return `<div style="height:${rowH}px;line-height:${rowH}px">${String(h).padStart(2,'0')}:00</div>`;
    }).join('');

    const blocks = list.map(e => {
      const type = eventTypeInfo(e.type);
      const top = Math.max(0, eventTopPx(e.time, hourStart, rowH));
      const height = Math.min(eventHeightPx(e.time, e.end_time, rowH), (hourEnd - hourStart) * rowH - top);
      const rsvp = e.my_rsvp ? `<span class="cal-rsvp-chip ${esc(e.my_rsvp)}">${esc(RSVP_LABEL[e.my_rsvp]||e.my_rsvp)}</span>` : '';
      return `<div class="cal-day-block" style="top:${top}px;height:${height}px;--event-color:${type.color}" data-id="${esc(String(e.id))}" data-source="${esc(e.source||'event')}">
        <span class="t">${esc(String(e.time||'').slice(0,5))}${e.end_time ? '–' + esc(String(e.end_time).slice(0,5)) : ''} · ${esc(type.label)} ${rsvp}</span>
        ${esc(e.title)}
        ${e.location || e.conference_url ? `<span class="t">${esc(e.conference_url || e.location)}</span>` : ''}
      </div>`;
    }).join('');

    const now = new Date();
    let nowLine = '';
    if (key === ymd(now)) {
      const top = eventTopPx(
        `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
        hourStart, rowH
      );
      if (top >= 0 && top <= (hourEnd - hourStart) * rowH) {
        nowLine = `<div class="cal-day-now" style="top:${top}px"></div>`;
      }
    }

    const emptyHint = list.length ? '' : `<div class="cal-day-empty-hint">День свободен — кликните по часу или «+ Событие»</div>`;

    return `<div class="cal-day-timeline" style="position:relative;min-height:${(hourEnd-hourStart)*rowH}px">
      <div class="cal-day-hours">${hours}</div>
      <div class="cal-day-track" data-date="${key}" style="height:${(hourEnd-hourStart)*rowH}px">${nowLine}${blocks}${emptyHint}</div>
    </div>`;
  }

  async function render({layout, title}) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }

    const now = new Date();
    let view = 'month'; // month | week | day
    let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let filterUserId = '';
    let cacheEvents = [];

    async function rangeForView() {
      if (view === 'day') return { from: ymd(cursor), to: ymd(cursor) };
      if (view === 'week') {
        const s = startOfWeek(cursor);
        return { from: ymd(s), to: ymd(addDays(s, 6)) };
      }
      const y = cursor.getFullYear(), m = cursor.getMonth();
      return {
        from: `${y}-${String(m+1).padStart(2,'0')}-01`,
        to: `${y}-${String(m+1).padStart(2,'0')}-${daysInMonth(y, m)}`
      };
    }

    async function reload() {
      const { from, to } = await rangeForView();
      cacheEvents = await loadFeed(from, to);
      if (filterUserId) {
        // For meetings we only have my feed; filter by title/participants text loosely
        // Real per-user calendar: availability is in planner. Here filter personal participant names if present.
        const name = (await loadUsers()).find(u => String(u.id) === String(filterUserId))?.name || '';
        if (name) {
          cacheEvents = cacheEvents.filter(e =>
            e.organizer_id == filterUserId ||
            (e.participants || '').toLowerCase().includes(name.toLowerCase()) ||
            !e.source || e.source === 'event'
          );
        }
      }
    }

    function titleText() {
      if (view === 'day') {
        return cursor.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      }
      if (view === 'week') {
        const s = startOfWeek(cursor);
        const e = addDays(s, 6);
        return `${s.getDate()}–${e.getDate()} ${MONTHS_RU[s.getMonth()]} ${s.getFullYear()}`;
      }
      return `${MONTHS_RU[cursor.getMonth()]} ${cursor.getFullYear()}`;
    }

    async function paintMain() {
      const todayYmd = ymd(now);
      if (view === 'month') return renderMonthGrid(cursor.getFullYear(), cursor.getMonth(), cacheEvents, todayYmd);
      if (view === 'week') return renderWeekGrid(cursor, cacheEvents);
      return renderDayList(cursor, cacheEvents);
    }

    async function upcomingHtml() {
      const from = ymd(now);
      const to = ymd(addDays(now, 60));
      let events = await loadFeed(from, to);
      events = events.sort((a, b) => {
        const c = String(a.date).localeCompare(String(b.date));
        return c || String(a.time||'').localeCompare(String(b.time||''));
      }).slice(0, 7);
      if (!events.length) return '<div class="muted">Нет предстоящих событий</div>';
      return events.map(e => {
        const type = eventTypeInfo(e.type);
        const dateObj = parseDate(e.date);
        const dateStr = dateObj ? dateObj.toLocaleDateString('ru-RU', {day:'numeric', month:'short'}) : e.date;
        return `<div class="upcoming-event" data-id="${esc(String(e.id))}" data-source="${esc(e.source||'event')}">
          <div class="upcoming-color" style="background:${type.color}"></div>
          <div class="upcoming-info">
            <div class="upcoming-title">${esc(e.title)}</div>
            <div class="upcoming-meta">${dateStr} ${esc(e.time||'')} · ${esc(type.label)}</div>
          </div>
        </div>`;
      }).join('');
    }

    const users = await loadUsers();
    await reload();

    const html = `
      <div class="page-head">
        <h1>Календарь встреч</h1>
        <div class="motto">Время — главный ресурс.</div>
      </div>
      <div class="cal-layout">
        <div class="cal-main">
          <div class="card">
            <div class="cal-header">
              <button class="btn ghost" id="btnPrev">←</button>
              <div class="cal-title" id="calTitle">${esc(titleText())}</div>
              <button class="btn ghost" id="btnNext">→</button>
              <button class="btn ghost" id="btnToday">Сегодня</button>
              <div class="cal-views row" style="gap:4px">
                <button class="btn ghost cal-view-btn active" data-view="month">Месяц</button>
                <button class="btn ghost cal-view-btn" data-view="week">Неделя</button>
                <button class="btn ghost cal-view-btn" data-view="day">День</button>
              </div>
              <div class="cal-filter"><div id="filterParticipant_w" style="min-width:150px"></div></div>
              <button class="btn primary" id="btnAddEvent">+ Событие</button>
            </div>
            <div class="cal-weekdays" id="calWeekdays">
              ${DAYS_RU.map(d => `<div class="cal-weekday">${d}</div>`).join('')}
            </div>
            <div class="cal-grid" id="calGrid">${await paintMain()}</div>
          </div>
        </div>
        <div class="cal-sidebar">
          <div class="card">
            <h3>Ближайшие события</h3>
            <div class="upcoming-list" id="upcomingList">${await upcomingHtml()}</div>
          </div>
          <div class="card">
            <h3>Типы событий</h3>
            <div class="event-types-legend">
              ${EVENT_TYPES.map(t => `
                <div class="event-type-item">
                  <span class="event-type-color" style="background:${t.color}"></span>
                  <span>${esc(t.label)}</span>
                </div>`).join('')}
            </div>
            <div class="muted" style="margin-top:10px;font-size:12px">
              Совещания с участниками и гостями уходят письмом с ICS. Протокол — в разделе «Совещания».
            </div>
          </div>
        </div>
      </div>
    `;

    await layout(html, { title: title || 'Календарь встреч', motto: 'Время — главный ресурс.' });

    $('#filterParticipant_w')?.appendChild(CRSelect.create({
      id: 'filterParticipant',
      options: [
        { value: '', label: 'Все / мой календарь' },
        ...users.map(u => ({ value: String(u.id), label: u.name || u.login }))
      ],
      searchable: true,
      onChange: async (v) => { filterUserId = v; await refresh(); }
    }));

    async function refresh() {
      await reload();
      $('#calTitle').textContent = titleText();
      const weekdays = $('#calWeekdays');
      if (weekdays) weekdays.style.display = view === 'month' ? '' : 'none';
      const grid = $('#calGrid');
      if (view === 'month') {
        grid.className = 'cal-grid';
      } else {
        grid.className = 'cal-grid cal-grid--' + view;
      }
      grid.innerHTML = await paintMain();
      $('#upcomingList').innerHTML = await upcomingHtml();
      bindClicks();
    }

    function findCached(id, source) {
      return cacheEvents.find(e => String(e.id) === String(id)) ||
        { id, source: source || 'event', date: ymd(cursor) };
    }

    function bindClicks() {
      $$('.cal-day:not(.empty), .cal-week-cell, .cal-week-col, .cal-day-track').forEach(day => {
        day.addEventListener('click', async (e) => {
          const eventEl = e.target.closest('.cal-event, .cal-day-item, .upcoming-event, .cal-week-block, .cal-day-block, .cal-agenda-item');
          if (eventEl) {
            e.stopPropagation();
            const item = findCached(eventEl.dataset.id, eventEl.dataset.source);
            const result = await openEventModal(item.date, item);
            if (result) { toast('Готово', result.action === 'deleted' ? 'Удалено' : 'Сохранено', 'ok'); await refresh(); }
            return;
          }
          if (day.classList.contains('cal-day') || day.classList.contains('cal-week-cell') || day.classList.contains('cal-week-col') || day.classList.contains('cal-day-track')) {
            const date = day.dataset.date;
            if (date) {
              const [yy, mm, dd] = String(date).split('-').map(Number);
              if (yy && mm && dd) cursor = new Date(yy, mm - 1, dd);
            }
            const hour = day.dataset.hour;
            const result = await openEventModal(date, hour != null ? {
              date, time: `${String(hour).padStart(2,'0')}:00`,
              end_time: `${String(Math.min(23, Number(hour)+1)).padStart(2,'0')}:00`,
              type: 'meeting'
            } : null);
            if (result && result.action === 'saved') {
              toast('Готово', 'Событие создано', 'ok');
              await refresh();
            } else if (view === 'month' && date) {
              // После выбора дня в месяце — остаёмся на этой дате (как Outlook)
              $('#calTitle').textContent = titleText();
            }
          }
        });
      });

      $$('.cal-day-item, .upcoming-event, .cal-agenda-item, .cal-week-block, .cal-day-block').forEach(el => {
        el.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const item = findCached(el.dataset.id, el.dataset.source);
          const result = await openEventModal(item.date, item);
          if (result) { toast('Готово', 'Готово', 'ok'); await refresh(); }
        });
      });
    }

    $$('.cal-view-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        view = btn.dataset.view;
        $$('.cal-view-btn').forEach(b => b.classList.toggle('active', b === btn));
        await refresh();
      });
    });

    $('#btnPrev').addEventListener('click', async () => {
      if (view === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
      else if (view === 'week') cursor = addDays(cursor, -7);
      else cursor = addDays(cursor, -1);
      await refresh();
    });
    $('#btnNext').addEventListener('click', async () => {
      if (view === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      else if (view === 'week') cursor = addDays(cursor, 7);
      else cursor = addDays(cursor, 1);
      await refresh();
    });
    $('#btnToday').addEventListener('click', async () => {
      cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      await refresh();
    });
    $('#btnAddEvent').addEventListener('click', async () => {
      const result = await openEventModal(ymd(cursor));
      if (result && result.action === 'saved') {
        toast('Готово', 'Событие создано', 'ok');
        await refresh();
      }
    });

    bindClicks();
  }

  return { render };
})();
