import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import {
  Activity, ChevronLeft, ChevronRight, FileText, Search, X,
} from 'lucide-react';
import { formatMoney, formatMoneyShort, formatDate, plural } from '@/lib/utils';
import './DirectorAnalytics.css';

/**
 * DirectorAnalytics — Jarl Pulse mobile parity.
 * Overview stack (Тендеры + Заявки + Работы + Команда) → реестр → fullscreen карточка.
 * API: /api/director-analytics/*
 */

const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];
const PAGE_SIZE = 25;

const PERIODS = [
  { id: 'month', label: 'Месяц' },
  { id: 'half_year', label: 'Полгода' },
  { id: 'year', label: 'Год' },
  { id: 'all', label: 'Всё' },
];

/** Локальный фильтр «Графика офиса» — не связан с чипами периода выше. */
const TEAM_SCOPES = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'year', label: 'Год' },
];

const TENDER_STATUSES = [
  { id: 'рассмотрение', label: 'Рассмотрение', tone: 'info' },
  { id: 'готовим', label: 'Готовим', tone: 'blue' },
  { id: 'подались', label: 'Подались', tone: 'warn' },
  { id: 'выиграли', label: 'Выиграли', tone: 'ok' },
  { id: 'проиграли', label: 'Проиграли', tone: 'err' },
  { id: 'отмена', label: 'Отмена', tone: 'muted' },
];

const APP_STATUSES = [
  { id: 'new', label: 'Новые', tone: 'warn' },
  { id: 'calc', label: 'Просчёт', tone: 'blue' },
  { id: 'approval', label: 'Согласование', tone: 'info' },
  { id: 'kp_prep', label: 'КП готов', tone: 'blue' },
  { id: 'sent', label: 'КП ушло', tone: 'info' },
  { id: 'addendum', label: 'Дозапрос', tone: 'warn' },
  { id: 'win', label: 'Выиграно', tone: 'ok' },
  { id: 'lose', label: 'Проиграно', tone: 'err' },
  { id: 'work', label: 'В работе', tone: 'ok' },
  { id: 'done', label: 'Завершено', tone: 'ok' },
  { id: 'trash', label: 'Корзина', tone: 'muted' },
];

const WORK_PHASES = [
  { id: 'active', label: 'Активные', tone: 'ok' },
  { id: 'pause', label: 'На паузе', tone: 'warn' },
  { id: 'archive', label: 'Архив', tone: 'muted' },
];

const APP_TONE = Object.fromEntries(APP_STATUSES.map((s) => [s.id, s.tone]));

const CHANNELS = {
  email: 'Почта', phone: 'Телефония', manual: 'Вручную',
  etp: 'Площадка', site: 'Сайт',
};

const TENDER_TABS = [
  { id: 'summary', label: 'Сводка' },
  { id: 'calc', label: 'Просчёт РП' },
  { id: 'estimate', label: 'Смета' },
  { id: 'checklist', label: 'Чек-лист' },
  { id: 'report', label: 'Отчёт РП' },
  { id: 'docs', label: 'Документы' },
];
const APP_TABS = [
  { id: 'summary', label: 'Сводка' },
  { id: 'estimate', label: 'Просчёт' },
  { id: 'history', label: 'История' },
  { id: 'docs', label: 'Документы' },
];
const WORK_TABS = [
  { id: 'summary', label: 'Сводка' },
  { id: 'finance', label: 'Финансы' },
  { id: 'timesheet', label: 'Табель' },
  { id: 'brigade', label: 'Бригада' },
  { id: 'checkins', label: 'Чекины' },
];

const CLOSED_APP = new Set(['win', 'lose', 'done', 'trash']);
const OPEN_REGISTRY = new Set(['рассмотрение', 'готовим', 'подались']);

function periodLabel(id) {
  return PERIODS.find((p) => p.id === id)?.label || id;
}

function hoursFmt(min) {
  if (min == null) return '—';
  const m = Math.abs(Math.round(Number(min)));
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

function hoursHuman(min) {
  if (min == null) return '—';
  const m = Math.abs(Math.round(Number(min)));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return (min < 0 ? '−' : '') + h + ' ч' + (mm ? ' ' + mm + ' мин' : '');
}

function daysLeftOf(deadline) {
  if (!deadline) return null;
  const end = new Date(deadline);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end - today) / 86400000);
}

function daysWord(n) {
  return plural(Math.abs(n || 0), 'день', 'дня', 'дней');
}

function dueFlag(deadline, closed) {
  if (closed || !deadline) return null;
  const d = daysLeftOf(deadline);
  if (d == null) return null;
  if (d < 0) return 'over';
  if (d === 0) return 'today';
  if (d <= 3) return 'soon';
  return null;
}

function dueChip(deadline, closed) {
  const f = dueFlag(deadline, closed);
  const d = daysLeftOf(deadline);
  if (!deadline) return null;
  if (closed) return { text: formatDate(deadline), cls: 'muted' };
  if (f === 'over') return { text: `−${Math.abs(d)} дн.`, cls: 'over' };
  if (f === 'today') return { text: 'сегодня', cls: 'today' };
  if (f === 'soon') return { text: `${d} дн.`, cls: 'soon' };
  if (d != null) return { text: formatDate(deadline), cls: '' };
  return { text: formatDate(deadline), cls: '' };
}

function statusesOf(section) {
  if (section === 'tenders') return TENDER_STATUSES;
  if (section === 'applications') return APP_STATUSES;
  return WORK_PHASES;
}

function statusMeta(section, id) {
  return statusesOf(section).find((s) => s.id === id) || null;
}

function itemDeadline(section, item) {
  if (section === 'tenders') return item?.docs_deadline || item?.deadline || null;
  if (section === 'applications') return item?.work_deadline || item?.deadline || null;
  return item?.end_plan || item?.deadline || null;
}

function itemAmount(section, item) {
  if (section === 'tenders') {
    return Number(item?.rp_review?.work_price ?? item?.work_price ?? item?.price ?? item?.nmck ?? 0) || 0;
  }
  if (section === 'applications') return Number(item?.estimated_sum ?? item?.amount ?? 0) || 0;
  return Number(item?.contract_value ?? item?.contract ?? 0) || 0;
}

function itemStatusId(section, item) {
  if (section === 'tenders') return item?.registry_status || item?.status;
  if (section === 'applications') return item?.status;
  return item?.bucket;
}

function itemTitle(section, item) {
  if (section === 'tenders') return item?.title || `Тендер #${item?.id}`;
  if (section === 'applications') {
    return item?.title || item?.work_description || item?.customer_name || `Заявка #${item?.id}`;
  }
  return item?.title || item?.object_name || `Работа #${item?.id}`;
}

function isClosed(section, item) {
  if (section === 'tenders') return !OPEN_REGISTRY.has(String(item?.registry_status || ''));
  if (section === 'applications') return CLOSED_APP.has(String(item?.status || ''));
  return item?.bucket === 'archive';
}

function normalizeEstimate(est) {
  if (!est) return null;
  const rows = est.rows || est.items || [];
  const totals = est.totals || {};
  const total = totals.total_no_vat != null ? totals.total_no_vat
    : (est.total_no_vat != null ? est.total_no_vat
      : (est.amount != null ? Number(est.amount) : null));
  const cost = totals.cost_total != null ? totals.cost_total
    : (est.cost_total != null ? est.cost_total
      : (est.cost != null ? Number(est.cost) : null));
  const marginPct = totals.margin_pct != null ? totals.margin_pct
    : (est.margin_pct != null ? est.margin_pct
      : (est.margin != null ? Number(est.margin) : null));
  const vat = totals.vat != null ? totals.vat
    : (est.vat != null ? est.vat : (total != null ? Math.round(total * 0.2) : null));
  const withVat = totals.total_with_vat != null ? totals.total_with_vat
    : (est.total_with_vat != null ? est.total_with_vat
      : (total != null && vat != null ? total + vat : null));
  const marginRub = totals.margin_rub != null ? totals.margin_rub
    : (est.margin_rub != null ? est.margin_rub
      : (total != null && cost != null ? total - cost : null));
  return {
    rows: (rows || []).map((r) => ({
      name: r?.name || r?.title || 'Позиция',
      unit: r?.unit || '',
      qty: r?.qty ?? r?.quantity ?? null,
      sum: r?.sum ?? r?.amount ?? null,
      cost: r?.cost ?? null,
      margin_pct: r?.margin_pct ?? r?.margin ?? null,
    })),
    total_no_vat: total,
    cost_total: cost,
    margin_pct: marginPct,
    margin_rub: marginRub,
    vat,
    total_with_vat: withVat,
  };
}

function normalizeChecklist(cl) {
  if (!cl) return [];
  if (Array.isArray(cl.items)) return cl.items;
  if (Array.isArray(cl)) return cl;
  const items = [];
  const answers = cl.answers;
  if (answers && typeof answers === 'object') {
    Object.keys(answers).forEach((k) => {
      const v = answers[k];
      const done = v === true || v === 'yes' || v === 'да' || v === 1 || v === '1';
      items.push({ text: String(k), done });
    });
  }
  return items;
}

function pct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${Math.round(Number(n) * 10) / 10} %`;
}

function EmptyHint({ children }) {
  return <div className="jp-empty">{children}</div>;
}

export default function DirectorAnalytics() {
  const user = useAuthStore((s) => s.user);
  const haptic = useHaptic();
  const role = user?.role || '';
  const allowed = DIRECTOR_ROLES.includes(role);

  const [period, setPeriod] = useState('month');
  const [view, setView] = useState('overview'); // overview | list
  const [listSection, setListSection] = useState(null);
  const [listStatus, setListStatus] = useState('all');
  const [listQuery, setListQuery] = useState('');
  const [listSort, setListSort] = useState('deadline');
  const [listPage, setListPage] = useState(1);

  const [overview, setOverview] = useState(null);
  const [tendersItems, setTendersItems] = useState([]);
  const [appsItems, setAppsItems] = useState([]);
  const [worksItems, setWorksItems] = useState([]);
  const [worksCounts, setWorksCounts] = useState({ active: 0, pause: 0, archive: 0 });
  const [teamHours, setTeamHours] = useState(null);
  const [teamScope, setTeamScope] = useState('month');
  const [teamAnchor, setTeamAnchor] = useState(null);

  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState('');

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailKind, setDetailKind] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState('summary');
  const [teamPerson, setTeamPerson] = useState(null);
  const periodHostRef = useRef(null);

  const morphPeriod = useCallback(() => {
    const host = periodHostRef.current;
    if (!host) return;
    const on = host.querySelector('.jp-period.is-on');
    if (!on) return;
    const hr = host.getBoundingClientRect();
    const r = on.getBoundingClientRect();
    host.style.setProperty('--morph-left', `${r.left - hr.left}px`);
    host.style.setProperty('--morph-width', `${r.width}px`);
  }, []);

  useEffect(() => {
    if (!allowed) return undefined;
    morphPeriod();
    const onResize = () => morphPeriod();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [allowed, period, morphPeriod, view]);

  const loadTeam = useCallback(async (scope, anchor) => {
    const s = TEAM_SCOPES.some((x) => x.id === scope) ? scope : 'month';
    const url = `/director-analytics/team-hours?period=${s}`
      + (anchor ? `&date=${anchor}` : '');
    const res = await api.get(url);
    setTeamHours(res);
    return res;
  }, []);

  const loadOverviewBundle = useCallback(async (p) => {
    const [ov, tenders, apps, works] = await Promise.all([
      api.get(`/director-analytics/overview?period=${p}`),
      api.get(`/director-analytics/tenders?period=${p}`).catch(() => ({ items: [] })),
      api.get(`/director-analytics/applications?period=${p}`).catch(() => ({ items: [] })),
      api.get('/director-analytics/works?bucket=all').catch(() => ({ items: [], counts: {} })),
    ]);
    setOverview(ov || null);
    setTendersItems(tenders?.items || []);
    setAppsItems(apps?.items || []);
    setWorksItems(works?.items || []);
    if (works?.counts) setWorksCounts(works.counts);
    return ov;
  }, []);

  // «График офиса» — отдельный контур: свой scope + якорь, независим от чипов выше.
  useEffect(() => {
    if (!allowed) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await loadTeam(teamScope, teamAnchor);
        if (cancelled) return;
        setTeamHours(res);
      } catch {
        if (!cancelled) setTeamHours(null);
      }
    })();
    return () => { cancelled = true; };
  }, [allowed, teamScope, teamAnchor, loadTeam]);


  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await loadOverviewBundle(period);
    } catch (e) {
      setError(e?.message || 'Не удалось загрузить аналитику');
    } finally {
      setLoading(false);
    }
  }, [period, loadOverviewBundle]);

  useEffect(() => {
    if (!allowed) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        await loadOverviewBundle(period);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Не удалось загрузить аналитику');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [allowed, period, loadOverviewBundle]);

  const openList = useCallback((section, status = 'all') => {
    haptic.light();
    setListSection(section);
    setListStatus(status || 'all');
    setListQuery('');
    setListSort('deadline');
    setListPage(1);
    setView('list');
    setListLoading(true);
    (async () => {
      try {
        if (section === 'tenders') {
          const res = await api.get(`/director-analytics/tenders?period=${period}`);
          setTendersItems(res?.items || []);
        } else if (section === 'applications') {
          const res = await api.get(`/director-analytics/applications?period=${period}`);
          setAppsItems(res?.items || []);
        } else {
          const res = await api.get('/director-analytics/works?bucket=all');
          setWorksItems(res?.items || []);
          if (res?.counts) setWorksCounts(res.counts);
        }
      } catch (e) {
        setError(e?.message || 'Не удалось загрузить реестр');
      } finally {
        setListLoading(false);
      }
    })();
  }, [haptic, period]);

  const backOverview = () => {
    haptic.light();
    setView('overview');
    setListSection(null);
    setDetailOpen(false);
  };

  const changePeriod = (id) => {
    if (id === period) return;
    haptic.light();
    setPeriod(id);
    setView('overview');
    setListSection(null);
    setDetailOpen(false);
  };

  const openDetail = async (kind, id) => {
    if (id == null) return;
    haptic.light();
    setDetailKind(kind);
    setDetailOpen(true);
    setDetail(null);
    setDetailTab('summary');
    setDetailLoading(true);
    try {
      const path =
        kind === 'tenders' ? `/director-analytics/tenders/${id}`
          : kind === 'applications' ? `/director-analytics/applications/${id}`
            : `/director-analytics/works/${id}`;
      const res = await api.get(path);
      setDetail(res);
    } catch (e) {
      setDetail({ _error: e?.message || 'Не удалось загрузить карточку' });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    haptic.light();
    setDetailOpen(false);
    setDetail(null);
  };

  const sourceItems = useCallback((section) => {
    if (section === 'tenders') return tendersItems || [];
    if (section === 'applications') return appsItems || [];
    return worksItems || [];
  }, [tendersItems, appsItems, worksItems]);

  const filteredList = useMemo(() => {
    if (!listSection) return [];
    const q = listQuery.trim().toLowerCase();
    let arr = sourceItems(listSection).slice();
    if (listStatus && listStatus !== 'all') {
      arr = arr.filter((x) => itemStatusId(listSection, x) === listStatus);
    }
    if (q) {
      arr = arr.filter((item) => {
        let hay = [];
        if (listSection === 'tenders') {
          hay = [item.title, item.customer_name, item.customer_inn, item.region,
            item.registry_status, item.pm?.name];
        } else if (listSection === 'applications') {
          hay = [item.title, item.work_description, item.customer_name, item.contact_person,
            item.status, item.ai_summary];
        } else {
          hay = [item.title, item.object_name, item.customer_name, item.city, item.pm?.name];
        }
        return hay.filter(Boolean).join(' ').toLowerCase().includes(q);
      });
    }
    arr.sort((a, b) => {
      if (listSort === 'sum') return itemAmount(listSection, b) - itemAmount(listSection, a);
      if (listSort === 'created') {
        return new Date(b.created_at || b.created || b.start || 0)
          - new Date(a.created_at || a.created || a.start || 0);
      }
      return new Date(itemDeadline(listSection, a) || 0) - new Date(itemDeadline(listSection, b) || 0);
    });
    return arr;
  }, [listSection, listStatus, listQuery, listSort, sourceItems]);

  const pageCount = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
  const safePage = Math.min(listPage, pageCount);
  const pageItems = filteredList.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const periodHint = useMemo(() => {
    const t = overview?.tenders?.total ?? '—';
    const a = overview?.applications?.total ?? '—';
    const w = overview?.works?.total ?? '—';
    return `${periodLabel(period)} · ${t} тенд. · ${a} заяв. · ${w} раб.`;
  }, [overview, period]);

  if (!allowed) return <Navigate to="/" replace />;

  return (
    <PageShell title="Пульс директора" subtitle={periodHint}>
      <PullToRefresh onRefresh={refresh}>
        <div className="jp-root">
          <div className="jp-eyebrow">Jarl Pulse</div>

          {view === 'overview' && (
            <>
              <div className="jp-periods" ref={periodHostRef}>
                {PERIODS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`jp-period spring-tap${period === p.id ? ' is-on' : ''}`}
                    onClick={() => changePeriod(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="jp-period-hint">{periodHint}</div>

              {loading ? (
                <SkeletonList count={6} />
              ) : error && !overview ? (
                <EmptyState
                  icon={Activity}
                  iconColor="var(--danger-ink)"
                  iconBg="color-mix(in srgb, var(--danger) 12%, transparent)"
                  title="Не удалось загрузить"
                  description={error}
                />
              ) : (
                <div className="jp-stack">
                  <BizSection
                    id="tenders"
                    title="Тендеры"
                    note="6 статусов реестра"
                    overview={overview?.tenders}
                    items={tendersItems}
                    onOpenList={openList}
                    onOpenDetail={(id) => openDetail('tenders', id)}
                  />
                  <BizSection
                    id="applications"
                    title="Заявки"
                    note="11 статусов канбана"
                    overview={overview?.applications}
                    items={appsItems}
                    onOpenList={openList}
                    onOpenDetail={(id) => openDetail('applications', id)}
                  />
                  <BizSection
                    id="works"
                    title="Работы"
                    note="Активные · пауза · архив"
                    overview={overview?.works}
                    items={worksItems}
                    worksCounts={worksCounts}
                    onOpenList={openList}
                    onOpenDetail={(id) => openDetail('works', id)}
                  />
                  <TeamSection
                    teamHours={teamHours}
                    period={period}
                    onOpenPerson={(p) => setTeamPerson(p)}
                    scope={teamScope}
                    onScope={(s) => { setTeamScope(s); setTeamAnchor(null); }}
                    onStep={(anchor) => anchor && setTeamAnchor(anchor)}
                    onCurrent={() => setTeamAnchor(null)}
                  />
                </div>
              )}
            </>
          )}

          {view === 'list' && listSection && (
            <ListScreen
              section={listSection}
              period={period}
              listStatus={listStatus}
              listQuery={listQuery}
              listSort={listSort}
              listPage={safePage}
              pageCount={pageCount}
              items={pageItems}
              allFiltered={filteredList}
              sourceCount={sourceItems(listSection).length}
              statusCounts={(() => {
                const map = {};
                sourceItems(listSection).forEach((x) => {
                  const sid = itemStatusId(listSection, x);
                  map[sid] = (map[sid] || 0) + 1;
                });
                if (listSection === 'works') {
                  WORK_PHASES.forEach((ph) => {
                    if (worksCounts[ph.id] != null) map[ph.id] = worksCounts[ph.id];
                  });
                }
                if (listSection === 'tenders' && overview?.tenders?.by_status) {
                  overview.tenders.by_status.forEach((r) => {
                    if (map[r.status] == null) map[r.status] = r.count;
                  });
                }
                if (listSection === 'applications' && overview?.applications?.by_status) {
                  overview.applications.by_status.forEach((r) => {
                    if (map[r.status] == null) map[r.status] = r.count;
                  });
                }
                return map;
              })()}
              loading={listLoading}
              overview={overview?.[listSection]}
              onBack={backOverview}
              onStatus={(st) => { haptic.light(); setListStatus(st); setListPage(1); }}
              onQuery={(q) => { setListQuery(q); setListPage(1); }}
              onSort={(s) => { haptic.light(); setListSort(s); setListPage(1); }}
              onPage={(p) => { haptic.light(); setListPage(p); }}
              onOpenDetail={(id) => openDetail(listSection, id)}
            />
          )}
        </div>
      </PullToRefresh>

      {detailOpen && (
        <DetailFullscreen
          kind={detailKind}
          detail={detail}
          loading={detailLoading}
          tab={detailTab}
          onTab={(t) => { haptic.light(); setDetailTab(t); }}
          onClose={closeDetail}
        />
      )}

      {teamPerson && (
        <TeamPersonSheet
          person={teamPerson}
          onClose={() => setTeamPerson(null)}
        />
      )}
    </PageShell>
  );
}

/* ── Overview section ─────────────────────────────────────────────────── */

function BizSection({
  id, title, note, overview, items, worksCounts, onOpenList, onOpenDetail,
}) {
  const haptic = useHaptic();
  const hero = useMemo(() => buildHero(id, overview, items, worksCounts), [id, overview, items, worksCounts]);
  const statuses = statusesOf(id);
  const byStatus = overview?.by_status || overview?.by_bucket || [];
  const statusMap = Object.fromEntries((byStatus || []).map((r) => [r.status, r]));

  const overdue = Number(overview?.overdue_count || 0);
  let todayCount = 0;
  (items || []).forEach((x) => {
    if (dueFlag(itemDeadline(id, x), isClosed(id, x)) === 'today') todayCount += 1;
  });

  const attention = overview?.attention || [];

  const totalSum = (items || []).reduce((a, x) => a + itemAmount(id, x), 0)
    || Number(overview?.nmck_sum || overview?.contract_sum || overview?.in_work_sum || 0);

  return (
    <section className="jp-sec-block" id={`jp-sec-${id}`}>
      <div className="jp-sec-head">
        <div className="jp-sec-head-left">
          <span className="jp-sec-mark" />
          <h2 className="jp-sec-title">{title}</h2>
          <span className="jp-sec-note">{note}</span>
        </div>
        <div className="jp-sec-head-right">
          <span className="jp-sec-total">{formatMoneyShort(totalSum)}</span>
          <button
            type="button"
            className="jp-sec-open spring-tap"
            onClick={() => onOpenList(id, 'all')}
          >
            Открыть реестр
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {(overdue > 0 || todayCount > 0) && (
        <div className={`jp-due-strip${overdue > 0 ? ' is-over' : ''}`}>
          <span className="jp-due-strip-ico" aria-hidden="true">!</span>
          <span className="jp-due-strip-text">
            {overdue > 0 && <><b>{overdue}</b> с просроченным дедлайном</>}
            {overdue > 0 && todayCount > 0 && ' · '}
            {todayCount > 0 && <><b>{todayCount}</b> истекает сегодня</>}
          </span>
          <button
            type="button"
            className="jp-due-strip-act spring-tap"
            onClick={() => onOpenList(id, 'all')}
          >
            Показать всё
          </button>
        </div>
      )}

      <div className="jp-hero">
        {hero.map((c) => (
          <div key={c.cap} className={`jp-hero-cell${c.tone ? ` tone-${c.tone}` : ''}`}>
            <div className="jp-hero-cap">{c.cap}</div>
            <div className={`jp-hero-num${c.money ? ' money' : ' lg'}`}>
              {c.value}
              {c.unit ? <span className="unit">{c.unit}</span> : null}
            </div>
            {c.meta ? <div className="jp-hero-meta" dangerouslySetInnerHTML={{ __html: c.meta }} /> : null}
          </div>
        ))}
      </div>

      <div className="jp-status-grid">
        {statuses.map((st) => {
          const row = statusMap[st.id] || {};
          const n = Number(row.count != null ? row.count
            : (items || []).filter((x) => itemStatusId(id, x) === st.id).length);
          const sum = id === 'applications' && st.id === 'trash'
            ? null
            : (row.sum != null ? row.sum
              : (items || []).filter((x) => itemStatusId(id, x) === st.id)
                .reduce((a, x) => a + itemAmount(id, x), 0));
          return (
            <button
              key={st.id}
              type="button"
              className={`jp-status-card tone-${st.tone} spring-tap`}
              onClick={() => { haptic.light(); onOpenList(id, st.id); }}
            >
              <span className="sc-top">
                <span className="sc-name"><span className="sc-dot" />{st.label}</span>
                <span className={`sc-n${n ? '' : ' zero'}`}>{n}</span>
              </span>
              <span className="sc-money">
                {n && sum != null ? formatMoneyShort(sum) : '—'}
              </span>
              <span className="sc-sub">
                {n ? `${n} карточек` : 'нет карточек за период'}
              </span>
            </button>
          );
        })}
      </div>

      {attention.length > 0 && (
        <div className="jp-attention">
          <div className="jp-attention-h">
            <span className="jp-attention-ico" aria-hidden="true">!</span>
            <span className="jp-attention-title">Требует внимания</span>
            <span className="jp-attention-n">{attention.length}</span>
            <button
              type="button"
              className="jp-attention-all spring-tap"
              onClick={() => onOpenList(id, 'all')}
            >
              Весь реестр
              <ChevronRight size={12} />
            </button>
          </div>
          <div className="jp-item-list jp-item-list--compact">
            {attention.slice(0, 3).map((item) => (
              <AttentionRow
                key={`${id}-${item.id}`}
                section={id}
                item={item}
                onOpen={() => onOpenDetail(item.id)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function buildHero(id, ov, items, worksCounts) {
  if (id === 'tenders') {
    const t = ov || {};
    const total = t.total ?? (items || []).length;
    const nmck = t.nmck_sum ?? 0;
    const price = t.work_price_sum ?? 0;
    const win = t.won ?? 0;
    const lose = t.lost ?? 0;
    const closed = win + lose;
    const conv = t.conversion;
    const inWork = t.active ?? (items || []).filter((x) => OPEN_REGISTRY.has(x.registry_status)).length;
    return [
      { cap: 'Тендеров в периоде', value: String(total), meta: `из них <b>${inWork}</b> в активной фазе` },
      { cap: 'Сумма НМЦК', value: compactVal(nmck).v, unit: compactVal(nmck).u, money: true, meta: `по ${total} процедурам` },
      { cap: 'Цена работ без НДС', value: compactVal(price).v, unit: compactVal(price).u, money: true, meta: 'сметы Асгард' },
      {
        cap: 'Конверсия',
        value: conv == null ? '—' : `${conv} %`,
        tone: conv != null && conv >= 30 ? 'ok' : '',
        meta: `<b>${win}</b> побед из <b>${closed}</b> закрытых`,
      },
    ];
  }
  if (id === 'applications') {
    const a = ov || {};
    const total = a.total ?? (items || []).length;
    const activeSum = a.in_work_sum ?? 0;
    const winSum = a.won_sum ?? 0;
    const conv = a.conversion;
    return [
      { cap: 'Заявок в периоде', value: String(total), meta: 'все статусы канбана' },
      { cap: 'В работе', value: compactVal(activeSum).v, unit: compactVal(activeSum).u, money: true, meta: 'сумма в контуре' },
      { cap: 'Выиграно', value: compactVal(winSum).v, unit: compactVal(winSum).u, money: true, tone: 'ok', meta: 'успешно закрыто' },
      {
        cap: 'Конверсия',
        value: conv == null ? '—' : `${conv} %`,
        tone: conv != null && conv >= 40 ? 'ok' : '',
        meta: 'по решённым заявкам',
      },
    ];
  }
  const w = ov || {};
  const total = w.total ?? (items || []).length;
  const active = w.active ?? worksCounts?.active ?? 0;
  const risk = w.risk_count ?? 0;
  const contract = w.contract_sum ?? 0;
  const avgM = w.avg_margin ?? 0;
  const paid = w.paid_sum ?? 0;
  return [
    { cap: 'Работ в периоде', value: String(total), meta: `<b>${active}</b> активных · <b>${risk}</b> в риске` },
    { cap: 'Портфель контрактов', value: compactVal(contract).v, unit: compactVal(contract).u, money: true, meta: `по ${total} договорам` },
    {
      cap: 'Средняя маржа',
      value: `${Math.round(Number(avgM) * 10) / 10} %`,
      tone: avgM >= 18 ? 'ok' : 'gold',
      meta: `${formatMoneyShort(Math.max(0, contract - paid))} к оплате`,
    },
    {
      cap: 'Оплачено',
      value: compactVal(paid).v,
      unit: compactVal(paid).u,
      money: true,
      meta: `остаток ${formatMoneyShort(Math.max(0, contract - paid))}`,
    },
  ];
}

function compactVal(n) {
  const abs = Math.abs(Number(n) || 0);
  if (abs >= 1e9) return { v: (abs / 1e9).toFixed(1), u: 'млрд' };
  if (abs >= 1e6) return { v: (abs / 1e6).toFixed(1), u: 'млн' };
  if (abs >= 1e3) return { v: (abs / 1e3).toFixed(0), u: 'тыс' };
  return { v: String(Math.round(abs)), u: '₽' };
}

function AttentionRow({ section, item, onOpen }) {
  const haptic = useHaptic();
  const st = statusMeta(section, item.status || item.registry_status || item.bucket);
  const dl = item.deadline || itemDeadline(section, item);
  const chip = dueChip(dl, false);
  return (
    <button
      type="button"
      className={`jp-item spring-tap${chip?.cls === 'over' ? ' row--over' : chip?.cls === 'today' ? ' row--today' : ''}`}
      onClick={() => { haptic.light(); onOpen(); }}
    >
      <div className="min-w-0 flex-1">
        <p className="jp-item-title">{itemTitle(section, item)}</p>
        <p className="jp-item-sub">
          {[item.customer_name, chip?.text].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="jp-item-aside">
        {st && <span className={`jp-badge tone-${st.tone}`}>{st.label}</span>}
        {chip && <span className={`jp-due-chip ${chip.cls}`}>{chip.text}</span>}
        <span className="jp-money">
          {formatMoneyShort(item.work_price ?? item.price ?? item.estimated_sum ?? item.contract_value)}
        </span>
      </div>
    </button>
  );
}

/* ── Team ─────────────────────────────────────────────────────────────── */

function TeamSection({ teamHours, period, onOpenPerson, scope, onScope, onStep, onCurrent }) {
  const haptic = useHaptic();
  const dq = teamHours?.data_quality || {};
  const noSkud = !dq.last_import;
  const activeScope = teamHours?.period?.scope || scope || 'month';

  const sorted = useMemo(() => {
    const stateRank = { red: 0, yellow: 1, none: 2, green: 3 };
    return (teamHours?.people || []).slice().sort((a, b) => {
      if (!!b.crown !== !!a.crown) return b.crown ? 1 : -1;
      const ra = stateRank[a.state] == null ? 2 : stateRank[a.state];
      const rb = stateRank[b.state] == null ? 2 : stateRank[b.state];
      if (ra !== rb) return ra - rb;
      const pa = a.ratio_pct == null ? Number.POSITIVE_INFINITY : a.ratio_pct;
      const pb = b.ratio_pct == null ? Number.POSITIVE_INFINITY : b.ratio_pct;
      if (pa !== pb) return pa - pb;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
    });
  }, [teamHours?.people]);

  const atCurrent = !teamHours?.period || !teamHours.period.current_anchor
    ? true
    : (teamHours.period.current_anchor >= teamHours.period.from
      && teamHours.period.current_anchor <= teamHours.period.to);

  const lastImportTo = dq.last_import ? String(dq.last_import.period_to).slice(0, 10) : null;
  const hasNorm = (teamHours?.people || []).some((p) => Number(p.norm_minutes) > 0);
  const notCovered = !!lastImportTo && (teamHours?.people || []).length > 0 && !hasNorm;

  const stateLabel = {
    green: 'в норме', yellow: 'недоработка', red: 'ниже половины', none: 'нет нормы',
  };

  return (
    <section className="jp-sec-block jp-team-block">
      <div className="jp-sec-head">
        <div className="jp-sec-head-left">
          <span className="jp-sec-mark" />
          <h2 className="jp-sec-title">График офиса</h2>
          <span className="jp-sec-note">офис + удалённо · норма 8 ч/день</span>
        </div>
        <div className="jp-sec-head-right">
          <span className="jp-sec-total">{teamHours?.period?.label || periodLabel(period)}</span>
        </div>
      </div>

      <div className="jp-og-filter">
        <div className="jp-og-scopes" role="tablist" aria-label="Период графика офиса">
          {TEAM_SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={activeScope === s.id}
              className={`jp-og-scope spring-tap${activeScope === s.id ? ' is-on' : ''}`}
              onClick={() => { haptic.light(); onScope?.(s.id); }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="jp-og-nav">
          <button
            type="button"
            className="jp-og-nav-btn spring-tap"
            aria-label="Предыдущий период"
            disabled={!teamHours?.period?.prev_anchor}
            onClick={() => { haptic.light(); onStep?.(teamHours?.period?.prev_anchor); }}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="jp-og-range">{teamHours?.period?.label || '—'}</span>
          <button
            type="button"
            className="jp-og-nav-btn spring-tap"
            aria-label="Следующий период"
            disabled={!teamHours?.period?.next_anchor}
            onClick={() => { haptic.light(); onStep?.(teamHours?.period?.next_anchor); }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        {atCurrent ? null : (
          <button type="button" className="jp-og-today spring-tap" onClick={() => { haptic.light(); onCurrent?.(); }}>
            Текущий период
          </button>
        )}
      </div>

      {noSkud ? (
        <div className="jp-warn-banner">
          Отчёт СКУД ещё не загружен — часы офиса и норма не считаются.
        </div>
      ) : (
        <>
          {notCovered ? (
            <div className="jp-warn-banner">
              Период ещё не покрыт отчётом СКУД (последний — по {formatDate(lastImportTo)}
              ). За дни без отчёта норма не начисляется.
              <button
                type="button"
                className="jp-og-today spring-tap"
                style={{ marginLeft: 8 }}
                onClick={() => { haptic.light(); onStep?.(lastImportTo); }}
              >
                {formatDate(lastImportTo)}
              </button>
            </div>
          ) : null}
          <div className="jp-og-summary">
            {teamHours?.norm?.people_total
              ? <span>В норме: <b>{teamHours.norm.people_total - teamHours.norm.people_under}</b> из {teamHours.norm.people_total}</span>
              : <span>Нет данных для расчёта нормы</span>}
            {teamHours?.period?.working_days
              ? <span>рабочих дней: <b>{teamHours.period.working_days}</b></span>
              : null}
          </div>

          <div className="jp-og-legend">
            <span className="is-green"><i />в норме</span>
            <span className="is-yellow"><i />до 50 %</span>
            <span className="is-red"><i />ниже половины</span>
            <span className="is-none"><i />нет нормы</span>
          </div>

          {!sorted.length ? (
            <EmptyState
              icon={Activity}
              title="Нет сотрудников"
              description="Список пуст — нет людей с аккаунтом CRM"
            />
          ) : (
            <div className="jp-og-list">
              {sorted.map((p) => {
                const st = p.state || 'none';
                return (
                  <button
                    type="button"
                    key={p.staff_id}
                    className={`jp-og-row is-${st}${p.crown ? ' is-crown' : ''} spring-tap`}
                    onClick={() => {
                      haptic.light();
                      onOpenPerson?.(p);
                    }}
                  >
                    <span className="jp-og-bar" />
                    <span className="jp-og-name">
                      <span className="jp-og-name-txt">
                        {p.name}
                        {p.crown ? <CrownIcon /> : null}
                      </span>
                      <span className="jp-og-role">
                        {p.role || ''}
                        {p.norm_minutes > 0
                          ? `${p.role ? ' · ' : ''}${p.days_counted} дн. в норме`
                          : ''}
                      </span>
                    </span>
                    <span className="jp-og-pct">
                      <span className="v">{p.ratio_pct == null ? '—' : `${Math.round(p.ratio_pct)} %`}</span>
                      <span className="l">{stateLabel[st] || '—'}</span>
                    </span>
                    <span className="jp-og-cells">
                      <span className="c"><i>офис</i>{hoursFmt(p.office_minutes)}</span>
                      <span className="c"><i>удалённо</i>{hoursFmt(p.remote_minutes)}</span>
                      <span className="c sum"><i>сумма</i>{hoursFmt(p.worked_minutes)}</span>
                      <span className="c"><i>норма</i>{p.norm_minutes ? hoursFmt(p.norm_minutes) : '—'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="jp-dq">
        <div className="h">Качество данных</div>
        {dq.last_import ? (
          <p>
            Отчёт СКУД: {formatDate(dq.last_import.period_from)}–{formatDate(dq.last_import.period_to)}
          </p>
        ) : <p>Отчёт СКУД ещё не импортирован</p>}
        {dq.skud_days_missing_count ? (
          <p>Дней без отчёта СКУД: {dq.skud_days_missing_count}</p>
        ) : null}
        {dq.crm_activity_since
          ? <p>Учёт времени СРМ с {formatDate(dq.crm_activity_since)}</p>
          : <p>Серверный учёт времени СРМ ещё не собирал минут</p>}
      </div>
    </section>
  );
}

/** Корона лидера периода — тот же силуэт, что на desktop. */
function CrownIcon() {
  return (
    <svg className="jp-og-crown" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 8.5l4.2 3.2L12 5l4.8 6.7L21 8.5l-1.8 10.2H4.8L3 8.5z" fill="currentColor" />
    </svg>
  );
}

/* ── Registry ─────────────────────────────────────────────────────────── */

function ListScreen({
  section, period, listStatus, listQuery, listSort, listPage, pageCount,
  items, allFiltered, sourceCount, statusCounts, loading, onBack,
  onStatus, onQuery, onSort, onPage, onOpenDetail,
}) {
  const meta = section === 'tenders'
    ? { title: 'Тендеры', unit: 'тендеров' }
    : section === 'applications'
      ? { title: 'Заявки', unit: 'заявок' }
      : { title: 'Работы', unit: 'работ' };
  const stMeta = statusMeta(section, listStatus);
  const totalSum = allFiltered.reduce((a, x) => a + itemAmount(section, x), 0);

  return (
    <div className="jp-list-screen jp-drill-in">
      <div className="jp-ls-head">
        <button type="button" className="jp-ls-back spring-tap" onClick={onBack}>
          <ChevronLeft size={18} />
          <span>К обзору</span>
        </button>
        <div className="jp-ls-titles">
          <h1 className="jp-ls-title">
            {meta.title}
            <span className="jp-ls-badge">
              {stMeta && listStatus !== 'all' ? stMeta.label : 'все статусы'}
            </span>
          </h1>
        </div>
        <div className="jp-ls-sum">
          <span className="jp-ls-sum-cap">
            {periodLabel(period)} · {allFiltered.length} {meta.unit}
          </span>
          <span className="jp-ls-sum-val">{formatMoneyShort(totalSum)}</span>
        </div>
      </div>

      <div className="jp-ls-bar">
        <label className="jp-ls-search">
          <Search size={14} />
          <input
            type="search"
            placeholder="Заказчик, название, РП…"
            value={listQuery}
            onChange={(e) => onQuery(e.target.value)}
          />
        </label>
        <div className="jp-ls-sort">
          <span className="jp-ls-sort-cap">Сортировка</span>
          <div className="jp-seg" role="group">
            {[
              ['deadline', 'По дедлайну'],
              ['sum', 'По сумме'],
              ['created', 'По дате'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={listSort === id ? 'is-on' : ''}
                onClick={() => onSort(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="jp-ls-tabs" role="tablist">
        <button
          type="button"
          className={`jp-lt-tab jp-lt-all${listStatus === 'all' ? ' is-on' : ''}`}
          onClick={() => onStatus('all')}
        >
          Все<span className="lt-n">{sourceCount}</span>
        </button>
        {statusesOf(section).map((st) => (
          <button
            key={st.id}
            type="button"
            className={`jp-lt-tab tone-${st.tone}${listStatus === st.id ? ' is-on' : ''}`}
            onClick={() => onStatus(st.id)}
          >
            {st.label}
            <span className="lt-n">{statusCounts[st.id] || 0}</span>
          </button>
        ))}
      </div>

      <div className="jp-ls-body">
        {loading ? (
          <SkeletonList count={4} />
        ) : !items.length ? (
          <EmptyHint>Ничего не найдено. Измените фильтр или период.</EmptyHint>
        ) : (
          <div className="jp-item-list">
            {items.map((item) => (
              <RegistryRow
                key={item.id}
                section={section}
                item={item}
                onOpen={() => onOpenDetail(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {pageCount > 1 && (
        <div className="jp-pager">
          <span className="pg-info">
            {(listPage - 1) * PAGE_SIZE + 1}
            –
            {Math.min(listPage * PAGE_SIZE, allFiltered.length)}
            {' '}
            из {allFiltered.length}
          </span>
          <span className="pg-btns">
            <button
              type="button"
              className="pg-arrow"
              disabled={listPage <= 1}
              onClick={() => onPage(listPage - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(5, pageCount) }, (_, i) => {
              let lo = Math.max(1, listPage - 2);
              const hi = Math.min(pageCount, lo + 4);
              lo = Math.max(1, hi - 4);
              const n = lo + i;
              if (n > hi) return null;
              return (
                <button
                  key={n}
                  type="button"
                  className={`pg-n${n === listPage ? ' is-on' : ''}`}
                  onClick={() => onPage(n)}
                >
                  {n}
                </button>
              );
            })}
            <button
              type="button"
              className="pg-arrow"
              disabled={listPage >= pageCount}
              onClick={() => onPage(listPage + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

function RegistryRow({ section, item, onOpen }) {
  const haptic = useHaptic();
  const closed = isClosed(section, item);
  const dl = itemDeadline(section, item);
  const chip = dueChip(dl, closed);
  const flag = dueFlag(dl, closed);
  const st = statusMeta(section, itemStatusId(section, item));
  const amount = itemAmount(section, item);

  let sub = '';
  if (section === 'tenders') {
    sub = [item.customer_name, item.region].filter(Boolean).join(' · ');
  } else if (section === 'applications') {
    const ch = CHANNELS[item.source_type] || item.source_type || '';
    sub = [item.customer_name, ch, item.created_at ? formatDate(item.created_at) : null]
      .filter(Boolean).join(' · ');
  } else {
    sub = [item.customer_name, item.city,
      item.brigade_count != null ? `бригада ${item.brigade_count}` : null]
      .filter(Boolean).join(' · ');
  }

  let moneySub = '—';
  let moneySubCls = '';
  if (section === 'tenders') {
    const m = item.estimate?.margin_pct ?? item.margin_pct;
    if (m != null) {
      moneySub = `маржа ${pct(m)}`;
      moneySubCls = m >= 20 ? 'ok' : m >= 14 ? 'warn' : 'err';
    } else if (item.pm?.name) moneySub = `РП ${String(item.pm.name).split(' ')[0]}`;
  } else if (section === 'applications') {
    const pm = item.pm || item.assigned;
    moneySub = pm?.name ? `РП ${String(pm.name).split(' ')[0]}` : 'РП не назначен';
    moneySubCls = pm ? '' : 'warn';
  } else {
    const m = item.margin_pct;
    if (m != null) {
      moneySub = `маржа ${pct(m)}`;
      moneySubCls = m >= 20 ? 'ok' : m >= 12 ? 'warn' : 'err';
    }
  }

  return (
    <button
      type="button"
      className={`jp-item spring-tap${flag === 'over' ? ' row--over' : flag === 'today' ? ' row--today' : ''}`}
      onClick={() => { haptic.light(); onOpen(); }}
    >
      <div className="min-w-0 flex-1">
        <p className="jp-item-title">{itemTitle(section, item)}</p>
        <p className="jp-item-sub">
          {sub}
          {chip ? (
            <>
              {' · '}
              <span className={`jp-due-chip ${chip.cls}`}>{chip.text}</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="jp-item-aside">
        {st && <span className={`jp-badge tone-${st.tone}`}>{st.label}</span>}
        <span className="jp-money">{amount ? formatMoneyShort(amount) : '—'}</span>
        <span className={`jp-money-sub ${moneySubCls}`}>{moneySub}</span>
        <ChevronRight size={14} className="c-tertiary" />
      </div>
    </button>
  );
}

/* ── Fullscreen detail ────────────────────────────────────────────────── */

function DetailFullscreen({ kind, detail, loading, tab, onTab, onClose }) {
  const tabs = kind === 'tenders' ? TENDER_TABS
    : kind === 'applications' ? APP_TABS
      : WORK_TABS;
  const title = !detail || detail._error
    ? (kind === 'tenders' ? 'Тендер' : kind === 'applications' ? 'Заявка' : 'Работа')
    : (detail.title || detail.customer_name || detail.object_name || 'Карточка');
  const kicker = kind === 'tenders' ? 'Тендер'
    : kind === 'applications' ? 'Заявка' : 'Работа';
  const tabsRef = useRef(null);

  useEffect(() => {
    const bar = tabsRef.current;
    if (!bar) return;
    const ind = bar.querySelector('.jp-tabs-ind');
    const on = bar.querySelector('button.is-on');
    if (!ind || !on) return;
    ind.style.left = `${on.offsetLeft}px`;
    ind.style.width = `${on.offsetWidth}px`;
  }, [tab, kind, detail]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const subParts = [];
  if (detail && !detail._error) {
    if (kind === 'tenders') {
      const st = statusMeta('tenders', detail.registry_status);
      if (st) subParts.push(st.label);
      if (detail.customer_name) subParts.push(detail.customer_name);
    } else if (kind === 'applications') {
      subParts.push(detail.status_label || detail.status);
      if (detail.customer_name) subParts.push(detail.customer_name);
    } else {
      const st = statusMeta('works', detail.bucket);
      if (st) subParts.push(st.label);
      if (detail.city) subParts.push(detail.city);
    }
  }

  const node = (
    <div className="jp-modal-root" role="dialog" aria-modal="true" aria-labelledby="jpModalTitle">
      <div className="jp-modal">
        <div className="jp-modal-head">
          <div className="jp-modal-head-top">
            <button type="button" className="jp-modal-back spring-tap" onClick={onClose} aria-label="Назад">
              <ChevronLeft size={22} />
            </button>
            <div className="jp-modal-head-main">
              <div className="jp-modal-kicker">
                <span>{kicker}</span>
                {detail?.id != null && <span className="mono">#{detail.id}</span>}
              </div>
              <h2 className="jp-modal-title" id="jpModalTitle">{title}</h2>
              {subParts.length > 0 && (
                <div className="jp-modal-sub">
                  {subParts.map((p, i) => (
                    <span key={`${p}-${i}`}>
                      {i > 0 && <span className="dotsep">·</span>}
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="jp-modal-close spring-tap" onClick={onClose} aria-label="Закрыть">
              <X size={18} />
            </button>
          </div>
          <div className="jp-modal-tabs" role="tablist" ref={tabsRef}>
            <span className="jp-tabs-ind" aria-hidden="true" />
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                className={tab === t.id ? 'is-on' : ''}
                aria-selected={tab === t.id}
                onClick={() => onTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="jp-modal-body">
          {loading ? (
            <SkeletonList count={4} />
          ) : detail?._error ? (
            <p className="jp-empty" style={{ color: 'var(--danger-ink)' }}>{detail._error}</p>
          ) : !detail ? null
            : kind === 'tenders' ? <TenderTabs d={detail} tab={tab} />
              : kind === 'applications' ? <AppTabs d={detail} tab={tab} />
                : <WorkTabs d={detail} tab={tab} />}
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

/* ── Shared detail bits ───────────────────────────────────────────────── */

function DeadlineBanner({ deadline, status }) {
  if (!deadline) return null;
  const d = daysLeftOf(deadline);
  if (d === null || d > 1) return null;
  const cls = d < 0 ? 'is-over' : 'is-today';
  const head = d < 0
    ? `Просрочка: дедлайн прошёл ${Math.abs(d)} ${daysWord(d)}`
    : d === 0 ? 'Дедлайн сегодня' : 'Дедлайн завтра';
  const hint = d < 0
    ? 'Карточка не закрыта. Требуется решение: продлить, подать или закрыть статусом.'
    : 'Срок истекает. Проверьте готовность пакета и решение по подаче.';
  return (
    <div className={`jp-dl-banner ${cls}`}>
      <span className="jp-dl-banner-ico" aria-hidden="true">!</span>
      <span className="jp-dl-banner-body">
        <span className="jp-dl-banner-head">
          {head}{status ? ` · статус «${status}»` : ''}
        </span>
        <span className="jp-dl-banner-hint">{hint}</span>
      </span>
      <span className="jp-dl-banner-date">{formatDate(deadline)}</span>
    </div>
  );
}

function OutcomeBlock({ outcome }) {
  if (!outcome) return null;
  const isCancel = outcome.kind === 'cancel';
  return (
    <div className="jp-block">
      <div className="jp-block-h">
        <h3>{isCancel ? 'Почему отменили' : 'Почему проиграли'}</h3>
      </div>
      <div className={`jp-outcome ${isCancel ? 'is-cancel' : 'is-lose'}`}>
        <div className="jp-outcome-head">
          <span className={`jp-badge tone-${isCancel ? 'muted' : 'err'}`}>
            {isCancel ? 'Отмена' : 'Проигрыш'}
          </span>
          <span className="jp-outcome-reason">{outcome.reason || '—'}</span>
        </div>
        {outcome.detail ? <div className="jp-outcome-detail">{outcome.detail}</div> : null}
        <div className="jp-outcome-foot">
          <span>Зафиксировал: <b>{outcome.by || '—'}</b></span>
          <span>{outcome.at ? formatDate(outcome.at) : '—'}</span>
        </div>
      </div>
    </div>
  );
}

function AuditBlock({ rows }) {
  const list = (rows || []).filter((r) => r?.name);
  return (
    <div className="jp-block">
      <div className="jp-block-h"><h3>Кто вёл карточку</h3></div>
      {list.length === 0 ? (
        <EmptyHint>Данных об авторе нет</EmptyHint>
      ) : (
        <div className="jp-audit">
          {list.map((r, i) => (
            <div className="jp-audit-row" key={`${r.role}-${i}`}>
              <span className="jp-audit-role">{r.role}</span>
              <span className="jp-audit-name">{r.name}</span>
              <span className="jp-audit-when">{r.at ? formatDate(r.at) : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Kv({ rows }) {
  return (
    <div className="jp-kv-list">
      {rows.map(([k, v]) => (
        <div className="jp-kv-row" key={k}>
          <span className="jp-kv-k">{k}</span>
          <span className="jp-kv-v">{v}</span>
        </div>
      ))}
    </div>
  );
}

function SideCard({ cap, value, tone, sub, rows }) {
  return (
    <div className="jp-side-card">
      <div className="jp-side-cap">{cap}</div>
      <div className={`jp-side-big${tone ? ` tone-${tone}` : ''}`}>{value}</div>
      {sub ? <div className="jp-side-cap-sub">{sub}</div> : null}
      {rows?.length ? (
        <div className="jp-side-rows">
          {rows.map(([k, v]) => (
            <div className="jp-side-row" key={k}>
              <span className="k">{k}</span>
              <span className="v">{v}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EstimateTable({ est }) {
  if (!est || !est.rows?.length) {
    return <EmptyHint>Строк сметы нет — данных пока нет.</EmptyHint>;
  }
  return (
    <>
      <div className="jp-tbl-wrap">
        <table className="jp-tbl">
          <thead>
            <tr>
              <th>Позиция</th>
              <th className="num">Кол-во</th>
              <th className="num">Сумма</th>
              <th className="num">Себест.</th>
              <th className="num">Маржа</th>
            </tr>
          </thead>
          <tbody>
            {est.rows.map((r, i) => (
              <tr key={`${r.name}-${i}`}>
                <td>
                  {i + 1}. {r.name}
                  {r.unit ? <span className="sub"> {r.unit}</span> : null}
                </td>
                <td className="num">{r.qty != null ? r.qty : '—'}</td>
                <td className="num">{formatMoney(r.sum)}</td>
                <td className="num">{formatMoney(r.cost)}</td>
                <td className="num">{r.margin_pct != null ? pct(r.margin_pct) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="jp-totals">
        <div className="jp-totals-row"><span className="k">Без НДС</span><span className="v">{formatMoney(est.total_no_vat)}</span></div>
        <div className="jp-totals-row"><span className="k">НДС 20 %</span><span className="v">{formatMoney(est.vat)}</span></div>
        <div className="jp-totals-row grand"><span className="k">С НДС</span><span className="v">{formatMoney(est.total_with_vat)}</span></div>
        <div className="jp-totals-row accent">
          <span className="k">Маржа</span>
          <span className="v">
            {est.margin_rub != null ? `${formatMoney(est.margin_rub)} · ` : ''}
            {est.margin_pct != null ? pct(est.margin_pct) : '—'}
          </span>
        </div>
      </div>
    </>
  );
}

function DocList({ docs }) {
  if (!docs?.length) return <EmptyHint>Документов нет</EmptyHint>;
  return (
    <div className="jp-docs">
      {docs.map((d) => {
        const name = d.original_name || d.file_name || d.name || 'файл';
        const ext = (d.ext || name.split('.').pop() || 'file').toString().slice(0, 4).toLowerCase();
        return (
          <div key={d.id || name} className="jp-doc-row">
            <span className="jp-doc-ext">{ext}</span>
            <FileText size={14} style={{ color: 'var(--gold)', flexShrink: 0 }} />
            <span className="truncate" style={{ flex: 1 }}>{name}</span>
            {d.created_at ? (
              <span className="c-tertiary" style={{ fontSize: 11 }}>{formatDate(d.created_at)}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Split({ main, side }) {
  return (
    <div className="jp-split">
      <div className="jp-split-main">{main}</div>
      <div className="jp-split-side">{side}</div>
    </div>
  );
}

function Block({ title, children, right }) {
  return (
    <div className="jp-block">
      <div className="jp-block-h">
        <h3>{title}</h3>
        {right || null}
      </div>
      {children}
    </div>
  );
}

/* ── Tender tabs ──────────────────────────────────────────────────────── */

function TenderTabs({ d, tab }) {
  const st = statusMeta('tenders', d.registry_status);
  const dl = d.docs_deadline || d.deadline;
  const est = normalizeEstimate(d.estimate || d.estimates?.[0] || null);
  const rp = d.rp_review || null;
  const checklist = normalizeChecklist(d.checklist);
  const docs = d.documents || [];
  const nmck = d.nmck != null ? d.nmck : d.price;
  const workPrice = rp?.work_price != null ? rp.work_price : d.price;

  if (tab === 'calc') {
    if (!rp) return <EmptyHint>Просчёт РП ещё не создан.</EmptyHint>;
    const ok = rp.decision === 'submit' || rp.decision === 'go' || rp.decision === 'подавать';
    return (
      <Split
        main={(
          <>
            <DeadlineBanner deadline={dl} status={d.registry_status} />
            <Block title="Кто и что посчитал">
              <Kv rows={[
                ['Калькулятор', rp.calculator?.name || d.calculator?.name || '—'],
                ['Цена работ', `${formatMoney(rp.work_price ?? workPrice)} без НДС`],
                ['Себестоимость', formatMoney(rp.cost)],
                ['Маржа', rp.margin_pct != null ? pct(rp.margin_pct) : '—'],
                ['Решение', ok ? 'Подавать' : (rp.decision || '—')],
                ['Дата финализации', formatDate(rp.finalized_at || rp.analysis_finalized_at, 'long')],
              ]}
              />
            </Block>
            {(rp.recommendation || rp.report_text) && (
              <Block title="Рекомендация калькулятора">
                <div className="jp-report">{rp.recommendation || rp.report_text}</div>
              </Block>
            )}
          </>
        )}
        side={(
          <>
            <SideCard
              cap="Цена работ без НДС"
              value={formatMoneyShort(rp.work_price ?? workPrice)}
              sub="канон: цена без НДС"
              rows={[
                ['НМЦК', formatMoneyShort(nmck)],
                ['Себестоимость', formatMoneyShort(rp.cost)],
                ['Маржа', rp.margin_pct != null ? pct(rp.margin_pct) : '—'],
              ]}
            />
          </>
        )}
      />
    );
  }

  if (tab === 'estimate') {
    if (!est) return <EmptyHint>Сметы по тендеру нет.</EmptyHint>;
    return (
      <Split
        main={<Block title={`Смета Асгард · ${est.rows.length} позиций`}><EstimateTable est={est} /></Block>}
        side={(
          <SideCard
            cap="Цена работ без НДС"
            value={formatMoneyShort(est.total_no_vat)}
            sub="ндс начисляется сверху"
            rows={[
              ['Позиций', String(est.rows.length)],
              ['Себестоимость', formatMoneyShort(est.cost_total)],
              ['Маржа', est.margin_pct != null ? pct(est.margin_pct) : '—'],
              ['НДС 20 %', formatMoneyShort(est.vat)],
            ]}
          />
        )}
      />
    );
  }

  if (tab === 'checklist') {
    if (!checklist.length) return <EmptyHint>Чек-лист анализа пуст.</EmptyHint>;
    const done = checklist.filter((x) => x.done).length;
    return (
      <Split
        main={(
          <Block title="Чек-лист анализа" right={<span className="jp-badge tone-muted">{done} / {checklist.length}</span>}>
            <div className="jp-checklist">
              {checklist.map((c, i) => (
                <div key={c.id || i} className={`jp-check-item${c.done ? ' done' : ''}`}>
                  <span className="jp-check-box">{c.done ? '✓' : ''}</span>
                  <span className="jp-check-txt">{c.text}</span>
                  <span className={`jp-check-when${c.done ? '' : ' pending'}`}>
                    {c.done ? formatDate(c.date) : (c.due ? `до ${formatDate(c.due)}` : '—')}
                  </span>
                </div>
              ))}
            </div>
          </Block>
        )}
        side={(
          <SideCard
            cap="Готовность"
            value={`${done} / ${checklist.length}`}
            tone={done === checklist.length ? 'ok' : 'warn'}
            sub={done === checklist.length ? 'все пункты закрыты' : `осталось ${checklist.length - done}`}
          />
        )}
      />
    );
  }

  if (tab === 'report') {
    let text = rp?.report_text || rp?.recommendation || '';
    if (!text && rp?.report_json) {
      try {
        const j = typeof rp.report_json === 'string' ? JSON.parse(rp.report_json) : rp.report_json;
        text = j?.conclusion || j?.summary || j?.text || '';
      } catch {
        text = String(rp.report_json);
      }
    }
    if (!text && !rp) return <EmptyHint>Отчёта РП нет.</EmptyHint>;
    const ok = rp?.decision === 'submit' || rp?.decision === 'go' || rp?.decision === 'подавать';
    return (
      <Split
        main={(
          <Block title="Заключение РП">
            <div className="jp-report">{text || '—'}</div>
            <div className="jp-report-meta">
              <span>{d.pm?.name || 'РП'}</span>
              <span>{formatDate(rp?.finalized_at || rp?.analysis_finalized_at)}</span>
            </div>
          </Block>
        )}
        side={<SideCard cap="Решение" value={ok ? 'Подавать' : (rp?.decision || '—')} tone={ok ? 'ok' : 'err'} />}
      />
    );
  }

  if (tab === 'docs') {
    return (
      <Block title="Документы процедуры" right={<span className="jp-badge tone-muted">{docs.length}</span>}>
        <DocList docs={docs} />
      </Block>
    );
  }

  /* summary */
  const dLeft = daysLeftOf(dl);
  return (
    <Split
      main={(
        <>
          <DeadlineBanner deadline={dl} status={d.registry_status} />
          <Block title="Паспорт процедуры">
            <Kv rows={[
              ['Заказчик', d.customer_name || '—'],
              ['ИНН', d.customer_inn || '—'],
              ['Площадка', d.platform || '—'],
              ['Извещение', d.registry_no || '—'],
              ['НМЦК', formatMoney(nmck)],
              ['Цена работ', `${formatMoney(workPrice)} без НДС`],
              ['Дедлайн', dl ? `${formatDate(dl, 'long')}${dLeft != null ? ` · ${dLeft < 0 ? `просрочен на ${Math.abs(dLeft)}` : `${dLeft}`} ${daysWord(dLeft)}` : ''}` : '—'],
              ['Реестр', st?.label || d.registry_status || '—'],
              ['Регион', d.region || '—'],
            ]}
            />
          </Block>
          <OutcomeBlock outcome={d.outcome} />
          <AuditBlock rows={d.audit} />
        </>
      )}
      side={(
        <>
          <SideCard
            cap="Цена работ без НДС"
            value={formatMoneyShort(workPrice)}
            sub={est ? `смета · ${est.rows.length} позиций` : 'смета не загружена'}
            rows={[
              ['НМЦК', formatMoneyShort(nmck)],
              ['Маржа сметы', est?.margin_pct != null ? pct(est.margin_pct) : '—'],
            ]}
          />
          <SideCard
            cap="Дедлайн"
            value={dLeft == null ? '—' : `${Math.abs(dLeft)} ${daysWord(dLeft)}`}
            tone={dLeft == null ? '' : dLeft < 0 ? 'err' : dLeft <= 5 ? 'warn' : 'ok'}
            sub={formatDate(dl)}
          />
          <SideCard
            cap="Статус"
            value={st?.label || d.registry_status || '—'}
            sub={d.tender_status || ''}
            rows={[
              ['Чек-лист', checklist.length ? `${checklist.filter((x) => x.done).length} / ${checklist.length}` : '—'],
              ['Документов', String(docs.length)],
            ]}
          />
        </>
      )}
    />
  );
}

/* ── App tabs ─────────────────────────────────────────────────────────── */

function AppTabs({ d, tab }) {
  const st = statusMeta('applications', d.status);
  const dl = d.work_deadline || d.deadline;
  const est = normalizeEstimate(d.estimate);
  const docs = d.documents || [];
  const history = d.history || [];
  const ai = {
    color: d.ai_color,
    confidence: d.ai_confidence,
    summary: d.ai_summary,
  };

  if (tab === 'estimate') {
    if (!est) {
      return (
        <EmptyHint>
          Просчёт по заявке ещё не создан.
          Калькулятор закрепляется при переходе в статус «Просчёт».
        </EmptyHint>
      );
    }
    return (
      <Split
        main={<Block title="Просчёт"><EstimateTable est={est} /></Block>}
        side={(
          <SideCard
            cap="Сумма без НДС"
            value={formatMoneyShort(est.total_no_vat)}
            sub={`позиций: ${est.rows.length}`}
            rows={[
              ['Себестоимость', formatMoneyShort(est.cost_total)],
              ['Маржа', est.margin_pct != null ? pct(est.margin_pct) : '—'],
              ['НДС 20 %', formatMoneyShort(est.vat)],
            ]}
          />
        )}
      />
    );
  }

  if (tab === 'history') {
    if (!history.length) return <EmptyHint>Истории статусов пока нет.</EmptyHint>;
    return (
      <Split
        main={(
          <Block title="История статусов" right={<span className="jp-badge tone-muted">{history.length}</span>}>
            <div className="jp-timeline">
              {history.map((h, i) => {
                const meta = statusMeta('applications', h.status);
                return (
                  <div key={h.id || i} className={`jp-tl-item${i === history.length - 1 ? ' is-last' : ''}`}>
                    <span className="jp-tl-dot" />
                    <div className="jp-tl-head">
                      <span className="jp-tl-status">{meta?.label || h.status}</span>
                      <span className="jp-tl-date">{formatDate(h.at)}</span>
                    </div>
                    {h.note ? <div className="jp-tl-note">{h.note}</div> : null}
                    {h.by ? <div className="jp-tl-by">{h.by}</div> : null}
                  </div>
                );
              })}
            </div>
          </Block>
        )}
        side={(
          <SideCard
            cap="Текущий статус"
            value={st?.label || d.status_label || d.status || '—'}
            sub={`создана ${formatDate(d.created_at)}`}
            rows={[
              ['Событий', String(history.length)],
              ['Дедлайн', dl ? formatDate(dl) : '—'],
            ]}
          />
        )}
      />
    );
  }

  if (tab === 'docs') {
    return (
      <Block title="Документы заявки" right={<span className="jp-badge tone-muted">{docs.length}</span>}>
        <DocList docs={docs} />
      </Block>
    );
  }

  const colorLabel = ai.color === 'green' ? 'зелёный'
    : ai.color === 'amber' || ai.color === 'yellow' ? 'жёлтый'
      : ai.color === 'red' ? 'красный' : (ai.color || '—');
  const conf = ai.confidence != null
    ? (ai.confidence <= 1 ? Math.round(ai.confidence * 100) : Math.round(ai.confidence))
    : null;
  const dLeft = daysLeftOf(dl);

  return (
    <Split
      main={(
        <>
          <DeadlineBanner deadline={dl} status={st?.label || d.status} />
          <Block title="AI-разбор письма">
            {(ai.summary || ai.color) ? (
              <div className="jp-ai-card">
                <div className="jp-ai-top">
                  <span className="jp-ai-num">AI-разбор</span>
                  <span className={`jp-badge tone-${ai.color === 'green' ? 'ok' : ai.color === 'red' ? 'err' : 'warn'}`}>
                    {colorLabel}
                  </span>
                </div>
                {conf != null && (
                  <div className="jp-ai-meter">
                    <span className="jp-ai-bar"><i style={{ width: `${conf}%` }} /></span>
                    <span className="jp-ai-num">{conf} %</span>
                  </div>
                )}
                <div className="jp-ai-sum">{ai.summary || '—'}</div>
              </div>
            ) : (
              <EmptyHint>AI-разбора нет</EmptyHint>
            )}
          </Block>
          <Block title="Паспорт заявки">
            <Kv rows={[
              ['Заказчик', d.customer_name || '—'],
              ['Отправитель', d.contact_person || '—'],
              ['Контакт', d.customer_email || d.contact_phone || '—'],
              ['Канал', CHANNELS[d.source_type] || d.source_type || '—'],
              ['Создана', formatDate(d.created_at, 'long')],
              ['Дедлайн', dl ? formatDate(dl, 'long') : '—'],
              ['Статус', st?.label || d.status_label || d.status || '—'],
              ['Назначенный РП', d.assigned?.name || 'не назначен'],
              ['Просчёт', est ? `${formatMoney(est.total_no_vat)} без НДС` : 'не создан'],
            ]}
            />
          </Block>
          <OutcomeBlock outcome={d.outcome} />
          <AuditBlock rows={d.audit} />
          {(d.decision_comment || d.reject_reason) && (
            <Block title="Комментарий">
              <div className="jp-report">{d.decision_comment || d.reject_reason}</div>
            </Block>
          )}
        </>
      )}
      side={(
        <>
          <SideCard
            cap="Оценка суммы"
            value={d.estimated_sum != null ? formatMoneyShort(d.estimated_sum) : '—'}
            sub={est ? `смета: ${formatMoneyShort(est.total_no_vat)}` : 'смета не создана'}
          />
          <SideCard
            cap="Дедлайн"
            value={dLeft == null ? '—' : `${Math.abs(dLeft)} ${daysWord(dLeft)}`}
            tone={dLeft == null ? '' : dLeft < 0 ? 'err' : dLeft <= 3 ? 'warn' : 'ok'}
            sub={dl ? formatDate(dl) : 'без срока'}
          />
          <SideCard
            cap="В контуре"
            value={String(history.length || docs.length || 0)}
            sub="событий / документов"
            rows={[
              ['Документов', String(docs.length)],
              ['AI', `${colorLabel}${conf != null ? ` · ${conf} %` : ''}`],
            ]}
          />
        </>
      )}
    />
  );
}

/* ── Work tabs ────────────────────────────────────────────────────────── */

function WorkTabs({ d, tab }) {
  const received = d.received != null
    ? Number(d.received)
    : (Number(d.advance_received || 0) + Number(d.balance_received || 0));
  const leftover = d.leftover != null
    ? d.leftover
    : (d.contract_value != null ? Number(d.contract_value) - received : null);
  const contract = d.contract_value;
  const cost = d.cost_current ?? d.cost_fact ?? d.cost_plan;
  const light = d.schedule_light || 'ok';
  const brigade = d.brigade || [];
  const months = d.timesheet_by_month || [];
  const checkins = d.recent_checkins || [];

  if (tab === 'finance') {
    const paidPct = d.paid_pct != null ? d.paid_pct
      : (contract > 0 ? Math.round((received / contract) * 1000) / 10 : null);
    const spentPct = d.spent_pct != null ? d.spent_pct
      : (contract > 0 && cost != null ? Math.round((cost / contract) * 1000) / 10 : null);
    return (
      <Split
        main={(
          <Block title="Финансы объекта">
            <div className="jp-fin-grid">
              {[
                ['Контракт', formatMoney(contract)],
                ['Себестоимость', formatMoney(cost)],
                ['Маржа', d.margin_pct != null ? `${pct(d.margin_pct)}${d.margin_abs != null ? ` · ${formatMoneyShort(d.margin_abs)}` : ''}` : '—'],
                ['Оплачено', formatMoney(received)],
                ['Остаток', formatMoney(leftover)],
                ['Расход факт', formatMoney(d.cost_fact)],
              ].map(([k, v]) => (
                <div className="jp-fin-cell" key={k}>
                  <div className="jp-fin-cap">{k}</div>
                  <div className="jp-fin-val">{v}</div>
                </div>
              ))}
            </div>
            <div className="jp-prog">
              <div className="jp-prog-h">
                <span>Оплата</span>
                <span>{paidPct != null ? `${paidPct} %` : '—'}</span>
              </div>
              <div className="jp-prog-bar"><i style={{ width: `${Math.min(100, paidPct || 0)}%` }} /></div>
            </div>
            <div className="jp-prog">
              <div className="jp-prog-h">
                <span>Расход</span>
                <span>{spentPct != null ? `${spentPct} %` : '—'}</span>
              </div>
              <div className="jp-prog-bar is-cost"><i style={{ width: `${Math.min(100, spentPct || 0)}%` }} /></div>
            </div>
          </Block>
        )}
        side={(
          <SideCard
            cap="Маржа"
            value={d.margin_pct != null ? pct(d.margin_pct) : '—'}
            tone={d.margin_pct == null ? '' : d.margin_pct >= 18 ? 'ok' : d.margin_pct < 14 ? 'err' : 'warn'}
            sub={d.margin_abs != null ? formatMoney(d.margin_abs) : ''}
            rows={[
              ['Контракт', formatMoneyShort(contract)],
              ['Остаток', formatMoneyShort(leftover)],
            ]}
          />
        )}
      />
    );
  }

  if (tab === 'timesheet') {
    if (!months.length && !brigade.length) {
      return <EmptyHint>Табеля пока нет.</EmptyHint>;
    }
    const peopleSet = new Set();
    let totalDays = 0;
    let totalAccrued = 0;
    months.forEach((m) => {
      (m.persons || []).forEach((p) => {
        peopleSet.add(p.employee_id);
        totalDays += Number(p.days || 0);
        totalAccrued += Number(p.accrued || 0);
      });
    });
    return (
      <>
        <div className="jp-ts-totals">
          <div><span className="k">Человеко-дней</span><span className="v">{totalDays || '—'}</span></div>
          <div><span className="k">Начислено</span><span className="v">{totalAccrued ? formatMoneyShort(totalAccrued) : '—'}</span></div>
          <div><span className="k">В бригаде</span><span className="v">{peopleSet.size || brigade.length || '—'}</span></div>
        </div>
        <Block title="По месяцам">
          <div className="jp-tbl-wrap">
            <table className="jp-tbl">
              <thead>
                <tr>
                  <th>Месяц</th>
                  <th className="num">Дней</th>
                  <th className="num">Людей</th>
                  <th className="num">Начислено</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const days = (m.persons || []).reduce((a, p) => a + Number(p.days || 0), 0) || m.marks;
                  const acc = (m.persons || []).reduce((a, p) => a + Number(p.accrued || 0), 0);
                  return (
                    <tr key={m.month} className={!days ? 'is-dim' : ''}>
                      <td>{m.month}</td>
                      <td className="num">{days || '—'}</td>
                      <td className="num">{m.people || '—'}</td>
                      <td className="num">{acc ? formatMoneyShort(acc) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Block>
        <Block title="Сводка по людям">
          {(months.flatMap((m) => m.persons || []).length === 0 && !brigade.length) ? (
            <EmptyHint>Нет разбивки по людям</EmptyHint>
          ) : (
            <div className="jp-people-sum">
              {(months.flatMap((m) => (m.persons || []).map((p) => ({ ...p, month: m.month })))
                .reduce((acc, p) => {
                  const key = p.employee_id;
                  if (!acc.map[key]) {
                    acc.map[key] = { ...p, days: 0, accrued: 0 };
                    acc.list.push(acc.map[key]);
                  }
                  acc.map[key].days += Number(p.days || 0);
                  acc.map[key].accrued += Number(p.accrued || 0);
                  return acc;
                }, { map: {}, list: [] }).list).map((p) => (
                  <div key={p.employee_id} className="jp-doc-row">
                    <span className="truncate" style={{ flex: 1 }}>{p.name || '—'}</span>
                    <span className="c-tertiary" style={{ fontSize: 11 }}>
                      {p.days} дн.
                      {p.day_rate != null ? ` · ${formatMoneyShort(p.day_rate)}` : ''}
                      {p.accrued ? ` · ${formatMoneyShort(p.accrued)}` : ''}
                    </span>
                  </div>
              ))}
            </div>
          )}
        </Block>
        {brigade.some((b) => b.arrival_date) && (
          <Block title="График заездов">
            <div className="jp-span-line">
              <div className="jp-span-cap">Заезд → выезд</div>
              {(() => {
                const dated = brigade.filter((b) => b.arrival_date);
                const starts = dated.map((b) => new Date(b.arrival_date).getTime()).filter((n) => !Number.isNaN(n));
                const ends = dated.map((b) => new Date(b.departure_date || b.arrival_date).getTime())
                  .filter((n) => !Number.isNaN(n));
                if (!starts.length) return null;
                const winStart = Math.min(...starts);
                const winEnd = Math.max(...ends);
                const span = (winEnd - winStart) || 1;
                return dated.map((b) => {
                  const a = new Date(b.arrival_date).getTime();
                  const e = new Date(b.departure_date || b.arrival_date).getTime();
                  const left = Math.max(0, Math.min(100, ((a - winStart) / span) * 100));
                  const width = Math.max(2, Math.min(100 - left, ((e - a) / span) * 100));
                  const parts = String(b.name || '').split(/\s+/);
                  const short = `${parts[0] || ''}${parts[1] ? ` ${parts[1].slice(0, 1)}.` : ''}`;
                  return (
                    <div className="jp-span-row" key={`${b.employee_id}-${b.arrival_date}`}>
                      <span className="jp-span-name" title={b.name}>{short}</span>
                      <span className="jp-span-track">
                        <span className="jp-span-fill" style={{ left: `${left.toFixed(2)}%`, width: `${width.toFixed(2)}%` }} />
                      </span>
                      <span className="jp-span-dates">
                        {formatDate(b.arrival_date)}
                        {' — '}
                        {b.departure_date ? formatDate(b.departure_date) : '…'}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </Block>
        )}
      </>
    );
  }

  if (tab === 'brigade') {
    if (!brigade.length) return <EmptyHint>Нет назначений в бригаду.</EmptyHint>;
    return (
      <Block title="Бригада" right={<span className="jp-badge tone-muted">{brigade.length}</span>}>
        {brigade.map((b) => (
          <div key={`${b.employee_id}-${b.arrival_date || ''}`} className="jp-brig-row">
            <div className="jp-brig-main">
              <span className="nm">{b.name || '—'}</span>
              <span className="role">{b.role || ''}{b.is_active === false ? ' · неакт.' : ''}</span>
            </div>
            <div className="jp-brig-side">
              <span className="rate">{b.rate != null ? `${formatMoneyShort(b.rate)}/смена` : '—'}</span>
              <span className="dates">
                {b.arrival_date ? formatDate(b.arrival_date) : '—'}
                {' → '}
                {b.departure_date ? formatDate(b.departure_date) : '…'}
              </span>
            </div>
          </div>
        ))}
      </Block>
    );
  }

  if (tab === 'checkins') {
    if (!checkins.length) return <EmptyHint>Чекинов пока нет.</EmptyHint>;
    return (
      <Block title="Чекины" right={<span className="jp-badge tone-muted">{checkins.length}</span>}>
        {checkins.map((c, i) => (
          <div key={`${c.employee_id}-${c.date}-${i}`} className="jp-checkin-row">
            <span className="dt">{formatDate(c.date)}</span>
            <span className="kind">{c.kind || c.status || '—'}</span>
            <span className="nm truncate">{c.name || '—'}</span>
            <span className={`ok${c.ok === false ? ' bad' : ''}`}>{c.ok === false ? 'нет' : 'ок'}</span>
          </div>
        ))}
      </Block>
    );
  }

  /* summary */
  const st = statusMeta('works', d.bucket);
  return (
    <Split
      main={(
        <>
          {d.days_left != null && d.days_left <= 1 && d.bucket !== 'archive' && (
            <DeadlineBanner deadline={d.end_plan} status={st?.label} />
          )}
          <Block title="Паспорт объекта">
            <Kv rows={[
              ['Заказчик', d.customer_name || '—'],
              ['Объект', d.object_name || d.title || '—'],
              ['Адрес', d.address || d.city || '—'],
              ['Договор', d.work_number || '—'],
              ['РП', d.pm?.name || '—'],
              ['Старт', formatDate(d.start_fact || d.start_in_work_date || d.start_plan, 'long')],
              ['Окончание', formatDate(d.end_plan || d.end_fact, 'long')],
              ['Фаза', st?.label || d.bucket || '—'],
              ['Статус', d.work_status || '—'],
            ]}
            />
          </Block>
          {d.pause_reason && (
            <Block title="Причина паузы">
              <div className="jp-report">{d.pause_reason}</div>
            </Block>
          )}
          <div className={`jp-light tone-${light}`}>
            Светофор сроков:
            {' '}
            {light === 'err' ? 'просрочка' : light === 'warn' ? 'риск' : 'в норме'}
            {d.days_left != null
              ? ` · ${d.days_left >= 0 ? `${d.days_left} дн.` : `−${Math.abs(d.days_left)} дн.`}`
              : ''}
          </div>
        </>
      )}
      side={(
        <>
          <SideCard
            cap="Контракт"
            value={formatMoneyShort(contract)}
            sub={d.margin_pct != null ? `маржа ${pct(d.margin_pct)}` : ''}
            rows={[
              ['Оплачено', formatMoneyShort(received)],
              ['Остаток', formatMoneyShort(leftover)],
            ]}
          />
          <SideCard
            cap="Бригада"
            value={String(brigade.filter((b) => b.is_active !== false).length)}
            sub="активных"
            rows={[['Всего назначений', String(brigade.length)]]}
          />
        </>
      )}
    />
  );
}

const TEAM_STATUS_LABELS = {
  оф: 'В офисе', уд: 'Удалёнка', об: 'На объекте', км: 'Командировка',
  пг: 'Встреча', уч: 'Учёба', ск: 'Склад', бн: 'Больничный',
  сс: 'За свой счёт', вх: 'Выходной', нп: 'Не подтверждён',
};

function TeamPersonSheet({ person, onClose }) {
  const haptic = useHaptic();
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const days = (person.days || []).filter((d) =>
    d.counts_in_norm || Number(d.office_minutes) > 0 || Number(d.crm_minutes) > 0
    || !!d.status_code || Number(d.norm_minutes) > 0);

  return (
    <div className="jp-modal-root is-on" role="dialog" aria-modal="true">
      <button type="button" className="jp-modal-scrim" aria-label="Закрыть" onClick={onClose} />
      <div className="jp-modal jp-modal--person">
        <div className="jp-modal-head">
          <div>
            <span className="jp-badge tone-info" style={{ marginBottom: 8 }}>Часы</span>
            <h2 id="jpModalTitle">{person.name || 'Сотрудник'}</h2>
            <div className="jp-modal-sub">{person.role || ''}</div>
          </div>
          <button
            type="button"
            className="jp-modal-close spring-tap"
            aria-label="Закрыть"
            onClick={() => { haptic.light(); onClose(); }}
          >
            ✕
          </button>
        </div>
        <div className="jp-modal-body">
          <div className="jp-person-sum">
            <div><span className="k">Офис</span><span className="v">{hoursFmt(person.office_minutes)}</span></div>
            <div><span className="k">Удалённо</span><span className="v">{hoursFmt(person.remote_minutes)}</span></div>
            <div><span className="k">Сумма</span><span className="v">{hoursFmt(person.worked_minutes)}</span></div>
            <div><span className="k">Норма</span><span className="v">{hoursFmt(person.norm_minutes)}</span></div>
            <div>
              <span className="k">Отклонение</span>
              <span className={`v ${person.delta_minutes < 0 ? 'is-bad' : ''}`}>
                {hoursHuman(person.delta_minutes)}
              </span>
            </div>
          </div>
          {!days.length ? (
            <EmptyHint>За период нет дней с данными</EmptyHint>
          ) : (
            <div className="jp-day-list">
              {days.map((d) => {
                const remote = d.crm_remote_minutes != null
                  ? Number(d.crm_remote_minutes)
                  : Math.max(0, Number(d.credited_minutes || 0) - Number(d.office_minutes || 0));
                const worked = Number(d.office_minutes || 0) + remote;
                const delta = d.counts_in_norm ? worked - Number(d.norm_minutes || 0) : null;
                return (
                  <div className="jp-day-row" key={d.date}>
                    <span className="dt mono">{formatDate(d.date)}</span>
                    <span className="st">{TEAM_STATUS_LABELS[d.status_code] || d.status_code || '—'}</span>
                    <span className="num">оф {hoursFmt(d.office_minutes)}</span>
                    <span className="num">уд {hoursFmt(remote)}</span>
                    <span className={`num ${delta != null && delta < 0 ? 'bad' : ''}`}>
                      {delta == null ? '—' : hoursHuman(delta)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
