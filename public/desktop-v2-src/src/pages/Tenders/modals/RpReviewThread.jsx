import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, FilePreviewModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { loadRpReviewMessages, postRpReviewMessage } from '../api';
import {
  threadFileSize, threadFileIcon, loadThreadFilePreview, loadLocalFilePreview
} from './rpReviewThreadHelpers';

function initials(name) {
  return String(name || '?').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
}

function fmtDt(s) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '';
}

function roleShort(role) {
  if (!role) return '';
  if (role === 'TO' || role === 'HEAD_TO') return 'ТО';
  if (['PM', 'HEAD_PM'].includes(role)) return 'РП';
  return role;
}

function isImageFile(mime, name) {
  const m = String(mime || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  return m.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(n);
}

function ThreadImageThumb({ tenderId, file, onPreview }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let revoke;
    let cancelled = false;
    loadThreadFilePreview(tenderId, file)
      .then((p) => {
        if (cancelled) {
          p.revoke?.();
          return;
        }
        if (p.mode === 'blob' && p.mime.startsWith('image/')) {
          setSrc(p.blobUrl);
          revoke = p.revoke;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      revoke?.();
    };
  }, [tenderId, file.id]);

  if (!src) return null;
  return (
    <button type="button" className="rp-thread-thumb" onClick={onPreview} title="Открыть изображение">
      <img src={src} alt={file.original_name || 'изображение'} />
    </button>
  );
}

function ThreadFileCard({ tenderId, file, onPreview }) {
  const name = file.original_name || 'файл';
  return (
    <div className="rp-thread-file-card">
      <div className="rp-thread-file-icon" aria-hidden="true">{threadFileIcon(file.mime_type, name)}</div>
      <div className="rp-thread-file-meta">
        <div className="rp-thread-file-name" title={name}>{name}</div>
        {file.size ? <div className="rp-thread-file-size muted">{threadFileSize(file.size)}</div> : null}
      </div>
      <button type="button" className="btn mini" onClick={onPreview}>Просмотр</button>
      <a className="btn mini ghost" href={file.download_url} target="_blank" rel="noreferrer" download>↓</a>
    </div>
  );
}

function PendingFileChip({ file, onPreview, onRemove }) {
  return (
    <div className="rp-thread-pending-file">
      <span className="rp-thread-pending-icon">{threadFileIcon(file.type, file.name)}</span>
      <span className="rp-thread-pending-name" title={file.name}>{file.name}</span>
      <button type="button" className="btn mini" onClick={onPreview}>Просмотр</button>
      <button type="button" className="btn mini ghost" onClick={onRemove} title="Убрать">✕</button>
    </div>
  );
}

export default function RpReviewThread({ tenderId, threadLocked = false }) {
  const { user } = useAuth();
  const modal = useModal();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const feedRef = useRef(null);
  const fileRef = useRef(null);

  const reload = useCallback(() => {
    if (!tenderId) return;
    setLoading(true);
    loadRpReviewMessages(tenderId)
      .then((d) => setMessages(d.messages || []))
      .catch((e) => toast('Чат', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  }, [tenderId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages]);

  const openPreviewModal = (title, payload) => {
    const onClose = payload.revoke;
    if (payload.mode === 'html') {
      modal.open(
        <FilePreviewModal
          title={title}
          htmlPreview={payload.html}
          downloadUrl={payload.downloadUrl}
          onClose={onClose}
        />,
        { size: 'wide' }
      );
      return;
    }
    modal.open(
      <FilePreviewModal
        title={title}
        fileUrl={payload.blobUrl}
        mime={payload.mime}
        downloadUrl={payload.downloadUrl}
        onClose={onClose}
      />,
      { size: 'wide' }
    );
  };

  const previewServerFile = async (file) => {
    const name = file.original_name || 'файл';
    try {
      const payload = await loadThreadFilePreview(tenderId, file);
      openPreviewModal(name, payload);
    } catch (e) {
      toast('Просмотр', String(e?.message || e), 'err');
    }
  };

  const previewLocalFile = (file) => {
    const payload = loadLocalFilePreview(file);
    openPreviewModal(file.name, payload);
  };

  const send = async () => {
    const t = text.trim();
    if (!t && !files.length) return;
    setSending(true);
    try {
      const res = await postRpReviewMessage(tenderId, t, files);
      if (res?.message) setMessages((m) => [...m, res.message]);
      setText('');
      setFiles([]);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      toast('Чат', String(e?.message || e), 'err');
    } finally {
      setSending(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const uid = Number(user?.id);

  return (
    <div className="rp-review-thread">
      <div className="rp-review-thread-head">
        <strong>Вопросы и ответы</strong>
        <span className="muted" style={{ fontSize: 12 }}>ТО и РП по этому тендеру · у каждого файла есть предпросмотр</span>
      </div>
      <div ref={feedRef} className="rp-review-thread-feed">
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : messages.length === 0 ? (
          <p className="muted">Пока нет сообщений — задайте вопрос или ответьте коллеге</p>
        ) : (
          messages.map((m) => {
            const mine = Number(m.user_id) === uid;
            return (
              <div key={m.id} className={'rp-thread-msg' + (mine ? ' mine' : '')}>
                <div className="rp-thread-msg-meta">
                  {!mine && <span className="rp-thread-avatar">{initials(m.user_name)}</span>}
                  <span className="rp-thread-author">{m.user_name || 'Пользователь'}</span>
                  <span className="pill mini muted">{roleShort(m.user_role)}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{fmtDt(m.created_at)}</span>
                </div>
                <div className="rp-thread-bubble">
                  {m.body ? <div className="rp-thread-text">{m.body}</div> : null}
                  {(m.files || []).length > 0 && (
                    <div className="rp-thread-files">
                      {(m.files || []).map((f) => (
                        <div key={f.id} className="rp-thread-file-wrap">
                          {isImageFile(f.mime_type, f.original_name) && (
                            <ThreadImageThumb
                              tenderId={tenderId}
                              file={f}
                              onPreview={() => previewServerFile(f)}
                            />
                          )}
                          <ThreadFileCard
                            tenderId={tenderId}
                            file={f}
                            onPreview={() => previewServerFile(f)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      {threadLocked ? (
        <div className="alert" style={{ marginTop: 12, fontSize: 13 }}>
          Чат закрыт — отчёт финализирован. История сообщений доступна только для просмотра.
        </div>
      ) : (
      <div className="rp-review-thread-form">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          style={{ display: 'none' }}
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
        <Btn variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
          Файл{files.length ? ` (${files.length})` : ''}
        </Btn>
        {files.length > 0 && (
          <div className="rp-thread-pending-list">
            {files.map((f, i) => (
              <PendingFileChip
                key={f.name + '-' + i}
                file={f}
                onPreview={() => previewLocalFile(f)}
                onRemove={() => setFiles((list) => list.filter((_, idx) => idx !== i))}
              />
            ))}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 200 }}>
          <TextareaInput
            value={text}
            onChange={setText}
            placeholder="Напишите вопрос или ответ…  Enter — отправить"
            minRows={2}
            maxRows={5}
            onKeyDown={onKey}
          />
        </div>
        <Btn variant="primary" disabled={sending || (!text.trim() && !files.length)} onClick={send}>
          {sending ? '…' : 'Отправить'}
        </Btn>
      </div>
      )}
    </div>
  );
}
