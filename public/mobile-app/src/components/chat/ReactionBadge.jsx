import { useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';

/**
 * ReactionBadge — реакции под баблом.
 * reactions: { "❤️": [user_id, ...], "👍": [user_id, ...] }
 * Tap — toggle реакция. Long-press — показать тултип с кол-вом.
 */
export function ReactionBadge({ reactions, onTap }) {
  const userId = useAuthStore((s) => s.user?.id);

  if (!reactions || typeof reactions !== 'object') return null;

  const entries = Object.entries(reactions).filter(([, users]) => {
    if (Array.isArray(users)) return users.length > 0;
    return Number(users) > 0;
  });

  if (entries.length === 0) return null;

  const getCount = (users) =>
    Array.isArray(users) ? users.length : Number(users);

  const isMine = (users) =>
    Array.isArray(users) && users.includes(userId);

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {entries.map(([emoji, users]) => {
        const count = getCount(users);
        const mine = isMine(users);

        return (
          <button
            key={emoji}
            onClick={() => onTap?.(emoji)}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full spring-tap"
            style={{
              background: mine
                ? 'color-mix(in srgb, var(--gold) 15%, var(--bg-surface))'
                : 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
              border: mine
                ? '0.5px solid color-mix(in srgb, var(--gold) 40%, transparent)'
                : '0.5px solid var(--border-norse)',
              fontSize: 13,
              transition: 'background 0.15s, border-color 0.15s',
            }}
          >
            <span>{emoji}</span>
            {count > 1 && (
              <span
                className="text-[10px] font-semibold"
                style={{ color: mine ? 'var(--gold)' : 'var(--text-secondary)' }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
