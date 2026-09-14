/**
 * Внести уже существующий счёт/акт (без конструктора) — реестр входящих документов.
 */
import { useEffect, useMemo, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, SelectInput, MoneyInput, NumberInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import {
  createInvoice, createAct, nextInvoiceNumber, nextActNumber,
  loadWorks, fmtMoney, todayISO, emitChanged, VAT_DEFAULT_PCT
} from './api';

export function RegisterModal({ kind = 'invoice', onSaved }) {
  const { close } = useModal();
  const isAct = kind === 'act';
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(todayISO());
  const [customerName, setCustomerName] = useState('');
  const [customerInn, setCustomerInn] = useState('');
  const [workId, setWorkId] = useState('');
  const [amount, setAmount] = useState('');
  const [vatPct, setVatPct] = useState(String(VAT_DEFAULT_PCT));
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [works, setWorks] = useState([]);
  const [customers, setCustomers] = useState([]);

  useEffect(() => {
    loadWorks().then(setWorks).catch(() => setWorks([]));
    api('/api/customers?limit=400').then((d) => setCustomers(d.customers || d.items || [])).catch(() => setCustomers([]));
    (isAct ? nextActNumber : nextInvoiceNumber)().then((n) => { if (n) setNumber(n); }).catch(() => {});
  }, [isAct]);

  const workOptions = useMemo(() => [
    { value: '', label: '— Без привязки —' },
    ...works.map((w) => ({
      value: String(w.id),
      label: (w.work_number || '#' + w.id) + ' · ' + (w.work_title || w.customer_name || '')
    }))
  ], [works]);

  const customerOptions = useMemo(() => [
    { value: '', label: '— Ввести вручную —' },
    ...customers.map((c) => ({
      value: c.name || c.full_name,
      label: `${c.name || c.full_name}${c.inn ? ' · ' + c.inn : ''}`,
      inn: c.inn
    }))
  ], [customers]);

  const total = useMemo(() => {
    const a = Number(amount) || 0;
    const v = Number(vatPct) || 0;
    return a + (a * v) / 100;
  }, [amount, vatPct]);

  const save = async () => {
    if (!date) return toast.warn('Укажите дату');
    if (!customerName) return toast.warn('Укажите контрагента');
    if (!amount || Number(amount) <= 0) return toast.warn('Сумма должна быть больше нуля');
    setBusy(true);
    try {
      if (isAct) {
        await createAct({
          act_number: number || undefined,
          act_date: date,
          customer_name: customerName,
          customer_inn: customerInn || undefined,
          work_id: workId ? Number(workId) : null,
          amount: Number(amount),
          vat_pct: Number(vatPct),
          total_amount: total,
          description: description.trim() || undefined,
          status: 'signed',
          act_type: 'registered'
        });
        toast.success('Акт внесён');
      } else {
        await createInvoice({
          invoice_number: number || undefined,
          invoice_date: date,
          customer_name: customerName,
          customer_inn: customerInn || undefined,
          work_id: workId ? Number(workId) : null,
          amount: Number(amount),
          vat_pct: Number(vatPct),
          total_amount: total,
          description: description.trim() || undefined,
          due_date: dueDate || null,
          status: 'pending',
          invoice_type: 'incoming'
        });
        toast.success('Счёт внесён');
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
        icon="📥"
        title={isAct ? 'Внести акт' : 'Внести счёт'}
        subtitle="Если документ уже выставлен на бумаге / в 1С — просто зафиксируйте его в CRM"
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <div className="bill-grid-2">
            <Field label="Номер"><TextInput value={number} onChange={setNumber} /></Field>
            <Field label="Дата" required><TextInput type="date" value={date} onChange={setDate} /></Field>
          </div>
          <Field label="Контрагент" required>
            <SelectInput
              value={customerName}
              onChange={(v) => {
                setCustomerName(v);
                const c = customers.find((x) => (x.name || x.full_name) === v);
                if (c?.inn) setCustomerInn(c.inn);
              }}
              options={customerOptions}
            />
          </Field>
          {!customerOptions.some((o) => o.value === customerName) && (
            <Field label="Название вручную">
              <TextInput value={customerName} onChange={setCustomerName} placeholder="ООО «Заказчик»" />
            </Field>
          )}
          <Field label="ИНН"><TextInput value={customerInn} onChange={setCustomerInn} /></Field>
          <Field label="Работа">
            <SelectInput
              value={workId}
              onChange={(v) => {
                setWorkId(v);
                const w = works.find((x) => String(x.id) === String(v));
                if (w) {
                  if (w.customer_name) setCustomerName(w.customer_name);
                  if (w.customer_inn) setCustomerInn(w.customer_inn);
                }
              }}
              options={workOptions}
            />
          </Field>
          <div className="bill-grid-3">
            <Field label="Сумма без НДС" required><MoneyInput value={amount} onChange={setAmount} /></Field>
            <Field label="НДС, %"><NumberInput value={vatPct} onChange={setVatPct} min={0} max={100} /></Field>
            <Field label="Итого"><TextInput value={fmtMoney(total)} disabled readOnly /></Field>
          </div>
          {!isAct && (
            <Field label="Срок оплаты"><TextInput type="date" value={dueDate} onChange={setDueDate} /></Field>
          )}
          <Field label="Описание">
            <TextareaInput value={description} onChange={setDescription} minRows={2} maxRows={5} />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Внести в реестр'}</Btn>
      </MFoot>
    </MCard>
  );
}
