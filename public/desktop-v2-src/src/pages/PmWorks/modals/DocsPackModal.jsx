/**
 * DocsPackModal — комплект документов работы.
 *
 * Источник vanilla: openDocsPack() в pm_works.js:49-147.
 *   Vanilla хранила документы в IndexedDB (AsgardDB.documents). Шаблоны
 *   Запрос/ТКП/Сопроводительное генерируются через AsgardTemplates (тоже
 *   client-side, без backend) — в v2 эти шаблоны НЕ перенесены.
 *
 * Backend в v2:
 *   GET    /api/files?work_id=<id>[&type=<>] — список документов (см. src/routes/files.js:357-364)
 *   POST   /api/files/upload (multipart)     — загрузка файла (src/routes/files.js:73-120)
 *   DELETE /api/files/:id                    — удаление (only owner/ADMIN)
 *   GET    /api/files/download/<filename>    — скачивание (auth)
 *
 * Что реализовано:
 *   ─ Список документов работы (тип, имя, дата, ссылка «Скачать»)
 *   ─ Загрузка нового файла с выбором типа (Запрос/ТКП/Сопроводительное/Другое)
 *   ─ Удаление (с гардом 403, если не владелец)
 *   ─ Копирование всех ссылок-скачиваний в буфер
 *
 * Что отложено (требует backend):
 *   ─ Генерация HTML-шаблонов Запрос/ТКП/Сопроводительное (AsgardTemplates не мигрирован).
 *     Скачивание этих шаблонов работает только в vanilla. Пометка стоит в UI.
 *   ─ Экспорт/импорт пакета (JSON) — vanilla формат AsgardDocsPack для IndexedDB,
 *     в v2 эквивалент не нужен (доки уже в postgres).
 */
import { useEffect, useState, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import { postMultipart, validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

const DOC_TYPES = [
  { value: 'Запрос',           label: 'Запрос заказчику' },
  { value: 'ТКП',              label: 'ТКП' },
  { value: 'Сопроводительное', label: 'Сопроводительное письмо' },
  { value: 'Договор',          label: 'Договор' },
  { value: 'ТЗ',               label: 'Техническое задание' },
  { value: 'Спецификация',     label: 'Спецификация' },
  { value: 'Документ',         label: 'Прочее' }
];

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function fmtSize(bytes) {
  const v = Number(bytes);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v < 1024) return v + ' Б';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' КБ';
  return (v / 1024 / 1024).toFixed(1) + ' МБ';
}

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}

export function DocsPackModal({ work }) {
  const { close } = useModal();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadType, setUploadType] = useState('Документ');
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      // GET /api/files?work_id=X — список (src/routes/files.js:357-364, поле `files`).
      const d = await api(`/api/files?work_id=${work.id}&limit=200`);
      const list = d?.files || d?.items || [];
      setDocs(list);
    } catch (e) {
      toast('Документы', String(e?.message || e), 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [work.id]);

  const onUpload = async () => {
    const file = inputRef.current?.files?.[0];
    if (!file) { toast('Файл', 'Выбери файл', 'warn'); return; }
    try {
      validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE });
    } catch (e) {
      toast('Файл', e.message, 'err'); return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('work_id', String(work.id));
      fd.append('type', uploadType);
      // POST /api/files/upload (src/routes/files.js:73-120). Бэк хранит original_name + filename.
      await postMultipart('/api/files/upload', fd);
      toast('Документ', `${file.name} загружен`, 'ok');
      if (inputRef.current) inputRef.current.value = '';
      setName('');
      await load();
    } catch (e) {
      toast('Загрузка', String(e?.message || e), 'err');
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id) => {
    if (!confirm('Удалить документ?')) return;
    try {
      await api(`/api/files/${id}`, { method: 'DELETE' });
      toast('Документ', 'Удалён', 'ok');
      setDocs((arr) => arr.filter((d) => d.id !== id));
    } catch (e) {
      toast('Удаление', String(e?.message || e), 'err');
    }
  };

  const copyAll = async () => {
    const lines = docs
      .filter((d) => d.download_url)
      .map((d) => `${d.type || 'Документ'}: ${location.origin}${d.download_url}`)
      .join('\n');
    if (!lines) { toast('Ссылки', 'Нет документов', 'warn'); return; }
    const ok = await copyText(lines);
    toast('Ссылки', ok ? 'Скопировано' : 'Не удалось скопировать', ok ? 'ok' : 'err');
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon="📁"
        title="Комплект документов"
        subtitle={`Работа #${work.id} · ${work.work_title || work.customer_name || ''}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-12">
          {/* Загрузка нового документа */}
          <div className="summary-box" style={{ padding: 12 }}>
            <strong className="summary-box-title">Добавить документ</strong>
            <div className="row gap-8" style={{ marginTop: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="Тип">
                <SelectInput value={uploadType} onChange={setUploadType} options={DOC_TYPES} />
              </Field>
              <Field label="Подпись (необязательно)">
                <TextInput value={name} onChange={setName} placeholder="Например: ТКП v2 финал" />
              </Field>
              <div className="col gap-4" style={{ minWidth: 220 }}>
                <label style={{ fontSize: 12, opacity: 0.7 }}>Файл</label>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip,.rar,.7z,.txt,.csv"
                  style={{ fontSize: 13 }}
                />
              </div>
              <Btn variant="primary" disabled={uploading} onClick={onUpload}>
                {uploading ? 'Загружаем…' : '⬆ Загрузить'}
              </Btn>
            </div>
            <div className="help" style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
              Лимит файла — 25 МБ. Допустимые форматы: pdf, doc, docx, xls, xlsx, jpg, png, zip, rar, 7z, txt, csv.
            </div>
          </div>

          {/* Список документов */}
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>В пакете · {docs.length}</strong>
            <Btn onClick={copyAll} disabled={!docs.length}>📋 Скопировать ссылки</Btn>
          </div>

          {loading ? (
            <div className="help">Загрузка…</div>
          ) : docs.length === 0 ? (
            <div className="help" style={{ padding: 12, opacity: 0.7 }}>
              Документов пока нет. Добавьте первый файл через форму выше.
            </div>
          ) : (
            <div className="col gap-6">
              {docs.map((d) => (
                <div key={d.id} className="row" style={{
                  padding: '10px 12px',
                  background: 'var(--bg-accent, rgba(120,140,180,.06))',
                  borderRadius: 8,
                  gap: 10,
                  alignItems: 'center',
                  flexWrap: 'wrap'
                }}>
                  <span style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'var(--brd, rgba(255,255,255,.08))',
                    fontWeight: 600
                  }}>
                    {d.type || 'Документ'}
                  </span>
                  <div className="col" style={{ flex: 1, minWidth: 200, lineHeight: 1.3 }}>
                    <strong style={{ fontSize: 13 }}>{d.original_name || d.filename || `#${d.id}`}</strong>
                    <span style={{ fontSize: 11, opacity: 0.65 }}>
                      {fmtDate(d.created_at)}{d.size ? ' · ' + fmtSize(d.size) : ''}
                    </span>
                  </div>
                  {d.download_url && (
                    <a
                      href={d.download_url}
                      target="_blank"
                      rel="noopener"
                      className="m-btn ghost"
                      style={{ textDecoration: 'none' }}
                    >
                      📥 Скачать
                    </a>
                  )}
                  <Btn onClick={() => onDelete(d.id)} title="Удалить документ (только владелец/ADMIN)">
                    🗑
                  </Btn>
                </div>
              ))}
            </div>
          )}

          {/* Заметка про шаблоны (vanilla AsgardTemplates не мигрирован) */}
          <div className="help" style={{
            padding: 10,
            background: 'rgba(212,168,67,.08)',
            borderRadius: 6,
            border: '1px solid rgba(212,168,67,.2)',
            fontSize: 11.5
          }}>
            <strong>ℹ Генератор шаблонов Запрос/ТКП/Сопроводительное</strong>
            <div style={{ marginTop: 4, opacity: 0.85 }}>
              Автоматическая генерация HTML-шаблонов из данных тендера (vanilla AsgardTemplates)
              пока не перенесена в v2. Готовые документы можно загрузить через форму выше.
            </div>
          </div>
        </div>
      </MBody>
      <MFoot align="end">
        <Btn onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
