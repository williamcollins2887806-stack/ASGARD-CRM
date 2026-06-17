/**
 * Колонка-подэтап личного канбана. Принимает drop карточки.
 *
 * props:
 *   substage  — { id, title, color, sort_order } | null (для «не размещено»)
 *   cards     — карты внутри подэтапа
 *   onCardOpen, onCardDragStart, onCardDragEnd, onDropTo, onConfigure
 */
import { useState } from 'react';
import PersonalKanbanCard from './Card';

export default function PersonalKanbanColumn({
  substage, cards, onCardOpen, onCardDragStart, onCardDragEnd, onDropTo,
  draggingCardId, isUnplaced
}) {
  const [over, setOver] = useState(false);

  const stripeColor = substage?.color || 'var(--brd-2)';

  return (
    <div
      className={'pk-col' + (isUnplaced ? ' pk-col-unplaced' : '')}
      data-substage-id={substage?.id ?? 'unplaced'}
    >
      <div className="pk-col-stripe" style={{ background: stripeColor }} aria-hidden="true" />
      <div className="pk-col-h">
        <span className="pk-col-ttl" title={substage?.title || 'Не размещено'}>
          {isUnplaced ? 'Не размещено' : (substage?.title || '—')}
        </span>
        <span className="pk-col-cnt" aria-label={`${cards.length} карточек`}>{cards.length}</span>
      </div>
      <div
        className={'pk-col-body ' + (over ? 'is-over' : '')}
        onDragOver={(e) => {
          if (isUnplaced) return; // в «не размещено» дроп не пускаем
          e.preventDefault();
          try { e.dataTransfer.dropEffect = 'move'; } catch { /* noop */ }
          if (!over) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (isUnplaced) return;
          onDropTo?.(substage);
        }}
        role="list"
        aria-label={substage?.title || 'Не размещено'}
      >
        {cards.length === 0 ? (
          <div className="pk-col-empty">{isUnplaced ? 'Нет карт без места' : 'Перенесите сюда карту'}</div>
        ) : (
          cards.map((c) => (
            <PersonalKanbanCard
              key={c.id}
              card={c}
              onOpen={onCardOpen}
              onDragStart={onCardDragStart}
              onDragEnd={onCardDragEnd}
              isDragging={draggingCardId === c.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
