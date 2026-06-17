import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { loadLocations } from './api';
import { BulkLocationsModal } from './BulkLocationsModal';

/** Вкладка «Ячейки» (vanilla renderLocations + openBulkModal). */
export function LocationsTab({ _user, onChanged }) {
  const modal = useModal();
  const [locs, setLocs] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadLocations(1000).then(setLocs).finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const openBulk = () => modal.open(<BulkLocationsModal onSaved={() => { refresh(); onChanged?.(); }} />);

  if (loading) return <div className="wh-loading">⏳ Загрузка ячеек…</div>;

  if (locs.length === 0) {
    return (
      <div className="wh-empty">
        <div className="wh-empty__ic">🗺️</div>
        <div className="wh-empty__ttl">Ячейки не заданы</div>
        <div className="mt-12">
          <Btn variant="primary" onClick={openBulk}>Сгенерировать сетку ячеек</Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={openBulk}>🗺️ Сгенерировать сетку</Btn>
      </div>
      <div className="wh-cellmap">
        {locs.map((l) => {
          const hasItems = (l.stock_lines > 0) || (l.unit_count > 0);
          return (
            <div key={l.id} className={'wh-cell ' + (hasItems ? 'wh-cell--full' : '')}>
              <div className="wh-cell__lbl">{l.label || l.zone}</div>
              <div className="wh-cell__sub">{l.warehouse_name || ''}</div>
              <div className="wh-cell__sub">{(+l.stock_lines || 0) + (+l.unit_count || 0)} поз.</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
