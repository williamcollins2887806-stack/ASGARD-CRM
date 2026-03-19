import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Calculator, ChevronRight, Send } from 'lucide-react';
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
  { id: 'all', label: 'Все' }, { id: 'draft', label: 'Черновики' },
  { id: 'sent', label: 'На рассмотрении' }, { id: 'approved', label: 'Одобрен' }, { id: 'rework', label: 'Доработка' },
];

export default function PmCalcs() {
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
        api.get('/data/estimates'),
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

  const handleSubmit = async (id) => {
    haptic.light();
    try {
      await api.put(`/data/estimates/${id}`, { approval_status: 'sent' });
      setEstimates((p) => p.map((e) => e.id === id ? { ...e, approval_status: 'sent' } : e));
      setDetail(null);
      haptic.success();
    } catch {}
  };

  return (
    <PageShell title="Мои расчёты">
      <PullToRefresh onRefresh={fetchData}>
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap" style={{ background: filter === f.id ? 'var(--bg-elevated)' : 'transparent', color: filter === f.id ? 'var(--text-primary)' : 'var(--text-tertiary)', border: filter === f.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent' }}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={5} /> : filtered.length === 0 ? (
          <EmptyState icon={Calculator} iconColor="var(--gold)" iconBg="color-mix(in srgb, var(--gold) 10%, transparent)" title="Нет расчётов" description="Ваши расчёты появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((est, i) => {
              const st = STATUS_MAP[est.approval_status] || STATUS_MAP.draft;
              const price = Number(est.total_price || est.price || 0);
              const cost = Number(est.total_cost || est.cost || 0);
              const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
              return (
                <button key={est.id} onClick={() => { haptic.light(); setDetail(est); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', backdropFilter: 'blur(8px)', border: '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{est.name || (est.tender_id && tenders[est.tender_id]) || `Расчёт #${est.id}`}</p>
                    <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {price > 0 && <span className="text-[10px] font-semibold" style={{ color: 'var(--blue)' }}>{formatMoney(price, { short: true })}</span>}
                    {margin > 0 && <span className="text-[10px] font-semibold" style={{ color: margin >= 15 ? 'var(--green)' : 'var(--gold)' }}>{margin}%</span>}
                    {est.created_at && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{relativeTime(est.created_at)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <PmCalcDetailSheet estimate={detail} onClose={() => setDetail(null)} tenders={tenders} onSubmit={handleSubmit} />
    </PageShell>
  );
}

function PmCalcDetailSheet({ estimate, onClose, tenders, onSubmit }) {
  if (!estimate) return null;
  const e = estimate;
  const st = STATUS_MAP[e.approval_status] || STATUS_MAP.draft;
  const price = Number(e.total_price || e.price || 0);
  const cost = Number(e.total_cost || e.cost || 0);
  const profit = price - cost;
  const margin = price > 0 ? Math.round((profit / price) * 100) : 0;
  const canSubmit = e.approval_status === 'draft' || e.approval_status === 'rework';
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    e.name && { label: 'Название', value: e.name },
    e.tender_id && tenders[e.tender_id] && { label: 'Тендер', value: tenders[e.tender_id] },
    (e.author_name || e.created_by_name) && { label: 'Автор', value: e.author_name || e.created_by_name },
    e.created_at && { label: 'Создан', value: relativeTime(e.created_at) },
    e.description && { label: 'Описание', value: e.description, full: true },
    e.approval_comment && { label: 'Комментарий', value: e.approval_comment, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!estimate} onClose={onClose} title={e.name || `Расчёт #${e.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {price > 0 && (
          <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)' }}>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="text-center"><p className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-tertiary)' }}>Цена</p><p className="text-[14px] font-bold" style={{ color: 'var(--blue)' }}>{formatMoney(price, { short: true })}</p></div>
              <div className="text-center"><p className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-tertiary)' }}>С/С</p><p className="text-[14px] font-bold" style={{ color: 'var(--gold)' }}>{formatMoney(cost, { short: true })}</p></div>
              <div className="text-center"><p className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-tertiary)' }}>Прибыль</p><p className="text-[14px] font-bold" style={{ color: profit >= 0 ? 'var(--green)' : 'var(--red-soft)' }}>{formatMoney(profit, { short: true })}</p></div>
            </div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Маржа</span>
              <span className="text-[12px] font-bold" style={{ color: margin >= 15 ? 'var(--green)' : 'var(--gold)' }}>{margin}%</span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--bg-surface-alt)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, margin))}%`, background: margin >= 15 ? 'var(--green)' : 'var(--gold)' }} />
            </div>
          </div>
        )}
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] ${f.full ? 'whitespace-pre-wrap' : ''}`} style={{ color: 'var(--text-primary)' }}>{f.value}</p>}</div>)}
        {canSubmit && (
          <button onClick={() => onSubmit(e.id)} className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] spring-tap mt-2" style={{ background: 'var(--gold-gradient)', color: '#fff' }}>
            <Send size={16} /> Отправить на согласование
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
