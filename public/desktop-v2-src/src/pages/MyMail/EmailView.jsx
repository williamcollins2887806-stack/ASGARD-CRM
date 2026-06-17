/**
 * EmailView — открытое письмо (vanilla my_mail.js:568..743 selectEmail/render).
 *
 * Реализует:
 *  - header: subject, from/to/cc, date
 *  - body в sandboxed iframe (XSS protection — как vanilla:677)
 *  - INLINE-превью картинок (vanilla:601) — для image/* вложений <img> сразу под body
 *  - вложения: download через openAttachment
 *  - действия: ↩ Ответить / ⏩ Переслать / 🗑 Удалить / 🏷 В папку / ⭐ Звезда
 *  - сетования пустого выбора
 */
import { useEffect, useState } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadMessage, patchMessage, moveMessage, openAttachment,
  fmtFullDate, fmtFileSize, hashColor, avatarLetter
} from './api';

export function EmailView({
  messageId, folders,
  onChanged, onClose,
  onReply, onForward
}) {
  const modal = useModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showMove, setShowMove] = useState(false);

  useEffect(() => {
    if (!messageId) { setData(null); return; }
    setLoading(true);
    loadMessage(messageId)
      .then((d) => {
        setData(d);
        // Mark as read триггерим через onChanged (бэкенд уже выставил)
        onChanged?.();
      })
      .catch((e) => toast('Не удалось открыть письмо', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  if (!messageId) {
    return (
      <div className="mm-view mm-view--empty">
        <div className="mm-view__placeholder">
          <div className="mm-view__placeholder-ico" aria-hidden="true">✉</div>
          <div className="mm-view__placeholder-ttl">Выберите письмо</div>
          <div className="mm-view__placeholder-hint">
            <kbd>J</kbd>/<kbd>K</kbd> — листать, <kbd>R</kbd> — ответить, <kbd>F</kbd> — переслать
          </div>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="mm-view mm-view--empty">
        <div className="mm-view__placeholder">⏳ Загружаем…</div>
      </div>
    );
  }

  const e = data.email;
  const attachments = data.attachments || [];
  const inlineImgs = attachments.filter((a) =>
    /^image\//i.test(a.mime_type || '') ||
    /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(a.original_filename || a.filename || '')
  );
  const otherAtts = attachments.filter((a) => !inlineImgs.includes(a));

  const toList = (e.to_emails || []).map((t) => t?.address || t).filter(Boolean).join(', ');
  const ccList = (e.cc_emails || []).map((t) => t?.address || t).filter(Boolean).join(', ');

  const toggleStar = async () => {
    try {
      await patchMessage(e.id, { is_starred: !e.is_starred });
      setData({ ...data, email: { ...e, is_starred: !e.is_starred } });
      onChanged?.();
    } catch (err) { toast('Ошибка', String(err?.message || err), 'err'); }
  };

  const onDelete = () => {
    modal.open(<ConfirmModal
      title="Удалить письмо?"
      message="Письмо будет перемещено в Корзину"
      okText="🗑 Удалить"
      tone="danger"
      onConfirm={async () => {
        try {
          await patchMessage(e.id, { is_deleted: true });
          toast('Удалено', '', 'ok');
          onChanged?.();
          onClose?.();
        } catch (err) { toast('Ошибка', String(err?.message || err), 'err'); }
      }}
    />);
  };

  const doMove = async (folderId) => {
    setShowMove(false);
    try {
      await moveMessage(e.id, folderId);
      toast('Письмо перемещено', '', 'ok');
      onChanged?.();
      onClose?.();
    } catch (err) { toast('Ошибка', String(err?.message || err), 'err'); }
  };

  // Тело письма — собираем HTML, дополняем inline-картинки
  const bodyHtml = e.body_html || (e.body_text || '').replace(/\n/g, '<br>') || '<p style="color:#888">(пустое письмо)</p>';

  return (
    <div className="mm-view">
      <div className="mm-view__head">
        <div className="mm-view__subject">{e.subject || '(без темы)'}</div>
        <div className="mm-view__actions">
          <button type="button" className="mm-view__icon" onClick={toggleStar} title={e.is_starred ? 'Снять звезду' : 'Звезда'}>
            {e.is_starred ? '★' : '☆'}
          </button>
          <button type="button" className="mm-view__icon" onClick={() => onReply?.(e)} title="Ответить (R)">↩</button>
          <button type="button" className="mm-view__icon" onClick={() => onForward?.(e)} title="Переслать (F)">⏩</button>
          <div className="mm-view__menu-wrap">
            <button type="button" className="mm-view__icon" onClick={() => setShowMove((v) => !v)} title="В папку…">🏷</button>
            {showMove && (
              <div className="mm-view__menu" role="menu">
                {(folders || []).map((f) => (
                  <button key={f.id} type="button" className="mm-view__menu-item" onClick={() => doMove(f.id)}>
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="mm-view__icon mm-view__icon--danger" onClick={onDelete} title="Удалить (Del)">🗑</button>
          <button type="button" className="mm-view__icon" onClick={() => window.print()} title="Печать">🖨</button>
          <button type="button" className="mm-view__icon" onClick={onClose} title="Закрыть (Esc)">×</button>
        </div>
      </div>

      <div className="mm-view__meta">
        <span className="mm-avatar mm-avatar--md" style={{ background: hashColor(e.from_email) }}>
          {avatarLetter(e.from_name, e.from_email)}
        </span>
        <div className="mm-view__meta-info">
          <div className="mm-view__from">
            <strong>{e.from_name || e.from_email || '?'}</strong>
            {e.from_name && e.from_email && <span className="mm-view__from-email"> &lt;{e.from_email}&gt;</span>}
          </div>
          {toList && <div className="mm-view__to">Кому: {toList}</div>}
          {ccList && <div className="mm-view__to">Копия: {ccList}</div>}
        </div>
        <div className="mm-view__date">{fmtFullDate(e.email_date)}</div>
      </div>

      {otherAtts.length > 0 && (
        <div className="mm-view__attach">
          <div className="mm-view__attach-lbl">Вложения ({otherAtts.length})</div>
          <div className="mm-view__attach-list">
            {otherAtts.map((a) => (
              <button
                key={a.id}
                type="button"
                className="mm-view__attach-item"
                onClick={() => openAttachment(e.id, a.id, a.original_filename || a.filename).catch((err) => toast('Вложение', String(err?.message || err), 'err'))}
              >
                <span aria-hidden="true">📄</span>
                <span className="mm-view__attach-name">{a.original_filename || a.filename}</span>
                <span className="mm-view__attach-size">{fmtFileSize(a.size)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Body — sandboxed iframe (XSS protection) */}
      <iframe
        title="Тело письма"
        sandbox=""
        srcDoc={bodyHtml}
        className="mm-view__body"
      />

      {/* Inline-превью картинок — vanilla строка 601 */}
      {inlineImgs.length > 0 && (
        <div className="mm-view__inline">
          <div className="mm-view__inline-lbl">🖼 Изображения ({inlineImgs.length})</div>
          <div className="mm-view__inline-grid">
            {inlineImgs.map((a) => (
              <a
                key={a.id}
                className="mm-view__inline-item"
                href={`/api/my-mail/attachments/${a.id}/download`}
                target="_blank"
                rel="noreferrer"
                title={a.original_filename || a.filename}
              >
                <img
                  src={`/api/my-mail/attachments/${a.id}/download`}
                  alt={a.original_filename || a.filename || 'inline'}
                  loading="lazy"
                />
                <div className="mm-view__inline-caption">{a.original_filename || a.filename}</div>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mm-view__foot">
        <Btn variant="primary" onClick={() => onReply?.(e)}>↩ Ответить</Btn>
        <Btn variant="ghost" onClick={() => onForward?.(e)}>⏩ Переслать</Btn>
        <Btn variant="ghost" onClick={onDelete}>🗑 Удалить</Btn>
      </div>
    </div>
  );
}
