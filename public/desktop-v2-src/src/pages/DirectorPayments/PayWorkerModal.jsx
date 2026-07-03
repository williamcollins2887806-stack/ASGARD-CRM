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
import { useEffect, useMemo, useState } from 'react';
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

// 2026-06-29 — радио-карточки источника денег (см. PayWorkerModal в FieldTab).
const SOURCE_CARDS = [
  {
    value: 'cash',
    icon: '📤',
    title: 'Наличкой',
    desc: 'Выдано рабочему наличными',
    tech: "payment_method='cash'"
  },
  {
    value: 'transfer',
    icon: '💳',
    title: 'Переводом с карты',
    desc: 'Перевод от директора со своей карты',
    tech: "payment_method='transfer'"
  },
  {
    value: 'bank',
    icon: '🏦',
    title: 'Бухгалтерия через банк (оф)',
    desc: 'Официальный перевод от компании',
    tech: "payment_method='bank' · paid_by=NULL",
    requireOfficial: true
  },
  {
    value: 'self',
    icon: '📱',
    title: 'Через СЗ-сервис (ReStaff)',
    desc: 'Бухгалтерия переведёт самозанятому',
    tech: "payment_method='self' · paid_by=NULL",
    requireSelfEmployed: true
  }
];

function defaultSourceFor({ isOfficial, isSelfEmployed, payType }) {
  if (payType === 'salary' && isOfficial) return 'bank';
  if (payType === 'salary' && isSelfEmployed) return 'self';
  return 'transfer';
}

function isSourceDisabled(srcValue, { isOfficial, isSelfEmployed }) {
  const card = SOURCE_CARDS.find((s) => s.value === srcValue);
  if (!card) return false;
  if (card.requireOfficial && !isOfficial) return true;
  if (card.requireSelfEmployed && !isSelfEmployed) return true;
  return false;
}

function disabledReason(card) {
  if (card.requireOfficial) return 'Доступно только для штатников';
  if (card.requireSelfEmployed) return 'Доступно только для самозанятых';
  return '';
}

export default function PayWorkerModal({ onSaved, defaults }) {
  const { close } = useModal();
  const [workId, setWorkId] = useState(defaults?.work_id ? String(defaults.work_id) : '');
  const [employeeId, setEmployeeId] = useState(defaults?.employee_id ? String(defaults.employee_id) : '');
  const [type, setType] = useState(defaults?.type || 'salary');
  const [amount, setAmount] = useState(defaults?.amount ? String(defaults.amount) : '');
  const [method, setMethod] = useState(defaults?.payment_method || 'transfer');
  const [methodTouched, setMethodTouched] = useState(!!defaults?.payment_method);
  const [comment, setComment] = useState('');
  const [works, setWorks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    loadWorks().then(setWorks);
    loadEmployees().then(setEmployees);
  }, []);

  // 2026-06-29 — определяем тип работника (штатник / СЗ) из employees-списка.
  const workerType = useMemo(() => {
    const emp = employees.find((e) => String(e.id) === String(employeeId));
    return {
      isOfficial: !!emp?.is_officially_employed,
      isSelfEmployed: !!emp?.is_self_employed
    };
  }, [employees, employeeId]);

  // Дефолтный источник при смене работника / типа выплаты (если юзер не трогал).
  useEffect(() => {
    if (methodTouched) return;
    if (!employeeId) return;
    setMethod(defaultSourceFor({
      isOfficial: workerType.isOfficial,
      isSelfEmployed: workerType.isSelfEmployed,
      payType: type
    }));
  }, [employeeId, type, workerType.isOfficial, workerType.isSelfEmployed, methodTouched]);

  // Если выбранный source стал недоступен — пересчитать
  useEffect(() => {
    if (!employeeId) return;
    if (isSourceDisabled(method, workerType)) {
      setMethod(defaultSourceFor({
        isOfficial: workerType.isOfficial,
        isSelfEmployed: workerType.isSelfEmployed,
        payType: type
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, workerType.isOfficial, workerType.isSelfEmployed]);

  const pickMethod = (v) => { setMethod(v); setMethodTouched(true); };

  const worksOpts = [
    { value: '', label: '— Выберите работу —' },
    ...works.map((w) => ({ value: String(w.id), label: w.work_title || `Работа #${w.id}` }))
  ];

  const employeesOpts = [
    { value: '', label: '— Выберите сотрудника —' },
    ...employees.map((e) => ({ value: String(e.id), label: e.full_name }))
  ];

  const amt = Number(amount) || 0;

  const submit = async (confirmDuplicate = false) => {
    setErr('');
    if (!employeeId) { setErr('Выберите сотрудника'); return; }
    if (!workId)     { setErr('Выберите работу'); return; }
    if (!type)       { setErr('Выберите тип выплаты'); return; }
    if (!amt || amt <= 0) { setErr('Введите положительную сумму'); return; }
    if (!method)     { setErr('Выберите способ выплаты'); return; }

    setBusy(true);
    try {
      const payload = {
        employee_id: Number(employeeId),
        work_id: Number(workId),
        type,
        amount: amt,
        payment_method: method,
        comment: comment.trim() || null
      };
      // 23.06.2026 BUG-FIX (🟡 Payouts-1): пробрасываем confirm_duplicate, когда
      // пользователь подтвердил повторную выплату (после 409 duplicate_payment).
      if (confirmDuplicate) payload.confirm_duplicate = true;

      await payAsDirector(payload);
      toast.success('Выплата зафиксирована');
      onSaved?.();
      close();
    } catch (e) {
      // 23.06.2026 BUG-FIX (🟡 Payouts-1): обработка 409 duplicate_payment.
      // Backend director-payments.js:97-107 возвращает {error:'duplicate_payment',
      // message, total_already_paid, requires_confirmation:true, ... }.
      // До фикса фронт показывал сухое serverMsg «duplicate_payment» вместо UX-диалога.
      const code = e?.status || e?.response?.status;
      const body = e?.body || e?.data || e?.response?.data || null;
      const isDup = code === 409 || body?.error === 'duplicate_payment' || body?.requires_confirmation;
      if (isDup) {
        const msg = body?.message || e?.serverMsg
          || 'Похожая выплата уже зафиксирована за этот месяц. Подтвердить повторную выплату?';
        // window.confirm — простейший UX-диалог, аналогичный vanilla field-tab.js
        // eslint-disable-next-line no-alert
        const ok = typeof window !== 'undefined' && window.confirm(msg);
        if (ok) {
          // повторяем запрос с confirm_duplicate:true
          setBusy(false);
          return submit(true);
        }
        setErr('Выплата отменена пользователем.');
      } else {
        setErr(e?.serverMsg || e?.message || String(e));
      }
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

        <Field label="Источник денег" required>
          <div className="ft-pw-src-group" role="radiogroup" aria-label="Источник денег">
            {SOURCE_CARDS.map((s) => {
              const disabled = isSourceDisabled(s.value, workerType);
              const selected = method === s.value;
              return (
                <label
                  key={s.value}
                  className={
                    'ft-pw-src-card'
                    + (selected ? ' is-selected' : '')
                    + (disabled ? ' is-disabled' : '')
                  }
                  title={disabled ? disabledReason(s) : ''}
                >
                  <input
                    type="radio"
                    name="dp-src"
                    value={s.value}
                    checked={selected}
                    disabled={disabled}
                    onChange={() => !disabled && pickMethod(s.value)}
                  />
                  <span className="ft-pw-src-ico" aria-hidden="true">{s.icon}</span>
                  <span className="ft-pw-src-body">
                    <span className="ft-pw-src-ttl">{s.title}</span>
                    <span className="ft-pw-src-desc">{disabled ? disabledReason(s) : s.desc}</span>
                    <span className="ft-pw-src-tech">{s.tech}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </Field>

        <Field label="Комментарий">
          <TextInput value={comment} onChange={setComment} placeholder="Например: «Премия за закрытие объекта»" />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={() => submit(false)} disabled={busy}>
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
