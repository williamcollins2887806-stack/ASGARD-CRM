/**
 * Страница /tenders — полная версия CRM 2.0.
 *
 * Источник: vanilla `public/assets/js/tenders.js` (4529 строк, IIFE `AsgardTendersPage`).
 *
 *   ✅ pages/Tenders/index.jsx          ← root + state + tabs (Активные / Архив) + 3 панели
 *   ✅ pages/Tenders/api.js             ← loadTenders + фильтрация
 *   ✅ pages/Tenders/TendersFilter.jsx  ← 5 фильтров + поиск
 *   ✅ pages/Tenders/TendersList.jsx    ← таблица + пагинация + сортировка
 *   ✅ pages/Tenders/TenderRow.jsx      ← строка
 *   ✅ pages/Tenders/modals/TenderEditor.jsx  ← 3-шаговый wizard
 *   ✅ pages/Tenders/modals/ActionMenu.jsx    ← меню действий (троеточие в строке)
 *   ✅ pages/Tenders/modals/StatusModals.jsx  ← Won/Lost/Cancel/Archive/Unarchive/ChangeAuthor
 *   ✅ pages/Tenders/panels/DistributionPanel.jsx (TO/HEAD_TO раздача через /assign-calculator)
 *   ✅ pages/Tenders/panels/WinAssignPanel.jsx    (привязка работы через /assign-work-pm)
 *   ✅ pages/Tenders/panels/KpReadyPanel.jsx      (отправка КП)
 *   ✅ pages/Tenders/modals/PassRequestModal.jsx  (POST /api/pass-requests)
 *   ✅ pages/Tenders/modals/TmcRequestModal.jsx   (POST /api/tmc-requests)
 *
 *   ⏳ ZIP-распаковка документов на клиенте (JSZip)
 *   ⏳ Комментарии к тендеру (лента)
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, TabsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';

// RBAC синхронно с backend `src/routes/tenders.js:268` (GET /api/tenders).
// Inline-литералы для скрипта rbac-audit.
const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

import TendersFilter from './TendersFilter';
import TendersList from './TendersList';
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
  loadTenders, loadUsers,
  filterByPeriod, filterByQuery, filterByMatch
} from './api';
import './tenders.css';

export default function TendersPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [tab, setTab] = useState('active');
  const [filters, setFilters] = useState({ q: '', period: 'month', type: '', status: '', pm: '' });
  const [sort, setSort] = useState({ key: 'id', dir: -1 });
  const [tenders, setTenders] = useState([]);
  const [pms, setPms] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      loadTenders({ archived: tab === 'archive', limit: 1000 }),
      loadUsers('PM')
    ])
      .then(([list, pmList]) => {
        setTenders(list);
        setPms(pmList);
      })
      .catch((e) => toast('Не удалось загрузить тендеры', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [tab]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:tenders:changed', onChanged);
    return () => window.removeEventListener('asgard:tenders:changed', onChanged);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // v2 BONUS: Tenders hotkeys — Ctrl+N новый тендер, A/V переключение табов, / фокус поиска (vanilla не имеет)
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
      } else if (e.key === 'a' && !e.ctrlKey && !e.metaKey && tab !== 'active') {
        setTab('active');
      } else if (e.key === 'v' && !e.ctrlKey && !e.metaKey && tab !== 'archive') {
        setTab('archive');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // v2 BONUS: deep-link ?status=... из Funnel KPI «Выиграно» (vanilla не имеет deep-link)
  useEffect(() => {
    const hash = String(window.location.hash || '');
    const i = hash.indexOf('?');
    if (i < 0) return;
    const params = new URLSearchParams(hash.slice(i + 1));
    const st = params.get('status');
    if (st) {
      setFilters((f) => ({ ...f, status: st, period: 'all' }));
      window.history.replaceState(null, '', hash.slice(0, i));
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pmsById = useMemo(() => Object.fromEntries(pms.map((u) => [u.id, u])), [pms]);

  /* RBAC vanilla (tenders.js:601..604): PM-роль видит только свои тендеры
     (где он автор / РП / отв. РП / расчётчик). Остальные роли — весь список.
     Без этой фильтрации PM видел чужие тендеры, что было багом миграции. */
  const visible = useMemo(() => {
    let v = tenders;
    // Архив в БД хранится как «Не подходит» (см. vanilla tenders.js:1020).
    // Ранее фильтрация по 'archived' (английскому) всегда возвращала 0 — табы счётчики были сломаны.
    if (tab === 'archive') {
      v = v.filter((t) => t.tender_status === 'Не подходит');
    } else {
      v = v.filter((t) => t.tender_status !== 'Не подходит');
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
    if (filters.pm) v = v.filter((t) => String(t.pm_id) === filters.pm);
    return v;
  }, [tenders, filters, tab, user]);

  const counts = useMemo(() => ({
    active: tenders.filter((t) => t.tender_status !== 'Не подходит').length,
    archive: tenders.filter((t) => t.tender_status === 'Не подходит').length
  }), [tenders]);

  const onOpen = (t) => {
    // Карточка с табами — широкая модалка (комменты + история + ДС + документы помещаются).
    modal.open(<TenderEditorModal tenderId={t.id} />, { size: 'wide' });
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
   * Список синхронизирован с `Tenders/modals/ActionMenu.jsx::actions`.
   * При добавлении новой команды:
   *   1) добавить id в ACTION_COMMANDS,
   *   2) добавить ветку в switch ниже (TypeScript-style exhaustive),
   *   3) добавить пункт в ActionMenu.actions.
   * Никакого `default: toast(...)` — это маскирует баги (опечатки cmd).
   */
  const ACTION_COMMANDS = [
    'won', 'lost', 'cancel', 'archive', 'unarchive',
    'change_author', 'pass_request', 'tmc_request'
  ];

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
    }
    // Дошли сюда — значит cmd НЕ из ACTION_COMMANDS (опечатка или новая команда
    // забыли добавить в switch). Громко падаем в консоль и тост, чтобы заметили.
    const known = ACTION_COMMANDS.join(', ');
    console.error('[Tenders] Unknown action command:', cmd, '— ожидался один из:', known);
    toast.error(`Неизвестная команда «${cmd}». Допустимы: ${known}`);
  };
  const onCreate = () => modal.open(<TenderEditorModal />);
  const onResetFilters = () => setFilters({ q: '', period: 'all', type: '', status: '', pm: '' });

  const tabs = [
    { id: 'active',  label: 'Активные', count: counts.active },
    { id: 'archive', label: 'Архив',    count: counts.archive }
  ];

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Тендеры недоступны"
        message="Раздел тендеров видят PM/HEAD_PM, ТО/HEAD_TO, директора и ADMIN."
      />
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        title="Сага Тендеров"
        subtitle={`${visible.length} ${pluralize(visible.length, ['тендер', 'тендера', 'тендеров'])} в выборке`}
        actions={
          <>
            <Btn variant="ghost" onClick={onResetFilters}>↺ Сбросить</Btn>
            {/* v2 BONUS: Ctrl+N hotkey hint в tooltip (vanilla — только мышью) */}
            <Btn onClick={onCreate} title="Ctrl+N">+ Новый тендер</Btn>
          </>
        }
      />

      <TabsBar tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'active' && (
        <>
          <DistributionPanel user={user} />
          <WinAssignPanel user={user} />
          <KpReadyPanel user={user} />
        </>
      )}

      <TendersFilter filters={filters} onChange={setFilters} pms={pms} />

      {loading ? (
        <div className="card card-empty">
          ⏳ Загружаем тендеры…
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
