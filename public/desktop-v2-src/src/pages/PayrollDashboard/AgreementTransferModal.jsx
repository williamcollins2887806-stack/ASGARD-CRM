/**
 * Модалка «Перевод по договорённости» (agreement_transfer).
 * Источник vanilla: payroll_dashboard.js → $('#pd_add_agreement').
 */
import { useEffect, useMemo, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { Combobox, MoneyInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { getSelfEmployedLimits, createSeTransfer, fmtMoney } from './api';

export function AgreementTransferModal({ year, month, onDone }) {
  const { close } = useModal();
  const [list, setList] = useState([]);
  const [monthlyLimit, setMonthlyLimit] = useState(350000);
  const [yearlyLimit, setYearlyLimit] = useState(2400000);
  const [empId, setEmpId] = useState(null);
  const [amount, setAmount] = useState('350000');
  const [comment, setComment] = useState('По договорённости');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSelfEmployedLimits()
      .then((d) => {
        const arr = d.employees || d.limits || d || [];
        // На бэке поле — `transferred_year`, у некоторых эндпоинтов — `yearly_transferred`.
        const normalized = arr.map((w) => ({
          ...w,
          employee_id: w.employee_id ?? w.id,
          fio: w.fio || w.name || '—',
          transferred_year: Number(w.transferred_year ?? w.yearly_transferred ?? 0),
          yearly_limit: Number(w.yearly_limit ?? d.yearly_limit ?? 2400000),
          remaining: Number(w.remaining ?? ((w.yearly_limit ?? d.yearly_limit ?? 2400000) - (w.transferred_year ?? w.yearly_transferred ?? 0)))
        }));
        setList(normalized);
        if (d.monthly_limit) setMonthlyLimit(Number(d.monthly_limit));
        if (d.yearly_limit) setYearlyLimit(Number(d.yearly_limit));
        if (d.monthly_limit) setAmount(String(d.monthly_limit));
      })
      .catch(() => toast.error('Не удалось загрузить лимиты'));
    // eslint-disable-next-line
  }, []);

  const options = useMemo(
    () => list.map((w) => ({
      value: w.employee_id,
      label: `${w.fio} · остаток ${fmtMoney(w.remaining)}`
    })),
    [list]
  );

  const submit = async () => {
    if (!empId) { toast.error('Выберите рабочего'); return; }
    const n = Number(amount);
    if (!n || n <= 0) { toast.error('Укажите сумму > 0'); return; }
    setBusy(true);
    try {
      await createSeTransfer({
        employee_id: Number(empId),
        year, month,
        operation_type: 'agreement_transfer',
        transfer_amount: n,
        earned_amount: 0,
        work_id: null,
        comment: comment.trim() || 'По договорённости'
      });
      toast.success('Перевод создан');
      onDone?.();
      close();
    } catch (e) {
      toast.error(e?.message || 'Не удалось создать перевод');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="🤝" title="Перевод по договорённости" subtitle={`Период: ${month}/${year}`} accent="gold" onClose={close} />
      <MBody>
        <Field label="Рабочий (самозанятый)" required>
          <Combobox
            options={options}
            value={empId}
            onChange={setEmpId}
            placeholder="Начните вводить ФИО…"
          />
        </Field>

        <div className="m-grid-2 mt-10">
          <Field label="Сумма перевода (₽)" required help={`Месячный лимит: ${fmtMoney(monthlyLimit)} · Годовой: ${fmtMoney(yearlyLimit)}`}>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Комментарий">
            <TextareaInput value={comment} onChange={setComment} placeholder="По договорённости" minRows={2} maxRows={4} />
          </Field>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? '…' : 'Создать перевод'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
