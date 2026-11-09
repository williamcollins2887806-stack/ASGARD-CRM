/* ASGARD Ting — CRM (#/ting). Telemost-level UI + Ting brand. */
(function () {
  'use strict';

  /* Self-hosted: внешний CDN — SPOF для гостя/ТВ (D24). Версия зафиксирована (D14). */
  const LK_CDN = '/assets/vendor/livekit-client.umd.min.js';

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
    moreOpen: false,
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
    /* Фаза 3: шумодав по умолчанию включён (как у Телемоста). */
    noiseSuppression: true,
    hideRemoteVideo: false,
    unreadChat: 0,
    myIdentity: null,
    myRole: null,
    activeSpeakerId: null,
    swapPrimary: false,
    pinnedId: null,
    joinToken: null,
    connQuality: null,
    reconnecting: false,
    intentionalLeave: false,
    chatOpen: false,
    handRaised: false,
    raisedHands: {},
    reactions: [],
    blurOn: false,
    bgPreset: 'none',
    devices: { mics: [], cams: [] },
    audioDeviceId: '',
    videoDeviceId: '',
    tokenExpiresAt: null,
    tokenRefreshTimer: null,
    consentAsked: false,
    guestJoinToken: null
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

  /** CRM display name — never stub «Участник» when profile exists. */
  function resolveLocalProfile() {
    let u = {};
    try { u = JSON.parse(localStorage.getItem('asgard_user') || '{}') || {}; } catch (_) { u = {}; }
    try {
      if (window.AsgardAuth && typeof AsgardAuth.getAuth === 'function') {
        const a = AsgardAuth.getAuth();
        if (a && a.user) u = Object.assign({}, u, a.user);
      }
    } catch (_) { /* */ }
    if (window.ASGARD_USER && typeof window.ASGARD_USER === 'object') {
      u = Object.assign({}, u, window.ASGARD_USER);
    }
    const name = String(u.full_name || u.name || u.email || '').trim();
    const job = u.job_title || u.position || '';
    return {
      name,
      jobTitle: job,
      label: name ? (job ? (name + ' · ' + job) : name) : '',
      user: u
    };
  }

  function roomTitleDisplay(room) {
    const t = String((room && room.title) || '').trim();
    if (!t || /^вкс$/i.test(t) || /^vcs$/i.test(t)) return 'Тинг';
    return t;
  }
  function friendlyHttpStatus(status) {
    const s = Number(status) || 0;
    if (s === 401 || s === 403) return 'Нет доступа';
    if (s === 404) return 'Не найдено';
    if (s === 409) return 'Конфликт состояния';
    if (s === 429) return 'Слишком много запросов';
    if (s >= 500) return 'Сервер временно недоступен';
    if (s >= 400) return 'Не удалось выполнить запрос';
    return 'Ошибка сети';
  }
  function friendlyErrorMessage(errOrMsg, fallback) {
    const raw = errOrMsg && typeof errOrMsg === 'object'
      ? (errOrMsg.message || '')
      : String(errOrMsg || '');
    const status = errOrMsg && typeof errOrMsg === 'object' ? errOrMsg.status : null;
    if (/Timeout starting video|Timed out|timeout/i.test(raw)) {
      return 'Камера не успела включиться. Закройте другие приложения с камерой и попробуйте снова.';
    }
    if (status && /^HTTP\s+\d+/i.test(raw)) return friendlyHttpStatus(status);
    if (/^HTTP\s+(\d+)/i.test(raw)) {
      const m = raw.match(/^HTTP\s+(\d+)/i);
      return friendlyHttpStatus(m && m[1]);
    }
    const t = String(raw || '').trim();
    if (!t || /^HTTP\b/i.test(t)) return fallback || friendlyHttpStatus(status) || 'Ошибка';
    return t;
  }
  function toast(msg, ok) {
    const text = friendlyErrorMessage(msg, typeof msg === 'string' ? msg : 'Ошибка');
    if (window.AsgardUI && typeof AsgardUI.toast === 'function') {
      /* AsgardUI.toast(title, msg, type). Раньше тип передавали во 2-й аргумент,
         и в подзаголовке тоста печаталось «success» / «error» — отсюда
         «Ссылка скопирована / success». */
      AsgardUI.toast(text, '', ok === false ? 'err' : 'ok');
      return;
    }
    let el = document.getElementById('ting-dom-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ting-dom-toast';
      el.className = 'ting-guest-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
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
      const err = new Error(j.error || j.message || friendlyHttpStatus(r.status));
      err.code = j.code || null;
      err.status = r.status;
      err.body = j;
      throw err;
    }
    return j;
  }
  /** Premium grid class for N=1..12 (explicit matrices, not auto-fit soup). */
  function stageGridClass(n) {
    const c = Math.max(1, Math.min(12, Number(n) || 1));
    if (c === 1) return 'g1';
    if (c === 2) return 'g2';
    if (c === 3) return 'g3';
    if (c === 4) return 'g4';
    if (c <= 6) return 'g6';
    if (c <= 9) return 'g9';
    if (c <= 10) return 'g10';
    return 'g12';
  }
  function demoRoster(n) {
    const pool = [
      ['host', 'Никита · организатор'],
      ['e', 'Елена'],
      ['p', 'Гость'],
      ['a', 'Андрей'],
      ['b', 'Мария'],
      ['c', 'Игорь'],
      ['d', 'Ольга'],
      ['f', 'Сергей'],
      ['g', 'Анна'],
      ['h', 'Дмитрий']
    ];
    const count = Math.max(1, Math.min(10, Number(n) || 2));
    return pool.slice(0, count);
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
    document.documentElement.classList.toggle('ting-incall', !!on);
    document.body.classList.toggle('ting-incall', !!on);
  }
  /** Логотип-плитка: квадрат с собственным фоном (для «Тинг готов», ожидания). */
  function logoTile(size) {
    const s = size || 44;
    return `<div class="ting-logo-tile" style="width:${s}px;height:${s}px;border-radius:${Math.round(s * 0.28)}px" aria-hidden="true">`
      + `<img src="/assets/img/ting-brand/ting-mark-v3-1024.png" alt="" width="${s}" height="${s}" />`
      + `</div>`;
  }

  /**
   * Знак Тинга — марка от Gemini без фона (вырез по золоту с жёстким порогом).
   * Никакой плитки и рамки: на светлой теме PNG с тёмным фоном давал
   * «серый квадрат», а скругление выглядело как посторонняя плашка.
   */
  function logoGlyph(size) {
    const s = size || 28;
    return `<img class="ting-logo-glyph" src="/assets/img/ting-brand/ting-mark-clean-256.png"`
      + ` alt="" width="${s}" height="${s}"`
      + ` style="width:${s}px;height:${s}px" aria-hidden="true" />`;
  }
  function brand(chip) {
    return `<div class="ting-brand-row">
      <div class="ting-logo">${logoGlyph(38)}
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
    const m = {
      open: 'Открыт',
      live: 'Идёт сейчас',
      scheduled: 'Запланирован',
      ended: 'Завершён',
      cancelled: 'Отменён',
      draft: 'Черновик',
      waiting: 'Ожидание'
    };
    return m[st] || 'Завершён';
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
          <div class="ting-avatar tone-${avatarTone(title)}${st === 'live' ? ' gold' : ''}">${esc(initials(title))}</div>
          <div class="ting-call-meta">
            <strong>${esc(title)}</strong>
            <span class="${missed ? 'missed' : ''}">${esc(statusLabel(st))}${metaBits ? ' · ' + esc(metaBits) : ''}</span>
          </div>
          <span class="ting-chip ${st === 'live' ? 'gold' : ''}">${st === 'live' || st === 'ended' || !r.thing_room_id && state.tab === 'ting' ? 'Тинг' : 'CRM'}</span>
          ${slug ? `<button type="button" class="ting-btn ${st === 'live' ? 'ting-btn-primary' : 'ting-btn-ghost'} ting-btn-compact" data-act="join" data-slug="${esc(slug)}">Войти</button>` : `<span class="ting-call-time">${esc(timeHm(when))}</span>`}
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
          <div class="ico">${logoGlyph(28)}</div>
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
        <label class="ting-switch"><input type="checkbox" id="ting-rec" /><span class="ting-switch-ui"></span><span>Запись разговора</span><span class="ting-tip" tabindex="0" data-tip="Запись начнётся автоматически при входе организатора. Файл пишется на сервер.">?</span></label>
        <label class="ting-switch"><input type="checkbox" id="ting-proto" /><span class="ting-switch-ui"></span><span>AI-протокол</span><span class="ting-tip" tabindex="0" data-tip="ИИ соберёт решения и поручения из расшифровки. Требует записи — включит её автоматически.">?</span></label>
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
        <label class="ting-switch"><input type="checkbox" id="ting-rec" /><span class="ting-switch-ui"></span><span>Запись разговора</span><span class="ting-tip" tabindex="0" data-tip="Запись начнётся автоматически при входе организатора.">?</span></label>
        <label class="ting-switch"><input type="checkbox" id="ting-proto" /><span class="ting-switch-ui"></span><span>AI-протокол</span><span class="ting-tip" tabindex="0" data-tip="ИИ соберёт решения и поручения из расшифровки.">?</span></label>
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
        <label class="ting-switch"><input type="checkbox" id="ting-rec" /><span class="ting-switch-ui"></span><span>Запись разговора</span><span class="ting-tip" tabindex="0" data-tip="Запись начнётся автоматически при входе организатора.">?</span></label>
        <label class="ting-switch"><input type="checkbox" id="ting-proto" /><span class="ting-switch-ui"></span><span>AI-протокол</span><span class="ting-tip" tabindex="0" data-tip="ИИ соберёт решения и поручения из расшифровки.">?</span></label>
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
    /* D24: свой QR-эндпоинт вместо api.qrserver.com */
    return '/api/thing/qr?size=168&data=' + encodeURIComponent(link);
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
          ${logoTile(56)}
          <h2>Тинг готов</h2>
          <p class="ting-muted">Отправьте ссылку коллегам и клиентам</p>
          <p class="ting-ready-title">${esc(roomTitleDisplay(r))}</p>
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

  function setPreviewCamVisual(on) {
    const box = qs('#ting-preview');
    const v = qs('#ting-prev-v');
    const av = qs('#ting-av');
    if (box) box.classList.toggle('cam-off', !on);
    if (v) {
      if (on) {
        v.hidden = false;
        v.style.display = 'block';
      } else {
        v.hidden = true;
        v.style.display = 'none';
        v.srcObject = null;
      }
    }
    if (av) {
      /* Класс .cam-off — источник истины; inline-стиль убираем, чтобы он
         не спорил с CSS (это и давало «чёрный прямоугольник» без аватара). */
      av.style.display = '';
      av.hidden = false;
    }
  }

  function renderLobby() {
    setIncall(false);
    const r = state.room || {};
    const profile = resolveLocalProfile();
    const name = profile.name || '';
    const namePh = name ? esc(name) : 'Ваше имя';
    root.innerHTML = `<div class="ting-wrap">
      ${brand('вход')}
      <div class="ting-card ting-center-card ting-lobby-hero">
        <h2 class="ting-h2-tight">${esc(roomTitleDisplay(r))}</h2>
        <div class="ting-preview" id="ting-preview">
          <div class="ting-avatar tone-${avatarTone(name || 'me')} gold" id="ting-av">${esc(initials(name || '?'))}</div>
          <video id="ting-prev-v" playsinline muted autoplay class="ting-preview-video is-mirrored" hidden></video>
          <div class="ting-precall-controls">
            <button type="button" class="ting-dock-btn ${state.micOn ? 'active' : 'off'}" data-act="tog-mic" id="ting-lob-mic" title="${esc(COPY.mic)}" aria-label="${esc(COPY.mic)}">${svgMic(!state.micOn)}</button>
            <button type="button" class="ting-dock-btn ${state.camOn ? 'active' : 'off'}" data-act="tog-cam" id="ting-lob-cam" title="${esc(COPY.cam)}" aria-label="${esc(COPY.cam)}">${svgCam(!state.camOn)}</button>
          </div>
        </div>
        <div class="ting-mic-eq" id="ting-mic-meter" aria-hidden="true" title="Уровень микрофона">
          <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
        </div>
        <p class="ting-muted ting-mic-hint" id="ting-mic-hint">Скажите пару слов — столбики должны прыгать</p>
        <input class="ting-field" id="ting-disp" value="${esc(name)}" placeholder="${namePh}" maxlength="80" autocomplete="name" />
        ${profile.jobTitle ? `<p class="ting-muted ting-lobby-job">${esc(profile.jobTitle)}</p>` : ''}
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
        <div class="ting-wait-pulse" aria-hidden="true">${logoTile(56)}</div>
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
    const chatOpen = !!(state.chatOpen || state.chatOpenMobile);
    const openCls = chatOpen ? ' open' : '';
    return `<aside class="ting-chat${openCls}" id="ting-chat" aria-hidden="${chatOpen ? 'false' : 'true'}">
      <div class="ting-chat-head"><span>${esc(COPY.chat)}</span>
        <button type="button" class="ting-icon-btn ting-icon-sm" data-act="chat-close" title="Скрыть">✕</button>
      </div>
      <div class="ting-chat-list" id="ting-chat-list">${msgs}</div>
      ${state.polls && state.polls.length ? `<div class="ting-polls" id="ting-polls">${pollsHtml()}</div>` : ''}
      <div class="ting-chat-input">
        <div class="ting-chat-compose">
          <input id="ting-chat-in" placeholder="${esc(COPY.chatPh)}" maxlength="2000" autocomplete="off" />
          ${state.isHost ? `<button type="button" class="ting-icon-btn ting-icon-sm" data-act="poll-create" title="Создать опрос" aria-label="Создать опрос">📊</button>` : ''}
          <button type="button" class="ting-chat-send-ico" data-act="chat-send" title="${esc(COPY.send)}" aria-label="${esc(COPY.send)}">${(window.TingIcons && TingIcons.send()) || '→'}</button>
        </div>
      </div>
    </aside>`;
  }

  /** T21: опросы в комнате — как в Телемосте (создать/голосовать/результаты). */
  function pollsHtml() {
    return (state.polls || []).map(p => {
      const opts = (p.options || []).map((o, i) => {
        const n = (p.results && p.results.counts && p.results.counts[i]) || 0;
        const total = (p.results && p.results.total) || 0;
        const pct = total ? Math.round((n / total) * 100) : 0;
        const voted = (p.my_choices || []).includes(i);
        return `<button type="button" class="ting-poll-opt${voted ? ' voted' : ''}" data-act="poll-vote" data-poll="${p.id}" data-opt="${i}">
          <span class="ting-poll-opt-label">${esc(o)}</span>
          <span class="ting-poll-opt-bar" style="width:${pct}%"></span>
          <span class="ting-poll-opt-n">${pct}%</span>
        </button>`;
      }).join('');
      return `<div class="ting-poll${p.status === 'closed' ? ' closed' : ''}">
        <div class="ting-poll-q">${esc(p.question)}${p.status === 'closed' ? ' · закрыт' : ''}</div>
        ${opts}
      </div>`;
    }).join('');
  }

  function peopleDrawerHtml() {
    if (!state.peopleOpen) return '';
    const wait = (state.waiting || []).map(p =>
      `<div class="ting-list-item ting-people-row">
        <div class="ting-people-row-top">
          <span class="ting-people-av">${esc(initials(p.display_name || p.guest_name))}</span>
          <span class="ting-people-meta"><strong>${esc(p.display_name || p.guest_name || 'Гость')}</strong>
          <em class="ting-muted">зал ожидания</em></span>
        </div>
        <span class="ting-list-actions">
          <button type="button" class="ting-btn ting-btn-primary" data-act="admit" data-id="${p.id}">${esc(COPY.admit)}</button>
          <button type="button" class="ting-btn ting-btn-ghost" data-act="reject" data-id="${p.id}">${esc(COPY.reject)}</button>
        </span>
      </div>`
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
      const camOff = lk ? !Array.from((lk.videoTrackPublications || new Map()).values()).some((x) => {
        if (!x || !x.track) return false;
        try {
          const mst = x.track.mediaStreamTrack;
          if (mst && mst.readyState === 'live') return true;
        } catch (_) { /* */ }
        return x.isMuted !== true;
      }) : false;
      const handUp = !!(state.raisedHands && state.raisedHands[p.identity]);
      const actions = (p.role !== 'host' && state.isHost) ? `<span class="ting-list-actions">
          <button type="button" class="ting-icon-btn ting-icon-sm" data-act="mute-mic-one" data-id="${esc(p.identity)}" title="Выключить микрофон" aria-label="Выключить микрофон">${svgMic(false)}</button>
          <button type="button" class="ting-icon-btn ting-icon-sm" data-act="mute-cam-one" data-id="${esc(p.identity)}" title="Выключить камеру" aria-label="Выключить камеру">${svgCam(false)}</button>
          ${handUp ? `<button type="button" class="ting-icon-btn ting-icon-sm" data-act="lower-hand-one" data-id="${esc(p.identity)}" title="Опустить руку" aria-label="Опустить руку">✋↓</button>` : ''}
          ${p.role === 'member' ? `<button type="button" class="ting-icon-btn ting-icon-sm" data-act="make-cohost" data-id="${esc(p.identity)}" data-role="co_host" title="Назначить соорганизатором" aria-label="Назначить соорганизатором">★</button>` : ''}
          <button type="button" class="ting-icon-btn ting-icon-sm" data-act="remove" data-id="${esc(p.identity)}" title="${esc(COPY.remove)}" aria-label="${esc(COPY.remove)}">✕</button>
        </span>` : '';
      return `<div class="ting-list-item ting-people-row${handUp ? ' hand-up' : ''}">
        <div class="ting-people-row-top">
          <span class="ting-people-av">${esc(initials(label))}</span>
          <span class="ting-people-meta">
            <strong>${esc(label)}${handUp ? ' ✋' : ''}</strong>
            ${host ? '<span class="ting-host-chip">хост</span>' : ''}
            ${p.job_title && !String(label).includes(p.job_title) ? `<em class="ting-muted">${esc(p.job_title)}</em>` : ''}
          </span>
          <span class="ting-people-status" title="Мик / камера">
            <span class="${micOff ? 'off' : ''}">${svgMic(!!micOff)}</span>
            <span class="${camOff ? 'off' : ''}">${svgCam(!!camOff)}</span>
          </span>
        </div>
        ${actions}
      </div>`;
    }).join('');
    /* В звонке счётчик = LiveKit без EG_* (бот записи). */
    const count = state.lkRoom
      ? Math.max(1, 1 + Array.from((state.lkRoom.remoteParticipants || new Map()).keys())
        .filter((id) => id && !/^EG_/i.test(String(id))).length)
      : (state.participants || []).length;
    return `<div class="ting-people-drawer" id="ting-people">
      <div class="ting-drawer-head">
        <strong>${esc(COPY.people)} · ${count}</strong>
        <button type="button" class="ting-icon-btn ting-icon-sm" data-act="toggle-people">✕</button>
      </div>
      ${parts || '<div class="ting-muted">Пока никого нет</div>'}
      ${(state.waiting || []).length || state.isHost ? `<h4 class="ting-drawer-sub">Зал ожидания</h4>${wait}` : ''}
      ${state.isHost ? `<button type="button" class="ting-btn ting-btn-ghost ting-full-btn ting-mt-12" data-act="mute-all">${esc(COPY.muteAll)}</button>` : ''}
      ${state.isHost ? `<div class="ting-cta-row ting-mt-12">
        <button type="button" class="ting-btn ting-btn-ghost ting-btn-compact" data-act="lock-toggle">${state.room && state.room.locked ? 'Открыть вход' : 'Закрыть вход'}</button>
        <button type="button" class="ting-btn ting-btn-ghost ting-btn-compact" data-act="rec-start">Запись</button>
        <button type="button" class="ting-btn ting-btn-ghost ting-btn-compact" data-act="rec-stop">Стоп записи</button>
      </div>
      <div class="ting-room-settings">
        <label class="ting-more-label">Зал ожидания</label>
        <select class="ting-field ting-device-select" data-act="lobby-policy">
          <option value="all"${(state.room && state.room.lobby_policy) === 'all' ? ' selected' : ''}>Все, кроме меня</option>
          <option value="guests"${(state.room && state.room.lobby_policy) === 'guests' ? ' selected' : ''}>Только гости</option>
          <option value="uninvited"${(state.room && state.room.lobby_policy) === 'uninvited' ? ' selected' : ''}>Неприглашённые</option>
        </select>
        <label class="ting-more-label">Видео-слотов</label>
        <select class="ting-field ting-device-select" data-act="max-video">
          ${[1, 2, 3, 4, 6, 9, 12].map(n => `<option value="${n}"${Number(state.room && state.room.max_video) === n ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
        <button type="button" class="ting-btn ting-btn-ghost ting-full-btn ting-mt-8" data-act="set-pin">${state.room && state.room.pin_required ? 'Сменить PIN' : 'Задать PIN'}</button>
        <label class="ting-more-label">Режим конференции</label>
        <select class="ting-field ting-device-select" data-act="conference-mode">
          <option value="meeting"${(state.room && state.room.conference_mode) === 'meeting' ? ' selected' : ''}>Совещание (все равны)</option>
          <option value="podium"${(state.room && state.room.conference_mode) === 'podium' ? ' selected' : ''}>Трибуна (N спикеров)</option>
          <option value="webinar"${(state.room && state.room.conference_mode) === 'webinar' ? ' selected' : ''}>Вебинар (зрители)</option>
        </select>
        <label class="ting-more-label">Раскладка у всех</label>
        <select class="ting-field ting-device-select" data-act="forced-layout">
          <option value=""${!(state.room && state.room.forced_layout) ? ' selected' : ''}>Свободная</option>
          <option value="speaker"${(state.room && state.room.forced_layout) === 'speaker' ? ' selected' : ''}>Спикер</option>
          <option value="grid"${(state.room && state.room.forced_layout) === 'grid' ? ' selected' : ''}>Сетка</option>
        </select>
        <a class="ting-btn ting-btn-ghost ting-full-btn ting-mt-8" href="/api/thing/rooms/${encodeURIComponent((state.room && state.room.slug) || '')}/analytics?format=csv" target="_blank" rel="noopener">Аналитика CSV</a>
      </div>` : ''}
    </div>`;
  }

  function dockHtml() {
    const endIco = (window.TingIcons && TingIcons.endCall()) || '';
    /* Chrome = текущий режим (не «переключить на»): speaker→иконка спикера+Спикер, grid→сетка+Сетка */
    const layoutIco = state.layout === 'speaker'
      ? svgSpeaker()
      : ((window.TingIcons && TingIcons.grid()) || svgSpeaker());
    const layoutLabel = state.layout === 'speaker' ? COPY.speaker : COPY.grid;
    const peopleIco = (window.TingIcons && TingIcons.people && TingIcons.people()) || svgPeople();
    const moreIco = svgMore();
    return `<div class="ting-dock"><div class="ting-dock-inner">
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn on-gold" data-act="layout-toggle" title="Сменить раскладку: ${esc(layoutLabel)}">${layoutIco}</button><span>${esc(layoutLabel)}</span></div>
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn ${state.micOn ? 'active' : 'off'}" data-act="mic" title="${esc(COPY.mic)}">${svgMic(!state.micOn)}</button><span>Мик</span></div>
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn ${state.camOn ? 'active' : 'off'}" data-act="cam" title="${esc(COPY.cam)}">${svgCam(!state.camOn)}</button><span>Камера</span></div>
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn ${state.sharing ? 'on-gold' : ''}" data-act="share" title="${esc(COPY.screen)}">${svgScreen()}</button><span>Экран</span></div>
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn ${state.peopleOpen ? 'active' : ''}" data-act="toggle-people" title="${esc(COPY.people)}">${peopleIco}</button><span>Люди</span></div>
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn ${state.moreOpen ? 'active' : ''}" data-act="toggle-more" title="Ещё">${moreIco}</button><span>Ещё</span></div>
      <div class="ting-dock-sep" aria-hidden="true"></div>
      ${state.isHost ? `<div class="ting-dock-cap"><button type="button" class="ting-dock-btn" data-act="host-end-open" title="${esc(COPY.end)}">${endIco}</button><span>${esc(COPY.end)}</span></div>` : ''}
      <div class="ting-dock-cap"><button type="button" class="ting-dock-btn danger" data-act="leave" title="${esc(COPY.leave)}">${svgHang()}</button><span>Выйти</span></div>
    </div></div>`;
  }

  const TING_BG_PRESETS = [
    { id: 'none', label: 'Без фона', url: '' },
    { id: 'blur', label: 'Размытие', url: '__blur__' },
    { id: 'office-dusk', label: 'Офис', url: '/assets/img/ting-bg/office-dusk.svg' },
    { id: 'soft-sky', label: 'Небо', url: '/assets/img/ting-bg/soft-sky.svg' },
    { id: 'warm-studio', label: 'Студия', url: '/assets/img/ting-bg/warm-studio.svg' }
  ];

  function moreSheetHtml() {
    if (!state.moreOpen) return '';
    const handOn = !!state.handRaised;
    const bg = state.bgPreset || 'none';
    const mics = (state.devices && state.devices.mics) || [];
    const cams = (state.devices && state.devices.cams) || [];
    const micOpts = mics.map((d) =>
      `<option value="${esc(d.deviceId)}"${state.audioDeviceId === d.deviceId ? ' selected' : ''}>${esc(d.label || 'Микрофон')}</option>`
    ).join('');
    const camOpts = cams.map((d) =>
      `<option value="${esc(d.deviceId)}"${state.videoDeviceId === d.deviceId ? ' selected' : ''}>${esc(d.label || 'Камера')}</option>`
    ).join('');
    const bgBtns = TING_BG_PRESETS.map((p) =>
      `<button type="button" class="ting-more-item${bg === p.id ? ' on' : ''}" data-act="bg-preset" data-bg="${esc(p.id)}">${esc(p.label)}</button>`
    ).join('');
    return `<div class="ting-more-sheet" id="ting-more-sheet" role="dialog" aria-label="Ещё">
      <div class="ting-more-head"><strong>Ещё</strong><button type="button" class="ting-icon-btn" data-act="toggle-more" aria-label="Закрыть">×</button></div>
      <div class="ting-more-section">
        <label class="ting-more-label">Микрофон</label>
        <select class="ting-field ting-device-select" data-act="device-audio">${micOpts || '<option value=\"\">По умолчанию</option>'}</select>
        <label class="ting-more-label">Камера</label>
        <select class="ting-field ting-device-select" data-act="device-video">${camOpts || '<option value=\"\">По умолчанию</option>'}</select>
      </div>
      <div class="ting-more-grid">
        <button type="button" class="ting-more-item${state.noiseSuppression ? ' on' : ''}" data-act="noise-toggle">${state.noiseSuppression ? '✓ ' : ''}Шумоподавление</button>
        <button type="button" class="ting-more-item${state.hideRemoteVideo ? ' on' : ''}" data-act="hide-remote-toggle">${state.hideRemoteVideo ? '✓ ' : ''}Скрыть видео других</button>
        <button type="button" class="ting-more-item${handOn ? ' on' : ''}" data-act="hand-toggle">${handOn ? 'Опустить руку' : 'Поднять руку'}</button>
        <button type="button" class="ting-more-item" data-act="react" data-emoji="👍">👍</button>
        <button type="button" class="ting-more-item" data-act="react" data-emoji="👏">👏</button>
        <button type="button" class="ting-more-item" data-act="react" data-emoji="❤️">❤️</button>
        <button type="button" class="ting-more-item" data-act="react" data-emoji="🔥">🔥</button>
      </div>
      <div class="ting-more-label">Фон</div>
      <div class="ting-more-grid ting-bg-grid">${bgBtns}</div>
    </div>`;
  }

  function qualityChipHtml() {
    const q = state.connQuality;
    if (!q) return '';
    const map = { excellent: 'Отлично', good: 'Хорошо', poor: 'Слабо', lost: 'Потеря', unknown: '' };
    const label = map[String(q).toLowerCase()] || '';
    if (!label) return '';
    return `<span class="ting-quality-chip q-${esc(String(q).toLowerCase())}" id="ting-quality">${esc(label)}</span>`;
  }

  function renderRoom() {
    setIncall(true);
    const r = state.room || {};
    /* C14: принудительная раскладка от хоста перекрывает личный выбор. */
    if (r.forced_layout && state.layout !== r.forced_layout) {
      state.layout = r.forced_layout;
    }
    /* Счётчик: LiveKit без EG_* (бот записи). */
    const n = state.lkRoom
      ? Math.max(1, 1 + Array.from((state.lkRoom.remoteParticipants || new Map()).keys())
        .filter((id) => id && !/^EG_/i.test(String(id))).length)
      : Math.max(1, (state.participants || []).length || 1);
    const peopleOpen = !!state.peopleOpen;
    const chatOpen = !!(state.chatOpen || state.chatOpenMobile);
    root.innerHTML = `<div class="ting-room-shell no-chat cinema${peopleOpen ? ' has-people-col' : ''}${chatOpen ? ' has-chat-open' : ''}">
      <div class="ting-room-main${peopleOpen ? ' has-people' : ''}">
        <div class="ting-room-top">
          ${state.recording ? `<div class="ting-consent" role="status">● ${esc(COPY.recording)}</div>` : ''}
          ${state.reconnecting ? `<div class="ting-consent ting-reconnect" role="status">Переподключение…</div>` : ''}
          <div class="ting-room-top-row">
            <div class="ting-room-title">
              ${logoGlyph(26)}
              <div class="ting-room-title-text">
                <strong>${esc(roomTitleDisplay(r))}</strong>
                <span class="ting-muted" id="ting-timer">${fmtTime(state.timerSec)}</span>
              </div>
            </div>
            <div class="ting-top-actions">
              ${qualityChipHtml()}
              <span class="ting-count-chip">${n} в комнате</span>
              <button type="button" class="ting-icon-btn${peopleOpen ? ' active' : ''}" data-act="toggle-people" title="${esc(COPY.people)}" aria-pressed="${peopleOpen}">${svgPeople()}</button>
              <button type="button" class="ting-icon-btn${chatOpen ? ' active' : ''}" data-act="toggle-chat" title="${esc(COPY.chat)}" aria-pressed="${chatOpen}">
                ${svgChat()}
                ${state.unreadChat ? `<span class="badge">${state.unreadChat > 9 ? '9+' : state.unreadChat}</span>` : ''}
              </button>
            </div>
          </div>
        </div>
        <div class="ting-stage-wrap">
          <div class="ting-stage ${state.layout === 'speaker' ? 'speaker' : stageGridClass(Math.max(2, (state.participants || []).length || 2))}" id="ting-stage"></div>
          <div class="ting-filmstrip" id="ting-filmstrip"></div>
          <div class="ting-react-layer" id="ting-react-layer" aria-hidden="true"></div>
          ${peopleDrawerHtml()}
          ${moreSheetHtml()}
        </div>
        ${dockHtml()}
      </div>
      ${chatHtml()}
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
    const noRecording = statusKey === 'no_recording';
    const emptyHint = noRecording
      ? (raw.protocol_error || 'Запись не велась — протоколировать нечего')
      : (preparing ? 'Протокол готовится' : 'Протокол пуст');
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
    const ready = Boolean(phone);
    root.innerHTML = `<div class="ting-wrap">
      ${brand('телефон')}
      <div class="ting-card ting-center-card">
        <h2 class="ting-h2-tight">${esc(COPY.phoneGuide)}</h2>
        <div class="ting-dialin-hero">
          <div class="ting-muted ting-label-sm">Номер Тинга</div>
          <div class="ting-dialin-number">${esc(phone || 'не подключён')}</div>
          ${!ready ? `<p class="ting-muted ting-mt-8">Телефонный вход пока не включён на сервере (нет DID). Код комнаты ниже всё равно можно продиктовать, когда номер появится.</p>` : ''}
          ${code ? `<div class="ting-muted ting-label-sm ting-mt-12">Код комнаты</div><div class="ting-dial ting-dial-lg">${esc(code)}</div>` : ''}
          ${pin ? `<div class="ting-muted ting-label-sm">PIN (опц.)</div><div class="ting-dial">${esc(pin)}</div>` : ''}
        </div>
        <div class="ting-step-cards">
          <div class="ting-step-card"><span class="n">1</span><div><strong>Позвоните</strong><p>${esc(phone || 'сначала настройте DID')}</p></div></div>
          <div class="ting-step-card"><span class="n">2</span><div><strong>Код комнаты</strong><p>${code ? esc(code) : '6 цифр с карточки'}</p></div></div>
          <div class="ting-step-card"><span class="n">3</span><div><strong>PIN</strong><p>${pin ? esc(pin) : 'если включён на карточке'}</p></div></div>
          <div class="ting-step-card"><span class="n">4</span><div><strong>В эфире</strong><p>Дождитесь соединения</p></div></div>
        </div>
        <div class="ting-cta-row ting-cta-center">
          ${ready ? '<button type="button" class="ting-btn ting-btn-primary" data-act="copy-dial-instr">Скопировать инструкцию</button>' : ''}
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
      let stream = null;
      /* Windows PWA: если лобби держит video-трек, после stop() драйвер часто
         не отдаёт камеру LiveKit → timeout «Камера не успела включиться».
         На десктопе в лобби берём только микрофон; камеру откроет connect. */
      const desktopNoPrevCam = typeof window !== 'undefined' && window.innerWidth > 820
        && /Windows|Win32/i.test(navigator.userAgent || '');
      try {
        if (desktopNoPrevCam) {
          stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        } else {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
      } catch (_) {
        /* Камера занята/запрещена — всё равно берём микрофон для эквалайзера */
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      }
      if (gen !== state.previewGen || state.view !== 'lobby') {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      state.previewStream = stream;
      state.micOn = true;
      const hasPrevVideo = stream.getVideoTracks().length > 0;
      /* Desktop Windows: video в лобби намеренно не берём — camOn не сбрасываем в false. */
      if (hasPrevVideo) state.camOn = true;
      else if (!desktopNoPrevCam) state.camOn = false;
      if (hasPrevVideo) {
        const v = qs('#ting-prev-v');
        if (v) v.srcObject = stream;
      }
      setPreviewCamVisual(hasPrevVideo);
      const micB = qs('#ting-lob-mic');
      const camB = qs('#ting-lob-cam');
      if (micB) { micB.classList.toggle('active', state.micOn); micB.classList.toggle('off', !state.micOn); micB.innerHTML = svgMic(!state.micOn); }
      if (camB) { camB.classList.toggle('active', state.camOn); camB.classList.toggle('off', !state.camOn); camB.innerHTML = svgCam(!state.camOn); }
      startMicMeter(stream);
    } catch (_) { /* preview optional — show avatar */ }
  }

  /**
   * Фаза 3 (T25): pre-call эквалайзер микрофона.
   * Баги: AudioContext часто suspended → нули; полоска была под аватаром.
   */
  function startMicMeter(stream) {
    stopMicMeter();
    const eq = qs('#ting-mic-meter');
    const hint = qs('#ting-mic-hint');
    if (!eq || !stream) return;
    const audio = stream.getAudioTracks && stream.getAudioTracks()[0];
    if (!audio || audio.readyState === 'ended') {
      eq.hidden = true;
      if (hint) hint.textContent = 'Микрофон недоступен';
      return;
    }
    eq.hidden = false;
    let ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { eq.hidden = true; return; }
      ctx = new AC();
      /* Chrome/Edge: без resume() analyser отдаёт тишину */
      const kick = () => {
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => { /* */ });
        }
      };
      kick();
      document.addEventListener('pointerdown', kick, { once: true });
      document.addEventListener('keydown', kick, { once: true });

      const src = ctx.createMediaStreamSource(new MediaStream([audio]));
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.55;
      src.connect(an);
      const timeBuf = new Uint8Array(an.fftSize);
      const freqBuf = new Uint8Array(an.frequencyBinCount);
      const bars = Array.from(eq.querySelectorAll('i'));
      let peak = 0;
      let alive = true;
      const tick = () => {
        if (!alive) return;
        kick();
        an.getByteTimeDomainData(timeBuf);
        let sum = 0;
        for (let i = 0; i < timeBuf.length; i++) {
          const v = (timeBuf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / timeBuf.length);
        const level = Math.min(100, Math.round(rms * 220));
        peak = Math.max(peak, level);

        an.getByteFrequencyData(freqBuf);
        const n = bars.length || 7;
        const step = Math.max(1, Math.floor(freqBuf.length / (n + 2)));
        for (let b = 0; b < n; b++) {
          let band = 0;
          const from = (b + 1) * step;
          const to = Math.min(freqBuf.length, from + step);
          for (let i = from; i < to; i++) band += freqBuf[i];
          const avg = (to > from ? band / (to - from) : 0) / 255;
          const h = Math.max(12, Math.round((avg * 0.65 + rms * 0.9) * 100));
          if (bars[b]) bars[b].style.height = Math.min(100, h) + '%';
        }
        if (hint) {
          hint.textContent = !state.micOn
            ? 'Микрофон выключен — включите, чтобы проверить'
            : (peak > 8 ? 'Микрофон слышно' : 'Скажите пару слов — столбики должны прыгать');
        }
        state.micMeterRaf = requestAnimationFrame(tick);
      };
      state.micMeterCtx = ctx;
      state._micMeterAlive = () => { alive = false; };
      state.micMeterRaf = requestAnimationFrame(tick);
    } catch (_) {
      if (eq) eq.hidden = true;
      if (ctx) { try { ctx.close(); } catch (__) { /* */ } }
    }
  }

  function stopMicMeter() {
    if (typeof state._micMeterAlive === 'function') {
      try { state._micMeterAlive(); } catch (_) { /* */ }
      state._micMeterAlive = null;
    }
    if (state.micMeterRaf) cancelAnimationFrame(state.micMeterRaf);
    state.micMeterRaf = null;
    if (state.micMeterCtx) {
      try { state.micMeterCtx.close(); } catch (_) { /* */ }
      state.micMeterCtx = null;
    }
    const eq = qs('#ting-mic-meter');
    if (eq) {
      eq.querySelectorAll('i').forEach((el) => { el.style.height = '12%'; });
    }
  }
  function stopPreview() {
    state.previewGen = (state.previewGen || 0) + 1;
    stopMicMeter();
    if (state.previewStream) {
      state.previewStream.getTracks().forEach(t => t.stop());
      state.previewStream = null;
    }
  }
  async function unpublishLocalCamera(room) {
    if (!room || !room.localParticipant) return;
    try {
      const pubs = Array.from(room.localParticipant.videoTrackPublications.values());
      for (const pub of pubs) {
        if (/screen/i.test(String(pub.source || ''))) continue;
        try {
          if (pub.track) await room.localParticipant.unpublishTrack(pub.track, true);
        } catch (_) { /* */ }
        try { if (pub.track && typeof pub.track.stop === 'function') pub.track.stop(); } catch (_) { /* */ }
      }
    } catch (_) { /* */ }
  }

  /** Точная причина отказа камеры по DOMException.name — не «timeout». */
  function cameraErrorMessage(err) {
    const name = String((err && err.name) || '');
    const raw = String((err && err.message) || err || '');
    if (name === 'NotAllowedError' || /Permission|denied/i.test(raw)) {
      return 'Браузер не даёт камеру. Разрешите её в настройках сайта (замок в адресной строке → Камера → Разрешить).';
    }
    if (name === 'NotFoundError' || /Requested device not found|DevicesNotFound/i.test(raw)) {
      return 'Камера не найдена. Проверьте, что она подключена и не отключена в диспетчере устройств.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError' || /NotReadable|Device in use|Could not start/i.test(raw)) {
      return 'Камера занята другим приложением. Закройте Zoom, Teams, связь Windows и попробуйте снова.';
    }
    /* AbortError драйвера: камера есть и разрешена, но кадры не идут.
       Chromium после такого отказа держит media-сервис в плохом состоянии —
       помогает только полный перезапуск приложения, не F5. */
    if (name === 'AbortError') {
      return 'Камера не отдаёт кадры. Полностью закройте приложение CRM (все окна) и откройте снова — затем включите камеру.';
    }
    if (name === 'OverconstrainedError') {
      return 'Камера не поддерживает выбранное разрешение. Пробуем ещё раз в базовом режиме.';
    }
    if (/Timeout starting video|Timed out|timeout/i.test(raw)) {
      if (isStandalonePwa()) {
        return 'Камера не ответила за 30 секунд. Откройте окно браузера — там может висеть запрос разрешения на камеру — и нажмите «Камера» снова.';
      }
      return 'Камера не успела включиться. Закройте другие приложения с камерой и попробуйте снова.';
    }
    return 'Камера не включилась' + (raw ? ': ' + raw : '.');
  }

  /** Идёт ли приложение как установленная PWA (там диалог разрешения часто за окном). */
  function isStandalonePwa() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
      if (navigator.standalone === true) return true;
    } catch (_) { /* */ }
    return false;
  }

  /**
   * Диагностика камеры. НЕ бросает и НЕ блокирует: в PWA на Windows
   * permissions.query часто врёт (возвращает 'denied'/'prompt' при рабочей
   * камере), поэтому единственный достоверный источник — сам getUserMedia.
   * Здесь только логируем состояние и заранее подсказываем про окно.
   */
  async function logCameraEnvironment() {
    const info = { standalone: isStandalonePwa(), secure: false, permission: null, devices: 0, deviceLabels: 0 };
    try { info.secure = window.isSecureContext === true; } catch (_) { /* */ }
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const st = await withTimeout(navigator.permissions.query({ name: 'camera' }), 1500, 'perm');
        info.permission = st && st.state;
      }
    } catch (_) { info.permission = 'query-unsupported'; }
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const list = await navigator.mediaDevices.enumerateDevices();
        const cams = list.filter((d) => d.kind === 'videoinput');
        info.devices = cams.length;
        info.deviceLabels = cams.filter((d) => d.label).length;
      }
    } catch (_) { /* */ }
    console.info('[Ting] cam env', info);
    if (info.permission === 'prompt' && info.standalone) {
      toast('Разрешите камеру: откройте окно браузера, оно может быть позади этого', false);
    }
    if (info.devices === 0) {
      const e = new Error('Камера не найдена');
      e.name = 'NotFoundError';
      throw e;
    }
    return info;
  }

  /**
   * Чёрный список камер, которые не годятся для звонка.
   * На ноутбуках Windows по умолчанию часто выбирается ИК-камера Windows Hello
   * (face unlock): Chromium пытается её открыть и падает с AbortError
   * «Timeout starting video source». Поэтому ИК и виртуальные камеры
   * отсекаем, а реальную выбираем явно по deviceId.
   */
  const CAMERA_DENY_RE = /infrared|\bir\b|windows hello|hello face|face unlock|depth|tof|virtual|obs virtual|snap camera|manycam|droidcam|xsplit/i;
  const CAMERA_PREFER_RE = /usb video|uvc|webcam|hd camera|fhd|logitech|razer|avermedia|elgato|integrated|built-in|front/i;

  /** Камеры в порядке приоритета: сначала обычные, ИК/виртуальные — в конце. */
  async function rankCameras() {
    const out = [];
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return out;
      const list = await navigator.mediaDevices.enumerateDevices();
      const cams = list.filter((d) => d.kind === 'videoinput');
      const scored = cams.map((d, i) => {
        const label = String(d.label || '');
        let score = 0;
        if (CAMERA_DENY_RE.test(label)) score -= 100;
        if (CAMERA_PREFER_RE.test(label)) score += 10;
        if (state.videoDeviceId && d.deviceId === state.videoDeviceId) score += 5;
        score -= i * 0.1;
        return { deviceId: d.deviceId, label, score };
      });
      scored.sort((a, b) => b.score - a.score);
      scored.forEach((c) => out.push(c));
      /* Полный список — по нему видно, ИК это, виртуальная или реальная. */
      console.info('[Ting] cameras', cams.map((d, i) => ({
        i, label: d.label || '(no label)', id: String(d.deviceId || '').slice(0, 12)
      })));
    } catch (e) {
      console.warn('[Ting] enumerateDevices failed', e && e.message);
    }
    return out;
  }

  /** Прогрессивный список constraints: от самого мягкого к строгому.
   *  Порядок важен: жёсткий `deviceId: exact` + 720p заставляет Chromium
   *  ждать кадры от конкретного драйвера и падать AbortError
   *  «Timeout starting video source». Начинаем с `video: true` — браузер
   *  сам выбирает рабочую конфигурацию, и только потом уточняем. */
  async function cameraConstraintsList() {
    const cams = await rankCameras();
    const usable = cams.filter((c) => c.score > -50);
    const list = [];
    /* 1. Самый мягкий запрос — никаких ограничений. */
    list.push(true);
    /* 2. Только fps: часть драйверов Windows не стартует без явного frameRate. */
    list.push({ frameRate: { ideal: 30 } });
    /* 3. Низкое разрешение — драйвер может не тянуть 720p на старте. */
    list.push({ width: { ideal: 640 }, height: { ideal: 480 } });
    /* 4. HD. */
    list.push({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } });
    /* 5. Только теперь — привязка к устройству (если их несколько). */
    usable.forEach((c) => {
      if (!c.deviceId) return;
      list.push({ deviceId: { exact: c.deviceId } });
    });
    return list;
  }

  /**
   * Открыть камеру с перебором устройств. Единая точка для лобби и звонка,
   * чтобы «одна кнопка работает, другая нет» больше не повторялось.
   */
  async function openCameraStream(opts) {
    const wantAudio = !!(opts && opts.audio);
    const list = await cameraConstraintsList();
    let lastErr = null;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      try {
        console.info('[Ting] getUserMedia try', i, JSON.stringify(c));
        const stream = await withTimeout(
          navigator.mediaDevices.getUserMedia({ video: c, audio: wantAudio }),
          30000,
          'Timeout starting video source'
        );
        const vt = stream.getVideoTracks()[0];
        console.info('[Ting] getUserMedia OK', i, vt ? vt.label : '(no track)');
        return stream;
      } catch (e) {
        lastErr = e;
        console.warn('[Ting] getUserMedia try', i, e && e.name, e && e.message);
        const name = String((e && e.name) || '');
        /* Разрешение/устройство повтором не лечатся — дальше нет смысла. */
        if (name === 'NotAllowedError' || name === 'NotFoundError' || name === 'SecurityError') break;
        /* Между попытками даём драйверу Windows освободиться. */
        await new Promise((r) => setTimeout(r, 350 + i * 250));
      }
    }
    throw (lastErr || new Error('Камера не включилась'));
  }

  /**
   * Проверка, что камера реально даёт кадры.
   * AbortError у Chromium означает «устройство открылось, но видео не пошло».
   * Ловим это отдельно, чтобы не публиковать мёртвый трек и не врать «вкл».
   */
  async function assertCameraFrames(stream, ms) {
    const vt = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    if (!vt) {
      const e = new Error('Камера не отдала видеопоток');
      e.name = 'NotFoundError';
      throw e;
    }
    /* readyState=ended — драйвер отвалился сразу после open. */
    if (vt.readyState === 'ended') {
      const e = new Error('Камера отключилась сразу после запуска');
      e.name = 'AbortError';
      throw e;
    }
    const settings = (() => { try { return vt.getSettings ? vt.getSettings() : {}; } catch (_) { return {}; } })();
    console.info('[Ting] camera track', {
      label: vt.label, readyState: vt.readyState, muted: vt.muted, settings
    });
    /* muted=true у свежего трека при живом драйвере — норма первые ~1с.
       Если остаётся muted дольше, кадров нет: ждём и проверяем. */
    const limit = typeof ms === 'number' ? ms : 2500;
    const start = Date.now();
    while (Date.now() - start < limit) {
      if (!vt.muted && vt.readyState === 'live') return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (vt.muted || vt.readyState !== 'live') {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* */ }
      const e = new Error('Камера открылась, но кадры не идут');
      e.name = 'AbortError';
      throw e;
    }
    return true;
  }

  /**
   * Сериализация переключений камеры.
   * Гонка «waiting for pending publication promise timed out»: пользователь
   * быстро жмёт камеру (или connect + клик), два потока одновременно зовут
   * publishTrack / setCameraEnabled. LiveKit держит pendingPublishing по
   * source и второй вызов отваливается по таймауту, оставляя трек
   * неопубликованным — «камера вкл», картинки нет.
   */
  let cameraOpChain = Promise.resolve();
  function runCameraOp(fn) {
    const next = cameraOpChain.then(fn, fn);
    cameraOpChain = next.catch(() => {});
    return next;
  }

  /**
   * Камера: getUserMedia ПЕРВЫМ, публикация готового трека.
   * Корень отказа в PWA на Windows: getUserMedia висит, пока не нажмут
   * в диалоге разрешения, а диалог уходит за окно приложения.
   */
  async function enableLocalCamera(room) {
    return runCameraOp(() => enableLocalCameraInner(room));
  }

  async function enableLocalCameraInner(room) {
    const LK = window.LivekitClient;
    console.info('[Ting] enableLocalCamera: start');
    /* Отпускаем только video из preview, mic preview не трогаем — mic уже в LiveKit. */
    if (state.previewStream) {
      state.previewStream.getVideoTracks().forEach((t) => { try { t.stop(); } catch (_) { /* */ } });
    }
    stopPreview();
    await unpublishLocalCamera(room);
    /* Windows отдаёт камеру не мгновенно после stop() превью — ждём. */
    await new Promise((r) => setTimeout(r, 900));

    await logCameraEnvironment();

    const stream = await openCameraStream({ audio: false });
    await assertCameraFrames(stream, 2500);

    const mst = stream.getVideoTracks()[0];
    if (!mst) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* */ }
      throw new Error('Камера не отдала видеопоток');
    }
    try { mst.enabled = true; } catch (_) { /* */ }

    try {
      let track = null;
      if (LK && typeof LK.LocalVideoTrack === 'function') {
        track = new LK.LocalVideoTrack(mst, undefined, true);
      } else if (LK && typeof LK.createLocalVideoTrack === 'function') {
        try { mst.stop(); } catch (_) { /* */ }
        track = await withTimeout(
          LK.createLocalVideoTrack(state.videoDeviceId ? { deviceId: state.videoDeviceId } : {}),
          12000,
          'Timeout starting video source'
        );
      }
      if (!track) throw new Error('Видеоклиент не умеет публиковать камеру');
      const pubOpts = {};
      try {
        if (LK.Track && LK.Track.Source) pubOpts.source = LK.Track.Source.Camera;
      } catch (_) { /* */ }
      /* D-176: БЕЗ явных simulcast-слоёв публикуется один поток, и
         setVideoQuality(HIGH) у зрителя выбирать не из чего — отсюда «пиксели»
         на ноуте при хорошем канале. Слои задаём всегда (кроме screen share). */
      try {
        if (LK.VideoPresets) {
          const layers = [];
          if (LK.VideoPresets.h180) layers.push(LK.VideoPresets.h180);
          if (LK.VideoPresets.h360) layers.push(LK.VideoPresets.h360);
          if (layers.length) {
            pubOpts.videoSimulcastLayers = layers;
            pubOpts.simulcast = true;
          }
        }
      } catch (_) { /* */ }
      await withTimeout(
        room.localParticipant.publishTrack(track, pubOpts),
        15000,
        'Timeout starting video source'
      );
      return true;
    } catch (e) {
      try { if (mst && mst.stop) mst.stop(); } catch (_) { /* */ }
      console.warn('[Ting] publish camera failed', e && e.name, e && e.message);
      await unpublishLocalCamera(room);
      throw e;
    }
  }

  /** Обновить правую панель «Люди» без пересборки стейджа (иначе видео «прыгает»). */
  function syncPeopleDrawer(opts) {
    const quiet = !!(opts && opts.quiet);
    const main = qs('.ting-room-main');
    const shell = qs('.ting-room-shell');
    const wrap = qs('.ting-stage-wrap');
    if (!main || !wrap) {
      if (state.view === 'room') render();
      return;
    }
    main.classList.toggle('has-people', !!state.peopleOpen);
    if (shell) shell.classList.toggle('has-people-col', !!state.peopleOpen);
    const existing = qs('#ting-people');
    if (!state.peopleOpen) {
      if (existing) existing.remove();
    } else {
      const html = peopleDrawerHtml();
      if (html) {
        const box = document.createElement('div');
        box.innerHTML = html;
        const next = box.firstElementChild;
        if (next) {
          if (quiet || existing) next.style.animation = 'none';
          if (existing) existing.replaceWith(next);
          else wrap.appendChild(next);
        }
      }
    }
    document.querySelectorAll('[data-act="toggle-people"]').forEach((el) => {
      el.classList.toggle('active', !!state.peopleOpen);
      el.setAttribute('aria-pressed', state.peopleOpen ? 'true' : 'false');
    });
  }

  function ensureAudioSink() {
    let sink = document.getElementById('ting-audio-sink');
    if (!sink) {
      sink = document.createElement('div');
      sink.id = 'ting-audio-sink';
      sink.setAttribute('aria-hidden', 'true');
      sink.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;left:-9999px;top:0';
      document.body.appendChild(sink);
    }
    return sink;
  }

  /** Без attach удалённого audio участники не слышат друг друга (баг CRM-комнаты). */
  function syncRemoteAudio(room) {
    if (!room) return;
    const sink = ensureAudioSink();
    const want = new Set();
    try {
      room.remoteParticipants.forEach((p) => {
        Array.from(p.audioTrackPublications.values()).forEach((pub) => {
          if (!pub || !pub.track) return;
          try { if (pub.isMuted || pub.track.isMuted) return; } catch (_) { /* */ }
          const sid = String(pub.trackSid || (pub.track && pub.track.sid) || '');
          if (!sid) return;
          want.add(sid);
          let el = sink.querySelector('[data-track-sid="' + sid + '"]');
          if (!el) {
            try {
              el = pub.track.attach();
            } catch (_) {
              el = document.createElement('audio');
              try {
                el.srcObject = new MediaStream([pub.track.mediaStreamTrack]);
              } catch (__) { return; }
            }
            el.autoplay = true;
            el.setAttribute('data-track-sid', sid);
            el.setAttribute('playsinline', '');
            sink.appendChild(el);
            try { el.play && el.play().catch(() => {}); } catch (_) { /* */ }
          }
        });
      });
    } catch (_) { /* */ }
    Array.from(sink.querySelectorAll('[data-track-sid]')).forEach((el) => {
      if (!want.has(el.getAttribute('data-track-sid'))) {
        try { el.srcObject = null; } catch (_) { /* */ }
        try { el.remove(); } catch (_) { /* */ }
      }
    });
  }

  function clearRemoteAudio() {
    const sink = document.getElementById('ting-audio-sink');
    if (!sink) return;
    Array.from(sink.querySelectorAll('audio')).forEach((el) => {
      try { el.srcObject = null; } catch (_) { /* */ }
      try { el.remove(); } catch (_) { /* */ }
    });
  }
  function parkCallToPip() {
    const sess = window.TingSession;
    if (state.lkRoom && sess && typeof sess.adoptRoom === 'function') {
      try {
        sess.adoptRoom(state.lkRoom, {
          slug: state.room && state.room.slug,
          title: roomTitleDisplay(state.room) || (state.room && state.room.slug),
          identity: state.myIdentity,
          role: state.isHost ? 'host' : null
        });
      } catch (_) { /* */ }
    }
    /* D-181: звук собеседников ДОЛЖЕН продолжать играть в мини-окне.
       Раньше при уходе в CRM audio оставался привязанным только к плиткам
       комнаты: стоило им размонтироваться — и в PiP было тихо, хотя
       «в Телемосте слышно». Переподключаем дорожки в постоянный sink
       (он живёт на body и переживает перерисовку страниц CRM). */
    if (state.lkRoom) {
      try { syncRemoteAudio(state.lkRoom); } catch (_) { /* */ }
    }
    stopPreview();
    stopLiveLoop();
    stopCrmLobbyPoll();
    setIncall(false);
    document.body.classList.remove('ting-incall');
    document.documentElement.classList.remove('ting-incall');
    state.lkRoom = null;
    if (root) {
      try { root.onclick = null; root.onchange = null; root.innerHTML = ''; } catch (_) { /* */ }
      root = null;
    }
    if (sess && typeof sess.syncChrome === 'function') sess.syncChrome();
    if (sess && typeof sess.isActive === 'function' && sess.isActive()) {
      try {
        if (window.HuginnTing && typeof HuginnTing.ensurePip === 'function') HuginnTing.ensurePip();
        if (window.HuginnDock && typeof HuginnDock.open === 'function') HuginnDock.open('ting');
      } catch (_) { /* */ }
      toast('Тинг свёрнут в мини-окно — можно работать в CRM', true);
    }
  }
  function withTimeout(promise, ms, label) {
    let t = null;
    return Promise.race([
      promise,
      new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error(label || 'timeout')), ms);
      })
    ]).finally(() => { if (t) clearTimeout(t); });
  }

  function detachStageVideos() {
    /* Только видео: полный track.detach() срывает audio из #ting-audio-sink. */
    const room = state.lkRoom;
    if (room) {
      const detachVideoPub = (pub) => {
        if (!pub || !pub.track || typeof pub.track.detach !== 'function') return;
        try {
          if (pub.track.kind && pub.track.kind !== 'video') return;
        } catch (_) { /* */ }
        try {
          const els = typeof pub.track.detach === 'function' ? pub.track.detach() : [];
          /* detach() без аргументов отцепляет всё — переattach audio ниже через syncRemoteAudio */
          void els;
        } catch (_) { /* */ }
      };
      try {
        room.localParticipant.videoTrackPublications.forEach(detachVideoPub);
        room.remoteParticipants.forEach((p) => p.videoTrackPublications.forEach(detachVideoPub));
      } catch (_) { /* */ }
    }
    [qs('#ting-stage'), qs('#ting-filmstrip')].forEach((el) => {
      if (!el) return;
      el.querySelectorAll('video').forEach((v) => {
        try { v.srcObject = null; } catch (_) { /* */ }
      });
    });
  }

  async function publishTingData(payload) {
    const room = state.lkRoom;
    if (!room || !room.localParticipant || typeof room.localParticipant.publishData !== 'function') return;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(Object.assign({ ts: Date.now() }, payload)));
      await room.localParticipant.publishData(bytes, { reliable: true });
    } catch (e) {
      console.warn('[Ting] publishData', e);
    }
  }

  function showReactionBurst(emoji, who) {
    const layer = qs('#ting-react-layer');
    if (!layer) return;
    const el = document.createElement('div');
    el.className = 'ting-react-burst';
    el.textContent = emoji;
    el.title = who || '';
    el.style.left = (20 + Math.random() * 60) + '%';
    layer.appendChild(el);
    setTimeout(() => { try { el.remove(); } catch (_) { /* */ } }, 2200);
  }

  async function loadTrackProcessors() {
    if (window.LivekitTrackProcessors) return window.LivekitTrackProcessors;
    if (window.TrackProcessors) return window.TrackProcessors;
    /* D24: только локальный ассет. Внешний CDN — SPOF: за корп. фаерволом
       размытие фона молча не работает, а ошибка не видна. */
    try {
      const mod = await import('/assets/vendor/livekit-track-processors.esm.js');
      window.LivekitTrackProcessors = mod;
      return mod;
    } catch (_) {
      return null;
    }
  }

  function localCamPublication() {
    const room = state.lkRoom;
    if (!room || !room.localParticipant) return null;
    const pubs = Array.from(room.localParticipant.videoTrackPublications.values());
    return pubs.find((p) => p.track && !/screen/i.test(String(p.source || ''))) || null;
  }

  async function refreshDeviceList() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      const list = await navigator.mediaDevices.enumerateDevices();
      state.devices = {
        mics: list.filter((d) => d.kind === 'audioinput'),
        cams: list.filter((d) => d.kind === 'videoinput')
      };
    } catch (_) {
      state.devices = { mics: [], cams: [] };
    }
  }

  async function switchTingDevice(kind, deviceId) {
    const room = state.lkRoom;
    if (!room || !deviceId) return;
    try {
      if (typeof room.switchActiveDevice === 'function') {
        await room.switchActiveDevice(kind, deviceId);
      }
      if (kind === 'audioinput') state.audioDeviceId = deviceId;
      if (kind === 'videoinput') state.videoDeviceId = deviceId;
      toast('Устройство переключено');
    } catch (e) {
      toast((e && e.message) || 'Не удалось сменить устройство', false);
    }
  }

  async function applyBackgroundPreset(presetId) {
    const room = state.lkRoom;
    if (!room || !room.localParticipant) {
      toast('Сначала войдите в комнату', false);
      return;
    }
    const preset = TING_BG_PRESETS.find((p) => p.id === presetId) || TING_BG_PRESETS[0];
    const cam = localCamPublication();
    if (!cam || !cam.track) {
      toast('Включите камеру', false);
      return;
    }
    try {
      if (typeof cam.track.stopProcessor === 'function') {
        try { await cam.track.stopProcessor(); } catch (_) { /* */ }
      }
      state.blurOn = false;
      state.bgPreset = preset.id;
      if (!preset.url) {
        toast('Фон выключен');
        return;
      }
      const processors = await loadTrackProcessors();
      if (!processors || typeof cam.track.setProcessor !== 'function') {
        toast('Эффекты фона недоступны в этом браузере', false);
        state.bgPreset = 'none';
        return;
      }
      let proc = null;
      if (preset.url === '__blur__') {
        if (typeof processors.BackgroundBlur !== 'function') {
          toast('Размытие недоступно', false);
          state.bgPreset = 'none';
          return;
        }
        proc = processors.BackgroundBlur(16);
        state.blurOn = true;
      } else if (typeof processors.VirtualBackground === 'function') {
        proc = processors.VirtualBackground(preset.url);
      } else {
        toast('Виртуальный фон недоступен', false);
        state.bgPreset = 'none';
        return;
      }
      await cam.track.setProcessor(proc);
      toast(preset.label);
    } catch (e) {
      state.bgPreset = 'none';
      state.blurOn = false;
      toast((e && e.message) || 'Не удалось сменить фон', false);
    }
  }

  async function toggleBackgroundBlur() {
    await applyBackgroundPreset(state.blurOn || state.bgPreset === 'blur' ? 'none' : 'blur');
  }

  function paintTiles() {
    const stage = qs('#ting-stage');
    const strip = qs('#ting-filmstrip');
    if (!stage) return;
    detachStageVideos();
    stage.innerHTML = '';
    if (strip) strip.innerHTML = '';
    /* Звук держим отдельно от видео-плиток — иначе detachStageVideos глушит собеседника. */
    if (state.lkRoom) syncRemoteAudio(state.lkRoom);
    /* Фаза 3: «скрыть видео других» должно переживать перерисовку и новые треки. */
    if (state.hideRemoteVideo) applyHideRemoteVideo();

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
        v.controls = false;
        v.disablePictureInPicture = true;
        try { v.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback'); } catch (_) { /* */ }
        v.muted = !!(opts && opts.mutedLocal);
        if (opts && opts.contain) v.classList.add('is-contain');
        /* Своё видео зеркалим, как в Телемосте/Zoom: человек видит себя как
           в зеркале («я поднял левую руку — вижу слева»). Драйвер камеры при
           этом может отдавать кадры как есть — нормализуем на своей плитке.
           Только камера: screen share и чужие потоки не отражаются. */
        if (opts && opts.mutedLocal && !(opts && opts.contain)) {
          v.classList.add('is-mirrored');
        }
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
        /* speaker default 2 (1:1+PiP); grid default 3; __TING_DEMO_N__ / demo=group override */
        let demoN = 2;
        if (typeof window !== 'undefined' && window.__TING_DEMO_N__) demoN = Number(window.__TING_DEMO_N__);
        else if (typeof window !== 'undefined' && window.__TING_DEMO_EXTRA__) demoN = 3;
        else if (state.layout !== 'speaker') demoN = 3;
        const roster = demoRoster(demoN);
        const people = Object.fromEntries(roster);
        const ids = roster.map((x) => x[0]);
        if (state.layout === 'speaker') {
          stage.className = 'ting-stage speaker';
          if (ids.length <= 2) {
            const mainId = state.swapPrimary ? ids[0] : (ids[1] || ids[0]);
            const pipId = mainId === ids[0] ? (ids[1] || ids[0]) : ids[0];
            stage.appendChild(makeTile(mainId, null, people[mainId], false, { speak: true, gold: true, cinematic: true }));
            if (pipId && pipId !== mainId) {
              stage.appendChild(makeTile(pipId, null, people[pipId], false, { pip: true, cinematic: true }));
            }
          } else {
            const mainId = (state.pinnedId && people[state.pinnedId]) ? state.pinnedId : ids[1] || ids[0];
            stage.appendChild(makeTile(mainId, null, people[mainId], false, {
              speak: true, gold: true, cinematic: true, pin: !!state.pinnedId
            }));
            if (strip) {
              ids.filter((id) => id !== mainId).forEach((id) => {
                strip.appendChild(makeTile(id, null, people[id], id === 'p', { cinematic: true, swap: true }));
              });
            }
          }
        } else {
          stage.className = 'ting-stage ' + stageGridClass(ids.length);
          ids.forEach((id, i) => {
            stage.appendChild(makeTile(id, null, people[id], id === 'p', {
              speak: i === 0, gold: true, cinematic: true
            }));
          });
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
    const Core = window.TingRoomCore || null;
    const trackLive = Core && Core.trackIsLive
      ? Core.trackIsLive
      : (pub) => {
        if (!pub || !pub.track) return null;
        try {
          if (pub.isMuted === true || pub.track.isMuted === true) return null;
        } catch (_) { /* */ }
        return pub.track;
      };
    const pickVideo = Core && Core.pickVideoTrack
      ? Core.pickVideoTrack
      : (p) => {
        const pubs = Array.from(p.videoTrackPublications.values());
        const screen = pubs.find(x => trackLive(x) && /screen/i.test(String(x.source || '')));
        if (screen) return trackLive(screen);
        const cam = pubs.find(x => trackLive(x));
        return cam ? trackLive(cam) : null;
      };
    const localVid = Array.from(lp.videoTrackPublications.values()).find(p => {
      if (!trackLive(p)) return false;
      try {
        if (window.LivekitClient && LivekitClient.Track && p.source === LivekitClient.Track.Source.ScreenShare) return false;
      } catch (_) { /* */ }
      return !/screen/i.test(String(p.source || ''));
    });
    const screenPub = Array.from(lp.videoTrackPublications.values()).find(p => {
      try { return p.source === LivekitClient.Track.Source.ScreenShare && trackLive(p); } catch (_) { return /screen/i.test(String(p.source || '')) && trackLive(p); }
    });
    const remotes = Array.from(room.remoteParticipants.values());

    const activeId = state.activeSpeakerId;
    const isScreenPub = (pub) => {
      try { return /screen/i.test(String((pub && pub.source) || '')); } catch (_) { return false; }
    };
    const hasScreen = (p) => {
      try {
        return Array.from(p.videoTrackPublications.values()).some(x => trackLive(x) && isScreenPub(x));
      } catch (_) { return false; }
    };
    const localCamTrack = localVid ? trackLive(localVid) : null;
    const localScreenTrack = screenPub ? trackLive(screenPub) : null;

    if (speakerMode) {
      stage.className = 'ting-stage speaker';
      const joinCount = 1 + remotes.length;   // видимых участников (включая себя)
      let mainP = lp;
      let mainTrack = localScreenTrack || localCamTrack;
      let mainName = 'Вы';
      let contain = !!localScreenTrack;
      /* Приоритет центра: своя презентация → свап (себя в центр) → активный спикер → первый с видео */
      let screenOwner = null;
      if (localScreenTrack) screenOwner = lp;
      remotes.forEach(p => {
        const sp = Array.from(p.videoTrackPublications.values()).find(x => trackLive(x) && /screen/i.test(String(x.source || '')));
        if (sp) screenOwner = p;
      });
      if (screenOwner) {
        mainP = screenOwner;
        mainTrack = pickVideo(screenOwner);
        mainName = screenOwner.identity === lp.identity ? 'Вы' : (screenOwner.name || screenOwner.identity);
        contain = true;
      } else if (state.pinnedId) {
        /* Ручной пин (клик по тайлу участника) — приоритетнее активного спикера */
        if (lp.identity === state.pinnedId) {
          mainP = lp; mainTrack = localCamTrack; mainName = 'Вы';
        } else {
          const pp = remotes.find(p => p.identity === state.pinnedId);
          if (pp) { mainP = pp; mainTrack = pickVideo(pp); mainName = pp.name || pp.identity; }
        }
      } else if (state.swapPrimary) {
        mainP = lp; mainTrack = localCamTrack; mainName = 'Вы';
        contain = false;
      } else if (activeId) {
        if (lp.identity === activeId) {
          mainP = lp; mainTrack = localCamTrack; mainName = 'Вы';
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
      /* D2: 11-й и далее участники раньше молчаливо исчезали (slice(0,9)).
         Теперь: 12 плиток на стейдже + плитка «+N» с остальными (клик — в режим спикера). */
      const GRID_MAX = 12;
      const visible = remotes.slice(0, GRID_MAX - 1);
      const hidden = remotes.length - visible.length;
      const count = 1 + visible.length + (hidden > 0 ? 1 : 0);
      stage.className = 'ting-stage ' + stageGridClass(count);
      const localSpeak = !activeId || lp.identity === activeId;
      const hostTile = makeTile(lp.identity, localScreenTrack || localCamTrack, 'Вы', lp.isMicrophoneEnabled === false, {
        speak: localSpeak, mutedLocal: true, contain: !!localScreenTrack,
        gold: !localCamTrack && !localScreenTrack
      });
      stage.appendChild(hostTile);
      visible.forEach(p => {
        const vt = pickVideo(p);
        stage.appendChild(makeTile(p.identity, vt, p.name || p.identity, p.isMicrophoneEnabled === false, {
          speak: !!(activeId && p.identity === activeId),
          contain: hasScreen(p)
        }));
      });
      if (hidden > 0) stage.appendChild(makeOverflowTile(hidden));
    }
    /* D-180: качество поднимаем ОДИН раз на публикацию, а не после каждой
       перерисовки. Раньше paintTiles() вызывал bumpRemoteVideoQuality()
       каждый раз, и при каждом «кто говорит» заново запрашивался HIGH-слой —
       лишний трафик, задержка видео и рассинхрон со звуком. */
  }

  /**
   * Подсветка «кто говорит» БЕЗ перерисовки сцены.
   * Меняет только класс .speak у уже существующих плиток и аватаров.
   * Полная пересборка ради подсветки — корень «прыгающих окон» (D-180).
   */
  function applySpeakerHighlight(activeIdentity) {
    const stage = qs('#ting-stage');
    const strip = qs('#ting-filmstrip');
    if (!stage && !strip) return;
    const apply = (root) => {
      if (!root) return;
      root.querySelectorAll('.ting-tile').forEach((el) => {
        const id = el.dataset.id || '';
        const on = !!activeIdentity && id === activeIdentity;
        if (el.classList.contains('speak') !== on) el.classList.toggle('speak', on);
        /* Аватар внутри плитки без видео тоже подсвечиваем */
        const av = el.querySelector('.ting-avatar');
        if (av) {
          if (on && !av.classList.contains('speaking')) av.classList.add('speaking');
          else if (!on && av.classList.contains('speaking')) av.classList.remove('speaking');
        }
      });
    };
    apply(stage);
    apply(strip);
  }

  /** Плитка «+N»: остальные участники не теряются, а видны счётчиком. */
  function makeOverflowTile(hidden) {
    const div = document.createElement('button');
    div.type = 'button';
    div.className = 'ting-tile ting-tile--more';
    div.title = 'Показать ещё ' + hidden + ' участников';
    div.innerHTML = `<span class="ting-tile-more-n">+${hidden}</span><span class="ting-tile-more-cap">ещё</span>`;
    div.addEventListener('click', () => {
      state.layout = 'speaker';
      try { localStorage.setItem('ting_layout', 'speaker'); } catch (_) { /* */ }
      paintTiles();
    });
    return div;
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
        await refreshPolls(slug);
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
          const n = state.lkRoom
            ? Math.max(1, 1 + Array.from(state.lkRoom.remoteParticipants.keys())
              .filter((id) => id && !/^EG_/i.test(String(id))).length)
            : Math.max(1, (state.participants || []).length || 1);
          countEl.textContent = n + ' в комнате';
        }
        if (state.peopleOpen) syncPeopleDrawer({ quiet: true });
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
        /* D5: join_token в теле, не в query (не течёт в логи/Referer/историю). */
        const r = await fetch(`/api/thing/public/${encodeURIComponent(slug)}/lobby-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Ting-Identity': identity,
            'X-Ting-Join-Token': joinToken
          },
          body: JSON.stringify({ identity, join_token: joinToken })
        });
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

  /**
   * D-176: метка устройства для identity.
   * Ноут и телефон под одним аккаунтом раньше получали одинаковую identity
   * `user_<id>` → LiveKit выкидывал первое подключение, и человек видел
   * два своих тайла / терял звук. Метка постоянна на устройство.
   */
  function deviceTag() {
    const KEY = 'ting_device_tag';
    try {
      let t = localStorage.getItem(KEY);
      if (t && /^[a-z0-9]{3,24}$/.test(t)) return t;
    } catch (_) { /* */ }
    const ua = String(navigator.userAgent || '');
    let base = 'web';
    if (/Android TV|TV;/i.test(ua)) base = 'tv';
    else if (/Android|iPhone|iPad|Mobile/i.test(ua)) base = 'mob';
    else if (/Windows/i.test(ua)) base = 'win';
    else if (/Mac OS X/i.test(ua)) base = 'mac';
    else if (/Linux/i.test(ua)) base = 'lin';
    let rnd = '';
    try {
      const a = new Uint8Array(3);
      (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : null;
      rnd = Array.from(a).map((x) => x.toString(16).padStart(2, '0')).join('');
    } catch (_) { rnd = ''; }
    if (!rnd) rnd = Math.random().toString(16).slice(2, 8);
    const tag = (base + rnd).slice(0, 24);
    try { localStorage.setItem(KEY, tag); } catch (_) { /* */ }
    return tag;
  }

  /** Тело запроса токена: имя + метка устройства (сервер соберёт identity). */
  function tokenBody(name) {
    const body = {};
    if (name && !/^участник(\s+\d+)?$/i.test(name)) body.display_name = name;
    body.device = deviceTag();
    return body;
  }

  async function connectRoom(slug) {
    if (connectBusy) return;
    const now = Date.now();
    if (tokenFailSlug === slug && (now - tokenFailAt) < 2500) {
      toast('Подождите пару секунд и повторите', false);
      return;
    }
    connectBusy = true;
    state.intentionalLeave = false;
    state.joinInFlight = true;
    /* Сразу UI комнаты — токен и LiveKit идут уже «внутри» */
    state.view = 'room';
    setIncall(true);
    render();
    /* Keep preview alive until LiveKit publishes — avoids Windows cam lock race (laptop). */
    try {
      const typed = qs('#ting-disp') && qs('#ting-disp').value;
      const fromCrm = resolveLocalProfile().name;
      const name = String(typed || fromCrm || '').trim();
      const body = tokenBody(name);
      const tok = await withTimeout(
        api(`/api/thing/rooms/${encodeURIComponent(slug)}/token`, {
          method: 'POST',
          body: JSON.stringify(body)
        }),
        10000,
        'Таймаут получения доступа к комнате'
      );
      tokenFailAt = 0;
      tokenFailSlug = null;
      /* D8: раньше /start не вызывался из фронта, поэтому комната могла остаться
         'scheduled' — от статуса зависят live-бейджи и протокол. Хост «будит» комнату. */
      if ((tok.role === 'host' || state.isHost) && tok.room && tok.room.status === 'scheduled') {
        try {
          await api(`/api/thing/rooms/${encodeURIComponent(slug)}/start`, { method: 'POST', body: '{}' });
        } catch (_) { /* не блокируем вход из-за уведомлений */ }
      }
      if (tok.lobby_status === 'waiting') {
        state.joinInFlight = false;
        stopPreview();
        setIncall(false);
        state.myIdentity = tok.identity || null;
        state.joinToken = tok.join_token || null;
        if (tok.room) state.room = unwrapRoom(tok);
        go('waiting', { slug });
        startCrmLobbyPoll(slug, tok.identity, tok.join_token);
        return;
      }
      await connectRoomWithCreds(slug, tok);
    } catch (e) {
      state.joinInFlight = false;
      stopPreview();
      setIncall(false);
      tokenFailAt = Date.now();
      tokenFailSlug = slug;
      toast(friendlyErrorMessage(e, 'Не удалось подключиться'), false);
      if (state.view === 'room' && !state.lkRoom) {
        state.view = 'lobby';
        render();
      }
    } finally {
      connectBusy = false;
    }
  }

  /**
   * На ноуте adaptiveStream часто залипает на low-слое (тайл 0×0 при paint → пиксели),
   * хотя канал быстрый и на ТВ картинка отличная. Десктоп — без adaptive, явный HIGH.
   */
  function livekitRoomOptions() {
    const LK = window.LivekitClient;
    const narrow = typeof window !== 'undefined' && window.innerWidth <= 820;
    const opts = { dynacast: true };
    if (narrow) {
      opts.adaptiveStream = { pixelDensity: 2 };
    } else {
      opts.adaptiveStream = false;
    }
    /* D-180: звук. Причины «дёргается сцена» и «задержка видео» были и в
       аудиотракте: без voiceIsolation и с авто-гейном каждый шорох
       пробивался как активный спикер. */
    try {
      opts.audioCaptureDefaults = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: true
      };
    } catch (_) { /* старые сборки LiveKit */ }
    try {
      if (LK && LK.VideoPresets) {
        const layers = [];
        if (LK.VideoPresets.h180) layers.push(LK.VideoPresets.h180);
        if (LK.VideoPresets.h360) layers.push(LK.VideoPresets.h360);
        opts.publishDefaults = {
          videoSimulcastLayers: layers,
          videoEncoding: (LK.VideoPresets.h720 && LK.VideoPresets.h720.encoding) || undefined
        };
      }
    } catch (_) { /* */ }
    return opts;
  }

  /**
   * Поднять качество видео у ЗРИТЕЛЯ для одной публикации.
   * Вызывается ровно один раз при подписке (TrackSubscribed), а не после
   * каждой перерисовки: повторные setVideoQuality(HIGH) гоняют лишний
   * трафик и добавляют задержку видео.
   */
  function bumpPublicationQuality(pub) {
    const LK = window.LivekitClient;
    if (!pub || !LK || !LK.VideoQuality) return;
    try {
      if (pub.kind && pub.kind !== 'video') return;
      if (typeof pub.setVideoQuality === 'function') {
        pub.setVideoQuality(LK.VideoQuality.HIGH);
      }
    } catch (_) { /* */ }
  }

  async function connectRoomWithCreds(slug, tok) {
    let room = null;
    let speakerTimer = null;
    try {
      const LK = await loadLk();
      room = new LK.Room(livekitRoomOptions());
      state.myIdentity = tok.identity || state.myIdentity || null;
      /* Роль из токена — единственный надёжный признак хоста ДО refreshPeople. */
      state.myRole = tok.role || state.myRole || null;
      if (tok.room) state.room = unwrapRoom(tok);
      if (tok.join_token) state.joinToken = tok.join_token;
      const bump = () => { syncRemoteAudio(room); paintTiles(); refreshPeople(slug); };
      room.on(LK.RoomEvent.TrackSubscribed, (track, pub) => {
        if (track && track.kind === 'audio') syncRemoteAudio(room);
        /* Качество поднимаем один раз на публикацию — не в каждом paintTiles. */
        bumpPublicationQuality(pub);
        bump();
      });
      room.on(LK.RoomEvent.TrackUnsubscribed, bump);
      room.on(LK.RoomEvent.TrackMuted, bump);
      room.on(LK.RoomEvent.TrackUnmuted, bump);
      room.on(LK.RoomEvent.ParticipantConnected, bump);
      room.on(LK.RoomEvent.ParticipantDisconnected, bump);
      // Своя камера/микрофон публикуются ПОСЛЕ connect — без этих событий
      // собственная плитка не перерисовывалась и «себя не видно».
      if (LK.RoomEvent.LocalTrackPublished) room.on(LK.RoomEvent.LocalTrackPublished, bump);
      if (LK.RoomEvent.LocalTrackUnpublished) room.on(LK.RoomEvent.LocalTrackUnpublished, bump);
      if (LK.RoomEvent.LocalTrackPublished) {
        try { room.localParticipant.on(LK.RoomEvent.LocalTrackPublished, bump); } catch (_) { /* */ }
      }
      if (LK.RoomEvent.ActiveSpeakersChanged) {
        room.on(LK.RoomEvent.ActiveSpeakersChanged, (speakers) => {
          if (harnessDemo()) return;
          /* D-180: раньше здесь вызывался paintTiles() — полная пересборка
             сцены. Микрофон ловит шорохи, событие приходит несколько раз в
             секунду, и ВСЁ видео пересоздавалось: картинка «прыгала» между
             говорящими, а треки переподключались (задержка видео + рассинхрон
             со звуком). Теперь меняем только класс .speak у существующих
             плиток. Переключение центрального спикера — отдельно и с
             «гистерезисом», чтобы не дёргалось при равной громкости. */
          const next = (speakers && speakers[0] && speakers[0].identity) || null;
          applySpeakerHighlight(next);

          if (state.layout !== 'speaker') return;
          if (state.pinnedId || state.swapPrimary) return;
          if (state.view !== 'room') return;
          if (next === state.activeSpeakerId) return;

          /* Владелец центра меняется только если держится дольше settle или
             силуэт явно сменился (не «двое на равных»). */
          const settleMs = state.activeSpeakerId ? 1400 : 600;
          if (speakerTimer) clearTimeout(speakerTimer);
          speakerTimer = setTimeout(() => {
            if (state.view !== 'room') return;
            if (state.pinnedId || state.swapPrimary) return;
            if (state.activeSpeakerId === next) return;
            state.activeSpeakerId = next;
            paintTiles();
          }, settleMs);
        });
      }
      room.on(LK.RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (!msg || !msg.type) return;
          if (msg.type === 'chat' && msg.text) {
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
              const chatOpenNow = !!(state.chatOpen || state.chatOpenMobile);
              if (!chatOpenNow && !isChatMine(row)) {
                state.unreadChat = (state.unreadChat || 0) + 1;
                const badge = qs('.ting-top-actions .ting-icon-btn .badge');
                const chatBtn = qs('.ting-top-actions [data-act="toggle-chat"]');
                if (chatBtn && !badge) {
                  chatBtn.insertAdjacentHTML('beforeend',
                    `<span class="badge">${state.unreadChat > 9 ? '9+' : state.unreadChat}</span>`);
                } else if (badge) {
                  badge.textContent = state.unreadChat > 9 ? '9+' : String(state.unreadChat);
                }
              }
              const chatList = qs('#ting-chat-list');
              if (chatList && chatOpenNow) {
                const mine = isChatMine(row);
                chatList.insertAdjacentHTML('beforeend',
                  `<div class="ting-chat-bubble ${mine ? 'me' : ''}"><b>${esc(row.display_name)}</b>${esc(row.text)}</div>`);
                chatList.scrollTop = chatList.scrollHeight;
              } else if (!chatList) render();
            }
            return;
          }
          if (msg.type === 'reaction' && msg.emoji) {
            showReactionBurst(msg.emoji, msg.identity || msg.display_name || '');
            return;
          }
          if (msg.type === 'hand_raise' || msg.type === 'hand_lower' || msg.type === 'hand_force_lower') {
            const id = msg.identity || '';
            if (!id) return;
            if (msg.type === 'hand_raise') state.raisedHands[id] = true;
            else delete state.raisedHands[id];
            const mine = state.myIdentity || (state.lkRoom && state.lkRoom.localParticipant && state.lkRoom.localParticipant.identity);
            if (msg.type === 'hand_force_lower' && id === mine) {
              state.handRaised = false;
              toast('Организатор опустил вашу руку');
            }
            if (state.view === 'room' && state.peopleOpen) syncPeopleDrawer();
            else {
              const badge = qs('#ting-hand-badge');
              if (badge) badge.textContent = String(Object.keys(state.raisedHands).length || '');
            }
          }
        } catch (_) { /* ignore */ }
        void topic;
      });
      if (LK.RoomEvent.ConnectionQualityChanged) {
        room.on(LK.RoomEvent.ConnectionQualityChanged, (quality, participant) => {
          try {
            const local = room.localParticipant;
            if (participant && local && participant.identity !== local.identity) return;
            const q = (quality && quality.toString) ? quality.toString() : String(quality || '');
            state.connQuality = q.replace(/^ConnectionQuality\./, '').toLowerCase();
            const el = qs('#ting-quality');
            if (el || state.view === 'room') {
              if (state.view === 'room' && !el) {
                /* chip created on next render */
              }
              const map = { excellent: 'Отлично', good: 'Хорошо', poor: 'Слабо', lost: 'Потеря' };
              const label = map[state.connQuality];
              if (el && label) {
                el.textContent = label;
                el.className = 'ting-quality-chip q-' + state.connQuality;
              } else if (!el && label && state.view === 'room') {
                const actions = qs('.ting-top-actions');
                if (actions && !qs('#ting-quality')) {
                  actions.insertAdjacentHTML('afterbegin', `<span class="ting-quality-chip q-${esc(state.connQuality)}" id="ting-quality">${esc(label)}</span>`);
                }
              }
            }
          } catch (_) { /* */ }
        });
      }
      room.on(LK.RoomEvent.Disconnected, async () => {
        if (state.intentionalLeave) {
          stopLiveLoop();
          if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
          if (state.lkRoom === room) state.lkRoom = null;
          state.reconnecting = false;
          return;
        }
        if (state.lkRoom !== room) return;
        stopLiveLoop();
        if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
        state.lkRoom = null;
        let ended = state.room && (state.room.status === 'ended' || state.room.status === 'cancelled');
        if (!ended && slug) {
          try {
            const r = unwrapRoom(await api(`/api/thing/rooms/${encodeURIComponent(slug)}`));
            state.room = r;
            ended = r.status === 'ended' || r.status === 'cancelled';
          } catch (_) { /* */ }
        }
        if (ended) {
          setIncall(false);
          state.view = 'ended';
          state.reconnecting = false;
          render();
          return;
        }
        if (state.reconnecting) return;
        state.reconnecting = true;
        setIncall(true);
        const banner = qs('.ting-room-top');
        if (banner && !qs('.ting-reconnect')) {
          banner.insertAdjacentHTML('afterbegin', '<div class="ting-consent ting-reconnect" role="status">Переподключение…</div>');
        } else {
          toast('Переподключение…', false);
        }
        try {
          const dn = resolveLocalProfile().name || undefined;
          const fresh = await api(`/api/thing/rooms/${encodeURIComponent(slug)}/token`, {
            method: 'POST',
            body: JSON.stringify(tokenBody(dn))
          });
          const tok2 = fresh.token ? fresh : (fresh.data || fresh);
          await connectRoomWithCreds(slug, tok2);
          state.reconnecting = false;
          toast('Соединение восстановлено');
        } catch (_) {
          state.reconnecting = false;
          setIncall(false);
          toast('Соединение прервано', false);
          go('hub');
        }
      });

      /* UI комнаты сразу — не ждём 5–10с на камеру; hash без повторного route */
      state.joinInFlight = true;
      state.view = 'room';
      state.timerSec = 0;
      if (state.timerId) clearInterval(state.timerId);
      state.timerId = setInterval(() => {
        state.timerSec++;
        const el = qs('#ting-timer');
        if (el) el.textContent = fmtTime(state.timerSec);
      }, 1000);
      setIncall(true);
      render();
      try {
        const q = new URLSearchParams({ view: 'room', slug: String(slug || '') });
        const nextHash = '#/ting?' + q.toString();
        if ((location.hash || '') !== nextHash) {
          state.skipHashRoute = true;
          location.hash = nextHash;
        }
      } catch (_) { /* */ }

      /* lkRoom до connect — уход в CRM mid-join всё равно уйдёт в PiP/session */
      state.lkRoom = room;
      await withTimeout(
        room.connect(tok.url || tok.livekit_url, tok.token),
        12000,
        'Таймаут подключения к видеосерверу'
      );
      /* Автоплей-политика браузера: без startAudio удалённый звук молчит. */
      try {
        if (typeof room.startAudio === 'function') await room.startAudio();
      } catch (_) { /* */ }
      syncRemoteAudio(room);
      scheduleTokenRefresh(slug, tok);
      if (window.TingSession && typeof TingSession.adoptRoom === 'function') {
        try {
          TingSession.adoptRoom(room, {
            slug: slug,
            title: roomTitleDisplay(tok.room) || slug,
            identity: tok.identity || state.myIdentity,
            role: tok.role || null
          });
        } catch (_) { /* */ }
      }
      /* Уже ушли в другое меню CRM → media в session/PiP, страницу не трогаем */
      const parkedAway = !root || state.view !== 'room' || state.lkRoom !== room;
      /* Фаза 3: шумодав/AEC по умолчанию ВКЛ (как у Телемоста).
         На self-hosted Krisp недоступен (требует LiveKit Cloud), поэтому WebRTC NS. */
      try {
        await room.localParticipant.setMicrophoneEnabled(state.micOn, {
          echoCancellation: true,
          noiseSuppression: state.noiseSuppression !== false,
          autoGainControl: true
        });
      } catch (micErr) {
        /* Фолбэк: некоторые устройства/браузеры не принимают AudioCaptureOptions. */
        await room.localParticipant.setMicrophoneEnabled(state.micOn);
      }
      try {
        if (state.camOn) {
          try {
            await enableLocalCamera(room);
          } catch (camErr) {
            toast(cameraErrorMessage(camErr), false);
            state.camOn = false;
            stopPreview();
          }
        } else {
          stopPreview();
          await runCameraOp(() => room.localParticipant.setCameraEnabled(false));
        }
        if (!parkedAway && state.lkRoom === room) {
          paintTiles();
          setTimeout(() => { if (state.lkRoom === room && state.view === 'room') paintTiles(); }, 400);
          setTimeout(() => { if (state.lkRoom === room && state.view === 'room') paintTiles(); }, 1200);
        }
      } catch (e) {
        console.warn('local media', e);
        stopPreview();
        toast(friendlyErrorMessage(e, 'Не удалось включить микрофон/камеру'), false);
      }
      state.joinInFlight = false;
      state.skipHashRoute = false;
      if (parkedAway || !root || state.lkRoom !== room) {
        try {
          if (window.HuginnTing && typeof HuginnTing.ensurePip === 'function') HuginnTing.ensurePip();
        } catch (_) { /* */ }
        return;
      }
      await refreshPeople(slug);
      await refreshChat(slug);
      startLiveLoop(slug);
      TingSound.play('join');
      render();
    } catch (e) {
      state.joinInFlight = false;
      state.skipHashRoute = false;
      try { if (room) await room.disconnect(); } catch (_) { /* */ }
      if (state.lkRoom === room) state.lkRoom = null;
      setIncall(false);
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
        if (/^EG_/i.test(String(lp.identity))) return; /* бот записи */
        parts = parts.concat([{
          identity: lp.identity,
          display_name: lp.name || lp.identity,
          role: 'member',
          lobby_status: 'admitted',
          live: true
        }]);
        byId.add(lp.identity);
      });
      /* В живом SFU — только люди из LiveKit; EG_* (запись) и кикнутые DB-ghost — вон. */
      if (state.lkRoom && state.lkRoom.localParticipant) {
        const liveIds = new Set();
        try {
          liveIds.add(state.lkRoom.localParticipant.identity);
          state.lkRoom.remoteParticipants.forEach((_, id) => {
            if (id && !/^EG_/i.test(String(id))) liveIds.add(id);
          });
        } catch (_) { /* */ }
        const dbById = new Map(parts.filter(p => p.identity).map(p => [p.identity, p]));
        const liveParts = [];
        liveIds.forEach((id) => {
          if (dbById.has(id)) {
            liveParts.push(dbById.get(id));
            return;
          }
          let lp = null;
          try {
            lp = id === state.lkRoom.localParticipant.identity
              ? state.lkRoom.localParticipant
              : state.lkRoom.remoteParticipants.get(id);
          } catch (_) { /* */ }
          liveParts.push({
            identity: id,
            display_name: (lp && lp.name) || id,
            role: id === state.myIdentity ? 'host' : 'member',
            lobby_status: 'admitted',
            live: true
          });
        });
        parts = liveParts;
      }
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
  /**
   * T21: опросы. Подтягиваем при входе и в общем цикле комнаты.
   * my_choices нужен, чтобы показать, за что человек уже голосовал.
   */
  async function refreshPolls(slug) {
    try {
      const j = await api(`/api/thing/rooms/${encodeURIComponent(slug)}/polls`);
      const mine = `user_${(window.ASGARD_USER && ASGARD_USER.id) || ''}`;
      state.polls = (j.polls || []).map(p => {
        const votes = p.votes || [];
        const my = votes.find(v => v.identity === mine);
        let choices = my ? my.choices : [];
        if (typeof choices === 'string') { try { choices = JSON.parse(choices); } catch (_) { choices = []; } }
        return { ...p, my_choices: Array.isArray(choices) ? choices.map(Number) : [] };
      });
    } catch (_) { /* опросы не критичны для звонка */ }
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
    state.intentionalLeave = true;
    state.reconnecting = false;
    state.joinInFlight = false;
    state.consentAsked = false;
    if (state.tokenRefreshTimer) {
      clearTimeout(state.tokenRefreshTimer);
      state.tokenRefreshTimer = null;
    }
    TingSound.play('end');
    state.activeSpeakerId = null;
    state.swapPrimary = false;
    state.pinnedId = null;
    stopLiveLoop();
    stopCrmLobbyPoll();
    stopPreview();
    clearRemoteAudio();
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
    /* Медиа и session рвём сразу — сеть /end|/leave параллельно, UI не ждёт */
    const lk = state.lkRoom;
    state.lkRoom = null;
    setIncall(false);
    document.body.classList.remove('ting-live', 'ting-incall');
    document.documentElement.classList.remove('ting-incall');
    if (window.HuginnTing && typeof HuginnTing.closePip === 'function') {
      try { HuginnTing.closePip(); } catch (_) { /* */ }
    }
    state.sharing = false;
    state.chatOpen = false;
    state.chatOpenMobile = false;
    state.peopleOpen = false;
    state.moreOpen = false;

    const apiP = (async () => {
      if (endAll && slug) {
        try {
          await withTimeout(
            api(`/api/thing/rooms/${encodeURIComponent(slug)}/end`, { method: 'POST', body: '{}' }),
            8000,
            'Сервер не ответил на завершение'
          );
          if (state.room) state.room.status = 'ended';
        } catch (e) {
          toast(friendlyErrorMessage(e, 'Тинг завершён локально (сервер не ответил)'), false);
        }
      } else if (slug) {
        try {
          await withTimeout(
            api(`/api/thing/rooms/${encodeURIComponent(slug)}/leave`, { method: 'POST', body: '{}' }),
            5000,
            'leave-timeout'
          );
        } catch (_) { /* best-effort */ }
      }
    })();

    const mediaP = (async () => {
      if (window.TingSession && typeof TingSession.leave === 'function') {
        try { await withTimeout(TingSession.leave(), 4000, 'session-leave-timeout'); } catch (_) { /* */ }
      }
      /* на случай выхода до adoptRoom — session.leave мог не знать про lk */
      if (lk) {
        try { await withTimeout(lk.disconnect(), 4000, 'disconnect-timeout'); } catch (_) { /* */ }
      }
    })();

    await Promise.all([apiP, mediaP]);
    return true;
  }

  async function leaveRoom(endAll) {
    const slug = state.room && state.room.slug;
    /* Сначала уводим экран — teardown сети не блокирует «Завершить» */
    const p = teardownLive({ endAll: !!endAll });
    if (endAll) {
      if (slug) go('ended', { slug });
      else { state.view = 'ended'; render(); }
    } else {
      go('hub');
    }
    await p;
  }

  async function route() {
    if (state.skipHashRoute) {
      state.skipHashRoute = false;
      return;
    }
    const p = parseHash();
    if (!p) return;
    /* Внутри #/ting уход с комнаты: leave уже сделал teardown; иначе → PiP */
    if (state.view === 'room' && p.view !== 'room' && state.lkRoom) {
      if (state.intentionalLeave || p.view === 'ended') {
        /* leaveRoom/teardown мог не успеть — добить без повторного /end */
        await teardownLive({ endAll: false });
      } else {
        parkCallToPip();
      }
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
        const proto = raw.raw || {};
        // Пункты берём из minutes (совещание) + raw_json (протокол без совещания)
        const srcItems = minutes.length
          ? minutes
          : (proto.items || []).map((it) => ({
              item_type: it.type,
              content: it.content,
              assignee: it.assignee,
              due: it.due,
              status: it.status
            }));
        const tasks = srcItems
          .filter(m => m.item_type === 'assignment' || m.item_type === 'action' || m.item_type === 'task')
          .map(m => ({
            title: m.content,
            assignee: m.assignee || m.owner || '—',
            due: m.due || m.deadline || '—',
            status: m.status || 'open'
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
        const pick = (types) => srcItems.filter(m => types.includes(m.item_type)).map(m => m.content).join('\n');
        state.protocol = {
          status: raw.protocol_status || 'queued',
          can_edit: !!raw.can_edit,
          document: {
            title: (state.room && state.room.title) || proto.title || raw.title || 'Протокол Тинга',
            date: raw.date || new Date().toLocaleDateString('ru-RU'),
            duration: raw.duration || (harnessDemo() ? '24 мин' : ''),
            protocol_no: raw.protocol_no || '',
            agenda: pick(['agenda']) || (proto.agenda || []).join('\n') || '',
            decisions: pick(['decision', 'summary']) || proto.summary || '',
            summary: raw.summary || proto.summary || '',
            participants: parts,
            participant_rows,
            open_questions: pick(['question', 'open']) || (proto.open_questions || []).join('\n')
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
    if (state.joinInFlight && state.lkRoom) return;
    if (state.joinInFlight) return;
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
      autoStartRecording(slug);
      return;
    }
    if (!state.lkRoom || (state.room && state.room.slug !== slug)) {
      await connectRoom(slug);
    }
  }

  /**
   * Запись в режиме 'auto' стартует сама при входе организатора (один раз на комнату).
   * Если протокол включён, а записи нет — подскажем, что протокол будет пустым.
   */
  const autoRecStarted = {};
  async function autoStartRecording(slug) {
    if (!slug || autoRecStarted[slug]) return;
    const room = state.room || {};
    if (String(room.recording_mode || '') !== 'auto') return;
    if (room.status === 'ended' || room.status === 'cancelled') return;
    autoRecStarted[slug] = true;
    try {
      await api(`/api/thing/rooms/${encodeURIComponent(slug)}/recording/start`, { method: 'POST', body: '{}' });
      state.recording = true;
      toast('Запись включена автоматически');
      askRecordingConsent(slug);
      if (state.view === 'room') render();
    } catch (e) {
      autoRecStarted[slug] = false;
      toast('Не удалось начать запись: ' + (e.message || 'ошибка'), false);
    }
  }

  /**
   * Хост ли я — по host_user_id, не по state.isHost.
   * state.isHost заполняется только после refreshPeople; на входе он ещё false,
   * и хост получал модалку согласия на СВОЮ запись → блокирующий оверлей.
   */
  function amIRoomHost() {
    if (state.myRole === 'host' || state.isHost === true) return true;
    const meId = window.ASGARD_USER && ASGARD_USER.id;
    const hostId = state.room && state.room.host_user_id;
    if (meId == null || hostId == null) return false;
    return String(meId) === String(hostId);
  }

  /** Q09/R01: согласие на запись — по факту старта, не по конфигу комнаты. */
  function askRecordingConsent(slug) {
    if (state.consentAsked || !slug) return;
    /* Хост сам включает запись — модалку не показываем (иначе glass поверх комнаты). */
    if (amIRoomHost()) {
      state.consentAsked = true;
      return;
    }
    state.consentAsked = true;
    const existing = document.getElementById('ting-consent-modal');
    if (existing) return;
    const modal = document.createElement('div');
    modal.id = 'ting-consent-modal';
    modal.className = 'ting-modal-backdrop';
    /* Без ting-modal-enter модалка остаётся opacity:0 — на экране только «стекло»
       backdrop-filter, клики и камера кажутся мёртвыми (баг с зала 05.11.2026). */
    modal.innerHTML = `<div class="ting-modal ting-modal-enter" role="dialog" aria-labelledby="ting-consent-title">
      <h3 id="ting-consent-title">Идёт запись</h3>
      <p>Встреча записывается. Продолжая участие, вы соглашаетесь на обработку вашей речи и изображения для протокола встречи.</p>
      <div class="ting-cta-row">
        <button type="button" class="ting-btn ting-btn-primary" data-consent="yes">Согласен, остаюсь</button>
        <button type="button" class="ting-btn ting-btn-ghost" data-consent="no">Покинуть</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', async (ev) => {
      const t = ev.target.closest('[data-consent]');
      if (!t) return;
      const yes = t.getAttribute('data-consent') === 'yes';
      try {
        if (yes) {
          await api(`/api/thing/rooms/${encodeURIComponent(slug)}/consent`, {
            method: 'POST', body: JSON.stringify({ revoked: false })
          });
        } else {
          await api(`/api/thing/rooms/${encodeURIComponent(slug)}/consent`, {
            method: 'POST', body: JSON.stringify({ revoked: true })
          }).catch(() => {});
          modal.remove();
          leaveRoom();
          return;
        }
      } catch (_) { /* гости без auth — согласие локальное */ }
      modal.remove();
    });
  }

  /** T31: держим свежий JWT до reconnect (токен валидируется при connect). */
  function scheduleTokenRefresh(slug, tok) {
    if (state.tokenRefreshTimer) {
      clearTimeout(state.tokenRefreshTimer);
      state.tokenRefreshTimer = null;
    }
    const expiresAt = tok && tok.expires_at ? Date.parse(tok.expires_at) : 0;
    state.tokenExpiresAt = expiresAt || null;
    if (!expiresAt || !slug) return;
    const msLeft = expiresAt - Date.now();
    /* Обновить за 5 минут до истечения, минимум через 60 с. */
    const wait = Math.max(60 * 1000, msLeft - 5 * 60 * 1000);
    state.tokenRefreshTimer = setTimeout(async () => {
      try {
        const dn = resolveLocalProfile().name || undefined;
        const fresh = await api(`/api/thing/rooms/${encodeURIComponent(slug)}/token`, {
          method: 'POST',
          body: JSON.stringify(tokenBody(dn))
        });
        const tok2 = fresh.token ? fresh : (fresh.data || fresh);
        if (window.TingSession && typeof TingSession.storeToken === 'function') {
          try { TingSession.storeToken(tok2); } catch (_) { /* */ }
        }
        scheduleTokenRefresh(slug, tok2);
      } catch (e) {
        /* Повтор через 2 минуты — сеть могла моргнуть. */
        state.tokenRefreshTimer = setTimeout(() => scheduleTokenRefresh(slug, tok), 120000);
      }
    }, wait);
  }

  /** Единая точка применения «скрыть видео других» — вызывается и при перерисовке,
      и при новой подписке, иначе трек снова становится видимым. */
  function applyHideRemoteVideo() {
    if (!state.lkRoom) return;
    Array.from(state.lkRoom.remoteParticipants.values()).forEach(p => {
      Array.from(p.videoTrackPublications.values()).forEach(pub => {
        try { pub.setSubscribed(!state.hideRemoteVideo); } catch (_) { /* */ }
      });
    });
  }

  /** Общая функция применения настроек комнаты (вызывается из onchange). */
  async function applyRoomSetting(el) {
    if (!root) return;
    const slug = state.room && state.room.slug || (state.slug || '');
    const act = el.getAttribute('data-act');
    if (!slug) return;
    let patch;
    if (act === 'lobby-policy') patch = { lobby_policy: el.value, lobby_enabled: true };
    else if (act === 'max-video') patch = { max_video: Number(el.value) };
    else if (act === 'conference-mode') patch = { conference_mode: el.value };
    else patch = { forced_layout: el.value || null };
    try {
      await api(`/api/thing/rooms/${encodeURIComponent(slug)}`, {
        method: 'PATCH', body: JSON.stringify(patch)
      });
      state.room = Object.assign({}, state.room, patch);
      toast('Настройка применена');
      if (act === 'forced-layout' && el.value) {
        state.layout = el.value;
        paintTiles();
      }
    } catch (e) {
      toast(friendlyErrorMessage(e, 'Не удалось сохранить'), false);
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
      autoStartRecording(state.room && state.room.slug);
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
        let rec = qs('#ting-rec') ? qs('#ting-rec').checked : false;
        let proto = qs('#ting-proto') ? qs('#ting-proto').checked : false;
        if (proto) rec = true;   // протокол без расшифровки бессмыслен
        const body = {
          title,
          lobby_enabled: lobby,
          recording_mode: rec ? 'auto' : 'manual',
          protocol_enabled: proto
        };
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
        let rec = qs('#ting-rec') ? qs('#ting-rec').checked : false;
        let proto = qs('#ting-proto') ? qs('#ting-proto').checked : false;
        if (proto) rec = true;
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
            body: JSON.stringify({
              title,
              meeting_id: meetingId,
              lobby_enabled: lobby,
              protocol_enabled: proto,
              recording_mode: rec ? 'auto' : 'manual'
            })
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
        const want = !state.camOn;
        state.camOn = want;
        const v = qs('#ting-prev-v');
        try {
          if (want) {
            /* Превью камеры в лобби: раньше кнопка только переключала флаг,
               а видео не появлялось — человек видел чёрный прямоугольник.
               Берём поток здесь же и гасим его в connectRoom (LiveKit откроет
               камеру заново сам, чтобы не делить устройство с превью). */
            let stream = state.previewStream;
            const hasVideo = stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
            if (!hasVideo) {
              /* КОРЕНЬ AbortError: в лобби микрофон УЖЕ открыт из startPreview().
                 Просить video+audio повторно — Chromium не даёт открыть то же
                 устройство дважды и прерывает запрос (AbortError
                 «Timeout starting video source»). Берём только видео и
                 подмешиваем уже открытую дорожку микрофона. */
              const videoOnly = await openCameraStream({ audio: false });
              await assertCameraFrames(videoOnly, 2500);
              const merged = new MediaStream();
              videoOnly.getVideoTracks().forEach((t) => merged.addTrack(t));
              const oldAudio = state.previewStream && state.previewStream.getAudioTracks
                ? state.previewStream.getAudioTracks().filter((t) => t.readyState === 'live')
                : [];
              oldAudio.forEach((t) => merged.addTrack(t));
              /* Прежний видеопоток отпускаем, аудио переиспользуем. */
              if (state.previewStream) {
                state.previewStream.getVideoTracks().forEach((t) => { try { t.stop(); } catch (_) { /* */ } });
              }
              state.previewStream = merged;
              stream = merged;
              if (oldAudio.length) state.micOn = true;
            }
            if (v) {
              v.srcObject = state.previewStream;
              try { await v.play(); } catch (_) { /* autoplay-политика */ }
            }
            setPreviewCamVisual(true);
          } else {
            if (state.previewStream) {
              state.previewStream.getVideoTracks().forEach((t) => { t.enabled = false; });
            }
            setPreviewCamVisual(false);
          }
        } catch (e) {
          /* Не глотаем: без тоста «кнопка не работает». */
          state.camOn = false;
          setPreviewCamVisual(false);
          console.warn('[Ting] lobby camera', e && e.name, e && e.message);
          toast(cameraErrorMessage(e), false);
        }
        btn.classList.toggle('active', state.camOn);
        btn.classList.toggle('off', !state.camOn);
        btn.innerHTML = svgCam(!state.camOn);
        const micB = qs('#ting-lob-mic');
        if (micB) {
          micB.classList.toggle('active', state.micOn);
          micB.classList.toggle('off', !state.micOn);
          micB.innerHTML = svgMic(!state.micOn);
        }
        try { startMicMeter(state.previewStream); } catch (_) { /* */ }
        return;
      }
      if (act === 'connect') { await connectRoom(slug); return; }
      if (act === 'mic' && state.lkRoom) {
        const want = !state.micOn;
        const lp = state.lkRoom.localParticipant;
        try {
          if (typeof state.lkRoom.startAudio === 'function') {
            try { await state.lkRoom.startAudio(); } catch (_) { /* */ }
          }
          try {
            await lp.setMicrophoneEnabled(want, {
              echoCancellation: true,
              noiseSuppression: state.noiseSuppression !== false,
              autoGainControl: true
            });
          } catch (_) {
            /* Фолбэк без AudioCaptureOptions — часть устройств их не принимает. */
            await lp.setMicrophoneEnabled(want);
          }
          /* Источник истины — фактическое состояние публикации, а не наш флаг. */
          state.micOn = lp.isMicrophoneEnabled !== false;
        } catch (e) {
          /* Раньше здесь стоял пустой catch: кнопка «не нажималась» и никто
             не понимал почему. Показываем реальную причину. */
          state.micOn = lp.isMicrophoneEnabled === true;
          const name = String((e && e.name) || '');
          const msg = name === 'NotAllowedError'
            ? 'Браузер не даёт микрофон. Разрешите его в настройках сайта (замок в адресной строке).'
            : (name === 'NotFoundError'
              ? 'Микрофон не найден. Подключите его и попробуйте снова.'
              : (name === 'NotReadableError'
                ? 'Микрофон занят другим приложением.'
                : (e && e.message) || 'Не удалось переключить микрофон'));
          toast(msg, false);
        } finally {
          /* Без этого при исключении кнопка оставалась в старом состоянии. */
          try { TingSound.play('mic'); } catch (_) { /* звук не критичен */ }
          updateDockMedia();
        }
        return;
      }
      if (act === 'cam' && state.lkRoom) {
        const want = !state.camOn;
        try {
          if (want) {
            await enableLocalCamera(state.lkRoom);
            state.camOn = true;
          } else {
            await runCameraOp(async () => {
              await state.lkRoom.localParticipant.setCameraEnabled(false);
              await unpublishLocalCamera(state.lkRoom);
            });
            state.camOn = false;
          }
        } catch (e) {
          state.camOn = false;
          toast(cameraErrorMessage(e), false);
        } finally {
          try { TingSound.play('mic'); } catch (_) { /* */ }
          updateDockMedia();
          paintTiles();
        }
        return;
      }
      if (act === 'share' && state.lkRoom) {
        try {
          const next = !state.lkRoom.localParticipant.isScreenShareEnabled;
          await withTimeout(
            state.lkRoom.localParticipant.setScreenShareEnabled(next, next ? {
              audio: true,
              resolution: (window.LivekitClient && LivekitClient.ScreenSharePresets
                && LivekitClient.ScreenSharePresets.h1080fps15)
                ? LivekitClient.ScreenSharePresets.h1080fps15.resolution
                : undefined
            } : undefined),
            20000,
            'Таймаут демонстрации экрана'
          );
          state.sharing = next;
          updateDockMedia();
          paintTiles();
          if (next) toast('Демонстрация экрана включена');
        } catch (err) {
          state.sharing = false;
          const msg = String((err && err.message) || err || '');
          toast(/Permission|NotAllowed|denied/i.test(msg)
            ? 'Разрешите доступ к экрану в браузере'
            : (err.message || 'Не удалось показать экран'), false);
          updateDockMedia();
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
          state.chatOpen = false;
          state.chatOpenMobile = false;
          state.moreOpen = false;
          const more = qs('#ting-more');
          if (more) more.remove();
          const chat = qs('.ting-chat');
          if (chat) chat.classList.remove('open');
          await refreshPeople(slug);
        }
        /* Не render()+paintTiles — иначе видео собеседника «прыгает» на первый план. */
        syncPeopleDrawer();
        return;
      }
      if (act === 'toggle-more') {
        state.moreOpen = !state.moreOpen;
        if (state.moreOpen) {
          state.peopleOpen = false;
          await refreshDeviceList();
        }
        render();
        return;
      }
      if (act === 'bg-preset') {
        await applyBackgroundPreset(btn.dataset.bg || 'none');
        state.moreOpen = false;
        render();
        return;
      }
      if (act === 'hand-toggle') {
        await publishTingData({
          type: state.handRaised ? 'hand_lower' : 'hand_raise',
          identity: state.myIdentity || (state.lkRoom && state.lkRoom.localParticipant && state.lkRoom.localParticipant.identity)
        });
        state.handRaised = !state.handRaised;
        const id = state.myIdentity || '';
        if (id) {
          if (state.handRaised) state.raisedHands[id] = true;
          else delete state.raisedHands[id];
        }
        state.moreOpen = false;
        render();
        return;
      }
      if (act === 'react') {
        const emoji = btn.dataset.emoji || '👍';
        await publishTingData({
          type: 'reaction',
          emoji,
          identity: state.myIdentity || '',
          display_name: resolveLocalProfile().name || 'Вы'
        });
        showReactionBurst(emoji, 'Вы');
        state.moreOpen = false;
        render();
        return;
      }
      if (act === 'blur-toggle') {
        await toggleBackgroundBlur();
        state.moreOpen = false;
        render();
        return;
      }
      if (act === 'toggle-chat' || act === 'chat-open-mobile') {
        const next = act === 'toggle-chat' ? !(state.chatOpen || state.chatOpenMobile) : true;
        state.chatOpen = next;
        state.chatOpenMobile = next;
        if (next) {
          state.peopleOpen = false;
          state.moreOpen = false;
          state.unreadChat = 0;
        }
        render();
        return;
      }
      if (act === 'chat-close' || act === 'chat-close-mobile') {
        state.chatOpen = false;
        state.chatOpenMobile = false;
        render();
        return;
      }
      if (act === 'admit') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/lobby/${btn.dataset.id}/admit`, { method: 'POST', body: '{}' });
        await refreshPeople(slug);
        syncPeopleDrawer({ quiet: true });
        return;
      }
      if (act === 'reject') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/lobby/${btn.dataset.id}/reject`, { method: 'POST', body: '{}' });
        await refreshPeople(slug);
        syncPeopleDrawer({ quiet: true });
        return;
      }
      if (act === 'remove') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/participants/${encodeURIComponent(btn.dataset.id)}/remove`, {
          method: 'POST', body: '{}'
        });
        await refreshPeople(slug);
        syncPeopleDrawer();
        paintTiles();
        return;
      }
      /* Фаза 2: точечная модерация — мик, камера, шаринг экрана. */
      if (act === 'mute-mic-one' || act === 'mute-cam-one' || act === 'stop-share-one') {
        const kind = act === 'mute-mic-one' ? 'audio' : (act === 'mute-cam-one' ? 'video' : 'screen');
        try {
          const r = await api(
            `/api/thing/rooms/${encodeURIComponent(slug)}/participants/${encodeURIComponent(btn.dataset.id)}/mute`,
            { method: 'POST', body: JSON.stringify({ kind }) }
          );
          toast(kind === 'audio' ? 'Микрофон выключен' : (kind === 'video' ? 'Камера выключена' : 'Демонстрация остановлена'));
          await refreshPeople(slug);
          syncPeopleDrawer({ quiet: true });
        } catch (e) {
          toast(friendlyErrorMessage(e, 'Не удалось применить'), false);
        }
        return;
      }
      /* T09: опустить руку участнику (сервер + data-channel). */
      if (act === 'lower-hand-one') {
        const id = btn.dataset.id;
        try {
          await api(
            `/api/thing/rooms/${encodeURIComponent(slug)}/participants/${encodeURIComponent(id)}/lower-hand`,
            { method: 'POST', body: '{}' }
          );
          await publishTingData({ type: 'hand_force_lower', identity: id });
          delete state.raisedHands[id];
          toast('Рука опущена');
          syncPeopleDrawer({ quiet: true });
        } catch (e) {
          toast(friendlyErrorMessage(e, 'Не удалось опустить руку'), false);
        }
        return;
      }
      if (act === 'make-cohost') {
        try {
          await api(`/api/thing/rooms/${encodeURIComponent(slug)}/roles`, {
            method: 'POST',
            body: JSON.stringify({ identity: btn.dataset.id, role: btn.dataset.role || 'co_host' })
          });
          toast('Роль назначена');
          await refreshPeople(slug);
          syncPeopleDrawer({ quiet: true });
        } catch (e) {
          toast(friendlyErrorMessage(e, 'Не удалось назначить роль'), false);
        }
        return;
      }
      if (act === 'noise-toggle') {
        state.noiseSuppression = !state.noiseSuppression;
        if (state.lkRoom && state.micOn) {
          try {
            await state.lkRoom.localParticipant.setMicrophoneEnabled(true, {
              echoCancellation: true,
              noiseSuppression: state.noiseSuppression,
              autoGainControl: true
            });
          } catch (_) { /* */ }
        }
        toast(state.noiseSuppression ? 'Шумоподавление включено' : 'Шумоподавление отключено');
        render();
        return;
      }
      if (act === 'hide-remote-toggle') {
        state.hideRemoteVideo = !state.hideRemoteVideo;
        applyHideRemoteVideo();
        toast(state.hideRemoteVideo ? 'Видео других скрыто' : 'Видео других показано');
        paintTiles();
        return;
      }
      if (act === 'mute-all') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/mute-all`, { method: 'POST', body: '{}' });
        toast('Микрофоны участников выключены');
        return;
      }
      if (act === 'lock-toggle') {
        const locked = !(state.room && state.room.locked);
        try {
          const r = await api(`/api/thing/rooms/${encodeURIComponent(slug)}`, {
            method: 'PATCH', body: JSON.stringify({ locked })
          });
          state.room = Object.assign({}, state.room, { locked });
          toast(locked ? 'Вход в комнату закрыт' : 'Вход открыт');
          render();
        } catch (e) {
          toast(friendlyErrorMessage(e, 'Не удалось изменить вход'), false);
        }
        return;
      }
      /* Фаза 2: настройки комнаты на лету (D1) — политика лобби, видео-слоты, PIN. */
      if (act === 'lobby-policy' || act === 'max-video' || act === 'conference-mode' || act === 'forced-layout') {
        /* Селекты обрабатываются в onchange (applyRoomSetting) — здесь ничего не делаем,
           чтобы не отправлять PATCH со старым значением при клике по списку. */
        return;
      }
      if (act === 'set-pin') {
        const pin = window.prompt('PIN из 4 цифр (пусто — убрать PIN):', '');
        if (pin === null) return;
        try {
          const clean = String(pin).replace(/\D/g, '').slice(0, 4);
          await api(`/api/thing/rooms/${encodeURIComponent(slug)}`, {
            method: 'PATCH', body: JSON.stringify({ pin_code: clean })
          });
          state.room = Object.assign({}, state.room, { pin_required: Boolean(clean) });
          toast(clean ? 'PIN установлен' : 'PIN снят');
          render();
        } catch (e) {
          toast(friendlyErrorMessage(e, 'Не удалось изменить PIN'), false);
        }
        return;
      }
      if (act === 'rec-start') {
        await api(`/api/thing/rooms/${encodeURIComponent(slug)}/recording/start`, { method: 'POST', body: '{}' });
        state.recording = true;
        askRecordingConsent(slug);
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
      if (act === 'poll-create') {
        const raw = window.prompt('Вопрос опроса:', '');
        if (!raw) return;
        const optsRaw = window.prompt('Варианты через точку с запятой:', '');
        if (!optsRaw) return;
        const options = String(optsRaw).split(';').map(s => s.trim()).filter(Boolean);
        if (options.length < 2) { toast('Нужно минимум два варианта', false); return; }
        try {
          await api(`/api/thing/rooms/${encodeURIComponent(slug)}/polls`, {
            method: 'POST',
            body: JSON.stringify({ question: raw, options })
          });
          await refreshPolls(slug);
          toast('Опрос создан');
          render();
        } catch (e) {
          toast(friendlyErrorMessage(e, 'Не удалось создать опрос'), false);
        }
        return;
      }
      if (act === 'poll-vote') {
        const pollId = btn.dataset.poll;
        const opt = parseInt(btn.dataset.opt, 10);
        try {
          await api(`/api/thing/rooms/${encodeURIComponent(slug)}/polls/${pollId}/vote`, {
            method: 'POST',
            body: JSON.stringify({ choices: [opt] })
          });
          await refreshPolls(slug);
          if (state.view === 'room') render();
        } catch (e) {
          toast(friendlyErrorMessage(e, 'Не удалось проголосовать'), false);
        }
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
      root.onchange = async (ev) => {
        const tgt = ev.target;
        if (!tgt || !tgt.closest) return;
        /* Устройства: отдельная логика переподключения трека. */
        const dev = tgt.closest('[data-act="device-audio"],[data-act="device-video"]');
        if (dev) {
          const id = dev.value;
          if (!id) return;
          if (dev.getAttribute('data-act') === 'device-audio') await switchTingDevice('audioinput', id);
          else await switchTingDevice('videoinput', id);
          return;
        }
        /* Настройки комнаты на лету: в WebKit change не всплывает в onclick,
           поэтому обрабатываем здесь, а не в click (иначе значение не применяется). */
        const setting = tgt.closest('[data-act="lobby-policy"],[data-act="max-video"],[data-act="conference-mode"],[data-act="forced-layout"]');
        if (setting) await applyRoomSetting(setting);
      };
      route();
    },
    unmount() {
      /* Уход со страницы Тинга при живом созвоне → PiP, не disconnect */
      if (state.lkRoom && !state.intentionalLeave) {
        parkCallToPip();
        return;
      }
      stopPreview();
      stopLiveLoop();
      stopCrmLobbyPoll();
      setIncall(false);
      const sess = window.TingSession;
      const keep = sess && typeof sess.isActive === 'function' && sess.isActive();
      if (state.lkRoom) {
        if (keep && sess.getRoom && sess.getRoom() === state.lkRoom) {
          if (typeof sess.syncChrome === 'function') sess.syncChrome();
        } else if (keep) {
          try { sess.adoptRoom(state.lkRoom, { slug: state.room && state.room.slug, title: roomTitleDisplay(state.room), identity: state.myIdentity }); } catch (_) {}
        } else {
          try { state.lkRoom.disconnect(); } catch (_) { /* */ }
        }
        state.lkRoom = null;
      }
      if (state.timerId) clearInterval(state.timerId);
      const m = qs('#ting-host-end'); if (m) m.remove();
      if (root) { root.onclick = null; root.onchange = null; root.innerHTML = ''; }
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
    const onTing = (location.hash || '').indexOf('#/ting') === 0;
    if (!onTing) {
      /* Уход в другое меню CRM — не рвать созвон, свернуть в PiP */
      if (root || (state.lkRoom && state.view === 'room')) parkCallToPip();
      return;
    }
    if (root) route();
  });
  window.addEventListener('resize', () => {
    if (state.view === 'room' && root) render();
  });
})();
