/**
 * Страница /office-expenses — Офисные расходы CRM 2.0.
 *
 * Источник: vanilla `public/assets/js/office_expenses.js` (603 строки, AsgardOfficeExpensesPage).
 *
 *   ✅ pages/OfficeExpenses/index.jsx                   ← root + KPI + категории + таблица
 *   ✅ pages/OfficeExpenses/api.js                      ← endpoints + helpers
 *   ✅ pages/OfficeExpenses/OfficeExpenseFormModal.jsx  ← создание/редактирование (draft + send)
 *   ✅ pages/OfficeExpenses/OfficeExpenseDetailModal.jsx ← просмотр + action-кнопки согласования
 *
 * Доступ: ADMIN, OFFICE_MANAGER, DIRECTOR_*, BUH (кроме BUH — те читают через ApprovalPayment).
 * Workflow:
 *   draft → pending (send) → approved | rejected | rework → resubmit ...
 * Согласование идёт через универсальные approval-маршруты `/api/approval/office_expenses/:id/*`.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';
import { useDebounce } from '@/api/useListHelpers';

import { OfficeExpenseFormModal } from './OfficeExpenseFormModal';
import { OfficeExpenseDetailModal } from './OfficeExpenseDetailModal';
import {
  loadExpenses, CATEGORIES, STATUS_TABS,
  categoryMeta, statusMeta, fmtMoney, fmtMoneyShort, fmtDate, getStatusKey,
  buildYearOptions, buildMonthOptions, filterByYearMonth, filterByQuery, sumByCategory
} from './api';
import './office-expenses.css';

const MANAGER_ROLES = ['ADMIN', 'OFFICE_MANAGER'];
const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR'];
const VIEW_ROLES = ['ADMIN', 'OFFICE_MANAGER', 'BUH', ...DIRECTOR_ROLES];

export default function OfficeExpensesPage() {
  const { user } = useAuth();
  const modal = useModal();
  const role = user?.role || '';
  const hasAccess = VIEW_ROLES.includes(role);
  const isManager = MANAGER_ROLES.includes(role);

  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState('');
  const [category, setCategory] = useState('');
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadExpenses({ limit: 1000 })
      .then((list) => setItems(Array.isArray(list) ? list : []))
      .catch((e) => toast.error('Не удалось загрузить расходы: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (hasAccess) refresh(); }, [hasAccess]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:office-expenses:changed', onChanged);
    return () => window.removeEventListener('asgard:office-expenses:changed', onChanged);
  }, []);

  /* ─── Подсчёты и фильтры ─── */
  const byYM = useMemo(() => filterByYearMonth(items, year, month), [items, year, month]);
  const byCat = useMemo(() => category ? byYM.filter((e) => e.category === category) : byYM, [byYM, category]);
  const byTab = useMemo(() => {
    if (tab === 'all') return byCat;
    if (tab === 'pending') {
      return byCat.filter((e) => ['pending', 'sent', 'question'].includes(getStatusKey(e)));
    }
    return byCat.filter((e) => getStatusKey(e) === tab);
  }, [byCat, tab]);
  const visible = useMemo(() => filterByQuery(byTab, dq), [byTab, dq]);

  const kpi = useMemo(() => {
    const total = byYM.reduce((s, e) => s + Number(e.amount || 0), 0);
    const pending = items.filter((e) => ['pending', 'sent', 'question'].includes(getStatusKey(e))).length;
    const approved = items.filter((e) => getStatusKey(e) === 'approved').length;
    return {
      total,
      avgPerMonth: total / 12,
      pending,
      approved,
      catTotals: sumByCategory(byYM)
    };
  }, [byYM, items]);

  const counts = useMemo(() => {
    const c = { all: byCat.length, pending: 0, approved: 0, rejected: 0, draft: 0 };
    for (const e of byCat) {
      const s = getStatusKey(e);
      if (['pending', 'sent', 'question'].includes(s)) c.pending++;
      else if (c[s] !== undefined) c[s]++;
    }
    return c;
  }, [byCat]);

  const tabsForBar = STATUS_TABS.map((t) => ({ id: t.id, label: t.label, count: counts[t.id] }));

  if (!hasAccess) {
    return (
      <div className="card oe-locked">
        <div className="oe-locked-icon">🔒</div>
        <div className="oe-locked-title">Доступ закрыт</div>
        <div className="oe-locked-hint">
          Раздел доступен офис-менеджеру, бухгалтерии и директорам.
        </div>
      </div>
    );
  }

  const openCreate = () => modal.open(
    <OfficeExpenseFormModal onDone={refresh} />,
    { size: 'wide' }
  );

  const openDetail = (e) => modal.open(
    <OfficeExpenseDetailModal expense={e} currentUser={user} onDone={refresh} />,
    { size: 'wide' }
  );

  const subtitle = `${byYM.length} в ${year || 'всех годах'} · ${fmtMoneyShort(kpi.total)}`;

  return (
    <div className="oe-wrap">
      <TopActionsBar
        kicker="Финансы"
        title="Офисные расходы"
        subtitle={subtitle}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {isManager && <Btn variant="primary" onClick={openCreate}>+ Добавить расход</Btn>}
          </>
        }
      />

      {/* KPI */}
      <div className="oe-kpis">
        <KpiBox label={`Всего за ${year || 'всё время'}`} value={fmtMoney(kpi.total)} sub={`${byYM.length} записей`} tone="gold" />
        <KpiBox label="Среднее/месяц" value={fmtMoneyShort(kpi.avgPerMonth)} tone="default" />
        <KpiBox label="На согласовании" value={String(kpi.pending)} tone={kpi.pending > 0 ? 'amber' : 'ok'} />
        <KpiBox label="Согласовано" value={String(kpi.approved)} tone="ok" />
      </div>

      {/* Категории */}
      <div className="card oe-cats">
        <div className="oe-cats-eyebrow">
          Категории за {year || 'все годы'} {month !== '' ? '· месяц' : ''}
        </div>
        <div className="oe-cats-grid">
          {CATEGORIES.map((c) => {
            const sum = kpi.catTotals[c.key] || 0;
            const active = category === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setCategory(active ? '' : c.key)}
                title={c.label + (active ? ' — снять фильтр' : '')}
                className={'oe-cat-btn' + (active ? ' is-active' : '')}
              >
                <span className="oe-cat-icon">{c.icon}</span>
                <div className="oe-cat-body">
                  <div className="oe-cat-label">
                    {c.label}
                  </div>
                  <div className="oe-cat-sum">
                    {fmtMoneyShort(sum)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card oe-filters">
        <div className="oe-search-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Поиск по поставщику, документу, комментарию…" />
        </div>
        <div className="oe-year">
          <SelectInput value={year} onChange={setYear} options={buildYearOptions()} placeholder="Год" />
        </div>
        <div className="oe-month">
          <SelectInput value={month} onChange={setMonth} options={buildMonthOptions()} placeholder="Месяц" />
        </div>
        {category && (
          <Pill tone="gold">
            {categoryMeta(category).icon} {categoryMeta(category).label}
            <button
              onClick={() => setCategory('')}
              className="oe-pill-x"
              aria-label="Сбросить категорию"
            >×</button>
          </Pill>
        )}
      </div>

      <TabsBar tabs={tabsForBar} active={tab} onChange={setTab} />

      {loading ? (
        <div className="card oe-loading">
          ⏳ Загружаем расходы…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="🏢"
          title="Нет офисных расходов"
          hint={isManager ? 'Добавьте первый расход за этот период.' : 'Нет записей по выбранным фильтрам.'}
          action={isManager ? <Btn variant="primary" onClick={openCreate}>+ Добавить расход</Btn> : null}
        />
      ) : (
        <div className="card oe-table-card">
          <div className="oe-table-scroll">
            <table className="t-list oe-table">
              <thead>
                <tr>
                  <Th>Дата</Th>
                  <Th>Категория</Th>
                  <Th right>Сумма</Th>
                  <Th>Поставщик / описание</Th>
                  <Th>Статус</Th>
                  <Th>Кто внёс</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => {
                  const c = categoryMeta(e.category);
                  const s = statusMeta(getStatusKey(e));
                  return (
                    <tr
                      key={e.id}
                      className="row-hover oe-row"
                      onClick={() => openDetail(e)}
                    >
                      <td className="oe-cell oe-cell-date">
                        {fmtDate(e.date)}
                      </td>
                      <td className="oe-cell oe-cell-cat">
                        <span className="oe-cat-icon-inline">{c.icon}</span>
                        <span className="oe-cat-name">{c.label}</span>
                      </td>
                      <td className="oe-cell oe-cell-amt">
                        {fmtMoney(e.amount)}
                      </td>
                      <td className="oe-cell oe-cell-desc">
                        <div className="oe-cell-desc-clip">
                          {e.supplier || e.comment || e.description || e.notes || '—'}
                        </div>
                      </td>
                      <td className="oe-cell">
                        <StatusBadge tone={s.tone} label={s.label} />
                      </td>
                      <td className="oe-cell oe-cell-creator">
                        {e.creator_name || e.created_by_name || (e.created_by ? '#' + e.created_by : '—')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, right }) {
  return (
    <th className={right ? 'oe-th-right' : undefined}>
      {children}
    </th>
  );
}

function KpiBox({ label, value, sub, tone = 'default' }) {
  return (
    <div className={'oe-kpi oe-kpi--' + tone}>
      <div className="oe-kpi-label">{label}</div>
      <div className="oe-kpi-value">{value}</div>
      {sub && <div className="oe-kpi-sub">{sub}</div>}
    </div>
  );
}
