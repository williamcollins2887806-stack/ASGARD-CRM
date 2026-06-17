/**
 * Страница /permit-applications — Заявки на оформление разрешений.
 *
 * Источник: vanilla `public/assets/js/permit_applications.js` (~1278 строк).
 * Backend: `src/routes/permit_applications.js` (prefix /api/permit-applications).
 *
 * ## Vanilla coverage checklist
 *  ✅ index.jsx              — список + поиск + статус-табы + KPI + действия
 *  ✅ FormPage.jsx           — vanilla renderForm (для /permit-application-form)
 *  ✅ api.js                 — все 13 endpoints + статусы + категории + пресеты + helpers
 *  ✅ EmployeeSelectModal    — vanilla openEmployeeSelectModal: чекбоксы + поиск + role-фильтр
 *  ✅ PermitSelectModal      — vanilla openPermitSelectModal: категории-карточки + список с иконками + статусы + 5 пресетов + копирование
 *  ✅ SendConfirmModal       — vanilla openSendConfirmModal: POST /:id/send
 *  ✅ ViewModal              — vanilla openViewModal: read-only c сотрудниками + историей
 *  ✅ Excel-экспорт          — vanilla btnExcel → downloadBlob(/excel)
 *  ✅ Статусы draft/sent/in_progress/completed/cancelled — переходы через ConfirmModal
 *  ✅ Удаление черновика     — vanilla btnDelete через ConfirmModal
 *  ✅ Автокомплит подрядчиков — Combobox + onQuery → /api/permit-applications/contractors
 *  ✅ Без window.confirm/prompt — все подтверждения через Confirm/PromptModal
 *
 * RBAC: ALLOWED_ROLES для просмотра. CREATE_ROLES (ADMIN/HR/TO/HEAD_TO/HR_MANAGER) для CRUD.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { ConfirmModal } from '@/modals/Confirm';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput } from '@/inputs/Inputs';
// v2 BONUS: hotkeys + LS-persist (vanilla не имеет)
import { useDebounce, useLocalStorage, useHotkeys } from '@/api/useListHelpers';

import ViewModal from './ViewModal';
import SendConfirmModal from './SendConfirmModal';
import {
  loadApplications, loadApplication, deleteApplication, setStatus, downloadExcel,
  STATUSES, STATUS_TABS, fmtDate, downloadBlob,
  ALLOWED_ROLES, CREATE_ROLES
} from './api';

import './permit-applications.css';

const PAGE = 50;

export default function PermitApplicationsPage() {
  const { user } = useAuth();
  const modal = useModal();

  // v2 BONUS: persist выбранного статус-таба между сессиями (vanilla сбрасывала на «Все»)
  const [tab, setTab]               = useLocalStorage('pa-tab', '');
  const [query, setQuery]           = useState('');
  // G-11: debounce 300мс — каждое изменение query вызывает /api запрос, debounce критичен.
  const dQuery = useDebounce(query, 300);
  const [apps, setApps]             = useState([]);
  const [counts, setCounts]         = useState({ draft: 0, sent: 0, in_progress: 0, completed: 0, cancelled: 0 });
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [page, setPage]             = useState(1);

  const isAllowed = ALLOWED_ROLES.includes(user?.role);
  const canCreate = CREATE_ROLES.includes(user?.role);

  const refresh = async () => {
    if (!isAllowed) return;
    setLoading(true);
    try {
      const [main, ...byStatus] = await Promise.all([
        loadApplications({ status: tab, search: dQuery, limit: 2000 }),
        ...['draft', 'sent', 'in_progress', 'completed', 'cancelled'].map((st) =>
          loadApplications({ status: st, limit: 1 })
        )
      ]);
      setApps(main.applications || []);
      setTotal(main.total || 0);
      const newCounts = {};
      ['draft', 'sent', 'in_progress', 'completed', 'cancelled'].forEach((st, i) => {
        newCounts[st] = byStatus[i]?.total || 0;
      });
      setCounts(newCounts);
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [tab, dQuery, isAllowed]);
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('asgard:permit-apps:changed', h);
    return () => window.removeEventListener('asgard:permit-apps:changed', h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setPage(1); }, [tab, dQuery]);

  // Deep-link ?id=NN — открывает View
  useEffect(() => {
    const tryOpen = () => {
      const m = (window.location.hash || '').match(/[?&]id=(\d+)/);
      if (m && m[1]) {
        modal.open(<ViewModal applicationId={Number(m[1])} />, { size: 'wide' });
        window.location.hash = '#/permit-applications';
      }
    };
    tryOpen();
    window.addEventListener('hashchange', tryOpen);
    return () => window.removeEventListener('hashchange', tryOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v2 BONUS: hotkeys для табов и быстрых действий (vanilla не имеет).
  // 1..5 = табы статусов (Все/Черновики/Отправлены/В работе/Завершены/Отменены),
  // / = фокус поиска, Ctrl+N = новая заявка.
  useHotkeys({
    '/': () => {
      const inp = document.querySelector('input[type=text]');
      if (inp) inp.focus();
    },
    'mod+n': () => { if (canCreate) onNew(); },
    '1': () => setTab(''),
    '2': () => setTab('draft'),
    '3': () => setTab('sent'),
    '4': () => setTab('in_progress'),
    '5': () => setTab('completed')
  }, [canCreate]);

  const onNew  = () => { window.location.hash = '#/permit-application-form'; };
  const onEdit = (a) => { window.location.hash = `#/permit-application-form?id=${a.id}`; };
  const onView = (a) => { modal.open(<ViewModal applicationId={a.id} />, { size: 'wide' }); };

  const onExcel = async (a) => {
    try {
      const blob = await downloadExcel(a.id);
      downloadBlob(blob, (a.number || 'draft') + '_реестр.xlsx');
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    }
  };

  const onSend = async (a) => {
    try {
      const data = await loadApplication(a.id);
      modal.open(<SendConfirmModal application={data.application} onSuccess={refresh} />);
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    }
  };

  const onDelete = (a) => {
    modal.open(<ConfirmModal
      title={`Удалить заявку ${a.number || ''}?`}
      message="Это действие нельзя отменить."
      tone="danger"
      okText="Удалить"
      onConfirm={async () => {
        try { await deleteApplication(a.id); toast.success('Заявка удалена'); refresh(); }
        catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
      }}
    />);
  };

  const onStatus = (a, newStatus) => {
    const labels = { in_progress: 'В работу', completed: 'Завершить', cancelled: 'Отменить' };
    const lbl = labels[newStatus] || newStatus;
    modal.open(<ConfirmModal
      title={`${lbl}?`}
      message={`Перевести заявку ${a.number || ''} в статус «${STATUSES[newStatus]?.label || newStatus}»`}
      tone={newStatus === 'cancelled' ? 'danger' : (newStatus === 'completed' ? 'success' : 'warn')}
      okText={lbl}
      onConfirm={async () => {
        try { await setStatus(a.id, newStatus); toast.success('Статус обновлён'); refresh(); }
        catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
      }}
    />);
  };

  const slice = useMemo(() => apps.slice((page - 1) * PAGE, page * PAGE), [apps, page]);
  const pages = Math.max(1, Math.ceil(apps.length / PAGE));

  if (!isAllowed) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 opacity-half mb-12">🔒</div>
        <div className="fs-16 fw-700 mb-6">Доступ закрыт</div>
        <div className="c-t3">Заявки доступны только специальным ролям.</div>
      </div>
    );
  }

  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Кадры"
        title="Заявки на оформление разрешений"
        subtitle="Управление заявками на оформление разрешений и допусков для подрядчиков"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {canCreate && <Btn variant="primary" onClick={onNew}>+ Новая заявка</Btn>}
          </>
        }
      />

      {/* KPI */}
      <div className="pa-kpi-grid">
        <div className="pa-kpi gray"><div className="v">{counts.draft}</div><div className="l">Черновики</div></div>
        <div className="pa-kpi blue"><div className="v">{counts.sent}</div><div className="l">Отправлены</div></div>
        <div className="pa-kpi amber"><div className="v">{counts.in_progress}</div><div className="l">В работе</div></div>
        <div className="pa-kpi green"><div className="v">{counts.completed}</div><div className="l">Завершены</div></div>
      </div>

      {/* Статус-табы */}
      <div className="pa-tabs">
        {STATUS_TABS.map((s) => {
          const n = s.value === '' ? totalAll : (counts[s.value] || 0);
          return (
            <button key={s.value} className={'pa-tab' + (tab === s.value ? ' active' : '')} onClick={() => setTab(s.value)}>
              {s.label} ({n})
            </button>
          );
        })}
      </div>

      {/* Поиск */}
      <div className="u-flex gap-8">
        <SearchInput value={query} onChange={setQuery} placeholder="Поиск по номеру, подрядчику..." />
      </div>

      {/* Таблица */}
      {loading ? (
        <div className="card card-empty" >⏳ Загружаем заявки…</div>
      ) : apps.length === 0 ? (
        <EmptyState
          icon="📋"
          title="Заявок пока нет"
          hint="Создайте первую заявку на оформление разрешений"
          action={canCreate ? <Btn variant="primary" onClick={onNew}>+ Новая заявка</Btn> : null}
        />
      ) : (
        <>
          <div className="pa-tbl-wrap">
            <div className="pa-tbl-scroll">
              <table className="pa-tbl">
                <thead>
                  <tr>
                    <th className="w-120">№ заявки</th>
                    <th>Подрядчик</th>
                    <th className="num w-70">Сотр.</th>
                    <th className="num w-70">Разр.</th>
                    <th className="w-130">Статус</th>
                    <th className="w-120">Дата</th>
                    <th className="right w-200">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((a) => {
                    const st = STATUSES[a.status] || STATUSES.draft;
                    return (
                      <tr key={a.id}>
                        <td className="fw-600">{a.number || 'черновик'}</td>
                        <td>
                          <div>{a.contractor_name || '—'}</div>
                          {a.title && <div className="fs-11 c-t3">{a.title}</div>}
                        </td>
                        <td className="num">{a.employee_count || 0}</td>
                        <td className="num">{a.permit_count || 0}</td>
                        <td>
                          <span className="pa-status-pill" style={{ background: st.bg, color: st.color }}>
                            {st.icon} {st.label}
                          </span>
                        </td>
                        <td>{fmtDate(a.sent_at || a.created_at)}</td>
                        <td>
                          <div className="pa-row-actions">
                            {a.status === 'draft' && canCreate && <Btn size="sm" variant="ghost" onClick={() => onEdit(a)} title="Редактировать">✎</Btn>}
                            {a.status !== 'draft' && <Btn size="sm" variant="ghost" onClick={() => onView(a)} title="Просмотр">👁</Btn>}
                            <Btn size="sm" variant="ghost" onClick={() => onExcel(a)} title="Excel">📥</Btn>
                            {a.status === 'draft' && canCreate && <Btn size="sm" variant="ghost" onClick={() => onSend(a)} title="Отправить">✉</Btn>}
                            {a.status === 'sent'        && canCreate && <Btn size="sm" variant="ghost" onClick={() => onStatus(a, 'in_progress')} title="В работу">⚙</Btn>}
                            {a.status === 'in_progress' && canCreate && <Btn size="sm" variant="ghost" onClick={() => onStatus(a, 'completed')} title="Завершить">✓</Btn>}
                            {a.status === 'draft' && canCreate && <Btn size="sm" variant="ghost" onClick={() => onDelete(a)} title="Удалить">🗑</Btn>}
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
            <div className="row-center gap-12">
              <Btn size="sm" variant="ghost" disabled={page === 1}    onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</Btn>
              <span className="c-t3 fs-13">{page} / {pages} · показано {apps.length} из {total}</span>
              <Btn size="sm" variant="ghost" disabled={page === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}
