/**
 * PaymentBreakdown — модалка детализации выплат конкретному работнику.
 *
 * Прототип: Desktop/азот/Прототип_выплаты.html (панель 1 «Модалка работника»).
 *
 * Структура:
 *   • Шапка: ФИО + бейдж штатник/СЗ + период + проект
 *   • Grid 2 колонки: «Начислено» (salary/bonus/per_diem/advance/penalty) | «Выплачено» (Банк/Касса РП/СЗ-сервис/Авто-ФОТ)
 *   • Плашка delta: 0 → «Полностью закрыто», >0 → «К доплате X ₽», <0 → «Переплата»
 *   • Таблица операций: Дата/Тип/Сумма/Источник chip/Кто выдал
 *
 * Props:
 *   employeeId, workId, periodFrom, periodTo, pmId, onClose
 *
 * Backend:
 *   GET /api/payroll-dashboard/worker/:id/breakdown?work_id=&from=&to=&pm_id=
 *
 * source_kind склейка: pm_cash_legacy → pm_cash.
 */
import { useEffect, useMemo, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
import './PaymentBreakdown.css';

// ─── helpers ───────────────────────────────────────────────────────────────

function fmtMoney(n) {
  if (n == null || n === '') return '0 ₽';
  const num = Number(n);
  if (!Number.isFinite(num)) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(num)) + ' ₽';
}

function fmtDate(s) {
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return String(s);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return String(s);
  }
}

// Описания типов начисления (worker_payments.type)
const ACCRUAL_LABELS = {
  salary:   'Оклад / ЗП',
  bonus:    'Премия',
  per_diem: 'Суточные',
  advance:  'Аванс',
  penalty:  'Штраф / удержание'
};

// Описания source_kind → chip + tone + label. pm_cash_legacy склеиваем с pm_cash.
const SOURCE_META = {
  pm_cash:      { icon: '📤', label: 'Касса РП',   tone: 'cash' },
  company_bank: { icon: '🏦', label: 'Банк',       tone: 'bank' },
  company_se:   { icon: '📱', label: 'СЗ-сервис',  tone: 'se' },
  auto_fot:     { icon: '⚙',  label: 'Авто-ФОТ',   tone: 'auto' },
  other:        { icon: '◦',  label: 'Прочее',     tone: 'other' }
};

function normalizeSourceKind(kind) {
  if (kind === 'pm_cash_legacy') return 'pm_cash';
  return kind || 'other';
}

function sourceMeta(kind) {
  return SOURCE_META[normalizeSourceKind(kind)] || SOURCE_META.other;
}

// ─── основной компонент ────────────────────────────────────────────────────

export default function PaymentBreakdown({
  employeeId,
  workId = null,
  periodFrom = null,
  periodTo = null,
  pmId = null,
  onClose
}) {
  const { close } = useModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const handleClose = () => {
    onClose?.();
    close();
  };

  useEffect(() => {
    if (!employeeId) {
      setError('Не указан работник');
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams();
    if (workId != null && workId !== '') q.set('work_id', String(workId));
    if (periodFrom) q.set('from', periodFrom);
    if (periodTo) q.set('to', periodTo);
    if (pmId != null && pmId !== '') q.set('pm_id', String(pmId));
    const qs = q.toString();
    api(`/api/payroll-dashboard/worker/${encodeURIComponent(employeeId)}/breakdown${qs ? '?' + qs : ''}`)
      .then((res) => {
        if (cancel) return;
        setData(res || null);
      })
      .catch((e) => {
        if (cancel) return;
        const msg = e?.serverMsg || e?.message || 'Не удалось загрузить детализацию';
        setError(msg);
        toast.error('Детализация выплат: ' + msg);
      })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [employeeId, workId, periodFrom, periodTo, pmId]);

  // Склейка pm_cash_legacy → pm_cash
  const paid = useMemo(() => {
    const p = data?.paid || {};
    return {
      pm_cash:      Number(p.pm_cash || 0) + Number(p.pm_cash_legacy || 0),
      company_bank: Number(p.company_bank || 0),
      company_se:   Number(p.company_se || 0),
      auto_fot:     Number(p.auto_fot || 0),
      other:        Number(p.other || 0),
      total:        Number(p.total || 0)
    };
  }, [data]);

  const accrued = useMemo(() => {
    const a = data?.accrued || {};
    return {
      salary:   Number(a.salary || 0),
      bonus:    Number(a.bonus || 0),
      per_diem: Number(a.per_diem || 0),
      advance:  Number(a.advance || 0),
      penalty:  Number(a.penalty || 0),
      total:    Number(a.total || 0)
    };
  }, [data]);

  // balance > 0 → к доплате
  // balance < 0 → переплата
  // balance == 0 → закрыто
  const balance = Number(data?.balance ?? (accrued.total - paid.total));

  const periodLabel = data?.period
    ? `${fmtDate(data.period.from)} — ${fmtDate(data.period.to)}`
    : (periodFrom || periodTo ? `${fmtDate(periodFrom)} — ${fmtDate(periodTo)}` : '');

  const fio = data?.employee_fio || '—';
  const isOff = !!data?.is_officially_employed;
  const isSe = !!data?.is_self_employed;

  // Бейдж типа работника
  const empBadge = isOff ? { cls: 'pb-badge-off', text: 'штатник' }
    : isSe ? { cls: 'pb-badge-se', text: 'самозанятый' }
    : { cls: 'pb-badge-cash', text: 'наличный' };

  return (
    <MCard className="modal-xl">
      <MHead
        icon="💰"
        title="Детализация выплат работнику"
        subtitle={loading ? 'Загружаем…' : `${fio}${periodLabel ? ' · ' + periodLabel : ''}`}
        accent="gold"
        onClose={handleClose}
      />
      <MBody>
        {loading && (
          <div className="pb-loading">⏳ Загружаем детализацию…</div>
        )}

        {!loading && error && (
          <div className="pb-error">⚠ {error}</div>
        )}

        {!loading && !error && data && (
          <>
            {/* Шапка: ФИО + бейдж + период + проект */}
            <div className="pb-head">
              <div className="pb-head-left">
                <div className="pb-fio">
                  {fio}
                  <span className={'pb-badge ' + empBadge.cls}>{empBadge.text}</span>
                </div>
                <div className="pb-head-meta">
                  {periodLabel && <span>{periodLabel}</span>}
                  {data.work_title && (
                    <>
                      <span className="pb-sep">·</span>
                      <span>{data.work_title}</span>
                    </>
                  )}
                  {data.pm_name && (
                    <>
                      <span className="pb-sep">·</span>
                      <span className="pb-mut">РП: {data.pm_name}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Двух-колонка: Начислено | Выплачено */}
            <div className="pb-breakdown">
              {/* ── Начислено ── */}
              <div className="pb-col pb-col-accrued">
                <div className="pb-col-h">💰 Начислено</div>

                {accrued.salary > 0 && (
                  <div className="pb-row">
                    <span className="pb-row-l">{ACCRUAL_LABELS.salary}</span>
                    <span className="pb-row-v">{fmtMoney(accrued.salary)}</span>
                  </div>
                )}
                {accrued.bonus > 0 && (
                  <div className="pb-row">
                    <span className="pb-row-l">{ACCRUAL_LABELS.bonus}</span>
                    <span className="pb-row-v">{fmtMoney(accrued.bonus)}</span>
                  </div>
                )}
                {accrued.per_diem > 0 && (
                  <div className="pb-row">
                    <span className="pb-row-l">{ACCRUAL_LABELS.per_diem}</span>
                    <span className="pb-row-v">{fmtMoney(accrued.per_diem)}</span>
                  </div>
                )}
                {accrued.advance > 0 && (
                  <div className="pb-row">
                    <span className="pb-row-l">{ACCRUAL_LABELS.advance}</span>
                    <span className="pb-row-v">{fmtMoney(accrued.advance)}</span>
                  </div>
                )}
                {accrued.penalty > 0 && (
                  <div className="pb-row">
                    <span className="pb-row-l">{ACCRUAL_LABELS.penalty}</span>
                    <span className="pb-row-v pb-row-v-neg">−{fmtMoney(accrued.penalty)}</span>
                  </div>
                )}

                {accrued.total === 0 && (
                  <div className="pb-row pb-row-empty">Нет начислений за период</div>
                )}

                <div className="pb-row pb-row-total">
                  <span>ИТОГО начислено</span>
                  <span className="pb-row-v">{fmtMoney(accrued.total)}</span>
                </div>
              </div>

              {/* ── Выплачено ── */}
              <div className="pb-col pb-col-paid">
                <div className="pb-col-h">💸 Выплачено</div>

                <PaidRow icon="🏦" label="Банк (компания)"     value={paid.company_bank} tone="bank" />
                <PaidRow icon="📤" label="Касса РП (нал)"      value={paid.pm_cash}      tone="cash" />
                <PaidRow icon="📱" label="СЗ-сервис (компания)" value={paid.company_se}  tone="se" />
                <PaidRow icon="⚙"  label="Авто-ФОТ"            value={paid.auto_fot}     tone="auto" />
                {paid.other > 0 && (
                  <PaidRow icon="◦" label="Прочее" value={paid.other} tone="other" />
                )}

                <div className="pb-row pb-row-total">
                  <span>ИТОГО выплачено</span>
                  <span className="pb-row-v">{fmtMoney(paid.total)}</span>
                </div>
              </div>
            </div>

            {/* Delta */}
            <DeltaBanner balance={balance} />

            {/* PM-Kassa Impact — сколько ушло из моей кассы */}
            {Number(data.pm_kassa_impact) !== 0 && (
              <div className="pb-pm-kassa">
                <span className="pb-pm-kassa-icon">📤</span>
                <span className="pb-pm-kassa-text">
                  Из кассы РП по этому работнику ушло: <b>{fmtMoney(data.pm_kassa_impact)}</b>
                </span>
              </div>
            )}

            {/* Таблица операций */}
            {Array.isArray(data.operations) && data.operations.length > 0 && (
              <>
                <div className="pb-ops-h">Детализация операций</div>
                <div className="pb-ops-wrap">
                  <table className="pb-ops-tbl">
                    <thead>
                      <tr>
                        <th>Дата</th>
                        <th>Тип</th>
                        <th className="pb-num">Сумма</th>
                        <th>Источник</th>
                        <th>Кто выдал</th>
                        <th>Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.operations.map((op) => {
                        const sm = sourceMeta(op.source_kind);
                        const amt = Number(op.amount || 0);
                        const isPenalty = op.type === 'penalty';
                        const showNeg = isPenalty || amt < 0;
                        const absAmt = Math.abs(amt);
                        return (
                          <tr key={op.id} className="pb-ops-row">
                            <td>{fmtDate(op.date)}</td>
                            <td>{ACCRUAL_LABELS[op.type] || op.type || '—'}</td>
                            <td className={'pb-num ' + (showNeg ? 'pb-num-neg' : '')}>
                              {showNeg ? '−' : ''}{fmtMoney(absAmt)}
                            </td>
                            <td>
                              <span className={'pb-chip pb-chip-' + sm.tone}>
                                {sm.icon} {sm.label}
                              </span>
                            </td>
                            <td>{op.paid_by_name || (op.is_from_pm_cash ? 'РП' : '—')}</td>
                            <td className="pb-ops-comment" title={op.comment || ''}>
                              {op.comment || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={handleClose}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

function PaidRow({ icon, label, value, tone }) {
  return (
    <div className="pb-row">
      <span className="pb-row-l">
        <span className={'pb-chip pb-chip-' + tone}>{icon} {label}</span>
      </span>
      <span className={'pb-row-v ' + (value > 0 ? '' : 'pb-row-v-mut')}>
        {fmtMoney(value)}
      </span>
    </div>
  );
}

function DeltaBanner({ balance }) {
  if (balance === 0) {
    return (
      <div className="pb-delta pb-delta-zero">
        ✓ Полностью закрыто — 0 ₽ к доплате
      </div>
    );
  }
  if (balance > 0) {
    return (
      <div className="pb-delta pb-delta-pos">
        ⚠ К доплате: {fmtMoney(balance)}
      </div>
    );
  }
  // balance < 0 — переплата
  return (
    <div className="pb-delta pb-delta-neg">
      ⚠ Переплата: {fmtMoney(Math.abs(balance))}
    </div>
  );
}

// Алиас для совместимости с modal.open(<PaymentBreakdown ...>)
export { PaymentBreakdown };
