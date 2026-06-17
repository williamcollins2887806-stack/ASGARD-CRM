/**
 * DepartedList — коллапсируемый блок «⚫ Уехали / убраны с объекта».
 *
 * Источник vanilla: field-tab.js:462-510.
 * Read-only история отъездов; для каждого работника — кнопка «🔄 Вернуть»:
 *   POST /api/field/manage/projects/:work_id/return/:employee_id
 */
import { useState } from 'react';
import { Btn } from '@/modals/parts';
import { StatusBadge, toast } from '@/modals/Notifications';
import { useModal, ConfirmModal } from '@/modals';
import { returnCrewMember } from '../../api';

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ru-RU'); } catch { return String(d); }
}

export default function DepartedList({ work, items, onReturned }) {
  const { open } = useModal();
  const [collapsed, setCollapsed] = useState(false);

  if (!items?.length) return null;

  const onReturnClick = (m) => {
    const empName = m.employee_name || m.name || `#${m.employee_id}`;
    open(<ConfirmModal
      title="Вернуть на объект"
      message={`Вернуть ${empName} в бригаду работы «${work.work_title || '#' + work.id}»?`}
      tone="info"
      okText="🔄 Вернуть"
      onConfirm={async () => {
        try {
          await returnCrewMember(work.id, m.employee_id);
          toast('Возврат', `${empName} вернулся на объект`, 'ok');
          if (onReturned) onReturned(m.employee_id);
        } catch (e) {
          toast('Ошибка', String(e?.message || e), 'err');
        }
      }}
    />);
  };

  return (
    <section className="ft-departed">
      <header className="ft-departed__head" onClick={() => setCollapsed((c) => !c)}>
        <span className="ft-departed__caret">{collapsed ? '▸' : '▾'}</span>
        <span>⚫ Уехали / убраны с объекта</span>
        <span className="ft-departed__count">{items.length}</span>
      </header>
      {!collapsed && (
        <ul className="ft-departed__list">
          {items.map((m) => {
            const empName = m.employee_name || m.name || `#${m.employee_id}`;
            const reason = m.departure_reason || m.reason || null;
            const isDeparted = !!m.departure_date;
            return (
              <li key={m.id || `${m.employee_id}-${m.work_id}`} className="ft-departed__row">
                <div className="ft-departed__main">
                  <strong>{empName}</strong>
                  {m.phone && <span className="ft-departed__phone">{m.phone}</span>}
                </div>
                <div className="ft-departed__meta">
                  <StatusBadge
                    tone={isDeparted ? 'rejected' : 'default'}
                    label={isDeparted ? `уехал ${fmtDate(m.departure_date)}` : 'убран РП'}
                  />
                  {reason && <span className="ft-departed__reason" title={reason}>{reason}</span>}
                </div>
                <div className="ft-departed__actions">
                  <Btn size="sm" variant="ghost" onClick={() => onReturnClick(m)} title="Вернуть на объект">
                    🔄 Вернуть
                  </Btn>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
