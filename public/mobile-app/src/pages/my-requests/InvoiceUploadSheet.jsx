import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Upload, Camera, X, FileText, Loader2, Check, AlertTriangle,
  ChevronLeft, ChevronRight, RotateCcw, PenLine, Search, CheckCircle2,
  Plus, Building2
} from 'lucide-react';
import { toast } from 'sonner';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { DocumentPreviewSheet } from '@/components/shared/DocumentPreviewSheet';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { formatMoney } from '@/lib/utils';

/**
 * D-369 (23.10.2026): мастер загрузки ПАЧКИ счетов на мобильном.
 * ═══════════════════════════════════════════════════════════════════════════
 * Прямой аналог десктопной модалки `AsgardPaymentBatch`
 * (public/assets/js/procurement-batch.js). Заказчик: «функционал 1в1 как на
 * десктопе, только сделанный на мобильно».
 *
 * ЦЕПОЧКА (точно как на десктопе, чтобы данные не разошлись):
 *   1) файл(ы) → POST /api/payment-invoices/upload  → file_path
 *   2)             POST /api/payment-invoices       → ЧЕРНОВИК (status=draft)
 *   3)             POST /api/payment-invoices/:id/recognize → поля из OCR/ИИ
 *   4) правка полей → PATCH /api/payment-invoices/:id
 *   5) «Отправить» → POST /api/payment-invoices/submit { ids }
 *
 * ВАЖНЫЕ ПРАВИЛА, ВЗЯТЫЕ ИЗ ДЕСКТОПА (не упрощать):
 *   • загрузка НЕ отправляет письмо директору — только черновик (D-316);
 *   • смена вида расхода СБРАСЫВАЕТ объект: иначе офисный счёт унаследует
 *     чужую привязку и расход упадёт не в тот проект;
 *   • объект выбирается ТОЛЬКО из базы (work-search), не свободным текстом;
 *   • отправка блокируется, если нет поставщика (или стоит «Распознаётся…»),
 *     нет суммы > 0 или нет файла;
 *   • при пустом распознавании — блок деградации «Повторить / Вписать вручную»,
 *     счёт не теряется.
 *
 * Props:
 *   onClose — закрыть мастер
 *   onDone  — счета отправлены/сохранены (родитель перечитывает список)
 */

/** Ставки НДС, допустимые НК РФ — как на десктопе. */
const VAT_RATES = [null, 0, 5, 7, 10, 20, 22];

const STEP_LABEL = { upload: 'Загрузка', ocr: 'Распознавание', ready: 'Готов', error: 'Ошибка', saved: 'Черновик' };

const TABS = [
  { id: 'main', label: 'Счёт' },
  { id: 'terms', label: 'Условия' },
  { id: 'review', label: 'Проверка' }
];

/** Черновик пустого элемента пачки. */
function newItem(file) {
  return {
    localId: 'l' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    file,
    invoiceId: null,
    status: 'upload',
    progress: 0,
    fields: {},
    error: null,
    engine: null,
    savedAt: null
  };
}

export function InvoiceUploadSheet({ onClose, onDone, draftId = null }) {
  const haptic = useHaptic();
  const [items, setItems] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [tab, setTab] = useState('main');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(!!draftId);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // D-369: продолжить существующий черновик — подтягиваем его поля с сервера,
  // иначе «сохранил, вышел, вернулся» не работает и черновики копятся сиротами.
  useEffect(() => {
    if (!draftId) return;
    let alive = true;
    (async () => {
      try {
        const d = await api.get(`/payment-invoices/${draftId}`);
        if (!alive) return;
        setItems([{
          localId: 'd' + draftId,
          file: { name: d.file_name || 'Скан счёта' },
          invoiceId: draftId,
          status: 'ready',
          progress: 100,
          engine: null,
          error: null,
          savedAt: null,
          fields: {
            supplier_name: d.supplier_name && d.supplier_name !== 'Распознаётся…' ? d.supplier_name : null,
            supplier_inn: (d.supplier && d.supplier.inn) || d.counterparty_inn || null,
            supplier_id: d.supplier_id || null,
            invoice_number: d.invoice_number || null,
            invoice_date: d.invoice_date ? String(d.invoice_date).slice(0, 10) : null,
            amount: d.amount != null ? Number(d.amount) : null,
            amount_net: d.amount_net != null ? Number(d.amount_net) : null,
            vat_amount: d.vat_amount != null ? Number(d.vat_amount) : null,
            vat_rate: d.vat_rate != null ? Number(d.vat_rate) : null,
            payment_due_at: d.due_date ? String(d.due_date).slice(0, 10) : null,
            contract_number: d.contract_basis_number || null,
            contract_id: d.contract_id || null,
            work_id: d.work_id || null,
            work_hint: d.work_hint || null,
            spend_kind: d.spend_kind || null,
            sf_due_at: d.sf_due_at ? String(d.sf_due_at).slice(0, 10) : null,
            service_done_at: d.service_done_at ? String(d.service_done_at).slice(0, 10) : null,
            sf_basis: d.sf_basis || 'invoice',
            pay_timing: d.pay_timing || 'immediate',
            comment_text: d.comment_text || null,
            // D-369 (найдено верификатором): API отдаёт `line_items_json`, а не
            // `line_items` — на вкладке «Проверка» при продолжении черновика
            // всегда было «Распознано позиций: 0».
            _lines: Array.isArray(d.line_items_json) ? d.line_items_json.length
              : (Array.isArray(d.line_items) ? d.line_items.length : 0)
          }
        }]);
      } catch (e) {
        toast.error(e?.message || 'Не удалось открыть черновик');
        onClose?.();
      } finally {
        if (alive) setLoadingDraft(false);
      }
    })();
    return () => { alive = false; };
  }, [draftId, onClose]);

  const active = items[activeIdx] || null;
  const readyItems = useMemo(() => items.filter((x) => x.status === 'ready' || x.status === 'saved'), [items]);

  /** Подтверждённая валидность: поставщик + сумма + файл. */
  const isComplete = useCallback((it) => {
    const f = it?.fields || {};
    const hasSupplier = !!(f.supplier_name && f.supplier_name !== 'Распознаётся…');
    const hasAmount = Number(f.amount) > 0;
    const hasFile = !!(it?.invoiceId);
    return hasSupplier && hasAmount && hasFile;
  }, []);

  /* ─── Загрузка и распознавание ─────────────────────────────────────── */

  /** Прогнать один файл: upload → draft → recognize. */
  const processItem = useCallback(async (it) => {
    const patch = (p) => setItems((cur) => cur.map((x) => (x.localId === it.localId ? { ...x, ...p } : x)));
    try {
      patch({ status: 'upload', progress: 8, error: null });

      const fd = new FormData();
      fd.append('file', it.file);
      const up = await api.postForm('/payment-invoices/upload', fd);
      if (!up || !up.file_path) throw new Error('Не удалось загрузить файл');
      patch({ progress: 34 });

      let invoiceId = it.invoiceId;
      if (!invoiceId) {
        // Черновик: поставщик-заглушка, сумма 0 — сервер запустит распознавание
        // в фоне. Ровно как на десктопе (procurement-batch.js:215).
        const created = await api.post('/payment-invoices', {
          amount: 0,
          supplier_name: 'Распознаётся…',
          file_path: up.file_path,
          file_name: up.file_name || it.file.name,
          basis_type: 'other'
        });
        invoiceId = created.id;
        patch({ invoiceId, progress: 46 });
      }

      patch({ status: 'ocr', progress: 58 });
      const rec = await api.post(`/payment-invoices/${invoiceId}/recognize`, {});
      const f = rec?.fields || {};

      patch({
        progress: 100,
        status: 'ready',
        engine: rec?.engine || null,
        fields: {
          supplier_name: f.supplier_name || null,
          supplier_inn: f.inn || null,
          supplier_id: null,
          invoice_number: f.invoice_number || null,
          invoice_date: f.invoice_date || null,
          amount: f.amount || null,
          amount_net: f.amount_net || null,
          vat_amount: f.vat_amount || null,
          vat_rate: f.vat_rate != null ? f.vat_rate : null,
          payment_due_at: f.payment_due_at || null,
          contract_number: f.contract_number || null,
          contract_id: null,
          work_id: null,
          work_hint: f.work_hint || null,
          spend_kind: null,
          sf_due_at: null,
          service_done_at: null,
          sf_basis: 'invoice',
          pay_timing: 'immediate',
          _lines: Array.isArray(f.lines) ? f.lines.length : 0
        }
      });
    } catch (e) {
      patch({ status: 'error', progress: 0, error: e?.message || 'Ошибка распознавания' });
    }
  }, []);

  /** Добавить файлы (пачкой) и обработать последовательно. */
  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []).filter(
      (f) => /pdf/i.test(f.type || '') || /image\//i.test(f.type || '') || /\.(pdf|png|jpe?g|webp)$/i.test(f.name || '')
    );
    if (!files.length) {
      toast.error('Нужны PDF или изображения счёта');
      return;
    }
    const created = files.map(newItem);
    setItems((cur) => [...cur, ...created]);
    setActiveIdx((i) => (i === 0 && items.length === 0 ? 0 : i));
    // Последовательно, а не параллельно: иначе пачка OCR душит сервер и
    // ответы приходят с таймаутом (то же решение, что на десктопе).
    for (const it of created) {
      await processItem(it);
    }
  }, [items.length, processItem]);

  const retryItem = async () => {
    if (!active) return;
    haptic.light();
    setItems((cur) => cur.map((x) => (x.localId === active.localId ? { ...x, status: 'upload', error: null } : x)));
    await processItem({ ...active, status: 'upload' });
  };

  /* ─── Правка полей ─────────────────────────────────────────────────── */

  const setField = (k, v) => {
    if (!active) return;
    setItems((cur) => cur.map((x) => {
      if (x.localId !== active.localId) return x;
      const fields = { ...x.fields, [k]: v };
      // Смена вида расхода сбрасывает объект: для офиса/склада/прочего он не
      // нужен, а унаследованное значение дало бы ложную привязку в реестре.
      if (k === 'spend_kind' && v !== 'work') {
        fields.work_id = null;
        fields.work_label = null;
      }
      return { ...x, fields };
    }));
  };

  /** Пересчёт НДС: сумма НДС включена в сумму с НДС (как на десктопе). */
  const recalcVat = (gross, rate) => {
    const g = Number(gross) || 0;
    if (rate == null || rate === 0) return { vat: 0, net: g };
    const vat = Math.round((g * rate) / (100 + rate) * 100) / 100;
    return { vat, net: Math.round((g - vat) * 100) / 100 };
  };

  /* ─── Сохранение и отправка ────────────────────────────────────────── */

  /** Payload для PATCH — ровно те поля, что принимает сервер. */
  const draftPayload = (it) => {
    const f = it.fields || {};
    const num = (v) => (v != null && v !== '' ? Number(v) : null);
    return {
      amount: Number(f.amount) || 0,
      supplier_name: (f.supplier_name && f.supplier_name !== 'Распознаётся…') ? f.supplier_name : null,
      supplier_id: num(f.supplier_id),
      invoice_number: f.invoice_number || null,
      invoice_date: f.invoice_date || null,
      due_date: f.payment_due_at || null,
      vat_amount: num(f.vat_amount),
      vat_rate: num(f.vat_rate),
      amount_net: num(f.amount_net),
      basis_type: f.spend_kind === 'work' ? 'work' : 'other',
      contract_basis_number: f.contract_number || null,
      contract_id: num(f.contract_id),
      work_id: num(f.work_id),
      work_hint: f.work_id ? (f.work_label || null) : (f.work_hint || null),
      pay_timing: f.pay_timing || 'immediate',
      // D-368: эти поля раньше терялись на десктопе. Теперь бэкенд их принимает.
      spend_kind: ['work', 'warehouse', 'office', 'other'].includes(String(f.spend_kind || ''))
        ? f.spend_kind : null,
      sf_due_at: f.sf_due_at || null,
      service_done_at: f.service_done_at || null,
      sf_basis: ['invoice', 'service'].includes(String(f.sf_basis || '')) ? f.sf_basis : null,
      // D-369: ИНН и комментарий — раньше сервер их отбрасывал, и введённое
      // в мастере терялось молча.
      counterparty_inn: f.supplier_inn || null,
      comment_text: f.comment_text || null
    };
  };

  const saveDrafts = async () => {
    if (!readyItems.length) return;
    setBusy(true);
    let ok = 0;
    for (const it of readyItems) {
      try {
        await api.patch(`/payment-invoices/${it.invoiceId}`, draftPayload(it));
        ok++;
        setItems((cur) => cur.map((x) => (x.localId === it.localId ? { ...x, status: 'saved', savedAt: new Date() } : x)));
      } catch (e) {
        toast.error(`Не сохранено: ${e?.message || 'ошибка'}`);
      }
    }
    setBusy(false);
    if (ok) {
      haptic.success();
      toast.success(`Сохранено черновиков: ${ok}`);
      onDone?.();
    }
  };

  const submitAll = async () => {
    const target = readyItems.filter(isComplete);
    if (!target.length) {
      toast.error('Нет готовых счетов: заполните поставщика и сумму');
      return;
    }
    setBusy(true);
    try {
      // Сначала сохраняем правки, иначе директор увидит распознанное, а не ваше.
      for (const it of target) {
        await api.patch(`/payment-invoices/${it.invoiceId}`, draftPayload(it));
      }
      const res = await api.post('/payment-invoices/submit', { ids: target.map((x) => x.invoiceId) });
      const sent = (res?.submitted || []).length;
      const skipped = (res?.skipped || []).length;
      haptic.success();
      toast.success(sent
        ? `Отправлено директору: ${sent}${skipped ? `, пропущено: ${skipped}` : ''}`
        : 'Директору ничего не ушло — проверьте поля');
      setConfirmOpen(false);
      onDone?.();
    } catch (e) {
      haptic.error();
      toast.error(e?.message || 'Не удалось отправить');
    } finally {
      setBusy(false);
    }
  };

  /* ─── Рендер ───────────────────────────────────────────────────────── */

  const incomplete = readyItems.filter((it) => !isComplete(it));

  if (loadingDraft) {
    return (
      <BottomSheet open onClose={onClose} title="Счета на согласование" maxHeight="94vh">
        <div className="flex flex-col items-center gap-2 py-8">
          <Loader2 size={22} className="animate-spin" style={{ color: 'var(--gold)' }} />
          <p className="text-[12.5px] c-tertiary">Открываем черновик…</p>
        </div>
      </BottomSheet>
    );
  }

  return (
    <>
      <BottomSheet
        open
        onClose={onClose}
        title="Счета на согласование"
        maxHeight="94vh"
        footer={
          items.length > 0 ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveDrafts}
                disabled={busy || !readyItems.length}
                className="btn-action spring-tap"
                style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-light)' }}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : 'Черновик'}
              </button>
              <button
                type="button"
                onClick={() => { haptic.medium(); setConfirmOpen(true); }}
                disabled={busy || !readyItems.length}
                className="btn-action btn-primary spring-tap"
                style={{ flex: 2, opacity: readyItems.length ? 1 : 0.5 }}
              >
                Отправить директору
              </button>
            </div>
          ) : null
        }
      >
        <div className="flex flex-col gap-3 pb-2">
          {/* Шаг 1: выбор файлов */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,image/*"
            style={{ display: 'none' }}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { haptic.light(); fileInputRef.current?.click(); }}
              className="spring-tap"
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '13px 10px', borderRadius: 14,
                background: 'color-mix(in srgb, var(--gold) 9%, var(--bg-surface))',
                border: '1px dashed color-mix(in srgb, var(--gold) 40%, var(--border-norse))'
              }}
            >
              <Upload size={17} style={{ color: 'var(--gold)' }} />
              <span className="text-[12.5px] font-semibold c-primary">Выбрать файлы</span>
            </button>
            <button
              type="button"
              onClick={() => { haptic.light(); cameraInputRef.current?.click(); }}
              className="spring-tap"
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '13px 10px', borderRadius: 14,
                background: 'var(--bg-surface)',
                border: '0.5px solid var(--border-norse)'
              }}
            >
              <Camera size={17} style={{ color: 'var(--blue)' }} />
              <span className="text-[12.5px] font-semibold c-primary">Снять фото</span>
            </button>
          </div>

          {items.length === 0 && (
            <p className="text-[11.5px] c-tertiary text-center px-3" style={{ lineHeight: 1.5 }}>
              PDF или фото. Можно несколько сразу — это черновик, директору ничего не уйдёт
              до вашего подтверждения.
            </p>
          )}

          {/* Список счетов в работе */}
          {items.length > 0 && (
            <>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                {items.map((it, i) => {
                  const st = it.status;
                  const tone = st === 'error' ? 'var(--red)'
                    : st === 'ready' || st === 'saved' ? 'var(--green)'
                      : 'var(--gold)';
                  const sel = i === activeIdx;
                  return (
                    <button
                      key={it.localId}
                      type="button"
                      onClick={() => { haptic.light(); setActiveIdx(i); setTab('main'); }}
                      className="spring-tap flex-shrink-0"
                      style={{
                        minWidth: 96, padding: '8px 10px', borderRadius: 12, textAlign: 'left',
                        background: sel ? 'color-mix(in srgb, var(--gold) 12%, var(--bg-surface))' : 'var(--bg-surface)',
                        border: `0.5px solid ${sel ? 'color-mix(in srgb, var(--gold) 45%, var(--border-norse))' : 'var(--border-norse)'}`
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: tone, flexShrink: 0 }} />
                        <span className="text-[10.5px] font-semibold" style={{ color: tone }}>
                          {STEP_LABEL[st] || st}
                        </span>
                      </div>
                      <p className="text-[11px] c-primary mt-1 truncate" style={{ maxWidth: 92 }}>
                        {it.fields?.amount ? formatMoney(it.fields.amount, { short: true }) : it.file?.name?.slice(0, 14)}
                      </p>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => { haptic.light(); fileInputRef.current?.click(); }}
                  className="spring-tap flex-shrink-0 flex items-center justify-center"
                  style={{
                    minWidth: 52, borderRadius: 12, background: 'var(--bg-surface)',
                    border: '0.5px dashed var(--border-light)'
                  }}
                  aria-label="Добавить ещё файл"
                >
                  <Plus size={18} className="c-tertiary" />
                </button>
              </div>

              {/* Прогресс / ошибка активного */}
              {active && (active.status === 'upload' || active.status === 'ocr') && (
                <div className="card-glass px-4 py-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Loader2 size={16} className="animate-spin" style={{ color: 'var(--gold)' }} />
                    <span className="text-[13px] font-medium c-primary">
                      {active.status === 'upload' ? 'Загружаем файл' : 'Распознаём счёт'}
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 99, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${active.progress}%`, height: '100%', borderRadius: 99,
                      background: 'var(--gold-gradient)', transition: 'width var(--motion-fast) linear'
                    }} />
                  </div>
                  <p className="text-[11px] c-tertiary mt-2">
                    {active.progress}% · это черновик, директору ничего не ушло
                  </p>
                </div>
              )}

              {active && active.status === 'error' && (
                <div
                  className="rounded-2xl px-4 py-4"
                  style={{ background: 'color-mix(in srgb, var(--red) 8%, var(--bg-surface))', border: '0.5px solid color-mix(in srgb, var(--red) 25%, var(--border-norse))' }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <AlertTriangle size={16} style={{ color: 'var(--red)' }} />
                    <span className="text-[13px] font-semibold c-primary">Не удалось распознать</span>
                  </div>
                  <p className="text-[11.5px] c-secondary mb-3">
                    Счёт не потерян. Повторите распознавание или впишите данные вручную.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={retryItem} className="btn-action spring-tap"
                      style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-light)' }}>
                      <RotateCcw size={14} style={{ marginRight: 5 }} />Повторить
                    </button>
                    <button type="button"
                      onClick={() => setItems((cur) => cur.map((x) => (x.localId === active.localId ? { ...x, status: 'ready', error: null } : x)))}
                      className="btn-action spring-tap"
                      style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-light)' }}>
                      <PenLine size={14} style={{ marginRight: 5 }} />Вручную
                    </button>
                  </div>
                </div>
              )}

              {/* Подвкладки: Счёт / Условия / Проверка */}
              {active && (active.status === 'ready' || active.status === 'saved') && (
                <>
                  <div className="flex gap-1.5">
                    {TABS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => { haptic.light(); setTab(t.id); }}
                        className="filter-pill spring-tap flex-1"
                        data-active={tab === t.id ? 'true' : undefined}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {tab === 'main' && (
                    <MainTab
                      fields={active.fields}
                      setField={setField}
                      onPreview={() => setPreviewOpen(true)}
                      hasFile={!!active.invoiceId}
                      fileName={active.file?.name}
                      recalcVat={recalcVat}
                    />
                  )}
                  {tab === 'terms' && <TermsTab fields={active.fields} setField={setField} />}
                  {tab === 'review' && (
                    <ReviewTab
                      fields={active.fields}
                      complete={isComplete(active)}
                      lines={active.fields?._lines || 0}
                      engine={active.engine}
                      savedAt={active.savedAt}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </BottomSheet>

      {/* Подтверждение отправки */}
      {confirmOpen && (
        <BottomSheet open onClose={() => setConfirmOpen(false)} title="Отправить директору?" maxHeight="80vh"
          footer={
            <button
              type="button"
              onClick={submitAll}
              disabled={busy}
              className="btn-primary spring-tap"
              style={{ width: '100%' }}
            >
              {busy ? 'Отправляем…' : `Отправить ${readyItems.filter(isComplete).length}`}
            </button>
          }
        >
          <div className="flex flex-col gap-3 pb-2">
            <p className="text-[12.5px] c-secondary">
              Директор получит уведомление. Проверьте суммы и контрагентов.
            </p>
            {readyItems.map((it) => {
              const ok = isComplete(it);
              return (
                <div key={it.localId} className="card-glass px-3.5 py-2.5 flex items-center gap-2">
                  {ok
                    ? <CheckCircle2 size={16} style={{ color: 'var(--green)', flexShrink: 0 }} />
                    : <AlertTriangle size={16} style={{ color: 'var(--gold)', flexShrink: 0 }} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold c-primary truncate">
                      {it.fields?.supplier_name || 'Контрагент не заполнен'}
                    </p>
                    <p className="text-[11px] c-tertiary">
                      {it.fields?.amount ? formatMoney(it.fields.amount) : 'сумма не заполнена'}
                      {it.fields?.invoice_number ? ` · № ${it.fields.invoice_number}` : ''}
                    </p>
                  </div>
                </div>
              );
            })}
            {incomplete.length > 0 && (
              <div
                className="rounded-xl px-3 py-2.5"
                style={{ background: 'color-mix(in srgb, var(--gold) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--gold) 30%, transparent)' }}
              >
                <p className="text-[11.5px]" style={{ color: 'var(--gold)' }}>
                  В {incomplete.length} {plural(incomplete.length, 'счёте', 'счетах', 'счетах')} не заполнены
                  поставщик или сумма — они не уйдут директору.
                </p>
              </div>
            )}
          </div>
        </BottomSheet>
      )}

      <DocumentPreviewSheet
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Скан счёта"
        fileName={active?.file?.name || 'счёт'}
        fileUrl={active?.invoiceId ? `/api/payment-invoices/${active.invoiceId}/file` : undefined}
        previewUrl={active?.invoiceId ? `/api/payment-invoices/preview/${active.invoiceId}` : undefined}
      />
    </>
  );
}

/* ─── Подвкладка «Счёт» ────────────────────────────────────────────────── */

function MainTab({ fields, setField, onPreview, hasFile, fileName, recalcVat }) {
  const [supplierHits, setSupplierHits] = useState([]);
  const [showSuppliers, setShowSuppliers] = useState(false);
  // D-370: карточка контрагента со счётчиками. Заказчик: «показывается, что у
  // этого контрагента уже есть счета и договора в СРМ». На десктопе это есть
  // (procurement-batch.js:421-431), на мобилке не было вообще.
  const [card, setCard] = useState(null);
  const [cardLoading, setCardLoading] = useState(false);
  const searchTimer = useRef(null);

  /** Тянет карточку контрагента из справочника: счета, договора, контакты. */
  const loadCard = async (query, inn) => {
    const q = String(query || '').trim();
    // Короткий запрос — не ищем, но и НЕ оставляем старую карточку: иначе после
    // ручной правки имени на «ООО Новый» пользователь продолжал видеть счётчики
    // предыдущего контрагента (нашёл на проверке ветки «новый поставщик»).
    if (q.length < 3) { setCard(null); return; }
    setCardLoading(true);
    try {
      const res = await api.get(`/customers/registry-suggest?q=${encodeURIComponent(q)}&limit=1`);
      const hit = (res?.suppliers || [])[0] || null;
      // Дополнительная сверка: сервер ищет по подстроке, поэтому «ООО Новый»
      // мог совпасть с чужим именем. Показываем карточку только если это тот
      // контрагент, которого ввёл человек (по ИНН или по нормализованному имени).
      const norm = (s) => String(s || '').toLowerCase().replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').trim();
      const qNorm = norm(q.replace(/\d{10,12}/g, ''));
      const matches = hit && (
        (inn && hit.inn === inn)
        || (qNorm.length >= 4 && (norm(hit.name).includes(qNorm) || qNorm.includes(norm(hit.name))))
      );
      setCard(matches ? {
        id: hit.id, name: hit.name, inn: hit.inn,
        docs_count: Number(hit.docs_count) || 0,
        contracts_count: Number(hit.contracts_count) || 0,
        phone: hit.phone || '', email: hit.email || ''
      } : null);
    } catch { setCard(null); }
    finally { setCardLoading(false); }
  };

  // При открытии мастера и при появлении распознанного контрагента —
  // подтягиваем карточку, чтобы человек сразу видел историю по контрагенту.
  //
  // ВАЖНО: эффект не должен спорить с ручным вводом. Пока идёт набор имени
  // (searching) или пользователь очистил supplier_id, карточку не трогаем —
  // иначе она возвращается и «новый контрагент» выглядит как известный
  // (нашёл на проверке ветки «нет в базе»).
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (searching) return;
    if (fields.supplier_id || (fields.supplier_name && fields.supplier_name !== 'Распознаётся…')) {
      loadCard(fields.supplier_inn || fields.supplier_name, fields.supplier_inn);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.supplier_id, fields.supplier_inn, fields.supplier_name, searching]);

  const searchSupplier = (q) => {
    setField('supplier_name', q);
    // Ввод имени вручную сбрасывает привязку к справочнику: иначе новый
    // контрагент унаследует supplier_id и счётчики предыдущего.
    setField('supplier_id', null);
    setField('supplier_inn', null);
    setCard(null);
    setSearching(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q || q.length < 2) { setSupplierHits([]); setSearching(false); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        // Эндпоинт возвращает { suppliers: [...] } (src/routes/customers.js:172).
        // Раньше читали res.items || res.suggestions — всегда пусто.
        const res = await api.get(`/customers/registry-suggest?q=${encodeURIComponent(q)}&limit=6`);
        setSupplierHits(res?.suppliers || res?.items || []);
        setShowSuppliers(true);
      } catch { /* подсказки не критичны */ }
      // Набор завершён — снова разрешаем эффекту подтягивать карточку.
      setSearching(false);
    }, 350);
  };

  const vat = recalcVat(fields.amount, fields.vat_rate);

  return (
    <div className="flex flex-col gap-3">
      {/* Файл */}
      <div className="card-glass px-4 py-3 flex items-center gap-2.5">
        <FileText size={18} style={{ color: 'var(--gold)', flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] c-primary truncate">{fileName || 'Скан счёта'}</p>
          <p className="text-[10.5px] c-tertiary">Черновик · директору не отправлен</p>
        </div>
        {hasFile && (
          <button type="button" onClick={onPreview} className="btn-icon spring-tap" aria-label="Открыть скан">
            <Search size={16} />
          </button>
        )}
      </div>

      {/* Поставщик */}
      <div>
        <label className="input-label">Контрагент *</label>
        <input
          type="text"
          className="input-field"
          value={fields.supplier_name || ''}
          onChange={(e) => searchSupplier(e.target.value)}
          onBlur={() => setTimeout(() => setShowSuppliers(false), 180)}
          placeholder="ООО «Ромашка»"
          autoComplete="off"
        />
        {showSuppliers && supplierHits.length > 0 && (
          <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
            {supplierHits.map((s, i) => (
              <button
                key={s.id || i}
                type="button"
                onClick={() => {
                  setField('supplier_name', s.name || s.supplier_name);
                  setField('supplier_inn', s.inn || null);
                  setField('supplier_id', s.id || null);
                  setCard({
                    id: s.id, name: s.name, inn: s.inn,
                    docs_count: Number(s.docs_count) || 0,
                    contracts_count: Number(s.contracts_count) || 0,
                    phone: s.phone || '', email: s.email || ''
                  });
                  setShowSuppliers(false);
                }}
                className="w-full text-left px-3 py-2 spring-tap"
                style={{ background: 'var(--bg-surface)', borderBottom: i < supplierHits.length - 1 ? '0.5px solid var(--border-norse)' : 'none' }}
              >
                <p className="text-[12.5px] c-primary truncate">{s.name || s.supplier_name}</p>
                <p className="text-[10.5px] c-tertiary">
                  ИНН {s.inn || '—'}
                  {Number(s.docs_count) > 0 ? ` · ${s.docs_count} в реестре` : ''}
                  {Number(s.contracts_count) > 0 ? ` · ${s.contracts_count} дог.` : ''}
                </p>
              </button>
            ))}
          </div>
        )}

        {/* D-370: история по контрагенту. Заказчик просил видеть, что у этого
            контрагента УЖЕ есть счета и договора в СРМ, — на десктопе это
            карточка с счётчиками (procurement-batch.js:421-431). */}
        {cardLoading && !card && (
          <p className="text-[10.5px] c-tertiary mt-1.5">Проверяем контрагента в СРМ…</p>
        )}
        {card && (
          <div
            className="rounded-xl px-3 py-2.5 mt-1.5"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
              border: '0.5px solid var(--border-norse)'
            }}
          >
            <p className="text-[12px] font-semibold c-primary truncate">{card.name}</p>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              {/* Счета в реестре */}
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{
                  background: card.docs_count > 0
                    ? 'color-mix(in srgb, var(--green) 14%, transparent)'
                    : 'var(--bg-elevated)',
                  color: card.docs_count > 0 ? 'var(--green)' : 'var(--text-tertiary)'
                }}
              >
                {card.docs_count > 0 ? `${card.docs_count} ${plural(card.docs_count, 'счёт', 'счёта', 'счетов')} в реестре` : 'счетов не было'}
              </span>
              {/* Договора */}
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{
                  background: card.contracts_count > 0
                    ? 'color-mix(in srgb, var(--green) 14%, transparent)'
                    : 'color-mix(in srgb, var(--gold) 14%, transparent)',
                  color: card.contracts_count > 0 ? 'var(--green)' : 'var(--gold)'
                }}
              >
                {card.contracts_count > 0
                  ? `${card.contracts_count} ${plural(card.contracts_count, 'договор', 'договора', 'договоров')}`
                  : 'договора в базе нет'}
              </span>
            </div>
            {card.contracts_count > 0 ? (
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--green)' }}>Работаем по договору</p>
            ) : (
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--gold)' }}>
                Договора нет — счёт уйдёт с пометкой «нет договора». Проверьте номер ниже
                или заведите договор в карточке контрагента.
              </p>
            )}
            {(card.phone || card.email) && (
              <p className="text-[10px] c-tertiary mt-1 truncate">
                {[card.phone, card.email].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        )}

        {/* Контрагента нет в базе — предлагаем создать карточку. Бэкенд сделает
            это сам при отправке (ensureSupplier), честно говорим об этом. */}
        {!cardLoading && !card && fields.supplier_name
          && fields.supplier_name !== 'Распознаётся…' && fields.supplier_name.trim().length > 2 && !fields.supplier_id && (
          <div
            className="rounded-xl px-3 py-2.5 mt-1.5"
            style={{
              background: 'color-mix(in srgb, var(--blue) 8%, transparent)',
              border: '0.5px solid color-mix(in srgb, var(--blue) 26%, transparent)'
            }}
          >
            <p className="text-[11.5px]" style={{ color: 'var(--blue)' }}>
              Контрагента нет в базе СРМ — карточка создастся автоматически при отправке
              (с реквизитами из счёта).
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="input-label">ИНН</label>
          <input
            type="text" inputMode="numeric" className="input-field"
            value={fields.supplier_inn || ''}
            onChange={(e) => setField('supplier_inn', e.target.value.replace(/\D/g, '').slice(0, 12))}
            placeholder="10 или 12 цифр"
          />
        </div>
        <div>
          <label className="input-label">Номер счёта</label>
          <input
            type="text" className="input-field"
            value={fields.invoice_number || ''}
            onChange={(e) => setField('invoice_number', e.target.value)}
            placeholder="№"
          />
        </div>
      </div>

      <div>
        <label className="input-label">Дата счёта</label>
        <input
          type="date" className="input-field"
          value={fields.invoice_date || ''}
          onChange={(e) => setField('invoice_date', e.target.value || null)}
        />
      </div>

      {/* Суммы */}
      <div>
        <label className="input-label">Сумма с НДС *</label>
        <input
          type="text" inputMode="decimal" className="input-field"
          value={fields.amount != null ? moneyDisplay(fields.amount) : ''}
          onChange={(e) => {
            const v = moneyParse(e.target.value);
            setField('amount', v);
            // D-369 (раунд 14): при правке суммы пересчитываем нетто/НДС, если
            // ставка уже выбрана. Иначе сценарий «ввёл 1000 → нажал 22 % →
            // исправил на 500» оставлял net/vat от 1000, и карточка получала
            // нетто 819,67 при сумме 500 (нетто больше брутто).
            if (fields.vat_rate != null && v > 0) {
              const nv = recalcVat(v, fields.vat_rate);
              setField('vat_amount', nv.vat);
              setField('amount_net', nv.net);
            }
          }}
          placeholder="0,00 ₽"
        />
        <p className="text-[10.5px] c-tertiary mt-1">Можно ввести «130 000,00» — разберём</p>
      </div>

      <div>
        <label className="input-label">Ставка НДС</label>
        <div className="flex gap-1.5 flex-wrap">
          {VAT_RATES.map((r) => (
            <button
              key={String(r)}
              type="button"
              onClick={() => {
                setField('vat_rate', r);
                if (r === 0 || r == null) { setField('vat_amount', 0); setField('amount_net', Number(fields.amount) || 0); }
                else {
                  const v = recalcVat(fields.amount, r);
                  setField('vat_amount', v.vat);
                  setField('amount_net', v.net);
                }
              }}
              className="filter-pill spring-tap"
              data-active={String(fields.vat_rate) === String(r) ? 'true' : undefined}
            >
              {r == null ? 'Без НДС' : `${r}%`}
            </button>
          ))}
        </div>
        {Number(fields.amount) > 0 && (
          <p className="text-[11px] c-secondary mt-1.5">
            НДС {formatMoney(fields.vat_amount || 0)} · без НДС {formatMoney(fields.amount_net || 0)}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Подвкладка «Условия» ─────────────────────────────────────────────── */

function TermsTab({ fields, setField }) {
  const [workHits, setWorkHits] = useState([]);
  const [workQuery, setWorkQuery] = useState('');
  const [contractHits, setContractHits] = useState([]);
  const [contractState, setContractState] = useState(''); // '' | checking | found | none | error
  const workTimer = useRef(null);

  const searchWork = (q) => {
    setWorkQuery(q);
    if (workTimer.current) clearTimeout(workTimer.current);
    if (!q || q.length < 2) { setWorkHits([]); return; }
    workTimer.current = setTimeout(async () => {
      try {
        const res = await api.get(`/payment-invoices/work-search?q=${encodeURIComponent(q)}&limit=8`);
        setWorkHits(res?.items || []);
      } catch { /* не критично */ }
    }, 320);
  };

  const checkContract = async (num) => {
    setField('contract_number', num);
    if (!num || num.length < 2) { setContractHits([]); setContractState(''); return; }
    setContractState('checking');
    try {
      // Раньше здесь был `/contracts?search=...` — такого роута нет (404), и
      // ошибка проглатывалась: подпись «Проверяем по реестру договоров»
      // висела вечно, договор не привязывался. Теперь выделенный эндпоинт
      // в payment-invoices.js.
      const res = await api.get(`/payment-invoices/contract-search?q=${encodeURIComponent(num)}&limit=5`);
      const items = res?.items || [];
      setContractHits(items);
      if (items.length === 1) setField('contract_id', items[0].id);
      setContractState(items.length ? 'found' : 'none');
    } catch {
      setContractHits([]);
      setContractState('error');
    }
  };

  const sk = fields.spend_kind || '';

  return (
    <div className="flex flex-col gap-3">
      {/* Вид расхода */}
      <div>
        <label className="input-label">Вид расхода *</label>
        <div className="flex gap-1.5 flex-wrap">
          {[['work', 'Работы / объект'], ['warehouse', 'Склад'], ['office', 'Офис / АХО'], ['other', 'Прочее']]
            .map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setField('spend_kind', v)}
                className="filter-pill spring-tap"
                data-active={sk === v ? 'true' : undefined}
              >
                {l}
              </button>
            ))}
        </div>
        <p className="text-[10.5px] c-tertiary mt-1.5">
          {sk === 'work'
            ? 'Для работ объект обязателен — расход попадёт в смету объекта.'
            : 'Офис / склад / прочее — объект не нужен, расход идёт в общий реестр.'}
        </p>
      </div>

      {/* Объект — только для работ */}
      {sk === 'work' && (
        <div>
          <label className="input-label">Объект *</label>
          {fields.work_id ? (
            <div className="card-glass px-3.5 py-2.5 flex items-center gap-2">
              <Building2 size={16} style={{ color: 'var(--blue)', flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] c-primary truncate">{fields.work_label || `Объект #${fields.work_id}`}</p>
              </div>
              <button type="button" onClick={() => { setField('work_id', null); setField('work_label', null); }}
                className="btn-icon spring-tap" aria-label="Сбросить объект">
                <X size={15} />
              </button>
            </div>
          ) : (
            <>
              <input
                type="text" className="input-field"
                value={workQuery} onChange={(e) => searchWork(e.target.value)}
                placeholder="Начните вводить название объекта"
                autoComplete="off"
              />
              {workHits.length > 0 && (
                <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
                  {workHits.map((w, i) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => {
                        setField('work_id', w.id);
                        setField('work_label', w.label || w.work_title || w.object_name);
                        setWorkHits([]); setWorkQuery('');
                      }}
                      className="w-full text-left px-3 py-2 spring-tap"
                      style={{ background: 'var(--bg-surface)', borderBottom: i < workHits.length - 1 ? '0.5px solid var(--border-norse)' : 'none' }}
                    >
                      <p className="text-[12.5px] c-primary truncate">{w.label || w.work_title || w.object_name}</p>
                      {w.object_name && w.work_title && w.object_name !== w.work_title && (
                        <p className="text-[10.5px] c-tertiary truncate">{w.object_name}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Договор */}
      <div>
        <label className="input-label">Договор-основание</label>
        <input
          type="text" className="input-field"
          value={fields.contract_number || ''}
          onChange={(e) => checkContract(e.target.value)}
          placeholder="Номер договора, если указан в счёте"
        />
        {contractHits.length > 0 && (
          <div className="mt-1">
            {contractHits.slice(0, 3).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { setField('contract_id', c.id); setField('contract_number', c.number); setContractHits([]); }}
                className="text-[11px] c-blue block py-0.5 spring-tap"
              >
                ✓ {c.number} — {c.counterparty_name || 'найден в CRM'}
              </button>
            ))}
          </div>
        )}
        {fields.contract_id
          ? <p className="text-[10.5px]" style={{ color: 'var(--green)' }}>Договор найден в CRM</p>
          : contractState === 'checking'
            ? <p className="text-[10.5px] c-tertiary">Проверяем по реестру договоров…</p>
            : contractState === 'none'
              ? <p className="text-[10.5px]" style={{ color: 'var(--gold)' }}>В реестре не найден — счёт уйдёт с пометкой «нет договора»</p>
              : contractState === 'error'
                ? <p className="text-[10.5px]" style={{ color: 'var(--red)' }}>Реестр договоров недоступен</p>
                : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="input-label">Срок оплаты</label>
          <input
            type="date" className="input-field"
            value={fields.payment_due_at || ''}
            onChange={(e) => setField('payment_due_at', e.target.value || null)}
          />
        </div>
        <div>
          <label className="input-label">Срок СФ</label>
          <input
            type="date" className="input-field"
            value={fields.sf_due_at || ''}
            onChange={(e) => setField('sf_due_at', e.target.value || null)}
          />
        </div>
      </div>

      {/* D-369: «Услуга оказана» есть на десктопе (procurement-batch.js:552).
          Без неё бухгалтерия не знает, когда ждать закрывающие, а поле в
          мобильном payload всегда уходило null — данные терялись молча. */}
      <div>
        <label className="input-label">Услуга оказана</label>
        <input
          type="date" className="input-field"
          value={fields.service_done_at || ''}
          onChange={(e) => setField('service_done_at', e.target.value || null)}
        />
      </div>

      <div>
        <label className="input-label">Комментарий</label>
        <textarea
          className="input-field"
          rows={2}
          value={fields.comment_text || ''}
          onChange={(e) => setField('comment_text', e.target.value)}
          placeholder="Например: оплатить до конца недели, объект закрываем"
          style={{ resize: 'vertical', minHeight: 56 }}
        />
      </div>

      <div>
        <label className="input-label">Основание СФ</label>
        <div className="flex gap-1.5">
          {[['invoice', 'По счёту'], ['service', 'По услуге']].map(([v, l]) => (
            <button
              key={v} type="button"
              onClick={() => setField('sf_basis', v)}
              className="filter-pill spring-tap flex-1"
              data-active={(fields.sf_basis || 'invoice') === v ? 'true' : undefined}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="input-label">Тип оплаты</label>
        <div className="flex gap-1.5">
          {[['immediate', 'Сразу'], ['deferred', 'Отложенная']].map(([v, l]) => (
            <button
              key={v} type="button"
              onClick={() => setField('pay_timing', v)}
              className="filter-pill spring-tap flex-1"
              data-active={(fields.pay_timing || 'immediate') === v ? 'true' : undefined}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Подвкладка «Проверка» ────────────────────────────────────────────── */

function ReviewTab({ fields, complete, lines, engine, savedAt }) {
  const checks = [
    { label: 'Поставщик заполнен', ok: !!(fields.supplier_name && fields.supplier_name !== 'Распознаётся…') },
    { label: 'Сумма указана', ok: Number(fields.amount) > 0 },
    { label: 'ИНН распознан', ok: !!(fields.supplier_inn && String(fields.supplier_inn).length >= 10) },
    {
      label: 'Объект выбран (для работ)',
      ok: fields.spend_kind !== 'work' || !!fields.work_id,
      optional: fields.spend_kind !== 'work'
    },
    { label: 'Номер и дата счёта', ok: !!(fields.invoice_number && fields.invoice_date) }
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="card-hero">
        <p className="input-label">Что увидит директор</p>
        <p className="text-[22px] font-bold c-primary leading-tight">
          {fields.amount ? formatMoney(fields.amount) : '—'}
        </p>
        <p className="text-[12.5px] c-secondary mt-0.5">{fields.supplier_name || 'Контрагент не заполнен'}</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {fields.invoice_number && <Tag>№ {fields.invoice_number}</Tag>}
          {fields.invoice_date && <Tag>{fmtDate(fields.invoice_date)}</Tag>}
          {fields.spend_kind && <Tag>{spendLabel(fields.spend_kind)}</Tag>}
          {fields.work_label && <Tag>{fields.work_label}</Tag>}
          {fields.contract_number && <Tag>{fields.contract_number}</Tag>}
        </div>
      </div>

      <div className="card-glass px-4 py-3">
        <p className="input-label mb-2">Проверка</p>
        <div className="flex flex-col gap-1.5">
          {checks.map((c) => (
            <div key={c.label} className="flex items-center gap-2">
              {c.ok
                ? <Check size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
                : <AlertTriangle size={14} style={{ color: c.optional ? 'var(--text-tertiary)' : 'var(--gold)', flexShrink: 0 }} />}
              <span className="text-[12px]" style={{ color: c.ok ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                {c.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {lines > 0 && (
        <p className="text-[11.5px] c-tertiary text-center">
          Распознано позиций: {lines}
          {engine ? ` · движок: ${engine === 'ai' ? 'ИИ' : 'регулярки'}` : ''}
        </p>
      )}
      {savedAt && (
        <p className="text-[11.5px] text-center" style={{ color: 'var(--green)' }}>
          Черновик сохранён {new Date(savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
      {!complete && (
        <p className="text-[11.5px] text-center" style={{ color: 'var(--gold)' }}>
          Заполните поставщика и сумму — иначе счёт не уйдёт директору.
        </p>
      )}
    </div>
  );
}

function Tag({ children }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px]"
      style={{ background: 'color-mix(in srgb, var(--gold) 12%, transparent)', color: 'var(--text-primary)' }}
    >
      {children}
    </span>
  );
}

/* ─── Хелперы ──────────────────────────────────────────────────────────── */

function moneyParse(s) {
  const t = String(s || '').replace(/[^\d,.\-]/g, '').replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function moneyDisplay(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x === 0) return '';
  return x.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

function spendLabel(k) {
  return { work: 'Работы', warehouse: 'Склад', office: 'Офис', other: 'Прочее' }[k] || k;
}

function fmtDate(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  return y && m && day ? `${day}.${m}.${y}` : s;
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export default InvoiceUploadSheet;
