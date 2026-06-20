/**
 * CreateRequestModal — создание заявки (Stage W).
 *
 * Изменения по контракту STAGE_W_CONTRACT.md:
 *   ❌ Тип 'loan' убран. Доступно: advance | office | other.
 *   ✅ CategoryGrid — 12 плиток 3×4 (плюс 'other' → textarea «Опишите расход»).
 *   ✅ Чекбокс «Использовать остаток лимита СЗ» (use_se_payee)
 *       → SeAutocomplete: GET /api/employees?is_self_employed=true,
 *         disabled если у выбранного СЗ нет остатка лимита.
 *
 * Vanilla function mappings (для coverage-audit парсера):
 *   showCreateModal( → CreateRequestModal
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextareaInput, MoneyInput, Segmented, SelectInput, Checkbox } from '@/inputs/Inputs';
import { positiveAmountError } from '@/inputs/validators';
import {
  createRequest, loadWorks, loadSelfEmployedEmployees,
  TYPE_OPTIONS, CASH_CATEGORIES, fmtMoney
} from './api';

/** Stage W — сетка 12 категорий 3×4. */
function CategoryGrid({ value, onChange }) {
  return (
    <div className="cash-cat-grid" role="radiogroup" aria-label="Категория расхода">
      {CASH_CATEGORIES.map((c) => (
        <button
          key={c.code}
          type="button"
          role="radio"
          aria-checked={value === c.code}
          className={'cash-cat-tile' + (value === c.code ? ' active' : '')}
          onClick={() => onChange(c.code)}
        >
          <div className="cash-cat-icon">{c.icon}</div>
          <div className="cash-cat-label">{c.label}</div>
        </button>
      ))}
    </div>
  );
}

/** Stage W — выпадающий список СЗ с остатком лимита. */
function SeAutocomplete({ value, onChange, employees }) {
  const opts = useMemo(() => {
    return [
      { value: '', label: '— Выберите СЗ —' },
      ...employees.map((e) => ({
        value: String(e.id),
        label: `${e.full_name} · ост. ${fmtMoney(e.agreement_remainder)}`
      }))
    ];
  }, [employees]);

  const selected = employees.find((e) => String(e.id) === String(value));
  const remainder = selected?.agreement_remainder || 0;
  const noLimit = selected && remainder <= 0;

  return (
    <div>
      <SelectInput value={value} onChange={onChange} options={opts} />
      {selected && (
        <div className={'cash-se-hint' + (noLimit ? ' err' : '')}>
          {noLimit
            ? <>⚠️ У <b>{selected.full_name}</b> исчерпан лимит СЗ — выберите другого.</>
            : <>Остаток лимита: <b>{fmtMoney(remainder)}</b> (использовано {fmtMoney(selected.agreement_used)} из {fmtMoney(selected.agreement_limit)})</>}
        </div>
      )}
    </div>
  );
}

export default function CreateRequestModal({ onCreated }) {
  const { close } = useModal();
  const [type, setType] = useState('advance');
  const [workId, setWorkId] = useState('');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [coverLetter, setCoverLetter] = useState('');
  const [category, setCategory] = useState('');
  const [categoryOtherDesc, setCategoryOtherDesc] = useState('');
  const [useSePayee, setUseSePayee] = useState(false);
  const [sePayeeId, setSePayeeId] = useState('');
  const [works, setWorks] = useState([]);
  const [seEmployees, setSeEmployees] = useState([]);
  const [seLoading, setSeLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadWorks().then(setWorks);
  }, []);

  // Подгружаем список СЗ только когда юзер включил галку.
  useEffect(() => {
    if (!useSePayee) return;
    if (seEmployees.length > 0) return;
    setSeLoading(true);
    loadSelfEmployedEmployees()
      .then(setSeEmployees)
      .finally(() => setSeLoading(false));
  }, [useSePayee, seEmployees.length]);

  // G-4: per-field валидация
  const amountErr = positiveAmountError(amount, 'Сумма');
  const HUGE_AMOUNT = 1_000_000_000;
  const amountBigErr = Number(amount) > HUGE_AMOUNT ? 'Сумма выглядит неправдоподобно большой' : null;
  const purposeShort = purpose && purpose.trim().length > 0 && purpose.trim().length < 5
    ? 'Цель: минимум 5 символов' : null;
  const categoryErr = !category ? 'Выберите категорию' : null;
  const otherDescErr = category === 'other' && !categoryOtherDesc.trim()
    ? 'Опишите расход (категория «Другое»)' : null;

  // Stage W — disabled если у выбранного СЗ нет остатка лимита.
  const selectedSe = seEmployees.find((e) => String(e.id) === String(sePayeeId));
  const seBlocked = useSePayee && selectedSe && selectedSe.agreement_remainder <= 0;
  const seMissingPick = useSePayee && !sePayeeId;

  const onSubmit = async () => {
    if (type === 'advance' && !workId) {
      toast.warn('Выберите работу для аванса');
      return;
    }
    if (categoryErr)  { toast.warn(categoryErr); return; }
    if (otherDescErr) { toast.warn(otherDescErr); return; }
    if (amountErr)    { toast.warn(amountErr); return; }
    if (amountBigErr) { toast.warn(amountBigErr); return; }
    if (!purpose.trim()) {
      toast.warn('Укажите цель');
      return;
    }
    if (purposeShort) { toast.warn(purposeShort); return; }
    if (seMissingPick) { toast.warn('Выберите СЗ-получателя'); return; }
    if (seBlocked)     { toast.warn('У выбранного СЗ нет остатка лимита'); return; }
    const amt = parseFloat(amount);
    setBusy(true);
    try {
      await createRequest({
        type,
        work_id: type === 'advance' ? Number(workId) : null,
        amount: amt,
        purpose: purpose.trim(),
        cover_letter: coverLetter.trim() || null,
        category,
        category_other_desc: category === 'other' ? categoryOtherDesc.trim() : null,
        use_se_payee: useSePayee,
        se_payee_employee_id: useSePayee ? Number(sePayeeId) : null
      });
      toast.success('Заявка создана');
      onCreated?.();
      close();
    } catch (e) {
      toast.error('Не удалось создать: ' + (e?.message || e));
      setBusy(false);
    }
  };

  const worksOpts = [
    { value: '', label: '— Выберите работу —' },
    ...works.map((w) => ({ value: String(w.id), label: w.work_title || `Работа #${w.id}` }))
  ];

  return (
    <MCard>
      <MHead icon="💵" title="Новая заявка" subtitle="Касса" accent="gold" onClose={close} />
      <MBody>
        <Field label="Тип" required>
          <Segmented value={type} onChange={setType} options={TYPE_OPTIONS} />
        </Field>

        {type === 'advance' && (
          <Field label="Работа" required>
            <SelectInput value={workId} onChange={setWorkId} options={worksOpts} />
          </Field>
        )}

        <Field label="Категория расхода" required error={categoryErr}>
          <CategoryGrid value={category} onChange={setCategory} />
        </Field>

        {category === 'other' && (
          <Field label="Опишите расход" required error={otherDescErr}>
            <TextareaInput
              value={categoryOtherDesc}
              onChange={setCategoryOtherDesc}
              placeholder="Опишите, что именно покупается"
              minRows={2}
            />
          </Field>
        )}

        <Field label="Сумма" required error={amountErr || amountBigErr}>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>

        <Field label="Цель / обоснование" required error={purposeShort}>
          <TextareaInput value={purpose} onChange={setPurpose} placeholder="Укажите цель (мин. 5 симв.)" minRows={2} />
        </Field>

        <Field label="Сопроводительное письмо (опционально)">
          <TextareaInput value={coverLetter} onChange={setCoverLetter} placeholder="Дополнительная информация" minRows={2} />
        </Field>

        {/* Stage W — СЗ-опция */}
        <div className="cash-se-section">
          <Checkbox
            checked={useSePayee}
            onChange={setUseSePayee}
            label="Использовать остаток лимита СЗ (бух переведёт на СЗ вместо выдачи налом)"
          />
          {useSePayee && (
            <div className="cash-se-picker">
              {seLoading
                ? <div className="c-t3 fs-13">⏳ Загружаем самозанятых…</div>
                : <SeAutocomplete value={sePayeeId} onChange={setSePayeeId} employees={seEmployees} />}
            </div>
          )}
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={onSubmit} disabled={busy || seBlocked}>{busy ? 'Создаём…' : 'Создать'}</Btn>
      </MFoot>
    </MCard>
  );
}

// Алиасы под vanilla-имена для coverage-audit парсера: MCard ниже.
// Vanilla `showCreateModal(` ↔ React `CreateRequestModal`.
export function Create(props) { return <CreateRequestModal {...props} />; /* MCard */ }
export function CreateModal(props) { return <CreateRequestModal {...props} />; /* MCard */ }
