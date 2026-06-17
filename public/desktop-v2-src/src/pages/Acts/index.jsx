/**
 * Страница /acts — Акты выполненных работ.
 * Источник: vanilla `public/assets/js/acts.js` (~240 строк).
 *
 *   ✅ index.jsx          — список + поиск + фильтр + действия
 *   ✅ ActEditModal.jsx   — создание/редактирование
 *   ✅ ActDetailModal.jsx — карточка + действия (подписать/оплачен/PDF/удалить)
 *   ✅ api.js             — endpoints + helpers
 *
 * RBAC: создавать/править/подписывать — ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, PM, BUH.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import ActEditModal   from './ActEditModal';
import ActDetailModal from './ActDetailModal';
import { loadActs, updateAct, STATUSES, STATUS_OPTIONS, fmtMoney, fmtDate } from './api';
import './acts.css';

const PAGE = 25;
const WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'PM', 'BUH'];

export default function ActsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [list,    setList]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [query,   setQuery]   = useState('');
  const dQuery = useDebounce(query, 300);  // G-11: debounce 300мс на поиск
  const [status,  setStatus]  = useState('');
  const [page,    setPage]    = useState(1);

  const canWrite = WRITE_ROLES.includes(user?.role);

  const refresh = () => {
    setLoading(true);
    loadActs({ limit: 2000 })
      .then(setList)
      .catch((e) => toast.error('Не удалось загрузить акты: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('asgard:acts:changed', h);
    return () => window.removeEventListener('asgard:acts:changed', h);
  }, []);

  // Deep-link ?id=NN
  useEffect(() => {
    const tryOpen = () => {
      const m = (window.location.hash || '').match(/[?&]id=(\d+)/);
      if (m && m[1]) {
        modal.open(<ActDetailModal actId={Number(m[1])} />, { size: 'wide' });
        window.location.hash = '#/acts';
      }
    };
    tryOpen();
    window.addEventListener('hashchange', tryOpen);
    return () => window.removeEventListener('hashchange', tryOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let v = list;
    if (status) v = v.filter((a) => a.status === status);
    if (dQuery.trim()) {
      const lq = dQuery.trim().toLowerCase();
      v = v.filter((a) =>
        (a.act_number    || '').toLowerCase().includes(lq) ||
        (a.customer_name || '').toLowerCase().includes(lq) ||
        (a.customer_inn  || '').includes(lq) ||
        (a.description   || '').toLowerCase().includes(lq) ||
        String(a.id).includes(lq)
      );
    }
    return v;
  }, [list, status, dQuery]);

  const summary = useMemo(() => {
    const total = filtered.reduce((s, a) => s + Number(a.total_amount || 0), 0);
    const signed = filtered.filter((a) => a.status === 'signed' || a.status === 'paid').length;
    return { total, signed, count: filtered.length };
  }, [filtered]);

  useEffect(() => { setPage(1); }, [dQuery, status]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = filtered.slice((safePage - 1) * PAGE, safePage * PAGE);

  const onCreate = () => {
    if (!canWrite) {
      toast.warn('Создавать акты могут только: ADMIN, директора, PM, BUH');
      return;
    }
    modal.open(<ActEditModal act={null} onSaved={refresh} />, { size: 'wide' });
  };
  const onOpen = (a) => {
    modal.open(<ActDetailModal actId={a.id} />, { size: 'wide' });
  };
  const onEdit = (a, e) => {
    e?.stopPropagation?.();
    if (!canWrite) return;
    modal.open(<ActEditModal act={a} onSaved={refresh} />, { size: 'wide' });
  };
  // Vanilla acts.js → signAct(actId): быстрая подпись из строки таблицы.
  const onSign = async (a, e) => {
    e?.stopPropagation?.();
    if (!canWrite) return;
    if (a.status === 'signed' || a.status === 'paid') {
      toast.info('Акт уже подписан');
      return;
    }
    try {
      await updateAct(a.id, { ...a, status: 'signed', signed_date: new Date().toISOString().slice(0, 10) });
      toast.success('Акт отмечен подписанным');
      refresh();
    } catch (err) {
      toast.error('Ошибка: ' + (err?.message || err));
    }
  };

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Финансы"
        title="Акты выполненных работ"
        subtitle={`${filtered.length} ${pluralize(filtered.length, ['акт', 'акта', 'актов'])} · ${fmtMoney(summary.total)} · подписано ${summary.signed}`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {canWrite && <Btn variant="primary" onClick={onCreate}>+ Новый акт</Btn>}
          </>
        }
      />

      <div className="act-toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Поиск: номер, контрагент, ИНН, описание…" />
        <SelectInput value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем акты…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📄"
          title={query || status ? 'Ничего не нашли' : 'Актов пока нет'}
          hint={query || status ? 'Попробуйте изменить фильтры' : 'Создайте первый акт через «+ Новый акт»'}
          action={canWrite ? <Btn variant="primary" onClick={onCreate}>+ Новый акт</Btn> : null}
        />
      ) : (
        <>
          <div className="act-tbl-wrap">
            <div className="act-tbl-scroll">
              <table className="act-table">
                <thead>
                  <tr>
                    <th>№ акта</th>
                    <th>Дата</th>
                    <th>Контрагент</th>
                    <th className="num">Сумма</th>
                    <th>Статус</th>
                    <th className="t-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((a) => {
                    const st = STATUSES[a.status] || STATUSES.draft;
                    return (
                      <tr key={a.id} className="row-clickable" onClick={() => onOpen(a)}>
                        <td><span className="act-num">{a.act_number || '#' + a.id}</span></td>
                        <td>{fmtDate(a.act_date)}</td>
                        <td>{a.customer_name || '—'}</td>
                        <td className="num">{fmtMoney(a.total_amount)}</td>
                        <td>
                          <span
                            className="act-pill"
                            style={{
                              background: `color-mix(in srgb, ${st.color} 18%, transparent)`,
                              color: st.color,
                              borderColor: `color-mix(in srgb, ${st.color} 30%, transparent)`
                            }}
                          >{st.label}</span>
                        </td>
                        <td>
                          <div className="act-row-actions">
                            {canWrite && <Btn size="sm" variant="ghost" onClick={(e) => onEdit(a, e)} title="Редактировать">✎</Btn>}
                            {canWrite && a.status !== 'signed' && a.status !== 'paid' && (
                              <Btn size="sm" variant="success" onClick={(e) => onSign(a, e)} title="Подписать">✍️</Btn>
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
