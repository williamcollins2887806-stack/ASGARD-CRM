/**
 * HistoryModal — полная история followup-событий по конкретному ТКП.
 * Backend: GET /api/tkp/:id/followup.
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { loadHistory, ACTION_LABELS, fmtDateTime } from '../api';

export function HistoryModal({ tkp }) {
  const { close } = useModal();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    loadHistory(tkp.id)
      .then(setRows)
      .catch((e) => {
        toast('Ошибка', String(e?.message || e), 'err');
        setRows([]);
      });
  }, [tkp.id]);

  return (
    <MCard className="modal-lg">
      <MHead
        icon="📜"
        title="История контактов"
        subtitle={`${tkp.customer_name || ''} — ${tkp.subject || tkp.tkp_number || `#${tkp.id}`}`}
        onClose={close}
      />
      <MBody>
        {rows === null ? (
          <div className="c-t3">⏳ Загружаем…</div>
        ) : rows.length === 0 ? (
          <div className="c-t3">Пока нет событий — запишите первый контакт.</div>
        ) : (
          <div className="tfu-log">
            {rows.map((r) => {
              const meta = ACTION_LABELS[r.action] || { label: r.action, icon: '•' };
              return (
                <div className="tfu-log__row" key={r.id}>
                  <div className="tfu-log__action">
                    <span aria-hidden="true">{meta.icon}</span> {meta.label}
                  </div>
                  <div className="tfu-log__details">{r.details || '—'}</div>
                  <div className="tfu-log__when">{fmtDateTime(r.created_at)}</div>
                  <div className="tfu-log__actor" style={{ gridColumn: '1 / -1' }}>
                    {r.actor_name ? `👤 ${r.actor_name}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
