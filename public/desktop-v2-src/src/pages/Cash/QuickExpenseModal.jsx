/**
 * QuickExpenseModal — «Добавить расход» для HEAD_TO (упрощённый UX).
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, MoneyInput, SelectInput } from '@/inputs/Inputs';
import {
  quickExpense, loadPerDiemSuggestions, loadEmployees, loadWorks, fmtMoney
} from './api';

const EXPENSE_TYPES = [
  { value: 'per_diem', label: '🌙 Суточные рабочему' },
  { value: 'taxi',     label: '🚕 Такси' },
  { value: 'office',   label: '🏢 Офис / хознужды' },
  { value: 'other',    label: '📦 Прочее' }
];

export default function QuickExpenseModal({ onSaved }) {
  const { close } = useModal();
  const [expenseType, setExpenseType] = useState('per_diem');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [workId, setWorkId] = useState('');
  const [employees, setEmployees] = useState([]);
  const [works, setWorks] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  const now = new Date();

  useEffect(() => {
    loadEmployees().then(setEmployees);
    loadWorks().then(setWorks);
    loadPerDiemSuggestions({ year: now.getFullYear(), month: now.getMonth() + 1 })
      .then((d) => setSuggestions(Array.isArray(d?.suggestions) ? d.suggestions : []))
      .catch(() => setSuggestions([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const employeeOpts = useMemo(() => [
    { value: '', label: '— Выберите рабочего —' },
    ...employees.map((e) => ({ value: String(e.id), label: e.fio }))
  ], [employees]);

  const workOpts = useMemo(() => [
    { value: '', label: '— Выберите работу —' },
    ...works.map((w) => ({
      value: String(w.id),
      label: w.work_title || w.title || `Работа #${w.id}`
    }))
  ], [works]);

  const suggestionForEmployee = useMemo(() => {
    if (!employeeId) return null;
    const eId = Number(employeeId);
    const wId = workId ? Number(workId) : null;
    return suggestions.find((s) =>
      s.employee_id === eId && (wId == null || s.work_id === wId)
    ) || suggestions.find((s) => s.employee_id === eId) || null;
  }, [employeeId, workId, suggestions]);

  useEffect(() => {
    if (expenseType !== 'per_diem' || !suggestionForEmployee) return;
    if (!amount && suggestionForEmployee.suggested_amount > 0) {
      setAmount(String(suggestionForEmployee.suggested_amount));
    }
    if (!workId && suggestionForEmployee.work_id) {
      setWorkId(String(suggestionForEmployee.work_id));
    }
  }, [expenseType, suggestionForEmployee, amount, workId]);

  const onPickSuggestion = (s) => {
    setEmployeeId(String(s.employee_id));
    if (s.work_id) setWorkId(String(s.work_id));
    setAmount(String(s.suggested_amount || ''));
  };

  const submit = async (forceDuplicate = false) => {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.warn('Сумма должна быть больше 0');
      return;
    }

    if (expenseType === 'per_diem') {
      if (!employeeId || !workId) {
        toast.warn('Выберите рабочего и работу');
        return;
      }
    } else if (!description.trim()) {
      toast.warn('Укажите описание расхода');
      return;
    }

    setBusy(true);
    try {
      const body = {
        expense_type: expenseType,
        amount: amt,
        description: description.trim() || undefined,
        note: description.trim() || undefined,
        confirm_duplicate: forceDuplicate || confirmDuplicate || undefined
      };
      if (expenseType === 'per_diem') {
        body.employee_id = Number(employeeId);
        body.work_id = Number(workId);
      }
      await quickExpense(body);
      toast.success('Расход записан');
      window.dispatchEvent(new CustomEvent('asgard:cash:changed'));
      onSaved?.();
      close();
    } catch (e) {
      if (e?.status === 409 && (e?.data?.error === 'duplicate_payment' || e?.data?.requires_confirmation)) {
        setConfirmDuplicate(true);
        toast.warn(e?.data?.message || 'Суточные уже выплачены. Нажмите ещё раз для подтверждения.');
        setBusy(false);
        return;
      }
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="💸" title="Добавить расход" subtitle="Моя касса" accent="default" onClose={close} />
      <MBody>
        <Field label="Тип расхода" required>
          <SelectInput
            value={expenseType}
            onChange={(v) => { setExpenseType(v); setAmount(''); setConfirmDuplicate(false); }}
            options={EXPENSE_TYPES}
          />
        </Field>

        {expenseType === 'per_diem' && (
          <>
            {suggestions.length > 0 && (
              <Field label="Подсказки из табеля дороги">
                <div className="col gap-6">
                  {suggestions.slice(0, 8).map((s) => (
                    <button
                      key={`${s.employee_id}-${s.work_id}`}
                      type="button"
                      className="cash-source-chip"
                      style={{ textAlign: 'left', width: '100%' }}
                      onClick={() => onPickSuggestion(s)}
                    >
                      {s.employee_fio}
                      {s.travel_days ? ` · ${s.travel_days} дн.` : ''}
                      {' · '}{fmtMoney(s.suggested_amount)}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            <Field label="Рабочий" required>
              <SelectInput value={employeeId} onChange={setEmployeeId} options={employeeOpts} />
            </Field>
            <Field label="Работа" required>
              <SelectInput value={workId} onChange={setWorkId} options={workOpts} />
            </Field>
            {suggestionForEmployee && (
              <p className="text-muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                По табелю: {suggestionForEmployee.travel_days} дн. дороги,
                уже выплачено {fmtMoney(suggestionForEmployee.paid_amount)}
              </p>
            )}
          </>
        )}

        <Field label="Сумма" required>
          <MoneyInput value={amount} onChange={(v) => { setAmount(v); setConfirmDuplicate(false); }} />
        </Field>

        {expenseType !== 'per_diem' && (
          <Field label="За что потрачено" required>
            <TextInput
              value={description}
              onChange={setDescription}
              placeholder={expenseType === 'taxi' ? 'Такси до офиса' : 'Описание'}
            />
          </Field>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn
          variant="primary"
          disabled={busy}
          onClick={() => submit(confirmDuplicate)}
        >
          {confirmDuplicate ? 'Подтвердить выплату' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
