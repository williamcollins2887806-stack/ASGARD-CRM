/**
 * ReceiptScannerModal — сканер чеков (Vanilla эталон: public/assets/js/receipt_scanner.js → AsgardReceiptScanner).
 *
 * D-66 / batch D-vol7.
 *
 * Что делает:
 *   1. Загрузка файла чека (image/* или PDF).
 *   2. Превью + кнопка «Распознать».
 *   3. По клику — dynamic import('tesseract.js') (~10 МБ модель), Tesseract.recognize(file,'rus+eng').
 *   4. Прогресс-бар (Tesseract отдаёт onProgress через logger).
 *   5. Парсинг текста простыми regex: amount (₽/итого/всего), date (DD.MM.YYYY), supplier (первая
 *      непустая ВЕРХНЯЯ строка чека).
 *   6. Editable inputs (распознанное можно поправить).
 *   7. Кнопка «Создать расход» → POST /api/expenses/parse-receipt (если нет — fallback /api/expenses/work
 *      с базовыми полями: work_id, amount, date, supplier, category='other').
 *
 * Tesseract.js — большая зависимость → ТОЛЬКО dynamic import (не раздуваем основной bundle).
 *
 * Props:
 *   onParsed(data) — callback после успешного создания расхода. data = { expense, parsed }.
 *   workId         — опц., если открыто из карточки работы.
 *   defaultCategory— опц., по умолчанию 'other'.
 */
import { useState, useRef, useEffect } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, MoneyInput, SelectInput } from '@/inputs/Inputs';
import { api } from '@/api/client';

const CATEGORIES = [
  { value: 'logistics',     label: '🚚 Логистика' },
  { value: 'accommodation', label: '🏨 Проживание' },
  { value: 'transfer',      label: '🚕 Трансфер' },
  { value: 'chemicals',     label: '🧪 Химия' },
  { value: 'equipment',     label: '🔧 Оборудование' },
  { value: 'other',         label: '📦 Прочее' },
];

// ─── Парсинг распознанного OCR-текста ─────────────────────────────────────────
const RX = {
  amount: [
    /итого[:\s]*([\d\s.,]+)/i,
    /всего[:\s]*([\d\s.,]+)/i,
    /к\s*оплате[:\s]*([\d\s.,]+)/i,
    /сумма[:\s]*([\d\s.,]+)/i,
    /total[:\s]*([\d\s.,]+)/i,
    /([\d\s.,]+)\s*(?:руб|₽|rub)/i,
    /\b(\d+[.,]\d{2})\b/,
  ],
  date: [
    /\b(\d{2}[./-]\d{2}[./-]\d{2,4})\b/,
    /\b(\d{4}[./-]\d{2}[./-]\d{2})\b/,
  ],
};

function parseAmount(text) {
  for (const rx of RX.amount) {
    const m = text.match(rx);
    if (m) {
      const v = parseFloat(String(m[1]).replace(/\s/g, '').replace(',', '.'));
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

function parseDate(text) {
  for (const rx of RX.date) {
    const m = text.match(rx);
    if (!m) continue;
    const parts = m[1].split(/[./-]/);
    if (parts.length !== 3) continue;
    let [a, b, c] = parts;
    // Если первая часть 4-значная — это год (YYYY-MM-DD).
    if (a.length === 4) return `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
    // Иначе DD.MM.YY[YY] (русский формат чека).
    if (c.length === 2) c = '20' + c;
    return `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
  }
  return new Date().toISOString().slice(0, 10);
}

function parseSupplier(text) {
  // Первая непустая строка (название магазина / ООО / ИП).
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.length >= 3 && /[А-ЯЁA-Z]/.test(line)) return line.replace(/^"|"$/g, '').slice(0, 120);
  }
  return '';
}

export default function ReceiptScannerModal({ onParsed, workId = null, defaultCategory = 'other' }) {
  const { close } = useModal();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState(''); // '' | 'recognizing' | 'parsed' | 'saving'
  const [rawText, setRawText] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplier, setSupplier] = useState('');
  const [category, setCategory] = useState(defaultCategory);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  // Освобождаем blob-URL после анмонта.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setStage('');
    setProgress(0);
    setRawText('');
  };

  // ─── Распознать (ленивая загрузка ~10 МБ модели) ───────────────────────────
  const onRecognize = async () => {
    if (!file) { toast.warn('Сначала выберите файл чека'); return; }
    if (file.type === 'application/pdf') {
      toast.warn('PDF-чеки пока не поддерживаются — сделайте скриншот (PNG/JPG)');
      return;
    }
    setStage('recognizing');
    setProgress(0);
    try {
      // Dynamic import — Tesseract не попадает в основной bundle.
      const tesseract = await import('tesseract.js');
      const Tesseract = tesseract.default || tesseract;
      const result = await Tesseract.recognize(file, 'rus+eng', {
        logger: (m) => {
          if (m && typeof m.progress === 'number' && m.status === 'recognizing text') {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });
      const text = result?.data?.text || '';
      setRawText(text);
      const a = parseAmount(text);
      if (a) setAmount(String(a));
      const d = parseDate(text);
      if (d) setDate(d);
      const s = parseSupplier(text);
      if (s && !supplier) setSupplier(s);
      setStage('parsed');
      toast.success('Чек распознан — проверьте поля и сохраните');
    } catch (e) {
      console.error('[ReceiptScanner] OCR error', e);
      toast.error('Не удалось распознать чек: ' + (e?.message || e));
      setStage('');
    }
  };

  // ─── Создать расход ────────────────────────────────────────────────────────
  const onSave = async () => {
    const amt = parseFloat(String(amount).replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) { toast.warn('Укажите сумму больше 0'); return; }
    setBusy(true);
    setStage('saving');
    const payload = {
      work_id: workId ? Number(workId) : null,
      category,
      amount: amt,
      date,
      supplier: supplier.trim() || null,
      comment: comment.trim() || (supplier ? `Чек: ${supplier.trim()}` : 'Чек'),
      raw_text: rawText || null,
    };
    try {
      // Сначала пытаемся специализированный endpoint (если есть на бэке).
      let res = null;
      let usedFallback = false;
      try {
        res = await api('/api/expenses/parse-receipt', { method: 'POST', body: payload, silent: true });
      } catch (e) {
        if (e?.status === 404 || e?.status === 405) usedFallback = true;
        else throw e;
      }
      if (usedFallback) {
        // Fallback — обычный POST /api/expenses/work (если есть work_id) или /api/expenses/office.
        const fbPath = payload.work_id ? '/api/expenses/work' : '/api/expenses/office';
        const fbBody = {
          ...(payload.work_id ? { work_id: payload.work_id } : {}),
          category,
          amount: amt,
          date,
          supplier: payload.supplier,
          description: payload.comment,
          comment: payload.comment,
        };
        res = await api(fbPath, { method: 'POST', body: fbBody });
      }
      toast.success('Расход создан');
      try { onParsed?.({ expense: res?.expense || res, parsed: payload }); } catch {}
      close();
    } catch (e) {
      toast.error('Не удалось создать расход: ' + (e?.message || e));
      setBusy(false);
      setStage('parsed');
    }
  };

  return (
    <MCard>
      <MHead icon="🧾" title="Сканер чеков" subtitle="OCR распознавание" accent="default" onClose={close} />
      <MBody>
        {/* 1. Файл-инпут */}
        <Field label="Файл чека (JPG/PNG/PDF)" required help="Можно сфотографировать на телефоне">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            capture="environment"
            onChange={onFileChange}
            className="m-input"
            style={{ padding: 8 }}
          />
        </Field>

        {/* 2. Превью */}
        {previewUrl && file && (
          <div style={{ marginTop: 8, marginBottom: 12, textAlign: 'center' }}>
            {file.type === 'application/pdf' ? (
              <div style={{ padding: 16, background: 'var(--bg3, #1a1a1a)', borderRadius: 6 }}>
                📄 PDF: {file.name} ({Math.round(file.size / 1024)} КБ)
              </div>
            ) : (
              <img
                src={previewUrl}
                alt="Превью чека"
                style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 6, border: '1px solid var(--brd, #333)' }}
              />
            )}
          </div>
        )}

        {/* 3. Кнопка распознать + прогресс */}
        {file && stage !== 'parsed' && (
          <div style={{ marginBottom: 16 }}>
            <Btn variant="primary" block onClick={onRecognize} disabled={stage === 'recognizing'}>
              {stage === 'recognizing' ? `🔍 Распознаём… ${progress}%` : '🔍 Распознать'}
            </Btn>
            {stage === 'recognizing' && (
              <div
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{ marginTop: 8, height: 6, background: 'var(--bg3, #1a1a1a)', borderRadius: 3, overflow: 'hidden' }}
              >
                <div style={{
                  width: progress + '%',
                  height: '100%',
                  background: 'var(--gold, #f5d78e)',
                  transition: 'width .2s',
                }} />
              </div>
            )}
          </div>
        )}

        {/* 4. Editable форма после парсинга (или сразу если юзер хочет ручной ввод) */}
        {(stage === 'parsed' || stage === 'saving') && (
          <>
            <Field label="Сумма (₽)" required>
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
            <Field label="Дата">
              <input
                type="date"
                className="m-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Поставщик / Магазин">
              <TextInput value={supplier} onChange={setSupplier} placeholder="ООО, ИП, название" />
            </Field>
            <Field label="Категория" required>
              <SelectInput
                value={category}
                onChange={setCategory}
                options={CATEGORIES}
              />
            </Field>
            <Field label="Комментарий">
              <TextInput value={comment} onChange={setComment} placeholder="Описание расхода" />
            </Field>
            {rawText && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', opacity: 0.7, fontSize: 12 }}>
                  Показать распознанный текст
                </summary>
                <pre style={{
                  fontSize: 11,
                  background: 'var(--bg3, #1a1a1a)',
                  padding: 8,
                  borderRadius: 6,
                  whiteSpace: 'pre-wrap',
                  marginTop: 8,
                  maxHeight: 200,
                  overflow: 'auto',
                }}>{rawText}</pre>
              </details>
            )}
          </>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        {stage === 'parsed' && (
          <Btn variant="primary" onClick={onSave} disabled={busy}>
            {busy ? 'Сохраняем…' : '💾 Создать расход'}
          </Btn>
        )}
      </MFoot>
    </MCard>
  );
}
