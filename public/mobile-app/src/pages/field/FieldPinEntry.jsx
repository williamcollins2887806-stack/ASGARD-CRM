import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { Lock, Loader2 } from 'lucide-react';

export default function FieldPinEntry() {
  const navigate = useNavigate();
  const { verifyPin, pinLogin, token, employee, loading, error, clearError } = useFieldAuthStore();

  const [pin, setPin] = useState('');

  const handlePinChange = (e) => {
    clearError();
    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
    setPin(val);
    if (val.length === 4) {
      setTimeout(() => handleSubmit(val), 100);
    }
  };

  const handleSubmit = async (pinVal) => {
    try {
      if (token) {
        // We have a valid session token — just verify PIN
        await verifyPin(pinVal || pin);
      } else {
        // Token expired — do PIN login
        await pinLogin(pinVal || pin);
      }
      navigate('/field/home', { replace: true });
    } catch {
      setPin('');
    }
  };

  const handleForgotPin = () => {
    // Clear stored data, go back to SMS login
    useFieldAuthStore.getState().logout();
    navigate('/field-login', { replace: true });
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="mb-8 text-center">
        <div
          className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center"
          style={{ background: 'var(--gold-gradient)' }}
        >
          <Lock size={28} className="text-white" />
        </div>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          Введите PIN
        </h1>
        {employee?.fio && (
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {employee.fio}
          </p>
        )}
      </div>

      <div className="w-full max-w-sm">
        {/* PIN dots */}
        <div className="flex justify-center gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-4 h-4 rounded-full transition-all"
              style={{
                backgroundColor: i < pin.length ? 'var(--gold)' : 'var(--bg-elevated)',
                border: '2px solid ' + (i < pin.length ? 'var(--gold)' : 'var(--border-norse)'),
                transform: i < pin.length ? 'scale(1.2)' : 'scale(1)',
              }}
            />
          ))}
        </div>

        <input
          type="tel"
          value={pin}
          onChange={handlePinChange}
          maxLength={4}
          className="w-full text-center text-3xl tracking-[0.5em] py-4 rounded-xl font-mono"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-norse)',
            color: 'var(--text-primary)',
            caretColor: 'transparent',
          }}
          autoFocus
        />

        {loading && (
          <div className="flex justify-center mt-4">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--gold)' }} />
          </div>
        )}

        <button
          onClick={handleForgotPin}
          className="w-full mt-6 text-sm text-center"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Забыли PIN? Войти через SMS
        </button>
      </div>

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
