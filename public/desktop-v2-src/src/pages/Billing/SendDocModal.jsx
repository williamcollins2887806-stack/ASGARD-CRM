/**
 * Отправка счёта или акта на почту с PDF.
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { sendInvoice, sendAct, openInvoicePdf, openActPdf, emitChanged, fmtMoney, fmtDate } from './api';

export function SendDocModal({ kind, doc }) {
  const { close } = useModal();
  const isAct = kind === 'act';
  const number = isAct ? (doc.act_number || doc.id) : (doc.invoice_number || doc.id);
  const [form, setForm] = useState({
    to: doc.contact_email || '',
    cc: '',
    subject: isAct ? `Акт выполненных работ № ${number}` : `Счёт на оплату № ${number}`,
    body: ''
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm((s) => ({ ...s, body: buildBody(kind, doc) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, kind]);

  const submit = async () => {
    if (!form.to?.trim()) return toast.warn('Укажите адрес получателя');
    if (!/.+@.+\..+/.test(form.to)) return toast.warn('Невалидный email');
    setBusy(true);
    try {
      const send = isAct ? sendAct : sendInvoice;
      await send(doc.id, form);
      toast.success('Отправлено на ' + form.to);
      emitChanged();
      close();
    } catch (e) {
      toast.error(String(e?.message || e));
      setBusy(false);
    }
  };

  const openPdf = () => {
    const fn = isAct ? openActPdf : openInvoicePdf;
    fn(doc.id).catch((e) => toast.error('PDF: ' + (e?.message || e)));
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon="📤"
        title={isAct ? 'Отправить акт' : 'Отправить счёт'}
        subtitle={`№ ${number} · ${doc.customer_name || ''}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="grid-2 gap-16">
          <div className="col gap-10">
            <Field label="Кому" required>
              <TextInput value={form.to} onChange={(v) => setForm({ ...form, to: v })} placeholder="email@company.ru" />
            </Field>
            <Field label="Копия (Cc)">
              <TextInput value={form.cc} onChange={(v) => setForm({ ...form, cc: v })} />
            </Field>
            <Field label="Тема">
              <TextInput value={form.subject} onChange={(v) => setForm({ ...form, subject: v })} />
            </Field>
            <Field label="Текст письма">
              <TextareaInput value={form.body} onChange={(v) => setForm({ ...form, body: v })} minRows={7} maxRows={14} />
            </Field>
          </div>
          <div className="col gap-10">
            <div className="bill-send-aside">
              <div className="bill-eyebrow">Вложение</div>
              <div className="fw-700">{isAct ? 'Акт' : 'Счёт'} № {number}.pdf</div>
              <div className="fs-13 c-t2 mt-6">{fmtMoney(doc.total_amount)} · {fmtDate(doc.act_date || doc.invoice_date)}</div>
              <div className="mt-10">
                <button type="button" onClick={openPdf} className="bill-linkish">Открыть PDF</button>
              </div>
            </div>
            <div className="bill-send-note">
              Письмо уйдёт с корпоративной почты. Получатель увидит документ как PDF-вложение.
            </div>
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Отправляем…' : '📤 Отправить'}</Btn>
      </MFoot>
    </MCard>
  );
}

function buildBody(kind, doc) {
  const greet = doc.contact_person ? `Здравствуйте, ${String(doc.contact_person).split(' ')[0]}!` : 'Добрый день!';
  const isAct = kind === 'act';
  const number = isAct ? (doc.act_number || doc.id) : (doc.invoice_number || doc.id);
  return [
    greet,
    '',
    isAct
      ? `Во вложении направляем акт выполненных работ № ${number}.`
      : `Во вложении направляем счёт на оплату № ${number}.`,
    doc.total_amount ? `Сумма: ${fmtMoney(doc.total_amount)}.` : '',
    '',
    'Готовы ответить на вопросы.',
    '',
    'С уважением,',
    'ООО «Асгард-Сервис»'
  ].filter((x, i, arr) => !(x === '' && arr[i - 1] === '')).join('\n');
}
