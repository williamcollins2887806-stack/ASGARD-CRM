/**
 * Создание / редактирование акта выполненных работ.
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field as FieldM } from '@/modals/parts';
import { TextInput, SelectInput, MoneyInput, NumberInput, TextareaInput } from '@/inputs/Inputs';
import { positiveAmountError, percentError, dateRangeError } from '@/inputs/validators';
import { toast } from '@/modals/Notifications';
import {
  createAct, updateAct, nextActNumber,
  loadCustomers, loadWorks, fmtMoney
} from './api';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:acts:changed'));
}

export default function ActEditModal({ act, onSaved }) {
  const { close } = useModal();
  const isEdit = !!act?.id;

  const [number,      setNumber]      = useState(act?.act_number || '');
  const [date,        setDate]        = useState((act?.act_date || '').slice(0, 10) || todayISO());
  const [customerId,  setCustomerId]  = useState(act?.customer_id ? String(act.customer_id) : '');
  const [customerInn, setCustomerInn] = useState(act?.customer_inn || '');
  const [customerName,setCustomerName]= useState(act?.customer_name || '');
  const [workId,      setWorkId]      = useState(act?.work_id ? String(act.work_id) : '');
  const [amount,      setAmount]      = useState(act?.amount != null ? String(act.amount) : '');
  const [vatPct,      setVatPct]      = useState(act?.vat_pct != null ? String(act.vat_pct) : '20');
  const [description, setDescription] = useState(act?.description || '');
  const [signedDate,  setSignedDate]  = useState((act?.signed_date || '').slice(0, 10));
  const [busy, setBusy] = useState(false);

  const [customers, setCustomers] = useState([]);
  const [works,     setWorks]     = useState([]);

  useEffect(() => {
    loadCustomers().then(setCustomers).catch(() => setCustomers([]));
    loadWorks().then(setWorks).catch(() => setWorks([]));
    if (!isEdit && !number) {
      nextActNumber().then((n) => { if (n) setNumber(n); }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    signedDate: dateRangeError(date, signedDate, { start: 'Дата акта', end: 'Дата подписания' })
  };
  const hasFieldErr = Object.values(fieldErrors).some(Boolean);

  const save = async () => {
    if (!date) return toast.warn('Укажите дату акта');
    if (!amount || Number(amount) <= 0) return toast.warn('Сумма должна быть больше нуля');
    if (!customerName) return toast.warn('Выберите контрагента');
    if (fieldErrors.vatPct)     return toast.warn(fieldErrors.vatPct);
    if (fieldErrors.signedDate) return toast.warn(fieldErrors.signedDate);

    setBusy(true);
    const payload = {
      act_number:    number || undefined,
      act_date:      date,
      customer_name: customerName,
      customer_inn:  customerInn || undefined,
      work_id:       workId ? Number(workId) : null,
      amount:        Number(amount),
      vat_pct:       Number(vatPct),
      total_amount:  totalAmount,
      description:   description.trim() || undefined,
      signed_date:   signedDate || null,
      status:        act?.status || 'draft'
    };
    try {
      if (isEdit) {
        await updateAct(act.id, payload);
        toast.success('Акт обновлён');
      } else {
        await createAct(payload);
        toast.success('Акт создан');
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
        title={isEdit ? 'Редактировать акт' : 'Новый акт'}
        subtitle={isEdit ? `№ ${act?.act_number || act?.id}` : 'Заполните поля и сохраните'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <div className="grid-2 gap-10">
            <FieldM label="Номер акта">
              <TextInput value={number} onChange={setNumber} placeholder="АКТ-2026-001" />
            </FieldM>
            <FieldM label="Дата акта" required>
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

          <FieldM label="Дата подписания" error={fieldErrors.signedDate}>
            <TextInput type="date" value={signedDate} onChange={setSignedDate} />
          </FieldM>

          <FieldM label="Наименование работ / описание">
            <TextareaInput value={description} onChange={setDescription} placeholder="Что выполнено по акту" minRows={2} maxRows={6} />
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
