/**
 * Модалка передачи печати сотруднику (или возврат в офис).
 */
import { useState, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import {
  TextareaInput, SelectInput, DatePicker, Switch
} from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';

import { createTransfer, updateSeal, todayIso } from './api';

function emit() { window.dispatchEvent(new CustomEvent('asgard:seals:changed')); }

export function SealTransferModal({ seal, users = [], currentUserId, onDone }) {
  const { close } = useModal();

  const [toId, setToId] = useState('');
  const [transferDate, setTransferDate] = useState(todayIso());
  const [returnDate, setReturnDate] = useState('');
  const [indefinite, setIndefinite] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [returnOffice, setReturnOffice] = useState(false);
  const [saving, setSaving] = useState(false);

  const userOpts = useMemo(() => {
    const opts = users
      .filter((u) => u.is_active !== false && u.name && u.name.trim())
      .map((u) => ({ value: String(u.id), label: u.name + (u.role ? ' · ' + u.role : '') }));
    return [{ value: '', label: '— выберите сотрудника —' }, ...opts];
  }, [users]);

  const submit = async () => {
    if (!returnOffice && !toId) {
      toast.error('Выберите получателя или включите «возврат в офис»');
      return;
    }
    setSaving(true);
    try {
      if (returnOffice) {
        await createTransfer({
          seal_id: seal.id,
          from_id: seal.holder_id || null,
          to_id: null,
          transfer_date: transferDate || todayIso(),
          purpose: (purpose || 'Возврат в офис').trim() || null,
          status: 'confirmed',
          created_by: currentUserId || null,
          confirmed_at: new Date().toISOString()
        });
        await updateSeal(seal.id, {
          status: 'office',
          holder_id: null,
          return_date: null,
          is_indefinite: false,
          pending_transfer_id: null
        });
        toast.success('Печать возвращена в офис');
      } else {
        const transfer = await createTransfer({
          seal_id: seal.id,
          from_id: seal.holder_id || null,
          to_id: parseInt(toId, 10),
          transfer_date: transferDate || todayIso(),
          return_date: indefinite ? null : (returnDate || null),
          is_indefinite: !!indefinite,
          purpose: purpose.trim() || null,
          status: 'pending',
          created_by: currentUserId || null
        });
        await updateSeal(seal.id, {
          status: 'transfer',
          holder_id: parseInt(toId, 10),
          return_date: indefinite ? null : (returnDate || null),
          is_indefinite: !!indefinite,
          pending_transfer_id: transfer?.id || null
        });
        toast.success('Запрос на передачу создан');
      }
      emit();
      onDone?.();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="🔄"
        title="Передача печати"
        subtitle={seal?.name}
        accent="info"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Switch
            checked={returnOffice}
            onChange={setReturnOffice}
            label="🏢 Вернуть в офис (без сотрудника)"
          />

          {!returnOffice && (
            <Field label="Кому передать" required>
              <SelectInput value={toId} onChange={setToId} options={userOpts} />
            </Field>
          )}

          <Field label="Дата передачи">
            <DatePicker value={transferDate} onChange={(v) => setTransferDate(v || '')} />
          </Field>

          {!returnOffice && (
            <>
              <div className="grid-1-auto gap-10 items-end">
                <Field label="Срок возврата">
                  <DatePicker value={returnDate} onChange={(v) => setReturnDate(v || '')} />
                </Field>
                <div className="pb-6">
                  <Switch checked={indefinite} onChange={setIndefinite} label="Бессрочно" />
                </div>
              </div>
            </>
          )}

          <Field label="Цель / комментарий">
            <TextareaInput
              value={purpose}
              onChange={setPurpose}
              placeholder="Зачем нужна печать…"
              minRows={2}
              maxRows={5}
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close} disabled={saving}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving}>
          {saving ? 'Передаём…' : returnOffice ? '🏢 Вернуть' : '🔄 Передать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
