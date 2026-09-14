/**
 * FullKpFormModal — полное КП по шаблону Ника (паритет AsgardTkpFullForm).
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, TextareaInput, NumberInput, Combobox, INNInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { createTkp, updateTkp, loadTkp, previewTkpPdf, openPdf, openDocx, lookupCustomers, customerByInn } from '../api';
import { PolishTextSheet } from './PolishTextSheet';

const emptyFull = () => ({
  object_name: '',
  basis: 'Техническое задание, ведомость объемов работ и письменные ответы Заказчика на технические вопросы',
  conditions: {
    mobilization: '', personnel: '', regime: '', payment: '',
    customer_resources: '', price_summary: ''
  },
  scope: '',
  scope_boundary: '',
  apparatus: [{ equipment: '', inventory_no: '', tube_data: '', qty: '1 компл.', amount_no_vat: '' }],
  transport_amount: 0,
  cost_notes: '',
  acceptance: '',
  risks: '',
  customer_duties: '',
  deliverables: '',
  author_name: '',
  author_position: 'Генеральный директор'
});

function calcTotals(full) {
  let sub = Number(full.transport_amount) || 0;
  (full.apparatus || []).forEach((r) => { sub += Number(r.amount_no_vat) || 0; });
  const vat_pct = 22;
  const vat_sum = Math.round(sub * vat_pct) / 100;
  const total_with_vat = Math.round((sub + vat_sum) * 100) / 100;
  return { subtotal: sub, vat_pct, vat_sum, total_with_vat };
}

function PolishBtn({ value, label, onApply }) {
  const { open } = useModal();
  return (
    <Btn
      style={{ padding: '2px 10px', fontSize: 12 }}
      onClick={() => open(<PolishTextSheet text={value} fieldLabel={label} onApply={onApply} />)}
    >
      ✨
    </Btn>
  );
}

function applySuggestion(res) {
  const s = res?.suggestion || res?.customer || (res?.found ? res : null) || res;
  if (!s) return null;
  const name = s.name || s.full_name || s.short_name || '';
  const inn = s.inn || '';
  if (!name && !inn) return null;
  return { name, inn };
}

export function FullKpFormModal({ editId, onSaved }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState(editId || null);
  const [customer_name, setCustomer] = useState('');
  const [customer_inn, setInn] = useState('');
  const [companyOptions, setCompanyOptions] = useState([]);
  const [subject, setSubject] = useState('');
  const [validity_days, setValidity] = useState(30);
  const [tkp_number, setNumber] = useState('');
  const [full, setFull] = useState(emptyFull);

  useEffect(() => {
    if (!editId) return;
    loadTkp(editId).then((res) => {
      const item = res?.item || res || {};
      setId(item.id);
      setCustomer(item.customer_name || '');
      setInn(item.customer_inn || '');
      setSubject(item.subject || '');
      setValidity(item.validity_days || 30);
      setNumber(item.tkp_number || '');
      let cj = {};
      try { cj = typeof item.items === 'string' ? JSON.parse(item.items || '{}') : (item.items || {}); } catch { /* */ }
      if (cj.full) {
        setFull({
          ...emptyFull(),
          ...cj.full,
          conditions: { ...emptyFull().conditions, ...(cj.full.conditions || {}) },
          apparatus: Array.isArray(cj.full.apparatus) && cj.full.apparatus.length
            ? cj.full.apparatus
            : emptyFull().apparatus
        });
      }
    }).catch((e) => toast('Ошибка', String(e?.message || e), 'err'));
  }, [editId]);

  const setCond = (k, v) => setFull((f) => ({ ...f, conditions: { ...f.conditions, [k]: v } }));
  const setApp = (idx, patch) => setFull((f) => {
    const apparatus = f.apparatus.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    return { ...f, apparatus };
  });

  const onCustomerQuery = async (q) => {
    const query = String(q || '').trim();
    if (query.length < 2) {
      setCompanyOptions([]);
      return;
    }
    const opts = await lookupCustomers(query);
    setCompanyOptions(opts.map((c) => ({
      value: c.inn || String(c.id) || c.name,
      label: `${c.name || c.full_name}${c.inn ? ' · ' + c.inn : ''}`,
      raw: c
    })));
  };

  const onInnLookup = async () => {
    const digits = String(customer_inn || '').replace(/\D/g, '');
    if (digits.length !== 10 && digits.length !== 12) {
      return toast('ИНН', 'Введи 10 или 12 цифр', 'warn');
    }
    setBusy(true);
    try {
      const list = await lookupCustomers(digits);
      const hit = list.find((x) => String(x.inn || '').replace(/\D/g, '') === digits);
      if (hit) {
        setCustomer(hit.name || hit.full_name || '');
        setInn(hit.inn || digits);
        toast('Заказчик', 'Подставлен из CRM', 'ok');
        return;
      }
      const res = await customerByInn(digits);
      const s = applySuggestion(res);
      if (s) {
        if (s.name) setCustomer(s.name);
        if (s.inn) setInn(s.inn);
        toast('ЕГРЮЛ', 'Заполнено из реестра', 'ok');
      } else {
        toast('ИНН', res?.message || 'В реестре не найдено', 'warn');
      }
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const onNewCustomer = () => {
    const openNew = window.AsgardContractsPage?.openNewCustomerModal;
    if (!openNew) {
      toast('Ошибка', 'Модуль договоров не загружен', 'err');
      return;
    }
    openNew((created) => {
      if (!created) return;
      setCustomer(created.short_name || created.name || '');
      if (created.inn) setInn(created.inn);
      toast('Контрагент создан', created.short_name || created.name || '', 'ok');
    });
  };

  const totals = calcTotals(full);

  const buildBody = () => ({
    kp_variant: 'full',
    subject,
    customer_name,
    customer_inn,
    validity_days,
    tkp_number: tkp_number || null,
    total_sum: totals.total_with_vat,
    work_description: (full.scope || '').slice(0, 500),
    items: {
      vat_pct: totals.vat_pct,
      subtotal: totals.subtotal,
      vat_sum: totals.vat_sum,
      total_with_vat: totals.total_with_vat,
      items: (full.apparatus || []).map((a) => ({
        name: a.equipment, unit: a.qty || 'компл.', qty: 1, price: a.amount_no_vat, total: a.amount_no_vat
      })),
      full
    }
  });

  const save = async () => {
    if (!subject.trim()) return toast('Предмет', 'Укажите предмет КП', 'warn');
    setBusy(true);
    try {
      const body = buildBody();
      const res = id ? await updateTkp(id, body) : await createTkp(body);
      const newId = res?.item?.id || res?.id || id;
      setId(newId);
      toast('Готово', `Полное КП #${newId} сохранено`, 'ok');
      onSaved?.(newId);
      window.dispatchEvent(new CustomEvent('asgard:tkp:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    setBusy(true);
    try {
      const body = { ...buildBody(), with_signature: true, with_stamp: true };
      const blob = await previewTkpPdf(body);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const FieldBlock = ({ label, value, onChange, rows = 3 }) => (
    <Field label={label}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <PolishBtn value={value} label={label} onApply={onChange} />
      </div>
      <TextareaInput value={value} onChange={onChange} minRows={rows} maxRows={rows + 4} />
    </Field>
  );

  return (
    <MCard className="modal-xl">
      <MHead icon="📑" title={id ? `Полное КП #${id}` : 'Полное коммерческое предложение'} subtitle="Шаблон развёрнутого КП" accent="gold" onClose={close} />
      <MBody>
        <div className="col gap-12" style={{ maxHeight: '65vh', overflow: 'auto' }}>
          <div className="grid-2 gap-8">
            <Field label="Заказчик" required>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <Combobox
                    value={customer_name}
                    onChange={(v, opt) => {
                      if (opt?.raw) {
                        setCustomer(opt.raw.name || opt.raw.full_name || v);
                        if (opt.raw.inn) setInn(opt.raw.inn);
                      } else {
                        setCustomer(v);
                      }
                    }}
                    options={companyOptions}
                    onQuery={onCustomerQuery}
                    placeholder="Начни вводить название или ИНН"
                    allowFreeText
                  />
                </div>
                <Btn size="sm" variant="ghost" onClick={onNewCustomer} style={{ whiteSpace: 'nowrap' }}>+ Новый</Btn>
              </div>
            </Field>
            <Field label="ИНН">
              <div style={{ display: 'flex', gap: 6 }}>
                <INNInput value={customer_inn} onChange={setInn} />
                <Btn size="sm" variant="ghost" onClick={onInnLookup} title="Запрос в ЕГРЮЛ" disabled={busy}>🔄</Btn>
              </div>
            </Field>
          </div>
          <div className="grid-2 gap-8">
            <Field label="Срок действия, дн."><NumberInput value={validity_days} onChange={setValidity} /></Field>
            <Field label="№ КП"><TextInput value={tkp_number} onChange={setNumber} /></Field>
          </div>
          <FieldBlock label="Объект" value={full.object_name} onChange={(v) => setFull({ ...full, object_name: v })} rows={2} />
          <FieldBlock label="Предмет" value={subject} onChange={setSubject} rows={2} />
          <FieldBlock label="Основание" value={full.basis} onChange={(v) => setFull({ ...full, basis: v })} rows={2} />

          <div style={{ fontWeight: 700, color: 'var(--gold)', marginTop: 8 }}>Условия и комментарии</div>
          <FieldBlock label="Мобилизация и срок" value={full.conditions.mobilization} onChange={(v) => setCond('mobilization', v)} />
          <FieldBlock label="Персонал" value={full.conditions.personnel} onChange={(v) => setCond('personnel', v)} rows={2} />
          <FieldBlock label="Режим производства" value={full.conditions.regime} onChange={(v) => setCond('regime', v)} />
          <FieldBlock label="Оплата" value={full.conditions.payment} onChange={(v) => setCond('payment', v)} rows={2} />
          <FieldBlock label="Ресурсы Заказчика" value={full.conditions.customer_resources} onChange={(v) => setCond('customer_resources', v)} />
          <FieldBlock label="Цена предложения (текст)" value={full.conditions.price_summary} onChange={(v) => setCond('price_summary', v)} rows={2} />

          <div style={{ fontWeight: 700, color: 'var(--gold)', marginTop: 8 }}>Технический периметр</div>
          <FieldBlock label="Технический периметр работ" value={full.scope} onChange={(v) => setFull({ ...full, scope: v })} rows={6} />
          <FieldBlock label="Граница объема" value={full.scope_boundary} onChange={(v) => setFull({ ...full, scope_boundary: v })} />

          <div style={{ fontWeight: 700, color: 'var(--gold)', marginTop: 8 }}>Стоимость по аппаратам</div>
          {(full.apparatus || []).map((r, idx) => (
            <div key={idx} className="p-10 bg-inner r-sm col gap-6">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b>#{idx + 1}</b>
                <Btn onClick={() => setFull((f) => ({ ...f, apparatus: f.apparatus.filter((_, i) => i !== idx).length ? f.apparatus.filter((_, i) => i !== idx) : emptyFull().apparatus }))}>×</Btn>
              </div>
              <Field label="Оборудование"><TextInput value={r.equipment} onChange={(v) => setApp(idx, { equipment: v })} /></Field>
              <div className="grid-2 gap-8">
                <Field label="Инв. №"><TextInput value={r.inventory_no} onChange={(v) => setApp(idx, { inventory_no: v })} /></Field>
                <Field label="Кол-во"><TextInput value={r.qty} onChange={(v) => setApp(idx, { qty: v })} /></Field>
              </div>
              <Field label="Расчётные данные по трубкам"><TextInput value={r.tube_data} onChange={(v) => setApp(idx, { tube_data: v })} /></Field>
              <Field label="Сумма без НДС"><NumberInput value={r.amount_no_vat} onChange={(v) => setApp(idx, { amount_no_vat: v })} /></Field>
            </div>
          ))}
          <Btn onClick={() => setFull((f) => ({ ...f, apparatus: [...f.apparatus, { equipment: '', inventory_no: '', tube_data: '', qty: '1 компл.', amount_no_vat: '' }] }))}>+ Аппарат</Btn>
          <Field label="Транспортные расходы"><NumberInput value={full.transport_amount} onChange={(v) => setFull({ ...full, transport_amount: v })} /></Field>
          <div className="p-10 bg-inner r-sm" style={{ textAlign: 'right' }}>
            Итого без НДС: <b>{totals.subtotal.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</b> ₽ ·
            НДС 22%: <b>{totals.vat_sum.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</b> ₽ ·
            <span style={{ color: 'var(--gold)', fontWeight: 700 }}> С НДС: {totals.total_with_vat.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽</span>
          </div>
          <FieldBlock label="Примечания к распределению" value={full.cost_notes} onChange={(v) => setFull({ ...full, cost_notes: v })} rows={4} />

          <div style={{ fontWeight: 700, color: 'var(--gold)', marginTop: 8 }}>Юридические разделы</div>
          <FieldBlock label="Порядок сдачи, приемки и оплаты" value={full.acceptance} onChange={(v) => setFull({ ...full, acceptance: v })} rows={5} />
          <FieldBlock label="Условия, влияющие на сроки и стоимость" value={full.risks} onChange={(v) => setFull({ ...full, risks: v })} rows={5} />
          <FieldBlock label="Обязанности заказчика" value={full.customer_duties} onChange={(v) => setFull({ ...full, customer_duties: v })} rows={5} />
          <FieldBlock label="Исполнительная документация" value={full.deliverables} onChange={(v) => setFull({ ...full, deliverables: v })} rows={4} />

          <div className="grid-2 gap-8">
            <Field label="Должность"><TextInput value={full.author_position} onChange={(v) => setFull({ ...full, author_position: v })} /></Field>
            <Field label="ФИО"><TextInput value={full.author_name} onChange={(v) => setFull({ ...full, author_name: v })} /></Field>
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn disabled={busy} onClick={preview}>Предпросмотр</Btn>
          {id && <Btn disabled={busy} onClick={() => openPdf(id, { signature: true, stamp: false })}>PDF без печати</Btn>}
          {id && <Btn disabled={busy} onClick={() => openPdf(id, { signature: true, stamp: true })}>PDF с печатью</Btn>}
          {id && <Btn disabled={busy} onClick={() => openDocx(id)}>Word</Btn>}
          <Btn variant="primary" disabled={busy} onClick={save}>{busy ? '…' : (id ? 'Сохранить' : 'Создать полное КП')}</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}
