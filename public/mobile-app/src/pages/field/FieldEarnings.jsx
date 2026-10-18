import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import {
  ArrowLeft, Banknote, Calendar, Star, AlertTriangle, ArrowDownCircle, CheckCircle, Moon,
  Wallet, TrendingDown, TrendingUp, Receipt,
} from 'lucide-react';
import { Card, IconTile, KeyButton, ProgressBar, SectionLabel, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { formatMoney as fmt } from '@/lib/utils';
import './field-screens.css';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ru-RU') : '—';

const TYPE_ICONS = { salary: Banknote, advance: ArrowDownCircle, per_diem: Calendar, bonus: Star, penalty: AlertTriangle };
const TYPE_LABELS = { per_diem: 'Суточные', salary: 'Зарплата', advance: 'Аванс', bonus: 'Премия', penalty: 'Удержание' };
const STATUS_COLORS = { paid: 'var(--acc)', confirmed: 'var(--ok)', pending: 'var(--value-ink)' };
const STATUS_LABELS = { paid: 'Выплачено', confirmed: 'Получено', pending: 'Ожидает' };

/* Строка «ключ — значение» для финансовых разбивок */
function Row({ k, v, tone }) {
  return (
    <div className="fs-row">
      <span className="fs-row__k">{k}</span>
      <span className="fs-row__v" style={tone ? { color: tone } : undefined}>{v}</span>
    </div>
  );
}

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
      <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <SkeletonList count={4} />
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
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-4">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/money')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Wallet} tone="value" size={40} />
          <h1 className="fs-head__title">Мои выплаты</h1>
        </div>

        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: 'var(--danger-ink)' }}>{error}</Card>
        )}

        {/* ─── Hero: К получению ──────────────────────────────── */}
        <Card variant="raised" tone={isOverpaid ? 'status' : 'value'} className="p-5 relative overflow-hidden">
          <div style={{ position: 'absolute', right: '-10px', top: '50%', transform: 'translateY(-50%)', fontSize: '4rem', fontWeight: 900, color: 'color-mix(in oklab, var(--text-primary) 4%, transparent)', letterSpacing: '4px', pointerEvents: 'none' }}>ASGARD</div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
              {isOverpaid ? 'ПЕРЕПЛАТА' : 'К получению'}
            </p>
            <p className="text-3xl font-bold" style={{ color: isOverpaid ? 'var(--ok)' : 'var(--value-ink)' }}>
              {fmt(Math.abs(pending))}
            </p>
            <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
              Заработано {yearLabel}: {fmt(totalEarned)}
            </p>
          </div>
        </Card>

        {/* ─── Per diem card ──────────────────────────────────── */}
        {perDiemAccrued > 0 && (
          <Card variant="raised" className="p-4">
            <SectionLabel>
              <span className="inline-flex items-center gap-1.5">
                <Moon size={11} strokeWidth={2.5} style={{ color: 'var(--value-ink)' }} aria-hidden />
                Суточные
              </span>
            </SectionLabel>
            <div>
              <Row k="Начислено" v={fmt(perDiemAccrued)} />
              <Row k="Получено" v={fmt(perDiemPaid)} tone="var(--ok)" />
              <Row
                k={perDiemDiff > 0 ? 'Ожидает' : perDiemDiff < 0 ? 'Переплата' : 'Полностью выплачено'}
                v={perDiemDiff === 0 ? '' : fmt(Math.abs(perDiemDiff))}
                tone={perDiemDiff > 0 ? 'var(--value-ink)' : perDiemDiff < 0 ? 'var(--acc)' : 'var(--ok)'}
              />
            </div>
            {/* Progress bar */}
            <div className="mt-3">
              <ProgressBar
                value={Math.min(100, perDiemAccrued > 0 ? (perDiemPaid / perDiemAccrued) * 100 : 0)}
                color="linear-gradient(90deg, var(--value), var(--acc))"
              />
            </div>
          </Card>
        )}

        {/* ─── НАЧИСЛЕНО ──────────────────────────────────────── */}
        <Card variant="raised" className="p-4">
          <SectionLabel>Начислено {yearLabel}</SectionLabel>
          <div>
            <Row k="ФОТ (зарплата)" v={fmt(finances?.fot)} />
            <Row k="Суточные" v={fmt(perDiemAccrued)} />
            <Row k="Премии" v={`+${fmt(finances?.bonus_accrued || finances?.bonus_paid)}`} tone="var(--ok)" />
            <Row k="Штрафы" v={`−${fmt(finances?.penalty)}`} tone="var(--danger-ink)" />
            <div className="fs-row" style={{ borderTop: '1px solid var(--tile-brd)', marginTop: 4, paddingTop: 8 }}>
              <span className="fs-row__k" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Итого начислено</span>
              <span className="fs-row__v" style={{ color: 'var(--value-ink)' }}>{fmt(totalEarned)}</span>
            </div>
          </div>
        </Card>

        {/* ─── ВЫПЛАЧЕНО ──────────────────────────────────────── */}
        <Card variant="raised" className="p-4">
          <SectionLabel>Выплачено</SectionLabel>
          <div>
            <Row k="Зарплата" v={fmt(finances?.salary_paid)} />
            <Row k="Суточные" v={fmt(perDiemPaid)} />
            <Row k="Авансы" v={fmt(finances?.advance_paid)} />
            <div className="fs-row" style={{ borderTop: '1px solid var(--tile-brd)', marginTop: 4, paddingTop: 8 }}>
              <span className="fs-row__k" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Итого выплачено</span>
              <span className="fs-row__v" style={{ color: 'var(--ok)' }}>{fmt(totalPaid)}</span>
            </div>
          </div>
        </Card>

        {/* ─── К ПОЛУЧЕНИЮ ────────────────────────────────────── */}
        <Card variant="raised" className="p-4 flex justify-between items-center" style={{
          borderColor: isOverpaid
            ? 'color-mix(in oklab, var(--ok) 24%, transparent)'
            : 'color-mix(in oklab, var(--value) 24%, transparent)',
        }}>
          <span className="text-sm font-bold" style={{ color: isOverpaid ? 'var(--ok)' : 'var(--value-ink)' }}>
            {isOverpaid ? 'ПЕРЕПЛАТА' : 'К получению'}
          </span>
          <span className="text-lg font-bold" style={{ color: isOverpaid ? 'var(--ok)' : 'var(--value-ink)' }}>
            {fmt(Math.abs(pending))}
          </span>
        </Card>

        {/* ─── Payment history ────────────────────────────────── */}
        <div>
          <SectionLabel>История операций</SectionLabel>
          {payments.length === 0 ? (
            <EmptyState icon={Receipt} title="Нет операций" description="История выплат появится здесь" />
          ) : (
            <div className="space-y-2">
              {payments.sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date)).map((p) => {
                const Icon = TYPE_ICONS[p.type] || Banknote;
                const statusColor = STATUS_COLORS[p.status] || 'var(--text-tertiary)';
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
                  <Card key={p.id} variant="raised" className="p-3 flex items-center gap-3">
                    <IconTile icon={Icon} tone="neutral" size={36} style={{ color: statusColor }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {TYPE_LABELS[p.type] || p.type}
                      </p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                        {meta.join(' · ')}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold" style={{ color: isDeduction ? 'var(--danger-ink)' : 'var(--text-primary)' }}>
                        {isDeduction ? '−' : '+'}{fmt(p.amount)}
                      </p>
                      {p.status === 'paid' && !p.confirmed_by_worker && (
                        <button
                          onClick={() => confirmPayment(p.id)}
                          className="text-xs mt-1 flex items-center gap-1"
                          style={{ color: 'var(--ok)' }}
                        >
                          <CheckCircle size={12} strokeWidth={2.5} aria-hidden /> Получил
                        </button>
                      )}
                      {p.status !== 'paid' && (
                        <span className="text-xs" style={{ color: statusColor }}>{STATUS_LABELS[p.status] || p.status}</span>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
