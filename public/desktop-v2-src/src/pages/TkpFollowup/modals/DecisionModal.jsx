/**
 * DecisionModal — окончательное решение клиента по ТКП.
 * Backend: POST /api/tkp/:id/client-decision  (decision: accepted|rejected|no_response).
 * Каскад: при accepted на link_type='tender' тендер → «Выиграли», при rejected → «Проиграли».
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { setClientDecision } from '../api';

const PRESETS = [
  { value: 'accepted',    icon: '✅', label: 'Победили',   tone: 'success', help: 'Клиент принял ТКП. Тендер → «Выиграли».' },
  { value: 'rejected',    icon: '❌', label: 'Проиграли',  tone: 'danger',  help: 'Клиент отказался. Тендер → «Проиграли».' },
  { value: 'no_response', icon: '⏳', label: 'Нет ответа', tone: 'warn',    help: 'Клиент пока не ответил, не закрываем.' }
];

export function DecisionModal({ tkp, decision: initialDecision = 'accepted', onDone }) {
  const { close } = useModal();
  const [decision, setDecision] = useState(initialDecision);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const meta = PRESETS.find((p) => p.value === decision) || PRESETS[0];

  const submit = async () => {
    setBusy(true);
    try {
      await setClientDecision(tkp.id, decision, comment);
      toast(`${meta.icon} ${meta.label}`, tkp.customer_name || `ТКП #${tkp.id}`, 'ok');
      window.dispatchEvent(new CustomEvent('asgard:tkp-followup:changed'));
      window.dispatchEvent(new CustomEvent('asgard:tkp:changed'));
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
        icon={meta.icon}
        title="Решение клиента"
        subtitle={`${tkp.customer_name || ''} — ${tkp.subject || tkp.tkp_number || `#${tkp.id}`}`}
        accent={meta.tone === 'success' ? 'success' : meta.tone === 'danger' ? 'danger' : 'warn'}
        onClose={close}
      />
      <MBody>
        <div className="col gap-10">
          <Field label="Что решил клиент">
            <div className="u-flex u-wrap gap-6">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`tfu-chip ${decision === p.value ? 'is-active' : ''}`}
                  onClick={() => setDecision(p.value)}
                >
                  <span aria-hidden="true">{p.icon}</span>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          <div className="fs-12 c-t3">{meta.help}</div>
          <Field label="Комментарий (попадёт в аудит)">
            <TextareaInput value={comment} onChange={setComment} minRows={3} maxRows={8} />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant={meta.tone === 'danger' ? 'danger' : 'primary'} disabled={busy} onClick={submit}>
          {busy ? 'Сохраняем…' : `${meta.icon} ${meta.label}`}
        </Btn>
      </MFoot>
    </MCard>
  );
}
