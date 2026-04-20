import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Landmark, CheckCircle, CornerDownLeft, Inbox } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';

function fmtMoney(n) { return (n || 0).toLocaleString('ru-RU') + ' \u20BD'; }

const STATUS_MAP = {
  issued: { label: 'Выдано', bg: 'rgba(234,179,8,0.15)', color: '#eab308' },
  confirmed: { label: 'Получено', bg: 'rgba(59,130,246,0.15)', color: '#3b82f6' },
  reporting: { label: 'Отчёт', bg: 'rgba(249,115,22,0.15)', color: '#f97316' },
  closed: { label: 'Закрыто', bg: 'rgba(107,114,128,0.15)', color: '#6b7280' },
};

export default function FieldFunds() {
  const navigate = useNavigate();
  const haptic = useHaptic();
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
    setError(null);
  };

  const handleReturn = async () => {
    if (!returnModal) return;
    const remainder = (returnModal.amount || 0) - (returnModal.spent || 0) - (returnModal.returned || 0);
    const amt = Number(returnAmount);
    if (!amt || amt <= 0 || amt > remainder) {
      setError(`Сумма должна быть от 1 до ${fmtMoney(remainder)}`);
      return;
    }
    haptic.medium();
    setSubmitting(true);
    try {
      await fieldApi.post(`/funds/${returnModal.id}/return`, {
        amount: amt,
        ...(returnNote.trim() && { note: returnNote.trim() }),
      });
      setReturnModal(null);
      await fetchData();
      haptic.success();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  const totalBalance = data?.funds?.reduce((s, f) => s + ((f.amount || 0) - (f.spent || 0) - (f.returned || 0)), 0) || 0;

  if (loading) return (
    <div className="p-4 space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="h-28 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <Landmark size={22} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Касса мастера</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}>{error}</div>}

      {/* Balance hero */}
      <div className="rounded-xl p-5 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Остаток на руках</p>
        <p className="text-3xl font-bold" style={{ color: 'var(--gold)' }}>{fmtMoney(totalBalance)}</p>
        <div className="grid grid-cols-3 gap-2 mt-4 pt-3" style={{ borderTop: '1px solid var(--border-norse)' }}>
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Выдано</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtMoney(data?.total_issued)}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Потрачено</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtMoney(data?.total_spent)}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Возвращено</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtMoney(data?.total_returned)}</p>
          </div>
        </div>
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
          <div key={fund.id} className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{fund.purpose || 'Без назначения'}</p>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>Сумма: {fmtMoney(fund.amount)}</p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap" style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</span>
            </div>
            {remainder > 0 && (
              <p className="text-sm" style={{ color: 'var(--gold)' }}>Остаток: {fmtMoney(remainder)}</p>
            )}
            {fund.status === 'issued' && (
              <button onClick={() => handleConfirm(fund.id)} disabled={submitting}
                className="w-full py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2"
                style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: '#3b82f6', opacity: submitting ? 0.6 : 1 }}>
                <CheckCircle size={16} /> Подтвердить получение
              </button>
            )}
            {(fund.status === 'confirmed' || fund.status === 'reporting') && remainder > 0 && (
              <button onClick={() => openReturn(fund)} disabled={submitting}
                className="w-full py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2"
                style={{ backgroundColor: 'rgba(234,179,8,0.15)', color: '#eab308', opacity: submitting ? 0.6 : 1 }}>
                <CornerDownLeft size={16} /> Вернуть остаток
              </button>
            )}
          </div>
        );
      })}

      {/* Return modal */}
      {returnModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setReturnModal(null)}>
          <div className="w-full max-w-md rounded-t-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Возврат средств</h2>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Сумма возврата</label>
              <input type="number" value={returnAmount} onChange={e => setReturnAmount(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Комментарий (необязательно)</label>
              <textarea value={returnNote} onChange={e => setReturnNote(e.target.value)} rows={2}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
            </div>
            <button onClick={handleReturn} disabled={submitting}
              className="w-full py-3 rounded-xl font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, var(--gold), #f59e0b)', opacity: submitting ? 0.6 : 1 }}>
              Вернуть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
