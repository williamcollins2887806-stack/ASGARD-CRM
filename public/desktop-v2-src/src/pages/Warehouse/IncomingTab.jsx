import { useState, useEffect } from 'react';
import { loadIncoming, INCOMING_STATUS, fmt, formatDate } from './api';

/** Приёмка (vanilla renderIncoming). */
export function IncomingTab() {
  const [data, setData] = useState({ items: [], summary: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadIncoming().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="wh-loading">⏳ Загрузка входящих поставок…</div>;

  const items = data.items || [];
  if (items.length === 0) {
    return (
      <div className="wh-empty">
        <div className="wh-empty__ic">🚚</div>
        <div className="wh-empty__ttl">Входящих поставок нет</div>
      </div>
    );
  }
  const wh = items.filter((r) => r.delivery_target === 'warehouse');
  const obj = items.filter((r) => r.delivery_target === 'object');
  const sm = data.summary || {};

  return (
    <div>
      <div className="wh-kpis mb-14" >
        <div className="wh-kpi wh-kpi--info">
          <div className="wh-kpi__ic">🚚</div>
          <div className="wh-kpi__v">{fmt(sm.to_warehouse_in_transit || 0)}</div>
          <div className="wh-kpi__l">В пути на склад</div>
        </div>
        <div className="wh-kpi wh-kpi--ok">
          <div className="wh-kpi__ic">📦</div>
          <div className="wh-kpi__v">{fmt(sm.to_warehouse_delivered || 0)}</div>
          <div className="wh-kpi__l">Доставлено на склад</div>
        </div>
        <div className="wh-kpi">
          <div className="wh-kpi__ic">📍</div>
          <div className="wh-kpi__v">{fmt(sm.to_object || 0)}</div>
          <div className="wh-kpi__l">Напрямую на объект</div>
        </div>
      </div>

      {wh.length > 0 && (
        <>
          <div style={{ fontWeight: 700, margin: '8px 0' }}>🏬 На склад (приёмка кладовщиком)</div>
          <IncomingTable rows={wh} />
        </>
      )}
      {obj.length > 0 && (
        <>
          <div style={{ fontWeight: 700, margin: '18px 0 8px' }}>📍 Напрямую на объект (мимо склада)</div>
          <IncomingTable rows={obj} />
        </>
      )}
    </div>
  );
}

function IncomingTable({ rows }) {
  return (
    <div className="wh-table-wrap">
      <div className="ov-x-auto">
        <table className="wh-table">
          <thead>
            <tr>
              <th>Позиция</th>
              <th>Кол-во</th>
              <th>Статус</th>
              <th>Работа / объект</th>
              <th>Срок</th>
              <th>Закупщик</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const st = INCOMING_STATUS[r.item_status] || { label: r.item_status, tone: 'mute' };
              const deadline = r.delivery_deadline || r.needed_by;
              const overdue = deadline && new Date(deadline) < new Date();
              return (
                <tr key={i}>
                  <td><strong>{r.name}</strong>{r.article && <span className="ml-6 op-half">{r.article}</span>}</td>
                  <td>{fmt(r.quantity)} {r.unit || 'шт'}</td>
                  <td><span className={'wh-chip wh-chip--' + st.tone}>{st.label}</span></td>
                  <td>{r.work_title || r.object_name || '—'}</td>
                  <td style={overdue ? { color: 'var(--err)', fontWeight: 700 } : null}>
                    {formatDate(deadline)}
                  </td>
                  <td>{r.proc_name || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
