import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Wallet, Plus, ChevronRight, Check } from 'lucide-react';
import { formatMoney, formatDate, relativeTime } from '@/lib/utils';

const STATUS_MAP = {
  requested: { label: 'На согласовании', color: 'var(--blue)' },
  approved: { label: 'Согласовано', color: 'var(--green)' },
  money_issued: { label: 'Наличные выданы', color: 'var(--blue)' },
  received: { label: 'Получено', color: 'var(--gold)' },
  reporting: { label: 'На отчёте', color: 'var(--gold)' },
  closed: { label: 'Закрыто', color: 'var(--green)' },
  rejected: { label: 'Отклонено', color: 'var(--red-soft)' },
  question: { label: 'Вопрос', color: 'var(--gold)' },
};

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'pending', label: 'На согласовании' },
  { id: 'approved', label: 'Одобрено' },
  { id: 'closed', label: 'Закрыто' },
];

export default function Cash() {
  const haptic = useHaptic();
  const [balance, setBalance] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [balRes, reqRes] = await Promise.all([
        api.get('/cash/my-balance').catch(() => null),
        api.get('/cash/my'),
      ]);
      setBalance(balRes);
      setRequests(api.extractRows(reqRes) || []);
    } catch { setRequests([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let list = requests;
    if (filter === 'pending') list = list.filter((r) => r.status === 'requested' || r.status === 'question');
    else if (filter === 'approved') list = list.filter((r) => ['approved', 'money_issued', 'received'].includes(r.status));
    else if (filter === 'closed') list = list.filter((r) => ['closed', 'reporting'].includes(r.status));
    return list;
  }, [requests, filter]);

  const confirmReceive = async (id) => {
    haptic.success();
    try {
      await api.put(`/cash/${id}/receive`);
      setRequests((p) => p.map((r) => r.id === id ? { ...r, status: 'received' } : r));
      setDetail(null);
    } catch {}
  };

  return (
    <PageShell title="Касса" headerRight={
      <button onClick={() => { haptic.light(); setShowCreate(true); }} className="flex items-center justify-center spring-tap" style={{ width: 44, height: 44, color: 'var(--blue)' }}><Plus size={22} /></button>
    }>
      <PullToRefresh onRefresh={fetchData}>
        {/* Balance hero */}
        {balance && !loading && (
          <div className="rounded-2xl p-4 mb-3" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', backdropFilter: 'blur(8px)', border: '0.5px solid var(--border-norse)', animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Баланс на руках</p>
            <p className="text-[24px] font-bold" style={{ color: 'var(--text-primary)' }}>{formatMoney(balance.balance || balance.on_hand || 0)}</p>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Получено: {formatMoney(balance.issued || balance.total_issued || 0, { short: true })}</span>
              <span className="text-[12px]" style={{ color: 'var(--green)' }}>Возвращено: {formatMoney(balance.returned || 0, { short: true })}</span>
            </div>
          </div>
        )}

        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap" style={{ background: filter === f.id ? 'var(--bg-elevated)' : 'transparent', color: filter === f.id ? 'var(--text-primary)' : 'var(--text-tertiary)', border: filter === f.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent' }}>{f.label}</button>
          ))}
        </div>

        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={Wallet} iconColor="var(--gold)" iconBg="color-mix(in srgb, var(--gold) 10%, transparent)" title="Нет заявок" description="Создайте первую заявку" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((req, i) => {
              const st = STATUS_MAP[req.status] || { label: req.status, color: 'var(--text-tertiary)' };
              return (
                <button key={req.id} onClick={() => { haptic.light(); setDetail(req); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', backdropFilter: 'blur(8px)', border: '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 50}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{req.purpose || req.description || `Заявка #${req.id}`}</p>
                    <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--gold)' }}>{formatMoney(req.amount || 0)}</span>
                    {req.created_at && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{relativeTime(req.created_at)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      {/* Detail sheet */}
      <CashDetailSheet request={detail} onClose={() => setDetail(null)} onConfirm={confirmReceive} />
      <CreateCashSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchData} />
    </PageShell>
  );
}

function CashDetailSheet({ request, onClose, onConfirm }) {
  if (!request) return null;
  const r = request;
  const st = STATUS_MAP[r.status] || { label: r.status, color: 'var(--text-tertiary)' };
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    { label: 'Назначение', value: r.purpose || r.description || '—' },
    { label: 'Сумма', value: formatMoney(r.amount || 0) },
    r.work_title && { label: 'Работа', value: r.work_title },
    r.created_at && { label: 'Создано', value: relativeTime(r.created_at) },
    r.comment && { label: 'Комментарий', value: r.comment, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!request} onClose={onClose} title={r.purpose || `Заявка #${r.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => (
          <div key={i}>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{f.label}</p>
            {f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] ${f.full ? 'whitespace-pre-wrap' : ''}`} style={{ color: 'var(--text-primary)' }}>{f.value}</p>}
          </div>
        ))}
        {r.status === 'money_issued' && (
          <button onClick={() => onConfirm(r.id)} className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] spring-tap mt-2" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)', color: 'var(--green)' }}>
            <Check size={16} /> Получил
          </button>
        )}
      </div>
    </BottomSheet>
  );
}

function CreateCashSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const is = { background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: '0.5px solid var(--border-norse)', caretColor: 'var(--gold)' };
  const handleSubmit = async () => {
    if (!purpose.trim() || !amount) return;
    haptic.light(); setSaving(true);
    try {
      await api.post('/cash', { purpose: purpose.trim(), amount: Number(amount), comment: comment || null });
      haptic.success(); setPurpose(''); setAmount(''); setComment(''); onClose(); onCreated();
    } catch {} setSaving(false);
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="Новая заявка">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Назначение *</label><input type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Командировка, закупка..." className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none" style={is} /></div>
        <div><label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Сумма (₽) *</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50000" className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none" style={is} /></div>
        <div><label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Комментарий</label><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Детали заявки..." rows={2} className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none resize-none" style={is} /></div>
        <button onClick={handleSubmit} disabled={!purpose.trim() || !amount || saving} className="w-full py-3 rounded-xl font-semibold text-[14px] spring-tap mt-1" style={{ background: (purpose.trim() && amount) ? 'var(--gold-gradient)' : 'var(--bg-elevated)', color: (purpose.trim() && amount) ? '#fff' : 'var(--text-tertiary)', opacity: saving ? 0.6 : 1 }}>{saving ? 'Сохранение...' : 'Создать заявку'}</button>
      </div>
    </BottomSheet>
  );
}
