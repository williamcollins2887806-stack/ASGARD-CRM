/**
 * /system-panel → Сервер.
 * Auto-refresh каждые 6 секунд (как vanilla).
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { loadHealth, fmtMb, fmtDateTime, severityTone } from '../api';

export default function ServerTab() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const intRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const h = await loadHealth();
      setHealth(h);
      setError(null);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    intRef.current = setInterval(refresh, 6000);
    return () => clearInterval(intRef.current);
  }, [refresh]);

  const onPing = async () => {
    const t0 = Date.now();
    try {
      const h = await loadHealth();
      setHealth(h);
      toast.success(`Ping OK · ${Date.now() - t0} мс · БД: ${h.db_ok ? `${h.db_ms} мс` : 'ошибка'}`);
    } catch (e) {
      toast.error('Ping failed: ' + (e?.message || e));
    }
  };

  const cardClass = (pct) => {
    const p = Number(pct);
    if (!Number.isFinite(p)) return '';
    if (p >= 85) return 'err';
    if (p >= 60) return 'warn';
    return 'ok';
  };

  const ramPct  = health?.ram?.pct;
  const cpuPct  = health?.cpu_pct;
  const diskPctNum = (() => {
    const raw = health?.disk?.pct;
    if (!raw) return null;
    const m = String(raw).match(/(\d+)/);
    return m ? +m[1] : null;
  })();

  return (
    <div>
      <div className="sysp-header-row">
        <div className="sysp-section-title" style={{ marginBottom: 0 }}>
          Состояние сервера
        </div>
        <div className="sysp-refresh-info">
          {loading ? 'обновление…' : `обновлено ${new Date().toLocaleTimeString('ru-RU')}`}
        </div>
        <Btn variant="ghost" onClick={onPing}>🛰 Ping</Btn>
        <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
      </div>

      {error && (
        <div className="sysp-empty" style={{ color: '#f87171' }}>
          Ошибка: {error}
        </div>
      )}

      {!error && (
        <div className="sysp-cards">
          <Card
            title="Сервис"
            val={health?.service_active ? 'Активен' : 'Упал'}
            sub={health?.uptime || ''}
            cls={health?.service_active ? 'ok' : 'err'}
            icon={
              <span className={'sysp-status-dot ' + (health?.service_active ? '' : 'dead')} />
            }
            nobar
          />
          <Card
            title="CPU"
            val={(cpuPct ?? '?') + '%'}
            sub="использование"
            pct={cpuPct}
            cls={cardClass(cpuPct)}
          />
          <Card
            title="RAM"
            val={health?.ram?.used != null ? fmtMb(health.ram.used) : '?'}
            sub={`из ${fmtMb(health?.ram?.total)} · ${ramPct ?? '—'}%`}
            pct={ramPct}
            cls={cardClass(ramPct)}
          />
          <Card
            title="Диск"
            val={health?.disk?.pct ?? '?'}
            sub={`${health?.disk?.used ?? '?'} / ${health?.disk?.size ?? '?'}`}
            pct={diskPctNum}
            cls={cardClass(diskPctNum)}
          />
          <Card
            title="База данных"
            val={health?.db_ok ? 'Онлайн' : 'Ошибка'}
            sub={health?.db_ok ? `ping ${health.db_ms} мс` : 'нет подключения'}
            cls={health?.db_ok ? 'ok' : 'err'}
            nobar
          />
          <Card
            title="Пользователи"
            val={String(health?.active_users ?? 0)}
            sub="активны за 30 мин"
            cls="ok"
            nobar
          />
          <Card
            title="Node.js"
            val={health?.node_version || '?'}
            sub={`Память процесса: ${fmtMb(health?.proc_mem)}`}
            cls="ok"
            nobar
          />
          <Card
            title="Последний пинг"
            val={fmtDateTime(health?.ts).split(', ')[1] || '—'}
            sub={fmtDateTime(health?.ts).split(', ')[0] || ''}
            cls="ok"
            nobar
          />
        </div>
      )}
    </div>
  );
}

function Card({ title, val, sub, pct, cls, icon, nobar }) {
  return (
    <div className={'sysp-card ' + (cls || '')}>
      <div className="sysp-card-title">{title}</div>
      <div className="sysp-card-val">
        {icon}
        {val}
      </div>
      {sub && <div className="sysp-card-sub">{sub}</div>}
      {!nobar && (
        <div className="sysp-card-bar">
          <div
            className="sysp-card-bar-fill"
            style={{ width: Math.min(100, Number(pct) || 0) + '%' }}
          />
        </div>
      )}
    </div>
  );
}

// severityTone re-export для совместимости (если потребуется)
export { severityTone };
