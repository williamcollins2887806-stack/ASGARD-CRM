/**
 * DocsPackModal — комплект документов работы.
 *
 * Источник vanilla: openDocsPack() в pm_works.js:49-147.
 * Vanilla кнопки:
 *   ─ dReq / dTKP / dCov   → AsgardTemplates.downloadRequest/TKP/Cover (blob-download)
 *   ─ aReq / aTKP / aCov   → AsgardDocsPack.addGeneratedHtml + перерисовка
 *   ─ packExport / Import  → JSON-снимок пакета документов
 *   ─ packAddLink          → вставка внешней URL-ссылки
 *
 * Backend v2 (REST):
 *   GET    /api/files?work_id=<id>  — список (src/routes/files.js)
 *   POST   /api/files/upload        — multipart-загрузка
 *   POST   /api/files               — добавление сгенерированного HTML / ссылки
 *   DELETE /api/files/:id           — удаление (owner/ADMIN)
 *   GET    /api/files/download/<filename> — скачивание
 *
 * Что реализовано полностью (D-55):
 *   ─ 6 кнопок-генераторов (dReq/dTKP/dCov + aReq/aTKP/aCov)
 *   ─ packExport — JSON-снимок пакета (skачивание)
 *   ─ packImport — загрузка JSON, восстановление ссылок и сгенерированных HTML
 *   ─ packAddLink — вставка внешней URL-ссылки (AddLinkModal)
 *   ─ Загрузка файла (form), удаление, копирование всех ссылок
 *
 * 0 хардкод-цветов в JSX. Все цвета через CSS-токены темы.
 */
import { useEffect, useState, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import { postMultipart, validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';
import {
  buildClientRequest, buildTKP, buildCoverLetter,
  downloadRequest, downloadTKP, downloadCover, downloadBlob
} from './templates';
import { AddLinkModal } from './AddLinkModal';

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

/**
 * Загрузить связанный тендер + последнюю смету (для шаблонов Запрос/ТКП/Сопров.).
 * Если у работы нет tender_id — возвращаем {tender:null, estimate:null}.
 */
async function loadTenderContext(work) {
  if (!work?.tender_id) return { tender: null, estimate: null };
  let tender = null;
  let estimate = null;
  try {
    const d = await api(`/api/tenders/${work.tender_id}`, { silent: true });
    tender = d?.tender || d?.item || d || null;
  } catch { /* tender 404 → шаблон с пустыми полями */ }
  try {
    const d = await api(`/api/estimates?tender_id=${work.tender_id}`, { silent: true });
    const list = d?.estimates || d?.items || [];
    if (list.length) {
      // Берём максимальную версию (vanilla pm_works.js:54).
      estimate = list.slice().sort((a, b) =>
        (Number(b.version_no || 0) - Number(a.version_no || 0)) || (Number(b.id || 0) - Number(a.id || 0))
      )[0];
    }
  } catch { /* нет смет — шаблон по тендеру */ }
  return { tender, estimate };
}

export function DocsPackModal({ work }) {
  const { close, open } = useModal();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadType, setUploadType] = useState('Документ');
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const inputRef = useRef(null);
  const importRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
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
      if (name.trim()) fd.append('name', name.trim());
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
      .map((d) => {
        const url = d.download_url || d.file_url;
        return url ? `${d.type || 'Документ'}: ${/^https?:/i.test(url) ? url : location.origin + url}` : '';
      })
      .filter(Boolean)
      .join('\n');
    if (!lines) { toast('Ссылки', 'Нет документов', 'warn'); return; }
    const ok = await copyText(lines);
    toast('Ссылки', ok ? 'Скопировано' : 'Не удалось скопировать', ok ? 'ok' : 'err');
  };

  // ── Скачивание сгенерированных шаблонов (dReq / dTKP / dCov) ──
  const downloadGen = async (kind) => {
    if (!work?.tender_id) {
      toast('Шаблон', 'У работы нет связанного тендера', 'err');
      return;
    }
    setGenBusy(true);
    try {
      const { tender, estimate } = await loadTenderContext(work);
      if (kind === 'req') await downloadRequest(tender, estimate);
      if (kind === 'tkp') await downloadTKP(tender, estimate);
      if (kind === 'cov') await downloadCover(tender, estimate);
      toast('Шаблон', 'Файл сформирован', 'ok');
    } catch (e) {
      toast('Шаблон', String(e?.message || e), 'err');
    } finally {
      setGenBusy(false);
    }
  };

  // ── Добавление сгенерированного HTML в комплект (aReq / aTKP / aCov) ──
  const addGenToPack = async (kind) => {
    if (!work?.tender_id) {
      toast('Шаблон', 'У работы нет связанного тендера', 'err');
      return;
    }
    setGenBusy(true);
    try {
      const { tender, estimate } = await loadTenderContext(work);
      let html = '';
      let type = 'Документ';
      let nm = '';
      if (kind === 'req') {
        html = await buildClientRequest({ tender, estimate });
        type = 'Запрос';
        nm = `Запрос_${tender?.id || work.id}.html`;
      }
      if (kind === 'tkp') {
        html = await buildTKP({ tender, estimate });
        type = 'ТКП';
        nm = `ТКП_${tender?.id || work.id}_v${estimate?.version_no || 1}.html`;
      }
      if (kind === 'cov') {
        html = await buildCoverLetter({ tender, estimate });
        type = 'Сопроводительное';
        nm = `Сопроводительное_${tender?.id || work.id}.html`;
      }
      // Заливаем как multipart, чтобы файл попал в /uploads и получил download_url.
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const fd = new FormData();
      fd.append('file', blob, nm);
      fd.append('work_id', String(work.id));
      fd.append('type', type);
      fd.append('name', nm);
      await postMultipart('/api/files/upload', fd);
      toast('Комплект', `«${type}» добавлен`, 'ok');
      await load();
    } catch (e) {
      toast('Комплект', String(e?.message || e), 'err');
    } finally {
      setGenBusy(false);
    }
  };

  // ── packExport: JSON-снимок пакета (vanilla AsgardDocsPack.downloadPackJson) ──
  const packExport = () => {
    if (!docs.length) { toast('Экспорт', 'Пакет пуст', 'warn'); return; }
    const payload = {
      pack_version: 1,
      exported_at: new Date().toISOString(),
      work_id: work.id,
      tender_id: work.tender_id || null,
      work_title: work.work_title || '',
      customer_name: work.customer_name || '',
      docs: docs.map((d) => ({
        id: d.id,
        type: d.type || 'Документ',
        name: d.original_name || d.filename || d.name || '',
        filename: d.filename || '',
        download_url: d.download_url || '',
        file_url: d.file_url || '',
        size: d.size || 0,
        created_at: d.created_at || null
      }))
    };
    const name = `ASGARD_Pack_${work.id}_${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(name, 'application/json;charset=utf-8', JSON.stringify(payload, null, 2));
    toast('Экспорт', 'Пакет выгружен', 'ok');
  };

  // ── packImport: загрузка JSON и восстановление ссылок ──
  const onImportFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const txt = await f.text();
      const payload = JSON.parse(txt);
      const list = Array.isArray(payload?.docs) ? payload.docs : [];
      if (!list.length) { toast('Импорт', 'В JSON нет документов', 'warn'); return; }
      let added = 0;
      let skipped = 0;
      for (const d of list) {
        const url = (d.file_url || d.download_url || '').trim();
        if (!url) { skipped++; continue; }
        try {
          // Импорт идёт только как ссылки (бинарь не вшит в JSON-снимок).
          await api('/api/files', {
            method: 'POST',
            body: {
              work_id: work.id,
              type: d.type || 'Документ',
              name: d.name || url,
              original_name: d.name || url,
              file_url: url
            }
          });
          added++;
        } catch { skipped++; }
      }
      toast('Импорт', `Добавлено: ${added}${skipped ? `, пропущено: ${skipped}` : ''}`, added ? 'ok' : 'warn');
      await load();
    } catch (err) {
      toast('Импорт', String(err?.message || err), 'err');
    }
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
          {/* ── Панель действий с пакетом (export/import/link) ── */}
          <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
            <Btn onClick={packExport} disabled={!docs.length} title="Скачать JSON-снимок пакета">
              ⬇ Экспорт JSON
            </Btn>
            <Btn onClick={() => importRef.current?.click()} title="Загрузить пакет из JSON">
              ⬆ Импорт JSON
            </Btn>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={onImportFile}
            />
            <Btn
              onClick={() => open(<AddLinkModal work={work} onAdded={load} />)}
              title="Добавить внешнюю ссылку в комплект"
            >
              🔗 + Ссылка
            </Btn>
            {work.purchase_url && (
              <a
                className="m-btn ghost"
                href={work.purchase_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none' }}
              >
                🌐 Открыть площадку
              </a>
            )}
          </div>

          {/* ── 6 кнопок-генераторов (Запрос / ТКП / Сопровод.) ── */}
          <div className="summary-box" style={{ padding: 12 }}>
            <strong className="summary-box-title">Шаблоны</strong>
            <div className="row gap-8" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              <Btn disabled={genBusy} onClick={() => downloadGen('req')}>📄 Скачать ЗАПРОС</Btn>
              <Btn disabled={genBusy} onClick={() => downloadGen('tkp')}>📄 Скачать ТКП</Btn>
              <Btn disabled={genBusy} onClick={() => downloadGen('cov')}>📄 Скачать СОПРОВ.</Btn>
              <Btn variant="primary" disabled={genBusy} onClick={() => addGenToPack('req')}>➕ Добавить ЗАПРОС в комплект</Btn>
              <Btn variant="primary" disabled={genBusy} onClick={() => addGenToPack('tkp')}>➕ Добавить ТКП в комплект</Btn>
              <Btn variant="primary" disabled={genBusy} onClick={() => addGenToPack('cov')}>➕ Добавить СОПРОВ. в комплект</Btn>
            </div>
            {!work?.tender_id && (
              <div className="help" style={{ marginTop: 6, fontSize: 11.5 }}>
                Шаблоны генерируются из данных тендера. У этой работы нет связанного тендера — кнопки шаблонов отдадут предупреждение.
              </div>
            )}
          </div>

          {/* ── Загрузка нового документа ── */}
          <div className="summary-box" style={{ padding: 12 }}>
            <strong className="summary-box-title">Добавить документ (файл)</strong>
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
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip,.rar,.7z,.txt,.csv,.html"
                  style={{ fontSize: 13 }}
                />
              </div>
              <Btn variant="primary" disabled={uploading} onClick={onUpload}>
                {uploading ? 'Загружаем…' : '⬆ Загрузить'}
              </Btn>
            </div>
            <div className="help" style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
              Лимит файла — 25 МБ. Допустимые форматы: pdf, doc, docx, xls, xlsx, jpg, png, zip, rar, 7z, txt, csv, html.
            </div>
          </div>

          {/* ── Список документов ── */}
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>В пакете · {docs.length}</strong>
            <Btn onClick={copyAll} disabled={!docs.length}>📋 Скопировать ссылки</Btn>
          </div>

          {loading ? (
            <div className="help">Загрузка…</div>
          ) : docs.length === 0 ? (
            <div className="help" style={{ padding: 12, opacity: 0.7 }}>
              Документов пока нет. Сгенерируй шаблон, добавь файл или вставь ссылку.
            </div>
          ) : (
            <div className="col gap-6">
              {docs.map((d) => {
                const url = d.download_url || d.file_url;
                const isExternal = url && /^https?:/i.test(url);
                return (
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
                      <strong style={{ fontSize: 13 }}>{d.original_name || d.filename || d.name || `#${d.id}`}</strong>
                      <span style={{ fontSize: 11, opacity: 0.65 }}>
                        {fmtDate(d.created_at)}{d.size ? ' · ' + fmtSize(d.size) : ''}
                      </span>
                    </div>
                    {url && (
                      <a
                        href={url}
                        target={isExternal ? '_blank' : undefined}
                        rel="noopener noreferrer"
                        download={isExternal ? undefined : true}
                        className="m-btn ghost"
                        style={{ textDecoration: 'none' }}
                      >
                        {isExternal ? '↗ Открыть' : '📥 Скачать'}
                      </a>
                    )}
                    <Btn onClick={() => onDelete(d.id)} title="Удалить документ (только владелец/ADMIN)">
                      🗑
                    </Btn>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </MBody>
      <MFoot align="end">
        <Btn onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
