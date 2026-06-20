/**
 * LockMonthModal — диалог подтверждения закрытия месяца.
 *
 * Когда РП/складская/ТО/Логист/директор закрывает месяц, нужна явная
 * подтверждалка с предупреждением: «после закрытия редактирование
 * запрещено». Закрытие можно потом снять (своё — автор / любое —
 * директор/ADMIN).
 *
 * Props:
 *   scope: 'pm'|'warehouse'|'medical'|'travel'|'global'
 *   year, month
 *   onConfirm: async () => server response (lockMonth(...))
 *   onClose
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { monthLabel } from './api';

// FIX 16 — человеческие подписи (без техжаргона типа scope=pm)
const SCOPE_LABEL = {
  pm: 'свой табель',
  warehouse: 'табель склада',
  medical: 'табель медосмотров',
  travel: 'табель дороги',
  global: 'общий табель (всё)'
};

export default function LockMonthModal({ scope, year, month, onConfirm }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm?.();
      toast.success('Месяц закрыт');
      close();
    } catch (e) {
      toast.error('Не удалось закрыть: ' + (e?.serverMsg || e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="🔒" title="Закрыть месяц" accent="amber"
        subtitle={`${monthLabel(year, month)} · ${SCOPE_LABEL[scope] || scope}`}
        onClose={close}
      />
      <MBody>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--t-2)' }}>
          После закрытия редактирование табеля в этом сегменте будет запрещено.
          Снять закрытие сможет автор или директор.
        </p>
        <div style={{
          marginTop: 12, padding: 10,
          background: 'var(--warn-bg)',
          borderRadius: 'var(--r-sm)',
          fontSize: 12,
          color: 'var(--warn-t)'
        }}>
          ⚠ Убедитесь, что все отметки внесены. После закрытия PUT /entry будет давать 423.
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? '…' : '🔒 Закрыть месяц'}</Btn>
      </MFoot>
    </MCard>
  );
}
