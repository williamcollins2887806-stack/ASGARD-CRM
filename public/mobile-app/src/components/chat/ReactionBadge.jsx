/**
 * ReactionBadge — реакции под баблом
 */
export function ReactionBadge({ reactions, onTap }) {
  if (!reactions || typeof reactions !== 'object') return null;

  const entries = Object.entries(reactions).filter(
    ([, count]) => count > 0
  );
  if (entries.length === 0) return null;

  return (
    <div className="flex gap-1 mt-1">
      {entries.map(([emoji, count]) => (
        <button
          key={emoji}
          onClick={() => onTap?.(emoji)}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full spring-tap"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
            border: '0.5px solid var(--border-norse)',
            fontSize: 12,
          }}
        >
          <span>{emoji}</span>
          {count > 1 && (
            <span
              className="text-[10px]"
              style={{ color: 'var(--text-secondary)' }}
            >
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
