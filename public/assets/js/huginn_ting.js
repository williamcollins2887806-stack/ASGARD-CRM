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

  function openHub(slug) {
    location.hash = slug ? '#/ting/' + encodeURIComponent(slug) : '#/ting';
  }

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
      if (!D || !D.isPanelOpen || !D.isPanelOpen('ting')) return;
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
    } catch (_) {
      /* keep last cache */
    }
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
        else openHub(slug);
      };
    });
    panelHost.querySelectorAll('[data-ting-act]').forEach((btn) => {
      btn.onclick = () => {
        const act = btn.getAttribute('data-ting-act');
        if (act === 'hub' || act === 'new' || act === 'plan') openHub();
        else if (act === 'code') {
          const code = prompt('Код Тинга');
          if (code) openHub(String(code).trim());
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
      const tok = await api('/api/thing/rooms/' + encodeURIComponent(slug) + '/token', {
        method: 'POST',
        body: JSON.stringify({ display_name: (global.ASGARD_USER && ASGARD_USER.name) || 'Участник' })
      });
      if (tok.lobby_status === 'waiting') {
        openHub(slug);
        return;
      }
      await S.connect({
        slug: slug,
        url: tok.url,
        token: tok.token,
        identity: tok.identity,
        title: (tok.room && tok.room.title) || (roomMeta && roomMeta.title) || slug,
        room: tok.room,
        role: tok.role
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

  function paintCompact() {
    if (!panelHost) return;
    const S = global.TingSession;
    const st = S ? S.getState() : {};
    const meta = st.meta || {};
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
        '<div class="hg-ting-tiles" id="hgTingTiles"></div>' +
        '<div class="hg-ting-timer" id="hgTingTimer">' + fmtTimer(st.timerSec) + '</div>' +
        '<div class="hg-ting-controls">' +
          '<button type="button" class="hg-chip" data-ting-ctl="mic">' + (st.micOn && !st.phoneForcedMute ? 'Мик' : 'Мик off') + '</button>' +
          '<button type="button" class="hg-chip" data-ting-ctl="cam">' + (st.camOn ? 'Кам' : 'Кам off') + '</button>' +
          '<button type="button" class="hg-chip hg-ting-danger" data-ting-ctl="hang">Выйти</button>' +
          '<button type="button" class="hg-chip" data-ting-ctl="expand">Развернуть</button>' +
          '<button type="button" class="hg-chip" data-ting-ctl="pip">PiP</button>' +
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
        else if (ctl === 'expand') openHub(meta.slug);
        else if (ctl === 'pip') ensurePip();
        if (ctl !== 'hang' && ctl !== 'expand') paintCompact();
      };
    });
    attachTiles(panelHost.querySelector('#hgTingTiles'), 2);
  }

  function attachTiles(el, maxN) {
    if (!el) return;
    el.innerHTML = '';
    const S = global.TingSession;
    const room = S && S.getRoom && S.getRoom();
    if (!room) {
      el.innerHTML = '<div class="hg-ting-empty">Подключение…</div>';
      return;
    }
    let n = 0;
    const add = (participant, track) => {
      if (n >= maxN) return;
      if (!track || track.kind !== 'video') return;
      const wrap = document.createElement('div');
      wrap.className = 'hg-ting-tile';
      const v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.muted = participant.isLocal;
      wrap.appendChild(v);
      el.appendChild(wrap);
      track.attach(v);
      n += 1;
    };
    if (room.localParticipant) {
      room.localParticipant.trackPublications.forEach((pub) => {
        if (pub.track) add(room.localParticipant, pub.track);
      });
    }
    room.remoteParticipants.forEach((p) => {
      p.trackPublications.forEach((pub) => {
        if (pub.track) add(p, pub.track);
      });
    });
    if (!n) el.innerHTML = '<div class="hg-ting-empty">Нет видео — только аудио</div>';
  }

  function ensurePip() {
    const S = global.TingSession;
    if (!S || !S.isActive()) { closePip(); return; }
    if (pipEl && document.body.contains(pipEl)) return;
    closePip();
    const meta = S.getMeta() || {};
    pipEl = document.createElement('div');
    pipEl.className = 'hg-ting-pip';
    pipEl.innerHTML =
      '<div class="hg-ting-pip-drag" data-drag></div>' +
      '<div class="hg-ting-pip-video" id="hgTingPipVid"></div>' +
      '<div class="hg-ting-pip-bar">' +
        '<span id="hgTingPipTimer">' + fmtTimer(S.getState().timerSec) + '</span>' +
        '<button type="button" class="hg-chip" data-pip="mic">Мик</button>' +
        '<button type="button" class="hg-chip" data-pip="hang">✕</button>' +
        '<button type="button" class="hg-chip" data-pip="expand">↗</button>' +
      '</div>';
    document.body.appendChild(pipEl);
    attachTiles(pipEl.querySelector('#hgTingPipVid'), 1);
    bindPipDrag(pipEl);
    pipEl.querySelectorAll('[data-pip]').forEach((btn) => {
      btn.onclick = async () => {
        const a = btn.getAttribute('data-pip');
        if (a === 'hang') { await S.leave(); closePip(); if (mounted) paintIdle(); }
        else if (a === 'expand') { closePip(); openHub(meta.slug); }
        else if (a === 'mic') {
          const st = S.getState();
          await S.setMicEnabled(!(st.micOn && !st.phoneForcedMute));
        }
      };
    });
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
    if (!mounted) {
      if (d.type === 'tick' && pipEl) {
        const t = pipEl.querySelector('#hgTingPipTimer');
        if (t) t.textContent = fmtTimer(d.timerSec);
      }
      return;
    }
    if (d.type === 'tick') {
      const t = panelHost && panelHost.querySelector('#hgTingTimer');
      if (t) t.textContent = fmtTimer(d.timerSec);
      return;
    }
    if (d.type === 'connected' || d.type === 'media' || d.type === 'phone-busy' || d.type === 'phone-free') {
      paintCompact();
    } else if (d.type === 'left') {
      closePip();
      paintIdle();
    }
  }

  function mountPanel(panelEl) {
    if (!panelEl) return;
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
    // do NOT leave TingSession — tab switch keeps call
  }

  // legacy stubs (no iframe)
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
    closePip: closePip
  };
})(typeof window !== 'undefined' ? window : global);
