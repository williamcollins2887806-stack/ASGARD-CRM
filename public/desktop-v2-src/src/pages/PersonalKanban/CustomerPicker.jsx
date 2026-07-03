/**
 * CustomerPicker — модалка поиска контрагента (по имени/ИНН).
 * Паритет с vanilla personal_kanban.js:3554..3631 (_openCustomerPicker).
 *
 * Props:
 *   onClose()          — закрыть модалку
 *   onPicked(customer) — выбран контрагент {name, inn, email, phone, address, contact_person}
 *   onNew()            — открыть «Новый контрагент» (родитель закрывает picker и
 *                        открывает CreateCustomerModal).
 */
import { useState, useEffect, useRef } from 'react';
import { toast } from '@/modals/Notifications';
import { searchCustomers } from './api';

export default function CustomerPicker({ onClose, onPicked, onNew }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  const doSearch = async (q) => {
    setLoading(true);
    try {
      const list = await searchCustomers(q);
      setItems(list);
    } catch (e) {
      setItems([]);
      toast.error('Поиск: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  // Первая загрузка — пустой запрос → 30 последних
  useEffect(() => { doSearch(''); }, []);

  // Debounce 250мс (vanilla тоже 250)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query.trim()), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Esc закрывает
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Фокус на input
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 40); }, []);

  const pick = (c) => {
    onPicked?.({
      id: c.id, name: c.name || '', inn: c.inn || '',
      email: c.email || '', phone: c.phone || '',
      address: c.address || '', contact_person: c.contact_person || '',
    });
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
        width: 'min(640px, 92vw)',
        maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 16px 48px rgba(0,0,0,.6)',
      }}>
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--brd-2,var(--brd-m))',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>👤</span>
          <h3 style={{
            margin: 0, fontFamily: '"Cinzel",Georgia,serif',
            fontSize: 17, color: 'var(--t-1,var(--t1))', flex: 1,
          }}>Выбрать контрагента</h3>
          <button
            type="button"
            onClick={onClose}
            className="pk3-btn-icon"
            style={{
              background: 'transparent', border: 0,
              color: 'var(--t-2,var(--t2))', fontSize: 18, cursor: 'pointer',
            }}
          >✕</button>
        </div>
        <div style={{
          padding: '14px 18px',
          display: 'flex', gap: 8,
          borderBottom: '1px solid var(--brd-2,var(--brd-m))',
        }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по имени или ИНН (минимум 2 символа)"
            style={{
              flex: 1, padding: '9px 12px',
              border: '1px solid var(--brd-2,var(--brd-m))',
              borderRadius: 7,
              background: 'var(--bg-1,var(--bg1))',
              color: 'var(--t-1,var(--t1))',
              fontSize: 14, outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => onNew?.()}
            style={{
              padding: '9px 14px',
              background: 'linear-gradient(180deg,var(--gold),var(--gold-h,var(--gold)))',
              color: '#0a0a0a', border: '1px solid var(--gold-h,var(--gold))',
              borderRadius: 8, fontWeight: 700, cursor: 'pointer',
              fontSize: 13, whiteSpace: 'nowrap', fontFamily: 'inherit',
            }}
          >＋ Новый</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
          {loading && (
            <div style={{
              padding: 24, textAlign: 'center',
              color: 'var(--t-3,var(--t3))', fontStyle: 'italic',
            }}>Ищу…</div>
          )}
          {!loading && !items.length && (
            <div style={{
              padding: 30, textAlign: 'center',
              color: 'var(--t-3,var(--t3))',
            }}>
              <b>Ничего не найдено.</b><br /><br />
              Создайте нового через «＋ Новый»
            </div>
          )}
          {!loading && items.map((c) => (
            <div
              key={c.id || c.inn}
              onClick={() => pick(c)}
              style={{
                padding: '10px 12px', margin: 4,
                border: '1px solid var(--brd-2,var(--brd-m))',
                borderRadius: 8,
                background: 'var(--bg-3,var(--bg3))',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
                transition: 'all .15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--gold-bg,rgba(212,168,93,.12))';
                e.currentTarget.style.borderColor = 'var(--gold)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-3,var(--bg3))';
                e.currentTarget.style.borderColor = 'var(--brd-2,var(--brd-m))';
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 600, color: 'var(--t-1,var(--t1))', fontSize: 14,
                }}>{c.name || '—'}</div>
                <div style={{
                  fontSize: 11.5, color: 'var(--t-3,var(--t3))', marginTop: 2,
                }}>
                  ИНН {c.inn || '—'}
                  {c.address ? ' · ' + c.address : ''}
                  {c.contact_person ? ' · 👤 ' + c.contact_person : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); pick(c); }}
                style={{
                  padding: '5px 11px',
                  background: 'linear-gradient(180deg,var(--gold),var(--gold-h,var(--gold)))',
                  color: '#0a0a0a',
                  border: '1px solid var(--gold-h,var(--gold))',
                  borderRadius: 6, fontWeight: 700,
                  fontSize: 12, cursor: 'pointer',
                  whiteSpace: 'nowrap', fontFamily: 'inherit',
                }}
              >Выбрать →</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
