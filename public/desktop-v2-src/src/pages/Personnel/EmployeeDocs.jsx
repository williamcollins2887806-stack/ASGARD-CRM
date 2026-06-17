/**
 * Документы сотрудника: военный билет, водительское удостоверение,
 * код подразделения, ссылка на папку Drive/Yandex с файлами.
 *
 * Источник: vanilla `employee.js` блок «Документы (файлы)» (строки 381–391)
 *           + блок «Документы» (строки 195–236, поля military_id / driver_license /
 *           passport_code / passport_issued / passport_date).
 *
 * Endpoints:
 *   PUT /api/staff/employees/:id  (EMPLOYEE_COLS на бэке принимает military_id,
 *                                  driver_license, passport_code, passport_issued,
 *                                  passport_date, docs_url — поле `docs_url` у нас
 *                                  играет роль docs_folder_link)
 *
 * Внимание: ссылка на папку приклеена к полю `docs_url` (whitelist EMPLOYEE_COLS,
 * см. src/routes/staff.js:8). Поля `docs_folder_link` в схеме нет — оно
 * использовалось в IndexedDB и при миграции к Postgres превратилось в `docs_url`.
 */
import { useEffect, useState } from 'react';
import { Btn, Field } from '@/modals/parts';
import { TextInput, DatePicker } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { updateEmployee } from './api';

const DOC_FIELDS = [
  { id: 'military_id',     label: 'Военный билет',           placeholder: '№, категория',         type: 'text' },
  { id: 'driver_license',  label: 'Водительское удостоверение', placeholder: 'Категории, срок',    type: 'text' },
  { id: 'passport_code',   label: 'Код подразделения',       placeholder: '123-456',             type: 'text' },
  { id: 'passport_issued', label: 'Паспорт: кем выдан',      placeholder: 'ОУФМС…',              type: 'text' },
  { id: 'passport_date',   label: 'Паспорт: дата выдачи',    placeholder: '',                    type: 'date' },
  { id: 'docs_url',        label: 'Ссылка на папку документов', placeholder: 'https://drive.google.com/…', type: 'text' },
];

function dateOnly(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  return '';
}

export function EmployeeDocs({ employee, canEdit, onSaved }) {
  const e = employee || {};
  const [form, setForm] = useState({
    military_id: e.military_id || '',
    driver_license: e.driver_license || '',
    passport_code: e.passport_code || '',
    passport_issued: e.passport_issued || '',
    passport_date: dateOnly(e.passport_date),
    docs_url: e.docs_url || e.docs_folder_link || '',
  });
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Сбрасываем форму, если employee сменился (после refresh()).
  useEffect(() => {
    setForm({
      military_id: e.military_id || '',
      driver_license: e.driver_license || '',
      passport_code: e.passport_code || '',
      passport_issued: e.passport_issued || '',
      passport_date: dateOnly(e.passport_date),
      docs_url: e.docs_url || e.docs_folder_link || '',
    });
    setDirty(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, e.updated_at]);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = {};
      Object.entries(form).forEach(([k, v]) => {
        payload[k] = typeof v === 'string' ? (v.trim() || null) : v;
      });
      await updateEmployee(employee.id, payload);
      toast.success('Документы сохранены');
      setDirty(false);
      onSaved?.();
    } catch (err) {
      toast.error('Ошибка: ' + (err?.serverMsg || err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="emp-docs">
      <div className="emp-docs-grid">
        {DOC_FIELDS.map((f) => (
          <Field key={f.id} label={f.label}>
            {f.type === 'date' ? (
              <DatePicker
                value={form[f.id]}
                onChange={(v) => set(f.id, v || '')}
              />
            ) : (
              <TextInput
                value={form[f.id]}
                onChange={(v) => set(f.id, v)}
                placeholder={f.placeholder}
                disabled={!canEdit}
              />
            )}
          </Field>
        ))}
      </div>

      {form.docs_url && (
        <div className="emp-docs-folder">
          <a
            className="m-btn ghost"
            href={form.docs_url}
            target="_blank"
            rel="noreferrer"
            title="Открыть папку"
          >📁 Открыть папку документов</a>
        </div>
      )}

      {canEdit && (
        <div className="emp-docs-foot">
          <Btn
            variant="primary"
            size="sm"
            disabled={!dirty || busy}
            onClick={save}
          >
            {busy ? 'Сохраняем…' : '💾 Сохранить документы'}
          </Btn>
        </div>
      )}
    </div>
  );
}
