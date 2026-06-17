import { useState, useMemo, useEffect } from 'react';
import { EmptyState } from '@/blocks/Blocks';
import { StatusBadge } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { useModal } from '@/modals';
import { CALC_STATUSES, fmtMoney, loadAutoEstimateStatusBatch } from './api';
import { TenderDocsModal } from './modals/TenderDocsModal';

const PAGE = 25;

export default function PmCalcsList({ tenders, pmsById, showPm, onOpen, onMimir, sort, onSortChange }) {
  const modal = useModal();
  const [page, setPage] = useState(1);
  const [mimirStatuses, setMimirStatuses] = useState({});

  const openDocs = (t) => {
    modal.open(<TenderDocsModal tenderId={t.id} purchaseUrl={t.purchase_url} />);
  };

  useEffect(() => {
    const ids = tenders.map((t) => t.id).slice(0, 50);
    if (!ids.length) return;
    loadAutoEstimateStatusBatch(ids).then(setMimirStatuses);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenders.length]);

  const sorted = useMemo(() => {
    const arr = [...tenders];
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
  }, [tenders, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = sorted.slice((safePage - 1) * PAGE, safePage * PAGE);

  if (!tenders.length) {
    return <EmptyState icon="🧮" title="Просчётов нет" hint="Тендеры от ТО ещё не переданы. Жди handoff." />;
  }

  const Th = ({ k, label, wCls, num }) => (
    <th
      className={'th-sort' + (num ? ' t-right' : '') + (wCls ? ' ' + wCls : '')}
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
                <Th k="customer_name" label="Заказчик / Тендер" />
                {showPm && <Th k="pm_id" label="РП" wCls="w-140" />}
                <Th k="tender_status" label="Статус" wCls="w-150" />
                <Th k="deadline_at" label="Дедлайн" wCls="w-120" />
                <Th k="tender_price" label="Цена" wCls="w-130" num />
                <th className="w-200">AI Мимир</th>
                <th className="w-90"></th>
              </tr>
            </thead>
            <tbody>
              {slice.map((t) => {
                const statusMeta = CALC_STATUSES.find((s) => s.value === t.tender_status) || { label: t.tender_status || '—', tone: 'draft' };
                const mimir = mimirStatuses[t.id];
                return (
                  <tr key={t.id} className="pmc-row" data-status={t.tender_status} onClick={() => onOpen?.(t)}>
                    <td className="pmc-id">#{t.id}</td>
                    <td>
                      <div className="pmc-customer">{t.customer_name || '—'}</div>
                      {t.tender_name && (
                        <div className="pmc-title">{t.tender_name}</div>
                      )}
                    </td>
                    {showPm && <td className="pmc-pm">{pmsById[t.pm_id]?.name || pmsById[t.pm_id]?.login || '—'}</td>}
                    <td><StatusBadge tone={statusMeta.tone} label={statusMeta.label} /></td>
                    <td><DeadlinePill value={t.deadline_at} /></td>
                    <td className="pmc-price">{fmtMoney(t.tender_price)}</td>
                    <td>
                      {mimir ? (
                        <MimirBadge status={mimir} />
                      ) : (
                        <span className="pmc-mimir none">—</span>
                      )}
                    </td>
                    <td className="pmc-actions">
                      <div className="pmc-actions-wrap" onClick={(e) => e.stopPropagation()}>
                        <Btn size="sm" variant="primary" onClick={() => onMimir?.(t)} title="Просчитать через AI">⚡</Btn>
                        <Btn size="sm" onClick={() => onOpen?.(t)} title="Открыть">✎</Btn>
                        {/* Vanilla pm_calcs.js:681-683 — три прямые ссылки/кнопки */}
                        <a
                          className="m-btn ghost btn-mini"
                          href="#/gantt-calcs"
                          onClick={(e) => e.stopPropagation()}
                          title="Гантт (полный)"
                          style={{ textDecoration: 'none' }}
                        >📊 Гантт</a>
                        <Btn size="sm" variant="ghost" onClick={() => openDocs(t)} title="Комплект документов">📁 Комплект</Btn>
                        {t.purchase_url && (
                          <a
                            className="m-btn ghost btn-mini"
                            href={t.purchase_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Площадка закупки"
                            style={{ textDecoration: 'none' }}
                          >🌐 Площадка</a>
                        )}
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
        <div className="pager">
          <button className="btn-ghost" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
          <span className="pager-info">{safePage} / {pages} · {sorted.length} шт.</span>
          <button className="btn-ghost" disabled={safePage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</button>
        </div>
      )}
    </>
  );
}

function MimirBadge({ status }) {
  const st = status?.state || status?.status;
  if (st === 'running')   return <span className="pmc-mimir running">⏳ Считает</span>;
  if (st === 'done')      return <span className="pmc-mimir done">✅ Готово</span>;
  if (st === 'questions') return <span className="pmc-mimir questions">❓ Вопросы</span>;
  if (st === 'error')     return <span className="pmc-mimir error">✗ Ошибка</span>;
  return <span className="pmc-mimir none">—</span>;
}

/** Дедлайн-пилюля (горит < 3д / скоро < 7д / норма). */
function DeadlinePill({ value }) {
  if (!value) return <span className="pmc-deadline none">—</span>;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return <span className="pmc-deadline none">—</span>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  const text = d.toLocaleDateString('ru-RU');
  if (days < 0)  return <span className="pmc-deadline hot" title={`Истёк ${-days} дн.`}>🔴 {text}</span>;
  if (days < 3)  return <span className="pmc-deadline hot" title="Горит">🔴 {text}</span>;
  if (days < 7)  return <span className="pmc-deadline soon" title="Скоро дедлайн">🟡 {text}</span>;
  return <span className="pmc-deadline ok">🟢 {text}</span>;
}
