/**
 * Редактирование расхода (BUH): № документа + флаги счёт-фактуры.
 * Vanilla buh_registry.js → openEditModal (только doc_number + invoice_needed + invoice_received).
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field as FieldM } from '@/modals/parts';
import { TextInput, Checkbox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { updateWorkExpense, fmtMoney, fmtDate, getCategory } from './api';

export default function ExpenseEditModal({ expense, onSaved }) {
  const { close } = useModal();
  const cat = getCategory(expense.category);

  const [docNumber,      setDocNumber]      = useState(expense.doc_number      || '');
  const [invoiceNeeded,  setInvoiceNeeded]  = useState(!!expense.invoice_needed);
  const [invoiceReceived,setInvoiceReceived]= useState(!!expense.invoice_received);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateWorkExpense(expense.id, {
        doc_number: docNumber.trim(),
        invoice_needed:   invoiceNeeded,
        invoice_received: invoiceReceived
      });
      toast.success('Расход обновлён');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="✎"
        title={`Расход #${expense.id}`}
        subtitle={`${cat.icon} ${cat.label} — редактирование`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          {/* read-only сводка */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            padding: 12,
            background: 'var(--inner-bg)',
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--brd-2)',
            fontSize: 13
          }}>
            <div>
              <div className="label-cap">Дата</div>
              <div className="mt-2">{fmtDate(expense.date)}</div>
            </div>
            <div>
              <div className="label-cap">Сумма</div>
              <div style={{ marginTop: 2, fontWeight: 700, color: 'var(--gold)' }}>{fmtMoney(expense.amount)}</div>
            </div>
            <div className="col-span-2">
              <div className="label-cap">Поставщик</div>
              <div className="mt-2">{expense.supplier || '—'}</div>
            </div>
          </div>

          <FieldM label="№ документа">
            <TextInput value={docNumber} onChange={setDocNumber} placeholder="Например: УПД-12345" />
          </FieldM>

          <div className="col gap-8">
            <Checkbox
              checked={invoiceNeeded}
              onChange={setInvoiceNeeded}
              label="Нужна счёт-фактура"
            />
            <Checkbox
              checked={invoiceReceived}
              onChange={setInvoiceReceived}
              label="СФ получена"
            />
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>
          {busy ? 'Сохраняем…' : '💾 Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
