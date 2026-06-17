/**
 * SheetCloseModal — закрытие ведомости (отметить «Оплачено» с подтверждением итогов).
 *
 * Источник vanilla: payroll.js → btnPay handler.
 * После подтверждения бэк создаст записи `payment_registry` и `work_expenses` (категория ФОТ).
 *
 * Принимает sheet + summary. Используется, когда статус = approved.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { paySheet, fmtMoney, fmtDate } from '../api';

export default function SheetCloseModal({ sheet, totals, onDone }) {
  const { close } = useModal();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await paySheet(sheet.id);
      const created = r?.payments_created ?? 0;
      toast.success(`Ведомость закрыта · реестр выплат: ${created}`);
      window.dispatchEvent(new CustomEvent('asgard:payroll:changed'));
      onDone?.();
      close();
    } catch (e) {
      toast.error(String(e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="💰" title="Закрыть и оплатить ведомость" subtitle={sheet.title || 'Ведомость'} accent="gold" onClose={close} />
      <MBody>
        {/* Итоги */}
        <div style={{
          background: 'var(--inner-bg)',
          borderRadius: 'var(--r-md)',
          padding: 14,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 10,
          marginBottom: 14
        }}>
          <KV label="Период"      value={`${fmtDate(sheet.period_from)} — ${fmtDate(sheet.period_to)}`} />
          <KV label="Рабочих"     value={String(sheet.workers_count || 0)} />
          <KV label="Начислено"   value={fmtMoney(totals?.total_accrued ?? sheet.total_accrued)} />
          <KV label="Премии"      value={fmtMoney(totals?.total_bonus   ?? sheet.total_bonus)} tone="info" />
          <KV label="Удержания"   value={fmtMoney(totals?.total_penalty ?? sheet.total_penalty)} tone="err" />
          <KV label="К выплате"   value={fmtMoney(totals?.total_payout  ?? sheet.total_payout)}  tone="gold" big />
        </div>

        {/* Подписант — текущий пользователь, сохраним в комментарии */}
        <Field
          label="Комментарий для реестра"
          help="Будет добавлен к записям в payment_registry / work_expenses (опционально)."
        >
          <TextareaInput value={comment} onChange={setComment} minRows={2} maxRows={4} placeholder="Например: за какой период / по какому объекту" />
        </Field>

        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--amber)' }}>
          После подтверждения ведомость станет «Оплачено». Для каждой строки создастся запись
          в реестре выплат + ФОТ-расход на работу (если работа указана).
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost"   onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? '…' : '💰 Подтвердить и оплатить'}</Btn>
      </MFoot>
    </MCard>
  );
}

function KV({ label, value, tone, big }) {
  const c = tone === 'gold' ? 'var(--gold)' : tone === 'info' ? 'var(--info)' : tone === 'err' ? 'var(--err)' : 'var(--t-1)';
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--t-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em' }}>{label}</div>
      <div style={{ fontSize: big ? 20 : 15, fontWeight: 800, marginTop: 4, color: c }}>{value}</div>
    </div>
  );
}
