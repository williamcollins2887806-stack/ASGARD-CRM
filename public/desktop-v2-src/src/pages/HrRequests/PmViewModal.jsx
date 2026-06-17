/**
 * Модалка PM «Смотреть заявку».
 * Источник: vanilla `hr_requests.js` openPmView.
 *
 * Показывает: статус, прогресс по позициям, назначенные рабочие, HR-комментарий.
 * Действия:
 *   • Если draft/rework — «Редактировать» (открывает RequestFormModal)
 *   • Если approved   — «Добавить в бригаду»
 */
import { useState, useEffect } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast, StatusBadge } from '@/modals/Notifications';
import {
  describeStatus, loadRequest, addToCrew, fmtDate,
} from './api';
import { RequestFormModal } from './RequestFormModal';

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:hr-requests:changed'));
}

export function PmViewModal({ requestId, onChanged }) {
  const { close, open } = useModal();
  const [req, setReq] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadRequest(requestId)
      .then(setReq)
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [requestId]);

  if (loading) {
    return (
      <MCard className="modal-wide">
        <MHead icon="📨" title={`Заявка #${requestId}`} onClose={close} />
        <MBody>
          <div className="t-center p-40 c-t3">⏳ Загружаем…</div>
        </MBody>
      </MCard>
    );
  }

  if (!req) {
    return (
      <MCard className="modal-wide">
        <MHead icon="📨" title="Заявка не найдена" onClose={close} accent="warn" />
        <MFoot><Btn onClick={close}>Закрыть</Btn></MFoot>
      </MCard>
    );
  }

  const meta = describeStatus(req.status_v2 || req.status);
  const status = req.status_v2 || req.status;
  const positions = req.positions || [];
  const assignments = req.assignments || [];

  const onEdit = () => {
    close();
    open(<RequestFormModal workId={req.work_id} onSaved={onChanged} />, { size: 'wide' });
  };
  const onAddCrew = () => {
    open(
      <ConfirmModal
        tone="gold"
        title="Добавить в бригаду?"
        message={`Добавить ${assignments.length} утверждённых рабочих на работу «${req.work_title || '—'}»? Они получат уведомление.`}
        okText="✓ Добавить"
        onConfirm={async () => {
          try {
            await addToCrew(req.id);
            toast.success('Рабочие добавлены в бригаду');
            emitChanged();
            onChanged?.();
            close();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  return (
    <MCard className="modal-wide">
      <MHead
        icon="📨"
        title={`Заявка #${req.id}`}
        subtitle={`${req.work_title || '—'} ${req.customer_name ? '· ' + req.customer_name : ''}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-16">
          <div className="row gap-10 u-wrap">
            <StatusBadge tone={meta.tone} label={meta.label} />
            <span className="c-t3 fs-13">создана {fmtDate(req.created_at)}</span>
            {req.hr_name && <span className="c-t3 fs-13">HR: {req.hr_name}</span>}
          </div>

          {/* Позиции */}
          <Section title="Прогресс по позициям">
            {positions.length === 0 ? (
              <div className="c-t3">Позиции не заданы</div>
            ) : (
              <div className="hr-pos">
                {positions.map((p) => <PositionRow key={p.id} pos={p} />)}
              </div>
            )}
          </Section>

          {/* Назначенные */}
          <Section title={`Назначенные рабочие (${assignments.length})`}>
            {assignments.length === 0 ? (
              <div className="c-t3">Никого не назначено</div>
            ) : (
              <div className="col gap-6">
                {assignments.map((a) => (
                  <div key={a.id} className="hr-assign-row">
                    <div>
                      <b>{a.fio || '—'}</b>
                      <span style={{ fontSize: 11, color: 'var(--t-3)', marginLeft: 8 }}>
                        {a.assigned_role || a.role_tag || ''}
                      </span>
                      {a.role_mismatch && (
                        <span style={{ color: 'var(--amber)', fontSize: 11, marginLeft: 8 }}>
                          ⚠️ роль не совпадает
                        </span>
                      )}
                    </div>
                    <StatusBadge tone="approved" label={a.status || ''} />
                  </div>
                ))}
              </div>
            )}
          </Section>

          {req.hr_comment && (
            <div style={{
              padding: 10, background: 'var(--orange-bg)', color: 'var(--amber)',
              borderRadius: 'var(--r-sm)', fontSize: 13,
            }}>
              <b>Комментарий HR:</b> {req.hr_comment}
            </div>
          )}

          {req.work_description && (
            <Section title="Описание работ">
              <div style={{ color: 'var(--t-2)', fontSize: 13, whiteSpace: 'pre-wrap' }}>{req.work_description}</div>
            </Section>
          )}
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Закрыть</Btn>
        <div className="u-flex gap-6">
          {(status === 'draft' || status === 'rework') && (
            <Btn onClick={onEdit}>✎ Редактировать</Btn>
          )}
          {status === 'approved' && (
            <Btn variant="primary" onClick={onAddCrew}>+ Добавить в бригаду</Btn>
          )}
        </div>
      </MFoot>
    </MCard>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
        fontWeight: 800, color: 'var(--t-3)', marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function PositionRow({ pos }) {
  const pct = pos.required_count > 0 ? Math.round((pos.filled_count || 0) / pos.required_count * 100) : 0;
  const isFull = pct >= 100;
  return (
    <div className={`hr-pos-row ${isFull ? 'hr-pos-row--full' : 'hr-pos-row--part'}`}>
      <div className="hr-pos-head">
        <span>{pos.role_label}{isFull ? ' ✅' : ''}</span>
        <span style={{ fontWeight: 700, color: isFull ? 'var(--ok)' : 'var(--amber)' }}>
          {pos.filled_count || 0} / {pos.required_count}
        </span>
      </div>
      <div className="hr-pos-fill">
        <div style={{ width: Math.min(100, pct) + '%' }} />
      </div>
    </div>
  );
}
