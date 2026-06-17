/**
 * Таблица всех работ по компании.
 * Сортировка по колонкам, пагинация, EmptyState.
 */
import { useState, useMemo } from 'react';
import { EmptyState } from '@/blocks/Blocks';
import { StatusBadge, toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { copyToClipboard } from '@/api/useListHelpers';
import { fmtMoney, fmtDate, WORK_STATUSES } from './api';

const PAGE = 25;

const STATUS_TONE = {
  new: 'draft',
  preparation: 'question',
  mobilization: 'sent',
  in_work: 'approved',
  pause: 'question',
  finished: 'approved',
  act_sign: 'sent',
  closed: 'approved',
  cancelled: 'rejected',
  // Русские каноники с бэка
  'Новая': 'draft',
  'Подготовка': 'question',
  'Мобилизация': 'sent',
  'В работе': 'approved',
  'На паузе': 'question',
  'Работы сдали': 'approved',
  'Подписание акта': 'sent',
  'Закрыт': 'approved'
};

function statusLabel(value) {
  const meta = WORK_STATUSES.find((s) => s.value === value);
  return meta?.label || value || '—';
}

export default function WorksList({ works, pmsById, onOpen, onCreateTkp, sort, onSortChange }) {
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const arr = [...works];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      let va = a[key];
      let vb = b[key];
      // company-сорт: считаем по customer_name
      if (key === 'company') { va = a.customer_name || a.customer || ''; vb = b.customer_name || b.customer || ''; }
      if (key === 'pm_name')  { va = pmsById[a.pm_id]?.name || ''; vb = pmsById[b.pm_id]?.name || ''; }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'ru') * dir;
    });
    return arr;
  }, [works, sort, pmsById]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = sorted.slice((safePage - 1) * PAGE, safePage * PAGE);

  // v2 BONUS: подитог в футере таблицы — сумма контрактов/полученного/долга по видимой странице
  // (vanilla показывала только KPI ВСЕЙ выборки наверху, не postraничный итог).
  const pageTotals = useMemo(() => {
    let contract = 0, received = 0;
    for (const w of slice) {
      contract += Number(w.contract_value || 0);
      received += Number(w.advance_received || 0) + Number(w.balance_received || 0);
    }
    return { contract, received, left: Math.max(0, contract - received) };
  }, [slice]);

  if (!works.length) {
    return (
      <EmptyState
        icon="🏗️"
        title="Работ не найдено"
        hint="Попробуйте сбросить фильтры или сменить период"
      />
    );
  }

  const Th = ({ k, label, w, align = 'left' }) => (
    <th
      style={{ width: w, cursor: 'pointer', userSelect: 'none', textAlign: align, padding: '10px 12px' }}
      onClick={() => onSortChange?.(k)}
    >
      {label}
      {sort.key === k && (
        <span className="ml-4 c-gold">{sort.dir < 0 ? '↓' : '↑'}</span>
      )}
    </th>
  );

  return (
    <>
      <div className="card card-pad-overflow">
        <div className="ov-x-auto">
          <table className="t-list w-full tbl-base">
            <thead>
              <tr className="bg-inner tbl-row-brd">
                <Th k="id" label="ID" w={72} />
                <Th k="company" label="Заказчик / Работа" />
                <Th k="pm_name" label="РП" w={160} />
                <Th k="work_status" label="Статус" w={170} />
                <Th k="contract_value" label="Деньги" w={200} align="right" />
                <Th k="start_in_work_date" label="Сроки" w={180} />
                {onCreateTkp && <th style={{ width: 110, padding: '10px 12px' }}></th>}
              </tr>
            </thead>
            <tbody>
              {slice.map((w) => {
                const pm = pmsById[w.pm_id];
                const tone = STATUS_TONE[w.work_status] || 'info';
                const received = (Number(w.advance_received || 0) + Number(w.balance_received || 0)) || 0;
                const contract = Number(w.contract_value || 0);
                const left = contract > 0 ? Math.max(0, contract - received) : 0;
                const start = fmtDate(w.start_in_work_date || w.start_date);
                const end = fmtDate(w.end_fact || w.end_plan);
                return (
                  <tr
                    key={w.id}
                    className="row-hover cur-p tbl-row-brd-2"
                    onClick={() => onOpen?.(w)}
                  >
                    <td className="font-mono c-t3 fs-12 pad-cell-lg" onClick={(e) => e.stopPropagation()}>
                      {/* v2 BONUS: click ID — copy в буфер для вставки в чаты/задачи (vanilla не имеет) */}
                      <button
                        type="button"
                        title={`Скопировать ID #${w.id}`}
                        onClick={async () => {
                          const ok = await copyToClipboard('#' + w.id);
                          if (ok) toast.success('Скопировано: #' + w.id);
                        }}
                        style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, font: 'inherit' }}
                      >#{w.id}</button>
                    </td>
                    <td className="pad-cell-lg">
                      <div className="fw-600 c-t1">{w.customer_name || w.customer || '—'}</div>
                      {w.work_title && (
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--t-3)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: 420,
                            marginTop: 2
                          }}
                        >
                          {w.work_title}
                        </div>
                      )}
                    </td>
                    <td className="pad-cell-lg c-t2">{pm?.name || pm?.login || '—'}</td>
                    <td className="pad-cell-lg">
                      <StatusBadge tone={tone} label={statusLabel(w.work_status)} />
                    </td>
                    <td className="pad-cell-lg t-right">
                      <div className="fw-700 c-t1">{fmtMoney(contract)}</div>
                      {contract > 0 && (
                        <div className="fs-11 c-t3 mt-2">
                          получено: {fmtMoney(received)} · должны: {fmtMoney(left)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--t-2)' }}>
                      <div>{start}</div>
                      <div className="c-t3">→ {end}</div>
                    </td>
                    {onCreateTkp && (
                      <td style={{ padding: '10px 12px' }} onClick={(e) => e.stopPropagation()}>
                        <Btn
                          size="sm"
                          variant="ghost"
                          title="Создать ТКП на основе работы"
                          onClick={(e) => { e.stopPropagation(); onCreateTkp(w); }}
                        >
                          📄 ТКП
                        </Btn>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            {/* v2 BONUS: подитог по странице (vanilla показывала только глобальные KPI) */}
            {slice.length > 1 && (
              <tfoot>
                <tr className="bg-inner" style={{ fontWeight: 700 }}>
                  <td className="pad-cell-lg c-t3 fs-12" colSpan={4}>
                    Итого на странице · {slice.length} {slice.length === 1 ? 'работа' : 'работ'}
                  </td>
                  <td className="pad-cell-lg t-right">
                    <div>{fmtMoney(pageTotals.contract)}</div>
                    <div className="fs-11 c-t3 mt-2">
                      получено: {fmtMoney(pageTotals.received)} · должны: {fmtMoney(pageTotals.left)}
                    </div>
                  </td>
                  <td colSpan={onCreateTkp ? 2 : 1} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 12,
            marginTop: 12
          }}
        >
          <button className="m-btn ghost" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ‹
          </button>
          <span className="c-t3 fs-13">
            {safePage} / {pages} · {sorted.length} шт.
          </span>
          <button
            className="m-btn ghost"
            disabled={safePage === pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
          >
            ›
          </button>
        </div>
      )}
    </>
  );
}
