/**
 * Модалка прикрепления файла к существующей записи.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { uploadAttachment } from './api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

export function TravelUploadModal({ logisticsId, onUploaded }) {
  const { close } = useModal();
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!file) {
      toast.error('Выберите файл');
      return;
    }
    // G-5: размер/тип на клиенте до загрузки.
    try {
      validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' });
    } catch (e) {
      toast.error(e?.message || 'Файл не подходит');
      return;
    }
    setSaving(true);
    try {
      await uploadAttachment(logisticsId, file);
      toast.success('Файл прикреплён');
      onUploaded?.();
      close();
    } catch (e) {
      toast.error('Не удалось загрузить: ' + (e?.message || e));
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead icon="📎" title="Прикрепить файл" onClose={() => close()} />
      <MBody>
        <Field label="Файл (билет, ваучер, направление)">
          <input
            type="file"
            className="m-input"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()} disabled={saving}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving}>
          {saving ? 'Загружаем…' : 'Загрузить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
