import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * EditMessageSheet — BottomSheet для редактирования сообщения (замена prompt())
 */
export function EditMessageSheet({ message, onSave, onClose }) {
  const [text, setText] = useState(message?.message || '');
  const textareaRef = useRef(null);

  useEffect(() => {
    setText(message?.message || '');
    // Автофокус с задержкой для анимации
    const t = setTimeout(() => textareaRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [message]);

  const handleSave = () => {
    const trimmed = text.trim();
    if (trimmed && trimmed !== message?.message) {
      onSave(message.id, trimmed);
    }
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  if (!message) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 ctx-backdrop"
        onClick={onClose}
      />
      {/* Sheet */}
      <div
        className="fixed left-0 right-0 bottom-0 rounded-t-2xl"
        style={{
          background: 'var(--bg-surface)',
          borderTop: '0.5px solid var(--border-norse)',
          paddingBottom: 'calc(16px + var(--safe-bottom))',
          zIndex: 'var(--z-modal)',
          animation: 'sheetUp 250ms var(--ease-smooth-out) both',
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div
            className="w-9 h-1 rounded-full"
            style={{ background: 'var(--border-light)' }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3">
          <span className="text-[15px] font-semibold c-primary">
            Редактировать
          </span>
          <button onClick={onClose} className="btn-icon">
            <X size={20} />
          </button>
        </div>

        {/* Textarea */}
        <div className="px-4 mb-3">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            className="input-field resize-none"
            style={{ minHeight: 80, maxHeight: 200 }}
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3 px-4">
          <button
            onClick={onClose}
            className="btn-action"
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
            }}
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            className="btn-action"
            style={{
              background: 'var(--gold-gradient)',
              color: '#fff',
            }}
            disabled={!text.trim() || text.trim() === message?.message}
          >
            Сохранить
          </button>
        </div>
      </div>
    </>
  );
}
