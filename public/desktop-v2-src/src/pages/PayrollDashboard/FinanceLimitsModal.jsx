/**
 * Модалка изменения финансовых лимитов самозанятых.
 * Доступ: ADMIN, DIRECTOR_GEN.
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { MoneyInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { getFinanceLimits, setFinanceLimits, fmtMoney } from './api';

export function FinanceLimitsModal({ onDone }) {
  const { close } = useModal();
  const [monthly, setMonthly] = useState('350000');
  const [yearly, setYearly] = useState('2400000');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFinanceLimits().then((d) => {
      if (d.monthly) setMonthly(String(d.monthly));
      if (d.yearly) setYearly(String(d.yearly));
    }).catch(() => {});
  }, []);

  const save = async () => {
    const m = Number(monthly);
    const y = Number(yearly);
    if (!Number.isFinite(m) || m < 0) { toast.error('Месячный лимит — число ≥ 0'); return; }
    if (!Number.isFinite(y) || y < 0) { toast.error('Годовой лимит — число ≥ 0'); return; }
    setBusy(true);
    try {
      await setFinanceLimits(m, y);
      toast.success('Лимиты сохранены');
      onDone?.();
      close();
    } catch (e) {
      toast.error(e?.message || 'Не удалось сохранить');
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="⚙" title="Финансовые лимиты самозанятых" accent="default" onClose={close} />
      <MBody>
        <div className="m-grid-2">
          <Field label="Месячный лимит (₽)" required help={`Сейчас: ${fmtMoney(monthly)}`}>
            <MoneyInput value={monthly} onChange={setMonthly} />
          </Field>
          <Field label="Годовой лимит (₽)" required help={`Сейчас: ${fmtMoney(yearly)}`}>
            <MoneyInput value={yearly} onChange={setYearly} />
          </Field>
        </div>
        <div className="mt-10 fs-12 c-t3">
          Применяется ко всем самозанятым при расчёте остатка лимита.
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>
          {busy ? '…' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
