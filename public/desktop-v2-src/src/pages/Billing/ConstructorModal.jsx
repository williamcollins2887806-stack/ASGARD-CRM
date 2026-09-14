/**
 * Конструктор счёта / акта — как ТКП: заказчик, позиции, живой предпросмотр, выставление.
 */
import { useEffect, useMemo, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, INNInput, PhoneInput, TextareaInput, NumberInput, Combobox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  calcTotals, emptyItem, VAT_DEFAULT_PCT, fmtMoney, fmtDate, todayISO, addDaysISO,
  lookupCustomers, customerByInn, loadWorks, loadWork, loadInvoice, loadAct,
  nextInvoiceNumber, nextActNumber, createInvoice, updateInvoice, createAct, updateAct,
  parseItems, previewPdf, previewOffice, buildPayload, emitChanged, loadCompanyProfile, displayText,
  parseIssuer
} from './api';
import { SendDocModal } from './SendDocModal';
import './billing.css';

function Section({ title, children, right }) {
  return (
    <div className="mb-18">
      <div className="bill-section-head">
        <strong className="bill-section-title">{title}</strong>
        {right}
      </div>
      <div className="col gap-10">{children}</div>
    </div>
  );
}

function Check({ ok, label }) {
  return <span className={'bill-check' + (ok ? ' is-ok' : '')}>{ok ? '✓' : '○'} {label}</span>;
}

function DocPaper({ kind, form, totals, company }) {
  const isAct = kind === 'act';
  const items = (form.items || []).filter((it) => String(it.name || '').trim());
  const co = form.issuer || company || {};
  const coName = co.full_name || co.name || 'ООО «Асгард-Сервис»';
  const coMeta = [co.inn && `ИНН ${co.inn}`, co.kpp && `КПП ${co.kpp}`, co.phone].filter(Boolean).join(' · ');
  const hasBank = !!(co.bank_name || co.bank_rs);
  return (
    <div className="bill-paper-wrap">
      <div className="bill-paper-kicker">
        <span>Живой лист</span>
        <span>{isAct ? 'Акт сдачи-приёмки' : 'Счёт на оплату'}</span>
      </div>
      <div className="bill-checks">
        <Check ok={!!String(form.customer_name || '').trim()} label="Заказчик" />
        <Check ok={items.length > 0} label="Позиции" />
        <Check ok={totals.total > 0} label="Сумма" />
        <Check ok={!!form.number} label="Номер" />
      </div>
      <div className="bill-paper">
        <div className="bill-paper-head">
          <div className="bill-brand">
            <img src="/assets/img/asgard_logo.png" alt="АСГАРД-СЕРВИС" />
          </div>
          <div className="bill-co">
            <div className="n">{coName}</div>
            {coMeta ? <div className="m">{coMeta}</div> : null}
          </div>
        </div>
        <div className="bill-paper-rule" />
        <h3>{isAct ? 'Акт сдачи-приёмки выполненных работ' : 'Счёт на оплату'}</h3>
        <div className="numline">
          № {form.number || 'б/н'}  ·  {fmtDate(form.date)}
        </div>
        {!isAct && hasBank ? (
          <div className="bill-bank">
            <div><div className="k">Банк</div>{co.bank_name || '—'}</div>
            <div><div className="k">БИК</div>{co.bank_bik || '—'}</div>
            <div><div className="k">Р/с</div>{co.bank_rs || '—'}</div>
            <div><div className="k">К/с</div>{co.bank_ks || '—'}</div>
          </div>
        ) : null}
        <div className="bill-parties">
          <div className="party">
            <div className="l">{isAct ? 'Исполнитель' : 'Поставщик'}</div>
            <div className="n">{coName}</div>
            <div className="m">{co.address || coMeta || 'реквизиты компании'}</div>
          </div>
          <div className="party">
            <div className="l">{isAct ? 'Заказчик' : 'Покупатель'}</div>
            <div className="n">{form.customer_name || '—'}</div>
            <div className="m">
              {[form.inn && `ИНН ${form.inn}`, form.kpp && `КПП ${form.kpp}`, form.address].filter(Boolean).join(' · ')
                || (form.customer_name ? '' : 'укажите заказчика слева')}
            </div>
          </div>
        </div>
        {form.subject || form.description ? (
          <div className="bill-paper-subject">
            <div className="l">{isAct ? 'Основание / работы' : 'Назначение'}</div>
            <div>{form.subject || form.description}</div>
          </div>
        ) : null}
        <table>
          <thead>
            <tr>
              <th>Наименование</th>
              <th className="r">Ед.</th>
              <th className="r">Кол.</th>
              <th className="r">Цена</th>
              <th className="r">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={5} className="bill-paper-empty">Заполните таблицу слева — строки появятся здесь</td></tr>
            ) : items.map((it, i) => (
              <tr key={it.id || i}>
                <td>{it.name || '—'}</td>
                <td className="r">{it.unit || ''}</td>
                <td className="r">{it.qty || 0}</td>
                <td className="r">{fmtMoney(Number(it.price) || 0, { fractionDigits: 2 })}</td>
                <td className="r">{fmtMoney((Number(it.qty) || 0) * (Number(it.price) || 0), { fractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sum"><span>Без НДС</span><span>{fmtMoney(totals.netto, { fractionDigits: 2 })}</span></div>
        <div className="sum"><span>НДС {form.vat_pct || VAT_DEFAULT_PCT}%</span><span>{fmtMoney(totals.vat, { fractionDigits: 2 })}</span></div>
        <div className="sum grand"><span>{isAct ? 'Всего с НДС' : 'К оплате'}</span><span>{fmtMoney(totals.total, { fractionDigits: 2 })}</span></div>
        {!isAct && form.due_date ? (
          <div className="bill-paper-subject bill-paper-due">
            <div className="l">Оплатить до</div>
            <div className="n">{fmtDate(form.due_date)}</div>
          </div>
        ) : null}
        <div className="signs">
          <div className="bill-sign-col">
            <div>{isAct ? 'Сдал (Исполнитель)' : (co.director_title || 'Руководитель')}</div>
            <div className="bill-sign-mark">
              <img className="bill-sign-img" src="/assets/img/signature.png" alt="" />
              <img className="bill-stamp-img" src="/assets/img/stamp.png" alt="" />
            </div>
            <div className="ln" />
            <div>{co.director || ''}</div>
          </div>
          <div />
          <div className="bill-sign-col">
            <div>{isAct ? 'Принял (Заказчик)' : 'Главный бухгалтер'}</div>
            <div className="ln" />
            <div>{isAct ? (form.contact_person || '') : (co.accountant || '')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const EMPTY = {
  number: '',
  date: todayISO(),
  due_date: addDaysISO(14),
  signed_date: '',
  work_id: '',
  work_label: '',
  customer_id: null,
  customer_name: '',
  inn: '',
  kpp: '',
  address: '',
  contact_person: '',
  contact_phone: '',
  contact_email: '',
  subject: '',
  description: '',
  vat_pct: String(VAT_DEFAULT_PCT),
  items: [],
  origin: 'issue',
  status: 'draft',
  issuer: null
};

export function ConstructorModal({ kind: kindProp = 'invoice', editId, editKind, onSaved }) {
  const { close, open } = useModal();
  const [kind, setKind] = useState(editKind || kindProp || 'invoice');
  const isAct = kind === 'act';
  const lockedKind = !!editId;
  const [form, setForm] = useState(() => ({ ...EMPTY, items: [emptyItem()] }));
  const [busy, setBusy] = useState(false);
  const [companyOptions, setCompanyOptions] = useState([]);
  const [workOptions, setWorkOptions] = useState([]);
  const [works, setWorks] = useState([]);
  const [company, setCompany] = useState(null);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const setIss = (k, v) => setForm((s) => ({
    ...s,
    issuer: { ...(s.issuer || company || {}), [k]: v }
  }));
  const issuerReady = (iss) => !!(iss && (iss.name || iss.full_name || iss.inn || iss.bank_rs));

  useEffect(() => {
    loadCompanyProfile().then((c) => {
      setCompany(c);
      setForm((s) => (issuerReady(s.issuer) ? s : { ...s, issuer: { ...c } }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadWorks().then((list) => {
      setWorks(list || []);
      setWorkOptions((list || []).slice(0, 30).map(workOpt));
    });
    if (editId) return;
    let cancelled = false;
    const next = isAct ? nextActNumber : nextInvoiceNumber;
    next().then((n) => { if (!cancelled && n) set('number', n); }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, editId]);

  useEffect(() => {
    if (!editId) return;
    const load = editKind === 'act' ? loadAct : loadInvoice;
    load(editId).then((d) => {
      const row = d.act || d.invoice || d;
      if (!row) return;
      const items = parseItems(row.items_json || row.items).map((it, i) => ({
        id: Date.now() + i,
        name: it.name || it.description || '',
        unit: it.unit || 'усл.',
        qty: it.qty || it.quantity || 1,
        price: it.price || 0
      }));
      setForm((s) => ({
        ...EMPTY,
        number: row.act_number || row.invoice_number || '',
        date: (row.act_date || row.invoice_date || '').slice(0, 10) || todayISO(),
        due_date: (row.due_date || '').slice(0, 10) || '',
        signed_date: (row.signed_date || '').slice(0, 10) || '',
        work_id: row.work_id ? String(row.work_id) : '',
        work_label: row.work_title || row.work_number || '',
        customer_id: row.customer_id || null,
        customer_name: row.customer_name || '',
        inn: row.customer_inn || '',
        kpp: row.customer_kpp || '',
        address: row.customer_address || '',
        contact_person: row.contact_person || '',
        contact_phone: row.contact_phone || '',
        contact_email: row.contact_email || '',
        subject: row.description || '',
        description: row.description || '',
        vat_pct: row.vat_pct != null ? String(row.vat_pct) : String(VAT_DEFAULT_PCT),
        items: items.length ? items : [emptyItem()],
        origin: (row.invoice_type === 'incoming' || row.act_type === 'registered') ? 'register' : 'issue',
        status: row.status || 'draft',
        issuer: parseIssuer(row.issuer_json) || s.issuer || null
      }));
    });
  }, [editId, editKind]);

  const totals = useMemo(() => calcTotals(form.items, Number(form.vat_pct) || VAT_DEFAULT_PCT), [form.items, form.vat_pct]);

  const onCustomerQuery = async (q) => {
    if (!q || q.length < 2) return;
    const opts = await lookupCustomers(q);
    setCompanyOptions(opts.map((c) => ({
      value: c.inn || c.id || c.name,
      label: `${c.name || c.full_name}${c.inn ? ' · ' + c.inn : ''}`,
      raw: c
    })));
  };

  const applyCustomer = (c) => {
    if (!c) return;
    setForm((s) => ({
      ...s,
      customer_id: c.id || s.customer_id,
      customer_name: c.name || c.full_name || s.customer_name,
      inn: c.inn || s.inn,
      kpp: c.kpp || s.kpp,
      address: c.address || c.legal_address || s.address,
      contact_person: c.contact_person || s.contact_person,
      contact_phone: c.phone || c.contact_phone || s.contact_phone,
      contact_email: c.email || s.contact_email
    }));
  };

  const fromInnLookup = (res) => res?.suggestion || res?.customer || (res?.found ? res : null);

  const onInnLookup = async () => {
    if (!form.inn || String(form.inn).length < 10) return toast('ИНН', 'Введи 10 или 12 цифр', 'warn');
    setBusy(true);
    try {
      const res = await customerByInn(form.inn);
      const c = fromInnLookup(res);
      if (c?.name || c?.full_name) {
        applyCustomer(c);
        toast('ЕГРЮЛ', 'Заполнено из реестра', 'ok');
      } else toast('ИНН', 'В реестре не найдено', 'warn');
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally { setBusy(false); }
  };

  const onWorkQuery = (q) => {
    const lq = (q || '').toLowerCase();
    const filtered = (works || []).filter((w) => {
      const hay = `${w.work_number || ''} ${w.work_title || ''} ${w.customer_name || ''} ${w.customer || ''}`.toLowerCase();
      return !lq || hay.includes(lq);
    }).slice(0, 40);
    setWorkOptions(filtered.map(workOpt));
  };

  const applyWork = async (workId, preview) => {
    if (!workId) {
      setForm((s) => ({ ...s, work_id: '', work_label: '' }));
      return;
    }
    setBusy(true);
    try {
      const full = await loadWork(workId).catch(() => null);
      const w = { ...(preview?.raw || {}), ...(works.find((x) => String(x.id) === String(workId)) || {}), ...(full || {}) };
      if (!w.id && !workId) return;
      w.id = w.id || workId;
      const title = w.work_title || w.work_name || '';
      const customer = w.customer_name || w.customer || '';
      const inn = w.customer_inn || '';
      const vat = w.vat_pct != null ? Number(w.vat_pct) : Number(form.vat_pct) || VAT_DEFAULT_PCT;
      const contract = Number(w.contract_value || w.contract_sum || 0);
      const netto = contract > 0 ? Math.round((contract / (1 + vat / 100)) * 100) / 100 : 0;
      setForm((s) => {
        const placeholder = !s.items.length || (s.items.length === 1 && !String(s.items[0].name || '').trim() && !Number(s.items[0].price));
        const nextItems = !placeholder
          ? s.items
          : (title || netto ? [{ ...emptyItem(), name: title || 'Работы по договору', qty: 1, price: netto }] : s.items);
        return {
          ...s,
          work_id: String(w.id),
          work_label: `${w.work_number || '#' + w.id} · ${title || customer}`,
          customer_name: customer || s.customer_name,
          inn: inn || s.inn,
          contact_person: w.contact_person || s.contact_person,
          contact_phone: w.contact_phone || s.contact_phone,
          subject: title || s.subject,
          description: title || s.description,
          vat_pct: String(vat),
          items: nextItems
        };
      });
      if (inn) {
        customerByInn(inn).then((res) => {
          const c = res?.suggestion || res?.customer || (res?.found ? res : null);
          if (c?.name || c?.kpp || c?.address) applyCustomer(c);
        }).catch(() => {});
      }
      toast('Работа', 'Заказчик и сумма подтянуты — можно править', 'ok');
    } finally { setBusy(false); }
  };

  const addRow = () => set('items', [...form.items, emptyItem()]);
  const updateRow = (idx, patch) => {
    const next = [...form.items];
    next[idx] = { ...next[idx], ...patch };
    set('items', next);
  };
  const removeRow = (idx) => set('items', form.items.filter((_, i) => i !== idx));

  const liveItems = (form.items || []).filter((it) => String(it.name || '').trim());
  const validate = () => {
    if (!form.customer_name?.trim()) return 'Укажите заказчика';
    if (!form.date) return 'Укажите дату';
    if (!liveItems.length) return 'Добавьте хотя бы одну позицию';
    if (!(totals.total > 0)) return 'Сумма должна быть больше нуля';
    return null;
  };

  const persist = async (status) => {
    const err = validate();
    if (err) { toast.warn(err); return null; }
    setBusy(true);
    try {
      const payload = buildPayload(kind, form, totals, status);
      let saved;
      if (editId && editKind === kind) {
        saved = isAct ? await updateAct(editId, payload) : await updateInvoice(editId, payload);
      } else {
        saved = isAct ? await createAct(payload) : await createInvoice(payload);
      }
      const row = saved?.act || saved?.invoice || saved;
      emitChanged();
      onSaved?.();
      return row;
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      return null;
    } finally { setBusy(false); }
  };

  const onDraft = async () => {
    const row = await persist('draft');
    if (row) { toast.success('Черновик сохранён'); close(); }
  };
  const onIssue = async () => {
    const row = await persist('sent');
    if (row) { toast.success(isAct ? 'Акт выставлен' : 'Счёт выставлен'); close(); }
  };
  const onIssueSend = async () => {
    const row = await persist('sent');
    if (!row?.id) return;
    close();
    open(<SendDocModal kind={kind} doc={row} />);
  };
  const onPreviewPdf = async (doPrint) => {
    const err = validate();
    if (err) return toast.warn(err);
    setBusy(true);
    try {
      const blob = await previewPdf(kind, buildPayload(kind, form, totals, 'draft'));
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (doPrint && w) setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 700);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast.error(String(e?.message || e));
    } finally { setBusy(false); }
  };

  const onPreviewOffice = async (ext) => {
    const err = validate();
    if (err) return toast.warn(err);
    setBusy(true);
    try {
      await previewOffice(kind, buildPayload(kind, form, totals, 'draft'), ext);
    } catch (e) {
      toast.error(String(e?.message || e));
    } finally { setBusy(false); }
  };

  const onIssuerReset = async () => {
    try {
      const c = await loadCompanyProfile();
      setCompany(c);
      setForm((s) => ({ ...s, issuer: { ...c } }));
      toast.success('Реквизиты подставлены из настроек');
    } catch (e) {
      toast.error(String(e?.message || e));
    }
  };

  const switchKind = (next) => {
    if (lockedKind || next === kind) return;
    setKind(next);
    setForm((s) => ({ ...s, number: '', due_date: next === 'invoice' ? (s.due_date || addDaysISO(14)) : s.due_date }));
  };

  return (
    <MCard className="modal-xl bill-ctor-modal">
      <MHead
        icon={isAct ? '📄' : '🧾'}
        title={editId ? (isAct ? `Акт № ${form.number || editId}` : `Счёт № ${form.number || editId}`) : (isAct ? 'Новый акт' : 'Новый счёт')}
        subtitle={form.work_label ? `Работа: ${form.work_label}` : 'Можно привязать работу или заполнить вручную'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {!lockedKind && (
          <div className="bill-seg" role="tablist">
            <button type="button" className={'bill-seg-btn' + (!isAct ? ' on' : '')} onClick={() => switchKind('invoice')}>
              <div className="t">Счёт на оплату</div>
              <div className="d">Выставить заказчику, PDF / Word / Excel</div>
            </button>
            <button type="button" className={'bill-seg-btn' + (isAct ? ' on' : '')} onClick={() => switchKind('act')}>
              <div className="t">Акт выполненных работ</div>
              <div className="d">Сдача-приёмка с позициями и подписями</div>
            </button>
          </div>
        )}

        <div className="bill-ctor">
          <div className="bill-ctor-form">
            <div className={'bill-bind' + (form.work_id ? ' is-on' : '')}>
              <div className="bill-bind-top">
                <div className="lab">Привязка к работе</div>
                {form.work_id ? (
                  <button type="button" className="bill-bind-clear" onClick={() => applyWork('')}>Снять</button>
                ) : null}
              </div>
              <Combobox
                value={form.work_label || ''}
                onChange={(v, opt) => {
                  if (opt?.raw) applyWork(opt.raw.id, opt);
                  else if (!v) applyWork('');
                  else setForm((s) => ({ ...s, work_label: v }));
                }}
                options={workOptions}
                onQuery={onWorkQuery}
                placeholder="Найти работу — подтянется заказчик, ИНН и сумма"
                allowFreeText
              />
              <div className="bill-bind-hint">
                {form.work_id
                  ? 'Заказчик подтянут из работы. Позиции и реквизиты можно править вручную.'
                  : 'Или заполните заказчика ниже вручную — как в конструкторе ТКП.'}
              </div>
            </div>

            <div className="bill-livebar">
              <div>
                <div className="k">{isAct ? 'Акт' : 'Счёт'} {form.number || 'б/н'}</div>
                <div className="w">{form.customer_name || 'Заказчик ещё не указан'}</div>
              </div>
              <div className="sum">{fmtMoney(totals.total, { fractionDigits: 2 })}</div>
            </div>

            <Section title="1. Заказчик">
              <div className="bill-grid-2">
                <Field label="Заказчик" required>
                  <Combobox
                    value={form.customer_name}
                    onChange={(v, opt) => {
                      if (opt?.raw) applyCustomer(opt.raw);
                      else set('customer_name', v);
                    }}
                    options={companyOptions}
                    onQuery={onCustomerQuery}
                    placeholder="Название или ИНН"
                    allowFreeText
                  />
                </Field>
                <Field label="ИНН">
                  <div className="u-flex gap-6">
                    <INNInput value={form.inn} onChange={(v) => set('inn', v)} />
                    <Btn size="sm" variant="ghost" onClick={onInnLookup}>ЕГРЮЛ</Btn>
                  </div>
                </Field>
                <Field label="КПП"><TextInput value={form.kpp} onChange={(v) => set('kpp', v)} maxLength={9} /></Field>
                <Field label="Адрес"><TextInput value={form.address} onChange={(v) => set('address', v)} /></Field>
                <Field label="Контакт"><TextInput value={form.contact_person} onChange={(v) => set('contact_person', v)} /></Field>
                <Field label="Телефон"><PhoneInput value={form.contact_phone} onChange={(v) => set('contact_phone', v)} /></Field>
                <div className="bill-span-2">
                  <Field label="Email"><TextInput value={form.contact_email} onChange={(v) => set('contact_email', v)} placeholder="для отправки PDF" /></Field>
                </div>
              </div>
            </Section>

            <Section title="2. Наши реквизиты" right={
              <Btn size="sm" variant="ghost" onClick={onIssuerReset}>Из настроек</Btn>
            }>
              <p className="bill-bind-hint">По умолчанию из настроек компании. Правки сохраняются только в этом документе.</p>
              <div className="bill-grid-2">
                <Field label="Краткое название">
                  <TextInput value={form.issuer?.name || ''} onChange={(v) => setIss('name', v)} />
                </Field>
                <Field label="Полное название">
                  <TextInput value={form.issuer?.full_name || ''} onChange={(v) => setIss('full_name', v)} />
                </Field>
                <Field label="ИНН">
                  <TextInput value={form.issuer?.inn || ''} onChange={(v) => setIss('inn', v)} maxLength={12} />
                </Field>
                <Field label="КПП">
                  <TextInput value={form.issuer?.kpp || ''} onChange={(v) => setIss('kpp', v)} maxLength={9} />
                </Field>
                <Field label="ОГРН">
                  <TextInput value={form.issuer?.ogrn || ''} onChange={(v) => setIss('ogrn', v)} />
                </Field>
                <Field label="Телефон">
                  <PhoneInput value={form.issuer?.phone || ''} onChange={(v) => setIss('phone', v)} />
                </Field>
                <div className="bill-span-2">
                  <Field label="Адрес">
                    <TextInput value={form.issuer?.address || ''} onChange={(v) => setIss('address', v)} />
                  </Field>
                </div>
                <Field label="Email">
                  <TextInput value={form.issuer?.email || ''} onChange={(v) => setIss('email', v)} />
                </Field>
                <Field label="Должность руководителя">
                  <TextInput value={form.issuer?.director_title || ''} onChange={(v) => setIss('director_title', v)} />
                </Field>
                <Field label="Руководитель">
                  <TextInput value={form.issuer?.director || ''} onChange={(v) => setIss('director', v)} />
                </Field>
                <Field label="Главный бухгалтер">
                  <TextInput value={form.issuer?.accountant || ''} onChange={(v) => setIss('accountant', v)} />
                </Field>
                <Field label="Банк">
                  <TextInput value={form.issuer?.bank_name || ''} onChange={(v) => setIss('bank_name', v)} />
                </Field>
                <Field label="БИК">
                  <TextInput value={form.issuer?.bank_bik || ''} onChange={(v) => setIss('bank_bik', v)} />
                </Field>
                <Field label="Р/с">
                  <TextInput value={form.issuer?.bank_rs || ''} onChange={(v) => setIss('bank_rs', v)} />
                </Field>
                <Field label="К/с">
                  <TextInput value={form.issuer?.bank_ks || ''} onChange={(v) => setIss('bank_ks', v)} />
                </Field>
              </div>
            </Section>

            <Section title={isAct ? '3. Предмет акта' : '3. Предмет счёта'}>
              <div className="bill-grid-3">
                <Field label="Номер">
                  <TextInput value={form.number} onChange={(v) => set('number', v)} placeholder={isAct ? 'АКТ-2026-001' : 'СЧ-2026-001'} />
                </Field>
                <Field label="Дата" required>
                  <TextInput type="date" value={form.date} onChange={(v) => set('date', v)} />
                </Field>
                {isAct ? (
                  <Field label="Дата подписания">
                    <TextInput type="date" value={form.signed_date} onChange={(v) => set('signed_date', v)} />
                  </Field>
                ) : (
                  <Field label="Оплатить до">
                    <TextInput type="date" value={form.due_date} onChange={(v) => set('due_date', v)} />
                  </Field>
                )}
              </div>
              <Field label="Наименование работ">
                <TextInput value={form.subject} onChange={(v) => { set('subject', v); set('description', v); }} placeholder="Капитальный ремонт, монтаж, ПНР…" />
              </Field>
              <Field label="Описание / основание">
                <TextareaInput value={form.description} onChange={(v) => set('description', v)} minRows={2} maxRows={5} placeholder="Договор, доп. соглашение, объект" />
              </Field>
            </Section>

            <Section title="4. Позиции" right={
              <Btn size="sm" variant="primary" onClick={addRow}>+ Строка</Btn>
            }>
              <div className="bill-items-card">
                <table className="bill-items-table">
                  <thead>
                    <tr>
                      <th className="bill-col-40">№</th>
                      <th>Наименование</th>
                      <th className="bill-col-70">Ед.</th>
                      <th className="bill-col-90">Кол-во</th>
                      <th className="bill-col-120">Цена</th>
                      <th className="bill-col-120">Сумма</th>
                      <th className="bill-col-40"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.length === 0 && (
                      <tr>
                        <td colSpan={7} className="bill-items-empty">
                          Таблица как в ТКП: одна строка на всю работу или детализация.
                          <div>
                            <button type="button" className="bill-items-cta" onClick={addRow}>+ Добавить позицию</button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {form.items.map((it, i) => (
                      <tr key={it.id}>
                        <td className="bill-cell-idx">{i + 1}</td>
                        <td><input className="m-input" value={it.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="Что делаем" /></td>
                        <td><input className="m-input" value={it.unit} onChange={(e) => updateRow(i, { unit: e.target.value })} /></td>
                        <td><input className="m-input" type="number" min="0" step="0.01" value={it.qty} onChange={(e) => updateRow(i, { qty: e.target.value })} /></td>
                        <td><input className="m-input" type="number" min="0" step="0.01" value={it.price} onChange={(e) => updateRow(i, { price: e.target.value })} /></td>
                        <td className="t-right fw-600">{fmtMoney((Number(it.qty) || 0) * (Number(it.price) || 0), { fractionDigits: 2 })}</td>
                        <td><button type="button" className="btn-ghost tkp-row-rm" onClick={() => removeRow(i)} title="Удалить">×</button></td>
                      </tr>
                    ))}
                    {form.items.length > 0 && (
                      <>
                        <tr>
                          <td colSpan={5} className="bill-totals-cell">НДС, %</td>
                          <td colSpan={2}>
                            <NumberInput value={form.vat_pct} onChange={(v) => set('vat_pct', v)} min={0} max={100} />
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={5} className="bill-totals-cell">Без НДС:</td>
                          <td className="bill-totals-val">{fmtMoney(totals.netto, { fractionDigits: 2 })}</td>
                          <td></td>
                        </tr>
                        <tr>
                          <td colSpan={5} className="bill-totals-cell">НДС {form.vat_pct}%:</td>
                          <td className="t-right">{fmtMoney(totals.vat, { fractionDigits: 2 })}</td>
                          <td></td>
                        </tr>
                        <tr className="bill-total-row">
                          <td colSpan={5} className="bill-total-label">ИТОГО с НДС:</td>
                          <td className="bill-total-val">{fmtMoney(totals.total, { fractionDigits: 2 })}</td>
                          <td></td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>

          <div className="bill-ctor-preview">
            <DocPaper kind={kind} form={form} totals={totals} company={company} />
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <div className="bill-foot-actions">
          <Btn variant="ghost" disabled={busy} onClick={() => onPreviewPdf(false)}>PDF</Btn>
          <Btn variant="ghost" disabled={busy} onClick={() => onPreviewOffice('docx')}>Word</Btn>
          <Btn variant="ghost" disabled={busy} onClick={() => onPreviewOffice('xlsx')}>Excel</Btn>
          <Btn variant="ghost" disabled={busy} onClick={() => onPreviewPdf(true)}>Печать</Btn>
          <Btn variant="ghost" disabled={busy} onClick={onDraft}>Черновик</Btn>
          <Btn variant="ghost" disabled={busy} onClick={onIssueSend}>Выставить и отправить</Btn>
          <Btn variant="primary" disabled={busy} onClick={onIssue}>
            {busy ? 'Сохраняем…' : (isAct ? 'Выставить акт' : 'Выставить счёт')}
          </Btn>
        </div>
      </MFoot>
    </MCard>
  );
}

function workOpt(w) {
  const title = displayText(w.work_title || w.work_name, 'без названия');
  const cust = displayText(w.customer_name || w.customer, '');
  const num = displayText(w.work_number, '#' + w.id);
  return {
    value: String(w.id),
    label: `${num} · ${title}${cust ? ' · ' + cust : ''}`,
    raw: w
  };
}
