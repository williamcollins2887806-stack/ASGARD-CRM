import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { GanttChart, ChevronRight } from 'lucide-react';
import { formatDate, formatMoney } from '@/lib/utils';

const DAY_W = 3;

function getBarColor(work) {
  const s = (work.work_status || '').toLowerCase();
  if (['завершена', 'закрыт', 'закрыто', 'работы сдали'].some((x) => s.includes(x))) return 'var(--green)';
  if (['в работе', 'работы начались', 'приступили'].some((x) => s.includes(x))) return 'var(--blue)';
  return 'var(--gold)';
}

export default function Gantt() {
  const haptic = useHaptic();
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const scrollRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get('/works?limit=500'); setWorks(api.extractRows(res) || []); }
    catch { setWorks([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const { rows, months, timelineStart, todayOffset, totalDays } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 10, 0);
    const total = Math.ceil((end - start) / 86400000);
    const todayOff = Math.ceil((now - start) / 86400000) * DAY_W;

    const ms = [];
    for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const daysInMonth = mEnd.getDate();
      ms.push({ label: d.toLocaleString('ru', { month: 'short', year: '2-digit' }), width: daysInMonth * DAY_W });
    }

    const rs = works.filter((w) => {
      const s = w.start_fact || w.start_plan;
      const e = w.end_fact || w.end_plan;
      return s && e;
    }).map((w) => {
      const s = new Date(w.start_fact || w.start_plan);
      const e = new Date(w.end_fact || w.end_plan);
      const left = Math.max(0, Math.ceil((s - start) / 86400000)) * DAY_W;
      const width = Math.max(DAY_W, Math.ceil((e - s) / 86400000) * DAY_W);
      const isOverdue = e < now && !['завершена', 'закрыт', 'закрыто'].some((x) => (w.work_status || '').toLowerCase().includes(x));
      return { ...w, left, width, color: isOverdue ? 'var(--red-soft)' : getBarColor(w) };
    });

    return { rows: rs, months: ms, timelineStart: start, todayOffset: todayOff, totalDays: total };
  }, [works]);

  useEffect(() => {
    if (scrollRef.current && todayOffset > 0) {
      setTimeout(() => { scrollRef.current?.scrollTo({ left: todayOffset - 100, behavior: 'smooth' }); }, 300);
    }
  }, [todayOffset, loading]);

  return (
    <PageShell title="Диаграмма Ганта">
      <PullToRefresh onRefresh={fetchData}>
        {loading ? <SkeletonList count={6} /> : rows.length === 0 ? (
          <EmptyState icon={GanttChart} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет данных" description="Работы с датами появятся здесь" />
        ) : (
          <div className="overflow-x-auto pb-4 -mx-1" ref={scrollRef}>
            <div style={{ width: totalDays * DAY_W, minWidth: '100%' }}>
              {/* Month headers */}
              <div className="flex sticky top-0 z-10" style={{ background: 'var(--bg-primary)' }}>
                {months.map((m, i) => (
                  <div key={i} className="text-center text-[10px] font-semibold py-1.5 shrink-0" style={{ width: m.width, color: 'var(--text-tertiary)', borderBottom: '0.5px solid var(--border-norse)' }}>{m.label}</div>
                ))}
              </div>
              {/* Rows */}
              {rows.map((row, i) => (
                <button key={row.id} onClick={() => { haptic.light(); setDetail(row); }} className="flex items-center w-full spring-tap" style={{ height: 36, background: i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--bg-surface) 50%, transparent)', position: 'relative' }}>
                  {/* Today line */}
                  {i === 0 && <div style={{ position: 'absolute', left: todayOffset, top: 0, bottom: 0, width: 1, background: 'var(--red-soft)', zIndex: 5, opacity: 0.5 }} />}
                  {/* Bar */}
                  <div className="absolute rounded-sm" style={{ left: row.left, width: row.width, height: 20, top: 8, background: row.color, opacity: 0.8 }}>
                    <span className="text-[8px] font-semibold px-1 truncate block leading-[20px]" style={{ color: '#fff' }}>{row.work_title || row.object_name || ''}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </PullToRefresh>
      <GanttDetailSheet work={detail} onClose={() => setDetail(null)} />
    </PageShell>
  );
}

function GanttDetailSheet({ work, onClose }) {
  if (!work) return null;
  const w = work;
  const fields = [
    w.work_status && { label: 'Статус', value: w.work_status, color: getBarColor(w) },
    w.work_title && { label: 'Работа', value: w.work_title },
    w.object_name && { label: 'Объект', value: w.object_name },
    w.customer_name && { label: 'Заказчик', value: w.customer_name },
    w.start_plan && { label: 'План начала', value: formatDate(w.start_plan) },
    w.end_plan && { label: 'План окончания', value: formatDate(w.end_plan) },
    w.start_fact && { label: 'Факт начала', value: formatDate(w.start_fact) },
    w.end_fact && { label: 'Факт окончания', value: formatDate(w.end_fact) },
    (w.pm_name || w.manager_name) && { label: 'РП', value: w.pm_name || w.manager_name },
    Number(w.contract_value) > 0 && { label: 'Бюджет', value: formatMoney(w.contract_value) },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!work} onClose={onClose} title={w.work_title || w.object_name || `#${w.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className="text-[14px]" style={{ color: 'var(--text-primary)' }}>{f.value}</p>}</div>)}
      </div>
    </BottomSheet>
  );
}
