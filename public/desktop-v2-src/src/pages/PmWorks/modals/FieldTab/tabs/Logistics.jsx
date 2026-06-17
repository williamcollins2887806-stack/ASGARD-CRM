/**
 * Logistics — матрица «сотрудник × тип» (туда / отель / обратно / виза / страховка).
 *
 * Бэк (src/routes/field-logistics.js):
 *   GET    /api/field/logistics?work_id=…       — список (CRM auth)
 *   POST   /api/field/logistics                 — создать
 *   PUT    /api/field/logistics/:id             — редактировать (title/dates/amount/...)
 *   POST   /api/field/logistics/:id/attach      — прикрепить документ (multipart, → status='ready')
 *   POST   /api/field/logistics/:id/purchased   — отметить «куплено» (Office-Manager workflow)
 *   POST   /api/field/logistics/:id/send        — отправить SMS пассажиру (→ status='sent')
 *   DELETE /api/field/logistics/:id             — удалить
 *
 * Vanilla coverage checklist (field-tab.js:859):
 *   ✅ матрица сотрудник×тип вместо плоского списка
 *   ✅ каждая ячейка: статус, дата, цена, кнопки «купить» / «загрузить файл» / «SMS»
 *   ✅ использование POST /:id/purchased — задействовано
 *   ✅ роль PM может работать со всеми типами LOG_MATRIX_TYPES.
 */
import { useEffect, useState, useRef } from 'react';
import { Btn, MCard, MHead, MBody, MFoot } from '@/modals/parts';
import { EmptyState } from '@/blocks/Blocks';
import { toast } from '@/modals/Notifications';
import { Field, TextInput, MoneyInput, DatePicker, SelectInput, TextareaInput } from '@/inputs/Inputs';
import { useModal, ConfirmModal } from '@/modals';
import {
  loadLogistics, loadCrew,
  createLogistics, deleteLogistics, sendLogistics,
  markLogisticsPurchased, updateLogistics, attachLogisticsFile
} from '../api';
import { LOG_MATRIX_TYPES, LOG_STATUS_LABELS } from '../constants';

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

const STATUS_DOTS = {
  pending:   { dot: '⏳', color: 'var(--amber)' },
  purchased: { dot: '💳', color: 'var(--info)' },
  ready:     { dot: '📋', color: 'var(--info)' },
  sent:      { dot: '📨', color: 'var(--ok)' }
};

export default function LogisticsTab({ work }) {
  const { open } = useModal();
  const [items, setItems] = useState(null);
  const [crew, setCrew] = useState([]);

  const reload = () => loadLogistics(work.id).then(setItems);
  useEffect(() => {
    reload();
    loadCrew(work.id).then(setCrew);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id]);

  // Список сотрудников: уникально из бригады.
  const employees = (crew || [])
    .filter((c) => c.is_active !== false)
    .map((c) => ({
      id: c.employee_id || c.id,
      fio: c.employee_name || c.name || c.fio || `#${c.employee_id || c.id}`
    }));

  // Дополним сотрудниками, у которых уже есть логистика, но их нет в crew
  // (на случай если человек убыл, а билеты остались).
  if (items) {
    const seen = new Set(employees.map((e) => e.id));
    items.forEach((it) => {
      if (!seen.has(it.employee_id)) {
        seen.add(it.employee_id);
        employees.push({ id: it.employee_id, fio: it.fio || `#${it.employee_id}` });
      }
    });
  }

  // matrix[employee_id][item_type] = item
  const matrix = {};
  (items || []).forEach((it) => {
    if (!matrix[it.employee_id]) matrix[it.employee_id] = {};
    // Если несколько записей одного типа на сотрудника — берём самую свежую (по created_at).
    const cur = matrix[it.employee_id][it.item_type];
    if (!cur || new Date(it.created_at) > new Date(cur.created_at)) {
      matrix[it.employee_id][it.item_type] = it;
    }
  });

  const openCreate = (employeeId, employeeFio, itemType) => {
    open(<LogisticsCellModal
      mode="create"
      work={work}
      employee={{ id: employeeId, fio: employeeFio }}
      itemType={itemType}
      onChanged={reload}
    />);
  };

  const openEdit = (item, employeeFio) => {
    open(<LogisticsCellModal
      mode="edit"
      work={work}
      employee={{ id: item.employee_id, fio: employeeFio }}
      itemType={item.item_type}
      item={item}
      onChanged={reload}
    />);
  };

  const onPurchased = async (item) => {
    try {
      await markLogisticsPurchased(item.id);
      toast('Куплено', '', 'ok');
      reload();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const onSend = async (item) => {
    try {
      const r = await sendLogistics(item.id);
      toast('Отправлено', r?.sms_sent ? 'SMS пассажиру' : 'Push уведомление', 'ok');
      reload();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const onDelete = (item) => {
    open(<ConfirmModal
      title="Удалить запись"
      message="Удалить запись логистики?"
      tone="danger"
      okText="Удалить"
      onConfirm={async () => {
        try {
          await deleteLogistics(item.id);
          toast('Удалено', '', 'ok');
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
        <div>
          <strong className="ft-toolbar-title">Логистика бригады</strong>
          <div className="ft-toolbar-sub">{employees.length} чел. · клик «+» — добавить, клик по ячейке — редактировать</div>
        </div>
      </div>

      {items === null && <div className="muted">⏳ Загружаем…</div>}

      {items && employees.length === 0 && (
        <EmptyState icon="✈️" title="В бригаде нет сотрудников" hint="Сначала добавь людей на вкладке «Бригада»" />
      )}

      {items && employees.length > 0 && (
        <div className="card ft-table-wrap">
          <table className="t-list ft-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>Сотрудник</th>
                {LOG_MATRIX_TYPES.map((lt) => (
                  <th key={lt.value} style={{ textAlign: 'center' }}>{lt.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="row-hover">
                  <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{emp.fio}</td>
                  {LOG_MATRIX_TYPES.map((lt) => {
                    const item = matrix[emp.id]?.[lt.value];
                    return (
                      <td key={lt.value} style={{ padding: 6, textAlign: 'center', minWidth: 130 }}>
                        {!item && (
                          <button
                            type="button"
                            onClick={() => openCreate(emp.id, emp.fio, lt.value)}
                            title={`Добавить ${lt.label}`}
                            style={{
                              width: 32, height: 32, borderRadius: 8,
                              border: '1px dashed var(--brd)', background: 'transparent',
                              color: 'var(--t-3)', cursor: 'pointer', fontSize: 16
                            }}
                          >+</button>
                        )}
                        {item && (
                          <LogisticsCell
                            item={item}
                            onEdit={() => openEdit(item, emp.fio)}
                            onPurchased={() => onPurchased(item)}
                            onSend={() => onSend(item)}
                            onDelete={() => onDelete(item)}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LogisticsCell({ item, onEdit, onPurchased, onSend, onDelete }) {
  const st = STATUS_DOTS[item.status] || STATUS_DOTS.pending;
  const canPurchase = item.status === 'pending';
  const canSend = item.status === 'ready' || item.status === 'purchased';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2, fontSize: 11 }}>
      <button
        type="button"
        onClick={onEdit}
        title={`${item.title} · ${LOG_STATUS_LABELS[item.status] || item.status}`}
        style={{
          background: st.color + '22',
          color: st.color,
          border: '1px solid ' + st.color + '55',
          borderRadius: 6,
          padding: '3px 6px',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 11,
          textAlign: 'left',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {st.dot} {String(item.title || '').slice(0, 18) || '—'}
      </button>
      <div style={{ display: 'flex', gap: 4, fontSize: 10, color: 'var(--t-3)' }}>
        <span>{fmtDate(item.date_from)}</span>
        <span style={{ marginLeft: 'auto' }}>{item.amount ? fmtMoney(item.amount) : ''}</span>
      </div>
      <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
        {canPurchase && (
          <button type="button" onClick={onPurchased} title="Отметить куплено"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>💳</button>
        )}
        {canSend && (
          <button type="button" onClick={onSend} title="Отправить SMS"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>📨</button>
        )}
        <button type="button" onClick={onDelete} title="Удалить"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>🗑</button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * Модалка ячейки — создание или редактирование одной записи логистики.
 * Включает: title/dates/amount/transport_no/description + загрузка файла.
 * ════════════════════════════════════════════════════════════════════════ */
function LogisticsCellModal({ mode, work, employee, itemType, item, onChanged }) {
  const { close } = useModal();
  const fileRef = useRef(null);
  const matrixType = LOG_MATRIX_TYPES.find((t) => t.value === itemType) || { label: itemType };
  const [form, setForm] = useState(() => ({
    title: item?.title || '',
    description: item?.description || '',
    date_from: item?.date_from ? String(item.date_from).slice(0, 10) : '',
    date_to: item?.date_to ? String(item.date_to).slice(0, 10) : '',
    amount: item?.amount || '',
    transport_no: item?.transport_no || '',
    status: item?.status || 'pending'
  }));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const submit = async () => {
    if (!form.title?.trim()) return toast('Описание', 'Укажи название (рейс/отель/документ)', 'warn');
    setBusy(true);
    try {
      if (mode === 'create') {
        await createLogistics({
          work_id: work.id,
          employee_id: employee.id,
          item_type: itemType,
          title: form.title.trim(),
          description: form.description || null,
          date_from: form.date_from || null,
          date_to: form.date_to || null,
          amount: form.amount ? Number(form.amount) : null,
          transport_no: form.transport_no || null
        });
        toast('Добавлено', matrixType.label, 'ok');
      } else {
        await updateLogistics(item.id, {
          title: form.title.trim(),
          description: form.description || null,
          date_from: form.date_from || null,
          date_to: form.date_to || null,
          amount: form.amount ? Number(form.amount) : null,
          transport_no: form.transport_no || null
        });
        toast('Сохранено', '', 'ok');
      }
      onChanged?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const onPurchase = async () => {
    if (!item?.id) return;
    try {
      await markLogisticsPurchased(item.id);
      toast('Куплено', '', 'ok');
      onChanged?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const onSendNow = async () => {
    if (!item?.id) return;
    try {
      await sendLogistics(item.id);
      toast('Отправлено', 'SMS пассажиру', 'ok');
      onChanged?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !item?.id) return;
    setUploading(true);
    try {
      await attachLogisticsFile(item.id, file);
      toast('Файл загружен', file.name, 'ok');
      onChanged?.();
      close();
    } catch (err) {
      toast('Ошибка загрузки', String(err?.message || err), 'err');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <MCard>
      <MHead
        icon="✈️"
        title={mode === 'create' ? `+ ${matrixType.label}` : `${matrixType.label} — ${employee.fio}`}
        subtitle={mode === 'create' ? employee.fio : `Статус: ${LOG_STATUS_LABELS[form.status] || form.status}`}
        onClose={close}
      />
      <MBody>
        <Field label="Сотрудник">
          <SelectInput value={String(employee.id)} disabled options={[{ value: String(employee.id), label: employee.fio }]} />
        </Field>
        <Field label="Тип">
          <SelectInput value={itemType} disabled options={[{ value: itemType, label: matrixType.label }]} />
        </Field>
        <Field label="Название" required help="Напр. «S7-2541 Москва→Кемерово» или «Hilton Tula 14-21.06»">
          <TextInput value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
        </Field>
        <Field label="Описание / комментарий">
          <TextareaInput value={form.description} onChange={(v) => setForm({ ...form, description: v })} minRows={2} maxRows={4} />
        </Field>
        <div className="ft-log-grid-4">
          <Field label="Дата с">
            <DatePicker value={form.date_from} onChange={(v) => setForm({ ...form, date_from: v })} />
          </Field>
          <Field label="Дата по">
            <DatePicker value={form.date_to} onChange={(v) => setForm({ ...form, date_to: v })} />
          </Field>
          <Field label="Стоимость">
            <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
          </Field>
          <Field label="Номер билета/брони">
            <TextInput value={form.transport_no} onChange={(v) => setForm({ ...form, transport_no: v })} />
          </Field>
        </div>

        {mode === 'edit' && (
          <div className="ft-card-soft" style={{ marginTop: 8 }}>
            <div className="ft-card-eyebrow ft-card-eyebrow--lg">
              <strong>Документ</strong>
              {item?.document_name && (
                <a href={item.download_url || `/uploads/logistics/${item.document_name}`} target="_blank" rel="noopener noreferrer">📎 {item.document_name}</a>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,image/*"
              onChange={onUpload}
              disabled={uploading}
              style={{ fontSize: 12 }}
            />
            {uploading && <div className="muted" style={{ fontSize: 11 }}>Загрузка…</div>}
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <div style={{ display: 'flex', gap: 6 }}>
          {mode === 'edit' && form.status === 'pending' && (
            <Btn size="sm" variant="ghost" onClick={onPurchase} title="Отметить куплено">💳 Куплено</Btn>
          )}
          {mode === 'edit' && (form.status === 'ready' || form.status === 'purchased') && (
            <Btn size="sm" variant="ghost" onClick={onSendNow} title="Отправить SMS">📨 SMS</Btn>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={close}>Отмена</Btn>
          <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Сохраняем…' : (mode === 'create' ? 'Добавить' : 'Сохранить')}</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}
