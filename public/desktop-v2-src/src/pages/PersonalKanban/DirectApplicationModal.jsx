/**
 * DirectApplicationModal — создать прямую заявку (POST /api/inbox-applications/direct, multipart).
 *
 * PM по умолчанию назначает себе. DIRECTOR/HEAD_PM/ADMIN — обязан указать `assign_pm_user_id`.
 * Файлы — multipart, до 20 шт, ≤50 MB каждый (см. backend H7).
 */
import { useEffect, useState, useMemo } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea } from '@/modals/parts';
import { Combobox } from '@/inputs/Inputs';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { useAuth } from '@/api/useAuth';
import { loadPmUsers, createDirectApplication } from './api';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export default function DirectApplicationModal({ onCreated }) {
  const { close } = useModal();
  const { user } = useAuth();
  const isPm = user?.role === 'PM';

  const [pmUsers, setPmUsers] = useState([]);
  const [loadingPms, setLoadingPms] = useState(!isPm);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [assignPm, setAssignPm] = useState('');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isPm) {
      // PM назначает себе автоматически — список не нужен.
      setAssignPm(String(user.id));
      return;
    }
    loadPmUsers()
      .then(setPmUsers)
      .finally(() => setLoadingPms(false));
  }, [isPm, user]);

  const pmOptions = useMemo(() => pmUsers.map((u) => ({
    value: String(u.id),
    label: u.name + (u.role ? ' · ' + u.role : '')
  })), [pmUsers]);

  const onPickFiles = (e) => {
    const list = Array.from(e.target.files || []);
    const next = [...files];
    for (const f of list) {
      if (next.length >= MAX_FILES) {
        toast.warn(`Максимум ${MAX_FILES} файлов`);
        break;
      }
      if (f.size > MAX_FILE_BYTES) {
        toast.warn(`«${f.name}» больше 50 МБ — пропускаем`);
        continue;
      }
      next.push(f);
    }
    setFiles(next);
    // сбрасываем input value, чтобы один и тот же файл можно было выбрать повторно после удаления
    e.target.value = '';
  };

  const removeFile = (idx) => setFiles((arr) => arr.filter((_, i) => i !== idx));

  const submit = async () => {
    const t = title.trim();
    const b = body.trim();
    if (t.length < 2 || t.length > 500) {
      toast.warn('Тема: 2..500 символов');
      return;
    }
    if (!b) {
      toast.warn('Заполните описание');
      return;
    }
    const pmIdNum = parseInt(assignPm, 10);
    if (!Number.isFinite(pmIdNum)) {
      toast.warn('Выберите РП');
      return;
    }
    setSaving(true);
    try {
      const r = await createDirectApplication({
        title: t,
        body: b,
        customer_name: customerName.trim() || null,
        customer_contact: customerContact.trim() || null,
        assign_pm_user_id: pmIdNum,
        files
      });
      toast.success(`Заявка №${r.application_id} создана`);
      onCreated?.(r);
      close();
    } catch (e) {
      const code = e?.body?.error || e?.message;
      if (code === 'too_many_files') toast.error(`Слишком много файлов (макс ${MAX_FILES})`);
      else if (code === 'file_too_large') toast.error('Один из файлов больше 50 МБ');
      else toast.error('Не удалось создать заявку: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard className="lg">
      <MHead icon="➕" title="Прямая заявка" subtitle="Создать вручную, без письма" onClose={close} />
      <MBody>
        <Field label="Тема" required>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Кратко — что нужно"
            maxLength={500}
          />
        </Field>
        <Field label="Описание" required>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            maxLength={4000}
            placeholder="Подробности запроса, контекст, сроки…"
          />
        </Field>
        <div className="row gap-10 u-wrap">
          <div style={{ flex: 1, minWidth: 220 }}>
            <Field label="Заказчик (название)">
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                maxLength={200}
              />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Field label="Контакт (email / тел)">
              <Input
                value={customerContact}
                onChange={(e) => setCustomerContact(e.target.value)}
                maxLength={200}
              />
            </Field>
          </div>
        </div>

        {!isPm && (
          <Field label="Назначить РП" required>
            {loadingPms ? (
              <div className="c-t3 fs-12">⏳ Загружаем список РП…</div>
            ) : (
              <Combobox
                value={assignPm}
                onChange={setAssignPm}
                options={pmOptions}
                placeholder="Начните вводить имя РП…"
                aria-label="Выберите РП"
              />
            )}
          </Field>
        )}

        <Field label={`Файлы (макс ${MAX_FILES}, по 50 МБ)`}>
          <input
            type="file"
            multiple
            onChange={onPickFiles}
            className="m-input"
          />
          {files.length > 0 && (
            <div className="col gap-4 mt-8">
              {files.map((f, i) => (
                <div key={i} className="row-spread gap-8 p-6" style={{ background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)' }}>
                  <span className="fs-12 ellipsis flex-1" title={f.name}>📎 {f.name}</span>
                  <span className="fs-11 c-t3">{Math.round(f.size / 1024)} KB</span>
                  <Btn variant="ghost" onClick={() => removeFile(i)} aria-label="Удалить файл">×</Btn>
                </div>
              ))}
            </div>
          )}
        </Field>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving || title.trim().length < 2 || !body.trim() || !assignPm}>
          {saving ? '…' : 'Создать заявку'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
