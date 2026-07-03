/**
 * HeaderForm.jsx — поля шапки официального письма ГНШ-формата.
 *
 * Контракт §1, §3 — letter_kind, doc_title, doc_sub, header_subline,
 * procedure_number, lot_number, lot_title, counterparty, contact_person.
 *
 * При выборе kind — подставляются дефолты title/sub/subline, но юзер может
 * их перезаписать. Каждое поле — controlled, изменения уходят через onChange.
 */
import { Field, TextInput, TextareaInput, SelectInput } from '@/inputs/Inputs';

export function HeaderForm({ draft, onChange, kinds, disabled }) {
  const kindOptions = [
    { value: '', label: 'Выбрать тип…' },
    ...kinds.map((k) => ({ value: k.key, label: k.title || k.key }))
  ];

  const handleKind = (key) => {
    const kind = kinds.find((k) => k.key === key);
    // Если пользователь уже заполнил title/sub/subline — НЕ перезатираем.
    const patch = { letter_kind: key || 'free' };
    if (kind) {
      if (!draft.doc_title)      patch.doc_title      = kind.title || '';
      if (!draft.doc_sub)        patch.doc_sub        = kind.sub || '';
      if (!draft.header_subline) patch.header_subline = kind.subline || '';
    }
    onChange(patch);
  };

  return (
    <div className="col gap-10" style={{ padding: '4px 2px' }}>
      <div style={{
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 1,
        color: 'var(--t-3)',
        marginBottom: 2
      }}>
        Шапка письма
      </div>

      <Field label="Тип письма">
        <SelectInput
          value={draft.letter_kind || ''}
          onChange={handleKind}
          options={kindOptions}
          disabled={disabled}
        />
      </Field>

      <Field label="Заголовок документа">
        <TextInput
          value={draft.doc_title || ''}
          onChange={(v) => onChange({ doc_title: v })}
          placeholder="напр. ПОЯСНЕНИЯ К ЦЕНОВОМУ ПРЕДЛОЖЕНИЮ"
          disabled={disabled}
        />
      </Field>

      <Field label="Подзаголовок (курсив)">
        <TextInput
          value={draft.doc_sub || ''}
          onChange={(v) => onChange({ doc_sub: v })}
          placeholder="напр. (об обстоятельствах, исключающих снижение цены)"
          disabled={disabled}
        />
      </Field>

      <Field label="Под-префикс шапки (под Исх.№)">
        <TextareaInput
          value={draft.header_subline || ''}
          onChange={(v) => onChange({ header_subline: v })}
          minRows={1}
          maxRows={3}
          placeholder="напр. по дополнительному запросу Организатора"
          disabled={disabled}
        />
      </Field>

      <div className="grid-2 gap-8">
        <Field label="№ процедуры">
          <TextInput
            value={draft.procedure_number || ''}
            onChange={(v) => onChange({ procedure_number: v })}
            placeholder="01-3012707-523-2026"
            disabled={disabled}
          />
        </Field>
        <Field label="№ лота">
          <TextInput
            value={draft.lot_number || ''}
            onChange={(v) => onChange({ lot_number: v })}
            placeholder="5855-3014050-2026"
            disabled={disabled}
          />
        </Field>
      </div>

      <Field label="Название лота">
        <TextareaInput
          value={draft.lot_title || ''}
          onChange={(v) => onChange({ lot_title: v })}
          minRows={1}
          maxRows={3}
          placeholder="Выполнение СМР по замене оголовка…"
          disabled={disabled}
        />
      </Field>

      <Field label="Тема письма" required>
        <TextInput
          value={draft.subject || ''}
          onChange={(v) => onChange({ subject: v })}
          placeholder="О предоставлении пояснений по лоту 5855"
          disabled={disabled}
        />
      </Field>

      <Field label="Заказчик / Контрагент" required>
        <TextInput
          value={draft.counterparty || ''}
          onChange={(v) => onChange({ counterparty: v })}
          placeholder="ООО «Газпром нефть шельф»"
          disabled={disabled}
        />
      </Field>

      <Field label="Адресат (кому)">
        <TextInput
          value={draft.contact_person || ''}
          onChange={(v) => onChange({ contact_person: v })}
          placeholder="Организатору конкурентного отбора"
          disabled={disabled}
        />
      </Field>
    </div>
  );
}
