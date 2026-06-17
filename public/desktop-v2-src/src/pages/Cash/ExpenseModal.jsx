/**
 * ExpenseModal — добавить расход (с чеком, multipart upload).
 * Источник: vanilla cash.js → showExpenseModal/submitExpense.
 */
import { useState, useRef } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, MoneyInput, SelectInput } from '@/inputs/Inputs';
import { addExpense, EXPENSE_CATEGORIES } from './api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

export default function ExpenseModal({ requestId, onSaved }) {
  const { close } = useModal();
  const fileRef = useRef(null);

  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0].value);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [fileLabel, setFileLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    setFileLabel(f ? `${f.name} (${(f.size / 1024).toFixed(0)} КБ)` : '');
  };

  const onSubmit = async () => {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.warn('Сумма должна быть больше 0');
      return;
    }
    if (!description.trim()) {
      toast.warn('Укажите описание расхода');
      return;
    }
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.warn('Прикрепите чек (фото или PDF)');
      return;
    }
    // G-5: client-side проверка размера/типа — раньше ловили 413/415 от бэка.
    try {
      validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: 'image/*,.pdf' });
    } catch (e) {
      toast.warn(e?.message || 'Файл не подходит');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('amount', String(amt));
      fd.append('description', description.trim());
      fd.append('category', category);
      if (expenseDate) fd.append('expense_date', expenseDate);
      fd.append('receipt', file);
      await addExpense(requestId, fd);
      toast.success('Расход добавлен');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось добавить: ' + (e?.message || e));
      setBusy(false);
    }
  };

  const catOpts = EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: `${c.icon} ${c.label}` }));

  return (
    <MCard>
      <MHead icon="💵" title="Добавить расход" subtitle="Касса" accent="default" onClose={close} />
      <MBody>
        <Field label="Категория" required>
          <SelectInput value={category} onChange={setCategory} options={catOpts} />
        </Field>

        <Field label="Сумма" required>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>

        <Field label="За что потрачено" required>
          <TextInput value={description} onChange={setDescription} placeholder="Описание расхода" />
        </Field>

        <Field label="Дата расхода">
          <input
            type="date"
            className="m-input"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
          />
        </Field>

        <Field label="Фото чека (PDF/JPG/PNG)" required help="На телефоне откроется камера">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            capture="environment"
            onChange={onFileChange}
            className="cash-file-input"
          />
          {fileLabel && <div className="mt-6 fs-12 c-t3">Выбран: {fileLabel}</div>}
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={onSubmit} disabled={busy}>{busy ? 'Загружаем…' : 'Добавить'}</Btn>
      </MFoot>
    </MCard>
  );
}
