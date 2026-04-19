import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import {
  Building2, Search, Plus, ChevronRight, X,
  Phone, Mail, MapPin, Copy, Check,
} from 'lucide-react';

export default function Customers() {
  const haptic = useHaptic();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/customers?limit=200');
      setCustomers(api.extractRows(res) || []);
    } catch {
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const filtered = useMemo(() => {
    if (!search) return customers;
    const q = search.toLowerCase();
    return customers.filter((c) =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.inn || '').includes(q) ||
      (c.contact_person || '').toLowerCase().includes(q)
    );
  }, [customers, search]);

  return (
    <PageShell
      title="Контрагенты"
      headerRight={
        <div className="flex items-center gap-1">
          <button
            onClick={() => { haptic.light(); setShowSearch(!showSearch); }}
            className="btn-icon spring-tap"
          >
            <Search size={20} />
          </button>
          <button
            onClick={() => { haptic.light(); setShowCreate(true); }}
            className="btn-icon spring-tap c-blue"
          >
            <Plus size={22} />
          </button>
        </div>
      }
    >
      <PullToRefresh onRefresh={fetchCustomers}>
        {showSearch && (
          <div className="px-1 pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}>
            <div className="search-bar">
              <Search size={16} className="c-tertiary" style={{ flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Поиск по названию или ИНН..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              {search && (
                <button onClick={() => setSearch('')} className="c-tertiary">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <SkeletonList count={6} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Building2}
            iconColor="#7B68EE"
            iconBg="rgba(123, 104, 238, 0.1)"
            title={search ? 'Ничего не найдено' : 'Нет контрагентов'}
            description={search ? 'Попробуйте изменить запрос' : 'Добавьте первого контрагента'}
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((cust, i) => (
              <button
                key={cust.inn || cust.id || i}
                onClick={() => { haptic.light(); setDetail(cust); }}
                className="card-glass w-full text-left px-4 py-3 spring-tap"
                style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div
                      className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                      style={{ background: 'rgba(123, 104, 238, 0.1)' }}
                    >
                      <Building2 size={16} style={{ color: '#7B68EE' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold leading-tight truncate c-primary">
                        {cust.name || cust.short_name || 'Контрагент'}
                      </p>
                      {cust.inn && (
                        <p className="text-[11px] mt-0.5 c-tertiary">
                          ИНН {cust.inn}
                        </p>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 10 }} />
                </div>
                {(cust.contact_person || cust.phone) && (
                  <div className="flex items-center gap-3 mt-2 pl-11.5">
                    {cust.contact_person && (
                      <span className="text-[11px] c-secondary">
                        {cust.contact_person}
                      </span>
                    )}
                    {cust.phone && (
                      <span className="flex items-center gap-0.5 text-[11px] c-tertiary">
                        <Phone size={10} />
                        {cust.phone}
                      </span>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </PullToRefresh>

      <CustomerDetailSheet customer={detail} onClose={() => setDetail(null)} />
      <CreateCustomerSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchCustomers} />
    </PageShell>
  );
}

function CustomerDetailSheet({ customer, onClose }) {
  const [copied, setCopied] = useState(null);

  if (!customer) return null;
  const c = customer;

  const copyInn = () => {
    if (!c.inn) return;
    navigator.clipboard?.writeText(c.inn);
    setCopied('inn');
    setTimeout(() => setCopied(null), 1500);
  };

  const fields = [
    c.inn && {
      label: 'ИНН', value: c.inn, action: (
        <button onClick={copyInn} className="spring-tap" style={{ color: copied === 'inn' ? 'var(--green)' : 'var(--blue)' }}>
          {copied === 'inn' ? <Check size={14} /> : <Copy size={14} />}
        </button>
      ),
    },
    { label: 'Название', value: c.name || c.short_name || '—' },
    c.full_name && { label: 'Полное название', value: c.full_name, full: true },
    c.contact_person && { label: 'Контактное лицо', value: c.contact_person },
    c.phone && { label: 'Телефон', value: c.phone, link: `tel:${c.phone}` },
    c.email && { label: 'Email', value: c.email, link: `mailto:${c.email}` },
    (c.address || c.legal_address) && { label: 'Адрес', value: c.address || c.legal_address, full: true },
    c.kpp && { label: 'КПП', value: c.kpp },
    c.ogrn && { label: 'ОГРН', value: c.ogrn },
    c.category && { label: 'Категория', value: c.category },
    (c.notes || c.comment) && { label: 'Примечания', value: c.notes || c.comment, full: true },
  ].filter(Boolean);

  return (
    <BottomSheet open={!!customer} onClose={onClose} title={c.name || 'Контрагент'}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => (
          <div key={i}>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">
              {f.label}
            </p>
            <div className="flex items-center gap-2">
              {f.link ? (
                <a href={f.link} className="text-[14px] c-blue">
                  {f.value}
                </a>
              ) : (
                <p className={`text-[14px] flex-1 c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>
                  {f.value}
                </p>
              )}
              {f.action}
            </div>
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}

function CreateCustomerSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [inn, setInn] = useState('');
  const [name, setName] = useState('');
  const [fullName, setFullName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  const reset = () => {
    setInn(''); setName(''); setFullName('');
    setContact(''); setPhone(''); setEmail(''); setAddress('');
  };

  const lookupInn = async () => {
    if (!inn || inn.length < 10) return;
    haptic.light();
    setLookingUp(true);
    try {
      const res = await api.get(`/customers/lookup/${inn}`);
      if (res.found && res.suggestion) {
        const s = res.suggestion;
        if (s.name) setName(s.name);
        if (s.full_name) setFullName(s.full_name);
        if (s.address) setAddress(s.address);
      }
    } catch {}
    setLookingUp(false);
  };

  const handleSubmit = async () => {
    if (!inn.trim() || !name.trim()) return;
    haptic.light();
    setSaving(true);
    try {
      await api.post('/customers', {
        inn: inn.trim(),
        name: name.trim(),
        full_name: fullName.trim() || null,
        contact_person: contact.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
      });
      haptic.success();
      reset();
      onClose();
      onCreated();
    } catch {}
    setSaving(false);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Новый контрагент">
      <div className="flex flex-col gap-3 pb-4">
        <FormField label="ИНН *">
          <div className="flex gap-2">
            <input
              type="text" value={inn} onChange={(e) => setInn(e.target.value.replace(/\D/g, '').slice(0, 12))}
              placeholder="10 или 12 цифр"
              className="input-field flex-1"
            />
            <button
              onClick={lookupInn}
              disabled={inn.length < 10 || lookingUp}
              className="px-3 py-2.5 rounded-xl text-[12px] font-semibold spring-tap shrink-0"
              style={{
                background: inn.length >= 10 ? 'color-mix(in srgb, var(--blue) 15%, transparent)' : 'var(--bg-surface-alt)',
                color: inn.length >= 10 ? 'var(--blue)' : 'var(--text-tertiary)',
                border: '0.5px solid var(--border-norse)',
              }}
            >
              {lookingUp ? '...' : 'Найти'}
            </button>
          </div>
        </FormField>

        <FormField label="Краткое наименование *">
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="ООО Компания"
            className="input-field"
          />
        </FormField>

        <FormField label="Полное наименование">
          <input
            type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
            placeholder="Общество с ограниченной ответственностью..."
            className="input-field"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-2">
          <FormField label="Контактное лицо">
            <input
              type="text" value={contact} onChange={(e) => setContact(e.target.value)}
              placeholder="ФИО"
              className="input-field"
            />
          </FormField>
          <FormField label="Телефон">
            <input
              type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="+7-900-000-00-00"
              className="input-field"
            />
          </FormField>
        </div>

        <FormField label="Email">
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            className="input-field"
          />
        </FormField>

        <FormField label="Адрес">
          <input
            type="text" value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="Юридический адрес"
            className="input-field"
          />
        </FormField>

        <button
          onClick={handleSubmit}
          disabled={!inn.trim() || !name.trim() || saving}
          className="btn-primary spring-tap mt-1"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Сохранение...' : 'Создать контрагента'}
        </button>
      </div>
    </BottomSheet>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="input-label">
        {label}
      </label>
      {children}
    </div>
  );
}
