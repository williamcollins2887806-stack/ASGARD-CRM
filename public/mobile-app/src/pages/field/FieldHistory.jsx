import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Briefcase, ChevronRight, TrendingUp, Calendar, Zap } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';

function fmtMoney(n) { return (n || 0).toLocaleString('ru-RU') + ' ₽'; }
function fmtMoneyShort(n) { return (n || 0).toLocaleString('ru-RU'); }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`; }
function fmtDateShort(iso) { if (!iso) return ''; const d = new Date(iso); return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`; }
function fmtHours(h) { return h ? `${Math.floor(h)}ч ${Math.round((h % 1) * 60)}м` : '—'; }

const SHIFT_LABELS = { day: 'Дневная', night: 'Ночная', half: 'Полсмены', travel: 'Дорога', standby: 'Дежурство', road: 'Дорога' };
const SHIFT_ICONS = { day: '☀️', night: '🌙', road: '🚗', travel: '✈️', half: '½', standby: '⏳' };
const SHIFT_COLORS = { day: '#f59e0b', night: '#6366f1', road: '#3b82f6', travel: '#3b82f6', half: '#8b5cf6', standby: '#6b7280' };
const ROLE_LABELS = { senior_master: 'Ст. мастер', shift_master: 'Мастер', worker: 'Рабочий' };

// ── CountUp hook ──────────────────────────────────────────────────
function useCountUp(target, duration = 1200) {
  const [val, setVal] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    if (!target) { setVal(0); return; }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setVal(Math.round(ease * target));
      if (t < 1) ref.current = requestAnimationFrame(step);
    };
    ref.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(ref.current);
  }, [target, duration]);
  return val;
}

// ── Slide-in wrapper ──────────────────────────────────────────────
function SlideIn({ delay = 0, children }) {
  return (
    <div style={{
      animation: `fieldHistSlideUp 0.45s cubic-bezier(.16,1,.3,1) ${delay}s both`,
    }}>{children}</div>
  );
}

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
      <div className="h-12 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
      <div className="h-40 rounded-2xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
      <div className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
      {[1,2,3,4].map(i => <div key={i} className="h-12 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
    </div>
  );

  if (!data) return (
    <div className="p-4">
      <button onClick={onBack} className="p-2 rounded-lg mb-4" style={{ backgroundColor: 'var(--bg-elevated)' }}>
        <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
      </button>
      <p className="text-center py-12" style={{ color: 'var(--text-tertiary)' }}>Проект не найден</p>
    </div>
  );

  const work = data.work || {};
  const days = (data.days || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const summary = data.summary || {};
  const projWork = data.projWork || {};

  const totalEarned = summary.total_earned || days.reduce((s, c) => s + (parseFloat(c.amount_earned) || 0), 0);
  const totalHours = summary.total_hours || days.reduce((s, c) => s + (parseFloat(c.hours_worked) || 0), 0);
  const totalDays = summary.total_days || days.length;

  const tariffPoints = work.tariff_points || 0;
  const rateFromTariff = tariffPoints * 500;
  const avgRate = days.length > 0 ? days.reduce((s, d) => s + (parseFloat(d.day_rate) || 0), 0) / days.length : 0;
  const dayRate = rateFromTariff || Math.round(avgRate);

  const dates = days.map(d => d.date).filter(Boolean).sort();
  const periodStart = dates[0];
  const periodEnd = dates[dates.length - 1];

  return (
    <div className="pb-24" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Keyframes */}
      <style>{`
        @keyframes fieldHistSlideUp { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        @keyframes fieldHistGradShift { 0%,100% { background-position:0% 50% } 50% { background-position:100% 50% } }
        @keyframes fieldHistPulse { 0%,100% { opacity:0.04 } 50% { opacity:0.08 } }
      `}</style>

      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
          </button>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Детали проекта</h1>
        </div>

        {/* ─── Hero — total earned ──────────────────────────── */}
        <SlideIn delay={0}>
          <div className="rounded-2xl p-6 relative overflow-hidden" style={{
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)',
            backgroundSize: '200% 200%',
            animation: 'fieldHistGradShift 8s ease infinite',
            border: '1px solid rgba(196,154,42,0.15)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            {/* ASGARD watermark */}
            <div style={{ position: 'absolute', right: '-8px', top: '50%', transform: 'translateY(-50%)',
              fontSize: '4.5rem', fontWeight: 900, letterSpacing: '6px', pointerEvents: 'none',
              animation: 'fieldHistPulse 4s ease infinite',
              color: 'rgba(255,255,255,0.04)',
            }}>ASGARD</div>

            <div style={{ position: 'relative', zIndex: 1 }}>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(196,154,42,0.7)' }}>
                Итого заработано
              </p>
              <HeroAmount target={totalEarned} />
              <div className="flex items-center justify-center gap-4 mt-3">
                <div className="flex items-center gap-1.5">
                  <Calendar size={13} style={{ color: 'rgba(255,255,255,0.4)' }} />
                  <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>{totalDays} смен</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Zap size={13} style={{ color: 'rgba(255,255,255,0.4)' }} />
                  <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>{fmtHours(totalHours)}</span>
                </div>
                {dayRate > 0 && (
                  <div className="flex items-center gap-1.5">
                    <TrendingUp size={13} style={{ color: 'rgba(255,255,255,0.4)' }} />
                    <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>{fmtMoneyShort(dayRate)}₽/см</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </SlideIn>

        {/* ─── Project info card ────────────────────────────── */}
        <SlideIn delay={0.08}>
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', borderLeft: '3px solid var(--gold)', borderRight: '1px solid var(--border-norse)', borderTop: '1px solid var(--border-norse)', borderBottom: '1px solid var(--border-norse)' }}>
            <p className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{work.work_title || 'Проект'}</p>
            {(projWork.city || projWork.object_name) && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                {[projWork.city, projWork.object_name].filter(Boolean).join(' · ')}
              </p>
            )}
            <div className="flex gap-4 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-norse)' }}>
              <InfoPill label="Период" value={`${periodStart ? fmtDateShort(periodStart) : '?'} – ${periodEnd ? fmtDateShort(periodEnd) : '?'}`} />
              <InfoPill label="Ставка" value={dayRate ? `${fmtMoneyShort(dayRate)}₽` : '—'} gold />
              <InfoPill label="Смена" value={work.shift_type === 'night' ? '🌙 Ночь' : work.shift_type === 'day' ? '☀️ День' : work.shift_type || '—'} />
            </div>
          </div>
        </SlideIn>

        {/* ─── Timesheet ────────────────────────────────────── */}
        {days.length > 0 && (
          <SlideIn delay={0.16}>
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
              {/* Table header */}
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>📋 Табель</p>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{totalDays} дн.</span>
              </div>

              {/* Column headers */}
              <div className="px-4 pb-2 flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                <span className="w-11">Дата</span>
                <span className="w-7 text-center">Тип</span>
                <span className="flex-1">Смена</span>
                <span className="w-8 text-right">Бал</span>
                <span className="w-16 text-right">Сумма</span>
              </div>

              {/* Rows */}
              <div className="px-2">
                {days.map((c, i) => {
                  const shift = c.shift || 'day';
                  const icon = SHIFT_ICONS[shift] || '☀️';
                  const label = SHIFT_LABELS[shift] || 'День';
                  const color = SHIFT_COLORS[shift] || '#f59e0b';
                  const points = c.day_rate ? Math.round(parseFloat(c.day_rate) / 500) : 0;
                  const earned = parseFloat(c.amount_earned) || 0;
                  const isOdd = i % 2 === 1;

                  return (
                    <div key={i} className="flex items-center gap-2 px-2 py-2.5 rounded-lg mx-0"
                      style={{ backgroundColor: isOdd ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                      <span className="text-xs font-medium w-11 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{fmtDateShort(c.date)}</span>
                      <span className="w-7 text-center text-base flex-shrink-0">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium" style={{ color }}>{label}</span>
                      </div>
                      <span className="text-xs w-8 text-right flex-shrink-0" style={{ color: points > 0 ? 'var(--text-secondary)' : 'transparent' }}>
                        {points > 0 ? points : ''}
                      </span>
                      <span className="text-sm font-bold w-16 text-right flex-shrink-0" style={{ color: 'var(--gold)' }}>
                        {fmtMoneyShort(earned)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* ─── Totals ─── */}
              <div className="mx-4 mt-1 mb-4 rounded-xl p-3 flex items-center justify-between"
                style={{ background: 'linear-gradient(135deg, rgba(196,154,42,0.08), rgba(196,154,42,0.03))', border: '1px solid rgba(196,154,42,0.15)' }}>
                <div>
                  <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>ИТОГО</span>
                  <span className="text-xs ml-2" style={{ color: 'var(--text-tertiary)' }}>{totalDays} дн · {fmtHours(totalHours)}</span>
                </div>
                <span className="text-base font-black" style={{ color: 'var(--gold)' }}>{fmtMoney(totalEarned)}</span>
              </div>
            </div>
          </SlideIn>
        )}

        {/* ─── Finance link ─────────────────────────────────── */}
        <SlideIn delay={0.24}>
          <button onClick={() => navigate(`/field/money?detail=${workId}`)}
            className="w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, var(--gold), #b8860b)', color: '#000', boxShadow: '0 4px 16px rgba(196,154,42,0.25)' }}>
            💰 Финансы проекта
          </button>
        </SlideIn>
      </div>
    </div>
  );
}

function HeroAmount({ target }) {
  const val = useCountUp(target);
  return (
    <p className="font-black mt-1" style={{ color: 'var(--gold)', fontSize: '2.75rem', lineHeight: 1.1, textShadow: '0 2px 20px rgba(196,154,42,0.3)' }}>
      {val.toLocaleString('ru-RU')} <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>₽</span>
    </p>
  );
}

function InfoPill({ label, value, gold }) {
  return (
    <div className="flex-1">
      <p className="text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
      <p className="text-sm font-semibold mt-0.5" style={{ color: gold ? 'var(--gold)' : 'var(--text-primary)' }}>{value}</p>
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
      <style>{`@keyframes fieldHistSlideUp { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }`}</style>

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>История работ</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: '📅', label: 'Проекты', val: totalProjects },
          { icon: '⚔️', label: 'Смены', val: totalShifts },
          { icon: '💰', label: 'Заработок', val: fmtMoney(totalEarned) },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{s.icon} {s.label}</p>
            <p className="font-bold text-sm mt-1" style={{ color: 'var(--gold)' }}>{s.val}</p>
          </div>
        ))}
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {projects.length === 0 && !error && (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <Briefcase size={36} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Пока нет завершённых проектов</p>
        </div>
      )}

      {/* Project list */}
      {years.map(year => (
        <div key={year} className="space-y-2">
          {years.length > 1 && (
            <p className="text-xs font-bold tracking-widest px-1 pb-1" style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-norse)' }}>{year}</p>
          )}
          {grouped[year].map((p, idx) => {
            const key = p.work_id || p.id;
            const isActive = p.status === 'active' || p.is_active;
            return (
              <SlideIn key={key} delay={0.04 * idx}>
                <button
                  onClick={() => { haptic.light(); setSearchParams({ detail: key }); }}
                  className="w-full rounded-xl p-4 text-left flex items-center gap-3 active:scale-[0.98] transition-transform"
                  style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate text-sm" style={{ color: 'var(--text-primary)' }}>{p.work_title || p.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {[
                        p.city,
                        (p.date_from || p.start_date) ? `${fmtDate(p.date_from || p.start_date)}${(p.date_to || p.end_date) ? ` — ${fmtDate(p.date_to || p.end_date)}` : ''}` : null,
                        ROLE_LABELS[p.field_role] || p.role || null,
                        p.pm_name ? `РП: ${p.pm_name}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span>⚔️ {p.shifts_count || 0} смен</span>
                      <span className="font-semibold" style={{ color: 'var(--gold)' }}>{fmtMoney(p.total_earned)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{
                      backgroundColor: isActive ? 'rgba(34,197,94,0.15)' : 'rgba(156,163,175,0.1)',
                      color: isActive ? '#22c55e' : 'var(--text-tertiary)'
                    }}>{isActive ? 'Активный' : 'Завершён'}</span>
                    <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />
                  </div>
                </button>
              </SlideIn>
            );
          })}
        </div>
      ))}
    </div>
  );
}
