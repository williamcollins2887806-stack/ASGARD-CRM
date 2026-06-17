/**
 * Допуски и разрешения сотрудника.
 *
 * Источник: vanilla `employee.js` блок «Допуски и разрешения» (строки 339–358)
 *          + `permits.js`/AsgardPermitsPage детальная таблица.
 *
 * Endpoints:
 *   GET    /api/permits?employee_id=N  → список действующих допусков с computed_status
 *   GET    /api/permits/types          → справочник типов
 *   POST   /api/permits {employee_id, type_id, doc_number, issuer, issue_date, expiry_date, notes}
 *   DELETE /api/permits/:id            → soft-delete
 *
 * Видно ли:
 *   • Кнопка «+ Добавить допуск» — HR/ADMIN/директора (см. canEdit).
 *   • Кнопка «🗑» рядом с допуском — те же.
 */
import { useEffect, useState } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, SelectInput, TextareaInput, DatePicker } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  loadEmployeePermits, loadPermitTypes, createPermit, deletePermit, fmtDate,
} from './api';

export function EmployeePermits({ employeeId, canEdit }) {
  const modal = useModal();
  const [loading, setLoading] = useState(true);
  const [permits, setPermits] = useState([]);

  const refresh = () => {
    setLoading(true);
    loadEmployeePermits(employeeId)
      .then(setPermits)
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, [employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openAdd = () => {
    if (!canEdit) {
      toast.warn('Нет прав на добавление допусков');
      return;
    }
    modal.open(
      <AddPermitModal employeeId={employeeId} onSaved={refresh} />,
      { size: 'md' }
    );
  };

  const onDelete = (permit) => {
    modal.open(
      <ConfirmModal
        title="Удалить допуск?"
        message={`«${permit.type_name || permit.type_id}»${permit.expiry_date ? ' (до ' + fmtDate(permit.expiry_date) + ')' : ''}`}
        okText="Удалить"
        tone="danger"
        onConfirm={async () => {
          try {
            await deletePermit(permit.id);
            toast.success('Допуск удалён');
            refresh();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  if (loading) {
    return <div className="emp-modal-empty">⏳ Загружаем допуски…</div>;
  }

  return (
    <div className="emp-permits">
      <div className="emp-permits-head">
        <div className="emp-permits-count">
          {permits.length === 0 ? 'Допусков нет' : `${permits.length} ${plural(permits.length, ['допуск', 'допуска', 'допусков'])}`}
        </div>
        {canEdit && (
          <Btn variant="primary" size="sm" onClick={openAdd}>+ Добавить</Btn>
        )}
      </div>

      {permits.length === 0 ? (
        <div className="emp-modal-empty">
          У сотрудника нет оформленных допусков. {canEdit && 'Нажмите «+ Добавить», чтобы внести допуск.'}
        </div>
      ) : (
        <div className="emp-permits-list">
          {permits.map((p) => (
            <PermitRow key={p.id} permit={p} canEdit={canEdit} onDelete={() => onDelete(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PermitRow({ permit, canEdit, onDelete }) {
  const status = permit.computed_status || 'active';
  const days = permit.days_left;
  const meta = (() => {
    if (status === 'expired')      return { dot: '🔴', text: `Просрочен ${days != null ? Math.abs(days) + ' дн.' : ''}`, cls: 'expired' };
    if (status === 'expiring_14')  return { dot: '⚠️', text: `Истекает через ${days} дн.`, cls: 'warn14' };
    if (status === 'expiring_30')  return { dot: '🟡', text: `Истекает через ${days} дн.`, cls: 'warn30' };
    return { dot: '✅', text: 'Действует', cls: 'ok' };
  })();

  return (
    <div className={`emp-permit-row emp-permit-row--${meta.cls}`}>
      <div className="emp-permit-row-main">
        <div className="emp-permit-row-name">
          <span>{meta.dot}</span>{' '}
          <b>{permit.type_name || `Тип #${permit.type_id}`}</b>
          {permit.type_category && (
            <span className="emp-permit-row-cat">{permit.type_category}</span>
          )}
        </div>
        <div className="emp-permit-row-meta">
          {permit.doc_number && <span>№ {permit.doc_number}</span>}
          {permit.issuer && <span>· {permit.issuer}</span>}
          {permit.issue_date && <span>· выдан {fmtDate(permit.issue_date)}</span>}
          {permit.expiry_date && <span>· до {fmtDate(permit.expiry_date)}</span>}
        </div>
        <div className="emp-permit-row-status">{meta.text}</div>
      </div>
      <div className="emp-permit-row-actions">
        {permit.scan_file && (
          <a
            className="m-btn ghost sm"
            href={`/api/files/download/${encodeURIComponent(permit.scan_file)}`}
            target="_blank"
            rel="noreferrer"
            title="Скачать скан"
          >📄</a>
        )}
        {canEdit && (
          <Btn variant="ghost" size="sm" onClick={onDelete} title="Удалить">🗑</Btn>
        )}
      </div>
    </div>
  );
}

/**
 * Модалка добавления допуска. Загружает справочник типов /api/permits/types,
 * сабмит — POST /api/permits.
 */
function AddPermitModal({ employeeId, onSaved }) {
  const { close } = useModal();
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    type_id: '',
    doc_number: '',
    issuer: '',
    issue_date: '',
    expiry_date: '',
    notes: '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    loadPermitTypes()
      .then(setTypes)
      .catch((e) => toast.error('Не удалось загрузить справочник: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  const submit = async () => {
    if (!form.type_id) {
      toast.warn('Выберите тип допуска');
      return;
    }
    setBusy(true);
    try {
      await createPermit({
        employee_id: Number(employeeId),
        type_id: Number(form.type_id),
        doc_number: form.doc_number.trim() || null,
        issuer: form.issuer.trim() || null,
        issue_date: form.issue_date || null,
        expiry_date: form.expiry_date || null,
        notes: form.notes.trim() || null,
      });
      toast.success('Допуск добавлен');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.serverMsg || e?.message || e));
      setBusy(false);
    }
  };

  const typeOptions = [
    { value: '', label: '— выбрать тип —' },
    ...types.map((t) => ({
      value: String(t.id),
      label: t.name + (t.category ? ` · ${t.category}` : ''),
    })),
  ];

  return (
    <MCard>
      <MHead icon="✅" title="Добавить допуск" accent="gold" onClose={close} />
      <MBody>
        {loading ? (
          <div className="emp-modal-empty">⏳ Загружаем справочник…</div>
        ) : (
          <div className="col gap-10">
            <Field label="Тип допуска" required>
              <SelectInput
                value={form.type_id}
                onChange={(v) => set('type_id', v)}
                options={typeOptions}
              />
            </Field>
            <div className="grid-2 gap-10">
              <Field label="Номер документа">
                <TextInput value={form.doc_number} onChange={(v) => set('doc_number', v)} />
              </Field>
              <Field label="Кем выдан">
                <TextInput value={form.issuer} onChange={(v) => set('issuer', v)} />
              </Field>
            </div>
            <div className="grid-2 gap-10">
              <Field label="Дата выдачи">
                <DatePicker value={form.issue_date} onChange={(v) => set('issue_date', v || '')} />
              </Field>
              <Field label="Действителен до">
                <DatePicker value={form.expiry_date} onChange={(v) => set('expiry_date', v || '')} />
              </Field>
            </div>
            <Field label="Примечание">
              <TextareaInput value={form.notes} onChange={(v) => set('notes', v)} minRows={2} maxRows={4} />
            </Field>
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy || loading} onClick={submit}>
          {busy ? 'Сохраняем…' : '✓ Добавить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
