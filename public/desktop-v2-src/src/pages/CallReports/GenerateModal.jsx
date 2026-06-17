/**
 * GenerateModal — ручная генерация отчёта.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { api } from '@/api/client';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { Field, SelectInput, DatePicker } from '@/inputs/Inputs';
import { TYPE_OPTIONS } from './api';

export function GenerateModal({ onCreated }) {
  const { close } = useModal();
  const [type, setType] = useState('daily');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  const onGenerate = async () => {
    setBusy(true);
    try {
      await api('/api/call-reports/generate', {
        method: 'POST',
        body: {
          report_type: type,
          date_from: from || undefined,
          date_to: to || undefined
        }
      });
      toast.success('Отчёт сгенерирован');
      onCreated?.();
      close();
    } catch (e) {
      toast.error('Не удалось сгенерировать: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="📊" title="Сгенерировать отчёт" accent="gold" onClose={close} />
      <MBody>
        <div className="col gap-14">
          <Field label="Тип отчёта" required>
            <SelectInput value={type} onChange={setType} options={TYPE_OPTIONS} />
          </Field>
          <div className="grid-2 gap-10">
            <Field label="С даты" help="Оставьте пусто — будет авто-период по типу">
              <DatePicker value={from} onChange={setFrom} />
            </Field>
            <Field label="По дату">
              <DatePicker value={to} onChange={setTo} />
            </Field>
          </div>
          <div style={{ padding: 10, background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--t-3)' }}>
            ℹ Если даты не указаны:<br />
            • daily — вчера<br />
            • weekly — последние 7 дней<br />
            • monthly — последний месяц
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={onGenerate} disabled={busy}>
          {busy ? 'Генерируем…' : '📊 Сгенерировать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
