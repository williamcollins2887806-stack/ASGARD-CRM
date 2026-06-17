/**
 * Модалка PM «Запросить рабочих» — создание/редактирование черновика.
 *
 * Источник: vanilla `hr_requests.js` renderCreateForm + блок «Требуемые допуска».
 *
 * Поведение:
 *   • Если уже есть draft на эту работу — продолжаем его (reused)
 *   • Состав: POSITION_ROLES × числовой ввод
 *   • Условия: питание/жильё/вахта
 *   • Блок «Требуемые допуска по должностям»:
 *      — для каждой активной должности (required_count>0) + «Для всех»
 *      — типы допусков из /api/permits/types
 *      — «свой» — отдельный input + категория
 *      — «не требуются» — отдельный маркер
 *   • 409 при submit → подсветка ролей-без-допусков
 */
import { useState, useEffect, useCallback } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, SelectInput, TextareaInput, DatePicker, NumberInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  POSITION_ROLES, FOOD_OPTS, HOUSING_OPTS, PERMIT_CATEGORIES,
  loadMy, loadMyWorks, loadPermitTypes, loadWorkPermitRequirements,
  addWorkPermit, addCustomWorkPermit, deleteWorkPermit,
  createDraft, updateDraft, submitToHr,
} from './api';

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:hr-requests:changed'));
}

export function RequestFormModal({ workId: initialWorkId, onSaved }) {
  const { close } = useModal();

  const [works, setWorks] = useState([]);
  const [existingDraft, setExistingDraft] = useState(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    work_id: initialWorkId || '',
    date_from: '',
    date_to: '',
    work_description: '',
    food: 'ration',
    housing: 'wagon',
    rotation: '',
    is_vachta: false,
    positions: Object.fromEntries(POSITION_ROLES.map((p) => [p.key, 0])),
  });

  const [permitTypes, setPermitTypes] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [missingRoles, setMissingRoles] = useState([]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savingSubmit, setSavingSubmit] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setPos = (key, v) => setForm((f) => ({ ...f, positions: { ...f.positions, [key]: Math.max(0, Number(v) || 0) } }));

  // Загрузка works + draft + permit types
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    Promise.all([
      loadMyWorks().catch(() => []),
      loadMy().catch(() => []),
      loadPermitTypes(),
    ])
      .then(([w, my, types]) => {
        if (cancel) return;
        setWorks(w);
        setPermitTypes(types);
        if (initialWorkId) {
          const found = my.find((r) => r.work_id === initialWorkId && (r.status_v2 || r.status) === 'draft');
          if (found) {
            setExistingDraft(found);
            // Заполняем форму из черновика
            const positions = {};
            POSITION_ROLES.forEach((pr) => {
              const p = (found.positions || []).find((x) => x.role_key === pr.key);
              positions[pr.key] = p ? p.required_count : 0;
            });
            const conditions = parseJson(found.work_conditions) || {};
            setForm({
              work_id: found.work_id || '',
              date_from: found.date_from ? String(found.date_from).slice(0, 10) : '',
              date_to: found.date_to ? String(found.date_to).slice(0, 10) : '',
              work_description: found.work_description || '',
              food: conditions.food || 'ration',
              housing: conditions.housing || 'wagon',
              rotation: conditions.rotation || '',
              is_vachta: !!found.is_vachta,
              positions,
            });
          }
        }
      })
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [initialWorkId]);

  // Загрузка требований по работе
  const refreshPermits = useCallback(async (wId) => {
    if (!wId) {
      setRequirements([]);
      return;
    }
    const reqs = await loadWorkPermitRequirements(wId);
    setRequirements(reqs);
  }, []);

  useEffect(() => {
    if (form.work_id) refreshPermits(Number(form.work_id));
  }, [form.work_id, refreshPermits]);

  // ─── Действия с требованиями ──────────────────────────────────────────────
  const addPermit = async (roleKey, typeId) => {
    if (!typeId) {
      toast.warn('Выберите тип допуска');
      return;
    }
    try {
      await addWorkPermit(form.work_id, { permit_type_id: Number(typeId), role_key: roleKey || null, is_mandatory: true });
      await refreshPermits(form.work_id);
    } catch (e) { toast.error('Не удалось добавить: ' + (e?.message || e)); }
  };
  const markNoPermits = async (roleKey) => {
    try {
      await addWorkPermit(form.work_id, { no_permits_required: true, role_key: roleKey || null });
      await refreshPermits(form.work_id);
    } catch (e) { toast.error('Не удалось: ' + (e?.message || e)); }
  };
  const removePermit = async (id) => {
    try {
      await deleteWorkPermit(form.work_id, id);
      await refreshPermits(form.work_id);
    } catch (e) { toast.error('Не удалось удалить: ' + (e?.message || e)); }
  };
  const addCustom = async (roleKey, name, category) => {
    if (!name || name.length < 3) {
      toast.warn('Введите название допуска (от 3 символов)');
      return;
    }
    try {
      await addCustomWorkPermit(form.work_id, { name, category: category || 'special', role_key: roleKey || null, is_mandatory: true });
      // обновляем тип-кэш
      const types = await loadPermitTypes();
      setPermitTypes(types);
      await refreshPermits(form.work_id);
    } catch (e) { toast.error('Не удалось добавить: ' + (e?.message || e)); }
  };

  // ─── Сохранение и отправка ───────────────────────────────────────────────
  const collectPayload = () => {
    const positionsArr = POSITION_ROLES
      .map((pr) => ({ role_key: pr.key, role_label: pr.label, required_count: Math.max(0, Number(form.positions[pr.key]) || 0) }))
      .filter((p) => p.required_count > 0);

    return {
      work_id: Number(form.work_id) || null,
      date_from: form.date_from || null,
      date_to: form.date_to || null,
      work_description: form.work_description.trim() || null,
      work_conditions: { food: form.food, housing: form.housing, rotation: form.rotation.trim() || null },
      is_vachta: form.is_vachta,
      positions: positionsArr,
    };
  };

  const saveDraft = async () => {
    const data = collectPayload();
    if (!data.work_id) {
      toast.warn('Выберите объект');
      return;
    }
    setSavingDraft(true);
    try {
      let req;
      if (existingDraft) {
        req = await updateDraft(existingDraft.id, data);
      } else {
        req = await createDraft(data);
      }
      setExistingDraft(req);
      toast.success(existingDraft ? 'Черновик сохранён' : 'Черновик создан');
      emitChanged();
      onSaved?.();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
    } finally {
      setSavingDraft(false);
    }
  };

  const submit = async () => {
    const data = collectPayload();
    if (!data.work_id) { toast.warn('Выберите объект'); return; }
    if (!data.positions.length) { toast.warn('Укажите хотя бы одну позицию'); return; }
    setSavingSubmit(true);
    try {
      let id;
      if (existingDraft) {
        await updateDraft(existingDraft.id, data);
        id = existingDraft.id;
      } else {
        const r = await createDraft(data);
        setExistingDraft(r);
        id = r.id;
      }
      try {
        await submitToHr(id);
        toast.success('Заявка отправлена HR');
        emitChanged();
        onSaved?.();
        close();
      } catch (e) {
        // Разбор 409 — не заданы допуска
        const msg = e?.message || '';
        if (/409/.test(msg) || /требуется/i.test(msg) || /допуска/i.test(msg)) {
          // Попробуем взять missing_roles если есть в ошибке
          try {
            const json = msg.includes(':') ? JSON.parse(msg.slice(msg.indexOf('{'))) : null;
            if (json?.missing_roles) setMissingRoles(json.missing_roles);
          } catch { /* noop */ }
          toast.error('Сначала заполните требуемые допуска по должностям');
        } else {
          toast.error('Не отправилось: ' + msg);
        }
      }
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
    } finally {
      setSavingSubmit(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <MCard className="modal-wide">
        <MHead icon="📨" title="Заявка на рабочих" subtitle="Загрузка…" onClose={close} />
        <MBody>
          <div className="t-center p-40 c-t3">⏳ Загружаем…</div>
        </MBody>
      </MCard>
    );
  }

  const activeRoles = POSITION_ROLES.filter((pr) => (Number(form.positions[pr.key]) || 0) > 0);
  const reqByRole = {};
  requirements.forEach((r) => {
    const k = r.role_key || '';
    if (!reqByRole[k]) reqByRole[k] = [];
    reqByRole[k].push(r);
  });

  const blocks = [
    { key: '', label: 'Для всех должностей' },
    ...activeRoles.map((r) => ({ key: r.key, label: r.label })),
  ];

  return (
    <MCard className="modal-wide">
      <MHead
        icon="📨"
        title={existingDraft ? `Заявка #${existingDraft.id}` : 'Новая заявка на рабочих'}
        subtitle={existingDraft ? `Черновик · продолжаем` : 'Заполните состав и условия'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-16">
          {existingDraft && (
            <div className="bg-info c-info r-sm fs-13 pad-cell-md">
              Продолжаете черновик #{existingDraft.id}
            </div>
          )}

          {/* Объект */}
          <div className="grid-2-1-1 gap-10">
            <Field label="Объект" required>
              <SelectInput
                value={String(form.work_id || '')}
                onChange={(v) => set('work_id', v ? Number(v) : '')}
                options={works.map((w) => ({
                  value: String(w.id),
                  label: `${w.work_title || '—'} ${w.customer_name ? '— ' + w.customer_name : ''}`,
                }))}
                placeholder="— выберите объект —"
              />
            </Field>
            <Field label="Дата начала">
              <DatePicker value={form.date_from} onChange={(v) => set('date_from', v || '')} />
            </Field>
            <Field label="Дата окончания">
              <DatePicker value={form.date_to} onChange={(v) => set('date_to', v || '')} />
            </Field>
          </div>

          {/* Состав */}
          <div>
            <div className="hr-split-eyebrow">Требуемый состав</div>
            <div className="hr-form-grid">
              {POSITION_ROLES.map((pr) => (
                <Field key={pr.key} label={pr.label}>
                  <NumberInput
                    value={String(form.positions[pr.key] || 0)}
                    onChange={(v) => setPos(pr.key, v)}
                    min={0}
                  />
                </Field>
              ))}
            </div>
          </div>

          {/* Допуска по должностям */}
          <div>
            <div className="row-spread mb-8">
              <div className="hr-split-eyebrow" style={{ marginBottom: 0 }}>Требуемые допуска по должностям</div>
              <a
                href="#/permits"
                className="fs-12 c-info u-no-decor"
                onClick={() => close()}
              >
                Открыть «Допуски → Проекты» ↗
              </a>
            </div>
            <div className="hr-perm-block">
              {!form.work_id ? (
                <div className="c-t3 fs-13">
                  Выберите объект, чтобы задать требуемые допуска.
                </div>
              ) : !activeRoles.length ? (
                <div className="c-t3 fs-13">
                  Укажите состав (количество по должностям) выше — затем задайте допуска для каждой должности.
                </div>
              ) : (
                blocks.map((b) => (
                  <PermitBlock
                    key={b.key || '_all'}
                    block={b}
                    items={reqByRole[b.key] || []}
                    types={permitTypes}
                    missing={missingRoles.includes(b.key)}
                    onAdd={(typeId) => addPermit(b.key, typeId)}
                    onAddCustom={(name, cat) => addCustom(b.key, name, cat)}
                    onMarkNo={() => markNoPermits(b.key)}
                    onRemove={removePermit}
                  />
                ))
              )}
            </div>
          </div>

          {/* Описание работ */}
          <Field label="Описание работ">
            <TextareaInput
              value={form.work_description}
              onChange={(v) => set('work_description', v)}
              placeholder="Что предстоит делать?"
              minRows={3}
              maxRows={6}
            />
          </Field>

          {/* Условия */}
          <div>
            <div className="hr-split-eyebrow">Условия</div>
            <div className="grid-3 gap-10">
              <Field label="Питание">
                <SelectInput value={form.food} onChange={(v) => set('food', v)} options={FOOD_OPTS} placeholder="" />
              </Field>
              <Field label="Жильё">
                <SelectInput value={form.housing} onChange={(v) => set('housing', v)} options={HOUSING_OPTS} placeholder="" />
              </Field>
              <Field label="Вахта (ротация)">
                <TextInput value={form.rotation} onChange={(v) => set('rotation', v)} placeholder="45/15" />
              </Field>
            </div>
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>✕ Отмена</Btn>
        <div className="u-flex gap-8">
          <Btn disabled={savingDraft} onClick={saveDraft}>
            {savingDraft ? 'Сохраняем…' : '💾 Сохранить черновик'}
          </Btn>
          <Btn variant="primary" disabled={savingSubmit} onClick={submit}>
            {savingSubmit ? 'Отправляем…' : '📨 Отправить HR'}
          </Btn>
        </div>
      </MFoot>
    </MCard>
  );
}

function PermitBlock({ block, items, types, missing, onAdd, onAddCustom, onMarkNo, onRemove }) {
  const [typeId, setTypeId] = useState('');
  const [customName, setCustomName] = useState('');
  const [customCat, setCustomCat] = useState('special');

  const marker = items.find((r) => r.no_permits_required);
  const perms = items.filter((r) => !r.no_permits_required && r.permit_type_id);

  return (
    <div className={`hr-perm-role ${missing ? 'hr-perm-role--missing' : ''}`}>
      <div className="fw-700 c-t1 fs-13 mb-6">
        {block.label}
        {missing && <span className="c-err fs-11 ml-8">— требуется заполнение</span>}
      </div>

      {marker ? (
        <div className="c-t3 fs-13 hr-italic">Допуска не требуются</div>
      ) : perms.length ? (
        <div className="mb-8">
          {perms.map((r) => (
            <span key={r.id} className="hr-chip">
              {r.type_name}
              <button type="button" onClick={() => onRemove(r.id)} title="Удалить">×</button>
            </span>
          ))}
        </div>
      ) : (
        <div className="c-t3 fs-12 mb-6">— нет требований —</div>
      )}

      <div className="row gap-6 u-wrap mt-6">
        <div className="min-w-200 flex-1">
          <SelectInput
            value={typeId}
            onChange={setTypeId}
            options={types.map((t) => ({ value: String(t.id), label: t.name }))}
            placeholder="+ тип допуска…"
          />
        </div>
        <Btn size="sm" onClick={() => { onAdd(typeId); setTypeId(''); }}>Добавить</Btn>
        {marker
          ? <Btn size="sm" variant="ghost" onClick={() => onRemove(marker.id)}>Отменить «не требуются»</Btn>
          : <Btn size="sm" variant="ghost" onClick={onMarkNo}>Не требуются</Btn>}
      </div>

      <div className="row gap-6 u-wrap mt-6">
        <div className="flex-1 min-w-200">
          <TextInput
            value={customName}
            onChange={setCustomName}
            placeholder="Свой допуск (нет в списке)…"
          />
        </div>
        <div className="min-w-140">
          <SelectInput
            value={customCat}
            onChange={setCustomCat}
            options={PERMIT_CATEGORIES}
            placeholder=""
          />
        </div>
        <Btn size="sm" variant="ghost" onClick={() => { onAddCustom(customName.trim(), customCat); setCustomName(''); }}>
          + Своё
        </Btn>
      </div>
    </div>
  );
}

function parseJson(s) {
  if (s == null) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}
