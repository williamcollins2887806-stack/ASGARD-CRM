/**
 * EmailPreview — превью разбора AI + полный текст письма + вложения.
 */
import { useEffect, useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { loadDetail, fmtDateTime, statusInfo, colorInfo, SOURCE_KINDS } from './api';

export default function EmailPreviewModal({ id, onChanged }) {
  const { close } = useModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    loadDetail(id)
      .then(setData)
      .catch((e) => toast.error('Не удалось открыть: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading || !data) {
    return (
      <MCard>
        <MHead title="Просмотр заявки" onClose={close} />
        <MBody><div className="c-t3 p-12">⏳ Загружаем…</div></MBody>
        <MFoot align="end"><Btn variant="ghost" onClick={close}>Закрыть</Btn></MFoot>
      </MCard>
    );
  }

  const it = data.item || data;
  const st = statusInfo(it.status);
  const col = colorInfo(it.ai_color);
  const sourceKindLabel = SOURCE_KINDS[it.source_kind] || it.source_kind || '—';

  return (
    <MCard className="lg">
      <MHead
        icon="📨"
        title={it.subject || '(без темы)'}
        subtitle={`Заявка №${it.id} · ${st.label} · ${col.label}`}
        onClose={close}
      />
      <MBody>
        <div className="card p-12 mb-12">
          <div className="row gap-12 u-wrap fs-12 c-t3">
            <span>👤 {it.source_name || '—'}</span>
            <span>· ✉ {it.source_email || '—'}</span>
            <span>· {sourceKindLabel}</span>
            <span>· 🕐 {fmtDateTime(it.created_at)}</span>
            {it.assigned_pm_id && <span>· 🎯 РП id={it.assigned_pm_id}</span>}
          </div>
          {it.forwarded_by_user_id && (
            <div className="mt-6 fs-12 c-t2">
              ↪ Переслано пользователем id={it.forwarded_by_user_id}
              {it.forwarded_from_email && <> ({it.forwarded_from_email})</>}
            </div>
          )}
          {it.original_sender_email && (
            <div className="mt-4 fs-12 c-t2">
              Оригинальный отправитель: {it.original_sender_name || ''} {it.original_sender_email}
            </div>
          )}
        </div>

        {it.ai_summary && (
          <div className="card p-12 mb-12" style={{ borderLeft: '3px solid var(--gold)' }}>
            <div className="fw-700 mb-6">🤖 Анализ МиМира</div>
            <div className="fs-13 c-t2 mb-6">{it.ai_summary}</div>
            <div className="row gap-12 u-wrap fs-11 c-t3">
              {it.ai_confidence != null && <span>Уверенность: {Math.round(it.ai_confidence * 100)}%</span>}
              {it.ai_recommendation && <span>· Рекомендация: {it.ai_recommendation}</span>}
              {/* 23.06.2026 BUG-FIX (🟡 D-14): см. index.jsx — strip jsonb-кавычек. */}
              {it.ai_classification && <span>· Тип: {String(it.ai_classification).replace(/^"|"$/g, '')}</span>}
              {it.estimated_budget && <span>· Бюджет: {it.estimated_budget}</span>}
              {it.estimated_days != null && <span>· Срок: {it.estimated_days} дн.</span>}
            </div>
            {it.ai_keywords && (
              <div className="mt-6 row gap-4 u-wrap">
                {String(it.ai_keywords).split(/[,;]/).filter(Boolean).slice(0, 8).map((k, i) => (
                  <span key={i} className="m-pill default fs-11">{k.trim()}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="fw-700 mb-6 fs-13">Текст письма</div>
        <div className="card p-12 mb-12" style={{ maxHeight: 380, overflowY: 'auto' }}>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: 'var(--t-2)', margin: 0 }}>
            {it.email_body_text || it.body_preview || '— (текст недоступен)'}
          </pre>
        </div>

        {Array.isArray(data.attachments) && data.attachments.length > 0 && (
          <>
            <div className="fw-700 mb-6 fs-13">Вложения ({data.attachments.length})</div>
            <div className="col gap-4">
              {data.attachments.map((a) => (
                <a
                  key={a.id}
                  className="row-spread gap-8 p-6"
                  style={{ background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)', textDecoration: 'none', color: 'var(--info)' }}
                  href={a.file_path || `/api/files/download/${a.filename}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={a.original_filename || a.filename}
                >
                  <span>📎 {a.original_filename || a.filename}</span>
                  <span className="fs-11 c-t3">{Math.round((a.size || 0) / 1024)} KB</span>
                </a>
              ))}
            </div>
          </>
        )}
      </MBody>
      <MFoot align="end">
        <Btn variant="ghost" onClick={() => { onChanged?.(); close(); }}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
