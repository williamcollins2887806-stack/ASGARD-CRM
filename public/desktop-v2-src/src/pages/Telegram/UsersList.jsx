/**
 * Вкладка «Пользователи» — таблица всех юзеров CRM с inline-input для chat_id,
 * кнопкой «Сохранить» и «Отправить пароль через Telegram» (если chat_id привязан).
 */
import { useEffect, useMemo, useState } from 'react';
import { SearchInput } from '@/inputs/Inputs';
import { EmptyState } from '@/blocks/Blocks';
import { toast } from '@/modals/Notifications';
import { loadUsers, setChatId, sendTempPassword } from './api';

const ROLE_LABEL = {
  ADMIN: 'Админ', PM: 'РП', TO: 'ТО', HEAD_PM: 'Гл. РП', HEAD_TO: 'Гл. ТО',
  HR: 'HR', HR_MANAGER: 'HR-менедж.', BUH: 'Бух.',
  DIRECTOR_GEN: 'Дир. ген.', DIRECTOR_COMM: 'Дир. ком.', DIRECTOR_DEV: 'Дир. разв.',
  OFFICE_MANAGER: 'Офис-менедж.', CHIEF_ENGINEER: 'Гл. инженер',
  WAREHOUSE: 'Склад', PROC: 'Закупки'
};

export default function UsersList() {
  const [users, setUsers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState({}); // { [userId]: 'chatId' }
  const [busy, setBusy] = useState({});      // { [userId]: 'save' | 'pwd' }

  useEffect(() => { reload(); }, []);

  async function reload() {
    setLoaded(false);
    try {
      const r = await loadUsers();
      setUsers(r.users || []);
      // Сбрасываем drafts на актуальные значения из БД.
      const map = {};
      for (const u of r.users || []) map[u.id] = u.telegram_chat_id || '';
      setDrafts(map);
    } catch (e) {
      toast.error('Не удалось загрузить пользователей: ' + (e.message || e));
    } finally {
      setLoaded(true);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.login || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q)
    );
  }, [users, search]);

  async function handleSave(user) {
    const value = (drafts[user.id] || '').trim();
    setBusy((b) => ({ ...b, [user.id]: 'save' }));
    try {
      const r = await setChatId(user.id, value || null);
      setUsers((arr) => arr.map((u) => u.id === user.id ? { ...u, telegram_chat_id: r.user.telegram_chat_id } : u));
      toast.success(`Chat ID для ${user.name || user.login} ${value ? 'обновлён' : 'удалён'}`);
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e.message || e));
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[user.id]; return n; });
    }
  }

  async function handleSendPassword(user) {
    if (!confirm(`Отправить временный пароль пользователю ${user.name || user.login} в Telegram?`)) return;
    setBusy((b) => ({ ...b, [user.id]: 'pwd' }));
    try {
      const r = await sendTempPassword(user.id);
      toast.success(r.message || 'Пароль отправлен');
    } catch (e) {
      toast.error('Не удалось отправить: ' + (e.message || e));
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[user.id]; return n; });
    }
  }

  if (!loaded) {
    return <div className="card p-16 c-t3">⏳ Загружаем пользователей…</div>;
  }

  return (
    <div className="col gap-12">
      <div className="row gap-12 ai-center">
        <div style={{ minWidth: 240, flex: '0 0 320px' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск по имени / логину / email…" />
        </div>
        <button className="btn ghost" onClick={reload}>↻ Обновить</button>
        <div className="c-t3 t-small">
          Всего: {users.length} · Привязано: {users.filter((u) => u.telegram_chat_id).length}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="Никого не нашли"
          hint="Попробуйте другой поисковый запрос"
        />
      ) : (
        <div className="card p-0" style={{ overflow: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Пользователь</th>
                <th style={{ minWidth: 110 }}>Роль</th>
                <th style={{ minWidth: 200 }}>Email</th>
                <th style={{ minWidth: 220 }}>Telegram Chat ID</th>
                <th style={{ minWidth: 220 }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const draft = drafts[u.id] ?? '';
                const original = u.telegram_chat_id || '';
                const dirty = draft.trim() !== original.trim();
                const hasChatId = Boolean(u.telegram_chat_id);
                return (
                  <tr key={u.id} className={u.is_active === false ? 't-muted' : ''}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.name || u.login}</div>
                      <div className="c-t3 t-small">{u.login}</div>
                    </td>
                    <td>
                      <span className="pill">{ROLE_LABEL[u.role] || u.role}</span>
                    </td>
                    <td className="t-small">{u.email || <span className="c-t3">—</span>}</td>
                    <td>
                      <input
                        className="inp-text"
                        style={{ width: 180 }}
                        type="text"
                        inputMode="numeric"
                        placeholder="123456789"
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [u.id]: e.target.value }))}
                      />
                      {hasChatId && (
                        <div className="c-ok t-small" style={{ marginTop: 2 }}>✓ привязан</div>
                      )}
                    </td>
                    <td>
                      <div className="row gap-8">
                        <button
                          className="btn mini primary"
                          onClick={() => handleSave(u)}
                          disabled={!dirty || busy[u.id] === 'save'}
                          title={dirty ? 'Сохранить изменения' : 'Нет изменений'}
                        >
                          {busy[u.id] === 'save' ? '⏳' : '💾'} Сохранить
                        </button>
                        <button
                          className="btn mini ghost"
                          onClick={() => handleSendPassword(u)}
                          disabled={!hasChatId || busy[u.id] === 'pwd'}
                          title={hasChatId ? 'Отправить временный пароль в Telegram' : 'Сначала привяжите Chat ID'}
                        >
                          {busy[u.id] === 'pwd' ? '⏳' : '🔑'} Пароль
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
