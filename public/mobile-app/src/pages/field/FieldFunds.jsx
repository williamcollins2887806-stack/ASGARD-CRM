import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Landmark, CheckCircle, CornerDownLeft, Inbox, Receipt, Camera, Wallet,
  Package, Car, UtensilsCrossed, Fuel, Wrench, Gift, Hotel, ClipboardList, Paperclip, AlertTriangle, Landmark as Bank,
} from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { formatMoney as fmtMoney } from '@/lib/utils';
import { Card, IconTile, KeyButton, Chip, BottomSheet, SectionLabel, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

const STATUS_MAP = {
  issued: { label: 'Выдан', bg: 'color-mix(in oklab, var(--value) 15%, transparent)', color: 'var(--value-ink)' },
  confirmed: { label: 'Получено', bg: 'var(--soft-blue)', color: 'var(--on-soft-blue)' },
  reporting: { label: 'Отчёт', bg: 'color-mix(in oklab, var(--danger) 15%, transparent)', color: 'var(--danger-ink)' },
  closed: { label: 'Закрыто', bg: 'var(--bg-surface-alt)', color: 'var(--text-secondary)' },
};

// Категории расходов полевого модуля.
// value — канонический English ключ для backend (field-funds.js маппит → cash + subcategory).
// label — что показываем РП в пилюлях.
const EXPENSE_CATEGORIES = [
  { value: 'supplies',  label: 'Материалы', Icon: Package },
  { value: 'transport', label: 'Транспорт', Icon: Car },
  { value: 'food',      label: 'Питание', Icon: UtensilsCrossed },
  { value: 'gsm',       label: 'ГСМ', Icon: Fuel },
  { value: 'services',  label: 'Услуги', Icon: Wrench },
  { value: 'representational', label: 'Представительские', Icon: Gift },
  { value: 'accommodation',    label: 'Жильё', Icon: Hotel },
  { value: 'other',     label: 'Прочее', Icon: ClipboardList },
];

/* ══════════════════════════════════════════════════════════════════
   Fund Detail view
   ══════════════════════════════════════════════════════════════════ */
function FundDetail({ fundId, fund, onBack, onRefresh }) {
  const haptic = useHaptic();
  const [showExpense, setShowExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ amount: '', description: '', category: '', supplier: '', source: 'advance' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [receiptName, setReceiptName] = useState(null);
  const fileRef = useRef(null);

  if (!fund) return null;
  const remainder = (fund.amount || 0) - (fund.spent || 0) - (fund.returned || 0);

  // Макс. размер чека — совпадает с MAX_RECEIPT_SIZE на бэке (field-funds.js).
  const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;

  function onPickReceipt(e) {
    const f = e.target.files?.[0];
    if (!f) { setReceiptName(null); return; }
    if (f.size > MAX_RECEIPT_BYTES) {
      // Иначе большой файл уходил на сервер и висел/падал 413 без объяснения.
      setError('Фото чека больше 15 МБ — сожмите или переснимите');
      e.target.value = '';
      setReceiptName(null);
      return;
    }
    setError(null);
    setReceiptName(f.name);
  }

  async function submitExpense() {
    if (!expenseForm.amount || !expenseForm.description || submitting) return;
    haptic.medium();
    setError(null);
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('amount', expenseForm.amount);
      formData.append('description', expenseForm.description);
      formData.append('category', expenseForm.category);
      formData.append('supplier', expenseForm.supplier);
      formData.append('source', expenseForm.source);
      if (fileRef.current?.files?.[0]) {
        formData.append('receipt', fileRef.current.files[0]);
      }
      const token = localStorage.getItem('field_token');
      // Таймаут — на слабой связи в поле upload мог висеть вечно, кнопка «залипала» на «...».
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60000);
      let resp;
      try {
        resp = await fetch(`/api/field/funds/${fundId}/expense`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      // Без проверки resp.ok серверный отказ (413/400/500) выглядел как успех,
      // форма закрывалась, но расход НЕ сохранялся → «редко сохраняет».
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `Ошибка сервера (${resp.status})`);
      }
      haptic.success();
      setShowExpense(false);
      setExpenseForm({ amount: '', description: '', category: '', supplier: '', source: 'advance' });
      setReceiptName(null);
      if (fileRef.current) fileRef.current.value = '';
      onRefresh();
    } catch (e) {
      haptic.error?.();
      setError(e.name === 'AbortError' ? 'Превышено время загрузки — проверьте связь и повторите' : (e.message || 'Не удалось сохранить'));
    }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-4">
        <div className="fs-head">
          <button onClick={onBack} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Wallet} tone="value" size={40} />
          <h1 className="fs-head__title">Расходы</h1>
        </div>

        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: 'var(--danger-ink)' }}>{error}</Card>
        )}

        {/* Balance */}
        <Card variant="raised" tone="value" className="p-5 text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>Остаток: {fund.purpose}</p>
          <p className="text-3xl font-bold" style={{ color: 'var(--value-ink)' }}>{fmtMoney(remainder)}</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Выдано {fmtMoney(fund.amount)} · Потрачено {fmtMoney(fund.spent)}</p>
        </Card>

        {/* Summary */}
        <Card variant="raised" className="p-4">
          <SectionLabel>Сводка</SectionLabel>
          {[
            { label: 'Выдано', value: fmtMoney(fund.amount) },
            { label: 'Потрачено (аванс)', value: `−${fmtMoney(fund.spent)}`, color: 'var(--danger-ink)' },
            { label: 'Возвращено', value: `−${fmtMoney(fund.returned)}`, color: 'var(--ok)' },
            ...(parseFloat(fund.own_spent) > 0 ? [{ label: 'Свои средства', value: fmtMoney(fund.own_spent), color: 'var(--value-ink)' }] : []),
            { label: 'Остаток', value: fmtMoney(remainder), color: 'var(--value-ink)', bold: true },
          ].map((r, i) => (
            <div key={i} className="fs-row" style={r.bold ? { borderTop: '1px solid var(--tile-brd)', marginTop: 4, paddingTop: 8 } : {}}>
              <span className="fs-row__k" style={{ fontWeight: r.bold ? 700 : 400 }}>{r.label}</span>
              <span className="fs-row__v" style={{ color: r.color || 'var(--text-primary)' }}>{r.value}</span>
            </div>
          ))}
        </Card>

        {/* Action buttons */}
        {fund.status !== 'closed' && (
          <div className="grid grid-cols-2 gap-3">
            <KeyButton tone="value" icon={Receipt} onClick={() => setShowExpense(true)}>Добавить расход</KeyButton>
            {remainder > 0 && (
              <KeyButton tone="neutral" icon={CornerDownLeft} onClick={onBack}>Вернуть остаток</KeyButton>
            )}
          </div>
        )}

        {/* Expense form */}
        {showExpense && (
          <Card variant="raised" className="p-4 space-y-3" style={{ borderColor: 'var(--value)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Новый расход</p>

            <input type="number" placeholder="Сумма" value={expenseForm.amount}
              onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
              className="w-full p-3 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />

            <input type="text" placeholder="Описание расхода" value={expenseForm.description}
              onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
              className="w-full p-3 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />

            {/* Category pills (English value → backend; label → UI) */}
            <div>
              <p className="text-xs mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Категория</p>
              <div className="flex flex-wrap gap-1.5">
                {EXPENSE_CATEGORIES.map((cat) => (
                  <button key={cat.value} onClick={() => setExpenseForm({ ...expenseForm, category: cat.value })}
                    className="px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5"
                    style={{
                      backgroundColor: expenseForm.category === cat.value ? 'var(--value)' : 'var(--bg-surface-alt)',
                      color: expenseForm.category === cat.value ? 'var(--value-ink)' : 'var(--text-secondary)',
                      border: '1px solid var(--tile-brd)',
                    }}>
                    <cat.Icon size={11} strokeWidth={2.4} aria-hidden />
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <input type="text" placeholder="Поставщик / магазин" value={expenseForm.supplier}
              onChange={(e) => setExpenseForm({ ...expenseForm, supplier: e.target.value })}
              className="w-full p-3 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />

            {/* Source: advance or own */}
            <div>
              <p className="text-xs mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Откуда деньги</p>
              <div className="flex gap-2">
                {[{ val: 'advance', label: 'Из аванса' }, { val: 'own', label: 'Свои' }].map((s) => (
                  <Chip key={s.val} tone="value" active={expenseForm.source === s.val} onClick={() => setExpenseForm({ ...expenseForm, source: s.val })}>
                    {s.label}
                  </Chip>
                ))}
              </div>
            </div>

            {/* Receipt photo */}
            <div>
              <p className="text-xs mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Фото чека</p>
              <label className="flex items-center gap-2 p-3 rounded-lg cursor-pointer"
                style={{ backgroundColor: 'var(--bg-surface-alt)', border: `1px dashed ${receiptName ? 'var(--value)' : 'var(--tile-brd)'}` }}>
                <Camera size={16} style={{ color: 'var(--value-ink)' }} />
                <span className="text-xs truncate flex items-center gap-1.5" style={{ color: receiptName ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                  {receiptName ? <><Paperclip size={11} strokeWidth={2.4} aria-hidden />{receiptName}</> : 'Прикрепить фото'}
                </span>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickReceipt} />
              </label>
            </div>

            <div className="flex gap-2">
              <KeyButton tone="neutral" style={{ flex: 1 }} onClick={() => setShowExpense(false)}>Отмена</KeyButton>
              <KeyButton tone="value" style={{ flex: 1 }} onClick={submitExpense} disabled={submitting || !expenseForm.amount || !expenseForm.description}>
                {submitting ? '…' : 'Сохранить'}
              </KeyButton>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Main Funds page
   ══════════════════════════════════════════════════════════════════ */
export default function FieldFunds() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [searchParams, setSearchParams] = useSearchParams();
  const detailId = searchParams.get('detail');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [returnModal, setReturnModal] = useState(null);
  const [returnAmount, setReturnAmount] = useState('');
  const [returnNote, setReturnNote] = useState('');

  const fetchData = async () => {
    try {
      const res = await fieldApi.get('/funds/my/balance');
      setData(res);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  // Detail view
  if (detailId && data?.funds) {
    const fund = data.funds.find(f => String(f.id) === detailId);
    return <FundDetail fundId={detailId} fund={fund} onBack={() => setSearchParams({})} onRefresh={fetchData} />;
  }

  const handleConfirm = async (fundId) => {
    haptic.medium();
    setSubmitting(true);
    try {
      await fieldApi.put(`/funds/${fundId}/confirm`);
      await fetchData();
      haptic.success();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  const openReturn = (fund) => {
    const remainder = (fund.amount || 0) - (fund.spent || 0) - (fund.returned || 0);
    setReturnModal(fund);
    setReturnAmount(String(remainder));
    setReturnNote('');
  };

  const handleReturn = async () => {
    if (!returnModal) return;
    const remainder = (returnModal.amount || 0) - (returnModal.spent || 0) - (returnModal.returned || 0);
    const amt = Number(returnAmount);
    if (!amt || amt <= 0 || amt > remainder) { setError(`Сумма от 1 до ${fmtMoney(remainder)}`); return; }
    haptic.medium();
    setSubmitting(true);
    try {
      await fieldApi.post(`/funds/${returnModal.id}/return`, { amount: amt, ...(returnNote.trim() && { note: returnNote.trim() }) });
      setReturnModal(null);
      await fetchData();
      haptic.success();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  const totalBalance = data?.funds?.reduce((s, f) => s + ((f.amount || 0) - (f.spent || 0) - (f.returned || 0)), 0) || 0;
  const totalOwnSpent = data?.funds?.reduce((s, f) => s + parseFloat(f.own_spent || 0), 0) || 0;

  if (loading) return (
    <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
      <SkeletonList count={3} />
    </div>
  );

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-4">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate(-1)} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Landmark} tone="value" size={40} />
          <h1 className="fs-head__title">Подотчёт</h1>
        </div>

        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: 'var(--danger-ink)' }}>{error}</Card>
        )}

        {/* Balance hero */}
        <Card variant="raised" tone="value" className="p-5 text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>Остаток на руках</p>
          <p className="text-3xl font-bold" style={{ color: 'var(--value-ink)' }}>{fmtMoney(totalBalance)}</p>
          <div className="grid grid-cols-3 gap-2 mt-4 pt-3 w-full" style={{ borderTop: '1px solid var(--tile-brd)' }}>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Выдано</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtMoney(data?.total_issued || data?.totals?.issued)}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Потрачено</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--danger-ink)' }}>{fmtMoney(data?.total_spent || data?.totals?.spent)}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Возвращено</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--ok)' }}>{fmtMoney(data?.total_returned || data?.totals?.returned)}</p>
            </div>
          </div>
          {totalOwnSpent > 0 && (
            <p className="text-xs mt-3 flex items-center gap-1.5" style={{ color: 'var(--value-ink)' }}>
              <AlertTriangle size={11} strokeWidth={2.6} aria-hidden />
              Потрачено своих: {fmtMoney(totalOwnSpent)}
            </p>
          )}
        </Card>

        {/* Fund cards */}
        {(!data?.funds || data.funds.length === 0) ? (
          <EmptyState icon={Inbox} title="Нет выданных средств" description="Выданные подотчётные суммы появятся здесь" />
        ) : data.funds.map((fund) => {
          const remainder = (fund.amount || 0) - (fund.spent || 0) - (fund.returned || 0);
          const st = STATUS_MAP[fund.status] || STATUS_MAP.closed;
          return (
            <Card key={fund.id} variant="raised" className="p-4 space-y-3"
              onClick={() => { haptic.light(); setSearchParams({ detail: fund.id }); }}
              style={{ cursor: 'pointer' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{fund.purpose || 'Без назначения'}</p>
                  {fund.work_title && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{fund.work_title}</p>
                  )}
                  <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>Выдано: {fmtMoney(fund.amount)}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap" style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</span>
              </div>
              {remainder > 0 && <p className="text-sm" style={{ color: 'var(--value-ink)' }}>Остаток: {fmtMoney(remainder)}</p>}
              {parseFloat(fund.own_spent) > 0 && (
                <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--value-ink)' }}>
                  <AlertTriangle size={11} strokeWidth={2.6} aria-hidden />
                  Свои: {fmtMoney(fund.own_spent)}
                </p>
              )}
              <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                {fund.status === 'issued' && (
                  <KeyButton tone="accent" size="sm" icon={CheckCircle} style={{ flex: 1 }} onClick={() => handleConfirm(fund.id)} disabled={submitting}>
                    Получил
                  </KeyButton>
                )}
                {(fund.status === 'confirmed' || fund.status === 'reporting') && remainder > 0 && (
                  <KeyButton tone="value" size="sm" icon={CornerDownLeft} style={{ flex: 1 }} onClick={() => openReturn(fund)} disabled={submitting}>
                    Вернуть
                  </KeyButton>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Return sheet */}
      <BottomSheet open={!!returnModal} onClose={() => setReturnModal(null)} title="Возврат средств">
        <div className="space-y-4 pb-2">
          <input type="number" value={returnAmount} onChange={(e) => setReturnAmount(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
          <textarea value={returnNote} onChange={(e) => setReturnNote(e.target.value)} rows={2} placeholder="Комментарий"
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
            style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
          <KeyButton tone="value" block onClick={handleReturn} disabled={submitting}>Вернуть</KeyButton>
        </div>
      </BottomSheet>
    </div>
  );
}
