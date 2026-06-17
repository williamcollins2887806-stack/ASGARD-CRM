/**
 * Модалка детальной карточки самозанятого: реквизиты + история выплат.
 * Источник: payroll.js → SE карточка + /self-employed/:id/payments.
 *
 * canEdit передаётся со страницы — кнопка «Редактировать» показывается
 * только ADMIN/BUH/HEAD_PM/DIRECTOR_* (см. SelfEmployed/index.jsx).
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { StatusBadge } from '@/modals/Notifications';
import { loadPayments, fmtMoney, fmtDate, fmtDateTime, npdMeta, maskAccount } from './api';

export function SelfEmployedDetailModal({ se, canEdit: canEditProp, onEdit }) {
  const { close } = useModal();
  const { user } = useAuth();
  // Дублируем RBAC для безопасности (если пропс не передали)
  // Источник истины — payroll.js:370-371 (canCreate включает HEAD_PM, директоров, ADMIN; BUH ведёт реестр)
  const canEdit = canEditProp !== undefined ? canEditProp : (
    user?.role === 'ADMIN' ||
    user?.role === 'BUH' ||
    user?.role === 'HEAD_PM' ||
    ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role)
  );
  const handleEdit = () => { close(); onEdit?.(); };
  const [data, setData] = useState({ payments: [], total_paid: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadPayments(se.id).then((d) => !cancelled && setData(d)).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [se.id]);

  const meta = npdMeta(se.npd_status);

  return (
    <MCard className="modal-lg">
      <MHead
        icon="🪪"
        title={se.full_name}
        subtitle={`ИНН: ${se.inn} · #${se.id}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {/* Шапка с реквизитами */}
        <div className="info-row-card mb-14">
          <StatusBadge tone={meta.tone} label={`НПД: ${meta.label}`} />
          {se.phone && <Pill>📞 {se.phone}</Pill>}
          {se.email && <Pill>✉ {se.email}</Pill>}
          {se.bank_name && <Pill>🏦 {se.bank_name}</Pill>}
          {se.account_number && <Pill>{maskAccount(se.account_number)}</Pill>}
        </div>

        <div className="m-grid-2 mb-14" >
          <KV label="БИК" value={se.bik || '—'} />
          <KV label="Карта" value={se.card_number || '—'} />
          <KV label="№ ГПХ" value={se.contract_number || '—'} />
          <KV label="Дата ГПХ" value={fmtDate(se.contract_date)} />
        </div>

        {se.comment && (
          <div className="p-12 bg-inner r-md mb-14">
            <div className="fs-11 c-t3 fw-600 mb-4">Комментарий</div>
            <div className="fs-13 u-prewrap">{se.comment}</div>
          </div>
        )}

        {/* История выплат */}
        <div className="label-cap-lg mb-8">
          История выплат
        </div>

        {loading ? (
          <div className="p-20 t-center c-t3">⏳ Загружаем…</div>
        ) : data.payments.length === 0 ? (
          <div className="p-16 t-center c-t3 bg-inner r-md">
            Выплат ещё не было.
          </div>
        ) : (
          <>
            <div className="row-spread p-10 bg-inner r-md mb-8">
              <span className="fs-13 c-t3">Итого выплачено:</span>
              <span className="fw-800 fs-16 c-gold">{fmtMoney(data.total_paid)}</span>
            </div>

            <div className="card card-pad-overflow">
              <table className="t-list tbl-base">
                <thead>
                  <tr className="bg-inner tbl-row-brd">
                    <th className="pad-cell-md t-left fw-600">Дата</th>
                    <th className="pad-cell-md t-left fw-600">Тип</th>
                    <th className="pad-cell-md t-left fw-600">Ведомость</th>
                    <th className="pad-cell-md t-left fw-600">Статус</th>
                    <th className="pad-cell-md t-right fw-600">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p, i) => (
                    <tr key={i} className="tbl-row-brd">
                      <td className="px-12 py-8">{fmtDateTime(p.paid_at || p.created_at)}</td>
                      <td className="pad-cell-md c-t2">{p.payment_type || '—'}</td>
                      <td className="pad-cell-md c-t2">{p.sheet_title || p.reason || '—'}</td>
                      <td className="pad-cell-md c-t2">{p.status || '—'}</td>
                      <td className="pad-cell-md t-right fw-700 c-gold">{fmtMoney(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        {canEdit && (
          <Btn variant="primary" onClick={handleEdit}>✎ Редактировать</Btn>
        )}
      </MFoot>
    </MCard>
  );
}

function KV({ label, value }) {
  return (
    <div className="p-8">
      <div className="label-cap" style={{ letterSpacing: '0.08em' }}>{label}</div>
      <div className="fs-13 c-t1 mt-2">{value}</div>
    </div>
  );
}
