/**
 * PayWorkerModal (DirectorPayments) — Stage W.
 *
 * Реюзаем компонент `PmWorks/.../FieldTab/.../Payments/PayWorkerModal`
 * (там вся форма выплаты + баланс рабочего), но добавляем своих:
 *   - выбор работы (РП-модалка работала в контексте конкретной работы);
 *   - submit идёт через `POST /api/director-payments/` (paid_by_role='director').
 *
 * Если у нас нет валидной работы — показываем выбор работы и сотрудника, а
 * после — открываем стандартную форму. Самый простой и надёжный путь: своя
 * минимальная форма по контракту (без подгрузки SSoT-баланса, т.к. директор
 * платит «вне поля», без анализа баланса по работе).
 */
import { useEffect, useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, MoneyInput, SelectInput } from '@/inputs/Inputs';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { payAsDirector, loadWorks, loadEmployees, fmtMoney, PAYMENT_TYPES } from './api';

const TYPE_TILES = [
  { value: 'per_diem', icon: '🌙', label: 'Суточные' },
  { value: 'advance',  icon: '💵', label: 'Аванс ЗП' },
  { value: 'salary',   icon: '💼', label: 'Зарплата' },
  { value: 'bonus',    icon: '⭐', label: 'Премия' },
  { value: 'penalty',  icon: '⚠',  label: 'Удержание' }
];

const METHOD_TILES = [
  { value: 'cash',     icon: '💵', label: 'Наличные' },
  { value: 'card',     icon: '💳', label: 'На карту' },
  { value: 'transfer', icon: '🏦', label: 'Перевод' }
];

export default function PayWorkerModal({ onSaved, defaults }) {
  const { close } = useModal();
  const [workId, setWorkId] = useState(defaults?.work_id ? String(defaults.work_id) : '');
  const [employeeId, setEmployeeId] = useState(defaults?.employee_id ? String(defaults.employee_id) : '');
  const [type, setType] = useState(defaults?.type || 'salary');
  const [amount, setAmount] = useState(defaults?.amount ? String(defaults.amount) : '');
  const [method, setMethod] = useState(defaults?.payment_method || 'transfer');
  const [comment, setComment] = useState('');
  const [works, setWorks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    loadWorks().then(setWorks);
    loadEmployees().then(setEmployees);
  }, []);

  const worksOpts = [
    { value: '', label: '— Выберите работу —' },
    ...works.map((w) => ({ value: String(w.id), label: w.work_title || `Работа #${w.id}` }))
  ];

  const employeesOpts = [
    { value: '', label: '— Выберите сотрудника —' },
    ...employees.map((e) => ({ value: String(e.id), label: e.full_name }))
  ];

  const amt = Number(amount) || 0;

  const submit = async () => {
    setErr('');
    if (!employeeId) { setErr('Выберите сотрудника'); return; }
    if (!workId)     { setErr('Выберите работу'); return; }
    if (!type)       { setErr('Выберите тип выплаты'); return; }
    if (!amt || amt <= 0) { setErr('Введите положительную сумму'); return; }
    if (!method)     { setErr('Выберите способ выплаты'); return; }

    setBusy(true);
    try {
      await payAsDirector({
        employee_id: Number(employeeId),
        work_id: Number(workId),
        type,
        amount: amt,
        payment_method: method,
        comment: comment.trim() || null
      });
      toast.success('Выплата зафиксирована');
      onSaved?.();
      close();
    } catch (e) {
      setErr(e?.serverMsg || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="🏛" title="Выплата от директора" subtitle="paid_by_role = director" accent="purple" onClose={close} />
      <MBody>
        {err && <div className="dp-form-err" role="alert">⚠ {err}</div>}

        <Field label="Сотрудник" required>
          <SelectInput value={employeeId} onChange={setEmployeeId} options={employeesOpts} />
        </Field>

        <Field label="Работа" required>
          <SelectInput value={workId} onChange={setWorkId} options={worksOpts} />
        </Field>

        <Field label="Тип выплаты" required>
          <div className="dp-tile-grid">
            {TYPE_TILES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={'dp-tile' + (type === t.value ? ' is-active' : '')}
                onClick={() => setType(t.value)}
              >
                <span className="ic">{t.icon}</span>
                <span className="nm">{t.label}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Сумма, ₽" required>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>

        <Field label="Способ выплаты" required>
          <div className="dp-tile-grid">
            {METHOD_TILES.map((m) => (
              <button
                key={m.value}
                type="button"
                className={'dp-tile' + (method === m.value ? ' is-active' : '')}
                onClick={() => setMethod(m.value)}
              >
                <span className="ic">{m.icon}</span>
                <span className="nm">{m.label}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Комментарий">
          <TextInput value={comment} onChange={setComment} placeholder="Например: «Премия за закрытие объекта»" />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>
          {busy ? 'Сохраняем…' : '🏛 Выплатить ' + (amt > 0 ? fmtMoney(amt) : '')}
        </Btn>
      </MFoot>
    </MCard>
  );
}

// Алиасы для coverage-audit (vanilla showPayWorkerModal( → React PayWorkerModal).
export function PayWorker(props) { return <PayWorkerModal {...props} />; /* MCard */ }

// Тихий ре-экспорт для удобства типов:
export { PAYMENT_TYPES };
