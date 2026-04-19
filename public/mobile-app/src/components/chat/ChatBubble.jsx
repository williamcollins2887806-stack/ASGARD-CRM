import { ActionBadge } from './ActionBadge';

/**
 * ChatBubble — пузырь сообщения для estimate-чата
 * Директор/чужие слева (тёмный), свои справа (синий)
 */

const ROLE_COLORS = {
  DIRECTOR_GEN: { bg: '#3d2a0a', text: '#D4A843' },
  DIRECTOR_COMM: { bg: '#3d2a0a', text: '#D4A843' },
  DIRECTOR_DEV: { bg: '#3d2a0a', text: '#D4A843' },
  PM: { bg: '#0d2848', text: '#58a6ff' },
  HEAD_PM: { bg: '#0d2848', text: '#58a6ff' },
  TO: { bg: '#0a2e0a', text: '#3FB950' },
  HEAD_TO: { bg: '#0a2e0a', text: '#3FB950' },
};
const DEFAULT_ROLE = { bg: '#2d2d2d', text: '#888' };

function getInitials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}

export function ChatBubble({ msg, isMine, showName, userRole, isNew }) {
  const rc = ROLE_COLORS[userRole] || DEFAULT_ROLE;
  const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const action = msg.metadata?.approval_action;

  return (
    <div
      className={`flex ${isMine ? 'justify-end' : 'justify-start'} px-3 py-0.5`}
      style={{ animation: isNew ? 'msgFadeIn 150ms ease-out both' : undefined }}
    >
      {/* Avatar (only for others, only when showName) */}
      {!isMine && showName && (
        <div
          className="shrink-0 flex items-center justify-center mr-2 mt-0.5"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: rc.bg,
            color: rc.text,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {getInitials(msg.user_name)}
        </div>
      )}
      {!isMine && !showName && <div style={{ width: 40 }} />}

      <div style={{ maxWidth: '80%', minWidth: 0 }}>
        {/* Name + action badge */}
        {!isMine && showName && (
          <div className="flex items-center gap-2 mb-0.5 ml-1">
            <span style={{ fontSize: 13, fontWeight: 600, color: rc.text }}>
              {msg.user_name}
            </span>
            {action && <ActionBadge action={action} />}
          </div>
        )}
        {isMine && action && (
          <div className="flex justify-end mb-0.5 mr-1">
            <ActionBadge action={action} />
          </div>
        )}

        {/* Bubble */}
        <div
          style={{
            background: isMine ? '#0d2848' : '#161b22',
            borderRadius: isMine ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
            padding: '10px 14px',
            marginLeft: isMine ? 'auto' : 0,
            opacity: msg._sending ? 0.7 : 1,
            transition: 'opacity 200ms',
          }}
        >
          <p
            className="whitespace-pre-wrap break-words"
            style={{ fontSize: 15, lineHeight: 1.5, color: isMine ? '#fff' : '#e6edf3' }}
          >
            {msg.message}
          </p>
          <div className="flex items-center justify-end gap-1 mt-0.5">
            <span style={{ fontSize: 11, color: isMine ? 'rgba(255,255,255,0.5)' : 'var(--text-tertiary)' }}>
              {time}
            </span>
            {msg._failed && (
              <span style={{ fontSize: 11, color: '#F85149' }}>!</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
