/**
 * Модалка создания/редактирования офисного расхода.
 * Источник vanilla: office_expenses.js → openAddModal / openEditModal.
 *
 * Поля:
 *   - Дата (required)
 *   - Категория (required)
 *   - Сумма ₽ (required > 0)
 *   - Поставщик
 *   - № документа
 *   - Комментарий
 *   - СФ нужна / получена
 *
 * Кнопки:
 *   - Сохранить (черновик)
 *   - Сохранить и отправить (на согласование директорам)
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { SelectInput, MoneyInput, TextInput, TextareaInput, DatePicker, Checkbox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import {
  createExpense, updateExpense, sendForApproval,
  CATEGORY_OPTIONS, todayISO
} from './api';

export function OfficeExpenseFormModal({ expense, onDone }) {
  const { close } = useModal();
  const isEdit = !!expense?.id;

  const [date, setDate] = useState((expense?.date || todayISO()).slice(0, 10));
  const [category, setCategory] = useState(expense?.category || 'other');
  const [amount, setAmount] = useState(expense?.amount != null ? String(expense.amount) : '');
  const [supplier, setSupplier] = useState(expense?.supplier || '');
  const [docNumber, setDocNumber] = useState(expense?.doc_number || '');
  const [comment, setComment] = useState(expense?.comment || expense?.description || '');
  const [invoiceNeeded, setInvoiceNeeded] = useState(!!expense?.invoice_needed);
  const [invoiceReceived, setInvoiceReceived] = useState(!!expense?.invoice_received);
  // D-004: backend в БД хранит FK `contract_id` (TEXT `contract_number` НЕ существует —
  // silent-drop allowlist'ом). Vanilla показывал чекбокс «Есть договор» + произвольный
  // текст; v2 теперь даёт picker по реальным договорам из /api/data/contracts → contract_id.
  const [hasContract, setHasContract] = useState(!!expense?.contract_id);
  const [contractId, setContractId] = useState(expense?.contract_id ? String(expense.contract_id) : '');
  const [contracts, setContracts] = useState([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Подгружаем реестр договоров один раз при открытии модалки.
  useEffect(() => {
    let cancelled = false;
    setContractsLoading(true);
    api('/api/data/contracts?limit=500')
      .then((d) => {
        if (cancelled) return;
        const rows = d?.items || d?.rows || d?.contracts || (Array.isArray(d) ? d : []);
        setContracts(Array.isArray(rows) ? rows : []);
      })
      .catch(() => { if (!cancelled) setContracts([]); })
      .finally(() => { if (!cancelled) setContractsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const contractOptions = contracts.map((c) => {
    const num = c.number || c.contract_number || `#${c.id}`;
    const cp  = c.counterparty_name || c.counterparty || '';
    return { value: String(c.id), label: cp ? `${num} — ${cp}` : num };
  });

  const rejectReason = expense?.reject_reason || expense?.rejection_reason || '';

  const buildPayload = () => ({
    date,
    category,
    amount: Number(amount) || 0,
    supplier: supplier.trim() || null,
    description: comment.trim() || null,
    notes: comment.trim() || null,
    // СчётФактура — backend OFFICE_EXP_COLS теперь принимает эти 3 поля.
    doc_number: docNumber.trim() || null,
    invoice_needed: !!invoiceNeeded,
    invoice_received: !!invoiceReceived,
    // D-004: backend хранит FK contract_id (TEXT contract_number нет в БД).
    contract_id: hasContract && contractId ? Number(contractId) : null,
    comment: comment.trim() || null
  });

  const validate = () => {
    if (!date) { toast.error('Укажите дату'); return false; }
    if (!category) { toast.error('Выберите категорию'); return false; }
    const n = Number(amount);
    if (!n || n <= 0) { toast.error('Укажите сумму > 0'); return false; }
    return true;
  };

  const save = async (submit) => {
    if (!validate()) return;
    setBusy(true);
    try {
      const payload = buildPayload();
      let saved;
      if (isEdit) {
        const r = await updateExpense(expense.id, payload);
        saved = r.expense || r;
      } else {
        const r = await createExpense(payload);
        saved = r.expense || r;
      }

      if (submit && saved?.id) {
        try {
          await sendForApproval(saved.id);
          toast.success(isEdit ? 'Обновлено и отправлено на согласование' : 'Создано и отправлено на согласование');
        } catch (e) {
          // Сохранение прошло, отправка нет — расходу можно нажать «Отправить» из карточки.
          toast.warn('Сохранено, но не получилось отправить: ' + (e?.message || ''));
        }
      } else {
        toast.success(isEdit ? 'Сохранено' : 'Создан черновик');
      }

      window.dispatchEvent(new CustomEvent('asgard:office-expenses:changed'));
      onDone?.(saved);
      close();
    } catch (e) {
      toast.error(e?.message || 'Не удалось сохранить');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon={isEdit ? '✎' : '＋'}
        title={isEdit ? `Расход #${expense.id}` : 'Новый офисный расход'}
        subtitle={isEdit ? 'Редактирование черновика' : 'Категории и согласование с директорами'}
        accent={isEdit ? 'default' : 'gold'}
        onClose={close}
      />
      <MBody>
        {rejectReason && (
          <div
            style={{
              marginBottom: 12,
              padding: '8px 12px',
              background: 'var(--err-bg)',
              color: 'var(--err)',
              borderRadius: 'var(--r-sm)',
              fontSize: 13
            }}
          >
            <b>Причина отклонения:</b> {rejectReason}
          </div>
        )}

        <div className="m-grid-2">
          <Field label="Дата" required>
            <DatePicker value={date} onChange={setDate} />
          </Field>
          <Field label="Категория" required>
            <SelectInput value={category} onChange={setCategory} options={CATEGORY_OPTIONS} placeholder="— выбрать —" />
          </Field>
          <Field label="Сумма (₽)" required>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Поставщик">
            <TextInput value={supplier} onChange={setSupplier} placeholder="ООО «Ромашка»" />
          </Field>
          <Field label="№ документа">
            <TextInput value={docNumber} onChange={setDocNumber} placeholder="УПД-123" />
          </Field>
          <Field label="Счёт-фактура">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Checkbox checked={invoiceNeeded} onChange={setInvoiceNeeded} label="Нужна СФ" />
              <Checkbox checked={invoiceReceived} onChange={setInvoiceReceived} label="СФ получена" />
            </div>
          </Field>
        </div>

        <div className="mt-10">
          <Field label="Договор">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Checkbox checked={hasContract} onChange={setHasContract} label="Есть договор" />
              {hasContract && (
                <div style={{ flex: 1, minWidth: 240 }}>
                  <SelectInput
                    value={contractId}
                    onChange={setContractId}
                    options={contractOptions}
                    placeholder={contractsLoading ? 'Загрузка договоров…' : '— выбрать договор —'}
                  />
                </div>
              )}
            </div>
          </Field>
        </div>

        <div className="mt-10">
          <Field label="Комментарий / описание">
            <TextareaInput
              value={comment}
              onChange={setComment}
              placeholder="Что куплено, для каких целей"
              minRows={2}
              maxRows={6}
            />
          </Field>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="ghost" disabled={busy} onClick={() => save(false)}>
          {busy ? '…' : 'Сохранить черновик'}
        </Btn>
        <Btn variant="primary" disabled={busy} onClick={() => save(true)}>
          {busy ? '…' : '📤 Сохранить и отправить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
