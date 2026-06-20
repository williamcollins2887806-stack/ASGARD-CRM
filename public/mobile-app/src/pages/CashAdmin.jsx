import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Vault, ChevronRight, Check, X as XIcon, Banknote, MessageCircle, AlertTriangle } from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';

const STATUS_MAP = {
  requested:    { label: 'На согласовании', color: 'var(--blue)' },
  approved:     { label: 'Согласовано',     color: 'var(--green)' },
  money_issued: { label: 'Выдано',          color: 'var(--gold)' },
  received:     { label: 'Получено',        color: 'var(--blue)' },
  reporting:    { label: 'На отчёте',       color: 'var(--gold)' },
  closed:       { label: 'Закрыто',         color: 'var(--green)' },
  rejected:     { label: 'Отклонено',       color: 'var(--red-soft)' },
  question:     { label: 'Уточнение',       color: 'var(--gold)' },
};

const FILTERS = [
  { id: 'all',      label: 'Все' },
  { id: 'awaiting', label: 'Ожидает' },
  { id: 'approved', label: 'Одобрено' },
  { id: 'issued',   label: 'Выдано' },
  { id: 'closed',   label: 'Закрыто' },
];

const CASH_CATEGORIES_MAP = {
  fuel_service:     { icon: '⛽', label: 'ГСМ служ.' },
  fuel_personal:    { icon: '⛽', label: 'ГСМ личн.' },
  taxi:             { icon: '🚕', label: 'Такси' },
  accommodation:    { icon: '🏨', label: 'Проживание' },
  food_brigade:     { icon: '🍲', label: 'Продукты' },
  materials:        { icon: '🧱', label: 'Материалы' },
  tool:             { icon: '🔧', label: 'Инструмент' },
  tech_rent:        { icon: '🚛', label: 'Аренда тех.' },
  communication:    { icon: '📞', label: 'Связь' },
  representational: { icon: '🥂', label: 'Представ.' },
  urgent_repair:    { icon: '🚨', label: 'Срочный ремонт' },
  other:            { icon: '📦', label: 'Другое' },
};

export default function CashAdmin() {
  const haptic = useHaptic();
  const [balance,    setBalance]    = useState(null);
  const [requests,   setRequests]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState('all');
  const [detail,     setDetail]     = useState(null);
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

  // Push event subscription
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener('asgard:cash:changed', handler);
    return () => window.removeEventListener('asgard:cash:changed', handler);
  }, [fetchData]);

  const filtered = useMemo(() => {
    if (filter === 'all')      return requests;
    if (filter === 'awaiting') return requests.filter((r) => r.status === 'requested' || r.status === 'question');
    if (filter === 'approved') return requests.filter((r) => r.status === 'approved');
    if (filter === 'issued')   return requests.filter((r) => r.status === 'money_issued' || r.status === 'received');
    if (filter === 'closed')   return requests.filter((r) => r.status === 'closed' || r.status === 'reporting');
    return requests;
  }, [requests, filter]);

  const cashBalance = Number(balance?.total_balance ?? balance?.balance ?? 0);

  const handleApprove = async (id) => {
    haptic.light();
    try {
      await api.put(`/cash/${id}/approve`);
      window.dispatchEvent(new CustomEvent('asgard:cash:changed'));
      fetchData(); setDetail(null); haptic.success();
    } catch {}
  };
  const handleReject = async (id) => {
    haptic.light();
    const comment = window.prompt('Причина отказа?');
    if (comment === null) return;
    try {
      await api.put(`/cash/${id}/reject`, { comment });
      window.dispatchEvent(new CustomEvent('asgard:cash:changed'));
      fetchData(); setDetail(null); haptic.success();
    } catch {}
  };
  const handleQuestion = async (id) => {
    haptic.light();
    const message = window.prompt('Что уточнить у автора?');
    if (message === null) return;
    try {
      await api.put(`/cash/${id}/question`, { message, comment: message });
      window.dispatchEvent(new CustomEvent('asgard:cash:changed'));
      fetchData(); setDetail(null); haptic.success();
    } catch {}
  };

  return (
    <PageShell title="Касса (упр.)">
      <PullToRefresh onRefresh={fetchData}>
        {balance && !loading && (
          <div className="card-hero mb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <p className="input-label">Баланс кассы</p>
            <p className="text-[24px] font-bold c-primary">{formatMoney(cashBalance)}</p>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[12px] c-blue">Выдано: {formatMoney(balance.total_issued || 0, { short: true })}</span>
              <span className="text-[12px] c-gold">Расход: {formatMoney(balance.total_spent || 0, { short: true })}</span>
              <span className="text-[12px] c-green">Возврат: {formatMoney(balance.total_returned || 0, { short: true })}</span>
            </div>
          </div>
        )}

        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => { haptic.light(); setFilter(f.id); }}
              className="filter-pill spring-tap"
              data-active={filter === f.id ? 'true' : undefined}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={Vault} iconColor="var(--gold)" iconBg="color-mix(in srgb, var(--gold) 10%, transparent)" title="Нет заявок" description="Кассовые заявки появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((req, i) => {
              const st = STATUS_MAP[req.status] || { label: req.status, color: 'var(--text-tertiary)' };
              const cat = CASH_CATEGORIES_MAP[req.category];
              return (
                <button
                  key={req.id}
                  onClick={() => { haptic.light(); setDetail(req); }}
                  className="w-full text-left card-glass px-4 py-3 spring-tap"
                  style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {cat && <span style={{ fontSize: 16 }}>{cat.icon}</span>}
                      <p className="text-[14px] font-semibold leading-tight c-primary truncate">
                        {req.purpose || req.description || `Заявка #${req.id}`}
                      </p>
                    </div>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="status-badge" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    <span className="text-[12px] font-semibold c-gold">{formatMoney(req.amount || 0)}</span>
                    {req.use_se_payee && (
                      <span className="status-badge" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)', color: 'var(--green)' }}>
                        💳 СЗ
                      </span>
                    )}
                    {req.user_name && <span className="text-[10px] c-tertiary">{req.user_name}</span>}
                    {req.created_at && <span className="text-[10px] c-tertiary">{relativeTime(req.created_at)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      <CashAdminDetailSheet
        request={detail}
        cashBalance={cashBalance}
        onClose={() => setDetail(null)}
        onApprove={handleApprove}
        onReject={handleReject}
        onQuestion={handleQuestion}
        onIssue={(r) => { setDetail(null); setIssueModal(r); }}
      />
      <IssueCashSheet
        request={issueModal}
        cashBalance={cashBalance}
        onClose={() => setIssueModal(null)}
        onIssued={() => {
          fetchData();
          window.dispatchEvent(new CustomEvent('asgard:cash:changed'));
        }}
      />
    </PageShell>
  );
}

function CashAdminDetailSheet({ request, cashBalance, onClose, onApprove, onReject, onQuestion, onIssue }) {
  if (!request) return null;
  const r   = request;
  const st  = STATUS_MAP[r.status] || { label: r.status, color: 'var(--text-tertiary)' };
  const cat = CASH_CATEGORIES_MAP[r.category];
  const amount = Number(r.amount || 0);
  const cashAfter    = cashBalance - amount;
  const willBeNegative = cashAfter < 0;
  const useSe = !!r.use_se_payee;

  const fields = [
    { label: 'Статус',     value: st.label, color: st.color },
    { label: 'Назначение', value: r.purpose || r.description || '—' },
    cat && { label: 'Категория', value: `${cat.icon} ${cat.label}` },
    r.category === 'other' && r.category_other_desc && { label: 'Описание', value: r.category_other_desc, full: true },
    { label: 'Сумма',      value: formatMoney(amount) },
    r.user_name && { label: 'Сотрудник', value: r.user_name },
    r.work_title && { label: 'Проект',   value: r.work_title },
    r.created_at && { label: 'Создано',  value: relativeTime(r.created_at) },
    r.cover_letter && { label: 'Пояснительная записка', value: r.cover_letter, full: true },
    r.comment && { label: 'Комментарий', value: r.comment, full: true },
  ].filter(Boolean);

  return (
    <BottomSheet open={!!request} onClose={onClose} title={r.purpose || `Заявка #${r.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => (
          <div key={i}>
            <p className="input-label">{f.label}</p>
            {f.color ? (
              <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>
                {f.value}
              </span>
            ) : (
              <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>
            )}
          </div>
        ))}

        {/* ── СЗ-перевод badge ─────────────────────────────── */}
        {useSe && (
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-2"
            style={{
              background: 'color-mix(in srgb, var(--green) 8%, var(--bg-surface))',
              border: '0.5px solid color-mix(in srgb, var(--green) 25%, var(--border-norse))',
            }}
          >
            <span style={{ fontSize: 18 }}>💳</span>
            <div>
              <p style={{ fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>
                Выдача через СЗ-перевод
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                Касса не уменьшается — деньги пойдут на лимит СЗ
              </p>
            </div>
          </div>
        )}

        {/* ── Balance preview (Stage W) ────────────────────── */}
        {(r.status === 'requested' || r.status === 'approved') && (
          <div
            className={`rounded-xl px-4 py-3 ${willBeNegative ? 'warn' : 'ok'}`}
            style={{
              background: willBeNegative
                ? 'color-mix(in srgb, var(--red-soft) 10%, var(--bg-surface))'
                : 'color-mix(in srgb, var(--green) 8%, var(--bg-surface))',
              border: willBeNegative
                ? '0.5px solid color-mix(in srgb, var(--red-soft) 30%, var(--border-norse))'
                : '0.5px solid color-mix(in srgb, var(--green) 20%, var(--border-norse))',
              animation: willBeNegative ? 'fadeInUp var(--motion-normal) var(--ease-spring)' : undefined,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>🏦 Касса сейчас</p>
                <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {formatMoney(cashBalance)}
                </p>
              </div>
              <span style={{ fontSize: 18, color: 'var(--text-tertiary)' }}>→</span>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>После выдачи</p>
                <p
                  style={{
                    fontSize: 15, fontWeight: 700,
                    color: useSe ? 'var(--text-primary)' : (willBeNegative ? 'var(--red)' : 'var(--green)'),
                  }}
                >
                  {useSe ? formatMoney(cashBalance) : formatMoney(cashAfter)}
                </p>
              </div>
            </div>
            {willBeNegative && !useSe && (
              <div className="error mt-2 flex items-center gap-1.5" style={{ color: 'var(--red)', fontSize: 12, fontWeight: 600 }}>
                <AlertTriangle size={13} /> Не хватит в кассе!
              </div>
            )}
            {useSe && (
              <div className="mt-2" style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                СЗ-перевод не уменьшает кассу
              </div>
            )}
          </div>
        )}

        {/* ── Действия ─────────────────────────────────────── */}
        {(r.status === 'requested' || r.status === 'question') && (
          <div className="flex flex-col gap-2 mt-2">
            <button
              onClick={() => onApprove(r.id)}
              className="btn-action spring-tap c-green"
              style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)', minHeight: 56, borderRadius: 14 }}
            >
              <Check size={18} /> Одобрить
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => onQuestion(r.id)}
                className="btn-action spring-tap c-blue"
                style={{ background: 'color-mix(in srgb, var(--blue) 12%, transparent)', flex: 1, minHeight: 56, borderRadius: 14 }}
              >
                <MessageCircle size={18} /> Уточнить
              </button>
              <button
                onClick={() => onReject(r.id)}
                className="btn-action spring-tap c-red"
                style={{ background: 'color-mix(in srgb, var(--red-soft) 15%, transparent)', flex: 1, minHeight: 56, borderRadius: 14 }}
              >
                <XIcon size={18} /> Отклонить
              </button>
            </div>
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

function IssueCashSheet({ request, cashBalance, onClose, onIssued }) {
  const haptic = useHaptic();
  const [amount,  setAmount]  = useState('');
  const [comment, setComment] = useState('');
  const [saving,  setSaving]  = useState(false);

  useEffect(() => { if (request) setAmount(String(request.amount || '')); }, [request]);

  const handleSubmit = async () => {
    if (!amount || !request) return;
    haptic.light(); setSaving(true);
    try {
      await api.put(`/cash/${request.id}/issue`, { amount: Number(amount), comment: comment || null });
      haptic.success(); setAmount(''); setComment(''); onClose(); onIssued();
    } catch {} setSaving(false);
  };

  const sumNum = Number(amount || 0);
  const cashAfter = cashBalance - sumNum;
  const useSe = !!request?.use_se_payee;

  return (
    <BottomSheet open={!!request} onClose={onClose} title="Выдача наличных">
      <div className="flex flex-col gap-3 pb-4">
        <div>
          <label className="input-label">Сумма (₽) *</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-field" />
        </div>

        {/* Balance preview прямо в форме */}
        {sumNum > 0 && (
          <div
            className="rounded-xl px-4 py-3"
            style={{
              background: cashAfter < 0 && !useSe
                ? 'color-mix(in srgb, var(--red-soft) 10%, var(--bg-surface))'
                : 'color-mix(in srgb, var(--green) 8%, var(--bg-surface))',
              border: cashAfter < 0 && !useSe
                ? '0.5px solid color-mix(in srgb, var(--red-soft) 28%, var(--border-norse))'
                : '0.5px solid color-mix(in srgb, var(--green) 22%, var(--border-norse))',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>Касса сейчас</span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{formatMoney(cashBalance)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>После выдачи</span>
              <span
                style={{
                  fontSize: 14, fontWeight: 700,
                  color: useSe ? 'var(--text-primary)' : (cashAfter < 0 ? 'var(--red)' : 'var(--green)'),
                }}
              >
                {useSe ? formatMoney(cashBalance) : formatMoney(cashAfter)}
              </span>
            </div>
          </div>
        )}

        <div>
          <label className="input-label">Комментарий</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Примечание..." rows={2} className="input-field resize-none" />
        </div>

        <button onClick={handleSubmit} disabled={!amount || saving} className="btn-primary spring-tap mt-1">
          {saving ? 'Выдаём...' : 'Выдать'}
        </button>
      </div>
    </BottomSheet>
  );
}
