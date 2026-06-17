/**
 * Модалка создания/редактирования контрагента.
 *
 * Поля: ИНН, КПП, Название (short_with_opf), Полное наименование, ОГРН,
 * Адрес, Телефон, Email, Категория, Комментарий + массив контактов.
 *
 * Источник логики: vanilla `customers.js` renderCard (multi-contact массив строки 98-120,
 * DaData live autocomplete по названию).
 * Идентификатор — `inn`. При редактировании ИНН не меняется.
 *
 * 2 утерянные фичи восстановлены:
 *   1) Live DaData-autocomplete по полю «Название» — debounce 300мс → /api/customers/suggest
 *      → выпадающий список → клик автозаполняет inn/kpp/ogrn/legal_address и др.
 *   2) Multi-contact array (`contacts: [{name, position, phone, email, is_primary}]`)
 *      — секция «👥 Контакты» с per-row add/edit/del и чекбоксом «основной».
 *      Backward compat: legacy `contact_person` конвертируется в [{name, is_primary:true}].
 */
import { useState, useEffect, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import {
  Field, TextInput, INNInput, PhoneInput, TextareaInput, SelectInput, Checkbox
} from '@/inputs/Inputs';
import {
  emailError, phoneError, innError, lengthInRange
} from '@/inputs/validators';
import { toast } from '@/modals/Notifications';
import { useDebounce } from '@/api/useListHelpers';
import {
  createCustomer, updateCustomer, lookupByInn, suggestCustomers, isValidInn, normInn
} from './api';

const CATEGORIES = [
  { value: '',           label: '— не указано —' },
  { value: 'oil_gas',    label: 'Нефтегаз' },
  { value: 'energy',     label: 'Энергетика' },
  { value: 'metallurgy', label: 'Металлургия' },
  { value: 'chem',       label: 'Химпром' },
  { value: 'construction', label: 'Стройка' },
  { value: 'other',      label: 'Другое' }
];

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:customers:changed'));
}

// ── Backward-compat: legacy contact_person → массив ───────────────────────
// Если у заказчика contacts[] пустой, но есть legacy contact_person —
// делаем из него один контакт с is_primary=true (чтобы данные не потерялись).
function initialContacts(customer) {
  const arr = Array.isArray(customer?.contacts) ? customer.contacts : [];
  if (arr.length) {
    return arr.map((c) => ({
      name:       String(c?.name || ''),
      position:   String(c?.position || ''),
      phone:      String(c?.phone || ''),
      email:      String(c?.email || ''),
      is_primary: !!c?.is_primary
    }));
  }
  if (customer?.contact_person && String(customer.contact_person).trim()) {
    return [{
      name:       String(customer.contact_person).trim(),
      position:   '',
      phone:      String(customer.phone || ''),
      email:      String(customer.email || ''),
      is_primary: true
    }];
  }
  return [];
}

export function CustomerEditModal({ customer, onSaved }) {
  const { close } = useModal();
  const isEdit = !!customer?.inn;

  const [form, setForm] = useState({
    inn:            customer?.inn || '',
    kpp:            customer?.kpp || '',
    name:           customer?.name || '',
    full_name:      customer?.full_name || '',
    ogrn:           customer?.ogrn || '',
    address:        customer?.address || '',
    phone:          customer?.phone || '',
    email:          customer?.email || '',
    category:       customer?.category || '',
    notes:          customer?.notes || ''
  });
  const [contacts, setContacts] = useState(() => initialContacts(customer));
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);

  // ── DaData live-autocomplete по полю «Название» ─────────────────────────
  const [suggestions, setSuggestions] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  // Активный индекс для клавиатурной навигации стрелками.
  const [activeIdx, setActiveIdx] = useState(-1);
  const dQuery = useDebounce(suggestQuery, 300);
  const nameWrapRef = useRef(null);
  // Защита от показа просроченных suggestions: помечаем «откатан» при выборе/ESC
  // и игнорируем подсказки, если выбор уже сделан.
  const ignoreUntilChangeRef = useRef(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Debounced fetch при изменении dQuery (если поле активно).
  useEffect(() => {
    if (ignoreUntilChangeRef.current) return;
    const q = (dQuery || '').trim();
    if (!suggestOpen || q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    setSuggestBusy(true);
    suggestCustomers(q)
      .then((list) => {
        if (cancelled) return;
        setSuggestions(Array.isArray(list) ? list : []);
        setActiveIdx(-1);
      })
      .finally(() => { if (!cancelled) setSuggestBusy(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dQuery, suggestOpen]);

  // Закрытие dropdown по клику снаружи.
  useEffect(() => {
    if (!suggestOpen) return;
    const onDocClick = (e) => {
      if (!nameWrapRef.current) return;
      if (!nameWrapRef.current.contains(e.target)) {
        setSuggestOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [suggestOpen]);

  const handleNameChange = (v) => {
    set('name', v);
    setSuggestQuery(v);
    ignoreUntilChangeRef.current = false;
    if (!suggestOpen) setSuggestOpen(true);
  };

  const applySuggestion = (s) => {
    setForm((f) => ({
      ...f,
      // ИНН не трогаем при редактировании (поле disabled)
      inn:       isEdit ? f.inn : (s.inn || f.inn),
      name:      s.name || f.name,
      full_name: s.full_name || f.full_name,
      kpp:       s.kpp || f.kpp,
      ogrn:      s.ogrn || f.ogrn,
      address:   s.address || f.address,
      // phone/email из DaData редко приходят, но если есть — подставляем.
      phone:     s.phone || f.phone,
      email:     s.email || f.email
    }));
    setSuggestOpen(false);
    setSuggestions([]);
    setActiveIdx(-1);
    ignoreUntilChangeRef.current = true;
    toast.success('Данные подставлены из ЕГРЮЛ');
  };

  const onNameKeyDown = (e) => {
    if (!suggestOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setSuggestOpen(false);
      setActiveIdx(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && activeIdx >= 0 && suggestions[activeIdx]) {
      e.preventDefault();
      applySuggestion(suggestions[activeIdx]);
    }
  };

  const doLookup = async () => {
    if (!isValidInn(form.inn)) {
      toast.warn('ИНН должен быть 10 или 12 цифр');
      return;
    }
    setLookupBusy(true);
    try {
      const res = await lookupByInn(normInn(form.inn));
      if (res.found && res.suggestion) {
        const s = res.suggestion;
        setForm((f) => ({
          ...f,
          name:      s.name || f.name,
          full_name: s.full_name || f.full_name,
          kpp:       s.kpp || f.kpp,
          ogrn:      s.ogrn || f.ogrn,
          address:   s.address || f.address
        }));
        toast.success('Данные обновлены из ЕГРЮЛ');
      } else {
        toast.warn(res.message || 'Организация не найдена');
      }
    } catch (e) {
      toast.error('ДаДата: ' + (e?.message || e));
    } finally {
      setLookupBusy(false);
    }
  };

  // ── Multi-contact: операции массива ─────────────────────────────────────
  const addContact = () => {
    setContacts((arr) => {
      const next = [...arr, { name: '', position: '', phone: '', email: '', is_primary: arr.length === 0 }];
      return next;
    });
  };
  const updateContact = (idx, patch) => {
    setContacts((arr) => arr.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };
  const removeContact = (idx) => {
    setContacts((arr) => {
      const next = arr.filter((_, i) => i !== idx);
      // Если удалили primary — назначим первым оставшимся.
      if (next.length && !next.some((c) => c.is_primary)) next[0].is_primary = true;
      return next;
    });
  };
  const setPrimary = (idx) => {
    setContacts((arr) => arr.map((c, i) => ({ ...c, is_primary: i === idx })));
  };

  // ── Per-field валидация ─────────────────────────────────────────────────
  const fieldErrors = {
    inn:   innError(form.inn),
    email: emailError(form.email),
    phone: phoneError(form.phone),
    kpp:   form.kpp && form.kpp.length !== 9 ? 'КПП — 9 цифр' : null,
    ogrn:  form.ogrn && form.ogrn.length !== 13 && form.ogrn.length !== 15 ? 'ОГРН — 13 (юр.лицо) или 15 (ИП) цифр' : null,
    name:  lengthInRange(form.name, null, 255)
  };
  // Валидация контактов: email и телефон в каждой строке.
  const contactErrors = contacts.map((c) => ({
    email: c.email ? emailError(c.email) : null,
    phone: c.phone ? phoneError(c.phone) : null
  }));
  const hasContactErr = contactErrors.some((e) => e.email || e.phone);
  const hasFieldErr = Object.values(fieldErrors).some(Boolean) || hasContactErr;

  const save = async () => {
    if (!isValidInn(form.inn)) {
      return toast.warn('ИНН должен быть 10 или 12 цифр (с правильной контрольной суммой)');
    }
    if (!form.name.trim() && !form.full_name.trim()) {
      return toast.warn('Укажите наименование организации');
    }
    if (fieldErrors.email) return toast.warn(fieldErrors.email);
    if (fieldErrors.phone) return toast.warn(fieldErrors.phone);
    if (fieldErrors.kpp)   return toast.warn(fieldErrors.kpp);
    if (fieldErrors.ogrn)  return toast.warn(fieldErrors.ogrn);
    if (hasContactErr)     return toast.warn('Проверьте контакты — есть невалидный email или телефон');

    // Нормализуем контакты: убираем пустые строки.
    const cleanContacts = contacts
      .map((c) => ({
        name:       (c.name || '').trim(),
        position:   (c.position || '').trim(),
        phone:      (c.phone || '').trim(),
        email:      (c.email || '').trim(),
        is_primary: !!c.is_primary
      }))
      .filter((c) => c.name || c.phone || c.email);

    setBusy(true);
    try {
      // Legacy `contact_person`: дублируем primary-контакт для обратной совместимости со старыми
      // местами CRM, которые читают одно строковое поле (DetailModal вывод, старые отчёты, vanilla).
      const primary = cleanContacts.find((c) => c.is_primary) || cleanContacts[0];
      const legacyContactPerson = primary
        ? [primary.name, primary.position].filter(Boolean).join(' · ')
        : '';

      const payload = {
        inn:            normInn(form.inn),
        name:           form.name.trim(),
        full_name:      form.full_name.trim(),
        kpp:            form.kpp.trim(),
        ogrn:           form.ogrn.trim(),
        address:        form.address.trim(),
        phone:          form.phone.trim(),
        email:          form.email.trim(),
        contact_person: legacyContactPerson,
        contacts:       cleanContacts,
        category:       form.category || null,
        notes:          form.notes.trim()
      };
      let result;
      if (isEdit) {
        result = await updateCustomer(payload.inn, payload);
        toast.success('Контрагент обновлён');
      } else {
        result = await createCustomer(payload);
        toast.success('Контрагент создан');
      }
      emitChanged();
      onSaved?.(result?.customer || payload);
      close();
    } catch (e) {
      toast.error(isEdit ? 'Не удалось обновить: ' + (e?.message || e) : 'Не удалось создать: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-wide">
      <MHead
        icon={isEdit ? '✎' : '➕'}
        title={isEdit ? 'Редактировать контрагента' : 'Новый контрагент'}
        subtitle={isEdit ? `ИНН ${customer?.inn}` : 'Подскажем из ДаДата — по ИНН или названию'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
            <Field label="ИНН" required help="10 цифр (юр.лицо) или 12 (ИП)" error={fieldErrors.inn}>
              <INNInput
                value={form.inn}
                onChange={(v) => set('inn', v)}
                disabled={isEdit}
              />
            </Field>
            <Field label="КПП" error={fieldErrors.kpp}>
              <TextInput
                value={form.kpp}
                onChange={(v) => set('kpp', v.replace(/\D/g, '').slice(0, 9))}
                placeholder="9 цифр"
                maxLength={9}
              />
            </Field>
            <Btn
              variant="ghost"
              disabled={lookupBusy || !isValidInn(form.inn)}
              onClick={doLookup}
              title="Обновить данные из ДаДата (ЕГРЮЛ по ИНН)"
            >
              {lookupBusy ? '⏳' : '🔄 ЕГРЮЛ'}
            </Btn>
          </div>

          {/* ── Название с live DaData autocomplete ──────────────────── */}
          <div className="cust-name-field" ref={nameWrapRef}>
            <Field label="Название (краткое)" required help="Начни вводить — подскажем из ЕГРЮЛ">
              <TextInput
                value={form.name}
                onChange={handleNameChange}
                onFocus={() => {
                  if ((form.name || '').trim().length >= 2) {
                    setSuggestQuery(form.name);
                    setSuggestOpen(true);
                  }
                }}
                onKeyDown={onNameKeyDown}
                placeholder='ООО «Ромашка»'
                autoComplete="off"
              />
            </Field>
            {suggestOpen && (suggestBusy || suggestions.length > 0) && (
              <div className="cust-name-dd" role="listbox" aria-label="Подсказки ЕГРЮЛ">
                {suggestBusy && suggestions.length === 0 && (
                  <div className="cust-name-dd-empty">⏳ Ищем в ЕГРЮЛ…</div>
                )}
                {suggestions.map((s, i) => (
                  <button
                    type="button"
                    key={(s.inn || '') + '-' + i}
                    role="option"
                    aria-selected={i === activeIdx}
                    className={'cust-name-dd-i' + (i === activeIdx ? ' active' : '')}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => applySuggestion(s)}
                  >
                    <div className="cust-name-dd-title">{s.name || s.full_name || '—'}</div>
                    <div className="cust-name-dd-meta">
                      <span className="cust-name-dd-inn">ИНН {s.inn || '—'}</span>
                      {s.kpp && <span> · КПП {s.kpp}</span>}
                      {s.address && <span className="cust-name-dd-addr"> · {s.address}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Field label="Наименование (полное)">
            <TextInput
              value={form.full_name}
              onChange={(v) => set('full_name', v)}
              placeholder='Общество с ограниченной ответственностью «Ромашка»'
            />
          </Field>

          <div className="grid-2 gap-10">
            <Field label="ОГРН" error={fieldErrors.ogrn}>
              <TextInput
                value={form.ogrn}
                onChange={(v) => set('ogrn', v.replace(/\D/g, '').slice(0, 15))}
                placeholder="13 или 15 цифр"
                maxLength={15}
              />
            </Field>
            <Field label="Категория">
              <SelectInput
                value={form.category}
                onChange={(v) => set('category', v)}
                options={CATEGORIES}
              />
            </Field>
          </div>

          <Field label="Адрес">
            <TextInput
              value={form.address}
              onChange={(v) => set('address', v)}
              placeholder="г. Москва, ул…"
            />
          </Field>

          <div className="grid-2 gap-10">
            <Field label="Телефон" error={fieldErrors.phone}>
              <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} />
            </Field>
            <Field label="Email" error={fieldErrors.email}>
              <TextInput
                type="email"
                value={form.email}
                onChange={(v) => set('email', v)}
                placeholder="info@example.ru"
              />
            </Field>
          </div>

          {/* ── Multi-contact array ────────────────────────────────── */}
          <div className="cust-contacts-sec">
            <div className="cust-contacts-head">
              <div className="cust-contacts-title">
                👥 Контакты
                <span className="cust-contacts-count">
                  {contacts.length === 0
                    ? 'не добавлены'
                    : `${contacts.length} ${pluralizeContacts(contacts.length)}`}
                </span>
              </div>
              <Btn variant="ghost" size="sm" onClick={addContact}>+ Добавить контакт</Btn>
            </div>

            {contacts.length === 0 ? (
              <div className="cust-contacts-empty">
                Добавьте сотрудников заказчика — менеджер, бухгалтер, технадзор…
              </div>
            ) : (
              <div className="cust-contacts-list">
                {contacts.map((c, idx) => {
                  const err = contactErrors[idx] || {};
                  return (
                    <div key={idx} className={'cust-contact-row' + (c.is_primary ? ' is-primary' : '')}>
                      <div className="cust-contact-grid">
                        <Field label="ФИО">
                          <TextInput
                            value={c.name}
                            onChange={(v) => updateContact(idx, { name: v })}
                            placeholder="Иванов Иван Иванович"
                          />
                        </Field>
                        <Field label="Должность">
                          <TextInput
                            value={c.position}
                            onChange={(v) => updateContact(idx, { position: v })}
                            placeholder="Главный инженер"
                          />
                        </Field>
                        <Field label="Телефон" error={err.phone}>
                          <PhoneInput
                            value={c.phone}
                            onChange={(v) => updateContact(idx, { phone: v })}
                          />
                        </Field>
                        <Field label="Email" error={err.email}>
                          <TextInput
                            type="email"
                            value={c.email}
                            onChange={(v) => updateContact(idx, { email: v })}
                            placeholder="ivanov@example.ru"
                          />
                        </Field>
                      </div>
                      <div className="cust-contact-actions">
                        <Checkbox
                          checked={c.is_primary}
                          onChange={() => setPrimary(idx)}
                          label="Основной"
                        />
                        <Btn
                          variant="ghost"
                          size="sm"
                          onClick={() => removeContact(idx)}
                          title="Удалить контакт"
                          aria-label="Удалить контакт"
                        >🗑</Btn>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Field label="Комментарий">
            <TextareaInput
              value={form.notes}
              onChange={(v) => set('notes', v)}
              placeholder="Любые заметки по контрагенту"
              minRows={2}
              maxRows={6}
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy || hasFieldErr} onClick={save}>
          {busy ? 'Сохраняем…' : isEdit ? '💾 Сохранить' : '✓ Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function pluralizeContacts(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'контактов';
  if (b > 1 && b < 5) return 'контакта';
  if (b === 1) return 'контакт';
  return 'контактов';
}
