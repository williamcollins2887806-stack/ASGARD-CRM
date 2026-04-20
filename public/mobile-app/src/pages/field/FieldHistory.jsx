import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Briefcase, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';

function fmtMoney(n) { return (n || 0).toLocaleString('ru-RU') + ' \u20BD'; }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`; }

const SHIFT_LABELS = { day: 'День', night: 'Ночь', half: 'Пол-смены', travel: 'Дорога' };

export default function FieldHistory() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [timesheet, setTimesheet] = useState(null);
  const [tsLoading, setTsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fieldApi.get('/worker/projects');
        setProjects(Array.isArray(res) ? res : res.projects || []);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  const toggleProject = async (p) => {
    haptic.light();
    const key = p.work_id || p.id;
    if (expanded === key) { setExpanded(null); setTimesheet(null); return; }
    setExpanded(key);
    setTsLoading(true);
    try {
      const res = await fieldApi.get(`/worker/timesheet/${key}`);
      setTimesheet(Array.isArray(res) ? res : res.days || []);
    } catch { setTimesheet([]); }
    finally { setTsLoading(false); }
  };

  const totalProjects = projects.length;
  const totalShifts = projects.reduce((s, p) => s + (p.shifts_count || 0), 0);
  const totalEarned = projects.reduce((s, p) => s + (p.total_earned || 0), 0);

  const grouped = projects.reduce((acc, p) => {
    const y = p.start_date ? new Date(p.start_date).getFullYear() : 'Без даты';
    (acc[y] = acc[y] || []).push(p);
    return acc;
  }, {});
  const years = Object.keys(grouped).sort((a, b) => b - a);

  if (loading) return (
    <div className="p-4 space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-20 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>История</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[['Проекты', totalProjects], ['Смены', totalShifts], ['Заработок', fmtMoney(totalEarned)]].map(([label, val]) => (
          <div key={label} className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
            <p className="font-bold text-sm mt-1" style={{ color: 'var(--gold)' }}>{val}</p>
          </div>
        ))}
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}>{error}</div>}

      {projects.length === 0 && !error && (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <Briefcase size={36} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Пока нет проектов</p>
        </div>
      )}

      {/* Project list */}
      {years.map(year => (
        <div key={year} className="space-y-2">
          {years.length > 1 && <p className="text-xs font-semibold px-1" style={{ color: 'var(--text-tertiary)' }}>{year}</p>}
          {grouped[year].map(p => {
            const key = p.work_id || p.id;
            const isOpen = expanded === key;
            const isActive = p.status === 'active' || p.is_active;
            return (
              <div key={key} className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                <button onClick={() => toggleProject(p)} className="w-full p-4 text-left flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.work_title || p.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {p.city}{p.start_date ? ` · ${fmtDate(p.start_date)}` : ''}{p.end_date ? ` — ${fmtDate(p.end_date)}` : ''}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span>{p.shifts_count || 0} смен</span>
                      <span style={{ color: 'var(--gold)' }}>{fmtMoney(p.total_earned)}</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={{
                    backgroundColor: isActive ? 'rgba(34,197,94,0.15)' : 'rgba(156,163,175,0.15)',
                    color: isActive ? '#22c55e' : 'var(--text-tertiary)'
                  }}>{isActive ? 'Активный' : 'Завершён'}</span>
                  {isOpen ? <ChevronUp size={16} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-tertiary)' }} />}
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border-norse)' }}>
                    {tsLoading ? (
                      <div className="py-4 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>Загрузка...</div>
                    ) : timesheet && timesheet.length > 0 ? (
                      <div className="mt-3 space-y-1">
                        <div className="grid grid-cols-4 text-xs font-semibold pb-1" style={{ color: 'var(--text-tertiary)' }}>
                          <span>Дата</span><span>Тип</span><span className="text-right">Часы</span><span className="text-right">Сумма</span>
                        </div>
                        {timesheet.map((d, i) => (
                          <div key={i} className="grid grid-cols-4 text-xs py-1" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-norse)' }}>
                            <span>{fmtDate(d.date)}</span>
                            <span>{SHIFT_LABELS[d.shift_type] || d.shift_type || '—'}</span>
                            <span className="text-right">{d.hours || '—'}</span>
                            <span className="text-right" style={{ color: 'var(--gold)' }}>{d.earned ? fmtMoney(d.earned) : '—'}</span>
                          </div>
                        ))}
                        <div className="grid grid-cols-4 text-xs font-bold pt-2" style={{ color: 'var(--text-primary)' }}>
                          <span>Итого</span><span></span>
                          <span className="text-right">{timesheet.reduce((s,d) => s + (d.hours || 0), 0)}</span>
                          <span className="text-right" style={{ color: 'var(--gold)' }}>{fmtMoney(timesheet.reduce((s,d) => s + (d.earned || 0), 0))}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="py-3 text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>Нет данных</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
