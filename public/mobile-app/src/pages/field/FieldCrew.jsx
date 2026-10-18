import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Users, Phone, UserPlus, Send, CircleDot, CircleDashed, CircleMinus, UserRound } from 'lucide-react';
import { Card, IconTile, KeyButton, SectionLabel, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { formatMoney as fmt } from '@/lib/utils';
import './field-screens.css';

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
const ROLE_LABELS = {
  senior_master: 'Ст. мастер',
  shift_master: 'Мастер',
  welder: 'Сварщик',
  pto: 'ПТО',
  worker: 'Рабочий',
};
const SHIFT_LABELS = { day: 'дневная', night: 'ночная', road: 'дорога', standby: 'ожидание' };

export default function FieldCrew() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [data, setData] = useState(null);
  const [workTitle, setWorkTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ employee_id: '', checkin_time: '', reason: '' });
  const [isMaster, setIsMaster] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setLoading(true);
      // Get active project for work_id
      const projData = await fieldApi.get('/worker/active-project');
      const proj = projData?.project || projData;
      const workId = proj?.work_id || proj?.id;
      setWorkTitle(proj?.work_title || '');

      if (!workId) {
        setError('Нет активного проекта');
        return;
      }

      // Use /worker/crew endpoint — returns 3 groups
      const crewData = await fieldApi.get(`/worker/crew?work_id=${workId}`);
      setData(crewData);
      setIsMaster(crewData?.your_role === 'shift_master' || crewData?.your_role === 'senior_master');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function submitManualCheckin() {
    haptic.medium();
    try {
      const projData = await fieldApi.get('/worker/active-project');
      const wid = projData?.project?.work_id || projData?.project?.id;
      await fieldApi.post('/checkin/manual', {
        work_id: wid,
        employee_id: Number(manualForm.employee_id),
        checkin_time: manualForm.checkin_time,
        reason: manualForm.reason,
      });
      haptic.success();
      setShowManual(false);
      setManualForm({ employee_id: '', checkin_time: '', reason: '' });
      loadData();
    } catch (e) { setError(e.message); }
  }

  if (loading) {
    return (
      <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <SkeletonList count={4} />
      </div>
    );
  }

  const onSite = data?.on_site || [];
  const notCheckedIn = data?.not_checked_in || [];
  const leftSite = data?.left_site || [];

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-3">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/home')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Users} tone="accent" size={40} />
          <h1 className="fs-head__title">Бригада</h1>
        </div>

        {/* Work title */}
        {workTitle && (
          <p className="text-xs font-semibold uppercase tracking-widest text-center" style={{ color: 'var(--text-tertiary)' }}>
            {workTitle}
          </p>
        )}

        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: 'var(--danger-ink)' }}>{error}</Card>
        )}

        {/* Stats — 4 columns matching vanilla */}
        <div className="grid grid-cols-4 gap-2">
          <StatBox icon={Users} label="Всего" value={data?.total || 0} color="var(--text-secondary)" />
          <StatBox icon={CircleDot} label="На объекте" value={onSite.length} color="var(--ok)" />
          <StatBox icon={CircleDashed} label="Нет чекина" value={notCheckedIn.length} color="var(--value-ink)" />
          <StatBox icon={CircleMinus} label="Уехали" value={leftSite.length} color="var(--text-tertiary)" />
        </div>

        {/* On site */}
        {onSite.length > 0 && (
          <>
            <SectionLabel>
              <span className="inline-flex items-center gap-1.5">
                <CircleDot size={11} strokeWidth={2.6} style={{ color: 'var(--ok)' }} aria-hidden />
                На объекте сегодня
              </span>
            </SectionLabel>
            {onSite.map((m) => <CrewCard key={m.employee_id} member={m} />)}
          </>
        )}

        {/* Not checked in */}
        {notCheckedIn.length > 0 && (
          <>
            <SectionLabel>
              <span className="inline-flex items-center gap-1.5">
                <CircleDashed size={11} strokeWidth={2.6} style={{ color: 'var(--value-ink)' }} aria-hidden />
                Не отметились
              </span>
            </SectionLabel>
            {notCheckedIn.map((m) => <CrewCard key={m.employee_id} member={m} />)}
          </>
        )}

        {/* Left site */}
        {leftSite.length > 0 && (
          <>
            <SectionLabel>
              <span className="inline-flex items-center gap-1.5">
                <CircleMinus size={11} strokeWidth={2.6} style={{ color: 'var(--text-tertiary)' }} aria-hidden />
                Уехали с объекта
              </span>
            </SectionLabel>
            {leftSite.map((m) => <CrewCard key={m.employee_id} member={m} />)}
          </>
        )}

        {onSite.length === 0 && notCheckedIn.length === 0 && leftSite.length === 0 && !error && (
          <EmptyState icon={Users} title="Бригада пуста" description="Состав появится после назначения на объект" />
        )}

        {/* Master: manual checkin */}
        {isMaster && (
          <div>
            {!showManual ? (
              <KeyButton tone="value" block icon={UserPlus} onClick={() => { haptic.light(); setShowManual(true); }}>
                Ручная отметка
              </KeyButton>
            ) : (
              <Card variant="raised" className="space-y-3">
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Ручная отметка</p>
                <select
                  value={manualForm.employee_id}
                  onChange={(e) => setManualForm({ ...manualForm, employee_id: e.target.value })}
                  className="w-full p-2 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }}
                >
                  <option value="">Выберите сотрудника</option>
                  {notCheckedIn.map((m) => (
                    <option key={m.employee_id} value={m.employee_id}>{m.fio}</option>
                  ))}
                </select>
                <input
                  type="time"
                  value={manualForm.checkin_time}
                  onChange={(e) => setManualForm({ ...manualForm, checkin_time: e.target.value })}
                  className="w-full p-2 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }}
                />
                <textarea
                  value={manualForm.reason}
                  onChange={(e) => setManualForm({ ...manualForm, reason: e.target.value })}
                  placeholder="Причина"
                  rows={2}
                  className="w-full p-2 rounded-lg text-sm resize-none"
                  style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }}
                />
                <div className="flex gap-2">
                  <KeyButton tone="neutral" style={{ flex: 1 }} onClick={() => setShowManual(false)}>Отмена</KeyButton>
                  <KeyButton
                    tone="value"
                    icon={Send}
                    style={{ flex: 1 }}
                    onClick={submitManualCheckin}
                    disabled={!manualForm.employee_id || !manualForm.checkin_time || !manualForm.reason}
                  >
                    Отметить
                  </KeyButton>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CrewCard({ member: m }) {
  const navigate = useNavigate();
  const isMasterRole = m.field_role === 'shift_master' || m.field_role === 'senior_master';

  const meta = [];
  if (m.checkin_at) meta.push(fmtTime(m.checkin_at));
  if (m.checkin_shift) meta.push(SHIFT_LABELS[m.checkin_shift] || m.checkin_shift);
  if (m.checkin_status === 'completed' && m.amount_earned) meta.push(fmt(parseFloat(m.amount_earned)));
  if (!m.is_active && m.date_to) meta.push('до ' + new Date(m.date_to).toLocaleDateString('ru-RU'));

  const active = m.checkin_status === 'active';

  return (
    <Card
      variant="raised"
      className="p-3 flex items-center gap-3"
      style={{ borderColor: active ? 'color-mix(in oklab, var(--ok) 26%, transparent)' : undefined, cursor: 'pointer' }}
      onClick={() => m.employee_id && navigate(`/field/hall/${m.employee_id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && m.employee_id && navigate(`/field/hall/${m.employee_id}`)}
    >
      <IconTile icon={UserRound} tone={isMasterRole ? 'value' : 'neutral'} size={36} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{m.fio || 'Сотрудник'}</p>
          {isMasterRole && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ color: 'var(--value-ink)', backgroundColor: 'color-mix(in oklab, var(--value) 12%, transparent)' }}>
              {ROLE_LABELS[m.field_role] || 'Рабочий'}
            </span>
          )}
        </div>
        {meta.length > 0 && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{meta.join(' · ')}</p>
        )}
      </div>
      {m.phone && (
        <a
          href={`tel:${m.phone.replace(/[^\d+]/g, '')}`}
          className="p-2 rounded-lg flex-shrink-0"
          aria-label="Позвонить"
          style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Phone size={16} style={{ color: 'var(--value-ink)' }} />
        </a>
      )}
    </Card>
  );
}

function StatBox({ icon: Icon, label, value, color }) {
  return (
    <Card variant="raised" className="p-2.5 text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <Icon size={14} strokeWidth={2.4} style={{ color }} aria-hidden />
      <p className="text-lg font-bold" style={{ color }}>{value}</p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)', fontSize: '0.5625rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
    </Card>
  );
}
