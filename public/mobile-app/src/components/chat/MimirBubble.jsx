import { MarkdownText } from './MarkdownText';

/**
 * MimirBubble — пузырь сообщения Мимира (gradient аватарка, gold border)
 */
export function MimirBubble({ msg, isNew }) {
  const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="flex items-start gap-2 px-3 py-1"
      style={{ animation: isNew ? 'msgFadeIn 150ms ease-out both' : undefined }}
    >
      {/* Gradient avatar */}
      <div
        className="shrink-0 flex items-center justify-center"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #6e1d2a, #0d2848)',
          border: '2px solid #D4A843',
          fontSize: 14,
          fontWeight: 700,
          color: '#D4A843',
        }}
      >
        M
      </div>

      <div style={{ maxWidth: '85%', minWidth: 0 }}>
        {/* Name + pill */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <span style={{ fontSize: 13, fontWeight: 600, color: '#D4A843' }}>Мимир</span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 4,
              background: 'rgba(212,168,67,0.12)',
              color: '#D4A843',
            }}
          >
            ассистент
          </span>
        </div>

        {/* Bubble */}
        <div
          style={{
            background: '#1a1a0e',
            border: '1px solid rgba(212,168,67,0.2)',
            borderRadius: '4px 16px 16px 16px',
            padding: '10px 14px',
          }}
        >
          <div
            className="whitespace-pre-wrap break-words"
            style={{ fontSize: 15, lineHeight: 1.5, color: '#e6edf3' }}
          >
            <MarkdownText text={msg.message} />
          </div>
          <div className="flex justify-end mt-1">
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{time}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
