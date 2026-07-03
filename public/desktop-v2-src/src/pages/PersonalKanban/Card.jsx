/**
 * Карточка личного канбана РП. Draggable (Native HTML5 DnD).
 * Клик открывает детали (history + notes + reminders + actions).
 */
import { sourceInfo, isStale, fmtDate } from './api';

export default function PersonalKanbanCard({ card, onOpen, onDragStart, onDragEnd, isDragging }) {
  const src = sourceInfo(card.entity_kind);
  const ent = card.entity || {};
  // 23.06.2026 BUG-FIX (🟡 D-6): для pre_tender backend COALESCE выдаёт title=work_description
  // (personal-kanban.js:104-109). Это конфликтует с DirectorsInbox/MarketplaceList.jsx, где title
  // приоритетно = customer_name. До фикса один и тот же pre_tender в личном канбане
  // отображался как «очистка резервуара РВС-5000…», а в маркетплейсе — «ЛУКОЙЛ». Унифицируем
  // на customer_name → title (work_description) → fallback. Для inbox_application title=subject
  // (нечем заменить), для tender title=tender_title — там логика остаётся прежней.
  const title = (card.entity_kind === 'pre_tender'
    ? (ent.customer_name || ent.title || `${src.label} #${card.entity_id}`)
    : (ent.title || `${src.label} #${card.entity_id}`));
  const customer = (card.entity_kind === 'pre_tender'
    ? (ent.work_description || '')
    : (ent.customer_name || ''));
  const stale = isStale(card.last_moved_at);

  return (
    <div
      className={'pk-card' + (isDragging ? ' is-dragging' : '')}
      draggable
      data-card-id={card.id}
      data-substage-id={card.current_substage_id ?? ''}
      onClick={(e) => { e.stopPropagation(); onOpen?.(card); }}
      onDragStart={(e) => {
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(card.id)); } catch { /* noop */ }
        onDragStart?.(card, e.currentTarget);
      }}
      onDragEnd={(e) => onDragEnd?.(card, e.currentTarget)}
      title={`${src.label} — ${title}\nКлик: детали · Перетащите для смены подэтапа`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(card); }
      }}
    >
      <div className="pk-card-h">
        <span className="pk-card-src" aria-hidden="true">{src.icon}</span>
        <div className="pk-card-ttl">{title}</div>
      </div>

      <div className="pk-card-meta">
        {customer && <span className="pk-card-cust" title={customer}>{customer}</span>}
        {card.last_moved_at && <span className="pk-card-date">↻ {fmtDate(card.last_moved_at)}</span>}
        {stale && <span className="pk-card-stale" title="Карта не двигалась >5 дней">залежалось</span>}
        {card.transferred_at && (
          <span className="pk-card-trf" title={`Передано ${fmtDate(card.transferred_at)}${card.transferred_prev_substage_label ? ' из «' + card.transferred_prev_substage_label + '»' : ''}`}>
            передано
          </span>
        )}
      </div>
    </div>
  );
}
