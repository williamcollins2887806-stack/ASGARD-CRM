/**
 * EmailDetail — правая панель с детализацией письма + AI-блок заявки.
 * Источник vanilla: mailbox.js renderDetail() + handleAppAction() + handleDetailAction().
 *
 * Действия письма:
 *   - 📩 reply / reply_all / forward — открыть ComposeModal
 *   - ⭐ star / unstar  — PATCH /emails/:id  { is_starred }
 *   - 📦 archive       — PATCH /emails/:id  { is_archived: true }
 *   - 🗑 delete         — PATCH /emails/:id  { is_deleted: true } (через ConfirmModal)
 *
 * Действия заявки (если есть inbox_application):
 *   - ✅ accept     — POST /api/inbox-applications/:id/accept  (через ConfirmModal)
 *   - ❌ reject     — POST /reject (через PromptModal)
 *   - 👁 review     — POST /review
 *   - 🔄 reanalyze  — POST /analyze
 *   - 📦 archive    — POST /archive
 *   - ➕ Создать заявку из письма — POST /from-email
 */
import { useEffect, useRef, useState } from 'react';
import { useModal, ConfirmModal, PromptModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadEmailDetail, patchEmail, attachmentUrl,
  EMAIL_TYPES, AI_COLOR_MAP, AI_STATUS_MAP, AI_CLASS_MAP as _AI_CLASS_MAP,
  fmtEmailDate, fmtDateTime, fmtFileSize, parseEmailList, money,
  createApplicationFromEmail, acceptApplication, rejectApplication,
  reviewApplication, reanalyzeApplication, archiveApplication
} from './api';
import { ComposeModal } from './ComposeModal';
import { openProtected } from '@/api/download';

function fmtAddr(a) {
  if (!a) return '—';
  if (typeof a === 'string') return a;
  return a.name ? `${a.name} <${a.address || a.email || ''}>` : (a.address || a.email || '—');
}

function StatusPill({ tone, children }) {
  return (
    <span className={'mb-detail-type-pill tone-' + (tone || 't2')}>
      {children}
    </span>
  );
}

export function EmailDetailPanel({ emailId, onChanged }) {
  const { open } = useModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const bodyFrameRef = useRef(null);

  const reload = async () => {
    if (!emailId) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const d = await loadEmailDetail(emailId);
      setData(d);
      // Mark as read
      if (d?.email && !d.email.is_read) {
        try {
          await patchEmail(emailId, { is_read: true });
          onChanged?.();
        } catch { /* noop */ }
      }
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [emailId]);

  // Inject body HTML into sandboxed iframe (защита от XSS).
  useEffect(() => {
    const frame = bodyFrameRef.current;
    if (!frame || !data?.email) return;
    const e = data.email;
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = e.body_html
      || esc(e.body_text || '').replace(/\n/g, '<br>').replace(/ {2}/g, '&nbsp; ')
      || '<em style="color:#999">Пустое письмо</em>';
    const onLoad = () => {
      try {
        const doc = frame.contentDocument;
        doc.open();
        doc.write(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
          'body{margin:0;padding:16px;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#222;background:#fff}' +
          'img{max-width:100%}a{color:#1e6df0}' +
          '</style></head><body>' + html + '</body></html>'
        );
        doc.close();
        frame.style.height = (doc.body.scrollHeight + 40) + 'px';
      } catch { /* noop */ }
    };
    frame.addEventListener('load', onLoad);
    frame.src = 'about:blank';
    return () => frame.removeEventListener('load', onLoad);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.email?.id, data?.email?.body_html, data?.email?.body_text]);

  if (!emailId) {
    return (
      <div className="mb-detail-empty">
        <div className="fs-40 op-4">📭</div>
        <div>Выберите письмо для просмотра</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mb-detail-empty">
        ⏳ Загружаем письмо…
      </div>
    );
  }

  if (!data?.email) {
    return (
      <div className="mb-detail-empty">
        ❌ Письмо не найдено
      </div>
    );
  }

  const e = data.email;
  const att = data.attachments || [];
  const thread = data.thread || [];
  const app = data.application || null;
  const type = EMAIL_TYPES[e.email_type] || EMAIL_TYPES.unknown;
  const toList = parseEmailList(e.to_emails);
  const ccList = parseEmailList(e.cc_emails);
  const isInbound = e.direction === 'inbound';

  /* ── Действия с письмом ── */
  const toggleStar = async () => {
    try {
      await patchEmail(e.id, { is_starred: !e.is_starred });
      setData({ ...data, email: { ...e, is_starred: !e.is_starred } });
      onChanged?.();
    } catch (err) { toast.error(err?.message || String(err)); }
  };

  const archiveMail = () => {
    open(
      <ConfirmModal
        title="В архив?"
        message={`Письмо «${e.subject || 'без темы'}» будет перемещено в Архив.`}
        tone="warn"
        okText="📦 Архив"
        onConfirm={async () => {
          try {
            await patchEmail(e.id, { is_archived: true });
            toast.success('📦 Перенесено в архив');
            onChanged?.();
            setData(null);
          } catch (err) { toast.error(err?.message || String(err)); }
        }}
      />
    );
  };

  const deleteMail = () => {
    open(
      <ConfirmModal
        title="Удалить письмо?"
        message="Письмо переместится в Корзину. Из неё можно восстановить вручную."
        tone="danger"
        okText="🗑 Удалить"
        onConfirm={async () => {
          try {
            await patchEmail(e.id, { is_deleted: true });
            toast.success('Удалено');
            onChanged?.();
            setData(null);
          } catch (err) { toast.error(err?.message || String(err)); }
        }}
      />
    );
  };

  const openCompose = (mode) => open(<ComposeModal mode={mode} email={e} onSent={onChanged} />);

  /* ── AI действия заявки ── */
  const doAccept = () => {
    if (!app) return;
    open(
      <ConfirmModal
        title="Принять заявку?"
        message={`Будет создан тендер из заявки #${app.id}. Заказчику автоматически уйдёт письмо.`}
        tone="success"
        okText="✅ Принять"
        onConfirm={async () => {
          setActing(true);
          try {
            const r = await acceptApplication(app.id);
            if (r?.tender_id) toast.success(`Заявка принята · тендер №${r.tender_id} создан`);
            else toast.success('Заявка принята');
            await reload();
            onChanged?.();
          } catch (err) {
            toast.error(err?.message || String(err));
          } finally {
            setActing(false);
          }
        }}
      />
    );
  };

  const doReject = () => {
    if (!app) return;
    open(
      <PromptModal
        title="Отклонить заявку"
        message="Укажите причину отклонения — она уйдёт заказчику."
        placeholder="Не профильный запрос; нет компетенций; ..."
        multiline
        required
        onSubmit={async (reason) => {
          setActing(true);
          try {
            await rejectApplication(app.id, reason);
            toast.success('Заявка отклонена');
            await reload();
            onChanged?.();
          } catch (err) {
            toast.error(err?.message || String(err));
          } finally {
            setActing(false);
          }
        }}
      />
    );
  };

  const doReview = async () => {
    if (!app) return;
    setActing(true);
    try {
      await reviewApplication(app.id);
      toast.success('Взято на рассмотрение');
      await reload();
      onChanged?.();
    } catch (err) { toast.error(err?.message || String(err)); }
    finally { setActing(false); }
  };

  const doReanalyze = async () => {
    if (!app) return;
    setActing(true);
    try {
      await reanalyzeApplication(app.id);
      toast.success('AI-анализ завершён');
      await reload();
      onChanged?.();
    } catch (err) { toast.error(err?.message || String(err)); }
    finally { setActing(false); }
  };

  const doArchive = async () => {
    if (!app) return;
    setActing(true);
    try {
      await archiveApplication(app.id);
      toast.success('Заявка архивирована');
      await reload();
      onChanged?.();
    } catch (err) { toast.error(err?.message || String(err)); }
    finally { setActing(false); }
  };

  const doCreateApp = async () => {
    setActing(true);
    try {
      const r = await createApplicationFromEmail(e.id, true);
      if (r?.success) {
        toast.success('Заявка создана и проанализирована');
        await reload();
        onChanged?.();
      } else {
        toast.error(r?.error || 'Не удалось создать заявку');
      }
    } catch (err) { toast.error(err?.message || String(err)); }
    finally { setActing(false); }
  };

  /* ── Рендер AI секции ── */
  const renderAi = () => {
    if (app && app.ai_summary) {
      const col = AI_COLOR_MAP[app.ai_color] || AI_COLOR_MAP.yellow;
      const st = AI_STATUS_MAP[app.status] || AI_STATUS_MAP.new;
      const canDecide = ['new', 'ai_processed', 'under_review'].includes(app.status);
      const canReview = ['new', 'ai_processed'].includes(app.status);
      return (
        <div className="mb-ai-section">
          <div className="mb-ai-status-row">
            <StatusPill tone={st.tone}>{st.label}</StatusPill>
            <StatusPill tone={col.tone}>{col.icon} {col.label}</StatusPill>
            <span className="c-t3 fs-11">Заявка #{app.id}</span>
          </div>

          <div className={'mb-ai-block tone-' + col.tone}>
            <div className="title">🧠 AI Анализ</div>
            <div className="summary">{app.ai_summary}</div>
            <div className="meta">
              <b>Рекомендация:</b> {app.ai_recommendation || '—'}
              {app.ai_work_type && <><br /><b>Тип работ:</b> {app.ai_work_type}</>}
              {app.ai_estimated_budget && <><br /><b>Бюджет:</b> ~{money(app.ai_estimated_budget)}</>}
              {app.ai_estimated_days && <><br /><b>Срок:</b> ~{app.ai_estimated_days} дней</>}
              {Array.isArray(app.ai_keywords) && app.ai_keywords.length > 0 && (
                <><br /><b>Ключевые:</b> {app.ai_keywords.join(', ')}</>
              )}
              <br /><b>Уверенность:</b> {app.ai_confidence ? Math.round(app.ai_confidence * 100) + '%' : '—'}
              {app.ai_model && <><br /><b>Модель:</b> {app.ai_model}</>}
            </div>
          </div>

          {app.ai_report && (
            <details className="mb-ai-block" open>
              <summary className="cur-p fw-700 fs-13">AI-отчёт</summary>
              <div className="mt-8 fs-13 lh-15 c-t1 u-prewrap">
                {app.ai_report}
              </div>
            </details>
          )}

          {app.decision_by_name && (
            <div className="p-10 bg-inner r-sm fs-12 mb-12">
              <b>Решение:</b> {app.decision_by_name} · {fmtDateTime(app.decision_at)}
              {app.decision_notes && <><br />{app.decision_notes}</>}
              {app.rejection_reason && <><br /><b>Причина:</b> {app.rejection_reason}</>}
              {app.linked_tender_id && (
                <><br /><a href={`#/tenders?open=${app.linked_tender_id}`} className="c-gold">Тендер #{app.linked_tender_id} →</a></>
              )}
            </div>
          )}

          <div className="row gap-8 u-wrap pt-8 brd-2-t">
            {canDecide && (
              <>
                <Btn variant="primary" disabled={acting} onClick={doAccept}>✅ Принять</Btn>
                <Btn variant="ghost" disabled={acting} onClick={doReject}>❌ Отклонить</Btn>
              </>
            )}
            {canReview && (
              <Btn variant="ghost" disabled={acting} onClick={doReview}>👁 На рассмотрение</Btn>
            )}
            <Btn variant="ghost" disabled={acting} onClick={doReanalyze}>🔄 Переанализировать</Btn>
            {app.status !== 'archived' && (
              <Btn variant="ghost" disabled={acting} onClick={doArchive}>📦 В архив</Btn>
            )}
          </div>
        </div>
      );
    }

    if (app && !app.ai_summary) {
      return (
        <div className="mb-ai-section">
          <div className="mb-ai-empty">
            <div className="c-t3 fs-13 mb-8">
              AI-анализ не проводился (Заявка #{app.id})
            </div>
            <Btn variant="primary" disabled={acting} onClick={doReanalyze}>🧠 Запустить анализ</Btn>
          </div>
        </div>
      );
    }

    if (!app && isInbound) {
      return (
        <div className="mb-ai-section">
          <div className="mb-ai-empty">
            <div className="c-t3 fs-13 mb-8">
              Заявка не создана
            </div>
            <Btn variant="primary" disabled={acting} onClick={doCreateApp}>
              ➕ Создать заявку и запустить AI-анализ
            </Btn>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="mb-detail">
      <div className="mb-detail-header">
        <div className="mb-detail-actions">
          <Btn variant="primary" onClick={() => openCompose('reply')}>↩ Ответить</Btn>
          <Btn variant="ghost"   onClick={() => openCompose('reply_all')}>↩↩ Ответить всем</Btn>
          <Btn variant="ghost"   onClick={() => openCompose('forward')}>↪ Переслать</Btn>
          <div className="flex-1" />
          <Btn variant="ghost" onClick={toggleStar}>{e.is_starred ? '⭐ Убрать' : '☆ Избранное'}</Btn>
          <Btn variant="ghost" onClick={archiveMail}>📦 Архив</Btn>
          <Btn variant="ghost" onClick={deleteMail}>🗑 Удалить</Btn>
        </div>

        <div className="mb-detail-subj-row">
          <StatusPill tone={type.tone}>{type.icon} {type.name}</StatusPill>
          <h2 className="mb-detail-subj-h2">{e.subject || '(без темы)'}</h2>
        </div>

        <div className="mb-detail-meta">
          <div className="mb-detail-meta-row">
            <span className="lbl">📩 От:</span>
            <b>{e.from_name || ''} {e.from_email ? `<${e.from_email}>` : ''}</b>
            <span className="mb-detail-date c-t3 fs-12">
              {fmtDateTime(e.email_date || e.received_at)}
            </span>
          </div>
          <div className="mb-detail-meta-row">
            <span className="lbl">📨 Кому:</span>
            {toList.map(fmtAddr).join(', ') || '—'}
          </div>
          {ccList.length > 0 && (
            <div className="mb-detail-meta-row c-t3" >
              <span className="lbl">📋 Копия:</span>
              {ccList.map(fmtAddr).join(', ')}
            </div>
          )}
        </div>
      </div>

      {renderAi()}

      {/* Sandboxed iframe для HTML тела — защита от XSS */}
      <div className="mb-detail-body-wrap">
        <iframe
          ref={bodyFrameRef}
          sandbox="allow-same-origin"
          className="mb-detail-iframe"
          title="email-body"
        />
      </div>

      {att.length > 0 && (
        <div className="mb-attachments">
          <div className="mb-attachments-title">📎 Вложения ({att.length})</div>
          <div className="mb-attachments-list">
            {att.map((a) => (
              // G-5: blob-download через Authorization header (без `?token=` в URL).
              <button
                type="button"
                key={a.id}
                onClick={() =>
                  openProtected(attachmentUrl(a.id), a.original_filename || a.filename || `attach_${a.id}`)
                    .catch((err) => toast.error('Файл: ' + (err?.message || err)))
                }
                className="mb-attachment"
                style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }}
              >
                📄 {a.original_filename || a.filename}
                <span className="size">{fmtFileSize(a.size)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {thread.length > 0 && (
        <div className="mb-thread">
          <div className="mb-thread-title">🧵 Цепочка ({thread.length + 1} писем)</div>
          {thread.map((t) => (
            <div
              key={t.id}
              className="mb-thread-item"
              onClick={() => onChanged?.(t.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChanged?.(t.id); } }}
              role="button"
              tabIndex={0}
              aria-label={`Письмо: ${t.subject || 'без темы'}`}
            >
              <span>
                {t.direction === 'outbound' ? '→' : '←'}{' '}
                <b>{t.from_name || t.from_email || ''}</b>
                {' — '}
                {t.subject || ''}
              </span>
              <span className="c-t3">{fmtEmailDate(t.email_date)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
