import { useState, useMemo } from 'react';
import { EmptyState } from '@/blocks/Blocks';
import WorkRow from './WorkRow';

const PAGE = 25;

export default function PmWorksList({ works, readiness, onOpen, sort, onSortChange }) {
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const arr = [...works];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return arr;
  }, [works, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = sorted.slice((safePage - 1) * PAGE, safePage * PAGE);

  if (!works.length) {
    return <EmptyState icon="🏗️" title="Работ нет" hint="Здесь будут показаны ваши работы (по тендерам с win-pending)" />;
  }

  const Th = ({ k, label, wCls }) => (
    <th
      className={'th-sort' + (wCls ? ' ' + wCls : '')}
      onClick={() => onSortChange?.(k)}
    >
      {label}
      {sort.key === k && <span className="th-sort-arrow">{sort.dir < 0 ? '↓' : '↑'}</span>}
    </th>
  );

  return (
    <>
      <div className="card card-pad-0 ov-hidden">
        <div className="ov-x-auto">
          <table className="t-list">
            <thead>
              <tr>
                <Th k="id" label="ID" wCls="w-70" />
                <Th k="customer_name" label="Заказчик / Работа" />
                <Th k="contract_value" label="Контракт" wCls="w-130" />
                <Th k="start_date" label="Сроки" wCls="w-200" />
                <th className="w-130">Готовность</th>
                <Th k="work_status" label="Статус" wCls="w-150" />
                <th className="w-100"></th>
              </tr>
            </thead>
            <tbody>
              {slice.map((w) => (
                <WorkRow
                  key={w.id}
                  work={w}
                  readiness={readiness}
                  onOpen={onOpen}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="pager">
          <button className="btn-ghost" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
          <span className="pager-info">
            {safePage} / {pages} · {sorted.length} шт.
          </span>
          <button className="btn-ghost" disabled={safePage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</button>
        </div>
      )}
    </>
  );
}
