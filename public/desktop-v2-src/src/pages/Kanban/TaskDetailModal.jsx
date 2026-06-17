/**
 * Модалка с деталями задачи: описание, исполнитель, дедлайн, файлы,
 * лента комментариев, кнопки «Подтвердить ознакомление» и «Подписаться».
 *
 * Источник данных:
 *   GET    /api/tasks/:id
 *   GET    /api/tasks/:id/comments
 *   POST   /api/tasks/:id/comments
 *   PUT    /api/tasks/:id/acknowledge
 *   POST   /api/tasks/:id/watch | DELETE /api/tasks/:id/watch
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Pill } from '@/modals/parts';
import { TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  loadTask, loadComments, addComment,
  acknowledgeTask, watchTask, unwatchTask,
  PRIORITIES, fmtDate, fmtDateTime
} from './api';

export default function TaskDetailModal({ taskId, onChanged }) {
  const { close } = useModal();
  const [task, setTask] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [ackBusy, setAckBusy] = useState(false);
  const [iWatch, setIWatch] = useState(false);

  const refresh = () => {
    setLoadError(null);
    loadTask(taskId)
      .then((t) => { setTask(t); setIWatch(!!t?.is_watching); })
      .catch((e) => {
        // Без setLoadError модалка вечно показывала «⏳ Загрузка…» — toast.error
        // исчезал через 3с, юзер видел зависшую модалку (Tier-A silent-bug).
        toast.error('Не удалось загрузить задачу: ' + (e?.message || e));
        setLoadError(e?.message || 'Не удалось загрузить задачу');
      });
    loadComments(taskId)
      .then(setComments)
      .catch(() => setComments([]));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [taskId]);

  const submitComment = async () => {
    const v = text.trim();
    if (!v) return;
    setSending(true);
    try {
      await addComment(taskId, v);
      setText('');
      // reload comments + count
      const fresh = await loadComments(taskId);
      setComments(fresh);
      toast.success('Комментарий добавлен');
      onChanged?.();
    } catch (e) {
      toast.error('Не удалось отправить: ' + (e?.message || e));
    } finally {
      setSending(false);
    }
  };

  const onAck = async () => {
    setAckBusy(true);
    try {
      await acknowledgeTask(taskId);
      toast.success('Ознакомление подтверждено');
      refresh();
      onChanged?.();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    } finally {
      setAckBusy(false);
    }
  };

  const onToggleWatch = async () => {
    setWatchBusy(true);
    try {
      if (iWatch) {
        await unwatchTask(taskId);
        toast.success('Подписка снята');
        setIWatch(false);
      } else {
        await watchTask(taskId);
        toast.success('Вы подписаны на задачу');
        setIWatch(true);
      }
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    } finally {
      setWatchBusy(false);
    }
  };

  if (!task) {
    return (
      <MCard>
        <MHead icon="📋" title={loadError ? 'Ошибка' : 'Задача'} onClose={close} />
        <MBody>
          {loadError ? (
            <div className="p-24 t-center">
              <div style={{ color: 'var(--err)', marginBottom: 12 }}>❌ {loadError}</div>
              <Btn variant="ghost" onClick={refresh}>↻ Попробовать снова</Btn>
            </div>
          ) : (
            <div className="p-24 t-center c-t3">⏳ Загрузка…</div>
          )}
        </MBody>
      </MCard>
    );
  }

  const priority = PRIORITIES[task.priority] || PRIORITIES.normal;
  const deadline = task.deadline ? fmtDateTime(task.deadline) : 'Не указан';

  return (
    <MCard>
      <MHead
        icon="📋"
        title={task.title}
        subtitle={`Задача #${task.id} · создана ${fmtDate(task.created_at)}`}
        accent={task.status === 'done' ? 'success' : 'default'}
        onClose={close}
      />
      <MBody>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <Pill tone={priority.cls === 'p-urgent' ? 'danger' : priority.cls === 'p-high' ? 'warn' : 'info'}>
            {priority.icon} {priority.label}
          </Pill>
          <Pill tone={statusTone(task.status)}>{statusLabel(task.status)}</Pill>
        </div>

        {task.description && (
          <div style={{ whiteSpace: 'pre-wrap', color: 'var(--t-2)', fontSize: 13.5, lineHeight: 1.5, marginBottom: 12 }}>
            {task.description}
          </div>
        )}

        <InfoRow label="📅 Дедлайн"      value={deadline} />
        <InfoRow label="👤 Исполнитель"  value={task.assignee_name || '—'} />
        <InfoRow label="👤 Создатель"    value={task.creator_name || '—'} />

        {task.acknowledged_at ? (
          <InfoRow label="👁 Ознакомлен" value={fmtDateTime(task.acknowledged_at)} />
        ) : (
          <div className="kb-info-row">
            <span>👁 Ознакомление</span>
            <Btn size="sm" variant="ghost" disabled={ackBusy} onClick={onAck}>
              {ackBusy ? 'Сохраняем…' : 'Подтвердить'}
            </Btn>
          </div>
        )}

        {Array.isArray(task.files) && task.files.length > 0 && (
          <div className="mt-12">
            <div className="kb-section-h">📎 Файлы</div>
            <div className="u-flex u-wrap gap-6">
              {task.files.map((f, i) => (
                <a
                  key={i}
                  href={`/api/tasks/${task.id}/file/${encodeURIComponent(f.filename)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kb-file"
                >
                  📎 {f.original_name || f.filename}
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="mt-16">
          <div className="kb-section-h">💬 Комментарии ({comments.length})</div>
          <div className="kb-comments">
            {comments.length === 0 ? (
              <div style={{ color: 'var(--t-3)', fontSize: 12.5, padding: '8px 0' }}>
                Пока нет комментариев
              </div>
            ) : (
              comments.map((c) => (
                <div key={c.id} className={'kb-cmt ' + (c.is_system ? 'is-sys' : '')}>
                  <div className="kb-cmt-h">
                    <b>{c.user_name || 'Пользователь'}</b>
                    <span className="kb-cmt-tm">{fmtDateTime(c.created_at)}</span>
                  </div>
                  <div className="kb-cmt-tx">{c.text}</div>
                </div>
              ))
            )}
          </div>

          <Field label="Новый комментарий">
            <TextareaInput
              value={text}
              onChange={setText}
              placeholder="Написать комментарий…"
              minRows={2}
              maxRows={6}
            />
          </Field>
          <div className="row-end">
            <Btn variant="primary" size="sm" disabled={sending || !text.trim()} onClick={submitComment}>
              {sending ? 'Отправляем…' : 'Отправить'}
            </Btn>
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" disabled={watchBusy} onClick={onToggleWatch}>
          {watchBusy ? '…' : (iWatch ? '👁 Отписаться' : '👁 Подписаться')}
        </Btn>
        <Btn onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="kb-info-row">
      <span>{label}</span>
      <span className="fw-600 c-t1">{value}</span>
    </div>
  );
}

function statusLabel(status) {
  return ({
    new: 'Новая', accepted: 'Принята', in_progress: 'В работе',
    done: 'Выполнена', completed: 'Завершена', overdue: 'Просрочена', cancelled: 'Отменена'
  })[status] || status;
}
function statusTone(status) {
  return ({
    new: 'info', accepted: 'info', in_progress: 'warn',
    done: 'success', completed: 'success', overdue: 'danger', cancelled: 'default'
  })[status] || 'default';
}
