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
            <div className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)' }}><p className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>{stats.total}</p><p className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>Всего</p></div>
            <div className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)' }}><p className="text-[13px] font-bold" style={{ color: 'var(--blue)' }}>{stats.pending}</p><p className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>Ожидает</p></div>
            <div className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)' }}><p className="text-[13px] font-bold" style={{ color: 'var(--green)' }}>{stats.paid}</p><p className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>Оплачено</p></div>
            <div className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)' }}><p className="text-[13px] font-bold" style={{ color: 'var(--gold)' }}>{formatMoney(stats.sum, { short: true })}</p><p className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>Сумма</p></div>
          </div>
        )}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap" style={{ background: filter === f.id ? 'var(--bg-elevated)' : 'transparent', color: filter === f.id ? 'var(--text-primary)' : 'var(--text-tertiary)', border: filter === f.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent' }}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={Banknote} iconColor="var(--green)" iconBg="rgba(48,209,88,0.1)" title="Нет ведомостей" description="Ведомости ЗП появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((sheet, i) => {
              const st = STATUS_MAP[sheet.status] || STATUS_MAP.draft;
              return (
                <button key={sheet.id} onClick={() => { haptic.light(); setDetail(sheet); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', backdropFilter: 'blur(8px)', border: '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{sheet.title || sheet.name || `Ведомость #${sheet.id}`}</p>
                    <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {(sheet.period || sheet.month) && <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{sheet.period || sheet.month}</span>}
                    {Number(sheet.total_amount || sheet.amount || 0) > 0 && <span className="text-[10px] font-semibold" style={{ color: 'var(--gold)' }}>{formatMoney(sheet.total_amount || sheet.amount, { short: true })}</span>}
                    {(sheet.employee_count || sheet.items_count) && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{sheet.employee_count || sheet.items_count} чел.</span>}
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
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className="text-[14px]" style={{ color: 'var(--text-primary)' }}>{f.value}</p>}</div>)}
        {s.status === 'draft' && (
          <button onClick={() => onAction(s.id, 'submit')} className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] spring-tap mt-2" style={{ background: 'var(--gold-gradient)', color: '#fff' }}>
            <Send size={16} /> Отправить на согласование
          </button>
        )}
        {canApprove && (s.status === 'pending' || s.status === 'submitted') && (
          <button onClick={() => onAction(s.id, 'approve')} className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] spring-tap mt-2" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)', color: 'var(--green)' }}>
            <Check size={16} /> Согласовать
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
