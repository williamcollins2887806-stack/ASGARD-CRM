/**
 * Список банковских транзакций с пагинацией, фильтрами и bulk-actions.
 * Backend ограничивает limit=500 за один запрос; пользуемся серверной пагинацией.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { EmptyState } from '@/blocks/Blocks';

import {
  loadTransactions, bulkClassify, bulkDistribute,
  ARTICLES, TX_STATUSES, DIRECTIONS,
  EXPENSE_ARTICLES, INCOME_ARTICLES,
  fmtMoney, fmtDate
} from './api';
import TransactionDetail from './TransactionDetail';
import DistributeModal from './DistributeModal';

const STATUS_OPTS = [
  { value: '',            label: 'Все статусы' },
  { value: 'new',         label: 'Новые' },
  { value: 'classified',  label: 'Классифицированные' },
  { value: 'confirmed',   label: 'Подтверждённые' },
  { value: 'distributed', label: 'Разнесённые' },
  { value: 'exported_1c', label: 'Экспорт в 1С' },
  { value: 'skipped',     label: 'Пропущенные' }
];

const DIR_OPTS = [
  { value: '',        label: 'Доходы и расходы' },
  { value: 'income',  label: 'Только доходы' },
  { value: 'expense', label: 'Только расходы' }
];

const PAGE_SIZE_OPTS = [
  { value: '50',  label: '50 / страницу' },
  { value: '100', label: '100 / страницу' },
  { value: '200', label: '200 / страницу' },
  { value: '500', label: '500 / страницу' }
];

function TxStatusPill({ status }) {
  const st = TX_STATUSES[status] || { label: status, tone: 'default' };
  return <span className={'bi-pill bi-pill--' + st.tone}>{st.label}</span>;
}

export default function TransactionsList({ onChanged }) {
  const modal = useModal();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  /* Фильтры */
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [article, setArticle] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  /* Выбор */
  const [picked, setPicked] = useState(new Set());

  const articleOpts = useMemo(() => {
    const opts = [{ value: '', label: 'Все статьи' }];
    if (direction !== 'income')  opts.push(...EXPENSE_ARTICLES);
    if (direction !== 'expense') opts.push(...INCOME_ARTICLES);
    return opts;
  }, [direction]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await loadTransactions({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        status, direction, article,
        search: search.trim(),
        date_from: dateFrom, date_to: dateTo
      });
      if (r?.success) {
        setItems(r.items || []);
        setTotal(r.total || 0);
        setPicked(new Set());
      } else {
        setItems([]); setTotal(0);
      }
    } catch (e) {
      toast.error('Не удалось загрузить транзакции: ' + (e?.message || ''));
      setItems([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, status, direction, article, search, dateFrom, dateTo]);

  // Дебаунс поиска
  useEffect(() => {
    const t = setTimeout(refresh, 350);
    return () => clearTimeout(t);
  }, [refresh]);

  // При смене фильтров возвращаемся на 1-ю страницу
  useEffect(() => { setPage(1); /* eslint-disable-next-line */ }, [status, direction, article, search, dateFrom, dateTo, pageSize]);

  const togglePick = (id) => {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAll = (checked) => {
    setPicked(checked ? new Set(items.map((x) => x.id)) : new Set());
  };

  const openDetail = (tx) => {
    modal.open(
      <TransactionDetail
        id={tx.id}
        onSaved={() => { refresh(); onChanged?.(); }}
      />,
      { size: 'wide' }
    );
  };

  const onBulkClassify = () => {
    if (!picked.size) return toast.warn('Выберите транзакции');
    // Подсчитываем доходы/расходы — нельзя смешивать статьи разных направлений
    const sel = items.filter((x) => picked.has(x.id));
    const incomes = sel.filter((x) => x.direction === 'income').length;
    const expenses = sel.filter((x) => x.direction === 'expense').length;
    if (incomes && expenses) {
      return toast.error('Выберите либо только доходы, либо только расходы — у них разные статьи');
    }
    const isIncome = incomes > 0;
    const opts = isIncome ? INCOME_ARTICLES : EXPENSE_ARTICLES;
    let chosen = '';
    modal.open(
      <BulkClassifyDialog
        opts={opts}
        count={picked.size}
        direction={isIncome ? 'income' : 'expense'}
        onSubmit={async (articleCode) => {
          chosen = articleCode;
          if (!chosen) return;
          try {
            const r = await bulkClassify(Array.from(picked), chosen, null);
            toast.success(`Классифицировано: ${r.updated || 0}`);
            refresh();
            onChanged?.();
          } catch (e) {
            toast.error('Bulk-classify: ' + (e?.message || ''));
          }
        }}
      />,
      { size: 'sm' }
    );
  };

  const onBulkDistribute = () => {
    if (!picked.size) return toast.warn('Выберите транзакции');
    // Bulk-распределение допускается только для уже классифицированных/подтверждённых
    const sel = items.filter((x) => picked.has(x.id));
    const notReady = sel.filter((x) => !['classified', 'confirmed'].includes(x.status) || !x.article);
    if (notReady.length) {
      return toast.error(`${notReady.length} транзакций без статьи или не подтверждены`);
    }
    modal.open(
      <DistributeModal
        ids={Array.from(picked)}
        mode="bulk"
        onDone={() => { refresh(); onChanged?.(); }}
      />,
      { size: 'wide' }
    );
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <div className="bi-toolbar">
        <SelectInput value={status} onChange={setStatus} options={STATUS_OPTS} placeholder="Все статусы" />
        <SelectInput value={direction} onChange={setDirection} options={DIR_OPTS} placeholder="Доходы и расходы" />
        <SelectInput value={article} onChange={setArticle} options={articleOpts} placeholder="Все статьи" />
        <div className="bi-date-pair">
          <input
            type="date"
            className="bi-date-inp"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Дата с"
          />
          <span className="bi-date-sep">→</span>
          <input
            type="date"
            className="bi-date-inp"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Дата по"
          />
        </div>
        <div className="bi-toolbar-search">
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск: контрагент / назначение…" />
        </div>
      </div>

      {picked.size > 0 && (
        <div className="bi-bulkbar">
          <span className="bi-bulkbar-cnt">Выбрано: <b>{picked.size}</b></span>
          <Btn variant="primary" onClick={onBulkClassify}>🏷 Массовая классификация</Btn>
          <Btn variant="success" onClick={onBulkDistribute}>📊 Разнести по работам</Btn>
          <Btn variant="ghost" onClick={() => setPicked(new Set())}>Сбросить</Btn>
        </div>
      )}

      <div className="card card-pad-0 ov-hidden">
        {loading && !items.length ? (
          <div className="p-32 t-center c-t3">⏳ Загружаем…</div>
        ) : !items.length ? (
          <EmptyState icon="🏦" title="Транзакций нет" hint="Загрузите банковскую выписку или измените фильтры" />
        ) : (
          <>
            <div className="bi-tx-head">
              <div>
                <input
                  type="checkbox"
                  checked={items.length > 0 && picked.size === items.length}
                  ref={(el) => { if (el) el.indeterminate = picked.size > 0 && picked.size < items.length; }}
                  onChange={(e) => toggleAll(e.target.checked)}
                  aria-label="Выбрать все"
                />
              </div>
              <div>Дата</div>
              <div className="t-right">Сумма</div>
              <div>Контрагент / назначение</div>
              <div>Статья</div>
              <div>Работа</div>
              <div>Статус</div>
            </div>
            <div className="bi-tx-body">
              {items.map((tx) => {
                const dir = DIRECTIONS[tx.direction] || {};
                const checked = picked.has(tx.id);
                return (
                  <div
                    key={tx.id}
                    className={'bi-tx-row ' + (checked ? 'sel ' : '') + (tx.status === 'new' ? 'new' : tx.status === 'distributed' ? 'dist' : '')}
                    onClick={() => openDetail(tx)}
                  >
                    <div onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePick(tx.id)}
                        aria-label={`Выбрать транзакцию #${tx.id}`}
                      />
                    </div>
                    <div className="bi-tx-date">{fmtDate(tx.transaction_date)}</div>
                    <div className={'bi-tx-amount ' + (dir.cls || '')}>
                      {dir.sign || ''}{fmtMoney(tx.amount).replace(' ₽', '')}
                    </div>
                    <div className="bi-tx-cp" title={tx.payment_purpose || ''}>
                      <div className="bi-tx-cp-name">{tx.counterparty_name || '—'}</div>
                      {tx.payment_purpose && (
                        <div className="bi-tx-cp-purpose">{tx.payment_purpose}</div>
                      )}
                    </div>
                    <div>{ARTICLES[tx.article] || tx.article || <span className="c-amber">— требует —</span>}</div>
                    <div>{tx.work_number || (tx.work_id ? '#' + tx.work_id : '—')}</div>
                    <div><TxStatusPill status={tx.status} /></div>
                  </div>
                );
              })}
            </div>

            <div className="bi-pager">
              <div className="bi-pager-info">
                Показано <b>{items.length}</b> из <b>{total}</b>
                {picked.size > 0 ? ` · выбрано ${picked.size}` : ''}
              </div>
              <div className="bi-pager-ctrl">
                <SelectInput value={String(pageSize)} onChange={(v) => setPageSize(Number(v))} options={PAGE_SIZE_OPTS} />
                <Btn variant="ghost" disabled={page <= 1} onClick={() => setPage(1)}>«</Btn>
                <Btn variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</Btn>
                <span className="bi-pager-pages">{page} / {pages}</span>
                <Btn variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</Btn>
                <Btn variant="ghost" disabled={page >= pages} onClick={() => setPage(pages)}>»</Btn>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ── Inline-диалог bulk-классификации ─────────────────────────────── */
function BulkClassifyDialog({ opts, count, direction, onSubmit }) {
  const { close } = useModal();
  const [art, setArt] = useState('');
  return (
    <div className="m-card">
      <div className="m-head m-acc-info">
        <div className="ico">🏷</div>
        <div className="ttl-wrap">
          <h2>Массовая классификация</h2>
          <div className="subt">{count} транзакций · {direction === 'income' ? 'доходы' : 'расходы'}</div>
        </div>
        <button className="close-btn" onClick={close}>×</button>
      </div>
      <div className="m-body">
        <label className="bi-label">Выберите статью</label>
        <SelectInput
          value={art}
          onChange={setArt}
          options={opts}
          placeholder="— статья —"
        />
        <div className="help mt-12">
          Статус выбранных транзакций станет «Подтверждена», а правило применится массово.
          После — можно «Разнести по работам».
        </div>
      </div>
      <div className="m-foot">
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn
          variant="primary"
          disabled={!art}
          onClick={async () => { await onSubmit(art); close(); }}
        >Применить</Btn>
      </div>
    </div>
  );
}
