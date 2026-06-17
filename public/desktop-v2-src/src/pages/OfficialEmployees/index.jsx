/**
 * Страница /official-employees — Официально устроенные сотрудники.
 * Источник: vanilla `public/assets/js/official_employees.js` (~384 строки).
 *
 *   ✅ index.jsx                           — root + summary + таблица + RBAC
 *   ✅ api.js                              — endpoints + статусы + helpers
 *   ✅ OfficialEmployeeEditModal.jsx       — табы Оплата / Паспорт (PII)
 *
 * RBAC:
 *   • Просмотр таблицы: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, BUH (см. backend payroll-dashboard.js)
 *   • Редактирование оплаты: ADMIN, DIRECTOR_GEN, BUH
 *   • Редактирование ПД (PII): ADMIN, HR, HR_MANAGER, DIRECTOR_GEN
 *   • Просмотр ПД скрыт от не-PII ролей: вкладка «Паспорт» в модалке не показывается
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';

import {
  VIEW_ROLES, EDIT_ROLES,
  STATUS_CFG,
  rub, fmtDate,
  loadOfficialEmployees, getTotals
} from './api';
import { OfficialEmployeeEditModal } from './OfficialEmployeeEditModal';
import './official-employees.css';

export default function OfficialEmployeesPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (user && !VIEW_ROLES.includes(user.role)) setDenied(true);
  }, [user]);

  const refresh = useCallback(() => {
    if (denied) return;
    setLoading(true);
    loadOfficialEmployees()
      .then(setList)
      .catch((e) => toast.error('Не удалось загрузить таблицу: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, [denied]);

  useEffect(() => { refresh(); }, [refresh]);

  const onOpen = (e) => {
    if (!EDIT_ROLES.includes(user?.role)) {
      toast.warn('Нет прав на редактирование');
      return;
    }
    modal.open(
      <OfficialEmployeeEditModal employee={e} userRole={user.role} onSaved={refresh} />,
      { size: 'wide' }
    );
  };

  if (denied) {
    return (
      <div className="p-32">
        <EmptyState
          icon="🔒"
          title="Доступ закрыт"
          hint="Раздел «Официально устроенные» доступен ролям ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, BUH."
          action={null}
        />
      </div>
    );
  }

  const totals = getTotals(list);

  return (
    <div className="ofe-page">
      <TopActionsBar
        kicker="Дружина"
        title="Официально устроенные"
        subtitle="Оклад + несгораемая часть. Кликните на строку для редактирования."
        actions={<Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>}
      />

      <div className="ofe-summary">
        <span className="ofe-summary-pill">Всего:<b>{totals.total}</b></span>
        <span className="ofe-summary-pill ok">Работают:<b>{totals.active}</b></span>
        {totals.onLeave > 0 && (
          <span className="ofe-summary-pill warn">В отпуске/больничном:<b>{totals.onLeave}</b></span>
        )}
        <span className={'ofe-summary-pill ' + (totals.totalDebt > 0 ? 'err' : 'ok')}>
          Суммарный долг:<b>{rub(totals.totalDebt)}</b>
        </span>
      </div>

      {loading ? (
        <div className="ofe-table-wrap">
          <div className="ofe-empty">⏳ Загружаем таблицу…</div>
        </div>
      ) : list.length === 0 ? (
        <div className="ofe-table-wrap">
          <div className="ofe-empty">Нет официально устроенных сотрудников</div>
        </div>
      ) : (
        <div className="ofe-table-wrap">
          <div className="ofe-table-scroll">
            <table className="ofe-table">
              <thead>
                <tr>
                  <th>ФИО</th>
                  <th>Дата устройства</th>
                  <th>Оклад</th>
                  <th>Несгораемая</th>
                  <th>Статус</th>
                  <th>Долг компании</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const cfg = STATUS_CFG[e.official_status] || { label: e.official_status || '—', bg: 'var(--inner-bg)', color: 'var(--t-2)' };
                  const debt = Number(e.company_debt || e.debt || 0);
                  const debtCls = debt > 0 ? 'ofe-debt-pos' : debt < 0 ? 'ofe-debt-neg' : '';
                  const name = e.full_name || e.fio || '—';
                  const hireDate = e.hired_date || e.official_hire_date;
                  return (
                    <tr key={e.id} className="ofe-row" onClick={() => onOpen(e)}>
                      <td>
                        <div className="ofe-name">{name}</div>
                        {(e.position || e.role_tag) && (
                          <div className="ofe-pos">{e.position || e.role_tag}</div>
                        )}
                      </td>
                      <td>{fmtDate(hireDate)}</td>
                      <td className="ofe-num">{rub(e.official_salary)}</td>
                      <td>{rub(e.official_non_burnable)}</td>
                      <td>
                        <span className="ofe-badge" style={{ background: cfg.bg, color: cfg.color }}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className={'ofe-num ' + debtCls}>{rub(debt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
