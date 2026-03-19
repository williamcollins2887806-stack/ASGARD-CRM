import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { AsgardLogo } from '@/components/shared/AsgardLogo';
import { Delete, LogOut } from 'lucide-react';

const PIN_LENGTH = 4;

export default function PinEntry() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [success, setSuccess] = useState(false);
  const verifyPin = useAuthStore((s) => s.verifyPin);
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const haptic = useHaptic();

  const handleDigit = useCallback(async (digit) => {
    if (loading || success) return;
    setError('');
    haptic.light();

    const next = pin + digit;
    setPin(next);

    if (next.length === PIN_LENGTH) {
      setLoading(true);
      try {
        await verifyPin(next);
        setSuccess(true);
        haptic.success();
        // Golden flash delay then navigate
        setTimeout(() => {
          navigate('/', { replace: true });
        }, 700);
      } catch {
        setError('Неверный PIN-код');
        setShake(true);
        haptic.error();
        setTimeout(() => setShake(false), 500);
        setPin('');
        setLoading(false);
      }
    }
  }, [pin, loading, success, verifyPin, navigate, haptic]);

  const handleDelete = useCallback(() => {
    if (loading || success) return;
    haptic.light();
    setPin((prev) => prev.slice(0, -1));
    setError('');
  }, [loading, success, haptic]);

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'del'];

  return (
    <div
      className="flex flex-col items-center justify-between min-h-screen"
      style={{
        backgroundColor: 'var(--bg-primary)',
        paddingTop: 'calc(var(--safe-top) + 48px)',
        paddingBottom: 'calc(var(--safe-bottom) + 24px)',
      }}
    >
      {/* Top section */}
      <div className="flex flex-col items-center page-enter">
        {/* Avatar / Logo */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mb-4 relative"
          style={{
            background: 'var(--hero-gradient)',
            boxShadow: success
              ? '0 0 24px rgba(200, 168, 78, 0.5)'
              : '0 4px 20px rgba(26, 74, 138, 0.25)',
            transition: 'box-shadow var(--motion-normal) var(--ease-smooth)',
          }}
        >
          {user?.name ? (
            <span className="text-xl font-bold text-white">
              {user.name.charAt(0).toUpperCase()}
            </span>
          ) : (
            <AsgardLogo size="sm" animate={false} />
          )}
        </div>

        {/* User name */}
        <p
          className="text-base font-semibold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          {user?.name || 'ASGARD'}
        </p>
        <p
          className="text-sm mb-8"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Введите PIN-код
        </p>

        {/* PIN dots */}
        <div
          className="flex items-center gap-4 mb-4"
          style={{
            animation: shake ? 'shakePin 0.5s ease-in-out' : 'none',
          }}
        >
          {Array.from({ length: PIN_LENGTH }).map((_, i) => {
            const filled = i < pin.length;
            const isLatest = i === pin.length - 1 && pin.length > 0;
            const allSuccess = success;

            return (
              <div
                key={i}
                className="w-3.5 h-3.5 rounded-full"
                style={{
                  backgroundColor: allSuccess ? 'var(--gold)' : filled ? 'var(--gold)' : 'var(--bg-elevated)',
                  transform: isLatest ? 'scale(1.3)' : filled ? 'scale(1.15)' : 'scale(1)',
                  boxShadow: allSuccess
                    ? '0 0 16px rgba(200, 168, 78, 0.6)'
                    : filled ? '0 0 8px var(--gold-glow)' : 'none',
                  transition: 'all var(--motion-fast) var(--ease-spring)',
                  animation: isLatest ? 'dotBounce 0.3s var(--ease-spring)' :
                             allSuccess ? `dotBurst 0.5s var(--ease-spring) ${i * 80}ms` : 'none',
                }}
              />
            );
          })}
        </div>

        {/* Error / Loading */}
        <div className="h-6 flex items-center">
          {error && (
            <p className="text-sm" style={{ color: 'var(--red-soft)' }}>
              {error}
            </p>
          )}
          {loading && !success && (
            <div
              className="h-4 w-4 rounded-full animate-spin"
              style={{
                border: '2px solid var(--bg-elevated)',
                borderTopColor: 'var(--gold)',
              }}
            />
          )}
          {success && (
            <p className="text-sm font-medium" style={{ color: 'var(--gold)' }}>
              Добро пожаловать
            </p>
          )}
        </div>
      </div>

      {/* Numpad */}
      <div className="w-full max-w-[280px] px-4">
        <div className="grid grid-cols-3 gap-y-3 gap-x-6">
          {digits.map((d, i) => {
            if (d === null) {
              return <div key={`empty-${i}`} />;
            }

            if (d === 'del') {
              return (
                <button
                  key="del"
                  onClick={handleDelete}
                  className="flex items-center justify-center h-[64px] rounded-full spring-tap"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <Delete size={24} />
                </button>
              );
            }

            return (
              <button
                key={d}
                onClick={() => handleDigit(d)}
                className="flex items-center justify-center h-[64px] w-[64px] mx-auto rounded-full spring-tap ripple-container text-2xl font-light"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  transition: 'background-color var(--motion-fast) var(--ease-smooth)',
                }}
              >
                {d}
              </button>
            );
          })}
        </div>

        {/* Logout link */}
        <button
          onClick={logout}
          className="flex items-center justify-center gap-2 w-full mt-6 py-3 spring-tap"
        >
          <LogOut size={16} style={{ color: 'var(--red-soft)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--red-soft)' }}>
            Сменить аккаунт
          </span>
        </button>
      </div>

      <style>{`
        @keyframes shakePin {
          0%, 100% { transform: translateX(0); }
          10%, 50%, 90% { transform: translateX(-8px); }
          30%, 70% { transform: translateX(8px); }
        }
      `}</style>
    </div>
  );
}
