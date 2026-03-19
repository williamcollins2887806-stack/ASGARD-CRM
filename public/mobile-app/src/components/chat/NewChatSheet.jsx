import { useState, useEffect } from 'react';
import { X, Search } from 'lucide-react';
import { api } from '@/api/client';
import { useHaptic } from '@/hooks/useHaptic';
import { useNavigate } from 'react-router-dom';

/**
 * NewChatSheet — bottom sheet для создания нового чата
 */
export function NewChatSheet({ open, onClose }) {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const haptic = useHaptic();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await api.get('/data/employees?limit=200');
        const rows = api.extractRows(res);
        setUsers(rows);
      } catch {
        setUsers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const filtered = search.trim()
    ? users.filter((u) =>
        (u.full_name || u.name || '')
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : users;

  const startChat = async (userId) => {
    haptic.light();
    try {
      const res = await api.post('/chat-groups/direct', { user_id: userId });
      const chat = res.chat || res;
      onClose();
      navigate(`/chat/${chat.id}`);
    } catch {}
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: 40, background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      <div
        className="fixed bottom-0 left-0 right-0 rounded-t-2xl overflow-hidden"
        style={{
          zIndex: 41,
          background: 'var(--bg-surface)',
          maxHeight: '70vh',
          paddingBottom: 'var(--safe-bottom)',
          animation: 'fadeInUp 200ms var(--ease-spring) forwards',
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div
            className="rounded-full"
            style={{
              width: 36,
              height: 4,
              background: 'var(--text-tertiary)',
              opacity: 0.3,
            }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2">
          <h3
            className="text-[17px] font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            Новый чат
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-full"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pb-2">
          <div
            className="flex items-center gap-2 px-3 rounded-xl"
            style={{
              height: 36,
              background: 'var(--bg-surface-alt)',
              border: '0.5px solid var(--border-norse)',
            }}
          >
            <Search size={16} style={{ color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              placeholder="Поиск сотрудника..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent outline-none text-[14px]"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {/* Users list */}
        <div className="overflow-y-auto scroll-container" style={{ maxHeight: '50vh' }}>
          {loading ? (
            <div className="flex justify-center py-8">
              <div
                className="h-6 w-6 rounded-full animate-spin"
                style={{
                  border: '2px solid var(--bg-elevated)',
                  borderTopColor: 'var(--gold)',
                }}
              />
            </div>
          ) : (
            filtered.map((u) => {
              const name = u.full_name || u.name || u.login || '';
              const initials = name
                .split(' ')
                .slice(0, 2)
                .map((w) => w[0])
                .join('')
                .toUpperCase();

              return (
                <button
                  key={u.id || u.user_id}
                  onClick={() => startChat(u.id || u.user_id)}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-left spring-tap"
                  style={{ borderBottom: '0.5px solid var(--border-norse)' }}
                >
                  <div
                    className="flex items-center justify-center rounded-full shrink-0"
                    style={{
                      width: 40,
                      height: 40,
                      background: 'var(--hero-gradient)',
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#fff',
                    }}
                  >
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-[14px] font-medium truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {name}
                    </p>
                    {u.position && (
                      <p
                        className="text-[12px] truncate"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {u.position}
                      </p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
