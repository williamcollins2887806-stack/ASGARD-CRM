import { useState, useEffect } from 'react';
import { loadMovements, MOVE_META, fmt, formatDateTime } from './api';

/** Вкладка «Движения» (vanilla renderMovements). */
export function MovementsTab() {
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMovements().then(setRows).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="wh-loading">⏳ Загрузка журнала…</div>;
  if (!rows.length) return (
    <div className="wh-empty">
      <div className="wh-empty__ic">📜</div>
      <div className="wh-empty__ttl">Движений пока нет</div>
    </div>
  );

  return (
    <div className="wh-mv-list">
      {rows.map((m, i) => {
        const meta = MOVE_META[m.movement_type] || { icon: '•', label: m.movement_type, tone: 'mute' };
        const route = (m.from_loc || m.to_loc)
          ? `${m.from_loc || m.from_wh_name || ''}${(m.from_loc && m.to_loc) ? ' → ' : ''}${m.to_loc || m.to_wh_name || ''}`
          : '';
        return (
          <div key={i} className="wh-mv">
            <div className="wh-mv__ic">{meta.icon}</div>
            <div className="flex-1">
              <strong>{m.product_name}</strong>
              <span className="ml-6 fs-12 c-t3">
                {meta.label} • {fmt(m.qty)} {m.unit}{route ? ' • ' + route : ''}
              </span>
              {m.reason && <div className="fs-12 c-t3">{m.reason}</div>}
            </div>
            <div className="fs-12 c-t3">
              {m.created_by_name && <span>{m.created_by_name} • </span>}
              {formatDateTime(m.created_at)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
