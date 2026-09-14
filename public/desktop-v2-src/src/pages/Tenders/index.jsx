/**
 * Страница /tenders — Хаб Тендеров (CRM 2.0, React v2).
 *
 * Источник: vanilla `public/assets/js/tenders.js` (4900+ строк) + S-13
 * (d97b6056) переделка под хаб. IMP-19 расширяет 2-табную React-страницу
 * («Активные/Архив») до полного хаба обращений с 3 главными табами,
 * sub-tabs, KPI, alert-bar, фильтром по источнику и контекст-действиями.
 *
 *   ✅ index.jsx                ← root + main/sub state + feed integration
 *   ✅ HubMainTabs.jsx          ← 3 главных таба
 *   ✅ SubTabsBar.jsx           ← chips (под-табы)
 *   ✅ KpiCards.jsx             ← 5 KPI сверху
 *   ✅ AlertBar.jsx             ← алёрт горящих дедлайнов
 *   ✅ SourceBadge.jsx          ← бейдж источника
 *   ✅ TenderRow.jsx            ← +Источник колонка +context actions +'Дозапрос'
 *   ✅ TendersFilter.jsx        ← +Источник фильтр
 *   ✅ api.js                   ← +loadHubFeed +putTenderStatus +TENDER_STATUS_COLORS
 *
 * SSE-каналы: добавлены подписки на pre_tender:*, inbox_applications:*,
 * call:* (одним top-level useEffect, см. INV-18 §A.9 R-11).
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, SkeletonRows } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';

// RBAC синхронно с backend `src/routes/tenders.js:268` (GET /api/tenders) +
// `src/routes/tenders-hub.js` ALLOWED_ROLES (8 ролей).
const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

import TendersFilter from './TendersFilter';
import TendersList from './TendersList';
import HubMainTabs from './HubMainTabs';
import SubTabsBar from './SubTabsBar';
import KpiCards from './KpiCards';
import AlertBar from './AlertBar';
import { ActionMenuModal } from './modals/ActionMenu';
import { TenderEditorModal } from './modals/TenderEditor.dispatch';
import {
  WonModal, LostModal, CancelModal, ArchiveModal, UnarchiveModal, ChangeAuthorModal
} from './modals/StatusModals';
import { PassRequestModal } from './modals/PassRequestModal';
import { TmcRequestModal } from './modals/TmcRequestModal';
import RegistryTab from './RegistryTab';
import PlatformTendersTab from './PlatformTendersTab';
import FunnelHubTab from './FunnelHubTab';
import TenderGuruSettingsPanel from './TenderGuruSettingsPanel';
import WinWorkModal from './modals/WinWorkModal';
import {
  loadTenders, loadUsers, loadHubFeed, putTenderStatus,
  filterByQuery, filterByMatch
} from './api';
import { defaultPeriodFilter, periodFilterKey } from './periodFilterUtils';
import './tenders.css';

/* Sub-табы конфигурация (1:1 с vanilla S-13). */
const SUB_TABS = {
  tenders: [
    { id: 'registry',  icon: '📋', label: 'Реестр',      hint: 'Быстрый ввод тендеров ТО — spreadsheet-таблица.' },
    { id: 'in_work',   icon: '🧮', label: 'В работе ТО', hint: 'Статусы «готовим» и «подались».' },
    { id: 'platforms', icon: '📡', label: 'С площадок',  hint: 'TenderGuru API — пропущенные тендеры.' }
  ],
  applications: [
    { id: 'mail',  icon: '📧', label: 'Почта',     hint: 'Заявки на оценку (не приглашения!). Приглашения уходят в «Тендеры → С площадок».' },
    { id: 'phone', icon: '📞', label: 'Телефония', hint: 'Mango → SpeechKit → AI распознал заявку. Подтвердите создание тендера.' },
    { id: 'pm',    icon: '👤', label: 'От РП',     hint: 'Заявки, которые РП внёс вручную — доп. объёмы и прямые запросы.' }
  ],
  all: null
};

export default function TendersPage() {
  const { user } = useAuth();
  const modal = useModal();

  // main: 'tenders' | 'applications' | 'all'
  // sub: 'platforms'|'in_work' | 'mail'|'phone'|'pm' | null
  // tab: 'active'|'archive' — sub-toggle, только для tenders+in_work (legacy)
  const [main, setMain] = useState('tenders');
  const [sub, setSub] = useState('registry');
  const [tab, setTab] = useState('active');
  const [filters, setFilters] = useState({
    q: '', type: '', status: '', source: '', pm: '',
    periodFilter: defaultPeriodFilter(),
  });
  const [sort, setSort] = useState({ key: 'id', dir: -1 });
  const [tenders, setTenders] = useState([]);
  const [feedItems, setFeedItems] = useState([]);
  // 26.06.2026: отдельные счётчики «всех» источников (всегда грузятся в фоне),
  // чтобы цифры на главных табах не зависели от активной вкладки.
  const [feedCounts, setFeedCounts] = useState({
    applications: null, all: null,
    apps_mail: null, apps_phone: null, apps_pm: null
  });
  const [pms, setPms] = useState([]);
  const [loading, setLoading] = useState(true);
  // S-31.1 F-4: ErrorCard вместо ложного EmptyState при сетевой ошибке.
  const [loadError, setLoadError] = useState(null);
  const [showTgSettings, setShowTgSettings] = useState(false);
  const [tgRefreshKey, setTgRefreshKey] = useState(0);
  const [registryPeriodFilter, setRegistryPeriodFilter] = useState(() => defaultPeriodFilter());
  const [registryBurnOnly, setRegistryBurnOnly] = useState(false);

  /* Загрузка для tab='tenders' — старый /api/tenders endpoint (snapshot).
     Для applications/all — /api/tenders-hub/feed (UNION 4 источников). */
  const refresh = () => {
    setLoading(true);
    setLoadError(null);
    const wantTenders = (main === 'tenders');
    const wantFeed    = (main !== 'tenders');
    const tasks = [];
    // F2: тянем И PM, И HEAD_PM (vanilla tenders.js:717). Backend поддерживает comma-list.
    tasks.push(loadUsers('PM,HEAD_PM'));
    if (wantTenders) {
      tasks.push(loadTenders({
        archived: tab === 'archive',
        limit: 1000,
        periodFilter: filters.periodFilter,
      }));
    } else {
      tasks.push(Promise.resolve([]));
    }
    if (wantFeed) {
      tasks.push(loadHubFeed({
        tab: main,
        subtab: sub || '',
        periodFilter: filters.periodFilter,
        search: filters.q || '',
        status: filters.status || '',
        type:   filters.type || '',
        source: filters.source || '',
        resp:   filters.pm || '',
        limit: 200
      }));
    } else {
      tasks.push(Promise.resolve({ items: [], total: 0 }));
    }
    // 26.06.2026: всегда параллельно дёргаем applications и all целиком
    // (limit=200), чтобы счётчики «📥 Заявки», «🌐 Все», а также sub-tab'ы
    // 📧 Почта / 📞 Телефония / 👤 От РП были актуальны независимо от
    // активной вкладки. Каждый item имеет поле `kind` (inbox_application |
    // pre_tender | call), по нему считаем sub-counters.
    const countTasks = [
      loadHubFeed({ tab: 'applications', period: 'all', limit: 1 }).catch(() => ({ total: 0, subtab_counts: null })),
      loadHubFeed({ tab: 'all',          period: 'all', limit: 1 }).catch(() => ({ total: 0 }))
    ];
    Promise.all([...tasks, ...countTasks])
      .then(([pmList, tList, feed, appsFeed, allFeed]) => {
        setPms(pmList);
        setTenders(tList);
        setFeedItems(feed?.items || []);
        const sc = appsFeed?.subtab_counts;
        setFeedCounts({
          applications: appsFeed?.applications_total ?? appsFeed?.total ?? null,
          all:          allFeed?.all_total ?? allFeed?.total ?? null,
          apps_mail:    sc?.mail ?? null,
          apps_phone:   sc?.phone ?? null,
          apps_pm:      sc?.pm ?? null
        });
      })
      .catch((e) => {
        // S-31.1 F-4: фиксируем ошибку в state, чтобы отрендерить ErrorCard
        // вместо ложного EmptyState «Тендеров пока нет».
        const msg = String(e?.message || e || 'Неизвестная ошибка');
        setLoadError(msg);
        setTenders([]);
        setFeedItems([]);
        toast('Не удалось загрузить хаб', msg, 'err');
      })
      .finally(() => setLoading(false));
  };

  const periodKey = periodFilterKey(filters.periodFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [main, sub, tab, periodKey, filters.status, filters.type, filters.source, filters.pm, filters.q]);

  /* SSE-подписки top-level (R-11). Одним effect — всё рассылается через
     `asgard:sse:<event>` от useGlobalSSE singleton. Любое изменение в любом
     из 4 namespace → refresh. */
  useEffect(() => {
    const onChanged = () => refresh();
    const events = [
      'asgard:tenders:changed',
      'asgard:sse:tender:created', 'asgard:sse:tender:updated', 'asgard:sse:tender:deleted',
      'asgard:sse:pre_tender:created', 'asgard:sse:pre_tender:updated', 'asgard:sse:pre_tender:status_changed',
      'asgard:sse:inbox_applications:created', 'asgard:sse:inbox_applications:updated',
      'asgard:sse:call:created', 'asgard:sse:call:updated'
    ];
    for (const ev of events) window.addEventListener(ev, onChanged);
    return () => { for (const ev of events) window.removeEventListener(ev, onChanged); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [main, sub, tab]);

  // v2 BONUS: Tenders hotkeys — Ctrl+N новый тендер, / фокус поиска
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        modal.open(<TenderEditorModal />);
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const input = document.querySelector('input[data-searchbox="tenders"]');
        input?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v2 BONUS: deep-link ?status=... / ?tab=... / ?subtab=... из Funnel KPI
  useEffect(() => {
    const hash = String(window.location.hash || '');
    const i = hash.indexOf('?');
    if (i < 0) return;
    const params = new URLSearchParams(hash.slice(i + 1));
    const st = params.get('status');
    const mainParam = params.get('tab');
    const subParam = params.get('subtab') || params.get('sub');
    if (mainParam && ['tenders', 'applications', 'all'].includes(mainParam)) {
      setMain(mainParam);
      if (mainParam === 'tenders') setSub(subParam || 'registry');
      else if (mainParam === 'applications') setSub(subParam || 'mail');
      else setSub(null);
    } else if (subParam === 'funnel') {
      setMain('tenders');
      setSub('funnel');
    }
    if (st) {
      setFilters((f) => ({
        ...f,
        status: st,
        periodFilter: { ...defaultPeriodFilter(), mode: 'quick', quick: 'all', month: '' },
      }));
    }
    if (st || mainParam) window.history.replaceState(null, '', hash.slice(0, i));
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pmsById = useMemo(() => Object.fromEntries(pms.map((u) => [u.id, u])), [pms]);

  /* visible — для tab='tenders' клиентская фильтрация snapshot (RBAC,
     archive, period, query, type, status, source, pm). Для applications/all —
     server-side через /feed, клиентский слой только sort. */
  const visible = useMemo(() => {
    if (main !== 'tenders') {
      // Feed уже отфильтрован на сервере — но source/status/type на feed
      // tab='applications' не применяются backend'ом (там pre_tender/inbox/call,
      // не у всех есть tender_type). Применяем мягко.
      let v = feedItems;
      if (filters.q) v = filterByQuery(v, filters.q);
      if (filters.source) {
        v = v.filter((x) => (x.source_label || x.source_kind || x.source || '') === filters.source);
      }
      return v;
    }
    let v = tenders;
    if (tab === 'archive') {
      v = v.filter((t) => t.tender_status === 'Не подходит');
    } else {
      v = v.filter((t) => t.tender_status !== 'Не подходит');
    }
    // sub-tab «С площадок» — фильтр по source_kind ∈ {platform, email_invite}
    if (sub === 'platforms') {
      v = v.filter((t) =>
        ['platform', 'email_invite', 'to_manual', 'tenderguru'].includes(t.source_kind)
      );
    }
    if (user?.role === 'PM') {
      const uid = Number(user.id);
      v = v.filter((t) =>
        Number(t.pm_id) === uid ||
        Number(t.responsible_pm_id) === uid ||
        Number(t.calculator_user_id) === uid ||
        Number(t.created_by) === uid ||
        Number(t.author_user_id) === uid
      );
    }
    v = filterByQuery(v, filters.q);
    v = filterByMatch(v, 'tender_type', filters.type);
    v = filterByMatch(v, 'tender_status', filters.status);
    if (filters.source) v = v.filter((t) => (t.source_kind || '') === filters.source);
    if (filters.pm) v = v.filter((t) => String(t.pm_id) === filters.pm);
    return v;
  }, [tenders, feedItems, filters, tab, sub, main, user]);

  /* KPI: календарный месяц (1…конец), не rolling 30d. Scope ТО — свои. */
  const kpiStats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    // ISO week Mon–Sun
    const dow = (today.getDay() + 6) % 7;
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - dow); weekStart.setHours(0, 0, 0, 0);
    const weekStartMs = weekStart.getTime();
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23, 59, 59, 999);
    const weekEndMs = weekEnd.getTime();

    const role = user?.role || '';
    const isDeptWide = ['ADMIN', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role);
    const uid = user?.id;
    const mine = (t) => {
      if (!uid || isDeptWide || role !== 'TO') return true;
      return t.created_by_user_id === uid || t.created_by === uid || t.calculator_user_id === uid;
    };

    const FINAL = new Set(['отмена', 'выиграли', 'проиграли']);
    let inboxToday = 0, inWork = 0, burn = 0, addendum = 0, wonMonth = 0, lostMonth = 0;
    const hotIds = [];
    const week = { inbox: 0, submitted: 0, won: 0, lost: 0 };
    const month = { inbox: 0, submitted: 0, won: 0, lost: 0, submission_sum: 0 };

    const inRange = (ms, a, b) => Number.isFinite(ms) && ms >= a && ms <= b;

    for (const t of tenders) {
      if (!mine(t)) continue;
      const created = t.created_at && new Date(t.created_at).getTime();
      const wonMs = t.won_at ? new Date(t.won_at).getTime() : created;
      const lostMs = t.lost_at ? new Date(t.lost_at).getTime() : created;
      const submittedMs = t.submitted_at
        ? new Date(t.submitted_at).getTime()
        : (t.registry_status === 'подались' ? created : null);

      if (Number.isFinite(created) && created >= todayMs) inboxToday++;
      if (['готовим', 'подались'].includes(t.registry_status) && t.tender_status !== 'Не подходит') inWork++;
      if (t.tender_status === 'Дозапрос') addendum++;
      if (t.tender_status === 'Выиграли' && inRange(wonMs, monthStart, monthEnd)) wonMonth++;
      if (t.tender_status === 'Проиграли' && inRange(lostMs, monthStart, monthEnd)) lostMonth++;

      const st = t.registry_status || 'рассмотрение';
      if (!FINAL.has(st) && (t.docs_deadline || t.deadline_at || t.deadline)) {
        const dl = new Date(t.docs_deadline || t.deadline_at || t.deadline).getTime();
        if (Number.isFinite(dl)) {
          const days = Math.round((dl - todayMs) / 86400000);
          if (days >= 0 && days <= 3) {
            burn++;
            if (hotIds.length < 10) hotIds.push(t.id);
          }
        }
      }

      if (inRange(created, weekStartMs, weekEndMs)) week.inbox++;
      if (t.registry_status === 'подались' && inRange(submittedMs, weekStartMs, weekEndMs)) week.submitted++;
      if (t.tender_status === 'Выиграли' && inRange(wonMs, weekStartMs, weekEndMs)) week.won++;
      if (t.tender_status === 'Проиграли' && inRange(lostMs, weekStartMs, weekEndMs)) week.lost++;

      if (inRange(created, monthStart, monthEnd)) month.inbox++;
      if (t.registry_status === 'подались' && inRange(submittedMs, monthStart, monthEnd)) {
        month.submitted++;
        month.submission_sum += Number(t.submission_price_with_vat) || Number(t.submission_price) || 0;
      }
      if (t.tender_status === 'Выиграли' && inRange(wonMs, monthStart, monthEnd)) month.won++;
      if (t.tender_status === 'Проиграли' && inRange(lostMs, monthStart, monthEnd)) month.lost++;
    }

    // заявки сегодня из feed (если подгружен)
    for (const f of feedItems) {
      if (f.kind === 'tender') continue;
      const created = f.created_at && new Date(f.created_at).getTime();
      if (Number.isFinite(created) && created >= todayMs) inboxToday++;
      if (Number.isFinite(created) && inRange(created, weekStartMs, weekEndMs)) week.inbox++;
      if (Number.isFinite(created) && inRange(created, monthStart, monthEnd)) month.inbox++;
    }

    const total = wonMonth + lostMonth;
    const win_pct = total > 0 ? Math.round((wonMonth / total) * 100) : null;
    return {
      inbox_today: inboxToday,
      in_work: inWork,
      burn,
      addendum,
      won_month: wonMonth,
      win_pct,
      hotIds,
      week,
      month
    };
  }, [tenders, feedItems, user]);

  /* Счётчики на главных табах. */
  const mainCounts = useMemo(() => {
    const tendersCount = tenders.filter((t) => t.tender_status !== 'Не подходит').length;
    return {
      tenders:      tendersCount,
      applications: feedCounts.applications ?? undefined,
      all:          feedCounts.all ?? undefined
    };
  }, [tenders, feedCounts]);

  const onOpen = (t) => {
    // Универсальный onOpen — для kind='tender' открываем редактор, остальное —
    // открыть в новой вкладке или сделать пометку. Пока — для всех tender-id.
    if (t.kind && t.kind !== 'tender') {
      // Для pre_tender/inbox/call — редиректы на их страницы (отдельные).
      // Это «v2 BONUS» — vanilla тоже открывает в drawer (S-13 .pk3-drawer).
      const url = t.kind === 'pre_tender' ? `#/pre-tenders?id=${t.id}` :
                  (t.kind === 'inbox_application' || t.kind === 'application') ? `#/director-inbox?id=${t.id}` :
                  t.kind === 'call' ? `#/telephony?id=${t.id}` : null;
      if (url) { window.location.hash = url.slice(1); return; }
    }
    const tid = String(t.id || '').replace(/^TND-/, '');
    modal.open(<TenderEditorModal tenderId={tid} />, { size: 'wide' });
  };

  const onAction = (cmd, t) => {
    if (cmd === 'menu') {
      modal.open(<ActionMenuModal tender={t} onCommand={runCommand} />);
      return;
    }
    runCommand(cmd, t);
  };

  /**
   * Все валидные команды действий по тендеру.
   * 'addendum' + 'back_to_sent' добавлены S-19 — переходы через PUT /:id/status
   * для нового состояния «Дозапрос».
   * 'handoff' — переход «Новый → На анализе» (быстрая кнопка из строки).
   */
  const ACTION_COMMANDS = [
    'won', 'lost', 'cancel', 'archive', 'unarchive',
    'change_author', 'pass_request', 'tmc_request',
    'addendum', 'back_to_sent', 'handoff',
    // S-13F: переход в реестр официальной переписки по этому тендеру.
    'correspondence'
  ];

  const _statusTransition = async (tenderId, toStatus, successMsg) => {
    try {
      await putTenderStatus(tenderId, toStatus);
      toast(successMsg, '', 'ok');
      window.dispatchEvent(new CustomEvent('asgard:tenders:changed'));
    } catch (e) {
      toast('Не удалось сменить статус', String(e?.message || e), 'err');
    }
  };

  const runCommand = (cmd, t) => {
    switch (cmd) {
      case 'won':           return modal.open(<WonModal tender={t} />);
      case 'lost':          return modal.open(<LostModal tender={t} />);
      case 'cancel':        return modal.open(<CancelModal tender={t} />);
      case 'archive':       return modal.open(<ArchiveModal tender={t} />);
      case 'unarchive':     return modal.open(<UnarchiveModal tender={t} />);
      case 'change_author': return modal.open(<ChangeAuthorModal tender={t} />);
      case 'pass_request':  return modal.open(<PassRequestModal tender={t} />);
      case 'tmc_request':   return modal.open(<TmcRequestModal tender={t} />);
      case 'addendum':      return _statusTransition(t.id, 'Дозапрос', 'Переведено в «Дозапрос»');
      case 'back_to_sent':  return _statusTransition(t.id, 'КП отправлено', 'Возврат в «КП отправлено»');
      case 'handoff':       return _statusTransition(t.id, 'На анализе', 'Переведено «На анализе»');
      // S-13F Stage 4 React v2: реестр переписки по тендеру. Роут /correspondence
      // существует (App.jsx:304), HashRouter → URL станет #/correspondence?...
      case 'correspondence': {
        const tid = String(t.id || '').replace(/^TND-/, '');
        window.location.hash = `#/correspondence?parent_entity_type=tender&parent_entity_id=${tid}`;
        return;
      }
    }
    const known = ACTION_COMMANDS.join(', ');
    console.error('[Tenders] Unknown action command:', cmd, '— ожидался один из:', known);
    toast.error(`Неизвестная команда «${cmd}». Допустимы: ${known}`);
  };

  const onCreate = () => modal.open(<TenderEditorModal />);
  const onResetFilters = () => setFilters({
    q: '', type: '', status: '', source: '', pm: '',
    periodFilter: defaultPeriodFilter(),
  });

  /* Переключение main-таба → дефолтный sub. */
  const onMainChange = (id) => {
    setMain(id);
    if (id === 'tenders') setSub('registry');
    else if (id === 'applications') setSub('mail');
    else setSub(null);
  };

  const jumpToBurn = () => {
    setRegistryPeriodFilter(defaultPeriodFilter());
    setRegistryBurnOnly(true);
    setMain('tenders');
    setSub('registry');
    setTab('active');
  };

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Хаб тендеров недоступен"
        message="Раздел тендеров видят PM/HEAD_PM, ТО/HEAD_TO, директора и ADMIN."
      />
    );
  }

  // 26.06.2026 FIX: sub-табы получают count через useMemo (раньше были прочерки —
  // const SUB_TABS не содержит .count). tenders sub-counts читаются из snapshot,
  // applications sub-counts — из feedCounts (полный applications-feed, считается в refresh).
  const ACTIVE_TENDER_STATUSES = useMemo(() => new Set([
    'Новый', 'На анализе', 'Отправлено на просчёт', 'Согласование ТКП',
    'ТКП согласовано', 'Готово к отправке КП', 'КП отправлено', 'Дозапрос'
  ]), []);

  const subTabs = useMemo(() => {
    if (main === 'tenders') {
      const inWork = tenders.filter((t) =>
        ['готовим', 'подались'].includes(t.registry_status) && t.tender_status !== 'Не подходит'
      ).length;
      const base = [
        { ...SUB_TABS.tenders[0] },
        { ...SUB_TABS.tenders[1], count: inWork },
        { ...SUB_TABS.tenders[2] }
      ];
      const role = user?.role || '';
      if (['ADMIN', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role)) {
        base.push({ id: 'funnel', icon: '📊', label: 'Воронка', hint: 'Все тендеры и заявки — обзор для руководства' });
      }
      return base;
    }
    if (main === 'applications') {
      return [
        { ...SUB_TABS.applications[0], count: feedCounts.apps_mail ?? 0 },
        { ...SUB_TABS.applications[1], count: feedCounts.apps_phone ?? 0 },
        { ...SUB_TABS.applications[2], count: feedCounts.apps_pm ?? 0 }
      ];
    }
    return null;
  }, [main, tenders, feedCounts, user]);
  const showArchiveToggle = main === 'tenders' && sub === 'registry';
  const showRegistry = main === 'tenders' && (sub === 'registry' || sub === 'in_work');
  const showFunnel = main === 'tenders' && sub === 'funnel';
  const showPlatform = main === 'tenders' && sub === 'platforms';
  const registrySubtab = sub === 'in_work' ? 'in_work' : (tab === 'archive' ? 'archive' : 'registry');

  const onOpenWin = (tender) => {
    modal.open(({ close }) => (
      <WinWorkModal tender={tender} pms={pms} onClose={close} onDone={refresh} />
    ));
  };

  return (
    <div className="col gap-12">
      <TopActionsBar
        title="Хаб Тендеров"
        subtitle={
          showRegistry
            ? (tab === 'archive' ? 'Архив реестра ТО' : 'Реестр тендеров ТО')
            : showFunnel
              ? 'Воронка для руководства'
              : showPlatform
                ? 'Тендеры с площадок'
                : `${visible.length} ${pluralize(visible.length, ['обращение', 'обращения', 'обращений'])} в выборке`
        }
        actions={
          <>
            {(user?.role === 'TO' || user?.role === 'HEAD_TO') && (
              <a className="btn ghost" href="#/personal-kanban" title="Личный канбан ТО">⚔ Канбан</a>
            )}
            {showPlatform && ['ADMIN', 'TO', 'HEAD_TO'].includes(user?.role) && (
              <Btn variant="ghost" onClick={() => setShowTgSettings(v => !v)}>
                {showTgSettings ? '✕ Закрыть настройки' : '⚙ TenderGuru'}
              </Btn>
            )}
            <Btn variant="ghost" onClick={onResetFilters}>↺ Сбросить</Btn>
            <Btn onClick={onCreate} title="Ctrl+N">+ Новый тендер</Btn>
          </>
        }
      />

      {/* KPI-карточки */}
      <KpiCards stats={kpiStats} onJumpToBurn={jumpToBurn} />

      {/* Алёрт-бар горящих дедлайнов */}
      <AlertBar
        burnCount={kpiStats.burn}
        hotIds={kpiStats.hotIds}
        onShow={jumpToBurn}
      />

      {/* 3 главных таба */}
      <HubMainTabs active={main} counts={mainCounts} onChange={onMainChange} />

      {/* Sub-табы (chips) */}
      {subTabs && (
        <SubTabsBar
          tabs={subTabs}
          active={sub}
          onChange={setSub}
        />
      )}

      {showPlatform && showTgSettings && (
        <TenderGuruSettingsPanel
          user={user}
          onClose={() => setShowTgSettings(false)}
          onSaved={() => setTgRefreshKey(k => k + 1)}
        />
      )}

      {showPlatform && (
        <PlatformTendersTab key={tgRefreshKey} onRefresh={refresh} />
      )}

      {/* Активные / Архив — над реестром */}
      {showArchiveToggle && (
        <div className="tnd-sub-tabs tnd-archive-toggle" role="tablist" aria-label="Активные или архив">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'active'}
            className={'tnd-sub-pill' + (tab === 'active' ? ' on' : '')}
            onClick={() => setTab('active')}
          >
            Активные
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'archive'}
            className={'tnd-sub-pill' + (tab === 'archive' ? ' on' : '')}
            onClick={() => setTab('archive')}
          >
            Архив
          </button>
        </div>
      )}

      {showRegistry && (
        <RegistryTab
          subtab={registrySubtab}
          periodFilter={registryPeriodFilter}
          burnOnly={registryBurnOnly}
          onPeriodFilterChange={(pf) => { setRegistryPeriodFilter(pf); setRegistryBurnOnly(false); }}
          onClearBurn={() => setRegistryBurnOnly(false)}
          onOpenWin={onOpenWin}
          onRefresh={refresh}
        />
      )}

      {showFunnel && (
        <FunnelHubTab tenders={tenders} onRefresh={refresh} />
      )}

      {!showRegistry && !showPlatform && !showFunnel && (
        <>
      <TendersFilter filters={filters} onChange={setFilters} pms={pms} />

      {loading ? (
        /* S-31.1 F-7: skeleton вместо текстового «⏳ Загружаем хаб…»
           (требование промпта §D.3 «скелетоны вместо пустоты»). */
        <SkeletonRows count={6} rowHeight={52} />
      ) : loadError ? (
        /* S-31.1 F-4: ErrorCard с retry — раньше при сетевой ошибке
           показывался ложный EmptyState «Тендеров пока нет. Создайте новый». */
        <div className="tnd-error-card" role="alert" aria-live="assertive">
          <div className="tnd-error-icon" aria-hidden="true">⚠</div>
          <div className="tnd-error-title">Не удалось загрузить хаб тендеров</div>
          <div className="tnd-error-msg">{loadError}</div>
          <button
            type="button"
            className="tnd-error-retry"
            onClick={() => { setLoadError(null); refresh(); }}
          >
            ↻ Повторить
          </button>
        </div>
      ) : (
        <TendersList
          tenders={visible}
          pmsById={pmsById}
          onOpen={onOpen}
          onAction={onAction}
          sort={sort}
          onSortChange={(key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}
          mode={main === 'tenders' ? 'tenders' : 'feed'}
        />
      )}
        </>
      )}
    </div>
  );
}

function pluralize(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
