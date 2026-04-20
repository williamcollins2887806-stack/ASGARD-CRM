import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Banknote, Calendar, Star, AlertTriangle, ArrowDownCircle, CheckCircle } from 'lucide-react';

const fmt = (n) => (n || 0).toLocaleString('ru-RU') + ' ₽';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ru-RU') : '—';

const TYPE_ICONS = { salary: Banknote, advance: ArrowDownCircle, per_diem: Calendar, bonus: Star, penalty: AlertTriangle };
const STATUS_COLORS = { paid: '#3b82f6', confirmed: '#22c55e', pending: '#f59e0b' };
const STATUS_LABELS = { paid: 'Выплачено', confirmed: 'Получено', pending: 'Ожидает' };

export default function FieldEarnings() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [finances, setFinances] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [fin, pay] = await Promise.all([
        fieldApi.get('/worker/finances'),
        fetchPayments(),
      ]);
      setFinances(fin);
      setPayments(Array.isArray(pay) ? pay : pay?.payments || pay?.rows || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function fetchPayments() {
    const token = localStorage.getItem('field_token');
    const res = await fetch('/api/worker-payments/my', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    return res.json();
  }

  async function confirmPayment(id) {
    haptic.success();
    try {
      const token = localStorage.getItem('field_token');
      await fetch(`/api/worker-payments/my/${id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      setPayments((prev) => prev.map((p) => p.id === id ? { ...p, status: 'confirmed', confirmed_by_worker: true } : p));
    } catch { /* silent */ }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
      </div>
    );
  }

  const totalEarned = finances?.total_earned || 0;
  const totalPaid = finances?.total_paid || 0;
  const pending = totalEarned - totalPaid;

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/money')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Выплаты</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* Balance card */}
      <div className="rounded-xl p-5 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-tertiary)' }}>
          {pending < 0 ? 'Переплата' : 'К получению'}
        </p>
        <p className="text-3xl font-bold" style={{ color: pending < 0 ? '#ef4444' : '#22c55e' }}>{fmt(Math.abs(pending))}</p>
      </div>

      {/* Breakdown */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>ФОТ</span><span style={{ color: 'var(--text-primary)' }}>{fmt(finances?.fot)}</span></div>
          <div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Суточные</span><span style={{ color: 'var(--text-primary)' }}>{fmt(finances?.per_diem)}</span></div>
          <div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Бонусы</span><span style={{ color: '#22c55e' }}>{fmt(finances?.bonuses)}</span></div>
          <div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Штрафы</span><span style={{ color: '#ef4444' }}>−{fmt(finances?.penalties)}</span></div>
          <div className="border-t pt-2" style={{ borderColor: 'var(--border-norse)' }}>
            <div className="flex justify-between font-semibold"><span style={{ color: 'var(--text-primary)' }}>Итого начислено</span><span style={{ color: 'var(--gold)' }}>{fmt(totalEarned)}</span></div>
            <div className="flex justify-between mt-1"><span style={{ color: 'var(--text-secondary)' }}>Выплачено</span><span style={{ color: 'var(--text-primary)' }}>{fmt(totalPaid)}</span></div>
          </div>
        </div>
      </div>

      {/* Payment history */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide px-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>История операций</p>
        {payments.length === 0 ? (
          <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <p style={{ color: 'var(--text-tertiary)' }}>Нет операций</p>
          </div>
        ) : (
          <div className="space-y-2">
            {payments.sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date)).map((p) => {
              const Icon = TYPE_ICONS[p.type] || Banknote;
              const statusColor = STATUS_COLORS[p.status] || '#6b7280';
              return (
                <div key={p.id} className="rounded-xl p-3 flex items-center gap-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: statusColor + '20' }}>
                    <Icon size={16} style={{ color: statusColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.description || p.type}</p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{fmtDate(p.created_at || p.date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold" style={{ color: p.type === 'penalty' ? '#ef4444' : 'var(--text-primary)' }}>{fmt(p.amount)}</p>
                    {p.status === 'paid' && !p.confirmed_by_worker && (
                      <button
                        onClick={() => confirmPayment(p.id)}
                        className="text-xs mt-1 flex items-center gap-1"
                        style={{ color: '#22c55e' }}
                      >
                        <CheckCircle size={12} /> Получил
                      </button>
                    )}
                    {p.status !== 'paid' && (
                      <span className="text-xs" style={{ color: statusColor }}>{STATUS_LABELS[p.status] || p.status}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
