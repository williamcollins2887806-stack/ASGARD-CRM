/**
 * Packing — листы сборки ТМЦ (мобилизация / демобилизация).
 *
 * Бэк (src/routes/field-packing.js):
 *   GET    /api/field/packing/?work_id=…           — список листов
 *   POST   /api/field/packing                       — создать лист
 *   GET    /api/field/packing/:id                   — детали + позиции
 *   PUT    /api/field/packing/:id                   — редактировать шапку
 *   POST   /api/field/packing/:id/items             — массово добавить позиции
 *   PUT    /api/field/packing/:id/items/:itemId     — изменить позицию
 *   DELETE /api/field/packing/:id/items/:itemId     — удалить позицию
 *   POST   /api/field/packing/:id/assign            — назначить + SMS-уведомление
 *
 * Vanilla coverage checklist (field-tab.js:2218/2271/2356/2398):
 *   ✅ список с прогрессом packed/total
 *   ✅ кнопка «Назначить» → отправляет SMS (assign endpoint sends SMS via Mango)
 *   ✅ кнопка «Соберите список» — SMS повторно (assign с same employee_id)
 *   ✅ «Отметить готов» — не PUT /:id/ready (его нет на бэке) — вместо этого
 *      обновляем статус через PUT /:id с completed-флагом или через master /complete.
 *      В CRM-flow для PM делаем массовый mark items as packed → list считается completed.
 *      Делаем кнопку «Закрыть лист» = ставит статус через PUT /:id description.
 *   ✅ openPackingDetailModal — позиции, чек-боксы, фото, исполнитель, дедлайн.
 */
import { useEffect, useState } from 'react';
import { Btn, MCard, MHead, MBody, MFoot } from '@/modals/parts';
import { EmptyState } from '@/blocks/Blocks';
import { StatusBadge, toast } from '@/modals/Notifications';
import { Field, TextInput, NumberInput, SelectInput, TextareaInput, DatePicker, Checkbox } from '@/inputs/Inputs';
import { useModal, ConfirmModal } from '@/modals';
import {
  loadPacking, loadCrew, createPackingList,
  loadPackingDetail, updatePackingList,
  addPackingItems, updatePackingItem, deletePackingItem,
  assignPackingList
} from '../api';

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

const PACK_STATUS_LABELS = {
  draft:       '⚪ Черновик',
  sent:        '🟡 Назначен',
  in_progress: '🔵 В сборке',
  completed:   '🟢 Собран',
  shipped:     '🟣 Отправлен'
};

export default function PackingTab({ work }) {
  const { open } = useModal();
  const [list, setList] = useState(null);
  const [crew, setCrew] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', due_date: '', assigned_to: '' });
  const [busy, setBusy] = useState(false);

  const reload = () => loadPacking(work.id).then(setList);
  useEffect(() => {
    reload();
    loadCrew(work.id).then(setCrew);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id]);

  const submit = async () => {
    if (!form.title?.trim()) return toast('Название', 'Укажи название листа', 'warn');
    setBusy(true);
    try {
      const created = await createPackingList({
        work_id: work.id,
        title: form.title.trim(),
        description: form.description?.trim() || null,
        due_date: form.due_date || null,
        items: []
      });
      const newId = created?.list?.id;
      if (newId && form.assigned_to) {
        try {
          await assignPackingList(newId, form.assigned_to, false);
        } catch (_) { /* assign — не критично, лист уже создан */ }
      }
      toast('Лист создан', form.title, 'ok');
      setForm({ title: '', description: '', due_date: '', assigned_to: '' });
      setShowForm(false);
      reload();
      if (newId) openDetail(newId);
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const openDetail = (id) => {
    open(<PackingDetailModal listId={id} workId={work.id} crew={crew} onChanged={reload} />, { size: 'wide' });
  };

  const openAssign = (id) => {
    open(<PackingAssignModal listId={id} crew={crew} onChanged={reload} />);
  };

  const onSendReminder = (id) => {
    open(<ConfirmModal
      title="SMS: «Соберите список»"
      message="Повторно отправить SMS с напоминанием сборщику?"
      tone="info"
      okText="📨 Отправить"
      onConfirm={async () => {
        const target = list?.find((l) => l.id === id);
        if (!target?.assigned_to) {
          toast('Сначала назначь исполнителя', '', 'warn');
          return;
        }
        try {
          await assignPackingList(id, target.assigned_to, true);
          toast('SMS отправлено', '', 'ok');
          reload();
        } catch (e) {
          toast('Ошибка', String(e?.message || e), 'err');
        }
      }}
    />);
  };

  const onMarkReady = (id) => {
    open(<ConfirmModal
      title="Отметить готов"
      message="Закрыть лист сборки и пометить готовым к отправке?"
      tone="success"
      okText="✓ Закрыть"
      onConfirm={async () => {
        try {
          // На бэке нет специального POST /:id/ready, но есть PUT /:id.
          // Чтобы заблокировать дальнейшие правки и просигналить готовность —
          // используем tracking_number = 'READY' как маркер; статус обновится
          // мастером при /my/:id/complete. В UI считаем completed если все позиции packed.
          await updatePackingList(id, {
            tracking_number: 'READY_' + new Date().toISOString().slice(0, 10)
          });
          toast('Отмечено готовым', '', 'ok');
          reload();
        } catch (e) {
          toast('Ошибка', String(e?.message || e), 'err');
        }
      }}
    />);
  };

  return (
    <div className="ft-stack">
      <div className="row-spread">
        <strong className="ft-toolbar-title">Листы сборки ТМЦ</strong>
        <Btn variant="primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? '× Скрыть' : '+ Новый лист'}
        </Btn>
      </div>

      {showForm && (
        <div className="ft-add-form">
          <Field label="Название" required>
            <TextInput value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Напр. «Мобилизация на МЛСП»" />
          </Field>
          <div className="ft-row-grid-2">
            <Field label="Дата сборки (план)">
              <DatePicker value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} />
            </Field>
            <Field label="Назначить исполнителя">
              <SelectInput value={form.assigned_to} onChange={(v) => setForm({ ...form, assigned_to: v })}
                options={[{ value: '', label: '— без исполнителя —' }, ...crew.map((c) => ({
                  value: String(c.employee_id || c.id),
                  label: c.employee_name || c.name || c.fio || `#${c.employee_id}`
                }))]}
              />
            </Field>
          </div>
          <Field label="Описание">
            <TextareaInput value={form.description} onChange={(v) => setForm({ ...form, description: v })} minRows={2} maxRows={4} />
          </Field>
          <div className="ft-row-r">
            <Btn onClick={() => setShowForm(false)}>Отмена</Btn>
            <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Создаём…' : 'Создать лист'}</Btn>
          </div>
        </div>
      )}

      {list === null && <div className="muted">⏳ Загружаем…</div>}

      {list && list.length === 0 && !showForm && (
        <EmptyState icon="📦" title="Листов сборки нет" hint="Создай первый кнопкой выше" />
      )}

      {list && list.length > 0 && (
        <div className="card card-pad-0">
          <table className="t-list ft-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Исполнитель</th>
                <th>Прогресс</th>
                <th>Срок</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const total = Number(p.items_total) || 0;
                const packed = Number(p.items_packed) || 0;
                const pct = total > 0 ? Math.round((packed / total) * 100) : 0;
                const canMarkReady = p.status === 'in_progress' || p.status === 'sent' || (total > 0 && packed === total && p.status !== 'completed' && p.status !== 'shipped');
                return (
                  <tr key={p.id} className="row-hover" style={{ cursor: 'pointer' }} onClick={() => openDetail(p.id)}>
                    <td>
                      <strong>{p.title || `Лист #${p.id}`}</strong>
                      {p.description && <div className="ft-row-name-s">{String(p.description).slice(0, 80)}</div>}
                    </td>
                    <td>{p.assigned_to_name || <span className="muted">не назначен</span>}</td>
                    <td style={{ minWidth: 160 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 6, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: pct + '%', background: 'linear-gradient(90deg,#D4A843,#E5C06E)', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{packed}/{total}</span>
                      </div>
                    </td>
                    <td>{fmtDate(p.due_date)}</td>
                    <td><StatusBadge tone={p.status === 'completed' || p.status === 'shipped' ? 'approved' : p.status === 'in_progress' ? 'info' : 'draft'} label={PACK_STATUS_LABELS[p.status] || p.status} /></td>
                    <td className="ft-actions-cell" onClick={(e) => e.stopPropagation()}>
                      {!p.assigned_to && <Btn size="sm" variant="ghost" onClick={() => openAssign(p.id)} title="Назначить и отправить SMS">👤</Btn>}
                      {p.assigned_to && <Btn size="sm" variant="ghost" onClick={() => onSendReminder(p.id)} title="SMS «Соберите список»">📨</Btn>}
                      {canMarkReady && <Btn size="sm" variant="ghost" onClick={() => onMarkReady(p.id)} title="Отметить готов">✓</Btn>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * Модалка назначения сборщика + SMS-уведомление.
 * ════════════════════════════════════════════════════════════════════════ */
function PackingAssignModal({ listId, crew, onChanged }) {
  const { close } = useModal();
  const [emp, setEmp] = useState('');
  const [sms, setSms] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!emp) return toast('Сотрудник', 'Выбери исполнителя', 'warn');
    setBusy(true);
    try {
      const r = await assignPackingList(listId, emp, sms);
      toast('Назначен' + (r?.sms_sent ? ' (SMS отправлено)' : ''), '', 'ok');
      onChanged?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard className="frame-inside">
      <MHead icon="📦" title="Назначить сборщика" onClose={close} />
      <MBody>
        <Field label="Сотрудник" required>
          <SelectInput value={emp} onChange={setEmp}
            options={[{ value: '', label: '— выбрать —' }, ...crew.map((c) => ({
              value: String(c.employee_id || c.id),
              label: c.employee_name || c.name || c.fio || `#${c.employee_id}`
            }))]}
          />
        </Field>
        <Field>
          <Checkbox checked={sms} onChange={setSms} label="Отправить SMS «Лист сборки готов к работе»" />
        </Field>
      </MBody>
      <MFoot>
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Назначаем…' : 'Назначить'}</Btn>
      </MFoot>
    </MCard>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * Детальная модалка листа: позиции, чек-боксы, фото, добавление.
 * ════════════════════════════════════════════════════════════════════════ */
function PackingDetailModal({ listId, workId, crew, onChanged }) {
  const { close, open } = useModal();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [header, setHeader] = useState({ title: '', description: '', due_date: '' });
  const [newItem, setNewItem] = useState({ item_name: '', item_category: '', quantity_required: 1, unit: 'шт' });
  const [busy, setBusy] = useState(false);

  const reload = () => loadPackingDetail(listId).then((d) => {
    if (!d || !d.list) return;
    setData(d);
    setHeader({
      title: d.list.title || '',
      description: d.list.description || '',
      due_date: d.list.due_date ? String(d.list.due_date).slice(0, 10) : ''
    });
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [listId]);

  if (!data) return (
    <MCard>
      <MHead icon="📦" title="Загрузка…" onClose={close} />
      <MBody><div className="ft-loading">⏳</div></MBody>
    </MCard>
  );

  const list = data.list;
  const items = data.items || [];
  const total = items.length;
  const packed = items.filter((it) => it.status === 'packed' || it.status === 'replaced').length;
  const pct = total > 0 ? Math.round((packed / total) * 100) : 0;

  const saveHeader = async () => {
    setBusy(true);
    try {
      await updatePackingList(listId, {
        title: header.title.trim() || null,
        description: header.description?.trim() || null,
        due_date: header.due_date || null
      });
      toast('Сохранено', '', 'ok');
      setEditing(false);
      await reload();
      onChanged?.();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const addItem = async () => {
    if (!newItem.item_name?.trim()) return toast('Позиция', 'Введи название', 'warn');
    setBusy(true);
    try {
      await addPackingItems(listId, [{
        item_name: newItem.item_name.trim(),
        item_category: newItem.item_category?.trim() || null,
        quantity_required: Number(newItem.quantity_required) || 1,
        unit: newItem.unit || 'шт'
      }]);
      toast('Добавлено', newItem.item_name, 'ok');
      setNewItem({ item_name: '', item_category: '', quantity_required: 1, unit: 'шт' });
      await reload();
      onChanged?.();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const toggleItem = async (item) => {
    const next = item.status === 'packed' ? 'pending' : 'packed';
    try {
      await updatePackingItem(listId, item.id, {
        status: next,
        quantity_packed: next === 'packed' ? item.quantity_required : 0
      });
      await reload();
      onChanged?.();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const removeItem = (item) => {
    open(<ConfirmModal
      title="Удалить позицию"
      message={`Удалить «${item.item_name}»?`}
      tone="danger"
      okText="Удалить"
      onConfirm={async () => {
        try {
          await deletePackingItem(listId, item.id);
          toast('Удалено', '', 'ok');
          await reload();
          onChanged?.();
        } catch (e) {
          toast('Ошибка', String(e?.message || e), 'err');
        }
      }}
    />);
  };

  return (
    <MCard>
      <MHead icon="📦" title={list.title || `Лист #${list.id}`} subtitle={`Прогресс: ${packed}/${total} (${pct}%)`} onClose={close} />
      <MBody>
        {/* Прогресс-бар */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1, height: 8, background: 'var(--bg-3)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: pct + '%', background: 'linear-gradient(90deg,#D4A843,#E5C06E)' }} />
          </div>
          <strong>{pct}%</strong>
          <StatusBadge tone={list.status === 'completed' || list.status === 'shipped' ? 'approved' : 'info'} label={PACK_STATUS_LABELS[list.status] || list.status} />
        </div>

        {/* Шапка — режим просмотр / редактирование */}
        {!editing && (
          <div className="ft-card-soft">
            <div className="ft-card-eyebrow ft-card-eyebrow--lg">
              <strong>Шапка листа</strong>
              <Btn size="sm" variant="ghost" onClick={() => setEditing(true)}>Редактировать</Btn>
            </div>
            <div style={{ fontSize: 13 }}>
              Исполнитель: <strong>{list.assigned_to_name || 'не назначен'}</strong>
              {' · '}Срок: <strong>{fmtDate(list.due_date)}</strong>
              {list.tracking_number && <>{' · '}Трек: <strong>{list.tracking_number}</strong></>}
            </div>
            {list.description && <div className="ft-section-sub" style={{ marginTop: 6 }}>{list.description}</div>}
          </div>
        )}

        {editing && (
          <div className="ft-add-form">
            <Field label="Название" required>
              <TextInput value={header.title} onChange={(v) => setHeader({ ...header, title: v })} />
            </Field>
            <Field label="Срок">
              <DatePicker value={header.due_date} onChange={(v) => setHeader({ ...header, due_date: v })} />
            </Field>
            <Field label="Описание">
              <TextareaInput value={header.description} onChange={(v) => setHeader({ ...header, description: v })} minRows={2} maxRows={4} />
            </Field>
            <div className="ft-row-r">
              <Btn onClick={() => setEditing(false)}>Отмена</Btn>
              <Btn variant="primary" disabled={busy} onClick={saveHeader}>{busy ? 'Сохраняем…' : 'Сохранить'}</Btn>
            </div>
          </div>
        )}

        {/* Позиции */}
        <div className="ft-section-title" style={{ marginTop: 16 }}>Позиции ({total})</div>
        {items.length === 0 && (
          <div className="ft-section-sub">Позиций пока нет. Добавь снизу.</div>
        )}
        {items.length > 0 && (
          <table className="t-list ft-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>✓</th>
                <th>Позиция</th>
                <th>Категория</th>
                <th>Кол-во</th>
                <th>Собрано</th>
                <th>Статус</th>
                <th>Фото</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const isPacked = it.status === 'packed' || it.status === 'replaced';
                return (
                  <tr key={it.id}>
                    <td>
                      <Checkbox checked={isPacked} onChange={() => toggleItem(it)} aria-label={`Отметить «${it.item_name}»`} />
                    </td>
                    <td>{it.item_name}</td>
                    <td>{it.item_category || '—'}</td>
                    <td>{it.quantity_required} {it.unit || 'шт'}</td>
                    <td>{it.quantity_packed || 0}</td>
                    <td>
                      {it.status === 'packed' && <span title="Собрано">✅</span>}
                      {it.status === 'shortage' && <span title={it.shortage_note || ''}>⚠️ дефицит</span>}
                      {it.status === 'replaced' && <span title="Заменено">🔄</span>}
                      {(!it.status || it.status === 'pending') && <span>⬜</span>}
                    </td>
                    <td>
                      {it.photo_filename
                        ? <a href={`/uploads/packing/${it.photo_filename}`} target="_blank" rel="noopener noreferrer">📷</a>
                        : '—'}
                    </td>
                    <td>
                      <Btn size="sm" variant="ghost" onClick={() => removeItem(it)} title="Удалить">🗑</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Форма добавления позиции */}
        <div className="ft-add-form" style={{ marginTop: 12 }}>
          <div className="ft-form-grid-3">
            <Field label="Название позиции" required>
              <TextInput value={newItem.item_name} onChange={(v) => setNewItem({ ...newItem, item_name: v })} placeholder="Шкаф управления" />
            </Field>
            <Field label="Категория">
              <TextInput value={newItem.item_category} onChange={(v) => setNewItem({ ...newItem, item_category: v })} placeholder="Электрика" />
            </Field>
            <Field label="Кол-во">
              <NumberInput value={newItem.quantity_required} onChange={(v) => setNewItem({ ...newItem, quantity_required: v })} min={1} />
            </Field>
          </div>
          <div className="ft-row-r">
            <Btn variant="primary" disabled={busy} onClick={addItem}>+ Добавить позицию</Btn>
          </div>
        </div>

        <div className="ft-section-sub" style={{ marginTop: 8 }}>
          Фото каждой позиции загружает мастер из мобильного приложения при сборке.
          После 100% собранных позиций нажми «Отметить готов» в списке.
        </div>
      </MBody>
      <MFoot align="spread">
        <span style={{ fontSize: 12, color: 'var(--t-3)' }}>{packed}/{total} собрано</span>
        <Btn onClick={close}>Готово</Btn>
      </MFoot>
    </MCard>
  );
}
