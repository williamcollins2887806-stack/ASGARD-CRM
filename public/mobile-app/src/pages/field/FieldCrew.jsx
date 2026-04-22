import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Users, Phone, Clock, UserPlus, Send } from 'lucide-react';

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
const fmt = (n) => (n || 0).toLocaleString('ru-RU') + ' ₽';

const ROLE_LABELS = { senior_master: 'Ст. мастер', shift_master: 'Мастер', worker: 'Рабочий' };
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
      <div className="p-4 space-y-4 animate-pulse">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
      </div>
    );
  }

  const onSite = data?.on_site || [];
  const notCheckedIn = data?.not_checked_in || [];
  const leftSite = data?.left_site || [];

  return (
    <div className="p-4 pb-24 space-y-3" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Бригада</h1>
      </div>

      {/* Work title */}
      {workTitle && (
        <p className="text-xs font-semibold uppercase tracking-widest text-center" style={{ color: 'var(--text-tertiary)' }}>
          {workTitle}
        </p>
      )}

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* Stats — 4 columns matching vanilla */}
      <div className="grid grid-cols-4 gap-2">
        <StatBox label="Всего" value={data?.total || 0} color="var(--text-secondary)" />
        <StatBox label="На объекте" value={onSite.length} color="#22c55e" />
        <StatBox label="Нет чекина" value={notCheckedIn.length} color="#f59e0b" />
        <StatBox label="Уехали" value={leftSite.length} color="var(--text-tertiary)" />
      </div>

      {/* On site */}
      {onSite.length > 0 && (
        <>
          <SectionLabel text="🟢 На объекте сегодня" />
          {onSite.map((m) => <CrewCard key={m.employee_id} member={m} />)}
        </>
      )}

      {/* Not checked in */}
      {notCheckedIn.length > 0 && (
        <>
          <SectionLabel text="🟡 Не отметились" />
          {notCheckedIn.map((m) => <CrewCard key={m.employee_id} member={m} />)}
        </>
      )}

      {/* Left site */}
      {leftSite.length > 0 && (
        <>
          <SectionLabel text="⚫ Уехали с объекта" />
          {leftSite.map((m) => <CrewCard key={m.employee_id} member={m} />)}
        </>
      )}

      {onSite.length === 0 && notCheckedIn.length === 0 && leftSite.length === 0 && !error && (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <Users size={32} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-tertiary)' }}>Бригада пуста</p>
        </div>
      )}

      {/* Master: manual checkin */}
      {isMaster && (
        <div>
          {!showManual ? (
            <button
              onClick={() => { haptic.light(); setShowManual(true); }}
              className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--gold)' }}
            >
              <UserPlus size={16} /> Ручная отметка
            </button>
          ) : (
            <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Ручная отметка</p>
              <select
                value={manualForm.employee_id}
                onChange={(e) => setManualForm({ ...manualForm, employee_id: e.target.value })}
                className="w-full p-2 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
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
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
              />
              <textarea
                value={manualForm.reason}
                onChange={(e) => setManualForm({ ...manualForm, reason: e.target.value })}
                placeholder="Причина"
                rows={2}
                className="w-full p-2 rounded-lg text-sm resize-none"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
              />
              <div className="flex gap-2">
                <button onClick={() => setShowManual(false)}
                  className="flex-1 py-2 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>Отмена</button>
                <button onClick={submitManualCheckin}
                  disabled={!manualForm.employee_id || !manualForm.checkin_time || !manualForm.reason}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1 disabled:opacity-50"
                  style={{ background: 'var(--gold-gradient)' }}>
                  <Send size={14} /> Отметить
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CrewCard({ member: m }) {
  const isMasterRole = m.field_role === 'shift_master' || m.field_role === 'senior_master';

  const meta = [];
  if (m.checkin_at) meta.push(fmtTime(m.checkin_at));
  if (m.checkin_shift) meta.push(SHIFT_LABELS[m.checkin_shift] || m.checkin_shift);
  if (m.checkin_status === 'completed' && m.amount_earned) meta.push(fmt(parseFloat(m.amount_earned)));
  if (!m.is_active && m.date_to) meta.push('до ' + new Date(m.date_to).toLocaleDateString('ru-RU'));

  const borderColor = m.checkin_status === 'active' ? 'rgba(52,199,89,0.2)' : 'var(--border-norse)';

  return (
    <div className="rounded-xl p-3 flex items-center gap-3"
      style={{ backgroundColor: 'var(--bg-elevated)', border: `1px solid ${borderColor}` }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{m.fio || 'Сотрудник'}</p>
          {isMasterRole && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ color: 'var(--gold)', backgroundColor: 'rgba(212,168,67,0.12)' }}>
              {ROLE_LABELS[m.field_role] || 'Рабочий'}
            </span>
          )}
        </div>
        {meta.length > 0 && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{meta.join(' · ')}</p>
        )}
      </div>
      {m.phone && (
        <a href={`tel:${m.phone.replace(/[^\d+]/g, '')}`} className="p-2 rounded-lg flex-shrink-0"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)' }}>
          <Phone size={16} style={{ color: 'var(--gold)' }} />
        </a>
      )}
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div className="rounded-lg p-2.5 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
      <p className="text-lg font-bold" style={{ color }}>{value}</p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)', fontSize: '0.5625rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
    </div>
  );
}

function SectionLabel({ text }) {
  return (
    <p className="text-xs font-bold tracking-wide mt-2 pb-1"
      style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-norse)' }}>
      {text}
    </p>
  );
}
