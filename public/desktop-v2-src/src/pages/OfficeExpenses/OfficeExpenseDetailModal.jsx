/**
 * Просмотр офисного расхода + действия согласования.
 * Источник vanilla: office_expenses.js → openViewModal + workflow handlers.
 *
 * Действия в зависимости от роли и статуса:
 *   - Автор / OFFICE_MANAGER: ✎ редактировать (draft/rejected/rework), 📤 отправить (draft/rework)
 *   - Директор: ✓ согласовать, ✕ отклонить, 🔄 на доработку (при pending/sent)
 */
import { useEffect, useState } from 'react';
import { useModal, ConfirmModal, PromptModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Pill } from '@/modals/parts';
import { toast, StatusBadge } from '@/modals/Notifications';
import {
  categoryMeta, statusMeta, fmtMoney, fmtDate, fmtDateTime, getStatusKey,
  loadComments,
  sendForApproval, approveExpense, rejectExpense, reworkExpense, deleteExpense
} from './api';
import { OfficeExpenseFormModal } from './OfficeExpenseFormModal';

const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR'];
const MANAGER_ROLES = ['ADMIN', 'OFFICE_MANAGER'];

export function OfficeExpenseDetailModal({ expense, currentUser, onDone }) {
  const modal = useModal();
  const { close } = useModal();
  const [exp, setExp] = useState(expense);
  const [comments, setComments] = useState([]);

  const status = getStatusKey(exp);
  const cat = categoryMeta(exp.category);
  const st = statusMeta(status);

  const role = currentUser?.role;
  const isDirector = DIRECTOR_ROLES.includes(role);
  const isManager = MANAGER_ROLES.includes(role);
  const isOwner = exp.created_by && currentUser?.id && String(exp.created_by) === String(currentUser.id);
  const canEdit = (isManager || isOwner) && ['draft', 'rejected', 'rework'].includes(status);
  const canSend = (isManager || isOwner) && ['draft', 'rework'].includes(status);
  const canApprove = isDirector && ['pending', 'sent', 'question'].includes(status);
  const canDelete = (isManager || isOwner) && status === 'draft';

  useEffect(() => {
    loadComments(exp.id).then(setComments).catch(() => setComments([]));
  }, [exp.id]);

  const refresh = () => {
    window.dispatchEvent(new CustomEvent('asgard:office-expenses:changed'));
    onDone?.();
  };

  const doSend = () => {
    modal.open(
      <ConfirmModal
        title="Отправить на согласование?"
        message={`Директора получат уведомление. Сумма: ${fmtMoney(exp.amount)}.`}
        tone="gold"
        okText="📤 Отправить"
        onConfirm={async () => {
          try {
            await sendForApproval(exp.id);
            toast.success('Отправлено на согласование');
            refresh();
            close();
          } catch (e) { toast.error(e?.message || 'Не удалось отправить'); }
        }}
      />
    );
  };

  const doApprove = () => {
    modal.open(
      <ConfirmModal
        title="Согласовать расход?"
        message={`${cat.icon} ${cat.label}, ${fmtMoney(exp.amount)}. После согласования отправится в реестр оплат.`}
        tone="success"
        okText="✓ Согласовать"
        onConfirm={async () => {
          try {
            await approveExpense(exp.id, '');
            toast.success('Согласовано');
            refresh();
            close();
          } catch (e) { toast.error(e?.message || 'Не удалось согласовать'); }
        }}
      />
    );
  };

  const doReject = () => {
    modal.open(
      <PromptModal
        title="Отклонить расход"
        subtitle={`#${exp.id} · ${fmtMoney(exp.amount)}`}
        label="Причина отклонения"
        placeholder="Опишите почему отклонено…"
        multiline
        required
        accent="danger"
        icon="✕"
        okText="Отклонить"
        onSubmit={async (comment) => {
          try {
            await rejectExpense(exp.id, comment);
            toast.success('Отклонено');
            refresh();
            close();
          } catch (e) { toast.error(e?.message || 'Не удалось отклонить'); }
        }}
      />,
      { size: 'center' }
    );
  };

  const doRework = () => {
    modal.open(
      <PromptModal
        title="Отправить на доработку"
        subtitle={`#${exp.id}`}
        label="Что доработать"
        placeholder="Опишите что не так…"
        multiline
        required
        accent="warn"
        icon="🔄"
        okText="На доработку"
        onSubmit={async (comment) => {
          try {
            await reworkExpense(exp.id, comment);
            toast.success('Отправлено на доработку');
            refresh();
            close();
          } catch (e) { toast.error(e?.message || 'Не удалось'); }
        }}
      />,
      { size: 'center' }
    );
  };

  const doEdit = () => {
    close();
    modal.open(
      <OfficeExpenseFormModal
        expense={exp}
        onDone={(updated) => { setExp(updated || exp); refresh(); }}
      />,
      { size: 'wide' }
    );
  };

  const doDelete = () => {
    modal.open(
      <ConfirmModal
        title="Удалить расход?"
        message={`Расход #${exp.id} на ${fmtMoney(exp.amount)} будет удалён. Действие необратимо.`}
        tone="danger"
        okText="🗑 Удалить"
        onConfirm={async () => {
          try {
            await deleteExpense(exp.id);
            toast.success('Удалено');
            refresh();
            close();
          } catch (e) { toast.error(e?.message || 'Не удалось удалить'); }
        }}
      />
    );
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon={cat.icon}
        title={`Расход #${exp.id} · ${cat.label}`}
        subtitle={fmtDate(exp.date)}
        accent="default"
        onClose={close}
      />
      <MBody>
        <div className="row gap-12 u-wrap mb-14">
          <span className="fw-800 fs-22 c-gold">{fmtMoney(exp.amount)}</span>
          <StatusBadge tone={st.tone} label={st.label} />
          {exp.invoice_needed && (
            <Pill tone={exp.invoice_received ? 'ok' : 'amber'}>
              СФ: {exp.invoice_received ? 'получена' : 'ожидается'}
            </Pill>
          )}
        </div>

        <div className="m-grid-2">
          <Field label="Поставщик">
            <div className="py-8 c-t1">{exp.supplier || '—'}</div>
          </Field>
          <Field label="№ документа">
            <div className="py-8 c-t1">{exp.doc_number || '—'}</div>
          </Field>
          <Field label="Кто внёс">
            <div className="py-8 c-t1">{exp.creator_name || exp.created_by_name || '—'}</div>
          </Field>
          <Field label="Создано">
            <div className="py-8 c-t2 fs-13">{fmtDateTime(exp.created_at)}</div>
          </Field>
        </div>

        {(exp.comment || exp.description || exp.notes) && (
          <div className="mt-10">
            <Field label="Комментарий">
              <div className="bg-inner r-sm c-t1 lh-15 pad-cell-md">
                {exp.comment || exp.description || exp.notes}
              </div>
            </Field>
          </div>
        )}

        {(exp.reject_reason || exp.rejection_reason) && (
          <div className="mt-10 bg-err c-err r-sm fs-13 lh-15" style={{ padding: '10px 12px' }}>
            <b>Причина отклонения:</b> {exp.reject_reason || exp.rejection_reason}
          </div>
        )}

        {comments.length > 0 && (
          <div className="mt-16">
            <div className="fs-11 c-t3 upper fw-700 mb-8">
              История согласования
            </div>
            <div className="col gap-6">
              {comments.map((c) => (
                <div key={c.id} className="bg-inner r-sm fs-13 lh-15 pad-cell-md">
                  <div className="row-spread gap-8 mb-4">
                    <b className="c-t2">{c.user_name || '—'} · {c.action}</b>
                    <span className="c-t3 fs-11">{fmtDateTime(c.created_at)}</span>
                  </div>
                  <div className="c-t1">{c.comment}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <div className="row gap-6">
          {canDelete && <Btn variant="danger" onClick={doDelete}>🗑 Удалить</Btn>}
        </div>
        <div className="row gap-6 u-wrap">
          <Btn variant="ghost" onClick={close}>Закрыть</Btn>
          {canEdit && <Btn variant="ghost" onClick={doEdit}>✎ Редактировать</Btn>}
          {canSend && <Btn variant="primary" onClick={doSend}>📤 Отправить</Btn>}
          {canApprove && (
            <>
              <Btn variant="warn" onClick={doRework}>🔄 Доработка</Btn>
              <Btn variant="danger" onClick={doReject}>✕ Отклонить</Btn>
              <Btn variant="success" onClick={doApprove}>✓ Согласовать</Btn>
            </>
          )}
        </div>
      </MFoot>
    </MCard>
  );
}
