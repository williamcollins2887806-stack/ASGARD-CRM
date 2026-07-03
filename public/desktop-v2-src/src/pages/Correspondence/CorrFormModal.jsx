/**
 * CorrFormModal — создание/редактирование документа корреспонденции.
 *
 * Источник vanilla: openAddModal() + openEditModal() в correspondence.js.
 *
 * Поведение:
 *   - direction передаётся при создании, при редактировании берётся из item.direction.
 *   - Для исходящих номер генерируется сервером (предпросмотр через /next-outgoing-number);
 *     для входящих — вводится вручную.
 *   - При сохранении: опционально загружаем файл через /api/files/upload, потом link-doc.
 *   - При редактировании исходящего с присвоенным номером — поля «дата» и «номер» залочены.
 *   - Привязка к заказчику/тендеру/работе — опционально.
 */
import { useEffect, useState, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, TextareaInput, SelectInput, Combobox, FileDrop } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { openProtected } from '@/api/download';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

import {
  DIRECTIONS, DOC_TYPES, LETTER_KINDS,
  getNextOutgoingNumber, createOne, updateOne,
  uploadFile, linkDoc, mimirSuggestForm,
  loadCustomers, loadTenders, loadWorks,
  today, fmtDate
} from './api';

// Опции letter_kind для inline-формы. Полный UX (с автозаполнением doc_title/sub) — в composer (S-13H).
const LETTER_KIND_OPTIONS = [
  { value: '', label: '— не указан —' },
  ...Object.entries(LETTER_KINDS).map(([value, label]) => ({ value, label }))
];

/** Преобразовать parent_entity_type → имя поля в payload. */
function parentToField(type) {
  switch (type) {
    case 'tender':                 return 'tender_id';
    case 'work':                   return 'work_id';
    case 'calc':                   return 'calc_id';
    case 'pre_tender':
    case 'request':                return 'pre_tender_id';
    default:                       return null;
  }
}

/** Алиас vanilla openAddModal — пустой враппер для совместимости имён в аудите. */
export function AddModal(props) { return <CorrFormModal {...props} />; }
/** Алиас vanilla openEditModal — пустой враппер. */
export function EditModal(props) { return <CorrFormModal {...props} />; }

export function CorrFormModal({ direction: dirArg = 'incoming', item: editItem = null, parentFilter = null, onSaved }) {
  const { close } = useModal();
  const isEdit = !!editItem;
  const direction = isEdit ? editItem.direction : dirArg;
  const dir = DIRECTIONS[direction] || DIRECTIONS.incoming;
  const isOutgoing = direction === 'outgoing';
  // V252: финализированное / отправленное письмо нельзя редактировать (создаётся new-revision).
  // Backend это сам проверяет на PUT, фронт даёт ранний понятный сигнал.
  const lockedBySigning = isEdit && editItem.signing_status && editItem.signing_status !== 'draft';
  const lockOutgoingIdentity = isEdit && isOutgoing && !!editItem.number;

  /* — Поля формы — */
  const [date, setDate] = useState(() => (editItem?.date || '').slice(0, 10) || today());
  const [number, setNumber] = useState(editItem?.number || '');
  const [docType, setDocType] = useState(editItem?.doc_type || 'letter');
  const [letterKind, setLetterKind] = useState(editItem?.letter_kind || (isOutgoing ? 'free' : ''));
  const [subject, setSubject] = useState(editItem?.subject || '');
  const [counterparty, setCounterparty] = useState(editItem?.counterparty || '');
  const [contact, setContact] = useState(editItem?.contact_person || '');
  const [note, setNote] = useState(editItem?.note || '');
  // Предзаполнить parent_entity_id из URL-фильтра (если есть и не редактируем).
  const initialFromParent = !isEdit && parentFilter ? parentFilter : null;
  const [customerId, setCustomerId] = useState(editItem?.customer_id || '');
  const [tenderId, setTenderId] = useState(
    editItem?.tender_id ||
    (initialFromParent?.type === 'tender' ? initialFromParent.id : '')
  );
  const [workId, setWorkId] = useState(
    editItem?.work_id ||
    (initialFromParent?.type === 'work' ? initialFromParent.id : '')
  );
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [mimirBusy, setMimirBusy] = useState(false);

  /* — Справочники для привязки — */
  const [customers, setCustomers] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [works, setWorks] = useState([]);

  useEffect(() => {
    loadCustomers().then(setCustomers);
    loadTenders().then(setTenders);
    loadWorks().then(setWorks);
  }, []);

  /* — Предпросмотр исходящего номера — */
  useEffect(() => {
    if (!isOutgoing || isEdit) return;
    getNextOutgoingNumber(date).then(setNumber);
  }, [isOutgoing, isEdit, date]);

  /* — Опции для Combobox — */
  const customerOptions = useMemo(
    () => customers.map((c) => ({
      value: c.id,
      label: `${c.name || c.title || c.full_name || '—'} ${c.inn ? '· ИНН ' + c.inn : ''}`
    })),
    [customers]
  );

  const tenderOptions = useMemo(
    () => tenders.map((t) => ({
      value: t.id,
      label: `№${t.id} ${t.tender_title || t.title || ''}${t.customer ? ' · ' + t.customer : ''}`
    })),
    [tenders]
  );

  const workOptions = useMemo(
    () => works.map((w) => ({
      value: w.id,
      label: `№${w.id} ${w.title || w.work_title || w.tender_title || ''}`
    })),
    [works]
  );

  const askMimir = async () => {
    setMimirBusy(true);
    try {
      const existing = {};
      if (subject)      existing.subject = subject;
      if (note)         existing.note = note;
      if (counterparty) existing.counterparty = counterparty;
      if (contact)      existing.contact_person = contact;
      const res = await mimirSuggestForm({ direction, existing_fields: existing });
      const fields = res?.fields || {};
      let filled = 0;
      if (fields.subject       && !subject)      { setSubject(fields.subject); filled++; }
      if (fields.note          && !note)         { setNote(fields.note); filled++; }
      if (fields.counterparty  && !counterparty) { setCounterparty(fields.counterparty); filled++; }
      if (fields.contact_person && !contact)     { setContact(fields.contact_person); filled++; }
      if (filled > 0) toast.success(`Мимир заполнил ${filled} полей`);
      else toast.info('Мало контекста — заполни тему или контрагента, Мимир поможет');
    } catch (e) {
      toast.error('Мимир не ответил: ' + (e?.message || e));
    } finally {
      setMimirBusy(false);
    }
  };

  const submit = async () => {
    if (!subject.trim()) {
      toast.warn('Укажите тему документа');
      return;
    }
    setSaving(true);
    try {
      let filePath = null;
      let docId = null;
      if (file) {
        // G-5: размер/тип вложения на клиенте.
        try {
          validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.zip,.rar' });
        } catch (vErr) {
          toast.error(vErr?.message || 'Файл не подходит');
          setSaving(false);
          return;
        }
        try {
          const uploaded = await uploadFile(file, 'Корреспонденция');
          filePath = uploaded?.download_url || uploaded?.filename || null;
          docId = uploaded?.file?.id || uploaded?.id || null;
        } catch (e) {
          toast.error('Файл не загружен: ' + (e?.message || e));
        }
      }

      const payload = {
        direction,
        date,
        doc_type: docType,
        subject: subject.trim(),
        counterparty: counterparty.trim(),
        contact_person: contact.trim(),
        note: note.trim()
      };
      if (filePath) payload.file_path = filePath;
      if (!isOutgoing) payload.number = number.trim();
      if (customerId) payload.customer_id = customerId;
      if (tenderId)   payload.tender_id = tenderId;
      if (workId)     payload.work_id = workId;
      // V252.letter_kind — для исходящих, чтобы на бэке корректно отрабатывал шаблон письма.
      if (isOutgoing && letterKind) payload.letter_kind = letterKind;
      // Если форма открыта с URL-фильтром по родителю (pre_tender/calc) — пробрасываем.
      if (initialFromParent && parentToField(initialFromParent.type)) {
        const f = parentToField(initialFromParent.type);
        if (f && !payload[f]) payload[f] = initialFromParent.id;
      }

      let res;
      if (isEdit) {
        res = await updateOne(editItem.id, payload);
      } else {
        res = await createOne(payload);
      }

      const savedId = res?.item?.id || res?.id || editItem?.id;
      if (docId && savedId) {
        try { await linkDoc(savedId, docId); } catch { /* noop */ }
      }

      toast.success(isEdit ? 'Документ обновлён' : 'Документ создан');
      window.dispatchEvent(new CustomEvent('asgard:correspondence:changed'));
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon={dir.icon}
        title={isEdit ? `Документ #${editItem.id}` : `Новый ${dir.label.toLowerCase()} документ`}
        subtitle={isEdit ? `Создан: ${fmtDate(editItem.created_at)}` : dir.label}
        onClose={close}
      />
      <MBody>
        {lockedBySigning && (
          <div className="corr-revision-banner" style={{ marginBottom: 12 }}>
            <span>🔒</span>
            <span>
              Письмо <b>{editItem.signing_status === 'sent' ? 'отправлено' : 'финализировано'}</b>.
              Изменения нельзя сохранить — закройте форму и создайте <b>новую редакцию</b>.
            </span>
          </div>
        )}
        <div className="corr-form-grid">
          <Field label="Дата" required>
            <input
              type="date"
              value={date}
              onChange={(ev) => setDate(ev.target.value)}
              disabled={lockOutgoingIdentity}
              style={{
                padding: '8px 10px', background: lockOutgoingIdentity ? 'var(--inner-bg)' : 'var(--card-bg)',
                color: 'var(--t-1)', border: '1px solid var(--brd-2)', borderRadius: 'var(--r-sm)',
                fontSize: 13, width: '100%'
              }}
            />
          </Field>
          <Field
            label={isOutgoing ? 'Номер (сервер выдаст)' : 'Номер'}
            help={isOutgoing ? 'Будет присвоен при сохранении' : undefined}
          >
            <TextInput
              value={number}
              onChange={setNumber}
              disabled={isOutgoing || lockOutgoingIdentity}
              placeholder={isOutgoing ? 'Авто' : 'Вх. №…'}
            />
          </Field>

          <Field label="Тип документа">
            <SelectInput value={docType} onChange={setDocType} options={DOC_TYPES} />
          </Field>
          {isOutgoing ? (
            <Field label="Тип письма" help="Влияет на шапку шаблона ГНШ">
              <SelectInput value={letterKind} onChange={setLetterKind} options={LETTER_KIND_OPTIONS} />
            </Field>
          ) : (
            <Field label={isOutgoing ? 'Получатель' : 'Отправитель'}>
              <TextInput value={counterparty} onChange={setCounterparty} placeholder="Организация или ФИО" />
            </Field>
          )}
          {isOutgoing && (
            <div className="span-2">
              <Field label="Получатель">
                <TextInput value={counterparty} onChange={setCounterparty} placeholder="Организация или ФИО" />
              </Field>
            </div>
          )}

          <div className="span-2">
            <Field label="Тема" required>
              <TextInput value={subject} onChange={setSubject} placeholder="О чём документ…" />
            </Field>
          </div>

          <Field label="Контактное лицо">
            <TextInput value={contact} onChange={setContact} placeholder="ФИО + телефон" />
          </Field>
          <Field label="Заказчик" help="Привязать к карточке заказчика">
            <Combobox value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="Выбрать заказчика…" />
          </Field>

          <Field label="Тендер" help="Опциональная привязка">
            <Combobox value={tenderId} onChange={setTenderId} options={tenderOptions} placeholder="Выбрать тендер…" />
          </Field>
          <Field label="Работа" help="Опциональная привязка">
            <Combobox value={workId} onChange={setWorkId} options={workOptions} placeholder="Выбрать работу…" />
          </Field>

          <div className="span-2">
            <Field label="Примечание">
              <TextareaInput value={note} onChange={setNote} minRows={2} maxRows={6} placeholder="Дополнительная информация…" />
            </Field>
          </div>

          <div className="span-2">
            <Field label="📎 Вложение (скан / PDF / Word / Excel)">
              {editItem?.file_path && (
                <div className="corr-attachment-row">
                  <span>📄</span>
                  {/* G-5: blob-download через Authorization header (file_path = /api/files/download/...) */}
                  <button
                    type="button"
                    className="file-link"
                    style={{ background: 'none', border: 0, padding: 0, color: 'var(--gold)', cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() =>
                      openProtected(editItem.file_path, (editItem.file_path.split('/').pop() || 'attachment'))
                        .catch((err) => toast.error('Файл: ' + (err?.message || err)))
                    }
                  >
                    Скачать текущий файл
                  </button>
                </div>
              )}
              <FileDrop
                multiple={false}
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.zip,.rar"
                hint="Перетащите файл или нажмите для выбора"
                onFiles={(fs) => setFile(fs[0])}
              />
              {file && (
                <div className="mt-6 p-6 bg-inner r-sm fs-12">
                  📎 {file.name} <span className="c-t3">({(file.size / 1024).toFixed(1)} КБ)</span>
                </div>
              )}
            </Field>
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <div className="flex-1" />
        <Btn variant="ghost" disabled={mimirBusy} onClick={askMimir} title="Мимир заполнит часть полей">
          {mimirBusy ? '⏳ Мимир думает…' : '🧙 Мимир заполнит'}
        </Btn>
        <Btn variant="primary" disabled={saving || lockedBySigning} onClick={submit} title={lockedBySigning ? 'Используйте «Новая редакция»' : undefined}>
          {saving ? '⏳ Сохраняем…' : (isEdit ? 'Сохранить' : 'Создать')}
        </Btn>
      </MFoot>
    </MCard>
  );
}
