/**
 * Колонка канбана задач. Принимает drop карточки.
 */
import { useState } from 'react';
import KanbanCard from './Card';

export default function KanbanColumn({
  column, tasks, onCardOpen, onDragStart, onDragEnd, onDropTo
}) {
  const [over, setOver] = useState(false);

  return (
    <div className="kb-col" data-col={column.id}>
      <div className="kb-col-h">
        <span className="kb-col-ttl">
          <span className="kb-col-ic">{column.icon}</span>
          {column.label}
        </span>
        <span className="kb-col-cnt">{tasks.length}</span>
      </div>
      <div
        className={'kb-col-body ' + (over ? 'is-over' : '')}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDropTo?.(column);
        }}
      >
        {tasks.length === 0 ? (
          <div className="kb-col-empty">Нет задач</div>
        ) : (
          tasks.map((t) => (
            <KanbanCard
              key={t.id}
              task={t}
              onOpen={onCardOpen}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>
    </div>
  );
}
