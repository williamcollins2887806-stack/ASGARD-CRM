/**
 * PreTenderApprovalModal — модалки директорской ветки утверждения/отклонения
 * согласования предтендера.
 *
 * Источник: vanilla `public/assets/js/pre_tenders.js:1190-1226` —
 *   • btnApprovePT  → POST /:id/accept (тот же endpoint, что и для обычного «Принять»,
 *                      но при текущем статусе pending_approval и роли директора
 *                      backend создаёт тендер из заявки).
 *   • btnRejectAppr → POST /:id/reject-approval с причиной (отклоняет согласование,
 *                      статус возвращается в in_review, запросившему уходит уведомление).
 *
 * RBAC: только директор/ADMIN. PM/TO/HEAD_TO/HEAD_PM запрашивают согласование через
 * обычный AcceptModal (бэк автоматически переводит в pending_approval).
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { approveAsDirector, rejectApproval } from '../api';

/**
 * Утверждение директором — создаёт тендер из заявки.
 * Vanilla: pre_tenders.js:1191 (btnApprovePT).
 */
export function ApprovePreTenderModal({ preTender, onDone }) {
  const { close } = useModal();
  const [comment, setComment] = useState('Утверждено директором');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await approveAsDirector(preTender.id, { comment: comment.trim() || 'Утверждено директором' });
      if (res?.tender_id) {
        toast('✓ Утверждено', `Тендер #${res.tender_id} создан`, 'ok');
      } else {
        toast('✓ Утверждено', 'Заявка принята в работу', 'ok');
      }
      window.dispatchEvent(new CustomEvent('asgard:pre-tenders:changed'));
      onDone?.(res);
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-md">
      <MHead
        icon="✓"
        title="Утвердить согласование"
        subtitle={preTender.customer_name || `Заявка #${preTender.id}`}
        accent="success"
        onClose={close}
      />
      <MBody>
        <div
          style={{
            padding: 10,
            background: 'var(--gold-bg)',
            borderRadius: 'var(--r-sm)',
            fontSize: 12.5,
            marginBottom: 12,
            color: 'var(--t-2)'
          }}
        >
          🪙 Заявка будет принята, на её основе создастся тендер,
          {preTender.approval_requested_by ? ' инициатор согласования получит уведомление.' : ' заказчику может уйти письмо «принято в работу».'}
        </div>
        <Field label="Комментарий (опционально)">
          <TextareaInput value={comment} onChange={setComment} minRows={2} maxRows={5} />
        </Field>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Утверждаем…' : '✓ Утвердить → создать тендер'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

/**
 * Отклонение согласования директором — возврат в in_review с причиной.
 * Vanilla: pre_tenders.js:1210 (btnRejectApproval).
 */
export function RejectApprovalModal({ preTender, onDone }) {
  const { close } = useModal();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const reason = comment.trim();
    if (!reason) {
      toast('Причина', 'Опишите причину отклонения согласования', 'warn');
      return;
    }
    setBusy(true);
    try {
      await rejectApproval(preTender.id, { comment: reason });
      toast('Отклонено', 'Согласование отклонено, инициатор уведомлён', 'ok');
      window.dispatchEvent(new CustomEvent('asgard:pre-tenders:changed'));
      onDone?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-md">
      <MHead
        icon="✗"
        title="Отклонить согласование"
        subtitle={preTender.customer_name || `Заявка #${preTender.id}`}
        accent="danger"
        onClose={close}
      />
      <MBody>
        <div
          style={{
            padding: 10,
            background: 'color-mix(in srgb, var(--err) 8%, transparent)',
            borderRadius: 'var(--r-sm)',
            fontSize: 12.5,
            marginBottom: 12,
            color: 'var(--t-2)'
          }}
        >
          ⚠️ Заявка вернётся в статус «На рассмотрении», запросивший согласование получит
          уведомление с указанной причиной.
        </div>
        <Field label="Причина отклонения согласования" required>
          <TextareaInput value={comment} onChange={setComment} minRows={3} maxRows={6} />
        </Field>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="danger" disabled={busy || !comment.trim()} onClick={submit}>
          {busy ? 'Отклоняем…' : 'Отклонить согласование'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
