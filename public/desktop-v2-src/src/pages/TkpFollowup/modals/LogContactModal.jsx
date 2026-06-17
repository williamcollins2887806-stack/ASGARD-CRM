/**
 * LogContactModal — записать контакт по ТКП (звонок/письмо/встреча/прочее/заметка).
 * Backend: POST /api/tkp/:id/followup → audit_log entity_type=tkp action=followup_*.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { CONTACT_KINDS, logContact } from '../api';

export function LogContactModal({ tkp, kind: initialKind = 'call', onDone }) {
  const { close } = useModal();
  const [kind, setKind] = useState(initialKind);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await logContact(tkp.id, kind, comment);
      const meta = CONTACT_KINDS.find((k) => k.value === kind) || { label: kind };
      toast('Контакт записан', `${meta.label}: ${tkp.customer_name || ''}`, 'ok');
      window.dispatchEvent(new CustomEvent('asgard:tkp-followup:changed'));
      onDone?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  const current = CONTACT_KINDS.find((k) => k.value === kind) || CONTACT_KINDS[0];

  return (
    <MCard className="modal-md">
      <MHead
        icon={current.icon}
        title="Контакт по ТКП"
        subtitle={`${tkp.customer_name || ''} — ${tkp.subject || tkp.tkp_number || `#${tkp.id}`}`}
        onClose={close}
      />
      <MBody>
        <div className="col gap-10">
          <Field label="Тип события">
            <div className="u-flex u-wrap gap-6">
              {CONTACT_KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  className={`tfu-chip ${kind === k.value ? 'is-active' : ''}`}
                  onClick={() => setKind(k.value)}
                >
                  <span aria-hidden="true">{k.icon}</span>
                  {k.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Комментарий" help="Что обсудили, что обещал клиент, когда перезвонить и т.п.">
            <TextareaInput value={comment} onChange={setComment} minRows={3} maxRows={8} />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Сохраняем…' : `${current.icon} Записать`}
        </Btn>
      </MFoot>
    </MCard>
  );
}
