import { useState } from 'react';
import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea, Select } from './parts';
import {
  emailError, phoneError, innError, positiveAmountError,
  percentError, rangeError, urlError, lengthInRange, isBlank
} from '@/inputs/validators';

/**
 * Большая форма (создание/редактирование).
 * Пример: новый тендер, новая работа, новый клиент.
 *
 * Описание полей:
 *   { key, label, type?, required?, span?, placeholder?, rows?, options?, help?,
 *     min?, max?, maxLength?, validate? (v, all) => string|null }
 *
 *   type ∈ text|email|phone|inn|number|money|url|percent|date|textarea|select
 *
 * Каждое поле валидируется на blur+submit. Сообщения копятся в `errors`
 * и показываются под полем (через <Field error=...>).
 *
 * G-4 (14.06.2026): добавлена per-field валидация (email/inn/phone/число/url/процент),
 * сообщения об ошибках под полями. Раньше FormModal проверял только required-trim,
 * остальное молча уходило на бэк (получали 400 без объяснения юзеру).
 */
export function FormModal({
  title,
  subtitle,
  icon = '＋',
  accent = 'default',
  fields = [],
  initial = {},
  submitText = 'Сохранить',
  cancelText = 'Отмена',
  onSubmit,
  onCancel,
  children
}) {
  const { close } = useModal();
  const [data, setData] = useState({ ...initial });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const validateField = (f, value, all) => {
    if (f.required && isBlank(value)) return `«${f.label}» обязательно`;
    if (isBlank(value)) return null;
    const v = String(value).trim();
    switch (f.type) {
      case 'email':   return emailError(v);
      case 'phone':   return phoneError(v);
      case 'inn':     return innError(v, f.kind || 'any');
      case 'money':   return positiveAmountError(v, f.label);
      case 'percent': return percentError(v, f.label);
      case 'url':     return urlError(v);
      case 'number':
        return rangeError(v, f.min, f.max, f.label);
      default: break;
    }
    if (f.maxLength) {
      const e = lengthInRange(v, f.minLength, f.maxLength);
      if (e) return e;
    }
    if (typeof f.validate === 'function') {
      return f.validate(value, all);
    }
    return null;
  };

  const validateAll = () => {
    const out = {};
    for (const f of fields) {
      const e = validateField(f, data[f.key], data);
      if (e) out[f.key] = e;
    }
    return out;
  };

  const formErrors = validateAll();
  const hasErrors = Object.keys(formErrors).length > 0;

  const submit = async () => {
    const errs = validateAll();
    setErrors(errs);
    setTouched(Object.fromEntries(fields.map((f) => [f.key, true])));
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await onSubmit?.(data);
      close();
    } catch (e) {
      setSaving(false);
    }
  };

  const onBlur = (k) => setTouched((t) => ({ ...t, [k]: true }));

  return (
    <MCard>
      <MHead icon={icon} title={title} subtitle={subtitle} accent={accent} onClose={() => { onCancel?.(); close(); }} />
      <MBody>
        {children}
        <div className="m-grid-2">
          {fields.map((f, _i) => {
            const span = f.span === 2;
            const showErr = touched[f.key] && formErrors[f.key];
            const errMsg = showErr || errors[f.key];
            return (
              <div key={f.key} style={span ? { gridColumn: 'span 2' } : undefined}>
                <Field label={f.label} required={f.required} help={f.help} error={errMsg}>
                  {f.type === 'textarea' ? (
                    <Textarea
                      value={data[f.key] ?? ''}
                      onChange={(e) => set(f.key, e.target.value)}
                      onBlur={() => onBlur(f.key)}
                      placeholder={f.placeholder}
                      rows={f.rows || 4}
                      maxLength={f.maxLength}
                    />
                  ) : f.type === 'select' ? (
                    <Select
                      value={data[f.key] ?? ''}
                      onChange={(e) => set(f.key, e.target.value)}
                      onBlur={() => onBlur(f.key)}
                    >
                      <option value="">— выбрать —</option>
                      {(f.options || []).map((o) => (
                        typeof o === 'string'
                          ? <option key={o} value={o}>{o}</option>
                          : <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      type={fieldHtmlType(f.type)}
                      value={data[f.key] ?? ''}
                      onChange={(e) => set(f.key, e.target.value)}
                      onBlur={() => onBlur(f.key)}
                      placeholder={f.placeholder}
                      maxLength={f.maxLength}
                      inputMode={fieldInputMode(f.type)}
                    />
                  )}
                </Field>
              </div>
            );
          })}
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => { onCancel?.(); close(); }}>{cancelText}</Btn>
        <Btn variant="primary" disabled={hasErrors || saving} onClick={submit}>
          {saving ? 'Сохраняем…' : submitText}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function fieldHtmlType(t) {
  switch (t) {
    case 'email': return 'email';
    case 'phone': return 'tel';
    case 'date':  return 'date';
    case 'number':
    case 'money':
    case 'percent':
    case 'inn':   return 'text'; // numeric маска через inputMode + обработчик
    case 'url':   return 'url';
    default: return t || 'text';
  }
}

function fieldInputMode(t) {
  if (t === 'phone') return 'tel';
  if (t === 'number' || t === 'money' || t === 'percent' || t === 'inn') return 'numeric';
  if (t === 'email') return 'email';
  if (t === 'url') return 'url';
  return undefined;
}
