window.AsgardCalendarPage = (function(){
  const {$, $$, esc, toast, showModal, closeModal} = AsgardUI;
  
  const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const DAYS_RU = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  
  const EVENT_TYPES = [
    {code: 'meeting', label: 'Совещание', color: '#2563eb'},
    {code: 'call', label: 'Звонок', color: '#8b5cf6'},
    {code: 'visit', label: 'Встреча с клиентом', color: '#16a34a'},
    {code: 'deadline', label: 'Дедлайн', color: '#dc2626'},
    {code: 'reminder', label: 'Напоминание', color: '#f59e0b'},
    {code: 'other', label: 'Другое', color: '#64748b'}
  ];
  
  function ymd(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  }
  
  function hhmm(d) {
    const x = new Date(d);
    return `${String(x.getHours()).padStart(2,'0')}:${String(x.getMinutes()).padStart(2,'0')}`;
  }
  
  function parseDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  
  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }
  
  function firstDayOfWeek(year, month) {
    const d = new Date(year, month, 1).getDay();
    return d === 0 ? 6 : d - 1; // Пн = 0
  }
  
  async function loadEvents(year, month) {
    const all = await AsgardDB.all('calendar_events') || [];
    const startYmd = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const endYmd = `${year}-${String(month+1).padStart(2,'0')}-${daysInMonth(year, month)}`;
    return all.filter(e => e.date >= startYmd && e.date <= endYmd);
  }
  
  async function loadAllEvents() {
    return await AsgardDB.all('calendar_events') || [];
  }
  
  async function saveEvent(event) {
    if (event.id) {
      await AsgardDB.put('calendar_events', event);
    } else {
      await AsgardDB.add('calendar_events', event);
    }
  }
  
  async function deleteEvent(id) {
    await AsgardDB.del('calendar_events', id);
  }
  
  function eventTypeInfo(code) {
    return EVENT_TYPES.find(t => t.code === code) || EVENT_TYPES[5];
  }
  
  async function openEventModal(date, existingEvent = null) {
    return new Promise(resolve => {
      const isEdit = !!existingEvent;
      const ev = existingEvent || {
        date: date,
        time: '10:00',
        type: 'meeting',
        title: '',
        description: '',
        participants: '',
        reminder_minutes: 30,
        created_at: new Date().toISOString()
      };
      
      const typeOptions = EVENT_TYPES.map(t => 
        `<option value="${t.code}" ${ev.type === t.code ? 'selected' : ''}>${esc(t.label)}</option>`
      ).join('');
      
      const reminderOptions = [
        {v: 0, l: 'Без напоминания'},
        {v: 5, l: 'За 5 минут'},
        {v: 15, l: 'За 15 минут'},
        {v: 30, l: 'За 30 минут'},
        {v: 60, l: 'За 1 час'},
        {v: 1440, l: 'За 1 день'}
      ].map(r => `<option value="${r.v}" ${ev.reminder_minutes === r.v ? 'selected' : ''}>${r.l}</option>`).join('');
      
      const html = `
        <div class="stack" style="gap:16px">
          <div class="formrow">
            <div class="field">
              <label for="ev_title">Название *</label>
              <input id="ev_title" class="inp" value="${esc(ev.title || '')}" placeholder="Совещание по проекту..." autocomplete="off"/>
            </div>
          </div>
          <div class="formrow" style="grid-template-columns:1fr 1fr">
            <div class="field">
              <label for="ev_date">Дата</label>
              <input id="ev_date" type="date" class="inp" value="${esc(ev.date || date)}"/>
            </div>
            <div class="field">
              <label for="ev_time">Время</label>
              <input id="ev_time" type="time" class="inp" value="${esc(ev.time || '10:00')}"/>
            </div>
          </div>
          <div class="formrow" style="grid-template-columns:1fr 1fr">
            <div class="field">
              <label for="ev_type">Тип события</label>
              <select id="ev_type" class="inp">${typeOptions}</select>
            </div>
            <div class="field">
              <label for="ev_reminder">Напоминание</label>
              <select id="ev_reminder" class="inp">${reminderOptions}</select>
            </div>
          </div>
          <div class="formrow">
            <div class="field">
              <label for="ev_participants">Участники</label>
              <input id="ev_participants" class="inp" value="${esc(ev.participants || '')}" placeholder="Иванов, Петров..." autocomplete="off"/>
            </div>
          </div>
          <div class="formrow">
            <div class="field">
              <label for="ev_desc">Описание</label>
              <textarea id="ev_desc" class="inp" rows="3" placeholder="Подробности...">${esc(ev.description || '')}</textarea>
            </div>
          </div>
          <div class="row" style="gap:10px;justify-content:flex-end;margin-top:8px">
            ${isEdit ? `<button class="btn red" data-act="delete">Удалить</button>` : ''}
            <button class="btn ghost" data-act="cancel">Отмена</button>
            <button class="btn primary" data-act="save">${isEdit ? 'Сохранить' : 'Создать'}</button>
          </div>
        </div>
      `;
      
      showModal({
        title: isEdit ? 'Редактировать событие' : 'Новое событие',
        html,
        wide: false,
        onMount: () => {
          $('#ev_title')?.focus();
          
          $$('[data-act]').forEach(btn => {
            btn.addEventListener('click', async () => {
              const act = btn.dataset.act;
              
              if (act === 'cancel') {
                closeModal();
                resolve(null);
                return;
              }
              
              if (act === 'delete') {
                if (confirm('Удалить событие?')) {
                  closeModal();
                  resolve({action: 'delete', id: ev.id});
                }
                return;
              }
              
              // Save
              const title = ($('#ev_title')?.value || '').trim();
              if (!title) {
                toast('Ошибка', 'Введите название', 'err');
                return;
              }
              
              const result = {
                action: 'save',
                event: {
                  id: ev.id || undefined,
                  date: $('#ev_date')?.value || date,
                  time: $('#ev_time')?.value || '10:00',
                  type: $('#ev_type')?.value || 'meeting',
                  title,
                  description: $('#ev_desc')?.value || '',
                  participants: $('#ev_participants')?.value || '',
                  reminder_minutes: parseInt($('#ev_reminder')?.value || '30', 10),
                  created_at: ev.created_at || new Date().toISOString(),
                  updated_at: new Date().toISOString()
                }
              };
              
              closeModal();
              resolve(result);
            });
          });
        }
      });
    });
  }
  
  async function checkReminders(userId) {
    const now = new Date();
    const events = await loadAllEvents();
    
    for (const ev of events) {
      if (!ev.reminder_minutes || ev.reminder_sent) continue;
      
      const eventTime = new Date(`${ev.date}T${ev.time || '00:00'}`);
      const reminderTime = new Date(eventTime.getTime() - ev.reminder_minutes * 60 * 1000);
      
      if (now >= reminderTime && now < eventTime) {
        // Отправляем уведомление
        try {
          await AsgardDB.add('notifications', {
            user_id: userId,
            type: 'calendar_reminder',
            title: `Напоминание: ${ev.title}`,
            message: `Через ${ev.reminder_minutes} мин: ${ev.title}${ev.participants ? ` (${ev.participants})` : ''}`,
            is_read: false,
            created_at: new Date().toISOString()
          });
          
          ev.reminder_sent = true;
          await AsgardDB.put('calendar_events', ev);
        } catch (e) {
          console.error('Reminder error:', e);
        }
      }
    }
  }
  
  async function render({layout, title}) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;
    
    // Проверяем напоминания
    await checkReminders(user.id);
    
    const now = new Date();
    let viewYear = now.getFullYear();
    let viewMonth = now.getMonth();
    
    async function renderCalendar() {
      let events = await loadEvents(viewYear, viewMonth);

      // Apply participant filter
      if (filterParticipant) {
        events = events.filter(e =>
          (e.participants || '').toLowerCase().includes(filterParticipant.toLowerCase())
        );
      }

      const numDays = daysInMonth(viewYear, viewMonth);
      const firstDay = firstDayOfWeek(viewYear, viewMonth);
      const todayYmd = ymd(now);

      // Группируем события по датам
      const eventsByDate = {};
      events.forEach(e => {
        if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
        eventsByDate[e.date].push(e);
      });
      
      // Строим сетку календаря
      let cells = [];
      
      // Пустые ячейки в начале
      for (let i = 0; i < firstDay; i++) {
        cells.push(`<div class="cal-day empty"></div>`);
      }
      
      // Дни месяца
      for (let d = 1; d <= numDays; d++) {
        const dateYmd = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isToday = dateYmd === todayYmd;
        const dayEvents = eventsByDate[dateYmd] || [];
        const isWeekend = ((firstDay + d - 1) % 7) >= 5;
        
        const eventsHtml = dayEvents.slice(0, 3).map(e => {
          const type = eventTypeInfo(e.type);
          return `<div class="cal-event" style="--event-color:${type.color}" data-id="${e.id}" title="${esc(e.title)}">
            <span class="cal-event-time">${esc(e.time || '')}</span>
            <span class="cal-event-title">${esc(e.title)}</span>
          </div>`;
        }).join('');
        
        const moreCount = dayEvents.length - 3;
        const moreHtml = moreCount > 0 ? `<div class="cal-more">+${moreCount} ещё</div>` : '';
        
        cells.push(`
          <div class="cal-day${isToday ? ' today' : ''}${isWeekend ? ' weekend' : ''}" data-date="${dateYmd}">
            <div class="cal-day-num">${d}</div>
            <div class="cal-day-events">${eventsHtml}${moreHtml}</div>
          </div>
        `);
      }
      
      // Заполняем оставшиеся ячейки
      const totalCells = cells.length;
      const remainder = totalCells % 7;
      if (remainder > 0) {
        for (let i = 0; i < 7 - remainder; i++) {
          cells.push(`<div class="cal-day empty"></div>`);
        }
      }
      
      return cells.join('');
    }
    
    async function renderUpcoming() {
      let events = await loadAllEvents();
      const todayYmd = ymd(now);

      // Apply participant filter
      if (filterParticipant) {
        events = events.filter(e =>
          (e.participants || '').toLowerCase().includes(filterParticipant.toLowerCase())
        );
      }

      const upcoming = events
        .filter(e => e.date >= todayYmd)
        .sort((a, b) => {
          const cmp = a.date.localeCompare(b.date);
          if (cmp !== 0) return cmp;
          return (a.time || '').localeCompare(b.time || '');
        })
        .slice(0, 5);
      
      if (!upcoming.length) {
        return '<div class="muted">Нет предстоящих событий</div>';
      }
      
      return upcoming.map(e => {
        const type = eventTypeInfo(e.type);
        const dateObj = parseDate(e.date);
        const dateStr = dateObj ? dateObj.toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'}) : e.date;
        return `
          <div class="upcoming-event" data-id="${e.id}">
            <div class="upcoming-color" style="background:${type.color}"></div>
            <div class="upcoming-info">
              <div class="upcoming-title">${esc(e.title)}</div>
              <div class="upcoming-meta">${dateStr} ${e.time || ''} · ${esc(type.label)}</div>
            </div>
          </div>
        `;
      }).join('');
    }
    
    const calendarHtml = await renderCalendar();
    const upcomingHtml = await renderUpcoming();
    
    // Load users for filter
    const allUsers = await AsgardDB.all('users') || [];
    const activeUsers = allUsers.filter(u => u.is_active !== false);
    let filterParticipant = '';

    const userOptions = activeUsers.map(u =>
      `<option value="${esc(u.name || u.login)}">${esc(u.name || u.login)}</option>`
    ).join('');

    const html = `
      <div class="page-head">
        <h1>Календарь встреч</h1>
        <div class="motto">Время — главный ресурс.</div>
      </div>

      <div class="cal-layout">
        <div class="cal-main">
          <div class="card">
            <div class="cal-header">
              <button class="btn ghost" id="btnPrevMonth">←</button>
              <div class="cal-title" id="calTitle">${MONTHS_RU[viewMonth]} ${viewYear}</div>
              <button class="btn ghost" id="btnNextMonth">→</button>
              <button class="btn ghost" id="btnToday">Сегодня</button>
              <div class="cal-filter">
                <select id="filterParticipant" class="inp" style="min-width:150px">
                  <option value="">Все участники</option>
                  ${userOptions}
                </select>
              </div>
              <button class="btn primary" id="btnAddEvent">+ Событие</button>
            </div>
            <div class="cal-weekdays">
              ${DAYS_RU.map(d => `<div class="cal-weekday">${d}</div>`).join('')}
            </div>
            <div class="cal-grid" id="calGrid">
              ${calendarHtml}
            </div>
          </div>
        </div>
        
        <div class="cal-sidebar">
          <div class="card">
            <h3>Ближайшие события</h3>
            <div class="upcoming-list" id="upcomingList">
              ${upcomingHtml}
            </div>
          </div>
          
          <div class="card">
            <h3>Типы событий</h3>
            <div class="event-types-legend">
              ${EVENT_TYPES.map(t => `
                <div class="event-type-item">
                  <span class="event-type-color" style="background:${t.color}"></span>
                  <span>${esc(t.label)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
    
    await layout(html, {title: title || 'Календарь встреч', motto: 'Время — главный ресурс.'});
    
    // Event handlers
    async function refresh() {
      $('#calTitle').textContent = `${MONTHS_RU[viewMonth]} ${viewYear}`;
      $('#calGrid').innerHTML = await renderCalendar();
      $('#upcomingList').innerHTML = await renderUpcoming();
      bindDayClicks();
    }
    
    function bindDayClicks() {
      $$('.cal-day:not(.empty)').forEach(day => {
        day.addEventListener('click', async (e) => {
          // Если клик по событию
          const eventEl = e.target.closest('.cal-event');
          if (eventEl) {
            const id = Number(eventEl.dataset.id);
            const ev = await AsgardDB.get('calendar_events', id);
            if (ev) {
              const result = await openEventModal(ev.date, ev);
              if (result) {
                if (result.action === 'delete') {
                  await deleteEvent(result.id);
                  toast('Готово', 'Событие удалено', 'ok');
                } else if (result.action === 'save') {
                  await saveEvent(result.event);
                  toast('Готово', 'Событие сохранено', 'ok');
                }
                await refresh();
              }
            }
            return;
          }
          
          // Клик по дню - создание события
          const date = day.dataset.date;
          const result = await openEventModal(date);
          if (result && result.action === 'save') {
            await saveEvent(result.event);
            toast('Готово', 'Событие создано', 'ok');
            await refresh();
          }
        });
      });
      
      // Upcoming events click
      $$('.upcoming-event').forEach(el => {
        el.addEventListener('click', async () => {
          const id = Number(el.dataset.id);
          const ev = await AsgardDB.get('calendar_events', id);
          if (ev) {
            const result = await openEventModal(ev.date, ev);
            if (result) {
              if (result.action === 'delete') {
                await deleteEvent(result.id);
                toast('Готово', 'Событие удалено', 'ok');
              } else if (result.action === 'save') {
                await saveEvent(result.event);
                toast('Готово', 'Событие сохранено', 'ok');
              }
              await refresh();
            }
          }
        });
      });
    }
    
    $('#btnPrevMonth').addEventListener('click', async () => {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      await refresh();
    });
    
    $('#btnNextMonth').addEventListener('click', async () => {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      await refresh();
    });
    
    $('#btnToday').addEventListener('click', async () => {
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
      await refresh();
    });
    
    $('#btnAddEvent').addEventListener('click', async () => {
      const todayYmd = ymd(now);
      const result = await openEventModal(todayYmd);
      if (result && result.action === 'save') {
        await saveEvent(result.event);
        toast('Готово', 'Событие создано', 'ok');
        await refresh();
      }
    });

    // Participant filter handler
    $('#filterParticipant')?.addEventListener('change', async (e) => {
      filterParticipant = e.target.value;
      await refresh();
    });

    bindDayClicks();
  }
  
  return { render, checkReminders };
})();
