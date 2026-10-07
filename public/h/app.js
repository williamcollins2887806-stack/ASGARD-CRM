(function () {
  'use strict';

  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const inviteToken = params.get('invite') || '';

  function token() { return localStorage.getItem('asgard_token') || ''; }

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

  function renderLogin(opts) {
    const invite = opts && opts.invite;
    app.innerHTML = `
      <div class="h-login">
        <div class="h-logo" aria-hidden="true">${logoSvg()}</div>
        <h1>Хугинн</h1>
        <p>${invite
          ? ('Приглашение от ' + (invite.inviter_name || 'сотрудника') + '. Подтвердите телефон — код придёт в SMS.')
          : 'Войдите по коду из SMS или ссылке на почту. Пароль не нужен.'}</p>
        <div class="h-err" id="err"></div>
        ${invite ? `<input id="name" placeholder="Ваше имя" autocomplete="name" />` : ''}
        <input id="phone" type="tel" inputmode="tel" placeholder="Телефон" autocomplete="tel" value="${invite && invite.phone ? invite.phone : ''}" />
        <button type="button" id="sendCode">Получить код в SMS</button>
        <div class="h-code-row" id="codeRow" hidden>
          <input id="code" inputmode="numeric" placeholder="Код из SMS" autocomplete="one-time-code" />
          <button type="button" id="verifyCode">Войти</button>
        </div>
        <div class="h-or"><span>или</span></div>
        <input id="email" type="email" inputmode="email" placeholder="Email — пришлём ссылку для входа" autocomplete="email" />
        <button type="button" id="sendLink">Прислать ссылку на почту</button>
        ${!invite ? '<button type="button" id="staffToggle" class="h-link">Вход для сотрудника CRM</button>' : ''}
        <div id="staffBox" hidden>
          <input id="staffLogin" placeholder="Логин или email" autocomplete="username" />
          <input id="staffPassword" type="password" placeholder="Пароль" autocomplete="current-password" />
          <button type="button" id="staffGo">Войти как сотрудник</button>
        </div>
        ${themeToggleHtml()}
        <details class="h-pwa">
          <summary>Как установить приложение?</summary>
          <div class="h-pwa-body">
            <div>iPhone: Safari → Поделиться → «На экран Домой».</div>
            <div style="margin-top:8px">Android: <a href="/h/android.html">скачать APK</a></div>
          </div>
        </details>
      </div>`;
    const err = () => document.getElementById('err');
    const setErr = (m) => { const e = err(); if (e) e.textContent = m || ''; };

    document.getElementById('sendCode').onclick = async () => {
      const phone = document.getElementById('phone').value.trim();
      if (!phone) { setErr('Укажите телефон'); return; }
      const btn = document.getElementById('sendCode');
      btn.disabled = true;
      setErr('');
      try {
        const res = await fetch('/api/chat-groups/auth/request-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось отправить код');
        document.getElementById('codeRow').hidden = false;
        document.getElementById('code').focus();
        btn.textContent = 'Код отправлен';
        if (!data.sent) setErr(data.error || 'SMS не ушла — попробуйте ссылку на почту');
      } catch (e) {
        setErr(e.message);
        btn.disabled = false;
      }
    };

    document.getElementById('verifyCode').onclick = async () => {
      const phone = document.getElementById('phone').value.trim();
      const code = document.getElementById('code').value.trim();
      if (!phone || !code) { setErr('Введите телефон и код'); return; }
      setErr('');
      try {
        const res = await fetch('/api/chat-groups/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone, code: code })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось войти');
        saveSessionAndBoot(data, inviteToken && !token());
      } catch (e) {
        setErr(e.message);
      }
    };

    document.getElementById('sendLink').onclick = async () => {
      const email = document.getElementById('email').value.trim();
      if (!email) { setErr('Укажите email'); return; }
      setErr('');
      try {
        const res = await fetch('/api/chat-groups/auth/request-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось отправить ссылку');
        setErr('Если адрес приглашён, ссылка отправлена. Проверьте почту.');
      } catch (e) {
        setErr(e.message);
      }
    };

    const staffToggle = document.getElementById('staffToggle');
    if (staffToggle) staffToggle.onclick = () => {
      const box = document.getElementById('staffBox');
      box.hidden = !box.hidden;
    };
    const staffGo = document.getElementById('staffGo');
    if (staffGo) staffGo.onclick = () => doStaffLogin();

    if (inviteToken) {
      // Invitation: entering a code grants access right away, so create the guest
      // record first (passwordless) and then continue to verification.
      wireInviteAccept();
    }
    wireThemeToggle();
  }

  /** Create the guest from the invite (no password), then show SMS verification. */
  function wireInviteAccept() {
    const sendBtn = document.getElementById('sendCode');
    sendBtn.onclick = async () => {
      const name = (document.getElementById('name') && document.getElementById('name').value || '').trim();
      const phone = document.getElementById('phone').value.trim();
      const err = document.getElementById('err');
      err.textContent = '';
      if (!name || name.length < 2) { err.textContent = 'Укажите имя'; return; }
      if (!phone) { err.textContent = 'Укажите телефон'; return; }
      sendBtn.disabled = true;
      try {
        const acc = await fetch('/api/chat-groups/invites/' + encodeURIComponent(inviteToken) + '/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, phone: phone })
        });
        const accData = await acc.json();
        if (!acc.ok) throw new Error(accData.error || 'Не удалось принять приглашение');
        // не логинимся сразу — просим подтвердить телефон кодом
        const req = await fetch('/api/chat-groups/auth/request-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone })
        });
        const reqData = await req.json();
        document.getElementById('codeRow').hidden = false;
        document.getElementById('code').focus();
        sendBtn.textContent = 'Код отправлен';
        if (!req.ok || !reqData.sent) {
          err.textContent = (reqData && reqData.error) || 'SMS не ушла — войдите позже по почте';
        }
      } catch (e) {
        err.textContent = e.message;
        sendBtn.disabled = false;
      }
    };
    document.getElementById('verifyCode').onclick = async () => {
      const phone = document.getElementById('phone').value.trim();
      const code = document.getElementById('code').value.trim();
      const err = document.getElementById('err');
      err.textContent = '';
      try {
        const res = await fetch('/api/chat-groups/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone, code: code })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось войти');
        saveSessionAndBoot(data, true);
      } catch (e) {
        err.textContent = e.message;
      }
    };
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
      saveSessionAndBoot(data, false);
    } catch (e) {
      err.textContent = e.message;
    }
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
    if (openChatId) HuginnDock.openChat(openChatId);

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
