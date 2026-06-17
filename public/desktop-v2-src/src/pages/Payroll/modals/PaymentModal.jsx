/**
 * PaymentModal — добавление строки начисления (рабочий + дни + ставка + премия/штраф).
 *
 * Источник vanilla: payroll.js → bindSheetHandlers → btnAddItem handler.
 *
 *  Поля:
 *   - Рабочий (employee_id, обязательно) — Combobox по справочнику
 *   - Дней + Ставка (₽/день) — автоподтягивание ставки при выборе рабочего (currentRate)
 *   - Премия / Штраф (опц.)
 *   - Аванс / Удержание / Комментарий — расширенные
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { Combobox, NumberInput, MoneyInput, TextareaInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  loadEmployees, currentRate, addItem, fmtMoney
} from '../api';

const METHODS = [
  { value: 'card',          label: '💳 На карту' },
  { value: 'cash',          label: '💵 Наличные' },
  { value: 'self_employed', label: '🪪 Самозанятый (ГПХ)' }
];

export default function PaymentModal({ sheetId, _sheetWorkId, onDone }) {
  const { close } = useModal();
  const [employees, setEmployees] = useState([]);
  const [empId, setEmpId]     = useState(null);
  const [days, setDays]       = useState(0);
  const [rate, setRate]       = useState(0);
  const [bonus, setBonus]     = useState(0);
  const [penalty, setPenalty] = useState(0);
  const [advance, setAdvance] = useState(0);
  const [deductions, setDeductions] = useState(0);
  const [penaltyReason, setPenaltyReason] = useState('');
  const [deductionsReason, setDeductionsReason] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadEmployees().then((list) => setEmployees(list.filter((e) => e.is_active !== false))).catch(() => setEmployees([]));
  }, []);

  const empOptions = useMemo(
    () => employees.map((e) => ({ value: e.id, label: e.fio || e.full_name || `Рабочий #${e.id}` })),
    [employees]
  );

  /* Автоподтягивание ставки при выборе рабочего */
  useEffect(() => {
    if (!empId) return;
    let cancelled = false;
    currentRate(empId).then((r) => {
      if (cancelled) return;
      if (r?.day_rate) {
        setRate(Number(r.day_rate) || 0);
      } else {
        const e = employees.find((x) => x.id === empId);
        if (e?.day_rate) setRate(Number(e.day_rate) || 0);
      }
    });
    return () => { cancelled = true; };
  }, [empId, employees]);

  /* Локальный пересчёт для предпросмотра */
  const preview = useMemo(() => {
    const d = Number(days) || 0;
    const r = Number(rate) || 0;
    const b = Number(bonus) || 0;
    const p = Number(penalty) || 0;
    const a = Number(advance) || 0;
    const dd = Number(deductions) || 0;
    const base = d * r;
    const accrued = base + b;
    const payout = Math.max(0, accrued - p - a - dd);
    return { base, accrued, payout };
  }, [days, rate, bonus, penalty, advance, deductions]);

  const submit = async () => {
    if (!empId) { toast.error('Выберите рабочего'); return; }
    if (!Number(days) && !Number(bonus)) { toast.warn('Укажите дни или премию'); return; }
    setSubmitting(true);
    try {
      await addItem({
        sheet_id: Number(sheetId),
        employee_id: Number(empId),
        days_worked: Number(days) || 0,
        day_rate: Number(rate) || 0,
        bonus: Number(bonus) || 0,
        penalty: Number(penalty) || 0,
        penalty_reason: penaltyReason || null,
        advance_paid: Number(advance) || 0,
        deductions: Number(deductions) || 0,
        deductions_reason: deductionsReason || null,
        payment_method: paymentMethod,
        comment: comment || null
      });
      toast.success('Строка добавлена', { title: fmtMoney(preview.payout) });
      window.dispatchEvent(new CustomEvent('asgard:payroll:changed'));
      onDone?.();
      close();
    } catch (e) {
      toast.error(String(e?.message || e));
      setSubmitting(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="➕" title="Добавить начисление" subtitle="Рабочий, дни, ставка, премии/штрафы" accent="gold" onClose={close} />
      <MBody>
        <Field label="Рабочий" required>
          <Combobox
            options={empOptions}
            value={empId}
            onChange={setEmpId}
            placeholder="Начните вводить ФИО…"
          />
        </Field>

        <div className="m-grid-2 mt-10">
          <Field label="Дней">
            <NumberInput value={days} onChange={setDays} min={0} max={31} />
          </Field>
          <Field label="Ставка (₽/день)">
            <MoneyInput value={rate} onChange={setRate} />
          </Field>
        </div>

        <div className="m-grid-2 mt-10">
          <Field label="Премия (₽)">
            <MoneyInput value={bonus} onChange={setBonus} />
          </Field>
          <Field label="Штраф (₽)">
            <MoneyInput value={penalty} onChange={setPenalty} />
          </Field>
        </div>

        {Number(penalty) > 0 && (
          <Field label="Причина штрафа">
            <TextareaInput value={penaltyReason} onChange={setPenaltyReason} minRows={1} maxRows={3} />
          </Field>
        )}

        <div className="m-grid-2 mt-10">
          <Field label="Аванс (₽)">
            <MoneyInput value={advance} onChange={setAdvance} />
          </Field>
          <Field label="Удержание (₽)">
            <MoneyInput value={deductions} onChange={setDeductions} />
          </Field>
        </div>

        {Number(deductions) > 0 && (
          <Field label="Причина удержания">
            <TextareaInput value={deductionsReason} onChange={setDeductionsReason} minRows={1} maxRows={3} />
          </Field>
        )}

        <Field label="Способ выплаты">
          <SelectInput value={paymentMethod} onChange={setPaymentMethod} options={METHODS} />
        </Field>

        <Field label="Комментарий">
          <TextareaInput value={comment} onChange={setComment} minRows={1} maxRows={4} placeholder="Необязательно" />
        </Field>

        {/* Предпросмотр итогов */}
        <div style={{
          marginTop: 14,
          padding: 12,
          background: 'var(--inner-bg)',
          borderRadius: 'var(--r-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10
        }}>
          <PreviewKV label="База" value={fmtMoney(preview.base)} />
          <PreviewKV label="Начислено" value={fmtMoney(preview.accrued)} tone="info" />
          <PreviewKV label="К выплате" value={fmtMoney(preview.payout)} tone="gold" />
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={submitting} onClick={submit}>
          {submitting ? '…' : 'Добавить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function PreviewKV({ label, value, tone }) {
  return (
    <div className="t-center">
      <div style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--t-3)', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: tone === 'gold' ? 'var(--gold)' : tone === 'info' ? 'var(--info)' : 'var(--t-1)' }}>{value}</div>
    </div>
  );
}
