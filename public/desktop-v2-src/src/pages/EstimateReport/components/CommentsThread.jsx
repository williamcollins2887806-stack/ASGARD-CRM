import { useState } from 'react';
import { Btn } from '@/modals/parts';
import { TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { postComment, fmtDateTime } from '../api';

const KIND_LABELS = {
  approve:  { icon: '✓',  label: 'Согласовано',  tone: 'ok' },
  rework:   { icon: '↩',  label: 'На доработку', tone: 'amber' },
  question: { icon: '❓', label: 'Вопрос',       tone: 'amber' },
  reject:   { icon: '✗',  label: 'Отклонено',    tone: 'err' },
  comment:  { icon: '💬', label: 'Комментарий',  tone: 't-2' },
  send:     { icon: '📤', label: 'Отправлено',   tone: 'sent' },
  resubmit: { icon: '🔄', label: 'Переотправка', tone: 'sent' }
};

export default function CommentsThread({ estimateId, comments, onChanged }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await postComment(estimateId, { text: text.trim() });
      setText('');
      onChanged?.();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  // v2 BONUS: Ctrl+Enter — отправка комментария (vanilla — только клик мышью)
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && text.trim() && !busy) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="card p-14">
      <strong className="section-eyebrow er-comments-eyebrow">
        💬 Переписка ({comments.length})
      </strong>

      {comments.length > 0 && (
        <div className="er-comments-scroll">
          {comments.map((c) => {
            const kind = KIND_LABELS[c.kind || c.action] || KIND_LABELS.comment;
            return (
              <div
                key={c.id}
                className={'er-comment-card er-comment-card--' + kind.tone}
              >
                <div className="row-spread">
                  <strong className="fs-12">{kind.icon} {kind.label}</strong>
                  <span className="fs-11 c-t3">{fmtDateTime(c.created_at)}</span>
                </div>
                <div className="er-comment-author">👤 {c.author_name || `#${c.author_id || c.user_id}`}</div>
                {c.text && <div className="er-comment-text">{c.text}</div>}
              </div>
            );
          })}
        </div>
      )}

      <div className="col gap-6 mt-10">
        {/* v2 BONUS: onKeyDown — Ctrl+Enter submit */}
        <TextareaInput value={text} onChange={setText} minRows={2} maxRows={4} placeholder="Добавить комментарий (Ctrl+Enter)" onKeyDown={onKeyDown} />
        <div className="row-end">
          <Btn size="sm" variant="primary" disabled={busy || !text.trim()} onClick={submit} title="Ctrl+Enter">{busy ? 'Сохраняем…' : '💬 Отправить'}</Btn>
        </div>
      </div>
    </div>
  );
}
