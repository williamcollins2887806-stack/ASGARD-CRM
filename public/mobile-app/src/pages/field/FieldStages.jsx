import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import {
  ArrowLeft, Truck, Play, Square, Plane, Building, Clock, Camera, Stethoscope, Ship,
  GraduationCap, Hourglass, Package, BedDouble, Swords, Route as RouteIcon, CircleDot, Check,
  Train, Bus, Car, Circle,
} from 'lucide-react';
import { Card, IconTile, KeyButton, Chip, SectionLabel, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { formatMoney as fmt } from '@/lib/utils';
import './field-screens.css';

const STAGE_CONFIG = {
  medical: { label: 'Медосмотр', Icon: Stethoscope, color: 'var(--acc)' },
  travel: { label: 'Дорога', Icon: Plane, color: 'var(--acc)' },
  // V255 (23.06.2026): Корабль — альтернатива дороги за 12 баллов × 500 ₽.
  // Рабочему сам ставить нельзя — только отображение, если поставили сверху.
  ship: { label: 'Корабль', Icon: Ship, color: 'var(--acc)' },
  helicopter: { label: 'Вертолёт', Icon: Plane, color: 'var(--acc)' },
  training: { label: 'Обучение', Icon: GraduationCap, color: 'var(--acc)' },
  waiting: { label: 'Ожидание', Icon: Hourglass, color: 'var(--value)' },
  warehouse: { label: 'Склад', Icon: Package, color: 'var(--value)' },
  day_off: { label: 'Выходной', Icon: BedDouble, color: 'var(--text-secondary)' },
  object: { label: 'На объекте', Icon: Swords, color: 'var(--ok)' },
};

const STATUS_LABELS = { planned: 'Запланирован', active: 'Активный', completed: 'Завершён', approved: 'Подтверждён', adjusted: 'Скорректирован', rejected: 'Отклонён' };
const STATUS_ICONS = { completed: Check, approved: Check, adjusted: Check, active: CircleDot, planned: Circle, rejected: Square };

const QUOTES = {
  medical: 'Здоровье воина — основа победы!',
  travel: 'Дорога зовёт! Удачного пути, воин',
  // V255: морская цитата для рабочего, которому поставили этап ship.
  ship: 'Морской переход — попутного ветра, воин!',
  helicopter: 'Вертолётный перелёт — мягкой посадки!',
  training: 'Обучение — сила дружины!',
  warehouse: 'Склад ждёт крепких рук!',
  waiting: 'Ожидание — тоже часть похода',
};

const TRANSPORT = [
  { value: 'plane', label: 'Самолёт', Icon: Plane },
  { value: 'train', label: 'Поезд', Icon: Train },
  { value: 'bus', label: 'Автобус', Icon: Bus },
  { value: 'car', label: 'Машина', Icon: Car },
];

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
      <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <SkeletonList count={3} />
      </div>
    );
  }

  const preObject = stages.filter((s) => s.stage_type !== 'object' && s.status !== 'rejected');
  const heroEarned = preObject.reduce((s, st) => s + parseFloat(st.amount_earned || 0), 0);
  const heroDays = preObject.reduce((s, st) => s + (st.days_approved || st.days_count || 0), 0);

  const activeStages = stages.filter((s) => s.status === 'active');
  const completedStages = stages.filter((s) => ['completed', 'approved', 'adjusted'].includes(s.status));
  const plannedStages = stages.filter((s) => s.status === 'planned');

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-4">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/home')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={RouteIcon} tone="accent" size={40} />
          <h1 className="fs-head__title">Мой маршрут</h1>
        </div>

        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: 'var(--danger-ink)' }}>{error}</Card>
        )}

        {/* Hero card — earned before object */}
        {preObject.length > 0 && (
          <Card variant="raised" tone="value" className="p-5 relative overflow-hidden">
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Заработано до объекта
            </p>
            <p className="text-3xl font-bold" style={{ color: 'var(--value-ink)' }}>{fmt(heroEarned)}</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {heroDays} дней · {preObject.length} этапов
            </p>
          </Card>
        )}

        {/* Active stages */}
        {activeStages.length > 0 && (
          <>
            <SectionLabel>Текущий этап</SectionLabel>
            {activeStages.map((s) => <StageCard key={s.id} stage={s} isActive onEnd={endStage} />)}
          </>
        )}

        {/* Completed */}
        {completedStages.length > 0 && (
          <>
            <SectionLabel>Завершённые</SectionLabel>
            {completedStages.map((s) => <StageCard key={s.id} stage={s} />)}
          </>
        )}

        {/* Planned */}
        {plannedStages.length > 0 && (
          <>
            <SectionLabel>Запланировано</SectionLabel>
            {plannedStages.map((s) => <StageCard key={s.id} stage={s} />)}
          </>
        )}

        {/* Start new stage */}
        {activeStages.length === 0 && project && !showAddForm && (
          <Card variant="raised" className="p-4">
            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Добавить этап</p>
            <div className="grid grid-cols-3 gap-2">
              {['medical', 'travel', 'warehouse', 'waiting', 'day_off'].map((type) => {
                const cfg = STAGE_CONFIG[type];
                return (
                  <button key={type} onClick={() => setShowAddForm(type)}
                    className="p-3 rounded-lg flex flex-col items-center gap-1.5"
                    style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)' }}>
                    <cfg.Icon size={20} strokeWidth={2.2} style={{ color: cfg.color }} />
                    <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        {/* Add stage form */}
        {showAddForm && (
          <Card variant="raised" className="p-4 space-y-3" style={{ borderColor: STAGE_CONFIG[showAddForm]?.color }}>
            <p className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              {(() => { const I = STAGE_CONFIG[showAddForm]?.Icon; return I ? <I size={16} strokeWidth={2.4} style={{ color: STAGE_CONFIG[showAddForm]?.color }} /> : null; })()}
              {STAGE_CONFIG[showAddForm]?.label}
            </p>
            <p className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>{QUOTES[showAddForm] || ''}</p>

            {showAddForm === 'medical' && (
              <input type="text" placeholder="Клиника" value={formData.clinic || ''}
                onChange={(e) => setFormData({ ...formData, clinic: e.target.value })}
                className="w-full p-3 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
            )}
            {showAddForm === 'travel' && (
              <>
                <div className="flex gap-2 flex-wrap">
                  {TRANSPORT.map((t) => (
                    <button key={t.value} onClick={() => setFormData({ ...formData, transport: t.value })}
                      className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5"
                      style={{
                        backgroundColor: formData.transport === t.value ? STAGE_CONFIG.travel.color : 'var(--bg-surface-alt)',
                        color: formData.transport === t.value ? 'var(--bg-primary)' : 'var(--text-secondary)',
                        border: '1px solid var(--tile-brd)',
                      }}>
                      <t.Icon size={12} strokeWidth={2.4} aria-hidden />
                      {t.label}
                    </button>
                  ))}
                </div>
                <input type="text" placeholder="Маршрут (откуда → куда)" value={formData.route || ''}
                  onChange={(e) => setFormData({ ...formData, route: e.target.value })}
                  className="w-full p-3 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
                <input type="text" placeholder="Номер рейса (необязательно)" value={formData.flight || ''}
                  onChange={(e) => setFormData({ ...formData, flight: e.target.value })}
                  className="w-full p-3 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
              </>
            )}
            {showAddForm === 'waiting' && (
              <input type="text" placeholder="Место ожидания" value={formData.location || ''}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full p-3 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
            )}

            <div className="flex gap-2">
              <KeyButton tone="neutral" style={{ flex: 1 }} onClick={() => { setShowAddForm(null); setFormData({}); }}>
                Отмена
              </KeyButton>
              <KeyButton tone="accent" style={{ flex: 1 }} onClick={() => startStage(showAddForm, formData)} disabled={starting}>
                {starting ? '…' : 'Начать'}
              </KeyButton>
            </div>
          </Card>
        )}

        {!project && stages.length === 0 && (
          <EmptyState icon={RouteIcon} title="Нет активного проекта" description="Этапы появятся после назначения на объект" />
        )}
      </div>
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
    ? `~${fmt(stageDay(stage.date_from) * parseFloat(stage.rate_per_day || 0))}`
    : `${fmt(earned)}`;
  const StatusIcon = isActive ? cfg.Icon : (STATUS_ICONS[stage.status] || Check);

  return (
    <Card variant="raised" className="p-4" style={{
      borderColor: isActive ? cfg.color : undefined,
      borderWidth: isActive ? 2 : 1,
    }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <StatusIcon size={17} strokeWidth={2.4} style={{ color: isActive ? cfg.color : 'var(--text-tertiary)' }} aria-hidden />
        <span className="font-semibold flex-1" style={{ color: isActive ? cfg.color : 'var(--text-primary)' }}>{cfg.label}</span>
        {stage.status === 'planned' && (
          <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
            <Circle size={10} strokeWidth={2.4} aria-hidden /> Запланирован
          </span>
        )}
        {stage.status === 'rejected' && (
          <span className="text-xs font-semibold" style={{ color: 'var(--danger-ink)' }}>Отклонён</span>
        )}
      </div>

      {/* Date / days / earned */}
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{dateStr} · {daysStr} · {earnStr}</p>

      {/* Travel details: route, flight (V255: и для ship — морской маршрут/рейс) */}
      {(stage.stage_type === 'travel' || stage.stage_type === 'ship') && details.route && (
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
        <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--value-ink)' }}>
          <Camera size={12} strokeWidth={2.4} aria-hidden /> Заключение
        </p>
      )}

      {/* End button for active */}
      {isActive && onEnd && (
        <KeyButton tone="danger" block size="sm" icon={Square} className="mt-3" onClick={onEnd}>
          Завершить этап
        </KeyButton>
      )}
    </Card>
  );
}
