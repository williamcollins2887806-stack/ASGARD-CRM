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
import { TopActionsBar } from '@/blocks/Blocks';
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
import DistributionPanel from './panels/DistributionPanel';
import WinAssignPanel from './panels/WinAssignPanel';
import KpReadyPanel from './panels/KpReadyPanel';
import {
  loadTenders, loadUsers, loadHubFeed, putTenderStatus,
  filterByPeriod, filterByQuery, filterByMatch
} from './api';
import './tenders.css';

/* Sub-табы конфигурация (1:1 с vanilla S-13). */
const SUB_TABS = {
  tenders: [
    { id: 'platforms', icon: '📡', label: 'С площадок',  hint: 'Письма-приглашения, которые AI распознал и сразу создал тендером. Парсинг ЭТП — в разработке.' },
    { id: 'in_work',   icon: '🧮', label: 'В работе ТО', hint: 'Активные тендеры ТО. Кликните по строке — откроется карточка с этапами.' }
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
  const [sub, setSub] = useState('in_work');
  const [tab, setTab] = useState('active');
  const [filters, setFilters] = useState({ q: '', period: 'month', type: '', status: '', source: '', pm: '' });
  const [sort, setSort] = useState({ key: 'id', dir: -1 });
  const [tenders, setTenders] = useState([]);
  const [feedItems, setFeedItems] = useState([]);
  const [pms, setPms] = useState([]);
  const [loading, setLoading] = useState(true);

  /* Загрузка для tab='tenders' — старый /api/tenders endpoint (snapshot).
     Для applications/all — /api/tenders-hub/feed (UNION 4 источников). */
  const refresh = () => {
    setLoading(true);
    const wantTenders = (main === 'tenders');
    const wantFeed    = (main !== 'tenders');
    const tasks = [];
    tasks.push(loadUsers('PM'));
    if (wantTenders) {
      tasks.push(loadTenders({ archived: tab === 'archive', limit: 1000 }));
    } else {
      tasks.push(Promise.resolve([]));
    }
    if (wantFeed) {
      // Period в feed-формате: month/quarter/year → 30d/year/year; week → 7d; today → 3d.
      const periodMap = { today: '3d', week: '7d', month: '30d', quarter: 'year', year: 'year', all: 'all' };
      const feedPeriod = periodMap[filters.period] || 'all';
      tasks.push(loadHubFeed({
        tab: main,
        subtab: sub || '',
        period: feedPeriod,
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
    Promise.all(tasks)
      .then(([pmList, tList, feed]) => {
        setPms(pmList);
        setTenders(tList);
        setFeedItems(feed?.items || []);
      })
      .catch((e) => toast('Не удалось загрузить хаб', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [main, sub, tab, filters.period, filters.status, filters.type, filters.source, filters.pm, filters.q]);

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
    const subParam = params.get('subtab');
    if (mainParam && ['tenders', 'applications', 'all'].includes(mainParam)) {
      setMain(mainParam);
      if (mainParam === 'tenders') setSub(subParam || 'in_work');
      else if (mainParam === 'applications') setSub(subParam || 'mail');
      else setSub(null);
    }
    if (st) setFilters((f) => ({ ...f, status: st, period: 'all' }));
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
      if (filters.source) v = v.filter((x) => (x.source_kind || x.source || '') === filters.source);
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
      v = v.filter((t) => t.source_kind === 'platform' || t.source_kind === 'email_invite');
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
    v = filterByPeriod(v, filters.period);
    v = filterByQuery(v, filters.q);
    v = filterByMatch(v, 'tender_type', filters.type);
    v = filterByMatch(v, 'tender_status', filters.status);
    if (filters.source) v = v.filter((t) => (t.source_kind || '') === filters.source);
    if (filters.pm) v = v.filter((t) => String(t.pm_id) === filters.pm);
    return v;
  }, [tenders, feedItems, filters, tab, sub, main, user]);

  /* KPI считаются из tenders snapshot (всё что есть, без current-tab фильтра). */
  const kpiStats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const month30 = todayMs - 30 * 86400000;
    let inboxToday = 0, inWork = 0, burn = 0, addendum = 0, wonMonth = 0;
    const hotIds = [];
    const ACTIVE_STATUSES = new Set([
      'Новый', 'На анализе', 'Отправлено на просчёт', 'Согласование ТКП',
      'ТКП согласовано', 'Готово к отправке КП', 'КП отправлено', 'Дозапрос'
    ]);
    for (const t of tenders) {
      const created = t.created_at && new Date(t.created_at).getTime();
      if (Number.isFinite(created) && created >= todayMs) inboxToday++;
      if (ACTIVE_STATUSES.has(t.tender_status)) inWork++;
      if (t.tender_status === 'Дозапрос') addendum++;
      if (t.tender_status === 'Выиграли' && Number.isFinite(created) && created >= month30) wonMonth++;
      // Burn — активный + deadline ≤ 3 дня
      if (ACTIVE_STATUSES.has(t.tender_status) && (t.deadline_at || t.deadline)) {
        const dl = new Date(t.deadline_at || t.deadline).getTime();
        if (Number.isFinite(dl)) {
          const days = Math.round((dl - todayMs) / 86400000);
          if (days >= 0 && days <= 3) {
            burn++;
            if (hotIds.length < 10) hotIds.push(t.id);
          }
        }
      }
    }
    // Конверсия = won / (won+lost) за месяц
    let lostMonth = 0;
    for (const t of tenders) {
      const created = t.created_at && new Date(t.created_at).getTime();
      if (Number.isFinite(created) && created >= month30 && t.tender_status === 'Проиграли') lostMonth++;
    }
    const total = wonMonth + lostMonth;
    const win_pct = total > 0 ? Math.round((wonMonth / total) * 100) : null;
    return { inbox_today: inboxToday, in_work: inWork, burn, addendum, won_month: wonMonth, win_pct, hotIds };
  }, [tenders]);

  /* Счётчики на главных табах. tenders — snapshot length после base-фильтра
     (не подходит=archive, sub=platforms). applications/all — из feedItems
     (что прилетело на этом запросе). */
  const mainCounts = useMemo(() => {
    const tendersCount = tenders.filter((t) => t.tender_status !== 'Не подходит').length;
    let appsCount = 0;
    let allCount  = 0;
    if (main === 'applications') appsCount = feedItems.length;
    if (main === 'all')          allCount  = feedItems.length;
    return { tenders: tendersCount, applications: appsCount || undefined, all: allCount || undefined };
  }, [tenders, feedItems, main]);

  const onOpen = (t) => {
    // Универсальный onOpen — для kind='tender' открываем редактор, остальное —
    // открыть в новой вкладке или сделать пометку. Пока — для всех tender-id.
    if (t.kind && t.kind !== 'tender') {
      // Для pre_tender/inbox/call — редиректы на их страницы (отдельные).
      // Это «v2 BONUS» — vanilla тоже открывает в drawer (S-13 .pk3-drawer).
      const url = t.kind === 'pre_tender' ? `#/pre-tenders?id=${t.id}` :
                  t.kind === 'inbox_application' ? `#/director-inbox?id=${t.id}` :
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
    'addendum', 'back_to_sent', 'handoff'
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
    }
    const known = ACTION_COMMANDS.join(', ');
    console.error('[Tenders] Unknown action command:', cmd, '— ожидался один из:', known);
    toast.error(`Неизвестная команда «${cmd}». Допустимы: ${known}`);
  };

  const onCreate = () => modal.open(<TenderEditorModal />);
  const onResetFilters = () => setFilters({ q: '', period: 'all', type: '', status: '', source: '', pm: '' });

  /* Переключение main-таба → дефолтный sub. */
  const onMainChange = (id) => {
    setMain(id);
    if (id === 'tenders') setSub('in_work');
    else if (id === 'applications') setSub('mail');
    else setSub(null);
  };

  const jumpToBurn = () => {
    setFilters((f) => ({ ...f, status: '', period: 'week' }));
    setMain('tenders'); setSub('in_work'); setTab('active');
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

  const subTabs = SUB_TABS[main];
  const showPanels = main === 'tenders' && sub === 'in_work' && tab === 'active';
  const showArchiveToggle = main === 'tenders' && sub === 'in_work';
  const showPlatformStub = main === 'tenders' && sub === 'platforms';

  return (
    <div className="col gap-12">
      <TopActionsBar
        title="Хаб Тендеров"
        subtitle={`${visible.length} ${pluralize(visible.length, ['обращение', 'обращения', 'обращений'])} в выборке`}
        actions={
          <>
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

      {/* CTA-карточка перехода в канбан ТО */}
      {(user?.role === 'TO' || user?.role === 'HEAD_TO') && (
        <div className="tnd-kanban-cta">
          <div className="tnd-kanban-cta-ic" aria-hidden>⚔</div>
          <div className="tnd-kanban-cta-text">
            <div className="tnd-kanban-cta-h">Личный канбан ТО — управление по этапам</div>
            <div className="tnd-kanban-cta-p">Drag &amp; drop карточек по 9 колонкам жизненного цикла.</div>
          </div>
          <a className="tnd-kanban-cta-btn" href="#/personal-kanban">⚔ Открыть канбан</a>
        </div>
      )}

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

      {/* Stub площадок (parsing ETP) */}
      {showPlatformStub && (
        <div className="tnd-platform-stub">
          <div className="tnd-platform-stub-ic" aria-hidden>🛰</div>
          <div className="tnd-platform-stub-txt">
            <div className="tnd-platform-stub-h">Парсинг ЭТП — в разработке</div>
            <div className="tnd-platform-stub-p">
              Интеграция с zakupki.gov.ru, B2B-Center, РТС-Тендер и другими площадками — позже.
              Сейчас тендеры с площадок приходят так: AI распознаёт письмо-приглашение и сразу создаёт тендер ниже.
            </div>
          </div>
        </div>
      )}

      {/* Sub-toggle «Активные / Архив» — только в Тендеры → В работе ТО */}
      {showArchiveToggle && (
        <div className="tnd-sub-tabs">
          <button
            type="button"
            className={'tnd-sub-pill' + (tab === 'active' ? ' on' : '')}
            onClick={() => setTab('active')}
          >
            Активные
          </button>
          <button
            type="button"
            className={'tnd-sub-pill' + (tab === 'archive' ? ' on' : '')}
            onClick={() => setTab('archive')}
          >
            📁 Архив
          </button>
        </div>
      )}

      {/* Оперативные панели — только в Тендеры → В работе → Активные */}
      {showPanels && (
        <>
          <DistributionPanel user={user} />
          <WinAssignPanel user={user} />
          <KpReadyPanel user={user} />
        </>
      )}

      <TendersFilter filters={filters} onChange={setFilters} pms={pms} />

      {loading ? (
        <div className="card card-empty">
          ⏳ Загружаем хаб…
        </div>
      ) : (
        <TendersList
          tenders={visible}
          pmsById={pmsById}
          onOpen={onOpen}
          onAction={onAction}
          sort={sort}
          onSortChange={(key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}
        />
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
