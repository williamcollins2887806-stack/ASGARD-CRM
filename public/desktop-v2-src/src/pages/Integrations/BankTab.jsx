/**
 * Таб «Банк / 1С» — стата, фильтры, список транзакций, загрузка выписки, правила.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { SearchInput, SelectInput, FileDrop } from '@/inputs/Inputs';
import {
  ARTICLES, TX_STATUS, fmtMoney, fmtDate,
  bankStats, bankTransactions, bankRules
} from './api';
import { openProtected } from '@/api/download';

const STATUS_OPTS = [
  { value: '', label: 'Все статусы' },
  { value: 'new', label: 'Новые' },
  { value: 'classified', label: 'Классиф.' },
  { value: 'confirmed', label: 'Подтв.' },
  { value: 'distributed', label: 'Разнесённые' }
];
const DIR_OPTS = [
  { value: '', label: 'Все' },
  { value: 'income', label: 'Доходы' },
  { value: 'expense', label: 'Расходы' }
];

export function BankTab() {
  const modal = useModal();
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(new Set());

  const refresh = () => {
    setLoading(true);
    Promise.all([bankStats().catch(() => null), loadTx()])
      .then(([s]) => setStats(s?.success ? s : (s || {})))
      .finally(() => setLoading(false));
  };

  async function loadTx() {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (status) params.set('status', status);
    if (direction) params.set('direction', direction);
    if (q) params.set('search', q);
    try {
      const r = await bankTransactions('?' + params.toString());
      if (r?.success) {
        setItems(r.items || []);
        setTotal(r.total || 0);
        setPicked(new Set());
      } else {
        setItems([]); setTotal(0);
      }
    } catch (e) {
      toast.error('Не удалось загрузить транзакции');
      setItems([]); setTotal(0);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const t = setTimeout(() => loadTx(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, direction, q]);

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

  const onUpload = () => {
    modal.open(<UploadModal onDone={refresh} />, { size: 'wide' });
  };
  const onRules = async () => {
    try {
      const data = await bankRules();
      const list = data?.items || [];
      modal.open(
        <MCard>
          <MHead icon="⚙️" title="Правила классификации" onClose={() => modal.close()} />
          <MBody>
            {list.length === 0 ? (
              <div className="p-20 t-center c-t3">Нет правил</div>
            ) : (
              <div className="ov-auto" style={{ maxHeight: 400 }}>
                {list.map((r) => (
                  <div key={r.id} className="row gap-8 fs-12-5 tbl-row-brd-2 pad-cell-y6">
                    <div className="flex-1 fw-600">{r.pattern}</div>
                    <div className="w-70">{r.direction || 'все'}</div>
                    <div className="w-110">{ARTICLES[r.article] || r.article}</div>
                    <div className="w-40 t-right">{r.usage_count || 0}</div>
                    <div className="w-20">{r.is_system ? '🔒' : ''}</div>
                  </div>
                ))}
              </div>
            )}
          </MBody>
          <MFoot align="end">
            <Btn variant="primary" onClick={() => modal.close()}>Закрыть</Btn>
          </MFoot>
        </MCard>,
        { size: 'wide' }
      );
    } catch (e) {
      toast.error('Не удалось загрузить правила');
    }
  };
  const onExport1c = async () => {
    // 1С-выгрузка через blob+Authorization header (без токена в URL — security D-4)
    try {
      await openProtected(
        '/api/integrations/bank/export/1c?date_from=2020-01-01&date_to=2030-12-31',
        'bank_1c_export.xml'
      );
    } catch (e) {
      toast.error('Экспорт 1С: ' + (e?.message || e));
    }
  };

  if (loading && !items.length) {
    return <div className="card p-32 t-center c-t3">⏳ Загружаем…</div>;
  }
  const s = stats || {};
  return (
    <>
      <div className="int-stats">
        <div className="int-stat">
          <div className="val c-ok" >{fmtMoney(s.total_income || 0)}</div>
          <div className="lbl">Доходы</div>
        </div>
        <div className="int-stat">
          <div className="val c-err" >{fmtMoney(s.total_expense || 0)}</div>
          <div className="lbl">Расходы</div>
        </div>
        <div className="int-stat">
          <div className="val c-gold" >{fmtMoney(s.balance || 0)}</div>
          <div className="lbl">Баланс</div>
        </div>
        <div className="int-stat">
          <div className="val c-amber" >{s.unclassified_count || 0}</div>
          <div className="lbl">Неразнесённых</div>
        </div>
      </div>

      <div className="int-toolbar">
        <Btn variant="primary" onClick={() => { window.location.hash = '#/bank-import'; }}>
          🏦 Полный модуль импорта →
        </Btn>
        <Btn variant="ghost" onClick={onUpload}>📥 Быстрая загрузка</Btn>
        <Btn variant="ghost" onClick={onExport1c}>📤 Экспорт в 1С</Btn>
        <Btn variant="ghost" onClick={onRules}>⚙️ Правила</Btn>
        <SelectInput value={status} onChange={setStatus} options={STATUS_OPTS} />
        <SelectInput value={direction} onChange={setDirection} options={DIR_OPTS} />
        <div className="min-w-200 flex-1">
          <SearchInput value={q} onChange={setQ} placeholder="Поиск по транзакциям…" />
        </div>
      </div>

      <div className="card card-pad-overflow">
        {items.length === 0 ? (
          <div className="p-32 t-center c-t3">Нет транзакций</div>
        ) : (
          <>
            <div className="int-tx-head">
              <div>
                <input type="checkbox"
                  checked={items.length > 0 && picked.size === items.length}
                  onChange={(e) => toggleAll(e.target.checked)} />
              </div>
              <div>Дата</div>
              <div>Сумма</div>
              <div>Контрагент</div>
              <div>Статья</div>
              <div>Проект</div>
              <div>Статус</div>
            </div>
            {items.map((tx) => {
              const st = TX_STATUS[tx.status] || TX_STATUS.new;
              return (
                <div key={tx.id} className={'int-tx-row ' + (tx.status === 'new' ? 'new' : tx.status === 'distributed' ? 'dist' : '')}>
                  <div onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={picked.has(tx.id)} onChange={() => togglePick(tx.id)} />
                  </div>
                  <div>{fmtDate(tx.transaction_date)}</div>
                  <div className={'int-tx-amount ' + (tx.direction === 'income' ? 'in' : 'out')}>
                    {tx.direction === 'income' ? '+' : '−'}{fmtMoney(tx.amount).replace(' ₽', '')}
                  </div>
                  <div className="int-tx-counterparty" title={tx.payment_purpose || ''}>
                    {tx.counterparty_name || '—'}
                  </div>
                  <div>{ARTICLES[tx.article] || tx.article || <span className="c-amber">—</span>}</div>
                  <div>{tx.work_number || '—'}</div>
                  <div>
                    <span className="int-tx-status" style={{ background: st.c + '22', color: st.c }}>{st.l}</span>
                  </div>
                </div>
              );
            })}
            <div className="p-10 fs-12 c-t3">
              Показано {items.length} из {total} {picked.size ? `· выбрано: ${picked.size}` : ''}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function UploadModal({ onDone }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const doUpload = async (files) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const token = (() => { try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; } })();
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/integrations/bank/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: fd
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) {
        setResult(d);
        toast.success(`Загружено: ${d.stats?.new || 0} новых транзакций`);
        onDone?.();
      } else {
        setErr(d.error || 'Не удалось обработать файл');
      }
    } catch (e) {
      setErr(e.message || 'Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="📥" title="Загрузить выписку" subtitle="CSV, TXT (1С, Тинькофф, Сбер, Точка)" onClose={() => close()} />
      <MBody>
        {result ? (
          <div className="int-card">
            <div className="fw-700 mb-8">✅ Загружено! Формат: {result.format}</div>
            <div className="grid-2 gap-8 fs-13">
              <div>Всего: <b>{result.stats?.total}</b></div>
              <div>Новых: <b className="c-ok">{result.stats?.new}</b></div>
              <div>Дубликатов: <b className="c-err">{result.stats?.duplicates}</b></div>
              <div>Авто-классиф.: <b className="c-blue">{result.stats?.auto}</b></div>
              <div>Требуют разноски: <b className="c-amber">{result.stats?.manual}</b></div>
            </div>
          </div>
        ) : (
          <FileDrop
            accept=".csv,.txt"
            hint={busy ? 'Обработка…' : 'Перетащите файл или нажмите'}
            onFiles={doUpload}
          />
        )}
        {err && <div className="ur-result err mt-12" >{err}</div>}
      </MBody>
      <MFoot>
        <Btn variant="primary" onClick={() => close()}>{result ? 'Готово' : 'Закрыть'}</Btn>
      </MFoot>
    </MCard>
  );
}
