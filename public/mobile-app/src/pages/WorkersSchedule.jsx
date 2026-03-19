import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { CalendarDays, ChevronLeft, ChevronRight as ChevRight, Phone } from 'lucide-react';

const KIND_MAP = {
  free: { label: 'Свободен', color: 'var(--text-tertiary)', bg: 'transparent' },
  office: { label: 'Офис', color: 'var(--blue)', bg: 'color-mix(in srgb, var(--blue) 20%, transparent)' },
  trip: { label: 'Командировка', color: '#7B68EE', bg: 'color-mix(in srgb, #7B68EE 20%, transparent)' },
  work: { label: 'Работа', color: 'var(--green)', bg: 'color-mix(in srgb, var(--green) 20%, transparent)' },
  note: { label: 'Заметка', color: 'var(--gold)', bg: 'color-mix(in srgb, var(--gold) 20%, transparent)' },
  reserve: { label: 'Бронь', color: '#7B68EE', bg: 'color-mix(in srgb, #7B68EE 20%, transparent)' },
};

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export default function WorkersSchedule() {
  const haptic = useHaptic();
  const [employees, setEmployees] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [detail, setDetail] = useState(null);
  const scrollRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const daysCount = getDaysInMonth(month.year, month.month);
    const dateFrom = `${month.year}-${String(month.month + 1).padStart(2, '0')}-01`;
    const dateTo = `${month.year}-${String(month.month + 1).padStart(2, '0')}-${String(daysCount).padStart(2, '0')}`;
    try {
      const [eRes, sRes] = await Promise.all([
        api.get('/staff/employees?limit=1000'),
        api.get(`/staff/schedule?date_from=${dateFrom}&date_to=${dateTo}`),
      ]);
      const allEmp = api.extractRows(eRes) || [];
      setEmployees(allEmp.filter((e) => !e.user_id && !e.deleted && e.is_active !== false).sort((a, b) => (a.fio || a.full_name || '').localeCompare(b.fio || b.full_name || '', 'ru')));
      setSchedule(api.extractRows(sRes) || []);
    } catch { setEmployees([]); setSchedule([]); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const days = useMemo(() => {
    const count = getDaysInMonth(month.year, month.month);
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(month.year, month.month, i + 1);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const isToday = d.toDateString() === new Date().toDateString();
      return { num: i + 1, date: `${month.year}-${String(month.month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`, isWeekend, isToday };
    });
  }, [month]);

  const scheduleMap = useMemo(() => {
    const map = {};
    schedule.forEach((s) => { map[`${s.employee_id}_${s.date}`] = s; });
    return map;
  }, [schedule]);

  const prevMonth = () => { haptic.light(); setMonth((m) => m.month === 0 ? { year: m.year - 1, month: 11 } : { ...m, month: m.month - 1 }); };
  const nextMonth = () => { haptic.light(); setMonth((m) => m.month === 11 ? { year: m.year + 1, month: 0 } : { ...m, month: m.month + 1 }); };

  const monthLabel = new Date(month.year, month.month).toLocaleString('ru', { month: 'long', year: 'numeric' });

  useEffect(() => {
    if (scrollRef.current) {
      const today = new Date();
      if (today.getMonth() === month.month && today.getFullYear() === month.year) {
        const offset = (today.getDate() - 1) * 36;
        setTimeout(() => scrollRef.current?.scrollTo({ left: Math.max(0, offset - 50), behavior: 'smooth' }), 300);
      }
    }
  }, [month, loading]);

  return (
    <PageShell title="График рабочих">
      <PullToRefresh onRefresh={fetchData}>
        {/* Month nav */}
        <div className="flex items-center justify-between px-2 pb-3">
          <button onClick={prevMonth} className="spring-tap p-2" style={{ color: 'var(--text-tertiary)' }}><ChevronLeft size={20} /></button>
          <p className="text-[14px] font-bold capitalize" style={{ color: 'var(--text-primary)' }}>{monthLabel}</p>
          <button onClick={nextMonth} className="spring-tap p-2" style={{ color: 'var(--text-tertiary)' }}><ChevRight size={20} /></button>
        </div>

        {/* Legend */}
        <div className="flex gap-2 px-2 pb-3 overflow-x-auto no-scrollbar">
          {Object.entries(KIND_MAP).filter(([k]) => k !== 'free').map(([k, v]) => (
            <span key={k} className="flex items-center gap-1 shrink-0">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: v.color }} />
              <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{v.label}</span>
            </span>
          ))}
        </div>

        {loading ? <SkeletonList count={5} /> : employees.length === 0 ? (
          <EmptyState icon={CalendarDays} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет рабочих" description="Рабочие появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {employees.map((emp, i) => {
              const name = emp.fio || emp.full_name || emp.last_name || `#${emp.id}`;
              const todayDate = new Date().toISOString().slice(0, 10);
              const todayEntry = scheduleMap[`${emp.id}_${todayDate}`];
              const todayKind = todayEntry ? (KIND_MAP[todayEntry.kind] || KIND_MAP.free) : KIND_MAP.free;
              return (
                <div key={emp.id} className="rounded-2xl overflow-hidden" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 30}ms both` }}>
                  {/* Employee header */}
                  <button onClick={() => { haptic.light(); setDetail(emp); }} className="w-full flex items-center gap-2 px-3 py-2 spring-tap">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: 'var(--hero-gradient)', color: '#fff' }}>{name.charAt(0)}</div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{name}</p>
                    </div>
                    {todayKind.label !== 'Свободен' && <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold shrink-0" style={{ background: `color-mix(in srgb, ${todayKind.color} 15%, transparent)`, color: todayKind.color }}>{todayKind.label}</span>}
                  </button>
                  {/* Calendar strip */}
                  <div className="overflow-x-auto no-scrollbar px-1 pb-1.5" ref={i === 0 ? scrollRef : undefined}>
                    <div className="flex gap-0.5">
                      {days.map((d) => {
                        const entry = scheduleMap[`${emp.id}_${d.date}`];
                        const kind = entry ? (KIND_MAP[entry.kind] || KIND_MAP.free) : KIND_MAP.free;
                        return (
                          <div key={d.date} className="flex flex-col items-center shrink-0" style={{ width: 34 }}>
                            <span className="text-[8px] mb-0.5" style={{ color: d.isWeekend ? 'var(--red-soft)' : 'var(--text-tertiary)' }}>{d.num}</span>
                            <div className="w-6 h-5 rounded-sm" style={{ background: kind.bg || 'transparent', border: d.isToday ? '1.5px solid var(--red-soft)' : '0.5px solid var(--border-norse)' }} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <EmployeeScheduleSheet employee={detail} onClose={() => setDetail(null)} days={days} scheduleMap={scheduleMap} />
    </PageShell>
  );
}

function EmployeeScheduleSheet({ employee, onClose, days, scheduleMap }) {
  if (!employee) return null;
  const emp = employee;
  const name = emp.fio || emp.full_name || emp.last_name || `#${emp.id}`;
  const entries = days.map((d) => ({ ...d, entry: scheduleMap[`${emp.id}_${d.date}`] })).filter((d) => d.entry && d.entry.kind !== 'free');
  const counts = {};
  entries.forEach((d) => { const k = d.entry.kind; counts[k] = (counts[k] || 0) + 1; });

  return (
    <BottomSheet open={!!employee} onClose={onClose} title={name}>
      <div className="flex flex-col gap-3 pb-4">
        {/* Summary */}
        {Object.keys(counts).length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {Object.entries(counts).map(([k, v]) => {
              const km = KIND_MAP[k] || KIND_MAP.free;
              return <span key={k} className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${km.color} 15%, transparent)`, color: km.color }}>{km.label}: {v}</span>;
            })}
          </div>
        )}
        {/* Day list */}
        {entries.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>Весь месяц свободен</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {entries.map((d) => {
              const km = KIND_MAP[d.entry.kind] || KIND_MAP.free;
              return (
                <div key={d.date} className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}>
                  <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{d.num}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${km.color} 15%, transparent)`, color: km.color }}>{km.label}</span>
                </div>
              );
            })}
          </div>
        )}
        {/* Phone */}
        {emp.phone && (
          <a href={`tel:${emp.phone}`} className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] spring-tap mt-1" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)', color: 'var(--green)' }}>
            <Phone size={16} /> Позвонить
          </a>
        )}
      </div>
    </BottomSheet>
  );
}
