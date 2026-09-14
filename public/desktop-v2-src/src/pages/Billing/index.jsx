/**
 * Единая страница «Счета и акты»: реестр + конструктор выставления.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState, LoadingCard } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';
import { CreateChooser } from './CreateChooser';
import { ConstructorModal } from './ConstructorModal';
import { DetailModal } from './DetailModal';
import PaymentModal from './PaymentModal';
import {
  loadInvoices, loadActs, WRITE_ROLES, INV_STATUS_OPTIONS, ACT_STATUS_OPTIONS, ALL_STATUS_OPTIONS,
  statusMeta, fmtMoney, fmtDate, openInvoicePdf, openActPdf, downloadDocOffice, displayText
} from './api';
import './billing.css';

const PAGE = 25;
const ALLOWED = ['ADMIN', 'PM', 'HEAD_PM', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

function ruCount(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

function invoiceOpen(r) {
  if (r.status === 'cancelled' || r.status === 'draft') return false;
  return Number(r.total_amount || 0) > Number(r.paid_amount || 0) + 0.009;
}

function actUnsigned(r) {
  return r.status !== 'signed' && r.status !== 'paid';
}

function dueUrgency(due) {
  if (!due) return '';
  const d = new Date(due);
  if (!Number.isFinite(d.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'hot';
  if (days <= 3) return 'soon';
  return '';
}

function readTabFromHash(fallback) {
  const h = window.location.hash || '';
  if (h.includes('/acts')) return 'acts';
  if (h.includes('/invoices')) return 'invoices';
  const m = h.match(/[?&]tab=(invoices|acts|all)/);
  return m ? m[1] : fallback;
}

export default function BillingPage({ defaultTab = 'all' }) {
  const { user } = useAuth();
  const modal = useModal();
  const [tab, setTab] = useState(() => readTabFromHash(defaultTab));
  const [invoices, setInvoices] = useState([]);
  const [acts, setActs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const dQuery = useDebounce(query, 300);
  const [status, setStatus] = useState('');
  const [queue, setQueue] = useState('');
  const [page, setPage] = useState(1);

  const hasAccess = !user || ALLOWED.includes(user.role);
  const canWrite = WRITE_ROLES.includes(user?.role);

  const refresh = () => {
    if (!hasAccess) return;
    setLoading(true);
    Promise.all([loadInvoices({ limit: 2000 }), loadActs({ limit: 2000 })])
      .then(([inv, ac]) => {
        setInvoices(inv);
        setActs(ac);
      })
      .catch((e) => toast.error('Не удалось загрузить документы: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('asgard:billing:changed', h);
    window.addEventListener('asgard:invoices:changed', h);
    window.addEventListener('asgard:acts:changed', h);
    return () => {
      window.removeEventListener('asgard:billing:changed', h);
      window.removeEventListener('asgard:invoices:changed', h);
      window.removeEventListener('asgard:acts:changed', h);
    };
  }, []);

  useEffect(() => {
    const tryOpen = () => {
      const hash = window.location.hash || '';
      const kind = hash.includes('/acts') ? 'act' : hash.includes('/invoices') ? 'invoice' : null;
      const m = hash.match(/[?&]id=(\d+)/);
      if (m && kind) {
        modal.open(<DetailModal kind={kind} id={Number(m[1])} />, { size: 'wide' });
        const clean = hash.replace(/[?&]id=\d+/, '').replace(/\?$/, '');
        history.replaceState(null, '', clean);
      }
      const nextTab = readTabFromHash(defaultTab);
      setTab(nextTab);
    };
    tryOpen();
    window.addEventListener('hashchange', tryOpen);
    return () => window.removeEventListener('hashchange', tryOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    const invRows = invoices.map((i) => ({
      ...i,
      kind: 'invoice',
      number: i.invoice_number,
      date: i.invoice_date,
      sortAt: i.created_at || i.invoice_date
    }));
    const actRows = acts.map((a) => ({
      ...a,
      kind: 'act',
      number: a.act_number,
      date: a.act_date,
      sortAt: a.created_at || a.act_date
    }));
    let list = tab === 'invoices' ? invRows : tab === 'acts' ? actRows : [...invRows, ...actRows];
    list.sort((a, b) => String(b.sortAt || '').localeCompare(String(a.sortAt || '')));
    if (queue === 'unpaid') list = list.filter((r) => r.kind === 'invoice' && invoiceOpen(r));
    else if (queue === 'unsigned') list = list.filter((r) => r.kind === 'act' && actUnsigned(r));
    else if (status) list = list.filter((r) => r.status === status);
    if (dQuery.trim()) {
      const lq = dQuery.trim().toLowerCase();
      list = list.filter((r) =>
        (r.number || '').toLowerCase().includes(lq) ||
        (r.customer_name || '').toLowerCase().includes(lq) ||
        (r.customer_inn || '').includes(lq) ||
        (r.description || '').toLowerCase().includes(lq) ||
        (r.work_title || '').toLowerCase().includes(lq) ||
        String(r.id).includes(lq)
      );
    }
    return list;
  }, [invoices, acts, tab, status, queue, dQuery]);

  const kpi = useMemo(() => {
    const invSum = invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const invPaid = invoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
    const actSum = acts.reduce((s, a) => s + Number(a.total_amount || 0), 0);
    const openInv = invoices.filter(invoiceOpen);
    const unpaidN = openInv.length;
    const invLeft = openInv.reduce((s, i) => s + Math.max(0, Number(i.total_amount || 0) - Number(i.paid_amount || 0)), 0);
    const unsigned = acts.filter(actUnsigned).length;
    return {
      invSum,
      invPaid,
      invLeft,
      actSum,
      unsigned,
      unpaidN,
      invN: invoices.length,
      actN: acts.length
    };
  }, [invoices, acts]);

  useEffect(() => { setPage(1); }, [dQuery, status, tab, queue]);

  const setKindTab = (v) => {
    setTab(v);
    setStatus('');
    setQueue('');
  };
  const showUnpaid = () => {
    setTab('invoices');
    setStatus('');
    setQueue('unpaid');
  };
  const showUnsigned = () => {
    setTab('acts');
    setStatus('');
    setQueue('unsigned');
  };

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = rows.slice((safePage - 1) * PAGE, safePage * PAGE);
  const statusOptions = tab === 'acts' ? ACT_STATUS_OPTIONS : tab === 'invoices' ? INV_STATUS_OPTIONS : ALL_STATUS_OPTIONS;

  const openCtor = (kind) => {
    if (!canWrite) return toast.warn('Выставлять документы могут ADMIN, директора, PM, BUH');
    modal.open(<ConstructorModal kind={kind} onSaved={refresh} />, { size: 'full' });
  };
  const onCreate = () => {
    if (!canWrite) return toast.warn('Выставлять документы могут ADMIN, директора, PM, BUH');
    modal.open(<CreateChooser onCreated={refresh} />);
  };
  const onOpen = (r) => modal.open(<DetailModal kind={r.kind} id={r.id} />, { size: 'wide' });
  const onEdit = (r, e) => {
    e?.stopPropagation?.();
    if (!canWrite) return;
    modal.open(<ConstructorModal kind={r.kind} editId={r.id} editKind={r.kind} onSaved={refresh} />, { size: 'full' });
  };
  const onPay = (r, e) => {
    e?.stopPropagation?.();
    if (!canWrite) return;
    modal.open(<PaymentModal invoice={r} onSaved={refresh} />);
  };
  const onPdf = (r, e) => {
    e?.stopPropagation?.();
    (r.kind === 'act' ? openActPdf : openInvoicePdf)(r.id).catch((err) => toast.error('PDF: ' + (err?.message || err)));
  };
  const onOffice = (r, ext, e) => {
    e?.stopPropagation?.();
    downloadDocOffice(r.kind, r.id, ext)
      .catch((err) => toast.error((ext === 'xlsx' ? 'Excel: ' : 'Word: ') + (err?.message || err)));
  };

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.target?.tagName === 'INPUT' || ev.target?.tagName === 'TEXTAREA') return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'n') {
        ev.preventDefault();
        openCtor('invoice');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (user && !ALLOWED.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED}
        userRole={user.role}
        title="Счета и акты недоступны"
        message="Раздел открыт PM, бухгалтерии, директорам и ADMIN."
      />
    );
  }

  return (
    <div className="bill-page">
      <TopActionsBar
        kicker="Казна"
        title="Счета и акты"
        subtitle="Очередь выставления: как ТКП — привязать работу или заполнить вручную"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>Обновить</Btn>
            {canWrite && <Btn variant="ghost" onClick={onCreate}>Внести</Btn>}
            {canWrite && <Btn variant="ghost" onClick={() => openCtor('act')}>Акт</Btn>}
            {canWrite && <Btn variant="primary" onClick={() => openCtor('invoice')} title="Ctrl+N">Выставить счёт</Btn>}
          </>
        }
      />

      {(kpi.unpaidN > 0 || kpi.unsigned > 0) && (
        <div className="bill-queue">
          {kpi.unpaidN > 0 && (
            <button type="button" className={'bill-alert is-pay' + (queue === 'unpaid' ? ' is-on' : '')} onClick={showUnpaid}>
              <span className="bill-alert-k">Очередь</span>
              <div className="bill-alert-t">
                <strong>К оплате {fmtMoney(kpi.invLeft)}</strong>
                <span>{kpi.unpaidN} {ruCount(kpi.unpaidN, 'счёт', 'счёта', 'счетов')} без полного закрытия</span>
              </div>
              <span className="bill-alert-go">Показать</span>
            </button>
          )}
          {kpi.unsigned > 0 && (
            <button type="button" className={'bill-alert is-sign' + (queue === 'unsigned' ? ' is-on' : '')} onClick={showUnsigned}>
              <span className="bill-alert-k">Подпись</span>
              <div className="bill-alert-t">
                <strong>Ждут подписи: {kpi.unsigned}</strong>
                <span>акты ещё не подписаны заказчиком</span>
              </div>
              <span className="bill-alert-go">Показать</span>
            </button>
          )}
        </div>
      )}

      <div className="bill-kpis">
        <button type="button" className={'bill-kpi' + (tab === 'invoices' && !queue ? ' is-on' : '')} onClick={() => setKindTab('invoices')}>
          <div className="k">Счета</div>
          <div className="v">{kpi.invN}</div>
          <div className="s">{fmtMoney(kpi.invSum)}</div>
        </button>
        <button type="button" className={'bill-kpi is-warn' + (queue === 'unpaid' ? ' is-on' : '') + (kpi.unpaidN > 0 ? ' is-alert' : '')} onClick={showUnpaid}>
          <div className="k">К оплате</div>
          <div className="v">{fmtMoney(kpi.invLeft)}</div>
          <div className="s">пришло {fmtMoney(kpi.invPaid)}</div>
        </button>
        <button type="button" className={'bill-kpi is-gold' + (tab === 'acts' && !queue ? ' is-on' : '')} onClick={() => setKindTab('acts')}>
          <div className="k">Акты</div>
          <div className="v">{kpi.actN}</div>
          <div className="s">{fmtMoney(kpi.actSum)}</div>
        </button>
        <button type="button" className={'bill-kpi is-ok' + (queue === 'unsigned' ? ' is-on' : '')} onClick={showUnsigned}>
          <div className="k">Ждут подписи</div>
          <div className="v">{kpi.unsigned}</div>
          <div className="s">не подписаны заказчиком</div>
        </button>
      </div>

      <div className="bill-board">
        <div className="bill-board-head">
          <div className="bill-chips" role="tablist">
            {[
              { id: 'all', label: 'Все', n: invoices.length + acts.length },
              { id: 'invoices', label: 'Счета', n: invoices.length },
              { id: 'acts', label: 'Акты', n: acts.length }
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id && !queue}
                className={'bill-chip' + (tab === t.id && !queue ? ' is-on' : '')}
                onClick={() => setKindTab(t.id)}
              >
                {t.label}
                <span className="n">{t.n}</span>
              </button>
            ))}
          </div>
          <div className="bill-toolbar">
            <SearchInput value={query} onChange={setQuery} placeholder="Номер, заказчик, ИНН, работа…" />
            <SelectInput
              value={queue ? '' : status}
              onChange={(v) => { setQueue(''); setStatus(v); }}
              options={statusOptions}
              placeholder="Все статусы"
            />
          </div>
        </div>

        {loading ? (
          <LoadingCard text="Загружаем счета и акты…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="✦"
            title={query || status || queue ? 'Ничего не нашли' : 'Документов пока нет'}
            hint={query || status || queue ? 'Смените фильтр или очередь' : 'Выставьте первый счёт — конструктор как у ТКП'}
            action={canWrite ? <Btn variant="primary" onClick={() => openCtor('invoice')}>Выставить счёт</Btn> : null}
          />
        ) : (
          <>
            <div className="bill-tbl-scroll">
              <table className="bill-table">
                <thead>
                  <tr>
                    <th>Документ</th>
                    <th>Заказчик</th>
                    <th>Дата</th>
                    <th className="num">Сумма</th>
                    <th>Статус</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((r) => {
                    const st = statusMeta(r.kind, r.status);
                    const total = Number(r.total_amount || 0);
                    const paid = Number(r.paid_amount || 0);
                    const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
                    const urg = r.kind === 'invoice' && invoiceOpen(r) ? dueUrgency(r.due_date) : '';
                    const name = displayText(r.customer_name, 'без названия');
                    const number = displayText(r.number, '#' + r.id);
                    const work = displayText(r.work_title, '');
                    return (
                      <tr
                        key={r.kind + '-' + r.id}
                        className="bill-row"
                        data-kind={r.kind}
                        data-status={r.status}
                        data-urgency={urg || undefined}
                        onClick={() => onOpen(r)}
                      >
                        <td>
                          <div className="bill-doc">
                            <span className={'bill-kind ' + (r.kind === 'act' ? 'is-act' : 'is-inv')}>
                              {r.kind === 'act' ? 'Акт' : 'Счёт'}
                            </span>
                            <div>
                              <div className="bill-num">{number}</div>
                              {work && <div className="bill-sub">{work}</div>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="bill-cust">{name}</div>
                          {r.customer_inn && <div className="bill-sub">ИНН {r.customer_inn}</div>}
                        </td>
                        <td>
                          <div>{fmtDate(r.date)}</div>
                          {r.kind === 'invoice' && r.due_date && (
                            <span className={'bill-due' + (urg ? ' is-' + urg : '')}>
                              до {fmtDate(r.due_date)}
                            </span>
                          )}
                        </td>
                        <td className="num">
                          <div className="bill-price">{fmtMoney(r.total_amount)}</div>
                          {r.kind === 'invoice' && total > 0 && (
                            <div className="bill-paybar" title={'Оплачено ' + pct + '%'}>
                              <i style={{ width: pct + '%' }} />
                            </div>
                          )}
                          {r.kind === 'invoice' && paid > 0 && (
                            <div className="bill-sub">опл. {fmtMoney(paid)}</div>
                          )}
                        </td>
                        <td>
                          <StatusBadge tone={st.tone} label={st.label} />
                        </td>
                        <td>
                          <div className="bill-row-actions" onClick={(e) => e.stopPropagation()}>
                            <Btn size="sm" variant="ghost" onClick={(e) => onPdf(r, e)}>PDF</Btn>
                            <Btn size="sm" variant="ghost" onClick={(e) => onOffice(r, 'docx', e)}>Word</Btn>
                            <Btn size="sm" variant="ghost" onClick={(e) => onOffice(r, 'xlsx', e)}>Excel</Btn>
                            {canWrite && r.kind === 'invoice' && invoiceOpen(r) && (
                              <Btn size="sm" onClick={(e) => onPay(r, e)}>Оплата</Btn>
                            )}
                            {canWrite && <Btn size="sm" variant="ghost" onClick={(e) => onEdit(r, e)}>Править</Btn>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="bill-pager">
                <Btn size="sm" variant="ghost" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</Btn>
                <span className="c-t3 fs-13">{safePage} / {pages} · {rows.length} шт.</span>
                <Btn size="sm" variant="ghost" disabled={safePage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</Btn>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
