/**
 * Прикрепление доверенности, созданной вне CRM.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, DatePicker, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  PROXY_TYPES, STATUS_OPTIONS, createProxy, uploadProxyFile, nextNumber
} from './api';

function emit() { window.dispatchEvent(new CustomEvent('asgard:proxies:changed')); }

export function ProxyExternalModal({ onSaved }) {
  const { close } = useModal();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    type_id: 'custom',
    number: '',
    issue_date: today,
    valid_until: '',
    fio: '',
    status: 'issued',
    comment: ''
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!form.fio.trim()) {
      toast.error('Укажите ФИО представителя');
      return;
    }
    if (!file) {
      toast.error('Прикрепите файл доверенности');
      return;
    }
    setSaving(true);
    try {
      let number = form.number.trim();
      if (!number) number = await nextNumber(form.issue_date);
      const type = PROXY_TYPES.find((t) => t.id === form.type_id) || PROXY_TYPES[7];
      const saved = await createProxy({
        type_id: type.id,
        type: type.label,
        number,
        issue_date: form.issue_date || null,
        valid_from: form.issue_date || null,
        valid_until: form.valid_until || null,
        fio: form.fio.trim(),
        employee_name: form.fio.trim(),
        status: form.status || 'issued',
        source: 'external',
        comment: form.comment || null,
        issue_place: 'г. Москва'
      });
      await uploadProxyFile(saved.id, file, 'external');
      toast.success('Внешняя доверенность добавлена');
      emit();
      onSaved?.(saved);
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard className="modal-md">
      <MHead
        title="Прикрепить внешнюю доверенность"
        subtitle="Создана вне CRM — только учёт и файл"
        accent="info"
        onClose={close}
      />
      <MBody>
        <div className="col gap-12">
          <Field label="Тип">
            <SelectInput
              value={form.type_id}
              onChange={(v) => set('type_id', v)}
              options={PROXY_TYPES.map((t) => ({ value: t.id, label: t.label }))}
            />
          </Field>
          <Field label="Номер">
            <TextInput value={form.number} onChange={(v) => set('number', v)} placeholder="Оставьте пустым — присвоится автоматически" />
          </Field>
          <div className="grid-2 gap-10">
            <Field label="Дата выдачи">
              <DatePicker value={form.issue_date} onChange={(v) => set('issue_date', v || '')} />
            </Field>
            <Field label="Действует до">
              <DatePicker value={form.valid_until} onChange={(v) => set('valid_until', v || '')} />
            </Field>
          </div>
          <Field label="Представитель (ФИО)" required>
            <TextInput value={form.fio} onChange={(v) => set('fio', v)} placeholder="Иванов Иван Иванович" />
          </Field>
          <Field label="Статус">
            <SelectInput value={form.status} onChange={(v) => set('status', v)} options={STATUS_OPTIONS} />
          </Field>
          <Field label="Файл" required>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Field>
          <Field label="Комментарий">
            <TextInput value={form.comment} onChange={(v) => set('comment', v)} />
          </Field>
        </div>
      </MBody>
      <MFoot align="end">
        <Btn onClick={close} disabled={saving}>Отмена</Btn>
        <Btn variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
