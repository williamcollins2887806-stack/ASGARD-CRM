/**
 * CreateCustomerModal — создать нового контрагента.
 * Паритет с vanilla personal_kanban.js:3633..3742 (_openCreateCustomerModal).
 *
 * Поток:
 *   1. Юзер вводит ИНН, жмёт 🔎 ЕГРЮЛ — dadata подгружает name/address.
 *   2. Юзер может доправить поля (email/phone/contact_person).
 *   3. «💾 Создать и выбрать» → POST /api/customers → если 409
 *      (уже есть с таким ИНН) — GET /:inn и сразу выбрать.
 *
 * Props:
 *   onClose()
 *   onCreated(customer) — успешно создан/найден существующий
 */
import { useState, useRef, useEffect } from 'react';
import { toast } from '@/modals/Notifications';
import { lookupCustomerByInn, getCustomerByInn, createCustomer } from './api';

export default function CreateCustomerModal({ onClose, onCreated }) {
  const [inn, setInn] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [contact, setContact] = useState('');
  const [egrulLoading, setEgrulLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const innRef = useRef(null);

  useEffect(() => { setTimeout(() => innRef.current?.focus(), 30); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const doEgrul = async () => {
    const innClean = inn.trim();
    if (!innClean || innClean.length < 10) {
      toast.warn('ИНН: введите 10+ цифр');
      return;
    }
    setEgrulLoading(true);
    try {
      const r = await lookupCustomerByInn(innClean);
      const data = r || {};
      const sug = data.suggestion || {};
      if (data.found === false && data.message) {
        toast.warn('ЕГРЮЛ: ' + data.message);
        return;
      }
      const foundName = sug.name || sug.full_name || data.name || '';
      const foundAddr = sug.address || '';
      if (!foundName) {
        toast.warn('ЕГРЮЛ: не найдено, заполни вручную');
        return;
      }
      setName(foundName);
      if (foundAddr) setAddress(foundAddr);
      toast.success('ЕГРЮЛ: ' + (sug.kpp ? `${foundName} (КПП ${sug.kpp})` : foundName));
    } catch (e) {
      toast.error('ЕГРЮЛ: ' + (e?.message || e));
    } finally {
      setEgrulLoading(false);
    }
  };

  const save = async () => {
    const innClean = inn.replace(/\D/g, '');
    if (!/^\d{10}$|^\d{12}$/.test(innClean)) {
      toast.warn('ИНН: 10 или 12 цифр');
      return;
    }
    const nameClean = name.trim();
    if (!nameClean) {
      toast.warn('Название организации обязательно');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        inn: innClean,
        name: nameClean,
        email: email.trim() || null,
        phone: phone.trim() || null,
        contact_person: contact.trim() || null,
        address: address.trim() || null,
      };
      let created = null;
      try {
        created = await createCustomer(payload);
      } catch (e) {
        const msg = (e?.message || '').toLowerCase();
        const conflict = e?.status === 409 || msg.includes('уже существует');
        if (conflict) {
          // Уже есть — подтянуть и вернуть как «выбран»
          try {
            const gr = await getCustomerByInn(innClean);
            if (gr && gr.customer) {
              onCreated?.({
                ...gr.customer,
                name: gr.customer.name || nameClean,
                inn: gr.customer.inn || innClean,
              });
              toast.info('Контрагент уже был в базе — выбран');
              onClose?.();
              return;
            }
          } catch (_) { /* ignore */ }
          toast.warn('Контрагент с этим ИНН уже существует');
          return;
        }
        toast.error('Ошибка: ' + (e?.message || 'не сохранилось'));
        return;
      }
      onCreated?.(payload);
      toast.success('Создан: ' + nameClean);
      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    padding: '9px 11px',
    border: '1px solid var(--brd-2,var(--brd-m))',
    borderRadius: 7,
    background: 'var(--bg-1,var(--bg1))',
    color: 'var(--t-1,var(--t1))',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 999999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div style={{
        background: 'var(--bg-2,var(--bg2))',
        border: '1px solid var(--brd-1,var(--brd))',
        borderRadius: 14,
        width: 'min(560px, 92vw)',
        boxShadow: '0 16px 48px rgba(0,0,0,.6)',
      }}>
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--brd-2,var(--brd-m))',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18, color: 'var(--gold)' }}>＋</span>
          <h3 style={{
            margin: 0, fontFamily: '"Cinzel",Georgia,serif',
            fontSize: 17, color: 'var(--t-1,var(--t1))', flex: 1,
          }}>Новый контрагент</h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent', border: 0,
              color: 'var(--t-2,var(--t2))', fontSize: 18, cursor: 'pointer',
            }}
          >✕</button>
        </div>
        <div style={{
          padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 9,
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={innRef}
              value={inn}
              onChange={(e) => setInn(e.target.value.replace(/\D/g, '').slice(0, 12))}
              placeholder="ИНН (10 или 12 цифр) *"
              maxLength={12}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={doEgrul}
              disabled={egrulLoading}
              title="Подгрузить из ЕГРЮЛ"
              style={{
                padding: '9px 12px',
                background: 'var(--bg-3,var(--bg3))',
                color: 'var(--t-1,var(--t1))',
                border: '1px solid var(--brd-2,var(--brd-m))',
                borderRadius: 7, cursor: egrulLoading ? 'default' : 'pointer',
                fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap',
                fontFamily: 'inherit', opacity: egrulLoading ? 0.6 : 1,
              }}
            >{egrulLoading ? '⏳' : '🔎 ЕГРЮЛ'}</button>
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название организации *"
            style={inputStyle}
          />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Юридический адрес"
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email" type="email"
              style={{ ...inputStyle, flex: 1 }}
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Телефон"
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Контактное лицо"
            style={inputStyle}
          />
        </div>
        <div style={{
          padding: '12px 18px',
          borderTop: '1px solid var(--brd-2,var(--brd-m))',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 14px',
              background: 'transparent',
              color: 'var(--t-2,var(--t2))',
              border: '1px solid var(--brd-2,var(--brd-m))',
              borderRadius: 8, cursor: 'pointer',
              fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
            }}
          >Отмена</button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              padding: '7px 14px',
              background: 'linear-gradient(180deg,var(--gold),var(--gold-h,var(--gold)))',
              color: '#0a0a0a',
              border: '1px solid var(--gold-h,var(--gold))',
              borderRadius: 8, cursor: saving ? 'default' : 'pointer',
              fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
              opacity: saving ? 0.6 : 1,
            }}
          >{saving ? '⏳ Сохраняю…' : '💾 Создать и выбрать'}</button>
        </div>
      </div>
    </div>
  );
}
