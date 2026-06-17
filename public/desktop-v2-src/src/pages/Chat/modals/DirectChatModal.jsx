/**
 * DirectChatModal — выбрать сотрудника → открыть прямой чат 1-на-1.
 * Источник: vanilla chat_groups.js:113 (POST /api/chat-groups/direct).
 *
 * Backend возвращает существующий direct-чат или создаёт новый.
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, SearchInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { loadUsers, openDirectChat, initials } from '../api';

export function DirectChatModal({ onCreated }) {
  const { close } = useModal();
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadUsers().then(setUsers);
  }, []);

  const filtered = useMemo(() => {
    const lq = q.trim().toLowerCase();
    if (!lq) return users.slice(0, 80);
    return users.filter((u) =>
      (u.name || u.full_name || u.login || '').toLowerCase().includes(lq) ||
      (u.role || '').toLowerCase().includes(lq)
    ).slice(0, 80);
  }, [users, q]);

  const pick = async (u) => {
    setBusy(true);
    try {
      const res = await openDirectChat(u.id);
      const chatId = res?.chat?.id || res?.id || res?.chat_id;
      if (!chatId) throw new Error('Backend не вернул id чата');
      toast('💬 Чат открыт', u.name || u.login || '', 'ok');
      onCreated?.(chatId);
      window.dispatchEvent(new CustomEvent('asgard:chat:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="💬" title="Новый личный чат" subtitle="Выберите сотрудника" onClose={close} />
      <MBody>
        <div className="col gap-10">
          <Field label="Поиск сотрудника">
            <SearchInput value={q} onChange={setQ} placeholder="Имя, логин или роль…" />
          </Field>
          <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filtered.length === 0 ? (
              <div className="c-t3 fs-13 p-12">Никого не нашли</div>
            ) : filtered.map((u) => (
              <button
                key={u.id}
                disabled={busy}
                className="chat-group-btn"
                onClick={() => pick(u)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, cursor: 'pointer' }}
              >
                <div style={{ width: 30, height: 30, background: 'var(--gold)', color: '#1a1000', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>
                  {initials(u.name || u.login)}
                </div>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <strong className="fs-13">{u.name || u.full_name || u.login}</strong>
                  <div className="c-t3 fs-11">{u.role || ''}{u.position ? ' · ' + u.position : ''}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </MBody>
      <MFoot align="end">
        <Btn onClick={close}>Отмена</Btn>
      </MFoot>
    </MCard>
  );
}
