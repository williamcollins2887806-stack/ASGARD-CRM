/**
 * PayeeSelector (V240) — поиск/создание родственника-получателя НПД-выплат.
 */
import { useEffect, useRef, useState } from 'react';
import { Btn, Field } from '@/modals/parts';
import { TextInput, PhoneInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { searchPayees, createPayee } from './api';

export function PayeeSelector({ payeeId, payeeFio, payeePhone, payeeInn, canCreate, onPick, onUnlink }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState({ fio: '', phone: '', inn: '' });
  const [savingNew, setSavingNew] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!q || q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const items = await searchPayees(q.trim(), 20);
        if (!cancelled) {
          setResults(items || []);
          setOpen(true);
        }
      } catch (_) {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const handlePick = (p) => {
    onPick?.(p);
    setQ('');
    setResults([]);
    setOpen(false);
  };

  const openCardHash = () => {
    if (!payeeId) return;
    location.hash = '#/employee?id=' + Number(payeeId);
  };

  const submitCreate = async () => {
    const fio = (newForm.fio || '').trim();
    if (!fio) { toast.warn('ФИО обязательно'); return; }
    setSavingNew(true);
    try {
      const created = await createPayee({
        fio,
        phone: (newForm.phone || '').trim() || null,
        inn: (newForm.inn || '').trim() || null,
      });
      if (!created || !created.id) {
        toast.error('Сервер не вернул id получателя');
      } else {
        onPick?.({
          id: created.id,
          fio: created.fio || fio,
          phone: created.phone || newForm.phone || '',
          inn: created.inn || newForm.inn || '',
        });
        toast.success('Получатель создан');
        setCreating(false);
        setNewForm({ fio: '', phone: '', inn: '' });
      }
    } catch (err) {
      toast.error('Не удалось создать: ' + (err?.message || err));
    } finally {
      setSavingNew(false);
    }
  };

  return (
    <div ref={wrapRef} className="emp-payee-wrap">
      {payeeId && (
        <div className="emp-payee-card">
          <div className="emp-payee-card-body">
            <div className="emp-payee-card-fio">{payeeFio || ('id=' + payeeId)}</div>
            <div className="emp-payee-card-meta">
              {['id=' + payeeId, payeePhone, payeeInn ? 'ИНН ' + payeeInn : null]
                .filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className="row gap-6">
            <Btn size="sm" onClick={onUnlink}>Открепить</Btn>
            <Btn size="sm" onClick={openCardHash}>Открыть карточку</Btn>
          </div>
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <TextInput
          value={q}
          onChange={setQ}
          placeholder={payeeId ? 'Сменить получателя…' : 'Поиск по ФИО или телефону…'}
          aria-label="Поиск получателя НПД"
        />
        {open && (
          <div className="emp-payee-dropdown">
            {loading && <div className="emp-payee-dropdown-empty">Ищем…</div>}
            {!loading && results.length === 0 && (
              <div className="emp-payee-dropdown-empty">
                Никого не нашли. {canCreate ? 'Попробуйте создать нового.' : ''}
              </div>
            )}
            {!loading && results.map((p) => (
              <button
                type="button"
                key={p.id}
                className="emp-payee-dropdown-item"
                onClick={() => handlePick(p)}
              >
                <div className="emp-payee-card-fio">
                  {p.fio || '—'}
                  {p.linked_count != null && (
                    <span className="c-t3"> (привязано: {p.linked_count})</span>
                  )}
                </div>
                <div className="emp-payee-card-meta">
                  id={p.id}
                  {p.phone ? ' · ' + p.phone : ''}
                  {p.inn ? ' · ИНН ' + p.inn : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {canCreate && !creating && (
        <div style={{ marginTop: 8 }}>
          <Btn size="sm" onClick={() => setCreating(true)}>+ Создать нового получателя</Btn>
        </div>
      )}

      {creating && (
        <div className="emp-payee-create">
          <div className="emp-form-section-title">+ Новый получатель НПД</div>
          <div className="col gap-10">
            <Field label="ФИО" required>
              <TextInput
                value={newForm.fio}
                onChange={(v) => setNewForm((f) => ({ ...f, fio: v }))}
                placeholder="Иванов Иван Иванович"
              />
            </Field>
            <Field label="Телефон">
              <PhoneInput
                value={newForm.phone}
                onChange={(v) => setNewForm((f) => ({ ...f, phone: v }))}
              />
            </Field>
            <Field label="ИНН (опц.)" help="12 цифр">
              <TextInput
                value={newForm.inn}
                onChange={(v) => setNewForm((f) => ({ ...f, inn: v.replace(/\D/g, '').slice(0, 12) }))}
                placeholder="123456789012"
                inputMode="numeric"
              />
            </Field>
            <div className="row-end gap-8">
              <Btn size="sm" onClick={() => { setCreating(false); setNewForm({ fio: '', phone: '', inn: '' }); }}>
                Отмена
              </Btn>
              <Btn size="sm" variant="primary" disabled={savingNew || !newForm.fio.trim()} onClick={submitCreate}>
                {savingNew ? 'Создаём…' : 'Создать'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
