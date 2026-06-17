/**
 * Страница /welcome — главная стартовая для НЕ-залогиненных.
 * Источник: vanilla `public/assets/js/app.js` (pageWelcome, строки 1170–1495).
 *
 * Что есть:
 *   • Aurora-фон, золотой герб, мотто
 *   • Кнопка «Войти» → форма логин/пароль
 *   • Кнопка «Регистрация» → форма регистрации (создаёт user_request)
 *   • Шаг PIN (после логина если есть pin_hash) — виртуальная клавиатура
 *   • Шаг setup (если must_change_password) — новый пароль + PIN
 *   • Theme-selector справа сверху (☀️/🌙)
 *
 * После успешного входа → persistSession → редирект на /home (или return_url).
 */
import { useState, useEffect } from 'react';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/api/useAuth';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TextInput, PasswordInput, Checkbox } from '@/inputs/Inputs';

import { PinKeypad } from './PinKeypad';
import { loginStep1, verifyPin, setupCredentials, register, persistSession } from './api';
import './welcome.css';

const STAGES = {
  HOME:     'home',     // герб + Войти / Регистрация
  LOGIN:    'login',    // логин/пароль
  PIN:      'pin',      // ввод PIN
  SETUP:    'setup',    // первый вход (новый пароль + PIN)
  REGISTER: 'register'  // форма регистрации
};

export default function WelcomePage() {
  const { theme, setTheme } = useTheme();
  const { user, ready } = useAuth();

  const [stage, setStage] = useState(STAGES.HOME);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [tempToken, setTempToken] = useState(''); // pre-PIN token
  const [tempUser, setTempUser] = useState(null);
  const [pinHint, setPinHint] = useState('');
  const [pinStatus, setPinStatus] = useState('idle');
  const [busy, setBusy] = useState(false);

  // Setup form
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [setupPin, setSetupPin] = useState('');

  // Registration form
  const [regLogin, setRegLogin] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');

  // Если уже залогинен — сразу на home
  useEffect(() => {
    if (ready && user) {
      const returnUrl = (() => {
        try { return sessionStorage.getItem('asgard_return_url'); } catch { return null; }
      })();
      try { sessionStorage.removeItem('asgard_return_url'); } catch { /* noop */ }
      window.location.hash = returnUrl || '#/home';
    }
  }, [ready, user]);

  const _goHome = () => {
    persistSession({ token: tempToken, user: tempUser });
    // CRIT-фикс: было `location.href='/#/home'` — это уводит на корень `/` (vanilla v1),
    // а не на `/v2/`. Юзер логинился через /v2/welcome и попадал в v1!
    // Использовать относительный hash сохраняет /v2/ префикс.
    window.location.hash = '#/home';
    // мягкий reload — useAuth тогда подхватит токен
    setTimeout(() => window.location.reload(), 50);
  };

  const onLogin = async () => {
    if (!login.trim() || !password) {
      toast.error('Заполните логин и пароль');
      return;
    }
    setBusy(true);
    try {
      const r = await loginStep1({ login: login.trim(), password });
      if (r?.status === 'need_pin') {
        setTempToken(r.token);
        setTempUser(r.user);
        setPinHint('');
        setPinStatus('idle');
        setStage(STAGES.PIN);
      } else if (r?.status === 'need_setup') {
        setTempToken(r.token);
        setTempUser(r.user);
        setStage(STAGES.SETUP);
      } else if (r?.token && r?.user) {
        // прямой вход без PIN
        setTempToken(r.token);
        setTempUser(r.user);
        persistSession({ token: r.token, user: r.user });
        // CRIT-фикс: hash вместо href — оставаться в /v2/ а не уходить в vanilla.
        window.location.hash = '#/home';
        setTimeout(() => window.location.reload(), 50);
      } else {
        toast.error('Неожиданный ответ сервера');
      }
    } catch (e) {
      toast.error(e.message || 'Неверный логин или пароль');
    } finally {
      setBusy(false);
    }
  };

  const onPinComplete = async (pin) => {
    setBusy(true);
    setPinStatus('idle');
    setPinHint('Проверяем…');
    try {
      const r = await verifyPin({ pin }, tempToken);
      const tok = r.token || tempToken;
      const usr = r.user || tempUser;
      setPinStatus('ok');
      setPinHint('Готово');
      persistSession({ token: tok, user: usr });
      setTimeout(() => {
        // CRIT-фикс: hash вместо href — иначе после PIN юзер /v2/ уходил в vanilla.
        window.location.hash = '#/home';
        setTimeout(() => window.location.reload(), 50);
      }, 250);
    } catch (e) {
      setPinStatus('err');
      setPinHint(e.message || 'Неверный PIN');
      setTimeout(() => { setPinStatus('reset'); setPinHint('Попробуйте ещё раз'); }, 800);
    } finally {
      setBusy(false);
    }
  };

  const onSetup = async () => {
    if (!newPass || newPass.length < 6) { toast.error('Пароль минимум 6 символов'); return; }
    if (newPass !== newPass2) { toast.error('Пароли не совпадают'); return; }
    if (!/^\d{4}$/.test(setupPin)) { toast.error('PIN — ровно 4 цифры'); return; }
    setBusy(true);
    try {
      const r = await setupCredentials({ newPassword: newPass, pin: setupPin }, tempToken);
      const tok = r.token || tempToken;
      const usr = r.user || tempUser;
      persistSession({ token: tok, user: usr });
      toast.success('Учётные данные сохранены');
      setTimeout(() => {
        // CRIT-фикс: hash вместо href — оставаться в /v2/ после первичной настройки.
        window.location.hash = '#/home';
        setTimeout(() => window.location.reload(), 50);
      }, 400);
    } catch (e) {
      toast.error(e.message || 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async () => {
    if (!regLogin || regLogin.length < 3) { toast.error('Логин ≥3 символа'); return; }
    if (!regName || regName.length < 2)   { toast.error('Укажите имя'); return; }
    if (!regEmail || !regEmail.includes('@')) { toast.error('Email обязателен'); return; }
    if (!regPass || regPass.length < 6)   { toast.error('Пароль ≥6 символов'); return; }
    setBusy(true);
    try {
      const r = await register({ login: regLogin.trim(), password: regPass, name: regName.trim(), email: regEmail.trim() });
      toast.success(r?.message || 'Заявка отправлена');
      setStage(STAGES.HOME);
      setRegLogin(''); setRegPass(''); setRegName(''); setRegEmail('');
    } catch (e) {
      toast.error(e.message || 'Не удалось зарегистрироваться');
    } finally {
      setBusy(false);
    }
  };

  // Глобальный Enter в формах
  const onKeyEnter = (fn) => (e) => { if (e.key === 'Enter') fn(); };

  return (
    <div className="welcome-v2">
      <div className="welcome-v2-bg">
        <div className="welcome-v2-aurora a1" />
        <div className="welcome-v2-aurora a2" />
        <div className="welcome-v2-aurora a3" />
      </div>

      <div className="welcome-v2-theme">
        <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')} title="Светлая">☀</button>
        <button className={theme === 'dark' ? 'on' : ''}  onClick={() => setTheme('dark')}  title="Тёмная">🌙</button>
      </div>

      <div className="welcome-v2-content">
        {stage === STAGES.HOME && (
          <>
            <div className="welcome-v2-header">
              <div className="welcome-v2-emblem">
                <img
                  src={import.meta.env.BASE_URL + 'assets/img/asgard_emblem.png'}
                  alt="АСГАРД-СЕРВИС"
                  className="welcome-v2-emblem-img"
                  onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement.classList.add('emblem-fallback'); }}
                />
                <span className="welcome-v2-emblem-rune">ᚨ</span>
              </div>
              <h1 className="welcome-v2-title">АСГАРД‑СЕРВИС</h1>
              <div className="welcome-v2-subtitle">Управляй · Контролируй · Побеждай</div>
              <div className="welcome-v2-runes">ᚠᚢᚦᚨᚱᚲ · CRM SYSTEM 2.0</div>
            </div>

            <div className="welcome-v2-motto">«Сталь и порядок. Пусть каждый день приносит добычу.»</div>

            <div className="welcome-v2-features">
              <span>◆ Порядок в делах</span>
              <span>•</span>
              <span>◆ Честный счёт</span>
              <span>•</span>
              <span>◆ Быстрые решения</span>
            </div>

            <div className="welcome-v2-actions">
              <Btn variant="primary" onClick={() => setStage(STAGES.LOGIN)}>Войти</Btn>
              <button className="welcome-v2-link" onClick={() => setStage(STAGES.REGISTER)}>
                Нет аккаунта? Подать заявку на регистрацию →
              </button>
            </div>

            <div className="welcome-v2-footer">ᚠᚹ · CRM SYSTEM · ᚹᚠ</div>
          </>
        )}

        {stage === STAGES.LOGIN && (
          <>
            <div className="welcome-v2-header">
              <div className="welcome-v2-emblem">ᚨ</div>
              <h1 className="welcome-v2-title welcome-v2-title--sm">ВХОД</h1>
            </div>
            <div className="welcome-v2-form">
              <div className="welcome-v2-form-title">Войти в Асгард</div>
              <div>
                <label className="welcome-v2-form-label">Логин</label>
                <TextInput
                  value={login}
                  onChange={setLogin}
                  placeholder="Введите логин"
                  autoComplete="username"
                  onKeyDown={onKeyEnter(onLogin)}
                  autoFocus
                />
              </div>
              <div>
                <label className="welcome-v2-form-label">Пароль</label>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  placeholder="Введите пароль"
                  autoComplete="current-password"
                  onKeyDown={onKeyEnter(onLogin)}
                />
              </div>
              <Checkbox checked={remember} onChange={setRemember} label="Запомнить меня" />
              <div className="welcome-v2-form-actions">
                <Btn variant="ghost" onClick={() => setStage(STAGES.HOME)} disabled={busy}>Назад</Btn>
                <Btn variant="primary" onClick={onLogin} disabled={busy}>{busy ? 'Проверяем…' : 'Далее'}</Btn>
              </div>
            </div>
          </>
        )}

        {stage === STAGES.PIN && (
          <>
            <div className="welcome-v2-header">
              <div className="welcome-v2-emblem">🔐</div>
              <h1 className="welcome-v2-title welcome-v2-title--sm">PIN</h1>
            </div>
            <div className="welcome-v2-form">
              <div className="welcome-v2-form-title">Введите PIN</div>
              <div className="welcome-v2-form-subtitle">{tempUser?.name || ''}</div>
              <PinKeypad
                length={4}
                status={pinStatus}
                hint={pinHint || 'Четыре цифры'}
                onComplete={onPinComplete}
              />
              <div className="welcome-v2-form-actions">
                <button className="welcome-v2-link" onClick={() => { setStage(STAGES.LOGIN); setPassword(''); }}>← Назад к логину</button>
              </div>
            </div>
          </>
        )}

        {stage === STAGES.SETUP && (
          <>
            <div className="welcome-v2-header">
              <div className="welcome-v2-emblem">✦</div>
              <h1 className="welcome-v2-title welcome-v2-title--sm">ПЕРВЫЙ ВХОД</h1>
            </div>
            <div className="welcome-v2-form">
              <div className="welcome-v2-form-title">Создайте пароль и PIN</div>
              <div className="welcome-v2-form-subtitle">{tempUser?.name || ''}</div>
              <div>
                <label className="welcome-v2-form-label">Новый пароль (мин. 6 символов)</label>
                <PasswordInput value={newPass} onChange={setNewPass} placeholder="Придумайте надёжный пароль" autoComplete="new-password" />
              </div>
              <div>
                <label className="welcome-v2-form-label">Повторите пароль</label>
                <PasswordInput value={newPass2} onChange={setNewPass2} placeholder="Ещё раз" autoComplete="new-password" />
              </div>
              <div>
                <label className="welcome-v2-form-label center">PIN-код (4 цифры)</label>
                <PinKeypad length={4} autoSubmit={false} onChange={setSetupPin} hint={setupPin.length === 4 ? '✓ PIN готов' : ''} />
              </div>
              <div className="welcome-v2-form-actions">
                <Btn variant="primary" onClick={onSetup} disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить и войти'}</Btn>
              </div>
            </div>
          </>
        )}

        {stage === STAGES.REGISTER && (
          <>
            <div className="welcome-v2-header">
              <div className="welcome-v2-emblem">✎</div>
              <h1 className="welcome-v2-title welcome-v2-title--sm">РЕГИСТРАЦИЯ</h1>
            </div>
            <div className="welcome-v2-form">
              <div className="welcome-v2-form-title">Подать заявку</div>
              <div className="welcome-v2-form-subtitle">После подачи заявку одобряет администратор</div>

              <div>
                <label className="welcome-v2-form-label">Имя *</label>
                <TextInput value={regName} onChange={setRegName} placeholder="Иванов И.И." onKeyDown={onKeyEnter(onRegister)} />
              </div>
              <div>
                <label className="welcome-v2-form-label">Логин *</label>
                <TextInput value={regLogin} onChange={setRegLogin} placeholder="ivanov" onKeyDown={onKeyEnter(onRegister)} autoComplete="username" />
              </div>
              <div>
                <label className="welcome-v2-form-label">Email *</label>
                <TextInput value={regEmail} onChange={setRegEmail} placeholder="user@company.ru" onKeyDown={onKeyEnter(onRegister)} type="email" />
              </div>
              <div>
                <label className="welcome-v2-form-label">Пароль (≥6 символов) *</label>
                <PasswordInput value={regPass} onChange={setRegPass} placeholder="Пароль" onKeyDown={onKeyEnter(onRegister)} autoComplete="new-password" />
              </div>

              <div className="welcome-v2-form-actions">
                <Btn variant="ghost" onClick={() => setStage(STAGES.HOME)} disabled={busy}>Назад</Btn>
                <Btn variant="primary" onClick={onRegister} disabled={busy}>{busy ? 'Отправляем…' : 'Подать заявку'}</Btn>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
