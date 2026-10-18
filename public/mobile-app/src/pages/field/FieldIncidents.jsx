import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, AlertTriangle, Send, CheckCircle } from 'lucide-react';
import { Card, IconTile, KeyButton, Chip, SectionLabel, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

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
  { value: 'low', label: 'Незначительный', color: 'var(--value)' },
  { value: 'medium', label: 'Средний', color: 'var(--value)' },
  { value: 'high', label: 'Серьёзный', color: 'var(--danger-ink)' },
  { value: 'critical', label: 'Критический', color: 'var(--danger-ink)' },
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
      <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <SkeletonList count={3} />
      </div>
    );
  }

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-4">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/home')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={AlertTriangle} tone="danger" size={40} />
          <h1 className="fs-head__title">Инциденты</h1>
        </div>

        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: 'var(--danger-ink)' }}>{error}</Card>
        )}
        {success && (
          <Card variant="flat" tone="status" className="p-3 text-sm flex items-center gap-2" style={{ color: 'var(--ok)' }}>
            <CheckCircle size={16} /> Инцидент зарегистрирован
          </Card>
        )}

        {/* Form */}
        {!project ? (
          <EmptyState icon={AlertTriangle} title="Нет активного проекта" description="Отчёт появится после назначения на объект" />
        ) : (
          <Card variant="raised" className="space-y-3">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Новый инцидент</p>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Тип</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full p-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Серьёзность</label>
              <div className="flex gap-2">
                {SEVERITY.map((s) => (
                  <button key={s.value} onClick={() => setForm({ ...form, severity: s.value })}
                    className="flex-1 py-2 rounded-lg text-xs font-medium"
                    style={{
                      backgroundColor: form.severity === s.value ? `color-mix(in oklab, ${s.color} 13%, transparent)` : 'var(--bg-surface-alt)',
                      border: `1px solid ${form.severity === s.value ? s.color : 'var(--tile-brd)'}`,
                      color: form.severity === s.value ? s.color : 'var(--text-tertiary)',
                    }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Описание</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Опишите что произошло..." rows={3} className="w-full p-2 rounded-lg text-sm resize-none" style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
            </div>
            <KeyButton tone="value" block icon={Send} onClick={handleSubmit} disabled={submitting || !form.description.trim()}>
              {submitting ? 'Отправка...' : 'Зарегистрировать'}
            </KeyButton>
          </Card>
        )}

        {/* History */}
        {incidents.length > 0 && (
          <div>
            <SectionLabel>Ранее</SectionLabel>
            <div className="space-y-2">
              {incidents.map((inc) => {
                const sev = SEVERITY.find((s) => s.value === inc.severity) || SEVERITY[0];
                return (
                  <Card key={inc.id} variant="flat" className="p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: `color-mix(in oklab, ${sev.color} 13%, transparent)`, color: sev.color }}>{sev.label}</span>
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{new Date(inc.created_at).toLocaleDateString('ru-RU')}</span>
                    </div>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-primary)' }}>{inc.description}</p>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
