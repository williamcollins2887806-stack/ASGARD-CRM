/**
 * Допуски и разрешения сотрудника.
 *
 * Источник: vanilla `employee.js` блок «Допуски и разрешения» (строки 339–358)
 *          + `permits.js`/AsgardPermitsPage детальная таблица.
 *
 * Endpoints:
 *   GET    /api/permits?employee_id=N  → список действующих допусков с computed_status
 *   GET    /api/permits/types          → справочник типов
 *   POST   /api/permits {employee_id, type_id, doc_number, issuer, issue_date, expiry_date, notes}
 *   DELETE /api/permits/:id            → soft-delete
 *
 * Видно ли:
 *   • Кнопка «+ Добавить допуск» — HR/ADMIN/директора (см. canEdit).
 *   • Кнопка «🗑» рядом с допуском — те же.
 */
import { useEffect, useState } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { loadEmployeePermits, deletePermit, fmtDate } from './api';
import PermitsChecklistModal from '../Permits/PermitsChecklistModal';

export function EmployeePermits({ employeeId, employeeName, canEdit }) {
  const modal = useModal();
  const [loading, setLoading] = useState(true);
  const [permits, setPermits] = useState([]);

  const refresh = () => {
    setLoading(true);
    loadEmployeePermits(employeeId)
      .then(setPermits)
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, [employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Единое окно-чеклист: добавление и редактирование допусков одним окном.
  const openChecklist = () => {
    if (!canEdit) {
      toast.warn('Нет прав на изменение допусков');
      return;
    }
    modal.open(
      <PermitsChecklistModal
        employeeId={employeeId}
        employeeName={employeeName || permits[0]?.employee_name || ''}
        onSaved={(fresh) => { if (Array.isArray(fresh)) setPermits(fresh); else refresh(); }}
      />,
      { size: 'wide' }
    );
  };

  const onDelete = (permit) => {
    modal.open(
      <ConfirmModal
        title="Удалить допуск?"
        message={`«${permit.type_name || permit.type_id}»${permit.expiry_date ? ' (до ' + fmtDate(permit.expiry_date) + ')' : ''}`}
        okText="Удалить"
        tone="danger"
        onConfirm={async () => {
          try {
            await deletePermit(permit.id);
            toast.success('Допуск удалён');
            refresh();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  if (loading) {
    return <div className="emp-modal-empty">⏳ Загружаем допуски…</div>;
  }

  return (
    <div className="emp-permits">
      <div className="emp-permits-head">
        <div className="emp-permits-count">
          {permits.length === 0 ? 'Допусков нет' : `${permits.length} ${plural(permits.length, ['допуск', 'допуска', 'допусков'])}`}
        </div>
        {canEdit && (
          <Btn variant="primary" size="sm" onClick={openChecklist}>Допуски (изменить)</Btn>
        )}
      </div>

      {permits.length === 0 ? (
        <div className="emp-modal-empty">
          У сотрудника нет оформленных допусков. {canEdit && 'Нажмите «Допуски (изменить)», чтобы отметить допуски.'}
        </div>
      ) : (
        <div className="emp-permits-list">
          {permits.map((p) => (
            <PermitRow key={p.id} permit={p} canEdit={canEdit} onDelete={() => onDelete(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PermitRow({ permit, canEdit, onDelete }) {
  const status = permit.computed_status || 'active';
  const days = permit.days_left;
  const meta = (() => {
    if (status === 'expired')      return { dot: '🔴', text: `Просрочен ${days != null ? Math.abs(days) + ' дн.' : ''}`, cls: 'expired' };
    if (status === 'expiring_14')  return { dot: '⚠️', text: `Истекает через ${days} дн.`, cls: 'warn14' };
    if (status === 'expiring_30')  return { dot: '🟡', text: `Истекает через ${days} дн.`, cls: 'warn30' };
    return { dot: '✅', text: 'Действует', cls: 'ok' };
  })();

  return (
    <div className={`emp-permit-row emp-permit-row--${meta.cls}`}>
      <div className="emp-permit-row-main">
        <div className="emp-permit-row-name">
          <span>{meta.dot}</span>{' '}
          <b>{permit.type_name || `Тип #${permit.type_id}`}</b>
          {permit.type_category && (
            <span className="emp-permit-row-cat">{permit.type_category}</span>
          )}
        </div>
        <div className="emp-permit-row-meta">
          {permit.doc_number && <span>№ {permit.doc_number}</span>}
          {permit.issuer && <span>· {permit.issuer}</span>}
          {permit.issue_date && <span>· выдан {fmtDate(permit.issue_date)}</span>}
          {permit.expiry_date && <span>· до {fmtDate(permit.expiry_date)}</span>}
        </div>
        <div className="emp-permit-row-status">{meta.text}</div>
      </div>
      <div className="emp-permit-row-actions">
        {permit.scan_file && (
          <a
            className="m-btn ghost sm"
            href={`/api/files/download/${encodeURIComponent(permit.scan_file)}`}
            target="_blank"
            rel="noreferrer"
            title="Скачать скан"
          >📄</a>
        )}
        {canEdit && (
          <Btn variant="ghost" size="sm" onClick={onDelete} title="Удалить">🗑</Btn>
        )}
      </div>
    </div>
  );
}

function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
