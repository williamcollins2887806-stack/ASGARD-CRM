import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { CreateEstimateSheet } from '@/components/estimates/CreateEstimateSheet';
import { Calculator, ChevronRight, Plus, MessageSquare } from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';
import { StatCard, StatRow } from '@/components/shared/StatCard';

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

const CAN_CREATE = ['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];

export default function AllEstimates() {
  const haptic = useHaptic();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const [estimates, setEstimates] = useState([]);
  const [tenders, setTenders] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);

  const canCreate = CAN_CREATE.includes(role);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, tRes] = await Promise.all([
        api.get('/estimates?limit=200'),
        api.get('/tenders?limit=500').catch(() => null),
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

  const handleCreated = useCallback((est) => {
    setEstimates((p) => [est, ...p]);
    navigate(`/estimate-report/${est.id}`);
  }, [navigate]);

  return (
    <PageShell title="Расчёты">
      <PullToRefresh onRefresh={fetchData}>
        {!loading && estimates.length > 0 && (
          <StatRow cols={3}>
            <StatCard icon={Calculator} label="Всего"        value={stats.total}    color="var(--text-primary)" delay={0} />
            <StatCard icon={Calculator} label="Одобрено"     value={stats.approved} color="var(--green)"        delay={60} />
            <StatCard icon={Calculator} label="На рассмотр." value={stats.sent}     color="var(--blue)"         delay={120} />
          </StatRow>
        )}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id ? 'true' : undefined}>
              {f.label}
            </button>
          ))}
        </div>
        {loading ? <SkeletonList count={5} /> : filtered.length === 0 ? (
          <EmptyState icon={Calculator} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет расчётов" description="Расчёты появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-24">
            {filtered.map((est, i) => {
              const st = STATUS_MAP[est.approval_status] || STATUS_MAP.draft;
              const price = Number(est.total_price || est.price || 0);
              const cost = Number(est.total_cost || est.cost || 0);
              const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
              const title = est.title || est.name || (est.tender_id && tenders[est.tender_id]) || `Расчёт #${est.id}`;
              return (
                <button
                  key={est.id}
                  onClick={() => { haptic.light(); navigate(`/estimate-report/${est.id}`); }}
                  className="w-full text-left card-glass px-4 py-3 spring-tap"
                  style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary flex-1">{title}</p>
                    <div className="flex items-center gap-2 shrink-0" style={{ marginTop: 2 }}>
                      {est.huginn_chat_id && (
                        <span
                          onClick={(ev) => { ev.stopPropagation(); haptic.light(); navigate(`/huginn-chat/${est.huginn_chat_id}`); }}
                          className="spring-tap"
                          style={{ color: 'var(--blue)', display: 'flex' }}
                        >
                          <MessageSquare size={15} />
                        </span>
                      )}
                      <ChevronRight size={16} className="c-tertiary" />
                    </div>
                  </div>
                  {est.object_name && <p className="text-[12px] mt-0.5 truncate c-secondary">{est.object_name}{est.object_city ? ` · ${est.object_city}` : ''}</p>}
                  {est.tender_id && tenders[est.tender_id] && !est.object_name && (
                    <p className="text-[12px] mt-0.5 truncate c-secondary">{tenders[est.tender_id]}</p>
                  )}
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

      {canCreate && (
        <button
          onClick={() => { haptic.medium(); setCreateOpen(true); }}
          className="spring-tap"
          style={{
            position: 'fixed',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)',
            right: '20px',
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: 'var(--gold)',
            color: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 20px color-mix(in srgb, var(--gold) 40%, transparent)',
            zIndex: 40,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <Plus size={22} strokeWidth={2.5} />
        </button>
      )}

      <CreateEstimateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </PageShell>
  );
}
