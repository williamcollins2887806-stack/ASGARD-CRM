/**
 * Модалка загрузки счёта поставщика → авто-парсинг → fuzzy-матчинг → массово проставить цены.
 *
 * Источник: openInvoiceModal в vanilla procurement-page.js.
 *
 * Поддержка форматов:
 *   • Excel (.xlsx/.xls) — multipart → POST /:id/invoice/parse, сервер парсит через parseProcurementExcel
 *   • PDF — pdf.js (CDN) → текст → POST /:id/invoice/parse {text}, сервер шлёт в AI (routerai)
 *   • Фото (.jpg/.png) — Tesseract.js (CDN, рус+eng) → текст → POST /:id/invoice/parse {text}
 *
 * Сопоставление:
 *   Сервер возвращает {matches:[{item_id,invoice_name,unit_price,confidence}], unmatched:[...]},
 *   причём confidence: 1.0 — артикул, 0.95 — точное имя, 0.4-0.99 — pg_trgm similarity.
 *
 * Применение:
 *   Кнопка «✅ Применить цены» → POST /:id/invoice/:importId/apply с {rows: [{item_id, unit_price}], supplier_*, delivery_days}.
 *   Закупщик может вручную привязать unmatched строки к позициям заявки.
 */
import { useState, useEffect, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadSuppliers, parseInvoiceExcel, parseInvoiceText, applyInvoice
} from '../api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector('script[data-pi-lib="' + src + '"]')) return res();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.piLib = src;
    s.onload = () => res();
    s.onerror = () => rej(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
}

/** PDF → текст через pdf.js. До 15 страниц. */
async function extractPdfText(file, onProgress) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error('PDF-движок недоступен');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let text = '';
  for (let pp = 1; pp <= Math.min(doc.numPages, 15); pp++) {
    onProgress?.(`Стр ${pp}…`);
    const page = await doc.getPage(pp);
    const tc = await page.getTextContent();
    text += tc.items.map((i) => i.str).join(' ') + '\n';
  }
  if (text.replace(/\s/g, '').length < 30) throw new Error('PDF без текстового слоя — сфотографируйте');
  return text;
}

/** Фото → текст через Tesseract.js (рус+eng). */
async function extractImageText(file, onProgress) {
  onProgress?.('OCR…');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js');
  if (!window.Tesseract) throw new Error('OCR недоступен');
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const out = await window.Tesseract.recognize(dataUrl, 'rus+eng');
  return (out?.data?.text) || '';
}

/** Открыть модалку загрузки счёта (1:1 с vanilla openInvoiceModal). */
export function openInvoiceModal(open, procId, onDone) {
  open(<InvoiceImportModal procId={procId} onDone={onDone} />);
}
/** Алиас короткого имени (для соответствия vanilla `openInvoice`). */
export function InvoiceModal(props) { return <InvoiceImportModal {...props} />; }

function ConfidenceBadge({ value }) {
  const v = Number(value) || 0;
  if (v >= 0.8) return <span className="proc-kbadge proc-detail-itembadge--ok">{Math.round(v * 100)}%</span>;
  if (v >= 0.5) return <span className="proc-kbadge proc-kbadge--warn">{Math.round(v * 100)}%</span>;
  return <span className="proc-kbadge">{Math.round(v * 100)}%</span>;
}

export function InvoiceImportModal({ procId, onDone }) {
  const { close } = useModal();
  const fileRef = useRef(null);

  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [deliveryDays, setDeliveryDays] = useState('');

  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [parsedResult, setParsedResult] = useState(null); // {import_id, matches, unmatched, items_for_match, ...}
  const [linkAssign, setLinkAssign] = useState({});  // {invoiceRowIndex: item_id}
  const [priceOverride, setPriceOverride] = useState({}); // {invoiceRowIndex: price}

  useEffect(() => {
    loadSuppliers().then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  const supplierFinalName = () => {
    if (supplierName.trim()) return supplierName.trim();
    if (supplierId) {
      const s = suppliers.find((x) => String(x.id) === String(supplierId));
      return s?.name || '';
    }
    return '';
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // G-5: размер/тип счёта на клиенте.
    try {
      validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.xlsx,.xls,.pdf,image/*' });
    } catch (vErr) {
      toast.error(vErr?.message || 'Файл не подходит'); return;
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    setBusy(true);
    setAiUnavailable(false);
    setParsedResult(null);
    setLinkAssign({});
    setPriceOverride({});
    try {
      let d;
      if (ext === 'xlsx' || ext === 'xls') {
        setStatus('Разбор Excel…');
        d = await parseInvoiceExcel(procId, file, {
          supplierId: supplierId || null,
          supplierName: supplierFinalName(),
          deliveryDays: deliveryDays || null
        });
      } else if (ext === 'pdf') {
        setStatus('Распознавание PDF…');
        const text = await extractPdfText(file, setStatus);
        setStatus('Анализ AI…');
        d = await parseInvoiceText(procId, {
          text,
          supplierId: supplierId || null,
          supplierName: supplierFinalName(),
          deliveryDays: deliveryDays || null
        });
      } else {
        setStatus('Распознавание изображения…');
        const text = await extractImageText(file, setStatus);
        setStatus('Анализ AI…');
        d = await parseInvoiceText(procId, {
          text,
          supplierId: supplierId || null,
          supplierName: supplierFinalName(),
          deliveryDays: deliveryDays || null
        });
      }
      setStatus('');
      if (d.ai_unavailable) {
        setAiUnavailable(true);
        return;
      }
      setParsedResult(d);
      // префилл выбора привязки для matched строк
      const initLink = {};
      const initPrice = {};
      (d.matches || []).forEach((m, i) => {
        initLink[i] = String(m.item_id);
        if (m.unit_price != null) initPrice[i] = m.unit_price;
      });
      (d.unmatched || []).forEach((u, j) => {
        const idx = (d.matches?.length || 0) + j;
        initLink[idx] = '';
        if (u.unit_price != null) initPrice[idx] = u.unit_price;
      });
      setLinkAssign(initLink);
      setPriceOverride(initPrice);
    } catch (err) {
      setStatus('');
      toast.error(err?.message || 'Ошибка обработки файла');
    } finally {
      setBusy(false);
    }
  };

  const allRows = parsedResult
    ? [
        ...(parsedResult.matches || []).map((m, i) => ({ ...m, _idx: i, _isMatched: true })),
        ...(parsedResult.unmatched || []).map((u, j) => ({
          ...u,
          _idx: (parsedResult.matches?.length || 0) + j,
          _isMatched: false
        }))
      ]
    : [];

  const applyPrices = async () => {
    const rows = [];
    allRows.forEach((row) => {
      const itemId = linkAssign[row._idx];
      const price = parseFloat(priceOverride[row._idx]);
      if (itemId && price > 0) rows.push({ item_id: +itemId, unit_price: price });
    });
    if (!rows.length) { toast.warn('Нет строк с привязкой и положительной ценой'); return; }
    setBusy(true);
    try {
      const r = await applyInvoice(procId, parsedResult.import_id, {
        rows,
        supplierId: parsedResult.supplier_id || supplierId || null,
        supplierName: parsedResult.supplier_name || supplierFinalName() || null,
        deliveryDays: parsedResult.delivery_days != null ? parsedResult.delivery_days : (deliveryDays || null)
      });
      toast.success(`Цены проставлены: ${r.applied}`);
      onDone?.();
      close();
    } catch (e) { toast.error(e?.message || 'Ошибка'); setBusy(false); }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="🧾" title="Загрузить счёт поставщика" accent="gold" onClose={close} />
      <MBody>
        {/* Поставщик */}
        <div className="proc-inv-supplier-row">
          <label className="proc-inv-supplier-sel">
            <span className="proc-modal-label-sub">Поставщик</span>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="m-select proc-modal-input"
            >
              <option value="">— выберите/впишите —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="proc-inv-supplier-name">
            <span className="proc-modal-label-sub">или вписать</span>
            <input
              className="m-input proc-modal-input"
              placeholder="ООО ..."
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
            />
          </label>
          <label className="proc-inv-supplier-days">
            <span className="proc-modal-label-sub">Срок, дней</span>
            <input
              className="m-input proc-modal-input" type="number" min="0"
              placeholder="—"
              value={deliveryDays}
              onChange={(e) => setDeliveryDays(e.target.value)}
            />
          </label>
        </div>

        <div className="proc-inv-help">
          Excel — разбирается сразу. PDF/фото — текст распознаётся в браузере, затем разбирает AI.
          Столбцы: наименование · артикул · количество · цена.
        </div>

        {/* Кнопка выбора файла */}
        <div className="proc-inv-file-row">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.pdf,image/*"
            className="proc-inv-hidden-file"
            onChange={onFile}
          />
          <Btn variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            📎 Выбрать файл счёта
          </Btn>
          {status && <span className="proc-inv-status">{status}</span>}
        </div>

        {/* AI недоступен */}
        {aiUnavailable && (
          <div className="proc-inv-ai-down">
            🤖 AI временно недоступен. Попробуйте позже или загрузите Excel.
          </div>
        )}

        {/* Превью сопоставления */}
        {parsedResult && (
          <div className="proc-inv-preview">
            <div className="proc-inv-preview-title">
              Сопоставление ({parsedResult.matches?.length || 0} авто, {parsedResult.unmatched?.length || 0} вручную)
            </div>
            <div className="proc-inv-table-wrap">
              <table className="proc-items-table">
                <thead>
                  <tr>
                    <th>Строка счёта</th>
                    <th>%</th>
                    <th>Позиция заявки</th>
                    <th>Цена</th>
                  </tr>
                </thead>
                <tbody>
                  {allRows.length === 0 ? (
                    <tr><td colSpan={4} className="proc-inv-empty-row">
                      В счёте не найдено позиций
                    </td></tr>
                  ) : allRows.map((row) => (
                    <tr key={row._idx} className={!row._isMatched ? 'proc-row-new' : ''}>
                      <td>
                        {row.invoice_name}
                        {!row._isMatched && (
                          <span className="proc-kbadge proc-kbadge--warn proc-inv-mlbadge">не найдено</span>
                        )}
                      </td>
                      <td>{row._isMatched ? <ConfidenceBadge value={row.confidence} /> : '—'}</td>
                      <td>
                        <select
                          className="m-select proc-inv-link-sel"
                          value={linkAssign[row._idx] || ''}
                          onChange={(e) => setLinkAssign((s) => ({ ...s, [row._idx]: e.target.value }))}
                        >
                          <option value="">— не привязывать —</option>
                          {(parsedResult.items_for_match || []).map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name}{it.has_price ? ' ✓' : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number" min="0" step="any"
                          className="proc-items-table__input proc-inv-price-input"
                          value={priceOverride[row._idx] ?? ''}
                          onChange={(e) => setPriceOverride((s) => ({ ...s, [row._idx]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        {parsedResult && allRows.length > 0 && (
          <Btn variant="primary" disabled={busy} onClick={applyPrices}>
            ✅ Применить цены
          </Btn>
        )}
      </MFoot>
    </MCard>
  );
}
