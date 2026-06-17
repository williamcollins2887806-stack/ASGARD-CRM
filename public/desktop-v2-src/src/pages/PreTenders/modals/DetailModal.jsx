/**
 * DetailModal — полная карточка пред-тендера с AI-отчётом + редактирование.
 * Источник: openDetail в pre_tenders.js (строки 750–1260).
 *
 * Покрыто (всё из vanilla):
 *   1. full_ai_report как markdown (~строка 1101) — секция «🧙 Полный анализ Мимира»
 *   2. ai_cost_report структурированный (~строки 153, 1103) — таблица «💰 Расчёт стоимости»
 *   3. Drop-zone /upload-docs + автоматический re-analyze (~строка 1116)
 *   4. Секция «📧 Оригинальное письмо» с ссылкой на mailbox (~строка 979)
 *   5. Секция «💬 Цепочка переписки» (~строка 1021)
 *   6. Кнопка «🧙 Быстрое ТКП через Мимира» → QuickMimirModal (~строка 1043)
 *   7. Секция «Решение» (decision_by_name + created_tender_id) (~строка 1012)
 */
import { useState, useEffect, lazy, Suspense } from 'react';
import { useModal } from '@/modals';
import { useAuth } from '@/api/useAuth';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { Field, TextInput, INNInput, PhoneInput, TextareaInput, DatePicker, MoneyInput } from '@/inputs/Inputs';
import { StatusBadge, toast } from '@/modals/Notifications';
import { validateFiles, MAX_ATTACHMENT_SIZE } from '@/api/upload';
import {
  loadDetail, analyze, calcCost, update, uploadDocs,
  STATUSES, colorBadge, fmtMoney, fmtDate, fmtDateTime
} from '../api';
import { ApprovePreTenderModal, RejectApprovalModal } from './PreTenderApprovalModal';
import CostReportTable from './CostReportTable';

// Lazy-import markdown-рендерера — экономим на пустых заявках без отчёта.
const MarkdownView = lazy(() => import('./MarkdownView'));

// Lazy-import QuickMimirModal — модуль ~190 строк + цепочка api, тянем только при клике.
function openQuickMimir(modalApi, prefill, closeSelf) {
  import('@/pages/Tkp/modals/QuickMimirModal').then(({ QuickMimirModal }) => {
    closeSelf();
    modalApi.open(
      <QuickMimirModal
        prefill={prefill}
        onCreated={(tkpId) => {
          if (tkpId) window.location.hash = `#/tkp?id=${tkpId}`;
        }}
      />
    );
  }).catch((e) => {
    toast('ТКП', 'Не удалось загрузить модуль: ' + (e?.message || e), 'err');
  });
}

// Backend `pre_tenders.js:402` directorRoles + ADMIN — ровно те, кто может POST /accept
// при pending_approval и POST /reject-approval. Inline для rbac-audit.
const APPROVAL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

// Vanilla `pre_tenders.js:1043` — ровно эти роли видят кнопку «🧙 Быстрое ТКП».
const QUICK_TKP_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

/**
 * Секция «📎 Документы + drop-zone» (vanilla pre_tenders.js:996-1009 + 1116-1158).
 *
 * Поведение:
 *  • Список загруженных документов (manual_documents JSON + email_attachments).
 *  • Drop-zone (drag&drop + click): POST /upload-docs (multipart).
 *  • После успешной загрузки — auto-trigger /analyze в фоне + toast.
 *  • Через 8 секунд (vanilla — пользователь жмёт ручную кнопку, мы автоматизируем) — reload.
 */
function DocumentsSection({ pt, canEdit, onReload }) {
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const docs = [];
  // Email-вложения (read-only).
  for (const a of pt.email_attachments || []) {
    docs.push({
      key: `e-${a.id}`,
      filename: a.original_filename || a.filename,
      url: `/api/mailbox/attachments/${encodeURIComponent(a.id)}/download`,
      from: 'email',
      icon: '📧'
    });
  }
  // Ручные загрузки (manual_documents JSON).
  const manual = Array.isArray(pt.manual_documents) ? pt.manual_documents : [];
  for (let i = 0; i < manual.length; i++) {
    const d = manual[i];
    docs.push({
      key: `m-${i}`,
      filename: d.original_name || d.filename,
      url: `/api/files/download/${encodeURIComponent(d.filename || d.name)}`,
      from: 'manual',
      icon: '📎'
    });
  }

  const handleFiles = async (fileList) => {
    if (!fileList?.length) return;
    let arr;
    try {
      arr = validateFiles(fileList, {
        maxSize: MAX_ATTACHMENT_SIZE,
        accept: '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.txt'
      });
    } catch (e) {
      toast('Файл', String(e?.message || e), 'warn');
      return;
    }
    setUploading(true);
    try {
      const r = await uploadDocs(pt.id, arr);
      if (!r || r.error) throw new Error(r?.error || 'Не загружено');
      toast('Загружено', `${(r.uploaded || arr).length} файл(ов). Мимир анализирует…`, 'ok');
      // Перезагружаем список доков
      onReload?.();
      // Авто-перерасчёт — vanilla pre_tenders.js:1154 (ручная кнопка), у нас автоматически.
      setAnalyzing(true);
      try {
        await analyze(pt.id);
        toast('🧙 Анализ обновлён', 'Через несколько секунд отчёт перезагрузится', 'ok');
        // Vanilla: pre_tenders.js:1111 — hideModal + openDetail; у нас — просто reload карточки.
        setTimeout(() => { onReload?.(); }, 6000);
      } catch (e) {
        toast('Ошибка анализа', String(e?.message || e), 'err');
      } finally {
        setAnalyzing(false);
      }
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mt-14">
      <strong className="mini-kpi-label">📁 Документы ({docs.length})</strong>
      <div className="col gap-4 mt-6">
        {docs.length === 0 && (
          <div className="c-t3 fs-12-5">Документы пока не загружены.</div>
        )}
        {docs.map((d) => (
          <a
            key={d.key}
            href={d.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-8 bg-inner r-sm fs-12-5 u-no-decor c-t1"
          >
            {d.icon} {d.filename}
          </a>
        ))}

        {canEdit && (
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
            }}
            style={{
              display: 'block',
              marginTop: 8,
              padding: '18px 12px',
              border: `2px dashed ${drag ? 'var(--gold)' : 'var(--brd)'}`,
              borderRadius: 8,
              textAlign: 'center',
              cursor: uploading ? 'progress' : 'pointer',
              background: drag ? 'var(--gold-bg)' : 'transparent',
              transition: 'border-color .15s, background .15s'
            }}
          >
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.txt"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <div style={{ fontSize: 22, marginBottom: 4 }}>{uploading ? '⏳' : '📎'}</div>
            <div className="fs-12-5 c-t2">
              {uploading
                ? 'Загружаем…'
                : analyzing
                  ? '🧙 Мимир анализирует загруженное…'
                  : drag
                    ? 'Отпустите файлы здесь'
                    : 'Перетащите документы или нажмите для выбора'}
            </div>
            <div className="fs-11 c-t3 mt-4">pdf / doc / xls / jpg / png · до 25 МБ</div>
          </label>
        )}
      </div>
    </div>
  );
}

/**
 * Секция «📧 Оригинальное письмо» (vanilla pre_tenders.js:979).
 *
 * Поле:
 *  • from / subject / date
 *  • body превью с clamp (по умолчанию 5 строк → кнопка «развернуть»)
 *  • Кнопка «📬 Открыть в почте» → #/mailbox?email=ID
 */
function OriginalEmailSection({ pt }) {
  const [expanded, setExpanded] = useState(false);
  if (!pt.email_id) return null;
  const body = (pt.email_body_text || '').trim();
  const showToggle = body.split('\n').length > 5 || body.length > 800;
  return (
    <div className="mt-14">
      <strong className="mini-kpi-label">📧 Оригинальное письмо</strong>
      <div className="p-12 bg-inner r-md mt-6 fs-12-5">
        <div className="col gap-4 mb-8">
          <div><span className="c-t3">От:</span> <b>{pt.email_from_name || '—'}</b> &lt;{pt.email_from || '—'}&gt;</div>
          <div><span className="c-t3">Тема:</span> {pt.email_subject || '—'}</div>
          <div><span className="c-t3">Дата:</span> {fmtDateTime(pt.email_date)}</div>
        </div>
        <div
          className="u-prewrap"
          style={{
            borderTop: '1px solid var(--brd)',
            paddingTop: 8,
            maxHeight: expanded ? 600 : 130,
            overflowY: 'auto',
            transition: 'max-height .15s'
          }}
        >
          {body || '(пусто)'}
        </div>
        <div className="row-spread mt-8">
          {showToggle ? (
            <Btn size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '▲ Свернуть' : '▼ Развернуть'}
            </Btn>
          ) : <span />}
          <a
            href={`#/mailbox?email=${pt.email_id}`}
            className="m-btn ghost"
            style={{ textDecoration: 'none' }}
          >
            📬 Открыть в почте
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * Секция «💬 Цепочка переписки» (vanilla pre_tenders.js:1021).
 *
 * Один writer-msg на строку: дата, direction, отправитель, snippet, кнопка «развернуть».
 * Реальный body загружается отдельным GET в почте — у нас в превью только snippet.
 */
function ThreadSection({ pt }) {
  const [openIdx, setOpenIdx] = useState(-1);
  const thread = Array.isArray(pt.email_thread) ? pt.email_thread : [];
  if (thread.length <= 1) return null;
  return (
    <div className="mt-14">
      <strong className="mini-kpi-label">💬 Цепочка переписки ({thread.length})</strong>
      <div className="col gap-6 mt-6">
        {thread.map((t, i) => {
          const isIn = t.direction === 'inbound';
          return (
            <div
              key={t.id || i}
              className="p-8 bg-inner r-sm fs-12-5"
              style={{ borderLeft: `3px solid ${isIn ? 'var(--blue)' : 'var(--ok)'}` }}
            >
              <div className="row-spread">
                <div className="u-flex gap-6">
                  <span style={{ color: isIn ? 'var(--blue)' : 'var(--ok)' }}>
                    {isIn ? '← входящее' : '→ исходящее'}
                  </span>
                  <strong>{t.from_name || t.from_email || '—'}</strong>
                </div>
                <span className="c-t3">{fmtDate(t.email_date)}</span>
              </div>
              <div className="mt-4">
                <b>{t.subject || ''}</b>
              </div>
              {t.snippet && (
                <div
                  className="u-prewrap mt-4"
                  style={{ maxHeight: openIdx === i ? 320 : 60, overflow: 'hidden', color: 'var(--t-2)' }}
                >
                  {t.snippet}
                </div>
              )}
              {t.snippet && t.snippet.length > 120 && (
                <Btn size="sm" variant="ghost" onClick={() => setOpenIdx(openIdx === i ? -1 : i)}>
                  {openIdx === i ? '▲ Свернуть' : '▼ Развернуть'}
                </Btn>
              )}
              {pt.email_id && (
                <a
                  href={`#/mailbox?email=${t.id || pt.email_id}`}
                  className="m-btn ghost"
                  style={{ textDecoration: 'none', marginLeft: 6 }}
                >
                  📬 К письму
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Секция «🎯 Решение» (vanilla pre_tenders.js:1012-1018).
 *
 * Видна когда есть decision_by_name (или created_tender_id, или reject_reason).
 * Отображает кто/когда + комментарий + причину отказа + ссылку на тендер.
 */
function DecisionSection({ pt }) {
  if (!pt.decision_by_name && !pt.created_tender_id && !pt.reject_reason) return null;
  const isReject = pt.status === 'rejected';
  return (
    <div
      className="mt-14 p-12 r-md"
      style={{
        background: isReject ? 'var(--err-bg, rgba(239,68,68,.08))' : 'var(--ok-bg, rgba(34,197,94,.08))',
        border: `1px solid ${isReject ? 'var(--err)' : 'var(--ok)'}40`
      }}
    >
      <strong style={{ color: isReject ? 'var(--err)' : 'var(--ok)' }}>
        🎯 Решение: {isReject ? 'Отклонено' : 'Принято'}
      </strong>
      <div className="fs-12-5 mt-6 col gap-4">
        {pt.decision_by_name && (
          <div>
            <span className="c-t3">Решил:</span> <b>{pt.decision_by_name}</b>
            {pt.decision_at && <> · {fmtDateTime(pt.decision_at)}</>}
          </div>
        )}
        {pt.decision_comment && (
          <div><span className="c-t3">Комментарий:</span> {pt.decision_comment}</div>
        )}
        {pt.reject_reason && (
          <div><span className="c-t3">Причина отказа:</span> {pt.reject_reason}</div>
        )}
        {pt.created_tender_id && (
          <div className="mt-6">
            <a
              href={`#/tenders?open=${pt.created_tender_id}`}
              className="m-btn primary"
              style={{ textDecoration: 'none' }}
            >
              → Перейти к тендеру #{pt.created_tender_id}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function DetailModal({ id, onAccept, onFastTrack, onReject, onRequestDocs }) {
  const { user } = useAuth();
  const modalApi = useModal();
  const { close } = modalApi;
  const [pt, setPt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState({});

  const reload = () => loadDetail(id).then(setPt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [id]);

  if (!pt) {
    return (
      <MCard className="modal-lg">
        <MHead icon="📨" title="Загружаем…" onClose={close} />
        <MBody>⏳ Загружаем пред-тендер…</MBody>
      </MCard>
    );
  }

  const status = STATUSES.find((s) => s.value === pt.status) || { label: pt.status, tone: 'draft' };
  const color = colorBadge(pt.ai_color);
  const editable = !['accepted', 'rejected'].includes(pt.status);

  // Директорская ветка согласования: pending_approval + директор/ADMIN.
  // Vanilla pre_tenders.js:1190-1226 — кнопки «✓ Утвердить» / «✗ Отклонить согласование».
  const isPendingApproval = pt.status === 'pending_approval';
  const isApprover = user && APPROVAL_ROLES.includes(user.role);
  const showApprovalActions = isPendingApproval && isApprover;
  const canQuickTkp = user && QUICK_TKP_ROLES.includes(user.role) && pt.customer_inn;

  const openApprove = () => {
    modalApi.open(<ApprovePreTenderModal preTender={pt} onDone={() => reload()} />);
    close();
  };
  const openRejectApproval = () => {
    modalApi.open(<RejectApprovalModal preTender={pt} onDone={() => reload()} />);
    close();
  };

  const saveField = async (field) => {
    if (!edit[field] && edit[field] !== 0) return;
    if (edit[field] === pt[field]) return;
    try {
      await update(id, { [field]: edit[field] });
      setPt({ ...pt, [field]: edit[field] });
      setEdit((e) => ({ ...e, [field]: undefined }));
      toast('Сохранено', '', 'ok');
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const runAnalyze = async () => {
    setBusy(true);
    try {
      await analyze(id);
      toast('🧙 Анализ запущен', 'Через 5-10 секунд обнови', 'ok');
      setTimeout(reload, 3000);
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const runCostCalc = async () => {
    setBusy(true);
    try {
      await calcCost(id);
      toast('💰 Расчёт запущен', 'Мимир считает себестоимость', 'ok');
      setTimeout(reload, 3000);
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const runQuickTkp = () => {
    openQuickMimir(modalApi, {
      pre_tender_id: pt.id,
      customer_inn: pt.customer_inn || '',
      customer_name: pt.customer_name || '',
      tz_text: pt.work_description || '',
      contact_person: pt.contact_person || '',
      contact_phone: pt.contact_phone || '',
      customer_email: pt.customer_email || '',
      estimated_sum: pt.estimated_sum || null
    }, close);
  };

  const InlineField = ({ field, label, _type = 'text', component: Comp = TextInput, ...props }) => {
    const current = edit[field] !== undefined ? edit[field] : pt[field] || '';
    return (
      <Field label={label}>
        <Comp
          value={current}
          onChange={(v) => setEdit((e) => ({ ...e, [field]: v }))}
          onBlur={() => saveField(field)}
          disabled={!editable}
          {...props}
        />
      </Field>
    );
  };

  return (
    <MCard className="modal-xl">
      <MHead
        icon="📨"
        title={`Заявка #${pt.id}`}
        subtitle={pt.customer_name || pt.work_description || ''}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {/* Шапка-статусы */}
        <div className="row gap-10 u-wrap mb-14">
          <StatusBadge tone={status.tone} label={status.label} />
          <StatusBadge tone={color.tone} label={color.label} />
          {pt.ai_urgency && (
            <Pill tone={pt.ai_urgency === 'high' ? 'rejected' : pt.ai_urgency === 'medium' ? 'question' : 'draft'}>
              ⏱ Срочность: {pt.ai_urgency}
            </Pill>
          )}
          {pt.estimated_sum && <Pill tone="default">💰 {fmtMoney(pt.estimated_sum)}</Pill>}
          {pt.work_deadline && <Pill tone="default">📅 До {fmtDate(pt.work_deadline)}</Pill>}
        </div>

        {/* Информер директорской ветки утверждения */}
        {isPendingApproval && (
          <div
            className="mb-14 p-12 r-md"
            style={{
              background: 'var(--gold-bg)',
              border: '1px solid color-mix(in srgb, var(--gold) 35%, transparent)'
            }}
          >
            <strong style={{ color: 'var(--gold)' }}>🔔 На согласовании директора</strong>
            <div className="fs-12-5 c-t2 mt-4">
              {pt.approval_requested_at && (
                <>Запрошено: {fmtDateTime(pt.approval_requested_at)}.{' '}</>
              )}
              {pt.approval_comment && (
                <>Комментарий: «{pt.approval_comment}». </>
              )}
              {showApprovalActions
                ? 'Нажмите «✓ Утвердить» чтобы создать тендер из заявки, либо «✗ Отклонить согласование» с указанием причины.'
                : 'Ожидается решение руководства.'}
            </div>
          </div>
        )}

        <div className="grid-2 gap-16">
          {/* Заказчик */}
          <div>
            <strong className="mini-kpi-label">Заказчик</strong>
            <div className="col gap-8 mt-8">
              <InlineField field="customer_name" label="Название" />
              <InlineField field="customer_inn" label="ИНН" component={INNInput} />
              <InlineField field="customer_email" label="Email" />
              <InlineField field="contact_person" label="Контактное лицо" />
              <InlineField field="contact_phone" label="Телефон" component={PhoneInput} />
              <InlineField field="work_location" label="Место работы" />
            </div>
          </div>

          {/* Параметры */}
          <div>
            <strong className="mini-kpi-label">Параметры</strong>
            <div className="col gap-8 mt-8">
              <InlineField field="work_deadline" label="Дедлайн" component={DatePicker} />
              <InlineField field="estimated_sum" label="Оценка суммы" component={MoneyInput} />
              <InlineField field="work_description" label="Описание работы" component={TextareaInput} minRows={4} maxRows={8} />
            </div>
          </div>
        </div>

        {/* AI-отчёт (краткий) */}
        <div className="mt-18">
          <div className="row-spread mb-8">
            <strong className="fs-11 c-purple upper ls-1">🧙 AI-анализ</strong>
            <div className="u-flex gap-6">
              {editable && <Btn size="sm" variant="ghost" disabled={busy} onClick={runAnalyze}>🧙 Анализ</Btn>}
              {editable && <Btn size="sm" variant="ghost" disabled={busy} onClick={runCostCalc}>💰 Себестоимость</Btn>}
            </div>
          </div>
          <div className="p-12 bg-purple r-md" style={{ border: '1px solid color-mix(in srgb, var(--purple) 25%, transparent)' }}>
            {pt.ai_summary ? (
              <div className="u-prewrap fs-13">{pt.ai_summary}</div>
            ) : (
              <div className="c-t3 fs-12-5">AI ещё не анализировал. Нажми «🧙 Анализ» чтобы запустить.</div>
            )}

            {pt.ai_work_match_score != null && (
              <div className="mt-10 p-8 bg-card r-sm">
                <div className="row-spread fs-12">
                  <span className="c-t3">Соответствие профилю</span>
                  <strong>{pt.ai_work_match_score}/100</strong>
                </div>
                <div className="ov-hidden mt-4" style={{ height: 6, background: 'var(--inner-bg)', borderRadius: 3 }}>
                  <div style={{ height: '100%', width: `${pt.ai_work_match_score}%`, background: pt.ai_work_match_score >= 70 ? 'var(--ok)' : pt.ai_work_match_score >= 30 ? 'var(--amber)' : 'var(--err)' }} />
                </div>
              </div>
            )}

            {(pt.ai_required_specialists?.length > 0) && (
              <div className="mt-10">
                <span className="fs-11 c-t3 upper">Нужные специалисты: </span>
                {pt.ai_required_specialists.map((s, i) => (
                  <Pill key={i} tone="default">{s}</Pill>
                ))}
              </div>
            )}

            {(pt.ai_risk_factors?.length > 0) && (
              <div className="mt-6">
                <span className="fs-11 c-t3 upper">Риски: </span>
                {pt.ai_risk_factors.map((s, i) => (
                  <Pill key={i} tone="rejected">{s}</Pill>
                ))}
              </div>
            )}

            {pt.ai_cost_estimate && (
              <div className="mt-10 p-10 bg-card r-sm">
                <strong>💰 AI-расчёт себестоимости:</strong> {fmtMoney(pt.ai_cost_estimate)}
              </div>
            )}
          </div>
        </div>

        {/* 🧙 Полный анализ Мимира (markdown) */}
        <div className="mt-18">
          <div className="row-spread mb-8">
            <strong className="fs-11 c-gold upper ls-1">🧙 Полный анализ Мимира</strong>
          </div>
          <div
            className="p-12 r-md"
            style={{
              background: 'var(--inner-bg, rgba(255,255,255,0.02))',
              border: '1px solid var(--brd)',
              maxHeight: 480,
              overflowY: 'auto'
            }}
          >
            {pt.full_ai_report ? (
              <Suspense fallback={<div className="c-t3 fs-12-5">⏳ Загружаем рендерер markdown…</div>}>
                <MarkdownView
                  source={pt.full_ai_report}
                  style={{ fontSize: 13.5, lineHeight: 1.7 }}
                />
              </Suspense>
            ) : (
              <div className="c-t3 fs-12-5">
                Мимир ещё не закончил анализ. Нажми «🧙 Анализ» чтобы запустить (или «💰 Себестоимость» для подробного расчёта).
              </div>
            )}
          </div>
        </div>

        {/* 💰 Структурированный расчёт стоимости */}
        {pt.ai_cost_report && (
          <div className="mt-18">
            <div className="row-spread mb-8">
              <strong className="fs-11 c-gold upper ls-1">💰 Расчёт стоимости (Мимир)</strong>
            </div>
            <div
              className="p-12 r-md"
              style={{
                background: 'var(--inner-bg, rgba(255,255,255,0.02))',
                border: '1px solid var(--brd)'
              }}
            >
              <CostReportTable raw={pt.ai_cost_report} />
            </div>
          </div>
        )}

        {/* 📁 Документы + drop-zone */}
        <DocumentsSection pt={pt} canEdit={editable} onReload={reload} />

        {/* 📧 Оригинальное письмо */}
        <OriginalEmailSection pt={pt} />

        {/* 💬 Цепочка переписки */}
        <ThreadSection pt={pt} />

        {/* 🎯 Решение */}
        <DecisionSection pt={pt} />

        {/* 🧙 Быстрое ТКП через Мимира — кнопка-секция */}
        {canQuickTkp && (
          <div className="mt-14">
            <Btn block variant="primary" onClick={runQuickTkp}>
              🧙 Быстрое ТКП через Мимира
            </Btn>
            <div className="fs-11 c-t3 mt-4 u-tac">
              Мимир соберёт ТКП с предзаполнением: ИНН/название/предмет/контакты/бюджет.
            </div>
          </div>
        )}

        {/* Метаданные */}
        <div className="mt-18 fs-12 c-t3">
          📅 Создана: {fmtDateTime(pt.created_at)}
          {pt.email_received_at && <> · 📧 Письмо: {fmtDateTime(pt.email_received_at)}</>}
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Закрыть</Btn>
        {showApprovalActions ? (
          <div className="u-flex gap-6">
            <Btn variant="danger" onClick={openRejectApproval}>✗ Отклонить согласование</Btn>
            <Btn variant="primary" onClick={openApprove}>✓ Утвердить → создать тендер</Btn>
          </div>
        ) : editable && (
          <div className="u-flex gap-6">
            <Btn variant="ghost" onClick={() => { onRequestDocs?.(pt); close(); }}>📁 Документы</Btn>
            <Btn variant="ghost" onClick={() => { onReject?.(pt); close(); }}>✗ Отклонить</Btn>
            <Btn variant="ghost" onClick={() => { onAccept?.(pt); close(); }}>✓ Принять</Btn>
            <Btn variant="primary" onClick={() => { onFastTrack?.(pt); close(); }}>🚀 Быстрый путь</Btn>
          </div>
        )}
      </MFoot>
    </MCard>
  );
}
