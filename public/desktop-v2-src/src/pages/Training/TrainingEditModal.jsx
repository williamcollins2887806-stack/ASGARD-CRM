/**
 * TrainingEditModal — создание/редактирование заявки на обучение.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { Field, TextInput, TextareaInput, SelectInput, MoneyInput, DatePicker } from '@/inputs/Inputs';
import { createApp, updateApp, TYPE_OPTIONS } from './api';

function emit() { window.dispatchEvent(new CustomEvent('asgard:training:changed')); }

export function TrainingEditModal({ app, onSaved }) {
  const { close } = useModal();
  const isEdit = !!app?.id;

  const [form, setForm] = useState({
    course_name:   app?.course_name || '',
    provider:      app?.provider || '',
    training_type: app?.training_type || 'external',
    date_start:    (app?.date_start || '').slice(0, 10),
    date_end:      (app?.date_end || '').slice(0, 10),
    cost:          app?.cost || '',
    justification: app?.justification || '',
    comment:       app?.comment || ''
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onSave = async () => {
    if (!form.course_name.trim()) {
      toast.error('Укажите название курса/обучения');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        course_name: form.course_name.trim(),
        provider: form.provider.trim() || null,
        training_type: form.training_type,
        date_start: form.date_start || null,
        date_end: form.date_end || null,
        cost: Number(form.cost) || 0,
        justification: form.justification.trim() || null,
        comment: form.comment.trim() || null
      };
      if (isEdit) {
        await updateApp(app.id, payload);
        toast.success('Заявка обновлена');
      } else {
        await createApp(payload);
        toast.success('Заявка создана (черновик)');
      }
      emit();
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
        icon={isEdit ? '✎' : '📚'}
        title={isEdit ? 'Редактировать заявку на обучение' : 'Заявка на обучение'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Название курса / обучения" required>
            <TextInput value={form.course_name} onChange={(v) => set('course_name', v)} placeholder="Курс повышения квалификации…" />
          </Field>
          <div className="grid-2 gap-10">
            <Field label="Поставщик / Школа">
              <TextInput value={form.provider} onChange={(v) => set('provider', v)} placeholder="Название организации" />
            </Field>
            <Field label="Тип">
              <SelectInput value={form.training_type} onChange={(v) => set('training_type', v)} options={TYPE_OPTIONS} />
            </Field>
          </div>
          <div className="grid-3 gap-10">
            <Field label="Дата начала">
              <DatePicker value={form.date_start} onChange={(v) => set('date_start', v)} />
            </Field>
            <Field label="Дата окончания">
              <DatePicker value={form.date_end} onChange={(v) => set('date_end', v)} />
            </Field>
            <Field label="Стоимость, ₽">
              <MoneyInput value={form.cost} onChange={(v) => set('cost', v)} />
            </Field>
          </div>
          <Field label="Обоснование (зачем нужно)">
            <TextareaInput value={form.justification} onChange={(v) => set('justification', v)} placeholder="Польза от обучения, ожидаемые результаты…" />
          </Field>
          <Field label="Комментарий">
            <TextareaInput value={form.comment} onChange={(v) => set('comment', v)} />
          </Field>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={onSave} disabled={busy}>
          {busy ? 'Сохраняем…' : isEdit ? 'Сохранить' : 'Создать черновик'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
