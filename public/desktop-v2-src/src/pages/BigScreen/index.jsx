/**
 * Страница /big-screen — Big Screen / Command Center.
 *
 * Полноэкранная презентация KPI компании для офисного монитора/ТВ.
 * 9 слайдов, авто-ротация каждые 60 секунд, живое обновление данных каждые 5 минут.
 * Управление: ← → / Пробел / ESC, клик по индикаторам.
 *
 * Источник: vanilla `public/assets/js/big_screen.js` (~772 строки).
 *
 * Endpoints:
 *  - GET /api/tenders?limit=2000
 *  - GET /api/works?limit=2000
 *  - GET /api/users?limit=500
 *  - GET /api/data/employees, /api/data/cash_requests, /api/data/permits, /api/data/permit_types
 *  - GET /api/pre-tenders/stats
 *  - GET /api/equipment/balance-value
 *  - GET /api/works/analytics/team
 *  - GET /api/work-readiness/summary?ids=...
 */
import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
// 23.06.2026 BUG-FIX (Sites D-M10/D-M11): CLOSED_WORK/PREP — из единого helpers/work-status.
import { CLOSED_WORK, isClosedWork, PREP_STATUSES } from '@/helpers/work-status';
import './big-screen.css';

const ALLOWED = ['ADMIN', 'DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV', 'HEAD_TO', 'HEAD_PM'];
const SLIDE_INTERVAL = 60_000;
const DATA_REFRESH = 300_000;

function esc(s) {
  return String(s ?? '');
}

function money(n) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(n) || 0) + ' ₽';
}

function shortNum(x) {
  const n = Number(x) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' млрд';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return n.toFixed(0);
}

function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
function daysFrom(d) { return Math.round((new Date() - new Date(d)) / 86400000); }

export default function BigScreenPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [current, setCurrent] = useState(0);
  const [clock, setClock] = useState(new Date());
  const [progress, setProgress] = useState(0);
  const progressStartRef = useRef(Date.now());
  const rafRef = useRef(null);

  // Access control
  useEffect(() => {
    if (!user) return;
    if (!ALLOWED.includes(user.role)) {
      toast.error('Big Screen доступен руководителям');
      navigate('/home', { replace: true });
    }
  }, [user, navigate]);

  // Add body class for fullscreen
  useEffect(() => {
    document.body.classList.add('bs-fullscreen');
    return () => document.body.classList.remove('bs-fullscreen');
  }, []);

  // Clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Data loader
  const loadData = useCallback(async () => {
    try {
      const [
        tendersR, worksR, usersR, employeesR, cashR, permitsR, permitTypesR,
        preTendersR, eqValueR, teamAnalyticsR
      ] = await Promise.all([
        api('/api/tenders?limit=2000').catch(() => ({})),
        api('/api/works?limit=2000').catch(() => ({})),
        api('/api/users?limit=500').catch(() => ({})),
        api('/api/data/employees').catch(() => ({})),
        api('/api/data/cash_requests').catch(() => ({})),
        api('/api/data/permits').catch(() => ({})),
        api('/api/data/permit_types').catch(() => ({})),
        api('/api/pre-tenders/stats').catch(() => ({})),
        api('/api/equipment/balance-value').catch(() => ({})),
        api('/api/works/analytics/team').catch(() => ({}))
      ]);

      const tenders = tendersR.tenders || tendersR.items || (Array.isArray(tendersR) ? tendersR : []);
      const works = worksR.works || worksR.items || (Array.isArray(worksR) ? worksR : []);
      const users = usersR.users || usersR.items || (Array.isArray(usersR) ? usersR : []);
      const employees = employeesR.items || employeesR.employees || (Array.isArray(employeesR) ? employeesR : []);
      const cash = cashR.items || cashR.cash_requests || (Array.isArray(cashR) ? cashR : []);
      const permits = permitsR.items || permitsR.permits || (Array.isArray(permitsR) ? permitsR : []);
      const permitTypes = permitTypesR.items || permitTypesR.permit_types || (Array.isArray(permitTypesR) ? permitTypesR : []);

      // Готовность работ в подготовке
      let readiness = {};
      const prepWorks = works.filter((w) => PREP_STATUSES.includes(w.work_status));
      const prepIds = prepWorks.map((w) => w.id).slice(0, 200);
      if (prepIds.length) {
        try {
          const r = await api('/api/work-readiness/summary?ids=' + prepIds.join(','));
          readiness = r || {};
        } catch { /* ignore */ }
      }

      setData({
        tenders, works, users, employees, cash, permits, permitTypes,
        preTenderStats: preTendersR.success ? preTendersR : {},
        equipmentStats: eqValueR.success ? eqValueR : {},
        teamAnalytics: teamAnalyticsR.team ? teamAnalyticsR : {},
        readiness,
        y: new Date().getFullYear(),
        now: new Date()
      });
    } catch (e) {
      toast.error(`Ошибка загрузки: ${e?.message || e}`);
    }
  }, []);

  useEffect(() => {
    if (!user || !ALLOWED.includes(user.role)) return;
    loadData();
    // G-2 performance: пауза polling когда вкладка скрыта (~10 параллельных API).
    // Сохраняем kiosk-режим: пропустили цикл — обновим при visibilitychange:visible.
    const id = setInterval(() => { if (!document.hidden) loadData(); }, DATA_REFRESH);
    const onVis = () => { if (!document.hidden) loadData(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user, loadData]);

  // Build slides
  const slides = useMemo(() => {
    if (!data || !data.tenders) return [];
    return [
      slideKPI(data),
      slideFinance(data),
      slideFunnel(data),
      slidePreparation(data),
      slidePM(data),
      slideActiveWorks(data),
      slideOverdue(data),
      slideTeamAndPermits(data),
      slidePreTendersAndEquipment(data)
    ];
  }, [data]);

  // Auto-rotation
  useEffect(() => {
    if (slides.length === 0) return;
    progressStartRef.current = Date.now();
    const id = setInterval(() => {
      setCurrent((c) => (c + 1) % slides.length);
      progressStartRef.current = Date.now();
    }, SLIDE_INTERVAL);
    return () => clearInterval(id);
  }, [slides.length]);

  // Progress bar
  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - progressStartRef.current;
      setProgress(Math.min((elapsed / SLIDE_INTERVAL) * 100, 100));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Keyboard control
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        navigate('/home');
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        setCurrent((c) => (c + 1) % Math.max(slides.length, 1));
        progressStartRef.current = Date.now();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrent((c) => (c - 1 + Math.max(slides.length, 1)) % Math.max(slides.length, 1));
        progressStartRef.current = Date.now();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [navigate, slides.length]);

  const goPrev = () => {
    setCurrent((c) => (c - 1 + Math.max(slides.length, 1)) % Math.max(slides.length, 1));
    progressStartRef.current = Date.now();
  };
  const goNext = () => {
    setCurrent((c) => (c + 1) % Math.max(slides.length, 1));
    progressStartRef.current = Date.now();
  };
  const goTo = (idx) => {
    setCurrent(idx);
    progressStartRef.current = Date.now();
  };

  if (!user || !ALLOWED.includes(user.role)) return null;

  const currentSlide = slides[current];

  return (
    <div className="bs">
      <div className="bs-hdr">
        <div className="bs-brand">
          <img
            src={import.meta.env.BASE_URL + 'assets/img/asgard_emblem.png'}
            alt="АСГАРД-СЕРВИС"
            className="bs-brand-img"
            onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'grid'; }}
          />
          <div className="bs-brand-icon u-hidden">⚒</div>
          <div>
            <div className="bs-brand-name">АСГАРД-СЕРВИС</div>
            <div className="bs-brand-sub">COMMAND CENTER</div>
          </div>
        </div>
        <div className="bs-hdr-spacer" />
        <div className="bs-clock">
          <div className="bs-clock-time">{clock.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
          <div className="bs-clock-date">{clock.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
        <button className="bs-exit" onClick={() => navigate('/home')} title="Выход (ESC)">✕</button>
      </div>

      <div className="bs-body">
        <div className="bs-slide" key={current}>
          {data === null ? (
            <div className="bs-msg">Загрузка данных…</div>
          ) : currentSlide ? (
            currentSlide
          ) : (
            <div className="bs-msg">Нет данных для отображения</div>
          )}
        </div>
      </div>

      <div className="bs-foot">
        <button className="bs-nav-btn" onClick={goPrev} title="Назад (←)">‹</button>
        <div className="bs-dots">
          {slides.map((_, i) => (
            <div
              key={i}
              className={'bs-dot' + (i === current ? ' active' : '')}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
        <button className="bs-nav-btn" onClick={goNext} title="Вперёд (→)">›</button>
        <div className="bs-page">{current + 1} / {Math.max(slides.length, 1)}</div>
      </div>

      <div className="bs-progress" style={{ width: progress + '%' }} />
    </div>
  );
}

/* ─── Slides ─── */

function slideKPI(d) {
  const yT = d.tenders.filter((t) => String(t.year) === String(d.y) || (t.period || '').startsWith(String(d.y)));
  const won = yT.filter((t) => t.tender_status === 'Выиграли').length;
  const yW = d.works.filter((w) => {
    const dt = w.start_fact || w.start_plan || w.start_in_work_date || w.created_at;
    return dt && new Date(dt).getFullYear() === d.y;
  });
  const revenue = yW.reduce((s, w) => s + (Number(w.contract_value) || 0), 0);
  const done = yW.filter((w) => isClosedWork(w.work_status)).length;
  const active = yW.filter((w) => !isClosedWork(w.work_status)).length;
  const overdue = yW.filter((w) => w.end_plan && !isClosedWork(w.work_status) && new Date(w.end_plan) < d.now).length;
  const teamActive = d.users.filter((u) => u.is_active).length;
  const conv = pct(won, yT.length);

  return (
    <>
      <SlideTitle title={`Ключевые показатели ${d.y}`} subtitle="Обзор деятельности компании" />
      <div className="bs-kpi">
        <KpiBigCard tone="blue" label="Тендеров" value={yT.length} sub={<>Выиграно: <b className="c-ok">{won}</b></>} />
        <KpiBigCard tone="green" label="Конверсия" value={conv + '%'} sub={`${won} из ${yT.length} тендеров`} />
        <KpiBigCard tone="gold" label="Выручка" value={shortNum(revenue)} sub={money(revenue)} />
        <KpiBigCard tone="purple" label="Работы" value={active} sub={<>Сдано: <b className="c-ok">{done}</b> · Просрочено: <b className={overdue ? 'c-err' : 'c-ok'}>{overdue}</b></>} />
      </div>
      <div className="bs-kpi bs-mt-24">
        <KpiBigCard tone="cyan" label="Команда" value={teamActive} sub="активных сотрудников" />
        <KpiBigCard tone="amber" label="Заявки" value={(d.preTenderStats.total_new || 0) + (d.preTenderStats.total_in_review || 0)} sub="ожидают решения" />
        <KpiBigCard tone="pink" label="Касса" value={d.cash.filter((c) => ['requested', 'approved'].includes(c.status)).length} sub="заявок в обработке" />
        <KpiBigCard tone="red" label="Допуски" value={d.permits.filter((p) => p.expiry_date && daysFrom(p.expiry_date) > -30 && daysFrom(p.expiry_date) < 0).length} sub="истекают в 30 дней" />
      </div>
    </>
  );
}

function slideFinance(d) {
  const yW = d.works.filter((w) => {
    const dt = w.start_fact || w.start_plan || w.start_in_work_date || w.created_at;
    return dt && new Date(dt).getFullYear() === d.y;
  });
  const contractTotal = yW.reduce((s, w) => s + (Number(w.contract_value) || 0), 0);
  const received = yW.reduce((s, w) => s + (Number(w.balance_received) || 0) + (Number(w.advance_received) || 0), 0);
  const advanceTotal = yW.reduce((s, w) => s + (Number(w.advance_received) || 0), 0);
  const balanceTotal = yW.reduce((s, w) => s + (Number(w.balance_received) || 0), 0);
  const receivedPct = pct(received, contractTotal);
  const cashOut = d.cash.filter((c) => ['received', 'reporting'].includes(c.status)).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const cashPending = d.cash.filter((c) => ['requested', 'approved'].includes(c.status)).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const eqVal = d.equipmentStats.total_book_value || 0;
  const eqPurch = d.equipmentStats.total_purchase_price || 0;

  return (
    <>
      <SlideTitle title={`Финансовая сводка ${d.y}`} subtitle="Контракты, поступления, касса, активы" />
      <div className="bs-kpi">
        <KpiBigCard tone="gold" label="Сумма контрактов" value={shortNum(contractTotal)} sub={money(contractTotal)} />
        <KpiBigCard tone="green" label="Получено" value={shortNum(received)} sub={`${receivedPct}% от контрактов`} />
        <KpiBigCard tone="blue" label="Авансы / Баланс" value={shortNum(advanceTotal)} sub={`Баланс: ${money(balanceTotal)}`} />
        <KpiBigCard tone="purple" label="Активы (ТМЦ)" value={shortNum(eqVal)} sub={`Закупка: ${money(eqPurch)}`} />
      </div>
      <div className="bs-kpi bs-mt-24">
        <div className="bs-kpi-card c-amber bs-kpi-card--span-2">
          <div className="bs-kpi-lbl">Касса: выдано (не закрыто)</div>
          <div className="bs-kpi-val c-amber">{money(cashOut)}</div>
          <div className="bs-kpi-sub">Ожидает выдачи: {money(cashPending)}</div>
        </div>
        <div className="bs-kpi-card c-cyan bs-kpi-card--span-2">
          <div className="bs-kpi-lbl">Собираемость</div>
          <Ring value={receivedPct} size={120} label="собрано" />
          <div className="bs-kpi-sub bs-kpi-sub-ring">Получено {money(received)} из {money(contractTotal)}</div>
        </div>
      </div>
    </>
  );
}

function slideFunnel(d) {
  const yT = d.tenders.filter((t) => String(t.year) === String(d.y) || (t.period || '').startsWith(String(d.y)));
  const stages = [
    { name: 'Новый', statuses: ['Новый', 'На анализе'], color: 'var(--t-2)' },
    { name: 'На просчёте', statuses: ['Отправлено на просчёт'], color: 'var(--info)' },
    { name: 'Согласование', statuses: ['Согласование ТКП'], color: 'var(--amber)' },
    { name: 'Согласовано', statuses: ['ТКП согласовано'], color: 'var(--ok)' },
    { name: 'ТКП готово', statuses: ['Готово к отправке КП'], color: 'var(--gold)' },
    { name: 'КП отправлено', statuses: ['КП отправлено'], color: 'var(--purple)' },
    { name: 'Выиграли', statuses: ['Выиграли'], color: 'var(--ok)' },
    { name: 'Проиграли', statuses: ['Проиграли'], color: 'var(--err)' }
  ];
  const rows = stages.map((s) => ({ ...s, count: yT.filter((t) => s.statuses.includes(t.tender_status)).length }));
  const max = Math.max(...rows.map((s) => s.count), 1);

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(d.now.getFullYear(), d.now.getMonth() - i, 1);
    const key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
    const label = dt.toLocaleDateString('ru-RU', { month: 'short' });
    const mT = d.tenders.filter((t) => (t.period || '').startsWith(key) || (t.created_at || '').startsWith(key));
    const mWon = mT.filter((t) => t.tender_status === 'Выиграли').length;
    months.push({ label, total: mT.length, won: mWon });
  }
  const mMax = Math.max(...months.map((m) => m.total), 1);

  return (
    <>
      <SlideTitle title={`Воронка тендеров ${d.y}`} subtitle={`Все тендеры: ${yT.length}`} />
      <div className="bs-cols">
        <div>
          <div className="bs-col-title">По стадиям</div>
          {rows.map((s, i) => (
            <div key={i} className="bs-bar">
              <div className="bs-bar-lbl">{s.name}</div>
              <div className="bs-bar-track">
                <div className="bs-bar-fill" style={{ width: Math.round((s.count / max) * 100) + '%', background: s.color }}>{s.count > 0 ? s.count : ''}</div>
              </div>
              <div className="bs-bar-val" style={{ color: s.color }}>{s.count}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="bs-col-title">Динамика (6 мес.)</div>
          <div className="bs-funnel-chart">
            {months.map((m, i) => {
              const h = (m.total / mMax) * 100;
              const wonH = (m.won / mMax) * 100;
              return (
                <div key={i} className="bs-funnel-col">
                  <div className="bs-funnel-col-bar-box">
                    <div className="bs-funnel-bar" style={{ height: h + '%' }}>
                      <div className="bs-funnel-bar-won" style={{ height: (h > 0 ? (wonH / h) * 100 : 0) + '%' }} />
                    </div>
                  </div>
                  <div className="bs-funnel-month">{m.label}</div>
                  <div className="bs-funnel-counts"><b>{m.total}</b> · <span className="c-ok">{m.won}</span></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function slidePreparation(d) {
  const summary = d.readiness || {};
  const prep = (d.works || [])
    .filter((w) => PREP_STATUSES.includes(w.work_status))
    .map((w) => ({ w, s: summary[w.id] }))
    .filter((x) => x.s)
    .sort((a, b) => (a.s.overall_percent || 0) - (b.s.overall_percent || 0));

  if (!prep.length) {
    return (
      <>
        <SlideTitle title="Подготовка проектов" subtitle="Готовность работ к старту" />
        <div className="bs-prep-empty">
          <div className="bs-prep-empty-icon">🎉</div>
          <div className="bs-prep-empty-text">Нет проектов в подготовке</div>
        </div>
      </>
    );
  }

  const userMap = new Map((d.users || []).map((u) => [u.id, u]));
  const avg = Math.round(prep.reduce((s, x) => s + (x.s.overall_percent || 0), 0) / prep.length);
  const hot = prep.filter((x) => {
    const dl = x.s.start_plan ? Math.round((new Date(x.s.start_plan) - d.now) / 86400000) : null;
    return (x.s.overall_percent || 0) < 60 && dl != null && dl <= 14;
  }).length;

  return (
    <>
      <SlideTitle
        title="Подготовка проектов"
        subtitle={<>Готовность {prep.length} работ к старту · средняя {avg}%{hot ? <> · <span className="c-err">{hot} горящих</span></> : null}</>}
      />
      <div className="bs-prep-grid">
        {prep.slice(0, 8).map(({ w, s }, i) => {
          const pctValue = s.overall_percent || 0;
          const pm = userMap.get(w.pm_id);
          const dl = s.start_plan ? Math.round((new Date(s.start_plan) - d.now) / 86400000) : null;
          return (
            <div key={i} className="bs-prep-card">
              <Ring value={pctValue} size={96} />
              <div className="bs-prep-name" title={esc(w.work_title || '')}>{esc(w.work_title || w.customer_name || ('Работа #' + w.id))}</div>
              <div className="bs-prep-sub">{pm ? (pm.name || pm.login || '') : ''}</div>
              <div className="bs-prep-meta">
                {(s.stages_done || 0)}/{(s.stages_total || 0)} этапов
                {s.blocker_label && <span className="bs-prep-hot">⚠ {esc(s.blocker_label)}</span>}
              </div>
              <div className="bs-prep-dl">
                {dl == null ? '' : (dl < 0 ? <span className="bs-prep-dl-err">старт −{Math.abs(dl)}д</span> : `до старта ${dl}д`)}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function slidePM(d) {
  const pmRoles = new Set(['PM', 'HEAD_PM', 'DIRECTOR_DEV', 'DIRECTOR_GEN', 'CHIEF_ENGINEER', 'HR']);
  const pmIds = new Set(d.works.filter((w) => w.pm_id).map((w) => w.pm_id));
  const pms = d.users.filter((u) => u.is_active && (pmRoles.has(u.role) || pmIds.has(u.id)));
  const rows = pms.map((pm) => {
    const pw = d.works.filter((w) => w.pm_id === pm.id);
    const active = pw.filter((w) => !isClosedWork(w.work_status)).length;
    const completed = pw.filter((w) => isClosedWork(w.work_status)).length;
    const overdue = pw.filter((w) => w.end_plan && !isClosedWork(w.work_status) && new Date(w.end_plan) < d.now).length;
    const contract = pw.reduce((s, w) => s + (Number(w.contract_value) || 0), 0);
    return { name: pm.name, active, completed, overdue, total: pw.length, contract };
  }).sort((a, b) => b.contract - a.contract).slice(0, 10);

  if (!rows.length) {
    return (
      <>
        <SlideTitle title="Руководители проектов" />
        <div className="bs-no-data">Нет данных</div>
      </>
    );
  }

  return (
    <>
      <SlideTitle title="Руководители проектов" subtitle="Загрузка и результативность" />
      <table className="bs-tbl">
        <thead>
          <tr>
            <th>#</th><th>РП</th><th>Активные</th><th>Сдано</th><th>Просрочено</th><th>Всего</th><th>Сумма контрактов</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="rank">{i + 1}</td>
              <td className="fw-700">{esc(r.name)}</td>
              <td className="c-amber bs-tbl-fw-7">{r.active}</td>
              <td className="c-ok">{r.completed}</td>
              <td className={r.overdue ? 'c-err fw-700' : 'c-ok'}>{r.overdue}</td>
              <td>{r.total}</td>
              <td className="highlight">{money(r.contract)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function slideActiveWorks(d) {
  const byPm = new Map(d.users.map((u) => [u.id, u.name]));
  const activeW = d.works.filter((w) => !isClosedWork(w.work_status))
    .sort((a, b) => (Number(b.contract_value) || 0) - (Number(a.contract_value) || 0))
    .slice(0, 10);

  const statusColors = {
    'В работе': 'var(--ok)',
    'Мобилизация': 'var(--info)',
    'Подготовка': 'var(--purple)',
    'На паузе': 'var(--amber)',
    'Подписание акта': 'var(--cyan)'
  };

  return (
    <>
      <SlideTitle title="Активные работы" subtitle={`Топ ${activeW.length} по сумме контракта`} />
      <table className="bs-tbl">
        <thead>
          <tr>
            <th>#</th><th>Работа</th><th>Заказчик</th><th>РП</th><th>Статус</th><th>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {activeW.map((w, i) => {
            const sc = statusColors[w.work_status] || 'var(--t-2)';
            return (
              <tr key={i}>
                <td className="rank">{i + 1}</td>
                <td className="bs-tbl-fw-6 bs-tbl-cell--col-300">{esc(w.work_title || '')}</td>
                <td className="bs-tbl-cell--col-200">{esc(w.customer_name || '—')}</td>
                <td>{esc(byPm.get(w.pm_id) || '—')}</td>
                <td><span className="bs-status" style={{ background: sc }} />{esc(w.work_status)}</td>
                <td className="highlight">{money(Number(w.contract_value) || 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function slideOverdue(d) {
  const byPm = new Map(d.users.map((u) => [u.id, u.name]));
  const overdue = d.works.filter((w) => w.end_plan && !isClosedWork(w.work_status) && new Date(w.end_plan) < d.now)
    .sort((a, b) => new Date(a.end_plan) - new Date(b.end_plan))
    .slice(0, 10);

  if (!overdue.length) {
    return (
      <>
        <SlideTitle title="Контроль сроков" />
        <div className="bs-overdue-ok">
          <div className="bs-overdue-ok-icon">✅</div>
          <div className="bs-overdue-ok-text">Все работы в графике</div>
          <div className="bs-overdue-ok-sub">Просроченных работ нет</div>
        </div>
      </>
    );
  }

  return (
    <>
      <SlideTitle title="Просроченные работы" subtitle={`${overdue.length} работ требуют внимания`} titleColor="var(--err)" />
      <table className="bs-tbl">
        <thead>
          <tr>
            <th>#</th><th>Работа</th><th>Заказчик</th><th>РП</th><th>Дедлайн</th><th>Просрочка</th>
          </tr>
        </thead>
        <tbody>
          {overdue.map((w, i) => {
            const days = Math.round((d.now - new Date(w.end_plan)) / 86400000);
            const severity = days > 30 ? 'var(--err)' : 'var(--amber)';
            return (
              <tr key={i}>
                <td className="rank">{i + 1}</td>
                <td className="bs-tbl-fw-6">{esc(w.work_title || '')}</td>
                <td>{esc(w.customer_name || '—')}</td>
                <td>{esc(byPm.get(w.pm_id) || '—')}</td>
                <td>{new Date(w.end_plan).toLocaleDateString('ru-RU')}</td>
                <td className="bs-overdue-days" style={{ color: severity }}>+{days} дн.</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

const ROLE_NAMES = {
  ADMIN: 'Администратор', PM: 'Руководитель проекта', HEAD_PM: 'Глав. РП',
  TO: 'Тендерный отдел', HEAD_TO: 'Глав. ТО', HR: 'Кадры', HR_MANAGER: 'Директор по кадрам',
  BUH: 'Бухгалтерия', PROC: 'Снабжение', WAREHOUSE: 'Склад', CHIEF_ENGINEER: 'Главный инженер',
  OFFICE_MANAGER: 'Офис-менеджер', DIRECTOR_GEN: 'Ген. директор',
  DIRECTOR_COMM: 'Ком. директор', DIRECTOR_DEV: 'Тех. директор'
};

function slideTeamAndPermits(d) {
  const activeUsers = d.users.filter((u) => u.is_active && u.name && u.name.trim());
  const roleGroups = {};
  activeUsers.forEach((u) => { const r = u.role || 'Другое'; roleGroups[r] = (roleGroups[r] || 0) + 1; });
  const roleData = Object.entries(roleGroups).sort((a, b) => b[1] - a[1]);
  const maxRole = Math.max(...roleData.map((r) => r[1]), 1);

  const expiring = d.permits.filter((p) => {
    if (!p.expiry_date) return false;
    const days = Math.round((new Date(p.expiry_date) - d.now) / 86400000);
    return days >= 0 && days <= 60;
  }).sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date)).slice(0, 8);

  const empMap = new Map();
  (d.employees || []).forEach((e) => empMap.set(e.id, e.fio || e.full_name || ''));
  const ptMap = new Map();
  (d.permitTypes || []).forEach((t) => ptMap.set(t.id, t.name || ''));

  return (
    <>
      <SlideTitle title="Команда и допуски" subtitle={`${activeUsers.length} сотрудников · ${d.permits.length} допусков`} />
      <div className="bs-cols">
        <div>
          <div className="bs-col-title">Состав по ролям ({activeUsers.length})</div>
          {roleData.map(([role, count]) => (
            <div key={role} className="bs-bar">
              <div className="bs-bar-lbl">{ROLE_NAMES[role] || role}</div>
              <div className="bs-bar-track">
                <div className="bs-bar-fill" style={{ width: Math.round((count / maxRole) * 100) + '%', background: 'var(--info)' }}>{count}</div>
              </div>
              <div className="bs-bar-val c-info">{count}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="bs-col-title">Истекающие допуски (60 дней)</div>
          {expiring.length ? (
            <table className="bs-tbl">
              <thead>
                <tr><th>Сотрудник</th><th>Допуск</th><th>Осталось</th></tr>
              </thead>
              <tbody>
                {expiring.map((p, i) => {
                  const days = Math.round((new Date(p.expiry_date) - d.now) / 86400000);
                  const color = days <= 7 ? 'var(--err)' : days <= 21 ? 'var(--amber)' : 'var(--ok)';
                  const empName = empMap.get(p.employee_id) || p.employee_name || p.fio || '—';
                  const typeName = ptMap.get(p.type_id) || p.permit_type || p.category || '';
                  return (
                    <tr key={i}>
                      <td className="bs-tbl-fw-6">{esc(empName)}</td>
                      <td>{esc(typeName)}</td>
                      <td className="fw-700" style={{ color }}>{days} дн.</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="bs-team-empty">
              <div className="bs-team-empty-icon">✅</div>
              Все допуски в порядке
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function slidePreTendersAndEquipment(d) {
  const pt = d.preTenderStats;
  const eq = d.equipmentStats;
  const totalPT = (pt.total_new || 0) + (pt.total_in_review || 0) + (pt.total_need_docs || 0);
  const eqCount = eq.equipment_count || 0;
  const eqBook = eq.total_book_value || 0;
  const eqPurch = eq.total_purchase_price || 0;
  const eqDepr = eq.total_depreciation || 0;
  const deprecPct = eqPurch > 0 ? Math.round((eqDepr / eqPurch) * 100) : 0;

  const cashByStatus = {};
  d.cash.forEach((c) => { cashByStatus[c.status] = (cashByStatus[c.status] || 0) + 1; });
  const cashStatuses = [
    { key: 'requested', label: 'Запрошено', color: 'var(--info)' },
    { key: 'approved', label: 'Одобрено', color: 'var(--amber)' },
    { key: 'received', label: 'Получено', color: 'var(--ok)' },
    { key: 'reporting', label: 'Отчёт', color: 'var(--purple)' },
    { key: 'closed', label: 'Закрыто', color: 'var(--t-2)' }
  ];

  return (
    <>
      <SlideTitle title="Заявки, активы, касса" subtitle="Операционная сводка" />
      <div className="bs-kpi">
        <KpiBigCard tone="blue" label="Входящие заявки" value={totalPT} sub={`Новых: ${pt.total_new || 0} · На рассмотрении: ${pt.total_in_review || 0}`} />
        <KpiBigCard tone="green" label="Принято заявок" value={pt.total_accepted || 0} sub="стали тендерами" />
        <KpiBigCard tone="gold" label="ТМЦ на балансе" value={eqCount} sub={`Стоимость: ${money(eqBook)}`} />
        <KpiBigCard tone="purple" label="Амортизация" value={deprecPct + '%'} sub={`${money(eqDepr)} из ${money(eqPurch)}`} />
      </div>
      <div className="bs-mt-24">
        <div className="bs-col-title bs-col-title--center">Касса — статусы заявок</div>
        <div className="bs-cash-row">
          {cashStatuses.map((s) => (
            <div key={s.key} className="bs-cash-cell">
              <div className="bs-cash-val" style={{ color: s.color }}>{cashByStatus[s.key] || 0}</div>
              <div className="bs-cash-lbl">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ─── Small components ─── */

function SlideTitle({ title, subtitle, titleColor }) {
  return (
    <div className="bs-title">
      <h2 style={titleColor ? { color: titleColor } : undefined}>{title}</h2>
      {subtitle && <div className="bs-subtitle">{subtitle}</div>}
    </div>
  );
}

function KpiBigCard({ tone, label, value, sub }) {
  return (
    <div className={'bs-kpi-card c-' + tone}>
      <div className="bs-kpi-lbl">{label}</div>
      <div className={'bs-kpi-val c-' + tone}>{value}</div>
      <div className="bs-kpi-sub">{sub}</div>
    </div>
  );
}

function Ring({ value = 0, size = 100, label }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * (Math.min(100, Math.max(0, value)) / 100);
  const tone = value >= 80 ? 'var(--ok)' : value >= 50 ? 'var(--amber)' : 'var(--err)';
  return (
    <div className="bs-ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="bs-ring-svg">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--brd-1)" strokeWidth="9" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="9" strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
      </svg>
      <div className="bs-ring-inner">
        <div className="bs-ring-val" style={{ fontSize: size * 0.22 }}>{Math.round(value)}%</div>
        {label && <div className="bs-ring-lbl">{label}</div>}
      </div>
    </div>
  );
}
