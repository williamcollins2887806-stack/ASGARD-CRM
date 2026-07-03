/**
 * PaymentBreakdown — разделение выплат работнику по источникам денег.
 *
 * Открывается тапом по строке работника в «Расчёт кассы» (PayrollDashboard).
 * Грузит детализацию из `/api/payroll-dashboard/worker/:id/breakdown` +
 * операции (worker_payments) с признаком source_kind.
 *
 * Источники:
 *   pm_cash         — 📤 моя касса (PM выдал нал) — зелёный
 *   company_bank    — 🏦 банк компании             — синий
 *   company_se      — 📱 СЗ-сервис                  — фиолетовый
 *   auto_fot        — ⚙ авто-ФОТ                    — серый
 *   pm_cash_legacy  — старая автоматика → склеиваем с pm_cash
 *
 * Только CSS-токены, никаких хардкод-цветов.
 */
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { BottomSheet } from './BottomSheet';
import { Loader2 } from 'lucide-react';

const fmt = (n) => (n != null ? Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽' : '—');

/* ── Палитра источников (через токены темы) ───────────────────────── */
const SOURCE_META = {
  pm_cash:        { icon: '📤', label: 'Касса РП (нал)',  color: 'var(--green)'  },
  pm_cash_legacy: { icon: '📤', label: 'Касса РП (нал)',  color: 'var(--green)'  },
  company_bank:   { icon: '🏦', label: 'Банк компании',   color: 'var(--blue)'   },
  company_se:     { icon: '📱', label: 'СЗ-сервис',        color: 'var(--purple)' },
  auto_fot:       { icon: '⚙',  label: 'Авто-ФОТ',         color: 'var(--text-secondary)' },
};

const ACCRUAL_META = {
  salary:   { icon: '💼', label: 'Оклад'    },
  bonus:    { icon: '⭐', label: 'Премия'    },
  per_diem: { icon: '🍱', label: 'Суточные' },
  advance:  { icon: '💵', label: 'Аванс'     },
  penalty:  { icon: '⚠', label: 'Штраф'    },
};

/**
 * Группирует legacy → pm_cash. Возвращает массив { kind, total } в каноне-порядке.
 */
function normalizeSources(bySource) {
  const norm = { pm_cash: 0, company_bank: 0, company_se: 0, auto_fot: 0 };
  if (!bySource) return norm;
  for (const [k, v] of Object.entries(bySource)) {
    const key = k === 'pm_cash_legacy' ? 'pm_cash' : k;
    if (norm[key] != null) norm[key] += Number(v) || 0;
  }
  return norm;
}

export function PaymentBreakdown({ open, onClose, worker, params }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!open || !worker?.employee_id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams();
    if (params?.work_id) q.set('work_id', params.work_id);
    if (params?.from)    q.set('from',    params.from);
    if (params?.to)      q.set('to',      params.to);
    if (params?.pm_id)   q.set('pm_id',   params.pm_id);
    api.get(`/payroll-dashboard/worker/${worker.employee_id}/breakdown?${q.toString()}`)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e)  => { if (!cancelled) setError(e?.message || 'Ошибка загрузки'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, worker?.employee_id, params?.work_id, params?.from, params?.to, params?.pm_id]);

  if (!worker) return null;

  const accrued    = data?.accrued    || {};
  const paidRaw    = data?.paid_by_source || data?.payouts_by_source || {};
  const operations = Array.isArray(data?.operations) ? data.operations : [];

  const accruedRows = ['salary', 'bonus', 'per_diem', 'advance', 'penalty']
    .map((k) => ({ key: k, value: Number(accrued[k]) || 0 }))
    .filter((r) => r.value !== 0);
  const totalAccrued = (data?.total_accrued != null)
    ? Number(data.total_accrued)
    : accruedRows.reduce((s, r) => s + (r.key === 'penalty' ? -Math.abs(r.value) : r.value), 0);

  const paid = normalizeSources(paidRaw);
  const totalPaid = (data?.total_paid != null)
    ? Number(data.total_paid)
    : Object.values(paid).reduce((s, v) => s + (Number(v) || 0), 0);

  const remaining = (data?.remaining != null) ? Number(data.remaining) : (totalAccrued - totalPaid);
  const isClosed  = remaining <= 0.5;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={worker?.fio ? `Разбивка: ${worker.fio}` : 'Разбивка выплат'}
    >
      <div className="flex flex-col gap-3 pb-4">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
          </div>
        )}

        {error && (
          <div
            className="text-[12px] px-3 py-2 rounded-lg"
            style={{
              background: 'color-mix(in srgb, var(--red-soft) 14%, transparent)',
              color: 'var(--red-soft)',
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* ── Начислено ─────────────────────────────────────── */}
            <section>
              <p
                className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Начислено
              </p>
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: '0.5px solid var(--border-norse)' }}
              >
                {accruedRows.length === 0 ? (
                  <div
                    className="px-4 py-3 text-[13px]"
                    style={{
                      background: 'var(--bg-surface)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    Нет начислений за период
                  </div>
                ) : (
                  accruedRows.map((r, i) => {
                    const m = ACCRUAL_META[r.key] || { icon: '•', label: r.key };
                    const isPenalty = r.key === 'penalty';
                    const shown = isPenalty ? -Math.abs(r.value) : r.value;
                    return (
                      <div
                        key={r.key}
                        className="flex items-center justify-between px-4 py-2.5"
                        style={{
                          background: 'var(--bg-surface)',
                          borderBottom: i < accruedRows.length - 1
                            ? '0.5px solid var(--border-norse)'
                            : 'none',
                        }}
                      >
                        <span
                          className="text-[13px]"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          <span style={{ marginRight: 6 }}>{m.icon}</span>
                          {m.label}
                        </span>
                        <span
                          className="text-[13px] font-semibold"
                          style={{ color: isPenalty ? 'var(--red-soft)' : 'var(--text-primary)' }}
                        >
                          {isPenalty ? '−' : ''}{fmt(Math.abs(shown))}
                        </span>
                      </div>
                    );
                  })
                )}
                <div
                  className="flex items-center justify-between px-4 py-2.5"
                  style={{
                    background: 'color-mix(in srgb, var(--gold) 10%, var(--bg-surface))',
                    borderTop: '0.5px solid var(--border-norse)',
                  }}
                >
                  <span
                    className="text-[12px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Итого начислено
                  </span>
                  <span
                    className="text-[14px] font-bold"
                    style={{ color: 'var(--gold)' }}
                  >
                    {fmt(totalAccrued)}
                  </span>
                </div>
              </div>
            </section>

            {/* ── Выплачено (по источникам) ─────────────────────── */}
            <section>
              <p
                className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Выплачено (по источникам)
              </p>
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: '0.5px solid var(--border-norse)' }}
              >
                {['company_bank', 'pm_cash', 'company_se', 'auto_fot'].map((kind, i, arr) => {
                  const m = SOURCE_META[kind];
                  const v = paid[kind] || 0;
                  return (
                    <div
                      key={kind}
                      className="flex items-center justify-between px-4 py-2.5"
                      style={{
                        background: 'var(--bg-surface)',
                        borderBottom: i < arr.length - 1
                          ? '0.5px solid var(--border-norse)'
                          : 'none',
                        opacity: v === 0 ? 0.55 : 1,
                      }}
                    >
                      <span
                        className="text-[13px]"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <span style={{ marginRight: 6 }}>{m.icon}</span>
                        {m.label}
                      </span>
                      <span
                        className="text-[13px] font-semibold"
                        style={{ color: v === 0 ? 'var(--text-tertiary)' : m.color }}
                      >
                        {v === 0 ? '—' : fmt(v)}
                      </span>
                    </div>
                  );
                })}
                <div
                  className="flex items-center justify-between px-4 py-2.5"
                  style={{
                    background: 'color-mix(in srgb, var(--blue) 10%, var(--bg-surface))',
                    borderTop: '0.5px solid var(--border-norse)',
                  }}
                >
                  <span
                    className="text-[12px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Итого выплачено
                  </span>
                  <span
                    className="text-[14px] font-bold"
                    style={{ color: 'var(--blue)' }}
                  >
                    {fmt(totalPaid)}
                  </span>
                </div>
              </div>
            </section>

            {/* ── Сальдо ───────────────────────────────────────── */}
            <div
              className="rounded-xl px-4 py-3 flex items-center justify-between"
              style={{
                background: isClosed
                  ? 'color-mix(in srgb, var(--green) 12%, var(--bg-surface))'
                  : 'color-mix(in srgb, var(--orange) 12%, var(--bg-surface))',
                border: isClosed
                  ? '0.5px solid color-mix(in srgb, var(--green) 30%, var(--border-norse))'
                  : '0.5px solid color-mix(in srgb, var(--orange) 30%, var(--border-norse))',
              }}
            >
              <span
                className="text-[13px] font-semibold"
                style={{ color: isClosed ? 'var(--green)' : 'var(--orange)' }}
              >
                {isClosed ? '✓ Полностью закрыто' : '⚠ К доплате'}
              </span>
              {!isClosed && (
                <span
                  className="text-[15px] font-bold"
                  style={{ color: 'var(--orange)' }}
                >
                  {fmt(remaining)}
                </span>
              )}
            </div>

            {/* ── Таблица операций ─────────────────────────────── */}
            {operations.length > 0 && (
              <section>
                <p
                  className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Операции ({operations.length})
                </p>
                <div className="flex flex-col gap-1.5 max-h-[40vh] overflow-y-auto scroll-container">
                  {operations.map((op, i) => {
                    const src = op.source_kind === 'pm_cash_legacy' ? 'pm_cash' : (op.source_kind || 'auto_fot');
                    const m = SOURCE_META[src] || SOURCE_META.auto_fot;
                    const amt = Number(op.amount) || 0;
                    const sign = (op.type === 'penalty' || amt < 0) ? '−' : '';
                    const dt = op.paid_at || op.date || op.created_at;
                    return (
                      <div
                        key={op.id || i}
                        className="rounded-lg px-3 py-2"
                        style={{
                          background: 'var(--bg-surface)',
                          border: '0.5px solid var(--border-norse)',
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="text-[12px] truncate"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {op.type_label || ACCRUAL_META[op.type]?.label || op.type || 'Выплата'}
                          </span>
                          <span
                            className="text-[13px] font-semibold shrink-0"
                            style={{ color: m.color }}
                          >
                            {sign}{fmt(Math.abs(amt))}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{
                              background: `color-mix(in srgb, ${m.color} 14%, transparent)`,
                              color: m.color,
                            }}
                          >
                            {m.icon} {m.label}
                          </span>
                          {dt && (
                            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                              {new Date(dt).toLocaleDateString('ru-RU')}
                            </span>
                          )}
                          {op.comment && (
                            <span
                              className="text-[10px] truncate"
                              style={{ color: 'var(--text-tertiary)' }}
                            >
                              · {op.comment}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}

export default PaymentBreakdown;
