import { useState, useRef, useCallback, useEffect, lazy, Suspense } from 'react';
import { Send, Paperclip, Mic, Smile, X, Trash2 } from 'lucide-react';
import { useHaptic } from '@/hooks/useHaptic';
import { ReplyBar } from './ReplyBar';
import { api } from '@/api/client';

const EmojiPicker = lazy(() =>
  import('./EmojiPicker').then((m) => ({ default: m.EmojiPicker }))
);

const CHAR_WARN = 500;

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Composer — поле ввода + голосовые сообщения + emoji + attach
 * Voice: long-press mic → запись → release → авто-отправка
 * Swipe left над кнопкой mic → отмена записи
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

  // Voice recording state
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [cancelZone, setCancelZone] = useState(false); // свайп влево для отмены
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const micBtnRef = useRef(null);
  const startXRef = useRef(0);

  const hasText = text.trim().length > 0;

  // — Таймер записи
  useEffect(() => {
    if (recording) {
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [recording]);

  // — Начать запись
  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/webm';

      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(100);
      mediaRecorderRef.current = mr;
      setRecording(true);
      haptic.medium();
    } catch {
      // нет разрешения или не поддерживается
    }
  }, [haptic]);

  // — Остановить запись и отправить (или отменить)
  const stopRecording = useCallback(async (cancel = false) => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === 'inactive') return;

    setRecording(false);
    setCancelZone(false);

    await new Promise((res) => {
      mr.onstop = res;
      mr.stop();
    });

    // Остановить все треки микрофона
    mr.stream?.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;

    if (cancel || chunksRef.current.length === 0) {
      chunksRef.current = [];
      haptic.light();
      return;
    }

    const duration = recordingTime;
    if (duration < 1) { chunksRef.current = []; return; } // слишком короткое

    const mimeType = chunksRef.current[0]?.type || 'audio/webm';
    const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

    setUploading(true);
    haptic.medium();
    try {
      const token = api.getToken();
      const form = new FormData();
      form.append('file', blob, `voice-${Date.now()}.${ext}`);
      form.append('file_duration', String(duration));
      const res = await fetch(`/api/chat-groups/${chatId}/upload-file`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error('upload failed');
      onFileUploaded?.();
      haptic.success?.() || haptic.medium();
    } catch {
      window.dispatchEvent(new CustomEvent('asgard:toast', {
        detail: { message: 'Ошибка отправки голосового', type: 'error' }
      }));
    } finally {
      setUploading(false);
    }
  }, [chatId, recordingTime, onFileUploaded, haptic]);

  // — Touch events на кнопке Mic
  const handleMicTouchStart = useCallback((e) => {
    e.preventDefault();
    startXRef.current = e.touches[0]?.clientX ?? 0;
    startRecording();
  }, [startRecording]);

  const handleMicTouchMove = useCallback((e) => {
    if (!recording) return;
    const dx = (e.touches[0]?.clientX ?? 0) - startXRef.current;
    setCancelZone(dx < -60);
  }, [recording]);

  const handleMicTouchEnd = useCallback((e) => {
    e.preventDefault();
    stopRecording(cancelZone);
  }, [cancelZone, stopRecording]);

  // — Обычная отправка текста
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
      window.dispatchEvent(new CustomEvent('asgard:toast', {
        detail: { message: err.message || 'Ошибка загрузки файла', type: 'error' }
      }));
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleEmojiSelect = (emoji) => {
    setText((prev) => prev + emoji);
    textareaRef.current?.focus();
  };

  // ─── Recording UI ────────────────────────────────────────────────
  if (recording) {
    return (
      <div
        style={{
          background: 'var(--bg-surface)',
          borderTop: '0.5px solid var(--border-norse)',
          paddingBottom: 'calc(8px + var(--safe-bottom))',
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Кнопка отмены */}
          <button
            onClick={() => stopRecording(true)}
            className="shrink-0 flex items-center justify-center spring-tap"
            style={{ width: 36, height: 36, color: 'var(--red-soft)' }}
          >
            <Trash2 size={20} />
          </button>

          {/* Прогресс-полоска с анимацией */}
          <div className="flex-1 flex items-center gap-2">
            {/* Пульс-точка */}
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: cancelZone ? 'var(--text-tertiary)' : 'var(--red-soft)',
                flexShrink: 0,
                animation: cancelZone ? 'none' : 'voice-pulse 1s ease-in-out infinite',
              }}
            />
            <div
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background: 'var(--bg-elevated)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min((recordingTime / 120) * 100, 100)}%`,
                  background: cancelZone ? 'var(--text-tertiary)' : 'var(--red-soft)',
                  transition: 'width 1s linear',
                  borderRadius: 2,
                }}
              />
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: cancelZone ? 'var(--text-tertiary)' : 'var(--red-soft)',
                fontVariantNumeric: 'tabular-nums',
                minWidth: 36,
              }}
            >
              {formatDuration(recordingTime)}
            </span>
          </div>

          {/* Свайп-подсказка / Mic-кнопка */}
          <div className="flex items-center gap-1 shrink-0">
            {cancelZone ? (
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Отмена</span>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>← отменить</span>
            )}
            <button
              ref={micBtnRef}
              onTouchMove={handleMicTouchMove}
              onTouchEnd={handleMicTouchEnd}
              onTouchCancel={handleMicTouchEnd}
              className="flex items-center justify-center rounded-full spring-tap"
              style={{
                width: 44,
                height: 44,
                background: cancelZone
                  ? 'var(--bg-elevated)'
                  : 'linear-gradient(135deg, #ff453a, #ff6b6b)',
                color: '#fff',
                boxShadow: cancelZone ? 'none' : '0 4px 16px rgba(255,69,58,0.4)',
                transition: 'all 0.2s var(--ease-spring)',
              }}
            >
              <Mic size={20} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Normal UI ───────────────────────────────────────────────────
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
          {text.length > CHAR_WARN && (
            <span
              className="absolute -top-5 right-1 text-[10px] font-medium"
              style={{ color: text.length > 2000 ? 'var(--red-soft)' : 'var(--text-tertiary)' }}
            >
              {text.length}
            </span>
          )}
        </div>

        {/* Right buttons */}
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

            {/* Mic — long press to record */}
            <button
              ref={micBtnRef}
              onTouchStart={handleMicTouchStart}
              onTouchMove={handleMicTouchMove}
              onTouchEnd={handleMicTouchEnd}
              onTouchCancel={handleMicTouchEnd}
              className="flex items-center justify-center spring-tap send-morph"
              style={{ width: 36, height: 36, color: 'var(--text-tertiary)' }}
            >
              <Mic size={20} />
            </button>
          </div>
        )}
      </div>

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
