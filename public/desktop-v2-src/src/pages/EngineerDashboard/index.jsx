/**
 * Страница /engineer-dashboard — Кузница Инженера (CHIEF_ENGINEER + директора).
 *
 * Источник: vanilla `public/assets/js/engineer_dashboard.js` (~243 строки).
 *
 * Содержит:
 *  - KPI-полосу (всего/на складе/на руках/в ремонте/стоимость)
 *  - Раскладку оборудования по РП с разворачивающимся списком позиций
 *  - Список оборудования, требующего ТО (ближайшие 30 дней)
 *  - Бары движений за 30 дней по типам
 *
 * Endpoints:
 *   GET /api/equipment/analytics/by-pm    — byPm + needsMaintenance + movements
 *   GET /api/equipment/stats/summary      — общая статистика склада
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import './engineer-dashboard.css';

const ALLOWED = ['ADMIN', 'CHIEF_ENGINEER', 'DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];

function fmtMoney(n) {
  const x = Number(n) || 0;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(x) + ' ₽';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('ru-RU'); } catch { return '—'; }
}

const MOVEMENT_LABELS = {
  issue: 'Выдача',
  return: 'Возврат',
  repair: 'Ремонт',
  write_off: 'Списание',
  transfer: 'Передача',
  adjust: 'Корректировка'
};

const MOVEMENT_COLORS = {
  issue: 'var(--info)',
  return: 'var(--ok)',
  repair: 'var(--amber)',
  write_off: 'var(--err)',
  transfer: 'var(--purple)',
  adjust: 'var(--t-3)'
};

export default function EngineerDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [openPm, setOpenPm] = useState({});

  const refresh = () => {
    setLoading(true);
    Promise.all([
      api('/api/equipment/analytics/by-pm').catch(() => ({})),
      api('/api/equipment/stats/summary').catch(() => ({}))
    ])
      .then(([byPm, summary]) => {
        setData(byPm || {});
        setStats(summary || {});
      })
      .catch((e) => toast.error(`Не удалось загрузить аналитику: ${e?.message || e}`))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    if (!ALLOWED.includes(user.role)) {
      toast.error('Раздел доступен главному инженеру и руководству');
      window.location.hash = '#/home';
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  if (!user || !ALLOWED.includes(user.role)) return null;

  // Подсчёт KPI
  const byPm = data?.byPm || [];
  let totalOnHands = 0, totalValue = 0, totalRepair = 0;
  for (const pm of byPm) {
    totalOnHands += Number(pm.equipment_count) || 0;
    totalValue += Number(pm.total_value) || 0;
    totalRepair += Number(pm.in_repair) || 0;
  }
  const s = stats.stats || stats || {};
  const total = Number(s.total) || 0;
  const inStock = Number(s.on_warehouse || s.in_stock) || 0;

  return (
    <div className="eng-wrap">
      <TopActionsBar
        kicker="Аналитика"
        title="Кузница Инженера"
        subtitle="Контроль оборудования по РП, требующее ТО, движения склада"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="primary" onClick={() => { window.location.hash = '#/warehouse'; }}>Перейти на склад →</Btn>
          </>
        }
      />

      {loading ? (
        <div className="card eng-loading">⏳ Загружаем аналитику…</div>
      ) : (
        <>
          {/* KPI */}
          <div className="eng-kpis">
            <KpiCard label="Всего на складе" value={total} tone="default" />
            <KpiCard label="На складе (доступно)" value={inStock} tone="ok" />
            <KpiCard label="На руках у РП" value={totalOnHands} tone="info" />
            <KpiCard label="В ремонте" value={totalRepair} tone="amber" />
            <KpiCard label="Стоимость на руках" value={fmtMoney(totalValue)} tone="gold" isText />
          </div>

          {/* Оборудование по РП */}
          <Section title="Оборудование по РП">
            {byPm.length === 0 ? (
              <EmptyState icon="📦" title="Нет оборудования на руках у РП" hint="Когда РП возьмут оборудование со склада, здесь появится разбивка по людям." action={null} />
            ) : (
              <div className="eng-pm-list">
                {byPm.map((pm, idx) => {
                  const isOpen = !!openPm[idx];
                  const eqList = pm.equipment_list || [];
                  return (
                    <div key={idx} className="eng-pm-card">
                      <button
                        type="button"
                        onClick={() => setOpenPm((o) => ({ ...o, [idx]: !o[idx] }))}
                        className="eng-pm-head"
                      >
                        <div className="eng-pm-head-l">
                          <span className="eng-pm-chev">{isOpen ? '▼' : '▶'}</span>
                          <span className="eng-pm-name">{pm.pm_name || '—'}</span>
                        </div>
                        <div className="eng-pm-head-r">
                          <span>{pm.equipment_count} ед.</span>
                          <span className="eng-pm-head-money">{fmtMoney(pm.total_value)}</span>
                          {pm.in_repair > 0 && (
                            <span className="eng-pm-head-repair">{pm.in_repair} в ремонте</span>
                          )}
                        </div>
                      </button>
                      {isOpen && (
                        <div className="eng-pm-body">
                          {eqList.length === 0 ? (
                            <div className="eng-pm-empty">Нет позиций</div>
                          ) : (
                            <div className="eng-pm-items">
                              {eqList.map((eq, i) => (
                                <div key={i} className="eng-eq-row">
                                  <span className="eng-eq-name">{eq.name || '—'}</span>
                                  <span className="eng-eq-inv">{eq.inventory_number || '—'}</span>
                                  <span className="eng-eq-status">{eq.status || '—'}</span>
                                  <span className="eng-eq-value">{fmtMoney(eq.book_value)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* ТО */}
          <Section title="Требуется ТО (ближайшие 30 дней)">
            <MaintenanceList items={data?.needsMaintenance || []} />
          </Section>

          {/* Движения */}
          <Section title="Движения за 30 дней">
            <MovementsBars movements={data?.movements || []} />
          </Section>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, tone = 'default', isText = false }) {
  const colors = {
    default: 'var(--t-1)',
    ok: 'var(--ok)',
    info: 'var(--info)',
    amber: 'var(--amber)',
    err: 'var(--err)',
    gold: 'var(--gold)'
  };
  return (
    <div className="eng-kpi">
      <div className="eng-kpi-label">{label}</div>
      <div
        className={'eng-kpi-value' + (isText ? ' eng-kpi-value--text' : '')}
        style={{ color: colors[tone] }}
      >
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="eng-section">
      <h3 className="eng-section-title">{title}</h3>
      {children}
    </div>
  );
}

function MaintenanceList({ items }) {
  if (!items.length) {
    return <div className="eng-maint-empty">Нет оборудования, требующего ТО в ближайшие 30 дней</div>;
  }
  const now = new Date();
  return (
    <div className="eng-maint-list">
      {items.map((item, i) => {
        const date = new Date(item.next_maintenance_date || item.next_maintenance);
        const isOverdue = date < now;
        return (
          <div key={i} className={'eng-maint-row' + (isOverdue ? ' eng-maint-row--overdue' : '')}>
            <div>
              <span className="eng-maint-name">{item.name || '—'}</span>
              {item.inventory_number && <span className="eng-maint-inv">{item.inventory_number}</span>}
              {item.holder_name && <span className="eng-maint-holder">→ {item.holder_name}</span>}
            </div>
            <div className={isOverdue ? 'eng-maint-date--overdue' : 'eng-maint-date'}>
              {fmtDate(item.next_maintenance_date || item.next_maintenance)}
              {isOverdue && <span className="eng-maint-warn">⚠</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MovementsBars({ movements }) {
  if (!movements.length) {
    return <div className="eng-mov-empty">Нет движений за последние 30 дней</div>;
  }
  const byType = {};
  for (const m of movements) {
    const t = m.movement_type || 'unknown';
    byType[t] = (byType[t] || 0) + (Number(m.count) || 0);
  }
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...types.map((t) => t[1]), 1);

  return (
    <div className="eng-mov-list">
      {types.map(([type, count]) => {
        const w = Math.round((count / max) * 100);
        const label = MOVEMENT_LABELS[type] || type;
        const color = MOVEMENT_COLORS[type] || 'var(--t-3)';
        return (
          <div key={type} className="eng-mov-row">
            <div className="eng-mov-label">{label}</div>
            <div className="eng-mov-bar">
              <div className="eng-mov-fill" style={{ width: w + '%', background: color }} />
            </div>
            <div className="eng-mov-count">{count}</div>
          </div>
        );
      })}
    </div>
  );
}
