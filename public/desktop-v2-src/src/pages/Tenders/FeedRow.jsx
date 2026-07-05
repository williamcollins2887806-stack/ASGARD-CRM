import { Btn } from '@/modals/parts';
import { StatusBadge } from '@/modals/Notifications';
import SourceBadge from './SourceBadge';

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

const FEED_STATUS_TONE = {
  'Новая': 'info',
  'Новая заявка': 'info',
  'Новый': 'info',
  'На проверке': 'question',
  'На рассмотрении': 'question',
  'AI обработана': 'info',
  'Целевой звонок': 'sent',
  'Принята': 'approved',
  'Отклонена': 'rejected',
  'Выиграли': 'approved',
  'Проиграли': 'rejected'
};

/**
 * Строка unified feed (заявки / все) — поля из /api/tenders-hub/feed.
 */
export default function FeedRow({ item, pmName, onOpen }) {
  const x = item;
  const status = x.tender_status || x.status || '—';
  const tone = FEED_STATUS_TONE[status] || 'info';
  const sourceKind = x.source_kind || x.source_label || 'manual';
  const typeLabel = x.type_label || x.tender_type || (x.kind === 'tender' ? '—' : 'Заявка');

  let urgency = '';
  if (x.deadline_days != null) {
    const days = Number(x.deadline_days);
    if (days <= 3) urgency = 'burn';
    else if (days <= 7) urgency = 'soon';
  }

  return (
    <tr
      className="tnd-row tnd-feed-row"
      data-kind={x.kind}
      data-urgency={urgency || undefined}
      onClick={() => onOpen?.(x)}
    >
      <td className="t-center tnd-checkbox-cell" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" disabled aria-label="Bulk недоступен" />
      </td>
      <td className="tnd-id">#{x.id}</td>
      <td>
        <div className="tnd-customer">{x.customer_name || '—'}</div>
        {x.customer_inn && <div className="help">{x.customer_inn}</div>}
        {(x.tender_title || x.title) && (
          <div className="tnd-title">{x.tender_title || x.title}</div>
        )}
        {x.work_id && (
          <div className="help">
            <a href={`#/pm-works?id=${x.work_id}`} onClick={(e) => e.stopPropagation()}>
              🏗 {x.work_code || `W-${x.work_id}`}
              {x.work_status ? ` · ${x.work_status}` : ''}
            </a>
          </div>
        )}
        {x.docs_count > 0 && <div className="help">📎 {x.docs_count} док.</div>}
      </td>
      <td>
        <SourceBadge source_kind={sourceKind} />
      </td>
      <td>
        <span className="tnd-type commercial">
          <span>{typeLabel}</span>
        </span>
      </td>
      <td className="tnd-price">{fmtMoney(x.tender_price ?? x.nmck)}</td>
      <td>
        {x.deadline_days != null ? (
          <span className={'tnd-deadline ' + (x.deadline_days <= 3 ? 'hot' : x.deadline_days <= 7 ? 'soon' : 'ok')}>
            {x.deadline_days} дн.
          </span>
        ) : (
          <span className="tnd-deadline none">—</span>
        )}
      </td>
      <td className="tnd-pm">{pmName || '—'}</td>
      <td><StatusBadge tone={tone} label={status} /></td>
      <td className="tnd-actions">
        <div className="tnd-actions-wrap" onClick={(e) => e.stopPropagation()}>
          <Btn size="sm" onClick={() => onOpen?.(x)} title="Открыть">Открыть</Btn>
        </div>
      </td>
    </tr>
  );
}
