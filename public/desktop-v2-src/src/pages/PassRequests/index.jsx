/**
 * Страница /pass-requests — Заявки на пропуск.
 * Источник: vanilla `public/assets/js/pass-requests-page.js` + backend
 * `src/routes/pass_requests.js` (PDF, smart-статусы, уведомления).
 *
 *   ✅ index.jsx                — root + KPI + фильтры + таблица + действия
 *   ✅ api.js                   — endpoints + helpers
 *   ✅ PassRequestEditModal.jsx — форма (объект, период, рабочие, ТС, оборудование)
 *   ✅ pass-requests.css        — стили
 *
 * RBAC создания/правки: см. WRITE_ROLES.
 * Действия со строкой:
 *   • 📄 PDF (через blob + Authorization header — без токена в URL)
 *   • ✎ Открыть / редактировать
 *   • 📨 Подать (draft → submitted)
 *   • ✅ Одобрить (submitted → approved)
 *   • ❌ Отклонить (submitted → rejected) с causes
 *   • 🪪 Выдан (approved → issued)
 *   • 🗑 Удалить (ADMIN, только draft)
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal, PromptModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
// v2 BONUS: hotkeys + LS-persist + CSV export (vanilla не имеет)
import { useDebounce, useLocalStorage, useHotkeys, exportToCsv } from '@/api/useListHelpers';

import {
  WRITE_ROLES, STATUS_FILTERS,
  loadList, loadWorks, loadEmployees, loadCustomers,
  changeStatus, deleteRequest, describeStatus,
  fmtDate, fmtDateRange, filterByQuery, downloadPdf
} from './api';
import { PassRequestEditModal } from './PassRequestEditModal';
import './pass-requests.css';

export default function PassRequestsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [list, setList] = useState([]);
  const [works, setWorks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 300);  // G-11: debounce 300мс
  // v2 BONUS: persist выбранного фильтра статуса (vanilla сбрасывала)
  const [filterStatus, setFilterStatus] = useLocalStorage('prq-status', '');

  const isAdmin = user?.role === 'ADMIN';
  const canWrite = !user || WRITE_ROLES.includes(user.role);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      loadList(),
      loadWorks().catch(() => []),
      loadEmployees().catch(() => []),
      loadCustomers().catch(() => [])
    ])
      .then(([items, ws, emps, cs]) => {
        setList(items);
        setWorks(ws);
        setEmployees(emps);
        setCustomers(cs);
      })
      .catch((e) => toast.error('Не удалось загрузить заявки: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [user?.id]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:pass-requests:changed', onChanged);
    return () => window.removeEventListener('asgard:pass-requests:changed', onChanged);
    /* eslint-disable-next-line */
  }, []);

  // Hash ?id=123 — открыть конкретную заявку
  useEffect(() => {
    const check = () => {
      const hash = window.location.hash || '';
      const m = hash.match(/[?&]id=(\d+)/);
      if (m) {
        const id = Number(m[1]);
        if (id) openEdit(id);
        window.location.hash = '#/pass-requests';
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
    /* eslint-disable-next-line */
  }, [employees, works, customers]);

  const filtered = useMemo(() => {
    let v = list.slice();
    v = filterByQuery(v, dSearch);
    if (filterStatus) v = v.filter((r) => r.status === filterStatus);
    v.sort((a, b) => (b.id || 0) - (a.id || 0));
    return v;
  }, [list, dSearch, filterStatus]);

  const kpi = useMemo(() => {
    const c = { total: list.length, draft: 0, submitted: 0, approved: 0, rejected: 0, issued: 0 };
    for (const r of list) {
      if (c[r.status] !== undefined) c[r.status]++;
    }
    return c;
  }, [list]);

  const openEdit = (id) => {
    modal.open(
      <PassRequestEditModal
        requestId={id}
        employees={employees}
        works={works}
        customers={customers}
        onSaved={refresh}
      />,
      { size: 'wide' }
    );
  };

  const onCreate = () => {
    if (!canWrite) {
      toast.warn('Нет прав на создание заявок');
      return;
    }
    modal.open(
      <PassRequestEditModal
        employees={employees}
        works={works}
        customers={customers}
        onSaved={refresh}
      />,
      { size: 'wide' }
    );
  };

  const doStatusChange = async (id, status, label) => {
    try {
      await changeStatus(id, status);
      toast.success(label);
      window.dispatchEvent(new CustomEvent('asgard:pass-requests:changed'));
      refresh();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  };

  const onSubmit = (r, e) => {
    e?.stopPropagation?.();
    modal.open(
      <ConfirmModal
        title="Подать заявку?"
        message={`Заявка #${r.id} «${r.object_name}» будет отправлена на согласование.`}
        tone="info"
        okText="📨 Подать"
        onConfirm={() => doStatusChange(r.id, 'submitted', 'Заявка подана')}
      />
    );
  };

  const onApprove = (r, e) => {
    e?.stopPropagation?.();
    modal.open(
      <ConfirmModal
        title="Одобрить заявку?"
        message={`Заявка #${r.id} «${r.object_name}» будет одобрена. Автору придёт уведомление.`}
        tone="success"
        okText="✅ Одобрить"
        onConfirm={() => doStatusChange(r.id, 'approved', 'Заявка одобрена')}
      />
    );
  };

  const onReject = (r, e) => {
    e?.stopPropagation?.();
    modal.open(
      <PromptModal
        title="Причина отклонения"
        subtitle={`Заявка #${r.id} «${r.object_name}». Причина уйдёт автору.`}
        label="Причина"
        placeholder="Например: некорректные данные паспорта…"
        multiline
        icon="❌"
        accent="danger"
        okText="❌ Отклонить"
        onSubmit={async (reason) => {
          try {
            await changeStatus(r.id, 'rejected');
            toast.success('Заявка отклонена' + (reason ? ': ' + reason : ''));
            window.dispatchEvent(new CustomEvent('asgard:pass-requests:changed'));
            refresh();
          } catch (e2) {
            toast.error('Не удалось: ' + (e2?.message || e2));
          }
        }}
      />
    );
  };

  const onIssued = (r, e) => {
    e?.stopPropagation?.();
    modal.open(
      <ConfirmModal
        title="Пропуск выдан?"
        message={`Заявка #${r.id} — отметить как «выдан»?`}
        tone="success"
        okText="🪪 Выдан"
        onConfirm={() => doStatusChange(r.id, 'issued', 'Заявка отмечена как «выдан»')}
      />
    );
  };

  // v2 BONUS: CSV-экспорт текущей выборки для приёмо-выдачи службой безопасности (vanilla не имеет).
  const onExportCsv = () => {
    if (!filtered.length) { toast.warn('Нет заявок для экспорта'); return; }
    const ymd = new Date().toISOString().slice(0, 10);
    exportToCsv(`pass-requests-${ymd}.csv`, filtered, [
      { key: 'id', label: '#' },
      { key: 'object_name', label: 'Объект' },
      { key: 'work_title', label: 'Работа' },
      { key: (r) => fmtDateRange(r.date_from || r.pass_date_from, r.date_to || r.pass_date_to), label: 'Период' },
      { key: (r) => (Array.isArray(r.workers) ? r.workers : (Array.isArray(r.employees_json) ? r.employees_json : [])).length, label: 'Состав' },
      { key: (r) => describeStatus(r.status).label, label: 'Статус' },
      { key: 'created_at', label: 'Создана', format: fmtDate }
    ]);
    toast.success(`Экспортировано ${filtered.length} заявок`);
  };

  // v2 BONUS: hotkeys — / поиск, Ctrl+N создать, Ctrl+E экспорт.
  useHotkeys({
    '/': () => {
      const inp = document.querySelector('.prq-filter input[type=text]');
      if (inp) inp.focus();
    },
    'mod+n': () => { if (canWrite) onCreate(); },
    'mod+e': () => onExportCsv()
  }, [filtered.length, canWrite]);

  const onDelete = (r, e) => {
    e?.stopPropagation?.();
    if (!isAdmin) {
      toast.warn('Удалять заявки может только ADMIN');
      return;
    }
    if (r.status !== 'draft') {
      toast.warn('Удалять можно только черновики');
      return;
    }
    modal.open(
      <ConfirmModal
        title="Удалить заявку?"
        message={`Черновик #${r.id} «${r.object_name}» будет удалён.`}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteRequest(r.id);
            toast.success('Заявка удалена');
            window.dispatchEvent(new CustomEvent('asgard:pass-requests:changed'));
            refresh();
          } catch (err) {
            toast.error('Не удалось удалить: ' + (err?.message || err));
          }
        }}
      />
    );
  };

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Документы"
        title="Заявки на пропуск"
        subtitle={`${filtered.length} из ${list.length} в выборке`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {/* v2 BONUS: CSV-экспорт (vanilla не имеет) */}
            <Btn variant="ghost" onClick={onExportCsv} title="Экспорт CSV (Ctrl+E)">📥 CSV</Btn>
            {canWrite && <Btn variant="primary" onClick={onCreate} title="Создать заявку (Ctrl+N)">+ Новая заявка</Btn>}
          </>
        }
      />

      <div className="prq-kpi">
        <div className="prq-kpi-card">
          <div className="prq-kpi-lab">Всего</div>
          <div className="prq-kpi-val">{kpi.total}</div>
        </div>
        <div className="prq-kpi-card brd-top-t3">
          <div className="prq-kpi-lab">Черновики</div>
          <div className="prq-kpi-val">{kpi.draft}</div>
        </div>
        <div className="prq-kpi-card brd-top-info">
          <div className="prq-kpi-lab">Поданы</div>
          <div className="prq-kpi-val">{kpi.submitted}</div>
        </div>
        <div className="prq-kpi-card brd-top-ok">
          <div className="prq-kpi-lab">Одобрены</div>
          <div className="prq-kpi-val">{kpi.approved}</div>
        </div>
        <div className="prq-kpi-card brd-top-err">
          <div className="prq-kpi-lab">Отклонены</div>
          <div className="prq-kpi-val">{kpi.rejected}</div>
        </div>
        <div className="prq-kpi-card brd-top-gold">
          <div className="prq-kpi-lab">Выданы</div>
          <div className="prq-kpi-val">{kpi.issued}</div>
        </div>
      </div>

      <div className="prq-filter">
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск по объекту, контактному лицу, работе…" />
        <SelectInput value={filterStatus} onChange={setFilterStatus} options={STATUS_FILTERS} />
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем заявки…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🪪"
          title={search || filterStatus ? 'Ничего не нашли' : 'Заявок пока нет'}
          hint={search || filterStatus ? 'Попробуйте изменить фильтры' : 'Создайте первую через «+ Новая заявка»'}
          action={null}
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="prq-table">
              <thead>
                <tr>
                  <th className="w-70">#</th>
                  <th>Объект</th>
                  <th>Работа</th>
                  <th className="w-220">Период</th>
                  <th className="w-110">Состав</th>
                  <th className="w-130">Статус</th>
                  <th className="w-110">Создана</th>
                  <th style={{ width: 270 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <Row
                    key={r.id}
                    r={r}
                    canWrite={canWrite}
                    isAdmin={isAdmin}
                    onOpen={openEdit}
                    onSubmit={onSubmit}
                    onApprove={onApprove}
                    onReject={onReject}
                    onIssued={onIssued}
                    onDelete={onDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ r, canWrite, isAdmin, onOpen, onSubmit, onApprove, onReject, onIssued, onDelete }) {
  const st = describeStatus(r.status);
  const emps = Array.isArray(r.workers) ? r.workers : (Array.isArray(r.employees_json) ? r.employees_json : []);

  return (
    <tr className="prq-row" onClick={() => onOpen(r.id)}>
      <td className="prq-dim">{r.id}</td>
      <td className="prq-obj">{r.object_name || '—'}</td>
      <td className="prq-dim">{r.work_title || '—'}</td>
      <td className="prq-dim">{fmtDateRange(r.date_from || r.pass_date_from, r.date_to || r.pass_date_to)}</td>
      <td className="prq-dim">{emps.length} чел.</td>
      <td><StatusBadge tone={st.tone} label={st.label} /></td>
      <td className="prq-dim">{fmtDate(r.created_at)}</td>
      <td className="prq-actions" onClick={(e) => e.stopPropagation()}>
        <Btn size="sm" variant="ghost" onClick={() => downloadPdf(r.id)} title="PDF">📄</Btn>
        <Btn size="sm" variant="ghost" onClick={() => onOpen(r.id)} title="Открыть">✎</Btn>
        {canWrite && r.status === 'draft' && (
          <Btn size="sm" onClick={(e) => onSubmit(r, e)} title="Подать">📨</Btn>
        )}
        {canWrite && r.status === 'submitted' && (
          <>
            <Btn size="sm" variant="success" onClick={(e) => onApprove(r, e)} title="Одобрить">✅</Btn>
            <Btn size="sm" variant="danger" onClick={(e) => onReject(r, e)} title="Отклонить">❌</Btn>
          </>
        )}
        {canWrite && r.status === 'approved' && (
          <Btn size="sm" onClick={(e) => onIssued(r, e)} title="Выдан">🪪</Btn>
        )}
        {isAdmin && r.status === 'draft' && (
          <Btn size="sm" variant="ghost" onClick={(e) => onDelete(r, e)} title="Удалить">🗑</Btn>
        )}
      </td>
    </tr>
  );
}
