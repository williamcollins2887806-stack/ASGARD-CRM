/**
 * UploadTkpModal — загрузка готового ТКП из файла (PDF/фото) и AI-разбор.
 * Источник: openUploadTkpModal в tkp-page.js.
 * Бэк: POST /api/tkp/parse-attachment (multipart), POST /api/tkp/upload-ready (multipart)
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, FileDrop, TextareaInput, TextInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { parseAttachmentForm, uploadReadyForm } from '../api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

function fmtPct(c) {
  const n = Math.round((Number(c) || 0) * 100);
  return Math.max(0, Math.min(100, n));
}

export function UploadTkpModal({ onCreated }) {
  const { close } = useModal();
  const [step, setStep] = useState('upload'); // upload | review
  const [files, setFiles] = useState([]);
  const [parsed, setParsed] = useState(null);
  const [meta, setMeta] = useState(null); // confidence, warnings, excerpt
  const [busy, setBusy] = useState(false);

  const onFiles = (fs) => {
    setFiles(Array.from(fs));
  };

  const mapParsed = (result) => ({
    customer_name: result.customer_name || '',
    customer_inn: result.customer_inn || result.inn || '',
    customer_address: result.customer_address || '',
    subject: result.subject || result.title || '',
    work_description: result.work_description || result.description || '',
    total_sum: result.total_with_vat || result.total_sum || result.total_amount || result.amount || '',
    deadline: result.deadline || '',
    validity_days: result.validity_days || 30,
    items: result.items || []
  });

  const runParse = async ({ force_ocr = false, mode = 'initial' } = {}) => {
    if (!files.length) return toast('Файл', 'Загрузите файл ТКП', 'warn');
    try {
      validateFile(files[0], { maxSize: MAX_ATTACHMENT_SIZE, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx' });
    } catch (e) {
      return toast('Файл', e?.message || 'Файл не подходит', 'warn');
    }
    setBusy(true);
    try {
      const res = await parseAttachmentForm(files[0], { force_ocr, mode });
      const result = res?.parsed || {};
      setParsed(mapParsed(result));
      setMeta({
        confidence: res?.confidence,
        warnings: res?.warnings || [],
        excerpt: String(res?.text_extracted || '').replace(/\s+/g, ' ').trim().slice(0, 280),
        ok: res?.ok
      });
      if (res?.ok === false) {
        toast('Распознавание', (res.warnings && res.warnings[0]) || res.reason || 'Не удалось извлечь данные', 'warn');
      }
      setStep('review');
    } catch (e) {
      toast('Ошибка парсинга', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!parsed) return;
    if (!parsed.subject?.trim()) return toast('Название', 'Укажите название ТКП', 'warn');
    setBusy(true);
    try {
      const res = await uploadReadyForm(files[0], {
        subject: parsed.subject,
        customer_name: parsed.customer_name,
        customer_inn: parsed.customer_inn,
        customer_address: parsed.customer_address,
        work_description: parsed.work_description,
        total_sum: Number(parsed.total_sum) || 0,
        deadline: parsed.deadline || '',
        validity_days: parseInt(parsed.validity_days, 10) || 30,
        items: { items: parsed.items || [] },
        parsed_from_attachment: 'true'
      });
      const id = res?.item?.id || res?.tkp_id || res?.id;
      toast('Загружено', `ТКП #${id || ''}`, 'ok');
      onCreated?.(id);
      window.dispatchEvent(new CustomEvent('asgard:tkp:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  const confPct = meta?.confidence != null ? fmtPct(meta.confidence) : null;
  const confColor = confPct == null ? 'var(--t-3)' : (confPct >= 60 ? 'var(--ok)' : (confPct >= 35 ? 'var(--warn)' : 'var(--err)'));

  return (
    <MCard className="modal-lg">
      <MHead icon="📥" title="Загрузить ТКП из файла" subtitle={step === 'upload' ? 'Загрузи PDF/фото и AI разберёт' : 'Проверь распознанное'} accent="cyan" onClose={close} />
      <MBody>
        {step === 'upload' && (
          <div className="col gap-14">
            <FileDrop
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
              hint="Перетащи готовое ТКП — PDF, скан, фото"
              onFiles={onFiles}
            />
            {files.length > 0 && (
              <div className="p-10 bg-inner r-sm">
                <div style={{ fontSize: 11, color: 'var(--t-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Загружено</div>
                <div>📄 {files[0].name} <span className="c-t3 fs-11">({(files[0].size / 1024).toFixed(1)} КБ)</span></div>
              </div>
            )}
            <div style={{ padding: 10, background: 'var(--cyan-bg)', borderRadius: 'var(--r-sm)', fontSize: 12.5, color: 'var(--t-2)' }}>
              💡 AI распознает: заказчика, ИНН, предмет, сумму, позиции таблицы. Перед сохранением сможешь проверить и пересканировать.
            </div>
          </div>
        )}

        {step === 'review' && parsed && (
          <div className="col gap-10">
            <div className="p-10 bg-inner r-sm" style={{ fontSize: 12.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>Файл обработан. Проверьте данные.</div>
                {confPct != null && <div style={{ fontWeight: 700, color: confColor }}>Уверенность: {confPct}%</div>}
              </div>
              {(meta?.warnings || []).map((w, i) => (
                <div key={i} style={{ marginTop: 6, color: 'var(--warn)', fontSize: 11 }}>⚠ {w}</div>
              ))}
              {meta?.excerpt ? (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--t-3)', lineHeight: 1.4 }}>
                  <b style={{ color: 'var(--t-2)' }}>Фрагмент:</b> {meta.excerpt}{meta.excerpt.length >= 280 ? '…' : ''}
                </div>
              ) : null}
              <div style={{ marginTop: 10 }}>
                <Btn
                  disabled={busy}
                  onClick={() => runParse({ force_ocr: true, mode: 'refine' })}
                >
                  {busy ? 'Сканируем…' : '🔄 Повторное / уточняющее сканирование'}
                </Btn>
              </div>
            </div>
            <Field label="Заказчик">
              <TextInput value={parsed.customer_name} onChange={(v) => setParsed({ ...parsed, customer_name: v })} />
            </Field>
            <div className="grid-2 gap-8">
              <Field label="ИНН"><TextInput value={parsed.customer_inn} onChange={(v) => setParsed({ ...parsed, customer_inn: v })} /></Field>
              <Field label="Сумма с НДС"><TextInput value={parsed.total_sum} onChange={(v) => setParsed({ ...parsed, total_sum: v })} /></Field>
            </div>
            <Field label="Адрес"><TextInput value={parsed.customer_address} onChange={(v) => setParsed({ ...parsed, customer_address: v })} /></Field>
            <Field label="Предмет" required><TextInput value={parsed.subject} onChange={(v) => setParsed({ ...parsed, subject: v })} /></Field>
            <Field label="Описание"><TextareaInput value={parsed.work_description} onChange={(v) => setParsed({ ...parsed, work_description: v })} minRows={3} maxRows={6} /></Field>
            <div className="grid-2 gap-8">
              <Field label="Сроки"><TextInput value={parsed.deadline} onChange={(v) => setParsed({ ...parsed, deadline: v })} /></Field>
              <Field label="Срок действия, дн."><TextInput value={parsed.validity_days} onChange={(v) => setParsed({ ...parsed, validity_days: v })} /></Field>
            </div>
            <div className="p-10 bg-inner r-sm fs-12-5">
              <strong>📋 Распознано позиций:</strong> {parsed.items?.length || 0}
            </div>
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn onClick={step === 'review' ? () => setStep('upload') : close}>{step === 'review' ? '← Назад' : 'Отмена'}</Btn>
        {step === 'upload' && (
          <Btn variant="primary" disabled={busy || !files.length} onClick={() => runParse({ mode: 'initial' })}>{busy ? 'Распознаём…' : 'Распознать →'}</Btn>
        )}
        {step === 'review' && (
          <Btn variant="primary" disabled={busy} onClick={apply}>{busy ? 'Сохраняем…' : '✓ Создать ТКП'}</Btn>
        )}
      </MFoot>
    </MCard>
  );
}
