/**
 * StatementTable — «Выписка РП» в банковском стиле.
 *
 * Спека: API_SPEC_PM_STATEMENT.md раздел 3.
 * Backend: GET /api/cash/statement?pm_id=&from=&to=&format=json|xlsx
 *
 * Props:
 *   - pmId            (number|null)  ID РП по которому смотрим выписку.
 *                                    Если null и showPmSelector=true — селектор
 *                                    обязателен (бекенд иначе 400 для админов).
 *   - defaultFrom     (string YYYY-MM-DD) — стартовая дата периода.
 *   - defaultTo       (string YYYY-MM-DD)
 *   - showPmSelector  (bool)         — рендерить ли селектор PM.
 *
 * RBAC на клиенте:
 *   - PM/HEAD_PM      — selector скрыт, pmId = свой user.id (passes from index.jsx).
 *   - ADMIN/DIR/BUH   — selector показан, user выбирает РП → pmId меняется.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { SelectInput, DatePicker } from '@/inputs/Inputs';
import { loadStatement, loadPmsList, getStatementXlsxUrl, fmtMoney, fmtDate } from './api';
// 2026-06-29 — chip-стили (pb-chip-*) для колонки «Источник» переиспользуем из PaymentBreakdown.
import '@/components/PaymentBreakdown.css';

// ─── константы ─────────────────────────────────────────────────────────────

const SOURCE_LABEL = {
  handover:        '💵 От СЗ',
  cash_request:    '🏦 Касса',
  cash_return:     '↩ Возврат',
  worker_payment:  '🧑‍🔧 Рабочему',
  work_expense:    '🧱 Расход',
  cash_expense:    '📦 Прочее'
};

// Группы для chip-фильтра «по категориям» (вторая строка).
const CATEGORY_GROUPS = [
  { key: 'handover',       label: '💵 От СЗ',     pred: (op) => op.source === 'handover' },
  { key: 'cash_request',   label: '🏦 Касса',     pred: (op) => op.source === 'cash_request' },
  { key: 'cash_return',    label: '↩ Возвраты',  pred: (op) => op.source === 'cash_return' },
  { key: 'worker_payment', label: '🧑‍🔧 ЗП/суточные', pred: (op) => op.source === 'worker_payment' },
  { key: 'work_expense',   label: '🧱 Материалы',  pred: (op) => op.source === 'work_expense' },
  { key: 'cash_expense',   label: '📦 Прочее',     pred: (op) => op.source === 'cash_expense' }
];

// Категории worker_payments (категория в operation у нас = wp.type для этого источника)
const WP_TYPE_LABEL = {
  salary:   'Зарплата',
  per_diem: 'Суточные',
  bonus:    'Премии',
  advance:  'Авансы',
  penalty:  'Удержания'
};

// 2026-06-29 — source_kind → chip (icon + tone). pm_cash_legacy склеиваем с pm_cash.
const SOURCE_KIND_META = {
  pm_cash:        { icon: '📤', label: 'Моя касса',      tone: 'cash' },
  pm_cash_legacy: { icon: '📤', label: 'Моя касса',      tone: 'cash' },
  company_bank:   { icon: '🏦', label: 'Банк (справочно)', tone: 'bank' },
  company_se:     { icon: '📱', label: 'СЗ-сервис (справочно)', tone: 'se' },
  auto_fot:       { icon: '⚙',  label: 'Авто-ФОТ',       tone: 'auto' },
  other:          { icon: '◦',  label: 'Прочее',         tone: 'other' }
};

function getSourceKindMeta(kind) {
  return SOURCE_KIND_META[kind] || SOURCE_KIND_META.other;
}

// Период по умолчанию: первое число текущего месяца → сегодня (как у backend).
function defaultPeriod() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    from: first.toISOString().slice(0, 10),
    to:   today.toISOString().slice(0, 10)
  };
}

// ─── компонент ─────────────────────────────────────────────────────────────

export default function StatementTable({
  pmId: initialPmId = null,
  defaultFrom,
  defaultTo,
  showPmSelector = false
}) {
  const dp = useMemo(defaultPeriod, []);
  const [pmId, setPmId] = useState(initialPmId);
  const [from, setFrom] = useState(defaultFrom || dp.from);
  const [to, setTo]   = useState(defaultTo   || dp.to);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pms, setPms] = useState([]);
  const [downloading, setDownloading] = useState(false);

  // Фильтры таблицы
  const [typeFilter, setTypeFilter] = useState('all');      // 'all' | 'income' | 'outflow'
  const [sourceFilter, setSourceFilter] = useState('all');  // 'all' | <source key>
  // 2026-06-29 — скрывать справочные строки (type='info' = деньги не из кассы РП)
  const [hideInfo, setHideInfo] = useState(false);

  // Селектор PM (только для админ-ролей)
  useEffect(() => {
    if (!showPmSelector) return;
    let cancel = false;
    loadPmsList().then((list) => { if (!cancel) setPms(list); });
    return () => { cancel = true; };
  }, [showPmSelector]);

  // initialPmId может меняться (например при логине / перерисовке родителя)
  useEffect(() => { setPmId(initialPmId); }, [initialPmId]);

  const refresh = useCallback(() => {
    // Для админ-ролей без выбранного РП — не дёргаем backend (400).
    if (showPmSelector && !pmId) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    loadStatement({ pm_id: pmId, from, to })
      .then((res) => setData(res || null))
      .catch((e) => {
        setError(e?.serverMsg || e?.message || 'Ошибка загрузки');
        setData(null);
        toast.error('Не удалось загрузить выписку: ' + (e?.serverMsg || e?.message || e));
      })
      .finally(() => setLoading(false));
  }, [pmId, from, to, showPmSelector]);

  useEffect(() => { refresh(); }, [refresh]);

  // ─── скачивание XLSX через fetch + Authorization (window.open не передаёт JWT)
  const onDownload = async () => {
    if (showPmSelector && !pmId) {
      toast.warn('Выберите РП для скачивания');
      return;
    }
    setDownloading(true);
    try {
      const url = getStatementXlsxUrl({ pm_id: pmId, from, to });
      let token = '';
      try { token = localStorage.getItem('asgard_token') || ''; } catch { /* noop */ }
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(t || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const pmName = (data?.pm?.name || 'PM').replace(/[\\/:*?"<>|]/g, '_');
      link.download = `Выписка_${pmName}_${from}_${to}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Освобождаем blob после небольшой задержки, чтобы Chrome успел инициировать download.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (e) {
      toast.error('Не удалось скачать: ' + (e?.message || e));
    } finally {
      setDownloading(false);
    }
  };

  // ─── разбивка для сводки (из operations, чтобы получить salary/per_diem/bonus раздельно) ─
  const breakdown = useMemo(() => {
    const ops = data?.operations || [];
    const result = {
      // Income
      from_se:   0,      // handover
      from_cash: 0,      // cash_request (advance issued)
      // Outflow — по wp.type
      returns:   0,
      salary:    0,
      per_diem:  0,
      bonus:     0,
      advance:   0,
      penalty:   0,
      work_exp:  0,      // work_expense (материалы/такси/жильё)
      cash_exp:  0       // cash_expense (прочее по подотчёту)
    };
    for (const op of ops) {
      const amt = Math.abs(Number(op.amount || 0));
      if (op.source === 'handover') result.from_se += amt;
      else if (op.source === 'cash_request') result.from_cash += amt;
      else if (op.source === 'cash_return') result.returns += amt;
      else if (op.source === 'work_expense') result.work_exp += amt;
      else if (op.source === 'cash_expense') result.cash_exp += amt;
      else if (op.source === 'worker_payment') {
        const cat = op.category;
        if (cat === 'salary')   result.salary   += amt;
        else if (cat === 'per_diem') result.per_diem += amt;
        else if (cat === 'bonus') result.bonus  += amt;
        else if (cat === 'advance') result.advance += amt;
        else if (cat === 'penalty') result.penalty += amt;
        else result.salary += amt;
      }
    }
    return result;
  }, [data]);

  // ─── отфильтрованные операции для таблицы ──────────────────────────────
  const filteredOps = useMemo(() => {
    const ops = data?.operations || [];
    return ops.filter((op) => {
      if (hideInfo && op.type === 'info') return false;
      if (typeFilter !== 'all' && op.type !== typeFilter) return false;
      if (sourceFilter !== 'all' && op.source !== sourceFilter) return false;
      return true;
    });
  }, [data, typeFilter, sourceFilter, hideInfo]);

  const summary = data?.summary || {};

  // Подсчёт количества для chip-фильтров (top bar)
  const counts = useMemo(() => {
    const ops = data?.operations || [];
    const c = { all: ops.length, income: 0, outflow: 0, info: 0 };
    for (const op of ops) {
      if (op.type === 'income') c.income++;
      else if (op.type === 'outflow') c.outflow++;
      else if (op.type === 'info') c.info++;
    }
    return c;
  }, [data]);

  const sourceCounts = useMemo(() => {
    const ops = data?.operations || [];
    const c = {};
    for (const g of CATEGORY_GROUPS) c[g.key] = 0;
    for (const op of ops) {
      if (c[op.source] != null) c[op.source]++;
    }
    return c;
  }, [data]);

  // ─── рендер ────────────────────────────────────────────────────────────
  return (
    <div className="statement-wrap col gap-14">
      {/* Шапка управления */}
      <div className="statement-controls">
        {showPmSelector && (
          <div className="statement-control">
            <label className="statement-control-label">РП</label>
            <SelectInput
              value={pmId ? String(pmId) : ''}
              onChange={(v) => setPmId(v ? Number(v) : null)}
              options={pms.map((p) => ({ value: String(p.id), label: p.full_name }))}
              placeholder="— выберите РП —"
              aria-label="Выбрать РП"
            />
          </div>
        )}
        <div className="statement-control">
          <label className="statement-control-label">С</label>
          <DatePicker value={from} onChange={(v) => setFrom(v || dp.from)} />
        </div>
        <div className="statement-control">
          <label className="statement-control-label">По</label>
          <DatePicker value={to} onChange={(v) => setTo(v || dp.to)} />
        </div>
        <div className="statement-control statement-control-actions">
          <Btn variant="ghost" onClick={refresh} disabled={loading}>↻ Обновить</Btn>
          <Btn
            variant="primary"
            onClick={onDownload}
            disabled={loading || downloading || (showPmSelector && !pmId)}
          >
            {downloading ? '⏳ Готовим…' : '📥 Скачать XLSX'}
          </Btn>
        </div>
      </div>

      {/* Loading / Empty */}
      {loading && (
        <div className="statement-empty">⏳ Загружаем выписку…</div>
      )}

      {!loading && showPmSelector && !pmId && (
        <div className="statement-empty">
          Выберите РП в селекторе выше, чтобы увидеть выписку.
        </div>
      )}

      {!loading && error && !data && (
        <div className="statement-empty err">
          ⚠ Ошибка: {error}
        </div>
      )}

      {!loading && data && (
        <>
          {/* PM + период */}
          <div className="statement-pm-head">
            <div className="statement-pm-name">{data.pm?.name || 'РП'}</div>
            <div className="statement-pm-period">
              {fmtDate(data.period?.from)} — {fmtDate(data.period?.to)}
            </div>
          </div>

          {/* Сводка: 3 числа + разбивка */}
          <div className="statement-grid">
            <SummaryBlock
              title="Приход за период"
              total={summary.total_in}
              tone="income"
              rows={[
                { label: 'От СЗ',          value: breakdown.from_se,   hide: !breakdown.from_se },
                { label: 'Аванс из кассы', value: breakdown.from_cash, hide: !breakdown.from_cash }
              ].filter((r) => !r.hide)}
            />
            <SummaryBlock
              title="Расход за период"
              total={summary.total_out}
              tone="outflow"
              negative
              rows={[
                { label: 'Возвраты',        value: breakdown.returns,  hide: !breakdown.returns },
                { label: 'Зарплата',        value: breakdown.salary,   hide: !breakdown.salary },
                { label: 'Суточные',        value: breakdown.per_diem, hide: !breakdown.per_diem },
                { label: 'Премии',          value: breakdown.bonus,    hide: !breakdown.bonus },
                { label: 'Авансы',          value: breakdown.advance,  hide: !breakdown.advance },
                { label: 'Удержания',       value: breakdown.penalty,  hide: !breakdown.penalty },
                { label: 'Расходы проекта', value: breakdown.work_exp, hide: !breakdown.work_exp },
                { label: 'Прочее',          value: breakdown.cash_exp, hide: !breakdown.cash_exp }
              ].filter((r) => !r.hide)}
            />
            <SummaryBlock
              title="Остаток на конец"
              total={summary.closing_balance}
              tone="balance"
              rows={[
                { label: 'На начало периода', value: summary.opening_balance, signed: true }
              ]}
            />
          </div>

          {/* Фильтры таблицы */}
          <div className="statement-filter-row" role="tablist" aria-label="Фильтр операций">
            <button
              type="button"
              className={'cash-source-chip' + (typeFilter === 'all' ? ' active' : '')}
              role="tab"
              aria-selected={typeFilter === 'all'}
              onClick={() => setTypeFilter('all')}
            >
              Все · {counts.all}
            </button>
            <button
              type="button"
              className={'cash-source-chip' + (typeFilter === 'income' ? ' active' : '')}
              role="tab"
              aria-selected={typeFilter === 'income'}
              onClick={() => setTypeFilter('income')}
            >
              ⬆ Приходы · {counts.income}
            </button>
            <button
              type="button"
              className={'cash-source-chip' + (typeFilter === 'outflow' ? ' active' : '')}
              role="tab"
              aria-selected={typeFilter === 'outflow'}
              onClick={() => setTypeFilter('outflow')}
            >
              ⬇ Расходы · {counts.outflow}
            </button>
            {counts.info > 0 && (
              <button
                type="button"
                className={'cash-source-chip' + (typeFilter === 'info' ? ' active' : '')}
                role="tab"
                aria-selected={typeFilter === 'info'}
                onClick={() => setTypeFilter('info')}
                title="Справочные строки — деньги не из кассы РП"
              >
                ℹ Инфо · {counts.info}
              </button>
            )}
            {/* 2026-06-29 — чекбокс «Скрыть справочные» */}
            {counts.info > 0 && (
              <label className="statement-hide-info" title="Не показывать строки с источниками Банк/СЗ-сервис/Авто-ФОТ — оставить только мою кассу">
                <input
                  type="checkbox"
                  checked={hideInfo}
                  onChange={(e) => setHideInfo(e.target.checked)}
                />
                <span>Скрыть справочные</span>
              </label>
            )}
          </div>

          {/* Доп. фильтры по источнику */}
          <div className="statement-filter-row sub" role="group" aria-label="Фильтр по источнику">
            <button
              type="button"
              className={'cash-source-chip' + (sourceFilter === 'all' ? ' active' : '')}
              onClick={() => setSourceFilter('all')}
            >
              Все источники
            </button>
            {CATEGORY_GROUPS.map((g) => (
              <button
                type="button"
                key={g.key}
                className={'cash-source-chip' + (sourceFilter === g.key ? ' active' : '')}
                onClick={() => setSourceFilter(g.key)}
                disabled={!sourceCounts[g.key]}
                title={!sourceCounts[g.key] ? 'Нет операций этого типа' : ''}
              >
                {g.label} · {sourceCounts[g.key] || 0}
              </button>
            ))}
          </div>

          {/* Таблица операций */}
          <div className="statement-table-wrap">
            {filteredOps.length === 0 ? (
              <div className="statement-empty">
                Нет операций по выбранным фильтрам
              </div>
            ) : (
              <table className="statement-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Тип</th>
                    <th className="num">Сумма</th>
                    <th>Категория</th>
                    <th>Описание</th>
                    <th>Работа</th>
                    <th>Источник</th>
                    <th className="num sticky-right">Баланс</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOps.map((op, idx) => (
                    <OperationRow key={`${op.source}-${op.ref_id}-${idx}`} op={op} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── SummaryBlock ──────────────────────────────────────────────────────────
function SummaryBlock({ title, total, tone, negative, rows = [] }) {
  const n = Number(total || 0);
  const sign = tone === 'income' ? '+' : (tone === 'outflow' ? '−' : (n >= 0 ? '+' : '−'));
  const cls = 'statement-summary tone-' + tone;
  return (
    <div className={cls}>
      <div className="statement-summary-title">{title}</div>
      <div className="statement-summary-total">
        {sign}{fmtMoney(Math.abs(n))}
      </div>
      {rows.length > 0 && (
        <div className="statement-summary-rows">
          {rows.map((r, i) => (
            <div className="statement-summary-row" key={i}>
              <span className="statement-summary-row-l">{r.label}</span>
              <span className="statement-summary-row-v">
                {r.signed
                  ? (Number(r.value) >= 0 ? '+' : '−') + fmtMoney(Math.abs(Number(r.value || 0)))
                  : (negative ? '−' : '') + fmtMoney(Math.abs(Number(r.value || 0)))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── OperationRow ──────────────────────────────────────────────────────────
function OperationRow({ op }) {
  const isIncome = op.type === 'income';
  const isInfo = op.type === 'info';
  const amt = Math.abs(Number(op.amount || 0));
  const sign = isInfo ? '' : (isIncome ? '+' : '−');
  const badgeCls = isInfo ? 'statement-badge-info'
    : isIncome ? 'statement-badge-income'
    : 'statement-badge-outflow';
  const typeLabel = isInfo ? 'ℹ инфо' : (SOURCE_LABEL[op.source] || op.source || '—');

  // Для worker_payment категория = wp.type → подменим лейбл
  const categoryLabel = (() => {
    if (op.source === 'worker_payment' && WP_TYPE_LABEL[op.category]) {
      return WP_TYPE_LABEL[op.category];
    }
    return op.category || '—';
  })();

  // 2026-06-29 — chip источника денег (source_kind из бэка V264)
  const sk = op.source_kind || (isInfo ? 'company_bank' : 'pm_cash');
  const skMeta = getSourceKindMeta(sk);

  return (
    <tr className={'statement-row' + (isInfo ? ' statement-row-info' : '')}>
      <td className="statement-cell-date">{fmtDate(op.date)}</td>
      <td>
        <span className={'statement-badge ' + badgeCls}>
          {typeLabel}
        </span>
      </td>
      <td className={'num ' + (isInfo ? 'amt-info' : (isIncome ? 'amt-income' : 'amt-outflow'))}>
        {sign}{fmtMoney(amt)}
      </td>
      <td className="statement-cell-cat">{categoryLabel}</td>
      <td className="statement-cell-desc" title={op.description || ''}>
        {op.description || '—'}
      </td>
      <td className="statement-cell-work">
        {op.work_title || (op.work_id ? `#${op.work_id}` : '—')}
      </td>
      <td>
        <span className={'pb-chip pb-chip-' + skMeta.tone}>
          {skMeta.icon} {skMeta.label}
        </span>
      </td>
      <td className="num sticky-right statement-cell-bal">
        {isInfo ? '—' : fmtMoney(op.balance_after)}
      </td>
    </tr>
  );
}
