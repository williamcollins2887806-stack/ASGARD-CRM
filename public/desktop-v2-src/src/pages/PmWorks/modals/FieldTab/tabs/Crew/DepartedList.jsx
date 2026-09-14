/**
 * DepartedList — коллапсируемый блок «⚫ Уехали / убраны с объекта».
 *
 * Источник vanilla: field-tab.js (departed + openDepartedTariffModal).
 * Для каждого: «🔄 Вернуть» и «💰 Тариф» (keep_inactive — без возврата на объект).
 */
import { useState } from 'react';
import { Btn, MCard, MHead, MBody } from '@/modals/parts';
import { StatusBadge, toast } from '@/modals/Notifications';
import { useModal, ConfirmModal } from '@/modals';
import { returnCrewMember } from '../../api';
import { filterTariffsForFieldRole } from '../../constants';
import TariffEditor from './TariffEditor';

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ru-RU'); } catch { return String(d); }
}

function DepartedTariffModal({ work, member, tariffs, comboTariffs, category, onDone }) {
  const { close } = useModal();
  const empName = member.employee_name || member.name || `#${member.employee_id}`;
  const role = member.field_role || member.role_in_field || 'worker';
  const pool = filterTariffsForFieldRole(tariffs || [], role, category || 'mlsp');

  return (
    <MCard>
      <MHead title={`Тариф — ${empName}`} onClose={close} />
      <MBody>
        <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
          Уехавший остаётся в истории бригады — тариф можно задать без возврата на объект.
        </p>
        <TariffEditor
          member={member}
          tariffs={pool.length ? pool : (tariffs || [])}
          comboTariffs={comboTariffs || []}
          workId={work.id}
          keepInactive
          onSaved={() => { close(); if (onDone) onDone(); }}
          onCancel={close}
        />
      </MBody>
    </MCard>
  );
}

export default function DepartedList({
  work,
  items,
  tariffs = [],
  comboTariffs = [],
  category = 'mlsp',
  onReturned,
  onTariffSaved
}) {
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

  const onTariffClick = (m) => {
    open(
      <DepartedTariffModal
        work={work}
        member={m}
        tariffs={tariffs}
        comboTariffs={comboTariffs}
        category={category}
        onDone={() => { if (onTariffSaved) onTariffSaved(); }}
      />
    );
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
            const tariffTitle = m.tariff_id
              ? (`Тариф #${m.tariff_id}${m.tariff_points != null ? ` · ${m.tariff_points}б` : ''}`)
              : 'Тариф не задан';
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
                  <Btn size="sm" variant="ghost" onClick={() => onTariffClick(m)} title={tariffTitle}>
                    💰 Тариф
                  </Btn>
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
