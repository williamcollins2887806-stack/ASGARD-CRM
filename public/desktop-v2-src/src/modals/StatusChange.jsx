import { useState } from 'react';
import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot, Btn, Field, Textarea, Select } from './parts';

/**
 * Смена статуса с обязательным комментарием/причиной.
 * Например: «Тендер: Проиграли» → нужна причина из списка + сопроводительное письмо.
 */
export function StatusChangeModal({
  title = 'Изменить статус',
  fromStatus,
  toStatus,
  reasonOptions = [],
  reasonLabel = 'Причина',
  commentLabel = 'Комментарий',
  commentRequired = true,
  icon = '↻',
  accent = 'warn',
  submitText = 'Подтвердить',
  onSubmit,
  onClose
}) {
  const { close } = useModal();
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const handleClose = () => { onClose?.(); close(); };

  const ok = (!reasonOptions.length || reason) && (!commentRequired || comment.trim());

  return (
    <MCard>
      <MHead icon={icon} title={title} subtitle={fromStatus && toStatus ? `${fromStatus} → ${toStatus}` : undefined} accent={accent} onClose={handleClose} />
      <MBody>
        {fromStatus && toStatus && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span className="m-pill">{fromStatus}</span>
            <span className="c-t3">→</span>
            <span className={'m-pill ' + (accent === 'danger' ? 'danger' : accent === 'warn' ? 'warn' : 'gold')}>{toStatus}</span>
          </div>
        )}
        {reasonOptions.length > 0 && (
          <Field label={reasonLabel} required>
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">— выбрать —</option>
              {reasonOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
        )}
        <Field label={commentLabel} required={commentRequired}>
          <Textarea
            placeholder="Поясните решение — это уйдёт в журнал и уведомление команде"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
          />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={handleClose}>Отмена</Btn>
        <Btn variant={accent === 'danger' ? 'danger' : 'primary'} disabled={!ok} onClick={() => { onSubmit?.({ reason, comment }); close(); }}>
          {submitText}
        </Btn>
      </MFoot>
    </MCard>
  );
}
