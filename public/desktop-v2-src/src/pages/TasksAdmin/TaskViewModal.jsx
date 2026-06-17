import { useModal, ConfirmModal, PromptModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  STATUS_LABELS, STATUS_CLASS, PRIORITY_LABELS, PRIORITY_CLASS,
  isOverdue, formatDateTime,
  deleteTask, changeTaskStatus, updateTask
} from './api';
import { TaskEditModal } from './TaskEditModal';

/**
 * Просмотр задачи + действия директора:
 *   – Редактировать (модалка)
 *   – Эскалировать (поменять приоритет на urgent + комментарий через PromptModal)
 *   – Отменить (status=cancelled через PromptModal на причину)
 *   – Удалить (ConfirmModal danger)
 *
 * Vanilla эквивалент: viewTask + editTask + deleteTask.
 */
export function TaskViewModal({ task, onChanged }) {
  const { close, open } = useModal();
  const overdue = isOverdue(task.deadline, task.status);
  const stCls   = STATUS_CLASS[task.status] || 'st-new';
  const stLbl   = STATUS_LABELS[task.status] || task.status;
  const pCls    = PRIORITY_CLASS[task.priority] || PRIORITY_CLASS.normal;
  const pLbl    = PRIORITY_LABELS[task.priority] || task.priority;
  const isDone  = task.status === 'done' || task.status === 'completed';
  const isCancelled = task.status === 'cancelled';

  const handleEdit = () => {
    open(<TaskEditModal task={task} onSaved={onChanged} />);
  };

  const handleEscalate = () => {
    open(
      <PromptModal
        title="Эскалировать задачу"
        subtitle={task.title}
        icon="⚡"
        accent="warn"
        label="Комментарий руководителя (зачем эскалируем)"
        placeholder="Срочно, на контроле директора…"
        multiline
        required
        okText="Эскалировать"
        onSubmit={async (comment) => {
          try {
            // Vanilla эскалация = поднять приоритет до urgent + комментарий
            const body = { priority: 'urgent' };
            if (comment) {
              body.creator_comment = (task.creator_comment ? task.creator_comment + '\n\n' : '')
                + '⚡ ЭСКАЛАЦИЯ: ' + comment;
            }
            await updateTask(task.id, body);
            toast.success('Задача эскалирована');
            onChanged?.();
            close();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const handleCancel = () => {
    open(
      <PromptModal
        title="Отменить задачу"
        subtitle={task.title}
        icon="✕"
        accent="warn"
        label="Причина отмены"
        placeholder="Не актуально / переназначено / …"
        multiline
        required
        okText="Отменить задачу"
        onSubmit={async (comment) => {
          try {
            await changeTaskStatus(task.id, 'cancelled', comment);
            toast.success('Задача отменена');
            onChanged?.();
            close();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const handleDelete = () => {
    open(
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
            close();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  return (
    <MCard>
      <MHead
        icon="📋"
        title={`Задача #${task.id}`}
        subtitle={task.title}
        accent={overdue ? 'danger' : (isDone ? 'success' : 'info')}
        onClose={close}
      />
      <MBody>
        {/* Шапка: статус + приоритет */}
        <div className="row gap-8 mb-14 u-wrap">
          <span className={'tadm-st ' + stCls}>{stLbl}</span>
          <span className={'tadm-prio ' + pCls}>{pLbl}</span>
          {overdue && <span className="tadm-st st-overdue">⚠️ Просрочена</span>}
        </div>

        {/* Метаинфо */}
        <div className="tadm-meta">
          <div className="row">
            <span className="label">Исполнитель</span>
            <span className="value">{task.assignee_name || '—'}{task.assignee_role ? ` (${task.assignee_role})` : ''}</span>
          </div>
          <div className="row">
            <span className="label">Создатель</span>
            <span className="value">{task.creator_name || '—'}{task.creator_role ? ` (${task.creator_role})` : ''}</span>
          </div>
          <div className="row">
            <span className="label">Дедлайн</span>
            <span className="value" style={overdue ? { color: 'var(--err)' } : null}>
              {task.deadline ? formatDateTime(task.deadline) : '—'}
            </span>
          </div>
          <div className="row">
            <span className="label">Создана</span>
            <span className="value">{task.created_at ? formatDateTime(task.created_at) : '—'}</span>
          </div>
          {task.accepted_at && (
            <div className="row">
              <span className="label">Принята</span>
              <span className="value">{formatDateTime(task.accepted_at)}</span>
            </div>
          )}
          {task.completed_at && (
            <div className="row">
              <span className="label">Завершена</span>
              <span className="value">{formatDateTime(task.completed_at)}</span>
            </div>
          )}
        </div>

        {task.description && (
          <div className="tadm-section">
            <h4>Описание</h4>
            <p>{task.description}</p>
          </div>
        )}

        {task.creator_comment && (
          <div className="tadm-section">
            <h4>Инструкции от руководителя</h4>
            <p className="quote">💬 {task.creator_comment}</p>
          </div>
        )}

        {task.assignee_comment && (
          <div className="tadm-section">
            <h4>Комментарий исполнителя</h4>
            <p className="quote">{task.assignee_comment}</p>
          </div>
        )}

        {Array.isArray(task.files) && task.files.length > 0 && (
          <div className="tadm-section">
            <h4>Файлы</h4>
            <div className="tadm-files">
              {task.files.map((f, i) => (
                <a
                  key={f.filename + i}
                  className="tadm-file"
                  href={`/api/tasks/${task.id}/file/${encodeURIComponent(f.filename)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >📎 {f.original_name || f.filename}</a>
              ))}
            </div>
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        {!isDone && !isCancelled && (
          <>
            <Btn variant="ghost" onClick={handleCancel}>✕ Отменить задачу</Btn>
            {task.priority !== 'urgent' && (
              <Btn variant="ghost" onClick={handleEscalate}>⚡ Эскалировать</Btn>
            )}
            <Btn variant="primary" onClick={handleEdit}>✎ Редактировать</Btn>
          </>
        )}
        <Btn variant="ghost" onClick={handleDelete} className="c-err">🗑 Удалить</Btn>
      </MFoot>
    </MCard>
  );
}
