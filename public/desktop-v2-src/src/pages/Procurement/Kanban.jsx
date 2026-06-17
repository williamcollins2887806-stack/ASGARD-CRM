/**
 * Канбан-доска заявок на закупку — 6 колонок.
 *
 * Группы (из vanilla KANBAN_COLS):
 *   🆕 Новые        ← sent_to_proc
 *   🛠️ В работе     ← proc_responded
 *   ⏳ Согласование ← pm_approved + dir_question + dir_rework
 *   💳 Оплачено     ← dir_approved + paid
 *   🚚 Доставка     ← partially_delivered + delivered
 *   ✅ Закрыто      ← closed + dir_rejected
 *
 * Drag&Drop — нативный HTML5. При drop вызывается onMove(procId, fromStatus, colKey).
 * Карточки внутри колонок отсортированы: горящие сверху.
 */
import { useState, useMemo, useRef } from 'react';
import { KANBAN_COLS, STATUSES, isUrgent, money, fmtDate } from './api';

function StatusPill({ status }) {
  const st = STATUSES[status] || { label: status, tone: 'draft' };
  return <span className={'proc-pill proc-pill--' + st.tone}>{st.label}</span>;
}

function KanbanCard({ row, onOpen, onDragStart, onDragEnd }) {
  const urgent = isUrgent(row);
  const unpriced = row.unpriced_count || 0;
  const overdue = row.delivery_deadline && new Date(row.delivery_deadline) < new Date();
  return (
    <div
      className={'proc-kcard ' + (urgent ? 'proc-kcard--urgent' : '')}
      draggable
      data-id={row.id}
      data-status={row.status}
      onClick={(e) => {
        if (e.target.closest('[data-nodrag]')) return;
        onOpen?.(row);
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', row.id + ':' + row.status); } catch (_) { /* noop */ }
        onDragStart?.(row, e.currentTarget);
      }}
      onDragEnd={(e) => onDragEnd?.(row, e.currentTarget)}
      title="Перетащите в другую колонку — смена статуса. Клик — открыть."
    >
      <div className="proc-kcard__top">
        <b>#{row.id}</b>
        <span className="flex-1 ellipsis">
          {row.title || ''}
        </span>
        {urgent && <span title="Горящая">🔥</span>}
      </div>
      <div className="proc-kcard__work">{row.work_title || 'без работы'}</div>
      <div className="proc-kcard__meta">
        <span>👤 {row.pm_name || '—'}</span>
        <span>📦 {row.items_count || 0}</span>
        <span>{money(row.items_total)}</span>
      </div>
      <div className="proc-kcard__badges">
        <StatusPill status={row.status} />
        {unpriced > 0 && (
          <span className="proc-kbadge proc-kbadge--warn">без цен: {unpriced}</span>
        )}
        {row.delivery_deadline && (
          <span className={'proc-kbadge ' + (overdue ? 'proc-kbadge--over' : '')}>
            ⏱ {fmtDate(row.delivery_deadline)}
          </span>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({ col, cards, onOpen, onDragStart, onDragEnd, onDrop }) {
  const [over, setOver] = useState(false);
  return (
    <div className="proc-kcol" data-col={col.key}>
      <div className="proc-kcol__h">
        {col.label}
        <span className="proc-kcol__cnt">{cards.length}</span>
      </div>
      <div
        className={'proc-kcol__body ' + (over ? 'proc-kcol__body--over' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const txt = (e.dataTransfer.getData('text/plain') || '');
          const [id, fromStatus] = txt.split(':');
          if (id) onDrop?.(+id, fromStatus, col.key);
        }}
      >
        {cards.length === 0 ? (
          <div className="proc-kcol__empty">пусто</div>
        ) : (
          cards.map((row) => (
            <KanbanCard
              key={row.id}
              row={row}
              onOpen={onOpen}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default function Kanban({ items, onOpen, onMove }) {
  const draggedRef = useRef(null);

  const byStatus = useMemo(() => {
    const map = {};
    items.forEach((r) => { (map[r.status] = map[r.status] || []).push(r); });
    return map;
  }, [items]);

  const colCards = (col) => {
    const cards = [];
    col.statuses.forEach((s) => (byStatus[s] || []).forEach((r) => cards.push(r)));
    cards.sort((a, b) => (isUrgent(b) ? 1 : 0) - (isUrgent(a) ? 1 : 0));
    return cards;
  };

  return (
    <div className="proc-kanban">
      {KANBAN_COLS.map((col) => (
        <KanbanColumn
          key={col.key}
          col={col}
          cards={colCards(col)}
          onOpen={onOpen}
          onDragStart={(row, el) => { draggedRef.current = { row, el }; el?.classList?.add('proc-kcard--drag'); }}
          onDragEnd={(_, el) => { draggedRef.current = null; el?.classList?.remove('proc-kcard--drag'); }}
          onDrop={(id, fromStatus, colKey) => {
            // та же колонка — пропускаем
            const sameCol = col.statuses.includes(fromStatus) ? null : { id, fromStatus, colKey };
            if (sameCol) onMove?.(id, fromStatus, colKey);
          }}
        />
      ))}
    </div>
  );
}
