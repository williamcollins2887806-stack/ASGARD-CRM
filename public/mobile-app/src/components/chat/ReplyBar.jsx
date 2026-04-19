import { X } from 'lucide-react';

/**
 * ReplyBar — цитата при ответе на сообщение (над composer)
 */
export function ReplyBar({ replyTo, onCancel }) {
  if (!replyTo) return null;

  return (
    <div
      className="flex items-center gap-2 px-4 py-2"
      style={{
        borderTop: '0.5px solid var(--border-norse)',
        background: 'var(--bg-surface)',
      }}
    >
      <div
        className="w-[3px] self-stretch rounded-full shrink-0"
        style={{ background: 'var(--blue)' }}
      />
      <div className="flex-1 min-w-0">
        <p
          className="text-[11px] font-semibold truncate"
          style={{ color: 'var(--blue)' }}
        >
          {replyTo.user_name || 'Сообщение'}
        </p>
        <p
          className="text-[12px] truncate"
          style={{ color: 'var(--text-secondary)' }}
        >
          {replyTo.message || '...'}
        </p>
      </div>
      <button
        onClick={onCancel}
        className="p-1.5 rounded-full shrink-0"
        style={{ color: 'var(--text-tertiary)' }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
