import { useState } from 'react';
import { Btn } from '@/modals/parts';
import { useModal, PromptModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import {
  STATUS_LABELS, STATUS_CLASS, PRIORITY_CLASS,
  isOverdue, formatDate, formatDateTime,
  acceptTask, startTask, completeTask, deleteTask
} from './api';
import { TaskCreateModal } from './TaskCreateModal';

/**
 * Карточка задачи в левом списке. Кликом — раскрывается с подробностями и кнопками.
 * Если пользователь — создатель/директор, доступны Редактировать/Удалить.
 */
export function TaskCard({ task, currentUser, onChanged, defaultExpanded = false }) {
  const modal = useModal();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const pCls = PRIORITY_CLASS[task.priority] || PRIORITY_CLASS.normal;
  const stCls = STATUS_CLASS[task.status] || 'st-new';
  const stLabel = STATUS_LABELS[task.status] || task.status;
  const overdue = task.status !== 'done' && task.status !== 'completed' && isOverdue(task.deadline);

  const isMine = currentUser && task.assignee_id === currentUser.id;
  const isMineCreator = currentUser && task.creator_id === currentUser.id;
  const isDirector = currentUser && ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(currentUser.role);
  const canEdit = isMineCreator || currentUser?.role === 'ADMIN';
  const canDelete = canEdit;
  const canComplete = (isMine || isDirector) && ['new', 'accepted', 'in_progress', 'overdue'].includes(task.status);

  const onAccept = async (e) => {
    e?.stopPropagation?.();
    try { await acceptTask(task.id); toast.success('Задача принята'); onChanged?.(); }
    catch (err) { toast.error('Ошибка: ' + (err?.message || err)); }
  };

  const onStart = async (e) => {
    e?.stopPropagation?.();
    try { await startTask(task.id); toast.success('Работа начата'); onChanged?.(); }
    catch (err) { toast.error('Ошибка: ' + (err?.message || err)); }
  };

  const onComplete = (e) => {
    e?.stopPropagation?.();
    modal.open(
      <PromptModal
        title="Завершить задачу"
        subtitle={task.title}
        icon="✓"
        accent="success"
        label="Комментарий о выполнении"
        placeholder="Что было сделано…"
        required={false}
        multiline
        okText="Завершить"
        onSubmit={async (comment) => {
          try {
            await completeTask(task.id, comment);
            toast.success('Задача завершена');
            onChanged?.();
          } catch (err) {
            toast.error('Ошибка: ' + (err?.message || err));
          }
        }}
      />
    );
  };

  const onEdit = (e) => {
    e?.stopPropagation?.();
    modal.open(<TaskCreateModal task={task} onSaved={onChanged} />);
  };

  const onDelete = (e) => {
    e?.stopPropagation?.();
    modal.open(
      <ConfirmModal
        title="Удалить задачу?"
        message={`«${task.title}» будет удалена вместе с файлами. Это действие необратимо.`}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteTask(task.id);
            toast.success('Задача удалена');
            onChanged?.();
          } catch (err) {
            toast.error('Ошибка: ' + (err?.message || err));
          }
        }}
      />
    );
  };

  return (
    <div
      className={'task-card ' + pCls}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v); } }}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`Задача: ${task.title}`}
    >
      <div className="task-card-top">
        <div className="flex-1">
          <div className="task-card-title">{task.title}</div>
          <div className="task-card-meta">
            <span>От: {task.creator_name || '?'}</span>
            {task.assignee_name && task.creator_id !== task.assignee_id && (
              <span className="sep">Кому: {task.assignee_name}</span>
            )}
            {task.deadline && (
              <span className={'sep ' + (overdue ? 'overdue' : '')}>
                Срок: {formatDate(task.deadline)}{overdue ? ' ⚠️' : ''}
              </span>
            )}
          </div>
        </div>
        <span className={'task-card-status ' + stCls}>{stLabel}</span>
      </div>

      {expanded && (
        <div className="task-card-body" onClick={(e) => e.stopPropagation()}>
          {task.description && <div className="task-card-desc">{task.description}</div>}
          {task.creator_comment && (
            <div className="task-card-comment">💬 {task.creator_comment}</div>
          )}
          {Array.isArray(task.files) && task.files.length > 0 && (
            <div className="task-card-files">
              {task.files.map((f, i) => (
                <a
                  key={f.filename + i}
                  className="task-card-file"
                  href={`/api/tasks/${task.id}/file/${encodeURIComponent(f.filename)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >📎 {f.original_name || f.filename}</a>
              ))}
            </div>
          )}

          {task.status === 'done' && (
            <div className="task-done-line mt-8" >
              ✅ Выполнено {formatDateTime(task.completed_at)}
              {task.assignee_comment && (
                <div style={{ marginTop: 4, fontStyle: 'italic', color: 'var(--t-3)' }}>
                  «{task.assignee_comment}»
                </div>
              )}
            </div>
          )}

          <div className="task-card-actions">
            {task.status === 'new' && isMine && (
              <>
                <Btn size="sm" variant="primary" onClick={onAccept}>👍 Принять</Btn>
                <Btn size="sm" variant="ghost" onClick={onStart}>▶ Начать</Btn>
              </>
            )}
            {task.status === 'accepted' && isMine && (
              <Btn size="sm" variant="primary" onClick={onStart}>▶ Начать работу</Btn>
            )}
            {canComplete && task.status !== 'done' && (
              <Btn size="sm" variant="success" onClick={onComplete}>✅ Завершить</Btn>
            )}
            {canEdit && task.status !== 'done' && (
              <Btn size="sm" variant="ghost" onClick={onEdit}>✎ Редактировать</Btn>
            )}
            {canDelete && (
              <Btn size="sm" variant="ghost" onClick={onDelete}>🗑 Удалить</Btn>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
