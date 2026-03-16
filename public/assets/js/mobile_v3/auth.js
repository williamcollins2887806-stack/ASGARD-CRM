/* ================================================================
 *  ASGARD CRM Mobile v3 — Auth Pages (v3.1.0)
 *  WelcomePage  #/welcome
 *  LoginPage    #/login   (3 stages: credentials → setupPin → quickPin)
 *  RegisterPage #/register (stub → redirect)
 * ================================================================ */
(function () {
'use strict';

const el = Utils.el;
const vibrate = ms => navigator.vibrate && navigator.vibrate(ms || 10);

/* ---------- PIN hash (client-side only, SHA-256) ---------- */
async function hashPin(pin) {
  const data = new TextEncoder().encode('asgard_pin_salt_' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return 'ph2_' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- AsgardAuth fallback (if desktop auth.js not loaded) ---------- */
async function authLoginStep1({ login, password }) {
  if (typeof AsgardAuth !== 'undefined' && AsgardAuth.loginStep1) {
    return AsgardAuth.loginStep1({ login, password });
  }
  return API.fetch('/auth/login', { method: 'POST', body: { login, password }, noCache: true });
}

function authGetAuth() {
  if (typeof AsgardAuth !== 'undefined' && AsgardAuth.getAuth) {
    return AsgardAuth.getAuth();
  }
  const token = localStorage.getItem('auth_token');
  const userStr = localStorage.getItem('asgard_mobile_state');
  try { const s = JSON.parse(userStr || '{}'); return { token, user: s.user }; } catch (_) {}
  return { token, user: null };
}

async function authVerifyPin(opts) {
  if (typeof AsgardAuth !== 'undefined' && AsgardAuth.verifyPin) {
    return AsgardAuth.verifyPin(opts);
  }
  return API.fetch('/auth/verify-pin', { method: 'POST', body: opts, noCache: true });
}

/* ---------- SVG assets ---------- */
const ICONS = {
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>',
  eye: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><path d="M9.88 9.88a3 3 0 104.24 4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  fingerprint: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 018 4"/><path d="M5 19.5C5.5 18 6 15 6 12c0-3.3 2.7-6 6-6 1.8 0 3.4.8 4.5 2"/><path d="M12 10a2 2 0 00-2 2c0 3-1 5.5-2.5 7.5"/><path d="M12 10a2 2 0 012 2c0 2.5-.5 5-1.5 7"/><path d="M18 15c-.3 2-1 4-2 5.5"/><path d="M22 12c0 1-.3 2.5-.7 4"/></svg>',
  backspace: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>',
};

/* ================================================================
 *  WELCOME PAGE — Heroic landing
 * ================================================================ */
const WelcomePage = {
  async render() {
    /* redirect if authenticated */
    if (Store.get('user')) { Router.navigate('/home', { replace: true }); return el('div'); }

    const page = el('div', { className: 'auth-welcome' });
    Object.assign(page.style, {
      position: 'fixed', inset: '0', zIndex: '9999',
      background: 'var(--hero-grad)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    });

    /* ---- floating runes layer ---- */
    const runes = 'ᚨᚱᚦᚹᛏᛒᛗᚠᚢᚲᚷᛁᛃᛇᛈᛉᛊᛚᛞᛟ'.split('');
    const runesLayer = el('div', { className: 'welcome-runes' });
    for (let i = 0; i < 20; i++) {
      const r = el('span', { className: 'welcome-rune' });
      r.textContent = runes[i % runes.length];
      Object.assign(r.style, {
        left: Math.random() * 100 + '%',
        top:  Math.random() * 100 + '%',
        fontSize: (18 + Math.random() * 36) + 'px',
        animationDelay:    (Math.random() * 10) + 's',
        animationDuration: (14 + Math.random() * 10) + 's',
      });
      runesLayer.appendChild(r);
    }
    page.appendChild(runesLayer);

    /* ---- center content ---- */
    const center = el('div', { className: 'welcome-center' });
    Object.assign(center.style, {
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
      opacity: '0', transform: 'scale(0.5)',
      transition: 'all 0.9s cubic-bezier(0.34,1.56,0.64,1)',
    });

    /* shield logo */
    const shield = el('div');
    shield.innerHTML = [
      '<svg viewBox="0 0 80 96" width="80" height="96" fill="none">',
        '<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">',
          '<stop offset="0%" stop-color="rgba(255,255,255,0.45)"/>',
          '<stop offset="100%" stop-color="rgba(255,255,255,0.1)"/>',
        '</linearGradient></defs>',
        '<path d="M40 4L76 20V56Q76 78 40 92Q4 78 4 56V20Z" stroke="url(#sg)" stroke-width="1.5" fill="rgba(255,255,255,0.06)"/>',
        '<text x="40" y="60" text-anchor="middle" fill="white" font-size="38" font-weight="800" ',
          'font-family="-apple-system,system-ui,sans-serif">ᚨ</text>',
      '</svg>',
    ].join('');
    center.appendChild(shield);

    /* title */
    const title = el('h1', { className: 'welcome-title' });
    title.textContent = 'ASGARD';
    Object.assign(title.style, {
      ...DS.font('hero'), color: '#fff', letterSpacing: '6px', margin: '0',
      opacity: '0', transform: 'translateY(24px)',
      transition: 'all 0.7s ease 0.35s',
    });
    center.appendChild(title);

    /* subtitle */
    const sub = el('p');
    sub.textContent = 'Система управления';
    Object.assign(sub.style, {
      ...DS.font('sm'), color: 'rgba(255,255,255,0.55)', margin: '0',
      letterSpacing: '3px', textTransform: 'uppercase',
      opacity: '0', transform: 'translateY(24px)',
      transition: 'all 0.7s ease 0.55s',
    });
    center.appendChild(sub);
    page.appendChild(center);

    /* ---- bottom buttons ---- */
    const btns = el('div', { className: 'welcome-buttons' });
    Object.assign(btns.style, {
      position: 'absolute', bottom: '0', left: '0', right: '0',
      padding: '0 28px env(safe-area-inset-bottom, 44px)',
      paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 44px)',
      display: 'flex', flexDirection: 'column', gap: '12px',
      opacity: '0', transform: 'translateY(32px)',
      transition: 'all 0.7s ease 0.75s',
    });

    const mkBtn = (label, primary, onClick) => {
      const b = el('button', { className: 'welcome-btn' });
      b.textContent = label;
      Object.assign(b.style, {
        width: '100%', padding: '17px', borderRadius: DS.radius.xl + 'px',
        ...DS.font('md'), cursor: 'pointer',
        transition: 'all 0.2s ease', border: 'none',
        WebkitTapHighlightColor: 'transparent',
        background: primary ? 'rgba(255,255,255,0.18)' : 'transparent',
        backdropFilter: primary ? 'blur(24px)' : 'none',
        WebkitBackdropFilter: primary ? 'blur(24px)' : 'none',
        color: primary ? '#fff' : 'rgba(255,255,255,0.65)',
        boxShadow: primary ? '0 2px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.2)' : 'none',
        borderWidth: '1px', borderStyle: 'solid',
        borderColor: primary ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
      });
      b.addEventListener('click', () => { vibrate(); onClick(); });
      b.addEventListener('touchstart', () => { b.style.transform = 'scale(0.97)'; b.style.opacity = '0.85'; }, { passive: true });
      b.addEventListener('touchend',   () => { b.style.transform = ''; b.style.opacity = ''; }, { passive: true });
      return b;
    };

    btns.appendChild(mkBtn('Войти', true, () => Router.navigate('/login')));
    btns.appendChild(mkBtn('\u041e\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443', false, () => Router.navigate('/register')));
    btns.appendChild(mkBtn('О системе', false, () =>
      M.Toast({ message: 'ASGARD CRM — Корпоративная система управления проектами', type: 'info' })
    ));
    page.appendChild(btns);

    /* ---- trigger entrance animations ---- */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      center.style.opacity   = '1'; center.style.transform = 'scale(1)';
      title.style.opacity    = '1'; title.style.transform  = 'translateY(0)';
      sub.style.opacity      = '1'; sub.style.transform    = 'translateY(0)';
      btns.style.opacity     = '1'; btns.style.transform   = 'translateY(0)';
    }));

    return page;
  },
};

/* ================================================================
 *  LOGIN PAGE — 3-stage auth flow
 * ================================================================ */
const LoginPage = {
  async render() {
    if (Store.get('user')) { Router.navigate('/home', { replace: true }); return el('div'); }

    const lastUser = JSON.parse(localStorage.getItem('asgard_last_user') || 'null');
    const pinKey   = lastUser ? 'asgard_pin_' + lastUser.id : null;
    const hasPin   = pinKey && localStorage.getItem(pinKey);

    /* returning user with PIN → quick login; otherwise credentials */
    const stage = (lastUser && hasPin) ? 'quickPin' : 'credentials';
    return LoginPage._stage(stage, { lastUser });
  },

  /* ---- stage dispatcher ---- */
  _stage(name, ctx) {
    const builders = {
      credentials: ()  => LoginPage._credentials(),
      setupPin:    ()  => LoginPage._pinScreen({
        title: 'Установите PIN-код', subtitle: 'Для быстрого входа в приложение',
        onComplete: pin => LoginPage._goto('confirmPin', { ...ctx, firstPin: pin }),
      }),
      confirmPin:  ()  => LoginPage._pinScreen({
        title: 'Подтвердите PIN-код', subtitle: 'Введите PIN-код повторно',
        onComplete: async pin => {
          if (pin === ctx.firstPin) {
            localStorage.setItem('asgard_pin_' + ctx.user.id, await hashPin(pin));
            M.Toast({ message: 'PIN-код установлен', type: 'success' });
            Router.navigate('/home', { replace: true });
          } else {
            M.Toast({ message: 'PIN-коды не совпадают. Попробуйте снова', type: 'danger' });
            LoginPage._goto('setupPin', ctx);
          }
        },
      }),
      serverPin:   ()  => LoginPage._pinScreen({
        title: ctx.userName || 'Подтвердите PIN-код', subtitle: 'Введите ваш PIN-код',
        avatar: ctx.user,
        showAlt: true,
        onComplete: async pin => {
          const result = await authVerifyPin({ userId: ctx.userId, pin, remember: true });
          const auth = authGetAuth();
          const user = auth?.user || result?.user || ctx.user;
          if (user) {
            Store.set('user', { ...user, token: auth?.token || result?.token || user.token });
            localStorage.setItem('asgard_last_user', JSON.stringify({
              id: user.id,
              login: user.login,
              name: user.name || user.full_name || user.login,
              avatar: user.avatar,
              role: user.role,
            }));
            const pinKey = 'asgard_pin_' + user.id;
            if (!localStorage.getItem(pinKey)) {
              localStorage.setItem(pinKey, await hashPin(pin));
            }
          }
          M.Toast({ message: 'PIN-код подтвержден', type: 'success' });
          Router.navigate('/home', { replace: true });
        },
        onAlt: () => LoginPage._goto('credentials', {}),
      }),
      quickPin:    ()  => LoginPage._pinScreen({
        title: ctx.lastUser?.name || 'Вход',
        subtitle: 'Введите PIN-код',
        avatar: ctx.lastUser,
        showBio: !!(window.AsgardWebAuthn && window.PublicKeyCredential && window.isSecureContext),
        showAlt: true,
        onComplete: async pin => {
          const stored = localStorage.getItem('asgard_pin_' + ctx.lastUser?.id);
          if (!stored || stored !== await hashPin(pin)) {
            M.Toast({ message: 'Неверный PIN-код', type: 'danger' }); vibrate(100);
            return;
          }
          // Сразу навигируем — dashboard покажет скелетоны, refresh сессии в фоне
          Router.navigate('/home', { replace: true });
          try {
            const res = await API.fetch('/auth/session', { noCache: true });
            if (res?.user) { Store.set('user', res.user); }
          } catch { /* сессия истекла — guard перенаправит */ }
        },
        onAlt: () => LoginPage._goto('credentials', {}),
      }),
    };
    return (builders[name] || builders.credentials)();
  },

  /* ---- cross-fade between stages ---- */
  _goto(stage, ctx) {
    const zone = Layout.getContentZone();
    const old  = zone.firstChild;
    if (old) {
      old.style.transition = 'all 0.3s ease';
      old.style.opacity    = '0';
      old.style.transform  = 'translateX(-24px)';
    }
    setTimeout(() => {
      zone.innerHTML = '';
      zone.appendChild(LoginPage._stage(stage, ctx));
    }, old ? 300 : 0);
  },

  /* ============================================================
   *  Stage 1 — Credentials (login + password)
   * ============================================================ */
  _credentials() {
    const page = el('div', { className: 'auth-credentials' });
    Object.assign(page.style, {
      position: 'fixed', inset: '0', zIndex: '9999',
      background: 'var(--hero-grad)',
      display: 'flex', flexDirection: 'column',
      padding: DS.spacing.page + 'px', paddingTop: '60px',
      overflow: 'auto',
    });

    /* back */
    const back = el('button', { className: 'auth-back-btn' });
    back.innerHTML = ICONS.back;
    back.style.color = DS.t.text;
    Object.assign(back.style, {
      position: 'absolute', top: '16px', left: '12px',
      background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.16)', padding: '10px',
      cursor: 'pointer', borderRadius: '50%', lineHeight: '0', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
    });
    back.addEventListener('click', () => Router.navigate('/welcome'));
    page.appendChild(back);

    /* header */
    const hdr = el('div');
    hdr.style.cssText = 'margin-bottom:20px;padding:22px 20px 18px;border-radius:28px;background:rgba(8,17,38,0.18);border:1px solid rgba(255,255,255,0.14);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);box-shadow:0 18px 44px rgba(2,6,23,0.18)';

    const h1 = el('h1');
    h1.textContent = 'Вход в систему';
    Object.assign(h1.style, { ...DS.font('xl'), color: '#FFFFFF', margin: '0 0 6px' });
    hdr.appendChild(h1);

    const desc = el('p');
    desc.textContent = 'Введите данные вашего аккаунта';
    Object.assign(desc.style, { ...DS.font('base'), color: 'rgba(255,255,255,0.72)', margin: '0' });
    hdr.appendChild(desc);
    page.appendChild(hdr);

    /* form */
    const form = el('form', { className: 'auth-form' });
    form.addEventListener('submit', e => e.preventDefault());
    Object.assign(form.style, {
      display: 'flex', flexDirection: 'column', gap: '20px', flex: '1',
      background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(255,255,255,0.5)', borderRadius: '28px',
      padding: '22px 18px 18px', boxShadow: '0 24px 52px rgba(3,9,24,0.16)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)'
    });

    /* login field */
    const loginF = LoginPage._field('Логин или email', 'text', 'username', true);
    form.appendChild(loginF.wrap);

    /* password field + toggle */
    const passF = LoginPage._field('Пароль', 'password', 'current-password', false);
    passF.wrap.style.position = 'relative';
    let passVis = false;
    const toggle = el('button', { type: 'button' });
    toggle.innerHTML = ICONS.eye;
    toggle.style.color = DS.t.textSec;
    Object.assign(toggle.style, {
      position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
      background: 'none', border: 'none', padding: '6px', cursor: 'pointer', lineHeight: '0',
    });
    toggle.addEventListener('click', () => {
      passVis = !passVis;
      passF.input.type  = passVis ? 'text' : 'password';
      toggle.innerHTML   = passVis ? ICONS.eyeOff : ICONS.eye;
      toggle.style.color = DS.t.textSec;
    });
    passF.wrap.appendChild(toggle);
    passF.input.style.paddingRight = '48px';
    form.appendChild(passF.wrap);

    /* error box */
    const errBox = el('div', { className: 'auth-error' });
    Object.assign(errBox.style, { ...DS.font('sm'), color: DS.t.red, minHeight: '18px' });
    form.appendChild(errBox);

    /* spacer */
    const spacer = el('div'); spacer.style.flex = '1'; spacer.style.minHeight = '32px';
    form.appendChild(spacer);

    /* submit */
    const btn = M.FullWidthBtn({
      label: 'Войти', variant: 'primary',
      onClick: async () => {
        const login    = loginF.input.value.trim();
        const password = passF.input.value;
        if (!login || !password) {
          errBox.textContent = 'Заполните все поля';
          LoginPage._shake(form); return;
        }

        btn.setLoading(true); errBox.textContent = '';

        try {
          const res = await authLoginStep1({ login, password });
          const auth = authGetAuth();
          const user = auth?.user || res?.user;
          if (!user && res?.status !== 'need_setup' && res?.status !== 'need_pin') {
            throw new Error('Ошибка авторизации');
          }

          if (user) {
            Store.set('user', { ...user, token: auth?.token || user.token });
            localStorage.setItem('asgard_last_user', JSON.stringify({
              id: user.id,
              login: user.login,
              name: user.name || user.full_name || user.login,
              avatar: user.avatar,
              role: user.role,
            }));
          }

          if (res?.status === 'need_pin') {
            LoginPage._goto('serverPin', { userId: res.userId || user?.id, userName: res.userName || user?.name, user });
          } else if (res?.status === 'need_setup') {
            const targetUser = user || { id: res.userId, name: res.userName };
            LoginPage._goto('setupPin', { user: targetUser });
          } else {
            const pinKey = user ? ('asgard_pin_' + user.id) : null;
            if (pinKey && !localStorage.getItem(pinKey)) {
              LoginPage._goto('setupPin', { user });
            } else {
              Router.navigate('/home', { replace: true });
            }
          }
        } catch (err) {
          btn.setLoading(false);
          errBox.textContent = 'Неверный логин или пароль';
          LoginPage._shake(form);
          M.Toast({ message: 'Ошибка входа', type: 'danger' });
        }
      },
    });
    form.appendChild(btn);

    /* forgot */
    const forgot = el('button', { type: 'button' });
    forgot.textContent = 'Забыли пароль?';
    Object.assign(forgot.style, {
      ...DS.font('sm'), color: DS.t.textSec, textAlign: 'center',
      background: 'none', border: 'none', padding: '14px', cursor: 'pointer',
    });
    forgot.addEventListener('click', () =>
      M.Toast({ message: 'Обратитесь к администратору для сброса пароля', type: 'info' })
    );
    form.appendChild(forgot);

    const signupHint = el('button', { type: 'button' });
    signupHint.textContent = '\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u0430? \u041e\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443';
    Object.assign(signupHint.style, {
      ...DS.font('sm'), color: DS.t.blue, textAlign: 'center',
      background: 'none', border: 'none', padding: '4px 14px 18px', cursor: 'pointer',
    });
    signupHint.addEventListener('click', () => Router.navigate('/register'));
    form.appendChild(signupHint);

    page.appendChild(form);

    /* entrance */
    page.style.opacity   = '0';
    page.style.transform = 'translateX(30px)';
    page.style.transition = 'all 0.4s cubic-bezier(0.25,0.46,0.45,0.94)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      page.style.opacity   = '1';
      page.style.transform = 'translateX(0)';
    }));

    return page;
  },

  /* ---- floating-label input builder ---- */
  _field(label, type, autocomp, autoFocus) {
    const wrap = el('div', { className: 'auth-field' });
    Object.assign(wrap.style, { position: 'relative' });

    const input = el('input', { type, autocomplete: autocomp });
    if (autoFocus) input.setAttribute('autofocus', '');
    Object.assign(input.style, {
      width: '100%', padding: '22px 16px 10px', boxSizing: 'border-box',
      ...DS.font('base'), color: '#1A1A1F',
      background: 'rgba(255,255,255,0.85)',
      border: '1.5px solid rgba(0,0,0,0.08)',
      borderRadius: DS.radius.md + 'px', outline: 'none',
      transition: 'border-color 0.2s, box-shadow 0.2s',
    });

    const lbl = el('label');
    lbl.textContent = label;
    Object.assign(lbl.style, {
      position: 'absolute', left: '16px', top: '50%',
      transform: 'translateY(-50%)', transformOrigin: 'left center',
      ...DS.font('base'), color: 'rgba(0,0,0,0.45)',
      pointerEvents: 'none', transition: 'all 0.2s ease',
    });

    const up   = () => { lbl.style.cssText += 'top:12px;transform:translateY(0) scale(0.72);color:#1E5A99;'; input.style.borderColor='#1E5A99'; input.style.boxShadow='0 0 0 3px rgba(30,90,153,0.1)'; };
    const down = () => { if (input.value) return; lbl.style.cssText += 'top:50%;transform:translateY(-50%) scale(1);color:rgba(0,0,0,0.45);'; input.style.borderColor = 'rgba(0,0,0,0.08)'; input.style.boxShadow='none'; };
    input.addEventListener('focus', up);
    input.addEventListener('blur', down);

    // Safari autofill detection — float label when autofilled
    input.addEventListener('animationstart', (e) => {
      if (e.animationName === 'onAutoFillStart' || input.matches(':-webkit-autofill')) {
        lbl.style.cssText += 'top:12px;transform:translateY(0) scale(0.72);color:rgba(0,0,0,0.45);';
      }
    });

    wrap.appendChild(input);
    wrap.appendChild(lbl);
    return { wrap, input, lbl };
  },

  _shake(el) {
    vibrate(50);
    el.style.animation = 'authShake 0.45s ease';
    setTimeout(() => el.style.animation = '', 500);
  },

  /* ============================================================
   *  PIN Screen — reusable for setup / confirm / quick login
   * ============================================================ */
  _pinScreen({ title, subtitle, avatar, onComplete, showBio, showAlt, onAlt }) {
    const page = el('div', { className: 'auth-pin-page' });
    Object.assign(page.style, {
      position: 'fixed', inset: '0', zIndex: '9999',
      background: 'var(--hero-grad)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '0 24px', paddingTop: '72px',
      paddingBottom: 'max(env(safe-area-inset-bottom,0px),24px)',
      color: '#fff', overflow: 'auto'
    });

    /* avatar */
    if (avatar) {
      const av = el('div', { className: 'pin-avatar' });
      const initials = (avatar.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      Object.assign(av.style, {
        width: '72px', height: '72px', borderRadius: '50%',
        background: 'var(--hero-grad)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        ...DS.font('xl'), color: '#fff', marginBottom: '16px',
        boxShadow: '0 4px 24px ' + DS.t.blue + '33',
      });
      if (avatar.avatar) {
        av.style.backgroundImage = 'url(' + avatar.avatar + ')';
        av.style.backgroundSize  = 'cover';
        av.textContent = '';
      } else {
        av.textContent = initials;
      }
      page.appendChild(av);
    }

    /* title */
    const h = el('h2');
    h.textContent = title;
    Object.assign(h.style, { ...DS.font('lg'), color: DS.t.text, margin: '0 0 4px', textAlign: 'center' });
    page.appendChild(h);

    /* subtitle */
    const s = el('p');
    s.textContent = subtitle;
    Object.assign(s.style, { ...DS.font('sm'), color: DS.t.textSec, margin: '0 0 36px', textAlign: 'center' });
    page.appendChild(s);

    /* dots */
    const dotsRow = el('div', { className: 'pin-dots' });
    Object.assign(dotsRow.style, { display: 'flex', gap: '18px', marginBottom: '48px' });
    const dots = [];
    for (let i = 0; i < 4; i++) {
      const d = el('div', { className: 'pin-dot' });
      Object.assign(d.style, {
        width: '14px', height: '14px', borderRadius: '50%',
        border: '2px solid ' + DS.t.textSec + '44',
        background: 'transparent',
        transition: 'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',
      });
      dots.push(d);
      dotsRow.appendChild(d);
    }
    page.appendChild(dotsRow);

    /* pin state */
    let pin = '', locked = false;

    const updateDots = () => {
      dots.forEach((d, i) => {
        const on = i < pin.length;
        d.style.background   = on ? DS.t.blue  : 'transparent';
        d.style.borderColor  = on ? DS.t.blue  : DS.t.textSec + '44';
        d.style.transform    = on ? 'scale(1.25)' : 'scale(1)';
        d.style.boxShadow    = on ? '0 0 8px ' + DS.t.blue + '55' : 'none';
      });
    };

    const shakeDotsRow = () => {
      dotsRow.style.animation = 'pinShake 0.45s ease';
      setTimeout(() => dotsRow.style.animation = '', 500);
    };

    const addDigit = d => {
      if (locked || pin.length >= 4) return;
      vibrate(10); pin += d; updateDots();
      if (pin.length === 4) {
        locked = true;
        setTimeout(async () => {
          try { await onComplete(pin); } catch { /* handled inside */ }
          setTimeout(() => { pin = ''; locked = false; updateDots(); }, 350);
        }, 220);
      }
    };
    const delDigit = () => { if (locked || !pin.length) return; vibrate(10); pin = pin.slice(0, -1); updateDots(); };

    /* numpad */
    const pad = el('div', { className: 'pin-numpad' });
    Object.assign(pad.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      width: '244px',
      maxWidth: '244px',
      marginTop: 'auto',
      marginLeft: 'auto',
      marginRight: 'auto',
      flex: '0 0 auto',
    });

    const makeKey = (key) => {
      const btn = el('button', { type: 'button', className: 'pin-key' });
      Object.assign(btn.style, {
        width: '72px', height: '72px', minWidth: '72px', minHeight: '72px', borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent', userSelect: 'none',
        WebkitAppearance: 'none', appearance: 'none', padding: '0', margin: '0',
        transition: 'all 0.12s ease', boxSizing: 'border-box', flex: '0 0 72px'
      });

      if (!key) {
        btn.style.visibility = 'hidden';
      } else if (key === 'bio') {
        btn.innerHTML = ICONS.fingerprint;
        btn.style.color = 'rgba(255,255,255,0.82)';
        Object.assign(btn.style, { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)' });
        btn.addEventListener('click', () => {
          vibrate(10);
          (async () => {
            try {
              const login = ctx.lastUser?.login || ctx.lastUser?.username;
              if (!login || !window.AsgardWebAuthn || !AsgardWebAuthn.loginWithBiometric) {
                M.Toast({ message: 'Face ID сейчас недоступен на этом устройстве', type: 'warning' });
                return;
              }
              const result = await AsgardWebAuthn.loginWithBiometric(login);
              if (result?.user) Store.set('user', result.user);
              if (result?.status === 'ok' || result?.token) {
                Router.navigate('/home', { replace: true });
                return;
              }
              M.Toast({ message: 'Не удалось подтвердить вход через Face ID', type: 'danger' });
            } catch (e) {
              if (e.message === 'cancelled') return;
              M.Toast({ message: e.message || 'Ошибка Face ID', type: 'danger' });
            }
          })();
        });
      } else if (key === 'del') {
        btn.innerHTML = ICONS.backspace;
        btn.style.color = 'rgba(255,255,255,0.82)';
        Object.assign(btn.style, { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)' });
        btn.addEventListener('click', delDigit);
      } else {
        Object.assign(btn.style, {
          ...DS.font('lg'),
          color: '#FFFFFF',
          background: 'rgba(255,255,255,0.16)',
          border: '1px solid rgba(255,255,255,0.22)',
          boxShadow: '0 14px 34px rgba(4,10,24,0.22), inset 0 1px 0 rgba(255,255,255,0.16)',
          backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        });
        btn.textContent = key;
        btn.addEventListener('click', () => addDigit(key));
        btn.addEventListener('touchstart', () => {
          btn.style.background = 'rgba(255,255,255,0.24)';
          btn.style.transform  = 'scale(0.94)';
          btn.style.borderColor = 'rgba(255,255,255,0.34)';
        }, { passive: true });
        btn.addEventListener('touchend', () => {
          btn.style.background  = 'rgba(255,255,255,0.16)';
          btn.style.transform   = '';
          btn.style.borderColor = 'rgba(255,255,255,0.22)';
        }, { passive: true });
      }
      return btn;
    };

    const rows = [
      ['1','2','3'],
      ['4','5','6'],
      ['7','8','9'],
      [showBio ? 'bio' : '', '0', 'del']
    ];
    rows.forEach((rowKeys) => {
      const row = el('div', { className: 'pin-row' });
      Object.assign(row.style, { display: 'flex', justifyContent: 'center', gap: '14px' });
      rowKeys.forEach((key) => row.appendChild(makeKey(key)));
      pad.appendChild(row);
    });
    page.appendChild(pad);

    /* alt login link */
    if (showAlt) {
      const alt = el('button', { type: 'button' });
      alt.textContent = 'Войти другим способом';
      Object.assign(alt.style, {
        ...DS.font('sm'), color: DS.t.blue,
        background: 'none', border: 'none', padding: '18px', cursor: 'pointer',
        marginTop: '16px',
      });
      alt.addEventListener('click', () => { vibrate(); onAlt && onAlt(); });
      page.appendChild(alt);
    }

    /* entrance animation */
    page.style.opacity    = '0';
    page.style.transition = 'opacity 0.4s ease';
    requestAnimationFrame(() => requestAnimationFrame(() => { page.style.opacity = '1'; }));

    return page;
  },
};

/* ================================================================
 *  REGISTER PAGE - access request
 * ================================================================ */
const RegisterPage = {
  async render() {
    if (Store.get('user')) { Router.navigate('/home', { replace: true }); return el('div'); }

    const page = el('div', { className: 'auth-register-page' });
    Object.assign(page.style, {
      minHeight: '100dvh',
      background: 'linear-gradient(180deg, rgba(10,93,194,0.08) 0%, var(--bg) 32%, var(--bg) 100%)',
      color: 'var(--text)',
      position: 'relative',
      overflowX: 'hidden',
    });

    const back = el('button', { className: 'auth-back-btn', type: 'button' });
    back.innerHTML = ICONS.back;
    Object.assign(back.style, {
      position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 12px)', left: '12px', zIndex: '2',
      background: 'rgba(255,255,255,0.12)', color: 'var(--text)', border: '1px solid var(--border)',
      width: '42px', height: '42px', borderRadius: '50%', lineHeight: '0', cursor: 'pointer',
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
    });
    back.addEventListener('click', () => Router.navigate('/welcome'));
    page.appendChild(back);

    const wrap = el('div');
    Object.assign(wrap.style, {
      padding: 'calc(env(safe-area-inset-top, 0px) + 72px) 20px max(env(safe-area-inset-bottom, 0px), 28px)',
      display: 'flex', flexDirection: 'column', gap: '18px',
    });

    const hero = el('div');
    Object.assign(hero.style, {
      background: 'var(--hero-grad)', borderRadius: '24px', padding: '22px 20px 20px', color: '#fff',
      boxShadow: 'var(--hero-shadow)', position: 'relative', overflow: 'hidden',
    });
    hero.appendChild(el('div', {
      textContent: '\u0414\u041e\u0421\u0422\u0423\u041f',
      style: { ...DS.font('label'), color: 'rgba(255,255,255,0.62)', marginBottom: '10px' },
    }));
    hero.appendChild(el('div', {
      textContent: '\u0417\u0430\u043f\u0440\u043e\u0441 \u0432 ASGARD',
      style: { ...DS.font('xl'), color: '#fff', marginBottom: '8px' },
    }));
    hero.appendChild(el('div', {
      textContent: '\u041e\u0441\u0442\u0430\u0432\u044c\u0442\u0435 \u0434\u0430\u043d\u043d\u044b\u0435, \u0438 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440 \u0441\u0432\u044f\u0436\u0435\u0442\u0441\u044f \u0441 \u0432\u0430\u043c\u0438 \u0434\u043b\u044f \u0432\u044b\u0434\u0430\u0447\u0438 \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u0432 \u043c\u043e\u0431\u0438\u043b\u044c\u043d\u0443\u044e CRM.',
      style: { ...DS.font('base'), color: 'rgba(255,255,255,0.72)', maxWidth: '280px' },
    }));
    hero.appendChild(el('div', {
      textContent: '\u16a8',
      style: {
        position: 'absolute', right: '18px', top: '16px', fontSize: '54px', fontWeight: '800',
        color: 'rgba(255,255,255,0.18)', lineHeight: '1',
      },
    }));
    wrap.appendChild(hero);

    const panel = el('div');
    Object.assign(panel.style, {
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '24px',
      boxShadow: 'var(--shadow)', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px',
    });
    panel.appendChild(el('div', {
      textContent: '\u041d\u043e\u0432\u0430\u044f \u0437\u0430\u044f\u0432\u043a\u0430',
      style: { ...DS.font('md'), color: 'var(--text)' },
    }));
    panel.appendChild(el('div', {
      textContent: '\u0412\u0441\u0435 \u043f\u043e\u043b\u044f \u043d\u0443\u0436\u043d\u044b, \u0447\u0442\u043e\u0431\u044b \u0441\u0440\u0430\u0437\u0443 \u043f\u043e\u0434\u043e\u0431\u0440\u0430\u0442\u044c \u0440\u043e\u043b\u044c \u0438 \u0432\u044b\u0434\u0430\u0442\u044c \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 \u0434\u043e\u0441\u0442\u0443\u043f \u0431\u0435\u0437 \u043b\u0438\u0448\u043d\u0438\u0445 \u0443\u0442\u043e\u0447\u043d\u0435\u043d\u0438\u0439.',
      style: { ...DS.font('sm'), color: 'var(--text-sec)', marginTop: '-6px' },
    }));

    const roles = [
      ['TO', '\u0422\u0435\u043d\u0434\u0435\u0440\u044b'], ['PM', '\u0420\u0443\u043a\u043e\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c \u043f\u0440\u043e\u0435\u043a\u0442\u043e\u0432'], ['HR', 'HR'],
      ['BUH', '\u0411\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438\u044f'], ['WAREHOUSE', '\u0421\u043a\u043b\u0430\u0434'], ['ADMIN', '\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440'],
    ];
    let selectedRole = 'TO';

    function makeField(label, type = 'text', opts = {}) {
      const row = el('label');
      Object.assign(row.style, { display: 'flex', flexDirection: 'column', gap: '8px' });
      row.appendChild(el('span', {
        textContent: label,
        style: { ...DS.font('sm'), color: 'var(--text-sec)' },
      }));
      const input = opts.multiline ? el('textarea') : el('input', { type });
      if (opts.placeholder) input.setAttribute('placeholder', opts.placeholder);
      if (opts.autocomplete) input.setAttribute('autocomplete', opts.autocomplete);
      Object.assign(input.style, {
        width: '100%', boxSizing: 'border-box', resize: opts.multiline ? 'vertical' : 'none',
        minHeight: opts.multiline ? '112px' : '52px', padding: opts.multiline ? '14px 16px' : '0 16px',
        borderRadius: '16px', border: '1px solid var(--border)', background: 'var(--input-bg)',
        color: 'var(--text)', outline: 'none', ...DS.font('base'),
      });
      row.appendChild(input);
      return { row, input };
    }

    const fullName = makeField('\u0418\u043c\u044f \u0438 \u0444\u0430\u043c\u0438\u043b\u0438\u044f', 'text', { autocomplete: 'name', placeholder: '\u041d\u0430\u043f\u0440\u0438\u043c\u0435\u0440, \u0418\u0432\u0430\u043d \u041f\u0435\u0442\u0440\u043e\u0432' });
    const phone = makeField('\u0422\u0435\u043b\u0435\u0444\u043e\u043d', 'tel', { autocomplete: 'tel', placeholder: '+7 (___) ___-__-__' });
    const email = makeField('Email', 'email', { autocomplete: 'email', placeholder: 'name@company.ru' });
    const company = makeField('\u041a\u043e\u043c\u043f\u0430\u043d\u0438\u044f / \u043e\u0442\u0434\u0435\u043b', 'text', { placeholder: 'ASGARD CRM / \u043f\u043e\u0434\u0440\u0430\u0437\u0434\u0435\u043b\u0435\u043d\u0438\u0435' });
    const note = makeField('\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439', 'text', { multiline: true, placeholder: '\u041e\u043f\u0438\u0448\u0438\u0442\u0435, \u0437\u0430\u0447\u0435\u043c \u043d\u0443\u0436\u0435\u043d \u0434\u043e\u0441\u0442\u0443\u043f \u0438 \u043a\u0430\u043a\u0438\u0435 \u0440\u0430\u0437\u0434\u0435\u043b\u044b \u0432\u0430\u043c \u043d\u0443\u0436\u043d\u044b \u0432 \u043f\u0435\u0440\u0432\u0443\u044e \u043e\u0447\u0435\u0440\u0435\u0434\u044c' });
    [fullName, phone, email, company].forEach(field => panel.appendChild(field.row));

    const roleWrap = el('div');
    Object.assign(roleWrap.style, { display: 'flex', flexDirection: 'column', gap: '8px' });
    roleWrap.appendChild(el('div', {
      textContent: '\u0420\u043e\u043b\u044c \u0432 \u0441\u0438\u0441\u0442\u0435\u043c\u0435',
      style: { ...DS.font('sm'), color: 'var(--text-sec)' },
    }));
    const roleGrid = el('div');
    Object.assign(roleGrid.style, { display: 'flex', flexWrap: 'wrap', gap: '8px' });
    const roleButtons = [];
    roles.forEach(([value, label]) => {
      const btn = el('button', { type: 'button', textContent: label });
      Object.assign(btn.style, {
        border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text-sec)',
        borderRadius: '999px', padding: '10px 14px', cursor: 'pointer', ...DS.font('sm'), fontWeight: '600',
        transition: 'all 0.2s ease', minHeight: '42px',
      });
      btn.addEventListener('click', () => {
        selectedRole = value;
        roleButtons.forEach(([key, button]) => {
          const active = key === selectedRole;
          button.style.background = active ? 'var(--blue-bg)' : 'var(--surface-alt)';
          button.style.borderColor = active ? 'var(--blue-border)' : 'var(--border)';
          button.style.color = active ? 'var(--blue)' : 'var(--text-sec)';
          button.style.boxShadow = active ? '0 6px 16px rgba(30,90,153,0.12)' : 'none';
        });
      });
      roleButtons.push([value, btn]);
      roleGrid.appendChild(btn);
    });
    roleWrap.appendChild(roleGrid);
    panel.appendChild(roleWrap);
    panel.appendChild(note.row);
    setTimeout(() => roleButtons[0] && roleButtons[0][1].click(), 0);

    const status = el('div');
    Object.assign(status.style, { ...DS.font('sm'), color: 'var(--text-sec)', minHeight: '20px' });
    panel.appendChild(status);

    const submit = M.FullWidthBtn({
      label: '\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443',
      variant: 'primary',
      onClick: async () => {
        const payload = {
          full_name: fullName.input.value.trim(),
          phone: phone.input.value.trim(),
          email: email.input.value.trim(),
          company: company.input.value.trim(),
          role: selectedRole,
          note: note.input.value.trim(),
          source: 'mobile_v3',
          created_at: new Date().toISOString(),
        };
        if (!payload.full_name || !payload.phone || !payload.email || !payload.company) {
          status.textContent = '\u0417\u0430\u043f\u043e\u043b\u043d\u0438\u0442\u0435 \u0438\u043c\u044f, \u0442\u0435\u043b\u0435\u0444\u043e\u043d, email \u0438 \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u044e.';
          status.style.color = 'var(--red)';
          M.Toast({ message: '\u041d\u0435 \u0432\u0441\u0435 \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u043f\u043e\u043b\u044f \u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d\u044b', type: 'error' });
          return;
        }
        submit.setLoading(true);
        status.textContent = '\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u043c \u0437\u0430\u044f\u0432\u043a\u0443\u2026';
        let sentRemote = false;
        for (const endpoint of ['/user-requests', '/auth/register-request', '/api/user-requests']) {
          try {
            const res = await API.fetch(endpoint, { method: 'POST', body: payload, noCache: true });
            if (res !== undefined) { sentRemote = true; break; }
          } catch (err) {}
        }
        const localKey = 'asgard_mobile_access_requests';
        const current = JSON.parse(localStorage.getItem(localKey) || '[]');
        current.unshift({ ...payload, sentRemote });
        localStorage.setItem(localKey, JSON.stringify(current.slice(0, 10)));

        panel.innerHTML = '';
        panel.appendChild(el('div', {
          textContent: '\u0417\u0430\u044f\u0432\u043a\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0430',
          style: { ...DS.font('lg'), color: 'var(--text)', marginBottom: '6px' },
        }));
        panel.appendChild(el('div', {
          textContent: sentRemote
            ? '\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440 \u043f\u043e\u043b\u0443\u0447\u0438\u0442 \u0437\u0430\u043f\u0440\u043e\u0441 \u0438 \u0441\u0432\u044f\u0436\u0435\u0442\u0441\u044f \u0441 \u0432\u0430\u043c\u0438 \u0434\u043b\u044f \u0432\u044b\u0434\u0430\u0447\u0438 \u0434\u043e\u0441\u0442\u0443\u043f\u0430.'
            : '\u0421\u0435\u0440\u0432\u0435\u0440 \u0437\u0430\u044f\u0432\u043e\u043a \u043f\u043e\u043a\u0430 \u043d\u0435 \u043e\u0442\u0432\u0435\u0442\u0438\u043b. \u0417\u0430\u044f\u0432\u043a\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0430 \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e \u043d\u0430 \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u0435 \u0438 \u043c\u043e\u0436\u0435\u0442 \u0431\u044b\u0442\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0430 \u043f\u043e\u0432\u0442\u043e\u0440\u043d\u043e \u043f\u043e\u0437\u0436\u0435.',
          style: { ...DS.font('base'), color: 'var(--text-sec)', marginBottom: '16px' },
        }));
        panel.appendChild(M.Badge({ text: sentRemote ? '\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e' : '\u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e', color: sentRemote ? 'success' : 'warning', variant: 'solid' }));
        const actions = el('div');
        Object.assign(actions.style, { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '18px' });
        actions.appendChild(M.FullWidthBtn({ label: '\u041a\u043e \u0432\u0445\u043e\u0434\u0443', variant: 'primary', onClick: () => Router.navigate('/login') }));
        actions.appendChild(M.FullWidthBtn({ label: '\u041d\u0430\u0437\u0430\u0434 \u043d\u0430 welcome', variant: 'secondary', onClick: () => Router.navigate('/welcome') }));
        panel.appendChild(actions);
        M.Toast({ message: sentRemote ? '\u0417\u0430\u044f\u0432\u043a\u0430 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0430' : '\u0417\u0430\u044f\u0432\u043a\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0430', type: 'success' });
      },
    });
    panel.appendChild(submit);
    wrap.appendChild(panel);
    wrap.appendChild(el('div', {
      textContent: '\u0414\u043e\u0441\u0442\u0443\u043f \u0432\u044b\u0434\u0430\u0451\u0442\u0441\u044f \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u043e\u043c. \u0410\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u043e\u0435 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430 \u0431\u0435\u0437 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u0440\u043e\u043b\u0438 \u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u043e.',
      style: { ...DS.font('xs'), color: 'var(--text-ter)', textAlign: 'center', padding: '4px 8px 0' },
    }));
    page.appendChild(wrap);
    return page;
  },
};
/* ---- globals ---- */
window.WelcomePage  = WelcomePage;
window.LoginPage    = LoginPage;
window.RegisterPage = RegisterPage;
})();
