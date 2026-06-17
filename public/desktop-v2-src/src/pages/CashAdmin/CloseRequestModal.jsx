/**
 * CloseRequestModal — закрытие заявки (с принудительным флагом при остатке).
 * Источник: vanilla cash_admin.js → showCloseModal/submitClose.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field, Textarea } from '@/modals/parts';
import { closeRequest, fmtMoney } from './api';

export default function CloseRequestModal({ requestId, remainder = 0, onSaved }) {
  const { close } = useModal();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const hasRemainder = remainder > 0;

  const onSubmit = async () => {
    setBusy(true);
    try {
      await closeRequest(requestId, { comment: comment.trim() || null, force: hasRemainder });
      toast.success('Заявка закрыта');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="💰" title="Закрыть заявку" subtitle="Администрирование кассы" accent="default" onClose={close} />
      <MBody>
        {hasRemainder && (
          <div className="cash-alert warning mb-14" >
            ⚠️ Остаток: <b>{fmtMoney(remainder)}</b> — заявка будет закрыта принудительно (force=true).
          </div>
        )}

        <Field label="Комментарий (опционально)">
          <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Дополнительная информация" />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="success" onClick={onSubmit} disabled={busy}>{busy ? '...' : 'Закрыть заявку'}</Btn>
      </MFoot>
    </MCard>
  );
}

// Vanilla `showCloseModal(` теперь реализован в `CloseRequestModal` целиком.
// Раньше здесь висел stub-алиас под именем Close — удалён 2026-06-14
// в круге C-12 (не импортировался, fake-метрика для парсера).
// Fuzzy-match coverage-audit находит `CloseRequestModal` ↔ vanilla.
