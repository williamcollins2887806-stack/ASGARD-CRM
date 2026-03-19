import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
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
  const [estimates, setEstimates] = useState([]);
  const [tenders, setTenders] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);

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
                <button key={est.id} onClick={() => { haptic.light(); setDetail(est); }} className="w-full text-left card-glass px-4 py-3 spring-tap" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
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
      <EstimateDetailSheet estimate={detail} onClose={() => setDetail(null)} tenders={tenders} />
    </PageShell>
  );
}

function EstimateDetailSheet({ estimate, onClose, tenders }) {
  if (!estimate) return null;
  const e = estimate;
  const st = STATUS_MAP[e.approval_status] || STATUS_MAP.draft;
  const price = Number(e.total_price || e.price || 0);
  const cost = Number(e.total_cost || e.cost || 0);
  const profit = price - cost;
  const margin = price > 0 ? Math.round((profit / price) * 100) : 0;
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    e.name && { label: 'Название', value: e.name },
    e.tender_id && tenders[e.tender_id] && { label: 'Тендер', value: tenders[e.tender_id] },
    (e.author_name || e.created_by_name) && { label: 'Автор', value: e.author_name || e.created_by_name },
    e.created_at && { label: 'Создан', value: relativeTime(e.created_at) },
    e.approval_comment && { label: 'Комментарий', value: e.approval_comment, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!estimate} onClose={onClose} title={e.name || `Расчёт #${e.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {price > 0 && (
          <div className="card-glass rounded-xl p-3">
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="text-center"><p className="text-[10px] uppercase font-semibold c-tertiary">Цена</p><p className="text-[14px] font-bold c-blue">{formatMoney(price, { short: true })}</p></div>
              <div className="text-center"><p className="text-[10px] uppercase font-semibold c-tertiary">С/С</p><p className="text-[14px] font-bold c-gold">{formatMoney(cost, { short: true })}</p></div>
              <div className="text-center"><p className="text-[10px] uppercase font-semibold c-tertiary">Прибыль</p><p className="text-[14px] font-bold" style={{ color: profit >= 0 ? 'var(--green)' : 'var(--red-soft)' }}>{formatMoney(profit, { short: true })}</p></div>
            </div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold c-tertiary">Маржа</span>
              <span className="text-[12px] font-bold" style={{ color: margin >= 15 ? 'var(--green)' : 'var(--gold)' }}>{margin}%</span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--bg-surface-alt)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, margin))}%`, background: margin >= 15 ? 'var(--green)' : 'var(--gold)' }} />
            </div>
          </div>
        )}
        {fields.map((f, i) => <div key={i}><p className="input-label">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>}</div>)}
      </div>
    </BottomSheet>
  );
}
