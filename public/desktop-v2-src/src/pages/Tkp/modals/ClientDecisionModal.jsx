/**
 * ClientDecisionModal — запись решения клиента по ТКП.
 * Источник: openClientDecisionModal в tkp_page.js.
 * Бэк: POST /api/tkp/:id/client-decision
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextareaInput, MoneyInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { setClientDecision } from '../api';

const DECISIONS = [
  { value: 'accepted',    label: '✅ Принято',     desc: 'Заказчик согласился, идём в работу', tone: 'ok' },
  { value: 'rejected',    label: '❌ Отклонено',   desc: 'Заказчик отказался от предложения',  tone: 'err' },
  { value: 'no_response', label: '💤 Нет ответа',  desc: 'Молчит, надо напомнить',             tone: 'amber' }
];

export function ClientDecisionModal({ tkp }) {
  const { close } = useModal();
  const [decision, setDecision] = useState(tkp?.client_decision || 'accepted');
  const [comment, setComment] = useState('');
  const [actualAmount, setActualAmount] = useState(tkp?.total_amount || '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (decision === 'rejected' && !comment?.trim()) {
      return toast('Причина', 'Поясни почему отклонили', 'warn');
    }
    setBusy(true);
    try {
      await setClientDecision(tkp.id, {
        decision,
        comment: comment || null,
        actual_amount: decision === 'accepted' && actualAmount ? Number(actualAmount) : null
      });
      toast('Записано', DECISIONS.find((d) => d.value === decision)?.label || '', 'ok');
      window.dispatchEvent(new CustomEvent('asgard:tkp:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-md">
      <MHead icon="✓" title="Решение клиента" subtitle={`ТКП #${tkp.id} · ${tkp.customer_name || ''}`} onClose={close} />
      <MBody>
        <div className="col gap-8 mb-14">
          {DECISIONS.map((d) => (
            <button
              key={d.value}
              className={'aag-card aag-' + (decision === d.value ? 'primary' : 'default')}
              style={{
                border: decision === d.value ? `2px solid var(--${d.tone})` : '1px solid var(--brd-2)',
                background: decision === d.value ? `var(--${d.tone}-bg)` : 'var(--inner-bg)',
                textAlign: 'left'
              }}
              onClick={() => setDecision(d.value)}
            >
              <span className="aag-txt">
                <span className="aag-l">{d.label}</span>
                <span className="aag-d">{d.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {decision === 'accepted' && (
          <Field label="Финальная сумма (если изменилась)" help="Если торговались — введи итог">
            <MoneyInput value={actualAmount} onChange={setActualAmount} />
          </Field>
        )}

        <Field label={decision === 'rejected' ? 'Причина отказа' : 'Комментарий'} required={decision === 'rejected'}>
          <TextareaInput
            value={comment}
            onChange={setComment}
            minRows={3}
            maxRows={6}
            placeholder={decision === 'rejected' ? 'Цена, сроки, конкурент…' : decision === 'no_response' ? 'Когда напомнить, через какой канал' : 'Доп. условия, особенности'}
          />
        </Field>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Сохраняем…' : 'Записать решение'}</Btn>
      </MFoot>
    </MCard>
  );
}
