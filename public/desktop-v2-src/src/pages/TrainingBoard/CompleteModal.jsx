/**
 * CompleteModal — завершение обучения с загрузкой сертификата.
 * Поток: загрузка файла (multipart) → PUT /complete.
 */
import { useState, useRef } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input } from '@/modals/parts';

import { uploadCertificate, completeTraining } from './api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

export function CompleteModal({ training, onChanged }) {
  const { close } = useModal();
  const fileRef = useRef(null);

  const [certNum, setCertNum] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [trainerName, setTrainerName] = useState('');
  const [fileLabel, setFileLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    setFileLabel(f ? `${f.name} (${(f.size / 1024).toFixed(0)} КБ)` : '');
  };

  const onSave = async () => {
    setBusy(true);
    setProgress('');
    try {
      const file = fileRef.current?.files?.[0];
      if (file) {
        // G-5: размер/тип на клиенте до отправки.
        validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' });
        setProgress('Загрузка файла…');
        await uploadCertificate(training.id, file);
        setProgress('✓ Файл загружен');
      }

      setProgress((s) => (s ? s + ' · ' : '') + 'Сохранение обучения…');
      await completeTraining(training.id, {
        certificate_number: certNum.trim() || null,
        valid_from: validFrom || null,
        valid_to: validTo || null,
        trainer_name: trainerName.trim() || null
      });

      toast.success('Обучение завершено');
      onChanged?.();
      close();
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
      setBusy(false);
      setProgress('');
    }
  };

  const t = training || {};

  return (
    <MCard>
      <MHead
        icon="✅"
        title={`Завершить обучение: ${t.title || t.permit_name || '—'}`}
        subtitle={t.fio || t.employee_name || ''}
        accent="success"
        onClose={() => close()}
      />
      <MBody>
        <div className="mb-14 c-t2 fs-13">
          Рабочий: <b className="c-t1">{t.fio || t.employee_name || '—'}</b>
          {' · '}
          Допуск: <b className="c-t1">{t.title || t.permit_name || '—'}</b>
        </div>

        <Field label="Номер сертификата" help="Например: АБВ-2026-001">
          <Input value={certNum} onChange={(e) => setCertNum(e.target.value)} placeholder="АБВ-2026-001" />
        </Field>

        <div className="tb-form-row">
          <Field label="Действует с">
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label="Действует до" help={!validTo ? 'Без даты — не создастся допуск в personnel' : null}>
            <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </Field>
        </div>

        <Field label="Обучающий (опционально)">
          <Input value={trainerName} onChange={(e) => setTrainerName(e.target.value)} placeholder="ФИО или организация" />
        </Field>

        <Field label="Файл сертификата (PDF, JPG, PNG, DOC)">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            onChange={onFileChange}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: 8,
              background: 'var(--inner-bg)',
              border: '1px solid var(--brd-1)',
              borderRadius: 'var(--r-sm)',
              color: 'var(--t-1)',
              fontSize: 13,
              cursor: 'pointer'
            }}
          />
          {fileLabel && <div className="mt-6 fs-12 c-t3">Выбран: {fileLabel}</div>}
          {progress && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--info-t)' }}>{progress}</div>}
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()} disabled={busy}>Отмена</Btn>
        <Btn variant="success" onClick={onSave} disabled={busy}>
          {busy ? 'Сохраняем…' : '✅ Завершить обучение'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
