import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Calculator, ChevronRight } from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';

const STATUS_MAP = {
  draft: { label: 'Черновик', color: 'var(--text-tertiary)' },
  sent: { label: 'На рассмотрении', color: 'var(--blue)' },
  approved: { label: 'Одобрен', color: 'var(--green)' },
  rework: { label: 'Доработка', color: 'var(--gold)' },
  question: { label: 'Вопрос', color: 'var(--gold)' },
  rejected: { label: 'Отклонён', color: 'var(--red-soft)' },
};
const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'draft', label: 'Черновик' },
  { id: 'sent', label: 'На рассмотрении' }, { id: 'approved', label: 'Одобрен' },
  { id: 'rework', label: 'Доработка' }, { id: 'rejected', label: 'Отклонён' },
];

export default function AllEstimates() {
  const haptic = useHaptic();
  const navigate = useNavigate();
  const [estimates, setEstimates] = useState([]);
  const [tenders, setTenders] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, tRes] = await Promise.all([
        api.get('/estimates?limit=200'),
        api.get('/data/tenders').catch(() => null),
      ]);
      setEstimates(api.extractRows(eRes) || []);
      if (tRes) {
        const rows = api.extractRows(tRes) || [];
        const map = {};
        rows.forEach((t) => { map[t.id] = t.name || t.title || t.customer_name || `#${t.id}`; });
        setTenders(map);
      }
    } catch { setEstimates([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let list = [...estimates].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    if (filter !== 'all') list = list.filter((e) => e.approval_status === filter);
    return list;
  }, [estimates, filter]);

  const stats = useMemo(() => ({
    total: estimates.length,
    approved: estimates.filter((e) => e.approval_status === 'approved').length,
    sent: estimates.filter((e) => e.approval_status === 'sent').length,
    rejected: estimates.filter((e) => e.approval_status === 'rejected').length,
  }), [estimates]);

  return (
    <PageShell title="Расчёты">
      <PullToRefresh onRefresh={fetchData}>
        {!loading && estimates.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5 px-1 pb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <div className="card-glass flex flex-col items-center gap-0.5 py-2.5"><p className="text-[13px] font-bold c-primary">{stats.total}</p><p className="text-[9px] c-tertiary">Всего</p></div>
            <div className="card-glass flex flex-col items-center gap-0.5 py-2.5"><p className="text-[13px] font-bold c-green">{stats.approved}</p><p className="text-[9px] c-tertiary">Одобрено</p></div>
            <div className="card-glass flex flex-col items-center gap-0.5 py-2.5"><p className="text-[13px] font-bold c-blue">{stats.sent}</p><p className="text-[9px] c-tertiary">На рассмотр.</p></div>
            <div className="card-glass flex flex-col items-center gap-0.5 py-2.5"><p className="text-[13px] font-bold c-red">{stats.rejected}</p><p className="text-[9px] c-tertiary">Отклонено</p></div>
          </div>
        )}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id ? 'true' : undefined}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={5} /> : filtered.length === 0 ? (
          <EmptyState icon={Calculator} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет расчётов" description="Расчёты появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((est, i) => {
              const st = STATUS_MAP[est.approval_status] || STATUS_MAP.draft;
              const price = Number(est.total_price || est.price || 0);
              const cost = Number(est.total_cost || est.cost || 0);
              const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
              return (
                <button key={est.id} onClick={() => { haptic.light(); navigate(`/estimate-report/${est.id}`); }} className="w-full text-left card-glass px-4 py-3 spring-tap" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{est.name || (est.tender_id && tenders[est.tender_id]) || `Расчёт #${est.id}`}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  {est.tender_id && tenders[est.tender_id] && est.name && <p className="text-[12px] mt-0.5 truncate c-secondary">{tenders[est.tender_id]}</p>}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="status-badge" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {price > 0 && <span className="text-[10px] font-semibold c-blue">{formatMoney(price, { short: true })}</span>}
                    {margin > 0 && <span className="text-[10px] font-semibold" style={{ color: margin >= 15 ? 'var(--green)' : 'var(--gold)' }}>{margin}%</span>}
                    {est.created_at && <span className="text-[10px] c-tertiary">{relativeTime(est.created_at)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
    </PageShell>
  );
}
