/* ASGARD Ting — CRM (#/ting). Telemost-level UI + Ting brand. */
(function () {
  'use strict';

  const LK_CDN = 'https://cdn.jsdelivr.net/npm/livekit-client@2.9.1/dist/livekit-client.umd.min.js';

  const COPY = {
    brandSub: 'совещания ASGARD',
    newTing: 'Новый Тинг',
    newTingHint: 'Начать прямо сейчас',
    join: 'Подключиться',
    joinHint: 'По ссылке или коду',
    schedule: 'Запланировать',
    scheduleHint: 'На дату и время',
    fromMeeting: 'Из совещания',
    tabsTing: 'Тинги',
    tabsMeetings: 'Совещания',
    today: 'Сегодня',
    yesterday: 'Вчера',
    earlier: 'Ранее',
    empty: 'Пока нет Тингов — создайте первый',
    lobbyWait: 'Зал ожидания (гость ждёт разрешения)',
    createNow: 'Создать сейчас',
    cancel: 'Отмена',
    back: 'Назад',
    ready: 'Комната готова',
    copyLink: 'Копировать ссылку',
    share: 'Поделиться',
    copyCode: 'Копировать код',
    enterRoom: 'Войти в комнату',
    phoneGuide: 'Вход по телефону',
    toList: 'К списку',
    mic: 'Микрофон',
    cam: 'Камера',
    screen: 'Экран',
    more: 'Ещё',
    leave: 'Выйти',
    end: 'Завершить',
    people: 'Участники',
    chat: 'Чат',
    remove: 'Удалить из комнаты',
    admit: 'Пустить',
    reject: 'Отклонить',
    muteAll: 'Выключить микрофоны у всех',
    waitingNone: 'Нет ожидающих',
    chatEmpty: 'Напишите первое сообщение',
    chatPh: 'Сообщение',
    send: 'Отправить',
    recording: 'Идёт запись · все участники уведомлены',
    endTitle: 'Завершить Тинг?',
    endBody: 'Комната закроется для всех. Начнётся AI-протокол.',
    endConfirm: 'Завершить для всех',
    grid: 'Сетка',
    speaker: 'Спикер',
    ended: 'Тинг завершён',
    protocol: 'Протокол',
    noMsg: 'Нет сообщений'
  };

  let root = null;
  let liveTimer = null;
  let crmLobbyPollId = null;
  let connectBusy = false;
  let tokenFailAt = 0;
  let tokenFailSlug = null;
  let state = {
    view: 'hub',
    tab: 'ting',
    rooms: [],
    meetings: [],
    room: null,
    protocol: null,
    dialin: null,
    lkRoom: null,
    micOn: true,
    camOn: true,
    sharing: false,
    peopleOpen: false,
    chatOpenMobile: false,
    chat: [],
    participants: [],
    waiting: [],
    recording: false,
    timerSec: 0,
    timerId: null,
    previewStream: null,
    error: null,
    hubError: null,
    layout: 'speaker',
    isHost: false,
    unreadChat: 0,
    myIdentity: null,
    activeSpeakerId: null,
    swapPrimary: false,
    pinnedId: null,
    joinToken: null
  };

  function harnessDemo() {
    return typeof window !== 'undefined' && window.__TING_HARNESS_DEMO__ === true;
  }

  const TingSound = (window.TingCommon && window.TingCommon.TingSound) || window.TingSound || { play() {} };
  const avatarTone = (window.TingCommon && window.TingCommon.avatarTone)
    || function (identity) {
      const s = String(identity || '');
      let h = 0;
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      return Math.abs(h) % 6;
    };
  const mergeChat = (window.TingCommon && window.TingCommon.mergeChat)
    || function (prev, incoming) { return (prev || []).concat(incoming || []); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function qs(sel, el) { return (el || document).querySelector(sel); }
  function toast(msg, ok) {
    if (window.AsgardUI && typeof AsgardUI.toast === 'function') {
      AsgardUI.toast(msg, ok === false ? 'error' : 'success');
      return;
    }
    let el = document.getElementById('ting-dom-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ting-dom-toast';
      el.className = 'ting-guest-toast';
      document.body.appendChild(el);
    }
    el.textContent = String(msg || '');
    el.classList.remove('hidden');
    clearTimeout(el._tingToastT);
    el._tingToastT = setTimeout(() => { el.classList.add('hidden'); }, 3200);
  }
  async function api(path, opts) {
    const token = localStorage.getItem('asgard_token');
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers }, opts || {}, {
      headers: Object.assign(headers, (opts && opts.headers) || {})
    }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(j.error || j.message || ('HTTP ' + r.status));
      err.code = j.code || null;
      err.status = r.status;
      err.body = j;
      throw err;
    }
    return j;
  }
  function unwrapRoom(j) { return (j && j.room) ? j.room : j; }
  function parseHash() {
    const h = location.hash || '';
    const m = h.match(/#\/ting(?:\?(.*))?$/);
    if (!m) return null;
    const p = new URLSearchParams(m[1] || '');
    return { view: p.get('view') || 'hub', slug: p.get('slug') || '', tab: p.get('tab') || 'ting', id: p.get('id') || '' };
  }
  function go(view, extra) {
    const q = new URLSearchParams(Object.assign({ view }, extra || {}));
    location.hash = '#/ting?' + q.toString();
  }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function initials(name) {
    if (window.TingCommon && TingCommon.initials) return TingCommon.initials(name);
    const base = String(name || '?').replace(/\([^)]*\)/g, ' ').replace(/[^\u0400-\u04FFa-zA-Z0-9\s.-]/g, ' ').trim();
    const parts = base.split(/\s+/).filter(Boolean).slice(0, 2);
    const out = parts.map((s) => {
      const m = s.match(/[\u0400-\u04FFa-zA-Z]/);
      return m ? m[0].toUpperCase() : '';
    }).join('');
    return out || '?';
  }
  function setIncall(on) {
    document.body.classList.toggle('ting-incall', !!on);
  }
  function logoMark(size) {
    const s = size || 44;
    const I = window.TingIcons;
    const svg = (I && I.logoMark()) || '';
    return `<div class="ting-logo-mark" style="width:${s}px;height:${s}px;border-radius:${Math.round(s * 0.32)}px" aria-hidden="true">${svg}</div>`;
  }
  function brand(chip) {
    return `<div class="ting-brand-row">
      <div class="ting-logo">${logoMark(44)}
        <div class="ting-logo-text"><strong>Тинг</strong><span>${esc(COPY.brandSub)}</span></div>
      </div>
      ${chip ? `<span class="ting-chip gold">${esc(chip)}</span>` : ''}
    </div>`;
  }
  function svgMic(off) { return (window.TingIcons && TingIcons.mic(off)) || ''; }
  function svgCam(off) { return (window.TingIcons && TingIcons.cam(off)) || ''; }
  function svgScreen() { return (window.TingIcons && TingIcons.screen()) || ''; }
  function svgPeople() { return (window.TingIcons && TingIcons.people()) || ''; }
  function svgChat() { return (window.TingIcons && TingIcons.chat()) || ''; }
  function svgMore() { return (window.TingIcons && TingIcons.more()) || ''; }
  function svgHang() { return (window.TingIcons && TingIcons.hang()) || ''; }
  function svgSpeaker() { return (window.TingIcons && TingIcons.speaker()) || ''; }

  function isChatMine(m) {
    const myId = window.ASGARD_USER && ASGARD_USER.id;
    const myIdent = state.myIdentity;
    if (myId != null && m.user_id != null && String(m.user_id) === String(myId)) return true;
    if (myIdent && m.identity && String(m.identity) === String(myIdent)) return true;
    return false;
  }

  function bannerError(msg) {
    if (!msg) return '';
    return `<div class="ting-banner-error" role="alert">${esc(msg)}</div>`;
  }

  function loadLk() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LK_CDN; s.async = true;
      s.onload = () => resolve(window.LivekitClient);
      s.onerror = () => reject(new Error('Не удалось загрузить видео-клиент'));
      document.head.appendChild(s);
    });
  }

  async function loadHub() {
    state.hubError = null;
    try {
      const rooms = await api('/api/thing/rooms');
      state.rooms = rooms.rooms || rooms.items || rooms || [];
      if (!Array.isArray(state.rooms)) state.rooms = [];
    } catch (e) {
      state.hubError = e.message || 'Не удалось загрузить список Тингов';
      state.rooms = [];
      state.meetings = [];
      toast(state.hubError, false);
      return;
    }
    try {
      const meetings = await api('/api/meetings?limit=40');
      state.meetings = (meetings.meetings || meetings.items || meetings || []).filter(m => m.thing_room_id || m.thing_slug);
      if (!Array.isArray(state.meetings)) state.meetings = [];
    } catch (e) {
      state.meetings = [];
      toast(e.message || 'Не удалось загрузить совещания', false);
    }
  }

  function dayLabel(iso) {
    if (!iso) return COPY.earlier;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return COPY.earlier;
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startY = new Date(startToday); startY.setDate(startY.getDate() - 1);
    if (d >= startToday) return COPY.today;
    if (d >= startY) return COPY.yesterday;
    return COPY.earlier;
  }
  function timeHm(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  function statusLabel(st) {
    const m = { live: 'Идёт сейчас', scheduled: 'Запланирован', ended: 'Завершён', cancelled: 'Отменён' };
    return m[st] || st || '—';
  }

  function renderHub() {
    setIncall(false);
    const list = state.tab === 'meetings' ? state.meetings : state.rooms;
    const groups = {};
    (list || []).forEach(r => {
      const key = dayLabel(r.started_at || r.created_at || r.start_time);
      (groups[key] = groups[key] || []).push(r);
    });
    const order = [COPY.today, COPY.yesterday, COPY.earlier];
    let body = '';
    order.forEach(day => {
      const items = groups[day];
      if (!items || !items.length) return;
      body += `<div class="ting-day">${esc(day)}</div>`;
      body += items.map(r => {
        const title = r.title || r.name || 'Без названия';
        const slug = r.slug || r.thing_slug || '';
        const st = r.status || 'scheduled';
        const missed = st === 'cancelled';
        const when = r.start_time || r.scheduled_at || r.started_at || r.created_at;
        const metaBits = [
          dayLabel(when) === COPY.today ? 'Сегодня' : (dayLabel(when) === COPY.yesterday ? 'Вчера' : ''),
          timeHm(when),
          r.dial_code ? 'код ' + r.dial_code : ''
        ].filter(Boolean).join(' · ');
        return `<div class="ting-call-row" data-slug="${esc(slug)}">
          <div class="ting-avatar ${st === 'live' ? 'gold' : ''}">${esc(initials(title))}</div>
          <div class="ting-call-meta">
            <strong>${esc(title)}</strong>
            <span class="${missed ? 'missed' : ''}">${esc(statusLabel(st))}${metaBits ? ' · ' + esc(metaBits) : ''}</span>
          </div>
          <span class="ting-chip ${st === 'live' ? 'gold' : ''}">${st === 'live' || st === 'ended' || !r.thing_room_id && state.tab === 'ting' ? 'Тинг' : 'CRM'}</span>
          ${slug ? `<button type="button" class="ting-btn ting-btn-primary ting-btn-compact" data-act="join" data-slug="${esc(slug)}">Войти</button>` : `<span class="ting-call-time">${esc(timeHm(when))}</span>`}
        </div>`;
      }).join('');
    });
    if (!body) body = `<div class="ting-empty">${esc(COPY.empty)}</div>`;
    if (state.hubError) toast(state.hubError, false);

    root.innerHTML = `<div class="ting-wrap">
      ${brand()}
      ${bannerError(state.hubError)}
      <div class="ting-hub-hero">
        <button type="button" class="ting-hub-card primary" data-act="new">
          <div class="ico">${logoMark(40)}</div>
          <strong>${esc(COPY.newTing)}</strong>
          <small>${esc(COPY.newTingHint)}</small>
        </button>
        <button type="button" class="ting-hub-card" data-act="join-prompt">
          <div class="ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v4"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg></div>
          <strong>${esc(COPY.join)}</strong>
          <small>${esc(COPY.joinHint)}</small>
        </button>
        <button type="button" class="ting-hub-card" data-act="schedule">
          <div class="ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></div>
          <strong>${esc(COPY.schedule)}</strong>
          <small>${esc(COPY.scheduleHint)}</small>
        </button>
      </div>
      <div class="ting-tabs">
        <button type="button" class="${state.tab === 'ting' ? 'on' : ''}" data-act="tab" data-tab="ting">${esc(COPY.tabsTing)}</button>
        <button type="button" class="${state.tab === 'meetings' ? 'on' : ''}" data-act="tab" data-tab="meetings">${esc(COPY.tabsMeetings)}</button>
        <button type="button" class="ting-btn ting-btn-ghost ting-btn-compact ting-tabs-trail" data-act="meeting-create">${esc(COPY.fromMeeting)}</button>
        <button type="button" class="ting-btn ting-btn-ghost ting-btn-compact" data-act="dialin">${esc(COPY.phoneGuide)}</button>
      </div>
      <div class="ting-card ting-card-tight">${body}</div>
    </div>`;
  }

  function renderNew() {
    setIncall(false);
    root.innerHTML = `<div class="ting-wrap">
      ${brand('новый')}
      <div class="ting-card">
        <h2 style="margin:0 0 8px;font-size:20px">Новый Тинг</h2>
        <p class="ting-muted">Участники по ссылке входят сами. Зал ожидания — по желанию.</p>
        <input class="ting-field" id="ting-title" placeholder="Название" maxlength="200" />
        <label class="ting-switch"><input type="checkbox" id="ting-lobby" /><span class="ting-switch-ui"></span><span>${esc(COPY.lobbyWait)}</span><span class="ting-tip" tabindex="0" data-tip="Гость ждёт, пока организатор пустит из панели участников">?</span></label>
        <div class="ting-cta-row">
          <button type="button" class="ting-btn ting-btn-primary" data-act="create">${esc(COPY.createNow)}</button>
          <button type="button" class="ting-btn ting-btn-ghost" data-act="hub">${esc(COPY.cancel)}</button>
        </div>
      </div>
    </div>`;
  }

  function defaultWhenParts(offsetMs) {
    const d = new Date(Date.now() + (offsetMs || 0));
    if (!offsetMs) d.setMinutes(0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    return {
      dateRu: d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }),
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      isoDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      label: d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    };
  }

  function parseRuDate(text) {
    const months = {
      января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
      июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11
    };
    const m = String(text || '').trim().toLowerCase().match(/^(\d{1,2})\s+([а-яё]+)\s+(\d{4})$/i);
    if (!m) return null;
    const mon = months[m[2]];
    if (mon == null) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${m[3]}-${pad(mon + 1)}-${pad(parseInt(m[1], 10))}`;
  }

  function readWhenField() {
    const dateRu = (qs('#ting-date') && qs('#ting-date').value) || '';
    const time = (qs('#ting-time') && qs('#ting-time').value) || '12:00';
    const iso = parseRuDate(dateRu) || (qs('#ting-date') && qs('#ting-date').dataset.iso) || '';
    if (!iso) return '';
    return `${iso}T${time}`;
  }

  function renderSchedule() {
    setIncall(false);
    const when = defaultWhenParts(3600000);
    root.innerHTML = `<div class="ting-wrap">
      ${brand('расписание')}
      <div class="ting-card">
        <h2 class="ting-h2-tight">${esc(COPY.schedule)}</h2>
        <p class="ting-muted">Дата, время и зал ожидания — как в карточке совещания Bitrix.</p>
        <label class="ting-muted ting-label-sm" for="ting-title">Название</label>
        <input class="ting-field" id="ting-title" placeholder="Например: Статус ОВКВ" maxlength="200" />
        <div class="ting-when-row">
          <div>
            <label class="ting-muted ting-label-sm" for="ting-date">Дата</label>
            <input class="ting-field" id="ting-date" type="text" inputmode="text" autocomplete="off"
              value="${esc(when.dateRu)}" data-iso="${esc(when.isoDate)}" placeholder="3 октября 2026" />
          </div>
          <div>
            <label class="ting-muted ting-label-sm" for="ting-time">Время</label>
            <input class="ting-field" id="ting-time" type="text" inputmode="numeric" autocomplete="off"
              value="${esc(when.time)}" placeholder="15:00" />
          </div>
        </div>
        <p class="ting-muted ting-label-sm" id="ting-when-hint">${esc(when.label)}</p>
        <label class="ting-switch"><input type="checkbox" id="ting-lobby" /><span class="ting-switch-ui"></span><span>${esc(COPY.lobbyWait)}</span><span class="ting-tip" tabindex="0" data-tip="Гость ждёт, пока организатор пустит из панели участников">?</span></label>
        <div class="ting-cta-row">
          <button type="button" class="ting-btn ting-btn-primary" data-act="create-sched">Сохранить</button>
          <button type="button" class="ting-btn ting-btn-ghost" data-act="hub">${esc(COPY.back)}</button>
        </div>
      </div>
    </div>`;
  }

  function inviteInitials(name) {
    return initials(name);
  }

  function renderMeetingCreate() {
    setIncall(false);
    const when = defaultWhenParts(300000);
    if (!state.createInvitees || !state.createInvitees.length) {
      const me = (typeof ASGARD_USER !== 'undefined' && ASGARD_USER && (ASGARD_USER.name || ASGARD_USER.email))
        || 'Вы (организатор)';
      state.createInvitees = harnessDemo()
        ? [{ name: me, kind: 'host' }, { name: 'Елена', kind: 'user' }, { name: 'Гость', kind: 'guest' }]
        : [{ name: me, kind: 'host' }];
    }
    const chips = state.createInvitees.map((p, i) =>
      `<span class="ting-invite-chip" data-invite-idx="${i}">
        <span class="ting-invite-av">${esc(inviteInitials(p.name))}</span>
        <span>${esc(p.name)}</span>
        ${p.kind === 'host' ? '' : `<button type="button" class="ting-invite-x" data-act="invite-remove" data-idx="${i}" aria-label="Убрать">×</button>`}
      </span>`
    ).join('');
    root.innerHTML = `<div class="ting-wrap">
      ${brand('совещание')}
      <div class="ting-card">
        <h2 class="ting-h2-tight">Совещание + Тинг</h2>
        <p class="ting-muted">Создаёт карточку совещания ASGARD и комнату Тинга с протоколом.</p>
        <label class="ting-muted ting-label-sm" for="ting-title">Тема</label>
        <input class="ting-field" id="ting-title" placeholder="Тема совещания" maxlength="200" />
        <div class="ting-when-row">
          <div>
            <label class="ting-muted ting-label-sm" for="ting-date">Дата</label>
            <input class="ting-field" id="ting-date" type="text" inputmode="text" autocomplete="off"
              value="${esc(when.dateRu)}" data-iso="${esc(when.isoDate)}" placeholder="3 октября 2026" />
          </div>
          <div>
            <label class="ting-muted ting-label-sm" for="ting-time">Время</label>
            <input class="ting-field" id="ting-time" type="text" inputmode="numeric" autocomplete="off"
              value="${esc(when.time)}" placeholder="15:00" />
          </div>
        </div>
        <p class="ting-muted ting-label-sm">${esc(when.label)}</p>
        <div class="ting-muted ting-label-sm">Участники</div>
        <div class="ting-invite-row" id="ting-invite-row">
          ${chips}
          <button type="button" class="ting-invite-add" data-act="invite-guest">+ гость</button>
        </div>
        <label class="ting-switch"><input type="checkbox" id="ting-lobby" /><span class="ting-switch-ui"></span><span>${esc(COPY.lobbyWait)}</span><span class="ting-tip" tabindex="0" data-tip="Гость ждёт, пока организатор пустит из панели участников">?</span></label>
        <label class="ting-switch"><input type="checkbox" id="ting-with-room" checked /><span class="ting-switch-ui"></span><span>Тинг-конференция</span><span class="ting-tip" tabindex="0" data-tip="Создать видеокомнату LiveKit вместе с карточкой совещания">?</span></label>
        <div class="ting-cta-row ting-stack">
          <button type="button" class="ting-btn ting-btn-primary" data-act="create-meeting">Создать совещание и комнату Тинга</button>
          <button type="button" class="ting-btn ting-btn-ghost" data-act="create-meeting-only">Только совещание</button>
          <button type="button" class="ting-btn ting-btn-ghost" data-act="hub">${esc(COPY.cancel)}</button>
        </div>
      </div>
    </div>`;
  }

  function qrUrl(link) {
    return 'https://api.qrserver.com/v1/create-qr-code/?size=168x168&margin=8&data=' + encodeURIComponent(link);
  }

  function renderReady() {
    setIncall(false);
    const r = state.room || {};
    const link = r.url || r.join_url || (location.origin + '/ting/' + (r.slug || ''));
    const phone = (state.dialin && state.dialin.phone) || '—';
    const pin = r.pin_code || (r.pin_required ? 'задан' : 'нет');
    root.innerHTML = `<div class="ting-wrap">
      ${brand()}
      <div class="ting-card ting-center-card">
        <div class="ting-ready-hero">
          ${logoMark(40)}
          <h2>Тинг готов</h2>
          <p class="ting-muted">Отправьте ссылку коллегам и клиентам</p>
          <p class="ting-ready-title">${esc(r.title || 'Тинг')}</p>
        </div>
        <div class="ting-link-box" id="ting-link">${esc(link)}</div>
        <div class="ting-cta-row ting-cta-center ting-stack">
          <button type="button" class="ting-btn ting-btn-primary ting-full-btn" data-act="enter-lobby" data-slug="${esc(r.slug)}">${esc(COPY.enterRoom)}</button>
          <div class="ting-cta-row ting-cta-center">
            <button type="button" class="ting-btn ting-btn-ghost" data-act="copy-link">${esc(COPY.copyLink)}</button>
            <button type="button" class="ting-btn ting-btn-ghost" data-act="share-link">${esc(COPY.share)}</button>
          </div>
        </div>
        <div class="ting-ready-dial-block">
          <div class="ting-muted ting-label-sm">Код для телефона</div>
          <div class="ting-dial-lg">${esc(r.dial_code || '——————')}</div>
          <div class="ting-muted">6 цифр · наберите после звонка на номер Тинга</div>
        </div>
        <div class="ting-ready-foot">
          <div class="ting-qr"><img src="${esc(qrUrl(link))}" alt="QR" width="128" height="128" /></div>
          <div class="phone-block">
            <div class="ting-muted">Без интернета — позвоните</div>
            <strong>${esc(phone)}</strong>
            <div class="ting-muted">код ${esc(r.dial_code || '—')} · PIN (опц.) ${esc(pin)}</div>
            <button type="button" class="ting-btn ting-btn-ghost ting-btn-compact ting-mt-10" data-act="dialin">Как дозвониться →</button>
          </div>
        </div>
        <div class="ting-cta-row ting-cta-center ting-mt-8">
          <button type="button" class="ting-btn ting-btn-ghost" data-act="copy-dial">${esc(COPY.copyCode)}</button>
          <button type="button" class="ting-btn ting-btn-ghost" data-act="hub">${esc(COPY.toList)}</button>
        </div>
      </div>
    </div>`;
  }

  function renderMeetingCard() {
    setIncall(false);
    const r = state.room || {};
    const link = r.url || (location.origin + '/ting/' + (r.slug || ''));
    root.innerHTML = `<div class="ting-wrap">
      ${brand('совещание')}
      <div class="ting-card">
        <h2 style="margin-top:0">${esc(r.title || 'Совещание')}</h2>
        <p class="ting-muted">Статус: ${esc(statusLabel(r.status))}</p>
        <div class="ting-link-box">${esc(link)}</div>
        <div class="ting-dial">${esc(r.dial_code || '——————')}</div>
        <div class="ting-cta-row">
          <button type="button" class="ting-btn ting-btn-primary" data-act="enter-lobby" data-slug="${esc(r.slug)}">${esc(COPY.join)}</button>
          <button type="button" class="ting-btn ting-btn-ghost" data-act="ready" data-slug="${esc(r.slug)}">Карточка доступа</button>
          <button type="button" class="ting-btn ting-btn-ghost" data-act="protocol" data-slug="${esc(r.slug)}">${esc(COPY.protocol)}</button>
        </div>
      </div>
    </div>`;
  }

  function renderLobby() {
    setIncall(false);
    const r = state.room || {};
    const name = (window.ASGARD_USER && (ASGARD_USER.full_name || ASGARD_USER.name)) || 'Участник';
    root.innerHTML = `<div class="ting-wrap">
      ${brand('вход')}
      <div class="ting-card ting-center-card">
        <h2 class="ting-h2-tight">${esc(r.title || 'Тинг')}</h2>
        <div class="ting-preview" id="ting-preview">
          <div class="ting-avatar tone-${avatarTone(name)} gold" id="ting-av">${esc(initials(name))}</div>
          <video id="ting-prev-v" playsinline muted autoplay class="ting-preview-video" hidden></video>
          <div class="ting-precall-controls">
            <button type="button" class="ting-dock-btn ${state.micOn ? 'active' : 'off'}" data-act="tog-mic" id="ting-lob-mic" title="${esc(COPY.mic)}" aria-label="${esc(COPY.mic)}">${svgMic(!state.micOn)}</button>
            <button type="button" class="ting-dock-btn ${state.camOn ? 'active' : 'off'}" data-act="tog-cam" id="ting-lob-cam" title="${esc(COPY.cam)}" aria-label="${esc(COPY.cam)}">${svgCam(!state.camOn)}</button>
          </div>
        </div>
        <input class="ting-field" id="ting-disp" value="${esc(name)}" maxlength="80" />
        <button type="button" class="ting-btn ting-btn-primary ting-full-btn" data-act="connect">${esc(COPY.join)}</button>
        <button type="button" class="ting-btn ting-btn-ghost ting-full-btn ting-mt-8" data-act="hub">${esc(COPY.back)}</button>
      </div>
    </div>`;
    startPreview();
  }

  function renderWaiting() {
    setIncall(false);
    root.innerHTML = `<div class="ting-wrap">
      ${brand('ожидание')}
      <div class="ting-card ting-center-card ting-stack">
        <div class="ting-wait-pulse" aria-hidden="true">${logoMark(56)}</div>
        <h2>Почти внутри</h2>
        <p class="ting-muted ting-wait-copy">Организатор скоро пустит · не закрывайте вкладку</p>
        <button type="button" class="ting-btn ting-btn-ghost" data-act="waiting-leave">${esc(COPY.leave)}</button>
      </div>
    </div>`;
  }

  function renderError(msg) {
    setIncall(false);
    const text = String(msg || state.error || '').trim();
    const isCode = /PIN|код|неверн/i.test(text);
    const title = isCode ? 'Неверный код или PIN' : 'Не удалось войти';
    const detail = text && text !== title && text !== 'Ошибка'
      ? text
      : (isCode
        ? 'Проверьте 6 цифр кода комнаты и PIN с карточки доступа.'
        : 'Сеть, права доступа или видео-сервер недоступны. Попробуйте ещё раз или откройте хаб.');
    root.innerHTML = `<div class="ting-wrap">
      ${brand(isCode ? 'код' : 'ошибка')}
      <div class="ting-card ting-center-card ting-stack">
        <h2>${esc(title)}</h2>
        <p class="ting-muted">${esc(detail)}</p>
        <div class="ting-cta-row ting-cta-center">
          <button type="button" class="ting-btn ting-btn-primary" data-act="hub">Повторить</button>
          <button type="button" class="ting-btn ting-btn-ghost" data-act="hub">Закрыть</button>
        </div>
      </div>
    </div>`;
  }

  function chatHtml() {
    const msgs = (state.chat || []).map(m => {
      const mine = isChatMine(m);
      const name = m.display_name || m.author || 'Участник';
      return `<div class="ting-chat-bubble ${mine ? 'me' : ''}"><b>${esc(name)}</b>${esc(m.text || '')}</div>`;
    }).join('') || `<div class="ting-muted">${esc(COPY.chatEmpty)}</div>`;
    const openCls = state.chatOpenMobile ? ' open' : '';
    return `<aside class="ting-chat${openCls}" id="ting-chat">
      <div class="ting-chat-head"><span>${esc(COPY.chat)}</span>
        <button type="button" class="ting-icon-btn ting-icon-sm" data-act="chat-close-mobile" title="Скрыть">✕</button>
      </div>
      <div class="ting-chat-list" id="ting-chat-list">${msgs}</div>
      <div class="ting-chat-input">
        <div class="ting-chat-compose">
          <input id="ting-chat-in" placeholder="${esc(COPY.chatPh)}" maxlength="2000" autocomplete="off" />
          <button type="button" class="ting-chat-send-ico" data-act="chat-send" title="${esc(COPY.send)}" aria-label="${esc(COPY.send)}">${(window.TingIcons && TingIcons.send()) || '→'}</button>
        </div>
      </div>
    </aside>`;
  }

  function peopleDrawerHtml() {
    if (!state.peopleOpen) return '';
    const wait = (state.waiting || []).map(p =>
      `<div class="ting-list-item ting-people-row">
        <span class="ting-people-av">${esc(initials(p.display_name || p.guest_name))}</span>
        <span class="ting-people-meta"><strong>${esc(p.display_name || p.guest_name || 'Гость')}</strong>
        <em class="ting-muted">зал ожидания</em></span>
      <span class="ting-list-actions"><button type="button" class="ting-btn ting-btn-primary" data-act="admit" data-id="${p.id}">${esc(COPY.admit)}</button>
      <button type="button" class="ting-btn ting-btn-ghost" data-act="reject" data-id="${p.id}">${esc(COPY.reject)}</button></span></div>`
    ).join('') || `<div class="ting-muted">${esc(COPY.waitingNone)}</div>`;
    const parts = (state.participants || []).map(p => {
      const label = p.label || p.display_name || p.identity || 'Участник';
      const host = p.role === 'host';
      const lk = state.lkRoom && (
        (state.lkRoom.localParticipant && state.lkRoom.localParticipant.identity === p.identity)
          ? state.lkRoom.localParticipant
          : (state.lkRoom.remoteParticipants && state.lkRoom.remoteParticipants.get(p.identity))
      );
      const micOff = lk ? lk.isMicrophoneEnabled === false : false;
      const camOff = lk ? !Array.from((lk.videoTrackPublications || new Map()).values()).some(x => x.track) : false;
      return `<div class="ting-list-item ting-people-row">
        <span class="ting-people-av">${esc(initials(label))}</span>
        <span class="ting-people-meta">
          <strong>${esc(label)}</strong>
          ${host ? '<span class="ting-host-chip">хост</span>' : ''}
          ${p.job_title && !String(label).includes(p.job_title) ? `<em class="ting-muted">${esc(p.job_title)}</em>` : ''}
        </span>
        <span class="ting-people-status" title="Мик / камера">
          <span class="${micOff ? 'off' : ''}">${svgMic(!!micOff)}</span>
          <span class="${camOff ? 'off' : ''}">${svgCam(!!camOff)}</span>
        </span>
        ${p.role !== 'host' ? `<span class="ting-list-actions"><button type="button" class="ting-btn ting-btn-ghost" data-act="remove" data-id="${esc(p.identity)}">${esc(COPY.remove)}</button></span>` : ''}
      </div>`;
    }).join('');
    const count = (state.participants || []).length;
    return `<div class="ting-people-drawer" id="ting-people">
      <div class="ting-drawer-head">
        <strong>${esc(COPY.people)} · ${count}</strong>
        <button type="button" class="ting-icon-btn ting-icon-sm" data-act="toggle-people">✕</button>
      </div>
      ${parts || '<div class="ting-muted">Пока никого нет</div>'}
      ${(state.waiting || []).length || state.isHost ? `<h4 class="ting-drawer-sub">Зал ожидания</h4>${wait}` : ''}
      ${state.isHost ? `<button type="button" class="ting-btn ting-btn-ghost ting-full-btn ting-mt-12" data-act="mute-all">${esc(COPY.muteAll)}</button>` : ''}
      ${state.isHost ? `<div class="ting-cta-row ting-mt-12"><button type="button" class="ting-btn ting-btn-ghost ting-btn-compact" data-act="rec-start">Запись</button><button type="button" class="ting-btn ting-btn-ghost ting-btn-compact" data-act="rec-stop">Стоп записи</button></div>` : ''}
    </div>`;
  }

  function dockHtml() {
    const endIco = (window.TingIcons && TingIcons.endCall()) || '';
    /* Chrome = текущий режим (не «переключить на»): speaker→иконка спикера+Спикер, grid→сетка+Сетка */
    const layoutIco = state.layout === 'speaker'
      ? svgSpeaker()
      : ((window.TingIcons && TingIcons.grid()) || svgSpeaker());
    const layoutLabel = state.layout === 'speaker' ? COPY.speaker : COPY.grid;
    return `<div class="ting-dock"><div class="ting-dock-inner">
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn on-gold" data-act="layout-toggle" title="Сменить раскладку: ${esc(layoutLabel)}">${layoutIco}</button><span>${esc(layoutLabel)}</span></div>
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn ${state.micOn ? 'active' : 'off'}" data-act="mic" title="${esc(COPY.mic)}">${svgMic(!state.micOn)}</button><span>Мик</span></div>
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn ${state.camOn ? 'active' : 'off'}" data-act="cam" title="${esc(COPY.cam)}">${svgCam(!state.camOn)}</button><span>Камера</span></div>
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn ${state.sharing ? 'on-gold' : ''}" data-act="share" title="${esc(COPY.screen)}">${svgScreen()}</button><span>Экран</span></div>
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn" data-act="toggle-people" title="${esc(COPY.people)}">${svgMore()}</button><span>Ещё</span></div>
      <div class="ting-dock-sep" aria-hidden="true"></div>
      ${state.isHost ? `<div class="ting-dock-cap"><button type="button" class="ting-dock-btn" data-act="host-end-open" title="${esc(COPY.end)}">${endIco}</button><span>${esc(COPY.end)}</span></div>` : ''}
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn danger" data-act="leave" title="${esc(COPY.leave)}">${svgHang()}</button><span>Выйти</span></div>
    </div></div>`;
  }

  function renderRoom() {
    setIncall(true);
    const r = state.room || {};
    const n = Math.max(1, (state.participants || []).length || (state.lkRoom ? 1 + state.lkRoom.remoteParticipants.size : 1));
    const peopleOpen = !!state.peopleOpen;
    const hideChat = peopleOpen || (typeof window !== 'undefined' && window.innerWidth <= 820 && !state.chatOpenMobile);
    root.innerHTML = `<div class="ting-room-shell${hideChat || peopleOpen ? ' no-chat' : ''}">
      <div class="ting-room-main${peopleOpen ? ' has-people' : ''}">
        <div class="ting-room-top">
          ${state.recording ? `<div class="ting-consent" role="status">● ${esc(COPY.recording)}</div>` : ''}
          <div class="ting-room-top-row">
            <div class="ting-room-title">
              ${logoMark(28)}
              <div class="ting-room-title-text">
                <strong>${esc(r.title || 'Тинг')}</strong>
                <span class="ting-muted" id="ting-timer">${fmtTime(state.timerSec)}</span>
              </div>
            </div>
            <div class="ting-top-actions">
              <span class="ting-count-chip">${n} в комнате</span>
              <button type="button" class="ting-icon-btn" data-act="toggle-people" title="${esc(COPY.people)}">${svgPeople()}</button>
              <button type="button" class="ting-icon-btn" data-act="chat-open-mobile" title="${esc(COPY.chat)}">
                ${svgChat()}
                ${state.unreadChat ? `<span class="badge">${state.unreadChat > 9 ? '9+' : state.unreadChat}</span>` : ''}
              </button>
            </div>
          </div>
        </div>
        <div class="ting-stage-wrap">
          <div class="ting-filmstrip" id="ting-filmstrip"></div>
          <div class="ting-stage ${state.layout === 'speaker' ? 'speaker' : 'g2'}" id="ting-stage"></div>
          ${peopleDrawerHtml()}
        </div>
        ${dockHtml()}
      </div>
      ${peopleOpen ? '' : chatHtml()}
    </div>`;
    paintTiles();
    const list = qs('#ting-chat-list');
    if (list) list.scrollTop = list.scrollHeight;
  }

  function renderHostEnd() {
    if (qs('#ting-host-end')) return;
    const modal = document.createElement('div');
    modal.className = 'ting-modal-backdrop';
    modal.id = 'ting-host-end';
    modal.innerHTML = `<div class="ting-modal ting-modal-enter">
      <h2>${esc(COPY.endTitle)}</h2>
      <p class="ting-muted">${esc(COPY.endBody)}</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:16px">
        <button type="button" class="ting-btn ting-btn-danger" data-act="host-end-confirm">${esc(COPY.endConfirm)}</button>
        <button type="button" class="ting-btn ting-btn-ghost" data-act="host-end-cancel">${esc(COPY.cancel)}</button>
      </div>
    </div>`;
    // Modal lives on document.body (above stage). root.onclick does not see it —
    // wire acts here so cancel/confirm always work (CRM + harness).
    modal.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!btn || !modal.contains(btn)) return;
      const act = btn.getAttribute('data-act');
      if (act === 'host-end-cancel') {
        modal.remove();
        return;
      }
      if (act === 'host-end-confirm') {
        modal.remove();
        leaveRoom(true);
      }
    });
    document.body.appendChild(modal);
  }

  function renderEnded() {
    setIncall(false);
    const r = state.room || {};
    root.innerHTML = `<div class="ting-wrap">
      ${brand('завершён')}
      <div class="ting-card ting-center-card ting-stack">
        <h2>${esc(COPY.ended)}</h2>
        <p class="ting-muted">${esc(r.title || '')}</p>
        <div class="ting-cta-row ting-cta-center">
          <button type="button" class="ting-btn ting-btn-primary" data-act="protocol" data-slug="${esc(r.slug)}">Открыть протокол</button>
          <button type="button" class="ting-btn ting-btn-ghost" data-act="open-recording" data-slug="${esc(r.slug)}">Запись</button>
          <button type="button" class="ting-btn ting-btn-ghost" data-act="hub">Закрыть</button>
        </div>
      </div>
    </div>`;
  }

  function renderProtocol() {
    setIncall(false);
    const p = state.protocol || {};
    const d = p.document || {};
    const raw = p.raw || {};
    const statusKey = raw.protocol_status || p.status || '';
    const status = (raw.status_labels && raw.status_labels[statusKey])
      || ({ queued: 'В очереди', pending: 'Ожидание', processing: 'ИИ обрабатывает',
        ready: 'Готов', done: 'Готов', failed: 'Ошибка', skipped: 'Пропущен',
        transcribing: 'Транскрибация', generating: 'Генерация' })[statusKey]
      || statusKey
      || '—';
    const taskStatusLabel = (s) => ({ open: 'открыто', done: 'сделано', closed: 'сделано', in_progress: 'в работе' }[s] || s || 'открыто');
    const tasks = (d.tasks || []).map(t => {
      const st = String(t.status || 'open').toLowerCase();
      const done = st === 'done' || st === 'closed';
      const badge = done ? 'done' : (st === 'in_progress' ? 'progress' : 'open');
      return `<label class="ting-proto-task ${done ? 'done' : ''}">
        <input type="checkbox" ${done ? 'checked' : ''} disabled aria-label="${esc(taskStatusLabel(st))}" />
        <span>
          <span class="ting-proto-task-title">${esc(t.title || t.text || t)}</span>
          <span class="ting-proto-task-meta">${esc(t.assignee || '—')} · ${esc(t.due || '—')} · <span class="ting-proto-status ting-proto-status-${badge}">${esc(taskStatusLabel(st))}</span></span>
        </span>
      </label>`;
    }).join('');
    const title = d.title || (state.room && state.room.title) || 'Протокол Тинга';
    const parts = (d.participants || []).length ? d.participants.join(', ') : '';
    const decisions = (d.decisions && d.decisions !== '—') ? d.decisions : '';
    const agenda = (d.agenda && d.agenda !== '—') ? d.agenda : '';
    const openQ = d.open_questions || '';
    const hasBody = !!(parts || decisions || agenda || tasks || openQ);
    const preparing = !statusKey || ['queued', 'pending', 'processing', 'transcribing', 'generating'].includes(statusKey);
    const emptyHint = preparing ? 'Протокол готовится' : 'Протокол пуст';
    const meetingId = (state.room && state.room.meeting_id) || raw.meeting_id || null;
    const meetingHref = meetingId ? `#/meetings/${meetingId}` : (state.room && state.room.slug ? `#/ting?view=meeting&slug=${encodeURIComponent(state.room.slug)}` : '#/meetings');
    const summary = d.summary || decisions || (harnessDemo() ? 'Согласовали объёмы ОВКВ; КП уходит заказчику до пятницы.' : '');
    const partRows = (d.participant_rows || []).length
      ? d.participant_rows.map(pr =>
          `<div class="ting-proto-part"><span class="ting-proto-part-av">${esc(inviteInitials(pr.name))}</span>
           <span>${esc(pr.name)}</span><span class="ting-proto-part-role">${esc(pr.role || '')}</span></div>`
        ).join('')
      : (parts ? `<p>${esc(parts)}</p>` : '');
    const logoUrl = d.client_logo_url || raw.client_logo_url || '';
    const logoSlot = logoUrl
      ? `<div class="ting-proto-logo-slot"><img src="${esc(logoUrl)}" alt="" /></div>`
      : `<div class="ting-proto-logo-slot"><div class="ting-proto-mark">ASGARD</div></div>`;
    const bodyHtml = hasBody
      ? `<div class="ting-proto-doc" id="ting-proto">
        <div class="ting-proto-letterhead">
          ${logoSlot}
          <div>
            <div class="meta">CRM · Тинг · протокол${d.protocol_no ? ' · № ' + esc(d.protocol_no) : ''}</div>
            ${meetingId ? `<span class="ting-proto-pill">Совещание #${esc(String(meetingId))}</span>` : ''}
          </div>
        </div>
        <h1>${esc(title)}</h1>
        <div class="meta">
          Дата: ${esc(d.date || '—')}
          ${d.duration ? ' · Длительность: ' + esc(d.duration) : ''}
        </div>
        ${summary ? `<section class="ting-proto-section"><h2>Резюме</h2><p class="ting-proto-summary">${esc(summary)}</p></section>` : ''}
        ${partRows ? `<section class="ting-proto-section"><h2>Участники</h2><div class="ting-proto-parts">${partRows}</div></section>` : ''}
        ${decisions ? `<section class="ting-proto-section"><h2>Решения</h2><p>${esc(decisions)}</p></section>` : ''}
        ${agenda ? `<section class="ting-proto-section"><h2>Повестка</h2><p>${esc(agenda)}</p></section>` : ''}
        ${tasks ? `<section class="ting-proto-section"><h2>Поручения</h2>${tasks}</section>` : ''}
        ${openQ ? `<section class="ting-proto-section"><h2>Открытые вопросы</h2><p>${esc(openQ)}</p></section>` : ''}
      </div>`
      : `<div class="ting-proto-doc ting-proto-empty" id="ting-proto">
          <div class="ting-proto-watermark" aria-hidden="true">ASGARD</div>
          <div class="meta">ASGARD CRM · Тинг · протокол</div>
          <h1>${esc(title)}</h1>
          <p class="ting-proto-empty-hint">${esc(emptyHint)}</p>
        </div>`;
    root.innerHTML = `<div class="ting-wrap">
      ${brand('протокол')}
      <div class="ting-proto-toolbar">
        <span class="ting-chip gold">${esc(status)}</span>
        <label class="ting-proto-toggle"><input type="checkbox" checked disabled /><span>ИИ</span></label>
        <label class="ting-proto-toggle"><input type="checkbox" checked disabled /><span>Просмотр</span></label>
        <a class="ting-proto-meeting-link" href="${esc(meetingHref)}" data-act="proto-meeting">В совещание →</a>
      </div>
      ${bodyHtml}
      <div class="ting-cta-row ting-cta-center ting-mt-16">
        ${hasBody ? '<button type="button" class="ting-btn ting-btn-primary" data-act="proto-send">Отправить всем</button>' : ''}
        ${p.can_edit && hasBody ? '<button type="button" class="ting-btn ting-btn-ghost" data-act="proto-edit">Редактировать</button>' : ''}
        ${hasBody ? '<button type="button" class="ting-btn ting-btn-ghost" data-act="proto-pdf">Печать / PDF</button>' : ''}
        ${hasBody && meetingId ? `<a class="ting-btn ting-btn-ghost" href="#/meetings/${esc(String(meetingId))}" data-act="proto-meeting">Задачи в совещании</a>` : ''}
        <button type="button" class="ting-btn ting-btn-ghost" data-act="hub">${esc(COPY.back)}</button>
      </div>
    </div>`;
  }

  function renderDialin() {
    setIncall(false);
    const d = state.dialin || {};
    const r = state.room || {};
    const code = r.dial_code || (harnessDemo() ? '482917' : '');
    const pin = r.pin_code || (harnessDemo() ? '3914' : '');
    const phone = d.number || d.phone || '';
    root.innerHTML = `<div class="ting-wrap">
      ${brand('телефон')}
      <div class="ting-card ting-center-card">
        <h2 class="ting-h2-tight">${esc(COPY.phoneGuide)}</h2>
        <div class="ting-dialin-hero">
          <div class="ting-muted ting-label-sm">Номер Тинга</div>
          <div class="ting-dialin-number">${esc(phone || 'номер не настроен')}</div>
          ${code ? `<div class="ting-muted ting-label-sm ting-mt-12">Код комнаты</div><div class="ting-dial ting-dial-lg">${esc(code)}</div>` : ''}
          ${pin ? `<div class="ting-muted ting-label-sm">PIN (опц.)</div><div class="ting-dial">${esc(pin)}</div>` : ''}
        </div>
        <div class="ting-step-cards">
          <div class="ting-step-card"><span class="n">1</span><div><strong>Позвоните</strong><p>${esc(phone || 'номер не настроен')}</p></div></div>
          <div class="ting-step-card"><span class="n">2</span><div><strong>Код комнаты</strong><p>${code ? esc(code) : '6 цифр с карточки'}</p></div></div>
          <div class="ting-step-card"><span class="n">3</span><div><strong>PIN</strong><p>${pin ? esc(pin) : 'если включён на карточке'}</p></div></div>
          <div class="ting-step-card"><span class="n">4</span><div><strong>В эфире</strong><p>Дождитесь соединения</p></div></div>
        </div>
        <div class="ting-cta-row ting-cta-center">
          <button type="button" class="ting-btn ting-btn-primary" data-act="copy-dial-instr">Скопировать инструкцию</button>
          <button type="button" class="ting-btn ting-btn-ghost" data-act="hub">${esc(COPY.back)}</button>
        </div>
      </div>
    </div>`;
  }

  async function startPreview() {
    const gen = (state.previewGen = (state.previewGen || 0) + 1);
    try {
      if (state.previewStream) {
        state.previewStream.getTracks().forEach(t => t.stop());
        state.previewStream = null;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (gen !== state.previewGen || state.view !== 'lobby') {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      state.previewStream = stream;
      state.micOn = true; state.camOn = true;
      const v = qs('#ting-prev-v');
      const av = qs('#ting-av');
      if (v) { v.srcObject = stream; v.hidden = false; v.style.display = 'block'; }
      if (av) av.style.display = 'none';
      const micB = qs('#ting-lob-mic');
      const camB = qs('#ting-lob-cam');
      if (micB) { micB.classList.toggle('active', state.micOn); micB.classList.toggle('off', !state.micOn); micB.innerHTML = svgMic(!state.micOn); }
      if (camB) { camB.classList.toggle('active', state.camOn); camB.classList.toggle('off', !state.camOn); camB.innerHTML = svgCam(!state.camOn); }
    } catch (_) { /* preview optional — show avatar */ }
  }
  function stopPreview() {
    state.previewGen = (state.previewGen || 0) + 1;
    if (state.previewStream) {
      state.previewStream.getTracks().forEach(t => t.stop());
      state.previewStream = null;
    }
  }

  function detachStageVideos() {
    const room = state.lkRoom;
    if (room) {
      const detachPub = (pub) => {
        if (pub && pub.track && typeof pub.track.detach === 'function') {
          try { pub.track.detach(); } catch (_) { /* */ }
        }
      };
      try {
        room.localParticipant.trackPublications.forEach(detachPub);
        room.remoteParticipants.forEach((p) => p.trackPublications.forEach(detachPub));
      } catch (_) { /* */ }
    }
    [qs('#ting-stage'), qs('#ting-filmstrip')].forEach((el) => {
      if (!el) return;
      el.querySelectorAll('video').forEach((v) => {
        try { v.srcObject = null; } catch (_) { /* */ }
      });
    });
  }

  function paintTiles() {
    const stage = qs('#ting-stage');
    const strip = qs('#ting-filmstrip');
    if (!stage) return;
    detachStageVideos();
    stage.innerHTML = '';
    if (strip) strip.innerHTML = '';

    function resolvePartLabel(identity, fallback) {
      if (fallback === 'Вы') {
        const me = (state.participants || []).find(p => p.identity === (state.myIdentity || identity));
        if (me && (me.label || me.display_name)) return 'Вы · ' + (me.label || me.display_name);
        return 'Вы';
      }
      const row = (state.participants || []).find(p => p.identity === identity);
      if (row && (row.label || row.display_name)) return row.label || row.display_name;
      if (fallback && !/^user_\d+$/i.test(fallback) && fallback !== identity) return fallback;
      return fallback || 'Участник';
    }

    const makeTile = (identity, videoTrack, name, micMuted, opts) => {
      const div = document.createElement('div');
      const cinematic = !!(opts && opts.cinematic);
      const speaking = !!(opts && opts.speak);
      const tone = avatarTone(identity || name);
      const resolved = resolvePartLabel(identity, name);
      div.className = 'ting-tile'
        + (speaking ? ' speak' : '')
        + (cinematic ? ' ting-tile-cinematic' : '')
        + (opts && opts.pip ? ' is-pip is-swappable' : '')
        + (opts && opts.swap ? ' is-swappable' : '');
      div.dataset.id = identity;
      if (videoTrack) {
        const v = document.createElement('video');
        v.playsInline = true; v.autoplay = true;
        v.muted = !!(opts && opts.mutedLocal);
        if (opts && opts.contain) v.classList.add('is-contain');
        videoTrack.attach(v);
        div.appendChild(v);
      } else {
        const ph = document.createElement('div');
        ph.className = 'ting-tile-ph tone-' + tone + (cinematic ? ' cinematic' : '');
        const gold = opts && opts.gold ? ' gold' : '';
        const speakCls = speaking ? ' speaking' : '';
        ph.innerHTML = `<div class="ting-avatar tone-${tone}${gold}${speakCls}">${esc(initials(resolved || identity))}</div>`;
        div.appendChild(ph);
      }
      const lab = document.createElement('div');
      lab.className = 'lbl';
      lab.innerHTML = `<span class="mic ${micMuted ? 'off' : ''}">${svgMic(!!micMuted)}</span><span class="name">${esc(resolved || identity)}</span>`;
      div.appendChild(lab);
      // Клик по тайлу участника:
      //  - PiP в 1-на-1 (opts.pip)   → swap «я ↔ собеседник»;
      //  - тайл ленты в группе (opts.swap) → поставить выбранного в центр (pin), повторный клик снимает.
      if (opts && opts.pip) {
        div.title = state.swapPrimary
          ? 'Вернуть собеседника в центр'
          : 'Нажмите, чтобы показать себя крупно';
        div.addEventListener('click', () => {
          state.swapPrimary = !state.swapPrimary;
          state.pinnedId = null;
          paintTiles();
        });
      } else if (opts && opts.swap) {
        const applied = state.pinnedId === identity;
        div.title = applied
          ? 'Вернуть активного спикера в центр'
          : 'Нажмите, чтобы вывести участника в центр';
        div.addEventListener('click', () => {
          state.pinnedId = applied ? null : identity; // повторный клик снимает пин
          state.swapPrimary = false;
          paintTiles();
        });
      } else if (opts && opts.pin && state.pinnedId) {
        /* Центральный тайл в группе: клик снимает пин и возвращает авто-спикера */
        div.classList.add('is-swappable');
        div.title = 'Вернуть активного спикера в центр';
        div.addEventListener('click', () => {
          state.pinnedId = null;
          paintTiles();
        });
      }
      return div;
    };

    // Demo tiles ONLY in harness; otherwise connecting / empty
    if (!state.lkRoom) {
      if (harnessDemo()) {
        if (state.layout === 'speaker') {
          stage.className = 'ting-stage speaker';
          // Демо зеркалит реальную логику: roster=2 → 1-на-1 (центр + PiP),
          // roster=3 (demo=group) → группа (центр + лента, без PiP).
          const roster = (typeof window !== 'undefined' && window.__TING_DEMO_EXTRA__) ? ['host', 'e', 'p'] : ['host', 'e'];
          const people = { host: 'Никита · организатор', e: 'Елена', p: 'Гость' };
          if (roster.length <= 2) {
            const mainId = state.swapPrimary ? 'host' : 'e';
            const pipId = mainId === 'host' ? 'e' : 'host';
            stage.appendChild(makeTile(mainId, null, people[mainId], false, { speak: true, gold: true, cinematic: true }));
            stage.appendChild(makeTile(pipId, null, people[pipId], false, { pip: true, cinematic: true }));
          } else {
            const mainId = state.pinnedId || 'e';
            stage.appendChild(makeTile(mainId, null, people[mainId], false, {
              speak: true, gold: true, cinematic: true, pin: !!state.pinnedId
            }));
            if (strip) {
              roster.filter((id) => id !== mainId).forEach((id) => {
                strip.appendChild(makeTile(id, null, people[id], id === 'p', { cinematic: true, swap: true }));
              });
            }
          }
        } else {
          stage.className = 'ting-stage auto';
          stage.appendChild(makeTile('host', null, 'Никита · организатор', false, { speak: true, gold: true, cinematic: true }));
          stage.appendChild(makeTile('e', null, 'Елена', false, { cinematic: true, gold: true }));
          stage.appendChild(makeTile('p', null, 'Гость', true, { cinematic: true }));
        }
      } else {
        stage.className = 'ting-stage g1';
        stage.innerHTML = '<div class="ting-stage-connecting">Подключение…</div>';
      }
      return;
    }

    const room = state.lkRoom;
    const speakerMode = state.layout === 'speaker';
    const lp = room.localParticipant;
    /* Запиненный участник мог выйти — тогда пин недействителен (иначе центр пустой) */
    if (state.pinnedId && state.pinnedId !== lp.identity
      && !Array.from(room.remoteParticipants.values()).some(p => p.identity === state.pinnedId)) {
      state.pinnedId = null;
    }
    const localVid = Array.from(lp.videoTrackPublications.values()).find(p => p.track && p.source !== (window.LivekitClient && LivekitClient.Track && LivekitClient.Track.Source.ScreenShare));
    const screenPub = Array.from(lp.videoTrackPublications.values()).find(p => {
      try { return p.source === LivekitClient.Track.Source.ScreenShare; } catch (_) { return /screen/i.test(String(p.source || '')); }
    });
    const remotes = Array.from(room.remoteParticipants.values());

    const activeId = state.activeSpeakerId;
    const isScreenPub = (pub) => {
      try { return /screen/i.test(String((pub && pub.source) || '')); } catch (_) { return false; }
    };
    const hasScreen = (p) => {
      try {
        return Array.from(p.videoTrackPublications.values()).some(x => x.track && isScreenPub(x));
      } catch (_) { return false; }
    };
    const pickVideo = (p) => {
      const pubs = Array.from(p.videoTrackPublications.values());
      const screen = pubs.find(x => x.track && /screen/i.test(String(x.source || '')));
      if (screen && screen.track) return screen.track;
      const cam = pubs.find(x => x.track);
      return cam && cam.track;
    };

    if (speakerMode) {
      stage.className = 'ting-stage speaker';
      const joinCount = 1 + remotes.length;   // видимых участников (включая себя)
      let mainP = lp;
      let mainTrack = screenPub && screenPub.track ? screenPub.track : (localVid && localVid.track);
      let mainName = 'Вы';
      let contain = !!(screenPub && screenPub.track);
      /* Приоритет центра: своя презентация → свап (себя в центр) → активный спикер → первый с видео */
      let screenOwner = null;
      if (screenPub && screenPub.track) screenOwner = lp;
      remotes.forEach(p => {
        const sp = Array.from(p.videoTrackPublications.values()).find(x => x.track && /screen/i.test(String(x.source || '')));
        if (sp && sp.track) screenOwner = p;
      });
      if (screenOwner) {
        mainP = screenOwner;
        mainTrack = pickVideo(screenOwner);
        mainName = screenOwner.identity === lp.identity ? 'Вы' : (screenOwner.name || screenOwner.identity);
        contain = true;
      } else if (state.pinnedId) {
        /* Ручной пин (клик по тайлу участника) — приоритетнее активного спикера */
        if (lp.identity === state.pinnedId) {
          mainP = lp; mainTrack = localVid && localVid.track; mainName = 'Вы';
        } else {
          const pp = remotes.find(p => p.identity === state.pinnedId);
          if (pp) { mainP = pp; mainTrack = pickVideo(pp); mainName = pp.name || pp.identity; }
        }
      } else if (state.swapPrimary) {
        mainP = lp; mainTrack = localVid && localVid.track; mainName = 'Вы';
        contain = false;
      } else if (activeId) {
        if (lp.identity === activeId) {
          mainP = lp; mainTrack = localVid && localVid.track; mainName = 'Вы';
        } else {
          const ap = remotes.find(p => p.identity === activeId);
          if (ap) { mainP = ap; mainTrack = pickVideo(ap); mainName = ap.name || ap.identity; }
        }
      } else {
        remotes.forEach(p => {
          const vt = pickVideo(p);
          if (vt) { mainP = p; mainTrack = vt; mainName = p.name || p.identity; }
        });
      }
      stage.appendChild(makeTile(mainP.identity, mainTrack, mainName, mainP.isMicrophoneEnabled === false, {
        speak: !activeId || mainP.identity === activeId || !!screenOwner,
        mutedLocal: mainP.identity === lp.identity,
        gold: !mainTrack,
        contain,
        pin: joinCount > 2
      }));
      /* 1-на-1: второй — прямоугольный PiP прямо на стейдже (клик = swap).
         Группа: остальные — лента снизу, клик по любому = поставить в центр. */
      const others = [{ p: lp, name: 'Вы' }].concat(remotes.map(p => ({ p, name: p.name || p.identity })))
        .filter(x => x.p.identity !== mainP.identity);
      if (joinCount === 2) {
        const only = others[0];
        if (only) {
          stage.appendChild(makeTile(only.p.identity, pickVideo(only.p), only.name, only.p.isMicrophoneEnabled === false, {
            mutedLocal: only.p.identity === lp.identity,
            speak: !!(activeId && only.p.identity === activeId),
            pip: true,
            contain: false
          }));
        }
      } else {
        others.forEach(({ p, name }) => {
          const vt = pickVideo(p);
          const tile = makeTile(p.identity, vt, name, p.isMicrophoneEnabled === false, {
            mutedLocal: p.identity === lp.identity,
            speak: !!(activeId && p.identity === activeId),
            swap: true
          });
          if (strip) strip.appendChild(tile);
        });
      }
    } else {
      const count = 1 + remotes.length;
      stage.className = 'ting-stage auto';
      const localSpeak = !activeId || lp.identity === activeId;
      const hostTile = makeTile(lp.identity, (screenPub && screenPub.track) || (localVid && localVid.track), 'Вы', lp.isMicrophoneEnabled === false, {
        speak: localSpeak, mutedLocal: true, contain: !!(screenPub && screenPub.track),
        gold: !(localVid && localVid.track) && !(screenPub && screenPub.track)
      });
      stage.appendChild(hostTile);
      remotes.forEach(p => {
        const vt = pickVideo(p);
        stage.appendChild(makeTile(p.identity, vt, p.name || p.identity, p.isMicrophoneEnabled === false, {
          speak: !!(activeId && p.identity === activeId),
          contain: hasScreen(p)
        }));
      });
    }
  }

  function stopLiveLoop() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }
  function startLiveLoop(slug) {
    stopLiveLoop();
    let inflight = false;
    liveTimer = setInterval(async () => {
      if (state.view !== 'room' || !slug || inflight) return;
      inflight = true;
      try {
        const prevLen = (state.chat || []).length;
        await refreshPeople(slug);
        await refreshChat(slug);
        if ((state.chat || []).length > prevLen && state.chatOpenMobile === false && window.innerWidth <= 820) {
          state.unreadChat = (state.chat || []).length - prevLen;
        }
        const chatList = qs('#ting-chat-list');
        if (chatList && state.view === 'room') {
          const msgs = (state.chat || []).map(m => {
            const mine = isChatMine(m);
            const name = m.display_name || m.author || 'Участник';
            return `<div class="ting-chat-bubble ${mine ? 'me' : ''}"><b>${esc(name)}</b>${esc(m.text || '')}</div>`;
          }).join('') || `<div class="ting-muted">${esc(COPY.chatEmpty)}</div>`;
          const atBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 40;
          chatList.innerHTML = msgs;
          if (atBottom) chatList.scrollTop = chatList.scrollHeight;
        }
        const countEl = qs('.ting-count-chip');
        if (countEl) {
          const n = Math.max(1, (state.participants || []).length || 1);
          countEl.textContent = n + ' в комнате';
        }
        if (state.peopleOpen) {
          const pe = qs('#ting-people');
          if (pe) {
            const html = peopleDrawerHtml();
            if (html) {
              const wrap = document.createElement('div');
              wrap.innerHTML = html;
              if (wrap.firstElementChild) pe.replaceWith(wrap.firstElementChild);
            }
          }
        }
      } finally {
        inflight = false;
      }
    }, 1000);
  }

  function updateDockMedia() {
    const micBtn = qs('.ting-dock [data-act="mic"]');
    const camBtn = qs('.ting-dock [data-act="cam"]');
    const shareBtn = qs('.ting-dock [data-act="share"]');
    const layoutBtn = qs('.ting-dock [data-act="layout-toggle"]');
    const layoutCap = layoutBtn && layoutBtn.closest('.ting-dock-cap');
    if (micBtn) {
      micBtn.classList.toggle('active', !!state.micOn);
      micBtn.classList.toggle('off', !state.micOn);
      micBtn.innerHTML = svgMic(!state.micOn);
    }
    if (camBtn) {
      camBtn.classList.toggle('active', !!state.camOn);
      camBtn.classList.toggle('off', !state.camOn);
      camBtn.innerHTML = svgCam(!state.camOn);
    }
    if (shareBtn) {
      shareBtn.classList.toggle('on-gold', !!state.sharing);
    }
    if (layoutBtn) {
      layoutBtn.classList.add('on-gold');
      layoutBtn.innerHTML = state.layout === 'speaker'
        ? svgSpeaker()
        : ((window.TingIcons && TingIcons.grid()) || svgSpeaker());
      const layoutLabel = state.layout === 'speaker' ? COPY.speaker : COPY.grid;
      layoutBtn.title = 'Сменить раскладку: ' + layoutLabel;
      if (layoutCap) {
        const span = layoutCap.querySelector('span');
        if (span) span.textContent = layoutLabel;
      }
    }
    paintTiles();
  }

  function stopCrmLobbyPoll() {
    if (crmLobbyPollId) { clearInterval(crmLobbyPollId); crmLobbyPollId = null; }
  }

  function startCrmLobbyPoll(slug, identity, joinToken) {
    stopCrmLobbyPoll();
    let enterBusy = false;
    crmLobbyPollId = setInterval(async () => {
      if (enterBusy || state.view !== 'waiting') return;
      try {
        const r = await fetch(`/api/thing/public/${encodeURIComponent(slug)}/lobby-status?identity=${encodeURIComponent(identity)}&join_token=${encodeURIComponent(joinToken)}`);
        const j = await r.json();
        if (j.lobby_status === 'ended' || j.lobby_status === 'left') {
          stopCrmLobbyPoll();
          state.view = 'ended';
          render();
          return;
        }
        if (j.lobby_status === 'rejected') {
          stopCrmLobbyPoll();
          state.view = 'error';
          state.error = 'Организатор отклонил вход';
          render();
          return;
        }
        if (j.lobby_status === 'admitted' && j.token) {
          enterBusy = true;
          stopCrmLobbyPoll();
          state.joinToken = joinToken;
          state.myIdentity = identity;
          try {
            await connectRoomWithCreds(slug, j);
          } catch (e) {
            enterBusy = false;
            toast(e.message || 'Не удалось войти в комнату', false);
            state.view = 'error';
            state.error = e.message || 'Не удалось войти';
            render();
          }
        }
      } catch (_) { /* retry */ }
    }, 2000);
  }

  async function connectRoom(slug) {
    if (connectBusy) return;
    const now = Date.now();
    if (tokenFailSlug === slug && (now - tokenFailAt) < 2500) {
      toast('Подождите пару секунд и повторите', false);
      return;
    }
    connectBusy = true;
    stopPreview();
    try {
      const typed = qs('#ting-disp') && qs('#ting-disp').value;
      const fromCrm = (window.ASGARD_USER && (ASGARD_USER.full_name || ASGARD_USER.name))
        || (window.AsgardAuth && AsgardAuth.user && (AsgardAuth.user.full_name || AsgardAuth.user.name))
        || (function () {
          try {
            const u = JSON.parse(localStorage.getItem('asgard_user') || '{}');
            return u.full_name || u.name || '';
          } catch (_) { return ''; }
        })();
      const name = String(typed || fromCrm || '').trim();
      const body = {};
      if (name && !/^участник(\s+\d+)?$/i.test(name)) body.display_name = name;
      const tok = await api(`/api/thing/rooms/${encodeURIComponent(slug)}/token`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      tokenFailAt = 0;
      tokenFailSlug = null;
      if (tok.lobby_status === 'waiting') {
        state.myIdentity = tok.identity || null;
        state.joinToken = tok.join_token || null;
        if (tok.room) state.room = unwrapRoom(tok);
        go('waiting', { slug });
        startCrmLobbyPoll(slug, tok.identity, tok.join_token);
        return;
      }
      await connectRoomWithCreds(slug, tok);
    } catch (e) {
      tokenFailAt = Date.now();
      tokenFailSlug = slug;
      const detail = [e.message, e.code].filter(Boolean).join(' · ');
      toast(detail || 'Не удалось подключиться', false);
    } finally {
      connectBusy = false;
    }
  }

  async function connectRoomWithCreds(slug, tok) {
    let room = null;
    let speakerTimer = null;
    try {
      const LK = await loadLk();
      room = new LK.Room({ adaptiveStream: true, dynacast: true });
      state.myIdentity = tok.identity || state.myIdentity || null;
      if (tok.join_token) state.joinToken = tok.join_token;
      const bump = () => { paintTiles(); refreshPeople(slug); };
      room.on(LK.RoomEvent.TrackSubscribed, bump);
      room.on(LK.RoomEvent.TrackUnsubscribed, bump);
      room.on(LK.RoomEvent.TrackMuted, bump);
      room.on(LK.RoomEvent.TrackUnmuted, bump);
      room.on(LK.RoomEvent.ParticipantConnected, bump);
      room.on(LK.RoomEvent.ParticipantDisconnected, bump);
      if (LK.RoomEvent.ActiveSpeakersChanged) {
        room.on(LK.RoomEvent.ActiveSpeakersChanged, (speakers) => {
          if (harnessDemo()) return;
          const next = (speakers && speakers[0] && speakers[0].identity) || null;
          if (speakerTimer) clearTimeout(speakerTimer);
          speakerTimer = setTimeout(() => {
            if (state.activeSpeakerId === next) return;
            state.activeSpeakerId = next;
            if (state.view === 'room') paintTiles();
          }, 200);
        });
      }
      room.on(LK.RoomEvent.DataReceived, (payload) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg && msg.type === 'chat' && msg.text) {
            const row = {
              text: msg.text,
              display_name: msg.display_name || msg.author || 'Участник',
              user_id: msg.user_id,
              identity: msg.identity || null,
              ts: msg.ts || Date.now()
            };
            const before = (state.chat || []).length;
            state.chat = mergeChat(state.chat, [row]);
            if (state.chat.length === before) return;
            if (state.view === 'room') {
              const chatList = qs('#ting-chat-list');
              if (chatList) {
                const mine = isChatMine(row);
                chatList.insertAdjacentHTML('beforeend',
                  `<div class="ting-chat-bubble ${mine ? 'me' : ''}"><b>${esc(row.display_name)}</b>${esc(row.text)}</div>`);
                chatList.scrollTop = chatList.scrollHeight;
              } else render();
            }
          }
        } catch (_) { /* ignore */ }
      });
      room.on(LK.RoomEvent.Disconnected, async () => {
        if (state.lkRoom !== room) return;
        stopLiveLoop();
        if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
        state.lkRoom = null;
        setIncall(false);
        let ended = state.room && (state.room.status === 'ended' || state.room.status === 'cancelled');
        if (!ended && slug) {
          try {
            const r = unwrapRoom(await api(`/api/thing/rooms/${encodeURIComponent(slug)}`));
            state.room = r;
            ended = r.status === 'ended' || r.status === 'cancelled';
          } catch (_) { /* */ }
        }
        if (ended) {
          state.view = 'ended';
          render();
        } else {
          toast('Соединение прервано', false);
          go('hub');
        }
      });

      await room.connect(tok.url || tok.livekit_url, tok.token);
      state.lkRoom = room;
      if (window.TingSession && typeof TingSession.adoptRoom === 'function') {
        try {
          TingSession.adoptRoom(room, {
            slug: slug,
            title: (tok.room && tok.room.title) || slug,
            identity: tok.identity || state.myIdentity,
            role: tok.role || null
          });
        } catch (_) { /* */ }
      }
      try {
        await room.localParticipant.setMicrophoneEnabled(state.micOn);
        await room.localParticipant.setCameraEnabled(state.camOn);
      } catch (e) { console.warn('local media', e); }
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
      startLiveLoop(slug);
      TingSound.play('join');
      go('room', { slug });
    } catch (e) {
      try { if (room) await room.disconnect(); } catch (_) { /* */ }
      if (state.lkRoom === room) state.lkRoom = null;
      throw e;
    }
  }

  let peopleToastAt = 0;
  let chatToastAt = 0;
  async function refreshPeople(slug) {
    try {
      const j = await api(`/api/thing/rooms/${encodeURIComponent(slug)}/participants`);
      const all = j.participants || [];
      state.waiting = all.filter(p => p.lobby_status === 'waiting');
      let parts = all.filter(p => p.lobby_status !== 'waiting' && p.lobby_status !== 'rejected' && !p.left_at);
      const byId = new Set(parts.map(p => p.identity).filter(Boolean));
      (j.live || []).forEach((lp) => {
        if (!lp.identity || byId.has(lp.identity)) return;
        parts = parts.concat([{
          identity: lp.identity,
          display_name: lp.name || lp.identity,
          role: 'member',
          lobby_status: 'admitted',
          live: true
        }]);
        byId.add(lp.identity);
      });
      state.participants = parts;
      if (typeof j.is_host === 'boolean') state.isHost = j.is_host;
      state.peopleError = null;
    } catch (e) {
      state.peopleError = e.message || 'Не удалось обновить участников';
      if (Date.now() - peopleToastAt > 8000) {
        peopleToastAt = Date.now();
        toast(state.peopleError, false);
      }
    }
  }
  async function refreshChat(slug) {
    try {
      const j = await api(`/api/thing/rooms/${encodeURIComponent(slug)}/chat`);
      const incoming = (j.messages || []).map(m => ({
        ...m,
        display_name: m.display_name || m.author,
        text: m.text
      }));
      state.chat = mergeChat([], incoming);
      state.chatError = null;
    } catch (e) {
      state.chatError = e.message || 'Не удалось обновить чат';
      if (Date.now() - chatToastAt > 8000) {
        chatToastAt = Date.now();
        toast(state.chatError, false);
      }
    }
  }

  async function teardownLive(opts) {
    const endAll = !!(opts && opts.endAll);
    const slug = state.room && state.room.slug;
    TingSound.play('end');
    state.activeSpeakerId = null;
    state.swapPrimary = false;
    state.pinnedId = null;
    stopLiveLoop();
    stopCrmLobbyPoll();
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
    if (endAll && slug) {
      try {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/end`, { method: 'POST', body: '{}' });
        if (state.room) state.room.status = 'ended';
      } catch (e) {
        toast(e.message || 'Не удалось завершить Тинг', false);
        return false;
      }
    } else if (slug) {
      try {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/leave`, { method: 'POST', body: '{}' });
      } catch (_) { /* best-effort */ }
    }
    if (state.lkRoom) {
      try { await state.lkRoom.disconnect(); } catch (_) { /* */ }
      state.lkRoom = null;
    }
    if (window.TingSession && typeof TingSession.leave === 'function' && TingSession.isActive()) {
      try { await TingSession.leave(); } catch (_) { /* */ }
    }
    state.sharing = false;
    setIncall(false);
    return true;
  }

  async function leaveRoom(endAll) {
    const ok = await teardownLive({ endAll: !!endAll });
    if (!ok) return;
    if (endAll) {
      const slug = state.room && state.room.slug;
      if (slug) go('ended', { slug });
      else { state.view = 'ended'; render(); }
      return;
    }
    go('hub');
  }

  async function route() {
    const p = parseHash();
    if (!p) return;
    if (state.view === 'room' && p.view !== 'room' && state.lkRoom) {
      const ok = await teardownLive({ endAll: false });
      if (!ok) return;
    }
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
        const tasks = minutes.filter(m => m.item_type === 'action' || m.item_type === 'task').map(m => ({
          title: m.content,
          assignee: m.assignee || m.owner || '—',
          due: m.due || m.deadline || '—',
          status: m.status || (harnessDemo() ? 'open' : 'open')
        }));
        const parts = (raw.participants || []).map(p => p.display_name || p.name || p).filter(Boolean);
        if (!parts.length && harnessDemo()) parts.push('Никита (организатор)', 'Елена', 'Гость');
        const participant_rows = (raw.participants || []).map(p => ({
          name: p.display_name || p.name || String(p),
          role: p.role === 'host' || /организатор/i.test(p.display_name || '') ? 'организатор'
            : (p.role === 'guest' || /гость/i.test(p.display_name || '') ? 'гость' : 'CRM')
        }));
        if (!participant_rows.length && harnessDemo()) {
          participant_rows.push(
            { name: 'Никита', role: 'организатор' },
            { name: 'Елена', role: 'CRM' },
            { name: 'Гость', role: 'гость' }
          );
        }
        if (raw.meeting_id && state.room && !state.room.meeting_id) {
          state.room.meeting_id = raw.meeting_id;
        }
        state.protocol = {
          status: raw.protocol_status || 'queued',
          can_edit: !!raw.can_edit,
          document: {
            title: (state.room && state.room.title) || raw.title || 'Протокол Тинга',
            date: raw.date || new Date().toLocaleDateString('ru-RU'),
            duration: raw.duration || (harnessDemo() ? '24 мин' : ''),
            protocol_no: raw.protocol_no || '',
            agenda: minutes.filter(m => m.item_type === 'agenda').map(m => m.content).join('\n') || '',
            decisions: minutes.filter(m => m.item_type === 'decision' || m.item_type === 'summary').map(m => m.content).join('\n') || '',
            summary: raw.summary || '',
            participants: parts,
            participant_rows,
            open_questions: minutes.filter(m => m.item_type === 'question' || m.item_type === 'open').map(m => m.content).join('\n')
              || (harnessDemo() ? 'Нужен ли выезд на объект до подписания?' : ''),
            tasks
          },
          raw
        };
      }
      if (p.view === 'lobby' && p.slug) {
        state.room = state.room || unwrapRoom(await api(`/api/thing/rooms/${encodeURIComponent(p.slug)}`));
      }
      if (p.view === 'room' && p.slug) {
        await adoptOrConnectRoom(p.slug);
      }
    } catch (e) {
      state.view = 'error';
      state.error = e.message;
    }
    render();
  }

  async function adoptOrConnectRoom(slug) {
    const sess = window.TingSession;
    const meta = sess && typeof sess.getMeta === 'function' ? sess.getMeta() : null;
    const liveRoom = sess && typeof sess.getRoom === 'function' ? sess.getRoom() : null;
    if (sess && sess.isActive() && meta && meta.slug === slug && liveRoom) {
      state.lkRoom = liveRoom;
      state.myIdentity = meta.identity || state.myIdentity;
      const st = sess.getState ? sess.getState() : {};
      if (typeof st.timerSec === 'number') state.timerSec = st.timerSec;
      if (!state.timerId) {
        state.timerId = setInterval(() => {
          const sst = sess.getState ? sess.getState() : null;
          state.timerSec = sst && typeof sst.timerSec === 'number' ? sst.timerSec : (state.timerSec + 1);
          const el = qs('#ting-timer');
          if (el) el.textContent = fmtTime(state.timerSec);
        }, 1000);
      }
      await refreshPeople(slug);
      await refreshChat(slug);
      startLiveLoop(slug);
      setIncall(true);
      return;
    }
    if (!state.lkRoom || (state.room && state.room.slug !== slug)) {
      await connectRoom(slug);
    }
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
    else if (v === 'room') {
      if (harnessDemo()) {
        if (!state.room) state.room = { title: 'Смета ОВКВ', slug: 'demo01', dial_code: '482917' };
        if (!state.participants.length) {
          state.participants = [
            { identity: 'host', display_name: 'Никита', role: 'host' },
            { identity: 'e', display_name: 'Елена', role: 'guest' },
            { identity: 'p', display_name: 'Гость', role: 'guest' }
          ];
          state.isHost = true;
        }
        if (!state.timerSec || state.timerSec < 372) state.timerSec = 372;
        state.recording = true;
      }
      renderRoom();
    }
    else if (v === 'ended') renderEnded();
    else if (v === 'protocol') renderProtocol();
    else if (v === 'dialin') renderDialin();
    else if (v === 'error') renderError();
    else renderHub();
  }

  async function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    const act = btn.dataset.act;
    const slug = btn.dataset.slug || (state.room && state.room.slug);

    try {
      if (act === 'hub') {
        if (state.view === 'waiting') stopCrmLobbyPoll();
        go('hub');
        return;
      }
      if (act === 'waiting-leave') {
        stopCrmLobbyPoll();
        const slug = state.room && state.room.slug;
        const identity = state.myIdentity;
        const joinToken = state.joinToken;
        if (slug && identity && joinToken) {
          try {
            await fetch(`/api/thing/public/${encodeURIComponent(slug)}/leave`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ identity, join_token: joinToken })
            });
          } catch (_) { /* best-effort */ }
        } else if (slug) {
          try {
            await api(`/api/thing/rooms/${encodeURIComponent(slug)}/leave`, { method: 'POST', body: '{}' });
          } catch (_) { /* best-effort */ }
        }
        go('hub');
        return;
      }
      if (act === 'new' || act === 'new-now') { go('new'); return; }
      if (act === 'schedule') { go('schedule'); return; }
      if (act === 'meeting-create') { go('meeting-create'); return; }
      if (act === 'dialin') { go('dialin'); return; }
      if (act === 'join-prompt') {
        const s = prompt('Вставьте код или slug комнаты (из ссылки /ting/…)');
        if (!s) return;
        const clean = String(s).trim().replace(/^.*\/ting\//, '').split(/[/?#]/)[0];
        if (clean) go('lobby', { slug: clean });
        return;
      }
      if (act === 'open-recording') {
        try {
          const j = await api(`/api/thing/rooms/${encodeURIComponent(slug)}/recording`);
          const rec = (j.recordings || [])[0];
          if (rec && rec.file_path) toast('Файл: ' + rec.file_path);
          else if (rec) toast('Статус записи: ' + (rec.status || '—'));
          else toast('Записи ещё нет', false);
        } catch (err) { toast(err.message || 'Нет записи', false); }
        return;
      }
      if (act === 'tab') { state.tab = btn.dataset.tab; go('hub', { tab: state.tab }); return; }
      if (act === 'ready') { go('ready', { slug }); return; }
      if (act === 'join') { go('lobby', { slug }); return; }
      if (act === 'enter-lobby') { go('lobby', { slug }); return; }
      if (act === 'protocol') { go('protocol', { slug }); return; }

      if (act === 'create' || act === 'create-sched') {
        const title = (qs('#ting-title') && qs('#ting-title').value || '').trim() || 'Тинг';
        const lobby = qs('#ting-lobby') ? qs('#ting-lobby').checked : false;
        const body = { title, lobby_enabled: lobby };
        if (act === 'create-sched') {
          const when = readWhenField();
          if (when) {
            body.scheduled_at = new Date(when).toISOString();
            body.mode = 'scheduled';
          }
        }
        const r = await api('/api/thing/rooms', { method: 'POST', body: JSON.stringify(body) });
        state.room = unwrapRoom(r);
        go('ready', { slug: state.room.slug });
        return;
      }
      if (act === 'create-meeting' || act === 'create-meeting-only') {
        const title = (qs('#ting-title') && qs('#ting-title').value || '').trim() || 'Совещание';
        const lobby = qs('#ting-lobby') ? qs('#ting-lobby').checked : false;
        const withRoom = act === 'create-meeting-only'
          ? false
          : (!qs('#ting-with-room') || qs('#ting-with-room').checked);
        const when = readWhenField();
        const startIso = when
          ? new Date(when).toISOString()
          : new Date(Date.now() + 5 * 60000).toISOString();
        try {
          const participant_ids = [];
          const guests = [];
          (state.createInvitees || []).forEach((p) => {
            if (!p || p.kind === 'host') return;
            if (p.user_id) participant_ids.push(p.user_id);
            else if (p.name) guests.push({ name: String(p.name).trim(), email: p.email || undefined });
          });
          const m = await api('/api/meetings', {
            method: 'POST',
            body: JSON.stringify({
              title,
              start_time: startIso,
              duration_minutes: 60,
              participant_ids,
              guests,
              send_invites: true
            })
          });
          const meetingId = (m.meeting && m.meeting.id) || m.id;
          if (!meetingId) throw new Error('Совещание не создано');
          state.createInvitees = null;
          if (!withRoom) {
            toast('Совещание создано');
            go('hub');
            return;
          }
          const tr = await api('/api/thing/rooms', {
            method: 'POST',
            body: JSON.stringify({ title, meeting_id: meetingId, lobby_enabled: lobby, protocol_enabled: true })
          });
          const room = unwrapRoom(tr);
          if (!room || !room.slug) throw new Error('Комната Тинга не создана');
          state.room = room;
          go('meeting', { slug: room.slug });
        } catch (e) {
          toast(e.message || 'Не удалось создать совещание с Тингом', false);
        }
        return;
      }
      if (act === 'copy-link') {
        const t = qs('#ting-link') && qs('#ting-link').textContent;
        await navigator.clipboard.writeText(t || '');
        toast('Ссылка скопирована');
        return;
      }
      if (act === 'share-link') {
        const t = (qs('#ting-link') && qs('#ting-link').textContent) || '';
        if (navigator.share) {
          try { await navigator.share({ title: 'Тинг', text: 'Присоединяйтесь к Тингу', url: t }); return; } catch (_) { /* fallthrough */ }
        }
        await navigator.clipboard.writeText(t);
        toast('Ссылка скопирована');
        return;
      }
      if (act === 'copy-dial') {
        await navigator.clipboard.writeText(String((state.room && state.room.dial_code) || ''));
        toast('Код скопирован');
        return;
      }
      if (act === 'copy-dial-instr') {
        const d = state.dialin || {};
        const code = (state.room && state.room.dial_code) || '';
        const pin = (state.room && state.room.pin_code) || '';
        const text = `Вход в Тинг по телефону:\n1) Наберите ${d.number || d.phone || 'номер'}\n2) Код: ${code}\n3) PIN: ${pin || 'если запросят'}`;
        await navigator.clipboard.writeText(text);
        toast('Инструкция скопирована');
        return;
      }
      if (act === 'tog-mic') {
        state.micOn = !state.micOn;
        if (state.previewStream) state.previewStream.getAudioTracks().forEach(t => { t.enabled = state.micOn; });
        btn.classList.toggle('active', state.micOn);
        btn.classList.toggle('off', !state.micOn);
        btn.innerHTML = svgMic(!state.micOn);
        return;
      }
      if (act === 'tog-cam') {
        state.camOn = !state.camOn;
        const v = qs('#ting-prev-v'), av = qs('#ting-av');
        if (state.previewStream) state.previewStream.getVideoTracks().forEach(t => { t.enabled = state.camOn; });
        if (v) { v.hidden = !state.camOn; v.style.display = state.camOn ? 'block' : 'none'; }
        if (av) av.style.display = state.camOn ? 'none' : 'grid';
        btn.classList.toggle('active', state.camOn);
        btn.classList.toggle('off', !state.camOn);
        btn.innerHTML = svgCam(!state.camOn);
        return;
      }
      if (act === 'connect') { await connectRoom(slug); return; }
      if (act === 'mic' && state.lkRoom) {
        state.micOn = !state.micOn;
        await state.lkRoom.localParticipant.setMicrophoneEnabled(state.micOn);
        TingSound.play('mic');
        updateDockMedia();
        return;
      }
      if (act === 'cam' && state.lkRoom) {
        state.camOn = !state.camOn;
        await state.lkRoom.localParticipant.setCameraEnabled(state.camOn);
        updateDockMedia();
        return;
      }
      if (act === 'share' && state.lkRoom) {
        try {
          const next = !state.lkRoom.localParticipant.isScreenShareEnabled;
          await state.lkRoom.localParticipant.setScreenShareEnabled(next);
          state.sharing = next;
          updateDockMedia();
        } catch (err) {
          toast(err.message || 'Не удалось показать экран', false);
        }
        return;
      }
      if (act === 'layout-toggle') {
        state.layout = state.layout === 'speaker' ? 'grid' : 'speaker';
        state.swapPrimary = false;
        state.pinnedId = null;
        const stage = qs('#ting-stage');
        if (stage) { paintTiles(); updateDockMedia(); }
        else render();
        return;
      }
      if (act === 'toggle-people') {
        state.peopleOpen = !state.peopleOpen;
        if (state.peopleOpen) {
          state.chatOpenMobile = false;
          await refreshPeople(slug);
        }
        render();
        return;
      }
      if (act === 'chat-open-mobile') {
        state.peopleOpen = false;
        state.chatOpenMobile = true;
        state.unreadChat = 0;
        render();
        return;
      }
      if (act === 'chat-close-mobile') {
        if (window.innerWidth <= 820) state.chatOpenMobile = false;
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
      if (act === 'remove') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/participants/${encodeURIComponent(btn.dataset.id)}/remove`, {
          method: 'POST', body: '{}'
        });
        await refreshPeople(slug); render();
        return;
      }
      if (act === 'mute-all') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/mute-all`, { method: 'POST', body: '{}' });
        toast('Микрофоны участников выключены');
        return;
      }
      if (act === 'rec-start') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/recording/start`, { method: 'POST', body: '{}' });
        state.recording = true;
        toast('Запись началась');
        render();
        return;
      }
      if (act === 'rec-stop') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/recording/stop`, { method: 'POST', body: '{}' });
        state.recording = false;
        toast('Запись остановлена');
        render();
        return;
      }
      if (act === 'chat-send') {
        const inp = qs('#ting-chat-in');
        const text = (inp && inp.value || '').trim();
        if (!text) return;
        const displayName = (window.ASGARD_USER && (ASGARD_USER.full_name || ASGARD_USER.name)) || 'Вы';
        const j = await api(`/api/thing/rooms/${encodeURIComponent(slug)}/chat`, {
          method: 'POST',
          body: JSON.stringify({ text, display_name: displayName })
        });
        if (inp) inp.value = '';
        const msg = (j && j.message) || {
          text, display_name: displayName, user_id: window.ASGARD_USER && ASGARD_USER.id,
          identity: state.myIdentity, ts: Date.now()
        };
        const before = (state.chat || []).length;
        state.chat = mergeChat(state.chat, [msg]);
        if (state.lkRoom && state.lkRoom.localParticipant) {
          try {
            const enc = new TextEncoder();
            await state.lkRoom.localParticipant.publishData(
              enc.encode(JSON.stringify({
                type: 'chat', text, display_name: displayName,
                user_id: window.ASGARD_USER && ASGARD_USER.id,
                identity: state.myIdentity, ts: msg.ts || Date.now()
              })),
              { reliable: true }
            );
          } catch (_) { /* */ }
        }
        const chatList = qs('#ting-chat-list');
        if (chatList && state.chat.length > before) {
          chatList.insertAdjacentHTML('beforeend',
            `<div class="ting-chat-bubble me"><b>${esc(displayName)}</b>${esc(text)}</div>`);
          chatList.scrollTop = chatList.scrollHeight;
        } else if (!chatList) render();
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
      if (act === 'invite-guest') {
        const name = prompt('Имя гостя', 'Гость');
        if (!name || !String(name).trim()) return;
        state.createInvitees = state.createInvitees || [];
        state.createInvitees.push({ name: String(name).trim(), kind: 'guest' });
        renderMeetingCreate();
        return;
      }
      if (act === 'invite-remove') {
        const idx = parseInt(btn.dataset.idx, 10);
        if (!Number.isFinite(idx) || !state.createInvitees) return;
        state.createInvitees = state.createInvitees.filter((_, i) => i !== idx);
        renderMeetingCreate();
        return;
      }
      if (act === 'proto-pdf') { window.print(); return; }
      if (act === 'proto-send') {
        const text = [
          (state.protocol && state.protocol.document && state.protocol.document.title) || 'Протокол Тинга',
          location.origin + location.pathname + location.hash
        ].join('\n');
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
          toast('Ссылка на протокол скопирована — отправьте участникам');
        } catch (_) {
          toast('Не удалось скопировать ссылку', false);
        }
        return;
      }
      if (act === 'proto-meeting') {
        const mid = state.room && state.room.meeting_id;
        if (mid) { location.hash = '#/meetings/' + mid; return; }
        if (state.room && state.room.slug) { go('meeting', { slug: state.room.slug }); return; }
        toast('Карточка совещания не привязана', false);
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
      root.onclick = onClick;
      route();
    },
    unmount() {
      stopPreview();
      stopLiveLoop();
      stopCrmLobbyPoll();
      setIncall(false);
      const sess = window.TingSession;
      const keep = sess && typeof sess.isActive === 'function' && sess.isActive();
      if (state.lkRoom) {
        if (keep && sess.getRoom && sess.getRoom() === state.lkRoom) {
          /* session owned by rail/PiP — do not disconnect */
          if (typeof sess.syncChrome === 'function') sess.syncChrome();
        } else if (keep) {
          try { sess.adoptRoom(state.lkRoom, { slug: state.room && state.room.slug, title: state.room && state.room.title, identity: state.myIdentity }); } catch (_) {}
        } else {
          try { state.lkRoom.disconnect(); } catch (_) { /* */ }
        }
        state.lkRoom = null;
      }
      if (state.timerId) clearInterval(state.timerId);
      const m = qs('#ting-host-end'); if (m) m.remove();
      if (root) { root.onclick = null; root.innerHTML = ''; }
      root = null;
    },
    onHash() { route(); }
  };

  window.AsgardTing = {
    async render({ layout }) {
      const auth = window.AsgardAuth && await AsgardAuth.requireUser();
      if (!auth) { location.hash = '#/login'; return; }
      if (!(location.hash || '').startsWith('#/ting')) location.hash = '#/ting';
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
  window.addEventListener('resize', () => {
    if (state.view === 'room' && root) render();
  });
})();
