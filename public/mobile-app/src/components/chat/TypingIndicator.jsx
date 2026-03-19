/**
 * TypingIndicator — "Печатает..." с bounce dots
 */
export function TypingIndicator({ users = [] }) {
  if (users.length === 0) return null;

  const names = users.map((u) => u.user_name || 'Кто-то');
  const label =
    names.length === 1
      ? `${names[0]} печатает`
      : `${names[0]} и ещё ${names.length - 1} печатают`;

  return (
    <div className="flex items-center gap-2 px-4 py-1.5">
      <div className="flex gap-[3px] items-end">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block rounded-full"
            style={{
              width: 5,
              height: 5,
              background: 'var(--text-tertiary)',
              animation: `dotBounce 1s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
      <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </span>
    </div>
  );
}
