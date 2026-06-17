/**
 * Модалка передачи выбранного оборудования другому РП.
 * Источник vanilla: my_equipment.js → btnTransferRequest.
 *
 * Поля: РП-получатель (required), работа (required), объект, примечание.
 * Один запрос на каждую позицию.
 */
import { useEffect, useMemo, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { Combobox, SelectInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  loadPms, loadActiveWorks, loadObjects,
  transferRequest
} from './api';

export function TransferModal({ selectedIds = [], items = [], currentUserId, onDone }) {
  const { close } = useModal();
  const [pms, setPms] = useState([]);
  const [works, setWorks] = useState([]);
  const [objects, setObjects] = useState([]);
  const [pmId, setPmId] = useState(null);
  const [workId, setWorkId] = useState('');
  const [objectId, setObjectId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadPms().then((list) => {
      setPms((list || []).filter((u) => Number(u.id) !== Number(currentUserId)));
    }).catch(() => setPms([]));

    loadActiveWorks().then((list) => {
      // Закрытые/отменённые отсеиваем
      const ACTIVE = ['Новая', 'Подготовка', 'Мобилизация', 'В работе', 'На паузе',
                      'new', 'preparation', 'mobilization', 'in_work', 'pause'];
      const filtered = (list || []).filter((w) => !w.work_status || ACTIVE.includes(w.work_status));
      setWorks(filtered);
    }).catch(() => setWorks([]));

    loadObjects().then(setObjects).catch(() => setObjects([]));
    // eslint-disable-next-line
  }, []);

  const pmOptions = useMemo(
    () => pms.map((u) => ({ value: u.id, label: u.name || u.login || `Пользователь #${u.id}` })),
    [pms]
  );
  const workOptions = useMemo(
    () => [
      { value: '', label: '— без работы —' },
      ...works.map((w) => ({
        value: String(w.id),
        label: `#${w.id} · ${w.work_number ? w.work_number + ' — ' : ''}${w.work_title || w.title || 'Работа'}`
      }))
    ],
    [works]
  );
  const objectOptions = useMemo(
    () => [
      { value: '', label: '— без объекта —' },
      ...objects.map((o) => ({ value: String(o.id), label: o.name }))
    ],
    [objects]
  );

  const submit = async () => {
    if (!selectedIds.length) { toast.error('Не выбрано оборудование'); return; }
    if (!pmId) { toast.error('Выберите РП-получателя'); return; }
    if (!workId) { toast.error('Выберите работу'); return; }

    setBusy(true);
    let ok = 0, fail = 0;
    for (const id of selectedIds) {
      try {
        const r = await transferRequest({
          equipment_id: id,
          target_holder_id: pmId,
          work_id: workId,
          object_id: objectId || null,
          notes
        });
        if (r.success !== false) ok++; else fail++;
      } catch (e) { fail++; }
    }
    if (ok) toast.success(`Создано запросов: ${ok} из ${selectedIds.length}`);
    if (fail) toast.error(`Не удалось создать: ${fail}`);
    onDone?.();
    setBusy(false);
    close();
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="📤" title="Запрос на передачу" subtitle={`Позиций: ${selectedIds.length}`} accent="gold" onClose={close} />
      <MBody>
        {items.length > 0 && (
          <div style={{ marginBottom: 12, maxHeight: 140, overflowY: 'auto' }}>
            <div className="fs-11 c-t3 upper fw-700 mb-6">
              К передаче
            </div>
            <ul className="m-0 pl-16 c-t1 fs-13">
              {items.map((e) => (
                <li key={e.id} className="mb-4">
                  <code className="fs-11 c-t3 mr-4">{e.inventory_number}</code>
                  {e.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field label="Кому передать (РП)" required>
          <Combobox options={pmOptions} value={pmId} onChange={setPmId} placeholder="Начните вводить ФИО…" />
        </Field>

        <div className="m-grid-2 mt-10" >
          <Field label="Для какой работы" required>
            <SelectInput value={workId} onChange={setWorkId} options={workOptions} placeholder="Выберите работу" />
          </Field>
          <Field label="Объект">
            <SelectInput value={objectId} onChange={setObjectId} options={objectOptions} placeholder="Без объекта" />
          </Field>
        </div>

        <Field label="Примечание">
          <TextareaInput value={notes} onChange={setNotes} placeholder="Срок, состояние, контакты…" minRows={2} maxRows={5} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? '…' : '📤 Отправить запрос'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
