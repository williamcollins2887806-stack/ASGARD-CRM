import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, AlertTriangle, Send, CheckCircle } from 'lucide-react';

const TYPES = [
  { value: 'injury', label: 'Травма' },
  { value: 'equipment', label: 'Поломка оборудования' },
  { value: 'safety', label: 'Нарушение ТБ' },
  { value: 'material', label: 'Порча материала' },
  { value: 'no_material', label: 'Нет материала' },
  { value: 'weather', label: 'Погода' },
  { value: 'other', label: 'Другое' },
];

const SEVERITY = [
  { value: 'low', label: 'Незначительный', color: '#f59e0b' },
  { value: 'medium', label: 'Средний', color: '#f97316' },
  { value: 'high', label: 'Серьёзный', color: '#ef4444' },
  { value: 'critical', label: 'Критический', color: '#dc2626' },
];

export default function FieldIncidents() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [project, setProject] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ type: 'safety', severity: 'low', description: '' });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setLoading(true);
      const projData = await fieldApi.get('/worker/active-project');
      const proj = projData?.project || projData;
      setProject(proj);
      const wid = proj?.work_id || proj?.id;
      if (wid) {
        const list = await fieldApi.get(`/reports/incidents?work_id=${wid}`).catch(() => []);
        setIncidents(Array.isArray(list) ? list : list?.rows || []);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleSubmit() {
    if (!form.description.trim()) return;
    haptic.medium();
    setSubmitting(true);
    try {
      const wid = project?.work_id || project?.id;
      await fieldApi.post('/reports/incidents', { work_id: wid, ...form });
      haptic.success();
      setSuccess(true);
      setForm({ type: 'safety', severity: 'low', description: '' });
      setTimeout(() => setSuccess(false), 3000);
      loadData();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <AlertTriangle size={22} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Инциденты</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}
      {success && (
        <div className="p-3 rounded-lg text-sm flex items-center gap-2" style={{ backgroundColor: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
          <CheckCircle size={16} /> Инцидент зарегистрирован
        </div>
      )}

      {/* Form */}
      {project && (
        <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Новый инцидент</p>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Тип</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full p-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Серьёзность</label>
            <div className="flex gap-2">
              {SEVERITY.map((s) => (
                <button key={s.value} onClick={() => setForm({ ...form, severity: s.value })} className="flex-1 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: form.severity === s.value ? s.color + '20' : 'var(--bg-primary)', border: `1px solid ${form.severity === s.value ? s.color : 'var(--border-norse)'}`, color: form.severity === s.value ? s.color : 'var(--text-tertiary)' }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Описание</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Опишите что произошло..." rows={3} className="w-full p-2 rounded-lg text-sm resize-none" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
          </div>
          <button onClick={handleSubmit} disabled={submitting || !form.description.trim()} className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50" style={{ background: 'var(--gold-gradient)' }}>
            <Send size={16} /> {submitting ? 'Отправка...' : 'Зарегистрировать'}
          </button>
        </div>
      )}

      {/* History */}
      {incidents.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide px-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>Ранее</p>
          <div className="space-y-2">
            {incidents.map((inc) => {
              const sev = SEVERITY.find((s) => s.value === inc.severity) || SEVERITY[0];
              return (
                <div key={inc.id} className="rounded-lg p-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: sev.color + '20', color: sev.color }}>{sev.label}</span>
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{new Date(inc.created_at).toLocaleDateString('ru-RU')}</span>
                  </div>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-primary)' }}>{inc.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
