import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Banknote, ChevronRight, Check, Send } from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';

const STATUS_MAP = {
  draft: { label: 'Черновик', color: 'var(--text-tertiary)' },
  pending: { label: 'На согласовании', color: 'var(--blue)' },
  submitted: { label: 'На согласовании', color: 'var(--blue)' },
  approved: { label: 'Согласовано', color: 'var(--green)' },
  paid: { label: 'Оплачено', color: 'var(--green)' },
  rework: { label: 'На доработке', color: 'var(--gold)' },
  rejected: { label: 'Отклонено', color: 'var(--red-soft)' },
};
const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'draft', label: 'Черновики' },
  { id: 'pending', label: 'На согласовании' }, { id: 'approved', label: 'Согласовано' }, { id: 'paid', label: 'Оплачено' },
];
const APPROVE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'HEAD_PM'];

export default function Payroll() {
  const user = useAuthStore((s) => s.user);
  const haptic = useHaptic();
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const canApprove = user && APPROVE_ROLES.includes(user.role);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get('/payroll/sheets'); setSheets(api.extractRows(res) || []); }
    catch { setSheets([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (filter === 'all') return sheets;
    if (filter === 'pending') return sheets.filter((s) => s.status === 'pending' || s.status === 'submitted');
    return sheets.filter((s) => s.status === filter);
  }, [sheets, filter]);

  const stats = useMemo(() => ({
    total: sheets.length,
    pending: sheets.filter((s) => s.status === 'pending' || s.status === 'submitted').length,
    paid: sheets.filter((s) => s.status === 'paid').length,
    sum: sheets.reduce((s, sh) => s + (Number(sh.total_amount || sh.amount || 0)), 0),
  }), [sheets]);

  const handleAction = async (id, action) => {
    haptic.light();
    try {
      await api.put(`/payroll/sheets/${id}/${action}`);
      fetchData();
      setDetail(null);
      haptic.success();
    } catch {}
  };

  return (
    <PageShell title="Ведомости ЗП">
      <PullToRefresh onRefresh={fetchData}>
        {!loading && sheets.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5 px-1 pb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <div className="card-glass flex flex-col items-center gap-0.5 py-2.5"><p className="text-[13px] font-bold c-primary">{stats.total}</p><p className="text-[9px] c-tertiary">Всего</p></div>
            <div className="card-glass flex flex-col items-center gap-0.5 py-2.5"><p className="text-[13px] font-bold c-blue">{stats.pending}</p><p className="text-[9px] c-tertiary">Ожидает</p></div>
            <div className="card-glass flex flex-col items-center gap-0.5 py-2.5"><p className="text-[13px] font-bold c-green">{stats.paid}</p><p className="text-[9px] c-tertiary">Оплачено</p></div>
            <div className="card-glass flex flex-col items-center gap-0.5 py-2.5"><p className="text-[13px] font-bold c-gold">{formatMoney(stats.sum, { short: true })}</p><p className="text-[9px] c-tertiary">Сумма</p></div>
          </div>
        )}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id ? 'true' : undefined}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={Banknote} iconColor="var(--green)" iconBg="rgba(48,209,88,0.1)" title="Нет ведомостей" description="Ведомости ЗП появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((sheet, i) => {
              const st = STATUS_MAP[sheet.status] || STATUS_MAP.draft;
              return (
                <button key={sheet.id} onClick={() => { haptic.light(); setDetail(sheet); }} className="w-full text-left card-glass px-4 py-3 spring-tap" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{sheet.title || sheet.name || `Ведомость #${sheet.id}`}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="status-badge" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {(sheet.period || sheet.month) && <span className="text-[10px] c-secondary">{sheet.period || sheet.month}</span>}
                    {Number(sheet.total_amount || sheet.amount || 0) > 0 && <span className="text-[10px] font-semibold c-gold">{formatMoney(sheet.total_amount || sheet.amount, { short: true })}</span>}
                    {(sheet.employee_count || sheet.items_count) && <span className="text-[10px] c-tertiary">{sheet.employee_count || sheet.items_count} чел.</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <PayrollDetailSheet sheet={detail} onClose={() => setDetail(null)} canApprove={canApprove} onAction={handleAction} />
    </PageShell>
  );
}

function PayrollDetailSheet({ sheet, onClose, canApprove, onAction }) {
  if (!sheet) return null;
  const s = sheet;
  const st = STATUS_MAP[s.status] || STATUS_MAP.draft;
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    (s.period || s.month) && { label: 'Период', value: s.period || s.month },
    Number(s.total_amount || s.amount || 0) > 0 && { label: 'Сумма', value: formatMoney(s.total_amount || s.amount) },
    (s.employee_count || s.items_count) && { label: 'Сотрудников', value: s.employee_count || s.items_count },
    s.created_by_name && { label: 'Создал', value: s.created_by_name },
    s.created_at && { label: 'Создано', value: relativeTime(s.created_at) },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!sheet} onClose={onClose} title={s.title || s.name || `Ведомость #${s.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="input-label">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className="text-[14px] c-primary">{f.value}</p>}</div>)}
        {s.status === 'draft' && (
          <button onClick={() => onAction(s.id, 'submit')} className="btn-primary flex items-center justify-center gap-2 spring-tap mt-2">
            <Send size={16} /> Отправить на согласование
          </button>
        )}
        {canApprove && (s.status === 'pending' || s.status === 'submitted') && (
          <button onClick={() => onAction(s.id, 'approve')} className="btn-action spring-tap mt-2 c-green" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)' }}>
            <Check size={16} /> Согласовать
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
