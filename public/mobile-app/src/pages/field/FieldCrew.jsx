import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Users, Phone, Clock, UserPlus, Send } from 'lucide-react';

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
const fmt = (n) => (n || 0).toLocaleString('ru-RU') + ' ₽';

export default function FieldCrew() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [crew, setCrew] = useState([]);
  const [project, setProject] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ employee_id: '', checkin_time: '', reason: '' });

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setLoading(true);
      const projData = await fieldApi.get('/worker/active-project');
      const proj = projData?.project || projData;
      const assign = projData?.assignment || null;
      setProject(proj);
      setAssignment(assign);

      if (proj?.work_id || proj?.id) {
        const wid = proj.work_id || proj.id;
        const checkins = await fieldApi.get(`/checkin/today?work_id=${wid}`);
        setCrew(Array.isArray(checkins) ? checkins : checkins?.rows || checkins?.crew || []);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function submitManualCheckin() {
    haptic.medium();
    try {
      const wid = project?.work_id || project?.id;
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
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
      </div>
    );
  }

  const isMaster = assignment?.field_role?.includes('master');
  const onSite = crew.filter((c) => c.status === 'active').length;
  const completed = crew.filter((c) => c.status === 'completed').length;
  const absent = crew.filter((c) => !c.status || c.status === 'absent');

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Бригада</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatBox label="На объекте" value={onSite} color="#22c55e" />
        <StatBox label="Завершили" value={completed} color="#3b82f6" />
        <StatBox label="Всего" value={crew.length} color="var(--gold)" />
      </div>

      {/* Crew list */}
      {crew.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <Users size={32} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-tertiary)' }}>Нет данных о бригаде</p>
        </div>
      ) : (
        <div className="space-y-2">
          {crew.map((member) => {
            const statusColor = member.status === 'active' ? '#22c55e' : member.status === 'completed' ? '#3b82f6' : '#6b7280';
            return (
              <div key={member.id || member.employee_id} className="rounded-xl p-3 flex items-center gap-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                {/* Status dot */}
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor }} />
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{member.fio || member.employee_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {member.checkin_at && (
                      <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                        <Clock size={10} /> {fmtTime(member.checkin_at)}
                      </span>
                    )}
                    {member.hours_worked > 0 && (
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{member.hours_worked}ч</span>
                    )}
                    {member.amount_earned > 0 && (
                      <span className="text-xs font-medium" style={{ color: 'var(--gold)' }}>{fmt(member.amount_earned)}</span>
                    )}
                  </div>
                </div>
                {/* Phone */}
                {member.phone && (
                  <a href={`tel:${member.phone}`} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-primary)' }}>
                    <Phone size={16} style={{ color: 'var(--gold)' }} />
                  </a>
                )}
              </div>
            );
          })}
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
                {absent.map((m) => (
                  <option key={m.employee_id || m.id} value={m.employee_id || m.id}>{m.fio || m.employee_name}</option>
                ))}
              </select>
              <input
                type="time"
                value={manualForm.checkin_time}
                onChange={(e) => setManualForm({ ...manualForm, checkin_time: e.target.value })}
                className="w-full p-2 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
                placeholder="Время"
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
                <button
                  onClick={() => setShowManual(false)}
                  className="flex-1 py-2 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)' }}
                >
                  Отмена
                </button>
                <button
                  onClick={submitManualCheckin}
                  disabled={!manualForm.employee_id || !manualForm.checkin_time || !manualForm.reason}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1 disabled:opacity-50"
                  style={{ background: 'var(--gold-gradient)' }}
                >
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

function StatBox({ label, value, color }) {
  return (
    <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
    </div>
  );
}
