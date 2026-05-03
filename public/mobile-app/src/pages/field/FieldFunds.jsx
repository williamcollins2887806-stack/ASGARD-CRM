import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Landmark, CheckCircle, CornerDownLeft, Inbox, Plus, Receipt, Camera } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';

function fmtMoney(n) { return (n || 0).toLocaleString('ru-RU') + ' ₽'; }

const STATUS_MAP = {
  issued: { label: 'Выдан', bg: 'rgba(234,179,8,0.15)', color: '#eab308' },
  confirmed: { label: 'Получено', bg: 'rgba(59,130,246,0.15)', color: '#3b82f6' },
  reporting: { label: 'Отчёт', bg: 'rgba(249,115,22,0.15)', color: '#f97316' },
  closed: { label: 'Закрыто', bg: 'rgba(107,114,128,0.15)', color: '#6b7280' },
};

const EXPENSE_CATEGORIES = ['Материалы', 'Инструмент', 'Транспорт', 'Питание', 'Расходники', 'Прочее'];

/* ══════════════════════════════════════════════════════════════════
   Fund Detail view
   ══════════════════════════════════════════════════════════════════ */
function FundDetail({ fundId, fund, onBack, onRefresh }) {
  const haptic = useHaptic();
  const [showExpense, setShowExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ amount: '', description: '', category: '', supplier: '', source: 'advance' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  if (!fund) return null;
  const remainder = (fund.amount || 0) - (fund.spent || 0) - (fund.returned || 0);

  async function submitExpense() {
    if (!expenseForm.amount || !expenseForm.description) return;
    haptic.medium();
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
      await fetch(`/api/field/funds/${fundId}/expense`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      haptic.success();
      setShowExpense(false);
      setExpenseForm({ amount: '', description: '', category: '', supplier: '', source: 'advance' });
      onRefresh();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Расходы</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* Balance */}
      <div className="rounded-xl p-5 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>Остаток: {fund.purpose}</p>
        <p className="text-3xl font-bold" style={{ color: 'var(--gold)' }}>{fmtMoney(remainder)}</p>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Выдано {fmtMoney(fund.amount)} · Потрачено {fmtMoney(fund.spent)}</p>
      </div>

      {/* Summary */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>Сводка</p>
        {[
          { label: 'Выдано', value: fmtMoney(fund.amount) },
          { label: 'Потрачено (аванс)', value: `−${fmtMoney(fund.spent)}`, color: '#ef4444' },
          { label: 'Возвращено', value: `−${fmtMoney(fund.returned)}`, color: '#22c55e' },
          ...(parseFloat(fund.own_spent) > 0 ? [{ label: 'Свои средства', value: fmtMoney(fund.own_spent), color: '#f59e0b' }] : []),
          { label: 'Остаток', value: fmtMoney(remainder), color: 'var(--gold)', bold: true },
        ].map((r, i) => (
          <div key={i} className="flex justify-between py-1 text-sm" style={r.bold ? { borderTop: '1px solid var(--border-norse)', marginTop: 4, paddingTop: 8 } : {}}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: r.bold ? 700 : 400 }}>{r.label}</span>
            <span style={{ color: r.color || 'var(--text-primary)', fontWeight: r.bold ? 700 : 600 }}>{r.value}</span>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      {fund.status !== 'closed' && (
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => setShowExpense(true)}
            className="p-4 rounded-xl flex flex-col items-center gap-2 text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, var(--gold), #b8860b)' }}>
            <Receipt size={20} /> Добавить расход
          </button>
          {remainder > 0 && (
            <button onClick={onBack}
              className="p-4 rounded-xl flex flex-col items-center gap-2 text-sm font-semibold"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
              <CornerDownLeft size={20} /> Вернуть остаток
            </button>
          )}
        </div>
      )}

      {/* Expense form */}
      {showExpense && (
        <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '2px solid var(--gold)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Новый расход</p>

          <input type="number" placeholder="Сумма" value={expenseForm.amount}
            onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })}
            className="w-full p-3 rounded-lg text-sm"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />

          <input type="text" placeholder="Описание расхода" value={expenseForm.description}
            onChange={e => setExpenseForm({ ...expenseForm, description: e.target.value })}
            className="w-full p-3 rounded-lg text-sm"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />

          {/* Category pills */}
          <div>
            <p className="text-xs mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Категория</p>
            <div className="flex flex-wrap gap-1.5">
              {EXPENSE_CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setExpenseForm({ ...expenseForm, category: cat })}
                  className="px-3 py-1 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: expenseForm.category === cat ? 'var(--gold)' : 'var(--bg-primary)',
                    color: expenseForm.category === cat ? '#000' : 'var(--text-secondary)',
                    border: '1px solid var(--border-norse)',
                  }}>{cat}</button>
              ))}
            </div>
          </div>

          <input type="text" placeholder="Поставщик / магазин" value={expenseForm.supplier}
            onChange={e => setExpenseForm({ ...expenseForm, supplier: e.target.value })}
            className="w-full p-3 rounded-lg text-sm"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />

          {/* Source: advance or own */}
          <div>
            <p className="text-xs mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Откуда деньги</p>
            <div className="flex gap-2">
              {[{ val: 'advance', label: 'Из аванса' }, { val: 'own', label: 'Свои' }].map(s => (
                <button key={s.val} onClick={() => setExpenseForm({ ...expenseForm, source: s.val })}
                  className="flex-1 py-2 rounded-lg text-xs font-medium"
                  style={{
                    backgroundColor: expenseForm.source === s.val ? 'var(--gold)' : 'var(--bg-primary)',
                    color: expenseForm.source === s.val ? '#000' : 'var(--text-secondary)',
                    border: '1px solid var(--border-norse)',
                  }}>{s.label}</button>
              ))}
            </div>
          </div>

          {/* Receipt photo */}
          <div>
            <p className="text-xs mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Фото чека</p>
            <label className="flex items-center gap-2 p-3 rounded-lg cursor-pointer"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px dashed var(--border-norse)' }}>
              <Camera size={16} style={{ color: 'var(--gold)' }} />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Прикрепить фото</span>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" />
            </label>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setShowExpense(false)} className="flex-1 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>Отмена</button>
            <button onClick={submitExpense} disabled={submitting || !expenseForm.amount || !expenseForm.description}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--gold), #b8860b)' }}>
              {submitting ? '...' : 'Сохранить'}
            </button>
          </div>
        </div>
      )}
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
    <div className="p-4 space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="h-28 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
    </div>
  );

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <Landmark size={22} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Подотчёт</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* Balance hero */}
      <div className="rounded-xl p-5 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>Остаток на руках</p>
        <p className="text-3xl font-bold" style={{ color: 'var(--gold)' }}>{fmtMoney(totalBalance)}</p>
        <div className="grid grid-cols-3 gap-2 mt-4 pt-3" style={{ borderTop: '1px solid var(--border-norse)' }}>
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Выдано</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtMoney(data?.total_issued || data?.totals?.issued)}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Потрачено</p>
            <p className="text-sm font-semibold" style={{ color: '#ef4444' }}>{fmtMoney(data?.total_spent || data?.totals?.spent)}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Возвращено</p>
            <p className="text-sm font-semibold" style={{ color: '#22c55e' }}>{fmtMoney(data?.total_returned || data?.totals?.returned)}</p>
          </div>
        </div>
        {totalOwnSpent > 0 && (
          <p className="text-xs mt-3" style={{ color: '#f59e0b' }}>⚠ Потрачено своих: {fmtMoney(totalOwnSpent)}</p>
        )}
      </div>

      {/* Fund cards */}
      {(!data?.funds || data.funds.length === 0) ? (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <Inbox size={36} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Нет выданных средств</p>
        </div>
      ) : data.funds.map((fund) => {
        const remainder = (fund.amount || 0) - (fund.spent || 0) - (fund.returned || 0);
        const st = STATUS_MAP[fund.status] || STATUS_MAP.closed;
        return (
          <div key={fund.id} className="rounded-xl p-4 space-y-3"
            onClick={() => { haptic.light(); setSearchParams({ detail: fund.id }); }}
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', cursor: 'pointer' }}>
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
            {remainder > 0 && <p className="text-sm" style={{ color: 'var(--gold)' }}>Остаток: {fmtMoney(remainder)}</p>}
            {parseFloat(fund.own_spent) > 0 && (
              <p className="text-xs" style={{ color: '#f59e0b' }}>⚠ Свои: {fmtMoney(fund.own_spent)}</p>
            )}
            <div className="flex gap-2" onClick={e => e.stopPropagation()}>
              {fund.status === 'issued' && (
                <button onClick={() => handleConfirm(fund.id)} disabled={submitting}
                  className="flex-1 py-2 rounded-lg font-medium text-sm flex items-center justify-center gap-1"
                  style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: '#3b82f6', opacity: submitting ? 0.6 : 1 }}>
                  <CheckCircle size={14} /> Получил
                </button>
              )}
              {(fund.status === 'confirmed' || fund.status === 'reporting') && remainder > 0 && (
                <button onClick={() => openReturn(fund)} disabled={submitting}
                  className="flex-1 py-2 rounded-lg font-medium text-sm flex items-center justify-center gap-1"
                  style={{ backgroundColor: 'rgba(234,179,8,0.15)', color: '#eab308', opacity: submitting ? 0.6 : 1 }}>
                  <CornerDownLeft size={14} /> Вернуть
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Return modal */}
      {returnModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setReturnModal(null)}>
          <div className="w-full max-w-md rounded-t-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Возврат средств</h2>
            <input type="number" value={returnAmount} onChange={e => setReturnAmount(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
            <textarea value={returnNote} onChange={e => setReturnNote(e.target.value)} rows={2} placeholder="Комментарий"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
            <button onClick={handleReturn} disabled={submitting}
              className="w-full py-3 rounded-xl font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, var(--gold), #f59e0b)', opacity: submitting ? 0.6 : 1 }}>Вернуть</button>
          </div>
        </div>
      )}
    </div>
  );
}
