/**
 * Карточка поставщика: реквизиты + контакты + статистика + история цен.
 * Источник: vanilla `suppliers-page.js` → openSupplierDetail.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Pill } from '@/modals/parts';
import { TextInput, PhoneInput, TextareaInput, Switch } from '@/inputs/Inputs';
import { toast, StatusBadge } from '@/modals/Notifications';
import { ConfirmModal } from '@/modals';
import {
  loadSupplier, loadSupplierStats, loadPriceHistory,
  addContact, updateContact, deleteContact, deleteSupplier,
  fmtMoney, fmtDate, categoryLabel, sourceLabel, emitChanged
} from './api';
import { SupplierEditModal } from './SupplierEditModal';

export function SupplierDetailModal({ id, canWrite, isAdmin }) {
  const { close, open } = useModal();
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    Promise.all([
      loadSupplier(id),
      loadSupplierStats(id),
      loadPriceHistory(id)
    ])
      .then(([d, st, ph]) => {
        setData(d);
        setStats(st && st.summary ? { summary: st.summary, top: st.top_items || [] } : null);
        setHistory(ph);
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [id]);

  if (loading || !data) {
    return (
      <MCard className="modal-lg">
        <MHead icon="🏭" title="Загружаем поставщика…" onClose={close} />
        <MBody>
          <div className="card-empty">⏳ Загружаем…</div>
        </MBody>
      </MCard>
    );
  }

  const s = data.item || data;
  const contacts = data.contacts || [];

  const onEdit = () => {
    open(<SupplierEditModal supplier={s} onSaved={reload} />);
  };

  const onDelete = () => {
    open(
      <ConfirmModal
        tone="danger"
        title="Удалить поставщика?"
        message={`«${s.name}» — действие необратимо.`}
        confirmLabel="Удалить"
        onConfirm={async () => {
          try {
            await deleteSupplier(id);
            toast.success('Поставщик удалён');
            emitChanged();
            close();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onAddContact = () => {
    open(<ContactEditModal supplierId={id} onSaved={reload} />);
  };

  const onMakePrimary = async (c) => {
    try {
      await updateContact(id, c.id, { is_primary: true });
      // P3-fix: контакт изменился — оповестить подписчиков (Procurence/Mimir используют contacts_count)
      emitChanged();
      reload();
    } catch (e) {
      toast.error('Не удалось обновить: ' + (e?.message || e));
    }
  };

  const onDeleteContact = (c) => {
    open(
      <ConfirmModal
        tone="danger"
        title="Удалить контакт?"
        message={`«${c.full_name}» из контактов поставщика`}
        confirmLabel="Удалить"
        onConfirm={async () => {
          try {
            await deleteContact(id, c.id);
            toast.success('Контакт удалён');
            // P3-fix: contacts_count изменился — оповестить подписчиков
            emitChanged();
            reload();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  return (
    <MCard className="modal-xl">
      <MHead
        icon="🏭"
        title={s.name}
        subtitle={[categoryLabel(s.category), s.inn ? 'ИНН ' + s.inn : ''].filter(Boolean).join(' · ')}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-18">
          {/* Статусы */}
          <div className="u-flex gap-8 u-wrap">
            <StatusBadge
              tone={s.is_active !== false ? 'approved' : 'rejected'}
              label={s.is_active !== false ? 'Активен' : 'Неактивен'}
            />
            <Pill>★ {s.rating || '—'}/5</Pill>
            <Pill tone="info">Контактов: {contacts.length}</Pill>
          </div>

          {/* Реквизиты */}
          <Section title="Реквизиты">
            <KV label="ИНН"      value={s.inn || '—'} />
            <KV label="КПП"      value={s.kpp || '—'} />
            <KV label="ОГРН"     value={s.ogrn || '—'} />
            <KV label="Телефон"  value={s.phone || '—'} />
            <KV label="Email"    value={s.email || '—'} />
            <KV label="Сайт"     value={s.website ? <a href={s.website} target="_blank" rel="noreferrer">{s.website}</a> : '—'} />
            <KV label="Адрес"    value={s.address || '—'} />
            <KV label="Категория" value={categoryLabel(s.category)} />
            {s.notes && <KV label="Примечание" value={s.notes} full />}
          </Section>

          {/* Статистика */}
          {stats && (
            <Section title="Статистика">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                <StatCard val={stats.summary.deals_count || 0} lbl="Закупок" />
                <StatCard val={stats.summary.price_points || 0} lbl="Записей цен" />
                <StatCard val={fmtDate(stats.summary.last_price_at)} lbl="Последняя цена" />
              </div>
              {stats.top.length > 0 && (
                <div className="mt-14">
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Топ товаров</div>
                  {stats.top.map((ti, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--brd-1)' }}>
                      <span>{ti.item_name}</span>
                      <span className="c-t3">{ti.cnt} поз. · {fmtMoney(ti.avg_price)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* Контакты */}
          <Section
            title={`Контакты (${contacts.length})`}
            action={canWrite && <Btn size="sm" onClick={onAddContact}>+ Контакт</Btn>}
          >
            {contacts.length === 0 ? (
              <div className="c-t3 fs-13">Контактов нет</div>
            ) : (
              contacts.map((c) => (
                <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto auto', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--brd-1)' }}>
                  <div>
                    <div className="fw-600">{c.full_name}</div>
                    <div className="fs-12 c-t3">{c.role || '—'}</div>
                  </div>
                  <div className="fs-13">
                    {c.phone && <div><a href={'tel:' + c.phone}>{c.phone}</a></div>}
                    {c.email && <div><a href={'mailto:' + c.email}>{c.email}</a></div>}
                    {c.telegram && <div><a href={'https://t.me/' + c.telegram} target="_blank" rel="noreferrer">@{c.telegram}</a></div>}
                  </div>
                  <div className="fs-12 c-t3">{c.notes || ''}</div>
                  <button
                    className="m-btn ghost fs-18"
                    onClick={() => onMakePrimary(c)}
                    title={c.is_primary ? 'Основной контакт' : 'Сделать основным'}
                  >
                    {c.is_primary ? '⭐' : '☆'}
                  </button>
                  {canWrite && (
                    <Btn size="sm" variant="ghost" onClick={() => onDeleteContact(c)} title="Удалить контакт">✕</Btn>
                  )}
                </div>
              ))
            )}
          </Section>

          {/* История цен */}
          <Section title="История цен">
            {(history || []).length === 0 ? (
              <div className="c-t3 fs-13">Записей нет</div>
            ) : (
              <div className="ov-x-auto">
                <table className="cust-table">
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th>Ед.</th>
                      <th>Цена</th>
                      <th>Источник</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice(0, 50).map((r, i) => (
                      <tr key={i}>
                        <td><strong>{r.item_name || r.product_ref_name || '—'}</strong></td>
                        <td>{r.unit || '—'}</td>
                        <td><strong>{fmtMoney(r.unit_price)}</strong></td>
                        <td>{sourceLabel(r.source)}</td>
                        <td className="c-t3">{fmtDate(r.recorded_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      </MBody>
      <MFoot align="spread">
        <div className="u-flex gap-8">
          {isAdmin && <Btn variant="ghost" onClick={onDelete} className="c-err">🗑 Удалить</Btn>}
        </div>
        <div className="u-flex gap-8">
          <Btn onClick={close}>Закрыть</Btn>
          {canWrite && <Btn variant="primary" onClick={onEdit}>✎ Редактировать</Btn>}
        </div>
      </MFoot>
    </MCard>
  );
}

function Section({ title, action, children }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--brd-1)' }}>
        <div className="fw-600 fs-14">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function KV({ label, value, full }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: full ? '1fr' : '160px 1fr', gap: 8, padding: '4px 0' }}>
      <div className="c-t3 fs-13">{label}</div>
      <div className="fs-13">{value}</div>
    </div>
  );
}

function StatCard({ val, lbl }) {
  return (
    <div style={{ background: 'var(--inner-bg)', borderRadius: 'var(--r-md)', padding: 14, textAlign: 'center' }}>
      <div className="fs-22 fw-700">{val}</div>
      <div className="label-cap mt-4">{lbl}</div>
    </div>
  );
}

function ContactEditModal({ supplierId, onSaved }) {
  const { close } = useModal();
  const [form, setForm] = useState({
    full_name: '', role: '', phone: '', email: '', telegram: '', notes: '', is_primary: false
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.full_name.trim()) return toast.warn('Укажите ФИО контакта');
    setBusy(true);
    try {
      await addContact(supplierId, {
        full_name:  form.full_name.trim(),
        role:       form.role || null,
        phone:      form.phone || null,
        email:      form.email || null,
        telegram:   form.telegram || null,
        notes:      form.notes || null,
        is_primary: !!form.is_primary
      });
      toast.success('Контакт добавлен');
      // P3-fix: contacts_count изменился — оповестить подписчиков
      emitChanged();
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="👤" title="Новый контакт" accent="gold" onClose={close} />
      <MBody>
        <div className="col gap-12">
          <Field label="ФИО" required>
            <TextInput value={form.full_name} onChange={(v) => set('full_name', v)} placeholder="Иванов Иван Иванович" />
          </Field>
          <Field label="Должность">
            <TextInput value={form.role} onChange={(v) => set('role', v)} placeholder="Менеджер" />
          </Field>
          <div className="grid-2 gap-10">
            <Field label="Телефон">
              <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} />
            </Field>
            <Field label="Email">
              <TextInput type="email" value={form.email} onChange={(v) => set('email', v)} placeholder="info@example.ru" />
            </Field>
          </div>
          <Field label="Telegram">
            <TextInput value={form.telegram} onChange={(v) => set('telegram', v.replace(/^@/, ''))} placeholder="ник без @" />
          </Field>
          <Field label="Примечание">
            <TextareaInput value={form.notes} onChange={(v) => set('notes', v)} minRows={2} />
          </Field>
          <Switch
            checked={form.is_primary}
            onChange={(v) => set('is_primary', v)}
            label="Основной контакт"
          />
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? '…' : '✓ Добавить'}</Btn>
      </MFoot>
    </MCard>
  );
}
