import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Banknote, Calendar, Star, AlertTriangle, ArrowDownCircle, CheckCircle } from 'lucide-react';

const fmt = (n) => (n || 0).toLocaleString('ru-RU') + ' ₽';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ru-RU') : '—';

const TYPE_ICONS = { salary: Banknote, advance: ArrowDownCircle, per_diem: Calendar, bonus: Star, penalty: AlertTriangle };
const TYPE_LABELS = { per_diem: 'Суточные', salary: 'Зарплата', advance: 'Аванс', bonus: 'Премия', penalty: 'Удержание' };
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
  const pending = finances?.total_pending ?? (totalEarned - totalPaid);
  const isOverpaid = pending < 0;

  const yearLabel = finances?.scope?.year === 'all' ? 'за всё время' : `за ${finances?.scope?.year || new Date().getFullYear()} год`;
  const perDiemAccrued = finances?.per_diem_accrued || 0;
  const perDiemPaid = finances?.per_diem_paid || 0;
  const perDiemDiff = perDiemAccrued - perDiemPaid;

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/money')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Мои выплаты</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* ─── Hero: К получению ──────────────────────────────── */}
      <div className="rounded-xl p-5 relative overflow-hidden" style={{
        background: 'linear-gradient(135deg, var(--bg-elevated) 0%, rgba(196,154,42,0.08) 100%)',
        border: '1px solid var(--border-norse)',
      }}>
        <div style={{ position: 'absolute', right: '-10px', top: '50%', transform: 'translateY(-50%)', fontSize: '4rem', fontWeight: 900, color: 'rgba(255,255,255,0.03)', letterSpacing: '4px', pointerEvents: 'none' }}>ASGARD</div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
            {isOverpaid ? 'ПЕРЕПЛАТА' : 'К получению'}
          </p>
          <p className="text-3xl font-bold" style={{ color: isOverpaid ? '#22c55e' : 'var(--gold)' }}>
            {fmt(Math.abs(pending))}
          </p>
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
            Заработано {yearLabel}: {fmt(totalEarned)}
          </p>
        </div>
      </div>

      {/* ─── Per diem card ──────────────────────────────────── */}
      {perDiemAccrued > 0 && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>🌙 Суточные</p>
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-secondary)' }}>Начислено</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(perDiemAccrued)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-secondary)' }}>Получено</span>
              <span className="font-medium" style={{ color: '#22c55e' }}>{fmt(perDiemPaid)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-secondary)' }}>
                {perDiemDiff > 0 ? 'Ожидает' : perDiemDiff < 0 ? 'Переплата' : 'Полностью выплачено'}
              </span>
              <span className="font-medium" style={{ color: perDiemDiff > 0 ? '#f59e0b' : perDiemDiff < 0 ? '#3b82f6' : '#22c55e' }}>
                {perDiemDiff === 0 ? '✔' : fmt(Math.abs(perDiemDiff))}
              </span>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-3 rounded" style={{ background: 'rgba(255,255,255,0.08)', height: '6px', overflow: 'hidden' }}>
            <div className="rounded" style={{
              height: '100%',
              width: `${Math.min(100, perDiemAccrued > 0 ? (perDiemPaid / perDiemAccrued) * 100 : 0)}%`,
              background: 'linear-gradient(90deg, var(--gold), #f5c542)',
              transition: 'width 0.8s ease',
            }} />
          </div>
        </div>
      )}

      {/* ─── НАЧИСЛЕНО ──────────────────────────────────────── */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Начислено {yearLabel}
        </p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-secondary)' }}>ФОТ (зарплата)</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(finances?.fot)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-secondary)' }}>Суточные</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(perDiemAccrued)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-secondary)' }}>Премии</span>
            <span className="font-medium" style={{ color: '#22c55e' }}>+{fmt(finances?.bonus_accrued || finances?.bonus_paid)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-secondary)' }}>Штрафы</span>
            <span className="font-medium" style={{ color: '#ef4444' }}>−{fmt(finances?.penalty)}</span>
          </div>
          <div className="flex justify-between pt-2 mt-1 font-semibold" style={{ borderTop: '1px solid var(--border-norse)' }}>
            <span style={{ color: 'var(--text-primary)' }}>Итого начислено</span>
            <span style={{ color: 'var(--gold)' }}>{fmt(totalEarned)}</span>
          </div>
        </div>
      </div>

      {/* ─── ВЫПЛАЧЕНО ──────────────────────────────────────── */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>Выплачено</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-secondary)' }}>Зарплата</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(finances?.salary_paid)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-secondary)' }}>Суточные</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(perDiemPaid)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-secondary)' }}>Авансы</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmt(finances?.advance_paid)}</span>
          </div>
          <div className="flex justify-between pt-2 mt-1 font-semibold" style={{ borderTop: '1px solid var(--border-norse)' }}>
            <span style={{ color: 'var(--text-primary)' }}>Итого выплачено</span>
            <span style={{ color: '#22c55e' }}>{fmt(totalPaid)}</span>
          </div>
        </div>
      </div>

      {/* ─── К ПОЛУЧЕНИЮ ────────────────────────────────────── */}
      <div className="rounded-xl p-4 flex justify-between items-center" style={{
        backgroundColor: 'var(--bg-elevated)',
        border: `1px solid ${isOverpaid ? 'rgba(34,197,94,0.2)' : 'rgba(196,154,42,0.2)'}`,
      }}>
        <span className="text-sm font-bold" style={{ color: isOverpaid ? '#22c55e' : 'var(--gold)' }}>
          {isOverpaid ? 'ПЕРЕПЛАТА' : 'К получению'}
        </span>
        <span className="text-lg font-bold" style={{ color: isOverpaid ? '#22c55e' : 'var(--gold)' }}>
          {fmt(Math.abs(pending))}
        </span>
      </div>

      {/* ─── Payment history ────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest px-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>История операций</p>
        {payments.length === 0 ? (
          <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <p style={{ color: 'var(--text-tertiary)' }}>Нет операций</p>
          </div>
        ) : (
          <div className="space-y-2">
            {payments.sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date)).map((p) => {
              const Icon = TYPE_ICONS[p.type] || Banknote;
              const statusColor = STATUS_COLORS[p.status] || '#6b7280';
              const isDeduction = p.type === 'advance' || p.type === 'penalty';

              // Build meta line: work_title · period · comment
              const meta = [];
              if (p.work_title) meta.push(p.work_title);
              if (p.period_from && p.period_to) {
                meta.push(`${fmtDate(p.period_from)} – ${fmtDate(p.period_to)}`);
              } else if (p.created_at) {
                meta.push(fmtDate(p.created_at));
              }
              if (p.comment) meta.push(p.comment);

              return (
                <div key={p.id} className="rounded-xl p-3 flex items-center gap-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: statusColor + '20' }}>
                    <Icon size={16} style={{ color: statusColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {TYPE_LABELS[p.type] || p.type}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {meta.join(' · ')}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold" style={{ color: isDeduction ? '#ef4444' : 'var(--text-primary)' }}>
                      {isDeduction ? '−' : '+'}{fmt(p.amount)}
                    </p>
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
