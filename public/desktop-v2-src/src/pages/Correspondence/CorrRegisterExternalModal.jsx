/**
 * Регистрация исходящего письма, созданного вне CRM (ручной Исх.№ + скан).
 */
import { useEffect, useState, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, TextareaInput, SelectInput, Combobox, FileDrop } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';
import { useDebounce } from '@/api/useListHelpers';

import {
  DOC_TYPES, LETTER_KINDS, registerExternalCorrespondence,
  checkOutgoingNumber, uploadFile, linkDoc,
  loadCustomers, loadTenders, loadWorks, today
} from './api';

const LETTER_KIND_OPTIONS = [
  { value: 'free', label: 'Свободный формат' },
  ...Object.entries(LETTER_KINDS).map(([value, label]) => ({ value, label }))
];

const STATUS_OPTIONS = [
  { value: 'finalized', label: 'Финализировано (ещё не отправлено)' },
  { value: 'sent', label: 'Уже отправлено' }
];

const CHANNEL_OPTIONS = [
  { value: 'manual', label: 'Вручную (почта / курьер)' },
  { value: 'edo', label: 'ЭДО' },
  { value: 'email_external', label: 'Email вне CRM' }
];

export function CorrRegisterExternalModal({ parentFilter = null, onSaved }) {
  const { close } = useModal();
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(today());
  const [sentAt, setSentAt] = useState(today());
  const [signingStatus, setSigningStatus] = useState('sent');
  const [sentChannel, setSentChannel] = useState('manual');
  const [subject, setSubject] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [docType, setDocType] = useState('letter');
  const [letterKind, setLetterKind] = useState('free');
  const [customerId, setCustomerId] = useState('');
  const [tenderId, setTenderId] = useState(parentFilter?.type === 'tender' ? String(parentFilter.id) : '');
  const [workId, setWorkId] = useState(parentFilter?.type === 'work' ? String(parentFilter.id) : '');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [numberCheck, setNumberCheck] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [works, setWorks] = useState([]);

  const dNumber = useDebounce(number, 400);

  useEffect(() => {
    loadCustomers().then(setCustomers);
    loadTenders().then(setTenders);
    loadWorks().then(setWorks);
  }, []);

  useEffect(() => {
    const n = (dNumber || '').trim();
    if (!n) {
      setNumberCheck(null);
      return;
    }
    checkOutgoingNumber(n).then(setNumberCheck).catch(() => setNumberCheck(null));
  }, [dNumber]);

  const customerOptions = useMemo(
    () => customers.map((c) => ({
      value: c.id,
      label: `${c.name || c.title || '—'} ${c.inn ? '· ИНН ' + c.inn : ''}`
    })),
    [customers]
  );
  const tenderOptions = useMemo(
    () => tenders.map((t) => ({ value: t.id, label: `№${t.id} ${t.tender_title || t.title || ''}` })),
    [tenders]
  );
  const workOptions = useMemo(
    () => works.map((w) => ({ value: w.id, label: `№${w.id} ${w.title || w.work_title || ''}` })),
    [works]
  );

  const submit = async () => {
    if (!number.trim()) {
      toast.warn('Укажите исходящий номер с бланка');
      return;
    }
    if (numberCheck && !numberCheck.available) {
      toast.error(`Номер «${number}» уже занят (документ #${numberCheck.conflict_id})`);
      return;
    }
    if (!subject.trim()) {
      toast.warn('Укажите тему');
      return;
    }
    if (!counterparty.trim()) {
      toast.warn('Укажите получателя');
      return;
    }
    if (!file) {
      toast.warn('Приложите скан подписанного бланка');
      return;
    }
    setSaving(true);
    try {
      validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' });
      const uploaded = await uploadFile(file, 'Корреспонденция');
      const filePath = uploaded?.download_url || uploaded?.filename || null;
      const payload = {
        number: number.trim(),
        date,
        subject: subject.trim(),
        counterparty: counterparty.trim(),
        contact_person: contact.trim() || null,
        note: note.trim() || null,
        doc_type: docType,
        letter_kind: letterKind,
        signing_status: signingStatus,
        file_path: filePath,
        sent_channel: sentChannel,
        customer_id: customerId || null,
        tender_id: tenderId || null,
        work_id: workId || null
      };
      if (signingStatus === 'sent') {
        payload.sent_at = sentAt;
      }
      const resp = await registerExternalCorrespondence(payload);
      const newId = resp?.id || resp?.item?.id;
      if (newId && uploaded?.document_id) {
        await linkDoc(newId, uploaded.document_id).catch(() => {});
      }
      toast.success('Письмо зарегистрировано · № ' + (resp?.item?.number || number));
      window.dispatchEvent(new CustomEvent('asgard:correspondence:changed'));
      onSaved?.();
      close();
    } catch (e) {
      toast.error(e?.message || 'Не удалось зарегистрировать');
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="📋" title="Зарегистрировать вне CRM" subtitle="Исходящее с готовым Исх.№" onClose={close} />
      <MBody>
        <div className="form-grid cols-2">
          <Field label="Исх. номер (с бланка)" required>
            <TextInput value={number} onChange={setNumber} placeholder="АС-2026-07-042" />
            {numberCheck && !numberCheck.available && (
              <div className="fs-12" style={{ color: 'var(--err)', marginTop: 4 }}>
                Номер занят — документ #{numberCheck.conflict_id}
              </div>
            )}
            {numberCheck && numberCheck.available && number.trim() && (
              <div className="fs-12 c-t3" style={{ marginTop: 4 }}>Номер свободен</div>
            )}
          </Field>
          <Field label="Дата письма" required>
            <TextInput type="date" value={date} onChange={setDate} />
          </Field>
          <Field label="Статус при регистрации">
            <SelectInput value={signingStatus} onChange={setSigningStatus} options={STATUS_OPTIONS} />
          </Field>
          {signingStatus === 'sent' && (
            <>
              <Field label="Дата отправки">
                <TextInput type="date" value={sentAt} onChange={setSentAt} />
              </Field>
              <Field label="Способ отправки">
                <SelectInput value={sentChannel} onChange={setSentChannel} options={CHANNEL_OPTIONS} />
              </Field>
            </>
          )}
          <Field label="Тип документа">
            <SelectInput value={docType} onChange={setDocType} options={DOC_TYPES} />
          </Field>
          <Field label="Тип письма">
            <SelectInput value={letterKind} onChange={setLetterKind} options={LETTER_KIND_OPTIONS} />
          </Field>
          <div className="span-2">
            <Field label="Тема" required>
              <TextInput value={subject} onChange={setSubject} />
            </Field>
          </div>
          <Field label="Получатель" required>
            <TextInput value={counterparty} onChange={setCounterparty} />
          </Field>
          <Field label="Контактное лицо">
            <TextInput value={contact} onChange={setContact} />
          </Field>
          <Field label="Заказчик">
            <Combobox value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="Выбрать…" />
          </Field>
          <Field label="Тендер">
            <Combobox value={tenderId} onChange={setTenderId} options={tenderOptions} placeholder="Выбрать…" />
          </Field>
          <div className="span-2">
            <Field label="Примечание">
              <TextareaInput value={note} onChange={setNote} minRows={2} />
            </Field>
          </div>
          <div className="span-2">
            <Field label="Скан подписанного бланка" required>
              <FileDrop
                multiple={false}
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                hint="PDF, JPG или Word — обязательно"
                onFiles={(fs) => setFile(fs[0])}
              />
              {file && <div className="fs-12 c-t3 mt-6">{file.name}</div>}
            </Field>
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Сохраняем…' : 'Зарегистрировать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
