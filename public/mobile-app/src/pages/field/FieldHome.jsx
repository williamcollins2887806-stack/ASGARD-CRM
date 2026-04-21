import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Wallet, History, Users, Truck, UserCircle,
  MapPin, AlertCircle, RefreshCw, Play, Square,
} from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { useHaptic } from '@/hooks/useHaptic';

const fmtMoney = (n) => n != null ? Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD' : null;

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function fmtDate() {
  return new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
}

function fmtTimer(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve({}),
      { timeout: 8000, enableHighAccuracy: true }
    );
  });
}

const ACTIONS = [
  { icon: Clock, label: 'Смена', path: '/m/field/shift' },
  { icon: Wallet, label: 'Деньги', path: '/m/field/money' },
  { icon: History, label: 'История', path: '/m/field/history' },
  { icon: Users, label: 'Бригада', path: '/m/field/crew' },
  { icon: Truck, label: 'Логистика', path: '/m/field/logistics' },
  { icon: UserCircle, label: 'Профиль', path: '/m/field/profile' },
];

const GAMIFICATION_TILES = [
  { emoji: '\uD83C\uDFB0', label: 'Рулетка', path: '/m/field/wheel', bg: 'linear-gradient(135deg,#3a0a10,#1a0508)', border: 'rgba(232,64,87,.25)' },
  { emoji: '\uD83D\uDECD', label: 'Магазин', path: '/m/field/shop', bg: 'linear-gradient(135deg,#2a2008,#1a1505)', border: 'rgba(240,200,80,.25)' },
  { emoji: '\uD83C\uDF81', label: 'Инвентарь', path: '/m/field/inventory', bg: 'linear-gradient(135deg,#0a1a2a,#081020)', border: 'rgba(74,144,255,.25)' },
  { emoji: '\u2694\uFE0F', label: 'Квесты', path: '/m/field/quests', bg: 'linear-gradient(135deg,#1a0a2a,#100818)', border: 'rgba(165,110,255,.25)' },
];

export default function FieldHome() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const employee = useFieldAuthStore((s) => s.employee);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const touchStartY = useRef(0);
  const [pulling, setPulling] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await fieldApi.get('/worker/active-project');
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Live timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const checkin = data?.today_checkin;
    if (!checkin || checkin.checkout_at) return;
    const start = new Date(checkin.checkin_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [data]);

  const handleCheckin = async () => {
    haptic.medium();
    setActionLoading(true);
    try {
      const geo = await getGeo();
      await fieldApi.post('/checkin/', { work_id: data.assignment?.work_id, ...geo });
      haptic.success();
      await fetchData();
    } catch (e) {
      haptic.error();
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckout = async () => {
    haptic.medium();
    setActionLoading(true);
    try {
      const geo = await getGeo();
      await fieldApi.post('/checkin/checkout', geo);
      haptic.success();
      await fetchData();
    } catch (e) {
      haptic.error();
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Pull to refresh
  const onTouchStart = (e) => { touchStartY.current = e.touches[0].clientY; };
  const onTouchEnd = async (e) => {
    if (pulling) return;
    const diff = e.changedTouches[0].clientY - touchStartY.current;
    if (diff > 80 && window.scrollY === 0) {
      setPulling(true);
      await fetchData();
      setPulling(false);
    }
  };

  const firstName = employee?.name?.split(' ')[0] || 'Работник';
  const checkin = data?.today_checkin;
  const isActive = checkin && !checkin.checkout_at;
  const project = data?.project;

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl h-24 animate-pulse" style={{ backgroundColor: 'var(--bg-elevated)' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 min-h-screen" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ backgroundColor: 'var(--bg-primary)' }}>
      {pulling && (
        <div className="flex justify-center py-2">
          <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--gold)' }} />
        </div>
      )}

      {/* Greeting */}
      <div className="mb-5">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{getGreeting()}, {firstName}</h1>
        <p className="text-sm capitalize mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{fmtDate()}</p>
      </div>

      {/* Error toast */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3 mb-4"
          style={{ backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <AlertCircle size={18} color="#ef4444" />
          <span className="text-sm" style={{ color: '#ef4444' }}>{error}</span>
        </div>
      )}

      {/* Active Project */}
      {project ? (
        <div className="rounded-xl p-4 mb-4"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <div className="flex items-center gap-2 mb-2">
            <MapPin size={16} style={{ color: 'var(--gold)' }} />
            <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
              Активный проект
            </span>
          </div>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{project.title || project.object_name}</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {[project.city, project.object_name].filter(Boolean).join(' \u2022 ')}
          </p>
        </div>
      ) : (
        <div className="rounded-xl p-6 mb-4 text-center"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <MapPin size={32} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>Нет активного проекта</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>Обратитесь к руководителю</p>
        </div>
      )}

      {/* Shift block */}
      {project && (
        <div className="rounded-xl p-4 mb-5"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          {isActive ? (
            <>
              <div className="text-center mb-3">
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-tertiary)' }}>Смена идёт</p>
                <p className="text-3xl font-mono font-bold" style={{ color: 'var(--gold)' }}>{fmtTimer(elapsed)}</p>
              </div>
              {checkin.amount_earned != null && (
                <p className="text-center text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                  Заработано: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtMoney(checkin.amount_earned)}</span>
                </p>
              )}
              <button disabled={actionLoading} onClick={handleCheckout}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm disabled:opacity-50"
                style={{ backgroundColor: '#ef4444' }}>
                {actionLoading ? 'Завершаем...' : 'Завершить смену'}
              </button>
            </>
          ) : (
            <>
              {checkin?.checkout_at && checkin.amount_earned != null && (
                <p className="text-center text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                  Сегодня: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtMoney(checkin.amount_earned)}</span>
                </p>
              )}
              <button disabled={actionLoading} onClick={handleCheckin}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--gold), #b8860b)' }}>
                {actionLoading ? 'Отмечаемся...' : 'Начать смену'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Gamification tiles — Norse style */}
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide px-1 mb-2" style={{ color: 'var(--text-tertiary)', letterSpacing: '.1em' }}>
          {'\u2694'} Геймификация
        </p>
        <div className="grid grid-cols-2 gap-3">
          {GAMIFICATION_TILES.map(({ emoji, label, path, bg, border }) => (
            <button key={path} onClick={() => { haptic.medium(); navigate(path); }}
              className="flex items-center gap-3 p-4 rounded-2xl active:scale-95 transition-transform"
              style={{ background: bg, border: `1.5px solid ${border}`, boxShadow: '0 4px 16px rgba(0,0,0,.2)' }}>
              <span style={{ fontSize: 28, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.3))' }}>{emoji}</span>
              <span className="text-sm font-bold" style={{ color: '#fff' }}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-3">
        {ACTIONS.map(({ icon: Icon, label, path }) => (
          <button key={path} onClick={() => { haptic.light(); navigate(path); }}
            className="flex flex-col items-center gap-2 py-4 rounded-xl active:scale-95 transition-transform"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <Icon size={22} style={{ color: 'var(--gold)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
