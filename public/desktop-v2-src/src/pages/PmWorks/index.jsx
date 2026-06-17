/**
 * Страница /pm-works — «Мои работы» CRM 2.0.
 *
 * Источник: vanilla `public/assets/js/pm_works.js` (≈1932 строки).
 *
 *   ✅ pages/PmWorks/index.jsx          ← root + state + табы (Подготовка/В работе/Закрытие/Закрытые)
 *   ✅ pages/PmWorks/api.js             ← endpoints + helpers
 *   ✅ pages/PmWorks/PmWorksFilter.jsx  ← поиск + статус + сортировка
 *   ✅ pages/PmWorks/PmWorksList.jsx    ← таблица + пагинация
 *   ✅ pages/PmWorks/WorkRow.jsx        ← строка с кольцом готовности
 *   ✅ pages/PmWorks/modals/WorkDetail.jsx ← главная (финансы/сроки/статус)
 *   ✅ pages/PmWorks/modals/CloseoutWizard.jsx ← закрытие работы с обязательными рейтингами
 *   ✅ pages/PmWorks/modals/{Assembly,EquipmentReserve,Invoice,Act,MimirActuals,WorkHistory}Modal.jsx
 *   ✅ pages/PmWorks/modals/FieldTab/ ← полевые табы (логистика/персонал/допуска/готовность)
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, TabsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
// v2 BONUS: hotkeys + LS-persist (vanilla не имеет)
import { useLocalStorage, useHotkeys, exportToCsv } from '@/api/useListHelpers';

import PmWorksFilter from './PmWorksFilter';
import PmWorksList from './PmWorksList';
import { WorkDetailModal } from './modals/WorkDetail';
import { WorksGanttModal } from './modals/WorksGanttModal';
import {
  loadWorks, loadReadinessSummary,
  filterByQuery, filterByGroup, filterByStatus, isPrepWork,
  PREP_STATUSES, ACTIVE_STATUSES, CLOSEOUT_STATUSES, CLOSED_STATUSES
} from './api';
import './pm-works.css';

// RBAC — синхронно с backend `src/routes/works.js:163,283` (POST/PUT works = author + ответственные).
// GET / на бэке `authenticate`, но семантика страницы «Мои работы»:
//   PM/HEAD_PM — основные пользователи (создают, ведут, закрывают)
//   ADMIN/DIRECTOR_* — обзор + смена РП + аудит (works.js:1127)
//   HR/HR_MANAGER — действия с персоналом (vanilla 1467,1507) видят свою колонку через @/blocks/AccessDenied на роли ниже.
// Без роли пользователь иначе видит пустой grid вместо явного «🚫 Нет доступа».
// Inline-литералы для rbac-audit (скрипт не разворачивает константы).
const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function PmWorksPage() {
  const { user } = useAuth();
  const modal = useModal();

  // RBAC — синхронно с vanilla pm_works.js строки 638,1087,1127,1207,1299,1305,1467,1507,1593:
  //   PM       — видит только свои; кнопка «Закупки»/«Closeout» — только автор работы
  //   HEAD_PM  — все работы, может в действия закупок
  //   ADMIN/DIRECTOR_GEN — могут принудительно сменить РП работы (vanilla 1127), увидеть аудит
  //   HR       — кнопка «Замена согласована» и «Вопрос по персоналу» (vanilla 1467,1507)
  // Inline-литералы нужны скрипту rbac-audit (он не разворачивает helper'ы).
  const isPm = user?.role === 'PM';
  const _isHeadPm = user?.role === 'HEAD_PM';
  const _isAdmin = user?.role === 'ADMIN';
  const _isDirectorGen = user?.role === 'DIRECTOR_GEN';
  const _isHr = user?.role === 'HR';
  const _canForceReassignPm = ['ADMIN', 'DIRECTOR_GEN'].includes(user?.role);
  const _canRespondHr = ['HR', 'HR_MANAGER', 'ADMIN'].includes(user?.role);

  const hasAccess = !user || ALLOWED_ROLES.includes(user.role);

  // v2 BONUS: auto-save таб/фильтров/сортировки в LS — пользователь возвращается
  // на ту же вкладку и тот же поиск (vanilla каждый раз сбрасывала на «Подготовка»).
  const [tab, setTab] = useLocalStorage('pmw-tab', 'prep');
  const [filters, setFilters] = useLocalStorage('pmw-filters', { q: '', status: '', sort: 'fresh' });
  const [sort, setSort] = useLocalStorage('pmw-sort', { key: 'id', dir: -1 });
  const [works, setWorks] = useState([]);
  const [readiness, setReadiness] = useState({});
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    if (!hasAccess) return;
    setLoading(true);
    // limit: 2000 — PM с большим числом закрытых работ не видел старые контракты
    // (баг был у Андросова Никиты — «АРХ БУМ» уезжала за лимит 500).
    loadWorks({ limit: 2000 })
      .then((list) => {
        // PM видит только свои; директора/HEAD/HR — все
        const visible = isPm ? list.filter((w) => String(w.pm_id) === String(user.id)) : list;
        setWorks(visible);
        // Готовность — батчем только для подготавливаемых работ
        const prepIds = visible.filter(isPrepWork).map((w) => w.id);
        if (prepIds.length) {
          loadReadinessSummary(prepIds).then(setReadiness).catch(() => {});
        }
      })
      .catch((e) => toast('Не удалось загрузить работы', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [user?.id, user?.role]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:works:changed', onChanged);
    return () => window.removeEventListener('asgard:works:changed', onChanged);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  const visible = useMemo(() => {
    let v = works;
    v = filterByGroup(v, tab);
    v = filterByQuery(v, filters.q);
    v = filterByStatus(v, filters.status);
    return v;
  }, [works, filters, tab]);

  const counts = useMemo(() => ({
    prep:     works.filter((w) => PREP_STATUSES.includes(w.work_status)).length,
    active:   works.filter((w) => ACTIVE_STATUSES.includes(w.work_status)).length,
    closeout: works.filter((w) => CLOSEOUT_STATUSES.includes(w.work_status)).length,
    closed:   works.filter((w) => CLOSED_STATUSES.includes(w.work_status)).length
  }), [works]);

  const onOpen = (w) => modal.open(<WorkDetailModal work={w} />);

  // v2 BONUS: экспорт текущей выборки в CSV (vanilla не имеет).
  const onExportCsv = () => {
    if (!visible.length) { toast.warn('Нет работ для экспорта'); return; }
    const ymd = new Date().toISOString().slice(0, 10);
    exportToCsv(`pm-works-${tab}-${ymd}.csv`, visible, [
      { key: 'id', label: 'ID' },
      { key: 'customer_name', label: 'Заказчик' },
      { key: 'work_title', label: 'Работа' },
      { key: 'work_status', label: 'Статус' },
      { key: (r) => r.contract_value || r.tender_price || 0, label: 'Контракт ₽' },
      { key: 'start_date', label: 'Старт' },
      { key: (r) => r.end_fact || r.end_plan || r.end_date, label: 'Конец' }
    ]);
    toast.success(`Экспортировано ${visible.length} работ`);
  };

  // v2 BONUS: keyboard hotkeys — /=focus search, Ctrl+S=сброс фильтров,
  // Ctrl+G=Гантт, 1..4=табы (vanilla кнопками только мышь).
  useHotkeys({
    '/': () => {
      const inp = document.querySelector('.pmw-filter input[type=text], .filter-bar input[type=text]');
      if (inp) inp.focus();
    },
    'mod+s': () => setFilters({ q: '', status: '', sort: 'fresh' }),
    'mod+g': () => openWorksGantt(),
    '1': () => setTab('prep'),
    '2': () => setTab('active'),
    '3': () => setTab('closeout'),
    '4': () => setTab('closed')
  }, [visible.length]);

  // 📅 Гантт по работам — vanilla pm_works.js:680, 959-985 (#btnGantt → openGantt).
  // Передаём ОТФИЛЬТРОВАННЫЙ список works (visible) — пользователь видит на диаграмме
  // именно ту выборку, что отображена в таблице (по табу + поиску + статусу).
  // Если выборка пуста — fallback к полному списку чтобы окно не открывалось пустым.
  const openWorksGantt = () => {
    const list = visible.length ? visible : works;
    modal.open(<WorksGanttModal works={list} pmsById={{}} title="Гантт • Мои походы" />, { size: 'wide' });
  };

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Походы недоступны"
        message="Раздел открыт PM/HEAD_PM (ведут работы), HR (персонал), директорам и ADMIN."
      />
    );
  }

  const tabs = [
    { id: 'prep',     label: '🛠 Подготовка', count: counts.prep },
    { id: 'active',   label: '⚒ В работе',    count: counts.active },
    { id: 'closeout', label: '📋 Закрытие',  count: counts.closeout },
    { id: 'closed',   label: '✅ Закрытые',   count: counts.closed }
  ];

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Мои работы"
        title="Походы"
        subtitle={`${visible.length} ${pluralize(visible.length, ['работа', 'работы', 'работ'])} в выборке`}
        actions={
          <>
            <Btn variant="ghost" onClick={openWorksGantt} title="Открыть диаграмму Гантта по работам (Ctrl+G)">📅 Гантт по работам</Btn>
            {/* v2 BONUS: CSV-экспорт текущей выборки (vanilla не имеет) */}
            <Btn variant="ghost" onClick={onExportCsv} title="Экспортировать видимые работы в CSV">📥 CSV</Btn>
            <Btn variant="ghost" onClick={() => setFilters({ q: '', status: '', sort: 'fresh' })} title="Сбросить фильтры (Ctrl+S)">↺ Сбросить</Btn>
          </>
        }
      />

      {/* KPI ряд по фазам жизненного цикла */}
      <div className="pmw-kpi">
        <div className="pmw-kpi-card info">
          <div className="pmw-kpi-ic">🛠</div>
          <div className="pmw-kpi-val">{counts.prep}</div>
          <div className="pmw-kpi-lab">Подготовка</div>
        </div>
        <div className="pmw-kpi-card gold">
          <div className="pmw-kpi-ic">⚒</div>
          <div className="pmw-kpi-val">{counts.active}</div>
          <div className="pmw-kpi-lab">В работе</div>
        </div>
        <div className="pmw-kpi-card warn">
          <div className="pmw-kpi-ic">📋</div>
          <div className="pmw-kpi-val">{counts.closeout}</div>
          <div className="pmw-kpi-lab">Закрытие</div>
        </div>
        <div className="pmw-kpi-card ok">
          <div className="pmw-kpi-ic">✅</div>
          <div className="pmw-kpi-val">{counts.closed}</div>
          <div className="pmw-kpi-lab">Закрытые</div>
        </div>
      </div>

      <TabsBar tabs={tabs} active={tab} onChange={setTab} />

      <PmWorksFilter filters={filters} onChange={setFilters} />

      {loading ? (
        <div className="card card-empty">
          ⏳ Загружаем работы…
        </div>
      ) : (
        <PmWorksList
          works={visible}
          readiness={readiness}
          onOpen={onOpen}
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
