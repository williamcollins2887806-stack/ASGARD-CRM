/**
 * Карточка тендера в воронке.
 *
 * Drag&Drop через нативный HTML5 API.
 * Клик — открывает TenderEditorModal.
 */
import { fmtMoney, tenderSum } from './api';

function fmtDate(s) {
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString('ru-RU');
}

export default function FunnelCard({ tender, canDrag, pmName, onOpen, onDragStart, onDragEnd }) {
  const sum = tenderSum(tender);
  const deadline = fmtDate(tender.deadline || tender.deadline_at);
  const title =
    tender.tender_title ||
    tender.tender_name ||
    tender.tender_number ||
    tender.subject ||
    tender.tag ||
    tender.group_tag ||
    'Без названия';
  const customer = tender.customer_name || tender.customer_display || tender.customer || 'Без заказчика';

  return (
    <div
      className="fnl-card"
      draggable={canDrag}
      data-id={tender.id}
      data-status={tender.tender_status || ''}
      onClick={() => onOpen?.(tender)}
      onDragStart={(e) => {
        if (!canDrag) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(tender.id)); } catch (_) { /* noop */ }
        onDragStart?.(tender, e.currentTarget);
      }}
      onDragEnd={(e) => onDragEnd?.(tender, e.currentTarget)}
      title="Клик — открыть карточку. Перетаскивание — смена статуса."
    >
      <div className="fnl-card-h">
        <span className="fnl-card-cust">{customer}</span>
        <span className="fnl-card-sum">{fmtMoney(sum)}</span>
      </div>
      <div className="fnl-card-ttl">{title}</div>
      <div className="fnl-card-meta">
        <span>{pmName || '—'}</span>
        {deadline && <span>⏱ {deadline}</span>}
      </div>
    </div>
  );
}
