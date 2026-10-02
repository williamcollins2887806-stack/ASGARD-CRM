/* ASGARD Ting — CRM module (#/ting). Parity with prototypes/ting screens. */
(function () {
  'use strict';

  const LK_CDN = 'https://cdn.jsdelivr.net/npm/livekit-client@2.9.1/dist/livekit-client.umd.min.js';
  let root = null;
  let state = {
    view: 'hub',
    tab: 'ting',
    rooms: [],
    meetings: [],
    room: null,
    protocol: null,
    dialin: null,
    lkRoom: null,
    localTracks: [],
    micOn: true,
    camOn: true,
    sharing: false,
    side: null, // people|chat|null
    chat: [],
    participants: [],
    waiting: [],
    recording: false,
    timerSec: 0,
    timerId: null,
    previewStream: null,
    error: null
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function qs(sel, el) { return (el || document).querySelector(sel); }
  function qsa(sel, el) { return Array.from((el || document).querySelectorAll(sel)); }
  function toast(msg, ok) {
    if (window.AsgardUI && typeof AsgardUI.toast === 'function') AsgardUI.toast(msg, ok === false ? 'error' : 'success');
    else console.log('[ting]', msg);
  }
  async function api(path, opts) {
    const token = localStorage.getItem('asgard_token');
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(path, Object.assign({
      credentials: 'same-origin',
      headers: headers
    }, opts || {}, {
      headers: Object.assign(headers, (opts && opts.headers) || {})
    }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || ('HTTP ' + r.status));
    return j;
  }
  function unwrapRoom(j) {
    return (j && j.room) ? j.room : j;
  }
  function parseHash() {
    const h = location.hash || '';
    const m = h.match(/#\/ting(?:\?(.*))?$/);
    if (!m) return null;
    const p = new URLSearchParams(m[1] || '');
    return {
      view: p.get('view') || 'hub',
      slug: p.get('slug') || '',
      tab: p.get('tab') || 'ting',
      id: p.get('id') || ''
    };
  }
  function go(view, extra) {
    const q = new URLSearchParams(Object.assign({ view: view }, extra || {}));
    location.hash = '#/ting?' + q.toString();
  }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function loadLk() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LK_CDN; s.async = true;
      s.onload = () => resolve(window.LivekitClient);
      s.onerror = () => reject(new Error('LiveKit CDN load failed'));
      document.head.appendChild(s);
    });
  }

  async function loadHub() {
    const [rooms, meetings] = await Promise.all([
      api('/api/thing/rooms').catch(() => ({ rooms: [] })),
      api('/api/meetings?limit=40').catch(() => ({ meetings: [] }))
    ]);
    state.rooms = rooms.rooms || rooms.items || rooms || [];
    if (!Array.isArray(state.rooms)) state.rooms = [];
    state.meetings = (meetings.meetings || meetings.items || meetings || []).filter(m => m.thing_room_id || m.thing_slug);
    if (!Array.isArray(state.meetings)) state.meetings = [];
  }

  function brand(chip) {
    return `<div class="ting-brand">
      <div class="ting-rune">ᛏ</div>
      <div><div style="font-weight:800;font-size:18px">Тинг</div>
      <div class="ting-muted" style="font-size:12px">совещания ASGARD</div></div>
      ${chip ? `<span class="ting-chip gold" style="margin-left:auto">${esc(chip)}</span>` : ''}
    </div>`;
  }

  function renderHub() {
    const list = state.tab === 'meetings' ? state.meetings : state.rooms;
    const items = (list || []).map(r => {
      const title = esc(r.title || r.name || 'Без названия');
      const slug = r.slug || r.thing_slug || '';
      const dial = r.dial_code || '';
      const st = r.status || 'scheduled';
      return `<div class="ting-list-item">
        <div>
          <div style="font-weight:700">${title}</div>
          <div class="ting-muted">${esc(st)}${dial ? ' · код ' + esc(dial) : ''}</div>
        </div>
        <div style="display:flex;gap:8px">
          ${slug ? `<button class="ting-btn ting-btn-ghost" data-act="ready" data-slug="${esc(slug)}">Ссылка</button>
          <button class="ting-btn ting-btn-primary" data-act="join" data-slug="${esc(slug)}">Войти</button>` : ''}
        </div>
      </div>`;
    }).join('') || `<div class="ting-muted">Пока пусто — создайте Тинг</div>`;

    root.innerHTML = `<div class="ting-wrap">
      ${brand('модуль CRM')}
      <div class="ting-cta-row">
        <button class="ting-btn ting-btn-primary" data-act="new">＋ Создать Тинг</button>
        <button class="ting-btn ting-btn-ghost" data-act="meeting-create">Совещание → Тинг</button>
        <button class="ting-btn ting-btn-ghost" data-act="schedule">Расписание</button>
        <button class="ting-btn ting-btn-ghost" data-act="dialin">Телефон</button>
      </div>
      <div class="ting-tabs">
        <button class="${state.tab === 'ting' ? 'on' : ''}" data-act="tab" data-tab="ting">Из Тинга</button>
        <button class="${state.tab === 'meetings' ? 'on' : ''}" data-act="tab" data-tab="meetings">Из Совещаний</button>
      </div>
      <div class="ting-card">${items}</div>
    </div>`;
  }

  function renderNew() {
    root.innerHTML = `<div class="ting-wrap">
      ${brand('новый')}
      <div class="ting-card">
        <h2 style="margin:0 0 12px">Создать Тинг</h2>
        <p class="ting-muted">Как начать?</p>
        <div class="ting-cta-row">
          <button class="ting-btn ting-btn-primary" data-act="new-now">Сейчас</button>
          <button class="ting-btn ting-btn-ghost" data-act="schedule">По расписанию</button>
        </div>
        <div id="ting-new-form" style="margin-top:14px">
          <input class="ting-field" id="ting-title" placeholder="Название" maxlength="200" />
          <label class="ting-muted"><input type="checkbox" id="ting-lobby" checked /> Лобби (гость ждёт допуска)</label>
          <div style="margin-top:14px;display:flex;gap:10px">
            <button class="ting-btn ting-btn-primary" data-act="create">Создать сейчас</button>
            <button class="ting-btn ting-btn-ghost" data-act="hub">Отмена</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderSchedule() {
    root.innerHTML = `<div class="ting-wrap">
      ${brand('расписание')}
      <div class="ting-card">
        <h2 style="margin:0 0 12px">Запланировать</h2>
        <input class="ting-field" id="ting-title" placeholder="Название" />
        <input class="ting-field" id="ting-when" type="datetime-local" />
        <div style="display:flex;gap:10px">
          <button class="ting-btn ting-btn-primary" data-act="create-sched">Сохранить</button>
          <button class="ting-btn ting-btn-ghost" data-act="hub">Назад</button>
        </div>
      </div>
    </div>`;
  }

  function renderMeetingCreate() {
    root.innerHTML = `<div class="ting-wrap">
      ${brand('совещание')}
      <div class="ting-card">
        <p class="ting-muted">Создаёт совещание ASGARD и комнату Тинга, открывает карточку доступа.</p>
        <input class="ting-field" id="ting-title" placeholder="Тема совещания" />
        <div style="display:flex;gap:10px">
          <button class="ting-btn ting-btn-primary" data-act="create-meeting">Создать</button>
          <button class="ting-btn ting-btn-ghost" data-act="hub">Отмена</button>
        </div>
      </div>
    </div>`;
  }

  function renderReady() {
    const r = state.room || {};
    const link = r.url || r.join_url || (location.origin + '/ting/' + (r.slug || ''));
    root.innerHTML = `<div class="ting-wrap">
      ${brand('готов')}
      <div class="ting-card" style="text-align:center">
        <div class="ting-chip gold">Тинг готов</div>
        <h2 style="margin:12px 0">${esc(r.title || 'Тинг')}</h2>
        <div class="ting-link-box" id="ting-link">${esc(link)}</div>
        <div class="ting-cta-row" style="justify-content:center">
          <button class="ting-btn ting-btn-primary" data-act="copy-link">Копировать ссылку</button>
          <button class="ting-btn ting-btn-ghost" data-act="copy-dial">Копировать код</button>
        </div>
        <div class="ting-dial" style="margin:18px 0">${esc(r.dial_code || '——————')}</div>
        <div class="ting-muted">Телефон: ${esc((state.dialin && state.dialin.phone) || '—')} · PIN: ${esc(r.pin_code || (r.pin_required ? 'задан' : 'нет'))}</div>
        <div class="ting-cta-row" style="justify-content:center;margin-top:18px">
          <button class="ting-btn ting-btn-primary" data-act="enter-lobby" data-slug="${esc(r.slug)}">Войти в комнату</button>
          <button class="ting-btn ting-btn-ghost" data-act="dialin">Инструкция dial-in</button>
          <button class="ting-btn ting-btn-ghost" data-act="hub">К списку</button>
        </div>
      </div>
    </div>`;
  }

  function renderMeetingCard() {
    const r = state.room || {};
    const link = r.url || (location.origin + '/ting/' + (r.slug || ''));
    root.innerHTML = `<div class="ting-wrap">
      ${brand('совещание')}
      <div class="ting-card">
        <h2>${esc(r.title || 'Совещание')}</h2>
        <p class="ting-muted">Статус: ${esc(r.status || '—')}</p>
        <div class="ting-access">
          <div class="ting-link-box">${esc(link)}</div>
          <div class="ting-dial">${esc(r.dial_code || '——————')}</div>
          <div class="ting-muted">Телефон: ${esc((state.dialin && state.dialin.phone) || '—')} · PIN: ${esc(r.pin_code || (r.pin_required ? 'задан' : 'нет'))}</div>
        </div>
        <div class="ting-cta-row">
          <button class="ting-btn ting-btn-primary" data-act="ready" data-slug="${esc(r.slug)}">Карточка доступа</button>
          <button class="ting-btn ting-btn-ghost" data-act="enter-lobby" data-slug="${esc(r.slug)}">Войти</button>
          <button class="ting-btn ting-btn-ghost" data-act="protocol" data-slug="${esc(r.slug)}">Протокол</button>
        </div>
      </div>
    </div>`;
  }

  function renderLobby() {
    const r = state.room || {};
    const name = (window.ASGARD_USER && (ASGARD_USER.full_name || ASGARD_USER.name)) || 'Участник';
    root.innerHTML = `<div class="ting-wrap">
      ${brand('лобби')}
      <div class="ting-card">
        <h2>${esc(r.title || 'Тинг')}</h2>
        <div class="ting-preview" id="ting-preview">
          <div class="avatar" id="ting-av">${esc(name.slice(0, 1).toUpperCase())}</div>
          <video id="ting-prev-v" playsinline muted autoplay style="display:none"></video>
        </div>
        <div class="ting-cta-row">
          <button class="ting-btn ting-btn-ghost" data-act="tog-mic" id="ting-lob-mic">Мик</button>
          <button class="ting-btn ting-btn-ghost" data-act="tog-cam" id="ting-lob-cam">Кам</button>
        </div>
        <input class="ting-field" id="ting-disp" value="${esc(name)}" maxlength="80" />
        <button class="ting-btn ting-btn-primary" style="width:100%" data-act="connect">Подключиться</button>
        <button class="ting-btn ting-btn-ghost" style="width:100%;margin-top:8px" data-act="hub">Назад</button>
      </div>
    </div>`;
    startPreview();
  }

  function renderWaiting() {
    root.innerHTML = `<div class="ting-wrap">
      ${brand('ожидание')}
      <div class="ting-card" style="text-align:center">
        <div class="ting-rune" style="margin:0 auto 12px">ᛏ</div>
        <h2>Почти внутри</h2>
        <p class="ting-muted">Хост скоро пустит · не закрывайте вкладку</p>
        <button class="ting-btn ting-btn-ghost" data-act="hub">Выйти</button>
      </div>
    </div>`;
  }

  function renderError(msg) {
    const text = msg || state.error || 'Ошибка';
    const isCode = /PIN|код|неверн/i.test(text);
    root.innerHTML = `<div class="ting-wrap">
      ${brand(isCode ? 'код' : 'ошибка')}
      <div class="ting-card" style="text-align:center" data-screen="${isCode ? 'error-code' : 'error'}">
        <h2>${isCode ? 'Неверный код или PIN' : 'Не удалось войти'}</h2>
        <p class="ting-muted">${esc(text)}</p>
        <button class="ting-btn ting-btn-primary" data-act="hub">На хаб</button>
      </div>
    </div>`;
  }

  function renderRoom() {
    const r = state.room || {};
    const side = state.side;
    let sideHtml = '';
    if (side === 'people') {
      const wait = (state.waiting || []).map(p =>
        `<div class="ting-list-item"><span>${esc(p.display_name || p.guest_name)}</span>
        <span><button class="ting-btn ting-btn-primary" style="padding:6px 10px" data-act="admit" data-id="${p.id}">Пустить</button>
        <button class="ting-btn ting-btn-ghost" style="padding:6px 10px" data-act="reject" data-id="${p.id}">✕</button></span></div>`
      ).join('') || '<div class="ting-muted">Нет ожидающих</div>';
      const parts = (state.participants || []).map(p =>
        `<div class="ting-list-item"><span>${esc(p.display_name || p.identity)} ${p.role === 'host' ? '👑' : ''}</span>
        ${p.role !== 'host' ? `<button class="ting-btn ting-btn-ghost" style="padding:6px 10px" data-act="kick" data-id="${esc(p.identity)}">Кик</button>` : ''}</div>`
      ).join('');
      sideHtml = `<div class="ting-side"><h3>Участники</h3>${parts}<h3 style="margin-top:16px">Лобби</h3>${wait}
        <button class="ting-btn ting-btn-ghost" style="width:100%;margin-top:12px" data-act="mute-all">Mute all</button></div>`;
    } else if (side === 'chat') {
      const msgs = (state.chat || []).map(m =>
        `<div style="margin:8px 0"><b>${esc(m.display_name || '—')}</b><div class="ting-muted">${esc(m.text)}</div></div>`
      ).join('') || '<div class="ting-muted">Нет сообщений</div>';
      sideHtml = `<div class="ting-side"><h3>Чат</h3><div id="ting-chat-list">${msgs}</div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <input class="ting-field" id="ting-chat-in" placeholder="Сообщение" style="margin:0" />
          <button class="ting-btn ting-btn-primary" data-act="chat-send">→</button>
        </div></div>`;
    }

    root.innerHTML = `<div class="ting-room-shell">
      ${state.recording ? '<div class="ting-consent">● Идёт запись · все участники уведомлены</div>' : ''}
      <div class="ting-room-top">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="ting-rune" style="width:28px;height:28px;font-size:14px">ᛏ</div>
          <strong>${esc(r.title || 'Тинг')}</strong>
          <span class="ting-muted" id="ting-timer">${fmtTime(state.timerSec)}</span>
        </div>
        <button class="ting-btn ting-btn-ghost" data-act="toggle-side" data-side="people">Люди</button>
      </div>
      <div class="ting-stage" id="ting-stage"></div>
      <div class="ting-filmstrip" id="ting-filmstrip" title="Участники"></div>
      ${sideHtml}
      <div class="ting-dock">
        <button class="ting-dock-btn ${state.micOn ? '' : 'off'}" data-act="mic" title="Микрофон">🎤</button>
        <button class="ting-dock-btn ${state.camOn ? '' : 'off'}" data-act="cam" title="Камера">📷</button>
        <button class="ting-dock-btn ${state.sharing ? 'off' : ''}" data-act="share" title="Экран">🖥️</button>
        <button class="ting-dock-btn" data-act="toggle-side" data-side="people" title="Участники">👥</button>
        <button class="ting-dock-btn" data-act="toggle-side" data-side="chat" title="Чат">💬</button>
        <button class="ting-dock-btn ${state.recording ? 'off' : ''}" data-act="rec" title="Запись">⏺</button>
        <button class="ting-dock-btn" data-act="host-end-open" title="Завершить">⏹</button>
        <button class="ting-dock-btn danger" data-act="leave" title="Выйти">📞</button>
      </div>
    </div>`;
    paintTiles();
  }

  function renderHostEnd() {
    const modal = document.createElement('div');
    modal.className = 'ting-modal-backdrop';
    modal.id = 'ting-host-end';
    modal.innerHTML = `<div class="ting-modal">
      <h2>Завершить Тинг?</h2>
      <p class="ting-muted">Комната закроется для всех. Начнётся AI-протокол.</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:16px">
        <button class="ting-btn ting-btn-danger" data-act="host-end-confirm">Завершить для всех</button>
        <button class="ting-btn ting-btn-ghost" data-act="host-end-cancel">Отмена</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
  }

  function renderEnded() {
    const r = state.room || {};
    root.innerHTML = `<div class="ting-wrap">
      ${brand('завершён')}
      <div class="ting-card" style="text-align:center">
        <h2>Тинг завершён</h2>
        <p class="ting-muted">${esc(r.title || '')}</p>
        <div class="ting-cta-row" style="justify-content:center">
          <button class="ting-btn ting-btn-primary" data-act="protocol" data-slug="${esc(r.slug)}">Открыть протокол</button>
          <button class="ting-btn ting-btn-ghost" data-act="open-recording" data-slug="${esc(r.slug)}">Запись</button>
          <button class="ting-btn ting-btn-ghost" data-act="hub">На хаб</button>
        </div>
      </div>
    </div>`;
  }

  function renderProtocol() {
    const p = state.protocol || {};
    const d = p.document || {};
    const status = p.status || 'pending';
    const tasks = (d.tasks || []).map(t => `<li>${esc(t.title || t.text || t)}</li>`).join('');
    root.innerHTML = `<div class="ting-wrap">
      ${brand('протокол')}
      <div style="margin-bottom:12px" class="ting-chip gold">статус: ${esc(status)}</div>
      <div class="ting-proto-doc" id="ting-proto">
        <div class="meta">ASGARD · Тинг</div>
        <h1>${esc(d.title || state.room?.title || 'Протокол')}</h1>
        <div class="meta">${esc(d.date || '')} · ${esc(d.duration || '')}</div>
        <h2>Участники</h2>
        <p>${esc((d.participants || []).join(', ') || '—')}</p>
        <h2>Повестка</h2>
        <p>${esc(d.agenda || '—')}</p>
        <h2>Решения</h2>
        <p>${esc(d.decisions || d.summary || '—')}</p>
        <h2>Задачи</h2>
        <ul>${tasks || '<li>—</li>'}</ul>
      </div>
      <div class="ting-cta-row" style="justify-content:center;margin-top:16px">
        ${p.can_edit ? '<button class="ting-btn ting-btn-primary" data-act="proto-edit">Редактировать</button>' : ''}
        <button class="ting-btn ting-btn-ghost" data-act="proto-pdf">PDF</button>
        <button class="ting-btn ting-btn-ghost" data-act="hub">Назад</button>
      </div>
    </div>`;
  }

  function renderDialin() {
    const d = state.dialin || {};
    root.innerHTML = `<div class="ting-wrap">
      ${brand('телефон')}
      <div class="ting-card">
        <h2>Вход по телефону</h2>
        <ol class="ting-steps">
          <li>Наберите <strong>${esc(d.phone || 'номер из ready-карточки')}</strong></li>
          <li>Введите 6-значный код Тинга</li>
          <li>Введите PIN комнаты</li>
          <li>Дождитесь соединения</li>
        </ol>
        <p class="ting-muted">${esc(d.instruction || 'Код и PIN — на карточке «Тинг готов».')}</p>
        <button class="ting-btn ting-btn-ghost" data-act="hub">Назад</button>
      </div>
    </div>`;
  }

  async function startPreview() {
    try {
      if (state.previewStream) state.previewStream.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      state.previewStream = stream;
      state.micOn = true; state.camOn = true;
      const v = qs('#ting-prev-v');
      const av = qs('#ting-av');
      if (v) { v.srcObject = stream; v.style.display = 'block'; }
      if (av) av.style.display = 'none';
    } catch (_) { /* preview optional */ }
  }

  function stopPreview() {
    if (state.previewStream) {
      state.previewStream.getTracks().forEach(t => t.stop());
      state.previewStream = null;
    }
  }

  function paintTiles() {
    const stage = qs('#ting-stage');
    const strip = qs('#ting-filmstrip');
    if (!stage || !state.lkRoom) return;
    stage.innerHTML = '';
    if (strip) strip.innerHTML = '';
    const room = state.lkRoom;
    const add = (identity, track, name, intoStrip) => {
      const div = document.createElement('div');
      div.className = 'ting-tile';
      div.dataset.id = identity;
      if (track && track.kind === 'video') {
        const v = document.createElement('video');
        v.playsInline = true; v.autoplay = true; v.muted = identity === room.localParticipant.identity;
        track.attach(v);
        div.appendChild(v);
      } else {
        div.innerHTML = `<div class="lbl" style="position:static;display:grid;place-items:center;height:100%;font-size:28px">${esc((name || identity || '?').slice(0, 1))}</div>`;
      }
      const lab = document.createElement('div');
      lab.className = 'lbl';
      lab.textContent = name || identity;
      div.appendChild(lab);
      if (intoStrip && strip) strip.appendChild(div);
      else stage.appendChild(div);
    };
    const lp = room.localParticipant;
    const vids = Array.from(lp.videoTrackPublications.values()).filter(p => p.track);
    if (vids[0]) add(lp.identity, vids[0].track, 'Вы', false);
    else add(lp.identity, null, 'Вы', false);
    room.remoteParticipants.forEach(p => {
      const vt = Array.from(p.videoTrackPublications.values()).find(x => x.track);
      add(p.identity, vt ? vt.track : null, p.name || p.identity, true);
    });
  }

  async function connectRoom(slug) {
    stopPreview();
    const name = (qs('#ting-disp') && qs('#ting-disp').value) || 'Участник';
    const tok = await api(`/api/thing/rooms/${encodeURIComponent(slug)}/token`, {
      method: 'POST',
      body: JSON.stringify({ display_name: name })
    });
    const LK = await loadLk();
    const room = new LK.Room({ adaptiveStream: true, dynacast: true });
    state.lkRoom = room;
    room.on(LK.RoomEvent.TrackSubscribed, () => paintTiles());
    room.on(LK.RoomEvent.TrackUnsubscribed, () => paintTiles());
    room.on(LK.RoomEvent.ParticipantConnected, () => { paintTiles(); refreshPeople(slug); });
    room.on(LK.RoomEvent.ParticipantDisconnected, () => { paintTiles(); refreshPeople(slug); });
    await room.connect(tok.url || tok.livekit_url, tok.token);
    try {
      const tracks = await LK.createLocalTracks({ audio: state.micOn, video: state.camOn });
      state.localTracks = tracks;
      for (const t of tracks) await room.localParticipant.publishTrack(t);
    } catch (e) { console.warn('local tracks', e); }
    state.view = 'room';
    state.timerSec = 0;
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = setInterval(() => {
      state.timerSec++;
      const el = qs('#ting-timer');
      if (el) el.textContent = fmtTime(state.timerSec);
    }, 1000);
    await refreshPeople(slug);
    await refreshChat(slug);
    render();
  }

  async function refreshPeople(slug) {
    try {
      const j = await api(`/api/thing/rooms/${encodeURIComponent(slug)}/participants`);
      const all = j.participants || [];
      state.waiting = all.filter(p => p.lobby_status === 'waiting');
      state.participants = all.filter(p => p.lobby_status !== 'waiting' && p.lobby_status !== 'rejected');
      state.isHost = !!j.is_host;
    } catch (_) {}
  }
  async function refreshChat(slug) {
    try {
      const j = await api(`/api/thing/rooms/${encodeURIComponent(slug)}/chat`);
      state.chat = j.messages || [];
    } catch (_) {}
  }

  async function leaveRoom(endAll) {
    const slug = state.room && state.room.slug;
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
    if (state.lkRoom) {
      try { await state.lkRoom.disconnect(); } catch (_) {}
      state.lkRoom = null;
    }
    state.localTracks.forEach(t => { try { t.stop(); } catch (_) {} });
    state.localTracks = [];
    if (endAll && slug) {
      try { await api(`/api/thing/rooms/${encodeURIComponent(slug)}/end`, { method: 'POST', body: '{}' }); } catch (_) {}
      state.view = 'ended';
      render();
      return;
    }
    go('hub');
  }

  async function route() {
    const p = parseHash();
    if (!p) return;
    state.view = p.view;
    state.tab = p.tab || state.tab;
    state.error = null;
    try {
      if (p.slug && !['hub', 'new', 'schedule', 'dialin', 'meeting-create'].includes(p.view)) {
        if (!state.room || state.room.slug !== p.slug) {
          state.room = unwrapRoom(await api(`/api/thing/rooms/${encodeURIComponent(p.slug)}`));
        }
      }
      if (p.view === 'hub') await loadHub();
      if (p.view === 'ready' || p.view === 'dialin' || p.view === 'meeting') {
        const d = await api('/api/thing/dial-in').catch(() => ({}));
        state.dialin = { phone: d.number, instruction: d.instruction, enabled: d.enabled };
      }
      if (p.view === 'protocol' && p.slug) {
        const raw = await api(`/api/thing/rooms/${encodeURIComponent(p.slug)}/protocol`);
        const minutes = raw.minutes || [];
        state.protocol = {
          status: raw.protocol_status || 'queued',
          can_edit: true,
          document: {
            title: state.room && state.room.title,
            date: new Date().toLocaleDateString('ru-RU'),
            agenda: minutes.filter(m => m.item_type === 'agenda').map(m => m.content).join('\n') || '—',
            decisions: minutes.filter(m => m.item_type === 'decision' || m.item_type === 'summary').map(m => m.content).join('\n') || (raw.status_labels && raw.status_labels[raw.protocol_status]) || '—',
            participants: [],
            tasks: minutes.filter(m => m.item_type === 'action' || m.item_type === 'task').map(m => ({ title: m.content }))
          },
          raw: raw
        };
      }
      if (p.view === 'lobby' && p.slug) {
        state.room = state.room || unwrapRoom(await api(`/api/thing/rooms/${encodeURIComponent(p.slug)}`));
      }
    } catch (e) {
      state.view = 'error';
      state.error = e.message;
    }
    render();
  }

  function render() {
    if (!root) return;
    const v = state.view;
    if (v === 'hub') renderHub();
    else if (v === 'new') renderNew();
    else if (v === 'schedule') renderSchedule();
    else if (v === 'meeting-create') renderMeetingCreate();
    else if (v === 'ready') renderReady();
    else if (v === 'meeting') renderMeetingCard();
    else if (v === 'lobby') renderLobby();
    else if (v === 'waiting') renderWaiting();
    else if (v === 'room') renderRoom();
    else if (v === 'ended') renderEnded();
    else if (v === 'protocol') renderProtocol();
    else if (v === 'dialin') renderDialin();
    else if (v === 'error') renderError();
    else renderHub();
  }

  async function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const slug = btn.dataset.slug || (state.room && state.room.slug);

    try {
      if (act === 'hub') { go('hub'); return; }
      if (act === 'new' || act === 'new-now') { go('new'); return; }
      if (act === 'schedule') { go('schedule'); return; }
      if (act === 'meeting-create') { go('meeting-create'); return; }
      if (act === 'dialin') { go('dialin'); return; }
      if (act === 'open-recording') {
        toast('Запись доступна хосту после egress (если была включена)');
        try {
          const j = await api(`/api/thing/rooms/${encodeURIComponent(slug)}/recording`);
          const rec = (j.recordings || [])[0];
          if (rec && rec.file_path) toast('Файл: ' + rec.file_path);
          else if (rec) toast('Статус записи: ' + (rec.status || '—'));
          else toast('Записи ещё нет', false);
        } catch (e) { toast(e.message || 'Нет записи', false); }
        return;
      }
      if (act === 'tab') { state.tab = btn.dataset.tab; go('hub', { tab: state.tab }); return; }
      if (act === 'ready') { go('ready', { slug }); return; }
      if (act === 'join') { go('lobby', { slug }); return; }
      if (act === 'enter-lobby') { go('lobby', { slug }); return; }
      if (act === 'protocol') { go('protocol', { slug }); return; }

      if (act === 'create' || act === 'create-sched') {
        const title = (qs('#ting-title') && qs('#ting-title').value || '').trim() || 'Тинг';
        const lobby = qs('#ting-lobby') ? qs('#ting-lobby').checked : true;
        const body = { title, lobby_enabled: lobby };
        if (act === 'create-sched' && qs('#ting-when') && qs('#ting-when').value) {
          body.scheduled_at = new Date(qs('#ting-when').value).toISOString();
        }
        const r = await api('/api/thing/rooms', { method: 'POST', body: JSON.stringify(body) });
        state.room = unwrapRoom(r);
        go('ready', { slug: state.room.slug });
        return;
      }
      if (act === 'create-meeting') {
        const title = (qs('#ting-title') && qs('#ting-title').value || '').trim() || 'Совещание';
        let room = null;
        try {
          const m = await api('/api/meetings', {
            method: 'POST',
            body: JSON.stringify({
              title,
              start_time: new Date(Date.now() + 5 * 60000).toISOString(),
              duration_minutes: 60
            })
          });
          const meetingId = (m.meeting && m.meeting.id) || m.id;
          if (meetingId) {
            const tr = await api('/api/thing/rooms', {
              method: 'POST',
              body: JSON.stringify({ title, meeting_id: meetingId, lobby_enabled: true, protocol_enabled: true })
            });
            room = unwrapRoom(tr);
          }
        } catch (_) {
          const r = await api('/api/thing/rooms', {
            method: 'POST',
            body: JSON.stringify({ title, lobby_enabled: true, protocol_enabled: true })
          });
          room = unwrapRoom(r);
        }
        if (room && room.slug) { state.room = room; go('meeting', { slug: room.slug }); }
        else toast('Создано', true);
        return;
      }
      if (act === 'copy-link') {
        const t = qs('#ting-link') && qs('#ting-link').textContent;
        await navigator.clipboard.writeText(t || '');
        toast('Ссылка скопирована');
        return;
      }
      if (act === 'copy-dial') {
        await navigator.clipboard.writeText(String((state.room && state.room.dial_code) || ''));
        toast('Код скопирован');
        return;
      }
      if (act === 'tog-mic') {
        state.micOn = !state.micOn;
        if (state.previewStream) state.previewStream.getAudioTracks().forEach(t => { t.enabled = state.micOn; });
        btn.textContent = state.micOn ? 'Мик' : 'Мик выкл';
        return;
      }
      if (act === 'tog-cam') {
        state.camOn = !state.camOn;
        const v = qs('#ting-prev-v'), av = qs('#ting-av');
        if (state.previewStream) state.previewStream.getVideoTracks().forEach(t => { t.enabled = state.camOn; });
        if (v) v.style.display = state.camOn ? 'block' : 'none';
        if (av) av.style.display = state.camOn ? 'none' : 'grid';
        btn.textContent = state.camOn ? 'Кам' : 'Кам выкл';
        return;
      }
      if (act === 'connect') {
        await connectRoom(slug);
        return;
      }
      if (act === 'mic' && state.lkRoom) {
        state.micOn = !state.micOn;
        await state.lkRoom.localParticipant.setMicrophoneEnabled(state.micOn);
        render();
        return;
      }
      if (act === 'cam' && state.lkRoom) {
        state.camOn = !state.camOn;
        await state.lkRoom.localParticipant.setCameraEnabled(state.camOn);
        render();
        return;
      }
      if (act === 'share' && state.lkRoom) {
        const LK = await loadLk();
        if (!state.sharing) {
          const track = await LK.createLocalScreenTracks({ audio: true });
          for (const t of track) await state.lkRoom.localParticipant.publishTrack(t);
          state.sharing = true;
        } else {
          const pubs = state.lkRoom.localParticipant.videoTrackPublications;
          for (const [, p] of pubs) {
            if (p.source === LK.Track.Source.ScreenShare || (p.track && p.track.source === 'screen_share')) {
              await state.lkRoom.localParticipant.unpublishTrack(p.track);
              p.track && p.track.stop();
            }
          }
          state.sharing = false;
        }
        render();
        return;
      }
      if (act === 'toggle-side') {
        const s = btn.dataset.side;
        state.side = state.side === s ? null : s;
        if (state.side === 'people') await refreshPeople(slug);
        if (state.side === 'chat') await refreshChat(slug);
        render();
        return;
      }
      if (act === 'admit') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/lobby/${btn.dataset.id}/admit`, { method: 'POST', body: '{}' });
        await refreshPeople(slug); render();
        return;
      }
      if (act === 'reject') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/lobby/${btn.dataset.id}/reject`, { method: 'POST', body: '{}' });
        await refreshPeople(slug); render();
        return;
      }
      if (act === 'kick') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/participants/${encodeURIComponent(btn.dataset.id)}/remove`, {
          method: 'POST', body: '{}'
        });
        await refreshPeople(slug); render();
        return;
      }
      if (act === 'mute-all') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/mute-all`, { method: 'POST', body: '{}' });
        toast('Mute all отправлен');
        return;
      }
      if (act === 'chat-send') {
        const inp = qs('#ting-chat-in');
        const text = (inp && inp.value || '').trim();
        if (!text) return;
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/chat`, {
          method: 'POST', body: JSON.stringify({ text })
        });
        if (inp) inp.value = '';
        await refreshChat(slug); render();
        return;
      }
      if (act === 'rec') {
        if (!state.recording) {
          await api(`/api/thing/rooms/${encodeURIComponent(slug)}/recording/start`, { method: 'POST', body: '{}' });
          state.recording = true;
          toast('Запись начата');
        } else {
          await api(`/api/thing/rooms/${encodeURIComponent(slug)}/recording/stop`, { method: 'POST', body: '{}' });
          state.recording = false;
          toast('Запись остановлена');
        }
        render();
        return;
      }
      if (act === 'host-end-open') { renderHostEnd(); return; }
      if (act === 'host-end-cancel') {
        const m = qs('#ting-host-end'); if (m) m.remove();
        return;
      }
      if (act === 'host-end-confirm') {
        const m = qs('#ting-host-end'); if (m) m.remove();
        await leaveRoom(true);
        return;
      }
      if (act === 'leave') { await leaveRoom(false); return; }
      if (act === 'proto-pdf') {
        window.print();
        return;
      }
      if (act === 'proto-edit') {
        const meetingId = state.room && state.room.meeting_id;
        if (!meetingId) {
          toast('Нет привязанного совещания — правки через Совещания', false);
          return;
        }
        const decisions = prompt('Решение / пункт протокола', (state.protocol.document && state.protocol.document.decisions) || '');
        if (decisions == null || !String(decisions).trim()) return;
        await api(`/api/meetings/${meetingId}/minutes`, {
          method: 'POST',
          body: JSON.stringify({ item_type: 'decision', content: String(decisions).trim() })
        });
        go('protocol', { slug });
        return;
      }
    } catch (err) {
      toast(err.message || String(err), false);
      if (/заверш|ended|не найден|PIN|код/i.test(err.message || '')) {
        state.view = 'error';
        state.error = err.message;
        render();
      }
    }
  }

  window.TingPage = {
    mount(el) {
      root = typeof el === 'string' ? document.querySelector(el) : el;
      if (!root) return;
      root.classList.add('ting-page');
      if (!document.getElementById('ting-manrope')) {
        const l = document.createElement('link');
        l.id = 'ting-manrope';
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap';
        document.head.appendChild(l);
      }
      root.onclick = onClick;
      route();
    },
    unmount() {
      stopPreview();
      if (state.lkRoom) { try { state.lkRoom.disconnect(); } catch (_) {} state.lkRoom = null; }
      if (state.timerId) clearInterval(state.timerId);
      if (root) { root.onclick = null; root.innerHTML = ''; }
      root = null;
    },
    onHash() { route(); }
  };

  window.AsgardTing = {
    async render({ layout }) {
      const auth = window.AsgardAuth && await AsgardAuth.requireUser();
      if (!auth) { location.hash = '#/login'; return; }
      if (!(location.hash || '').startsWith('#/ting')) {
        location.hash = '#/ting';
      }
      await layout('<div id="ting-root" class="ting-page"></div>', {
        title: 'Тинг',
        motto: 'Видеосовещания ASGARD'
      });
      TingPage.mount('#ting-root');
    }
  };

  window.addEventListener('hashchange', () => {
    if ((location.hash || '').indexOf('#/ting') === 0 && root) route();
  });
})();
