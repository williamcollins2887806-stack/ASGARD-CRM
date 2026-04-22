import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Wallet, History, Users, Truck, UserCircle,
  MapPin, AlertCircle, RefreshCw, Play, Square,
  Phone, Briefcase, Camera, FileText, AlertTriangle, Package, DollarSign, Map,
} from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { useHaptic } from '@/hooks/useHaptic';

const fmtMoney = (n) => n != null ? Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽' : null;

const VIKING_QUOTES = [
  'Не бойся медленного продвижения — бойся остановки',
  'Лучше быть волком один день, чем овцой всю жизнь',
  'В бурю кормчий познаётся',
  'Каждый день — поход за славой',
  'Кто рано встаёт, тому Один даёт',
  'Сильный духом побеждает сильного телом',
  'Дела говорят громче рун',
  'Мудрый путник далеко не заходит в одиночку',
  'Своё железо куй, пока горячо',
  'Даже Тор пахал прежде, чем метал молнии',
  'Слава приходит к тому, кто работает молча',
  'Валгалла ждёт тех, кто не сдаётся',
  'Рука помощи ближе, чем ты думаешь',
  'Один весло не сдвинет корабль',
  'Битва выиграна до рассвета — подготовкой',
  'Нет плохой погоды — есть слабые воины',
  'Щит ломается — дух крепчает',
  'Асгард строится каждый день',
  'Один мудрый сказал: «Рано встал — уже победил»',
  'Новый день — новый поход за славой!',
  'Руки крепкие, дух несгибаемый — вперёд!',
  'Настоящий воин не ждёт команды — он готов',
  'Сегодня мы делаем то, что другие не могут',
  'Рассвет принадлежит тем, кто не боится работы',
  'Один за всех, все за Асгард!',
  'Воин не жалуется — воин действует',
];

function randomQuote() { return VIKING_QUOTES[Math.floor(Math.random() * VIKING_QUOTES.length)]; }

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

function shortFio(fio) {
  if (!fio) return '';
  const p = fio.trim().split(/\s+/);
  if (p.length >= 3) return `${p[0]} ${p[1][0]}.${p[2][0]}.`;
  if (p.length === 2) return `${p[0]} ${p[1][0]}.`;
  return p[0];
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

const STAGE_LABELS = { medical: 'Медосмотр', travel: 'Дорога', waiting: 'Ожидание', warehouse: 'Склад', day_off: 'Выходной' };
const STAGE_COLORS = { medical: '#9333EA', travel: '#3B82F6', waiting: '#F59E0B', warehouse: '#F97316', day_off: '#9CA3AF' };
const STAGE_ICONS = { medical: '🏥', travel: '✈️', waiting: '⏳', warehouse: '📦', day_off: '🛏' };

const GAMIFICATION_TILES = [
  { emoji: '🎰', label: 'Рулетка', path: '/field/wheel', bg: 'linear-gradient(135deg,#3a0a10,#1a0508)', border: 'rgba(232,64,87,.25)' },
  { emoji: '🛍', label: 'Магазин', path: '/field/shop', bg: 'linear-gradient(135deg,#2a2008,#1a1505)', border: 'rgba(240,200,80,.25)' },
  { emoji: '🎁', label: 'Инвентарь', path: '/field/inventory', bg: 'linear-gradient(135deg,#0a1a2a,#081020)', border: 'rgba(74,144,255,.25)' },
  { emoji: '⚔️', label: 'Квесты', path: '/field/quests', bg: 'linear-gradient(135deg,#1a0a2a,#100818)', border: 'rgba(165,110,255,.25)' },
];

export default function FieldHome() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const employee = useFieldAuthStore((s) => s.employee);

  const [data, setData] = useState(null);
  const [currentStage, setCurrentStage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [quote] = useState(randomQuote);
  const timerRef = useRef(null);
  const touchStartY = useRef(0);
  const [pulling, setPulling] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await fieldApi.get('/worker/active-project');
      setData(res);
      // Load current trip stage
      const workId = res?.project?.work_id;
      if (workId) {
        fieldApi.get(`/stages/my/current/${workId}`).then(setCurrentStage).catch(() => {});
      }
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
    const checkin = data?.today_checkin || data?.project?.today_checkin;
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
      const wid = data?.project?.work_id || data?.assignment?.work_id;
      await fieldApi.post('/checkin/', { work_id: wid, ...geo });
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
  const project = data?.project;
  const checkin = data?.today_checkin || project?.today_checkin;
  const isActive = checkin && !checkin.checkout_at;
  const isActiveAssignment = project?.is_active !== false;
  const isMaster = employee?.field_role === 'shift_master' || employee?.field_role === 'senior_master' || project?.field_role?.includes('master');

  // Earnings breakdown
  const perDiem = parseFloat(project?.per_diem || 0);
  const checkinAmount = checkin?.status === 'completed' ? parseFloat(checkin.amount_earned || 0) : 0;
  const todayEarned = checkinAmount > 0 ? checkinAmount + perDiem : 0;

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl h-24 animate-pulse" style={{ backgroundColor: 'var(--bg-elevated)' }} />
        ))}
      </div>
    );
  }

  // Build quick actions
  const actions = [
    { icon: Briefcase, label: 'Мои работы', path: '/field/my-works' },
    { icon: Users, label: 'Бригада', path: '/field/crew' },
    { icon: Wallet, label: 'Деньги', path: '/field/money' },
    { icon: Map, label: 'Маршрут', path: '/field/stages' },
    { icon: Truck, label: 'Билеты', path: '/field/logistics' },
    { icon: Camera, label: 'Фото', path: '/field/photos' },
    { icon: History, label: 'История', path: '/field/history' },
    { icon: DollarSign, label: 'Выплаты', path: '/field/earnings' },
  ];
  if (isMaster) {
    actions.push(
      { icon: FileText, label: 'Отчёт', path: '/field/report' },
      { icon: AlertTriangle, label: 'Инцидент', path: '/field/incidents' },
      { icon: Wallet, label: 'Подотчёт', path: '/field/funds' },
      { icon: Package, label: 'Сборы', path: '/field/packing' },
    );
  }
  actions.push({ icon: UserCircle, label: 'Профиль', path: '/field/profile' });

  return (
    <div className="p-4 pb-24 min-h-screen" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ backgroundColor: 'var(--bg-primary)' }}>
      {pulling && (
        <div className="flex justify-center py-2">
          <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--gold)' }} />
        </div>
      )}

      {/* Greeting + Viking quote */}
      <div className="mb-5">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{getGreeting()}, {firstName}</h1>
        <p className="text-sm capitalize mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{fmtDate()}</p>
        <p className="text-xs italic mt-2" style={{ color: 'var(--text-tertiary)' }}>«{quote}»</p>
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
              {isActiveAssignment ? '▶ Активный проект' : '✔ Завершён'}
            </span>
          </div>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{project.work_title || project.title || project.object_name}</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {[project.city, project.object_name].filter(Boolean).join(' · ')}
          </p>

          {/* PM + Masters call buttons */}
          <div className="flex flex-wrap gap-2 mt-3">
            {project.pm?.fio && (
              <a href={`tel:${(project.pm.phone || '').replace(/[^\d+]/g, '')}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                <Phone size={12} style={{ color: 'var(--gold)' }} />
                РП: {shortFio(project.pm.fio)}
              </a>
            )}
            {project.masters?.map((m, i) => (
              <a key={i} href={`tel:${(m.phone || '').replace(/[^\d+]/g, '')}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                <Phone size={12} style={{ color: 'var(--gold)' }} />
                {m.role === 'senior_master' ? 'Ст. маст.' : 'Маст.'}: {shortFio(m.fio)}
              </a>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-6 mb-4 text-center"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <MapPin size={32} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>Нет активного проекта</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>Отдыхай, воин!</p>
        </div>
      )}

      {/* Current trip stage card */}
      {currentStage && currentStage.stage_type && currentStage.stage_type !== 'object' && (
        <button onClick={() => navigate('/field/stages')}
          className="w-full rounded-xl p-4 mb-4 text-left"
          style={{ backgroundColor: 'var(--bg-elevated)', border: `2px solid ${STAGE_COLORS[currentStage.stage_type] || '#3B82F6'}` }}>
          <p className="font-semibold" style={{ color: STAGE_COLORS[currentStage.stage_type] || '#3B82F6' }}>
            {STAGE_ICONS[currentStage.stage_type] || ''} {STAGE_LABELS[currentStage.stage_type] || currentStage.stage_type}
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {Math.max(1, Math.floor((Date.now() - new Date(currentStage.date_from).getTime()) / 86400000) + 1)}-й день
            {currentStage.rate_per_day ? ` · ~${fmtMoney(Math.max(1, Math.floor((Date.now() - new Date(currentStage.date_from).getTime()) / 86400000) + 1) * parseFloat(currentStage.rate_per_day))}` : ''}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--gold)' }}>Подробнее →</p>
        </button>
      )}

      {/* "Left site" info card */}
      {project && !isActiveAssignment && (
        <div className="rounded-xl p-4 mb-4 text-center"
          style={{ backgroundColor: 'rgba(255,165,0,0.08)', border: '1px solid rgba(255,165,0,0.2)' }}>
          <div className="text-2xl mb-1">⚫</div>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Вы уехали с объекта</p>
          {project.date_to && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Отъезд: {new Date(project.date_to).toLocaleDateString('ru-RU')}
            </p>
          )}
        </div>
      )}

      {/* Shift block */}
      {project && isActiveAssignment && (
        <div className="rounded-xl p-4 mb-4"
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
                <div className="text-center text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                  <p>Сегодня: <span className="font-semibold" style={{ color: 'var(--gold)' }}>{fmtMoney(todayEarned)}</span></p>
                  {checkinAmount > 0 && perDiem > 0 && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      {fmtMoney(checkinAmount)} смена + {fmtMoney(perDiem)} пайковые
                    </p>
                  )}
                </div>
              )}
              <button disabled={actionLoading} onClick={handleCheckin}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--gold), #b8860b)' }}>
                {actionLoading ? 'Отмечаемся...' : '⚔️ Начать смену'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Tariff card */}
      {project?.tariff && (
        <div className="rounded-xl p-3 mb-4"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>Тариф</p>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            {project.tariff.position_name} · {project.tariff.points} баллов
          </p>
          {project.tariff.combination && (
            <p className="text-xs mt-1" style={{ color: 'var(--gold)' }}>
              + Совмещение: {project.tariff.combination.position_name} (+1 балл)
            </p>
          )}
        </div>
      )}

      {/* Gamification tiles */}
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide px-1 mb-2" style={{ color: 'var(--text-tertiary)', letterSpacing: '.1em' }}>
          ⚔ Геймификация
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
      <div className="grid grid-cols-4 gap-3">
        {actions.map(({ icon: Icon, label, path }) => (
          <button key={path + label} onClick={() => { haptic.light(); navigate(path); }}
            className="flex flex-col items-center gap-2 py-3 px-1 rounded-xl active:scale-95 transition-transform"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <Icon size={20} style={{ color: 'var(--gold)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
