import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { Eye, EyeOff } from 'lucide-react';

/** Floating rune particles */
const RUNES = [
  { char: 'ᚱ', x: 8,  delay: 0,   dur: 7,  size: 18 },
  { char: 'ᚨ', x: 22, delay: 1.2, dur: 9,  size: 14 },
  { char: 'ᚷ', x: 45, delay: 2.5, dur: 8,  size: 20 },
  { char: 'ᚾ', x: 65, delay: 0.8, dur: 10, size: 16 },
  { char: 'ᛟ', x: 80, delay: 3,   dur: 7.5, size: 15 },
  { char: 'ᚲ', x: 35, delay: 4,   dur: 8.5, size: 13 },
  { char: 'ᛏ', x: 55, delay: 1.5, dur: 9.5, size: 17 },
  { char: 'ᛒ', x: 90, delay: 2,   dur: 6.5, size: 14 },
];

export default function Login() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [mounted, setMounted] = useState(false);
  const doLogin = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const haptic = useHaptic();

  const from = location.state?.from?.pathname || '/';

  useEffect(() => {
    setTimeout(() => setMounted(true), 100);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!login.trim() || !password.trim()) return;
    setLoading(true);
    setError('');
    haptic.light();

    try {
      const result = await doLogin(login.trim(), password);
      setSuccess(true);
      haptic.success();
      setTimeout(() => {
        if (result.status === 'need_pin' || result.status === 'need_setup') {
          navigate('/pin', { replace: true });
        } else {
          navigate(from, { replace: true });
        }
      }, 800);
    } catch {
      setError('Неверный логин или пароль');
      haptic.error();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative flex flex-col items-center justify-center min-h-screen px-6 overflow-hidden"
      style={{
        backgroundColor: '#050508',
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'var(--safe-bottom)',
      }}
    >
      {/* === AURORA BACKGROUND === */}
      <div className="absolute inset-0 login-aurora" />

      {/* Radial color orbs — soft aurora spots */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="login-orb login-orb-blue" />
        <div className="login-orb login-orb-red" />
        <div className="login-orb login-orb-gold" />
      </div>

      {/* === FLOATING RUNE PARTICLES === */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        {RUNES.map((r, i) => (
          <span
            key={i}
            className="absolute c-gold"
            style={{
              left: `${r.x}%`,
              bottom: '-20px',
              fontSize: r.size,
              opacity: 0,
              animation: `loginRuneFloat ${r.dur}s ease-in-out ${r.delay}s infinite`,
            }}
          >
            {r.char}
          </span>
        ))}
      </div>

      {/* === LOGO SECTION — настоящий логотип ASGARD CRM === */}
      <div
        className="flex flex-col items-center mb-10 relative z-10"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted
            ? (success ? 'translateY(0) scale(1.05)' : 'translateY(0) scale(1)')
            : 'translateY(24px) scale(0.85)',
          transition: 'all 0.9s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Glow rings behind logo */}
        <div className="relative">
          <div
            className="absolute rounded-full"
            style={{
              inset: -28,
              border: '1px solid rgba(200, 41, 59, 0.06)',
              animation: 'loginRingPulse 4s ease-in-out infinite',
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              inset: -14,
              border: '1px solid rgba(30, 77, 140, 0.1)',
              animation: 'loginRingPulse 4s ease-in-out 0.6s infinite',
            }}
          />

          {/* Logo image with glow */}
          <div
            className="relative"
            style={{
              filter: success
                ? 'drop-shadow(0 0 40px rgba(200, 41, 59, 0.6)) drop-shadow(0 0 80px rgba(30, 77, 140, 0.4))'
                : 'drop-shadow(0 0 20px rgba(200, 41, 59, 0.25)) drop-shadow(0 0 40px rgba(30, 77, 140, 0.15))',
              transition: 'filter 0.6s ease',
            }}
          >
            <img
              src={import.meta.env.BASE_URL + 'asgard-logo.png'}
              alt="ASGARD CRM"
              draggable={false}
              style={{
                width: 160,
                height: 'auto',
                userSelect: 'none',
              }}
            />
          </div>
        </div>

        {/* Subtitle */}
        <p
          className="text-[11px] mt-3 tracking-[0.06em] c-tertiary"
        >
          Управление бизнесом
        </p>
      </div>

      {/* === FORM === */}
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 relative z-10"
      >
        {/* Login field */}
        <div
          className="space-y-2"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(16px)',
            transition: 'all 0.6s ease 0.3s',
          }}
        >
          <label
            className="text-[10px] font-semibold uppercase tracking-[0.1em] pl-1"
            style={{ color: 'rgba(212, 168, 67, 0.5)' }}
          >
            Логин
          </label>
          <div className="relative">
            <input
              type="text"
              placeholder="Введите логин"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              className="w-full h-[52px] rounded-2xl px-4 text-[15px] border-0 outline-none login-input c-primary"
              style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                caretColor: 'var(--gold)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            />
            {/* Gold underline glow */}
            <div
              className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full"
              style={{
                background: login ? 'var(--gold-gradient)' : 'transparent',
                boxShadow: login ? '0 0 12px rgba(212, 168, 67, 0.4)' : 'none',
                opacity: login ? 1 : 0,
                transition: 'all 0.3s ease',
              }}
            />
          </div>
        </div>

        {/* Password field */}
        <div
          className="space-y-2"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(16px)',
            transition: 'all 0.6s ease 0.45s',
          }}
        >
          <label
            className="text-[10px] font-semibold uppercase tracking-[0.1em] pl-1"
            style={{ color: 'rgba(212, 168, 67, 0.5)' }}
          >
            Пароль
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Введите пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full h-[52px] rounded-2xl px-4 pr-12 text-[15px] border-0 outline-none login-input c-primary"
              style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                caretColor: 'var(--gold)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full c-tertiary"
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
            <div
              className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full"
              style={{
                background: password ? 'var(--gold-gradient)' : 'transparent',
                boxShadow: password ? '0 0 12px rgba(212, 168, 67, 0.4)' : 'none',
                opacity: password ? 1 : 0,
                transition: 'all 0.3s ease',
              }}
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm c-red"
            style={{
              backgroundColor: 'rgba(198, 40, 40, 0.12)',
              border: '1px solid rgba(198, 40, 40, 0.15)',
              animation: 'fadeInUp 0.2s ease forwards',
            }}
          >
            {error}
          </div>
        )}

        {/* Submit button */}
        <div
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(16px)',
            transition: 'all 0.6s ease 0.6s',
          }}
        >
          <button
            type="submit"
            disabled={loading || !login.trim() || !password.trim()}
            className="w-full h-[52px] rounded-2xl text-[15px] font-bold border-0 spring-tap relative overflow-hidden"
            style={{
              background: success
                ? 'linear-gradient(135deg, #D4A843, #c8a040)'
                : 'linear-gradient(135deg, #C8293B 0%, #1E4D8C 100%)',
              color: '#fff',
              boxShadow: success
                ? '0 4px 24px rgba(212, 168, 67, 0.5)'
                : '0 4px 24px rgba(30, 77, 140, 0.4), 0 0 40px rgba(200, 41, 59, 0.15)',
              transition: 'all 0.4s ease',
              opacity: (!login.trim() || !password.trim()) && !loading ? 0.4 : 1,
              letterSpacing: '0.03em',
            }}
          >
            {/* Shimmer sweep */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%)',
                animation: 'loginBtnShimmer 3s ease-in-out infinite',
              }}
            />
            <span className="relative z-10">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span
                    className="inline-block h-4 w-4 rounded-full animate-spin"
                    style={{ border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff' }}
                  />
                  Вход...
                </span>
              ) : success ? (
                '✓ Добро пожаловать'
              ) : (
                'Войти'
              )}
            </span>
          </button>
        </div>
      </form>

      {/* Footer */}
      <p
        className="mt-12 text-[10px] font-medium relative z-10 tracking-wider uppercase"
        style={{ color: 'rgba(255,255,255,0.15)' }}
      >
        Асгард Сервис © 2026
      </p>

      {/* === SCOPED STYLES === */}
      <style>{`
        .login-aurora {
          background: linear-gradient(-45deg,
            #050510, #0a1628, #0d0a1e, #08121f,
            #120a18, #050510, #0a1525, #0d0a20
          );
          background-size: 400% 400%;
          animation: loginAuroraShift 25s ease infinite;
        }
        @keyframes loginAuroraShift {
          0%   { background-position: 0% 50%; }
          25%  { background-position: 50% 25%; }
          50%  { background-position: 100% 50%; }
          75%  { background-position: 50% 75%; }
          100% { background-position: 0% 50%; }
        }

        .login-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          animation: loginOrbDrift 12s ease-in-out infinite;
        }
        .login-orb-blue {
          width: 300px; height: 300px;
          top: 5%; left: -10%;
          background: radial-gradient(circle, rgba(30,77,140,0.25), transparent 70%);
        }
        .login-orb-red {
          width: 250px; height: 250px;
          bottom: 15%; right: -10%;
          background: radial-gradient(circle, rgba(200,41,59,0.18), transparent 70%);
          animation-delay: -4s;
        }
        .login-orb-gold {
          width: 200px; height: 200px;
          top: 35%; left: 30%;
          background: radial-gradient(circle, rgba(212,168,67,0.08), transparent 70%);
          animation-delay: -8s;
        }
        @keyframes loginOrbDrift {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(30px, -20px) scale(1.1); }
          66%      { transform: translate(-20px, 15px) scale(0.95); }
        }

        @keyframes loginRuneFloat {
          0%   { transform: translateY(0) rotate(0deg); opacity: 0; }
          10%  { opacity: 0.07; }
          70%  { opacity: 0.04; }
          100% { transform: translateY(-100vh) rotate(35deg); opacity: 0; }
        }

        @keyframes loginRingPulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50%      { transform: scale(1.15); opacity: 0; }
        }

        @keyframes loginBtnShimmer {
          0%, 100% { transform: translateX(-150%); }
          50%      { transform: translateX(150%); }
        }

        .login-input:focus {
          border-color: rgba(212, 168, 67, 0.25) !important;
          box-shadow: 0 0 0 1px rgba(212, 168, 67, 0.1), 0 0 20px rgba(212, 168, 67, 0.05);
        }
        .login-input::placeholder {
          color: rgba(255,255,255,0.2);
        }

        .light .login-aurora {
          background: linear-gradient(-45deg,
            #e8eaf6, #c5cae9, #e1bee7, #bbdefb,
            #d1c4e9, #e8eaf6, #c5cae9, #e1bee7
          );
          background-size: 400% 400%;
          animation: loginAuroraShift 25s ease infinite;
        }
        .light .login-orb-blue {
          background: radial-gradient(circle, rgba(30,77,140,0.12), transparent 70%);
        }
        .light .login-orb-red {
          background: radial-gradient(circle, rgba(200,41,59,0.08), transparent 70%);
        }
        .light .login-orb-gold {
          background: radial-gradient(circle, rgba(212,168,67,0.1), transparent 70%);
        }
        .light .login-input {
          background-color: rgba(0,0,0,0.04) !important;
          border-color: rgba(0,0,0,0.08) !important;
        }
        .light .login-input::placeholder {
          color: rgba(0,0,0,0.25);
        }
      `}</style>
    </div>
  );
}
