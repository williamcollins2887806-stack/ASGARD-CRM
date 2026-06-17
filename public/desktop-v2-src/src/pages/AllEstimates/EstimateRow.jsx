/**
 * Строка списка просчёта.
 */
import { StatusBadge } from '@/modals/Notifications';
import { fmtMoney, fmtDate, statusMeta } from './api';

export default function EstimateRow({ estimate, onOpen, vatPct }) {
  const e = estimate;
  const meta = statusMeta(e.approval_status);
  const sent = fmtDate(e.sent_for_approval_at);
  const priceNoVat =
    e.price_tkp != null && Number.isFinite(+e.price_tkp)
      ? Math.round(Number(e.price_tkp) / (1 + (vatPct || 22) / 100))
      : null;

  return (
    <tr
      className="row-hover cur-p tbl-row-brd-2"
      onClick={() => onOpen?.(e)}
    >
      <td className="font-mono c-t3 fs-12 pad-cell-lg">
        #{e.id}
      </td>
      <td className="pad-cell-lg">
        <div className="fw-600 c-t1">
          {e.customer || e.customer_name || '—'}
        </div>
        {e.title && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--t-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 380,
              marginTop: 2
            }}
          >
            {e.title}
          </div>
        )}
      </td>
      <td className="pad-cell-lg c-t2">{e.pm_name || '—'}</td>
      <td style={{ padding: '10px 12px', color: 'var(--t-3)', fontSize: 12 }}>
        v{e.version_no || 1}
      </td>
      <td className="pad-cell-lg">
        <StatusBadge tone={meta.tone} label={meta.label} />
        {sent !== '—' && (
          <div className="fs-11 c-t3 mt-4">{sent}</div>
        )}
      </td>
      <td className="pad-cell-lg t-right">
        <div className="fw-700 c-t1">{fmtMoney(e.price_tkp)}</div>
        {priceNoVat != null && (
          <div className="fs-11 c-t3">
            б/НДС: {fmtMoney(priceNoVat)}
          </div>
        )}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--t-2)' }}>
        {fmtMoney(e.cost_plan)}
      </td>
    </tr>
  );
}
