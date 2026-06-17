/**
 * AssignPmModal — назначить РП на заявку. Защита от двойного назначения (409 already_assigned).
 */
import { useEffect, useState, useMemo } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field, Textarea } from '@/modals/parts';
import { Combobox } from '@/inputs/Inputs';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { assignPm, loadPmUsers } from './api';

export default function AssignPmModal({ application, onAssigned }) {
  const { close } = useModal();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pmId, setPmId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPmUsers().then(setUsers).finally(() => setLoading(false));
  }, []);

  const options = useMemo(() => users.map((u) => ({
    value: String(u.id),
    label: u.name + (u.role ? ' · ' + u.role : '')
  })), [users]);

  const submit = async () => {
    const uid = parseInt(pmId, 10);
    if (!Number.isFinite(uid)) {
      toast.warn('Выберите РП');
      return;
    }
    setSaving(true);
    try {
      await assignPm(application.id, uid, note.trim() || null);
      toast.success('РП назначен — карта появится в его канбане');
      onAssigned?.();
      close();
    } catch (e) {
      if (e?.status === 409 && e?.body?.error === 'already_assigned') {
        toast.error('Заявка уже назначена другому РП');
        onAssigned?.();
      } else {
        toast.error('Не удалось назначить: ' + (e?.message || e));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="🎯"
        title={`Назначить РП на заявку №${application.id}`}
        subtitle={application.subject || '(без темы)'}
        onClose={close}
      />
      <MBody>
        <Field label="Кому назначить" required>
          {loading ? (
            <div className="c-t3 fs-12">⏳ Загружаем список РП…</div>
          ) : (
            <Combobox
              value={pmId}
              onChange={setPmId}
              options={options}
              placeholder="Начните вводить имя РП…"
              aria-label="Выберите РП"
            />
          )}
        </Field>
        <Field label="Комментарий (необязательно)">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Дополнительные указания РП"
          />
        </Field>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving || !pmId}>
          {saving ? '…' : 'Назначить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
