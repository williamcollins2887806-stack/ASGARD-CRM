/**
 * Модалка создания / редактирования договора.
 * Поля: номер, тип, контрагент, предмет, даты, бессрочно, сумма, ответственный,
 *       статус (draft / active / terminated), ссылка на файл, комментарий.
 *
 * E-6b (2026-06-14): добавлены DaData lookup/suggest + Мимир suggest-form
 * (vanilla contracts.js «новый контрагент» flow).
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import {
  TextInput, MoneyInput, TextareaInput, SelectInput,
  DatePicker, Switch, Combobox
} from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';

import {
  CONTRACT_TYPES, CONTRACT_STATUSES,
  createContract, updateContract,
  suggestCustomers, lookupCustomerByInn, mimirSuggestForm
} from './api';

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:contracts:changed'));
}

export function ContractEditModal({ contract, customers = [], onSaved }) {
  const { close } = useModal();
  const isEdit = !!contract?.id;

  const [form, setForm] = useState({
    number:            contract?.number || '',
    type:              contract?.type || 'customer',
    counterparty_id:   contract?.counterparty_id ? String(contract.counterparty_id) : '',
    counterparty_name: contract?.counterparty_name || '',
    subject:           contract?.subject || '',
    start_date:        (contract?.start_date || '').slice(0, 10),
    end_date:          (contract?.end_date || '').slice(0, 10),
    is_perpetual:      !!contract?.is_perpetual,
    amount:            contract?.amount ?? '',
    responsible:       contract?.responsible || '',
    status:            contract?.status || 'active',
    file_url:          contract?.file_url || '',
    comment:           contract?.comment || ''
  });
  const [saving, setSaving] = useState(false);

  // E-6b DaData smart-search state
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [innInput, setInnInput] = useState('');
  const [egrulBadge, setEgrulBadge] = useState(null); // { tone:'ok'|'warn', text }
  const [dataDataBusy, setDaDataBusy] = useState(false);
  const [mimirBusy, setMimirBusy] = useState(false);
  const innDebRef = useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // DaData suggest по тексту
  const onSuggestQuery = (q) => {
    setSuggestQuery(q);
    if (!q || /^\d+$/.test(q.trim())) { setSuggestions([]); return; }
    suggestCustomers(q).then((arr) => {
      setSuggestions((arr || []).map((s) => ({
        value: String(s.inn || s.name),
        label: s.name || s.full_name || '—',
        sublabel: 'ИНН ' + (s.inn || '—') + (s.address ? ' · ' + s.address.slice(0, 60) : ''),
        _raw: s
      })));
    });
  };

  const applySuggestion = (raw) => {
    if (!raw) return;
    setForm((f) => ({
      ...f,
      counterparty_id: String(raw.inn || ''),
      counterparty_name: raw.name || raw.full_name || f.counterparty_name
    }));
    if (raw.inn) setInnInput(String(raw.inn));
    setEgrulBadge({ tone: 'ok', text: 'Данные из ЕГРЮЛ' });
  };

  // DaData lookup по точному ИНН
  const onInnChange = (v) => {
    const digits = String(v || '').replace(/\D/g, '').slice(0, 12);
    setInnInput(digits);
    setEgrulBadge(null);
    clearTimeout(innDebRef.current);
    if (digits.length === 10 || digits.length === 12) {
      innDebRef.current = setTimeout(() => doLookup(digits), 350);
    }
  };

  const doLookup = async (innVal) => {
    const inn = (innVal || innInput || '').replace(/\D/g, '');
    if (inn.length !== 10 && inn.length !== 12) {
      toast.error('ИНН должен содержать 10 или 12 цифр');
      return;
    }
    setDaDataBusy(true);
    try {
      const data = await lookupCustomerByInn(inn);
      if (data?.found && data.suggestion) {
        const s = data.suggestion;
        setForm((f) => ({
          ...f,
          counterparty_id: String(s.inn || inn),
          counterparty_name: s.name || s.full_name || f.counterparty_name
        }));
        setEgrulBadge({ tone: 'ok', text: 'Данные загружены из ЕГРЮЛ' });
      } else {
        setEgrulBadge({ tone: 'warn', text: data?.message || 'Не найдено в ЕГРЮЛ' });
      }
    } catch (e) {
      toast.error('Ошибка DaData: ' + (e?.message || e));
    } finally {
      setDaDataBusy(false);
    }
  };

  // Мимир suggest-form: один запрос — БД или AI
  const askMimir = async () => {
    const context = suggestQuery.trim() || form.counterparty_name.trim() || innInput.trim();
    if (!context) {
      toast('Мимир', 'Введи название или ИНН контрагента', 'warn');
      return;
    }
    setMimirBusy(true);
    try {
      const data = await mimirSuggestForm('customer', {
        search_query: context,
        inn: innInput || undefined,
        name: form.counterparty_name || undefined
      });
      const fields = data?.fields || {};
      if (Object.keys(fields).length > 0) {
        setForm((f) => ({
          ...f,
          counterparty_id: String(fields.inn || f.counterparty_id),
          counterparty_name: fields.name || fields.full_name || f.counterparty_name
        }));
        if (fields.inn) setInnInput(String(fields.inn));
        const source = data.source === 'database' ? 'из реестра' : 'через AI';
        toast.success(`Мимир заполнил ${Object.keys(fields).length} полей (${source})`);
        if (data.source === 'database') setEgrulBadge({ tone: 'ok', text: 'Найден в реестре контрагентов' });
      } else if (innInput && (innInput.length === 10 || innInput.length === 12)) {
        // Fallback на DaData lookup
        await doLookup(innInput);
      } else {
        toast('Мимир', 'Не нашёл. Попробуй точный ИНН (10 или 12 цифр).', 'warn');
      }
    } catch (e) {
      toast.error('Мимир: ' + (e?.message || e));
    } finally {
      setMimirBusy(false);
    }
  };

  const counterpartyOpts = useMemo(() => {
    const opts = customers.map((c) => ({
      value: String(c.inn || ''),
      label: (c.name || c.full_name || 'Без названия') + (c.inn ? ' (' + c.inn + ')' : '')
    })).filter((o) => o.value);
    return [{ value: '', label: '— выберите контрагента —' }, ...opts];
  }, [customers]);

  // Если ставим «Бессрочно» — обнуляем end_date
  useEffect(() => {
    if (form.is_perpetual && form.end_date) {
      setForm((f) => ({ ...f, end_date: '' }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.is_perpetual]);

  const dateHint = useMemo(() => {
    if (!form.end_date || form.is_perpetual) return null;
    const end = new Date(form.end_date);
    if (Number.isNaN(end.getTime())) return null;
    const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
    if (days < 0) return { tone: 'err', text: 'Истёк ' + Math.abs(days) + ' дн. назад' };
    if (days <= 30) return { tone: 'warn', text: 'Истекает через ' + days + ' дн.' };
    return { tone: 'ok', text: 'Осталось ' + days + ' дн.' };
  }, [form.end_date, form.is_perpetual]);

  const save = async () => {
    if (!form.number.trim()) {
      toast.error('Укажите номер договора');
      return;
    }
    if (!form.counterparty_id) {
      toast.error('Выберите контрагента');
      return;
    }
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      toast.error('Дата окончания раньше даты заключения');
      return;
    }

    const customer = customers.find((c) => String(c.inn) === String(form.counterparty_id));
    const payload = {
      number:            form.number.trim(),
      type:              form.type,
      counterparty_id:   form.counterparty_id,
      counterparty_name: customer ? (customer.name || customer.full_name || '') : (contract?.counterparty_name || ''),
      subject:           form.subject.trim() || null,
      start_date:        form.start_date || null,
      end_date:          form.is_perpetual ? null : (form.end_date || null),
      is_perpetual:      !!form.is_perpetual,
      amount:            form.amount === '' || form.amount == null ? null : parseFloat(form.amount),
      responsible:       form.responsible.trim() || null,
      status:            form.status,
      file_url:          form.file_url.trim() || null,
      comment:           form.comment.trim() || null
    };

    setSaving(true);
    try {
      const saved = isEdit
        ? await updateContract(contract.id, payload)
        : await createContract(payload);
      toast.success(isEdit ? 'Договор обновлён' : 'Договор создан');
      emitChanged();
      onSaved?.(saved);
      close();
    } catch (e) {
      toast.error(isEdit
        ? 'Не удалось сохранить: ' + (e?.message || e)
        : 'Не удалось создать: ' + (e?.message || e));
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '📄'}
        title={isEdit ? 'Редактирование договора' : 'Новый договор'}
        subtitle={isEdit ? ('№ ' + (contract?.number || '')) : 'Заполните данные договора'}
        accent="info"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <div className="grid-2 gap-10">
            <Field label="Номер договора" required>
              <TextInput value={form.number} onChange={(v) => set('number', v)} placeholder="Д-2026/001" />
            </Field>
            <Field label="Тип" required>
              <SelectInput value={form.type} onChange={(v) => set('type', v)} options={CONTRACT_TYPES} />
            </Field>
          </div>

          {/* E-6b: DaData smart-search + Мимир кнопка */}
          <div className="p-10 bg-inner r-md col gap-8">
            <strong className="mini-kpi-label">🔎 Поиск контрагента (ЕГРЮЛ через DaData)</strong>
            <Field label="Название или ИНН — подсказки появятся при вводе">
              <Combobox
                value={suggestQuery}
                onChange={(v, opt) => { setSuggestQuery(v); if (opt?._raw) applySuggestion(opt._raw); }}
                onQuery={onSuggestQuery}
                options={suggestions}
                placeholder="ООО «Газпром» или 7736050003…"
                allowFreeText
                renderOption={(o) => (
                  <div>
                    <div>{o.label}</div>
                    {o.sublabel && <div className="c-t3 fs-11">{o.sublabel}</div>}
                  </div>
                )}
              />
            </Field>
            <div className="grid-2 gap-10">
              <Field label="ИНН (10/12 цифр — авто-lookup в ЕГРЮЛ)">
                <TextInput
                  value={innInput}
                  onChange={onInnChange}
                  placeholder="7736050003"
                  inputMode="numeric"
                />
              </Field>
              <div className="row gap-6 items-end pb-6">
                <Btn variant="ghost" disabled={dataDataBusy} onClick={() => doLookup()}>{dataDataBusy ? '…' : '🔎 ЕГРЮЛ'}</Btn>
                <Btn variant="ghost" disabled={mimirBusy} onClick={askMimir}>{mimirBusy ? '🧙 Думаю…' : '🧙 Мимир заполнит'}</Btn>
              </div>
            </div>
            {egrulBadge && (
              <div className={'fs-12 p-6 r-sm ' + (egrulBadge.tone === 'ok' ? 'bg-ok-soft c-ok' : 'bg-warn-soft c-warn')}>
                {egrulBadge.tone === 'ok' ? '✓ ' : '⚠ '}{egrulBadge.text}
              </div>
            )}
          </div>

          <Field label="Контрагент" required>
            <SelectInput
              value={form.counterparty_id}
              onChange={(v) => set('counterparty_id', v)}
              options={counterpartyOpts}
            />
          </Field>
          {form.counterparty_name && !form.counterparty_id && (
            <div className="c-t3 fs-12">
              Из ЕГРЮЛ: <b>{form.counterparty_name}</b>{innInput ? ` (ИНН ${innInput})` : ''}
              <br />
              <span className="c-amber">Контрагент ещё не в реестре — сначала добавь его в «Заказчики».</span>
            </div>
          )}

          <Field label="Предмет договора">
            <TextareaInput
              value={form.subject}
              onChange={(v) => set('subject', v)}
              placeholder="Краткое описание предмета договора…"
              minRows={2}
              maxRows={6}
            />
          </Field>

          <div className="grid-2 gap-10">
            <Field label="Дата заключения">
              <DatePicker value={form.start_date} onChange={(v) => set('start_date', v || '')} />
            </Field>
            <Field label="Сумма">
              <MoneyInput value={form.amount} onChange={(v) => set('amount', v)} />
            </Field>
          </div>

          <div className="grid-1-auto gap-10 items-end">
            <Field
              label="Срок действия до"
              help={dateHint ? dateHint.text : undefined}
            >
              <DatePicker
                value={form.end_date}
                onChange={(v) => set('end_date', v || '')}
              />
            </Field>
            <div className="pb-6">
              <Switch
                checked={form.is_perpetual}
                onChange={(v) => set('is_perpetual', v)}
                label="Бессрочный"
              />
            </div>
          </div>

          <div className="grid-2 gap-10">
            <Field label="Ответственный">
              <TextInput
                value={form.responsible}
                onChange={(v) => set('responsible', v)}
                placeholder="ФИО сотрудника"
              />
            </Field>
            <Field label="Статус">
              <SelectInput value={form.status} onChange={(v) => set('status', v)} options={CONTRACT_STATUSES} />
            </Field>
          </div>

          <Field label="Ссылка на файл договора">
            <TextInput
              value={form.file_url}
              onChange={(v) => set('file_url', v)}
              placeholder="https://drive.google.com/…"
            />
          </Field>

          <Field label="Комментарий">
            <TextareaInput
              value={form.comment}
              onChange={(v) => set('comment', v)}
              placeholder="Любые заметки по договору…"
              minRows={2}
              maxRows={6}
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close} disabled={saving}>Отмена</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>
          {saving ? 'Сохраняем…' : isEdit ? '💾 Сохранить' : '✓ Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
