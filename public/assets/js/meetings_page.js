/**
 * ASGARD CRM — Совещания (M5)
 *
 * Функционал:
 * - Список совещаний
 * - Создание/редактирование
 * - RSVP
 * - Протокол и задачи из протокола
 */
window.AsgardMeetings = (function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  let _savedLayout = null;

  // ═══════════════════════════════════════════════════════════════
  // API
  // ═══════════════════════════════════════════════════════════════

  const API = {
    async getMeetings(params = {}) {
      const query = new URLSearchParams(params);
      const res = await fetch(`/api/meetings?${query}`, {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      return res.json();
    },

    async getMeeting(id) {
      const res = await fetch(`/api/meetings/${id}`, {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      return res.json();
    },

    async getUpcoming(limit = 5) {
      const res = await fetch(`/api/meetings/upcoming?limit=${limit}`, {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      return res.json();
    },

    async getStats() {
      const res = await fetch('/api/meetings/stats', {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      return res.json();
    },

    async createMeeting(data) {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('asgard_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      return res.json();
    },

    async updateMeeting(id, data) {
      const res = await fetch(`/api/meetings/${id}`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('asgard_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      return res.json();
    },

    async rsvp(id, status, comment = '') {
      const res = await fetch(`/api/meetings/${id}/rsvp`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('asgard_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status, comment })
      });
      return res.json();
    },

    async addMinutesItem(meetingId, data) {
      const res = await fetch(`/api/meetings/${meetingId}/minutes`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('asgard_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      return res.json();
    },

    async createTaskFromMinutes(meetingId, itemId) {
      const res = await fetch(`/api/meetings/${meetingId}/minutes/${itemId}/create-task`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('asgard_token') }
      });
      return res.json();
    },

    async finalizeMeeting(id, minutesText) {
      const res = await fetch(`/api/meetings/${id}/finalize`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('asgard_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ minutes_text: minutesText })
      });
      return res.json();
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // Render List
  // ═══════════════════════════════════════════════════════════════

  async function render({ layout }) {
    if (layout) _savedLayout = layout;
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }

    const [meetingsResp, statsResp] = await Promise.all([
      API.getMeetings({ my_only: 'true' }).catch(() => ({})),
      API.getStats().catch(() => ({}))
    ]);
    const meetings = meetingsResp?.meetings || [];
    const stats = statsResp || {};

    const upcomingHtml = meetings.filter(m => m.status === 'scheduled' || m.status === 'in_progress')
      .slice(0, 10)
      .map(m => renderMeetingCard(m)).join('');

    const pastHtml = meetings.filter(m => m.status === 'completed' || m.status === 'cancelled')
      .slice(0, 10)
      .map(m => renderMeetingCard(m)).join('');

    const html = `
      <div class="page-head row between mb-4">
        <div>
          <h1>📅 Совещания</h1>
          <p class="desc">Планирование и протоколирование</p>
        </div>
        <div class="row">
          <button class="btn primary" onclick="AsgardMeetings.showCreateModal()">+ Создать совещание</button>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid mb-6">
        <div class="span-3 card kpi-card">
          <div class="kpi-value">${stats.today || 0}</div>
          <div class="kpi-label">Сегодня</div>
        </div>
        <div class="span-3 card kpi-card">
          <div class="kpi-value">${stats.this_week || 0}</div>
          <div class="kpi-label">На этой неделе</div>
        </div>
        <div class="span-3 card kpi-card">
          <div class="kpi-value">${stats.pending_rsvp || 0}</div>
          <div class="kpi-label">Ожидают ответа</div>
        </div>
      </div>

      <!-- Upcoming -->
      <h2 class="mb-3">📋 Предстоящие</h2>
      <div class="grid mb-6">
        ${upcomingHtml || '<div class="span-12"><div class="widget-empty"><span class="widget-empty-text">Нет предстоящих совещаний</span></div></div>'}
      </div>

      <!-- Past -->
      <h2 class="mb-3">📁 Прошедшие</h2>
      <div class="grid">
        ${pastHtml || '<div class="span-12"><div class="widget-empty"><span class="widget-empty-text">Нет прошедших совещаний</span></div></div>'}
      </div>
    `;

    await layout(html, { title: 'Совещания', motto: 'Планирование и протоколирование' });
  }

  function renderMeetingCard(meeting) {
    const start = new Date(meeting.start_time);
    const timeStr = start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const dateStr = start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

    const statusClasses = {
      scheduled: 'scheduled',
      in_progress: 'in_progress',
      completed: 'completed',
      cancelled: 'cancelled'
    };
    const statusLabels = {
      scheduled: 'Запланировано',
      in_progress: 'Идёт',
      completed: 'Завершено',
      cancelled: 'Отменено'
    };

    const rsvpHtml = meeting.my_rsvp && meeting.status === 'scheduled' ? `
      <div class="meeting-rsvp">
        <button class="meeting-rsvp-btn ${meeting.my_rsvp === 'accepted' ? 'accepted' : ''}"
                onclick="event.stopPropagation(); AsgardMeetings.rsvp(${meeting.id}, 'accepted')">✓ Приду</button>
        <button class="meeting-rsvp-btn ${meeting.my_rsvp === 'tentative' ? 'tentative' : ''}"
                onclick="event.stopPropagation(); AsgardMeetings.rsvp(${meeting.id}, 'tentative')">? Возможно</button>
        <button class="meeting-rsvp-btn ${meeting.my_rsvp === 'declined' ? 'declined' : ''}"
                onclick="event.stopPropagation(); AsgardMeetings.rsvp(${meeting.id}, 'declined')">✕ Не приду</button>
      </div>
    ` : '';

    return `
      <div class="span-6 meeting-card" onclick="AsgardMeetings.openMeeting(${meeting.id})">
        <div class="meeting-card-header">
          <div class="meeting-card-title">${esc(meeting.title)}</div>
          <span class="meeting-status ${statusClasses[meeting.status]}">${statusLabels[meeting.status]}</span>
        </div>
        <div class="meeting-card-time">
          <span>📅 ${dateStr}</span>
          <span>🕐 ${timeStr}</span>
        </div>
        ${meeting.location ? `<div class="meeting-card-location">📍 ${esc(meeting.location)}</div>` : ''}
        <div class="meeting-card-participants">
          <span class="text-muted">${meeting.participant_count || 0} участников</span>
          <span class="text-muted">• ${esc(meeting.organizer_name)}</span>
        </div>
        ${rsvpHtml}
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  // Meeting Details
  // ═══════════════════════════════════════════════════════════════

  async function openMeeting(meetingId) {
    const { meeting, participants, minutes } = await API.getMeeting(meetingId);
    const users = await AsgardDB.getAll('users') || [];
    const usersById = new Map(users.map(u => [u.id, u]));

    const start = new Date(meeting.start_time);
    const end = meeting.end_time ? new Date(meeting.end_time) : null;

    const participantsHtml = participants.map(p => {
      const statusIcons = { accepted: '✅', declined: '❌', tentative: '❓', pending: '⏳' };
      return `
        <div class="row" style="padding: 4px 0;">
          <span>${statusIcons[p.rsvp_status] || '⏳'}</span>
          <span>${esc(p.name)}</span>
          <span class="text-muted">(${p.user_role})</span>
        </div>
      `;
    }).join('');

    const minutesHtml = minutes.map(m => {
      const typeIcons = { note: '📝', decision: '✅', action: '📋', question: '❓' };
      const responsible = m.responsible_user_id ? usersById.get(m.responsible_user_id)?.name : null;
      return `
        <div class="info-row">
          <div>
            <span>${typeIcons[m.item_type] || '📝'}</span>
            <span>${esc(m.content)}</span>
            ${responsible ? `<span class="text-muted">→ ${esc(responsible)}</span>` : ''}
          </div>
          ${m.item_type === 'action' && !m.task_id && m.responsible_user_id ? `
            <button class="btn mini" onclick="AsgardMeetings.createTaskFromMinutes(${meeting.id}, ${m.id})">Создать задачу</button>
          ` : ''}
          ${m.task_id ? `<a href="#/kanban?id=${m.task_id}" class="text-gold">→ Задача #${m.task_id}</a>` : ''}
        </div>
      `;
    }).join('') || '<p class="text-muted">Протокол пуст</p>';

    const html = `
      <div style="max-width: 700px;">
        <div class="row between mb-3">
          <span class="meeting-status ${meeting.status}">${meeting.status}</span>
          <span class="text-muted">Организатор: ${esc(meeting.organizer_name)}</span>
        </div>

        <h3>${esc(meeting.title)}</h3>
        ${meeting.description ? `<p class="text-muted mb-3">${esc(meeting.description)}</p>` : ''}

        <div class="grid2 mb-4">
          <div>
            <div class="info-row">
              <span>📅 Дата</span>
              <span>${start.toLocaleDateString('ru-RU')}</span>
            </div>
            <div class="info-row">
              <span>🕐 Время</span>
              <span>${start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${end ? ' — ' + end.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
            </div>
            ${meeting.location ? `
              <div class="info-row">
                <span>📍 Место</span>
                <span>${esc(meeting.location)}</span>
              </div>
            ` : ''}
          </div>
          <div>
            <h4>👥 Участники</h4>
            ${participantsHtml}
          </div>
        </div>

        ${meeting.agenda ? `
          <h4 class="mb-2">📋 Повестка дня</h4>
          <div class="card mb-4" style="white-space: pre-wrap;">${esc(meeting.agenda)}</div>
        ` : ''}

        <h4 class="mb-2">📝 Протокол</h4>
        <div class="mb-3">
          ${minutesHtml}
        </div>

        ${meeting.status !== 'completed' && meeting.status !== 'cancelled' ? `
          <div class="row mb-4">
            <select id="minutes-item-type" class="input">
              <option value="note">📝 Заметка</option>
              <option value="decision">✅ Решение</option>
              <option value="action">📋 Поручение</option>
              <option value="question">❓ Вопрос</option>
            </select>
            <input type="text" id="minutes-item-content" class="input" style="flex: 2;" placeholder="Текст пункта...">
            <select id="minutes-item-responsible" class="input">
              <option value="">Ответственный...</option>
              ${participants.map(p => `<option value="${p.user_id}">${esc(p.name)}</option>`).join('')}
            </select>
            <button class="btn" onclick="AsgardMeetings.addMinutesItem(${meeting.id})">Добавить</button>
          </div>

          <div class="row between">
            <button class="btn text-red" onclick="AsgardMeetings.cancelMeeting(${meeting.id})">Отменить</button>
            <button class="btn primary" onclick="AsgardMeetings.finalizeMeeting(${meeting.id})">✅ Завершить</button>
          </div>
        ` : ''}

        <div class="row between mt-4">
          <button class="btn" onclick="AsgardUI.closeModal()">Закрыть</button>
        </div>
      </div>
    `;

    showModal(`Совещание #${meeting.id}`, html);
  }

  // ═══════════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════════

  async function rsvp(meetingId, status) {
    try {
      await API.rsvp(meetingId, status);
      toast('Ответ сохранён', 'success');
      await refresh();
    } catch (e) {
      toast('Ошибка', 'error');
    }
  }

  async function addMinutesItem(meetingId) {
    const itemType = $('#minutes-item-type')?.value;
    const content = $('#minutes-item-content')?.value?.trim();
    const responsible = $('#minutes-item-responsible')?.value;

    if (!content) {
      toast('Введите текст пункта', 'error');
      return;
    }

    try {
      await API.addMinutesItem(meetingId, {
        item_type: itemType,
        content,
        responsible_user_id: responsible || null
      });
      toast('Пункт добавлен', 'success');
      await openMeeting(meetingId);
    } catch (e) {
      toast('Ошибка', 'error');
    }
  }

  async function createTaskFromMinutes(meetingId, itemId) {
    try {
      const { task } = await API.createTaskFromMinutes(meetingId, itemId);
      toast(`Задача #${task.id} создана`, 'success');
      await openMeeting(meetingId);
    } catch (e) {
      toast('Ошибка создания задачи', 'error');
    }
  }

  async function finalizeMeeting(meetingId) {
    if (!confirm('Завершить совещание и зафиксировать протокол?')) return;

    try {
      await API.finalizeMeeting(meetingId, null);
      toast('Совещание завершено', 'success');
      closeModal();
      await refresh();
    } catch (e) {
      toast('Ошибка', 'error');
    }
  }

  async function cancelMeeting(meetingId) {
    if (!confirm('Отменить совещание?')) return;

    try {
      await API.updateMeeting(meetingId, { status: 'cancelled' });
      toast('Совещание отменено', 'success');
      closeModal();
      await refresh();
    } catch (e) {
      toast('Ошибка', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Create Modal
  // ═══════════════════════════════════════════════════════════════

  // Helpers for meeting participant picker
  function _meetAvatarColor(name) {
    if (!name) return 'var(--muted)';
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    const colors = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE','#85C1E9'];
    return colors[Math.abs(h) % colors.length];
  }
  function _meetInitials(name) {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  async function showCreateModal() {
    const users = await AsgardDB.getAll('users') || [];
    // Filter: only active users with non-empty names
    const activeUsers = users.filter(u => u.is_active && u.name && u.name.trim());
    activeUsers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));

    // Default to tomorrow 10:00
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const defaultDate = tomorrow.toISOString().slice(0, 16);

    const participantsHtml = activeUsers.map(u => {
      const bg = _meetAvatarColor(u.name);
      const ini = _meetInitials(u.name);
      return `<label class="emp-selector-item" data-uname="${esc((u.name||'').toLowerCase())}" data-urole="${esc((u.role||'').toLowerCase())}">
        <input type="checkbox" name="meeting-participants" value="${u.id}">
        <div class="emp-selector-check">\u2713</div>
        <div class="emp-selector-avatar" style="background:${bg}">${ini}</div>
        <div class="emp-selector-info">
          <div class="emp-selector-name">${esc(u.name)}</div>
          <div class="emp-selector-role">${esc(u.role || u.position || '')}</div>
        </div>
      </label>`;
    }).join('');

    const html = `
      <div style="min-width: min(560px, calc(100vw - 32px)); max-width: min(640px, calc(100vw - 32px));">
        <div class="form-group">
          <label>\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 *</label>
          <input type="text" id="meeting-title" class="input" placeholder="\u0422\u0435\u043c\u0430 \u0441\u043e\u0432\u0435\u0449\u0430\u043d\u0438\u044f" autofocus>
        </div>
        <div class="grid2">
          <div class="form-group">
            <label>\u0414\u0430\u0442\u0430 \u0438 \u0432\u0440\u0435\u043c\u044f \u043d\u0430\u0447\u0430\u043b\u0430 *</label>
            <input type="datetime-local" id="meeting-start" class="input" value="${defaultDate}">
          </div>
          <div class="form-group">
            <label>\u0414\u0430\u0442\u0430 \u0438 \u0432\u0440\u0435\u043c\u044f \u043e\u043a\u043e\u043d\u0447\u0430\u043d\u0438\u044f</label>
            <input type="datetime-local" id="meeting-end" class="input">
          </div>
        </div>
        <div class="form-group">
          <label>\u041c\u0435\u0441\u0442\u043e / \u0421\u0441\u044b\u043b\u043a\u0430</label>
          <input type="text" id="meeting-location" class="input" placeholder="\u041f\u0435\u0440\u0435\u0433\u043e\u0432\u043e\u0440\u043d\u0430\u044f \u21161 \u0438\u043b\u0438 https://meet.google.com/...">
        </div>
        <div class="form-group">
          <label>\u041f\u043e\u0432\u0435\u0441\u0442\u043a\u0430 \u0434\u043d\u044f</label>
          <textarea id="meeting-agenda" class="input" rows="3" placeholder="1. \u041e\u0431\u0441\u0443\u0436\u0434\u0435\u043d\u0438\u0435...\n2. \u041f\u0440\u0438\u043d\u044f\u0442\u0438\u0435 \u0440\u0435\u0448\u0435\u043d\u0438\u044f..."></textarea>
        </div>
        <div class="form-group">
          <label>\u0423\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u0438 (${activeUsers.length} \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e)</label>
          <input type="text" class="inp" placeholder="\u041f\u043e\u0438\u0441\u043a \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430..." id="meetingParticipantSearch" style="margin-bottom:12px;width:100%">
          <div class="emp-selector" id="meetingParticipantList" style="max-height:280px">
            ${participantsHtml || '<div class="text-muted" style="padding:12px">\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0445 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u0439</div>'}
          </div>
          <div id="meetingParticipantCount" style="font-size:12px;color:var(--muted);margin-top:6px;text-align:right">\u0412\u044b\u0431\u0440\u0430\u043d\u043e: 0</div>
        </div>
        <div class="row between mt-4">
          <button class="btn" onclick="AsgardUI.closeModal()">\u041e\u0442\u043c\u0435\u043d\u0430</button>
          <button class="btn primary" onclick="AsgardMeetings.createMeeting()">\u0421\u043e\u0437\u0434\u0430\u0442\u044c</button>
        </div>
      </div>
    `;

    showModal('\ud83d\udcc5 \u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0441\u043e\u0432\u0435\u0449\u0430\u043d\u0438\u0435', html);

    // Search filter for participants
    const searchInput = document.getElementById('meetingParticipantSearch');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        const q = this.value.toLowerCase().trim();
        const items = document.querySelectorAll('#meetingParticipantList .emp-selector-item');
        items.forEach(item => {
          const name = item.dataset.uname || '';
          const role = item.dataset.urole || '';
          item.style.display = (!q || name.includes(q) || role.includes(q)) ? '' : 'none';
        });
      });
    }

    // Update selected count on checkbox change
    const participantList = document.getElementById('meetingParticipantList');
    const countEl = document.getElementById('meetingParticipantCount');
    if (participantList && countEl) {
      participantList.addEventListener('change', function() {
        const checked = participantList.querySelectorAll('input[name="meeting-participants"]:checked').length;
        countEl.textContent = '\u0412\u044b\u0431\u0440\u0430\u043d\u043e: ' + checked;
      });
    }
  }


  async function createMeeting() {
    const title = $('#meeting-title')?.value?.trim();
    const startTime = $('#meeting-start')?.value;
    const endTime = $('#meeting-end')?.value;
    const location = $('#meeting-location')?.value?.trim();
    const agenda = $('#meeting-agenda')?.value?.trim();
    const participantCheckboxes = $$('input[name="meeting-participants"]:checked');
    const participantIds = Array.from(participantCheckboxes).map(cb => parseInt(cb.value));

    if (!title) {
      toast('Укажите название', 'error');
      return;
    }
    if (!startTime) {
      toast('Укажите дату и время', 'error');
      return;
    }

    try {
      await API.createMeeting({
        title,
        start_time: startTime,
        end_time: endTime || null,
        location: location || null,
        agenda: agenda || null,
        participant_ids: participantIds
      });
      toast('Совещание создано', 'success');
      closeModal();
      await refresh();
    } catch (e) {
      toast('Ошибка создания', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Widget for Home Page
  // ═══════════════════════════════════════════════════════════════

  async function renderWidget() {
    try {
      const upResp = await API.getUpcoming(3);
      const meetings = upResp?.meetings || [];

      if (meetings.length === 0) {
        return `<div class="widget-empty"><span class="widget-empty-icon">📅</span><span class="widget-empty-text">Нет совещаний</span></div>`;
      }

      return meetings.map(m => {
        const start = new Date(m.start_time);
        const hour = start.getHours().toString().padStart(2, '0');
        const min = start.getMinutes().toString().padStart(2, '0');

        return `
          <div class="widget-meeting-mini" onclick="location.hash='#/meetings'; setTimeout(() => AsgardMeetings.openMeeting(${m.id}), 300);">
            <div class="widget-meeting-time">
              <span class="widget-meeting-time-hour">${hour}:${min}</span>
              <span class="widget-meeting-time-min">${start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
            </div>
            <div class="widget-meeting-content">
              <div class="widget-meeting-title">${esc(m.title)}</div>
              <div class="widget-meeting-location">${m.location ? '📍 ' + esc(m.location) : esc(m.organizer_name)}</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      return '<p class="text-muted">Ошибка загрузки</p>';
    }
  }

  async function refresh() {
    await render({ layout: _savedLayout });
  }

  // ═══════════════════════════════════════════════════════════════
  // Export
  // ═══════════════════════════════════════════════════════════════

  return {
    render,
    refresh,
    openMeeting,
    rsvp,
    addMinutesItem,
    createTaskFromMinutes,
    finalizeMeeting,
    cancelMeeting,
    showCreateModal,
    createMeeting,
    renderWidget
  };
})();
