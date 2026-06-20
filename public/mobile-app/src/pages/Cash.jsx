import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Wallet, Plus, ChevronRight, Check, X as XIcon, Search } from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';

const STATUS_MAP = {
  requested:    { label: 'На согласовании', color: 'var(--blue)' },
  approved:     { label: 'Согласовано',     color: 'var(--green)' },
  money_issued: { label: 'Наличные выданы', color: 'var(--gold)' },
  received:     { label: 'Получено',        color: 'var(--green)' },
  reporting:    { label: 'На отчёте',       color: 'var(--gold)' },
  closed:       { label: 'Закрыто',         color: 'var(--green)' },
  rejected:     { label: 'Отклонено',       color: 'var(--red-soft)' },
  question:     { label: 'Вопрос',          color: 'var(--gold)' },
};

const FILTERS = [
  { id: 'all',      label: 'Все' },
  { id: 'pending',  label: 'Ожидание' },
  { id: 'approved', label: 'Одобрено' },
  { id: 'closed',   label: 'Закрыто' },
];

/* ── 12 категорий (Stage W) ────────────────────────────────────── */
const CASH_CATEGORIES = [
  { code: 'fuel_service',     icon: '⛽', label: 'ГСМ служ.' },
  { code: 'fuel_personal',    icon: '⛽', label: 'ГСМ личн.' },
  { code: 'taxi',             icon: '🚕', label: 'Такси' },
  { code: 'accommodation',    icon: '🏨', label: 'Проживание' },
  { code: 'food_brigade',     icon: '🍲', label: 'Продукты' },
  { code: 'materials',        icon: '🧱', label: 'Материалы' },
  { code: 'tool',             icon: '🔧', label: 'Инструмент' },
  { code: 'tech_rent',        icon: '🚛', label: 'Аренда тех.' },
  { code: 'communication',    icon: '📞', label: 'Связь' },
  { code: 'representational', icon: '🥂', label: 'Представ.' },
  { code: 'urgent_repair',    icon: '🚨', label: 'Срочный ремонт' },
  { code: 'other',            icon: '📦', label: 'Другое' },
];

const TYPES = [
  { code: 'advance', icon: '💰', label: 'Аванс' },
  { code: 'office',  icon: '🏢', label: 'Офис' },
  { code: 'other',   icon: '📦', label: 'Прочее' },
];
// ❌ 'loan' — убран из UI (Stage W)

export default function Cash() {
  const haptic   = useHaptic();
  const [balance,     setBalance]     = useState(null);
  const [requests,    setRequests]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState('all');
  const [detail,      setDetail]      = useState(null);
  const [showCreate,  setShowCreate]  = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [balRes, reqRes] = await Promise.all([
        api.get('/cash/my-balance').catch(() => null),
        api.get('/cash/my'),
      ]);
      setBalance(balRes);
      setRequests(api.extractRows(reqRes) || []);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let list = requests;
    if (filter === 'pending')  list = list.filter((r) => r.status === 'requested' || r.status === 'question');
    if (filter === 'approved') list = list.filter((r) => ['approved', 'money_issued', 'received'].includes(r.status));
    if (filter === 'closed')   list = list.filter((r) => ['closed', 'reporting'].includes(r.status));
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

  const totalOnHand = balance?.balance ?? balance?.on_hand ?? 0;
  const totalIssued = balance?.issued ?? balance?.total_issued ?? 0;
  const totalReturned = balance?.returned ?? 0;

  return (
    <PageShell
      title="Касса"
      headerRight={
        <button
          onClick={() => { haptic.light(); setShowCreate(true); }}
          className="flex items-center justify-center spring-tap"
          style={{ width: 44, height: 44, color: 'var(--blue)' }}
        >
          <Plus size={22} />
        </button>
      }
    >
      <PullToRefresh onRefresh={fetchData}>
        {balance && !loading && (
          <div
            className="rounded-2xl px-5 py-4 mb-3"
            style={{
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--gold) 14%, var(--bg-surface)), color-mix(in srgb, var(--green) 6%, var(--bg-surface)))',
              border: '0.5px solid color-mix(in srgb, var(--gold) 25%, var(--border-norse))',
              animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards',
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Баланс на руках
            </p>
            <p className="text-[28px] font-bold leading-tight" style={{ color: 'var(--gold)' }}>
              {formatMoney(totalOnHand)}
            </p>
            <div className="flex items-center gap-5 mt-2">
              <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                Выдано: {formatMoney(totalIssued, { short: true })}
              </span>
              <span className="text-[12px]" style={{ color: 'var(--green)' }}>
                Возврат: {formatMoney(totalReturned, { short: true })}
              </span>
            </div>
          </div>
        )}

        <div className="flex gap-1.5 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => { haptic.light(); setFilter(f.id); }}
              className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap"
              style={{
                background: filter === f.id ? 'var(--bg-elevated)' : 'transparent',
                color:      filter === f.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border:     filter === f.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <SkeletonList count={4} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Wallet}
            iconColor="var(--gold)"
            iconBg="color-mix(in srgb, var(--gold) 10%, transparent)"
            title="Нет заявок"
            description="Создайте первую заявку"
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((req, i) => {
              const st = STATUS_MAP[req.status] || { label: req.status, color: 'var(--text-tertiary)' };
              const isActionable = req.status === 'money_issued';
              const catIcon = (CASH_CATEGORIES.find((c) => c.code === req.category) || {}).icon;
              return (
                <button
                  key={req.id}
                  onClick={() => { haptic.light(); setDetail(req); }}
                  className="w-full text-left rounded-2xl px-4 py-3.5 spring-tap"
                  style={{
                    background:    'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                    backdropFilter:'blur(8px)',
                    border:        isActionable
                      ? '0.5px solid color-mix(in srgb, var(--gold) 30%, var(--border-norse))'
                      : '0.5px solid var(--border-norse)',
                    animation:     `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      {catIcon && <span style={{ fontSize: 18 }}>{catIcon}</span>}
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-semibold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
                          {req.purpose || req.description || `Заявка #${req.id}`}
                        </p>
                        {req.work_title && (
                          <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                            {req.work_title}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[15px] font-bold" style={{ color: 'var(--gold)' }}>
                        {formatMoney(req.amount || 0, { short: true })}
                      </span>
                      <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{
                        background: `color-mix(in srgb, ${st.color} 14%, transparent)`,
                        color: st.color,
                      }}
                    >
                      {st.label}
                    </span>
                    {req.use_se_payee && (
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: 'color-mix(in srgb, var(--green) 14%, transparent)', color: 'var(--green)' }}
                      >
                        💳 через СЗ
                      </span>
                    )}
                    {req.created_at && (
                      <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        {relativeTime(req.created_at)}
                      </span>
                    )}
                    {isActionable && (
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: 'color-mix(in srgb, var(--gold) 14%, transparent)', color: 'var(--gold)' }}
                      >
                        Подтвердите получение
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      <CashDetailSheet request={detail} onClose={() => setDetail(null)} onConfirm={confirmReceive} />
      <CreateCashSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchData} />
    </PageShell>
  );
}

function CashDetailSheet({ request, onClose, onConfirm }) {
  if (!request) return null;
  const r  = request;
  const st = STATUS_MAP[r.status] || { label: r.status, color: 'var(--text-tertiary)' };
  const cat = CASH_CATEGORIES.find((c) => c.code === r.category);

  const fields = [
    { label: 'Назначение',   value: r.purpose || r.description || '—' },
    { label: 'Сумма',        value: formatMoney(r.amount || 0) },
    cat && { label: 'Категория', value: `${cat.icon} ${cat.label}` },
    r.category === 'other' && r.category_other_desc && { label: 'Описание', value: r.category_other_desc, full: true },
    r.work_title && { label: 'Работа',       value: r.work_title },
    r.created_at && { label: 'Создано',      value: relativeTime(r.created_at) },
    r.comment    && { label: 'Комментарий',  value: r.comment, full: true },
    r.cover_letter && { label: 'Пояснительная', value: r.cover_letter, full: true },
  ].filter(Boolean);

  return (
    <BottomSheet open={!!request} onClose={onClose} title={r.purpose || `Заявка #${r.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
            Статус
          </p>
          <span
            className="px-3 py-1.5 rounded-full text-[13px] font-semibold inline-block"
            style={{ background: `color-mix(in srgb, ${st.color} 14%, transparent)`, color: st.color }}
          >
            {st.label}
          </span>
          {r.use_se_payee && (
            <span
              className="px-3 py-1.5 rounded-full text-[13px] font-semibold inline-block ml-2"
              style={{ background: 'color-mix(in srgb, var(--green) 14%, transparent)', color: 'var(--green)' }}
            >
              💳 через СЗ
            </span>
          )}
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
          {fields.map((f, i) => (
            <div
              key={i}
              className="px-4 py-3"
              style={{
                background:   'var(--bg-surface)',
                borderBottom: i < fields.length - 1 ? '0.5px solid var(--border-norse)' : 'none',
              }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                {f.label}
              </p>
              <p className={`text-[14px] ${f.full ? 'whitespace-pre-wrap' : ''}`} style={{ color: 'var(--text-primary)' }}>
                {f.value}
              </p>
            </div>
          ))}
        </div>

        {r.status === 'money_issued' && (
          <button
            onClick={() => onConfirm(r.id)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-[15px] spring-tap"
            style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)', color: 'var(--green)' }}
          >
            <Check size={18} />
            Подтвердить получение
          </button>
        )}
      </div>
    </BottomSheet>
  );
}

/* ══════════════════════════════════════════════════════════════
   CreateCashSheet — форма заявки.
   ВАЖНО (Stage W):
     • тип loan УБРАН (только advance/office/other)
     • CategoryGrid — 12 плиток (3 колонки × 4 ряда)
     • category='other' → textarea «category_other_desc» (обязательно)
     • Чекбокс «Через СЗ-перевод» → выбор сотрудника-СЗ
   ══════════════════════════════════════════════════════════════ */
function CreateCashSheet({ open, onClose, onCreated }) {
  const haptic   = useHaptic();
  const [type,         setType]         = useState('advance');
  const [purpose,      setPurpose]      = useState('');
  const [amount,       setAmount]       = useState('');
  const [comment,      setComment]      = useState('');
  const [coverLetter,  setCoverLetter]  = useState('');
  const [category,     setCategory]     = useState(null);
  const [otherDesc,    setOtherDesc]    = useState('');
  const [useSe,        setUseSe]        = useState(false);
  const [seQuery,      setSeQuery]      = useState('');
  const [seCandidates, setSeCandidates] = useState([]);
  const [sePayee,      setSePayee]      = useState(null);
  const [saving,       setSaving]       = useState(false);

  /* SE-employees autocomplete */
  useEffect(() => {
    if (!useSe) return;
    if (!seQuery.trim() || seQuery.trim().length < 2) { setSeCandidates([]); return; }
    let cancel = false;
    const t = setTimeout(async () => {
      try {
        const res  = await api.get(`/employees?se=1&q=${encodeURIComponent(seQuery)}`);
        const rows = api.extractRows(res);
        if (!cancel) setSeCandidates(rows.slice(0, 8));
      } catch {
        if (!cancel) setSeCandidates([]);
      }
    }, 250);
    return () => { cancel = true; clearTimeout(t); };
  }, [seQuery, useSe]);

  const reset = () => {
    setType('advance'); setPurpose(''); setAmount(''); setComment('');
    setCoverLetter(''); setCategory(null); setOtherDesc('');
    setUseSe(false); setSeQuery(''); setSeCandidates([]); setSePayee(null);
  };

  const canSubmit = useMemo(() => {
    if (!purpose.trim() || !amount || Number(amount) <= 0) return false;
    if (!category) return false;
    if (category === 'other' && !otherDesc.trim()) return false;
    if (useSe && !sePayee) return false;
    return true;
  }, [purpose, amount, category, otherDesc, useSe, sePayee]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    haptic.light();
    setSaving(true);
    try {
      const payload = {
        type,
        purpose: purpose.trim(),
        amount:  Number(amount),
        comment: comment || null,
        cover_letter: coverLetter.trim() || null,
        category,
        category_other_desc: category === 'other' ? otherDesc.trim() : null,
        use_se_payee: useSe,
        se_payee_employee_id: useSe ? sePayee?.id : null,
      };
      await api.post('/cash', payload);
      haptic.success();
      // Сигнал «появилась новая заявка» — DirectorApprovalsWidget/Page подхватят.
      window.dispatchEvent(new CustomEvent('asgard:cash:changed'));
      reset();
      onClose(); onCreated();
    } catch (e) {
      haptic.error();
      window.alert('Ошибка: ' + (e.message || 'не удалось создать'));
    }
    setSaving(false);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Новая заявка">
      <div className="flex flex-col gap-3 pb-4">
        {/* ── Тип ──────────────────────────────────────────── */}
        <div>
          <label className="input-label">Тип заявки</label>
          <div className="flex gap-1.5 mt-1">
            {TYPES.map((t) => (
              <button
                key={t.code}
                onClick={() => { haptic.light(); setType(t.code); }}
                className="flex-1 spring-tap"
                style={{
                  padding: '8px 4px',
                  borderRadius: 12,
                  background: type === t.code ? 'color-mix(in srgb, var(--blue) 15%, transparent)' : 'var(--bg-surface)',
                  color: type === t.code ? 'var(--blue)' : 'var(--text-secondary)',
                  border: type === t.code
                    ? '0.5px solid color-mix(in srgb, var(--blue) 30%, var(--border-norse))'
                    : '0.5px solid var(--border-norse)',
                  fontWeight: 600,
                  fontSize: 12,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                }}
              >
                <span style={{ fontSize: 18 }}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Категория (12 плиток) ────────────────────────── */}
        <div>
          <label className="input-label">Категория *</label>
          <div
            className="grid mt-1"
            style={{
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 6,
            }}
          >
            {CASH_CATEGORIES.map((c) => {
              const active = category === c.code;
              return (
                <button
                  key={c.code}
                  onClick={() => { haptic.light(); setCategory(c.code); }}
                  className="spring-tap"
                  style={{
                    minHeight: 72,
                    borderRadius: 12,
                    background: active
                      ? 'color-mix(in srgb, var(--gold) 18%, transparent)'
                      : 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                    border: active
                      ? '0.5px solid color-mix(in srgb, var(--gold) 40%, var(--border-norse))'
                      : '0.5px solid var(--border-norse)',
                    color: active ? 'var(--gold)' : 'var(--text-secondary)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 4, padding: 6,
                    fontWeight: active ? 700 : 600,
                    fontSize: 11,
                    lineHeight: 1.1,
                    textAlign: 'center',
                  }}
                >
                  <span style={{ fontSize: 22 }}>{c.icon}</span>
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── «Другое» — описание ──────────────────────────── */}
        {category === 'other' && (
          <div>
            <label className="input-label">Опишите расход *</label>
            <textarea
              value={otherDesc}
              onChange={(e) => setOtherDesc(e.target.value)}
              placeholder="На что именно нужны деньги..."
              rows={2}
              className="input-field resize-none"
            />
          </div>
        )}

        {/* ── Назначение ───────────────────────────────────── */}
        <div>
          <label className="input-label">Назначение *</label>
          <input
            type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)}
            placeholder="Краткое описание заявки"
            className="input-field"
          />
        </div>

        {/* ── Сумма ────────────────────────────────────────── */}
        <div>
          <label className="input-label">Сумма (₽) *</label>
          <input
            type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="50 000"
            className="input-field"
          />
        </div>

        {/* ── Через СЗ-перевод ─────────────────────────────── */}
        <div>
          <label
            className="flex items-center gap-2 spring-tap"
            style={{
              padding: '12px 14px',
              borderRadius: 12,
              background: useSe ? 'color-mix(in srgb, var(--green) 8%, var(--bg-surface))' : 'var(--bg-surface)',
              border: useSe
                ? '0.5px solid color-mix(in srgb, var(--green) 25%, var(--border-norse))'
                : '0.5px solid var(--border-norse)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={useSe}
              onChange={(e) => { haptic.light(); setUseSe(e.target.checked); if (!e.target.checked) setSePayee(null); }}
              style={{ width: 18, height: 18, accentColor: 'var(--green)' }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                💳 Выдать через СЗ-перевод
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                Не из кассы — на лимит самозанятого
              </div>
            </div>
          </label>
        </div>

        {/* ── SE-payee autocomplete ────────────────────────── */}
        {useSe && (
          <div>
            <label className="input-label">Кому СЗ-перевод *</label>
            {sePayee ? (
              <div
                className="flex items-center justify-between gap-2"
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'color-mix(in srgb, var(--green) 8%, var(--bg-surface))',
                  border: '0.5px solid color-mix(in srgb, var(--green) 25%, var(--border-norse))',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {sePayee.fio || sePayee.full_name || sePayee.name || `#${sePayee.id}`}
                  </p>
                  {(sePayee.position || sePayee.role) && (
                    <p style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {sePayee.position || sePayee.role}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => { setSePayee(null); setSeQuery(''); }}
                  className="spring-tap p-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <XIcon size={16} />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={14} style={{ position: 'absolute', left: 10, top: 14, color: 'var(--text-tertiary)' }} />
                  <input
                    type="text" value={seQuery} onChange={(e) => setSeQuery(e.target.value)}
                    placeholder="ФИО самозанятого..."
                    className="input-field"
                    style={{ paddingLeft: 32 }}
                  />
                </div>
                {seCandidates.length > 0 && (
                  <div
                    className="mt-1 rounded-xl overflow-hidden"
                    style={{ border: '0.5px solid var(--border-norse)' }}
                  >
                    {seCandidates.map((emp) => (
                      <button
                        key={emp.id}
                        onClick={() => { haptic.light(); setSePayee(emp); setSeCandidates([]); setSeQuery(''); }}
                        className="w-full text-left spring-tap"
                        style={{
                          padding: '10px 14px',
                          background: 'var(--bg-surface)',
                          borderBottom: '0.5px solid var(--border-norse)',
                          color: 'var(--text-primary)',
                          fontSize: 13,
                        }}
                      >
                        {emp.fio || emp.full_name || emp.name || `#${emp.id}`}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Пояснительная записка ────────────────────────── */}
        <div>
          <label className="input-label">Пояснительная записка</label>
          <textarea
            value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)}
            placeholder="Для согласующего: контекст, обоснование суммы..."
            rows={2}
            className="input-field resize-none"
          />
        </div>

        {/* ── Комментарий ──────────────────────────────────── */}
        <div>
          <label className="input-label">Комментарий</label>
          <textarea
            value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Внутренние детали..."
            rows={2}
            className="input-field resize-none"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!canSubmit || saving}
          className="btn-primary spring-tap mt-1"
          style={{ opacity: (!canSubmit || saving) ? 0.5 : 1 }}
        >
          {saving ? 'Сохранение...' : 'Создать заявку'}
        </button>
      </div>
    </BottomSheet>
  );
}
