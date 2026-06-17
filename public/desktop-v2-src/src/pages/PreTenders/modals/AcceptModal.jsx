/**
 * AcceptModal + FastTrackModal + RejectModal + RequestDocsModal + CreateManualModal.
 * Источник: openAcceptModal, openFastTrackModal, openRejectModal, openCreateManual в pre_tenders.js.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, INNInput, PhoneInput, TextareaInput, DatePicker, MoneyInput, SelectInput, Checkbox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { accept, fastTrack, reject, requestDocs, createManual, loadPms, REJECT_REASONS } from '../api';

export function AcceptModal({ preTender }) {
  const { close } = useModal();
  const [form, setForm] = useState({ assigned_pm_id: '', contact_person: preTender.contact_person || '', contact_phone: preTender.contact_phone || '', comment: '', send_email: true });
  const [pms, setPms] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadPms().then(setPms); }, []);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await accept(preTender.id, form);
      if (res?.pending_approval) {
        toast('🔔 На согласовании', 'Директор должен подтвердить', 'ok');
      } else {
        toast('✓ Принято', `Тендер #${res?.tender_id || ''} создан`, 'ok');
      }
      window.dispatchEvent(new CustomEvent('asgard:pre-tenders:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-md">
      <MHead icon="✓" title="Принять заявку" subtitle={preTender.customer_name} accent="green" onClose={close} />
      <MBody>
        <div className="col gap-10">
          <Field label="Назначить РП (опционально)">
            <SelectInput value={form.assigned_pm_id} onChange={(v) => setForm({ ...form, assigned_pm_id: v })} options={[{ value: '', label: '— назначим позже —' }, ...pms.map((u) => ({ value: String(u.id), label: u.name || u.login }))]} />
          </Field>
          <Field label="Контактное лицо"><TextInput value={form.contact_person} onChange={(v) => setForm({ ...form, contact_person: v })} /></Field>
          <Field label="Телефон"><PhoneInput value={form.contact_phone} onChange={(v) => setForm({ ...form, contact_phone: v })} /></Field>
          <Field label="Комментарий"><TextareaInput value={form.comment} onChange={(v) => setForm({ ...form, comment: v })} minRows={2} maxRows={4} /></Field>
          <Checkbox checked={form.send_email} onChange={(v) => setForm({ ...form, send_email: v })} label="📧 Отправить заказчику письмо «принято в работу»" />
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Принимаем…' : '✓ Подтвердить'}</Btn>
      </MFoot>
    </MCard>
  );
}

export function FastTrackModal({ preTender }) {
  const { close } = useModal();
  const [form, setForm] = useState({ pm_id: '', contact_person: preTender.contact_person || '', contact_phone: preTender.contact_phone || '', comment: '', send_email: true });
  const [pms, setPms] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadPms().then(setPms); }, []);

  const submit = async () => {
    if (!form.pm_id) return toast('РП', 'Обязательно выбери РП для быстрого пути', 'warn');
    setBusy(true);
    try {
      const res = await fastTrack(preTender.id, form);
      toast('🚀 Запущено', `Тендер #${res?.tender_id || ''} → РП на просчёт`, 'ok');
      window.dispatchEvent(new CustomEvent('asgard:pre-tenders:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-md">
      <MHead icon="🚀" title="Быстрый путь" subtitle="Принять + сразу назначить РП на просчёт" accent="gold" onClose={close} />
      <MBody>
        <div style={{ padding: 10, background: 'var(--gold-bg)', borderRadius: 'var(--r-sm)', fontSize: 12.5, marginBottom: 12, color: 'var(--t-2)' }}>
          💡 Тендер создастся в статусе «in_calc» сразу с назначенным РП. Письмо РП уйдёт автоматически.
        </div>
        <div className="col gap-10">
          <Field label="РП на просчёт" required>
            <SelectInput value={form.pm_id} onChange={(v) => setForm({ ...form, pm_id: v })} options={[{ value: '', label: '— выбрать —' }, ...pms.map((u) => ({ value: String(u.id), label: u.name || u.login }))]} />
          </Field>
          <Field label="Контактное лицо"><TextInput value={form.contact_person} onChange={(v) => setForm({ ...form, contact_person: v })} /></Field>
          <Field label="Телефон"><PhoneInput value={form.contact_phone} onChange={(v) => setForm({ ...form, contact_phone: v })} /></Field>
          <Field label="Комментарий для РП"><TextareaInput value={form.comment} onChange={(v) => setForm({ ...form, comment: v })} minRows={2} maxRows={4} /></Field>
          <Checkbox checked={form.send_email} onChange={(v) => setForm({ ...form, send_email: v })} label="📧 Отправить заказчику письмо" />
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Запускаем…' : '🚀 Запустить'}</Btn>
      </MFoot>
    </MCard>
  );
}

export function RejectModal({ preTender }) {
  const { close } = useModal();
  const [form, setForm] = useState({ reject_reason: '', comment: '', send_email: true });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.reject_reason) return toast('Причина', 'Выбери причину отказа', 'warn');
    setBusy(true);
    try {
      await reject(preTender.id, form);
      toast('Отклонено', preTender.customer_name || '', 'info');
      window.dispatchEvent(new CustomEvent('asgard:pre-tenders:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-md">
      <MHead icon="✗" title="Отклонить заявку" subtitle={preTender.customer_name} accent="red" onClose={close} />
      <MBody>
        <div className="col gap-10">
          <Field label="Причина отказа" required>
            <SelectInput value={form.reject_reason} onChange={(v) => setForm({ ...form, reject_reason: v })} options={[{ value: '', label: '— выбрать —' }, ...REJECT_REASONS]} />
          </Field>
          <Field label="Комментарий (в письмо)"><TextareaInput value={form.comment} onChange={(v) => setForm({ ...form, comment: v })} minRows={2} maxRows={5} /></Field>
          <Checkbox checked={form.send_email} onChange={(v) => setForm({ ...form, send_email: v })} label="📧 Отправить заказчику вежливый отказ" />
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Отклоняем…' : 'Отклонить'}</Btn>
      </MFoot>
    </MCard>
  );
}

export function RequestDocsModal({ preTender }) {
  const { close } = useModal();
  const [comment, setComment] = useState(`Добрый день!\n\nДля подготовки коммерческого предложения нам понадобятся следующие документы:\n\n1. \n2. \n3. \n\nС уважением,\nАсгард`);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await requestDocs(preTender.id, { comment });
      toast('📁 Запрос отправлен', preTender.customer_email, 'ok');
      window.dispatchEvent(new CustomEvent('asgard:pre-tenders:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-md">
      <MHead icon="📁" title="Запросить документы" subtitle={preTender.customer_email || ''} onClose={close} />
      <MBody>
        <Field label="Текст письма заказчику"><TextareaInput value={comment} onChange={setComment} minRows={6} maxRows={12} /></Field>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Отправляем…' : '📁 Отправить запрос'}</Btn>
      </MFoot>
    </MCard>
  );
}

export function CreateManualModal({ onCreated }) {
  const { close } = useModal();
  const [form, setForm] = useState({
    customer_name: '', work_description: '', customer_email: '', customer_inn: '',
    contact_person: '', contact_phone: '', work_location: '', work_deadline: '', estimated_sum: ''
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.customer_name?.trim()) return toast('Заказчик', '—', 'warn');
    if (!form.work_description?.trim()) return toast('Описание', '—', 'warn');
    setBusy(true);
    try {
      const res = await createManual({
        ...form,
        estimated_sum: form.estimated_sum ? Number(form.estimated_sum) : null
      });
      toast('Создано', `Заявка #${res?.pre_tender?.id || res?.id || ''}`, 'ok');
      onCreated?.(res?.pre_tender?.id || res?.id);
      window.dispatchEvent(new CustomEvent('asgard:pre-tenders:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-md">
      <MHead icon="+" title="Создать заявку вручную" onClose={close} />
      <MBody>
        <div className="col gap-10">
          <Field label="Заказчик" required><TextInput value={form.customer_name} onChange={(v) => setForm({ ...form, customer_name: v })} /></Field>
          <Field label="Описание работы" required><TextareaInput value={form.work_description} onChange={(v) => setForm({ ...form, work_description: v })} minRows={3} maxRows={6} /></Field>
          <div className="grid-2 gap-8">
            <Field label="Email"><TextInput value={form.customer_email} onChange={(v) => setForm({ ...form, customer_email: v })} /></Field>
            <Field label="ИНН"><INNInput value={form.customer_inn} onChange={(v) => setForm({ ...form, customer_inn: v })} /></Field>
            <Field label="Контакт"><TextInput value={form.contact_person} onChange={(v) => setForm({ ...form, contact_person: v })} /></Field>
            <Field label="Телефон"><PhoneInput value={form.contact_phone} onChange={(v) => setForm({ ...form, contact_phone: v })} /></Field>
            <Field label="Место"><TextInput value={form.work_location} onChange={(v) => setForm({ ...form, work_location: v })} /></Field>
            <Field label="Дедлайн"><DatePicker value={form.work_deadline} onChange={(v) => setForm({ ...form, work_deadline: v })} /></Field>
          </div>
          <Field label="Оценка суммы"><MoneyInput value={form.estimated_sum} onChange={(v) => setForm({ ...form, estimated_sum: v })} /></Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Создаём…' : '+ Создать'}</Btn>
      </MFoot>
    </MCard>
  );
}
