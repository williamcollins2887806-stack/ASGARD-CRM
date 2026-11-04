/* Birthday Greet — premium ritual (invite / atelier / reveal) */
(function () {
  'use strict';

  const TONE_META = { warm: 'Тёплый', saga: 'Сага', light: 'Лёгкий' };

  let _layer = null;
  let _todayCache = [];
  let _fxStop = null;

  function art() {
    return window.AsgardBirthdayArt || null;
  }
  function giftMeta(type) {
    const m = art() && art().META;
    return (m && m[type]) || { name: type, hint: '', scene: '' };
  }
  function giftSvg(type) {
    if (art() && art().giftSvg) return art().giftSvg(type);
    return '';
  }
  function giftCardHtml(type, selected) {
    if (art() && art().giftCardHtml) return art().giftCardHtml(type, selected);
    return `<button type="button" class="bd-gift ${selected ? 'is-on' : ''}" data-gift="${type}">${type}</button>`;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 41 → «41 год», 22 → «22 года», 35 → «35 лет» */
  function yearsWordRu(n) {
    const a = Math.abs(Number(n) || 0) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return 'лет';
    if (b === 1) return 'год';
    if (b >= 2 && b <= 4) return 'года';
    return 'лет';
  }
  function formatYearsRu(n) {
    if (n == null || n === '') return null;
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    return v + ' ' + yearsWordRu(v);
  }
  function ageTodayLabel(age) {
    const f = formatYearsRu(age);
    return f ? ('сегодня ' + f) : 'сегодня день рождения';
  }

  function mskDayKey() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
    } catch (_) {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }

  function auth() {
    return (window.AsgardAuth && AsgardAuth.getAuth && AsgardAuth.getAuth()) || null;
  }

  function tokenHeaders() {
    const a = auth();
    const t = a && a.token;
    return t
      ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }

  async function api(path, opts) {
    const r = await fetch(path, {
      ...opts,
      headers: { ...tokenHeaders(), ...((opts && opts.headers) || {}) },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(j.message || j.error || ('HTTP ' + r.status));
      err.status = r.status;
      err.body = j;
      throw err;
    }
    return j;
  }

  function initials(name) {
    const p = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return 'А';
    return ((p[0][0] || '') + (p[1] ? p[1][0] : '')).toUpperCase();
  }

  function avatarGradient(name) {
    let h = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const a = 28 + (h % 40);
    const b = 48 + ((h >> 5) % 35);
    return `linear-gradient(145deg, hsl(${a},48%,58%), hsl(${b},42%,38%))`;
  }

  function reduceMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (_) { return false; }
  }

  function dismissKey(userId) { return `bd_banner_${userId}_${mskDayKey()}`; }
  function revealKey(userId) { return `bd_reveal_seen_${userId}_${mskDayKey()}`; }
  function isDismissed(userId) {
    try { return localStorage.getItem(dismissKey(userId)) === '1'; } catch (_) { return false; }
  }
  function setDismissed(userId) {
    try { localStorage.setItem(dismissKey(userId), '1'); } catch (_) {}
  }
  function revealSeen(userId) {
    try { return localStorage.getItem(revealKey(userId)) === '1'; } catch (_) { return false; }
  }
  function setRevealSeen(userId) {
    try { localStorage.setItem(revealKey(userId), '1'); } catch (_) {}
  }

  function softChime() {
    if (reduceMotion()) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      [[523.25, 0, 0.035], [659.25, 0.12, 0.028], [783.99, 0.26, 0.022]].forEach(([freq, delay, gain]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.value = 0.0001;
        o.connect(g); g.connect(ctx.destination);
        const t0 = now + delay;
        g.gain.exponentialRampToValueAtTime(gain, t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
        o.start(t0); o.stop(t0 + 0.6);
      });
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 1200);
    } catch (_) {}
  }

  function haptic(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern || [16, 36, 16]); } catch (_) {}
  }

  function stopFx() {
    if (typeof _fxStop === 'function') {
      try { _fxStop(); } catch (_) {}
    }
    _fxStop = null;
  }

  function clearLayer() {
    stopFx();
    if (_layer) {
      try { _layer.remove(); } catch (_) {}
      _layer = null;
    }
  }

  function mountLayer(innerHtml, { dismissOnDim } = {}) {
    clearLayer();
    const wrap = document.createElement('div');
    wrap.className = 'bd-root';
    wrap.innerHTML = `<div class="bd-dim" data-bd-dim></div><div class="bd-stage">${innerHtml}</div>`;
    document.body.appendChild(wrap);
    _layer = wrap;
    if (dismissOnDim) {
      wrap.querySelector('[data-bd-dim]')?.addEventListener('click', dismissOnDim);
    }
    return wrap;
  }

  /* Premium fireworks: gold trails + soft sparks */
  function runFireworks(canvas, ms) {
    if (!canvas || reduceMotion()) return () => {};
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ctx = canvas.getContext('2d');
    let w = canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    let h = canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    const particles = [];
    const colors = ['#FFF4D0', '#F0D078', '#E8C35A', '#D4A843', '#F5F0E6'];

    function burst(x, y, count, speed) {
      for (let i = 0; i < count; i++) {
        const a = (Math.PI * 2 * i) / count + Math.random() * 0.15;
        const sp = speed * (0.55 + Math.random() * 0.7);
        particles.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          decay: 0.008 + Math.random() * 0.01,
          r: (1.4 + Math.random() * 2.2) * dpr,
          c: colors[(i + (Math.random() * colors.length) | 0) % colors.length],
          trail: Math.random() > 0.55,
        });
      }
    }

    burst(w * 0.5, h * 0.38, 36, 2.1 * dpr);
    const t1 = setTimeout(() => burst(w * 0.3, h * 0.5, 24, 1.7 * dpr), 420);
    const t2 = setTimeout(() => burst(w * 0.7, h * 0.46, 24, 1.7 * dpr), 820);

    let alive = true;
    const start = performance.now();
    function frame(t) {
      if (!alive) return;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.018 * dpr;
        p.vx *= 0.992;
        p.life -= p.decay;
        if (p.life <= 0) continue;
        ctx.globalAlpha = Math.max(0, p.life);
        if (p.trail) {
          ctx.strokeStyle = p.c;
          ctx.lineWidth = Math.max(1, p.r * 0.45);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
          ctx.stroke();
        }
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      if (t - start < (ms || 3600)) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return () => {
      alive = false;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }

  function spawnPetals(scene) {
    if (!scene || reduceMotion()) return;
    for (let i = 0; i < 16; i++) {
      const p = document.createElement('span');
      p.className = 'bd-petal';
      p.style.left = (8 + Math.random() * 84) + '%';
      p.style.top = (4 + Math.random() * 28) + '%';
      p.style.setProperty('--dx', (Math.random() * 100 - 50) + 'px');
      p.style.animationDuration = (2.4 + Math.random() * 2.2) + 's';
      p.style.animationDelay = (Math.random() * 1.1) + 's';
      scene.appendChild(p);
      setTimeout(() => p.remove(), 5200);
    }
  }

  /* ── Invitation ── */
  function openInvite(items) {
    const list = Array.isArray(items) && items.length ? items : _todayCache;
    _todayCache = list || [];
    const peers = _todayCache.filter((it) => !it.is_me);
    if (!peers.length) return;
    let selected = peers[0].id;

    const hall = peers.map((p) => `
      <button type="button" class="bd-person ${p.id === selected ? 'is-on' : ''}" data-id="${p.id}">
        <div class="bd-av" style="background:${avatarGradient(p.name)}">${
          p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc(initials(p.name))
        }</div>
        <div class="bd-person__name">${esc(p.name)}</div>
        <div class="bd-person__meta">${ageTodayLabel(p.age)}</div>
        ${p.already_sent
          ? '<div class="bd-person__sent">дар уже отправлен</div>'
          : (p.sent_count ? `<div class="bd-person__sent">даров в зале: ${p.sent_count}</div>` : '')}
      </button>
    `).join('');

    const wrap = mountLayer(`
      <div class="bd-frame bd-invite" role="dialog" aria-modal="true" aria-label="День рождения">
        <div class="bd-invite__eyebrow">Асгард · день воина</div>
        <h2 class="bd-invite__title">В зале сегодня праздник</h2>
        <p class="bd-invite__sub">Оставь дар — текст напишет Асгард по дороге</p>
        <div class="bd-invite__hall">${hall}</div>
        <div class="bd-invite__actions">
          <button type="button" class="bd-btn bd-btn--ghost" data-later>Позже</button>
          <button type="button" class="bd-btn bd-btn--gold" data-go>Поздравить</button>
        </div>
      </div>
    `, {
      dismissOnDim: () => {
        const a = auth();
        if (a?.user?.id) setDismissed(a.user.id);
        clearLayer();
      },
    });

    const goBtn = wrap.querySelector('[data-go]');
    function syncSelected() {
      wrap.querySelectorAll('.bd-person').forEach((el) => {
        el.classList.toggle('is-on', Number(el.getAttribute('data-id')) === Number(selected));
      });
      const cur = peers.find((p) => Number(p.id) === Number(selected));
      if (goBtn) goBtn.disabled = !!(cur && cur.already_sent);
    }
    syncSelected();

    wrap.querySelectorAll('.bd-person').forEach((el) => {
      el.addEventListener('click', () => {
        selected = Number(el.getAttribute('data-id'));
        syncSelected();
      });
    });
    wrap.querySelector('[data-later]')?.addEventListener('click', () => {
      const a = auth();
      if (a?.user?.id) setDismissed(a.user.id);
      clearLayer();
    });
    goBtn?.addEventListener('click', () => {
      const cur = peers.find((p) => Number(p.id) === Number(selected));
      if (!cur || cur.already_sent) return;
      openAtelier(cur);
    });
  }

  /* ── Atelier ── */
  function openAtelier(person) {
    let gift = 'flowers';
    let tone = 'warm';
    const types = ['flowers', 'fireworks', 'toy'];

    const wrap = mountLayer(`
      <div class="bd-frame bd-atelier" role="dialog" aria-modal="true" aria-label="Выбор дара">
        <div class="bd-atelier__eyebrow">Ателье даров</div>
        <h2 class="bd-atelier__title">Дар для ${esc(person.name)}</h2>
        <p class="bd-atelier__sub">Выбери материю и тон — свиток напишется сам</p>
        <div class="bd-gifts">${types.map((k) => giftCardHtml(k, k === gift)).join('')}</div>
        <div class="bd-tones">${Object.keys(TONE_META).map((k) => `
          <button type="button" class="bd-tone ${k === tone ? 'is-on' : ''}" data-tone="${k}">${esc(TONE_META[k])}</button>
        `).join('')}</div>
        <div class="bd-invite__actions">
          <button type="button" class="bd-btn bd-btn--ghost" data-cancel>Назад</button>
          <button type="button" class="bd-btn bd-btn--gold" data-send>Отправить дар</button>
        </div>
      </div>
    `);

    wrap.querySelectorAll('[data-gift]').forEach((el) => {
      el.addEventListener('click', () => {
        gift = el.getAttribute('data-gift');
        wrap.querySelectorAll('[data-gift]').forEach((x) => {
          const on = x === el;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
    });
    wrap.querySelectorAll('[data-tone]').forEach((el) => {
      el.addEventListener('click', () => {
        tone = el.getAttribute('data-tone');
        wrap.querySelectorAll('[data-tone]').forEach((x) => x.classList.toggle('is-on', x === el));
      });
    });
    wrap.querySelector('[data-cancel]')?.addEventListener('click', () => openInvite(_todayCache));
    wrap.querySelector('[data-send]')?.addEventListener('click', async () => {
      const btn = wrap.querySelector('[data-send]');
      if (btn) btn.disabled = true;
      try {
        await api('/api/birthday-gifts', {
          method: 'POST',
          body: JSON.stringify({ to_user_id: person.id, gift_type: gift, tone }),
        });
        haptic([12, 30, 12]);
        softChime();
        showFlyAway();
      } catch (err) {
        if (btn) btn.disabled = false;
        if (window.AsgardUI?.toast) {
          AsgardUI.toast('Дар', err.status === 409 ? 'Ты уже поздравил' : (err.message || 'Не удалось отправить'), 'warn');
        }
      }
    });
  }

  function showFlyAway() {
    mountLayer(`
      <div class="bd-frame"><div class="bd-fly">
        <div class="bd-fly__orb"></div>
        <div class="bd-fly__txt">Дар улетел в зал</div>
      </div></div>
    `);
    setTimeout(() => {
      clearLayer();
      if (window.AsgardUI?.toast) {
        AsgardUI.toast('Дар отправлен', 'Именинник увидит его при входе в CRM', 'ok');
      }
      const a = auth();
      if (a?.user?.id) setDismissed(a.user.id);
    }, reduceMotion() ? 450 : 1300);
  }

  /* ── Reveal ── */
  async function openReveal(force) {
    const a = auth();
    if (!a?.user?.id) return;
    if (!force && revealSeen(a.user.id)) return;

    let data;
    try {
      data = await api('/api/birthday-gifts/inbox?unread=1');
    } catch (_) {
      if (!force) return;
      try { data = await api('/api/birthday-gifts/inbox'); } catch (e2) { return; }
    }

    const items = data.items || [];
    const asgard = data.asgard;
    if (!items.length && !asgard) return;

    softChime();
    haptic([18, 40, 18, 40, 24]);

    let idx = -1; // -1 = hall intro
    const total = items.length;

    function renderHall() {
      const wrap = mountLayer(`
        <div class="bd-frame bd-reveal" role="dialog" aria-modal="true" aria-label="Дары">
          <div class="bd-reveal__line"></div>
          <div class="bd-reveal__eyebrow">Зал даров</div>
          <h2 class="bd-reveal__title">Тебе оставили дары</h2>
          <p class="bd-hall-count">${total
            ? (total === 1 ? 'Один дар ждёт тебя' : `Даров в зале: ${total}`)
            : 'Слово от Асгарда'}</p>
          <p class="bd-reveal__sub">Открой — и прочитай каждый свиток</p>
          <div class="bd-reveal__nav">
            <button type="button" class="bd-btn bd-btn--ghost" data-skip>Позже</button>
            <button type="button" class="bd-btn bd-btn--gold" data-next>Открыть</button>
          </div>
        </div>
      `);
      wrap.querySelector('[data-skip]')?.addEventListener('click', () => finishReveal());
      wrap.querySelector('[data-next]')?.addEventListener('click', () => {
        idx = 0;
        if (total > 0) renderGift();
        else if (asgard) renderAsgard(asgard);
        else finishReveal();
      });
    }

    function renderGift() {
      const g = items[idx];
      if (!g) {
        if (asgard) return renderAsgard(asgard);
        return finishReveal();
      }
      const pending = g.message_status !== 'ready' || !g.message_text;
      const meta = giftMeta(g.gift_type);
      stopFx();

      const wrap = mountLayer(`
        <div class="bd-frame bd-reveal" role="dialog" aria-modal="true" aria-label="Дар">
          <div class="bd-reveal__line"></div>
          <div class="bd-reveal__eyebrow">Дар ${idx + 1} из ${total}</div>
          <h2 class="bd-reveal__title">${esc(meta.name || 'Дар')}</h2>
          <p class="bd-reveal__sub">от ${esc(g.from_name)}${meta.scene ? ' · ' + esc(meta.scene) : ''}</p>
          <div class="bd-scene bd-scene--${esc(g.gift_type)}" data-scene>
            <canvas data-fx></canvas>
            <div class="bd-scene__art">${giftSvg(g.gift_type)}</div>
          </div>
          <div data-letter>
            ${pending
              ? '<div class="bd-pending">Свиток ещё пишется золотыми нитями…</div>'
              : `<div class="bd-letter"><div class="bd-letter__from">От ${esc(g.from_name)}</div>${esc(g.message_text)}</div>`}
          </div>
          <div class="bd-reveal__nav">
            <button type="button" class="bd-btn bd-btn--ghost" data-skip>Закрыть</button>
            <button type="button" class="bd-btn bd-btn--gold" data-next>${idx + 1 < total || asgard ? 'Далее' : 'В добрый путь'}</button>
          </div>
        </div>
      `);

      const scene = wrap.querySelector('[data-scene]');
      const canvas = wrap.querySelector('[data-fx]');
      if (g.gift_type === 'fireworks') _fxStop = runFireworks(canvas, 3800);
      if (g.gift_type === 'flowers') spawnPetals(scene);
      haptic([10, 24, 10]);

      let pollTimer = null;
      if (pending) {
        pollTimer = setInterval(async () => {
          try {
            const fresh = await api('/api/birthday-gifts/inbox');
            const updated = (fresh.items || []).find((x) => Number(x.id) === Number(g.id));
            if (updated && updated.message_status === 'ready' && updated.message_text) {
              clearInterval(pollTimer);
              const box = wrap.querySelector('[data-letter]');
              if (box) {
                box.innerHTML = `<div class="bd-letter"><div class="bd-letter__from">От ${esc(updated.from_name || g.from_name)}</div>${esc(updated.message_text)}</div>`;
              }
              g.message_text = updated.message_text;
              g.message_status = 'ready';
            }
          } catch (_) {}
        }, 2000);
      }

      wrap.querySelector('[data-skip]')?.addEventListener('click', async () => {
        if (pollTimer) clearInterval(pollTimer);
        await finishReveal();
      });
      wrap.querySelector('[data-next]')?.addEventListener('click', async () => {
        if (pollTimer) clearInterval(pollTimer);
        try { await api('/api/birthday-gifts/' + g.id + '/open', { method: 'POST', body: '{}' }); } catch (_) {}
        idx += 1;
        if (idx < total) renderGift();
        else if (asgard) renderAsgard(asgard);
        else await finishReveal();
      });
    }

    function renderAsgard(wish) {
      stopFx();
      const text = wish.message_email || wish.message_sms || '';
      const wrap = mountLayer(`
        <div class="bd-frame bd-reveal" role="dialog" aria-modal="true" aria-label="От Асгарда">
          <div class="bd-reveal__line"></div>
          <div class="bd-reveal__eyebrow">И от всего Асгарда</div>
          <h2 class="bd-reveal__title">День воина</h2>
          <p class="bd-reveal__sub">официальное слово команды</p>
          <div class="bd-letter">${esc(text)}</div>
          <div class="bd-reveal__nav">
            <span></span>
            <button type="button" class="bd-btn bd-btn--gold" data-done>В добрый путь</button>
          </div>
        </div>
      `);
      wrap.querySelector('[data-done]')?.addEventListener('click', () => finishReveal());
    }

    async function finishReveal() {
      stopFx();
      try { await api('/api/birthday-gifts/inbox/open-all', { method: 'POST', body: '{}' }); } catch (_) {}
      setRevealSeen(a.user.id);
      clearLayer();
    }

    if (total > 0) renderHall();
    else if (asgard) renderAsgard(asgard);
  }

  async function maybeShow() {
    const a = auth();
    if (!a?.user?.id) return;
    if (_layer) return;

    const forceReveal = /[?&]bd_reveal=1/.test(location.hash + location.search);

    try {
      const inbox = await api('/api/birthday-gifts/inbox?unread=1');
      const hasUnread = (inbox.unread || 0) > 0 || (forceReveal && ((inbox.items || []).length || inbox.asgard));
      if (hasUnread) {
        await openReveal(!!forceReveal);
        return;
      }
    } catch (_) {}

    if (isDismissed(a.user.id)) return;

    try {
      const today = await api('/api/birthday-gifts/today');
      _todayCache = today.items || [];
      const peers = _todayCache.filter((it) => !it.is_me);
      if (!peers.length) return;
      openInvite(_todayCache);
    } catch (_) {}
  }

  function openSendFor(userId, name, age) {
    openAtelier({
      id: userId,
      name: name || 'коллега',
      age: age == null || age === '' ? null : Number(age),
      already_sent: false,
    });
  }

  window.AsgardBirthdayGreet = {
    maybeShow,
    openInvite,
    openAtelier,
    openReveal,
    openSendFor,
    formatYearsRu,
    ageTodayLabel,
    clear: clearLayer,
  };

  window.addEventListener('hashchange', () => {
    if (/bd_reveal=1/.test(location.hash)) openReveal(true);
  });
})();
