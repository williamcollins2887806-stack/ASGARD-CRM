/**
 * TransferModal — передать карту другому РП (PM/HEAD_PM).
 */
import { useEffect, useState, useMemo } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field, Textarea } from '@/modals/parts';
import { Combobox } from '@/inputs/Inputs';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { loadPmUsers, transferCard } from './api';

export default function TransferModal({ card, currentOwnerId, onDone }) {
  const { close } = useModal();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toUserId, setToUserId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPmUsers()
      .then((list) => setUsers(list.filter((u) => u.id !== currentOwnerId)))
      .finally(() => setLoading(false));
  }, [currentOwnerId]);

  const options = useMemo(() => users.map((u) => ({
    value: String(u.id),
    label: u.name + (u.role ? ' · ' + u.role : '')
  })), [users]);

  const submit = async () => {
    const uid = parseInt(toUserId, 10);
    if (!Number.isFinite(uid)) {
      toast.warn('Выберите получателя');
      return;
    }
    setSaving(true);
    try {
      await transferCard(card.id, { to_user_id: uid, note: note.trim() || null });
      toast.success('Карта передана');
      onDone?.();
      close();
    } catch (e) {
      if (e?.status === 409 && e?.body?.error === 'already_owns') {
        toast.error('У получателя уже есть карта на этот объект');
      } else {
        toast.error('Передача не выполнена: ' + (e?.message || e));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead icon="↪" title="Передать карту другому РП" subtitle={card?.entity?.title || ('Карта #' + card.id)} onClose={close} />
      <MBody>
        <Field label="Кому передать" required>
          {loading ? (
            <div className="c-t3 fs-12">⏳ Загружаем список РП…</div>
          ) : (
            <Combobox
              value={toUserId}
              onChange={setToUserId}
              options={options}
              placeholder="Начните вводить имя…"
              aria-label="Выберите РП"
            />
          )}
        </Field>
        <Field label="Сопроводительная заметка (необязательно)">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Что важно знать новому РП"
          />
        </Field>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving || !toUserId}>
          {saving ? '…' : 'Передать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
