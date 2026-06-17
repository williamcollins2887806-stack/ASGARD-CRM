/**
 * Модалка создания / редактирования заявки на пропуск.
 *
 * Поля: заказчик/объект, привязка к работе, период (С — По),
 *       контактное лицо/телефон, заметки.
 *       Списки: рабочие (ФИО+ИНН+паспорт+должность), транспорт (марка+номер),
 *       оборудование (название+серийник).
 */
import { useState, useMemo, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import {
  TextInput, TextareaInput, SelectInput, DatePicker, PhoneInput
} from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';

import {
  createRequest, updateRequest, loadOne, changeStatus
} from './api';

function emit() { window.dispatchEvent(new CustomEvent('asgard:pass-requests:changed')); }

function blankWorker() {
  return { fio: '', employee_id: null, inn: '', passport: '', position: '' };
}
function blankVehicle() { return { brand: '', plate: '' }; }
function blankEquipment() { return { name: '', serial: '' }; }

export function PassRequestEditModal({ requestId, employees = [], works = [], customers = [], onSaved }) {
  const { close } = useModal();
  const isEdit = !!requestId;

  const [loading, setLoading] = useState(isEdit);
  const [item, setItem] = useState(null);
  const [form, setForm] = useState({
    work_id: '',
    object_name: '',
    pass_date_from: '',
    pass_date_to: '',
    contact_person: '',
    contact_phone: '',
    notes: '',
    status: 'draft',
    employees: [blankWorker()],
    vehicles: [],
    equipment: []
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    loadOne(requestId)
      .then((it) => {
        setItem(it);
        const emps = Array.isArray(it.workers) ? it.workers : (Array.isArray(it.employees_json) ? it.employees_json : []);
        const vehs = Array.isArray(it.vehicles) ? it.vehicles : (Array.isArray(it.vehicles_json) ? it.vehicles_json : []);
        const eqs  = Array.isArray(it.equipment_json) ? it.equipment_json : [];
        setForm({
          work_id: it.work_id ? String(it.work_id) : '',
          object_name: it.object_name || '',
          pass_date_from: (it.date_from || it.pass_date_from || '').slice(0, 10),
          pass_date_to:   (it.date_to   || it.pass_date_to   || '').slice(0, 10),
          contact_person: it.contact_person || '',
          contact_phone:  it.contact_phone || '',
          notes: it.notes || '',
          status: it.status || 'draft',
          employees: emps.length ? emps.map((e) => ({
            fio: e.fio || e.name || '',
            employee_id: e.employee_id || null,
            inn: e.inn || '',
            passport: e.passport || '',
            position: e.position || ''
          })) : [blankWorker()],
          vehicles: vehs.map((v) => ({
            brand: v.brand || v.type || '',
            plate: v.plate || v.number || ''
          })),
          equipment: eqs.map((eq) => ({
            name: eq.name || '',
            serial: eq.serial || eq.quantity || ''
          }))
        });
      })
      .catch((e) => toast.error('Не удалось загрузить заявку: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, [requestId, isEdit]);

  const workOpts = useMemo(() => [
    { value: '', label: '— не привязано —' },
    ...works.map((w) => ({ value: String(w.id), label: w.work_title || ('Работа #' + w.id) }))
  ], [works]);

  const customerOpts = useMemo(() => [
    { value: '', label: '— не указано —' },
    ...customers.map((c) => ({
      value: String(c.inn || ''),
      label: (c.name || c.full_name || 'Без названия') + (c.inn ? ' (' + c.inn + ')' : '')
    })).filter((o) => o.value)
  ], [customers]);

  // Если выбираем сотрудника из справочника — подставляем ФИО/паспорт/должность
  const pickEmployee = (idx, employeeId) => {
    const e = employees.find((x) => String(x.id) === String(employeeId));
    setForm((s) => {
      const next = s.employees.slice();
      next[idx] = {
        ...next[idx],
        employee_id: e ? e.id : null,
        fio: e ? e.name : next[idx].fio,
        passport: e?.passport || next[idx].passport,
        position: e?.position || next[idx].position
      };
      return { ...s, employees: next };
    });
  };
  const updateWorker = (idx, key, val) => {
    setForm((s) => {
      const next = s.employees.slice();
      next[idx] = { ...next[idx], [key]: val };
      return { ...s, employees: next };
    });
  };
  const addWorker = () => setForm((s) => ({ ...s, employees: [...s.employees, blankWorker()] }));
  const removeWorker = (idx) => setForm((s) => {
    const next = s.employees.filter((_, i) => i !== idx);
    return { ...s, employees: next.length ? next : [blankWorker()] };
  });

  const updateVehicle = (idx, key, val) => setForm((s) => {
    const next = s.vehicles.slice();
    next[idx] = { ...next[idx], [key]: val };
    return { ...s, vehicles: next };
  });
  const addVehicle = () => setForm((s) => ({ ...s, vehicles: [...s.vehicles, blankVehicle()] }));
  const removeVehicle = (idx) => setForm((s) => ({ ...s, vehicles: s.vehicles.filter((_, i) => i !== idx) }));

  const updateEquipment = (idx, key, val) => setForm((s) => {
    const next = s.equipment.slice();
    next[idx] = { ...next[idx], [key]: val };
    return { ...s, equipment: next };
  });
  const addEquipment = () => setForm((s) => ({ ...s, equipment: [...s.equipment, blankEquipment()] }));
  const removeEquipment = (idx) => setForm((s) => ({ ...s, equipment: s.equipment.filter((_, i) => i !== idx) }));

  const cleanForBackend = () => {
    const emps = form.employees
      .filter((e) => (e.fio || '').trim())
      .map((e) => ({
        fio: e.fio.trim(),
        employee_id: e.employee_id || null,
        inn: (e.inn || '').trim() || undefined,
        passport: (e.passport || '').trim() || undefined,
        position: (e.position || '').trim() || undefined
      }));
    const vehs = form.vehicles
      .filter((v) => (v.brand || '').trim() || (v.plate || '').trim())
      .map((v) => ({
        brand: (v.brand || 'ТС').trim(),
        plate: (v.plate || '').trim()
      }));
    const eqs = form.equipment
      .filter((eq) => (eq.name || '').trim())
      .map((eq) => ({
        name: (eq.name || '').trim(),
        serial: (eq.serial || '').trim() || undefined
      }));
    return {
      work_id: form.work_id ? parseInt(form.work_id, 10) : null,
      object_name: form.object_name.trim(),
      pass_date_from: form.pass_date_from || null,
      pass_date_to:   form.pass_date_to || null,
      contact_person: form.contact_person.trim() || null,
      contact_phone:  form.contact_phone.trim() || null,
      notes: form.notes.trim() || null,
      employees_json: emps,
      vehicles_json:  vehs,
      equipment_json: eqs
    };
  };

  const save = async () => {
    if (!form.object_name.trim()) {
      toast.error('Укажите объект');
      return false;
    }
    if (!form.pass_date_from || !form.pass_date_to) {
      toast.error('Укажите период действия пропуска');
      return false;
    }
    if (form.pass_date_from && form.pass_date_to && form.pass_date_to < form.pass_date_from) {
      toast.error('Дата окончания раньше даты начала');
      return false;
    }
    setSaving(true);
    try {
      const payload = cleanForBackend();
      const saved = isEdit ? await updateRequest(requestId, payload) : await createRequest(payload);
      toast.success(isEdit ? 'Заявка обновлена' : 'Заявка создана');
      emit();
      onSaved?.(saved);
      return saved;
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndClose = async () => {
    const r = await save();
    if (r) close();
  };

  const submitForApproval = async () => {
    const r = await save();
    if (!r) return;
    try {
      await changeStatus(r.id || requestId, 'submitted');
      toast.success('Заявка отправлена на согласование');
      emit();
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось подать: ' + (e?.message || e));
    }
  };

  if (loading) {
    return (
      <MCard>
        <MHead icon="🪪" title="Загрузка заявки…" onClose={close} />
        <MBody>
          <div className="p-24 t-center c-t3">⏳</div>
        </MBody>
      </MCard>
    );
  }

  const canSubmit = isEdit && (item?.status === 'draft' || form.status === 'draft');

  return (
    <MCard className="modal-wide">
      <MHead
        icon="🪪"
        title={isEdit ? `Заявка на пропуск #${requestId}` : 'Новая заявка на пропуск'}
        subtitle={form.object_name || 'Заполните данные заявки'}
        accent="info"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Связанная работа">
            <SelectInput value={form.work_id} onChange={(v) => set('work_id', v)} options={workOpts} />
          </Field>

          <Field label="Объект" required>
            <TextInput value={form.object_name} onChange={(v) => set('object_name', v)} placeholder="Название объекта" />
          </Field>

          <div className="grid-2 gap-10">
            <Field label="Действует с" required>
              <DatePicker value={form.pass_date_from} onChange={(v) => set('pass_date_from', v || '')} />
            </Field>
            <Field label="Действует по" required>
              <DatePicker value={form.pass_date_to} onChange={(v) => set('pass_date_to', v || '')} />
            </Field>
          </div>

          <div className="grid-2 gap-10">
            <Field label="Контактное лицо">
              <TextInput value={form.contact_person} onChange={(v) => set('contact_person', v)} placeholder="ФИО · должность" />
            </Field>
            <Field label="Телефон контакта">
              <PhoneInput value={form.contact_phone} onChange={(v) => set('contact_phone', v)} />
            </Field>
          </div>

          {/* — Рабочие — */}
          <div className="prq-section">
            <div className="prq-section-head">
              <div className="prq-section-ttl">👷 Сотрудники / рабочие</div>
              <Btn size="sm" onClick={addWorker}>+ Добавить</Btn>
            </div>
            <div className="prq-list">
              {form.employees.map((w, idx) => (
                <div key={idx} className="prq-worker">
                  <div className="prq-worker-grid">
                    <Field label="Из справочника">
                      <SelectInput
                        value={w.employee_id ? String(w.employee_id) : ''}
                        onChange={(v) => pickEmployee(idx, v)}
                        options={[
                          { value: '', label: '— ввести вручную —' },
                          ...employees.map((e) => ({ value: String(e.id), label: e.name }))
                        ]}
                      />
                    </Field>
                    <Field label="ФИО" required>
                      <TextInput value={w.fio} onChange={(v) => updateWorker(idx, 'fio', v)} placeholder="Иванов И.И." />
                    </Field>
                    <Field label="ИНН">
                      <TextInput
                        value={w.inn}
                        onChange={(v) => updateWorker(idx, 'inn', v.replace(/\D/g, '').slice(0, 12))}
                        placeholder="12 цифр"
                      />
                    </Field>
                    <Field label="Паспорт">
                      <TextInput
                        value={w.passport}
                        onChange={(v) => updateWorker(idx, 'passport', v)}
                        placeholder="1234 567890"
                      />
                    </Field>
                    <Field label="Должность">
                      <TextInput
                        value={w.position}
                        onChange={(v) => updateWorker(idx, 'position', v)}
                        placeholder="Слесарь / Сварщик / …"
                      />
                    </Field>
                  </div>
                  {form.employees.length > 1 && (
                    <Btn size="sm" variant="ghost" onClick={() => removeWorker(idx)} title="Удалить">🗑</Btn>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* — Транспорт — */}
          <div className="prq-section">
            <div className="prq-section-head">
              <div className="prq-section-ttl">🚚 Транспорт</div>
              <Btn size="sm" onClick={addVehicle}>+ Добавить</Btn>
            </div>
            <div className="prq-list">
              {form.vehicles.length === 0 && (
                <div className="c-t3 fs-12">Нет транспорта</div>
              )}
              {form.vehicles.map((v, idx) => (
                <div key={idx} className="prq-row-grid">
                  <Field label="Марка / тип">
                    <TextInput value={v.brand} onChange={(val) => updateVehicle(idx, 'brand', val)} placeholder="Газель" />
                  </Field>
                  <Field label="Гос. номер">
                    <TextInput value={v.plate} onChange={(val) => updateVehicle(idx, 'plate', val)} placeholder="А123БВ77" />
                  </Field>
                  <Btn size="sm" variant="ghost" onClick={() => removeVehicle(idx)} title="Удалить">🗑</Btn>
                </div>
              ))}
            </div>
          </div>

          {/* — Оборудование — */}
          <div className="prq-section">
            <div className="prq-section-head">
              <div className="prq-section-ttl">📦 Оборудование</div>
              <Btn size="sm" onClick={addEquipment}>+ Добавить</Btn>
            </div>
            <div className="prq-list">
              {form.equipment.length === 0 && (
                <div className="c-t3 fs-12">Нет оборудования</div>
              )}
              {form.equipment.map((eq, idx) => (
                <div key={idx} className="prq-row-grid">
                  <Field label="Название">
                    <TextInput value={eq.name} onChange={(val) => updateEquipment(idx, 'name', val)} placeholder="Сварочный аппарат…" />
                  </Field>
                  <Field label="Серийный № / кол-во">
                    <TextInput value={eq.serial} onChange={(val) => updateEquipment(idx, 'serial', val)} placeholder="SN-..." />
                  </Field>
                  <Btn size="sm" variant="ghost" onClick={() => removeEquipment(idx)} title="Удалить">🗑</Btn>
                </div>
              ))}
            </div>
          </div>

          <Field label="Примечания">
            <TextareaInput value={form.notes} onChange={(v) => set('notes', v)} placeholder="Дополнительная информация…" minRows={2} maxRows={6} />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close} disabled={saving}>Отмена</Btn>
        <div className="u-flex gap-8">
          <Btn variant="primary" onClick={saveAndClose} disabled={saving}>
            {saving ? 'Сохраняем…' : isEdit ? '💾 Сохранить' : '➕ Создать черновик'}
          </Btn>
          {canSubmit && (
            <Btn variant="info" onClick={submitForApproval} disabled={saving}>📨 Подать</Btn>
          )}
        </div>
      </MFoot>
    </MCard>
  );
}
