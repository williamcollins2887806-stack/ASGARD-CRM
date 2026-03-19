/**
 * DateSeparator — разделитель дат в чате
 */
export function DateSeparator({ date }) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  let label;
  if (d.toDateString() === today.toDateString()) {
    label = 'Сегодня';
  } else if (d.toDateString() === yesterday.toDateString()) {
    label = 'Вчера';
  } else {
    label = d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
    });
  }

  return (
    <div className="flex items-center justify-center py-3">
      <span
        className="px-3 py-1 rounded-full text-[11px] font-medium"
        style={{
          background: 'color-mix(in srgb, var(--bg-surface) 80%, transparent)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          color: 'var(--text-tertiary)',
        }}
      >
        {label}
      </span>
    </div>
  );
}
