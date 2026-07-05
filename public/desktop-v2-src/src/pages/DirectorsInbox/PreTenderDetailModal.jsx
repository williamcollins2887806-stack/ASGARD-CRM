/**
 * PreTenderDetailModal — просмотр pre_tender для директора/РП.
 * Вкладки: Суть · Письмо · AI · Документы
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { StatusBadge } from '@/modals/Notifications';
import { api } from '@/api/client';
import { colorInfo, fmtDate, fmtDateTime } from './api';
import EmailPreviewModal from './EmailPreview';
import { FilePreviewModal } from '@/modals/FilePreview';

const TABS = [
  { id: 'summary', label: 'Суть' },
  { id: 'email', label: 'Письмо' },
  { id: 'ai', label: 'AI' },
  { id: 'docs', label: 'Документы' }
];

function fmtMoney(n) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('ru-RU') + ' ₽' : '—';
}

export default function PreTenderDetailModal({ item, onChanged }) {
  const { close, open } = useModal();
  const [tab, setTab] = useState('summary');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const ptId = item?.id;

  useEffect(() => {
    if (!ptId) return;
    setLoading(true);
    api(`/api/pre-tenders/${ptId}`)
      .then((d) => setDetail(d?.item || d || item))
      .catch(() => setDetail(item))
      .finally(() => setLoading(false));
  }, [ptId]);

  const d = detail || item || {};
  const col = colorInfo(d.ai_color);

  const openDoc = (url, name, mime) => {
    open(
      <FilePreviewModal
        title={name || 'Документ'}
        fileUrl={url}
        mime={mime || ''}
        downloadUrl={url}
      />,
      { size: 'xl' }
    );
  };

  const token = (() => { try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; } })();
  const tokenQs = token ? `?token=${encodeURIComponent(token)}` : '';

  return (
    <MCard>
      <MHead
        icon="🗂"
        title={d.customer_name || d.work_description?.slice(0, 80) || `Заявка #${ptId}`}
        subtitle={`Pre-tender #${ptId} · ${fmtDateTime(d.created_at)}`}
        accent="info"
        onClose={close}
      />
      <MBody>
        <div className="row gap-6 u-wrap mb-12">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={'pk-tab' + (tab === t.id ? ' is-active' : '')}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="c-t3">Загрузка…</div>
        ) : tab === 'summary' ? (
          <div className="col gap-10 fs-13">
            <div className="row gap-8 u-wrap">
              <StatusBadge tone={col.tone} label={col.label} />
              {d.status && <span className="c-t3">Статус: <b>{d.status}</b></span>}
            </div>
            <div><b>Заказчик:</b> {d.customer_name || '—'}</div>
            {d.customer_inn && <div><b>ИНН:</b> {d.customer_inn}</div>}
            {d.contact_person && <div><b>Контакт:</b> {d.contact_person}{d.contact_phone ? ` · ${d.contact_phone}` : ''}</div>}
            {d.customer_email && <div><b>Email:</b> {d.customer_email}</div>}
            <div><b>Описание работ:</b><div className="c-t2 mt-4">{d.work_description || '—'}</div></div>
            <div className="row gap-16 u-wrap">
              {d.estimated_sum != null && <span><b>Бюджет/НМЦ:</b> {fmtMoney(d.estimated_sum)}</span>}
              {d.work_deadline && <span><b>Дедлайн КП:</b> {fmtDate(d.work_deadline)}</span>}
            </div>
            {(d.assigned_to_name || d.assigned_to) && (
              <div style={{ padding: '8px 12px', background: 'var(--ok-bg)', borderRadius: 8 }}>
                🎯 Назначен: <b>{d.assigned_to_name || `#${d.assigned_to}`}</b>
              </div>
            )}
            {!d.assigned_to && <div className="c-t3">Свободна в маркетплейсе</div>}
            {d.ai_summary && (
              <div style={{ padding: '10px 12px', background: 'var(--inner-bg)', borderRadius: 8 }}>
                🤖 {d.ai_summary}
              </div>
            )}
          </div>
        ) : tab === 'email' ? (
          <div>
            {d.email_id ? (
              <Btn variant="primary" onClick={() => open(<EmailPreviewModal id={d.email_id} onChanged={onChanged} />, { size: 'lg' })}>
                📧 Открыть полное письмо
              </Btn>
            ) : (
              <div className="c-t3">Нет связанного письма</div>
            )}
          </div>
        ) : tab === 'ai' ? (
          <div className="col gap-8 fs-13">
            {d.ai_classification && <div><b>Классификация:</b> {String(d.ai_classification).replace(/^"|"$/g, '')}</div>}
            {d.ai_confidence != null && <div><b>Уверенность:</b> {Math.round(d.ai_confidence * 100)}%</div>}
            {d.ai_recommendation && <div><b>Рекомендация:</b><div className="c-t2 mt-4">{d.ai_recommendation}</div></div>}
            {!d.ai_classification && !d.ai_summary && <div className="c-t3">AI-разбор отсутствует</div>}
          </div>
        ) : (
          <div className="col gap-8">
            {(d.email_attachments || []).map((att) => {
              const url = `/api/pre-tenders/${ptId}/email-attachments/${att.id}/download${tokenQs}`;
              return (
                <div key={att.id} className="row-spread gap-8" style={{ padding: '8px 0', borderBottom: '1px solid var(--brd-1)' }}>
                  <span>📎 {att.original_filename || att.filename}</span>
                  <Btn variant="ghost" onClick={() => openDoc(url, att.original_filename, att.mime_type)}>Просмотр</Btn>
                </div>
              );
            })}
            {(d.manual_documents || []).map((doc, idx) => {
              const url = `/api/pre-tenders/${ptId}/documents/${idx}/download${tokenQs}`;
              return (
                <div key={idx} className="row-spread gap-8" style={{ padding: '8px 0', borderBottom: '1px solid var(--brd-1)' }}>
                  <span>📄 {doc.name || doc.filename || `файл #${idx}`}</span>
                  <Btn variant="ghost" onClick={() => openDoc(url, doc.name, doc.mime)}>Просмотр</Btn>
                </div>
              );
            })}
            {!(d.email_attachments || []).length && !(d.manual_documents || []).length && (
              <div className="c-t3">Документов нет</div>
            )}
          </div>
        )}
      </MBody>
      <MFoot align="right">
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
