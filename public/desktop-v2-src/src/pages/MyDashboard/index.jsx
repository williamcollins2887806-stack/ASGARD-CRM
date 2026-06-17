/**
 * Страница /my-dashboard — Дашборд РП (личный кабинет).
 *
 * Источник: vanilla `public/assets/js/dashboard.js` (PM-вид + блок звонков).
 *
 * Что показываем:
 *   - KPI по моим работам: всего/активные/завершённые/в подготовке
 *   - KPI по моим тендерам (где я responsible_pm/calc_user)
 *   - Мои финансы: на руках, потрачено, должен вернуть
 *   - Топ моих работ с прогрессом и маржой
 *   - Алерты: горящие дедлайны, проблемные
 *   - 📞 Звонки за последний отчёт — только для ADMIN/DIRECTOR_*
 *     (endpoint /api/call-reports/dashboard требует REPORT_ROLES; для PM/HEAD_PM
 *      backend вернёт 403 — виджет автоматически не рендерится).
 *
 * Endpoints:
 *   GET /api/works?pm_id=me
 *   GET /api/tenders?pm=me
 *   GET /api/payroll-dashboard/pm-balance/:pm_id
 *   GET /api/call-reports/dashboard            — звонки (vanilla dashboard.js:47)
 *
 * RBAC: PM, HEAD_PM, ADMIN, OFFICE_MANAGER, BUH, TO, HR, DIRECTOR_* (см. nav.config).
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import './my-dashboard.css';

// RBAC: vanilla dashboard.js / app.js NAV (строка 216) показывает /my-dashboard для
// ADMIN, PM, TO, HR, OFFICE_MANAGER, BUH, 3 DIR, 2 HEAD. Расширил до полного списка.
const ALLOWED = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'HR', 'HR_MANAGER', 'OFFICE_MANAGER', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
// Звонки доступны только ролям REPORT_ROLES (src/routes/call-reports.js:15).
// Для PM/HEAD_PM backend вернёт 403 → виджет молча скрывается.
const CALL_DASH_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
// Pre-tenders статистика осмысленна только для тендерного отдела.
const PRE_TENDERS_ROLES = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

function fmtMoney(n) {
  const x = Number(n) || 0;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(x) + ' ₽';
}
function shortMoney(n) {
  const x = Number(n) || 0;
  const abs = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + ' млрд ₽';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + ' млн ₽';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + ' тыс ₽';
  return fmtMoney(x);
}

const DONE_SET = new Set([
  'Закрыт', 'Закрыта', 'Закрыто', 'Работы сдали',
  'Завершена', 'Завершено', 'Завершен', 'Завершён',
  'Сдан', 'Сдана', 'Сдано',
  'Отменена', 'Отменено', 'Отменён', 'Отменен', 'Отмена'
].map((s) => s.trim().toLowerCase()));
const isDone = (s) => DONE_SET.has(String(s || '').trim().toLowerCase());
const PREP_SET = new Set(['Новая', 'Подготовка', 'Мобилизация']);

export default function MyDashboardPage() {
  const { user } = useAuth();

  const [works, setWorks] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [balance, setBalance] = useState(null);
  const [callDash, setCallDash] = useState(null);
  // 7 виджетов, восстановленных из vanilla custom_dashboard.js:
  const [readiness, setReadiness] = useState(null);     // /api/work-readiness?my=true — кольца готовности
  const [recentCalls, setRecentCalls] = useState([]);   // /api/telephony/calls?limit=5 — последние звонки
  const [cashBalance, setCashBalance] = useState(null); // /api/cash/my-balance — личный кассовый баланс
  const [todoTasks, setTodoTasks] = useState([]);       // /api/tasks/todo — мои задачи
  const [preTenderStats, setPreTenderStats] = useState(null); // /api/pre-tenders/stats — заявки ТО
  const [mailStats, setMailStats] = useState(null);     // /api/my-mail/stats — почта
  const [academyLessons, setAcademyLessons] = useState([]); // /api/office-academy/lessons — академия
  const [loading, setLoading] = useState(true);

  // RBAC inline-литералы для rbac-audit
  const _allowed = ALLOWED.includes(user?.role);
  // Видеть блок звонков может только REPORT_ROLES (см. CALL_DASH_ROLES выше).
  const _canSeeCalls = CALL_DASH_ROLES.includes(user?.role);
  const _canSeePreTenders = PRE_TENDERS_ROLES.includes(user?.role);

  const refresh = () => {
    if (!user?.id) return;
    setLoading(true);
    // Загружаем звонки только для REPORT_ROLES — иначе backend 403.
    const callDashPromise = _canSeeCalls
      ? api('/api/call-reports/dashboard').catch(() => null)
      : Promise.resolve(null);
    // Pre-tenders stats — только ТО/HEAD_TO/DIR.
    const preTendersPromise = _canSeePreTenders
      ? api('/api/pre-tenders/stats').catch(() => null)
      : Promise.resolve(null);
    Promise.all([
      api(`/api/works?pm_id=${user.id}&limit=2000`).then((d) => d.works || d.items || []).catch(() => []),
      api(`/api/tenders?pm=${user.id}&limit=2000`).then((d) => d.tenders || d.items || []).catch(() => []),
      api(`/api/payroll-dashboard/pm-balance/${user.id}`).catch(() => null),
      callDashPromise,
      // ↓ 7 виджетов из vanilla custom_dashboard.js — каждый с .catch чтобы failed endpoint не валил остальные.
      api('/api/work-readiness?my=true').then((d) => d?.items || []).catch(() => null),
      api('/api/telephony/calls?limit=5').then((d) => d?.items || d?.calls || []).catch(() => []),
      api('/api/cash/my-balance').catch(() => null),
      api('/api/tasks/todo').then((d) => d?.items || d?.tasks || []).catch(() => []),
      preTendersPromise,
      api('/api/my-mail/stats').catch(() => null),
      api('/api/office-academy/lessons').then((d) => d?.lessons || d?.items || []).catch(() => [])
    ])
      .then(([w, t, b, cd, rdy, rCalls, cB, todo, ptStats, mStats, acLessons]) => {
        setWorks(w); setTenders(t); setBalance(b); setCallDash(cd);
        setReadiness(rdy); setRecentCalls(rCalls); setCashBalance(cB);
        setTodoTasks(todo); setPreTenderStats(ptStats); setMailStats(mStats);
        setAcademyLessons(acLessons);
      })
      .catch((e) => toast.error('Не удалось загрузить данные: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    if (!_allowed) return;
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, _allowed]);

  const stats = useMemo(() => {
    const totalWorks = works.length;
    const activeWorks = works.filter((w) => !isDone(w.work_status)).length;
    const doneWorks = works.filter((w) => isDone(w.work_status)).length;
    const prepWorks = works.filter((w) => PREP_SET.has(w.work_status || '')).length;
    const problemWorks = works.filter((w) => w.work_status === 'Проблема').length;
    const contractSum = works.reduce((a, w) => a + (Number(w.contract_value) || 0), 0);
    const planSum = works.reduce((a, w) => a + (Number(w.cost_plan) || 0), 0);
    const factSum = works.reduce((a, w) => a + (Number(w.cost_fact) || 0), 0);
    const profit = contractSum - factSum;
    const tendersTotal = tenders.length;
    const tendersInWork = tenders.filter((t) => !['won', 'lost', 'cancelled', 'Выиграли', 'Проиграли', 'Отменено'].includes(t.tender_status)).length;
    return {
      totalWorks, activeWorks, doneWorks, prepWorks, problemWorks,
      contractSum, planSum, factSum, profit,
      tendersTotal, tendersInWork
    };
  }, [works, tenders]);

  // Топ-5 активных работ
  const topWorks = useMemo(() => {
    return works
      .filter((w) => !isDone(w.work_status))
      .slice()
      .sort((a, b) => (Number(b.contract_value) || 0) - (Number(a.contract_value) || 0))
      .slice(0, 5);
  }, [works]);

  // Горящие дедлайны (end_plan < +14 дней, ещё активные)
  const burningWorks = useMemo(() => {
    const now = Date.now();
    return works
      .filter((w) => !isDone(w.work_status) && w.end_plan)
      .map((w) => ({ w, days: Math.floor((new Date(w.end_plan).getTime() - now) / 86400000) }))
      .filter((x) => x.days <= 14)
      .sort((a, b) => a.days - b.days);
  }, [works]);

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !_allowed) {
    return (
      <AccessDenied
        allowed={ALLOWED}
        userRole={user.role}
        title="Дашборд РП недоступен"
        message="Личный дашборд показывает работы и финансы PM/HEAD_PM. Открыт также ADMIN."
      />
    );
  }

  return (
    <div className="mydash-wrap">
      <TopActionsBar
        kicker="Дашборд"
        title="Мой дашборд"
        subtitle={`${user?.name || 'РП'} · сегодня ${new Date().toLocaleDateString('ru-RU')}`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={() => { window.location.hash = '#/pm-works'; }}>📋 К моим работам</Btn>
            <Btn variant="primary" onClick={() => { window.location.hash = '#/cash'; }}>💵 Касса</Btn>
          </>
        }
      />

      {loading ? (
        <div className="card mydash-loading">⏳ Собираем дашборд…</div>
      ) : (
        <>
          {/* Алерты */}
          {(stats.problemWorks > 0 || burningWorks.length > 0) && (
            <div className="mydash-alerts">
              <div className="mydash-alerts-title">⚠️ Требует внимания</div>
              {stats.problemWorks > 0 && (
                <div className="mydash-alert-row">🔴 <b>{stats.problemWorks}</b> работ со статусом «Проблема»</div>
              )}
              {burningWorks.length > 0 && (
                <div className="mydash-alert-row">⏰ <b>{burningWorks.length}</b> работ с горящим дедлайном (≤14 дней)</div>
              )}
            </div>
          )}

          {/* KPI грид */}
          <div className="mydash-kpis">
            <Kpi label="Всего работ" value={stats.totalWorks} tone="default" />
            <Kpi label="Активные" value={stats.activeWorks} tone="info" />
            <Kpi label="В подготовке" value={stats.prepWorks} tone="amber" />
            <Kpi label="Завершены" value={stats.doneWorks} tone="ok" />
            <Kpi label="Контракты" value={shortMoney(stats.contractSum)} tone="gold" isText />
            <Kpi label="Прибыль (факт)" value={shortMoney(stats.profit)} tone={stats.profit >= 0 ? 'ok' : 'err'} isText />
            <Kpi label="Тендеры (все)" value={stats.tendersTotal} tone="default" />
            <Kpi label="Тендеры в работе" value={stats.tendersInWork} tone="purple" />
          </div>

          {/* Финансы */}
          {balance && (
            <div className="card mydash-section">
              <h3 className="mydash-section-title">💼 Мои финансы</h3>
              <div className="mydash-kpis mydash-kpis--narrow">
                <Kpi label="Получено" value={fmtMoney(balance.cash_in)} tone="ok" isText />
                <Kpi label="Потрачено" value={fmtMoney((Number(balance.expenses) || 0) + (Number(balance.salaries) || 0))} tone="err" isText />
                <Kpi label="Вернул в кассу" value={fmtMoney(balance.cash_returned)} tone="info" isText />
                <Kpi label="На руках" value={fmtMoney(balance.on_hands)} tone={(Number(balance.on_hands) || 0) >= 0 ? 'gold' : 'err'} isText />
              </div>
            </div>
          )}

          {/* Звонки — vanilla dashboard.js → блок «Звонки» (callDashData) */}
          {_canSeeCalls && callDash && callDash.stats && (
            <div
              className={'card mydash-section mydash-calls-card' + (callDash.unviewedReport ? ' mydash-calls-card--hot' : '')}
              onClick={() => { window.location.hash = '#/telephony?tab=analytics'; }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') window.location.hash = '#/telephony?tab=analytics'; }}
            >
              <div className="mydash-calls-head">
                <h3 className="mydash-section-title" style={{ margin: 0 }}>📞 Звонки (последний отчёт)</h3>
                <span className="mydash-calls-link">Открыть аналитику →</span>
              </div>
              <div className="mydash-kpis mydash-kpis--narrow">
                <Kpi label="Всего звонков" value={callDash.stats.totalCalls || 0} tone="info" />
                <Kpi label="Целевых" value={callDash.stats.targetCalls || 0} tone="ok" />
                <Kpi label="Пропущено" value={callDash.stats.missedCalls || 0} tone="err" />
                {Number(callDash.stats.avgDuration) > 0 && (
                  <Kpi
                    label="Сред. длит."
                    value={`${Math.round(Number(callDash.stats.avgDuration))} с`}
                    tone="purple"
                    isText
                  />
                )}
              </div>
              {callDash.unviewedReport && (
                <div className="mydash-calls-newrep">
                  📊 Новый отчёт: {callDash.unviewedReport.title || 'готов к просмотру'}
                </div>
              )}
              {callDash.stats.latestSummary && (
                <div className="mydash-calls-summary">
                  {String(callDash.stats.latestSummary).slice(0, 200)}
                  {String(callDash.stats.latestSummary).length > 200 ? '…' : ''}
                </div>
              )}
            </div>
          )}

          {/* ─── 7 виджетов из vanilla custom_dashboard.js ─── */}

          {/* 1. Кольца готовности работ — vanilla custom_dashboard.js:392 */}
          {Array.isArray(readiness) && readiness.length > 0 && (
            <div className="card mydash-section">
              <h3 className="mydash-section-title">🏁 Готовность работ в подготовке</h3>
              <div className="mydash-readiness">
                {readiness.slice(0, 6).map((it) => {
                  const overall = it?.readiness?.overall_percent ?? it?.overall_percent ?? 0;
                  const blocker = it?.readiness?.blocker || it?.blocker;
                  return (
                    <div
                      key={it.id}
                      className="mydash-rdy-row"
                      onClick={() => { window.location.hash = `#/pm-works?id=${it.id}`; }}
                      role="button" tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') window.location.hash = `#/pm-works?id=${it.id}`; }}
                    >
                      <div className="mydash-rdy-ring" style={{ background: `conic-gradient(var(--ok) 0% ${overall}%, var(--brd) ${overall}% 100%)` }}>
                        <span>{overall}%</span>
                      </div>
                      <div className="mydash-rdy-info">
                        <div className="mydash-rdy-title">{it.work_title || `Работа #${it.id}`}</div>
                        <div className="mydash-rdy-sub">{it.customer_name || ''}{blocker ? ` · блок: ${blocker}` : ''}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. Личный кассовый баланс — vanilla custom_dashboard.js:1105
              Backend src/routes/cash.js: {issued, spent, returned, balance, active_requests}. */}
          {cashBalance && (
            <div className="card mydash-section mydash-mini-section">
              <h3 className="mydash-section-title">💵 Касса (личный остаток)</h3>
              <div className="mydash-kpis mydash-kpis--narrow">
                <Kpi label="Остаток на руках" value={fmtMoney(cashBalance.balance ?? 0)} tone="gold" isText />
                <Kpi label="Выдано всего" value={fmtMoney(cashBalance.issued ?? 0)} tone="info" isText />
                <Kpi label="Потрачено" value={fmtMoney(cashBalance.spent ?? 0)} tone="err" isText />
                {cashBalance.active_requests != null && (
                  <Kpi label="Активных заявок" value={cashBalance.active_requests} tone="amber" />
                )}
              </div>
              <div className="mydash-w-link">
                <a href="#/cash">Открыть кассу →</a>
              </div>
            </div>
          )}

          {/* 3. Мои задачи — vanilla custom_dashboard.js:1176 */}
          {Array.isArray(todoTasks) && todoTasks.length > 0 && (
            <div className="card mydash-section mydash-mini-section">
              <h3 className="mydash-section-title">✅ Мои задачи ({todoTasks.length})</h3>
              <div className="mydash-todo">
                {todoTasks.slice(0, 5).map((t) => (
                  <div key={t.id}
                       className={'mydash-todo-row' + (t.priority === 'high' || t.priority === 'urgent' ? ' is-urgent' : '')}
                       onClick={() => { window.location.hash = '#/tasks'; }}
                       role="button" tabIndex={0}
                       onKeyDown={(e) => { if (e.key === 'Enter') window.location.hash = '#/tasks'; }}
                  >
                    <span className="mydash-todo-title">{t.title || t.name || '—'}</span>
                    {t.due_date && (
                      <span className="mydash-todo-due">{new Date(t.due_date).toLocaleDateString('ru-RU')}</span>
                    )}
                  </div>
                ))}
              </div>
              {todoTasks.length > 5 && (
                <div className="mydash-w-link"><a href="#/tasks">Все {todoTasks.length} →</a></div>
              )}
            </div>
          )}

          {/* 4. Pre-tenders статистика — vanilla custom_dashboard.js:1204 (только TO/HEAD_TO/DIR)
              Backend src/routes/pre_tenders.js: {total_new, total_in_review, total_need_docs, total_accepted, total_pending}. */}
          {_canSeePreTenders && preTenderStats && (
            <div className="card mydash-section mydash-mini-section">
              <h3 className="mydash-section-title">📨 Входящие заявки (ТО)</h3>
              <div className="mydash-kpis mydash-kpis--narrow">
                {preTenderStats.total_new != null && <Kpi label="Новые" value={preTenderStats.total_new} tone="amber" />}
                {preTenderStats.total_in_review != null && <Kpi label="На анализе" value={preTenderStats.total_in_review} tone="info" />}
                {preTenderStats.total_need_docs != null && <Kpi label="Нужны доки" value={preTenderStats.total_need_docs} tone="purple" />}
                {preTenderStats.total_accepted != null && <Kpi label="Принято" value={preTenderStats.total_accepted} tone="ok" />}
              </div>
              <div className="mydash-w-link"><a href="#/pre-tenders">Открыть → </a></div>
            </div>
          )}

          {/* 5. Почта (непрочитанные) — vanilla custom_dashboard.js:1349 */}
          {mailStats && (mailStats.unread != null || mailStats.total != null) && (
            <div className="card mydash-section mydash-mini-section">
              <h3 className="mydash-section-title">📬 Почта</h3>
              <div className="mydash-kpis mydash-kpis--narrow">
                {mailStats.unread != null && <Kpi label="Непрочитано" value={mailStats.unread} tone={mailStats.unread > 0 ? 'amber' : 'ok'} />}
                {mailStats.total != null && <Kpi label="Всего" value={mailStats.total} tone="default" />}
                {mailStats.with_ai_summary != null && <Kpi label="С AI-резюме" value={mailStats.with_ai_summary} tone="purple" />}
              </div>
              <div className="mydash-w-link"><a href="#/my-mail">Открыть почту →</a></div>
            </div>
          )}

          {/* 6. Академия Асгарда — vanilla custom_dashboard.js:1464 */}
          {Array.isArray(academyLessons) && academyLessons.length > 0 && (
            <div className="card mydash-section mydash-mini-section">
              <h3 className="mydash-section-title">📚 Академия Асгарда</h3>
              <div className="mydash-todo">
                {academyLessons.slice(0, 3).map((les) => (
                  <div key={les.id}
                       className={'mydash-todo-row' + (les.is_mandatory ? ' is-urgent' : '')}
                       onClick={() => { window.location.hash = '#/office-academy'; }}
                       role="button" tabIndex={0}
                       onKeyDown={(e) => { if (e.key === 'Enter') window.location.hash = '#/office-academy'; }}
                  >
                    <span className="mydash-todo-title">{les.title || '—'}</span>
                    <span className="mydash-todo-due">{les.is_completed ? '✓' : les.is_mandatory ? 'обяз.' : 'опц.'}</span>
                  </div>
                ))}
              </div>
              {academyLessons.length > 3 && (
                <div className="mydash-w-link"><a href="#/office-academy">Все {academyLessons.length} уроков →</a></div>
              )}
            </div>
          )}

          {/* 7. Последние звонки — vanilla custom_dashboard.js:704 */}
          {Array.isArray(recentCalls) && recentCalls.length > 0 && (
            <div className="card mydash-section mydash-mini-section">
              <h3 className="mydash-section-title">📞 Последние звонки</h3>
              <div className="mydash-todo">
                {recentCalls.slice(0, 5).map((c) => (
                  <div key={c.call_id || c.id}
                       className="mydash-todo-row"
                       onClick={() => { window.location.hash = '#/telephony'; }}
                       role="button" tabIndex={0}
                       onKeyDown={(e) => { if (e.key === 'Enter') window.location.hash = '#/telephony'; }}
                  >
                    <span className="mydash-todo-title">
                      {(c.caller_number || c.from_number || '—')} → {(c.called_number || c.to_number || '—')}
                    </span>
                    <span className="mydash-todo-due">
                      {c.created_at || c.call_time ? new Date(c.created_at || c.call_time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mydash-w-link"><a href="#/telephony">К полной истории →</a></div>
            </div>
          )}

          {/* Топ работ */}
          <div className="card mydash-section">
            <h3 className="mydash-section-title">🏗️ Топ активных работ</h3>
            {topWorks.length === 0 ? (
              <EmptyState icon="📭" title="Нет активных работ" hint="Здесь будут появляться твои контракты в работе." action={null} />
            ) : (
              <div className="mydash-top">
                {topWorks.map((w) => {
                  const margin = (Number(w.contract_value) || 0) - (Number(w.cost_fact) || 0);
                  const marginPct = (Number(w.contract_value) || 0) > 0
                    ? Math.round((margin / Number(w.contract_value)) * 100)
                    : null;
                  return (
                    <div
                      key={w.id}
                      onClick={() => { window.location.hash = `#/pm-works?id=${w.id}`; }}
                      className="mydash-top-row"
                    >
                      <div>
                        <div className="mydash-top-title">{w.work_title || w.tender_title || '—'}</div>
                        <div className="mydash-top-sub">{w.customer_name || ''} · {w.work_status || ''}</div>
                      </div>
                      <div className="mydash-top-r">
                        <div className="mydash-top-r-val">{shortMoney(w.contract_value)}</div>
                        <div className="mydash-top-r-lbl">контракт</div>
                      </div>
                      <div className="mydash-top-r">
                        <div
                          className="mydash-top-r-val"
                          style={{ color: marginPct == null ? 'var(--t-3)' : marginPct >= 0 ? 'var(--ok)' : 'var(--err)' }}
                        >
                          {marginPct == null ? '—' : `${marginPct}%`}
                        </div>
                        <div className="mydash-top-r-lbl">маржа</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Горящие */}
          {burningWorks.length > 0 && (
            <div className="card mydash-section">
              <h3 className="mydash-section-title mydash-section-title--err">🔥 Горящие дедлайны</h3>
              <div className="mydash-burn">
                {burningWorks.slice(0, 5).map((x) => (
                  <div
                    key={x.w.id}
                    onClick={() => { window.location.hash = `#/pm-works?id=${x.w.id}`; }}
                    className="mydash-burn-row"
                  >
                    <div>
                      <div className="mydash-burn-title">{x.w.work_title || x.w.tender_title || '—'}</div>
                      <div className="mydash-burn-sub">{new Date(x.w.end_plan).toLocaleDateString('ru-RU')} · {x.w.work_status || ''}</div>
                    </div>
                    <span
                      className="mydash-burn-pill"
                      style={{ background: x.days < 0 ? 'var(--err)' : x.days <= 3 ? 'var(--err)' : 'var(--amber)' }}
                    >
                      {x.days < 0 ? `просрочено ${-x.days}д` : x.days === 0 ? 'сегодня' : `осталось ${x.days}д`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, tone = 'default', isText = false }) {
  const colors = {
    default: 'var(--t-1)',
    ok: 'var(--ok)',
    info: 'var(--info)',
    amber: 'var(--amber)',
    err: 'var(--err)',
    gold: 'var(--gold)',
    purple: 'var(--purple)'
  };
  return (
    <div className="mydash-kpi">
      <div className="mydash-kpi-label">{label}</div>
      <div
        className={'mydash-kpi-value' + (isText ? ' mydash-kpi-value--text' : '')}
        style={{ color: colors[tone] }}
      >
        {value}
      </div>
    </div>
  );
}
