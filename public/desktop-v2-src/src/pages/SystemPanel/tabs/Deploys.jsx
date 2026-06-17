/**
 * /system-panel → Деплои.
 * Список последних релизов из таблицы app_updates (бэкенд /api/admin/system/updates).
 */
import { useEffect, useState, useCallback } from 'react';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { loadDeploys, fmtDateTime } from '../api';

export default function DeploysTab() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setList(await loadDeploys(30));
    } catch (e) {
      toast.error('Не удалось загрузить деплои: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      <div className="sysp-header-row">
        <div className="sysp-section-title" style={{ marginBottom: 0 }}>🚀 История деплоев</div>
        <div className="sysp-refresh-info">{list.length} записей</div>
        <Btn variant="ghost" onClick={refresh} disabled={loading}>↻ Обновить</Btn>
      </div>

      {loading ? (
        <div className="sysp-empty">⏳ Загружаем…</div>
      ) : list.length === 0 ? (
        <div className="sysp-empty">Деплоев пока нет</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map((u) => {
            let changes = [];
            try {
              changes = typeof u.changes === 'string' ? JSON.parse(u.changes) : (u.changes || []);
            } catch { /* noop */ }
            const changeTexts = (Array.isArray(changes) ? changes : []).map((c) =>
              typeof c === 'string' ? c : (c?.text || c?.change || String(c))
            );

            return (
              <div className="sysp-deploy-item" key={u.id}>
                <div className="sysp-deploy-hd">
                  <span className="sysp-ver-badge">v{u.version}</span>
                  <span className="sysp-deploy-title">{u.title || '—'}</span>
                  {u.target && (
                    <span
                      className="sett-pill"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                    >
                      {u.target}
                    </span>
                  )}
                  <span className="sysp-deploy-date">{fmtDateTime(u.published_at)}</span>
                </div>
                {changeTexts.length > 0 && (
                  <ul className="sysp-deploy-changes">
                    {changeTexts.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
