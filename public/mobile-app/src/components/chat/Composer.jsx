import { useState, useRef, useCallback, lazy, Suspense } from 'react';
import { Send, Paperclip, Mic, Smile } from 'lucide-react';
import { useHaptic } from '@/hooks/useHaptic';
import { ReplyBar } from './ReplyBar';
import { api } from '@/api/client';

const EmojiPicker = lazy(() =>
  import('./EmojiPicker').then((m) => ({ default: m.EmojiPicker }))
);

const CHAR_WARN = 500;

/**
 * Composer — поле ввода + кнопки (emoji, attach, voice, send)
 * Gold gradient send, morph mic→send, счётчик символов
 */
export function Composer({
  chatId,
  onSend,
  replyTo,
  onCancelReply,
  onTyping,
  onFileUploaded,
}) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const haptic = useHaptic();

  const hasText = text.trim().length > 0;

  const handleSend = useCallback(() => {
    if (!hasText) return;
    haptic.light();
    onSend(text.trim(), replyTo?.id);
    setText('');
    onCancelReply?.();
    setShowEmoji(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [text, replyTo, hasText, onSend, onCancelReply, haptic]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e) => {
    setText(e.target.value);
    onTyping?.();
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !chatId) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (file.name) form.append('original_name', file.name);
      const token = api.getToken();
      const res = await fetch(`/api/chat-groups/${chatId}/upload-file`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed (${res.status})`);
      }
      onFileUploaded?.();
    } catch (err) {
      // Show native alert as simple toast
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('asgard:toast', {
          detail: { message: err.message || 'Ошибка загрузки файла', type: 'error' }
        }));
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleEmojiSelect = (emoji) => {
    setText((prev) => prev + emoji);
    textareaRef.current?.focus();
  };

  return (
    <div style={{ background: 'var(--bg-surface)' }}>
      <ReplyBar replyTo={replyTo} onCancel={onCancelReply} />

      <div
        className="flex items-end gap-2 px-3 py-2"
        style={{
          borderTop: '0.5px solid var(--border-norse)',
          paddingBottom: 'calc(8px + var(--safe-bottom))',
        }}
      >
        {/* Emoji button */}
        <button
          onClick={() => setShowEmoji(!showEmoji)}
          className="shrink-0 flex items-center justify-center spring-tap"
          style={{
            width: 36,
            height: 36,
            color: showEmoji ? 'var(--gold)' : 'var(--text-tertiary)',
          }}
        >
          <Smile size={22} />
        </button>

        {/* Textarea */}
        <div className="flex-1 relative">
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'var(--bg-surface-alt)',
              border: '0.5px solid var(--border-norse)',
            }}
          >
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Сообщение..."
              rows={1}
              className="w-full px-3 py-2 resize-none outline-none text-[15px] leading-[1.35]"
              style={{
                background: 'transparent',
                color: 'var(--text-primary)',
                caretColor: 'var(--gold)',
                maxHeight: 120,
              }}
            />
          </div>
          {/* Character counter */}
          {text.length > CHAR_WARN && (
            <span
              className="absolute -top-5 right-1 text-[10px] font-medium"
              style={{ color: text.length > 2000 ? 'var(--red-soft)' : 'var(--text-tertiary)' }}
            >
              {text.length}
            </span>
          )}
        </div>

        {/* Right buttons — morph transition */}
        {hasText ? (
          <button
            onClick={handleSend}
            className="shrink-0 flex items-center justify-center rounded-full send-morph"
            style={{
              width: 36,
              height: 36,
              background: 'var(--gold-gradient)',
              color: '#fff',
            }}
          >
            <Send size={18} className="ml-0.5" />
          </button>
        ) : (
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Attach */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center spring-tap"
              style={{
                width: 36,
                height: 36,
                color: uploading ? 'var(--gold)' : 'var(--text-tertiary)',
              }}
            >
              {uploading ? (
                <div
                  className="h-4 w-4 rounded-full animate-spin"
                  style={{
                    border: '2px solid var(--bg-elevated)',
                    borderTopColor: 'var(--gold)',
                  }}
                />
              ) : (
                <Paperclip size={20} />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx"
            />

            {/* Mic */}
            <button
              className="flex items-center justify-center spring-tap send-morph"
              style={{ width: 36, height: 36, color: 'var(--text-tertiary)' }}
            >
              <Mic size={20} />
            </button>
          </div>
        )}
      </div>

      {/* Emoji picker */}
      {showEmoji && (
        <Suspense fallback={null}>
          <EmojiPicker
            onSelect={handleEmojiSelect}
            onClose={() => setShowEmoji(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
