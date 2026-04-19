/**
 * ActionBadge — badge действия директора (рядом с именем в пузыре)
 */

const ACTION_MAP = {
  approve: { label: 'Согласовано', bg: 'rgba(63,185,80,0.12)', color: '#3FB950' },
  rework: { label: 'На доработку', bg: 'rgba(212,168,67,0.12)', color: '#D4A843' },
  question: { label: 'Вопрос', bg: 'rgba(88,166,255,0.12)', color: '#58a6ff' },
  reject: { label: 'Отклонено', bg: 'rgba(248,81,73,0.12)', color: '#F85149' },
  resubmit: { label: 'Переотправлено', bg: 'rgba(88,166,255,0.12)', color: '#58a6ff' },
};

export function ActionBadge({ action }) {
  const cfg = ACTION_MAP[action];
  if (!cfg) return null;

  return (
    <span
      className="inline-flex items-center"
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 6,
        background: cfg.bg,
        color: cfg.color,
        animation: 'badgeScale 200ms var(--ease-spring) both',
      }}
    >
      {cfg.label}
    </span>
  );
}
