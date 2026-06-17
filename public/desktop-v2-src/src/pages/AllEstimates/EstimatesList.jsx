/**
 * Таблица «Свод Расчётов» — сортировка, пагинация, пустое состояние.
 */
import { useState, useMemo } from 'react';
import { EmptyState } from '@/blocks/Blocks';
import EstimateRow from './EstimateRow';

const PAGE = 25;

export default function EstimatesList({ estimates, onOpen, sort, onSortChange, vatPct }) {
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const arr = [...estimates];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      let va = a[key];
      let vb = b[key];
      if (key === 'customer') { va = a.customer || a.customer_name || ''; vb = b.customer || b.customer_name || ''; }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'ru') * dir;
    });
    return arr;
  }, [estimates, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = sorted.slice((safePage - 1) * PAGE, safePage * PAGE);

  if (!estimates.length) {
    return (
      <EmptyState
        icon="📋"
        title="Просчётов не найдено"
        hint="Когда РП отправят расчёты на согласование — они появятся здесь"
      />
    );
  }

  const Th = ({ k, label, w, align = 'left' }) => (
    <th
      style={{
        width: w,
        cursor: 'pointer',
        userSelect: 'none',
        textAlign: align,
        padding: '10px 12px'
      }}
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
                <Th k="customer" label="Заказчик / Тендер" />
                <Th k="pm_name" label="РП" w={160} />
                <Th k="version_no" label="v" w={60} />
                <Th k="approval_status" label="Статус" w={180} />
                <Th k="price_tkp" label="Цена ТКП" w={180} align="right" />
                <Th k="cost_plan" label="Себестоим." w={150} align="right" />
              </tr>
            </thead>
            <tbody>
              {slice.map((e) => (
                <EstimateRow key={e.id} estimate={e} onOpen={onOpen} vatPct={vatPct} />
              ))}
            </tbody>
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
