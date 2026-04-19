import { useState, useCallback } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { api } from '@/api/client';
import { useHaptic } from '@/hooks/useHaptic';

/**
 * AddMemberSheet — bottom sheet для добавления участника в чат
 */
export function AddMemberSheet({ open, onClose, chatId, existingMemberIds = [] }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(null);
  const haptic = useHaptic();

  const handleSearch = useCallback(async (q) => {
    setSearch(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get(`/users?search=${encodeURIComponent(q.trim())}`);
      const users = Array.isArray(res) ? res : res.rows || res.users || [];
      setResults(users.filter((u) => !existingMemberIds.includes(u.id)));
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, [existingMemberIds]);

  const handleAdd = useCallback(async (userId) => {
    setAdding(userId);
    try {
      await api.post(`/chat-groups/${chatId}/members`, { user_id: userId });
      haptic.success();
      setResults((prev) => prev.filter((u) => u.id !== userId));
    } catch {
      haptic.error();
    }
    setAdding(null);
  }, [chatId, haptic]);

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Добавить участника">
      {/* Search */}
      <div
        className="flex items-center gap-2 px-3 rounded-xl mb-3"
        style={{
          height: 40,
          background: 'var(--bg-surface-alt)',
          border: '0.5px solid var(--border-norse)',
        }}
      >
        <Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Поиск по имени..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="flex-1 bg-transparent outline-none text-[14px]"
          style={{ color: 'var(--text-primary)', caretColor: 'var(--gold)' }}
          autoFocus
        />
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex justify-center py-6">
          <div
            className="h-6 w-6 rounded-full animate-spin"
            style={{ border: '2px solid var(--bg-elevated)', borderTopColor: 'var(--gold)' }}
          />
        </div>
      ) : results.length === 0 && search.trim().length >= 2 ? (
        <p className="text-center py-6 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          Никого не найдено
        </p>
      ) : (
        <div className="space-y-1">
          {results.map((user) => (
            <div
              key={user.id}
              className="flex items-center gap-3 py-2.5 px-1 rounded-lg"
              style={{ borderBottom: '0.5px solid var(--border-norse)' }}
            >
              <div
                className="shrink-0 flex items-center justify-center"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: '#2d2d2d',
                  color: '#888',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {getInitials(user.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {user.name}
                </p>
                {user.role && (
                  <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    {user.role}
                  </p>
                )}
              </div>
              <button
                onClick={() => handleAdd(user.id)}
                disabled={adding === user.id}
                className="shrink-0 flex items-center justify-center spring-tap"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'rgba(88,166,255,0.12)',
                  color: '#58a6ff',
                }}
              >
                {adding === user.id ? (
                  <div
                    className="h-4 w-4 rounded-full animate-spin"
                    style={{ border: '2px solid transparent', borderTopColor: '#58a6ff' }}
                  />
                ) : (
                  <UserPlus size={16} />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
