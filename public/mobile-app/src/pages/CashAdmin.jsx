import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Vault, ChevronRight, Check, X as XIcon, Banknote } from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';

const STATUS_MAP = {
  requested: { label: 'На согласовании', color: 'var(--blue)' },
  approved: { label: 'Согласовано', color: 'var(--green)' },
  money_issued: { label: 'Выдано', color: 'var(--gold)' },
  received: { label: 'Получено', color: 'var(--blue)' },
  reporting: { label: 'На отчёте', color: 'var(--gold)' },
  closed: { label: 'Закрыто', color: 'var(--green)' },
  rejected: { label: 'Отклонено', color: 'var(--red-soft)' },
};
const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'awaiting', label: 'Ожидает' },
  { id: 'approved', label: 'Одобрено' }, { id: 'issued', label: 'Выдано' }, { id: 'closed', label: 'Закрыто' },
];

export default function CashAdmin() {
  const haptic = useHaptic();
  const [balance, setBalance] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [issueModal, setIssueModal] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [balRes, reqRes] = await Promise.all([
        api.get('/cash/balance').catch(() => null),
        api.get('/cash/all'),
      ]);
      setBalance(balRes);
      setRequests(api.extractRows(reqRes) || []);
    } catch { setRequests([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (filter === 'all') return requests;
    if (filter === 'awaiting') return requests.filter((r) => r.status === 'requested');
    if (filter === 'approved') return requests.filter((r) => r.status === 'approved');
    if (filter === 'issued') return requests.filter((r) => r.status === 'money_issued' || r.status === 'received');
    if (filter === 'closed') return requests.filter((r) => r.status === 'closed' || r.status === 'reporting');
    return requests;
  }, [requests, filter]);

  const handleApprove = async (id) => {
    haptic.light();
    try { await api.put(`/cash/${id}/approve`); fetchData(); setDetail(null); haptic.success(); } catch {}
  };
  const handleReject = async (id) => {
    haptic.light();
    try { await api.put(`/cash/${id}/reject`, { comment: 'Отклонено' }); fetchData(); setDetail(null); haptic.success(); } catch {}
  };

  return (
    <PageShell title="Касса (упр.)">
      <PullToRefresh onRefresh={fetchData}>
        {balance && !loading && (
          <div className="card-hero mb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <p className="input-label">Баланс кассы</p>
            <p className="text-[24px] font-bold c-primary">{formatMoney(balance.total_balance || 0)}</p>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[12px] c-blue">Выдано: {formatMoney(balance.total_issued || 0, { short: true })}</span>
              <span className="text-[12px] c-gold">Расход: {formatMoney(balance.total_spent || 0, { short: true })}</span>
              <span className="text-[12px] c-green">Возврат: {formatMoney(balance.total_returned || 0, { short: true })}</span>
            </div>
          </div>
        )}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id ? 'true' : undefined}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={Vault} iconColor="var(--gold)" iconBg="color-mix(in srgb, var(--gold) 10%, transparent)" title="Нет заявок" description="Кассовые заявки появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((req, i) => {
              const st = STATUS_MAP[req.status] || { label: req.status, color: 'var(--text-tertiary)' };
              return (
                <button key={req.id} onClick={() => { haptic.light(); setDetail(req); }} className="w-full text-left card-glass px-4 py-3 spring-tap" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{req.purpose || req.description || `Заявка #${req.id}`}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="status-badge" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    <span className="text-[12px] font-semibold c-gold">{formatMoney(req.amount || 0)}</span>
                    {req.user_name && <span className="text-[10px] c-tertiary">{req.user_name}</span>}
                    {req.created_at && <span className="text-[10px] c-tertiary">{relativeTime(req.created_at)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <CashAdminDetailSheet request={detail} onClose={() => setDetail(null)} onApprove={handleApprove} onReject={handleReject} onIssue={(r) => { setDetail(null); setIssueModal(r); }} />
      <IssueCashSheet request={issueModal} onClose={() => setIssueModal(null)} onIssued={fetchData} />
    </PageShell>
  );
}

function CashAdminDetailSheet({ request, onClose, onApprove, onReject, onIssue }) {
  if (!request) return null;
  const r = request;
  const st = STATUS_MAP[r.status] || { label: r.status, color: 'var(--text-tertiary)' };
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    { label: 'Назначение', value: r.purpose || r.description || '—' },
    { label: 'Сумма', value: formatMoney(r.amount || 0) },
    r.user_name && { label: 'Сотрудник', value: r.user_name },
    r.work_title && { label: 'Проект', value: r.work_title },
    r.created_at && { label: 'Создано', value: relativeTime(r.created_at) },
    r.comment && { label: 'Комментарий', value: r.comment, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!request} onClose={onClose} title={r.purpose || `Заявка #${r.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="input-label">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>}</div>)}
        {r.status === 'requested' && (
          <div className="flex gap-2 mt-2">
            <button onClick={() => onApprove(r.id)} className="btn-action spring-tap c-green" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)' }}><Check size={16} /> Одобрить</button>
            <button onClick={() => onReject(r.id)} className="btn-action spring-tap c-red" style={{ background: 'color-mix(in srgb, var(--red-soft) 15%, transparent)' }}><XIcon size={16} /> Отклонить</button>
          </div>
        )}
        {r.status === 'approved' && (
          <button onClick={() => onIssue(r)} className="btn-primary flex items-center justify-center gap-2 spring-tap mt-2">
            <Banknote size={16} /> Выдать наличные
          </button>
        )}
      </div>
    </BottomSheet>
  );
}

function IssueCashSheet({ request, onClose, onIssued }) {
  const haptic = useHaptic();
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (request) setAmount(String(request.amount || '')); }, [request]);

  const handleSubmit = async () => {
    if (!amount || !request) return;
    haptic.light(); setSaving(true);
    try {
      await api.put(`/cash/${request.id}/issue`, { amount: Number(amount), comment: comment || null });
      haptic.success(); setAmount(''); setComment(''); onClose(); onIssued();
    } catch {} setSaving(false);
  };
  return (
    <BottomSheet open={!!request} onClose={onClose} title="Выдача наличных">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="input-label">Сумма (₽) *</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-field" /></div>
        <div><label className="input-label">Комментарий</label><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Примечание..." rows={2} className="input-field resize-none" /></div>
        <button onClick={handleSubmit} disabled={!amount || saving} className="btn-primary spring-tap mt-1">{saving ? 'Выдаём...' : 'Выдать'}</button>
      </div>
    </BottomSheet>
  );
}
