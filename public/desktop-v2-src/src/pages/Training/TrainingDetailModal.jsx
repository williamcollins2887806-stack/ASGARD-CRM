/**
 * TrainingDetailModal — карточка заявки на обучение + workflow actions.
 *
 * RBAC (action -> role):
 *   - submit: автор / ADMIN (draft -> pending_approval)
 *   - approve_head: HEAD_PM/HEAD_TO/DIRECTOR/ADMIN (pending -> approved)
 *   - approve_budget: DIRECTOR_GEN/ADMIN (approved -> budget_approved)
 *   - confirm_payment: BUH/ADMIN (budget_approved -> paid)
 *   - mark_completed: HR/HR_MANAGER/ADMIN (paid -> completed)
 *   - reject: соотв. роль на этапе -> rejected
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal, PromptModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { StatusBadge } from '@/modals/Notifications';
import { loadOne, updateStatus, deleteApp, STATUS_MAP, STATUS_TONES, TYPE_MAP } from './api';
import { TrainingEditModal } from './TrainingEditModal';

function emit() { window.dispatchEvent(new CustomEvent('asgard:training:changed')); }

export function TrainingDetailModal({ id, onChanged }) {
  const { user } = useAuth();
  const { close, open } = useModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setLoading(true);
    loadOne(id)
      .then(setData)
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [id]);

  if (loading || !data) {
    return (
      <MCard>
        <MHead title="Заявка на обучение" onClose={close} />
        <MBody>
          <div className="t-center p-32 c-t3">⏳ Загрузка…</div>
        </MBody>
      </MCard>
    );
  }

  const status = data.status;
  const isOwner = data.user_id === user?.id;
  const role = user?.role;

  // RBAC inline-литералы для каждого action
  const _canSubmit = status === 'draft' && (isOwner || ['ADMIN'].includes(role));
  const _canApproveHead = status === 'pending_approval' && ['HEAD_PM', 'HEAD_TO', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role);
  const _canApproveBudget = status === 'approved' && ['ADMIN', 'DIRECTOR_GEN'].includes(role);
  const _canConfirmPay = status === 'budget_approved' && ['BUH', 'ADMIN'].includes(role);
  const _canMarkCompleted = status === 'paid' && ['HR', 'HR_MANAGER', 'ADMIN'].includes(role);
  const _canEdit = status === 'draft' && (isOwner || ['ADMIN'].includes(role));
  const _canDelete = status === 'draft' && ['ADMIN'].includes(role);

  const _canReject = (
    (status === 'pending_approval' && ['HEAD_PM', 'HEAD_TO', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role)) ||
    (status === 'approved' && ['ADMIN', 'DIRECTOR_GEN'].includes(role)) ||
    (status === 'budget_approved' && ['BUH', 'ADMIN'].includes(role))
  );

  const act = async (action, extra) => {
    setBusy(true);
    try {
      await updateStatus(id, action, extra);
      toast.success('Статус обновлён');
      emit();
      refresh();
      onChanged?.();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = () => open(<ConfirmModal tone="success" title="Подать на согласование?" message="Заявка будет отправлена руководителю." onConfirm={() => act('submit')} />);
  const onApproveHead = () => open(<ConfirmModal tone="success" title="Согласовать как руководитель?" onConfirm={() => act('approve_head')} />);
  const onApproveBudget = () => open(<ConfirmModal tone="success" title="Утвердить бюджет?" message={`${fmtMoney(data.cost)} — бюджет одобрен.`} onConfirm={() => act('approve_budget')} />);
  const onConfirmPay = () => open(<ConfirmModal tone="success" title="Подтвердить оплату?" message="Заявка перейдёт в статус «Оплачено»." onConfirm={() => act('confirm_payment')} />);
  const onMarkCompleted = () => open(<ConfirmModal tone="success" title="Завершить обучение?" message="Заявка будет помечена как «Завершено»." onConfirm={() => act('mark_completed')} />);
  const onReject = () => open(<PromptModal title="Отклонить заявку?" label="Причина отказа" multiline onSubmit={(reject_reason) => act('reject', { reject_reason })} />);

  const onEdit = () => {
    close();
    setTimeout(() => open(<TrainingEditModal app={data} onSaved={() => { emit(); onChanged?.(); }} />), 30);
  };
  const onDelete = () => open(<ConfirmModal tone="danger" title="Удалить заявку?" message="Будет удалён черновик безвозвратно." onConfirm={async () => {
    try {
      await deleteApp(id);
      toast.success('Удалена');
      emit();
      onChanged?.();
      close();
    } catch (e) {
      toast.error('Не удалось удалить: ' + (e?.message || e));
    }
  }} />);

  return (
    <MCard>
      <MHead
        icon="📚"
        title={data.course_name || '...'}
        subtitle={`№ ${data.id} · ${data.user_name || '—'}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="mb-14">
          <StatusBadge tone={STATUS_TONES[status] || 'draft'} label={STATUS_MAP[status]?.label || status} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <KV label="Сотрудник" value={data.user_name || '—'} />
          <KV label="Роль" value={data.user_role || '—'} />
          <KV label="Тип" value={TYPE_MAP[data.training_type] || data.training_type || '—'} />
          <KV label="Поставщик" value={data.provider || '—'} />
          <KV label="Период" value={fmtDateRange(data.date_start, data.date_end)} />
          <KV label="Стоимость" value={fmtMoney(data.cost)} accent="gold" />
        </div>

        {data.justification && (
          <Section title="Обоснование">
            <div className="fs-13 c-t2 lh-15">{data.justification}</div>
          </Section>
        )}
        {data.comment && (
          <Section title="Комментарий">
            <div className="fs-13 c-t2 lh-15">{data.comment}</div>
          </Section>
        )}

        {/* History */}
        <Section title="История согласования">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            {data.head_name && (
              <Row label="Руководитель" who={data.head_name} when={data.approved_by_head_at} tone="ok" />
            )}
            {data.dir_name && (
              <Row label="Бюджет" who={data.dir_name} when={data.approved_by_dir_at} tone="ok" />
            )}
            {data.buh_name && (
              <Row label="Бухгалтерия" who={data.buh_name} when={data.paid_by_buh_at} tone="ok" />
            )}
            {data.hr_name && (
              <Row label="HR (завершено)" who={data.hr_name} when={data.completed_by_hr_at} tone="ok" />
            )}
            {data.rejector_name && (
              <Row label="Отклонил" who={data.rejector_name} when={data.rejected_at} tone="err" reason={data.reject_reason} />
            )}
          </div>
        </Section>
      </MBody>
      <MFoot align="spread">
        <div className="u-flex gap-8">
          {_canEdit && <Btn variant="ghost" onClick={onEdit}>✎ Редактировать</Btn>}
          {_canDelete && <Btn variant="ghost" onClick={onDelete} className="c-err">🗑 Удалить</Btn>}
        </div>
        <div className="u-flex gap-8">
          {_canReject && <Btn variant="ghost" onClick={onReject} className="c-err" disabled={busy}>✕ Отклонить</Btn>}
          {_canSubmit && <Btn variant="primary" onClick={onSubmit} disabled={busy}>📤 Подать</Btn>}
          {_canApproveHead && <Btn variant="primary" onClick={onApproveHead} disabled={busy}>✓ Согласовать</Btn>}
          {_canApproveBudget && <Btn variant="primary" onClick={onApproveBudget} disabled={busy}>💰 Утвердить бюджет</Btn>}
          {_canConfirmPay && <Btn variant="primary" onClick={onConfirmPay} disabled={busy}>💳 Подтвердить оплату</Btn>}
          {_canMarkCompleted && <Btn variant="primary" onClick={onMarkCompleted} disabled={busy}>🎓 Завершить</Btn>}
          <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}

function KV({ label, value, accent }) {
  return (
    <div>
      <div className="mini-kpi-label">{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: accent === 'gold' ? 'var(--gold)' : 'var(--t-1)', marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Section({ title, children }) {
  return (
    <div className="mt-18 pt-14 brd-2-t">
      <div className="label-cap-lg mb-8">{title}</div>
      {children}
    </div>
  );
}
function Row({ label, who, when, tone, reason }) {
  return (
    <div className="p-10 bg-inner r-sm">
      <div className="row-spread">
        <div>
          <b>{label}: </b>
          <span style={{ color: tone === 'err' ? 'var(--err)' : 'var(--t-1)' }}>{who}</span>
        </div>
        <div className="fs-11 c-t3">{fmtDateTime(when)}</div>
      </div>
      {reason && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--err)' }}>Причина: {reason}</div>}
    </div>
  );
}
function fmtMoney(n) {
  if (!Number.isFinite(+n) || +n === 0) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ru-RU'); } catch { return '—'; }
}
function fmtDateTime(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('ru-RU'); } catch { return '—'; }
}
function fmtDateRange(from, to) {
  if (!from && !to) return '—';
  if (from && to) return `${fmtDate(from)} — ${fmtDate(to)}`;
  return fmtDate(from || to);
}
