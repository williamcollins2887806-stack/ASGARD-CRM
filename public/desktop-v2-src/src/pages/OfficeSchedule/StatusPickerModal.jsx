/**
 * Модалка выбора статуса дня — заменяет vanilla `openPicker()`.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { STATUS } from './api';

export function StatusPickerModal({ staffName, dateIso, currentCode, onPick }) {
  const { close } = useModal();
  const [code, setCode] = useState(currentCode || '');

  const dateLabel = dateIso ? new Date(dateIso).toLocaleDateString('ru-RU') : '';

  const handle = (value) => {
    onPick?.(value);
    close();
  };

  return (
    <MCard>
      <MHead icon="📅" title="Статус дня" onClose={() => close()} />
      <MBody>
        <div style={{ fontSize: 13, color: 'var(--t-2)', marginBottom: 6 }}>
          Сотрудник: <b className="c-t1">{staffName || '—'}</b>
        </div>
        <div style={{ fontSize: 13, color: 'var(--t-2)', marginBottom: 12 }}>
          Дата: <b className="c-t1">{dateLabel}</b>
        </div>
        <Field label="Статус">
          <SelectInput
            value={code}
            onChange={setCode}
            options={STATUS.map((s) => ({ value: s.code, label: s.label }))}
          />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => handle('')}>Очистить</Btn>
        <Btn variant="ghost" onClick={() => close()}>Отмена</Btn>
        <Btn variant="primary" onClick={() => handle(code)}>Сохранить</Btn>
      </MFoot>
    </MCard>
  );
}
