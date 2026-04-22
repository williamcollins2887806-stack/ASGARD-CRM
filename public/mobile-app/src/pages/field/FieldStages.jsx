import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Truck, Play, Square, MapPin, Plane, Building, Clock, Camera } from 'lucide-react';

const STAGE_CONFIG = {
  medical: { label: 'Медосмотр', icon: '🏥', color: '#9333EA' },
  travel: { label: 'Дорога', icon: '✈️', color: '#3B82F6' },
  waiting: { label: 'Ожидание', icon: '⏳', color: '#F59E0B' },
  warehouse: { label: 'Склад', icon: '📦', color: '#F97316' },
  day_off: { label: 'Выходной', icon: '🛏', color: '#9CA3AF' },
  object: { label: 'На объекте', icon: '⚔️', color: '#22C55E' },
};

const STATUS_LABELS = { planned: 'Запланирован', active: 'Активный', completed: 'Завершён', approved: 'Подтверждён', adjusted: 'Скорректирован', rejected: 'Отклонён' };
const STATUS_ICONS = { completed: '✅', approved: '✅', adjusted: '✅', active: '🔵', planned: '⚬', rejected: '❌' };

const QUOTES = {
  medical: '🏥 Здоровье воина — основа победы!',
  travel: '✈️ Дорога зовёт! Удачного пути, воин',
  warehouse: '📦 Склад ждёт крепких рук!',
  waiting: '⏳ Ожидание — тоже часть похода',
};

const fmt = (n) => (n || 0).toLocaleString('ru-RU');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';

function stageDay(dateFrom) {
  return Math.max(1, Math.floor((Date.now() - new Date(dateFrom).getTime()) / 86400000) + 1);
}

export default function FieldStages() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [project, setProject] = useState(null);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(null); // stage_type for form
  const [formData, setFormData] = useState({});

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setLoading(true);
      const projData = await fieldApi.get('/worker/active-project');
      const proj = projData?.project || projData;
      setProject(proj);
      const wid = proj?.work_id || proj?.id;
      if (wid) {
        const stageData = await fieldApi.get(`/stages/my/${wid}`);
        const list = Array.isArray(stageData) ? stageData : stageData?.stages || stageData?.rows || [];
        setStages(list);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function startStage(type, details) {
    haptic.medium();
    setStarting(true);
    try {
      await fieldApi.post('/stages/my/start', { stage_type: type, details });
      haptic.success();
      setShowAddForm(null);
      setFormData({});
      loadData();
    } catch (e) { setError(e.message); }
    finally { setStarting(false); }
  }

  async function endStage() {
    haptic.medium();
    try {
      await fieldApi.post('/stages/my/end');
      haptic.success();
      loadData();
    } catch (e) { setError(e.message); }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
      </div>
    );
  }

  const preObject = stages.filter(s => s.stage_type !== 'object' && s.status !== 'rejected');
  const heroEarned = preObject.reduce((s, st) => s + parseFloat(st.amount_earned || 0), 0);
  const heroDays = preObject.reduce((s, st) => s + (st.days_approved || st.days_count || 0), 0);

  const activeStages = stages.filter(s => s.status === 'active');
  const completedStages = stages.filter(s => ['completed', 'approved', 'adjusted'].includes(s.status));
  const plannedStages = stages.filter(s => s.status === 'planned');

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Мой маршрут</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* Hero card — earned before object */}
      {preObject.length > 0 && (
        <div className="rounded-xl p-5 relative overflow-hidden" style={{
          background: 'linear-gradient(135deg, var(--bg-elevated) 0%, rgba(196,154,42,0.08) 100%)',
          border: '1px solid var(--border-norse)',
        }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Заработано до объекта
          </p>
          <p className="text-3xl font-bold" style={{ color: 'var(--gold)' }}>{fmt(heroEarned)} ₽</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {heroDays} дней · {preObject.length} этапов
          </p>
        </div>
      )}

      {/* Active stages */}
      {activeStages.length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Текущий этап</p>
          {activeStages.map(s => <StageCard key={s.id} stage={s} isActive onEnd={endStage} />)}
        </>
      )}

      {/* Completed */}
      {completedStages.length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Завершённые</p>
          {completedStages.map(s => <StageCard key={s.id} stage={s} />)}
        </>
      )}

      {/* Planned */}
      {plannedStages.length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Запланировано</p>
          {plannedStages.map(s => <StageCard key={s.id} stage={s} />)}
        </>
      )}

      {/* Start new stage */}
      {activeStages.length === 0 && project && !showAddForm && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Добавить этап</p>
          <div className="grid grid-cols-3 gap-2">
            {['medical', 'travel', 'warehouse', 'waiting', 'day_off'].map(type => {
              const cfg = STAGE_CONFIG[type];
              return (
                <button key={type} onClick={() => setShowAddForm(type)}
                  className="p-3 rounded-lg flex flex-col items-center gap-1"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)' }}>
                  <span className="text-xl">{cfg.icon}</span>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Add stage form */}
      {showAddForm && (
        <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg-elevated)', border: `2px solid ${STAGE_CONFIG[showAddForm]?.color || 'var(--border-norse)'}` }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {STAGE_CONFIG[showAddForm]?.icon} {STAGE_CONFIG[showAddForm]?.label}
          </p>
          <p className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>{QUOTES[showAddForm] || ''}</p>

          {showAddForm === 'medical' && (
            <input type="text" placeholder="Клиника" value={formData.clinic || ''}
              onChange={e => setFormData({ ...formData, clinic: e.target.value })}
              className="w-full p-3 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
          )}
          {showAddForm === 'travel' && (
            <>
              <div className="flex gap-2 flex-wrap">
                {['plane', 'train', 'bus', 'car'].map(t => (
                  <button key={t} onClick={() => setFormData({ ...formData, transport: t })}
                    className="px-3 py-1.5 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: formData.transport === t ? STAGE_CONFIG.travel.color : 'var(--bg-primary)',
                      color: formData.transport === t ? '#fff' : 'var(--text-secondary)',
                      border: '1px solid var(--border-norse)',
                    }}>
                    {{ plane: '✈️ Самолёт', train: '🚂 Поезд', bus: '🚌 Автобус', car: '🚗 Машина' }[t]}
                  </button>
                ))}
              </div>
              <input type="text" placeholder="Маршрут (откуда → куда)" value={formData.route || ''}
                onChange={e => setFormData({ ...formData, route: e.target.value })}
                className="w-full p-3 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
              <input type="text" placeholder="Номер рейса (необязательно)" value={formData.flight || ''}
                onChange={e => setFormData({ ...formData, flight: e.target.value })}
                className="w-full p-3 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
            </>
          )}
          {showAddForm === 'waiting' && (
            <input type="text" placeholder="Место ожидания" value={formData.location || ''}
              onChange={e => setFormData({ ...formData, location: e.target.value })}
              className="w-full p-3 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
          )}

          <div className="flex gap-2">
            <button onClick={() => { setShowAddForm(null); setFormData({}); }}
              className="flex-1 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>Отмена</button>
            <button onClick={() => startStage(showAddForm, formData)} disabled={starting}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${STAGE_CONFIG[showAddForm]?.color}, var(--gold))` }}>
              {starting ? '...' : 'Начать'}
            </button>
          </div>
        </div>
      )}

      {!project && stages.length === 0 && (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <p style={{ color: 'var(--text-tertiary)' }}>Нет активного проекта</p>
        </div>
      )}
    </div>
  );
}

function StageCard({ stage, isActive, onEnd }) {
  const cfg = STAGE_CONFIG[stage.stage_type] || STAGE_CONFIG.waiting;
  const details = typeof stage.details === 'string' ? JSON.parse(stage.details || '{}') : (stage.details || {});

  const dateStr = stage.date_to
    ? `${fmtDate(stage.date_from)} – ${fmtDate(stage.date_to)}`
    : fmtDate(stage.date_from);
  const daysStr = isActive
    ? `${stageDay(stage.date_from)}-й день`
    : `${stage.days_count || 1} дн.`;
  const earned = parseFloat(stage.amount_earned || 0);
  const earnStr = isActive
    ? `~${fmt(stageDay(stage.date_from) * parseFloat(stage.rate_per_day || 0))} ₽`
    : `${fmt(earned)} ₽`;
  const icon = isActive ? cfg.icon : (STATUS_ICONS[stage.status] || '✅');

  return (
    <div className="rounded-xl p-4" style={{
      backgroundColor: 'var(--bg-elevated)',
      border: isActive ? `2px solid ${cfg.color}` : '1px solid var(--border-norse)',
    }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <span className="font-semibold flex-1" style={{ color: isActive ? cfg.color : 'var(--text-primary)' }}>{cfg.label}</span>
        {stage.status === 'planned' && (
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>⚬ Запланирован</span>
        )}
        {stage.status === 'rejected' && (
          <span className="text-xs font-semibold" style={{ color: '#ef4444' }}>Отклонён</span>
        )}
      </div>

      {/* Date / days / earned */}
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{dateStr} · {daysStr} · {earnStr}</p>

      {/* Travel details: route, flight */}
      {stage.stage_type === 'travel' && details.route && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {details.flight ? `${details.flight} ` : ''}{details.route}
        </p>
      )}
      {/* Waiting: location */}
      {stage.stage_type === 'waiting' && details.location && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{details.location}</p>
      )}
      {/* Medical: clinic */}
      {stage.stage_type === 'medical' && details.clinic && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{details.clinic}</p>
      )}

      {/* Photo attachment */}
      {stage.photo_filename && (
        <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--gold)' }}>
          <Camera size={12} /> Заключение
        </p>
      )}

      {/* End button for active */}
      {isActive && onEnd && (
        <button onClick={onEnd}
          className="mt-3 w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1"
          style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <Square size={12} /> Завершить этап
        </button>
      )}
    </div>
  );
}
