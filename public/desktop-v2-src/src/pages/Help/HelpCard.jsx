/**
 * HelpCard — карточка help-задачи в списке (inbox/outbox/watching/archive).
 */
import { useMemo } from 'react';
import { STATUS_LABELS, STATUS_CLASS, PRIORITY_LABELS, PRIORITY_CLASS, ROLE_LABELS,
         formatDateTime, timeLeft } from './api';

export function HelpCard({ task, mode, currentUser, onOpen, onAccept, onDecline, onRedirect, onComplete, onReassign, onEscalate, onRate }) {
  const tl = useMemo(() => timeLeft(task.deadline), [task.deadline]);
  const isMine = task.assignee_id === currentUser?.id;
  const isCreator = task.creator_id === currentUser?.id;

  const showAccept   = mode === 'inbox' && isMine && task.status === 'new';
  const showDecline  = mode === 'inbox' && isMine && ['new','accepted','in_progress'].includes(task.status);
  const showRedirect = mode === 'inbox' && isMine && ['new','accepted','in_progress'].includes(task.status) && !task.redirected_once;
  const showComplete = mode === 'inbox' && isMine && ['accepted','in_progress'].includes(task.status);
  const showReassign = mode === 'outbox' && isCreator && task.status === 'declined';
  const showEscalate = mode === 'outbox' && isCreator && task.status === 'declined';
  const showRate     = mode === 'outbox' && isCreator && task.status === 'done';

  const fromName = task.creator_name || `id ${task.creator_id}`;
  const toName   = task.assignee_name || `id ${task.assignee_id}`;
  const fromRole = task.creator_role  ? ` · ${ROLE_LABELS[task.creator_role]   || task.creator_role}`   : '';
  const toRole   = task.assignee_role ? ` · ${ROLE_LABELS[task.assignee_role]  || task.assignee_role}`  : '';

  return (
    <article
      className={`help-card ${task.priority === 'urgent' ? 'help-card--urgent' : ''} ${tl?.overdue ? 'help-card--overdue' : ''}`}
      data-task-id={task.id}
      onClick={onOpen}
    >
      <div className="help-card-head">
        <span className={`help-prio ${PRIORITY_CLASS[task.priority] || 'help-p-normal'}`}>
          {PRIORITY_LABELS[task.priority] || task.priority}
        </span>
        <span className={`help-st ${STATUS_CLASS[task.status] || 'help-st-new'}`}>
          {STATUS_LABELS[task.status] || task.status}
        </span>
        {task.redirected_once && (
          <span className="help-badge-redir" title="Задача была перенаправлена">↪️ перенаправлено</span>
        )}
        {task.task_kind === 'help' && task.archived_at && (
          <span className="help-badge-arch" title="В архиве">🗄</span>
        )}
        {tl && (
          <span className={`help-deadline ${tl.overdue ? 'is-overdue' : ''} ${tl.hot ? 'is-hot' : ''}`}>
            {tl.overdue ? '⏰' : (tl.hot ? '🔥' : '⏱')} {tl.label}
          </span>
        )}
      </div>

      <h3 className="help-card-title">{task.title}</h3>

      {task.description && (
        <p className="help-card-desc">{task.description.slice(0, 180)}{task.description.length > 180 ? '…' : ''}</p>
      )}

      <div className="help-card-meta">
        {mode === 'inbox' ? (
          <span>📨 От: <b>{fromName}</b>{fromRole}</span>
        ) : (
          <span>👤 Исполнитель: <b>{toName}</b>{toRole}</span>
        )}
        {task.deadline && (
          <span>🗓 {formatDateTime(task.deadline)}</span>
        )}
        {Array.isArray(task.files) && task.files.length > 0 && (
          <span>📎 {task.files.length}</span>
        )}
        {parseInt(task.watchers_count) > 0 && (
          <span>👁 +{task.watchers_count}</span>
        )}
        {parseInt(task.messages_count) > 0 && (
          <span>💬 {task.messages_count}</span>
        )}
      </div>

      {task.declined_reason && task.status === 'declined' && (
        <div className="help-card-declined">
          <b>❌ Причина отказа:</b> {task.declined_reason}
        </div>
      )}

      <div className="help-card-actions" onClick={(e) => e.stopPropagation()}>
        {showAccept   && <button className="help-btn help-btn--accept"   onClick={onAccept}>✓ Принять</button>}
        {showComplete && <button className="help-btn help-btn--complete" onClick={onComplete}>✅ Завершить</button>}
        {showDecline  && <button className="help-btn help-btn--decline"  onClick={onDecline}>❌ Отказать</button>}
        {showRedirect && <button className="help-btn help-btn--redirect" onClick={onRedirect}>↪️ Перенаправить</button>}
        {showReassign && <button className="help-btn help-btn--accept"   onClick={onReassign}>🔄 Переназначить</button>}
        {showEscalate && <button className="help-btn help-btn--escalate" onClick={onEscalate}>🛡 Эскалировать</button>}
        {showRate     && <button className="help-btn help-btn--escalate" onClick={onRate}>⭐ Оценить</button>}
        {task.chat_id && (
          <a className="help-btn help-btn--chat" href={`#/messenger?id=${task.chat_id}`} onClick={(e) => e.stopPropagation()}>💬 Чат</a>
        )}
      </div>
    </article>
  );
}
