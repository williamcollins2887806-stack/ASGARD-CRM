import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import '@/styles/field-auth.css';

function playGateOpen() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
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

// Stars (shared with Welcome)
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

export default function FieldLogin() {
  const navigate = useNavigate();
  const { requestCode, verifyCode, loading, error, clearError } = useFieldAuthStore();

  const [step, setStep] = useState('phone'); // phone | code | success
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '']);
  const [cooldown, setCooldown] = useState(0);
  const [employeeName, setEmployeeName] = useState('');
  const otpRefs = [useRef(), useRef(), useRef(), useRef()];

  // Countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => c <= 1 ? 0 : c - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const rawPhone = phone.replace(/\D/g, '');
  const fullPhone = '+7' + rawPhone;

  const handleRequestCode = async () => {
    if (rawPhone.length < 10) return;
    clearError();
    try {
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

    if (digit && index < 3) {
      otpRefs[index + 1].current?.focus();
    }

    // Auto-verify on last digit
    if (digit && index === 3) {
      const code = newOtp.join('');
      if (code.length === 4) {
        handleVerify(code);
      }
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs[index - 1].current?.focus();
    }
  };

  const handleVerify = async (code) => {
    try {
      const result = await verifyCode(fullPhone, code);
      setEmployeeName(result?.employee?.fio || '');

      // Success animation
      playGateOpen();
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      setStep('success');

      setTimeout(() => {
        navigate('/field/home', { replace: true });
      }, 1800);
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

  // ═══ SUCCESS SCREEN ═══
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
        <span className="fa-mini-logo">ASGARD</span>
      </div>

      <div className="fa-login-body">
        {/* ═══ PHONE STEP ═══ */}
        {step === 'phone' && (
          <div className="fa-slide-in" style={{ width: '100%', maxWidth: 320 }}>
            <h2 className="fa-heading">Назови себя,<br />воин</h2>
            <p className="fa-desc">Введи свой номер телефона</p>

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
              {loading ? '⏳ Валькирия посылает знак...' : '⚔ Отправить знак'}
            </button>
          </div>
        )}

        {/* ═══ CODE STEP ═══ */}
        {step === 'code' && (
          <div className="fa-slide-in" style={{ width: '100%', maxWidth: 320 }}>
            <h2 className="fa-heading">Валькирия<br />отправила знак</h2>
            <p className="fa-desc">Введи 4 руны с неба</p>

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
            {loading && <div className="fa-loading-text">Валькирия проверяет руны...</div>}

            <div className="fa-countdown">
              {cooldown > 0 ? (
                <span>Повторить знак через {String(Math.floor(cooldown / 60)).padStart(2, '0')}:{String(cooldown % 60).padStart(2, '0')}</span>
              ) : (
                <button className="fa-countdown-link" onClick={handleResend}>Повторить знак</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
