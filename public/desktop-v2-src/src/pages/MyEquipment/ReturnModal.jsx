/**
 * Модалка возврата выбранного оборудования на склад.
 * Источник vanilla: my_equipment.js → btnReturnRequest.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { SelectInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { returnEquipment, CONDITION_OPTIONS } from './api';

export function ReturnModal({ selectedIds = [], items = [], onDone }) {
  const { close } = useModal();
  const [condition, setCondition] = useState('good');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!selectedIds.length) {
      toast.error('Не выбрано оборудование');
      return;
    }
    setBusy(true);
    let ok = 0, fail = 0;
    for (const id of selectedIds) {
      try {
        const r = await returnEquipment(id, condition, notes);
        if (r.success !== false) ok++; else fail++;
      } catch (e) { fail++; }
    }
    if (ok) toast.success(`Возвращено: ${ok} из ${selectedIds.length}`);
    if (fail) toast.error(`Не удалось вернуть: ${fail}`);
    onDone?.();
    setBusy(false);
    close();
  };

  return (
    <MCard>
      <MHead icon="📥" title="Возврат на склад" subtitle={`Позиций: ${selectedIds.length}`} accent="default" onClose={close} />
      <MBody>
        {items.length > 0 && (
          <div style={{ marginBottom: 12, maxHeight: 160, overflowY: 'auto' }}>
            <div className="fs-11 c-t3 upper fw-700 mb-6">
              Выбранное оборудование
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

        <Field label="Состояние при возврате" required>
          <SelectInput value={condition} onChange={setCondition} options={CONDITION_OPTIONS} placeholder="— выбрать —" />
        </Field>

        <Field label="Примечание">
          <TextareaInput value={notes} onChange={setNotes} placeholder="Что важно знать кладовщику" minRows={2} maxRows={5} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? '…' : '📥 Вернуть'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
