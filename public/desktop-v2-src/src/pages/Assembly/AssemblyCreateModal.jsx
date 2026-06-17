/**
 * Модалка создания ведомости (мобилизация / перемещение).
 * Демоб создаётся отдельной кнопкой «🏠 Создать демоб» из мобилизации.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, SelectInput, DatePicker, TextareaInput, Combobox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { createAssembly, loadWorks, emitChanged } from './api';

export function AssemblyCreateModal({ defaultWorkId, defaultType, onCreated }) {
  const { close } = useModal();
  const [works, setWorks] = useState([]);
  const [form, setForm] = useState({
    work_id:      defaultWorkId || '',
    type:         defaultType || 'mobilization',
    title:        '',
    destination:  '',
    planned_date: '',
    notes:        ''
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadWorks()
      .then((items) =>
        setWorks(items.map((w) => ({ value: w.id, label: '#' + w.id + ' ' + (w.work_title || w.tender_title || '—') })))
      )
      .catch(() => setWorks([]));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.work_id) return toast.warn('Выберите работу');
    if (!form.type)    return toast.warn('Выберите тип ведомости');
    setBusy(true);
    try {
      const result = await createAssembly({
        work_id:      Number(form.work_id),
        type:         form.type,
        title:        form.title || null,
        destination:  form.destination || null,
        planned_date: form.planned_date || null,
        notes:        form.notes || null
      });
      toast.success('Ведомость создана');
      emitChanged();
      onCreated?.(result?.item);
      close();
    } catch (e) {
      toast.error('Не удалось создать: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="🏗️" title="Новая ведомость сборки" accent="gold" onClose={close} />
      <MBody>
        <div className="col gap-12">
          <Field label="Работа" required>
            <Combobox
              options={works}
              value={form.work_id}
              onChange={(v) => set('work_id', v)}
              placeholder="Выберите работу"
            />
          </Field>

          <Field label="Тип" required>
            <SelectInput
              value={form.type}
              onChange={(v) => set('type', v)}
              options={[
                { value: 'mobilization',   label: '🚛 Мобилизация (на объект)' },
                { value: 'transfer',       label: '↔️ Перемещение между объектами' }
              ]}
            />
          </Field>

          <Field label="Название (опц.)">
            <TextInput
              value={form.title}
              onChange={(v) => set('title', v)}
              placeholder="Авто-имя из работы, если оставить пустым"
            />
          </Field>

          <Field label="Назначение / объект">
            <TextInput
              value={form.destination}
              onChange={(v) => set('destination', v)}
              placeholder="г. Череповец, ЭЛОУ-АВТ"
            />
          </Field>

          <Field label="Плановая дата">
            <DatePicker value={form.planned_date} onChange={(v) => set('planned_date', v)} />
          </Field>

          <Field label="Заметки">
            <TextareaInput value={form.notes} onChange={(v) => set('notes', v)} minRows={2} />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? '…' : '✓ Создать'}</Btn>
      </MFoot>
    </MCard>
  );
}
