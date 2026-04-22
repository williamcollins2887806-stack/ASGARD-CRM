import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Search, UserPlus, FileEdit } from 'lucide-react';

const STAGE_LABELS = { medical: 'Медосмотр', travel: 'Дорога', waiting: 'Ожидание', warehouse: 'Склад', day_off: 'Выходной', object: 'Объект' };
const STAGE_ICONS = { medical: '🟣', travel: '🔵', waiting: '🟡', warehouse: '🟠', day_off: '⚪', object: '🟢' };
const STAGE_COLORS = { medical: '#9333EA', travel: '#3B82F6', waiting: '#F59E0B', warehouse: '#F97316', day_off: '#9CA3AF', object: '#22C55E' };

const fmt = (n) => (n || 0).toLocaleString('ru-RU');
function stageDay(dateFrom) { return Math.max(1, Math.floor((Date.now() - new Date(dateFrom).getTime()) / 86400000) + 1); }

export default function FieldCrewStages() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [employees, setEmployees] = useState([]);
  const [workId, setWorkId] = useState(null);
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
      <div className="p-4 space-y-4 animate-pulse">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
      </div>
    );
  }

  const filtered = employees.filter(emp => {
    if (search && !emp.fio.toLowerCase().includes(search.toLowerCase())) return false;
    const active = emp.stages?.find(s => s.status === 'active');
    if (filter === 'on_stage' && (!active || active.stage_type === 'object')) return false;
    if (filter === 'on_object' && (!active || active.stage_type !== 'object')) return false;
    return true;
  });

  return (
    <div className="p-4 pb-24 space-y-3" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Маршруты бригады</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
        <input type="text" placeholder="Поиск по ФИО..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
      </div>

      {/* Filter pills */}
      <div className="flex gap-2">
        {[{ val: 'all', label: 'Все' }, { val: 'on_stage', label: 'На этапах' }, { val: 'on_object', label: 'На объекте' }].map(f => (
          <button key={f.val} onClick={() => setFilter(f.val)}
            className="px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: filter === f.val ? 'var(--gold)' : 'var(--bg-elevated)',
              color: filter === f.val ? '#000' : 'var(--text-secondary)',
              border: '1px solid var(--border-norse)',
            }}>{f.label}</button>
        ))}
      </div>

      {/* Employee list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <p style={{ color: 'var(--text-tertiary)' }}>Нет сотрудников</p>
        </div>
      ) : filtered.map(emp => {
        const active = emp.stages?.find(s => s.status === 'active');
        const color = active ? (STAGE_COLORS[active.stage_type] || 'var(--text-secondary)') : 'var(--text-tertiary)';
        return (
          <div key={emp.employee_id} className="rounded-xl p-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{emp.fio}</p>
            {active ? (
              <p className="text-xs mt-1" style={{ color }}>
                {STAGE_ICONS[active.stage_type]} {STAGE_LABELS[active.stage_type]} · {stageDay(active.date_from)}-й день · ~{fmt(stageDay(active.date_from) * parseFloat(active.rate_per_day || 0))} ₽
              </p>
            ) : (
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Нет активных этапов</p>
            )}
            <button onClick={() => { haptic.light(); setShowOnBehalf(emp); }}
              className="mt-2 flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--gold)' }}>
              <UserPlus size={12} /> Отметить за него
            </button>
          </div>
        );
      })}

      {/* Correction request button */}
      <button onClick={() => setShowCorrection(true)}
        className="w-full py-3 rounded-xl text-sm font-semibold"
        style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--gold)' }}>
        <FileEdit size={14} className="inline mr-1" /> Запросить корректировку
      </button>

      {/* On-behalf bottom sheet */}
      {showOnBehalf && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowOnBehalf(null)}>
          <div className="w-full max-w-md rounded-t-2xl p-5 space-y-3" style={{ backgroundColor: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Начать этап</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Отметить за {showOnBehalf.fio}</p>
            {['medical', 'travel', 'warehouse', 'waiting', 'day_off'].map(type => (
              <button key={type} onClick={() => startOnBehalf(showOnBehalf, type)} disabled={submitting}
                className="w-full p-3 rounded-xl text-left text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                {STAGE_ICONS[type]} {STAGE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Correction bottom sheet */}
      {showCorrection && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowCorrection(false)}>
          <div className="w-full max-w-md rounded-t-2xl p-5 space-y-3" style={{ backgroundColor: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Запрос корректировки</h2>
            <select value={corrStageId} onChange={e => setCorrStageId(e.target.value)}
              className="w-full p-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
              <option value="">Выберите рабочего</option>
              {employees.flatMap(emp => (emp.stages || []).filter(s => s.id).map(s => (
                <option key={s.id} value={s.id}>{emp.fio} — {STAGE_LABELS[s.stage_type] || s.stage_type}</option>
              )))}
            </select>
            <textarea value={corrNote} onChange={e => setCorrNote(e.target.value)} placeholder="Что нужно исправить..."
              rows={3} className="w-full p-2.5 rounded-lg text-sm resize-none"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
            <button onClick={submitCorrection} disabled={submitting || !corrStageId || !corrNote.trim()}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--gold), #b8860b)' }}>Отправить</button>
          </div>
        </div>
      )}
    </div>
  );
}
