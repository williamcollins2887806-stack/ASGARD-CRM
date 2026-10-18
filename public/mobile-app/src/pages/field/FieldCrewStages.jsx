import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import {
  ArrowLeft, Search, UserPlus, FileEdit, Stethoscope, Plane, Ship, GraduationCap,
  Hourglass, Package, BedDouble, Swords, CircleDot, CircleDashed, Users, UserRound,
} from 'lucide-react';
import { Card, IconTile, KeyButton, Chip, BottomSheet, SectionLabel, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { formatMoney as fmt } from '@/lib/utils';
import './field-screens.css';

// V255 (23.06.2026): добавлен 'ship' — Корабль (альтернатива «Дороги» за 12 баллов).
const STAGE_LABELS = {
  medical: 'Медосмотр', travel: 'Дорога', ship: 'Корабль', helicopter: 'Вертолёт',
  training: 'Обучение', waiting: 'Ожидание', warehouse: 'Склад', day_off: 'Выходной', object: 'Объект',
};

const STAGE_ICONS = {
  medical: Stethoscope, travel: Plane, ship: Ship, helicopter: Plane, training: GraduationCap,
  waiting: Hourglass, warehouse: Package, day_off: BedDouble, object: Swords,
};
const STAGE_COLORS = {
  medical: 'var(--acc)', travel: 'var(--acc)', ship: 'var(--acc)', helicopter: 'var(--acc)',
  training: 'var(--acc)', waiting: 'var(--value)', warehouse: 'var(--value)', day_off: 'var(--text-secondary)', object: 'var(--ok)',
};

// V255: 'ship' — медицинский scope (ставит ТО/HEAD_TO). В мобильном поле мастер сам
// не CRM-роль, реальный RBAC — на бэкенде (deriveScope→medical). В UI кнопку «Корабль»
// показываем только мастерам уровня senior_master (он же = HEAD_TO-эквивалент на объекте),
// либо если ship уже встречается у бригады (старший ставил с десктопа).
const SHIP_VISIBLE_FIELD_ROLES = ['senior_master', 'shift_master'];

function stageDay(dateFrom) { return Math.max(1, Math.floor((Date.now() - new Date(dateFrom).getTime()) / 86400000) + 1); }

export default function FieldCrewStages() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [employees, setEmployees] = useState([]);
  const [workId, setWorkId] = useState(null);
  // V255: field_role мастера — нужно для гейтинга кнопки «Корабль».
  const [fieldRole, setFieldRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showOnBehalf, setShowOnBehalf] = useState(null); // employee
  const [showCorrection, setShowCorrection] = useState(false);
  const [corrStageId, setCorrStageId] = useState('');
  const [corrNote, setCorrNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setLoading(true);
      const projData = await fieldApi.get('/worker/active-project');
      const wid = projData?.project?.work_id;
      setWorkId(wid);
      setFieldRole(projData?.project?.field_role || null);
      if (wid) {
        const data = await fieldApi.get(`/stages/my-crew/${wid}`);
        setEmployees(data?.employees || []);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function startOnBehalf(emp, stageType) {
    haptic.medium();
    setSubmitting(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await fieldApi.post('/stages/on-behalf', {
        employee_id: emp.employee_id, work_id: parseInt(workId),
        stage_type: stageType, date_from: today,
      });
      haptic.success();
      setShowOnBehalf(null);
      loadData();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  async function submitCorrection() {
    if (!corrStageId || !corrNote.trim()) return;
    haptic.medium();
    setSubmitting(true);
    try {
      await fieldApi.post('/stages/request-correction', { stage_id: parseInt(corrStageId), note: corrNote.trim() });
      haptic.success();
      setShowCorrection(false);
      setCorrStageId('');
      setCorrNote('');
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  if (loading) {
    return (
      <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <SkeletonList count={4} />
      </div>
    );
  }

  const filtered = employees.filter((emp) => {
    if (search && !emp.fio.toLowerCase().includes(search.toLowerCase())) return false;
    const active = emp.stages?.find((s) => s.status === 'active');
    if (filter === 'on_stage' && (!active || active.stage_type === 'object')) return false;
    if (filter === 'on_object' && (!active || active.stage_type !== 'object')) return false;
    return true;
  });

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-3">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/home')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Users} tone="value" size={40} />
          <h1 className="fs-head__title">Маршруты бригады</h1>
        </div>

        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: 'var(--danger-ink)' }}>{error}</Card>
        )}

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
          <input type="text" placeholder="Поиск по ФИО..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm"
            style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
        </div>

        {/* Filter pills */}
        <div className="flex gap-2">
          {[{ val: 'all', label: 'Все' }, { val: 'on_stage', label: 'На этапах' }, { val: 'on_object', label: 'На объекте' }].map((f) => (
            <Chip key={f.val} tone="value" active={filter === f.val} onClick={() => setFilter(f.val)}>{f.label}</Chip>
          ))}
        </div>

        {/* Employee list */}
        {filtered.length === 0 ? (
          <EmptyState icon={Users} title="Нет сотрудников" description="Попробуйте изменить фильтр или поиск" />
        ) : filtered.map((emp) => {
          const active = emp.stages?.find((s) => s.status === 'active');
          const color = active ? (STAGE_COLORS[active.stage_type] || 'var(--text-secondary)') : 'var(--text-tertiary)';
          const ActiveIcon = active ? (STAGE_ICONS[active.stage_type] || CircleDot) : CircleDashed;
          return (
            <Card key={emp.employee_id} variant="raised" className="p-3">
              <div className="flex items-center gap-2">
                <IconTile icon={UserRound} tone="neutral" size={32} />
                <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{emp.fio}</p>
              </div>
              {active ? (
                <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color }}>
                  <ActiveIcon size={12} strokeWidth={2.5} aria-hidden />
                  {STAGE_LABELS[active.stage_type]} · {stageDay(active.date_from)}-й день · ~{fmt(stageDay(active.date_from) * parseFloat(active.rate_per_day || 0))}
                </p>
              ) : (
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>Нет активных этапов</p>
              )}
              <KeyButton tone="value" size="sm" icon={UserPlus} className="mt-2" onClick={() => { haptic.light(); setShowOnBehalf(emp); }}>
                Отметить за него
              </KeyButton>
            </Card>
          );
        })}

        {/* Correction request button */}
        <KeyButton tone="value" block icon={FileEdit} onClick={() => setShowCorrection(true)}>
          Запросить корректировку
        </KeyButton>
      </div>

      {/* On-behalf bottom sheet */}
      <BottomSheet open={!!showOnBehalf} onClose={() => setShowOnBehalf(null)} title="Начать этап">
        {showOnBehalf && (
          <div className="space-y-3 pb-2">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Отметить за {showOnBehalf.fio}</p>
            {(() => {
              // V255: «Корабль» виден только мастерам (senior_master/shift_master),
              // т.к. это медицинский scope. Если уже есть ship у бригады — показываем
              // принудительно, чтобы не «потерять» кнопку коррекции.
              const hasShipInCrew = employees.some((e) => (e.stages || []).some((s) => s.stage_type === 'ship'));
              const canSetShip = SHIP_VISIBLE_FIELD_ROLES.includes(fieldRole) || hasShipInCrew;
              const types = ['medical', 'travel'];
              if (canSetShip) types.push('ship');
              types.push('warehouse', 'waiting', 'day_off');
              return types.map((type) => {
                const TypeIcon = STAGE_ICONS[type] || CircleDot;
                return (
                  <button key={type} onClick={() => startOnBehalf(showOnBehalf, type)} disabled={submitting}
                    className="w-full p-3 rounded-xl text-left text-sm font-medium disabled:opacity-50 flex items-center gap-2.5"
                    style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }}>
                    <TypeIcon size={16} strokeWidth={2.4} style={{ color: STAGE_COLORS[type] || 'var(--text-secondary)' }} aria-hidden />
                    {STAGE_LABELS[type]}
                    {type === 'ship' && (
                      <span className="ml-auto text-xs" style={{ color: 'var(--text-tertiary)' }}>· 12 баллов</span>
                    )}
                  </button>
                );
              });
            })()}
          </div>
        )}
      </BottomSheet>

      {/* Correction bottom sheet */}
      <BottomSheet open={showCorrection} onClose={() => setShowCorrection(false)} title="Запрос корректировки">
        <div className="space-y-3 pb-2">
          <select value={corrStageId} onChange={(e) => setCorrStageId(e.target.value)}
            className="w-full p-2.5 rounded-lg text-sm"
            style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }}>
            <option value="">Выберите рабочего</option>
            {employees.flatMap((emp) => (emp.stages || []).filter((s) => s.id).map((s) => (
              <option key={s.id} value={s.id}>{emp.fio} — {STAGE_LABELS[s.stage_type] || s.stage_type}</option>
            )))}
          </select>
          <textarea value={corrNote} onChange={(e) => setCorrNote(e.target.value)} placeholder="Что нужно исправить..."
            rows={3} className="w-full p-2.5 rounded-lg text-sm resize-none"
            style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
          <KeyButton tone="value" block onClick={submitCorrection} disabled={submitting || !corrStageId || !corrNote.trim()}>
            Отправить
          </KeyButton>
        </div>
      </BottomSheet>
    </div>
  );
}
