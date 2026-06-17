/**
 * Модалка создания / редактирования доверенности.
 * Поля рендерятся по type.fields (из шаблона PROXY_TYPES).
 */
import { useState, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import {
  TextInput, TextareaInput, DatePicker
} from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';

import {
  FIELD_LABELS, FIELD_PLACEHOLDERS, TEXTAREA_FIELDS,
  createProxy, updateProxy, downloadDoc
} from './api';

function emit() { window.dispatchEvent(new CustomEvent('asgard:proxies:changed')); }

export function ProxyEditModal({ type, proxy, onSaved }) {
  const { close } = useModal();
  const isEdit = !!proxy?.id;

  // Список полей, который шёл из конкретного шаблона
  const fieldKeys = useMemo(() => {
    const base = type?.fields || ['fio', 'passport', 'powers_general', 'description'];
    // Гарантируем уникальность
    return Array.from(new Set(base));
  }, [type]);

  const [form, setForm] = useState(() => {
    const f = {
      number:      proxy?.number || '',
      issue_date:  (proxy?.issue_date || '').slice(0, 10),
      valid_until: (proxy?.valid_until || '').slice(0, 10)
    };
    for (const k of fieldKeys) f[k] = proxy?.[k] || '';
    return f;
  });
  const [saving, setSaving] = useState(false);
  // Мимир-автозаполнение — vanilla proxies.js:485-540. Зовём backend
  // POST /api/mimir/suggest-form, заполняем только пустые поля (чтобы не затирать
  // то что юзер уже ввёл). Без typewriter-эффекта — короткая прямая запись.
  const [mimirBusy, setMimirBusy] = useState(false);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const askMimir = async () => {
    setMimirBusy(true);
    try {
      const data = await api('/api/mimir/suggest-form', {
        method: 'POST',
        body: {
          form_type: 'proxy',
          context: {
            proxy_type: type?.label || proxy?.type || 'Общая',
            existing_fields: Object.fromEntries(
              Object.entries(form).filter(([, v]) => String(v || '').trim().length > 0)
            )
          }
        }
      });
      const suggested = data?.fields || data?.suggested || {};
      let filled = 0;
      setForm((s) => {
        const next = { ...s };
        for (const fld of fieldKeys) {
          const v = suggested[fld];
          if (v && String(v).trim() && !String(next[fld] || '').trim()) {
            next[fld] = String(v);
            filled++;
          }
        }
        return next;
      });
      if (filled > 0) toast.success(`Мимир заполнил ${filled} ${filled === 1 ? 'поле' : 'поля'}`);
      else toast.info('Мимиру нечего добавить — все поля уже заполнены');
    } catch (e) {
      toast.error('Мимир не справился: ' + (e?.message || e));
    } finally {
      setMimirBusy(false);
    }
  };

  const save = async (extraFlags = {}) => {
    if (!form.fio?.trim()) {
      toast.error('Укажите ФИО доверенного лица');
      return null;
    }
    setSaving(true);
    try {
      const payload = {
        type: type?.label || proxy?.type || 'Общая',
        number: form.number.trim() || null,
        issue_date: form.issue_date || null,
        valid_until: form.valid_until || null,
        status: 'active',
        ...Object.fromEntries(
          fieldKeys.map((k) => [k, String(form[k] || '').trim() || null])
        ),
        ...extraFlags
      };
      const saved = isEdit ? await updateProxy(proxy.id, payload) : await createProxy(payload);
      toast.success(isEdit ? 'Доверенность обновлена' : 'Доверенность создана');
      emit();
      onSaved?.(saved);
      return saved;
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveAndClose = async () => {
    const r = await save();
    if (r) close();
  };

  const saveAndDownload = async () => {
    const r = await save();
    if (r) {
      downloadDoc({ ...form, type: type?.label }, type);
      close();
    }
  };

  const previewDoc = () => {
    downloadDoc({ ...form, type: type?.label }, type);
  };

  return (
    <MCard className="modal-wide">
      <MHead
        icon={type?.icon || '📜'}
        title={isEdit ? 'Редактирование доверенности' : 'Новая доверенность'}
        subtitle={type?.label}
        accent="info"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Номер доверенности">
            <TextInput value={form.number} onChange={(v) => set('number', v)} placeholder="ДОВ-001" />
          </Field>
          <div className="grid-2 gap-10">
            <Field label="Дата выдачи">
              <DatePicker value={form.issue_date} onChange={(v) => set('issue_date', v || '')} />
            </Field>
            <Field label="Действует до">
              <DatePicker value={form.valid_until} onChange={(v) => set('valid_until', v || '')} />
            </Field>
          </div>

          {fieldKeys.map((fld) => {
            const label = FIELD_LABELS[fld] || fld;
            const ph = FIELD_PLACEHOLDERS[fld] || '';
            const required = fld === 'fio';
            const isTextarea = TEXTAREA_FIELDS.has(fld);
            return (
              <Field key={fld} label={label} required={required}>
                {isTextarea ? (
                  <TextareaInput
                    value={form[fld] || ''}
                    onChange={(v) => set(fld, v)}
                    placeholder={ph}
                    minRows={2}
                    maxRows={6}
                  />
                ) : (
                  <TextInput
                    value={form[fld] || ''}
                    onChange={(v) => set(fld, v)}
                    placeholder={ph}
                  />
                )}
              </Field>
            );
          })}
        </div>
      </MBody>
      <MFoot align="spread">
        <div className="u-flex gap-8">
          <Btn variant="ghost" onClick={previewDoc} disabled={saving}>📄 Скачать .doc</Btn>
          <Btn variant="ghost" onClick={askMimir} disabled={saving || mimirBusy}>
            {mimirBusy ? '🧙 Мимир думает…' : '🧙 Мимир, заполни'}
          </Btn>
        </div>
        <div className="u-flex gap-8">
          <Btn onClick={close} disabled={saving}>Отмена</Btn>
          <Btn variant="primary" onClick={saveAndClose} disabled={saving}>
            {saving ? 'Сохраняем…' : isEdit ? '💾 Сохранить' : '✓ Создать'}
          </Btn>
          <Btn variant="info" onClick={saveAndDownload} disabled={saving}>
            ✓ Создать + .doc
          </Btn>
        </div>
      </MFoot>
    </MCard>
  );
}
