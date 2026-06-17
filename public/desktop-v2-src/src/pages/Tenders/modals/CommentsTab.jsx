/**
 * Лента комментариев к тендеру.
 * Источник: vanilla tenders.js:2491-2576 (renderCommentFeed + loadComments + send/delete).
 * Backend: src/routes/tenders.js:908-995.
 *   GET    /api/tenders/:id/comments
 *   POST   /api/tenders/:id/comments  { text }
 *   DELETE /api/tenders/:id/comments/:commentId  (свой ≤5 мин или ADMIN)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { ConfirmModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { loadTenderComments, postTenderComment, deleteTenderComment } from '../api';

function initials(name) {
  return String(name || '?').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
}

function fmtDt(s) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '';
}

export default function CommentsTab({ tenderId }) {
  const { user } = useAuth();
  const modal = useModal();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const feedRef = useRef(null);

  const reload = useCallback(() => {
    setLoading(true);
    loadTenderComments(tenderId)
      .then(setComments)
      .finally(() => setLoading(false));
  }, [tenderId]);

  useEffect(() => {
    if (!tenderId) return;
    reload();
  }, [tenderId, reload]);

  // Авто-скролл вниз при загрузке/добавлении.
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [comments]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    try {
      const created = await postTenderComment(tenderId, t);
      // Оптимистично добавим в ленту, но reload даст user_name из БД.
      setComments((c) => [...c, {
        id: created?.id,
        text: created?.text || t,
        created_at: created?.created_at || new Date().toISOString(),
        user_id: user?.id,
        user_name: created?.user_name || user?.name || user?.login,
        user_role: created?.user_role || user?.role
      }]);
      setText('');
    } catch (e) {
      toast('Комментарий', String(e?.message || e), 'err');
    } finally {
      setSending(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const askDelete = (c) => {
    modal.open(
      <ConfirmModal
        title="Удалить комментарий"
        message="Удалить ваш комментарий? Действие необратимо."
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteTenderComment(tenderId, c.id);
            setComments((all) => all.filter((x) => x.id !== c.id));
            toast('Комментарий', 'Удалён', 'ok');
          } catch (e) {
            toast('Ошибка', String(e?.message || e), 'err');
          }
        }}
      />
    );
  };

  // Можно удалить свой ≤5 мин или ADMIN (бэк src/routes/tenders.js:982-991).
  const canDelete = (c) => {
    if (!user) return false;
    if (user.role === 'ADMIN') return true;
    if (Number(c.user_id) !== Number(user.id)) return false;
    const age = Date.now() - new Date(c.created_at).getTime();
    return age < 5 * 60 * 1000;
  };

  return (
    <div className="tnd-comments">
      <div ref={feedRef} className="tnd-comments-feed">
        {loading ? (
          <div className="tnd-comments-empty">⏳ Загружаем…</div>
        ) : comments.length === 0 ? (
          <div className="tnd-comments-empty">Комментариев пока нет — будьте первым</div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="tnd-comment">
              <div className="tnd-comment-avatar">{initials(c.user_name)}</div>
              <div className="tnd-comment-body">
                <div className="tnd-comment-head">
                  <span className="tnd-comment-author">{c.user_name || 'Пользователь'}</span>
                  {c.user_role && <span className="tnd-comment-role">{c.user_role}</span>}
                  <span className="tnd-comment-time">{fmtDt(c.created_at)}</span>
                  {canDelete(c) && (
                    <button
                      type="button"
                      className="tnd-comment-del"
                      onClick={() => askDelete(c)}
                      title="Удалить"
                    >удалить</button>
                  )}
                </div>
                <div className="tnd-comment-text">{c.text}</div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="tnd-comments-form">
        <TextareaInput
          value={text}
          onChange={setText}
          placeholder="Напишите комментарий…  Enter — отправить, Shift+Enter — перенос"
          minRows={2}
          maxRows={6}
          onKeyDown={onKey}
        />
        <Btn
          variant="primary"
          disabled={sending || !text.trim()}
          onClick={send}
        >{sending ? '…' : '↑ Отправить'}</Btn>
      </div>
    </div>
  );
}
