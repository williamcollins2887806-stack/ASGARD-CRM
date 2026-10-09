(function () {
  'use strict';

  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const inviteToken = params.get('invite') || '';

  function token() { return localStorage.getItem('asgard_token') || ''; }

  /** Local XSS-safe escape (ui.js is not loaded on /h/). */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function logoSvg() {
    const ico = (window.HuginnIcons && window.HuginnIcons.ICO) || {};
    return ico.empty || ico['message-circle'] ||
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>';
  }

  function themeToggleHtml() {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    return `<div class="h-theme-toggle" role="group" aria-label="Тема">
      <button type="button" data-theme-set="dark" class="${cur === 'dark' ? 'is-active' : ''}">Тёмная</button>
      <button type="button" data-theme-set="light" class="${cur === 'light' ? 'is-active' : ''}">Светлая</button>
    </div>`;
  }

  function wireThemeToggle() {
    document.querySelectorAll('[data-theme-set]').forEach((btn) => {
      btn.onclick = () => {
        const t = btn.getAttribute('data-theme-set');
        if (typeof window.__hgSetTheme === 'function') window.__hgSetTheme(t);
        else document.documentElement.setAttribute('data-theme', t);
        document.querySelectorAll('[data-theme-set]').forEach((b) => {
          b.classList.toggle('is-active', b.getAttribute('data-theme-set') === t);
        });
      };
    });
  }

  // ── TG-style step flow: phone → confirm → code, or email → check ──
  // Country list kept tiny (RU default); extend as needed.
  const COUNTRIES = [
    { code: 'RU', flag: '🇷🇺', dial: '+7', name: 'Россия', len: 10 },
    { code: 'KZ', flag: '🇰🇿', dial: '+7', name: 'Казахстан', len: 10 },
    { code: 'BY', flag: '🇧🇾', dial: '+375', name: 'Беларусь', len: 9 },
    { code: 'UA', flag: '🇺🇦', dial: '+380', name: 'Украина', len: 9 },
    { code: 'UZ', flag: '🇺🇿', dial: '+998', name: 'Узбекистан', len: 9 },
    { code: 'AM', flag: '🇦🇲', dial: '+374', name: 'Армения', len: 8 },
    { code: 'GE', flag: '🇬🇪', dial: '+995', name: 'Грузия', len: 9 }
  ];

  function stepShell(inner) {
    app.innerHTML = `<div class="h-step">${inner}</div>`;
  }

  function renderLogin(opts) {
    const invite = opts && opts.invite;
    let country = COUNTRIES[0];
    let syncContacts = true;
    let lastPhoneFull = '';
    stepShell(`
      ${!invite ? '<div class="h-step-top"><button type="button" class="h-step-cancel" id="toEmail">Отмена</button></div>' : ''}
      <div class="h-step-art" aria-hidden="true">${invite ? '📨' : '☎️'}</div>
      <h1 class="h-step-title">${invite ? 'Хугинн' : 'Телефон'}</h1>
      <p class="h-step-sub">${invite
        ? ('Приглашение от ' + esc(invite.inviter_name || 'сотрудника') + '. Подтвердите телефон — код придёт в SMS.')
        : 'Проверьте код страны и введите свой номер телефона.'}</p>
      <div class="h-err" id="err"></div>
      ${invite ? `<input id="name" placeholder="Ваше имя" autocomplete="name" />` : ''}
      <button type="button" class="h-country" id="countryBtn">
        <span class="flag">${country.flag}</span><span>${esc(country.name)}</span><span class="chev">›</span>
      </button>
      <div class="h-phone-row">
        <span class="h-phone-prefix" id="dialCode">${country.dial}</span>
        <input id="phone" type="tel" inputmode="tel" placeholder="Номер телефона" autocomplete="tel"
          value="${invite && invite.phone ? esc(invite.phone) : ''}" />
      </div>
      <label class="h-sync">
        <span>Синхронизировать контакты</span>
        <button type="button" class="h-switch is-on" id="syncSwitch" role="switch" aria-checked="true" aria-label="Синхронизировать контакты"></button>
      </label>
      <button type="button" class="h-step-cta" id="continueBtn">Продолжить</button>
      ${!invite ? '<button type="button" class="h-step-link" id="staffToggle">Вход для сотрудника CRM</button>' : ''}
      <div id="staffBox" hidden style="margin-top:12px">
        <input id="staffLogin" placeholder="Логин или email" autocomplete="username" />
        <input id="staffPassword" type="password" placeholder="Пароль" autocomplete="current-password" />
        <button type="button" class="h-step-cta" id="staffGo">Войти как сотрудник</button>
      </div>
      <details class="h-pwa">
        <summary>Как установить приложение?</summary>
        <div class="h-pwa-body">
          <div>iPhone: Safari → Поделиться → «На экран Домой».</div>
          <div style="margin-top:8px">Android: <a href="/h/android.html">скачать APK</a></div>
        </div>
      </details>
    `);
    const err = () => document.getElementById('err');
    const setErr = (m) => { const e = err(); if (e) e.textContent = m || ''; };

    const dial = document.getElementById('dialCode');
    document.getElementById('syncSwitch').onclick = (e) => {
      syncContacts = !syncContacts;
      e.currentTarget.classList.toggle('is-on', syncContacts);
      e.currentTarget.setAttribute('aria-checked', syncContacts ? 'true' : 'false');
    };
    document.getElementById('countryBtn').onclick = () => {
      const next = COUNTRIES[(COUNTRIES.indexOf(country) + 1) % COUNTRIES.length];
      country = next;
      const btn = document.getElementById('countryBtn');
      btn.innerHTML = `<span class="flag">${country.flag}</span><span>${esc(country.name)}</span><span class="chev">›</span>`;
      dial.textContent = country.dial;
    };
    const phoneFull = () => {
      const raw = (document.getElementById('phone').value || '').replace(/\D/g, '');
      const cc = country.dial.replace(/\D/g, '');
      const local = raw.startsWith(cc) ? raw.slice(cc.length) : raw;
      return country.dial + local;
    };

    const continueBtn = document.getElementById('continueBtn');
    continueBtn.onclick = () => {
      const full = phoneFull();
      const digits = full.replace(/\D/g, '');
      if (digits.length < (country.dial.replace(/\D/g, '').length + country.len - 1)) { setErr('Введите номер полностью'); return; }
      lastPhoneFull = full;
      openConfirm(full);
    };
    const toEmail = document.getElementById('toEmail');
    if (toEmail) toEmail.onclick = () => renderEmailStep();
    const staffToggle = document.getElementById('staffToggle');
    if (staffToggle) staffToggle.onclick = () => { const b = document.getElementById('staffBox'); b.hidden = !b.hidden; };
    const staffGo = document.getElementById('staffGo');
    if (staffGo) staffGo.onclick = () => doStaffLogin();
    wireThemeToggle();

    /** Confirm-number modal (TG: «Правильно ли указан номер?»). */
    function openConfirm(full) {
      const m = document.createElement('div');
      m.className = 'h-modal-back';
      m.innerHTML = `<div class="h-modal">
        <p class="h-modal-num">${esc(full)}</p>
        <p class="h-modal-q">Правильно ли указан номер?</p>
        <button type="button" class="h-modal-change" id="mChange">Изменить</button>
        <button type="button" class="h-step-cta" id="mOk">Продолжить</button>
      </div>`;
      document.body.appendChild(m);
      m.querySelector('#mChange').onclick = () => m.remove();
      m.querySelector('#mOk').onclick = async () => {
        m.remove();
        if (inviteToken) await acceptInviteThenCode(full);
        else await sendCodeThenCodeStep(full);
      };
    }

    async function sendCodeThenCodeStep(full) {
      setErr('');
      try {
        const res = await fetch('/api/chat-groups/auth/request-code', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: full })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось отправить код');
        renderCodeStep(full, !data.sent ? (data.error || 'SMS не ушла — попробуйте ссылку на почту') : '');
      } catch (e) { setErr(e.message); }
    }

    async function acceptInviteThenCode(full) {
      const name = (document.getElementById('name') && document.getElementById('name').value || '').trim();
      if (!name || name.length < 2) { setErr('Укажите имя'); return; }
      setErr('');
      try {
        const acc = await fetch('/api/chat-groups/invites/' + encodeURIComponent(inviteToken) + '/accept', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone: full })
        });
        const accData = await acc.json();
        if (!acc.ok) throw new Error(accData.error || 'Не удалось принять приглашение');
        const req = await fetch('/api/chat-groups/auth/request-code', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: full })
        });
        const reqData = await req.json();
        renderCodeStep(full, (!req.ok || !reqData.sent) ? ((reqData && reqData.error) || 'SMS не ушла') : '');
      } catch (e) { setErr(e.message); }
    }

    void lastPhoneFull;
    void syncContacts;
    if (inviteToken) {
      // Invite keeps the same step flow; accept happens on «Продолжить».
    }
  }

  /** 6-cell code step (SMS). */
  function renderCodeStep(phone, warn) {
    const cells = Array.from({ length: 6 }, (_, i) =>
      `<input class="h-code-cell" inputmode="numeric" maxlength="1" data-cell="${i}" ${i === 0 ? 'autofocus' : ''} />`).join('');
    stepShell(`
      <div class="h-step-top"><button type="button" class="h-step-cancel" id="back">Назад</button></div>
      <div class="h-step-art" aria-hidden="true">💬</div>
      <h1 class="h-step-title">Введите код</h1>
      <p class="h-step-sub">Мы отправили SMS с кодом проверки на ${esc(phone)}.</p>
      <div class="h-err" id="err">${warn ? esc(warn) : ''}</div>
      <div class="h-code-cells" id="cells">${cells}</div>
      <button type="button" class="h-step-cta" id="verify" disabled>Продолжить</button>
      <button type="button" class="h-step-link" id="again">Отправить код ещё раз</button>
    `);
    const inputs = Array.from(document.querySelectorAll('.h-code-cell'));
    const verify = document.getElementById('verify');
    const read = () => inputs.map((i) => i.value.replace(/\D/g, '')).join('');
    const refresh = () => { verify.disabled = read().length !== 6; };
    inputs.forEach((inp, idx) => {
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/\D/g, '').slice(0, 1);
        if (inp.value && idx < 5) inputs[idx + 1].focus();
        refresh();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !inp.value && idx > 0) inputs[idx - 1].focus();
      });
      inp.addEventListener('paste', (e) => {
        const txt = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
        if (!txt) return;
        e.preventDefault();
        txt.split('').forEach((ch, i) => { if (inputs[i]) inputs[i].value = ch; });
        inputs[Math.min(txt.length, 5)].focus();
        refresh();
      });
    });
    document.getElementById('back').onclick = () => renderLogin({ invite: inviteToken ? { inviter_name: '' } : null });
    document.getElementById('again').onclick = async () => {
      try {
        await fetch('/api/chat-groups/auth/request-code', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone })
        });
      } catch (_) {}
    };
    verify.onclick = async () => {
      const e = document.getElementById('err');
      e.textContent = '';
      try {
        const res = await fetch('/api/chat-groups/auth/verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, code: read() })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось войти');
        saveSessionAndBoot(data, inviteToken && !token());
      } catch (ex) { e.textContent = ex.message; }
    };
  }

  /** Email step: «Укажите почту для входа» → «Проверьте почту». */
  function renderEmailStep() {
    stepShell(`
      <div class="h-step-top"><button type="button" class="h-step-cancel" id="back">Назад</button></div>
      <div class="h-step-art" aria-hidden="true">📫</div>
      <h1 class="h-step-title">Укажите почту для входа</h1>
      <p class="h-step-sub">Вы будете получать коды для входа в АСГАРД Хугинн на адрес электронной почты, а не через SMS.</p>
      <div class="h-err" id="err"></div>
      <input id="email" type="email" inputmode="email" placeholder="Email" autocomplete="email" />
      <button type="button" class="h-step-cta" id="sendEmail">Продолжить</button>
    `);
    document.getElementById('back').onclick = () => renderLogin({});
    document.getElementById('sendEmail').onclick = async () => {
      const email = (document.getElementById('email').value || '').trim();
      const e = document.getElementById('err');
      e.textContent = '';
      if (!email) { e.textContent = 'Укажите email'; return; }
      try {
        const res = await fetch('/api/chat-groups/auth/request-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось отправить ссылку');
        renderEmailCheck(email);
      } catch (ex) { e.textContent = ex.message; }
    };
  }

  /** «Проверьте почту» + 6 ячеек (код из письма). */
  function renderEmailCheck(email) {
    const cells = Array.from({ length: 6 }, (_, i) =>
      `<input class="h-code-cell" inputmode="numeric" maxlength="1" data-cell="${i}" ${i === 0 ? 'autofocus' : ''} />`).join('');
    stepShell(`
      <div class="h-step-top"><button type="button" class="h-step-cancel" id="back">Назад</button></div>
      <div class="h-step-art" aria-hidden="true">📧</div>
      <h1 class="h-step-title">Проверьте почту</h1>
      <p class="h-step-sub">Введите код, который пришёл на ${esc(email)}.</p>
      <div class="h-err" id="err"></div>
      <div class="h-code-cells" id="cells">${cells}</div>
      <button type="button" class="h-step-link" id="again">Отправить ссылку ещё раз</button>
    `);
    const inputs = Array.from(document.querySelectorAll('.h-code-cell'));
    const read = () => inputs.map((i) => i.value.replace(/\D/g, '')).join('');
    inputs.forEach((inp, idx) => {
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/\D/g, '').slice(0, 1);
        if (inp.value && idx < 5) inputs[idx + 1].focus();
        if (read().length === 6) submit();
      });
    });
    document.getElementById('back').onclick = () => renderEmailStep();
    document.getElementById('again').onclick = async () => {
      try { await fetch('/api/chat-groups/auth/request-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); } catch (_) {}
    };
    async function submit() {
      const e = document.getElementById('err');
      e.textContent = '';
      try {
        const res = await fetch('/api/chat-groups/auth/verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code: read() })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Неверный код');
        saveSessionAndBoot(data, true);
      } catch (ex) { e.textContent = ex.message; }
    }
  }

  function saveSessionAndBoot(data, cleanUrl) {
    localStorage.setItem('asgard_token', data.token);
    localStorage.setItem('asgard_user', JSON.stringify(data.user || {}));
    if (cleanUrl) history.replaceState({}, '', '/h/');
    bootApp(data.chat_id);
  }


  async function loadInvite() {
    if (!inviteToken) return null;
    const res = await fetch('/api/chat-groups/invites/' + encodeURIComponent(inviteToken));
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      app.innerHTML = `<div class="h-login"><div class="h-logo">${logoSvg()}</div><h1>Хугинн</h1><p>${err.error || 'Приглашение недействительно'}</p>${themeToggleHtml()}</div>`;
      wireThemeToggle();
      return null;
    }
    const data = await res.json();
    return data.invite;
  }

  async function doStaffLogin() {
    const login = document.getElementById('staffLogin').value.trim();
    const password = document.getElementById('staffPassword').value;
    const err = document.getElementById('err');
    err.textContent = '';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка входа');
      // Staff tokens can be gated by PIN (auth.js returns need_pin). Ask for the
      // PIN right here instead of dumping the user into the CRM.
      if (data.status === 'need_pin') {
        localStorage.setItem('asgard_token', data.token || '');
        localStorage.setItem('asgard_user', JSON.stringify(data.user || {}));
        renderPinStep(data.token || '');
        return;
      }
      // First login with a temp password: password change lives in the full CRM.
      if (data.status === 'need_setup') {
        localStorage.setItem('asgard_token', data.token || '');
        localStorage.setItem('asgard_user', JSON.stringify(data.user || {}));
        app.innerHTML = `<div class="h-login"><div class="h-logo" aria-hidden="true">${logoSvg()}</div>
          <h1>Нужно сменить пароль</h1>
          <p>Первый вход: задайте новый пароль и PIN в CRM, затем вернитесь в Хугинн.</p>
          <div class="h-err" id="err"></div>
          <button type="button" id="toCrm">Открыть CRM</button></div>`;
        document.getElementById('toCrm').onclick = () => { location.href = '/'; };
        return;
      }
      saveSessionAndBoot(data, false);
    } catch (e) {
      err.textContent = e.message;
    }
  }

  /** PIN step inside /h/ (uses the existing /api/auth/verify-pin). */
  function renderPinStep(tempToken) {
    app.innerHTML = `
      <div class="h-login">
        <div class="h-logo" aria-hidden="true">${logoSvg()}</div>
        <h1>Хугинн</h1>
        <p>Введите PIN сотрудника</p>
        <div class="h-err" id="err"></div>
        <input id="staffPin" inputmode="numeric" autocomplete="one-time-code" placeholder="PIN" />
        <button type="button" id="staffPinGo">Войти</button>
      </div>`;
    const go = async () => {
      const pin = (document.getElementById('staffPin').value || '').trim();
      const err = document.getElementById('err');
      err.textContent = '';
      if (!pin) { err.textContent = 'Введите PIN'; return; }
      try {
        const res = await fetch('/api/auth/verify-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tempToken },
          body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Неверный PIN');
        saveSessionAndBoot(data, true);
      } catch (e) { err.textContent = e.message; }
    };
    document.getElementById('staffPinGo').onclick = go;
    document.getElementById('staffPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  /** Deep link from the login email: /h/?login=<token>. */
  async function tryLoginToken() {
    let loginToken = '';
    try { loginToken = new URLSearchParams(location.search).get('login') || ''; } catch (_) {}
    if (!loginToken) return false;
    try {
      const res = await fetch('/api/chat-groups/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: loginToken })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ссылка недействительна');
      saveSessionAndBoot(data, true);
      return true;
    } catch (e) {
      app.innerHTML = `<div class="h-login"><div class="h-logo">${logoSvg()}</div><h1>Хугинн</h1><p>${e.message}</p>${themeToggleHtml()}</div>`;
      wireThemeToggle();
      return true;
    }
  }

  async function bootApp(openChatId) {
    app.innerHTML = `
      <div class="h-top">
        <h1>Хугинн</h1>
        <button type="button" class="h-icon" id="dl" title="Android" aria-label="Android">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>
        </button>
        <button type="button" class="h-icon" id="out" title="Выйти" aria-label="Выйти">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
        </button>
      </div>
      <div class="h-main"><div id="hgHost"></div></div>`;
    document.getElementById('out').onclick = () => {
      localStorage.removeItem('asgard_token');
      localStorage.removeItem('asgard_user');
      location.href = '/h/';
    };
    document.getElementById('dl').onclick = () => { location.href = '/h/android.html'; };

    document.body.dataset.huginnAutostart = '0';
    await HuginnDock.mount();
    const chrome = document.getElementById('huginnDock');
    const host = document.getElementById('hgHost');
    if (chrome && host) host.appendChild(chrome);
    HuginnDock.open();
    // Calls: mount the LiveKit call UI (was desktop-only; /h/ had no calls at all).
    if (window.HuginnCall && typeof window.HuginnCall.mount === 'function') {
      try { window.HuginnCall.mount(); } catch (_) {}
    }
    handleCallDeepLink();
    if (openChatId) HuginnDock.openChat(openChatId);

    if (window.HuginnSSE && typeof window.HuginnSSE.on === 'function') {
      window.HuginnSSE.on('call:incoming', () => handleCallDeepLink());
    }
    navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', (ev) => {
      const d = ev.data || {};
      if (d.type === 'NOTIFICATION_CLICK' && d.url) {
        const cu = new URL(d.url, location.origin);
        const callId = cu.searchParams.get('call');
        if (callId) {
          try { history.replaceState({}, '', '/h/?call=' + encodeURIComponent(callId)); } catch (_) {}
          handleCallDeepLink();
        } else {
          const m = cu.searchParams.get('chat');
          if (m) HuginnDock.openChat(Number(m));
        }
      }
      if (d.type === 'PUSH_RESUBSCRIBE') subscribePush();
    });

    if ('Notification' in window && Notification.permission === 'default') {
      setTimeout(() => Notification.requestPermission().then(() => subscribePush()).catch(() => {}), 1500);
    } else {
      subscribePush();
    }
  }

  /**
   * Register this device for web-push. Without it /h/ users never receive
   * Huginn chat or call notifications (the server has nowhere to send).
   */
  async function subscribePush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      if (Notification.permission !== 'granted') return;
      const reg = await navigator.serviceWorker.ready;
      const keyRes = await fetch('/api/push/vapid-key');
      const keyData = await keyRes.json().catch(() => ({}));
      const publicKey = keyData && keyData.publicKey;
      if (!publicKey) return;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token()
        },
        body: JSON.stringify({
          endpoint: sub.toJSON ? sub.toJSON() : sub,
          device_info: navigator.userAgent.slice(0, 200)
        })
      });
    } catch (_) { /* push is best-effort */ }
  }

  /** Deep link from a call push: /h/?call=<id>[&call_action=accept|decline].
   *  HuginnCall.initFromUrl() owns the ?call= parsing (ringing/accept/decline/active). */
  function handleCallDeepLink() {
    if (!window.HuginnCall || typeof window.HuginnCall.initFromUrl !== 'function') return;
    try { window.HuginnCall.initFromUrl(); } catch (_) {}
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function main() {
    if (await tryLoginToken()) return;
    if (token() && !inviteToken) {
      bootApp();
      return;
    }
    const invite = await loadInvite();
    if (inviteToken && !invite) return;
    renderLogin({ invite });
  }

  main();
})();
