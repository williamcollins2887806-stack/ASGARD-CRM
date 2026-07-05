/**
 * PlatformTendersTab — TenderGuru candidates (С площадок)
 */
import { useEffect, useState, useCallback } from 'react';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadRegistry, acceptPlatformCandidate, dismissPlatformCandidate, loadTenderGuruSettings
} from './api';

export default function PlatformTendersTab({ onRefresh }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tg, setTg] = useState({ enabled: true, api_key_set: false });

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      loadRegistry({ subtab: 'platform' }),
      loadTenderGuruSettings().catch(() => ({ settings: {} }))
    ])
      .then(([d, s]) => {
        setItems(d.items || []);
        setTg(s.settings || {});
      })
      .catch(e => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const accept = (id) => {
    acceptPlatformCandidate(id)
      .then(() => { toast('Принято в реестр', 'ok'); refresh(); onRefresh?.(); })
      .catch(e => toast(e.message, 'err'));
  };

  const dismiss = (id, duplicate) => {
    dismissPlatformCandidate(id, duplicate)
      .then(() => refresh())
      .catch(e => toast(e.message, 'err'));
  };

  const apiOff = tg.enabled === false;
  const noKey = !tg.api_key_set;

  return (
    <div>
      <p className="muted" style={{ marginBottom: 12 }}>
        Тендеры из TenderGuru API — дополнение к ручному реестру. Сверка с уже внесёнными.
        Обогащение наших тендеров — только моложе {tg.enrich_max_age_months || 3} мес.
      </p>

      {apiOff && (
        <div className="alert warn" style={{ marginBottom: 12 }}>
          TenderGuru API выключен администратором. Крон не подтягивает новые тендеры.
        </div>
      )}
      {noKey && (
        <div className="alert warn" style={{ marginBottom: 12 }}>
          На сервере не задан <code>TENDERGURU_API_KEY</code> — синхронизация невозможна.
        </div>
      )}
      {tg.last_sync_at && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Последняя синхронизация: {new Date(tg.last_sync_at).toLocaleString('ru')}
          {tg.last_sync_result?.candidates != null && ` · +${tg.last_sync_result.candidates} канд., обогащено ${tg.last_sync_result.enriched || 0}`}
        </p>
      )}

      {loading && <p>Загрузка…</p>}
      <table className="tnd-table" style={{ width: '100%', fontSize: 13 }}>
        <thead>
          <tr><th>Тендер</th><th>Заказчик</th><th>НМЦ</th><th>Срок</th><th>Действия</th></tr>
        </thead>
        <tbody>
          {items.map(row => (
            <tr key={row.id}>
              <td>{row.title}</td>
              <td>{row.customer_name}</td>
              <td>{row.nmc != null ? Number(row.nmc).toLocaleString('ru-RU') : '—'}</td>
              <td>{row.deadline ? String(row.deadline).slice(0, 10) : '—'}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <Btn size="sm" onClick={() => accept(row.id)}>Принять</Btn>
                <Btn size="sm" variant="ghost" onClick={() => dismiss(row.id, true)}>Дубликат</Btn>
                <Btn size="sm" variant="ghost" onClick={() => dismiss(row.id, false)}>Скрыть</Btn>
                {row.purchase_url && (
                  <a href={row.purchase_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">↗</a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && items.length === 0 && (
        <p className="muted">
          {apiOff ? 'API выключен — новые кандидаты не загружаются.' : 'Нет новых кандидатов из API'}
        </p>
      )}
    </div>
  );
}
