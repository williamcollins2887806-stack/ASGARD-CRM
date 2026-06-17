/**
 * RecomputeModal — пересчёт сметы с правкой РП.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextareaInput } from '@/inputs/Inputs';

import { recomputeWithFeedback } from './api';

export function RecomputeModal({ runId, onApplied }) {
  const { close } = useModal();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const onSave = async () => {
    const t = text.trim();
    if (!t) { toast.warn('Введите что изменить'); return; }
    setBusy(true);
    try {
      await recomputeWithFeedback(runId, t);
      toast.success('Conductor учтёт правку и продолжит');
      close();
      onApplied?.();
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="🔄"
        title="Попросить Conductor пересчитать"
        accent="default"
        onClose={() => close()}
      />
      <MBody>
        <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--t-3)' }}>
          Опиши что нужно изменить — Conductor учтёт правку и пересчитает смету.
          Примеры: «увеличить бригаду до 12 человек», «убрать командировочные»,
          «учесть скидку поставщика 10%», «работаем в две смены вместо одной».
        </p>
        <Field label="Правка">
          <TextareaInput value={text} onChange={setText} placeholder="Что не так / что изменить…" minRows={6} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={onSave}>
          {busy ? 'Запускаем…' : 'Запустить пересчёт'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
