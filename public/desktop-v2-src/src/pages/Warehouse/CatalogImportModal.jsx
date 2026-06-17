import { useState, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Select } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';
/**
 * Каталог-импорт (vanilla openCatalogImport + drawCiPreview).
 *
 * Поддержано:
 *   ✅ Excel  — POST /api/catalog-import/excel (multipart, exceljs на бэке)
 *   ✅ PDF    — pdf.js извлекает текст → POST /api/catalog-import/ai (AI-разбор)
 *   ✅ Фото   — Tesseract.js OCR rus+eng → POST /api/catalog-import/ai
 *   ✅ Предпросмотр + редактирование строк (имя/арт./qty/ед./цена/оборуд.)
 *   ✅ Применение POST /api/catalog-import/:id/apply с поставщиком
 *
 * КРУГ B: убран legacy-стуб «PDF/фото пока в legacy» — реализован полный
 *         перенос extractDocText() из warehouse-v2.js (pdf.js 3.11 + Tesseract.js 5.1).
 */

// Догрузка внешнего скрипта (pdf.js / Tesseract) с CDN. Идемпотентно: повторный вызов re-use.
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector('script[data-ci-lib="' + src + '"]')) return res();
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.dataset.ciLib = src;
    s.onload = () => res();
    s.onerror = () => rej(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
}

// Извлечение текста: PDF (pdf.js) или изображение (Tesseract.js OCR).
async function extractDocText(file, onProgress) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') {
    onProgress?.('Чтение PDF…');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    const pdfjs = window.pdfjsLib;
    if (!pdfjs) throw new Error('PDF-движок недоступен');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    let text = '';
    for (let p = 1; p <= Math.min(doc.numPages, 15); p++) {
      onProgress?.('Страница ' + p + '/' + doc.numPages + '…');
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      text += tc.items.map((i) => i.str).join(' ') + '\n';
    }
    if (text.replace(/\s/g, '').length < 30) {
      throw new Error('PDF без текста (скан). Сфотографируйте или приложите Excel.');
    }
    return text;
  }
  // image → OCR
  onProgress?.('Загрузка OCR…');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js');
  if (!window.Tesseract) throw new Error('OCR-движок недоступен');
  onProgress?.('Распознавание текста…');
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const out = await window.Tesseract.recognize(dataUrl, 'rus+eng');
  const text = (out && out.data && out.data.text) || '';
  if (text.replace(/\s/g, '').length < 10) throw new Error('Не удалось распознать текст на фото');
  return text;
}
export function CatalogImportModal({ onSaved }) {
  const { close } = useModal();
  const fileRef = useRef(null);
  const [docType, setDocType] = useState('invoice');
  const [supplier, setSupplier] = useState('');
  const [items, setItems] = useState([]);
  const [importId, setImportId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // G-5: размер/тип на клиенте до загрузки или OCR.
    try {
      validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.xlsx,.xls,.pdf,image/*' });
    } catch (vErr) {
      toast.error(vErr?.message || 'Файл не подходит'); return;
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    setBusy(true);
    try {
      if (ext === 'xlsx' || ext === 'xls') {
        setStatus('Разбор Excel…');
        const token = localStorage.getItem('asgard_token') || '';
        const form = new FormData();
        form.append('source_doc', docType);
        form.append('file', file);
        const r = await fetch('/api/catalog-import/excel', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          body: form
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || ('HTTP ' + r.status));
        setImportId(d.import?.id || null);
        setItems(d.items || []);
        setSupplier(d.import?.supplier_name || '');
        if (!(d.items || []).length) toast.warn('Позиции не найдены');
      } else if (ext === 'pdf' || /^(jpg|jpeg|png|webp|gif|bmp|heic)$/i.test(ext)) {
        // КРУГ B: полный перенос PDF/фото → текст → AI (vanilla warehouse-v2.js:1076-1095).
        const text = await extractDocText(file, setStatus);
        setStatus('AI разбирает документ…');
        const d = await api('/api/catalog-import/ai', {
          method: 'POST',
          body: { text, source_doc: docType }
        });
        if (d.ai_unavailable) {
          toast.warn(d.message || 'AI временно недоступен');
          return;
        }
        setImportId(d.import?.id || null);
        setItems(d.items || []);
        setSupplier(d.supplier || '');
        if (!(d.items || []).length) toast.warn('Позиции не найдены');
      } else {
        toast.warn('Поддерживаются: Excel (.xlsx/.xls), PDF, фото (jpg/png).');
      }
    } catch (err) {
      toast.error('Ошибка: ' + (err?.message || err));
    } finally {
      setBusy(false);
      setStatus('');
      e.target.value = '';
    }
  };

  const setRow = (i, k, v) => {
    setItems((arr) => {
      const next = arr.slice();
      next[i] = { ...next[i], [k]: v };
      return next;
    });
  };

  const removeRow = (i) => {
    setItems((arr) => arr.filter((_, idx) => idx !== i));
  };

  const apply = async () => {
    const list = items.filter((it) => it.name && String(it.name).trim());
    if (!list.length) return toast.warn('Нет позиций для добавления');
    setBusy(true);
    try {
      const d = await api('/api/catalog-import/' + importId + '/apply', {
        method: 'POST',
        body: { items: list, supplier_name: supplier || null }
      });
      toast.success(`В каталог: ${d.to_catalog || 0} · в оборудование: ${d.to_equipment || 0} · цен: ${d.prices || 0}`);
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="📄"
        title="Загрузить накладную / счёт / УПД"
        subtitle="Позиции из документа → в каталог расходников и оборудования + цены"
        accent="info"
        onClose={close}
      />
      <MBody>
        <div className="fs-13 c-t3 mb-12">
          Excel — разбирается сразу. PDF — извлекаем текст и шлём в AI. Фото — OCR (rus+eng) → AI.
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <Select value={docType} onChange={(e) => setDocType(e.target.value)} className="w-160">
            <option value="invoice">Счёт</option>
            <option value="upd">УПД</option>
            <option value="quote">КП</option>
            <option value="other">Накладная / другое</option>
          </Select>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf,image/*" className="u-hidden" onChange={onPickFile} />
          <Btn variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            📎 Выбрать файл
          </Btn>
          {status && <span className="fs-12 c-gold">{status}</span>}
        </div>

        {items.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <Field label="Поставщик (для цен)" help={`${items.length} позиций`}>
                <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Имя поставщика…" />
              </Field>
            </div>
            <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--brd-1)', borderRadius: 'var(--r-md)' }}>
              <table className="wh-table m-0" >
                <thead>
                  <tr>
                    <th>Наименование</th>
                    <th>Артикул</th>
                    <th>Кол-во</th>
                    <th>Ед.</th>
                    <th>Цена ₽</th>
                    <th title="Оборудование (поштучно в equipment)">Обор.</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          className="m-input min-w-180"
                          value={it.name || ''}
                          onChange={(e) => setRow(i, 'name', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="m-input w-100"
                          value={it.article || ''}
                          onChange={(e) => setRow(i, 'article', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="m-input w-80"
                          type="number"
                          step="any"
                          value={it.quantity != null ? it.quantity : ''}
                          onChange={(e) => setRow(i, 'quantity', e.target.value === '' ? null : parseFloat(e.target.value))}
                        />
                      </td>
                      <td>
                        <input
                          className="m-input w-60"
                          value={it.unit || 'шт'}
                          onChange={(e) => setRow(i, 'unit', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="m-input w-100"
                          type="number"
                          step="any"
                          value={it.unit_price != null ? it.unit_price : ''}
                          onChange={(e) => setRow(i, 'unit_price', e.target.value === '' ? null : parseFloat(e.target.value))}
                        />
                      </td>
                      <td className="t-center">
                        <input
                          type="checkbox"
                          checked={!!it.is_equipment}
                          onChange={(e) => setRow(i, 'is_equipment', e.target.checked)}
                        />
                      </td>
                      <td className="t-center">
                        <button className="tadm-icon-btn" onClick={() => removeRow(i)} title="Убрать">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        {items.length > 0 && (
          <Btn variant="primary" disabled={busy} onClick={apply}>
            {busy ? 'Применяем…' : `✅ Добавить в каталог (${items.length})`}
          </Btn>
        )}
      </MFoot>
    </MCard>
  );
}
