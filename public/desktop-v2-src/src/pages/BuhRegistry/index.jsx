/**
 * Страница /buh-registry — Реестр расходов (BUH).
 * Источник: vanilla `public/assets/js/buh_registry.js` (~560 строк).
 *
 *   ✅ index.jsx            — фильтры + сводка + таблица + пагинация
 *   ✅ ExpenseViewModal.jsx — карточка просмотра расхода
 *   ✅ ExpenseEditModal.jsx — редактирование (doc_number + invoice_*)
 *   ✅ api.js               — endpoints + helpers + CSV-экспорт
 *
 * RBAC: ADMIN, BUH, DIRECTOR_*.
 * Видны только расходы по работам (work_expenses). Бекенд это публичный endpoint
 * для аутентифицированных — ролевой контроль на клиенте.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import {  SelectInput } from '@/inputs/Inputs';

import ExpenseViewModal from './ExpenseViewModal';
import ExpenseEditModal from './ExpenseEditModal';
import {
  loadWorkExpenses, loadWorks, loadUsers,
  EXPENSE_CATEGORIES, INVOICE_STATUS_OPTIONS, MONTHS_SHORT,
  fmtMoney, fmtDate, moneyShort, getCategory,
  exportExpensesToCsv
} from './api';
import './buh-registry.css';

const PAGE = 25;
const ALLOWED_ROLES = ['ADMIN', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR'];

const YEAR_NOW = new Date().getFullYear();
const MONTH_NOW = new Date().getMonth() + 1;

export default function BuhRegistryPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [expenses, setExpenses] = useState([]);
  const [works,    setWorks]    = useState([]);
  const [users,    setUsers]    = useState([]);
  const [loading,  setLoading]  = useState(true);

  const [year,     setYear]     = useState(String(YEAR_NOW));
  const [month,    setMonth]    = useState(String(MONTH_NOW));
  const [customer, setCustomer] = useState('');
  const [creator,  setCreator]  = useState('');
  const [category, setCategory] = useState('');
  const [invStatus,setInvStatus]= useState('');
  const [page,     setPage]     = useState(1);

  useEffect(() => {
    if (user && !ALLOWED_ROLES.includes(user.role)) {
      toast.error('Раздел доступен бухгалтерии и директорам');
      window.location.hash = '#/home';
    }
  }, [user]);

  const refresh = () => {
    setLoading(true);
    Promise.all([loadWorkExpenses(), loadWorks(), loadUsers()])
      .then(([exp, w, u]) => {
        setExpenses(exp);
        setWorks(w);
        setUsers(u);
      })
      .catch((e) => toast.error('Не удалось загрузить данные: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const worksMap = useMemo(() => Object.fromEntries(works.map((w) => [w.id, w])), [works]);
  const usersMap = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);

  /* ── Доступные значения для фильтров (берём из данных) ── */
  const yearsList = useMemo(() => {
    const set = new Set();
    expenses.forEach((e) => {
      if (e.date) {
        const y = new Date(e.date).getFullYear();
        if (y > 2000) set.add(y);
      }
    });
    if (!set.size) set.add(YEAR_NOW);
    return Array.from(set).sort((a, b) => b - a);
  }, [expenses]);

  const customerList = useMemo(() => {
    const set = new Set();
    works.forEach((w) => {
      const name = w.customer_name || w.customer;
      if (name) set.add(name);
    });
    return Array.from(set).sort();
  }, [works]);

  const creatorList = useMemo(() => {
    const set = new Set();
    expenses.forEach((e) => { if (e.created_by) set.add(e.created_by); });
    return Array.from(set).map((id) => usersMap[id]).filter(Boolean);
  }, [expenses, usersMap]);

  /* ── Фильтр + сортировка ── */
  const filtered = useMemo(() => {
    let v = expenses.slice();

    if (year) {
      v = v.filter((e) => e.date && new Date(e.date).getFullYear() === Number(year));
    }
    if (month) {
      v = v.filter((e) => e.date && (new Date(e.date).getMonth() + 1) === Number(month));
    }
    if (customer) {
      v = v.filter((e) => {
        const w = worksMap[e.work_id];
        return (w?.customer_name || w?.customer) === customer;
      });
    }
    if (creator) {
      v = v.filter((e) => String(e.created_by) === creator);
    }
    if (category) {
      v = v.filter((e) => e.category === category);
    }
    if (invStatus === 'need') v = v.filter((e) =>  e.invoice_needed && !e.invoice_received);
    else if (invStatus === 'got')  v = v.filter((e) =>  e.invoice_received);
    else if (invStatus === 'none') v = v.filter((e) => !e.invoice_needed);

    v.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return v;
  }, [expenses, worksMap, year, month, customer, creator, category, invStatus]);

  /* ── Сводка ── */
  const summary = useMemo(() => {
    const total = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);
    const need  = filtered.filter((e) => e.invoice_needed && !e.invoice_received).length;
    const got   = filtered.filter((e) => e.invoice_received).length;

    const byCat = {};
    EXPENSE_CATEGORIES.forEach((c) => { byCat[c.key] = 0; });
    filtered.forEach((e) => {
      if (byCat[e.category] !== undefined) byCat[e.category] += Number(e.amount || 0);
    });
    const topCats = EXPENSE_CATEGORIES
      .map((c) => ({ ...c, sum: byCat[c.key] || 0 }))
      .filter((c) => c.sum > 0)
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 3);
    return { total, need, got, count: filtered.length, topCats };
  }, [filtered]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = filtered.slice((safePage - 1) * PAGE, safePage * PAGE);

  useEffect(() => { setPage(1); }, [year, month, customer, creator, category, invStatus]);

  /* ── Действия ── */
  const onView = (exp) => {
    modal.open(
      <ExpenseViewModal
        expense={exp}
        work={worksMap[exp.work_id]}
        creator={usersMap[exp.created_by]}
        onEdit={(e) => onEdit(e)}
      />,
      { size: 'wide' }
    );
  };
  const onEdit = (exp) => {
    modal.open(<ExpenseEditModal expense={exp} onSaved={() => refresh()} />);
  };
  const onReset = () => {
    setYear(String(YEAR_NOW));
    setMonth(String(MONTH_NOW));
    setCustomer('');
    setCreator('');
    setCategory('');
    setInvStatus('');
  };
  const onExport = () => {
    if (!filtered.length) {
      toast.warn('Нет записей для экспорта');
      return;
    }
    exportExpensesToCsv(filtered, { worksMap, usersMap }, `expenses_${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Экспортировано ${filtered.length} записей`);
  };

  /* ── Опции селектов ── */
  const yearOptions = [{ value: '', label: 'Все годы' }, ...yearsList.map((y) => ({ value: String(y), label: String(y) }))];
  const monthOptions = [
    { value: '', label: 'Все месяцы' },
    ...MONTHS_SHORT.map((m, i) => ({ value: String(i + 1), label: m }))
  ];
  const customerOptions = [
    { value: '', label: 'Все заказчики' },
    ...customerList.map((c) => ({ value: c, label: c }))
  ];
  const creatorOptions = [
    { value: '', label: 'Все авторы' },
    ...creatorList.map((u) => ({ value: String(u.id), label: u.name || u.login || `#${u.id}` }))
  ];
  const categoryOptions = [
    { value: '', label: 'Все категории' },
    ...EXPENSE_CATEGORIES.map((c) => ({ value: c.key, label: `${c.icon} ${c.label}` }))
  ];

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Бухгалтерия"
        title="Реестр расходов"
        subtitle={`${filtered.length} ${pluralize(filtered.length, ['запись', 'записи', 'записей'])} · ${fmtMoney(summary.total)}`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={onReset}>↺ Сбросить</Btn>
            <Btn variant="ghost" onClick={onExport}>📥 Экспорт CSV</Btn>
          </>
        }
      />

      <div className="buh-filters">
        <SelectInput value={year}      onChange={setYear}      options={yearOptions} />
        <SelectInput value={month}     onChange={setMonth}     options={monthOptions} />
        <SelectInput value={customer}  onChange={setCustomer}  options={customerOptions} />
        <SelectInput value={creator}   onChange={setCreator}   options={creatorOptions} />
        <SelectInput value={category}  onChange={setCategory}  options={categoryOptions} />
        <SelectInput value={invStatus} onChange={setInvStatus} options={INVOICE_STATUS_OPTIONS} />
      </div>

      <div className="buh-summary">
        <div className="buh-card">
          <div className="buh-card-label">Всего расходов</div>
          <div className="buh-card-value">{moneyShort(summary.total)} ₽</div>
          <div className="buh-card-sub">{summary.count} записей</div>
        </div>
        <div className="buh-card">
          <div className="buh-card-label">Ожидают СФ</div>
          <div className="buh-card-value amber">{summary.need}</div>
          <div className="buh-card-sub">записей без счёт-фактуры</div>
        </div>
        <div className="buh-card">
          <div className="buh-card-label">СФ получены</div>
          <div className="buh-card-value ok">{summary.got}</div>
          <div className="buh-card-sub">документов закрыто</div>
        </div>
        {summary.topCats.map((c) => (
          <div key={c.key} className="buh-card">
            <div className="buh-card-label">{c.icon} {c.label}</div>
            <div className="buh-card-value">{moneyShort(c.sum)} ₽</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем реестр…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="Нет расходов по фильтрам"
          hint="Попробуйте сменить год, месяц или сбросить фильтры."
          action={<Btn variant="ghost" onClick={onReset}>↺ Сбросить фильтры</Btn>}
        />
      ) : (
        <>
          <div className="buh-tbl-wrap">
            <div className="buh-tbl-scroll">
              <table className="buh-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Категория</th>
                    <th className="t-right">Сумма</th>
                    <th>Заказчик / Работа</th>
                    <th>Статус работы</th>
                    <th>Поставщик</th>
                    <th>№ док.</th>
                    <th>СФ</th>
                    <th>Кто внёс</th>
                    <th className="t-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((e) => (
                    <ExpenseRow
                      key={e.id}
                      expense={e}
                      work={worksMap[e.work_id]}
                      creator={usersMap[e.created_by]}
                      onView={onView}
                      onEdit={onEdit}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {pages > 1 && (
            <div className="buh-pagination">
              <Btn size="sm" variant="ghost" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</Btn>
              <span className="info">{safePage} / {pages} · {filtered.length} зап.</span>
              <Btn size="sm" variant="ghost" disabled={safePage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ExpenseRow({ expense: e, work, creator, onView, onEdit }) {
  const cat = getCategory(e.category);
  const workStatus = work?.work_status || '—';
  const isClosed = workStatus === 'Работы сдали' || workStatus === 'Закрыта' || workStatus === 'Закрыт';
  const customerName = work?.customer_name || work?.customer || '—';
  const workTitle = work?.work_title || '—';

  let invoiceCell;
  if (e.invoice_received)    invoiceCell = <span className="buh-pill got">✓ СФ получена</span>;
  else if (e.invoice_needed) invoiceCell = <span className="buh-pill need">⏳ Ожидает СФ</span>;
  else                       invoiceCell = <span className="buh-pill none">—</span>;

  return (
    <tr>
      <td className="u-nowrap">{fmtDate(e.date)}</td>
      <td>
        <span
          className="buh-cat-badge"
          style={{ background: `color-mix(in srgb, ${cat.color} 18%, transparent)`, color: cat.color }}
        >{cat.icon} {cat.label}</span>
      </td>
      <td className="t-right">
        <span className="buh-amount">{fmtMoney(e.amount)}</span>
      </td>
      <td>
        <div className="buh-customer-name">{customerName}</div>
        <div className="buh-work-title">{workTitle}</div>
        {e.category === 'fot' && e.fot_employee_name && (
          <div className="buh-fot-info">
            {e.fot_employee_name}: оклад {fmtMoney(e.fot_base_pay || 0)}, сут. {fmtMoney(e.fot_per_diem || 0)}, премия {fmtMoney(e.fot_bonus || 0)}
          </div>
        )}
      </td>
      <td>
        <span className={'buh-pill ' + (isClosed ? 'closed' : 'open')}>{workStatus}</span>
      </td>
      <td>{e.supplier || '—'}</td>
      <td>{e.doc_number || '—'}</td>
      <td>{invoiceCell}</td>
      <td>{creator?.name || creator?.login || '—'}</td>
      <td>
        <div className="buh-row-actions">
          <Btn size="sm" onClick={() => onView(e)} title="Просмотр">👁</Btn>
          {!isClosed && <Btn size="sm" variant="ghost" onClick={() => onEdit(e)} title="Редактировать">✎</Btn>}
        </div>
      </td>
    </tr>
  );
}

function pluralize(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5)  return forms[1];
  if (b === 1)         return forms[0];
  return forms[2];
}
