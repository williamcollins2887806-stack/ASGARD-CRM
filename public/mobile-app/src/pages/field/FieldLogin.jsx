import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { Phone, Shield, ArrowRight, Loader2 } from 'lucide-react';

export default function FieldLogin() {
  const navigate = useNavigate();
  const { requestCode, verifyCode, loading, error, clearError } = useFieldAuthStore();

  const [step, setStep] = useState('phone'); // 'phone' | 'code'
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const codeInputRef = useRef(null);

  // Format phone for display
  const formatPhone = (val) => {
    const digits = val.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 1) return '+7';
    let formatted = '+7';
    const rest = digits.slice(1);
    if (rest.length > 0) formatted += ' (' + rest.slice(0, 3);
    if (rest.length > 3) formatted += ') ' + rest.slice(3, 6);
    if (rest.length > 6) formatted += '-' + rest.slice(6, 8);
    if (rest.length > 8) formatted += '-' + rest.slice(8, 10);
    return formatted;
  };

  const handlePhoneChange = (e) => {
    clearError();
    const raw = e.target.value.replace(/\D/g, '');
    setPhone(raw.length <= 1 ? '7' : raw);
  };

  const handleRequestCode = async () => {
    if (phone.length < 11) return;
    try {
      await requestCode('+' + phone);
      setStep('code');
      setCooldown(60);
      const timer = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) { clearInterval(timer); return 0; }
          return c - 1;
        });
      }, 1000);
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch { /* error in store */ }
  };

  const handleVerifyCode = async () => {
    if (code.length < 4) return;
    try {
      const result = await verifyCode('+' + phone, code);
      if (result.status === 'need_pin_setup') {
        navigate('/field/pin-setup', { replace: true });
      } else if (result.status === 'need_pin') {
        navigate('/field/pin-entry', { replace: true });
      } else {
        navigate('/field/home', { replace: true });
      }
    } catch { /* error in store */ }
  };

  const handleCodeChange = (e) => {
    clearError();
    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
    setCode(val);
    if (val.length === 4) {
      setTimeout(() => handleVerifyCode(), 50);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      {/* Logo */}
      <div className="mb-8 text-center">
        <div
          className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
          style={{ background: 'var(--gold-gradient)' }}
        >
          <Shield size={32} className="text-white" />
        </div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          ASGARD Field
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Личный к��бинет рабочего
        </p>
      </div>

      {/* Phone step */}
      {step === 'phone' && (
        <div className="w-full max-w-sm space-y-4">
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
              Номер телефона
            </label>
            <div className="relative">
              <Phone size={18} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
              <input
                type="tel"
                value={formatPhone(phone)}
                onChange={handlePhoneChange}
                placeholder="+7 (___) ___-__-__"
                className="w-full pl-10 pr-4 py-3 rounded-xl text-base"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-norse)',
                  color: 'var(--text-primary)',
                }}
                autoFocus
              />
            </div>
          </div>

          <button
            onClick={handleRequestCode}
            disabled={phone.length < 11 || loading}
            className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
            style={{ background: 'var(--gold-gradient)' }}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
            Получить код
          </button>
        </div>
      )}

      {/* Code step */}
      {step === 'code' && (
        <div className="w-full max-w-sm space-y-4">
          <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
            Код отправлен на {formatPhone(phone)}
          </p>

          <input
            ref={codeInputRef}
            type="tel"
            value={code}
            onChange={handleCodeChange}
            placeholder="____"
            maxLength={4}
            className="w-full text-center text-3xl tracking-[0.5em] py-4 rounded-xl font-mono"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-norse)',
              color: 'var(--text-primary)',
              letterSpacing: '0.5em',
            }}
            autoFocus
          />

          <button
            onClick={handleVerifyCode}
            disabled={code.length < 4 || loading}
            className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
            style={{ background: 'var(--gold-gradient)' }}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : null}
            Подтвердить
          </button>

          <div className="flex items-center justify-between">
            <button
              onClick={() => { setStep('phone'); setCode(''); clearError(); }}
              className="text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Изменить номер
            </button>
            <button
              onClick={handleRequestCode}
              disabled={cooldown > 0 || loading}
              className="text-sm disabled:opacity-50"
              style={{ color: 'var(--gold)' }}
            >
              {cooldown > 0 ? `Повторить (${cooldown}с)` : 'Отправить снова'}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="mt-4 px-4 py-2 rounded-lg text-sm text-center"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--error, #ef4444)' }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
