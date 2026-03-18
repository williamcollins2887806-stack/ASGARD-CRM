/**
 * ASGARD CRM — Mobile v3 / Профиль пользователя
 * Сессия 13 (Окно A) — 15.03.2026
 * Личный кабинет: данные, безопасность, уведомления, внешний вид, система
 */
var ProfilePage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;
    var user = Store.get('user') || {};

    // Если нет данных пользователя — попробовать подгрузить
    if (!user.id && typeof API !== 'undefined') {
      var loadingPage = el('div', { style: { background: t.bg, padding: '40px 20px', textAlign: 'center' } });
      loadingPage.appendChild(M.Skeleton({ type: 'card', count: 3 }));
      API.fetch('/users/me').then(function (resp) {
        var u = resp.user || resp || {};
        if (u.id) {
          Store.set('user', u);
          Router.navigate('/profile', { replace: true });
        }
      }).catch(function () {
        loadingPage.replaceChildren(
          M.Empty({ text: 'Не удалось загрузить профиль', icon: '👤' })
        );
        var retryBtn = el('button', {
          style: { marginTop: '16px', padding: '10px 24px', borderRadius: '12px', background: t.red, color: '#fff', border: 'none', fontSize: '14px', fontWeight: '600' },
          textContent: 'Повторить',
          onClick: function () { Router.navigate('/profile', { replace: true }); },
        });
        loadingPage.appendChild(retryBtn);
      });
      return loadingPage;
    }

    var page = el('div', { style: { background: t.bg, paddingBottom: '100px' } });

    // ── Header ──
    page.appendChild(M.Header({
      title: 'Профиль',
      subtitle: 'ЛИЧНЫЙ КАБИНЕТ',
      back: true,
      backHref: '/home',
    }));

    // ── Hero card (avatar + info) ──
    var heroWrap = el('div', {
      style: {
        padding: '24px 20px 20px',
        background: t.heroGradSoft,
        borderBottom: '1px solid ' + t.border,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        ...DS.anim(0),
      },
    });

    var avatarWrap = el('div', { style: {
      display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', cursor: 'pointer',
    } });
    var avatarInner = el('div', { style: { position: 'relative' } });
    avatarInner.appendChild(M.Avatar({ name: user.name || 'Пользователь', size: 72, status: 'online', src: user.avatar_url || null }));
    var camBadge = el('div', { style: {
      position: 'absolute', bottom: '-2px', right: '-2px', width: '24px', height: '24px',
      borderRadius: '50%', background: 'var(--hero-grad)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontSize: '12px',
      border: '2px solid ' + t.bg, color: '#fff',
    } }, '📷');
    avatarInner.appendChild(camBadge);
    avatarWrap.appendChild(avatarInner);
    avatarWrap.appendChild(el('div', { style: { ...DS.font('xs'), color: t.textSec, textAlign: 'center', marginTop: '4px' } }, 'Сменить фото'));
    avatarWrap.addEventListener('click', function () {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.setAttribute('capture', 'user');
      inp.onchange = function () {
        if (!inp.files || !inp.files[0]) return;
        var fd = new FormData();
        fd.append('file', inp.files[0]);
        M.Toast({ message: 'Загрузка фото...', type: 'info' });
        fetch('/api/files/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + API.getToken() },
          body: fd,
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (!data.success || !data.download_url) throw new Error('Ошибка загрузки');
          return API.fetch('/users/' + user.id, { method: 'PUT', body: { avatar_url: data.download_url } });
        }).then(function (resp) {
          var u = Store.get('user') || {};
          u.avatar_url = resp.user ? resp.user.avatar_url : (resp.avatar_url || u.avatar_url);
          Store.set('user', u);
          M.Toast({ message: 'Фото обновлено', type: 'success' });
          Router.navigate('/profile', { replace: true });
        }).catch(function (e) {
          M.Toast({ message: 'Ошибка: ' + (e.message || 'не удалось обновить'), type: 'error' });
        });
      };
      inp.click();
    });
    heroWrap.appendChild(avatarWrap);

    var nameEl = el('div', {
      style: { ...DS.font('lg'), color: t.text, textAlign: 'center' },
      textContent: user.name || 'Пользователь',
    });
    heroWrap.appendChild(nameEl);

    var rolePill = M.Badge({
      text: user.role_name || user.role || 'Сотрудник',
      color: user.role === 'ADMIN' ? 'danger' : user.role === 'DIRECTOR' || (user.role || '').startsWith('DIRECTOR_') ? 'gold' : 'info',
    });
    heroWrap.appendChild(rolePill);

    var contactRow = el('div', {
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' },
    });
    if (user.email) {
      contactRow.appendChild(el('div', {
        style: { ...DS.font('sm'), color: t.textSec, display: 'flex', alignItems: 'center', gap: '4px' },
        textContent: '✉ ' + user.email,
      }));
    }
    if (user.phone) {
      contactRow.appendChild(el('div', {
        style: { ...DS.font('sm'), color: t.textSec, display: 'flex', alignItems: 'center', gap: '4px' },
        textContent: '📞 ' + user.phone,
      }));
    }
    heroWrap.appendChild(contactRow);
    page.appendChild(heroWrap);

    // ══════════════════════════════════════════
    //  SECTION BUILDER
    // ══════════════════════════════════════════
    var sectionIdx = 0;
    function addSection(title, icon) {
      sectionIdx++;
      var hdr = el('div', {
        style: {
          padding: '20px 20px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          ...DS.anim(sectionIdx * 0.04),
        },
      });
      hdr.appendChild(el('span', { style: { fontSize: '16px' } }, icon));
      hdr.appendChild(el('div', { style: { ...DS.font('md'), color: t.text } }, title));
      page.appendChild(hdr);
    }

    function addRow(label, value, opts) {
      opts = opts || {};
      var row = el('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 16px',
          background: t.surface,
          borderBottom: '1px solid ' + t.border,
          minHeight: '48px',
        },
      });
      row.appendChild(el('div', { style: { ...DS.font('base'), color: t.text, flex: 1, minWidth: 0 } }, label));
      if (opts.pill) {
        row.appendChild(M.Badge({ text: value, color: opts.pillColor || 'success' }));
      } else if (opts.toggle) {
        var toggleState = { on: !!opts.toggleValue };
        var toggleWrap = el('div', {
          style: {
            width: '46px', minWidth: '46px', height: '26px',
            borderRadius: '13px', position: 'relative', cursor: 'pointer',
            transition: 'background 0.3s ease',
            background: toggleState.on ? t.red : t.surfaceAlt,
            border: '1px solid ' + t.border, flexShrink: 0,
          },
        });
        var thumb = el('span', {
          style: {
            position: 'absolute', top: '2px',
            left: toggleState.on ? '22px' : '2px',
            width: '20px', height: '20px', borderRadius: '50%',
            background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            transition: 'left 0.3s cubic-bezier(.34,1.56,.64,1)',
            pointerEvents: 'none',
          },
        });
        toggleWrap.appendChild(thumb);
        toggleWrap.addEventListener('click', function () {
          toggleState.on = !toggleState.on;
          toggleWrap.style.background = toggleState.on ? t.red : t.surfaceAlt;
          thumb.style.left = toggleState.on ? '22px' : '2px';
          if (opts.onToggle) opts.onToggle(toggleState.on);
        });
        row.appendChild(toggleWrap);
      } else if (opts.button) {
        var btn = el('button', {
          style: {
            padding: '6px 14px', borderRadius: '8px',
            border: '1px solid ' + t.border, background: t.surface,
            color: t.blue, fontSize: '12px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          },
          textContent: opts.buttonLabel || 'Изменить',
        });
        btn.addEventListener('click', opts.onButton || function () {});
        row.appendChild(btn);
      } else {
        row.appendChild(el('div', {
          style: { ...DS.font('sm'), color: t.textSec, textAlign: 'right', flexShrink: 0 },
          textContent: value || '—',
        }));
      }
      return row;
    }

    function addCard(children) {
      var card = el('div', {
        style: {
          margin: '0 20px',
          borderRadius: '16px',
          overflow: 'hidden',
          border: '1px solid ' + t.border,
          background: t.surface,
        },
      });
      children.forEach(function (c) { card.appendChild(c); });
      page.appendChild(card);
    }

    // ══════════════════════════════════════════
    //  МОИ ДАННЫЕ
    // ══════════════════════════════════════════
    addSection('Мои данные', '👤');
    addCard([
      addRow('Логин', user.login || '—'),
      addRow('Email', user.email || '—', {
        button: true,
        buttonLabel: 'Изменить',
        onButton: function () { openEditField('email', user.email); },
      }),
      addRow('Телефон', user.phone || '—', {
        button: true,
        buttonLabel: 'Изменить',
        onButton: function () { openEditField('phone', user.phone); },
      }),
      addRow('Telegram', user.telegram_chat_id ? 'Привязан' : 'Не привязан', {
        pill: true,
        pillColor: user.telegram_chat_id ? 'success' : 'neutral',
      }),
      addRow('Дата регистрации', user.created_at ? Utils.formatDate(user.created_at, 'date') : '—'),
    ]);

    // ══════════════════════════════════════════
    //  БЕЗОПАСНОСТЬ
    // ══════════════════════════════════════════
    addSection('Безопасность', '🔒');
    var secRows = [
      addRow('Сменить пароль', '', {
        button: true,
        buttonLabel: 'Сменить',
        onButton: function () { openChangePassword(); },
      }),
    ];

    // WebAuthn toggle
    var webAuthnSupported = window.PublicKeyCredential && typeof window.PublicKeyCredential === 'function';
    if (webAuthnSupported) {
      secRows.push(addRow('Face ID / Touch ID', '', {
        toggle: true,
        toggleValue: !!user.has_webauthn,
        onToggle: function (on) {
          if (on) {
            registerBiometric();
          } else {
            M.Toast({ message: 'Биометрия отключена', type: 'info' });
          }
        },
      }));
    }

    secRows.push(addRow('Активные сессии', '', {
      button: true,
      buttonLabel: 'Показать',
      onButton: function () { M.Toast({ message: 'Загрузка сессий...', type: 'info' }); },
    }));

    addCard(secRows);

    // ══════════════════════════════════════════
    //  УВЕДОМЛЕНИЯ
    // ══════════════════════════════════════════
    addSection('Уведомления', '🔔');
    addCard([
      addRow('Push-уведомления', '', {
        toggle: true,
        toggleValue: Notification.permission === 'granted',
        onToggle: function (on) {
          if (on && Notification.permission !== 'granted') {
            Notification.requestPermission().then(function (p) {
              if (p !== 'granted') M.Toast({ message: 'Разрешение не получено', type: 'warning' });
            });
          }
        },
      }),
      addRow('Telegram-уведомления', '', {
        toggle: true,
        toggleValue: !!user.telegram_notifications,
        onToggle: function (on) { savePreference('telegram_notifications', on); },
      }),
      addRow('Email-уведомления', '', {
        toggle: true,
        toggleValue: user.email_notifications !== false,
        onToggle: function (on) { savePreference('email_notifications', on); },
      }),
      addRow('Звук уведомлений', '', {
        toggle: true,
        toggleValue: user.sound_notifications !== false,
        onToggle: function (on) { savePreference('sound_notifications', on); },
      }),
    ]);

    // ══════════════════════════════════════════
    //  ВНЕШНИЙ ВИД
    // ══════════════════════════════════════════
    addSection('Внешний вид', '🎨');
    var themeRow = addRow('Тёмная тема', '', {
      toggle: true,
      toggleValue: DS.getTheme() === 'dark',
      onToggle: function (on) {
        DS.setTheme(on ? 'dark' : 'light');
      },
    });
    addCard([
      themeRow,
      addRow('Язык', 'Русский'),
    ]);

    // ══════════════════════════════════════════
    //  О СИСТЕМЕ
    // ══════════════════════════════════════════
    addSection('О системе', 'ℹ️');
    var versionInfo = (window.ASGARD_BUILD && window.ASGARD_BUILD.version) || 'Mobile v3.0';
    var serverInfo = window.location.hostname;
    var cacheWrap = el('div');
    var cacheSize = '—';
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        var used = est.usage || 0;
        if (used >= 1048576) cacheSize = (used / 1048576).toFixed(1) + ' MB';
        else if (used >= 1024) cacheSize = (used / 1024).toFixed(0) + ' KB';
        else cacheSize = used + ' B';
        var csEl = cacheWrap.querySelector('[data-cache-size]');
        if (csEl) csEl.textContent = cacheSize;
      });
    }
    addCard([
      addRow('Версия CRM', versionInfo),
      addRow('Сервер', serverInfo),
      (function () {
        var r = addRow('Размер кэша', cacheSize);
        var val = r.querySelector('div:last-child');
        if (val) val.setAttribute('data-cache-size', '1');
        cacheWrap.appendChild(r);
        return cacheWrap.firstChild;
      })(),
      addRow('Очистить кэш', '', {
        button: true,
        buttonLabel: 'Очистить',
        onButton: function () {
          if ('caches' in window) {
            caches.keys().then(function (names) {
              names.forEach(function (name) { caches.delete(name); });
            });
          }
          localStorage.removeItem('asgard_mobile_state');
          M.Toast({ message: 'Кэш очищен', type: 'success' });
        },
      }),
    ]);

    // ══════════════════════════════════════════
    //  КНОПКА ВЫХОДА
    // ══════════════════════════════════════════
    var gap = el('div', { style: { height: '24px' } });
    page.appendChild(gap);

    var logoutBtn = el('div', { style: { padding: '0 20px', ...DS.anim(0.3) } });
    logoutBtn.appendChild(M.FullWidthBtn({
      label: 'Выйти из аккаунта',
      variant: 'danger',
      onClick: function () {
        M.Confirm({
          title: 'Выход',
          message: 'Вы уверены, что хотите выйти?',
          okText: 'Выйти',
          cancelText: 'Отмена',
          danger: true,
        }).then(function (ok) {
          if (ok) {
            Store.set('user', null);
            localStorage.removeItem('auth_token');
            Router.navigate('/welcome', { replace: true });
          }
        });
      },
    }));
    page.appendChild(logoutBtn);

    // ══════════════════════════════════════════
    //  ACTIONS / MODALS
    // ══════════════════════════════════════════

    function openEditField(field, currentValue) {
      var labels = { email: 'Email', phone: 'Телефон' };
      var types = { email: 'email', phone: 'tel' };
      var content = el('div');
      var inputVal = { v: currentValue || '' };
      content.appendChild(M.Form({
        fields: [
          { id: field, label: labels[field] || field, type: types[field] || 'text', value: currentValue || '' },
        ],
        submitLabel: 'Сохранить',
        onSubmit: function (data) {
          API.fetch('/users/' + user.id, {
            method: 'PUT',
            body: { [field]: data[field] },
          }).then(function () {
            user[field] = data[field];
            Store.set('user', Object.assign({}, user));
            M.Toast({ message: 'Сохранено', type: 'success' });
            Router.navigate('/profile', { replace: true });
          }).catch(function () {
            M.Toast({ message: 'Ошибка сохранения', type: 'error' });
          });
        },
      }));
      M.BottomSheet({ title: 'Изменить ' + (labels[field] || field).toLowerCase(), content: content });
    }

    function openChangePassword() {
      var content = el('div');
      content.appendChild(M.Form({
        fields: [
          { id: 'old_password', label: 'Текущий пароль', type: 'password', required: true },
          { id: 'new_password', label: 'Новый пароль', type: 'password', required: true },
          { id: 'confirm_password', label: 'Подтверждение', type: 'password', required: true },
        ],
        submitLabel: 'Сменить пароль',
        onSubmit: function (data) {
          if (data.new_password !== data.confirm_password) {
            M.Toast({ message: 'Пароли не совпадают', type: 'error' });
            return;
          }
          API.fetch('/auth/change-password', {
            method: 'POST',
            body: { old_password: data.old_password, new_password: data.new_password },
          }).then(function () {
            M.Toast({ message: 'Пароль изменён', type: 'success' });
          }).catch(function () {
            M.Toast({ message: 'Ошибка смены пароля', type: 'error' });
          });
        },
      }));
      M.BottomSheet({ title: 'Смена пароля', content: content });
    }

    function registerBiometric() {
      if (typeof AsgardWebAuthn !== 'undefined' && AsgardWebAuthn.registerBiometric) {
        AsgardWebAuthn.registerBiometric().then(function () {
          M.Toast({ message: 'Биометрия подключена', type: 'success' });
        }).catch(function (e) {
          M.Toast({ message: e.message || 'Ошибка регистрации', type: 'error' });
        });
      } else {
        API.fetch('/webauthn/register', { method: 'POST' }).then(function () {
          M.Toast({ message: 'Face ID / Touch ID подключён', type: 'success' });
        }).catch(function () {
          M.Toast({ message: 'Ошибка подключения биометрии', type: 'error' });
        });
      }
    }

    function savePreference(key, value) {
      user[key] = value;
      Store.set('user', Object.assign({}, user));
      API.fetch('/users/' + user.id, {
        method: 'PUT',
        body: { [key]: value },
      }).catch(function () {});
    }

    return page;
  },
};

Router.register('/profile', ProfilePage);
