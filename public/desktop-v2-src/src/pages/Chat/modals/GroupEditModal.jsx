/**
 * GroupEditModal — создание/правка чат-группы + управление участниками.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, TextareaInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { createGroup, updateGroup, addMember, removeMember, loadUsers, initials } from '../api';

export function GroupEditModal({ group, onCreated }) {
  const { close } = useModal();
  const [form, setForm] = useState({
    name: group?.name || group?.title || '',
    description: group?.description || '',
    // D-83: group_kind (public/private/work/broadcast) — отдельная семантика
    // от chats.type (direct/group/mimir). На бэке поле называется group_kind.
    type: group?.group_kind || group?.type || 'public',
    work_id: group?.work_id || null
  });
  const [users, setUsers] = useState([]);
  const [members, setMembers] = useState(group?.members || []);
  const [pickUser, setPickUser] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadUsers().then(setUsers);
  }, []);

  const save = async () => {
    if (!form.name?.trim()) return toast('Название', '—', 'warn');
    setBusy(true);
    try {
      let id = group?.id;
      const payload = {
        name: form.name?.trim(),
        description: form.description?.trim() || null,
        group_kind: form.type || 'public',
        is_readonly: form.type === 'broadcast' // объявления — только админ пишет
        // member_ids синхронизируются отдельно через addMember после создания (ниже)
      };
      if (group?.id) {
        await updateGroup(group.id, {
          name: payload.name,
          description: payload.description,
          group_kind: payload.group_kind,
          is_readonly: payload.is_readonly
        });
      } else {
        const created = await createGroup(payload);
        id = created?.group?.id || created?.id;
      }
      // Синхронизация участников (только при создании)
      if (!group?.id && members.length > 0 && id) {
        await Promise.all(members.map((m) => addMember(id, m.id || m.user_id)));
      }
      toast(group?.id ? 'Сохранено' : 'Группа создана', form.name, 'ok');
      onCreated?.(id);
      window.dispatchEvent(new CustomEvent('asgard:chat:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  const addMemberToList = () => {
    if (!pickUser) {
      toast('Выберите пользователя', 'Сначала укажите пользователя в выпадающем списке выше', 'warn');
      return;
    }
    const u = users.find((x) => String(x.id) === pickUser);
    if (!u) {
      toast('Пользователь не найден', 'Перевыберите из списка', 'warn');
      return;
    }
    if (members.find((m) => (m.id || m.user_id) === u.id)) return toast('Уже в группе', u.name || u.login, 'info');
    if (group?.id) {
      addMember(group.id, u.id).then(() => {
        setMembers([...members, u]);
        toast('Добавлен', u.name || u.login, 'ok');
      }).catch((e) => toast('Ошибка', String(e?.message || e), 'err'));
    } else {
      setMembers([...members, u]);
    }
    setPickUser('');
  };

  const removeFromList = (m) => {
    const id = m.id || m.user_id;
    if (group?.id) {
      removeMember(group.id, id).then(() => {
        setMembers(members.filter((x) => (x.id || x.user_id) !== id));
        toast('Удалён', m.name || '', 'ok');
      }).catch((e) => toast('Ошибка', String(e?.message || e), 'err'));
    } else {
      setMembers(members.filter((x) => (x.id || x.user_id) !== id));
    }
  };

  const availableUsers = users.filter((u) => !members.find((m) => (m.id || m.user_id) === u.id));

  return (
    <MCard className="modal-lg">
      <MHead icon="💬" title={group?.id ? 'Группа: ' + (group.name || group.title) : 'Новая группа'} onClose={close} />
      <MBody>
        <div className="col gap-10">
          <Field label="Название" required><TextInput value={form.name} onChange={(v) => setForm({ ...form, name: v })} /></Field>
          <Field label="Описание"><TextareaInput value={form.description} onChange={(v) => setForm({ ...form, description: v })} minRows={2} maxRows={4} /></Field>
          <Field label="Тип">
            <SelectInput value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={[
              { value: 'public',    label: '🌐 Открытая (все видят)' },
              { value: 'private',   label: '🔒 Закрытая (только участники)' },
              { value: 'work',      label: '🏗 Привязана к работе' },
              { value: 'broadcast', label: '📢 Объявления (только админ пишет)' }
            ]} />
          </Field>

          <div className="p-10 bg-inner r-md">
            <div className="row-spread mb-8">
              <strong className="mini-kpi-label">
                Участники ({members.length})
              </strong>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <SelectInput value={pickUser} onChange={setPickUser} options={[{ value: '', label: '— выбрать —' }, ...availableUsers.map((u) => ({ value: String(u.id), label: u.name || u.login }))]} />
              <Btn size="sm" variant="primary" onClick={addMemberToList}>+ Добавить</Btn>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
              {members.length === 0 ? (
                <div style={{ color: 'var(--t-3)', fontSize: 12.5, padding: 6 }}>Участников пока нет</div>
              ) : members.map((m) => (
                <div key={m.id || m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 6, background: 'var(--card-bg)', borderRadius: 'var(--r-sm)' }}>
                  <div style={{ width: 24, height: 24, background: 'var(--gold)', color: '#1a1000', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700 }}>
                    {initials(m.name || m.login)}
                  </div>
                  <span className="flex-1 fs-13">{m.name || m.login} <span className="c-t3 fs-11">{m.role}</span></span>
                  <button className="btn-ghost px-8 py-2" onClick={() => removeFromList(m)}>×</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : (group?.id ? 'Сохранить' : 'Создать')}</Btn>
      </MFoot>
    </MCard>
  );
}
