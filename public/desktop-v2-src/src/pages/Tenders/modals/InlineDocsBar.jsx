/**
 * Inline-загрузка документов и ссылок к УЖЕ СОЗДАННОМУ тендеру.
 * Источник: vanilla tenders.js — btnAddDoc / btnAddLink (вкладка «Документы» в карточке).
 * Backend:
 *   POST /api/files/upload (multipart с tender_id, type) — src/routes/files.js:73
 *   GET  /api/files?tender_id=:id — список (src/routes/files.js:303)
 *   DELETE /api/files/:id — soft-delete (src/routes/files.js:367)
 *   POST /api/data/documents — добавить ссылку как документ type='Ссылка'
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { ConfirmModal } from '@/modals';
import { Field, TextInput, FileDrop } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  uploadTenderFile, addTenderLink, loadTenderDocs, deleteTenderDoc
} from '../api';

function formatBytes(n) {
  if (!n) return '';
  if (n < 1024) return n + ' Б';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
  return (n / 1024 / 1024).toFixed(1) + ' МБ';
}

function docDownloadUrl(doc) {
  if (doc.file_url) return doc.file_url;
  if (doc.download_url) return doc.download_url;
  if (doc.filename) return `/api/files/download/${encodeURIComponent(doc.filename)}`;
  return '';
}

/* ─── Модалка добавления ссылки ─── */
function AddLinkModal({ tenderId, onAdded }) {
  const { close } = useModal();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const u = url.trim();
    if (!u) return toast('Ссылка', 'Укажите URL', 'warn');
    if (!/^https?:\/\//i.test(u)) return toast('Ссылка', 'URL должен начинаться с http(s)://', 'warn');
    setBusy(true);
    try {
      await addTenderLink(tenderId, name.trim() || u, u);
      toast('Ссылка', 'Добавлена', 'ok');
      onAdded?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="🔗" title="Добавить ссылку" />
      <MBody>
        <div className="col gap-12">
          <Field label="Название (необязательно)">
            <TextInput value={name} onChange={setName} placeholder="Тендерная площадка, ТЗ онлайн…" />
          </Field>
          <Field label="URL" required>
            <TextInput value={url} onChange={setUrl} placeholder="https://…" />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? '…' : '🔗 Добавить'}</Btn>
      </MFoot>
    </MCard>
  );
}

const MAX_FILE = 200 * 1024 * 1024; // 200MB — лимит uploads (см. multipart config)

export default function InlineDocsBar({ tenderId }) {
  const modal = useModal();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const reload = useCallback(() => {
    if (!tenderId) return;
    setLoading(true);
    loadTenderDocs(tenderId)
      .then(setDocs)
      .finally(() => setLoading(false));
  }, [tenderId]);

  useEffect(() => { reload(); }, [reload]);

  const onFiles = async (files) => {
    if (!files || !files.length) return;
    setBusy(true);
    let ok = 0, err = 0;
    for (const f of Array.from(files)) {
      if (f.size > MAX_FILE) {
        toast('Файл', `${f.name}: слишком большой (>200 МБ)`, 'err');
        err++; continue;
      }
      try {
        await uploadTenderFile(tenderId, f, 'Документ');
        ok++;
      } catch (e) {
        toast('Файл', `${f.name}: ${e?.message || e}`, 'err');
        err++;
      }
    }
    setBusy(false);
    if (ok) toast('Документы', `Загружено: ${ok}${err ? `, ошибок: ${err}` : ''}`, err ? 'warn' : 'ok');
    reload();
  };

  const askDelete = (d) => {
    modal.open(
      <ConfirmModal
        title="Удалить документ"
        message={`Удалить «${d.original_name || d.filename || d.name || '?'}» из тендера?`}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteTenderDoc(d.id);
            toast('Документ', 'Удалён', 'ok');
            reload();
          } catch (e) {
            toast('Ошибка', String(e?.message || e), 'err');
          }
        }}
      />
    );
  };

  const openLinkModal = () => modal.open(<AddLinkModal tenderId={tenderId} onAdded={reload} />);

  // Vanilla tenders.js:1906 — кнопка «📥 Скачать все» — открывает все доки в новых вкладках.
  const downloadAll = () => {
    if (!docs.length) return;
    let opened = 0;
    for (const d of docs) {
      const url = docDownloadUrl(d);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        opened++;
      }
    }
    if (opened > 0) toast('Документы', `Открыто ${opened} файл(ов) в новых вкладках`, 'ok');
    else toast('Документы', 'Нет ссылок для скачивания', 'warn');
  };

  // Vanilla tenders.js:1907 — «📋 Копировать ссылки» — копирует список URL в буфер.
  const copyAllLinks = async () => {
    if (!docs.length) return;
    const lines = docs
      .map((d) => {
        const label = d.original_name || d.filename || d.name || 'без названия';
        const url = docDownloadUrl(d);
        if (!url) return null;
        const fullUrl = url.startsWith('http') ? url : window.location.origin + url;
        return `${label} — ${fullUrl}`;
      })
      .filter(Boolean);
    if (!lines.length) return toast('Документы', 'Нет ссылок для копирования', 'warn');
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast('Документы', `Скопировано ${lines.length} ссылок`, 'ok');
    } catch (e) {
      toast('Документы', 'Не удалось скопировать: ' + (e?.message || e), 'err');
    }
  };

  return (
    <div className="tnd-docs-bar">
      <div className="tnd-docs-actions">
        <Btn size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? '⏳ Загружаем…' : '📎 Добавить файлы'}
        </Btn>
        <Btn size="sm" variant="ghost" onClick={openLinkModal}>🔗 Добавить ссылку</Btn>
        {/* Vanilla tenders.js:1906-1907 — кнопки «Скачать все» и «Копировать ссылки» */}
        {docs.length > 0 && (
          <>
            <Btn size="sm" variant="primary" onClick={downloadAll} title="Открыть все файлы в новых вкладках">📥 Скачать все</Btn>
            <Btn size="sm" variant="ghost" onClick={copyAllLinks} title="Скопировать список ссылок в буфер">📋 Копировать ссылки</Btn>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.jpg,.jpeg,.png,.txt,.csv,.xml"
          style={{ display: 'none' }}
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <FileDrop
        accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.jpg,.jpeg,.png,.txt,.csv,.xml"
        multiple
        hint="Перетащите файлы сюда — загрузка стартует автоматически"
        onFiles={onFiles}
      />

      {loading ? (
        <div className="tnd-docs-empty">⏳ Загружаем список…</div>
      ) : !docs.length ? (
        <div className="tnd-docs-empty">Документов и ссылок ещё нет.</div>
      ) : (
        <div className="tnd-docs-list">
          <div className="tnd-docs-head">Прикреплено · {docs.length}</div>
          {docs.map((d) => {
            const url = docDownloadUrl(d);
            const label = d.original_name || d.filename || d.name || 'без названия';
            const isLink = d.type === 'Ссылка' || d.mime_type === 'text/uri-list';
            return (
              <div key={d.id} className="tnd-docs-row">
                <div className="tnd-docs-name ellipsis">
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" title={label}>
                      {isLink ? '🔗' : '📄'} {label}
                    </a>
                  ) : (
                    <span>{isLink ? '🔗' : '📄'} {label}</span>
                  )}
                  {!isLink && d.size > 0 && (
                    <span className="tnd-docs-size">{formatBytes(d.size)}</span>
                  )}
                </div>
                <Btn size="sm" variant="ghost" onClick={() => askDelete(d)} title="Удалить">×</Btn>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
