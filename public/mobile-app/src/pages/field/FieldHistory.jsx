import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Briefcase, ChevronDown, ChevronUp } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';

function fmtMoney(n) { return (n || 0).toLocaleString('ru-RU') + ' ₽'; }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`; }
function fmtDateShort(iso) { if (!iso) return ''; const d = new Date(iso); return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`; }

const SHIFT_LABELS = { day: 'День', night: 'Ночь', half: 'Пол-смены', travel: 'Дорога', standby: 'Ожидание', road: 'Дорога' };
const SHIFT_ICONS = { day: '☀️', night: '🌙', road: '🚗', travel: '🚗', half: '½', standby: '⏳' };
const ROLE_LABELS = { senior_master: 'Ст. мастер', shift_master: 'Мастер', worker: 'Рабочий' };

/* ══════════════════════════════════════════════════════════════════
   History Detail — /field/history?detail=WORK_ID
   ══════════════════════════════════════════════════════════════════ */
function HistoryDetail({ workId, onBack }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [tsData, projData] = await Promise.all([
          fieldApi.get(`/worker/timesheet/${workId}`),
          fieldApi.get(`/worker/projects/${workId}`).catch(() => null),
        ]);
        setData({ ...tsData, projWork: projData?.work || null });
      } catch {}
      setLoading(false);
    })();
  }, [workId]);

  if (loading) return (
    <div className="p-4 space-y-4 animate-pulse">
      {[1, 2, 3, 4].map(i => <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
    </div>
  );

  if (!data) return (
    <div className="p-4">
      <button onClick={onBack} className="p-2 rounded-lg mb-4" style={{ backgroundColor: 'var(--bg-elevated)' }}>
        <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
      </button>
      <p className="text-center" style={{ color: 'var(--text-tertiary)' }}>Проект не найден</p>
    </div>
  );

  const work = data.work || {};
  const days = (data.days || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const summary = data.summary || {};
  const projWork = data.projWork || {};

  const totalEarned = summary.total_earned || days.reduce((s, c) => s + (parseFloat(c.amount_earned) || 0), 0);
  const totalHours = summary.total_hours || days.reduce((s, c) => s + (parseFloat(c.hours_worked) || 0), 0);
  const totalDays = summary.total_days || days.length;

  // Rate
  const tariffPoints = work.tariff_points || 0;
  const rateFromTariff = tariffPoints * 500;
  const avgRate = days.length > 0 ? days.reduce((s, d) => s + (parseFloat(d.day_rate) || 0), 0) / days.length : 0;
  const dayRate = rateFromTariff || Math.round(avgRate);

  // Period from actual days
  const dates = days.map(d => d.date).filter(Boolean).sort();
  const periodStart = dates[0];
  const periodEnd = dates[dates.length - 1];

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Детали проекта</h1>
      </div>

      {/* Project info card */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{work.work_title || 'Проект'}</p>
        {(projWork.city || projWork.object_name) && (
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {[projWork.city, projWork.object_name].filter(Boolean).join(' · ')}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Период</p>
            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
              {periodStart ? fmtDate(periodStart) : '?'} – {periodEnd ? fmtDate(periodEnd) : '?'}
            </p>
          </div>
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Ставка</p>
            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{dayRate ? `${fmtMoney(dayRate).replace(' ₽', '')}₽/см` : '—'}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Смена</p>
            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
              {work.shift_type === 'night' ? '🌙 Ночная' : work.shift_type === 'day' ? '☀️ Дневная' : work.shift_type || '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Hero — total earned */}
      <div className="rounded-xl p-5 text-center relative overflow-hidden" style={{
        background: 'linear-gradient(135deg, var(--bg-elevated) 0%, rgba(196,154,42,0.08) 100%)',
        border: '1px solid var(--border-norse)',
      }}>
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>Итого заработано</p>
        <p className="text-3xl font-bold" style={{ color: 'var(--gold)' }}>{fmtMoney(totalEarned)}</p>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          {totalDays} смен · {Math.round(totalHours)}ч
        </p>
      </div>

      {/* Timesheet table */}
      {days.length > 0 && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>📋 Табель</p>

          {days.map((c, i) => {
            const shift = c.shift || '';
            const icon = SHIFT_ICONS[shift] || '☀️';
            const label = SHIFT_LABELS[shift] || 'День';
            const points = c.day_rate ? Math.round(parseFloat(c.day_rate) / 500) : 0;
            const earned = parseFloat(c.amount_earned) || 0;

            return (
              <div key={i} className="flex items-center gap-2 py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span className="text-xs w-10 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{fmtDateShort(c.date)}</span>
                <span className="text-sm w-5 text-center flex-shrink-0">{icon}</span>
                <span className="text-xs flex-1" style={{ color: 'var(--text-primary)' }}>{label}</span>
                {points > 0 && <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>{points}бал</span>}
                <span className="text-xs font-semibold text-right flex-shrink-0 w-16" style={{ color: 'var(--gold)' }}>{fmtMoney(earned)}</span>
              </div>
            );
          })}

          {/* Totals */}
          <div className="flex justify-between pt-2 mt-1" style={{ borderTop: '1px dashed var(--border-norse)' }}>
            <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>ИТОГО: {totalDays} дней</span>
            <span className="text-xs font-bold" style={{ color: 'var(--gold)' }}>{fmtMoney(totalEarned)}</span>
          </div>
        </div>
      )}

      {/* Finance link */}
      <button onClick={() => navigate(`/field/money?detail=${workId}`)}
        className="w-full py-3 rounded-xl text-sm font-semibold text-center"
        style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--gold)' }}>
        💰 Финансы проекта
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   History List — /field/history
   ══════════════════════════════════════════════════════════════════ */
export default function FieldHistory() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [searchParams, setSearchParams] = useSearchParams();
  const detailWorkId = searchParams.get('detail');

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fieldApi.get('/worker/projects');
        setProjects(Array.isArray(res) ? res : res.projects || []);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  // Detail page
  if (detailWorkId) {
    return <HistoryDetail workId={detailWorkId} onBack={() => setSearchParams({})} />;
  }

  const totalProjects = projects.length;
  const totalShifts = projects.reduce((s, p) => s + (p.shifts_count || 0), 0);
  const totalEarned = projects.reduce((s, p) => s + (p.total_earned || 0), 0);

  const grouped = projects.reduce((acc, p) => {
    const y = (p.date_from || p.start_date) ? new Date(p.date_from || p.start_date).getFullYear() : 'Без даты';
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
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>История работ</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>📅 Проекты</p>
          <p className="font-bold text-sm mt-1" style={{ color: 'var(--gold)' }}>{totalProjects}</p>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>⚔️ Смены</p>
          <p className="font-bold text-sm mt-1" style={{ color: 'var(--gold)' }}>{totalShifts}</p>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>💰 Заработок</p>
          <p className="font-bold text-sm mt-1" style={{ color: 'var(--gold)' }}>{fmtMoney(totalEarned)}</p>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {projects.length === 0 && !error && (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <Briefcase size={36} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Пока нет завершённых проектов</p>
        </div>
      )}

      {/* Project list — click opens detail page */}
      {years.map(year => (
        <div key={year} className="space-y-2">
          {years.length > 1 && (
            <p className="text-xs font-bold tracking-widest px-1 pb-1" style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-norse)' }}>{year}</p>
          )}
          {grouped[year].map(p => {
            const key = p.work_id || p.id;
            const isActive = p.status === 'active' || p.is_active;
            return (
              <button key={key}
                onClick={() => { haptic.light(); setSearchParams({ detail: key }); }}
                className="w-full rounded-xl p-4 text-left flex items-center gap-3"
                style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate text-sm" style={{ color: 'var(--text-primary)' }}>{p.work_title || p.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    {[
                      p.city,
                      (p.date_from || p.start_date) ? `${fmtDate(p.date_from || p.start_date)}${(p.date_to || p.end_date) ? ` — ${fmtDate(p.date_to || p.end_date)}` : ''}` : null,
                      ROLE_LABELS[p.field_role] || p.role || null,
                      p.pm_name ? `РП: ${p.pm_name}` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span>{p.shifts_count || 0} смен</span>
                    <span style={{ color: 'var(--gold)' }}>{fmtMoney(p.total_earned)}</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-xs font-medium flex-shrink-0" style={{
                  backgroundColor: isActive ? 'rgba(34,197,94,0.15)' : 'rgba(156,163,175,0.15)',
                  color: isActive ? '#22c55e' : 'var(--text-tertiary)'
                }}>{isActive ? 'Активный' : 'Завершён'}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
