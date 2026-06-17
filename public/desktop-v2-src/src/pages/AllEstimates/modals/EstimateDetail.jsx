/**
 * Модалка детали просчёта — карточка с полями + действиями согласования.
 * Источник: openEst() в all_estimates.js.
 *
 * Поля карточки:
 *   • Заказчик / тендер
 *   • РП, версия, цена ТКП, себестоимость (план)
 *   • Дата отправки на согласование, дата решения + автор
 *   • Сопроводительное письмо, комментарий РП, комментарий директора
 *
 * Действия:
 *   • Директор (если status='sent'): Согласовать / Доработка / Вопрос / Отклонить
 *   • PM (если status='rework'/'question' и user==pm_id): Отправить повторно
 *
 * При отсутствии прав действий — карточка просто на чтение.
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { PromptModal } from '@/modals/Prompt';
import { toast } from '@/modals/Notifications';
import { useAuth } from '@/api/useAuth';
import {
  loadEstimate,
  approveEstimate, reworkEstimate, questionEstimate, rejectEstimate, resubmitEstimate, statusMeta, fmtMoney, fmtDateTime
} from '../api';

export function EstimateDetailModal({ estimate: initial, onChanged }) {
  const { close, open } = useModal();
  const { user } = useAuth();
  const [e, setE] = useState(initial);
  const [busy, setBusy] = useState(false);

  // Тянем свежие данные (тендер/комментарий/документы)
  useEffect(() => {
    if (!initial?.id) return;
    loadEstimate(initial.id).then((fresh) => {
      if (fresh) setE((cur) => ({ ...cur, ...fresh }));
    }).catch(() => {});
  }, [initial?.id]);

  const meta = statusMeta(e.approval_status);
  const sent = fmtDateTime(e.sent_for_approval_at);
  const decided = e.decided_at ? fmtDateTime(e.decided_at) : null;

  // RBAC — синхронно с vanilla all_estimates.js:
  //   :12,172,173 — директор+ADMIN видят/решают (canAct)
  //   :108        — PM/HEAD_PM (автор просчёта) видит свои + кнопку повторной отправки
  // Inline-литералы нужны для скрипта rbac-audit (он не разворачивает helper-функцию).
  const canAct = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role)
                  && e.approval_status === 'sent';
  const isAuthorOfPmRoles = ['PM', 'HEAD_PM'].includes(user?.role);
  const isPmRework =
    ['rework', 'question'].includes(e.approval_status) &&
    ((isAuthorOfPmRoles && Number(user?.id) === Number(e.pm_id)) || user?.role === 'ADMIN');

  const refreshAndNotify = () => {
    onChanged?.();
    window.dispatchEvent(new CustomEvent('asgard:estimates:changed'));
  };

  const doApprove = async () => {
    setBusy(true);
    try {
      await approveEstimate(e.id, '');
      toast.success(`Согласовано: #${e.id}`);
      refreshAndNotify();
      close();
    } catch (err) {
      toast.error(`Ошибка: ${err?.message || err}`);
      setBusy(false);
    }
  };

  const askComment = (action, label, tone, fn) => {
    open(
      <PromptModal
        title={action}
        subtitle={label}
        label="Комментарий"
        placeholder="Опишите, что именно нужно исправить / в чём вопрос…"
        multiline
        required
        accent={tone}
        icon="✎"
        okText="Отправить"
        onSubmit={async (comment) => {
          setBusy(true);
          try {
            await fn(e.id, comment);
            toast.success(`Готово: #${e.id} → ${label.toLowerCase()}`);
            refreshAndNotify();
            close();
          } catch (err) {
            toast.error(`Ошибка: ${err?.message || err}`);
            setBusy(false);
          }
        }}
      />
    );
  };

  const doResubmit = async () => {
    setBusy(true);
    try {
      await resubmitEstimate(e.id);
      toast.success('Отправлено повторно');
      refreshAndNotify();
      close();
    } catch (err) {
      toast.error(`Ошибка: ${err?.message || err}`);
      setBusy(false);
    }
  };

  const openReport = () => {
    // Переход на React-страницу /estimate-report?id=X
    // (зарегистрирована в App.jsx, lazy-import pages/EstimateReport).
    window.location.hash = `#/estimate-report?id=${e.id}`;
    close();
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon="📊"
        title={`Просчёт #${e.id}`}
        subtitle={e.customer || e.customer_name || ''}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          {/* Шапка: тендер + статус */}
          <div className="row-top gap-12 u-wrap row-spread">
            <div className="flex-1 min-w-200 min-w-240">
              <div className="fs-15 fw-700 c-t1">
                {e.customer || e.customer_name || '—'}
              </div>
              <div className="fs-13 c-t3 mt-4">
                {e.title || '—'}
              </div>
            </div>
            <Pill tone={meta.tone}>{meta.label}</Pill>
          </div>

          {/* Сетка ключ-значение */}
          <div className="grid-2 fs-13 p-12 bg-inner r-sm" style={{ gap: '10px 16px' }}>
            <KV k="РП" v={e.pm_name || '—'} />
            <KV k="Версия" v={`v${e.version_no || 1}`} />
            <KV k="Цена ТКП" v={<b className="c-t1">{fmtMoney(e.price_tkp)}</b>} />
            <KV k="Себестоимость (план)" v={fmtMoney(e.cost_plan)} />
            <KV k="Отправлено" v={sent} />
            {decided && (
              <KV k="Решение" v={decided + (e.decided_by_user_id ? ' · ' + (e.director_name || '') : '')} />
            )}
            {e.tender_id && <KV k="Тендер" v={`#${e.tender_id}`} />}
          </div>

          {/* Сопроводительное письмо */}
          {e.cover_letter && (
            <div>
              <div className="fw-600 fs-13 mb-6 c-t1">
                Сопроводительное письмо
              </div>
              <div className="p-12 r-sm bg-inner fs-13 c-t2 u-prewrap ov-auto mh-200">
                {e.cover_letter}
              </div>
            </div>
          )}

          {/* Комментарий РП */}
          {e.comment && (
            <KVBlock label="Комментарий РП" value={e.comment} />
          )}

          {/* Комментарий директора (если НЕ PM-rework, иначе ниже в hint) */}
          {e.approval_comment && !isPmRework && (
            <KVBlock label="Комментарий директора" value={e.approval_comment} />
          )}

          {/* PM hint при rework/question */}
          {isPmRework && (
            <div className="p-12 r-sm bg-orange" style={{ border: '1px solid var(--amber)' }}>
              <div className="fw-600 c-amber fs-13">
                {e.approval_status === 'question'
                  ? '❓ Вопрос от директора'
                  : '↻ Возвращено на доработку'}
              </div>
              <div className="mt-6 fs-13 c-t2 u-prewrap">
                {e.approval_comment || '—'}
              </div>
              <div className="mt-12">
                <Btn variant="primary" disabled={busy} onClick={doResubmit}>
                  📤 Отправить повторно
                </Btn>
              </div>
            </div>
          )}
        </div>
      </MBody>

      <MFoot align="spread">
        <div className="u-flex gap-6">
          <Btn onClick={close}>Закрыть</Btn>
          <Btn variant="ghost" onClick={openReport}>📈 Отчёт</Btn>
        </div>
        {canAct && (
          <div className="u-flex gap-6 u-wrap">
            <Btn
              variant="success"
              disabled={busy}
              onClick={doApprove}
            >
              ✓ Согласовать
            </Btn>
            <Btn
              variant="warn"
              disabled={busy}
              onClick={() => askComment('На доработку', 'Расчётчик доработает по комментарию', 'warn', reworkEstimate)}
            >
              ↻ Доработка
            </Btn>
            <Btn
              variant="info"
              disabled={busy}
              onClick={() => askComment('Вопрос', 'Уточнение по просчёту', 'info', questionEstimate)}
            >
              ❓ Вопрос
            </Btn>
            <Btn
              variant="danger"
              disabled={busy}
              onClick={() => askComment('Отклонить', 'Тендер пометится как «Не подходит»', 'danger', rejectEstimate)}
            >
              ✕ Отклонить
            </Btn>
          </div>
        )}
      </MFoot>
    </MCard>
  );
}

function KV({ k, v }) {
  return (
    <div className="row-spread gap-10">
      <span className="c-t3">{k}</span>
      <span className="c-t1 t-right">{v}</span>
    </div>
  );
}

function KVBlock({ label, value }) {
  return (
    <div>
      <div className="fw-600 fs-13 mb-6 c-t1">
        {label}
      </div>
      <div className="p-10 r-sm bg-inner fs-13 c-t2 u-prewrap">
        {value}
      </div>
    </div>
  );
}
