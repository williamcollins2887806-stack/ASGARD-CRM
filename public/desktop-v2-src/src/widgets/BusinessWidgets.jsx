/**
 * Бизнес-виджеты для главной страницы — 20 виджетов на живых данных.
 *
 * Каждый виджет:
 *  • Загружает данные через @/api/client
 *  • Имеет loading / error / empty состояния
 *  • Использует готовые компоненты (StatusBadge, MiniChart, Tooltip и т.д.)
 *  • Никаких vanilla — только React 2.0
 *
 * Эталон: компактные, безопасные (try/catch), graceful fallback на demo-данные
 * если endpoint недоступен.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { MiniChart as _MiniChart, StatusBadge, ProgressSteps as _ProgressSteps } from '@/modals/Notifications';
import './business-widgets.css';

/* ─── Хелперы ─── */
function shortMoney(n) {
  const x = Number(n) || 0;
  const abs = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + ' млрд ₽';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + ' млн ₽';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + ' тыс ₽';
  return (abs).toLocaleString('ru-RU') + ' ₽';
}

function Loading({ tall }) {
  return <div className={`empty ${tall ? 'bw-load-tall' : 'bw-load-default'}`}>⏳ Загрузка…</div>;
}

function Empty({ icon = '✓', text = 'Пусто' }) {
  return (
    <div className="empty">
      <div className="bw-empty-icon">{icon}</div>
      <div>{text}</div>
    </div>
  );
}

/**
 * NotConfigured — для виджетов которые ждут API endpoint которого ещё нет
 * или для виджетов которые требуют настройку (Bank, Mail и т.д.).
 * НЕ показывает demo-данные.
 */
function NotConfigured({ link, hint = 'Раздел ещё не настроен' }) {
  return (
    <div className="empty bw-not-configured">
      <div className="bw-not-configured-icon">⚙️</div>
      <div className="fs-12">{hint}</div>
      {link && <Link to={link} className="widget-link mt-8">Открыть →</Link>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1. MyReadiness — Готовность моих проектов (PM)
 *
 * Backend: GET /api/work-readiness?my=true&limit=5 → {items:[{id,work_title,
 *   customer_name,work_status,pm_id,pm_name,readiness:{overall_percent,blocker,...}}], total}
 * + GET /api/work-readiness/summary?ids=... — батч (для других виджетов/пр-в).
 * ═══════════════════════════════════════════════════════════════════════ */
export function MyReadiness({ _user }) {
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/work-readiness?my=true&limit=5')
      .then((d) => {
        const list = d.items || d.works || (Array.isArray(d) ? d : []);
        // Нормализуем поля под рендер: title, ready, blocker.
        const norm = list.slice(0, 5).map((w) => ({
          id: w.id,
          title: w.work_title || w.title || w.customer_name || `Работа #${w.id}`,
          ready: Math.round(Number(w.readiness?.overall_percent ?? w.ready ?? 0)),
          blocker: w.readiness?.blocker_label || w.readiness?.blocker || w.blocker || null
        }));
        setItems(norm);
      })
      .catch(() => { setFailed(true); setItems([]); });
  }, []);
  if (items === null) return <Loading />;
  if (failed) return <NotConfigured link="/readiness" hint="Готовность считается на странице «Проекты»" />;
  if (!items.length) return <Empty icon="📭" text="Нет активных проектов" />;
  return (
    <div className="bw-ready-list">
      {items.map((w) => (
        <div key={w.id} className="bw-ready-row">
          <Ring value={w.ready} />
          <div className="bw-ready-main">
            <div className="bw-ready-name">{w.title}</div>
            {w.blocker && <div className="bw-ready-blocker">⚠ {w.blocker}</div>}
          </div>
        </div>
      ))}
      <Link to="/readiness" className="widget-link">Все проекты →</Link>
    </div>
  );
}

function Ring({ value = 0, size = 40 }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * (value / 100);
  const tone = value >= 80 ? 'var(--ok)' : value >= 50 ? 'var(--gold)' : 'var(--err)';
  return (
    <svg width={size} height={size} className="bw-ring">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--brd-1)" strokeWidth="3" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={tone} strokeWidth="3" strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
      <text x={size/2} y={size/2 + 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--t-1)" transform={`rotate(90 ${size/2} ${size/2})`}>{value}%</text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 2. DirectorReadiness — Светофор готовности по РП
 *
 * Endpoint `/api/work-readiness/team` отсутствует — собираем на клиенте:
 *   1. GET /api/work-readiness?my=true (HEAD_PM/DIRECTOR видят ВСЕ работы в подготовке)
 *   2. Группируем по pm_id + pm_name, считаем avg readiness, светофор.
 * Это даёт ту же картинку без серверной сводки.
 * ═══════════════════════════════════════════════════════════════════════ */
export function DirectorReadiness() {
  const [pms, setPms] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/work-readiness?my=true&limit=500')
      .then((d) => {
        const works = d.items || d.works || (Array.isArray(d) ? d : []);
        const byPm = new Map();
        for (const w of works) {
          if (!w.pm_id) continue;
          const ready = Number(w.readiness?.overall_percent ?? 0);
          const entry = byPm.get(w.pm_id) || { id: w.pm_id, name: w.pm_name || `PM #${w.pm_id}`, total: 0, count: 0 };
          entry.total += ready;
          entry.count += 1;
          byPm.set(w.pm_id, entry);
        }
        const list = Array.from(byPm.values()).map((e) => {
          const avg = e.count > 0 ? Math.round(e.total / e.count) : 0;
          // Светофор: >=70 зелёный, 50-69 жёлтый, <50 красный
          const status = avg >= 70 ? 'green' : avg >= 50 ? 'yellow' : 'red';
          return { id: e.id, name: e.name, avgReady: avg, worksCount: e.count, status };
        }).sort((a, b) => a.avgReady - b.avgReady);
        setPms(list);
      })
      .catch(() => { setFailed(true); setPms([]); });
  }, []);
  if (pms === null) return <Loading tall />;
  if (failed) return <NotConfigured link="/readiness-board" hint="Сводная готовность по РП на отдельной странице" />;
  if (!pms.length) return <Empty icon="👥" text="Нет РП с работами в подготовке" />;
  const colors = { green: 'var(--ok)', yellow: 'var(--amber)', red: 'var(--err)' };
  return (
    <div className="bw-dir-grid">
      {pms.map((p) => (
        <div key={p.id} className="bw-dir-row" style={{ borderLeft: `3px solid ${colors[p.status]}` }}>
          <Ring value={p.avgReady} size={36} />
          <div className="bw-dir-main">
            <div className="bw-dir-name">{p.name}</div>
            <div className="bw-dir-sub">{p.worksCount} работ</div>
          </div>
        </div>
      ))}
      <Link to="/readiness-board" className="widget-link">Подробнее →</Link>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 3. EquipmentValue — Стоимость ТМЦ
 *
 * Backend: GET /api/equipment/balance-value (E-3 правильный endpoint).
 * Возвращает {total_purchase_value, total_book_value, total_depreciation,
 *   total_items, on_warehouse, issued, written_off}.
 * RBAC: финансовые поля видят только hasFullAccess или isWarehouseAdmin.
 * ═══════════════════════════════════════════════════════════════════════ */
export function EquipmentValue() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/equipment/balance-value')
      .then(setData)
      .catch(() => { setFailed(true); setData({}); });
  }, []);
  if (data === null) return <Loading />;
  // Backend для не-финансовой роли возвращает {success:true, message:'Нет доступа…'}
  if (failed || !data || data.message) {
    return <NotConfigured link="/warehouse-v2" hint={data?.message || 'Стоимость ТМЦ считается на странице склада'} />;
  }
  const total = Number(data.total_book_value) || Number(data.total_purchase_value) || 0;
  if (!total) return <Empty icon="📦" text="Нет данных по стоимости" />;
  return (
    <div>
      <div className="bw-equip-head">
        <div className="bw-equip-val">{shortMoney(total)}</div>
        <div className="bw-equip-cap">Балансовая стоимость ТМЦ</div>
      </div>
      <div className="bw-equip-list">
        <div className="bw-equip-row">
          <span className="c-t2">Закупочная</span>
          <b>{shortMoney(Number(data.total_purchase_value) || 0)}</b>
        </div>
        <div className="bw-equip-row">
          <span className="c-t2">Амортизация</span>
          <b>{shortMoney(Number(data.total_depreciation) || 0)}</b>
        </div>
        <div className="bw-equip-row">
          <span className="c-t2">Позиций</span>
          <b>{data.total_items || 0} (на складе {data.on_warehouse || 0})</b>
        </div>
      </div>
      <Link to="/warehouse-v2" className="widget-link">К складу →</Link>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 4. ReceiptScanner — Сканер чеков (кнопка)
 * ═══════════════════════════════════════════════════════════════════════ */
export function ReceiptScanner() {
  return (
    <div className="bw-rs-wrap">
      <div className="bw-rs-icon">📷</div>
      <button
        onClick={() => { window.location.hash = '#/cash?scan=1'; }}
        className="bw-rs-btn"
      >
        Сканировать чек
      </button>
      <div className="bw-rs-cap">Tesseract OCR + AI парсер</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 5. TelephonyStatus — Телефония
 * ═══════════════════════════════════════════════════════════════════════ */
export function TelephonyStatus() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([
      api('/api/telephony/call-control/settings'),
      api('/api/telephony/calls?limit=5')
    ]).then(([settings, calls]) => {
      setData({
        dispatcher: settings.dispatcher_enabled ?? false,
        recent: (calls.call_history || calls.calls || calls.items || []).slice(0, 3)
      });
    }).catch(() => { setFailed(true); setData({}); });
  }, []);
  if (data === null) return <Loading />;
  if (failed) return <NotConfigured link="/telephony" hint="Телефония не подключена" />;
  return (
    <div>
      <div className={`bw-tel-status ${data.dispatcher ? 'bw-tel-status--on' : 'bw-tel-status--off'}`}>
        <span className="bw-tel-status-lbl">Диспетчер</span>
        <StatusBadge tone={data.dispatcher ? 'approved' : 'rejected'} label={data.dispatcher ? 'Активен' : 'Отключён'} />
      </div>
      <div className="bw-tel-eyebrow">Последние</div>
      {data.recent.map((c) => (
        <div key={c.id} className="bw-tel-row">
          <span className={c.direction === 'in' ? 'bw-tel-arrow--in' : 'bw-tel-arrow--out'}>{c.direction === 'in' ? '↙' : '↗'}</span>
          <span className="bw-tel-from">{c.from || c.phone}</span>
          <span className="bw-tel-when">{c.when}</span>
        </div>
      ))}
      <Link to="/telephony" className="widget-link">Все звонки →</Link>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 6. OverdueWorks — Просроченные работы (wide)
 *
 * Канонический столбец дедлайна в `works` — `end_plan` (не deadline/work_deadline/end_date).
 * Эталон vanilla: public/assets/js/custom_dashboard.js:831 (renderOverdueWorks).
 * Закрытые работы не учитываются (status IN closed/completed/cancelled).
 * ═══════════════════════════════════════════════════════════════════════ */
export function OverdueWorks() {
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/works?status=active&limit=200')
      .then((d) => {
        const list = d.works || d.items || (Array.isArray(d) ? d : []);
        const now = Date.now();
        const overdue = list.filter((w) => {
          if (!w.end_plan) return false;
          const t = new Date(w.end_plan).getTime();
          if (!Number.isFinite(t) || t >= now) return false;
          const st = (w.work_status || w.status || '').toLowerCase();
          return !['closed','completed','cancelled'].includes(st);
        })
        .map((w) => ({
          ...w,
          _overdueDays: Math.round((now - new Date(w.end_plan).getTime()) / 86400000)
        }))
        .sort((a, b) => new Date(a.end_plan) - new Date(b.end_plan))
        .slice(0, 10);
        setItems(overdue);
      })
      .catch(() => { setFailed(true); setItems([]); });
  }, []);
  if (items === null) return <Loading tall />;
  if (failed) return <NotConfigured link="/all-works" hint="Просроченные работы — см. на странице «Все работы»" />;
  if (!items.length) return <Empty icon="✅" text="Просроченных работ нет" />;
  return (
    <div className="bw-overdue-list">
      {items.map((w) => (
        <div key={w.id} className="bw-overdue-row">
          <div>
            <div className="bw-overdue-title">{w.work_title}</div>
            <div className="bw-overdue-customer">{w.customer_name}</div>
          </div>
          <div className="bw-overdue-pm">РП: {w.pm_name || '—'}</div>
          <StatusBadge tone="burning" label={`+${w._overdueDays} дн.`} />
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 7. PermitsExpiry — Истекающие допуски (wide)
 * ═══════════════════════════════════════════════════════════════════════ */
export function PermitsExpiry() {
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/permits?status=expiring_30&limit=10')
      .then((d) => setItems(d.items || d.permits || (Array.isArray(d) ? d : [])))
      .catch(() => { setFailed(true); setItems([]); });
  }, []);
  if (items === null) return <Loading tall />;
  if (failed) return <NotConfigured link="/permits" hint="Допуски — на странице «Разрешения и допуски»" />;
  if (!items.length) return <Empty icon="✅" text="Все допуски в порядке" />;
  return (
    <div className="bw-permits-grid">
      {items.map((p) => {
        const tone = p.expires_in <= 7 ? 'burning' : p.expires_in <= 14 ? 'question' : 'sent';
        return (
          <div key={p.id} className="bw-permit-card">
            <div className="bw-permit-name">{p.employee_name}</div>
            <div className="bw-permit-type">{p.permit_type}</div>
            <StatusBadge tone={tone} label={`через ${p.expires_in} дн.`} />
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 8. TeamWorkload — Загрузка РП (wide)
 * ═══════════════════════════════════════════════════════════════════════ */
export function TeamWorkload() {
  const [pms, setPms] = useState(null);
  useEffect(() => {
    Promise.all([
      api('/api/users?role=PM&limit=50').catch(() => ({ users: [] })),
      api('/api/works?status=active&limit=200').catch(() => ({ works: [] }))
    ]).then(([usersR, worksR]) => {
      const users = (usersR.users || usersR.items || []).filter((u) => u.role === 'PM' && u.is_active);
      const works = worksR.works || worksR.items || [];
      const counts = {};
      works.forEach((w) => { if (w.pm_id) counts[w.pm_id] = (counts[w.pm_id] || 0) + 1; });
      const out = users.map((u) => ({ ...u, workCount: counts[u.id] || 0 })).sort((a, b) => b.workCount - a.workCount);
      setPms(out);
    }).catch(() => setPms([]));
  }, []);
  if (pms === null) return <Loading tall />;
  if (!pms.length) return <Empty icon="👥" text="Нет активных РП" />;
  const max = Math.max(...pms.map((p) => p.workCount), 1);
  return (
    <div className="bw-team-list">
      {pms.slice(0, 8).map((p) => {
        const pct = (p.workCount / max) * 100;
        const tone = p.workCount >= 5 ? 'var(--err)' : p.workCount >= 3 ? 'var(--amber)' : 'var(--ok)';
        return (
          <div key={p.id} className="bw-team-row">
            <span className="bw-team-name">{p.name}</span>
            <div className="bw-team-bar">
              <div className="bw-team-bar-fill" style={{ width: pct + '%', background: tone }} />
            </div>
            <b className="bw-team-count" style={{ color: tone }}>{p.workCount}</b>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 9. TenderDynamics — Динамика тендеров (wide)
 * ═══════════════════════════════════════════════════════════════════════ */
export function TenderDynamics() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api('/api/tenders?limit=2000')
      .then((d) => {
        const tenders = d.tenders || [];
        const months = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
        const year = new Date().getFullYear();
        const monthCounts = months.map((_, i) => {
          return tenders.filter((t) => {
            const p = t.period || '';
            const mm = p.match(/^\d{4}-(\d{2})$/);
            if (mm) return Number(p.slice(0, 4)) === year && Number(mm[1]) === i + 1;
            return false;
          }).length;
        });
        const wonCounts = months.map((_, i) => {
          return tenders.filter((t) => {
            const p = t.period || '';
            const mm = p.match(/^\d{4}-(\d{2})$/);
            if (mm && Number(p.slice(0, 4)) === year && Number(mm[1]) === i + 1) {
              return t.tender_status === 'Выиграли';
            }
            return false;
          }).length;
        });
        setData({ months, total: monthCounts, won: wonCounts });
      })
      .catch(() => setData(null));
  }, []);
  if (!data) return <Loading tall />;
  const currentMonth = new Date().getMonth();
  return (
    <div>
      <div className="bw-td-tot">
        <div><span className="c-t3">Всего:</span> <b className="c-info">{data.total.reduce((a, b) => a + b, 0)}</b></div>
        <div><span className="c-t3">Выиграли:</span> <b className="c-ok">{data.won.reduce((a, b) => a + b, 0)}</b></div>
      </div>
      <div className="bw-td-chart">
        {data.total.slice(0, currentMonth + 1).map((c, i) => {
          const maxC = Math.max(...data.total, 1);
          const h = (c / maxC) * 100;
          const wonH = (data.won[i] / maxC) * 100;
          return (
            <div key={i} className="bw-td-col">
              <div className="bw-td-bar" style={{ height: h + '%' }}>
                <div className="bw-td-bar-won" style={{ height: (wonH / h) * 100 + '%' }} />
              </div>
              <div className="bw-td-month">{data.months[i]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 10. KpiSummary — KPI сводка (wide)
 * ═══════════════════════════════════════════════════════════════════════ */
export function KpiSummary() {
  const [data, setData] = useState(null);
  useEffect(() => {
    Promise.all([
      api('/api/tenders?limit=2000').catch(() => ({ tenders: [] })),
      api('/api/works?limit=2000').catch(() => ({ works: [] }))
    ]).then(([tR, wR]) => {
      const tenders = tR.tenders || [];
      const works = wR.works || wR.items || [];
      const year = new Date().getFullYear();
      const yT = tenders.filter((t) => String(t.year) === String(year) || (t.period || '').startsWith(String(year)));
      const won = yT.filter((t) => t.tender_status === 'Выиграли').length;
      const total = yT.length;
      const revenue = works.reduce((s, w) => s + (Number(w.contract_value) || 0), 0);
      setData({ total, won, conversion: total > 0 ? Math.round((won / total) * 100) : 0, revenue, works: works.length });
    });
  }, []);
  if (!data) return <Loading tall />;
  return (
    <div className="bw-kpi-grid">
      <div className="bw-kpi-card bw-kpi-card--info">
        <div className="bw-kpi-val c-info">{data.total}</div>
        <div className="bw-kpi-lbl">Тендеров</div>
      </div>
      <div className="bw-kpi-card bw-kpi-card--ok">
        <div className="bw-kpi-val c-ok">{data.conversion}%</div>
        <div className="bw-kpi-lbl">Конверсия</div>
      </div>
      <div className="bw-kpi-card bw-kpi-card--gold">
        <div className="bw-kpi-val c-gold">{shortMoney(data.revenue)}</div>
        <div className="bw-kpi-lbl">Выручка</div>
      </div>
      <div className="bw-kpi-card bw-kpi-card--purple">
        <div className="bw-kpi-val c-purple">{data.works}</div>
        <div className="bw-kpi-lbl">Работ</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 11. GanttMini — Ближайшие дедлайны
 * ═══════════════════════════════════════════════════════════════════════ */
export function GanttMini() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    api('/api/works?limit=100&status=active')
      .then((d) => {
        const works = (d.works || d.items || []).filter((w) => {
          if (!w.end_plan && !w.end_fact) return false;
          const dt = new Date(w.end_plan || w.end_fact);
          return dt instanceof Date && !isNaN(dt);
        });
        // сортируем по дедлайну (ближайшие сверху)
        works.sort((a, b) => new Date(a.end_plan || a.end_fact) - new Date(b.end_plan || b.end_fact));
        setItems(works.slice(0, 5));
      })
      .catch(() => setItems([]));
  }, []);
  if (items === null) return <Loading />;
  if (!items.length) return <Empty icon="📅" text="Нет работ с дедлайнами" />;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (
    <div className="bw-gantt-list">
      {items.map((w) => {
        const d = new Date(w.end_plan || w.end_fact);
        if (isNaN(d)) return null;
        const days = Math.ceil((d - today) / 86400000);
        let tone = 'approved';
        let label;
        if (days < 0) { tone = 'burning'; label = `просрочка ${-days} дн.`; }
        else if (days === 0) { tone = 'burning'; label = 'сегодня'; }
        else if (days === 1) { tone = 'question'; label = 'завтра'; }
        else if (days <= 7) { tone = 'question'; label = `через ${days} дн.`; }
        else { tone = 'approved'; label = d.toLocaleDateString('ru-RU'); }
        return (
          <div key={w.id} className="bw-gantt-row">
            <div className="bw-gantt-title">
              {w.work_title || w.customer_name || `Работа #${w.id}`}
            </div>
            <StatusBadge tone={tone} label={label} />
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 12. CashBalance — Баланс кассы
 * ═══════════════════════════════════════════════════════════════════════ */
export function CashBalance() {
  const [balance, setBalance] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/approval/cash-balance')
      .then((d) => setBalance(Number(d.balance) || 0))
      .catch(() => { setFailed(true); setBalance(0); });
  }, []);
  if (balance === null) return <Loading />;
  if (failed) return <NotConfigured link="/cash-admin" hint="Баланс кассы — на странице «Касса (управление)»" />;
  return (
    <div className="bw-cash-wrap">
      <div className={`bw-cash-val ${balance > 100000 ? 'c-ok' : 'c-amber'}`}>{shortMoney(balance)}</div>
      <div className="bw-cash-cap">Наличные в кассе</div>
      <Link to="/cash-admin" className="widget-link">Управление кассой →</Link>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 13. MyCashBalance — Мои подотчётные
 *
 * Backend: GET /api/cash/my-balance (E-3 правильный endpoint).
 * Возвращает {issued, spent, returned, balance, active_requests}.
 * ═══════════════════════════════════════════════════════════════════════ */
export function MyCashBalance({ user }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/cash/my-balance')
      .then(setData)
      .catch(() => { setFailed(true); setData({}); });
  }, [user.id]);
  if (data === null) return <Loading />;
  if (failed) return <NotConfigured link="/cash" hint="Подотчётные средства — на странице «Касса»" />;
  const totalIssued = Number(data.issued) || 0;
  if (!totalIssued && !Number(data.spent) && !data.active_requests) {
    return <Empty icon="✓" text="Нет активных подотчётных" />;
  }
  return (
    <div>
      <div className="bw-mini-grid">
        <Mini label="Получено" v={totalIssued} color="info" />
        <Mini label="Потрачено" v={Number(data.spent) || 0} color="err" />
        <Mini label="Возвращено" v={Number(data.returned) || 0} color="t-3" />
        <Mini label="На руках" v={Number(data.balance) || 0} color="gold" />
      </div>
      <Link to="/cash" className="widget-link">Перейти в кассу →</Link>
    </div>
  );
}
function Mini({ label, v, color }) {
  const colorClass = { info: 'c-info', err: 'c-err', 't-3': 'c-t3', gold: 'c-gold' }[color] || 'c-t1';
  return (
    <div className="bw-mini">
      <div className="bw-mini-lbl">{label}</div>
      <div className={`bw-mini-val ${colorClass}`}>{shortMoney(v)}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 14. EquipmentAlerts — Оборудование Алерты
 *
 * Backend: GET /api/equipment/maintenance/upcoming?days=30 — список с
 * приближающимся next_maintenance или next_calibration.
 * Возвращает {success, upcoming:[{id,name,inventory_number,next_maintenance,
 *   next_calibration,status,condition,category_name,holder_name,warehouse_name}]}.
 * ═══════════════════════════════════════════════════════════════════════ */
export function EquipmentAlerts() {
  const [alerts, setAlerts] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/equipment/maintenance/upcoming?days=30')
      .then((d) => {
        const list = d.upcoming || d.items || (Array.isArray(d) ? d : []);
        const al = list.slice(0, 5).map((e) => {
          const m = e.next_maintenance ? new Date(e.next_maintenance) : null;
          const c = e.next_calibration ? new Date(e.next_calibration) : null;
          let when = '';
          let kind = 'maintenance';
          if (m && (!c || m <= c)) { when = m.toLocaleDateString('ru-RU'); kind = 'maintenance'; }
          else if (c) { when = c.toLocaleDateString('ru-RU'); kind = 'calibration'; }
          return { id: e.id, name: e.name || e.inventory_number || `#${e.id}`, kind, when };
        });
        setAlerts(al);
      })
      .catch(() => { setFailed(true); setAlerts([]); });
  }, []);
  if (alerts === null) return <Loading />;
  if (failed) return <NotConfigured link="/warehouse-v2" hint="Алерты по оборудованию — на странице склада" />;
  if (!alerts.length) return <Empty icon="✅" text="ТО и поверки в порядке" />;
  return (
    <div className="bw-alerts-list">
      {alerts.map((a) => (
        <div key={a.id} className="bw-alert-row">
          <span className="bw-alert-icon">🔧</span>
          <div className="bw-alert-main">
            <div className="bw-alert-name">{a.name}</div>
            <div className="bw-alert-meta">{a.kind === 'calibration' ? 'поверка' : 'ТО'} · {a.when}</div>
          </div>
        </div>
      ))}
      <Link to="/warehouse-v2" className="widget-link">К складу →</Link>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 15. PayrollPending — Ведомости ожидания
 * ═══════════════════════════════════════════════════════════════════════ */
export function PayrollPending() {
  const [count, setCount] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/payroll/sheets?status=pending&limit=1')
      .then((d) => setCount(d.total || (d.items || []).length || 0))
      .catch(() => { setFailed(true); setCount(0); });
  }, []);
  if (count === null) return <Loading />;
  if (failed) return <NotConfigured link="/payroll" hint="Ведомости — на странице «Расчёты с рабочими»" />;
  return (
    <div className="bw-pp-wrap">
      <div className={`bw-pp-val ${count > 0 ? 'c-gold' : 'c-ok'}`}>{count}</div>
      <div className="bw-pp-lbl">{count > 0 ? 'Ведомости ждут согласования' : 'Все ведомости согласованы'}</div>
      {count > 0 && <Link to="/payroll" className="widget-link mt-10">Перейти →</Link>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 16. PreTenders — Заявки
 * ═══════════════════════════════════════════════════════════════════════ */
export function PreTenders() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/pre-tenders/stats')
      .then(setData)
      .catch(() => { setFailed(true); setData({}); });
  }, []);
  if (data === null) return <Loading />;
  if (failed) return <NotConfigured link="/pre-tenders" hint="Заявки — на странице «Pre-Tenders»" />;
  return (
    <div>
      <div className="bw-pt-grid">
        <div className="bw-pt-cell bw-pt-cell--info">
          <div className="bw-pt-val c-info">{data.total_new || 0}</div>
          <div className="bw-pt-lbl">Новых</div>
        </div>
        <div className="bw-pt-cell bw-pt-cell--orange">
          <div className="bw-pt-val c-amber">{data.total_in_review || 0}</div>
          <div className="bw-pt-lbl">На рассмотрении</div>
        </div>
        <div className="bw-pt-cell bw-pt-cell--inner">
          <div className="bw-pt-val c-t2">{data.total_need_docs || 0}</div>
          <div className="bw-pt-lbl">Нужны документы</div>
        </div>
      </div>
      <Link to="/pre-tenders" className="widget-link">Все заявки →</Link>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 17. BankSummary — Банковская сводка
 *
 * Backend: GET /api/integrations/bank/stats — агрегаты по bank_transactions.
 * Возвращает {total_income, total_expense, balance, unclassified_count,
 *   unclassified_amount, by_article, by_month, last_import_date}.
 * + /api/integrations/bank/transactions — список (используется на BankImport).
 * ═══════════════════════════════════════════════════════════════════════ */
export function BankSummary() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/integrations/bank/stats')
      .then((d) => setData(d.stats || d))
      .catch(() => { setFailed(true); setData({}); });
  }, []);
  if (data === null) return <Loading />;
  if (failed) return <NotConfigured link="/integrations" hint="Банк не подключён в интеграциях" />;
  const income = Number(data.total_income) || 0;
  const expense = Number(data.total_expense) || 0;
  const unclassified = Number(data.unclassified_count ?? data.unclassified) || 0;
  if (!income && !expense && !unclassified) {
    return <NotConfigured link="/integrations" hint="Нет импортированных транзакций" />;
  }
  return (
    <div>
      <div className="bw-bs-grid">
        <div className="bw-bs-cell bw-bs-cell--ok">
          <div className="bw-kpi-val-sm c-ok">{shortMoney(income)}</div>
          <div className="bw-pt-lbl">Приход</div>
        </div>
        <div className="bw-bs-cell bw-bs-cell--err">
          <div className="bw-kpi-val-sm c-err">{shortMoney(expense)}</div>
          <div className="bw-pt-lbl">Расход</div>
        </div>
      </div>
      {unclassified > 0 && (
        <div className="bw-bs-cell--orange">
          <span className="c-t3">Нераспред.: </span>
          <b className="c-amber">{unclassified}</b>
        </div>
      )}
      <Link to="/bank-import" className="widget-link">К транзакциям →</Link>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 18. PlatformAlerts — Тендерные площадки
 *
 * Backend:
 *   GET /api/integrations/platforms?limit=10 — последние спарсенные с площадок
 *   GET /api/integrations/platforms/stats — сводка по площадкам + дедлайны
 * Возвращает {items:[{customer_name, platform_name, application_deadline, nmck}], total}.
 * ═══════════════════════════════════════════════════════════════════════ */
export function PlatformAlerts() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([
      api('/api/integrations/platforms?limit=5').catch(() => ({ items: [] })),
      api('/api/integrations/platforms/stats').catch(() => ({ upcoming_deadlines: [], total: 0 }))
    ])
      .then(([list, stats]) => {
        const items = list.items || [];
        setData({
          items,
          total: stats.total || items.length,
          upcoming: stats.upcoming_deadlines || []
        });
      })
      .catch(() => { setFailed(true); setData({ items: [], upcoming: [] }); });
  }, []);
  if (data === null) return <Loading />;
  if (failed) return <NotConfigured link="/integrations" hint="Площадки настраиваются в интеграциях" />;
  // Если есть горящие дедлайны — показываем их в приоритете.
  const rows = (data.upcoming.length ? data.upcoming : data.items).slice(0, 4);
  if (!rows.length) return <Empty icon="✓" text="Новых тендеров нет" />;
  return (
    <div className="bw-pa-list">
      {rows.map((t) => (
        <div key={t.id} className="bw-pa-row">
          <div className="bw-pa-name">{t.customer_name || t.purchase_number || '—'}</div>
          <div className="bw-pa-src">
            {t.platform_name || 'площадка'}
            {t.application_deadline && ' · до ' + new Date(t.application_deadline).toLocaleDateString('ru-RU')}
          </div>
        </div>
      ))}
      <Link to="/integrations" className="widget-link">Все площадки →</Link>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 19. MyMail — Моя почта
 *
 * Backend:
 *   GET /api/my-mail/stats → {unread, total, folders, configured}
 *   GET /api/my-mail/emails?folder_type=inbox&limit=3 — превью писем
 *   GET /api/mailbox/stats → {unread, inbox_total, starred, drafts, ...} (общий ящик CRM)
 * Логика: сначала пробуем личный ящик, если configured=false — показываем общий
 *   ТОЛЬКО для ADMIN/DIRECTOR_*. Остальные роли (PM/TO/HR/...) без личной почты
 *   видят "Почта не подключена" — общий ящик CRM им показывать НЕЛЬЗЯ (privacy leak).
 *   Эталон vanilla: public/assets/js/custom_dashboard.js:1368 (_MAILBOX_ROLES).
 * ═══════════════════════════════════════════════════════════════════════ */
const _MAILBOX_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
export function MyMail({ user }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/my-mail/stats')
      .then(async (stats) => {
        if (!stats?.configured) {
          // Личной почты нет — общий ящик /api/mailbox/stats только для ADMIN/DIRECTOR
          if (!_MAILBOX_ROLES.includes(user && user.role)) {
            setFailed(true);
            setData({ items: [] });
            return;
          }
          const mb = await api('/api/mailbox/stats').catch(() => null);
          if (mb && (mb.unread > 0 || mb.inbox_total > 0)) {
            setData({
              unread: Number(mb.unread) || 0,
              total: Number(mb.inbox_total) || 0,
              items: [],
              source: 'mailbox'
            });
            return;
          }
          setFailed(true);
          setData({ items: [] });
          return;
        }
        // Личный ящик настроен — добираем превью inbox
        const preview = await api('/api/my-mail/emails?folder_type=inbox&limit=3&is_read=false').catch(() => ({ emails: [] }));
        const emails = preview.emails || preview.items || [];
        setData({
          unread: Number(stats.unread) || 0,
          total: Number(stats.total) || 0,
          items: emails.map((m) => ({
            id: m.id,
            from: m.from_name || m.from_email || m.from || '—',
            subject: m.subject || '(без темы)',
            when: m.email_date ? new Date(m.email_date).toLocaleDateString('ru-RU') : ''
          })),
          source: 'my-mail'
        });
      })
      .catch(() => { setFailed(true); setData({ items: [] }); });
  }, [user && user.role]);
  if (data === null) return <Loading />;
  if (failed) return <NotConfigured link="/mail-settings" hint="Почта не подключена в «Настройки почты»" />;
  const link = data.source === 'mailbox' ? '/mailbox' : '/my-mail';
  return (
    <div>
      {data.unread > 0 ? (
        <div className="bw-mail-unread">
          📬 {data.unread} непрочитанных {data.total ? `· всего ${data.total}` : ''}
        </div>
      ) : (
        <div className="bw-mail-unread" style={{ background: 'var(--bg-2)', color: 'var(--t-2)' }}>
          ✓ Входящие прочитаны
        </div>
      )}
      {data.items.slice(0, 3).map((m) => (
        <div key={m.id} className="bw-mail-row">
          <div className="bw-mail-head">
            <b>{m.from}</b>
            <span className="bw-mail-when">{m.when}</span>
          </div>
          <div className="bw-mail-sub">{m.subject}</div>
        </div>
      ))}
      <Link to={link} className="widget-link">Все письма →</Link>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 20. Academy — Залы Асгарда (Academy)
 *
 * Backend:
 *   GET /api/office-academy/stats → {lessons_passed, lessons_started, avg_score,
 *      total_xp, last_passed_at, rank:{name,level,icon}, streak, ranks}
 *   GET /api/office-academy/lessons → {lessons:[], total, passed, mandatory_pending, total_xp, rank}
 * Берём агрегированные данные из stats + общее total из /lessons.
 * ═══════════════════════════════════════════════════════════════════════ */
export function Academy({ user }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([
      api('/api/office-academy/stats').catch(() => null),
      api('/api/office-academy/lessons').catch(() => null)
    ])
      .then(([stats, lessons]) => {
        if (!stats && !lessons) { setFailed(true); setData({}); return; }
        const total = Number(lessons?.total) || 0;
        const completed = Number(stats?.lessons_passed ?? lessons?.passed) || 0;
        const xp = Number(stats?.total_xp ?? lessons?.total_xp) || 0;
        const rank = stats?.rank || lessons?.rank || null;
        const streak = Number(stats?.streak) || 0;
        const mandatoryPending = Number(lessons?.mandatory_pending) || 0;
        setData({ completed, total, xp, rank, streak, mandatoryPending });
      })
      .catch(() => { setFailed(true); setData({}); });
  }, [user.id]);
  if (data === null) return <Loading />;
  if (failed || !data.total) return <NotConfigured link="/office-academy" hint="Академия — на отдельной странице" />;
  const pct = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
  return (
    <div>
      <div className="bw-ac-head">
        <div className="bw-ac-val">{data.completed} / {data.total}</div>
        <div className="bw-ac-cap">
          уроков пройдено · {pct}%
          {data.xp > 0 && <> · ⚡ {data.xp} XP</>}
        </div>
      </div>
      <div className="bw-ac-bar">
        <div className="bw-ac-bar-fill" style={{ width: pct + '%' }} />
      </div>
      {data.rank && (
        <div className="bw-ac-curr">
          <span className="c-t3">Ранг:</span> <b>{data.rank.icon || ''} {data.rank.name || ''}</b>
          {data.streak > 0 && <span className="c-t3"> · streak {data.streak}</span>}
        </div>
      )}
      {data.mandatoryPending > 0 && (
        <div className="bw-ac-curr" style={{ color: 'var(--amber)' }}>
          ⚠ {data.mandatoryPending} обязательных непройденных
        </div>
      )}
      <Link to="/office-academy" className="widget-link">Продолжить →</Link>
    </div>
  );
}
