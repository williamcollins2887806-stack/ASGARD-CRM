/**
 * Карточка входящей заявки: AI-анализ + текст письма + вложения + действия.
 * Источник: vanilla `inbox_applications.js` → openDetail.
 */
import { useState, useEffect, lazy, Suspense } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { toast, StatusBadge } from '@/modals/Notifications';
import { ConfirmModal, PromptModal } from '@/modals';
import {
  loadDetail, analyze, calcCost, accept, reject, review, archive,
  statusInfo, colorInfo, CLASSIFICATIONS, fmtMoney, fmtDateTime, emitChanged
} from './api';

// Vanilla inbox_applications.js:275 рендерил ai_report через AsgardUI.renderMarkdown.
// Реюзаем тот же markdown-рендерер, что и в PreTenders DetailModal (lazy — модуль ~150 строк).
const MarkdownView = lazy(() => import('@/pages/PreTenders/modals/MarkdownView'));

export function InboxDetailModal({ id, onChanged }) {
  const { close, open } = useModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    setLoading(true);
    loadDetail(id)
      .then(setData)
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [id]);

  if (loading || !data?.item) {
    return (
      <MCard className="modal-xl">
        <MHead icon="📨" title="Загружаем заявку…" onClose={close} />
        <MBody><div className="card-empty">⏳ Загружаем…</div></MBody>
      </MCard>
    );
  }

  const item = data.item;
  const attachments = data.attachments || [];
  const st = statusInfo(item.status);
  const col = colorInfo(item.ai_color);
  const classLabel = CLASSIFICATIONS[item.ai_classification] || item.ai_classification || '';

  const runAnalyze = async () => {
    setBusy(true);
    try {
      const res = await analyze(id);
      if (res?.success) {
        toast.success('🧙 Анализ завершён');
        emitChanged();
        reload();
        onChanged?.();
      } else {
        toast.error(res?.error || 'Ошибка анализа');
      }
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const runCostCalc = async () => {
    setBusy(true);
    try {
      const res = await calcCost(id);
      if (res?.success) {
        toast.success('💰 Себестоимость пересчитана');
        reload();
      } else {
        toast.error(res?.error || 'Ошибка');
      }
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onAccept = () => {
    open(
      <ConfirmModal
        tone="success"
        title="Принять заявку и создать тендер?"
        message="На основе заявки будет создан тендер. Заказчику можно отправить уведомление."
        confirmLabel="Принять"
        onConfirm={async () => {
          setBusy(true);
          try {
            const res = await accept(id, { create_tender: true, send_email: true });
            if (res?.success) {
              toast.success(res.tender_id ? `Тендер #${res.tender_id} создан` : 'Заявка принята');
              emitChanged();
              onChanged?.();
              close();
            } else if (res?.tender_id) {
              toast.warn(`Уже обработана. Тендер #${res.tender_id}`);
              emitChanged();
              onChanged?.();
              close();
            } else {
              toast.error(res?.error || 'Не удалось');
            }
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  };

  const onReject = () => {
    open(
      <PromptModal
        title="Причина отклонения"
        placeholder="Укажите, почему заявка не подходит"
        required
        multiline
        onConfirm={async (reason) => {
          setBusy(true);
          try {
            const res = await reject(id, { reason, send_email: true });
            if (res?.success) {
              toast.success('Отклонена');
              emitChanged();
              onChanged?.();
              close();
            } else {
              toast.error(res?.error || 'Не удалось');
            }
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  };

  const onReview = async () => {
    setBusy(true);
    try {
      const res = await review(id);
      if (res?.success) {
        toast.success('Взято на рассмотрение');
        emitChanged();
        reload();
        onChanged?.();
      }
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onArchive = () => open(
    <ConfirmModal
      tone="warn"
      title="В архив?"
      message="Заявка перейдёт в архив. Её можно будет найти через фильтр статусов."
      confirmLabel="В архив"
      onConfirm={async () => {
        try {
          await archive(id);
          toast.success('Архивировано');
          emitChanged();
          onChanged?.();
          close();
        } catch (e) {
          toast.error('Не удалось: ' + (e?.message || e));
        }
      }}
    />
  );

  const canActions = ['new', 'ai_processed', 'under_review'].includes(item.status);
  const canReviewBtn = ['new', 'ai_processed'].includes(item.status);
  const isAI = !item.created_by;

  return (
    <MCard className="modal-xl">
      <MHead
        icon="📨"
        title={item.subject || '(без темы)'}
        subtitle={`#${item.id} · ${classLabel || '—'}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-18">
          {/* Шапка-статусы */}
          <div className="u-flex gap-8 u-wrap">
            <StatusBadge tone={st.tone} label={st.label} />
            {item.ai_color && <Pill tone={col.tone}>{col.label}</Pill>}
            {item.ai_confidence && <Pill>AI: {Math.round(item.ai_confidence * 100)}%</Pill>}
            {classLabel && <Pill tone="info">{classLabel}</Pill>}
          </div>

          {/* Отправитель */}
          <div className="p-12 bg-inner r-md">
            <KV label="От" value={`${item.source_name || '—'} <${item.source_email || '—'}>`} />
            <KV label="Дата" value={fmtDateTime(item.created_at)} />
            <KV label="Внёс" value={isAI ? '🤖 МиМир (AI)' : (item.created_by_name || '—')} />
            {attachments.length > 0 && <KV label="Вложений" value={attachments.length + ' файла'} />}
          </div>

          {/* AI Анализ */}
          {item.ai_summary ? (
            <div className="p-14 bg-inner brd r-md">
              <div className="fw-700 mb-10">🤖 AI Анализ</div>
              <div className="mb-10 fs-14">{item.ai_summary}</div>
              <div className="fs-12 c-t3 lh-15">
                {item.ai_recommendation && <div><strong>Рекомендация:</strong> {item.ai_recommendation}</div>}
                {item.ai_work_type && <div><strong>Тип работ:</strong> {item.ai_work_type}</div>}
                {item.ai_estimated_budget && <div><strong>Бюджет:</strong> ~{fmtMoney(item.ai_estimated_budget)}</div>}
                {item.ai_estimated_days && <div><strong>Срок:</strong> ~{item.ai_estimated_days} дней</div>}
                {item.ai_keywords?.length > 0 && <div><strong>Ключевые:</strong> {item.ai_keywords.join(', ')}</div>}
                {/* Vanilla inbox_applications.js:263 показывал уверенность отдельной строкой в AI-блоке */}
                <div><strong>Уверенность:</strong> {item.ai_confidence != null ? Math.round(item.ai_confidence * 100) + '%' : '—'}</div>
                {item.ai_model && <div><strong>Модель:</strong> {item.ai_model}</div>}
              </div>
            </div>
          ) : (
            <div className="p-14 bg-inner r-md t-center">
              <div className="c-t3 mb-10">AI-анализ не проводился</div>
              <Btn variant="primary" disabled={busy} onClick={runAnalyze}>🤖 Запустить анализ</Btn>
            </div>
          )}

          {/* AI report — vanilla:275 рендерил markdown (AsgardUI.renderMarkdown). */}
          {item.ai_report && (
            <details open className="bg-inner p-12 r-md">
              <summary className="cur-p fw-600 fs-13">AI-отчёт</summary>
              <div className="mt-10 fs-13 lh-15">
                <Suspense fallback={<div className="c-t3 fs-12">⏳ Загружаем рендерер…</div>}>
                  <MarkdownView source={item.ai_report} />
                </Suspense>
              </div>
            </details>
          )}

          {/* Текст письма */}
          <details className="bg-inner p-12 r-md">
            <summary className="cur-p fw-600 fs-13">Текст письма</summary>
            <div className="mt-10 p-12 bg-card fs-12 ov-y-auto u-prewrap r-sm brd" style={{ maxHeight: 360 }}>
              {item.email_body_text || item.body_preview || '(пусто)'}
            </div>
          </details>

          {/* Вложения */}
          {attachments.length > 0 && (
            <details className="bg-inner p-12 r-md">
              <summary className="cur-p fw-600 fs-13">📎 Вложения ({attachments.length})</summary>
              <div className="mt-10">
                {attachments.map((a) => (
                  <div key={a.id} className="py-4 fs-12">
                    📄 {a.original_filename} <span className="c-t3">({Math.round((a.size || 0) / 1024)} КБ)</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Решение */}
          {item.decision_by_name && (
            <div className="p-12 bg-inner r-md fs-13">
              <div><strong>Решение:</strong> {item.decision_by_name} · {fmtDateTime(item.decision_at)}</div>
              {item.decision_notes && <div className="mt-6">{item.decision_notes}</div>}
              {item.rejection_reason && <div className="mt-6"><strong>Причина:</strong> {item.rejection_reason}</div>}
              {item.linked_tender_id && (
                <div className="mt-6">
                  <a href={'#/tenders?open=' + item.linked_tender_id}>Тендер #{item.linked_tender_id} →</a>
                </div>
              )}
            </div>
          )}

          {/* Загрузка компании на момент анализа */}
          {item.workload_snapshot && (
            <details className="bg-inner p-12 r-md">
              <summary className="cur-p fw-600 fs-12 c-t3">
                Загрузка компании (на момент анализа)
              </summary>
              <div className="mt-8 fs-12 c-t3">
                Активных работ: {item.workload_snapshot.activeWorks || 0} ·
                Тендеров: {item.workload_snapshot.activeTenders || 0} ·
                Свободных: {item.workload_snapshot.availableCrews || 0}
              </div>
            </details>
          )}
        </div>
      </MBody>
      <MFoot align="spread">
        <div className="u-flex gap-8 u-wrap">
          <Btn variant="ghost" disabled={busy} onClick={runAnalyze}>🔄 Переанализ</Btn>
          {item.ai_estimated_budget != null && (
            <Btn variant="ghost" disabled={busy} onClick={runCostCalc}>💰 Себестоимость</Btn>
          )}
        </div>
        <div className="u-flex gap-8 u-wrap">
          {canActions && (
            <>
              <Btn variant="primary" disabled={busy} onClick={onAccept}>✓ Принять</Btn>
              <Btn variant="ghost" disabled={busy} onClick={onReject} className="c-err">✕ Отклонить</Btn>
            </>
          )}
          {canReviewBtn && <Btn variant="ghost" disabled={busy} onClick={onReview}>👁 На рассмотрение</Btn>}
          {item.status !== 'archived' && <Btn variant="ghost" disabled={busy} onClick={onArchive}>📦 В архив</Btn>}
          <Btn onClick={close}>Закрыть</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}

function KV({ label, value }) {
  return (
    <div className="kv-row-120 fs-13">
      <div className="c-t3">{label}</div>
      <div>{value}</div>
    </div>
  );
}
