/**
 * ClarificationAnswerModal — ответ текстом на уточнение.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextareaInput } from '@/inputs/Inputs';

import { answerClarification } from './api';

export function ClarificationAnswerModal({ clar, onAnswered }) {
  const { close } = useModal();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    const t = text.trim();
    if (!t) { toast.warn('Введите текст'); return; }
    setBusy(true);
    try {
      const r = await answerClarification(clar.id, { answer_text: t });
      if (r?.resumed) {
        toast.success('Conductor продолжает — все блокеры закрыты');
      } else {
        toast.success(`Ответ сохранён. Осталось блокеров: ${r?.remaining_blockers ?? 0}`);
      }
      close();
      onAnswered?.();
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="✍"
        title={`Ответ на уточнение #${clar.id}`}
        accent="default"
        onClose={() => close()}
      />
      <MBody>
        <div style={{
          background: 'var(--inner-bg)',
          padding: '10px 12px',
          borderRadius: 'var(--r-md)',
          marginBottom: 12,
          fontSize: 13,
          color: 'var(--t-1)',
        }}>
          {clar.question_ru || ''}
        </div>
        <Field label="Ответ">
          <TextareaInput value={text} onChange={setText} placeholder="Введите ответ…" minRows={6} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={onSubmit}>
          {busy ? 'Сохраняем…' : 'Сохранить ответ'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
