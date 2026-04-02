import { useState, useEffect, useCallback } from 'react';
import { X, Search, Users, User, Check } from 'lucide-react';
import { api } from '@/api/client';
import { useHaptic } from '@/hooks/useHaptic';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

/**
 * NewChatSheet — bottom sheet для создания нового чата
 * BUG-6: фильтр пользователей (only active, no bots/test)
 * BUG-7: режим группового чата
 */
export function NewChatSheet({ open, onClose }) {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('direct'); // 'direct' | 'group'
  const [selected, setSelected] = useState([]); // for group mode
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const haptic = useHaptic();
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setMode('direct');
    setSelected([]);
    setGroupName('');
    setLoading(true);
    (async () => {
      try {
        const res = await api.get('/data/employees?limit=200');
        const rows = api.extractRows(res);
        // BUG-6: filter out inactive, bots, test accounts, nameless, self
        const cleaned = rows.filter((u) => {
          const name = u.full_name || u.name || '';
          if (!name.trim()) return false;
          if (u.is_active === false) return false;
          if (u.role === 'BOT') return false;
          const login = (u.login || '').toLowerCase();
          if (login.startsWith('test')) return false;
          const uid = u.id || u.user_id;
          if (uid === currentUserId) return false;
          return true;
        });
        setUsers(cleaned);
      } catch {
        setUsers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, currentUserId]);

  const filtered = search.trim()
    ? users.filter((u) =>
        (u.full_name || u.name || '')
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : users;

  const startDirectChat = useCallback(async (userId) => {
    haptic.light();
    try {
      const res = await api.post('/chat-groups/direct', { user_id: userId });
      const chat = res.chat || res;
      onClose();
      navigate(`/chat/${chat.id}`);
    } catch {}
  }, [haptic, navigate, onClose]);

  const toggleSelect = useCallback((userId) => {
    haptic.light();
    setSelected((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  }, [haptic]);

  const createGroupChat = useCallback(async () => {
    if (selected.length < 2 || !groupName.trim()) return;
    setCreating(true);
    haptic.light();
    try {
      const res = await api.post('/chat-groups', {
        name: groupName.trim(),
        member_ids: selected,
        is_group: true,
      });
      const chat = res.chat || res;
      onClose();
      navigate(`/chat/${chat.id}`);
    } catch {}
    setCreating(false);
  }, [selected, groupName, haptic, navigate, onClose]);

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
          maxHeight: '80vh',
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
            {mode === 'direct' ? 'Новый чат' : 'Новая группа'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-full"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 px-4 pb-2">
          <button
            onClick={() => { setMode('direct'); setSelected([]); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
            style={{
              background: mode === 'direct' ? 'var(--blue)' : 'var(--bg-surface-alt)',
              color: mode === 'direct' ? '#fff' : 'var(--text-secondary)',
              border: '0.5px solid var(--border-norse)',
            }}
          >
            <User size={14} />
            Личный
          </button>
          <button
            onClick={() => setMode('group')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
            style={{
              background: mode === 'group' ? 'var(--blue)' : 'var(--bg-surface-alt)',
              color: mode === 'group' ? '#fff' : 'var(--text-secondary)',
              border: '0.5px solid var(--border-norse)',
            }}
          >
            <Users size={14} />
            Группа
          </button>
        </div>

        {/* Group name input */}
        {mode === 'group' && (
          <div className="px-4 pb-2">
            <input
              type="text"
              placeholder="Название группы..."
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl outline-none text-[14px]"
              style={{
                background: 'var(--bg-surface-alt)',
                border: '0.5px solid var(--border-norse)',
                color: 'var(--text-primary)',
                caretColor: 'var(--gold)',
              }}
            />
            {selected.length > 0 && (
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Выбрано: {selected.length}
              </p>
            )}
          </div>
        )}

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
        <div className="overflow-y-auto scroll-container" style={{ maxHeight: mode === 'group' ? '40vh' : '50vh' }}>
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
          ) : filtered.length === 0 ? (
            <div className="flex justify-center py-8">
              <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
                Никого не найдено
              </p>
            </div>
          ) : (
            filtered.map((u) => {
              const uid = u.id || u.user_id;
              const name = u.full_name || u.name || u.login || '';
              const initials = name
                .split(' ')
                .slice(0, 2)
                .map((w) => w[0])
                .join('')
                .toUpperCase();
              const isSelected = selected.includes(uid);
              const subtitle = u.position || u.role_label || '';

              return (
                <button
                  key={uid}
                  onClick={() =>
                    mode === 'direct' ? startDirectChat(uid) : toggleSelect(uid)
                  }
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-left spring-tap"
                  style={{ borderBottom: '0.5px solid var(--border-norse)' }}
                >
                  {/* Checkbox for group mode */}
                  {mode === 'group' && (
                    <div
                      className="flex items-center justify-center rounded-md shrink-0"
                      style={{
                        width: 22,
                        height: 22,
                        border: isSelected ? 'none' : '2px solid var(--text-tertiary)',
                        background: isSelected ? 'var(--blue)' : 'transparent',
                        borderRadius: 6,
                      }}
                    >
                      {isSelected && <Check size={14} color="#fff" strokeWidth={3} />}
                    </div>
                  )}

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
                    {subtitle && (
                      <p
                        className="text-[12px] truncate"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {subtitle}
                      </p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Create group button */}
        {mode === 'group' && (
          <div className="px-4 py-3" style={{ borderTop: '0.5px solid var(--border-norse)' }}>
            <button
              onClick={createGroupChat}
              disabled={selected.length < 2 || !groupName.trim() || creating}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[15px] font-semibold transition-opacity"
              style={{
                background: 'var(--blue)',
                color: '#fff',
                opacity: selected.length < 2 || !groupName.trim() || creating ? 0.4 : 1,
              }}
            >
              {creating ? (
                <div
                  className="h-4 w-4 rounded-full animate-spin"
                  style={{
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#fff',
                  }}
                />
              ) : (
                <>
                  <Users size={16} />
                  Создать группу ({selected.length})
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
