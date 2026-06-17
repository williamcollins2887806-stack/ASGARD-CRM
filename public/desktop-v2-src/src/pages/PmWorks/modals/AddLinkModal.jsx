/**
 * AddLinkModal — добавление внешней URL-ссылки в комплект документов работы.
 *
 * Паритет vanilla packAddLink (pm_works.js:100-119): тип / название / URL.
 * Бэк: POST /api/files { work_id, type, name, file_url } — endpoint поддерживает
 * чисто-ссылочные «документы» (без upload). Если бэк отвечает 404/422 — toast.err.
 *
 * Использование (из DocsPackModal):
 *   open(<AddLinkModal work={work} onAdded={() => reload()} />);
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';

export function AddLinkModal({ work, onAdded }) {
  const { close } = useModal();
  const [type, setType] = useState('Документ');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const u = url.trim();
    if (!u) { toast('Документ', 'Укажите ссылку', 'err'); return; }
    if (!/^(https?:|ftp:|mailto:|tel:|\/)/i.test(u)) {
      toast('Документ', 'Ссылка должна начинаться с http(s):// или /', 'err');
      return;
    }
    setSaving(true);
    try {
      // POST /api/files — для ссылок (без multipart). Backend ставит type, file_url,
      // original_name. См. src/routes/files.js (link-mode без file).
      await api('/api/files', {
        method: 'POST',
        body: {
          work_id: work.id,
          type: (type || 'Документ').trim(),
          name: (name || u).trim(),
          original_name: (name || u).trim(),
          file_url: u
        }
      });
      toast('Документ', 'Ссылка добавлена', 'ok');
      onAdded?.();
      close();
    } catch (e) {
      toast('Документ', String(e?.message || e), 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead icon="🔗" title="Добавить ссылку" subtitle="Внешний URL → в комплект" onClose={close} />
      <MBody>
        <div className="col gap-8">
          <Field label="Тип">
            <TextInput value={type} onChange={setType} placeholder="ТЗ / Письмо / Фото" />
          </Field>
          <Field label="Название">
            <TextInput value={name} onChange={setName} placeholder="Например: Комплект" />
          </Field>
          <Field label="Ссылка" required>
            <TextInput value={url} onChange={setUrl} placeholder="https://…" />
          </Field>
        </div>
      </MBody>
      <MFoot>
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving || !url.trim()} onClick={save}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
