/**
 * Модалка «Оценить рабочего» (РП ставит оценку 1–10 + комментарий).
 *
 * POST /api/staff/employees/:id/review — { score_1_10, comment, work_id? }
 * Доступ: PM, ADMIN, директора (любой авторизованный — backend authenticate).
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextareaInput, Slider } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { createReview } from './api';

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:personnel:changed'));
}

export function ReviewModal({ employee, onSaved }) {
  const { close } = useModal();
  const [score, setScore] = useState(7);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await createReview(employee.id, {
        score_1_10: score,
        rating: score,
        comment: comment.trim() || null,
      });
      toast.success('Оценка сохранена');
      emitChanged();
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setBusy(false);
    }
  };

  const tone =
    score >= 8 ? { fg: 'var(--ok)', label: 'Отлично' } :
    score >= 6 ? { fg: 'var(--gold)', label: 'Хорошо' } :
    score >= 4 ? { fg: 'var(--amber)', label: 'Средне' } :
    { fg: 'var(--err)', label: 'Плохо' };

  return (
    <MCard>
      <MHead
        icon="★"
        title="Оценить рабочего"
        subtitle={employee?.fio || '—'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label={`Оценка (1–10): ${score}`}>
            <div className="row gap-16">
              <Slider value={score} onChange={setScore} min={1} max={10} step={1} />
              <span style={{
                fontSize: 28, fontWeight: 900, color: tone.fg, minWidth: 70, textAlign: 'right',
              }}>
                {score}/10
              </span>
            </div>
            <div style={{ fontSize: 12, color: tone.fg, marginTop: 4, fontWeight: 600 }}>{tone.label}</div>
          </Field>

          <Field label="Комментарий">
            <TextareaInput
              value={comment}
              onChange={setComment}
              placeholder="За что оценка? (необязательно)"
              minRows={3}
              maxRows={6}
            />
          </Field>
        </div>
      </MBody>
      <MFoot>
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>
          {busy ? 'Сохраняем…' : '✓ Поставить оценку'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
