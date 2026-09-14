/**
 * Форма создания / редактирования доверенности — одна модалка с секциями.
 */
import { useEffect, useMemo, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import {
  TextInput, TextareaInput, DatePicker, SelectInput, SearchInput
} from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';

import {
  FIELD_LABELS, STATUS_OPTIONS, findType,
  createProxy, updateProxy, nextNumber,
  downloadDocx, uploadProxyFile,
  loadPowerPresets, employeeToForm, buildPayload, toGenitiveFioClient,
  buildPolishContext
} from './api';
import { ProxyPolishSheet } from './ProxyPolishSheet';
import { ProxyPreviewModal } from './ProxyPreviewModal';

function emit() { window.dispatchEvent(new CustomEvent('asgard:proxies:changed')); }

function PolishBtn({ value, label, context, onApply }) {
  const { open } = useModal();
  return (
    <button
      type="button"
      className="prx-polish-btn"
      title="Мимир поправит грамматику"
      onClick={() => open(
        <ProxyPolishSheet text={value} fieldLabel={label} context={context} onApply={onApply} />
      )}
    >
      ✨
    </button>
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function ProxyEditModal({ type, proxy, onSaved, copyFrom }) {
  const { close, open } = useModal();
  const isEdit = !!proxy?.id && !copyFrom;
  const t = useMemo(
    () => type || findType(proxy?.type_id || proxy?.type || copyFrom?.type_id),
    [type, proxy, copyFrom]
  );
  const src = copyFrom || proxy || {};
  const initialFio = src.fio || src.employee_name || '';

  const [form, setForm] = useState(() => ({
    type_id: t.id,
    number: copyFrom ? '' : (src.number || ''),
    issue_date: (src.issue_date || todayIso()).toString().slice(0, 10),
    valid_from: (src.valid_from || src.issue_date || todayIso()).toString().slice(0, 10),
    valid_until: (src.valid_until || '').toString().slice(0, 10),
    status: copyFrom ? 'draft' : (src.status === 'revoked' ? 'annulled' : (src.status || 'created')),
    source: src.source || 'crm',
    employee_id: src.employee_id || null,
    fio: initialFio,
    fio_genitive: src.fio_genitive || toGenitiveFioClient(initialFio),
    birth_date: (src.birth_date || '').toString().slice(0, 10),
    passport_series: src.passport_series || '',
    passport_number: src.passport_number || '',
    passport_issued: src.passport_issued || '',
    passport_date: (src.passport_date || '').toString().slice(0, 10),
    passport_code: src.passport_code || '',
    registration_address: src.registration_address || src.address || '',
    phone: src.phone || '',
    powers_text: src.powers_text || src.powers_general || '',
    vehicle_brand: src.vehicle_brand || '',
    vehicle_number: src.vehicle_number || '',
    vin: src.vin || '',
    bank_name: src.bank_name || '',
    account_number: src.account_number || '',
    tender_subject: src.description || '',
    counterparty: src.supplier || '',
    region: src.region || '',
    original_handed_to: src.original_handed_to || '',
    notary_number: src.notary_number || '',
    comment: src.comment || '',
    signatory: src.signatory || '',
    issue_place: src.issue_place || 'г. Москва',
    allow_redelegation: !!src.allow_redelegation
  }));

  const [manualPerson, setManualPerson] = useState(!src.employee_id);
  const [genitiveLocked, setGenitiveLocked] = useState(!!src.fio_genitive && !copyFrom);
  const [empQ, setEmpQ] = useState('');
  const [empResults, setEmpResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [presets, setPresets] = useState([]);
  const [saving, setSaving] = useState(false);
  const [signedFile, setSignedFile] = useState(null);

  const set = (k, v) => {
    setForm((s) => {
      const next = { ...s, [k]: v };
      if (k === 'fio' && !genitiveLocked) next.fio_genitive = toGenitiveFioClient(v);
      return next;
    });
  };

  useEffect(() => {
    if (!form.powers_text && t?.id) {
      api('/api/proxies/types').then((d) => {
        const found = (d.types || []).find((x) => x.id === t.id);
        if (found?.defaultPowers) set('powers_text', found.defaultPowers);
      }).catch(() => {});
    }
    if (t.id === 'custom') {
      loadPowerPresets().then(setPresets).catch(() => setPresets([]));
    }
    if (!form.number && !isEdit) {
      nextNumber(form.issue_date).then((n) => set('number', n)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = empQ.trim();
    if (manualPerson || q.length < 2) {
      setEmpResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api(`/api/staff/employees?search=${encodeURIComponent(q)}&limit=15`);
        setEmpResults(Array.isArray(r) ? r : (r?.employees || r?.items || []));
      } catch {
        setEmpResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [empQ, manualPerson]);

  const pickEmployee = (emp) => {
    const patch = employeeToForm(emp);
    setGenitiveLocked(false);
    setForm((s) => ({ ...s, ...patch }));
    setEmpQ(patch.fio || '');
    setEmpResults([]);
    setManualPerson(false);
  };

  const clearEmployee = () => {
    setForm((s) => ({
      ...s,
      employee_id: null,
      fio: '',
      fio_genitive: '',
      birth_date: '',
      passport_series: '',
      passport_number: '',
      passport_issued: '',
      passport_date: '',
      passport_code: '',
      registration_address: '',
      phone: ''
    }));
    setEmpQ('');
    setManualPerson(true);
  };

  const validate = () => {
    if (!form.fio?.trim()) {
      toast.error('Укажите ФИО представителя');
      return false;
    }
    if (!form.issue_date) {
      toast.error('Укажите дату выдачи');
      return false;
    }
    if (!form.valid_until) {
      toast.error('Укажите срок действия');
      return false;
    }
    if (!form.powers_text?.trim() && form.source !== 'external') {
      toast.error('Укажите полномочия');
      return false;
    }
    if (form.source !== 'external') {
      if (!form.passport_series?.trim() || !form.passport_number?.trim()) {
        toast.error('Укажите серию и номер паспорта — без них бланк не готов к печати');
        return false;
      }
      if (!form.registration_address?.trim()) {
        toast.error('Укажите адрес регистрации');
        return false;
      }
    }
    return true;
  };

  const save = async () => {
    if (!validate()) return null;
    setSaving(true);
    try {
      const payload = buildPayload(form, t);
      if (copyFrom) payload.status = payload.status || 'draft';
      const saved = isEdit
        ? await updateProxy(proxy.id, payload)
        : await createProxy(payload);
      if (signedFile && saved?.id) {
        await uploadProxyFile(saved.id, signedFile, 'signed');
      }
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

  const onPreview = () => {
    if (!validate()) return;
    open(
      <ProxyPreviewModal
        form={buildPayload(form, t)}
        number={form.number}
      />
    );
  };

  const polishCtx = useMemo(() => buildPolishContext(form, t), [form, t]);

  const onSaveDownload = async () => {
    const r = await save();
    if (!r?.id) return;
    try {
      await downloadDocx(r.id);
      toast.success('Сохранено и скачано');
      close();
    } catch (e) {
      toast.error('Сохранено, но скачивание не удалось: ' + (e?.message || e));
    }
  };

  const extraFields = t.fields || [];

  return (
    <MCard className="modal-wide">
      <MHead
        title={isEdit ? 'Доверенность' : (copyFrom ? 'Копия доверенности' : 'Новая доверенность')}
        subtitle={t.label}
        accent="info"
        onClose={close}
      />
      <MBody>
        <div className="prx-form col gap-18">
          <section className="prx-sec">
            <div className="prx-sec-title">Документ</div>
            <div className="grid-2 gap-10">
              <Field label="Номер">
                <TextInput value={form.number} onChange={(v) => set('number', v)} placeholder="YYMMDD/NN" />
              </Field>
              <Field label="Статус">
                <SelectInput value={form.status} onChange={(v) => set('status', v)} options={STATUS_OPTIONS} />
              </Field>
              <Field label="Дата выдачи">
                <DatePicker value={form.issue_date} onChange={(v) => set('issue_date', v || '')} />
              </Field>
              <Field label="Действует с">
                <DatePicker value={form.valid_from} onChange={(v) => set('valid_from', v || '')} />
              </Field>
              <Field label="Действует до" required>
                <DatePicker value={form.valid_until} onChange={(v) => set('valid_until', v || '')} />
              </Field>
              <Field label="Место выдачи">
                <TextInput value={form.issue_place} onChange={(v) => set('issue_place', v)} />
              </Field>
            </div>
            <label className="prx-check">
              <input
                type="checkbox"
                checked={!!form.allow_redelegation}
                onChange={(e) => set('allow_redelegation', e.target.checked)}
              />
              С правом передоверия
            </label>
          </section>

          <section className="prx-sec">
            <div className="prx-sec-title">Представитель</div>
            <div className="prx-person-mode">
              <button
                type="button"
                className={'prx-mode-btn' + (!manualPerson ? ' is-on' : '')}
                onClick={() => setManualPerson(false)}
              >
                Из Дружины
              </button>
              <button
                type="button"
                className={'prx-mode-btn' + (manualPerson ? ' is-on' : '')}
                onClick={() => { setManualPerson(true); setForm((s) => ({ ...s, employee_id: null })); }}
              >
                Вручную
              </button>
              {form.employee_id ? (
                <button type="button" className="prx-mode-btn" onClick={clearEmployee}>Сбросить</button>
              ) : null}
            </div>

            {!manualPerson && (
              <Field label="Поиск по Дружине">
                <div className="prx-emp-search">
                  <SearchInput
                    value={empQ}
                    onChange={setEmpQ}
                    placeholder="ФИО или телефон…"
                  />
                  {searching && <div className="prx-emp-hint">Ищем…</div>}
                  {empResults.length > 0 && (
                    <div className="prx-emp-list">
                      {empResults.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          className="prx-emp-item"
                          onClick={() => pickEmployee(e)}
                        >
                          <span className="prx-emp-name">{e.full_name || e.name}</span>
                          <span className="prx-emp-meta">{e.phone || e.role || ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
            )}

            <Field label="ФИО" required>
              <TextInput value={form.fio} onChange={(v) => set('fio', v)} placeholder="Иванов Иван Иванович" />
            </Field>
            <Field label="ФИО в родительном (в бланке)">
              <TextInput
                value={form.fio_genitive}
                onChange={(v) => { setGenitiveLocked(true); set('fio_genitive', v); }}
                placeholder="Иванова Ивана Ивановича"
              />
            </Field>
            <div className="grid-2 gap-10">
              <Field label="Дата рождения">
                <DatePicker value={form.birth_date} onChange={(v) => set('birth_date', v || '')} />
              </Field>
              <Field label="Телефон">
                <TextInput value={form.phone} onChange={(v) => set('phone', v)} />
              </Field>
              <Field label="Паспорт серия">
                <TextInput value={form.passport_series} onChange={(v) => set('passport_series', v)} />
              </Field>
              <Field label="Паспорт номер">
                <TextInput value={form.passport_number} onChange={(v) => set('passport_number', v)} />
              </Field>
            </div>
            <Field label="Кем выдан">
              <TextInput value={form.passport_issued} onChange={(v) => set('passport_issued', v)} />
            </Field>
            <div className="grid-2 gap-10">
              <Field label="Дата выдачи паспорта">
                <DatePicker value={form.passport_date} onChange={(v) => set('passport_date', v || '')} />
              </Field>
              <Field label="Код подразделения">
                <TextInput value={form.passport_code} onChange={(v) => set('passport_code', v)} placeholder="770-001" />
              </Field>
            </div>
            <Field label="Адрес регистрации">
              <TextareaInput value={form.registration_address} onChange={(v) => set('registration_address', v)} minRows={2} maxRows={4} />
            </Field>
          </section>

          <section className="prx-sec">
            <div className="prx-sec-title">Полномочия</div>
            {t.id === 'custom' && presets.length > 0 && (
              <Field label="Библиотека текстов">
                <SelectInput
                  value=""
                  onChange={(v) => {
                    const p = presets.find((x) => String(x.id) === String(v));
                    if (p) set('powers_text', p.body);
                  }}
                  options={[
                    { value: '', label: 'Вставить готовый текст…' },
                    ...presets.map((p) => ({ value: String(p.id), label: p.title || ('Preset #' + p.id) }))
                  ]}
                />
              </Field>
            )}
            <div className="prx-field-with-polish">
              <div className="prx-field-label-row">
                <span className="prx-field-label">Текст полномочий <span className="req">*</span></span>
                <PolishBtn
                  value={form.powers_text}
                  label="Текст полномочий"
                  context={polishCtx}
                  onApply={(v) => set('powers_text', v)}
                />
              </div>
              <TextareaInput
                value={form.powers_text}
                onChange={(v) => set('powers_text', v)}
                minRows={4}
                maxRows={12}
                placeholder="Полномочия представителя…"
              />
            </div>
            {extraFields.length > 0 && (
              <div className="grid-2 gap-10">
                {extraFields.map((fld) => (
                  <Field key={fld} label={FIELD_LABELS[fld] || fld}>
                    <TextInput value={form[fld] || ''} onChange={(v) => set(fld, v)} />
                  </Field>
                ))}
              </div>
            )}
          </section>

          <section className="prx-sec">
            <div className="prx-sec-title">Дополнительно</div>
            <div className="grid-2 gap-10">
              <Field label="Регион">
                <TextInput value={form.region} onChange={(v) => set('region', v)} />
              </Field>
              <Field label="Оригинал передан">
                <TextInput value={form.original_handed_to} onChange={(v) => set('original_handed_to', v)} />
              </Field>
              <Field label="Подписант">
                <TextInput value={form.signatory} onChange={(v) => set('signatory', v)} placeholder="Генеральный директор…" />
              </Field>
              <Field label="Нотариальный номер">
                <TextInput value={form.notary_number} onChange={(v) => set('notary_number', v)} />
              </Field>
            </div>
            <Field label="Комментарий">
              <TextInput value={form.comment} onChange={(v) => set('comment', v)} />
            </Field>
          </section>

          <section className="prx-sec">
            <div className="prx-sec-title">Файлы</div>
            {proxy?.signed_file_url && (
              <div className="prx-file-row">
                Подписанный скан: <a href={proxy.signed_file_url} target="_blank" rel="noreferrer">открыть</a>
              </div>
            )}
            {proxy?.external_file_url && (
              <div className="prx-file-row">
                Внешний файл: <a href={proxy.external_file_url} target="_blank" rel="noreferrer">открыть</a>
              </div>
            )}
            <Field label="Прикрепить подписанный скан">
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => setSignedFile(e.target.files?.[0] || null)}
              />
            </Field>
          </section>
        </div>
      </MBody>
      <MFoot align="spread">
        <div className="u-flex gap-8">
          <Btn variant="ghost" onClick={onPreview} disabled={saving}>Предпросмотр</Btn>
        </div>
        <div className="u-flex gap-8">
          <Btn onClick={close} disabled={saving}>Отмена</Btn>
          <Btn variant="primary" onClick={saveAndClose} disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Btn>
          <Btn variant="info" onClick={onSaveDownload} disabled={saving}>
            Сохранить и скачать
          </Btn>
        </div>
      </MFoot>
    </MCard>
  );
}
