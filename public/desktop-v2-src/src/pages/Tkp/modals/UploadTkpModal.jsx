/**
 * UploadTkpModal — загрузка готового ТКП из файла (PDF/фото) и AI-разбор.
 * Источник: openUploadTkpModal в tkp_page.js.
 * Бэк: POST /api/tkp/parse-attachment, POST /api/tkp/upload-ready
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, FileDrop, TextareaInput, TextInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { parseAttachment, uploadReady } from '../api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

export function UploadTkpModal({ onCreated }) {
  const { close } = useModal();
  const [step, setStep] = useState('upload'); // upload | review
  const [files, setFiles] = useState([]);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);

  const onFiles = (fs) => {
    setFiles(Array.from(fs));
  };

  const parse = async () => {
    if (!files.length) return toast('Файл', 'Загрузите файл ТКП', 'warn');
    // G-5: размер/тип на клиенте (FileReader.readAsDataURL не освобождает память при OOM).
    try {
      validateFile(files[0], { maxSize: MAX_ATTACHMENT_SIZE, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' });
    } catch (e) {
      return toast('Файл', e?.message || 'Файл не подходит', 'warn');
    }
    setBusy(true);
    try {
      const f = files[0];
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const res = await parseAttachment({
            name: f.name,
            content_base64: String(reader.result).split(',').pop()
          });
          const result = res?.parsed || res || {};
          setParsed({
            customer_name: result.customer_name || '',
            inn: result.inn || '',
            subject: result.subject || result.title || '',
            description: result.description || '',
            total_amount: result.total_amount || result.amount || '',
            items: result.items || []
          });
          setStep('review');
        } catch (e) {
          toast('Ошибка парсинга', String(e?.message || e), 'err');
        } finally {
          setBusy(false);
        }
      };
      reader.onerror = () => { toast('Ошибка', 'Не удалось прочитать файл', 'err'); setBusy(false); };
      reader.readAsDataURL(f);
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!parsed) return;
    if (!parsed.customer_name?.trim()) return toast('Заказчик', 'Подтвердите заказчика', 'warn');
    setBusy(true);
    try {
      const res = await uploadReady({
        customer_name: parsed.customer_name,
        inn: parsed.inn,
        subject: parsed.subject,
        description: parsed.description,
        total_amount: Number(parsed.total_amount) || null,
        items: parsed.items,
        source_file_name: files[0]?.name
      });
      toast('Загружено', `ТКП #${res?.tkp_id || res?.id || ''}`, 'ok');
      onCreated?.(res?.tkp_id || res?.id);
      window.dispatchEvent(new CustomEvent('asgard:tkp:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="📥" title="Загрузить ТКП из файла" subtitle={step === 'upload' ? 'Загрузи PDF/фото и AI разберёт' : 'Проверь распознанное'} accent="cyan" onClose={close} />
      <MBody>
        {step === 'upload' && (
          <div className="col gap-14">
            <FileDrop
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
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
              💡 AI распознает: заказчика, ИНН, предмет, сумму, позиции таблицы. Перед сохранением сможешь проверить.
            </div>
          </div>
        )}

        {step === 'review' && parsed && (
          <div className="col gap-10">
            <Field label="Заказчик" required>
              <TextInput value={parsed.customer_name} onChange={(v) => setParsed({ ...parsed, customer_name: v })} />
            </Field>
            <div className="grid-2 gap-8">
              <Field label="ИНН"><TextInput value={parsed.inn} onChange={(v) => setParsed({ ...parsed, inn: v })} /></Field>
              <Field label="Сумма"><TextInput value={parsed.total_amount} onChange={(v) => setParsed({ ...parsed, total_amount: v })} /></Field>
            </div>
            <Field label="Предмет"><TextInput value={parsed.subject} onChange={(v) => setParsed({ ...parsed, subject: v })} /></Field>
            <Field label="Описание"><TextareaInput value={parsed.description} onChange={(v) => setParsed({ ...parsed, description: v })} minRows={3} maxRows={6} /></Field>
            <div className="p-10 bg-inner r-sm fs-12-5">
              <strong>📋 Распознано позиций:</strong> {parsed.items?.length || 0}
            </div>
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn onClick={step === 'review' ? () => setStep('upload') : close}>{step === 'review' ? '← Назад' : 'Отмена'}</Btn>
        {step === 'upload' && (
          <Btn variant="primary" disabled={busy || !files.length} onClick={parse}>{busy ? 'Распознаём…' : 'Распознать →'}</Btn>
        )}
        {step === 'review' && (
          <Btn variant="primary" disabled={busy} onClick={apply}>{busy ? 'Сохраняем…' : '✓ Создать ТКП'}</Btn>
        )}
      </MFoot>
    </MCard>
  );
}
