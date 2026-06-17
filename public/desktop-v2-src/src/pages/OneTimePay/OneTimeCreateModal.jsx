/**
 * Модалка создания запроса разовой оплаты.
 * Источник vanilla: payroll.js → renderOneTimePay → btnNewOTP handler.
 *
 * Поля:
 *   - Рабочий (employee_id, обязательно) — Combobox по справочнику
 *   - Сумма (₽, обязательно)
 *   - Тип (taxi/fuel/meal/material/other/one_time)
 *   - Работа (work_id, не обязательно)
 *   - Причина (reason, обязательно)
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { Combobox, SelectInput, MoneyInput, TextareaInput } from '@/inputs/Inputs';
import { positiveAmountError } from '@/inputs/validators';
import { toast } from '@/modals/Notifications';
import {
  loadEmployees, loadWorks, createOneTime,
  PAYMENT_TYPE_OPTIONS
} from './api';

export function OneTimeCreateModal({ userRole, userId, onDone }) {
  const { close } = useModal();
  const [employees, setEmployees] = useState([]);
  const [works, setWorks] = useState([]);
  const [empId, setEmpId] = useState(null);
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('one_time');
  const [workId, setWorkId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadEmployees().then((list) => setEmployees(list.filter((e) => e.is_active !== false))).catch(() => setEmployees([]));
    loadWorks().then(setWorks).catch(() => setWorks([]));
  }, []);

  const empOptions = useMemo(
    () => employees.map((e) => ({ value: e.id, label: e.fio || e.full_name || `Рабочий #${e.id}` })),
    [employees]
  );

  const workOptions = useMemo(() => {
    let list = works;
    // PM видит только свои работы
    if (userRole === 'PM' && userId) {
      list = works.filter((w) => w.pm_id === userId || w.created_by === userId);
    }
    return [
      { value: '', label: 'Без привязки' },
      ...list.map((w) => ({
        value: String(w.id),
        label: `#${w.id} · ${w.customer_name ? w.customer_name + ' — ' : ''}${w.work_title || w.title || 'Работа'}`
      }))
    ];
  }, [works, userRole, userId]);

  // G-4: per-field валидация
  const amountErr = positiveAmountError(amount, 'Сумма');
  const reasonShort = reason && reason.trim().length > 0 && reason.trim().length < 5
    ? 'Причина: минимум 5 символов' : null;

  const submit = async () => {
    if (!empId) { toast('Ошибка', 'Выберите рабочего', 'err'); return; }
    const amountNum = Number(amount);
    if (amountErr) { toast('Ошибка', amountErr, 'err'); return; }
    if (!amountNum || amountNum <= 0) { toast('Ошибка', 'Укажите сумму', 'err'); return; }
    if (!reason.trim()) { toast('Ошибка', 'Укажите причину', 'err'); return; }
    if (reasonShort) { toast('Ошибка', reasonShort, 'err'); return; }

    setSubmitting(true);
    try {
      await createOneTime({
        employee_id: Number(empId),
        amount: amountNum,
        reason: reason.trim(),
        work_id: workId ? Number(workId) : null,
        payment_type: type || 'one_time'
      });
      toast('Создано', 'Ожидает согласования', 'ok');
      window.dispatchEvent(new CustomEvent('asgard:one-time-pay:changed'));
      onDone?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setSubmitting(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="💵" title="Запросить разовую оплату" subtitle="Такси, топливо, питание и пр." accent="gold" onClose={close} />
      <MBody>
        <Field label="Рабочий" required>
          <Combobox
            options={empOptions}
            value={empId}
            onChange={setEmpId}
            placeholder="Начните вводить ФИО…"
          />
        </Field>

        <div className="m-grid-2 mt-10" >
          <Field label="Сумма (₽)" required error={amountErr}>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Тип">
            <SelectInput
              value={type}
              onChange={setType}
              options={PAYMENT_TYPE_OPTIONS}
              placeholder="Тип оплаты…"
            />
          </Field>
        </div>

        <Field label="Работа">
          <SelectInput
            value={workId}
            onChange={setWorkId}
            options={workOptions}
            placeholder="Без привязки"
          />
        </Field>

        <Field label="Причина / описание" required error={reasonShort}>
          <TextareaInput
            value={reason}
            onChange={setReason}
            placeholder="Опишите за что и почему оплата (мин. 5 симв.)…"
            minRows={2}
            maxRows={5}
          />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={submitting} onClick={submit}>
          {submitting ? '…' : 'Запросить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
