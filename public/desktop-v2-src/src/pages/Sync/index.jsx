/**
 * Страница /sync — Синхронизация с внешними системами (1С, банки).
 *
 * Источник: vanilla `public/assets/js/sync.js` (~656 строк, ERP/банки).
 *
 * Слева — список ERP-подключений (1С/SAP/Парус), выбор → справа лог +
 * банковские выписки + кнопка выгрузки.
 *
 * RBAC: ADMIN + директора + BUH (см. SYNC_ROLES в api.js).
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';

import {
  SYNC_ROLES,
  loadConnections, deleteConnection, testConnection,
  loadSyncLog, loadBankBatches, loadBankStats,
  statusTone, fmtDateTime, fmtErpType
} from './api';
import { ConnectionEditModal } from './ConnectionEditModal';
import { ExportModal } from './ExportModal';
import './sync.css';

export default function SyncPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [connections, setConnections] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [syncLog, setSyncLog] = useState([]);
  const [bankBatches, setBankBatches] = useState([]);
  const [bankStats, setBankStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(null);

  const canView = SYNC_ROLES.includes(user?.role);
  const canEdit = user?.role === 'ADMIN' || user?.role === 'DIRECTOR_GEN';

  const refresh = useCallback(() => {
    if (!canView) return;
    setLoading(true);
    Promise.allSettled([
      loadConnections(),
      loadSyncLog(null, 30),
      loadBankBatches(20),
      loadBankStats().catch(() => null)
    ])
      .then(([c, l, b, s]) => {
        if (c.status === 'fulfilled') setConnections(c.value);
        if (l.status === 'fulfilled') setSyncLog(l.value);
        if (b.status === 'fulfilled') setBankBatches(b.value);
        if (s.status === 'fulfilled' && s.value && !s.value.error) setBankStats(s.value);
      })
      .finally(() => setLoading(false));
  }, [canView]);

  useEffect(() => { refresh(); }, [refresh]);

  const selected = useMemo(
    () => connections.find((c) => c.id === selectedId) || null,
    [connections, selectedId]
  );

  const filteredLog = useMemo(() => {
    if (!selectedId) return syncLog;
    return syncLog.filter((l) => l.connection_id === selectedId);
  }, [syncLog, selectedId]);

  const onCreate = () => {
    if (!canEdit) {
      toast.warn('Создавать подключения может только ADMIN или DIRECTOR_GEN');
      return;
    }
    modal.open(<ConnectionEditModal onSaved={refresh} />, { size: 'wide' });
  };

  const onEdit = (conn) => {
    if (!canEdit) {
      toast.warn('Редактировать может только ADMIN или DIRECTOR_GEN');
      return;
    }
    modal.open(<ConnectionEditModal connection={conn} onSaved={refresh} />, { size: 'wide' });
  };

  const onTest = async (conn) => {
    setTesting(conn.id);
    try {
      const r = await testConnection(conn.id);
      if (r?.success && (r?.status === 'ok' || !r?.status)) {
        toast.success(r?.message || `OK${r?.http_status ? ' · HTTP ' + r.http_status : ''}`);
      } else {
        toast.error('Ошибка: ' + (r?.error || `HTTP ${r?.http_status}`));
      }
      refresh();
    } catch (e) {
      toast.error('Не удалось проверить: ' + (e?.message || e));
    } finally {
      setTesting(null);
    }
  };

  const onDelete = (conn) => {
    if (!canEdit) {
      toast.warn('Удалять может только ADMIN или DIRECTOR_GEN');
      return;
    }
    modal.open(
      <ConfirmModal
        title="Деактивировать подключение?"
        message={`Подключение «${conn.name}» будет помечено неактивным (is_active=false). Соединение можно вернуть позже.`}
        tone="warn"
        okText="Деактивировать"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await deleteConnection(conn.id);
            toast.success('Подключение деактивировано');
            if (selectedId === conn.id) setSelectedId(null);
            refresh();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onExport = (conn) => {
    modal.open(<ExportModal connection={conn} onDone={refresh} />);
  };

  if (!user) return null;

  if (!canView) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Раздел" title="Синхронизация" />
        <EmptyState
          icon="🔒"
          title="Нет доступа"
          hint="Раздел доступен ADMIN, директорам и бухгалтерии"
        />
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Раздел"
        title="Синхронизация"
        subtitle={
          loading
            ? 'Загружаем…'
            : `${connections.length} подключени${pluralize(connections.length, 'е', 'я', 'й')} · ${bankBatches.length} выпис${pluralize(bankBatches.length, 'ка', 'ки', 'ок')}`
        }
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {canEdit && <Btn onClick={onCreate}>＋ ERP-подключение</Btn>}
          </>
        }
      />

      {bankStats && (
        <div className="sync-stats">
          <div className="sync-stat success">
            <div className="lab">Доходы (распределены)</div>
            <div className="val">
              {fmtRub(bankStats.totals?.income_total)}
            </div>
          </div>
          <div className="sync-stat warn">
            <div className="lab">Расходы (распределены)</div>
            <div className="val">{fmtRub(bankStats.totals?.expense_total)}</div>
          </div>
          <div className="sync-stat danger">
            <div className="lab">Не классифицировано</div>
            <div className="val">{bankStats.unclassified?.cnt ?? 0}</div>
          </div>
        </div>
      )}

      <div className="sync-grid">
        {/* — Список подключений — */}
        <div className="sync-card">
          <h3>🔗 ERP-подключения</h3>
          {connections.length === 0 ? (
            <div className="c-t3 fs-13 p-12">
              Подключений пока нет.
              {canEdit && ' Создайте первое через кнопку «＋ ERP-подключение».'}
            </div>
          ) : (
            <div className="sync-conn-list">
              {connections.map((c) => (
                <div
                  key={c.id}
                  className={'sync-conn ' + (selectedId === c.id ? 'active' : '')}
                  onClick={() => setSelectedId(c.id)}
                >
                  <div className="head">
                    <div className="name">{c.name}</div>
                    <span className="erp-type">{fmtErpType(c.erp_type)}</span>
                  </div>

                  <div className="meta">
                    <span>
                      <b>Статус:</b>{' '}
                      <span className={'sync-pill ' + statusTone(c.last_sync_status)}>
                        <span className="dot" />
                        {c.is_active ? c.last_sync_status || 'не запускалась' : 'неактивна'}
                      </span>
                    </span>
                    <span>
                      <b>Последняя:</b> {fmtDateTime(c.last_sync_at)}
                    </span>
                    <span>
                      <b>Интервал:</b> {c.sync_interval_minutes ?? 60} мин
                    </span>
                  </div>

                  {c.last_sync_error && (
                    <div className="err">⚠ {c.last_sync_error}</div>
                  )}

                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); onTest(c); }}
                      disabled={testing === c.id}
                    >
                      {testing === c.id ? '⏳' : '🛰'} Проверить
                    </Btn>
                    <Btn
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); onExport(c); }}
                    >
                      📤 Выгрузить
                    </Btn>
                    {canEdit && (
                      <>
                        <Btn
                          size="sm"
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); onEdit(c); }}
                        >
                          ✎ Править
                        </Btn>
                        <Btn
                          size="sm"
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); onDelete(c); }}
                        >
                          🗑
                        </Btn>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* — Журнал синхронизации — */}
        <div className="sync-card">
          <h3>
            📜 Журнал {selected ? `«${selected.name}»` : '(все)'}
          </h3>
          {filteredLog.length === 0 ? (
            <div className="c-t3 fs-13 p-12">
              Записей нет. Запустите выгрузку.
            </div>
          ) : (
            <div className="sync-log">
              {filteredLog.slice(0, 30).map((l) => (
                <div key={l.id} className="sync-log-row">
                  <div className="top">
                    <span>
                      <b className="c-t1">
                        {l.direction === 'export' ? '📤' : '📥'} {l.entity_type || '—'}
                      </b>
                    </span>
                    <span className={'sync-pill ' + statusTone(l.status)}>
                      <span className="dot" />
                      {l.status || '—'}
                    </span>
                  </div>
                  <div className="bottom">
                    <span>{fmtDateTime(l.started_at || l.created_at)}</span>
                    <span>✓ {l.records_success ?? 0} / {l.records_total ?? 0}</span>
                    {l.records_failed > 0 && (
                      <span className="c-err">✗ {l.records_failed}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* — Банковские выписки — */}
        <div className="sync-card col-span-2">
          <h3>🏦 Банковские выписки</h3>
          {bankBatches.length === 0 ? (
            <div className="c-t3 fs-13 p-12">
              Выписок ещё не загружали. Загрузка — через раздел «Финансы → Банк-выписки».
            </div>
          ) : (
            <div className="sync-bank-list">
              {bankBatches.map((b) => (
                <div key={b.id} className="sync-bank-row">
                  <div className="fn" title={b.filename}>{b.filename}</div>
                  <div className="num">{b.total_rows} строк</div>
                  <div className="num c-ok" >
                    +{b.new_rows ?? 0}
                  </div>
                  <div className="when">
                    {fmtDateTime(b.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtRub(n) {
  if (!Number.isFinite(+n) || n === 0) return '0 ₽';
  const v = +n;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + ' млн ₽';
  if (v >= 1_000) return (v / 1_000).toFixed(0) + ' тыс. ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽';
}

function pluralize(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
