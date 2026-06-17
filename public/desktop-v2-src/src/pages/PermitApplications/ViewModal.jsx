/**
 * ViewModal — просмотр заявки (read-only): подрядчик / сотрудники / история.
 * Источник: vanilla permit_applications.js → openViewModal.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { loadApplication, STATUSES, fmtDate } from './api';

export default function ViewModal({ applicationId }) {
  const { close } = useModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadApplication(applicationId)
      .then(setData)
      .catch((e) => toast.error('Ошибка: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, [applicationId]);

  if (loading || !data) {
    return (
      <MCard>
        <MHead icon="📋" title="Заявка" onClose={close} />
        <MBody>
          <div className="t-center p-24 c-t3">⏳ Загружаем…</div>
        </MBody>
      </MCard>
    );
  }

  const app = data.application;
  const items = data.items || [];
  const history = data.history || [];
  const st = STATUSES[app.status] || STATUSES.draft;

  return (
    <MCard>
      <MHead
        icon="📋"
        title={`Заявка ${app.number || ''}`}
        subtitle={`${app.contractor_name || '—'}`}
        accent="default"
        onClose={close}
      />
      <MBody>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
          <div>
            <div className="fs-11 c-t3 upper mb-4">Подрядчик</div>
            <div className="fw-600">{app.contractor_name || '—'}</div>
            <div className="fs-12 c-t3">{app.contractor_email || ''}</div>
          </div>
          <div>
            <div className="fs-11 c-t3 upper mb-4">Статус</div>
            <span className="pa-status-pill" style={{ background: st.bg, color: st.color }}>{st.icon} {st.label}</span>
            {app.sent_at && <div className="fs-12 c-t3 mt-4">Отправлено: {fmtDate(app.sent_at)}</div>}
          </div>
        </div>

        {app.title && (
          <div className="mb-16">
            <div className="fs-11 c-t3 upper mb-4">Комментарий</div>
            <div>{app.title}</div>
          </div>
        )}

        <h4 className="mt-12 mb-8">Сотрудники ({items.length})</h4>
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table className="pa-tbl">
            <thead>
              <tr>
                <th className="w-40">№</th>
                <th>ФИО</th>
                <th className="w-140">Должность</th>
                <th>Разрешения</th>
                <th className="w-140">Примечания</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id}>
                  <td>{i + 1}</td>
                  <td className="fw-600">{it.employee_fio || it.employee_full_name || '—'}</td>
                  <td>{it.employee_role_tag || ''}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'normal' }}>
                    {(it.permit_type_names || []).join(', ') || '—'}
                  </td>
                  <td>{it.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="mt-12 mb-8">История</h4>
        {history.length === 0
          ? <div className="c-t3">Нет записей</div>
          : (
            <div className="col gap-6">
              {history.map((h) => {
                const hst = STATUSES[h.new_status] || STATUSES.draft;
                return (
                  <div key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--brd-1)' }}>
                    <span className="pa-status-pill" style={{ background: hst.bg, color: hst.color }}>{hst.icon} {hst.label}</span>
                    <span className="fs-11 c-t3">
                      {h.changed_by_name || ''} · {fmtDate(h.created_at)}
                    </span>
                    {h.comment && <span className="fs-11 c-t3">— {h.comment}</span>}
                  </div>
                );
              })}
            </div>
          )}
      </MBody>
      <MFoot>
        <Btn variant="primary" onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
