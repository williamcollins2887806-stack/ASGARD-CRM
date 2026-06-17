/**
 * Создание / редактирование счёта.
 * Поля: номер (с автогенерацией), дата, контрагент, привязка к работе, сумма + НДС, описание, срок оплаты.
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field as FieldM } from '@/modals/parts';
import { TextInput, SelectInput, MoneyInput, NumberInput, TextareaInput } from '@/inputs/Inputs';
import { positiveAmountError, percentError, dateRangeError } from '@/inputs/validators';
import { toast } from '@/modals/Notifications';
import {
  createInvoice, updateInvoice, nextInvoiceNumber,
  loadCustomers, loadWorks, fmtMoney
} from './api';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:invoices:changed'));
}

export default function InvoiceEditModal({ invoice, onSaved }) {
  const { close } = useModal();
  const isEdit = !!invoice?.id;

  const [number,      setNumber]      = useState(invoice?.invoice_number || '');
  const [date,        setDate]        = useState((invoice?.invoice_date || '').slice(0, 10) || todayISO());
  const [customerId,  setCustomerId]  = useState(invoice?.customer_id ? String(invoice.customer_id) : '');
  const [customerInn, setCustomerInn] = useState(invoice?.customer_inn || '');
  const [customerName,setCustomerName]= useState(invoice?.customer_name || '');
  const [workId,      setWorkId]      = useState(invoice?.work_id ? String(invoice.work_id) : '');
  const [amount,      setAmount]      = useState(invoice?.amount != null ? String(invoice.amount) : '');
  const [vatPct,      setVatPct]      = useState(invoice?.vat_pct != null ? String(invoice.vat_pct) : '20');
  const [description, setDescription] = useState(invoice?.description || '');
  const [dueDate,     setDueDate]     = useState((invoice?.due_date || '').slice(0, 10));
  const [busy, setBusy] = useState(false);

  const [customers, setCustomers] = useState([]);
  const [works,     setWorks]     = useState([]);

  useEffect(() => {
    loadCustomers().then(setCustomers).catch(() => setCustomers([]));
    loadWorks().then(setWorks).catch(() => setWorks([]));
    if (!isEdit && !number) {
      nextInvoiceNumber().then((n) => { if (n) setNumber(n); }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Контрагенты идентифицируются по ИНН в /api/customers
  const customerOptions = useMemo(() => [
    { value: '', label: '— Не выбран —' },
    ...customers.map((c) => ({
      value: c.inn || String(c.id || ''),
      label: c.name || c.full_name || c.inn || '?'
    }))
  ], [customers]);

  const workOptions = useMemo(() => [
    { value: '', label: '— Без привязки —' },
    ...works.map((w) => ({
      value: String(w.id),
      label: (w.work_number || '#' + w.id) + ' · ' + (w.work_title || w.customer_name || '')
    }))
  ], [works]);

  const totalAmount = useMemo(() => {
    const a = Number(amount) || 0;
    const v = Number(vatPct) || 0;
    return a + (a * v) / 100;
  }, [amount, vatPct]);

  const onCustomerChange = (val) => {
    setCustomerId(val);
    const c = customers.find((c) => (c.inn || String(c.id || '')) === val);
    if (c) {
      setCustomerName(c.name || c.full_name || '');
      setCustomerInn(c.inn || '');
    }
  };

  // G-4: per-field валидация
  const fieldErrors = {
    amount: positiveAmountError(amount, 'Сумма'),
    vatPct: percentError(vatPct, 'НДС'),
    dueDate: dateRangeError(date, dueDate, { start: 'Дата счёта', end: 'Срок оплаты' })
  };
  const hasFieldErr = Object.values(fieldErrors).some(Boolean);

  const save = async () => {
    if (!date) {
      toast.warn('Укажите дату счёта');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      toast.warn('Сумма должна быть больше нуля');
      return;
    }
    if (!customerName) {
      toast.warn('Выберите контрагента');
      return;
    }
    if (fieldErrors.vatPct)  { toast.warn(fieldErrors.vatPct); return; }
    if (fieldErrors.dueDate) { toast.warn(fieldErrors.dueDate); return; }
    setBusy(true);
    const payload = {
      invoice_number: number || undefined,
      invoice_date:   date,
      customer_name:  customerName,
      customer_inn:   customerInn || undefined,
      work_id:        workId ? Number(workId) : null,
      amount:         Number(amount),
      vat_pct:        Number(vatPct),
      total_amount:   totalAmount,
      description:    description.trim() || undefined,
      due_date:       dueDate || null,
      status:         invoice?.status || 'draft'
    };
    try {
      if (isEdit) {
        await updateInvoice(invoice.id, payload);
        toast.success('Счёт обновлён');
      } else {
        await createInvoice(payload);
        toast.success('Счёт создан');
      }
      emitChanged();
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-wide">
      <MHead
        icon={isEdit ? '✎' : '➕'}
        title={isEdit ? 'Редактировать счёт' : 'Новый счёт'}
        subtitle={isEdit ? `№ ${invoice?.invoice_number || invoice?.id}` : 'Заполните поля и сохраните'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <div className="grid-2 gap-10">
            <FieldM label="Номер счёта">
              <TextInput value={number} onChange={setNumber} placeholder="СЧ-2026-001" />
            </FieldM>
            <FieldM label="Дата" required>
              <TextInput type="date" value={date} onChange={setDate} />
            </FieldM>
          </div>

          <FieldM label="Контрагент" required>
            <SelectInput value={customerId} onChange={onCustomerChange} options={customerOptions} />
          </FieldM>

          <FieldM label="Привязка к работе">
            <SelectInput value={workId} onChange={setWorkId} options={workOptions} />
          </FieldM>

          <div className="grid-2-1-1 gap-10">
            <FieldM label="Сумма (без НДС)" required error={fieldErrors.amount}>
              <MoneyInput value={amount} onChange={setAmount} />
            </FieldM>
            <FieldM label="НДС, %" error={fieldErrors.vatPct}>
              <NumberInput value={vatPct} onChange={setVatPct} min={0} max={100} />
            </FieldM>
            <FieldM label="Итого с НДС">
              <TextInput value={fmtMoney(totalAmount)} disabled readOnly />
            </FieldM>
          </div>

          <FieldM label="Срок оплаты" error={fieldErrors.dueDate}>
            <TextInput type="date" value={dueDate} onChange={setDueDate} />
          </FieldM>

          <FieldM label="Описание / примечание">
            <TextareaInput value={description} onChange={setDescription} placeholder="За что выставлен счёт" minRows={2} maxRows={6} />
          </FieldM>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy || hasFieldErr} onClick={save}>
          {busy ? 'Сохраняем…' : isEdit ? '💾 Сохранить' : '✓ Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
