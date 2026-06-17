/**
 * SendTkpModal — отправка ТКП клиенту email.
 * Источник: openSendTkpModal в tkp_page.js (1249–1346).
 * Бэк: POST /api/tkp/:id/send
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, TextareaInput, Checkbox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { sendTkpEmail, openPdf, loadTkp } from '../api';

export function SendTkpModal({ tkp: tkpProp }) {
  const { close } = useModal();
  const [tkp, setTkp] = useState(tkpProp);
  const [form, setForm] = useState({
    to: tkpProp?.contact_email || '',
    cc: '',
    subject: `Технико-коммерческое предложение${tkpProp?.tkp_number ? ` № ${tkpProp.tkp_number}` : ''}${tkpProp?.subject ? ` — ${tkpProp.subject}` : ''}`,
    body: '',
    attach_signature: true,
    attach_stamp: true
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tkpProp?.id) return;
    // Если в карточке нет письма — пробуем подтянуть
    if (!tkpProp.contact_email) {
      loadTkp(tkpProp.id).then((d) => {
        if (d) {
          const fresh = d.tkp || d;
          setTkp(fresh);
          setForm((s) => ({ ...s, to: fresh.contact_email || s.to }));
        }
      });
    }
    // Дефолтное тело
    setForm((s) => ({
      ...s,
      body: buildEmailBody(tkpProp)
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tkpProp?.id]);

  const submit = async () => {
    if (!form.to?.trim()) return toast('Email', 'Укажи адрес получателя', 'warn');
    if (!/.+@.+\..+/.test(form.to)) return toast('Email', 'Невалидный адрес', 'warn');
    setBusy(true);
    try {
      await sendTkpEmail(tkp.id, {
        to: form.to,
        cc: form.cc || null,
        subject: form.subject,
        body: form.body,
        attach_signature: form.attach_signature,
        attach_stamp: form.attach_stamp
      });
      toast('📤 Отправлено', form.to, 'ok');
      window.dispatchEvent(new CustomEvent('asgard:tkp:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  const openPreview = () => openPdf(tkp.id, { signature: form.attach_signature, stamp: form.attach_stamp })
    .catch((e) => toast('PDF', String(e?.message || e), 'err'));

  return (
    <MCard className="modal-lg">
      <MHead icon="📤" title="Отправить ТКП клиенту" subtitle={`#${tkp.id} · ${tkp.customer_name || ''}`} accent="gold" onClose={close} />
      <MBody>
        <div className="grid-2 gap-16">
          <div className="col gap-10">
            <Field label="Кому" required>
              <TextInput value={form.to} onChange={(v) => setForm({ ...form, to: v })} placeholder="email@company.ru" />
            </Field>
            <Field label="Копия (Cc)" help="Можно через запятую">
              <TextInput value={form.cc} onChange={(v) => setForm({ ...form, cc: v })} />
            </Field>
            <Field label="Тема">
              <TextInput value={form.subject} onChange={(v) => setForm({ ...form, subject: v })} />
            </Field>
            <Field label="Текст письма">
              <TextareaInput value={form.body} onChange={(v) => setForm({ ...form, body: v })} minRows={6} maxRows={14} />
            </Field>
          </div>
          <div className="col gap-10">
            <div className="p-12 bg-inner r-md">
              <div style={{ fontSize: 11, color: 'var(--t-3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                Вложение PDF
              </div>
              <Checkbox checked={form.attach_signature} onChange={(v) => setForm({ ...form, attach_signature: v })} label="Включить подпись" />
              <div style={{ height: 6 }} />
              <Checkbox checked={form.attach_stamp} onChange={(v) => setForm({ ...form, attach_stamp: v })} label="Включить печать" />
              <div className="mt-10">
                <button type="button" onClick={openPreview} style={{ fontSize: 12.5, color: 'var(--gold)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                  👁 Открыть превью PDF
                </button>
              </div>
            </div>
            <div style={{ padding: 12, background: 'var(--gold-bg)', borderRadius: 'var(--r-md)', fontSize: 12.5, color: 'var(--t-2)' }}>
              💡 Письмо уйдёт с корпоративной почты. Получатель увидит твоё ТКП как PDF-вложение.
              <br /><br />Если в карточке заполнен email заказчика — он подставится автоматически.
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

function buildEmailBody(tkp) {
  if (!tkp) return '';
  const greet = tkp.contact_person ? `Здравствуйте, ${tkp.contact_person.split(' ')[0]}!` : 'Добрый день!';
  return [
    greet,
    '',
    `Во вложении направляем технико-коммерческое предложение${tkp.tkp_number ? ` № ${tkp.tkp_number}` : ''}` +
      (tkp.subject ? ` по теме «${tkp.subject}»` : '') + '.',
    '',
    'Готовы обсудить любые детали и при необходимости скорректировать предложение.',
    '',
    'С уважением,',
    tkp.author_name || ''
  ].join('\n');
}
