/**
 * Модалка детальной карточки заявки на премию.
 *
 * Для PM — просмотр своего запроса (со статусом и комментарием директора).
 * Для директоров (ADMIN, DIRECTOR_*) — 4 действия согласования:
 *   ✓ approve, 🔄 rework, ❓ question, ✕ reject (с обязательным комментарием).
 *
 * Endpoints:
 *   POST /api/approval/bonus_requests/:id/{approve,rework,question,reject}
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { PromptModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import {
  approveBonus, reworkBonus, questionBonus, rejectBonus,
  notifyApproval,
  loadEmployees, parseBonuses, statusMeta, fmtMoney, fmtDateTime
} from './api';

const _DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export function BonusApprovalModal({ request, userRole, onDone }) {
  const { close, open } = useModal();
  // inline-литералы ролей для скрипта rbac-audit. Логика идентична vanilla bonus_approval.js:233-236
  const isDirector = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(userRole);
  const [employees, setEmployees] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadEmployees().then(setEmployees).catch(() => setEmployees([]));
  }, []);

  const empMap = useMemo(() => {
    const m = new Map();
    employees.forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  const bonuses = useMemo(() => parseBonuses(request.bonuses ?? request.bonuses_json), [request]);
  const meta = statusMeta(request.status);
  const canDecide = isDirector && (request.status === 'pending' || request.status === 'sent');

  const doApprove = async () => {
    setBusy(true);
    try {
      await approveBonus(request.id);
      // Уведомление РП о согласовании (telegram-канал) — см. vanilla bonus_approval.js:525.
      await notifyApproval({
        type: 'bonus',
        action: 'approved',
        entityId: request.id,
        toUserId: request.pm_id || request.created_by,
        details: `Премии по работе «${request.work_title || ''}» согласованы директором.`
      });
      toast('Согласовано', '', 'ok');
      window.dispatchEvent(new CustomEvent('asgard:bonus-approval:changed'));
      onDone?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  const askComment = (action, fn, label, tone, notifyAction) => {
    open(
      <PromptModal
        title={action}
        label="Комментарий"
        placeholder={label}
        multiline
        required
        accent={tone}
        icon="✎"
        okText="Отправить"
        onSubmit={async (comm) => {
          try {
            await fn(request.id, comm);
            // Telegram-уведомление РП (синхронно с vanilla bonus_approval.js:525)
            await notifyApproval({
              type: 'bonus',
              action: notifyAction || 'updated',
              entityId: request.id,
              toUserId: request.pm_id || request.created_by,
              details: `Премии по работе «${request.work_title || ''}»: ${action}.\n${comm || ''}`
            });
            toast('Отправлено', '', 'ok');
            window.dispatchEvent(new CustomEvent('asgard:bonus-approval:changed'));
            onDone?.();
            close();
          } catch (e) {
            toast('Ошибка', String(e?.message || e), 'err');
          }
        }}
      />,
      { size: 'center' }
    );
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon="🏆"
        title={`Премии · #${request.id}`}
        subtitle={request.work_title || (request.work_id ? `Работа #${request.work_id}` : '')}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {/* Сводка */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 12,
            background: 'var(--inner-bg)',
            borderRadius: 'var(--r-md)',
            marginBottom: 14
          }}
        >
          <div>
            <div className="fs-11 c-t3 upper fw-700 ls-wide">
              Статус
            </div>
            <div className="mt-4">
              <StatusBadge tone={meta.tone} label={meta.label} />
            </div>
          </div>
          <div className="t-right">
            <div className="fs-11 c-t3">Создано</div>
            <div className="fs-13 c-t2 fw-600">{fmtDateTime(request.created_at)}</div>
          </div>
          <div className="t-right">
            <div className="fs-11 c-t3">Сумма</div>
            <div style={{ fontSize: 18, color: 'var(--gold)', fontWeight: 800 }}>{fmtMoney(request.total_amount)}</div>
          </div>
        </div>

        {/* Кто отправил */}
        {(request.pm_name || request.created_by) && (
          <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--t-2)' }}>
            <span className="c-t3">РП:&nbsp;</span>
            <b>{request.pm_name || `#${request.created_by}`}</b>
          </div>
        )}

        {/* Распределение премий */}
        <div className="label-cap-lg mb-8">
          Распределение
        </div>
        {bonuses.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--t-3)', background: 'var(--inner-bg)', borderRadius: 'var(--r-md)' }}>
            Нет данных о распределении премий
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {bonuses.map((b, i) => {
              const emp = empMap.get(b.employee_id);
              const name = emp?.fio || emp?.full_name || `Рабочий #${b.employee_id}`;
              return (
                <Pill key={i}>{name}: <b className="c-gold">{fmtMoney(b.amount)}</b></Pill>
              );
            })}
          </div>
        )}

        {/* Обоснование РП */}
        {request.comment && (
          <div style={{ padding: 12, background: 'var(--inner-bg)', borderRadius: 'var(--r-md)', marginBottom: 12 }}>
            <div className="fs-11 c-t3 fw-600 mb-4">Обоснование</div>
            <div className="fs-13 c-t1 u-prewrap">{request.comment}</div>
          </div>
        )}

        {/* Ответ директора */}
        {request.director_comment && (
          <div style={{ padding: 12, background: 'var(--card-bg)', borderRadius: 'var(--r-md)', borderLeft: `3px solid var(--${meta.tone === 'rejected' ? 'err' : 'amber'})` }}>
            <div className="fs-11 c-t3 fw-600 mb-4">Ответ директора</div>
            <div className="fs-13 c-t1 u-prewrap">{request.director_comment}</div>
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        {canDecide && (
          <div className="u-flex gap-6 u-wrap">
            <Btn variant="success" disabled={busy} onClick={doApprove}>✓ Согласовать</Btn>
            <Btn variant="warn" disabled={busy} onClick={() => askComment('На доработку', reworkBonus, 'РП доработает по комментарию', 'warn', 'rework')}>↻ Доработать</Btn>
            <Btn variant="info" disabled={busy} onClick={() => askComment('Вопрос', questionBonus, 'Уточнение по премиям', 'info', 'question')}>❓ Вопрос</Btn>
            <Btn variant="danger" disabled={busy} onClick={() => askComment('Отклонить', rejectBonus, 'Причина отклонения', 'danger', 'rejected')}>✕ Отклонить</Btn>
          </div>
        )}
      </MFoot>
    </MCard>
  );
}
