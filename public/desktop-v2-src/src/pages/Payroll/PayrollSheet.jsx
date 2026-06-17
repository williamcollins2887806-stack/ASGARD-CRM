/**
 * PayrollSheet — карточка одной ведомости: рабочие + операции + итого.
 *
 * Источник vanilla: payroll.js → renderSheet (~370 строк) и bindSheetHandlers.
 *
 *  Что покрыто:
 *   - GET /api/payroll/sheets/:id — детали + items + payments
 *   - KPI: Начислено / Премии / Удержания / К выплате / Рабочих / Ср.ставка
 *   - Inline-редактирование (days_worked, day_rate, bonus, penalty, advance_paid) с дебаунсом 800мс
 *   - PaymentModal: добавление строки начисления (через `addItem`)
 *   - btnAutoFill: автозаполнение всех assignment-ов работы (POST /api/payroll/items/auto-fill)
 *   - btnRecalc: пересчёт всех item.payout = base+bonus-penalty-advance (POST /items/recalc)
 *   - btnSubmit (status=draft|rework → pending) с уведомлениями директорам
 *   - btnApprove (директор) / btnRework (PromptModal с причиной) → uses ConfirmModal/PromptModal
 *   - btnPay (BUH/директор) → SheetCloseModal
 *   - btnDeleteSheet (status=draft) → ConfirmModal danger
 *   - btnExport → ExportModal
 *   - badge директорского комментария при rework/draft
 *   - удаление строки через ConfirmModal
 *   - назад к /payroll
 */
import { useEffect, useMemo, useState, useRef } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal, PromptModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import {
  loadSheet, deleteSheet, submitSheet, approveSheet, reworkSheet,
  autoFillItems, recalcItems, updateItem, deleteItem,
  fmtMoney, fmtDate, statusMeta,
  canApprove, canPay, hasAccess
} from './api';
import PaymentModal     from './modals/PaymentModal';
import SheetCloseModal  from './modals/SheetCloseModal';
import ExportModal      from './modals/ExportModal';
import './payroll.css';

export default function PayrollSheet({ sheetId, onClose }) {
  const { user } = useAuth();
  const modal   = useModal();

  const [sheet,    setSheet]    = useState(null);
  const [items,    setItems]    = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading,  setLoading]  = useState(true);

  const refresh = async () => {
    if (!sheetId) return;
    setLoading(true);
    try {
      const r = await loadSheet(sheetId);
      setSheet(r.sheet || null);
      setItems(r.items || []);
      setPayments(r.payments || []);
    } catch (e) {
      toast.error('Не удалось загрузить ведомость: ' + (e?.message || e));
      setSheet(null);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [sheetId]);

  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('asgard:payroll:changed', h);
    return () => window.removeEventListener('asgard:payroll:changed', h);
    // eslint-disable-next-line
  }, [sheetId]);

  const totals = useMemo(() => {
    const total_accrued      = items.reduce((s, x) => s + Number(x.accrued || 0), 0);
    const total_bonus        = items.reduce((s, x) => s + Number(x.bonus   || 0), 0);
    const total_penalty      = items.reduce((s, x) => s + Number(x.penalty || 0) + Number(x.deductions || 0), 0);
    const total_advance_paid = items.reduce((s, x) => s + Number(x.advance_paid || 0), 0);
    const total_payout       = items.reduce((s, x) => s + Number(x.payout  || 0), 0);
    const avgRate            = items.length ? Math.round(items.reduce((s, x) => s + Number(x.day_rate || 0), 0) / items.length) : 0;
    return { total_accrued, total_bonus, total_penalty, total_advance_paid, total_payout, avgRate };
  }, [items]);

  /* RBAC */
  if (!hasAccess(user?.role)) {
    return (
      <div className="card pyd-access-locked">
        <div className="pyd-locked-icon">🔒</div>
        <div className="pyd-locked-title">Доступ закрыт</div>
        <div className="c-t3">Раздел зарплаты доступен директорам, бухгалтерии и руководителям проектов.</div>
      </div>
    );
  }

  if (loading) {
    return <div className="card card-loader">⏳ Грузим ведомость…</div>;
  }
  if (!sheet) {
    return (
      <div className="card p-24">
        <div className="mb-10">Ведомость не найдена.</div>
        <Btn variant="ghost" onClick={onClose}>← Назад к списку</Btn>
      </div>
    );
  }

  const isEditable = sheet.status === 'draft' || sheet.status === 'rework';
  const isMine     = sheet.created_by === user.id || sheet.pm_id === user.id;
  const isPm       = user.role === 'PM' || user.role === 'HEAD_PM';
  const isDir      = canApprove(user.role);
  const canEdit    = isEditable && (!isPm || isMine);
  const canPayOk   = sheet.status === 'approved' && canPay(user.role);
  const sMeta      = statusMeta(sheet.status);

  const workLabel = sheet.work_title
    ? `${sheet.customer_name || ''}${sheet.customer_name && sheet.work_title ? ' — ' : ''}${sheet.work_title}`
    : 'Общая';

  /* ─ Действия ─ */
  const onAddItem = () => modal.open(<PaymentModal sheetId={sheet.id} sheetWorkId={sheet.work_id} onDone={refresh} />, { size: 'wide' });

  const onAutoFill = async () => {
    if (!sheet.work_id) { toast.warn('Автозаполнение доступно только для ведомостей с привязкой к работе'); return; }
    try {
      const r = await autoFillItems(sheet.id);
      toast.success('Автозаполнение', { title: `Добавлено ${r.filled}, пропущено ${r.skipped}` });
      refresh();
    } catch (e) { toast.error(String(e?.message || e)); }
  };

  const onRecalc = async () => {
    try {
      await recalcItems(sheet.id);
      toast.success('Пересчитано');
      refresh();
    } catch (e) { toast.error(String(e?.message || e)); }
  };

  const onSubmit = () => {
    if (!items.length) { toast.warn('Добавьте строки начислений'); return; }
    modal.open(
      <ConfirmModal
        title="Отправить на согласование?"
        message={`«${sheet.title}» → пойдёт директорам. К выплате: ${fmtMoney(totals.total_payout)}.`}
        tone="gold"
        okText="📤 Отправить"
        onConfirm={async () => {
          try {
            await submitSheet(sheet.id);
            toast.success('Отправлено на согласование');
            window.dispatchEvent(new CustomEvent('asgard:payroll:changed'));
            refresh();
          } catch (e) { toast.error(String(e?.message || e)); }
        }}
      />
    );
  };

  const onApprove = () => {
    modal.open(
      <ConfirmModal
        title="Согласовать ведомость?"
        message={`Сумма к выплате: ${fmtMoney(totals.total_payout)} (${items.length} рабочих).`}
        tone="success"
        okText="✓ Согласовать"
        onConfirm={async () => {
          try {
            await approveSheet(sheet.id);
            toast.success('Согласовано');
            window.dispatchEvent(new CustomEvent('asgard:payroll:changed'));
            refresh();
          } catch (e) { toast.error(String(e?.message || e)); }
        }}
      />
    );
  };

  const onRework = () => {
    modal.open(
      <PromptModal
        title="На доработку"
        subtitle={sheet.title}
        label="Комментарий для РП"
        placeholder="Что нужно исправить…"
        multiline
        required
        accent="warn"
        icon="↻"
        okText="↻ Вернуть"
        onSubmit={async (comment) => {
          try {
            await reworkSheet(sheet.id, comment);
            toast.success('Возвращено на доработку');
            window.dispatchEvent(new CustomEvent('asgard:payroll:changed'));
            refresh();
          } catch (e) { toast.error(String(e?.message || e)); }
        }}
      />,
      { size: 'center' }
    );
  };

  const onPayConfirm = () => modal.open(<SheetCloseModal sheet={sheet} totals={totals} onDone={refresh} />, { size: 'wide' });

  const onExport = () => modal.open(<ExportModal sheetId={sheet.id} sheet={sheet} defaultMode="payments" />);

  const onDeleteSheet = () => {
    modal.open(
      <ConfirmModal
        title="Удалить ведомость?"
        message="Все строки начислений будут удалены. Это действие необратимо."
        tone="danger"
        okText="🗑 Удалить"
        onConfirm={async () => {
          try {
            await deleteSheet(sheet.id);
            toast.success('Ведомость удалена');
            window.dispatchEvent(new CustomEvent('asgard:payroll:changed'));
            onClose?.();
          } catch (e) { toast.error(String(e?.message || e)); }
        }}
      />
    );
  };

  /* ─ Шапка ─ */
  const actions = (
    <>
      {canEdit && (
        <>
          {sheet.work_id && <Btn variant="ghost" onClick={onAutoFill}>⚡ Автозаполнение</Btn>}
          <Btn variant="ghost"   onClick={onRecalc}>↻ Пересчитать</Btn>
          <Btn variant="primary" onClick={onSubmit}>📤 На согласование</Btn>
          {sheet.status === 'draft' && <Btn variant="danger" onClick={onDeleteSheet}>🗑 Удалить</Btn>}
        </>
      )}
      {sheet.status === 'pending' && isDir && (
        <>
          <Btn variant="success" onClick={onApprove}>✓ Согласовать</Btn>
          <Btn variant="warn"    onClick={onRework}>↻ На доработку</Btn>
        </>
      )}
      {canPayOk && <Btn variant="primary" onClick={onPayConfirm}>💰 Оплачено</Btn>}
      {(sheet.status === 'approved' || sheet.status === 'paid') && (
        <Btn variant="ghost" onClick={onExport}>📥 Excel</Btn>
      )}
      <Btn variant="ghost" onClick={onClose}>← К списку</Btn>
    </>
  );

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Ведомость"
        title={sheet.title || `Ведомость #${sheet.id}`}
        subtitle={
          <>
            <StatusBadge tone={sMeta.tone} label={sMeta.label} /> · {fmtDate(sheet.period_from)} — {fmtDate(sheet.period_to)} · <b>{workLabel}</b>
            {sheet.creator_name && <> · РП: {sheet.creator_name}</>}
            {sheet.approver_name && <> · Согл-л: {sheet.approver_name}</>}
          </>
        }
        actions={actions}
      />

      {/* Директорский комментарий */}
      {sheet.director_comment && (sheet.status === 'rework' || sheet.status === 'draft') && (
        <div className="card pyr-director-comment">
          <div className="pyr-eyebrow">Комментарий директора</div>
          <div className="fs-14 c-t1">{sheet.director_comment}</div>
        </div>
      )}

      {/* KPI */}
      <div className="grid-auto-150 gap-10">
        <KpiCell label="Начислено"  value={fmtMoney(totals.total_accrued)} />
        <KpiCell label="Премии"     value={fmtMoney(totals.total_bonus)}   tone="info" />
        <KpiCell label="Удержания"  value={fmtMoney(totals.total_penalty)} tone="err" />
        <KpiCell label="Авансы"     value={fmtMoney(totals.total_advance_paid)} tone="amber" />
        <KpiCell label="К выплате"  value={fmtMoney(totals.total_payout)}  tone="gold" />
        <KpiCell label="Рабочих"    value={items.length} />
        <KpiCell label="Ср. ставка" value={`${fmtMoney(totals.avgRate)}/д`} />
      </div>

      {/* Таблица начислений */}
      <div className="card p-0">
        <div className="pyr-sheet-head">
          <h3 className="m-0 fs-16">Начисления</h3>
          {canEdit && <Btn variant="primary" size="sm" onClick={onAddItem}>＋ Добавить</Btn>}
        </div>

        {items.length === 0 ? (
          <div className="pyr-empty-text">
            Нет начислений. {canEdit && 'Нажмите «＋ Добавить» или «⚡ Автозаполнение».'}
          </div>
        ) : (
          <div className="pyr-table-wrap">
            <table className="pyr-table">
              <thead>
                <tr className="bg-inner">
                  <th className="pyr-table-th">№</th>
                  <th className="pyr-table-th pyr-table-th--left">ФИО</th>
                  <th className="pyr-table-th">Дней</th>
                  <th className="pyr-table-th">Ставка</th>
                  <th className="pyr-table-th">Начисл.</th>
                  <th className="pyr-table-th">Премия</th>
                  <th className="pyr-table-th">Штраф</th>
                  <th className="pyr-table-th">Аванс</th>
                  <th className="pyr-table-th pyr-table-th--gold">К выпл.</th>
                  <th className="pyr-table-th"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    idx={idx}
                    editable={canEdit}
                    onUpdated={(patch) => {
                      setItems((arr) => arr.map((x) => x.id === item.id ? { ...x, ...patch } : x));
                    }}
                    onDeleted={refresh}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="pyr-tf-row">
                  <td className="pyr-tf-td" />
                  <td className="pyr-tf-td fw-800">ИТОГО</td>
                  <td className="pyr-tf-td" />
                  <td className="pyr-tf-td" />
                  <td className="pyr-tf-td pyr-tf-td--r">{fmtMoney(totals.total_accrued)}</td>
                  <td className="pyr-tf-td pyr-tf-td--r">{fmtMoney(totals.total_bonus)}</td>
                  <td className="pyr-tf-td pyr-tf-td--r">{fmtMoney(totals.total_penalty)}</td>
                  <td className="pyr-tf-td pyr-tf-td--r">{fmtMoney(totals.total_advance_paid)}</td>
                  <td className="pyr-tf-td pyr-tf-td--r">{fmtMoney(totals.total_payout)}</td>
                  <td className="pyr-tf-td" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Реестр выплат (если есть) */}
      {payments.length > 0 && (
        <div className="card p-14">
          <h3 className="mt-0 fs-16">Реестр выплат ({payments.length})</h3>
          <div className="col gap-6 fs-13">
            {payments.map((p) => (
              <div key={p.id} className="pyr-pay-row">
                <span className="flex-1">{p.employee_name || `#${p.employee_id}`}</span>
                <Pill>{p.payment_type || 'salary'}</Pill>
                <span className="fw-700 c-gold pyr-pay-amt">{fmtMoney(p.amount)}</span>
                <StatusBadge tone={p.status === 'paid' ? 'paid' : p.status === 'cancelled' ? 'draft' : 'sent'} label={p.status || '—'} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Общий комментарий ведомости */}
      {sheet.comment && (
        <div className="card p-14">
          <div className="pyr-eyebrow mb-4">Комментарий</div>
          <div className="fs-14 c-t1">{sheet.comment}</div>
        </div>
      )}
    </div>
  );
}

/* ─── Строка с inline-редактированием ─── */
function ItemRow({ item, idx, editable, onUpdated, onDeleted }) {
  const modal = useModal();
  const [days,     setDays]     = useState(item.days_worked || 0);
  const [rate,     setRate]     = useState(item.day_rate    || 0);
  const [bonus,    setBonus]    = useState(item.bonus       || 0);
  const [penalty,  setPenalty]  = useState(item.penalty     || 0);
  const [advance,  setAdvance]  = useState(item.advance_paid || 0);
  const timer = useRef(null);

  /* sync при refresh снаружи */
  useEffect(() => {
    setDays(item.days_worked || 0);
    setRate(item.day_rate || 0);
    setBonus(item.bonus || 0);
    setPenalty(item.penalty || 0);
    setAdvance(item.advance_paid || 0);
  }, [item.days_worked, item.day_rate, item.bonus, item.penalty, item.advance_paid]);

  const base    = (Number(days) || 0) * (Number(rate) || 0);
  const accrued = base + (Number(bonus) || 0);
  const payout  = Math.max(0, accrued - (Number(penalty) || 0) - (Number(advance) || 0) - (Number(item.deductions) || 0));

  const persist = (patch) => {
    if (!editable) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await updateItem(item.id, {
          days_worked: Number(days) || 0,
          day_rate:    Number(rate) || 0,
          bonus:       Number(bonus) || 0,
          penalty:     Number(penalty) || 0,
          advance_paid: Number(advance) || 0,
          ...patch
        });
        onUpdated?.({
          days_worked: r.item?.days_worked, day_rate: r.item?.day_rate,
          bonus: r.item?.bonus, penalty: r.item?.penalty, advance_paid: r.item?.advance_paid,
          accrued: r.item?.accrued, base_amount: r.item?.base_amount, payout: r.item?.payout
        });
      } catch (e) { toast.error('Не удалось сохранить: ' + (e?.message || e)); }
    }, 800);
  };

  const onDelete = () => {
    modal.open(
      <ConfirmModal
        title="Удалить строку?"
        message={`${item.employee_name || item.emp_fio || '—'} · ${fmtMoney(item.payout)}`}
        tone="danger"
        okText="🗑 Удалить"
        onConfirm={async () => {
          try {
            await deleteItem(item.id);
            toast.success('Строка удалена');
            onDeleted?.();
          } catch (e) { toast.error(String(e?.message || e)); }
        }}
      />
    );
  };

  const se = item.is_self_employed || item.emp_se;

  return (
    <tr className="brd-bar-b-row">
      <td className="pyr-table-td">{idx + 1}</td>
      <td className="pyr-table-td pyr-table-td--left">
        <div className="fw-700">
          {item.employee_name || item.emp_fio || '—'}
          {se && <span className="badge-se">СЗ</span>}
        </div>
        {item.role_on_work && <div className="fs-11 c-t3 mt-2">{item.role_on_work}</div>}
      </td>
      <td className="pyr-table-td">{editable ? <InlineNumber value={days} onChange={(v) => { setDays(v); persist(); }} max={31} min={0} /> : (item.days_worked || 0)}</td>
      <td className="pyr-table-td">{editable ? <InlineNumber value={rate} onChange={(v) => { setRate(v); persist(); }} min={0} step={100} wide /> : fmtMoney(item.day_rate)}</td>
      <td className="pyr-table-td pyr-table-td--rt-3">{fmtMoney(editable ? base : item.base_amount)}</td>
      <td className="pyr-table-td">{editable ? <InlineNumber value={bonus} onChange={(v) => { setBonus(v); persist(); }} min={0} step={100} /> : fmtMoney(item.bonus)}</td>
      <td className="pyr-table-td">{editable ? <InlineNumber value={penalty} onChange={(v) => { setPenalty(v); persist(); }} min={0} step={100} /> : fmtMoney(item.penalty)}</td>
      <td className="pyr-table-td">{editable ? <InlineNumber value={advance} onChange={(v) => { setAdvance(v); persist(); }} min={0} step={100} /> : fmtMoney(item.advance_paid)}</td>
      <td className="pyr-table-td pyr-table-td--rgold">{fmtMoney(editable ? payout : item.payout)}</td>
      <td className="pyr-table-td">
        {editable && (
          <button onClick={onDelete} className="pyr-del-btn">✕</button>
        )}
      </td>
    </tr>
  );
}

function InlineNumber({ value, onChange, min, max, step = 1, wide }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      min={min}
      max={max}
      step={step}
      className={`pyr-inline-num ${wide ? 'pyr-inline-num--80' : 'pyr-inline-num--60'}`}
    />
  );
}

function KpiCell({ label, value, tone }) {
  const c = tone === 'gold' ? 'c-gold' : tone === 'info' ? 'c-info' : tone === 'err' ? 'c-err' : tone === 'amber' ? 'c-amber' : 'c-t1';
  return (
    <div className="card pyr-kpi-cell">
      <div className="pyr-kpi-cell-label">{label}</div>
      <div className={`pyr-kpi-cell-value ${c}`}>{value}</div>
    </div>
  );
}
