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
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { MiniChart as _MiniChart, StatusBadge, ProgressSteps as _ProgressSteps, toast } from '@/modals/Notifications';
import { DrawerModal, useModal } from '@/modals';
import { Btn } from '@/modals/parts';
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
  const [active, setActive] = useState(null); // ActiveWorksFinancialSummary
  const [failed, setFailed] = useState(false);
  const { open } = useModal();
  useEffect(() => {
    let cancelled = false;
    // 1) Подготовка
    api('/api/work-readiness?my=true&limit=5')
      .then(async (d) => {
        if (cancelled) return;
        const list = d.items || d.works || (Array.isArray(d) ? d : []);
        const norm = list.slice(0, 5).map((w) => ({
          id: w.id,
          title: w.work_title || w.title || w.customer_name || `Работа #${w.id}`,
          ready: Math.round(Number(w.readiness?.overall_percent ?? w.ready ?? 0)),
          blocker: w.readiness?.blocker_label || w.readiness?.blocker || w.blocker || null
        }));
        setItems(norm);
      })
      .catch(() => { if (!cancelled) { setFailed(true); setItems([]); } });
    // 2) ActiveWorksFinancialSummary — работы пользователя в работе
    api('/api/works?status=active&my=true&limit=10')
      .then(async (d) => {
        if (cancelled) return;
        const list = d.works || d.items || (Array.isArray(d) ? d : []);
        const summaries = await Promise.all(list.slice(0, 5).map((w) =>
          api(`/api/works/${w.id}/financial-summary`).catch(() => null).then((fs) => ({
            id: w.id,
            title: w.work_title || w.title || w.customer_name || `Работа #${w.id}`,
            fs
          }))
        ));
        if (!cancelled) setActive(summaries.filter((x) => x.fs));
      })
      .catch(() => { if (!cancelled) setActive([]); });
    return () => { cancelled = true; };
  }, []);
  const openDrawer = (w) => {
    open(<MyReadinessStageDrawer workId={w.id} title={w.title} />, { size: 'drawer-right' });
  };
  if (items === null) return <Loading />;
  if (failed) return <NotConfigured link="/readiness" hint="Готовность считается на странице «Проекты»" />;
  if (!items.length && (!active || !active.length)) return <Empty icon="📭" text="Нет активных проектов" />;
  return (
    <div className="bw-ready-list">
      {items.length > 0 && (
        <>
          <div className="bw-section-eyebrow">Подготовка</div>
          {items.map((w) => (
            <div key={w.id} className="bw-ready-row bw-ready-row--click" onClick={() => openDrawer(w)} role="button" tabIndex={0}>
              <Ring value={w.ready} />
              <div className="bw-ready-main">
                <div className="bw-ready-name">{w.title}</div>
                {w.blocker && <div className="bw-ready-blocker">⚠ {w.blocker}</div>}
              </div>
            </div>
          ))}
        </>
      )}
      {active && active.length > 0 && (
        <>
          <div className="bw-section-eyebrow bw-section-eyebrow--mt">В работе</div>
          {active.map((a) => {
            const margin = Number(a.fs?.margin_percent ?? a.fs?.margin ?? 0);
            const costPlan = Number(a.fs?.cost_plan ?? 0);
            const costFact = Number(a.fs?.cost_fact ?? 0);
            const overrun = costPlan > 0 && costFact > costPlan;
            const marginTone = margin >= 15 ? 'c-ok' : margin >= 5 ? 'c-gold' : 'c-err';
            return (
              <div key={a.id} className="bw-active-row">
                <div className="bw-ready-main">
                  <div className="bw-ready-name">{a.title}</div>
                  <div className="bw-active-fin">
                    <span className={marginTone}>маржа {margin.toFixed(1)}%</span>
                    {overrun && <span className="c-err"> · перерасход {shortMoney(costFact - costPlan)}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
      <Link to="/readiness" className="widget-link">Все проекты →</Link>
    </div>
  );
}

/* Drawer для MyReadiness — stages + override */
function MyReadinessStageDrawer({ workId, title }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const { close } = useModal();
  const load = () => {
    setData(null);
    api(`/api/work-readiness/${workId}`).then(setData).catch(() => setData({ error: true }));
  };
  useEffect(load, [workId]);
  const setOverride = async (stage, forced_done) => {
    if (busy) return;
    setBusy(true);
    try {
      if (forced_done === null) {
        await api(`/api/work-readiness/${workId}/override/${stage}`, { method: 'DELETE' });
        toast.success('Override снят');
      } else {
        await api(`/api/work-readiness/${workId}/override`, {
          method: 'POST',
          body: { stage, forced_done }
        });
        toast.success('Override сохранён');
      }
      load();
    } catch (e) {
      toast.error('Не удалось сохранить override');
    } finally {
      setBusy(false);
    }
  };
  return (
    <DrawerModal title={title || `Работа #${workId}`} icon="🛡️" subtitle={data?.overall_percent != null ? `Готовность ${data.overall_percent}%` : ''} onClose={close}>
      {!data && <div className="p-24 t-center c-t3">⏳ Загрузка…</div>}
      {data?.error && <div className="p-24 t-center c-err">Не удалось загрузить</div>}
      {data && !data.error && (
        <div className="bw-drawer-stages">
          {(data.stages || []).filter((s) => s.applicable !== false).map((s) => {
            const pct = Math.round(Number(s.percent ?? s.ready ?? 0));
            const overridden = s.override?.forced_done;
            return (
              <div key={s.key || s.stage} className="bw-drawer-stage">
                <div className="bw-drawer-stage-head">
                  <span className="bw-drawer-stage-name">{s.label || s.title || s.key}</span>
                  <span className={pct >= 80 ? 'c-ok' : pct >= 50 ? 'c-gold' : 'c-err'}>{pct}%</span>
                </div>
                {s.blocker_label && <div className="bw-ready-blocker">⚠ {s.blocker_label}</div>}
                <div className="bw-drawer-stage-actions">
                  {!overridden ? (
                    <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setOverride(s.key || s.stage, true)}>
                      Закрыть принудительно
                    </Btn>
                  ) : (
                    <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setOverride(s.key || s.stage, null)}>
                      Снять override
                    </Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DrawerModal>
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
  const { open } = useModal();
  useEffect(() => {
    api('/api/work-readiness?my=true&limit=500')
      .then((d) => {
        const works = d.items || d.works || (Array.isArray(d) ? d : []);
        const now = Date.now();
        const byPm = new Map();
        for (const w of works) {
          if (!w.pm_id) continue;
          const ready = Number(w.readiness?.overall_percent ?? 0);
          const startPlan = w.start_plan ? new Date(w.start_plan).getTime() : null;
          const daysLeft = Number.isFinite(startPlan) ? Math.ceil((startPlan - now) / 86400000) : null;
          const isHot = ready < 60 && daysLeft != null && daysLeft <= 14;
          const entry = byPm.get(w.pm_id) || { id: w.pm_id, name: w.pm_name || `PM #${w.pm_id}`, total: 0, count: 0, hot: 0, works: [] };
          entry.total += ready;
          entry.count += 1;
          if (isHot) entry.hot += 1;
          entry.works.push({
            id: w.id,
            title: w.work_title || w.title || w.customer_name || `Работа #${w.id}`,
            ready,
            daysLeft,
            isHot,
            blocker: w.readiness?.blocker_label || w.readiness?.blocker || null
          });
          byPm.set(w.pm_id, entry);
        }
        const list = Array.from(byPm.values()).map((e) => {
          const avg = e.count > 0 ? Math.round(e.total / e.count) : 0;
          const status = avg >= 70 ? 'green' : avg >= 50 ? 'yellow' : 'red';
          return { id: e.id, name: e.name, avgReady: avg, worksCount: e.count, hot: e.hot, works: e.works, status };
        }).sort((a, b) => (b.hot - a.hot) || (a.avgReady - b.avgReady));
        setPms(list);
      })
      .catch(() => { setFailed(true); setPms([]); });
  }, []);
  const openPm = (p) => {
    open(<DirectorReadinessPmDrawer pm={p} />, { size: 'drawer-right' });
  };
  if (pms === null) return <Loading tall />;
  if (failed) return <NotConfigured link="/readiness-board" hint="Сводная готовность по РП на отдельной странице" />;
  if (!pms.length) return <Empty icon="👥" text="Нет РП с работами в подготовке" />;
  const toneVar = { green: 'var(--ok)', yellow: 'var(--amber)', red: 'var(--err)' };
  return (
    <div className="bw-dir-grid">
      {pms.map((p) => (
        <div
          key={p.id}
          className="bw-dir-row bw-dir-row--click"
          style={{ borderLeft: `3px solid ${toneVar[p.status]}` }}
          onClick={() => openPm(p)}
          role="button"
          tabIndex={0}
        >
          <Ring value={p.avgReady} size={36} />
          <div className="bw-dir-main">
            <div className="bw-dir-name">{p.name}</div>
            <div className="bw-dir-sub">
              {p.worksCount} работ
              {p.hot > 0 && <span className="bw-dir-hot">🔥 {p.hot} горящих</span>}
            </div>
          </div>
        </div>
      ))}
      <Link to="/readiness-board" className="widget-link">Подробнее →</Link>
    </div>
  );
}

/* Drawer для DirectorReadiness — список работ РП с blocker_label */
function DirectorReadinessPmDrawer({ pm }) {
  const { close } = useModal();
  const sorted = [...(pm.works || [])].sort((a, b) => (b.isHot - a.isHot) || (a.ready - b.ready));
  return (
    <DrawerModal
      title={pm.name}
      subtitle={`${pm.worksCount} работ · средняя готовность ${pm.avgReady}%${pm.hot > 0 ? ` · ${pm.hot} горящих` : ''}`}
      icon="🚦"
      onClose={close}
    >
      <div className="bw-drawer-stages">
        {sorted.map((w) => (
          <div key={w.id} className={`bw-drawer-stage ${w.isHot ? 'bw-drawer-stage--hot' : ''}`}>
            <div className="bw-drawer-stage-head">
              <span className="bw-drawer-stage-name">
                {w.isHot && <span className="bw-dir-hot-icon">🔥</span>}
                {w.title}
              </span>
              <span className={w.ready >= 70 ? 'c-ok' : w.ready >= 50 ? 'c-gold' : 'c-err'}>{w.ready}%</span>
            </div>
            {w.blocker && <div className="bw-ready-blocker">⚠ {w.blocker}</div>}
            {w.daysLeft != null && (
              <div className="bw-dir-days">
                {w.daysLeft >= 0 ? `до старта ${w.daysLeft} дн.` : `старт прошёл ${-w.daysLeft} дн. назад`}
              </div>
            )}
          </div>
        ))}
      </div>
    </DrawerModal>
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
  const purchase = Number(data.total_purchase_value) || 0;
  const depreciation = Number(data.total_depreciation) || 0;
  const deprecPercent = purchase > 0 ? Math.round((depreciation / purchase) * 100) : 0;
  const remaining = Math.max(0, 100 - deprecPercent);
  const expiringCount = Number(data.expiring_soon?.count) || 0;
  const autoWrittenOff = Number(data.auto_written_off) || 0;
  return (
    <div>
      <div className="bw-equip-head">
        <div className="bw-equip-val">{shortMoney(total)}</div>
        <div className="bw-equip-cap">Балансовая стоимость ТМЦ</div>
      </div>
      <div className="bw-equip-list">
        <div className="bw-equip-row">
          <span className="c-t2">Закупочная</span>
          <b>{shortMoney(purchase)}</b>
        </div>
        <div className="bw-equip-row">
          <span className="c-t2">Амортизация</span>
          <b>{shortMoney(depreciation)} ({deprecPercent}%)</b>
        </div>
        <div className="bw-equip-row">
          <span className="c-t2">Позиций</span>
          <b>{data.total_items || 0} (на складе {data.on_warehouse || 0})</b>
        </div>
      </div>
      <div className="bw-equip-bar" title={`Остаточная стоимость ${remaining}%`}>
        <div className="bw-equip-bar-fill" style={{ width: remaining + '%' }} />
      </div>
      {expiringCount > 0 && (
        <div className="bw-equip-alert bw-equip-alert--amber">
          ⚠️ {expiringCount} скоро истекает
        </div>
      )}
      {autoWrittenOff > 0 && (
        <div className="bw-equip-alert bw-equip-alert--err">
          🗑️ {autoWrittenOff} автосписано
        </div>
      )}
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
const TEL_DIR_ICONS = { inbound: '↙', outbound: '↗', missed: '↩', internal: '⇄', in: '↙', out: '↗' };
const TEL_DIR_CLS = { inbound: 'bw-tel-arrow--in', outbound: 'bw-tel-arrow--out', missed: 'bw-tel-arrow--missed', internal: 'bw-tel-arrow--internal', in: 'bw-tel-arrow--in', out: 'bw-tel-arrow--out' };
function fmtDuration(s) {
  const n = Number(s) || 0;
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
}
function fmtTime(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}
export function TelephonyStatus() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([
      api('/api/telephony/call-control/settings'),
      api('/api/telephony/calls?limit=5')
    ]).then(([settings, calls]) => {
      setData({
        dispatcher: settings.dispatcher_enabled ?? settings.is_dispatcher ?? false,
        dispatcherName: settings.current_dispatcher_name || settings.dispatcher_name || '',
        recent: (calls.call_history || calls.calls || calls.items || []).slice(0, 5)
      });
    }).catch(() => { setFailed(true); setData({}); });
  }, []);
  if (data === null) return <Loading />;
  if (failed) return <NotConfigured link="/telephony" hint="Телефония не подключена" />;
  return (
    <div>
      <div className={`bw-tel-status ${data.dispatcher ? 'bw-tel-status--on' : data.dispatcherName ? 'bw-tel-status--name' : 'bw-tel-status--off'}`}>
        <span className="bw-tel-status-lbl">
          Диспетчер
          {data.dispatcherName && <span className="bw-tel-name"> · {data.dispatcherName}</span>}
        </span>
        <StatusBadge tone={data.dispatcher ? 'approved' : 'rejected'} label={data.dispatcher ? 'Активен' : 'Отключён'} />
      </div>
      <div className="bw-tel-eyebrow">Последние</div>
      {data.recent.map((c) => {
        const dir = c.direction || 'inbound';
        const icon = TEL_DIR_ICONS[dir] || '↙';
        const cls = TEL_DIR_CLS[dir] || 'bw-tel-arrow--in';
        const phone = c.from_number || c.to_number || c.caller_id || c.from || c.phone || '—';
        const dur = fmtDuration(c.duration_seconds || c.duration || 0);
        const time = fmtTime(c.created_at || c.when || c.started_at);
        return (
          <div key={c.id} className="bw-tel-row">
            <span className={cls}>{icon}</span>
            <span className="bw-tel-from">{phone}</span>
            <span className="bw-tel-dur">{dur}</span>
            <span className="bw-tel-when">{time}</span>
          </div>
        );
      })}
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
  const [groups, setGroups] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Получаем максимум 60 дней — затем сами раскладываем по корзинам.
    api('/api/permits?status=expiring_60&limit=200')
      .catch(() => api('/api/permits?limit=200'))
      .then((d) => {
        const list = d.items || d.permits || (Array.isArray(d) ? d : []);
        const now = Date.now();
        const buckets = { expired: [], critical: [], warning: [], upcoming: [] };
        list.forEach((p) => {
          const exp = p.expiry_date || p.expires_at;
          if (!exp) return;
          const t = new Date(exp).getTime();
          if (!Number.isFinite(t)) return;
          const days = Math.round((t - now) / 86400000);
          const item = {
            id: p.id,
            name: p.employee_name || p.fio || p.name || '—',
            type: p.permit_type || p.type || '',
            days,
            date: exp
          };
          if (days < 0) buckets.expired.push(item);
          else if (days <= 14) buckets.critical.push(item);
          else if (days <= 30) buckets.warning.push(item);
          else if (days <= 60) buckets.upcoming.push(item);
        });
        Object.values(buckets).forEach((arr) => arr.sort((a, b) => a.days - b.days));
        setGroups(buckets);
      })
      .catch(() => { setFailed(true); setGroups({ expired: [], critical: [], warning: [], upcoming: [] }); });
  }, []);
  if (groups === null) return <Loading tall />;
  if (failed) return <NotConfigured link="/permits" hint="Допуски — на странице «Разрешения и допуски»" />;
  const total = groups.expired.length + groups.critical.length + groups.warning.length + groups.upcoming.length;
  if (!total) return <Empty icon="✅" text="Все допуски в порядке" />;
  return (
    <div>
      <div className="bw-permits-badges">
        {groups.expired.length > 0 && <span className="bw-permit-badge bw-permit-badge--err"><b>{groups.expired.length}</b> истекли</span>}
        {groups.critical.length > 0 && <span className="bw-permit-badge bw-permit-badge--orange"><b>{groups.critical.length}</b> &lt; 14 дн.</span>}
        {groups.warning.length > 0 && <span className="bw-permit-badge bw-permit-badge--amber"><b>{groups.warning.length}</b> &lt; 30 дн.</span>}
        {groups.upcoming.length > 0 && <span className="bw-permit-badge bw-permit-badge--info"><b>{groups.upcoming.length}</b> &lt; 60 дн.</span>}
      </div>
      <div className="bw-permits-list">
        {groups.expired.length > 0 && <PermitGroup title="Истекли" tone="err" items={groups.expired} max={10} />}
        {groups.critical.length > 0 && <PermitGroup title="Критично (до 14 дн.)" tone="orange" items={groups.critical} max={20} />}
        {groups.warning.length > 0 && <PermitGroup title="До 30 дн." tone="amber" items={groups.warning} max={20} />}
        {groups.upcoming.length > 0 && <PermitGroup title="До 60 дн." tone="info" items={groups.upcoming} max={15} />}
      </div>
      <Link to="/permits" className="widget-link">Все допуски →</Link>
    </div>
  );
}

function PermitGroup({ title, tone, items, max }) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <div className={`bw-permit-group bw-permit-group--${tone}`}>
      <div className={`bw-permit-group-head bw-permit-group-head--${tone}`}>{title}</div>
      {shown.map((it) => {
        const days = it.days;
        const daysTxt = days === 0 ? 'Сегодня' : days < 0 ? `${Math.abs(days)} дн. назад` : `${days} дн.`;
        return (
          <div key={it.id} className="bw-permit-row">
            <span className="bw-permit-row-name">{it.name}</span>
            <span className="bw-permit-row-type">{it.type}</span>
            <span className={`bw-permit-row-days bw-permit-row-days--${tone}`}>{daysTxt}</span>
          </div>
        );
      })}
      {rest > 0 && <div className="bw-permit-row-rest">и ещё {rest}…</div>}
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
      api('/api/works?status=active&limit=500').catch(() => ({ works: [] })),
      api('/api/works?status=completed&limit=500').catch(() => ({ works: [] }))
    ]).then(([usersR, activeR, doneR]) => {
      const users = (usersR.users || usersR.items || []).filter((u) => u.role === 'PM' && u.is_active);
      const activeWorks = activeR.works || activeR.items || [];
      const doneWorks = doneR.works || doneR.items || [];
      const activeCount = {};
      activeWorks.forEach((w) => { if (w.pm_id) activeCount[w.pm_id] = (activeCount[w.pm_id] || 0) + 1; });
      const doneCount = {};
      doneWorks.forEach((w) => { if (w.pm_id) doneCount[w.pm_id] = (doneCount[w.pm_id] || 0) + 1; });
      // Также добавим PM из works у которых нет в users-выдаче
      const knownPm = new Set(users.map((u) => u.id));
      const pmFromWorks = new Map();
      [...activeWorks, ...doneWorks].forEach((w) => {
        if (w.pm_id && !knownPm.has(w.pm_id) && !pmFromWorks.has(w.pm_id)) {
          pmFromWorks.set(w.pm_id, { id: w.pm_id, name: w.pm_name || `PM #${w.pm_id}` });
        }
      });
      const allPms = [...users, ...pmFromWorks.values()];
      const out = allPms.map((u) => ({
        id: u.id,
        name: u.name || u.login || `PM #${u.id}`,
        active: activeCount[u.id] || 0,
        completed: doneCount[u.id] || 0
      })).filter((p) => p.active > 0 || p.completed > 0).sort((a, b) => (b.active + b.completed) - (a.active + a.completed));
      setPms(out);
    }).catch(() => setPms([]));
  }, []);
  if (pms === null) return <Loading tall />;
  if (!pms.length) return <Empty icon="👥" text="Нет активных РП" />;
  const max = Math.max(...pms.map((p) => p.active + p.completed), 1);
  return (
    <div>
      <div className="bw-team-list">
        {pms.slice(0, 8).map((p) => {
          const pctDone = (p.completed / max) * 100;
          const pctActive = (p.active / max) * 100;
          const tone = p.active >= 6 ? 'var(--err)' : p.active >= 3 ? 'var(--amber)' : 'var(--ok)';
          const short = (p.name || '').split(' ')[0];
          return (
            <div key={p.id} className="bw-team-row" title={p.name}>
              <span className="bw-team-name">{short}</span>
              <div className="bw-team-bar bw-team-bar--split">
                <div className="bw-team-bar-done" style={{ width: pctDone + '%' }} />
                <div className="bw-team-bar-fill" style={{ width: pctActive + '%', background: tone }} />
              </div>
              <b className="bw-team-count" style={{ color: tone }}>
                {p.active + p.completed} <span className="c-t3">({p.active})</span>
              </b>
            </div>
          );
        })}
      </div>
      <TeamLegend />
    </div>
  );
}

function TeamLegend() {
  return (
    <div className="bw-team-legend">
      <span className="bw-legend-item"><span className="bw-legend-dot bw-legend-dot--done" />Сдано</span>
      <span className="bw-legend-item"><span className="bw-legend-dot bw-legend-dot--ok" />В норме (1-2)</span>
      <span className="bw-legend-item"><span className="bw-legend-dot bw-legend-dot--amber" />Нагрузка (3-5)</span>
      <span className="bw-legend-item"><span className="bw-legend-dot bw-legend-dot--err" />Перегрузка (6+)</span>
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
        const tenders = d.tenders || d.items || (Array.isArray(d) ? d : []);
        const now = new Date();
        // 6-месячное скользящее окно (как vanilla)
        const months = [];
        for (let i = 5; i >= 0; i--) {
          const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
          const label = dt.toLocaleDateString('ru-RU', { month: 'short' });
          const mTenders = tenders.filter((t) => {
            const p = String(t.period || '');
            const c = String(t.created_at || '');
            return p.startsWith(key) || c.startsWith(key);
          });
          const won = mTenders.filter((t) => t.tender_status === 'Выиграли').length;
          months.push({ key, label, total: mTenders.length, won });
        }
        setData({ months });
      })
      .catch(() => setData(null));
  }, []);
  if (!data) return <Loading tall />;
  const totalAll = data.months.reduce((s, m) => s + m.total, 0);
  const wonAll = data.months.reduce((s, m) => s + m.won, 0);
  const max = Math.max(...data.months.map((m) => m.total), 1);
  return (
    <div>
      <div className="bw-td-tot">
        <div><span className="c-t3">Всего:</span> <b className="c-info">{totalAll}</b></div>
        <div><span className="c-t3">Выиграли:</span> <b className="c-ok">{wonAll}</b></div>
      </div>
      <div className="bw-td-chart">
        {data.months.map((m, i) => {
          const h = Math.max(4, Math.round((m.total / max) * 80));
          const wonH = m.total > 0 ? Math.round((m.won / m.total) * h) : 0;
          return (
            <div key={i} className="bw-td-col">
              <div className="bw-td-num">{m.total}</div>
              <div className="bw-td-bar" style={{ height: h + 'px' }}>
                <div className="bw-td-bar-won" style={{ height: wonH + 'px' }} />
              </div>
              <div className="bw-td-month">{m.label}</div>
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
function _isClosedWork(st) {
  const s = String(st || '').toLowerCase();
  return s === 'closed' || s === 'completed' || s === 'cancelled' || s === 'done';
}

export function KpiSummary() {
  const [data, setData] = useState(null);
  useEffect(() => {
    Promise.all([
      api('/api/tenders?limit=2000').catch(() => ({ tenders: [] })),
      api('/api/works?limit=2000').catch(() => ({ works: [] }))
    ]).then(([tR, wR]) => {
      const tenders = tR.tenders || tR.items || [];
      const works = wR.works || wR.items || [];
      const year = new Date().getFullYear();
      const yT = tenders.filter((t) => String(t.year) === String(year) || (t.period || '').startsWith(String(year)));
      const won = yT.filter((t) => t.tender_status === 'Выиграли').length;
      const total = yT.length;
      // Работы текущего года (по start_fact/start_plan/created_at)
      const yWorks = works.filter((w) => {
        const d = w.start_fact || w.start_plan || w.created_at;
        return d && new Date(d).getFullYear() === year;
      });
      const completed = yWorks.filter((w) => _isClosedWork(w.work_status || w.status)).length;
      const revenue = yWorks.reduce((s, w) => s + (Number(w.contract_value) || 0), 0);
      setData({
        total,
        won,
        conversion: total > 0 ? Math.round((won / total) * 100) : 0,
        revenue,
        worksTotal: yWorks.length,
        worksCompleted: completed
      });
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
        <div className="bw-kpi-val c-purple">{data.worksCompleted}/{data.worksTotal}</div>
        <div className="bw-kpi-lbl">Сдано работ</div>
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
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([
      api('/api/approval/cash-balance').catch(() => null),
      api('/api/cash/admin/summary').catch(() => null)
    ]).then(([primary, summary]) => {
      if (!primary && !summary) { setFailed(true); setData({}); return; }
      const totalIssued = Number(summary?.total_issued ?? primary?.total_issued ?? 0);
      const totalReturned = Number(summary?.total_returned ?? primary?.total_returned ?? 0);
      // Семантика как в vanilla custom_dashboard.js: «Выдано (не закрыто)»
      // = total_issued - total_returned (если есть detail), fallback на balance.
      const outstanding = (totalIssued > 0 || totalReturned > 0)
        ? totalIssued - totalReturned
        : Number(primary?.balance ?? 0);
      const pending = Number(summary?.pending_count ?? primary?.pending_count ?? primary?.pending ?? 0);
      setData({ outstanding, pending });
    });
  }, []);
  if (data === null) return <Loading />;
  if (failed) return <NotConfigured link="/cash-admin" hint="Баланс кассы — на странице «Касса (управление)»" />;
  const v = Number(data.outstanding) || 0;
  return (
    <div className="bw-cash-wrap">
      <div className={`bw-cash-val ${v > 100000 ? 'c-ok' : 'c-amber'}`}>{shortMoney(v)}</div>
      <div className="bw-cash-cap">Выдано (не закрыто)</div>
      {data.pending > 0 && (
        <div className="bw-cash-pending">{data.pending} заявок в обработке</div>
      )}
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
  const isHeadTo = user?.role === 'HEAD_TO';

  const reload = () => {
    api('/api/cash/my-balance', { silent: true })
      .then(setData)
      .catch(() => { setFailed(true); setData({}); });
  };

  useEffect(() => {
    reload();
    const onChanged = () => reload();
    window.addEventListener('asgard:cash:changed', onChanged);
    return () => window.removeEventListener('asgard:cash:changed', onChanged);
  }, [user.id]);

  if (data === null) return <Loading />;
  if (failed) return <NotConfigured link="/cash" hint={isHeadTo ? 'Моя касса — на странице «Касса»' : 'Подотчётные средства — на странице «Касса»'} />;
  const totalIssued = Number(data.issued) || 0;
  const activeRequests = Number(data.active_requests) || 0;
  const balance = Number(data.balance) || 0;
  if (!totalIssued && !Number(data.spent) && !activeRequests && balance <= 0) {
    return <Empty icon="✓" text={isHeadTo ? 'Касса пуста' : 'Нет активных подотчётных'} />;
  }
  return (
    <div>
      <div className="bw-mini-grid">
        <Mini label="Получено" v={totalIssued} color="info" />
        <Mini label={isHeadTo ? 'Выплачено' : 'Потрачено'} v={Number(isHeadTo ? data.cash_payouts_workers : data.spent) || 0} color="err" />
        <Mini label="Возвращено" v={Number(data.returned) || 0} color="t-3" />
        <Mini label="На руках" v={balance} color="gold" />
      </div>
      {activeRequests > 0 && (
        <div className="bw-mycash-active">У вас {activeRequests} заяв{activeRequests === 1 ? 'ка' : activeRequests < 5 ? 'ки' : 'ок'} на рассмотрении</div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        <Link to="/cash" className="widget-link">{isHeadTo ? 'Моя касса →' : 'Перейти в кассу →'}</Link>
        {isHeadTo && (
          <Link to="/cash" className="widget-link" onClick={() => { /* navigate then user clicks */ }}>
            Добавить расход →
          </Link>
        )}
      </div>
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
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([
      api('/api/payroll/sheets?status=pending&limit=1').catch(() => null),
      api('/api/one-time-payments?status=pending&limit=1').catch(() => null)
    ]).then(([sheetsR, oneR]) => {
      if (!sheetsR && !oneR) { setFailed(true); setData({}); return; }
      const sheets = Number(sheetsR?.total ?? (sheetsR?.items || []).length) || 0;
      const oneTime = Number(oneR?.total ?? (oneR?.items || []).length) || 0;
      setData({ sheets, oneTime });
    });
  }, []);
  if (data === null) return <Loading />;
  if (failed) return <NotConfigured link="/payroll" hint="Ведомости — на странице «Расчёты с рабочими»" />;
  const total = (data.sheets || 0) + (data.oneTime || 0);
  return (
    <div className="bw-pp-wrap">
      <div className={`bw-pp-val ${total > 0 ? 'c-gold' : 'c-ok'}`}>{total}</div>
      <div className="bw-pp-lbl">
        {total > 0 ? 'Ведомостей / разовых на согласовании' : 'Все согласованы'}
      </div>
      {total > 0 && (
        <div className="bw-pp-links">
          {data.sheets > 0 && <Link to="/payroll" className="bw-pp-link">{data.sheets} ведомост{data.sheets === 1 ? 'ь' : data.sheets < 5 ? 'и' : 'ей'} →</Link>}
          {data.oneTime > 0 && <Link to="/one-time-pay" className="bw-pp-link">{data.oneTime} разов{data.oneTime === 1 ? 'ая' : data.oneTime < 5 ? 'ые' : 'ых'} →</Link>}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 16. PreTenders — Заявки
 * ═══════════════════════════════════════════════════════════════════════ */
const PT_AI_DOT_CLS = { green: 'bw-pt-dot--ok', yellow: 'bw-pt-dot--amber', red: 'bw-pt-dot--err', gray: 'bw-pt-dot--t2' };

export function PreTenders() {
  const [data, setData] = useState(null);
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([
      api('/api/pre-tenders/stats').catch(() => null),
      api('/api/pre-tenders/?status=new&limit=5').catch(() => null)
    ]).then(([stats, listR]) => {
      if (!stats) { setFailed(true); setData({}); return; }
      setData(stats);
      setList((listR?.items || listR?.pre_tenders || []).slice(0, 5));
    });
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
      {list && list.length > 0 && (
        <div className="bw-pt-list">
          {list.map((it) => {
            const dotCls = PT_AI_DOT_CLS[it.ai_color] || PT_AI_DOT_CLS.gray;
            return (
              <div key={it.id} className="bw-pt-item">
                <span className={`bw-pt-dot ${dotCls}`} />
                <span className="bw-pt-item-name">{it.customer_name || it.email_from_name || '—'}</span>
                <span className="bw-pt-item-when">
                  {it.created_at ? new Date(it.created_at).toLocaleDateString('ru-RU') : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
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
  const [transactions, setTransactions] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([
      api('/api/integrations/bank/stats').catch(() => null),
      api('/api/integrations/bank/transactions?limit=5&sort=transaction_date&order=desc').catch(() => null)
    ]).then(([statsR, txR]) => {
      if (!statsR) { setFailed(true); setData({}); return; }
      setData(statsR.stats || statsR);
      setTransactions((txR?.items || txR?.transactions || []).slice(0, 5));
    });
  }, []);
  if (data === null) return <Loading />;
  if (failed) return <NotConfigured link="/integrations" hint="Банк не подключён в интеграциях" />;
  const income = Number(data.total_income) || 0;
  const expense = Number(data.total_expense) || 0;
  const unclassified = Number(data.unclassified_count ?? data.unclassified) || 0;
  if (!income && !expense && !unclassified && (!transactions || !transactions.length)) {
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
      {transactions && transactions.length > 0 && (
        <div className="bw-bs-tx-list">
          {transactions.map((t) => {
            const isIn = t.direction === 'income' || (Number(t.amount) > 0 && !t.direction);
            const sign = isIn ? '+' : '−';
            const iconCls = isIn ? 'bw-bs-tx-icon--ok' : 'bw-bs-tx-icon--err';
            const amount = Math.abs(Number(t.amount) || 0);
            return (
              <div key={t.id} className="bw-bs-tx-row">
                <span className={`bw-bs-tx-icon ${iconCls}`}>{isIn ? '↙' : '↗'}</span>
                <span className={`bw-bs-tx-amt ${isIn ? 'c-ok' : 'c-err'}`}>{sign}{shortMoney(amount)}</span>
                <span className="bw-bs-tx-name">{t.counterparty_name || t.payment_purpose || '—'}</span>
                <span className="bw-bs-tx-date">
                  {t.transaction_date ? new Date(t.transaction_date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : ''}
                </span>
              </div>
            );
          })}
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
      api('/api/integrations/platforms/stats').catch(() => null),
      api('/api/integrations/platforms?parse_status=completed&sort=application_deadline&order=asc&limit=5').catch(() => ({ items: [] }))
    ])
      .then(([statsR, listR]) => {
        if (!statsR && !listR) { setFailed(true); setData({}); return; }
        const stats = statsR?.stats || statsR || {};
        const items = listR.items || listR.platforms || [];
        setData({
          total: Number(stats.total) || 0,
          completed: Number(stats.completed) || 0,
          pending: Number(stats.pending) || 0,
          items
        });
      });
  }, []);
  if (data === null) return <Loading />;
  if (failed) return <NotConfigured link="/integrations" hint="Площадки настраиваются в интеграциях" />;
  const now = Date.now();
  const rows = (data.items || []).filter((p) => {
    if (!p.application_deadline) return false;
    return new Date(p.application_deadline).getTime() > now;
  }).slice(0, 4);
  return (
    <div>
      <div className="bw-pa-kpi">
        <div className="bw-pa-kpi-cell">
          <div className="bw-kpi-val-sm c-info">{data.total}</div>
          <div className="bw-pt-lbl">Всего</div>
        </div>
        <div className="bw-pa-kpi-cell">
          <div className="bw-kpi-val-sm c-ok">{data.completed}</div>
          <div className="bw-pt-lbl">Разобрано</div>
        </div>
        <div className="bw-pa-kpi-cell">
          <div className="bw-kpi-val-sm c-amber">{data.pending}</div>
          <div className="bw-pt-lbl">Ожидают</div>
        </div>
      </div>
      {rows.length === 0 && data.total === 0 && <Empty icon="✓" text="Новых тендеров нет" />}
      {rows.length > 0 && (
        <div className="bw-pa-list">
          {rows.map((t) => {
            const daysLeft = Math.ceil((new Date(t.application_deadline).getTime() - now) / 86400000);
            const dotCls = daysLeft <= 2 ? 'bw-pa-dot--err' : daysLeft <= 5 ? 'bw-pa-dot--amber' : 'bw-pa-dot--ok';
            const daysCls = daysLeft <= 2 ? 'c-err' : daysLeft <= 5 ? 'c-amber' : 'c-ok';
            return (
              <div key={t.id} className="bw-pa-row">
                <span className={`bw-pa-dot ${dotCls}`} />
                <span className="bw-pa-name">{t.customer_name || t.purchase_number || '—'}</span>
                <span className={`bw-pa-days ${daysCls}`}>{daysLeft}д</span>
              </div>
            );
          })}
        </div>
      )}
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
 *   Эталон vanilla: public/assets/js/custom_dashboard.js:1368 (MAILBOX_ROLES).
 * ═══════════════════════════════════════════════════════════════════════ */
const MAILBOX_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
export function MyMail({ user }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api('/api/my-mail/stats')
      .then(async (stats) => {
        if (!stats?.configured) {
          // Личной почты нет — общий ящик /api/mailbox/stats только для ADMIN/DIRECTOR
          if (!MAILBOX_ROLES.includes(user && user.role)) {
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
  const mountedRef = useRef(true);
  const load = () => {
    Promise.all([
      api('/api/office-academy/stats').catch(() => null),
      api('/api/office-academy/lessons').catch(() => null)
    ])
      .then(([stats, lessons]) => {
        if (!mountedRef.current) return;
        if (!stats && !lessons) { setFailed(true); setData({}); return; }
        const total = Number(lessons?.total) || 0;
        const completed = Number(stats?.lessons_passed ?? lessons?.passed) || 0;
        const xp = Number(stats?.total_xp ?? lessons?.total_xp) || 0;
        const rank = stats?.rank || lessons?.rank || null;
        const streak = Number(stats?.streak) || 0;
        const mandatoryPending = Number(lessons?.mandatory_pending) || 0;
        // Первый непройденный обязательный урок
        const firstMandatory = (lessons?.lessons || []).find((l) => l.is_mandatory && !l.passed) || null;
        setData({ completed, total, xp, rank, streak, mandatoryPending, firstMandatory });
      })
      .catch(() => { if (mountedRef.current) { setFailed(true); setData({}); } });
  };
  useEffect(() => {
    mountedRef.current = true;
    load();
    // Авто-обновление каждые 60c + при возврате на вкладку (паритет vanilla)
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 60000);
    const visHandler = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', visHandler);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', visHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
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
        <div className="bw-ac-mandatory">
          <span className="bw-ac-mandatory-icon">⚠️</span>
          <div className="bw-ac-mandatory-main">
            <div className="bw-ac-mandatory-count">
              {data.mandatoryPending} обязательн{data.mandatoryPending === 1 ? 'ый свиток' : data.mandatoryPending < 5 ? 'ых свитка' : 'ых свитков'}
            </div>
            {data.firstMandatory && (
              <div className="bw-ac-mandatory-title">
                {data.firstMandatory.cover_icon || '📜'} {data.firstMandatory.title}
              </div>
            )}
          </div>
        </div>
      )}
      <Link to="/office-academy" className="widget-link">Продолжить →</Link>
    </div>
  );
}
