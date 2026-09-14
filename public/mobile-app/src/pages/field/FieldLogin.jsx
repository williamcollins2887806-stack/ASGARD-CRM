import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import '@/styles/field-auth.css';

function playGateOpen() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      g.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.12 + 0.5);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.12);
      o.stop(ctx.currentTime + i * 0.12 + 0.5);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch (_) {}
}

function Stars() {
  const stars = useRef(
    Array.from({ length: 30 }, () => ({
      x: Math.random() * 100, y: Math.random() * 100,
      size: Math.random() * 2 + 0.5,
      delay: Math.random() * 4, duration: 2 + Math.random() * 3,
    }))
  ).current;
  return (
    <div className="fa-stars">
      {stars.map((s, i) => (
        <div key={i} className="fa-star" style={{
          left: s.x+'%', top: s.y+'%', width: s.size+'px', height: s.size+'px',
          animationDelay: s.delay+'s', animationDuration: s.duration+'s',
        }} />
      ))}
    </div>
  );
}

function formatPhone(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`;
  if (d.length <= 8) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,8)}-${d.slice(8)}`;
}

function phoneDigitsFromStored(phone) {
  if (!phone) return '';
  const d = String(phone).replace(/\D/g, '');
  if (d.length >= 10) return d.slice(-10);
  return d;
}

export default function FieldLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    requestCode, verifyCode, checkPhone, rememberForPin,
    loading, error, clearError,
    employee, pendingResetPin,
  } = useFieldAuthStore();

  const [step, setStep] = useState('phone'); // phone | code | success
  const [phone, setPhone] = useState(() => phoneDigitsFromStored(employee?.phone));
  const [otp, setOtp] = useState(['', '', '', '']);
  const [cooldown, setCooldown] = useState(0);
  const [employeeName, setEmployeeName] = useState('');
  const otpRefs = [useRef(), useRef(), useRef(), useRef()];
  const autoSmsSent = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => c <= 1 ? 0 : c - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // Устройство уже помнит PIN — не SMS, а ввод PIN (кроме «забыл PIN»)
  useEffect(() => {
    const wantReset = pendingResetPin || searchParams.get('reset') === '1';
    if (wantReset) return;
    const emp = employee || (() => {
      try { return JSON.parse(localStorage.getItem('field_employee') || 'null'); }
      catch { return null; }
    })();
    if (localStorage.getItem('field_has_pin') === '1' && emp?.id) {
      navigate('/field/pin-entry', { replace: true });
    }
  }, [employee, pendingResetPin, searchParams, navigate]);

  // Забыл PIN / сброс: сразу шлём SMS на сохранённый номер
  useEffect(() => {
    if (autoSmsSent.current) return;
    const wantReset = pendingResetPin || searchParams.get('reset') === '1';
    const digits = phoneDigitsFromStored(employee?.phone) || phone;
    if (wantReset && digits.length >= 10) {
      autoSmsSent.current = true;
      setPhone(digits);
      (async () => {
        try {
          await requestCode('+7' + digits);
          setStep('code');
          setCooldown(60);
        } catch (_) {
          setStep('phone');
        }
      })();
    }
  }, [pendingResetPin, employee, phone, requestCode, searchParams]);

  const rawPhone = phone.replace(/\D/g, '');
  const fullPhone = '+7' + rawPhone;

  const goAfterAuth = (nextStatus, fio, hasPin) => {
    setEmployeeName(fio || '');
    playGateOpen();
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    setStep('success');
    setTimeout(() => {
      // SMS уже доказал личность: либо создать PIN, либо сразу в приложение
      // (не просим PIN после SMS — PIN только при следующем входе без SMS)
      if (nextStatus === 'need_pin_setup' || (!hasPin && nextStatus !== 'authenticated')) {
        navigate('/field/pin-setup', { replace: true });
      } else {
        navigate('/field/home', { replace: true });
      }
    }, 1200);
  };

  const handleRequestCode = async () => {
    if (rawPhone.length < 10) return;
    clearError();
    const wantReset = pendingResetPin || searchParams.get('reset') === '1';
    try {
      if (!wantReset) {
        const looked = await checkPhone(fullPhone);
        if (looked?.has_pin && looked.employee?.id) {
          rememberForPin(looked.employee);
          navigate('/field/pin-entry', { replace: true });
          return;
        }
      }
      await requestCode(fullPhone);
      setStep('code');
      setCooldown(60);
      setTimeout(() => otpRefs[0].current?.focus(), 300);
    } catch (_) {}
  };

  const handleOtpChange = (index, value) => {
    clearError();
    const digit = value.replace(/\D/g, '').slice(-1);
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);
    if (digit && index < 3) otpRefs[index + 1].current?.focus();
    if (digit && index === 3) {
      const code = newOtp.join('');
      if (code.length === 4) handleVerify(code);
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs[index - 1].current?.focus();
    }
  };

  const handleVerify = async (code) => {
    try {
      const result = await verifyCode(fullPhone, code, {
        resetPin: pendingResetPin || searchParams.get('reset') === '1',
      });
      goAfterAuth(
        result?.status || useFieldAuthStore.getState().status,
        result?.employee?.fio,
        !!result?.has_pin,
      );
    } catch (_) {}
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    clearError();
    try {
      await requestCode(fullPhone);
      setCooldown(60);
      setOtp(['', '', '', '']);
    } catch (_) {}
  };

  if (step === 'success') {
    return (
      <div className="fa-success-overlay">
        <Stars />
        <div className="fa-success-rune">ᚦ</div>
        <div className="fa-success-text">Врата открыты</div>
        {employeeName && (
          <div className="fa-success-name">Асгард встречает тебя, {employeeName.split(' ')[0]}</div>
        )}
      </div>
    );
  }

  return (
    <div className="fa-login">
      <Stars />

      <div className="fa-login-header">
        <button className="fa-back-btn" onClick={() => {
          if (step === 'code') { setStep('phone'); setOtp(['','','','']); clearError(); }
          else navigate('/field/welcome');
        }}>←</button>
        <img
          src={import.meta.env.BASE_URL + 'asgard-logo.png'}
          alt="ASGARD"
          draggable={false}
          style={{
            height: 36, width: 'auto', userSelect: 'none',
            filter: 'drop-shadow(0 0 8px rgba(200,41,59,0.3))',
          }}
        />
      </div>

      <div className="fa-login-body">
        {step === 'phone' && (
          <div className="fa-slide-in" style={{ width: '100%', maxWidth: 320 }}>
            <h2 className="fa-heading">Назови себя,<br />воин</h2>
            <p className="fa-desc">
              {pendingResetPin
                ? 'Подтверди номер — пришлём SMS для нового PIN'
                : 'Введи номер. Если PIN уже есть — сразу его, иначе придёт SMS'}
            </p>

            <div className="fa-phone-wrap">
              <span className="fa-phone-prefix">+7</span>
              <input
                className="fa-phone-input"
                type="tel"
                inputMode="numeric"
                placeholder="(999) 123-45-67"
                value={formatPhone(phone)}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                autoFocus
              />
            </div>

            {error && <div className="fa-error">{error}</div>}

            <button
              className="fa-btn-gold"
              style={{ marginTop: 24 }}
              disabled={rawPhone.length < 10 || loading}
              onClick={handleRequestCode}
            >
              {loading
                ? '⏳ Проверяем...'
                : (pendingResetPin ? '⚔ Отправить SMS-код' : '⚔ Продолжить')}
            </button>
          </div>
        )}

        {step === 'phone' && (
          <div style={{ marginTop: 32, textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => navigate('/login')}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12, padding: '10px 20px',
                color: 'rgba(255,255,255,0.35)', fontSize: 12,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
              }}
            >
              <span>🏛️</span>
              <span>Вы из офиса? Войти в CRM</span>
              <span style={{ opacity: 0.5 }}>→</span>
            </button>
          </div>
        )}

        {step === 'code' && (
          <div className="fa-slide-in" style={{ width: '100%', maxWidth: 320 }}>
            <h2 className="fa-heading">Код из SMS</h2>
            <p className="fa-desc">Введи 4 цифры. Если есть Max — код мог прийти туда.</p>

            <div className="fa-otp-wrap">
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={otpRefs[i]}
                  className="fa-otp-box"
                  type="tel"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                />
              ))}
            </div>

            {error && <div className="fa-error">{error}</div>}
            {loading && <div className="fa-loading-text">Проверяем код...</div>}

            <div className="fa-countdown">
              {cooldown > 0 ? (
                <span>Повторить через {String(Math.floor(cooldown / 60)).padStart(2, '0')}:{String(cooldown % 60).padStart(2, '0')}</span>
              ) : (
                <button className="fa-countdown-link" onClick={handleResend}>Отправить снова</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
