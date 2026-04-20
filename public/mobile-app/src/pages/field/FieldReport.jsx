import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, FileText, Send, CheckCircle } from 'lucide-react';

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
      <div className="p-4 space-y-4 animate-pulse">
        {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
      </div>
    );
  }

  const fields = template?.fields || [];

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <FileText size={22} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Ежедневный отчёт</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}
      {success && (
        <div className="p-3 rounded-lg text-sm flex items-center gap-2" style={{ backgroundColor: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
          <CheckCircle size={16} /> Отчёт отправлен
        </div>
      )}

      {/* Form */}
      {!project ? (
        <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <p style={{ color: 'var(--text-tertiary)' }}>Нет активного проекта</p>
        </div>
      ) : fields.length === 0 ? (
        <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Отчёт за сегодня</p>
          <textarea
            value={formData.summary || ''}
            onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
            placeholder="Что сделано за смену..."
            rows={4}
            className="w-full p-3 rounded-lg text-sm resize-none"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
          />
          <textarea
            value={formData.issues || ''}
            onChange={(e) => setFormData({ ...formData, issues: e.target.value })}
            placeholder="Проблемы / замечания (необязательно)"
            rows={2}
            className="w-full p-3 rounded-lg text-sm resize-none"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
          />
        </div>
      ) : (
        <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          {fields.map((field) => (
            <div key={field.key || field.name}>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>{field.label || field.name}</label>
              {field.type === 'textarea' ? (
                <textarea
                  value={formData[field.key || field.name] || ''}
                  onChange={(e) => setFormData({ ...formData, [field.key || field.name]: e.target.value })}
                  rows={3}
                  className="w-full p-2 rounded-lg text-sm resize-none"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
                />
              ) : (
                <input
                  type={field.type || 'text'}
                  value={formData[field.key || field.name] || ''}
                  onChange={(e) => setFormData({ ...formData, [field.key || field.name]: e.target.value })}
                  className="w-full p-2 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Submit */}
      {project && (
        <button
          onClick={handleSubmit}
          disabled={submitting || (!formData.summary && fields.length === 0)}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: 'var(--gold-gradient)' }}
        >
          <Send size={16} /> {submitting ? 'Отправка...' : 'Отправить отчёт'}
        </button>
      )}

      {/* Recent reports */}
      {recentReports.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide px-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>Последние отчёты</p>
          <div className="space-y-2">
            {recentReports.map((r) => (
              <div key={r.id} className="rounded-lg p-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                <div className="flex justify-between">
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{new Date(r.created_at).toLocaleDateString('ru-RU')}</span>
                  <CheckCircle size={14} style={{ color: '#22c55e' }} />
                </div>
                {r.data?.summary && <p className="text-sm mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{r.data.summary}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
