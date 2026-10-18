import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, FileText, Send, CheckCircle, Minus, Plus } from 'lucide-react';
import { Card, IconTile, KeyButton, Chip, SectionLabel, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

export default function FieldReport() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [project, setProject] = useState(null);
  const [template, setTemplate] = useState(null);
  const [formData, setFormData] = useState({});
  const [recentReports, setRecentReports] = useState([]);
  const [loading, setLoading] = useState(true);
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
        const [tmpl, reports] = await Promise.all([
          fieldApi.get(`/reports/template/${wid}`).catch(() => null),
          fieldApi.get(`/reports/?work_id=${wid}&limit=5`).catch(() => []),
        ]);
        setTemplate(tmpl);
        setRecentReports(Array.isArray(reports) ? reports : reports?.rows || []);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleSubmit() {
    haptic.medium();
    setSubmitting(true);
    try {
      const wid = project?.work_id || project?.id;
      await fieldApi.post('/reports/', { work_id: wid, data: formData });
      haptic.success();
      setSuccess(true);
      setFormData({});
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

  const fields = template?.fields || [];

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-4">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/home')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={FileText} tone="value" size={40} />
          <h1 className="fs-head__title">Ежедневный отчёт</h1>
        </div>

        {/* Date header */}
        <p className="text-sm font-medium text-center" style={{ color: 'var(--text-secondary)' }}>
          Отчёт за {new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>

        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: 'var(--danger-ink)' }}>{error}</Card>
        )}
        {success && (
          <Card variant="flat" tone="status" className="p-3 text-sm flex items-center gap-2" style={{ color: 'var(--ok)' }}>
            <CheckCircle size={16} /> Отчёт отправлен
          </Card>
        )}

        {/* Form */}
        {!project ? (
          <EmptyState icon={FileText} title="Нет активного проекта" description="Отчёт появится после назначения на объект" />
        ) : fields.length === 0 ? (
          <Card variant="raised" className="space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Отчёт за сегодня</p>
            <textarea
              value={formData.summary || ''}
              onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
              placeholder="Что сделано за смену..."
              rows={4}
              className="w-full p-3 rounded-lg text-sm resize-none"
              style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }}
            />
            <textarea
              value={formData.issues || ''}
              onChange={(e) => setFormData({ ...formData, issues: e.target.value })}
              placeholder="Проблемы / замечания (необязательно)"
              rows={2}
              className="w-full p-3 rounded-lg text-sm resize-none"
              style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }}
            />
          </Card>
        ) : (
          <Card variant="raised" className="space-y-3">
            {template?.name && <SectionLabel>{template.name}</SectionLabel>}
            {fields.map((field) => {
              const fKey = field.key || field.name;
              return (
                <div key={fKey}>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>{field.label || field.name}</label>
                  {field.type === 'textarea' ? (
                    <textarea value={formData[fKey] || ''} onChange={(e) => setFormData({ ...formData, [fKey]: e.target.value })}
                      rows={3} className="w-full p-2 rounded-lg text-sm resize-none"
                      style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
                  ) : field.type === 'select' ? (
                    <div className="flex flex-wrap gap-1.5">
                      {(field.options || []).map((opt) => (
                        <Chip key={opt} tone="value" active={formData[fKey] === opt} onClick={() => setFormData({ ...formData, [fKey]: opt })}>
                          {opt}
                        </Chip>
                      ))}
                    </div>
                  ) : field.type === 'number' ? (
                    <div className="flex items-center gap-3">
                      <button onClick={() => setFormData({ ...formData, [fKey]: Math.max(0, (parseInt(formData[fKey]) || 0) - 1) })}
                        aria-label="Уменьшить"
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }}>
                        <Minus size={16} strokeWidth={2.6} />
                      </button>
                      <span className="text-lg font-bold flex-1 text-center" style={{ color: 'var(--text-primary)' }}>{formData[fKey] || 0}</span>
                      <button onClick={() => setFormData({ ...formData, [fKey]: (parseInt(formData[fKey]) || 0) + 1 })}
                        aria-label="Увеличить"
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }}>
                        <Plus size={16} strokeWidth={2.6} />
                      </button>
                    </div>
                  ) : (
                    <input type={field.type || 'text'} value={formData[fKey] || ''} onChange={(e) => setFormData({ ...formData, [fKey]: e.target.value })}
                      className="w-full p-2 rounded-lg text-sm"
                      style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
                  )}
                </div>
              );
            })}
            {/* Downtime fields */}
            <div className="pt-2 mt-1" style={{ borderTop: '1px solid var(--tile-brd)' }}>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Простой (минуты)</label>
              <input type="number" value={formData.downtime_minutes || ''} onChange={(e) => setFormData({ ...formData, downtime_minutes: e.target.value })}
                placeholder="0" className="w-full p-2 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
              {(formData.downtime_minutes > 0) && (
                <textarea value={formData.downtime_reason || ''} onChange={(e) => setFormData({ ...formData, downtime_reason: e.target.value })}
                  placeholder="Причина простоя" rows={2} className="w-full p-2 rounded-lg text-sm resize-none mt-2"
                  style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
              )}
            </div>
          </Card>
        )}

        {/* Submit */}
        {project && (
          <KeyButton
            tone="value"
            block
            icon={Send}
            onClick={handleSubmit}
            disabled={submitting || (!formData.summary && fields.length === 0)}
          >
            {submitting ? 'Отправка...' : 'Отправить отчёт'}
          </KeyButton>
        )}

        {/* Recent reports */}
        {recentReports.length > 0 && (
          <div>
            <SectionLabel>Последние отчёты</SectionLabel>
            <div className="space-y-2">
              {recentReports.map((r) => (
                <Card key={r.id} variant="flat" className="p-3">
                  <div className="flex justify-between">
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{new Date(r.created_at).toLocaleDateString('ru-RU')}</span>
                    <CheckCircle size={14} style={{ color: 'var(--ok)' }} />
                  </div>
                  {r.data?.summary && <p className="text-sm mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{r.data.summary}</p>}
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
