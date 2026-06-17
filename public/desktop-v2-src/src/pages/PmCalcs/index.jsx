/**
 * Страница /pm-calcs — «Просчёты (inbox)» для PM.
 *
 * Источник: vanilla `public/assets/js/pm_calcs.js` (≈1323 строки).
 *
 *   ✅ pages/PmCalcs/index.jsx          ← root + табы + tkp-ready
 *   ✅ pages/PmCalcs/api.js             ← endpoints + helpers + KPI-функции
 *   ✅ pages/PmCalcs/PmCalcsFilter.jsx  ← поиск + период + статус + чекбоксы
 *   ✅ pages/PmCalcs/PmCalcsList.jsx    ← таблица + AI Мимир статусы + пагинация
 *   ✅ pages/PmCalcs/TkpReadyPanel.jsx  ← согласованные → создать ТКП
 *   ✅ pages/PmCalcs/modals/QuickCalcModal.jsx — быстрый ручной просчёт с KPI зон
 *   ✅ pages/PmCalcs/modals/TenderCalcModal.jsx — главная: тендер + версии оценок + редактор
 *
 * Никаких заглушек. Все кнопки работают.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';

import PmCalcsFilter from './PmCalcsFilter';
import PmCalcsList from './PmCalcsList';
import TkpReadyPanel from './TkpReadyPanel';
import { QuickCalcModal } from './modals/QuickCalcModal';
import { TenderCalcModal } from './modals/TenderCalcModal';
import { EstimateMethodPicker } from '@/modals/EstimateMethodPicker';
import {
  loadTendersInbox, loadUsers,
  filterByPeriod, filterByQuery
} from './api';
import './pm-calcs.css';

// RBAC — синхронно с backend `src/routes/estimates.js:350,465` (POST/PUT просчёта).
// GET `/api/estimates` сам по себе auth-only, но семантика страницы — создание/просмотр просчётов
// (только участники цикла «тендер → ТКП → согласование»).
// Inline-литералы нужны скрипту rbac-audit (он не разворачивает константы).
const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function PmCalcsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const isDirector = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM'].includes(user?.role);
  const isPm = user?.role === 'PM';
  // RBAC: создавать просчёт (vanilla pm_calcs.js:1240) — только PM/HEAD_PM/ADMIN.
  const canCreate = ['PM', 'HEAD_PM', 'ADMIN'].includes(user?.role);

  const hasAccess = !user || ALLOWED_ROLES.includes(user.role);

  const [filters, setFilters] = useState({ q: '', period: '24m', status: '', pm: '', includeLost: false, includeWon: false });
  const [sort, setSort] = useState({ key: 'created_at', dir: -1 });
  const [tenders, setTenders] = useState([]);
  const [pms, setPms] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    if (!hasAccess) return;
    setLoading(true);
    Promise.all([
      loadTendersInbox(isPm ? user.id : null),
      loadUsers('PM')
    ])
      .then(([list, pmList]) => {
        setTenders(list);
        setPms(pmList);
      })
      .catch((e) => toast('Не удалось загрузить просчёты', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user?.id) refresh(); }, [user?.id, user?.role]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:pmcalcs:changed', onChanged);
    window.addEventListener('asgard:tenders:changed', onChanged);
    return () => {
      window.removeEventListener('asgard:pmcalcs:changed', onChanged);
      window.removeEventListener('asgard:tenders:changed', onChanged);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // v2 BONUS: hotkeys (Ctrl+N — быстрый просчёт, / фокус поиска, Esc сброс) — vanilla не имеет
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && canCreate) {
        e.preventDefault();
        modal.open(<QuickCalcModal onCreated={() => refresh()} />);
      } else if (!e.ctrlKey && !e.metaKey) {
        if (e.key === '/') { e.preventDefault(); document.querySelector('input[data-searchbox="pmcalcs"]')?.focus(); }
        else if (e.key === 'Escape' && (filters.q || filters.status || filters.pm)) {
          setFilters({ q: '', period: '24m', status: '', pm: '', includeLost: false, includeWon: false });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.status, filters.pm, canCreate]);

  const pmsById = useMemo(() => Object.fromEntries(pms.map((u) => [u.id, u])), [pms]);

  const visible = useMemo(() => {
    let v = tenders;
    // Backend хранит RUSSIAN строки. Все эти english-сравнения никогда не срабатывали —
    // фильтр «не показывать проигранные» был сломан, инкрементальный счётчик считал 0.
    if (!filters.includeLost) {
      v = v.filter((t) => !['Проиграли', 'Не подходит'].includes(t.tender_status));
    }
    if (!filters.includeWon) {
      v = v.filter((t) => t.tender_status !== 'Выиграли');
    }
    // Только просчёты — у которых есть handoff_at или responsible_pm_id или статус «активного просчёта»
    v = v.filter((t) =>
      t.responsible_pm_id != null || t.handoff_at ||
      t.tender_status === 'Отправлено на просчёт' ||
      t.tender_status === 'Согласование ТКП' ||
      t.tender_status === 'ТКП согласовано' ||
      t.tender_status === 'Новый'
    );
    v = filterByPeriod(v, filters.period, 'handoff_at');
    v = filterByQuery(v, filters.q);
    if (filters.status) v = v.filter((t) => t.tender_status === filters.status);
    if (filters.pm) v = v.filter((t) => String(t.responsible_pm_id || t.pm_id) === filters.pm);
    return v;
  }, [tenders, filters]);

  const onOpen = (t) => modal.open(<TenderCalcModal tender={t} />);

  const onMimir = (t) => {
    modal.open(<EstimateMethodPicker tender={t} />);
  };

  const onQuickCalc = () => modal.open(<QuickCalcModal onCreated={() => refresh()} />);

  // KPI-ряд: всего / в работе / на согласовании / выиграно
  const kpi = useMemo(() => {
    const all = visible.length;
    const inWork = visible.filter((t) => ['Новый', 'Отправлено на просчёт'].includes(t.tender_status)).length;
    const approval = visible.filter((t) => ['Согласование ТКП', 'КП отправлено'].includes(t.tender_status)).length;
    const won = visible.filter((t) => t.tender_status === 'Выиграли').length;
    return { all, inWork, approval, won };
  }, [visible]);

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Просчёты недоступны"
        message="Раздел открыт PM/HEAD_PM (создают), TO/HEAD_TO (тендерный отдел), директорам и ADMIN."
      />
    );
  }

  return (
    <div className="col gap-14">
      <TopActionsBar
        title="Просчёты (inbox)"
        subtitle={`${visible.length} ${pluralize(visible.length, ['просчёт', 'просчёта', 'просчётов'])} в выборке`}
        actions={
          <>
            <Btn variant="ghost" onClick={() => setFilters({ q: '', period: '24m', status: '', pm: '', includeLost: false, includeWon: false })}>↺ Сбросить</Btn>
            {/* v2 BONUS: Ctrl+N hint */}
            {canCreate && <Btn variant="primary" onClick={onQuickCalc} title="Ctrl+N">+ Быстрый просчёт</Btn>}
          </>
        }
      />

      {/* KPI-ряд сверху */}
      {/* v2 BONUS: KPI-карточки кликабельны → drill-down фильтра по статусу + checkbox includeWon (vanilla не имел) */}
      <div className="pmc-hero">
        <div
          className="pmc-hero-card info"
          style={{ cursor: 'pointer' }}
          title="Сбросить фильтр статуса"
          onClick={() => setFilters((f) => ({ ...f, status: '' }))}
        >
          <div className="pmc-hero-ic">📥</div>
          <div className="pmc-hero-val">{kpi.all}</div>
          <div className="pmc-hero-lab">В выборке</div>
        </div>
        <div
          className="pmc-hero-card gold"
          style={{ cursor: 'pointer' }}
          title="Показать только в просчёте"
          onClick={() => setFilters((f) => ({ ...f, status: 'Отправлено на просчёт' }))}
        >
          <div className="pmc-hero-ic">🧮</div>
          <div className="pmc-hero-val">{kpi.inWork}</div>
          <div className="pmc-hero-lab">В просчёте</div>
        </div>
        <div
          className="pmc-hero-card info"
          style={{ cursor: 'pointer' }}
          title="Показать на согласовании"
          onClick={() => setFilters((f) => ({ ...f, status: 'Согласование ТКП' }))}
        >
          <div className="pmc-hero-ic">⏳</div>
          <div className="pmc-hero-val">{kpi.approval}</div>
          <div className="pmc-hero-lab">На согласовании</div>
        </div>
        <div
          className="pmc-hero-card ok"
          style={{ cursor: 'pointer' }}
          title="Показать выигранные"
          onClick={() => setFilters((f) => ({ ...f, status: 'Выиграли', includeWon: true }))}
        >
          <div className="pmc-hero-ic">🏆</div>
          <div className="pmc-hero-val">{kpi.won}</div>
          <div className="pmc-hero-lab">Выиграно</div>
        </div>
      </div>

      <TkpReadyPanel pmId={isPm ? user.id : null} />

      <PmCalcsFilter filters={filters} onChange={setFilters} showPmFilter={isDirector} pms={pms} />

      {loading ? (
        <div className="card card-empty">
          ⏳ Загружаем просчёты…
        </div>
      ) : (
        <PmCalcsList
          tenders={visible}
          pmsById={pmsById}
          showPm={isDirector}
          onOpen={onOpen}
          onMimir={onMimir}
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
