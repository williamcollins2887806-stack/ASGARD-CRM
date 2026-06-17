/**
 * Страница /invoices — Счета и оплаты.
 * Источник: vanilla `public/assets/js/invoices.js` (~332 строки).
 *
 *   ✅ index.jsx              — список + поиск + фильтр + действия
 *   ✅ InvoiceEditModal.jsx   — создание/редактирование
 *   ✅ InvoiceDetailModal.jsx — карточка + платежи + действия + PDF
 *   ✅ PaymentModal.jsx       — внесение оплаты
 *   ✅ api.js                 — endpoints + helpers
 *
 * RBAC: создавать/править/платить — ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, PM, BUH.
 *       PDF и просмотр — всем аутентифицированным.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import InvoiceEditModal   from './InvoiceEditModal';
import InvoiceDetailModal from './InvoiceDetailModal';
import PaymentModal       from './PaymentModal';
import {
  loadInvoices, STATUSES, STATUS_OPTIONS,
  fmtMoney, fmtDate
} from './api';
import './invoices.css';

const PAGE = 25;
const WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'PM', 'BUH'];

export default function InvoicesPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [list,    setList]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [query,   setQuery]   = useState('');
  const dQuery = useDebounce(query, 300);  // G-11: debounce 300мс
  const [status,  setStatus]  = useState('');
  const [page,    setPage]    = useState(1);

  const canWrite = WRITE_ROLES.includes(user?.role);

  const refresh = () => {
    setLoading(true);
    loadInvoices({ limit: 2000 })
      .then(setList)
      .catch((e) => toast.error('Не удалось загрузить счета: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('asgard:invoices:changed', h);
    return () => window.removeEventListener('asgard:invoices:changed', h);
  }, []);

  // Deep-link ?id=NN — открыть карточку
  useEffect(() => {
    const tryOpen = () => {
      const m = (window.location.hash || '').match(/[?&]id=(\d+)/);
      if (m && m[1]) {
        modal.open(<InvoiceDetailModal invoiceId={Number(m[1])} />, { size: 'wide' });
        window.location.hash = '#/invoices';
      }
    };
    tryOpen();
    window.addEventListener('hashchange', tryOpen);
    return () => window.removeEventListener('hashchange', tryOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let v = list;
    if (status) v = v.filter((i) => i.status === status);
    if (dQuery.trim()) {
      const lq = dQuery.trim().toLowerCase();
      v = v.filter((i) =>
        (i.invoice_number || '').toLowerCase().includes(lq) ||
        (i.customer_name  || '').toLowerCase().includes(lq) ||
        (i.customer_inn   || '').includes(lq) ||
        (i.description    || '').toLowerCase().includes(lq) ||
        String(i.id).includes(lq)
      );
    }
    return v;
  }, [list, status, dQuery]);

  const summary = useMemo(() => {
    const total = filtered.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const paid  = filtered.reduce((s, i) => s + Number(i.paid_amount  || 0), 0);
    return { total, paid, remaining: Math.max(0, total - paid) };
  }, [filtered]);

  useEffect(() => { setPage(1); }, [dQuery, status]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = filtered.slice((safePage - 1) * PAGE, safePage * PAGE);

  const onCreate = () => {
    if (!canWrite) {
      toast.warn('Создавать счета могут только: ADMIN, директора, PM, BUH');
      return;
    }
    modal.open(<InvoiceEditModal invoice={null} onSaved={refresh} />, { size: 'wide' });
  };
  const onOpen = (inv) => {
    modal.open(<InvoiceDetailModal invoiceId={inv.id} />, { size: 'wide' });
  };
  const onPay = (inv, e) => {
    e?.stopPropagation?.();
    if (!canWrite) return;
    modal.open(<PaymentModal invoice={inv} onSaved={refresh} />);
  };
  const onEdit = (inv, e) => {
    e?.stopPropagation?.();
    if (!canWrite) return;
    modal.open(<InvoiceEditModal invoice={inv} onSaved={refresh} />, { size: 'wide' });
  };

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Финансы"
        title="Счета и оплаты"
        subtitle={`${filtered.length} ${pluralize(filtered.length, ['счёт', 'счёта', 'счетов'])} · ${fmtMoney(summary.total)} (оплачено ${fmtMoney(summary.paid)})`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {canWrite && <Btn variant="primary" onClick={onCreate}>+ Новый счёт</Btn>}
          </>
        }
      />

      <div className="inv-toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Поиск: номер, контрагент, ИНН, описание…" />
        <SelectInput value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем счета…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🧾"
          title={query || status ? 'Ничего не нашли' : 'Счетов пока нет'}
          hint={query || status ? 'Попробуйте изменить фильтры' : 'Создайте первый счёт через «+ Новый счёт»'}
          action={canWrite ? <Btn variant="primary" onClick={onCreate}>+ Новый счёт</Btn> : null}
        />
      ) : (
        <>
          <div className="inv-tbl-wrap">
            <div className="inv-tbl-scroll">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>№ счёта</th>
                    <th>Дата</th>
                    <th>Контрагент</th>
                    <th className="num">Сумма</th>
                    <th className="num">Оплачено</th>
                    <th>Статус</th>
                    <th className="t-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((inv) => {
                    const st = STATUSES[inv.status] || STATUSES.draft;
                    return (
                      <tr key={inv.id} className="row-clickable" onClick={() => onOpen(inv)}>
                        <td><span className="inv-num">{inv.invoice_number || '#' + inv.id}</span></td>
                        <td>{fmtDate(inv.invoice_date)}</td>
                        <td>{inv.customer_name || '—'}</td>
                        <td className="num">{fmtMoney(inv.total_amount)}</td>
                        <td className="num">{fmtMoney(inv.paid_amount)}</td>
                        <td>
                          <span
                            className="inv-pill"
                            style={{
                              background: `color-mix(in srgb, ${st.color} 18%, transparent)`,
                              color: st.color,
                              borderColor: `color-mix(in srgb, ${st.color} 30%, transparent)`
                            }}
                          >{st.label}</span>
                        </td>
                        <td>
                          <div className="inv-row-actions">
                            {canWrite && <Btn size="sm" onClick={(e) => onPay(inv, e)} title="Внести оплату">💰</Btn>}
                            {canWrite && <Btn size="sm" variant="ghost" onClick={(e) => onEdit(inv, e)} title="Редактировать">✎</Btn>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {pages > 1 && (
            <div className="row-center gap-12 mt-6">
              <Btn size="sm" variant="ghost" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</Btn>
              <span className="c-t3 fs-13">{safePage} / {pages} · {filtered.length} шт.</span>
              <Btn size="sm" variant="ghost" disabled={safePage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</Btn>
            </div>
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
  if (b > 1 && b < 5)  return forms[1];
  if (b === 1)         return forms[0];
  return forms[2];
}
