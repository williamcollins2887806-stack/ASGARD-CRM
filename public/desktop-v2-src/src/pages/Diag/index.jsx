/**
 * Страница /diag — Диагностика системы (admin only).
 *
 * Источник: vanilla `public/assets/js/diag.js` (использовала локальную IndexedDB).
 * В CRM 2.0 пользуемся реальным бэком — `src/routes/admin-system.js`:
 *   • /health   — RAM/Disk/CPU/Service/DB/active users
 *   • /updates  — последние релизы (app_updates)
 *   • /logs     — последние записи journalctl
 *   • /action   — restart, bump-version
 *
 * Auto-refresh раз в 15 с.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SelectInput } from '@/inputs/Inputs';

import {
  ADMIN_ROLE,
  loadHealth, loadUpdates, loadLogs, runAction,
  fmtMb, fmtDateTime, severityTone
} from './api';
import './diag.css';

const LOG_LEVELS = [
  { value: 'all',   label: 'Все' },
  { value: 'warn',  label: 'Warn+Error' },
  { value: 'error', label: 'Только Error' }
];

export default function DiagPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [health, setHealth] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [logs, setLogs] = useState([]);
  const [logLevel, setLogLevel] = useState('warn');
  const [loading, setLoading] = useState(true);
  const [pinging, setPinging] = useState(false);

  const canView = user?.role === ADMIN_ROLE;

  const refresh = useCallback(() => {
    if (!canView) return;
    setLoading(true);
    Promise.allSettled([loadHealth(), loadUpdates(), loadLogs({ lines: 200, level: logLevel })])
      .then(([h, u, l]) => {
        if (h.status === 'fulfilled') setHealth(h.value);
        if (u.status === 'fulfilled') setUpdates(u.value);
        if (l.status === 'fulfilled') setLogs(l.value);
      })
      .finally(() => setLoading(false));
  }, [canView, logLevel]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh каждые 15 с
  useEffect(() => {
    if (!canView) return;
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh, canView]);

  const onPing = async () => {
    setPinging(true);
    try {
      const t0 = Date.now();
      const h = await loadHealth();
      const ms = Date.now() - t0;
      setHealth(h);
      toast.success(`Ping OK · ${ms} мс · БД: ${h.db_ok ? `${h.db_ms} мс` : 'ошибка'}`);
    } catch (e) {
      toast.error('Ping failed: ' + (e?.message || e));
    } finally {
      setPinging(false);
    }
  };

  const onRestart = () => {
    modal.open(
      <ConfirmModal
        title="Рестарт сервиса"
        message="Перезапустить systemd-сервис asgard-crm? Сервис вернётся через ~5 секунд."
        tone="warn"
        okText="Перезапустить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            const r = await runAction('restart');
            toast.success(r?.message || 'Рестарт запущен');
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onBump = () => {
    modal.open(
      <ConfirmModal
        title="Бамп SHELL_VERSION"
        message="Инкрементировать SHELL_VERSION в public/index.html (для сброса SW-кеша)?"
        tone="info"
        okText="Инкрементировать"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            const r = await runAction('bump-version');
            toast.success(r?.message || 'Версия обновлена');
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const ramPct = health?.ram?.pct;
  const cpuPct = health?.cpu_pct;
  const diskPct = useMemo(() => {
    const raw = health?.disk?.pct;
    if (!raw) return null;
    const m = String(raw).match(/(\d+)/);
    return m ? +m[1] : null;
  }, [health]);

  if (!user) return null;

  if (!canView) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Раздел" title="Диагностика" />
        <EmptyState
          icon="🔒"
          title="Нет доступа"
          hint="Раздел доступен только администраторам"
        />
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Раздел"
        title="Диагностика"
        subtitle={
          loading
            ? 'Загружаем…'
            : `сервис ${health?.service_active ? '🟢 active' : '🔴 down'} · БД ${
                health?.db_ok ? `${health.db_ms} мс` : 'ошибка'
              } · ${fmtDateTime(health?.ts)}`
        }
        actions={
          <>
            <Btn variant="ghost" onClick={onPing} disabled={pinging}>
              {pinging ? '⏳ Ping…' : '🛰 Ping'}
            </Btn>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={onBump}>📦 Бамп версии</Btn>
            <Btn onClick={onRestart}>♻ Рестарт сервиса</Btn>
          </>
        }
      />

      <div className="diag-grid">
        {/* — Ресурсы — */}
        <div className="diag-card">
          <h3>📊 Ресурсы сервера</h3>

          <div className="diag-meter-row">
            <div className="lab">
              <span>RAM</span>
              <span>
                {fmtMb(health?.ram?.used)} / {fmtMb(health?.ram?.total)} ({ramPct ?? '—'}%)
              </span>
            </div>
            <div className="diag-meter">
              <div
                className={`fill ${severityTone(ramPct)}`}
                style={{ width: Math.min(100, ramPct || 0) + '%' }}
              />
            </div>
          </div>

          <div className="diag-meter-row">
            <div className="lab">
              <span>CPU</span>
              <span>{cpuPct == null ? '—' : `${cpuPct}%`}</span>
            </div>
            <div className="diag-meter">
              <div
                className={`fill ${severityTone(cpuPct)}`}
                style={{ width: Math.min(100, cpuPct || 0) + '%' }}
              />
            </div>
          </div>

          <div className="diag-meter-row">
            <div className="lab">
              <span>Диск /</span>
              <span>
                {health?.disk?.used ?? '—'} / {health?.disk?.size ?? '—'} ({health?.disk?.pct ?? '—'})
              </span>
            </div>
            <div className="diag-meter">
              <div
                className={`fill ${severityTone(diskPct)}`}
                style={{ width: Math.min(100, diskPct || 0) + '%' }}
              />
            </div>
          </div>

          <div className="diag-kv mt-8" >
            <div className="k">Свободно RAM</div>
            <div className="v">{fmtMb(health?.ram?.free)}</div>
            <div className="k">Свободно диска</div>
            <div className="v">{health?.disk?.avail ?? '—'}</div>
            <div className="k">Память процесса</div>
            <div className="v">{fmtMb(health?.proc_mem)}</div>
          </div>
        </div>

        {/* — Сервис и БД — */}
        <div className="diag-card">
          <h3>⚙️ Сервис и БД</h3>

          <div className="diag-kv">
            <div className="k">Статус сервиса</div>
            <div className="v">
              <span className={`diag-status-pill ${health?.service_active ? 'ok' : 'err'}`}>
                <span className="dot" />
                {health?.service_active ? 'active' : 'inactive'}
              </span>
            </div>
            <div className="k">Время работы</div>
            <div className="v">{health?.uptime || '—'}</div>
            <div className="k">Версия Node</div>
            <div className="v">{health?.node_version || '—'}</div>

            <div className="k">БД</div>
            <div className="v">
              <span className={`diag-status-pill ${health?.db_ok ? 'ok' : 'err'}`}>
                <span className="dot" />
                {health?.db_ok ? `${health.db_ms} мс` : 'недоступна'}
              </span>
            </div>

            <div className="k">Активные пользователи (30 мин)</div>
            <div className="v">{health?.active_users ?? 0}</div>

            <div className="k">Последнее обновление</div>
            <div className="v">{fmtDateTime(health?.ts)}</div>
          </div>
        </div>

        {/* — Релизы — */}
        <div className="diag-card">
          <h3>📦 Последние релизы (app_updates)</h3>
          <div className="diag-updates">
            {updates.length === 0 ? (
              <div className="c-t3 fs-13 p-12">
                Записей пока нет
              </div>
            ) : (
              updates.slice(0, 10).map((u) => (
                <div key={u.id} className="diag-update">
                  <div className="ver">{u.version}</div>
                  {u.title && <div className="title">{u.title}</div>}
                  <div className="when">{fmtDateTime(u.published_at)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* — Логи — */}
        <div className="diag-card diag-card--span2">
          <div className="row-spread gap-12 mb-10 u-wrap">
            <h3 className="m-0">📜 Журнал (journalctl)</h3>
            <div className="row gap-8">
              <span className="c-t3 fs-12">Уровень:</span>
              <div className="w-160">
                <SelectInput value={logLevel} onChange={setLogLevel} options={LOG_LEVELS} />
              </div>
            </div>
          </div>

          <div className="diag-logs">
            {logs.length === 0 ? (
              <div className="c-t3 fs-12 p-8">
                Логов нет (или загрузка…)
              </div>
            ) : (
              logs.slice(0, 200).map((l, i) => (
                <div key={i} className={`diag-log-line ${l.sev}`}>{l.line}</div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
