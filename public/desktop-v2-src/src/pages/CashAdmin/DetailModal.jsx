/**
 * DetailModal (CashAdmin) — карточка заявки для директора/БУХ с полным набором действий.
 * Источник: vanilla cash_admin.js → showDetail/renderDetail.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { ConfirmModal } from '@/modals/Confirm';
import { PromptModal } from '@/modals/Prompt';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import {
  loadRequest, approveRequest, issueMoney, rejectRequest, askQuestion, confirmReturn,
  STATUS_LABELS, TYPE_LABELS, ADVANCE_STEPS, LOAN_STEPS, STEP_LABELS,
  fmtMoney, fmtDate, fmtDateTime, deadlineMeta, openReceipt
} from './api';
import CloseRequestModal from './CloseRequestModal';

export default function DetailModal({ requestId, onChanged }) {
  const { open, close } = useModal();
  const [req, setReq] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await loadRequest(requestId);
      setReq(r);
    } catch (e) {
      toast.error('Не удалось загрузить: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  const notifyChanged = () => {
    onChanged?.();
    try { window.dispatchEvent(new CustomEvent('asgard:cash:changed')); } catch { /* noop */ }
  };

  const onApprove = () => {
    open(<ConfirmModal
      title="Согласовать заявку?"
      message="После согласования бухгалтерия сможет выдать деньги."
      tone="success"
      okText="Согласовать"
      onConfirm={async () => {
        try { await approveRequest(req.id); toast.success('Заявка согласована'); await refresh(); notifyChanged(); }
        catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
      }}
    />);
  };

  const onIssue = () => {
    open(<ConfirmModal
      title="Выдать деньги?"
      message="У РП будет 12 часов на подтверждение получения. Баланс кассы будет уменьшен."
      tone="gold"
      okText="Выдать"
      onConfirm={async () => {
        try { await issueMoney(req.id); toast.success('Деньги выданы. РП получил уведомление'); await refresh(); notifyChanged(); }
        catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
      }}
    />);
  };

  const onReject = () => {
    open(<PromptModal
      title="Отклонить заявку"
      label="Причина отклонения"
      placeholder="Укажите причину"
      multiline
      okText="Отклонить"
      onSubmit={async (comment) => {
        try { await rejectRequest(req.id, comment); toast.success('Заявка отклонена'); await refresh(); notifyChanged(); }
        catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
      }}
    />);
  };

  const onQuestion = () => {
    open(<PromptModal
      title="Задать вопрос"
      label="Вопрос"
      placeholder="Введите вопрос"
      multiline
      okText="Отправить вопрос"
      onSubmit={async (message) => {
        try { await askQuestion(req.id, message); toast.success('Вопрос отправлен'); await refresh(); notifyChanged(); }
        catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
      }}
    />);
  };

  const onClose = () => {
    open(<CloseRequestModal requestId={req.id} remainder={req.balance?.remainder || 0} onSaved={() => { refresh(); notifyChanged(); }} />);
  };

  const onConfirmReturn = (returnId) => {
    open(<ConfirmModal
      title="Подтвердить получение возврата?"
      message="Сумма будет добавлена в кассу."
      tone="success"
      okText="Подтвердить"
      onConfirm={async () => {
        try { await confirmReturn(req.id, returnId); toast.success('Возврат подтверждён'); await refresh(); notifyChanged(); }
        catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
      }}
    />);
  };

  if (loading || !req) {
    return (
      <MCard>
        <MHead icon="💰" title={`Заявка #${requestId}`} subtitle="Администрирование кассы" onClose={close} />
        <MBody>
          <div className="t-center p-24 c-t3">⏳ Загружаем…</div>
        </MBody>
      </MCard>
    );
  }

  const canApprove = req.status === 'requested';
  const canIssue   = req.status === 'approved';
  const canReject  = ['requested', 'approved'].includes(req.status);
  const canQuestion = ['requested', 'received', 'reporting'].includes(req.status);
  const canClose   = ['received', 'reporting'].includes(req.status);

  const isLoan = req.type === 'loan';
  const steps = isLoan ? LOAN_STEPS : ADVANCE_STEPS;
  const currentStep = steps.indexOf(req.status);
  const isRejected = req.status === 'rejected';

  const dl = req.status === 'money_issued' ? deadlineMeta(req.receipt_deadline, req.is_overdue) : null;

  return (
    <MCard>
      <MHead
        icon="💰"
        title={`Заявка #${req.id}`}
        subtitle={`${req.user_name || ''} · ${TYPE_LABELS[req.type] || req.type}`}
        accent={isRejected ? 'danger' : 'gold'}
        onClose={close}
      />
      <MBody>
        {/* Steps */}
        <div className="cash-steps">
          {steps.map((s, i) => {
            const cls = ['cash-step'];
            if (isRejected) cls.push('rejected');
            else if (i < currentStep) cls.push('done');
            else if (i === currentStep) cls.push('active');
            return (
              <div key={s} className={cls.join(' ')}>
                <div className="cash-step-dot" />
                <div className="cash-step-label">{STEP_LABELS[s]}</div>
              </div>
            );
          })}
        </div>

        {/* KV */}
        <div className="cash-detail-grid mt-14" >
          <div>
            <div className="cash-detail-item">
              <span className="label">Сотрудник</span>
              <span className="value">{req.user_name || '—'} ({req.user_role || ''})</span>
            </div>
            <div className="cash-detail-item mt-10" >
              <span className="label">Тип</span>
              <span className="value">{TYPE_LABELS[req.type] || req.type}</span>
            </div>
            <div className="cash-detail-item mt-10" >
              <span className="label">Проект</span>
              <span className="value">{req.work_title || (req.work_id ? `#${req.work_id}` : '—')}</span>
            </div>
            <div className="cash-detail-item mt-10" >
              <span className="label">Сумма</span>
              <span className="value fs-18 c-gold fw-700">{fmtMoney(req.amount)}</span>
            </div>
            <div className="cash-detail-item mt-10" >
              <span className="label">Цель</span><span className="value">{req.purpose}</span>
            </div>
            {req.cover_letter && (
              <div className="cash-detail-item mt-10" >
                <span className="label">Письмо</span><span className="value">{req.cover_letter}</span>
              </div>
            )}
          </div>
          <div>
            <div className="cash-detail-item">
              <span className="label">Статус</span>
              <span className="value"><span className={'cash-pill ' + req.status}>{STATUS_LABELS[req.status]}</span></span>
            </div>
            <div className="cash-detail-item mt-10" >
              <span className="label">Создано</span><span className="value">{fmtDateTime(req.created_at)}</span>
            </div>
            {req.director_name && (
              <div className="cash-detail-item mt-10" >
                <span className="label">Директор</span><span className="value">{req.director_name}</span>
              </div>
            )}
            {req.director_comment && (
              <div className="cash-detail-item mt-10" >
                <span className="label">Комментарий</span><span className="value">{req.director_comment}</span>
              </div>
            )}
            {req.issued_by_name && (
              <div className="cash-detail-item mt-10" >
                <span className="label">Выдал</span><span className="value">{req.issued_by_name}</span>
              </div>
            )}
            {req.issued_at && (
              <div className="cash-detail-item mt-10" >
                <span className="label">Дата выдачи</span><span className="value">{fmtDateTime(req.issued_at)}</span>
              </div>
            )}
            {req.received_at && (
              <div className="cash-detail-item mt-10" >
                <span className="label">Получено</span><span className="value">{fmtDateTime(req.received_at)}</span>
              </div>
            )}
            {req.closed_at && (
              <div className="cash-detail-item mt-10" >
                <span className="label">Закрыто</span><span className="value">{fmtDateTime(req.closed_at)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Дедлайн */}
        {dl && (
          <div className={'cash-alert ' + (dl.isOverdue || dl.tone === 'err' ? 'danger' : 'warning')}>
            {dl.isOverdue
              ? <>⚠️ <b>ПРОСРОЧЕНО!</b> Дедлайн истёк {fmtDateTime(req.receipt_deadline)}</>
              : <>⏱ РП должен подтвердить получение в течение <b>{dl.hours}ч {dl.mins}мин</b> (до {fmtDateTime(req.receipt_deadline)})</>}
          </div>
        )}

        {/* Баланс */}
        {req.balance && (
          <div className={'cash-alert ' + (req.balance.remainder > 0 ? 'warning' : 'success')}>
            <b>Баланс:</b> Выдано: {fmtMoney(req.balance.approved)} | Потрачено: {fmtMoney(req.balance.spent)} |{' '}
            Возвращено: {fmtMoney(req.balance.returned)} | <b>Остаток: {fmtMoney(req.balance.remainder)}</b>
          </div>
        )}

        {/* Расходы */}
        {req.expenses?.length > 0 && (
          <>
            <div className="cash-section-h">Расходы</div>
            <div className="ov-x-auto">
              <table className="cash-tbl">
                <thead><tr><th>Дата</th><th>Описание</th><th>Сумма</th><th>Чек</th></tr></thead>
                <tbody>
                  {req.expenses.map((e) => (
                    <tr key={e.id}>
                      <td>{fmtDate(e.expense_date)}</td>
                      <td>{e.description}</td>
                      <td>{fmtMoney(e.amount)}</td>
                      <td>
                        {e.receipt_file
                          ? <button type="button" className="m-btn-link" onClick={() => openReceipt(req.id, e.receipt_file).catch((err) => toast.error('Чек: ' + (err?.message || err)))}>{e.receipt_original_name || 'Чек'}</button>
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Возвраты */}
        {req.returns?.length > 0 && (
          <>
            <div className="cash-section-h">Возвраты</div>
            <div className="ov-x-auto">
              <table className="cash-tbl">
                <thead><tr><th>Дата</th><th>Сумма</th><th>Комментарий</th><th>Статус</th><th></th></tr></thead>
                <tbody>
                  {req.returns.map((r) => (
                    <tr key={r.id}>
                      <td>{fmtDateTime(r.created_at)}</td>
                      <td>{fmtMoney(r.amount)}</td>
                      <td>{r.note || '—'}</td>
                      <td>
                        {r.confirmed_at
                          ? <span className="cash-pill approved">Подтверждено {fmtDateTime(r.confirmed_at)}</span>
                          : <span className="cash-pill requested">Ожидает</span>}
                      </td>
                      <td>
                        {!r.confirmed_at && <Btn size="sm" variant="success" onClick={() => onConfirmReturn(r.id)}>Подтвердить</Btn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Переписка */}
        {req.messages?.length > 0 && (
          <>
            <div className="cash-section-h">Переписка</div>
            <div className="cash-messages">
              {req.messages.map((m) => (
                <div key={m.id} className="cash-message">
                  <div className="meta">{fmtDateTime(m.created_at)} — {m.user_name} ({m.user_role})</div>
                  <div className="text">{m.message}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        <div className="row-end gap-8 u-wrap">
          {canApprove  && <Btn variant="success" onClick={onApprove}>Согласовать</Btn>}
          {canIssue    && <Btn variant="primary" onClick={onIssue}>💰 Выдать деньги</Btn>}
          {canReject   && <Btn variant="danger"  onClick={onReject}>Отклонить</Btn>}
          {canQuestion && <Btn variant="warn"    onClick={onQuestion}>Задать вопрос</Btn>}
          {canClose    && <Btn variant="info"    onClick={onClose}>Закрыть</Btn>}
        </div>
      </MFoot>
    </MCard>
  );
}
