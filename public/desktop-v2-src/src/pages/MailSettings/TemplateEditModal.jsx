/**
 * Модалка создания email-шаблона.
 * POST /api/mailbox/templates
 *   { code, name, category, subject_template, body_template, use_letterhead, default_cc }
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, TextareaInput, SelectInput, Switch } from '@/inputs/Inputs';

import { TPL_CATEGORIES, createTemplate } from './api';

export function TemplateEditModal({ onSaved }) {
  const { close } = useModal();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [category, setCategory] = useState('custom');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [useLetterhead, setUseLetterhead] = useState(false);
  const [defaultCc, setDefaultCc] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.warn('Укажите название шаблона');
      return;
    }
    setSaving(true);
    try {
      await createTemplate({
        name: name.trim(),
        code: code.trim() || undefined,
        category,
        subject_template: subject.trim(),
        body_template: body.trim(),
        use_letterhead: useLetterhead,
        default_cc: defaultCc.trim() || null
      });
      toast.success('Шаблон создан');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead icon="＋" title="Новый шаблон письма" onClose={close} />
      <MBody>
        <div className="ms-formgrid">
          <Field label="Название" required>
            <TextInput value={name} onChange={setName} placeholder="ТКП клиенту (черновик)" />
          </Field>
          <Field label="Код (опционально)" help="латиница/цифры/_, авто если пусто">
            <TextInput value={code} onChange={setCode} placeholder="tkp_draft" />
          </Field>
          <div className="span-2">
            <Field label="Категория">
              <SelectInput value={category} onChange={setCategory} options={TPL_CATEGORIES} />
            </Field>
          </div>
          <div className="span-2">
            <Field label="Тема">
              <TextInput
                value={subject}
                onChange={setSubject}
                placeholder="ТКП по запросу № {{tender_number}}"
              />
            </Field>
          </div>
          <div className="span-2">
            <Field label="Тело (HTML или текст)">
              <TextareaInput
                value={body}
                onChange={setBody}
                minRows={6}
                maxRows={14}
                placeholder="Уважаемый {{customer_name}}, … {{calc_total}} ₽ …"
              />
            </Field>
          </div>
          <div className="span-2">
            <Field label="Default CC (через запятую)">
              <TextInput value={defaultCc} onChange={setDefaultCc} placeholder="boss@company.ru" />
            </Field>
          </div>
          <div className="span-2">
            <Switch
              checked={useLetterhead}
              onChange={setUseLetterhead}
              label="Оборачивать в фирменный бланк"
            />
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving}>
          {saving ? 'Сохраняем…' : 'Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
