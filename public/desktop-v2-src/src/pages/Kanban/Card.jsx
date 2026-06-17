/**
 * Карточка задачи в канбане.
 * - HTML5 drag&drop: draggable + onDragStart/End.
 * - Клик — открывает модалку с деталями (через onOpen).
 */
import { PRIORITIES, initialsOf, fmtDate, deadlineTone } from './api';

export default function KanbanCard({ task, onOpen, onDragStart, onDragEnd }) {
  const priority = PRIORITIES[task.priority] || PRIORITIES.normal;
  const dlTone = deadlineTone(task.deadline, task.status);
  const dl = fmtDate(task.deadline);

  return (
    <div
      className={'kb-card ' + priority.cls}
      data-id={task.id}
      draggable
      onClick={(e) => { e.stopPropagation(); onOpen?.(task); }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(task.id)); } catch (_) { /* noop */ }
        onDragStart?.(task, e.currentTarget);
      }}
      onDragEnd={(e) => onDragEnd?.(task, e.currentTarget)}
      title="Клик — открыть задачу. Перетаскивание — сменить колонку."
    >
      <div className="kb-card-ttl">{task.title}</div>

      <div className="kb-card-meta">
        <span
          className="kb-card-ava"
          title={task.assignee_name || 'Без исполнителя'}
        >
          {initialsOf(task.assignee_name)}
        </span>
        {dl && (
          <span className={'kb-card-dl ' + (dlTone || '')}>
            📅 {dl}
          </span>
        )}
        {Number(task.comment_count) > 0 && (
          <span className="kb-card-cmt">💬 {task.comment_count}</span>
        )}
      </div>

      {Array.isArray(task.tags) && task.tags.length > 0 && (
        <div className="kb-card-tags">
          {task.tags.slice(0, 3).map((t, i) => (
            <span key={i} className="kb-tag">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
