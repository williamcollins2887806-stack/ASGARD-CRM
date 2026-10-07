/**
 * Huginn ↔ Ting: panel IA (Live/Soon/CTA/History) + compact/PiP.
 * No iframe — one TingSession for hub and rail.
 */
(function (global) {
  'use strict';

  let panelHost = null;
  let listTimer = null;
  let listSeq = 0;
  let roomsCache = [];
  let protocolCache = null;
  let pipEl = null;
  let mounted = false;
  let dockListenerBound = false;

  const ROLE_TITLE = {
    ADMIN: 'администратор',
    DIRECTOR_GEN: 'генеральный директор',
    DIRECTOR_COMM: 'коммерческий директор',
    DIRECTOR_DEV: 'директор по развитию',
    PM: 'руководитель проекта',
    HEAD_PM: 'руководитель проектов',
    TO: 'технический отдел',
    HEAD_TO: 'руководитель ТО',
    BUH: 'бухгалтер',
    HR: 'HR',
    HR_MANAGER: 'руководитель HR',
    OM: 'офис-менеджер'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function token() {
    return localStorage.getItem('asgard_token') || '';
  }

  async function api(path, opts) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers }, opts || {}, {
      headers: Object.assign(headers, (opts && opts.headers) || {})
    }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(j.error || j.message || ('HTTP ' + r.status));
      err.code = j.code || null;
      throw err;
    }
    return j;
  }

  /** Canonical CRM route — never #/ting/slug (router exact-match → /home). */
  function openHub(slug, view) {
    if (!slug) {
      location.hash = '#/ting';
      return;
    }
    const v = view || 'room';
    location.hash = '#/ting?view=' + encodeURIComponent(v) + '&slug=' + encodeURIComponent(slug);
  }

  function localDisplayProfile() {
    let u = {};
    try { u = JSON.parse(localStorage.getItem('asgard_user') || '{}') || {}; } catch (_) { u = {}; }
    if (global.AsgardAuth && AsgardAuth.user) {
      u = Object.assign({}, u, AsgardAuth.user);
    }
    if (global.ASGARD_USER && typeof global.ASGARD_USER === 'object') {
      u = Object.assign({}, u, global.ASGARD_USER);
    }
    const name = String(u.full_name || u.name || u.email || '').trim();
    const job = u.job_title || u.position || ROLE_TITLE[u.role] || '';
    return {
      name: name || '',
      jobTitle: job,
      label: name ? (job ? (name + ' · ' + job) : name) : (job ? ('Участник · ' + job) : 'Участник')
    };
  }

  function initials(name) {
    const base = String(name || '?').replace(/\([^)]*\)/g, ' ').trim();
    const parts = base.split(/\s+/).filter(Boolean).slice(0, 2);
    const out = parts.map((s) => {
      const m = s.match(/[\u0400-\u04FFa-zA-Z]/);
      return m ? m[0].toUpperCase() : '';
    }).join('');
    return out || '?';
  }

  function ico(paths) {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }

  const SVG = {
    mic: ico('<path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>'),
    micOff: ico('<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V5a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2"/><line x1="12" y1="19" x2="12" y2="23"/>'),
    cam: ico('<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>'),
    camOff: ico('<path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/>'),
    hang: ico('<path d="M10.68 13.31a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 003.81.74 2 2 0 012 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 2 12.84 12.84 0 00.74 3.81 2 2 0 01-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/>'),
    expand: ico('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'),
    pip: ico('<rect x="2" y="3" width="20" height="14" rx="2"/><rect x="11" y="10" width="9" height="6" rx="1"/>')
  };

  function setRailBadge(opts) {
    opts = opts || {};
    const dock = document.getElementById('huginnDock');
    if (!dock) return;
    const btn = dock.querySelector('.hg-rail-btn[data-hg-tab="ting"]');
    if (!btn) return;
    let badge = btn.querySelector('[data-rail-badge="ting"]');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'hg-rail-badge';
      badge.setAttribute('data-rail-badge', 'ting');
      btn.appendChild(badge);
    }
    const live = Number(opts.live) || 0;
    const soon = Number(opts.soon) || 0;
    const n = live + soon;
    badge.hidden = n === 0;
    if (n > 0) badge.textContent = n > 99 ? '99+' : String(n);
    btn.classList.toggle('is-live', live > 0);
  }

  function splitRooms(list) {
    const now = Date.now();
    const live = [];
    const soon = [];
    const history = [];
    (list || []).forEach((r) => {
      const st = String(r.status || '');
      if (st === 'live' || st === 'lobby') live.push(r);
      else if (st === 'ended' || st === 'cancelled') history.push(r);
      else {
        const when = r.scheduled_at || r.starts_at || r.meeting_at;
        if (when) {
          const t = new Date(when).getTime();
          const diff = t - now;
          if (diff >= 0 && diff <= 24 * 3600 * 1000) soon.push(r);
          else if (diff < 0 && st === 'scheduled') live.push(r);
          else soon.push(r);
        } else if (st === 'scheduled') soon.push(r);
        else history.push(r);
      }
    });
    return { live: live, soon: soon, history: history.slice(0, 8) };
  }

  function fmtTimer(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function stopListPoll() {
    if (listTimer) clearInterval(listTimer);
    listTimer = null;
  }

  function startListPoll() {
    stopListPoll();
    listTimer = setInterval(() => {
      if (!mounted || !panelHost) return;
      const D = global.HuginnDock;
      if (!D || !D.isTabOpen || !D.isTabOpen('ting')) return;
      refreshLists();
    }, 30000);
  }

  async function refreshLists() {
    const seq = ++listSeq;
    try {
      const data = await api('/api/thing/rooms');
      if (seq !== listSeq) return;
      roomsCache = data.rooms || data.items || data || [];
      if (!Array.isArray(roomsCache)) roomsCache = [];
      const parts = splitRooms(roomsCache);
      setRailBadge({ live: parts.live.length, soon: parts.soon.length });
      if (mounted) paintIdle();
    } catch (_) { /* keep last cache */ }
  }

  function roomRow(r, actionLabel) {
    return (
      '<button type="button" class="hg-ting-row" data-slug="' + esc(r.slug) + '">' +
        '<div class="hg-ting-row-title">' + esc(r.title || r.slug) + '</div>' +
        '<div class="hg-ting-row-meta">' + esc(r.status || '') +
          (r.scheduled_at ? ' · ' + esc(String(r.scheduled_at).slice(0, 16).replace('T', ' ')) : '') +
        '</div>' +
        '<span class="hg-ting-row-cta">' + esc(actionLabel) + '</span>' +
      '</button>'
    );
  }

  function paintIdle() {
    if (!panelHost) return;
    const S = global.TingSession;
    if (S && S.isActive()) {
      paintCompact();
      return;
    }
    const parts = splitRooms(roomsCache);
    const liveHtml = parts.live.length
      ? parts.live.map((r) => roomRow(r, 'Войти')).join('')
      : '<div class="hg-ting-empty">Нет идущих Тингов</div>';
    const soonHtml = parts.soon.length
      ? parts.soon.slice(0, 5).map((r) => roomRow(r, 'Открыть')).join('')
      : '<div class="hg-ting-empty">Нет ближайших</div>';
    const histHtml = parts.history.length
      ? parts.history.map((r) => roomRow(r, 'Протокол')).join('')
      : '<div class="hg-ting-empty">История пуста</div>';

    panelHost.innerHTML =
      '<div class="hg-panel-head">' +
        '<h2>Тинг</h2>' +
        '<button type="button" class="hg-icon-btn" data-collapse aria-label="Свернуть">✕</button>' +
      '</div>' +
      '<div class="hg-ting-panel">' +
        '<section class="hg-ting-sec">' +
          '<div class="hg-ting-sec-h">Live сейчас</div>' + liveHtml +
        '</section>' +
        '<section class="hg-ting-sec">' +
          '<div class="hg-ting-sec-h">Скоро</div>' + soonHtml +
        '</section>' +
        '<section class="hg-ting-sec hg-ting-cta">' +
          '<button type="button" class="hg-chip hg-ting-gold" data-ting-act="new">Новый</button>' +
          '<button type="button" class="hg-chip" data-ting-act="code">По коду</button>' +
          '<button type="button" class="hg-chip" data-ting-act="plan">Запланировать</button>' +
        '</section>' +
        '<section class="hg-ting-sec">' +
          '<div class="hg-ting-sec-h">История / протоколы</div>' + histHtml +
        '</section>' +
        '<div class="hg-ting-foot">' +
          '<button type="button" class="hg-chip" data-ting-act="hub">Открыть хаб Тинг</button>' +
          '<button type="button" class="hg-chip" data-ting-act="phone-log">Журнал → Телефон</button>' +
        '</div>' +
        (protocolCache ? '<div class="hg-ting-proto" id="hgTingProto">' + esc(protocolCache) + '</div>' : '') +
      '</div>';

    wireIdle(parts);
  }

  function wireIdle(parts) {
    if (!panelHost) return;
    const collapse = panelHost.querySelector('[data-collapse]');
    if (collapse) collapse.onclick = () => {
      if (global.HuginnDock && global.HuginnDock.collapse) global.HuginnDock.collapse();
    };
    panelHost.querySelectorAll('[data-slug]').forEach((btn) => {
      btn.onclick = async () => {
        const slug = btn.getAttribute('data-slug');
        const room = (roomsCache || []).find((r) => r.slug === slug);
        const st = room && room.status;
        if (st === 'ended' || st === 'cancelled') {
          try {
            const p = await api('/api/thing/rooms/' + encodeURIComponent(slug) + '/protocol');
            protocolCache = (p && (p.summary || p.text || p.protocol_status)) || 'Протокол недоступен';
            if (typeof protocolCache !== 'string') protocolCache = JSON.stringify(protocolCache).slice(0, 400);
            paintIdle();
          } catch (e) {
            openHub(slug);
          }
          return;
        }
        if (st === 'live' || st === 'lobby') joinSlug(slug, room);
        else openHub(slug, 'lobby');
      };
    });
    panelHost.querySelectorAll('[data-ting-act]').forEach((btn) => {
      btn.onclick = () => {
        const act = btn.getAttribute('data-ting-act');
        if (act === 'hub' || act === 'new' || act === 'plan') {
          location.hash = act === 'hub' ? '#/ting' : (act === 'new' ? '#/ting?view=new' : '#/ting?view=schedule');
        } else if (act === 'code') {
          const code = prompt('Код Тинга');
          if (code) openHub(String(code).trim());
        } else if (act === 'phone-log') {
          if (global.HuginnDock && global.HuginnDock.openTab) global.HuginnDock.openTab('phone');
        }
      };
    });
  }

  async function joinSlug(slug, roomMeta) {
    const S = global.TingSession;
    if (!S) {
      openHub(slug);
      return;
    }
    try {
      const me = localDisplayProfile();
      const body = {};
      // Не шлём заглушку «Участник» — сервер подставит ФИО из users.name
      if (me.name) body.display_name = me.name;
      const tok = await api('/api/thing/rooms/' + encodeURIComponent(slug) + '/token', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      if (tok.lobby_status === 'waiting') {
        openHub(slug, 'waiting');
        return;
      }
      await S.connect({
        slug: slug,
        url: tok.url,
        token: tok.token,
        identity: tok.identity,
        title: (tok.room && tok.room.title) || (roomMeta && roomMeta.title) || slug,
        room: tok.room,
        role: tok.role,
        displayName: tok.display_name || me.name || 'Участник',
        jobTitle: tok.job_title || me.jobTitle
      });
      paintCompact();
    } catch (e) {
      if (e && e.code === 'PBX_BUSY') {
        toast(e.message || 'Сначала завершите телефонный разговор');
        return;
      }
      toast(e.message || 'Не удалось войти');
    }
  }

  function toast(msg) {
    if (global.AsgardUI && AsgardUI.toast) AsgardUI.toast(msg, 'error');
    else console.warn('[HuginnTing]', msg);
  }

  function ctlBtn(ctl, title, svg, extraClass) {
    return '<button type="button" class="hg-ting-iconbtn' + (extraClass ? ' ' + extraClass : '') +
      '" data-ting-ctl="' + ctl + '" title="' + esc(title) + '" aria-label="' + esc(title) + '">' + svg + '</button>';
  }

  function paintCompact() {
    if (!panelHost) return;
    const S = global.TingSession;
    const st = S ? S.getState() : {};
    const meta = st.meta || {};
    const micLive = !!(st.micOn && !st.phoneForcedMute);
    const banner = st.phoneForcedMute
      ? '<div class="hg-ting-banner">Трубка занята телефоном</div>'
      : '';
    panelHost.innerHTML =
      '<div class="hg-panel-head">' +
        '<h2>' + esc(meta.title || 'Тинг') + '</h2>' +
        '<button type="button" class="hg-icon-btn" data-collapse aria-label="Свернуть">✕</button>' +
      '</div>' +
      '<div class="hg-ting-panel hg-ting-compact">' +
        banner +
        '<div class="hg-ting-stage" id="hgTingTiles"></div>' +
        '<div class="hg-ting-timer" id="hgTingTimer">' + fmtTimer(st.timerSec) + '</div>' +
        '<div class="hg-ting-controls hg-ting-iconbar">' +
          ctlBtn('mic', micLive ? 'Микрофон вкл.' : 'Микрофон выкл.', micLive ? SVG.mic : SVG.micOff, micLive ? '' : 'is-off') +
          ctlBtn('cam', st.camOn ? 'Камера вкл.' : 'Камера выкл.', st.camOn ? SVG.cam : SVG.camOff, st.camOn ? '' : 'is-off') +
          ctlBtn('hang', 'Выйти', SVG.hang, 'is-danger') +
          ctlBtn('expand', 'Развернуть', SVG.expand, '') +
          ctlBtn('pip', 'Мини-окно', SVG.pip, pipEl ? 'is-active' : '') +
        '</div>' +
      '</div>';

    const collapse = panelHost.querySelector('[data-collapse]');
    if (collapse) collapse.onclick = () => {
      if (global.HuginnDock && global.HuginnDock.collapse) global.HuginnDock.collapse();
      ensurePip();
    };
    panelHost.querySelectorAll('[data-ting-ctl]').forEach((btn) => {
      btn.onclick = async () => {
        const ctl = btn.getAttribute('data-ting-ctl');
        if (ctl === 'mic') await S.setMicEnabled(!(st.micOn && !st.phoneForcedMute));
        else if (ctl === 'cam') await S.setCamEnabled(!st.camOn);
        else if (ctl === 'hang') { await S.leave(); closePip(); paintIdle(); }
        else if (ctl === 'expand') { closePip(); openHub(meta.slug); }
        else if (ctl === 'pip') togglePip();
        if (ctl !== 'hang' && ctl !== 'expand') paintCompact();
      };
    });
    paintStage(panelHost.querySelector('#hgTingTiles'));
  }

  function participantLabel(p, isLocal) {
    if (isLocal) {
      const me = localDisplayProfile();
      const S = global.TingSession;
      const meta = S && S.getMeta && S.getMeta();
      let name = (meta && meta.displayName) || me.name || '';
      if (!name || /^участник(\s+\d+)?$/i.test(name) || /^user_\d+$/i.test(name)) {
        name = me.name || name || 'Участник';
      }
      const job = (meta && meta.jobTitle) || me.jobTitle;
      return job ? (name + ' · ' + job) : name;
    }
    const name = (p && (p.name || p.displayName || p.identity)) || 'Участник';
    if (/^user_\d+$/i.test(name) || name === p.identity) {
      return 'Участник';
    }
    return name;
  }

  function makeTileEl(participant, track, opts) {
    opts = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'hg-ting-tile' + (opts.primary ? ' is-primary' : '') + (opts.inset ? ' is-inset' : '');
    const label = participantLabel(participant, !!opts.local);
    if (track && track.kind === 'video') {
      const v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.muted = !!opts.local;
      wrap.appendChild(v);
      track.attach(v);
    } else {
      const ph = document.createElement('div');
      ph.className = 'hg-ting-tile-ph';
      ph.innerHTML = '<span class="hg-ting-avatar">' + esc(initials(label)) + '</span>';
      wrap.appendChild(ph);
    }
    const lab = document.createElement('div');
    lab.className = 'hg-ting-tile-lbl';
    lab.textContent = opts.local ? ('Вы · ' + label) : label;
    wrap.appendChild(lab);
    return wrap;
  }

  function pickVideoTrack(participant) {
    if (!participant) return null;
    let found = null;
    const pubs = participant.trackPublications || participant.videoTrackPublications;
    if (!pubs) return null;
    pubs.forEach((pub) => {
      if (found) return;
      if (pub.track && pub.track.kind === 'video') found = pub.track;
    });
    return found;
  }

  function paintStage(el) {
    if (!el) return;
    el.innerHTML = '';
    const S = global.TingSession;
    const room = S && S.getRoom && S.getRoom();
    if (!room) {
      el.innerHTML = '<div class="hg-ting-empty">Подключение…</div>';
      return;
    }
    const local = room.localParticipant;
    const remotes = [];
    room.remoteParticipants.forEach((p) => remotes.push(p));

    let primary = remotes[0] || local;
    let primaryTrack = pickVideoTrack(primary);
    // Prefer remote with video
    remotes.forEach((p) => {
      const t = pickVideoTrack(p);
      if (t) { primary = p; primaryTrack = t; }
    });

    el.appendChild(makeTileEl(primary, primaryTrack, {
      primary: true,
      local: primary === local
    }));

    if (primary !== local && local) {
      el.appendChild(makeTileEl(local, pickVideoTrack(local), { inset: true, local: true }));
    } else if (remotes.length && primary === local) {
      const other = remotes[0];
      el.appendChild(makeTileEl(other, pickVideoTrack(other), { inset: true, local: false }));
    }
  }

  function togglePip() {
    if (pipEl && document.body.contains(pipEl)) closePip();
    else ensurePip();
  }

  function ensurePip() {
    const S = global.TingSession;
    if (!S || !S.isActive()) { closePip(); return; }
    if (pipEl && document.body.contains(pipEl)) {
      syncPipPark();
      paintStage(pipEl.querySelector('#hgTingPipVid'));
      return;
    }
    closePip();
    const meta = S.getMeta() || {};
    pipEl = document.createElement('div');
    pipEl.className = 'hg-ting-pip';
    pipEl.innerHTML =
      '<div class="hg-ting-pip-drag" data-drag title="Перетащить">Мини-окно</div>' +
      '<div class="hg-ting-pip-video" id="hgTingPipVid"></div>' +
      '<div class="hg-ting-pip-bar">' +
        '<span id="hgTingPipTimer">' + fmtTimer(S.getState().timerSec) + '</span>' +
        '<button type="button" class="hg-ting-iconbtn" data-pip="mic" title="Микрофон" aria-label="Микрофон">' + SVG.mic + '</button>' +
        '<button type="button" class="hg-ting-iconbtn is-danger" data-pip="hang" title="Выйти" aria-label="Выйти">' + SVG.hang + '</button>' +
        '<button type="button" class="hg-ting-iconbtn" data-pip="expand" title="Развернуть" aria-label="Развернуть">' + SVG.expand + '</button>' +
        '<button type="button" class="hg-ting-iconbtn" data-pip="close" title="Закрыть мини-окно" aria-label="Закрыть">✕</button>' +
      '</div>';
    document.body.appendChild(pipEl);
    paintStage(pipEl.querySelector('#hgTingPipVid'));
    bindPipDrag(pipEl);
    syncPipPark();
    pipEl.querySelectorAll('[data-pip]').forEach((btn) => {
      btn.onclick = async () => {
        const a = btn.getAttribute('data-pip');
        if (a === 'hang') { await S.leave(); closePip(); if (mounted) paintIdle(); }
        else if (a === 'expand') { closePip(); openHub(meta.slug); }
        else if (a === 'close') closePip();
        else if (a === 'mic') {
          const st = S.getState();
          await S.setMicEnabled(!(st.micOn && !st.phoneForcedMute));
        }
      };
    });
  }

  function syncPipPark() {
    if (!pipEl) return;
    const dock = document.getElementById('huginnDock');
    const phoneActive = !!(dock && dock.querySelector('.hg-rail-btn[data-hg-tab="phone"].is-active'));
    const panelOpen = !!(dock && !dock.classList.contains('is-collapsed') && document.body.classList.contains('hg-dock-open'));
    pipEl.classList.toggle('is-parked', phoneActive && panelOpen);
    if (phoneActive && panelOpen) {
      pipEl.style.left = '';
      pipEl.style.top = '';
      pipEl.style.right = '';
      pipEl.style.bottom = '';
    }
  }

  function closePip() {
    if (pipEl) {
      pipEl.remove();
      pipEl = null;
    }
  }

  function bindPipDrag(el) {
    const handle = el.querySelector('[data-drag]') || el;
    let ox = 0, oy = 0, dragging = false;
    const onDown = (e) => {
      if (el.classList.contains('is-parked')) return;
      dragging = true;
      const r = el.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      el.style.left = Math.max(8, e.clientX - ox) + 'px';
      el.style.top = Math.max(8, e.clientY - oy) + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };
    const onUp = (e) => {
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  }

  function onSessionEvent(ev) {
    const d = ev.detail || {};
    if (d.type === 'tick' && pipEl) {
      const t = pipEl.querySelector('#hgTingPipTimer');
      if (t) t.textContent = fmtTimer(d.timerSec);
    }
    if (!mounted) return;
    if (d.type === 'tick') {
      const t = panelHost && panelHost.querySelector('#hgTingTimer');
      if (t) t.textContent = fmtTimer(d.timerSec);
      return;
    }
    if (d.type === 'connected' || d.type === 'media' || d.type === 'phone-busy' || d.type === 'phone-free') {
      paintCompact();
      if (pipEl) paintStage(pipEl.querySelector('#hgTingPipVid'));
    } else if (d.type === 'left') {
      closePip();
      paintIdle();
    }
  }

  function onDockLayout(ev) {
    const d = ev && ev.detail;
    if (!d) return;
    syncPipPark();
  }

  function bindDockListener() {
    if (dockListenerBound) return;
    dockListenerBound = true;
    document.addEventListener('huginn-dock', onDockLayout);
  }

  function mountPanel(panelEl) {
    if (!panelEl) return;
    bindDockListener();
    if (panelHost === panelEl && mounted) {
      const S = global.TingSession;
      if (S && S.isActive()) paintCompact();
      else paintIdle();
      return;
    }
    unmountPanel();
    panelHost = panelEl;
    mounted = true;
    document.addEventListener('ting-session', onSessionEvent);
    paintIdle();
    refreshLists();
    startListPoll();
  }

  function unmountPanel() {
    mounted = false;
    stopListPoll();
    document.removeEventListener('ting-session', onSessionEvent);
    panelHost = null;
  }

  function openOverlay() { openHub(); }
  function closeOverlay() { closePip(); }

  global.HuginnTing = {
    openHub: openHub,
    openOverlay: openOverlay,
    closeOverlay: closeOverlay,
    mountPanel: mountPanel,
    unmountPanel: unmountPanel,
    setRailBadge: setRailBadge,
    refreshLists: refreshLists,
    ensurePip: ensurePip,
    closePip: closePip,
    syncPipPark: syncPipPark
  };
})(typeof window !== 'undefined' ? window : global);
