import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { Lock, Loader2 } from 'lucide-react';

export default function FieldPinSetup() {
  const navigate = useNavigate();
  const { setupPin, subscribePush, loading, error, clearError } = useFieldAuthStore();

  const [step, setStep] = useState('create'); // 'create' | 'confirm'
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const handlePinChange = (e) => {
    clearError();
    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (step === 'create') {
      setPin(val);
      if (val.length === 4) {
        setTimeout(() => setStep('confirm'), 150);
      }
    } else {
      setConfirmPin(val);
      if (val.length === 4) {
        setTimeout(() => handleConfirm(val), 150);
      }
    }
  };

  const handleConfirm = async (confirmed) => {
    const pinToConfirm = confirmed || confirmPin;
    if (pinToConfirm !== pin) {
      useFieldAuthStore.setState({ error: 'PIN не совпадает. Попробуйте снова' });
      setConfirmPin('');
      setStep('create');
      setPin('');
      return;
    }

    try {
      await setupPin(pin);
      // After PIN setup, request push permission
      await subscribePush();
      navigate('/field/home', { replace: true });
    } catch { /* error in store */ }
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
          {step === 'create' ? 'Создайте PIN' : 'Подтвердите PIN'}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          {step === 'create'
            ? '4 цифры для быстрого входа'
            : 'Введите PIN ещё раз'}
        </p>
      </div>

      <div className="w-full max-w-sm">
        {/* PIN dots */}
        <div className="flex justify-center gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => {
            const val = step === 'create' ? pin : confirmPin;
            return (
              <div
                key={i}
                className="w-4 h-4 rounded-full transition-all"
                style={{
                  backgroundColor: i < val.length ? 'var(--gold)' : 'var(--bg-elevated)',
                  border: '2px solid ' + (i < val.length ? 'var(--gold)' : 'var(--border-norse)'),
                  transform: i < val.length ? 'scale(1.2)' : 'scale(1)',
                }}
              />
            );
          })}
        </div>

        <input
          type="tel"
          value={step === 'create' ? pin : confirmPin}
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
