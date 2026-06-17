/**
 * Telephony / Таб «Маршрутизация» — управление call_routing_rules.
 *
 * Источник vanilla: public/assets/js/telephony.js (renderRoutingTab) +
 * backend telephony.js:1087–1158 (GET/POST/PUT/DELETE /routing).
 *
 *   Поля правила:
 *     name, description, priority,
 *     condition_type    : caller_pattern | line_number | hour_range | weekday
 *     condition_value   : JSON (зависит от condition_type)
 *     action_type       : route_to_user | route_to_department | route_to_number | drop | voicemail
 *     action_value      : JSON (id/phone/dept)
 *     is_active         : bool
 *
 * RBAC: создавать/менять/удалять — TEL_ADMIN_ROLES (ADMIN/DIRECTOR_GEN/DIRECTOR_COMM)
 * (telephony.js:1099). Остальные роли видят список read-only.
 *
 * Никаких заглушек.
 */
import { useEffect, useState } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { useAuth } from '@/api/useAuth';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, NumberInput, SelectInput, TextareaInput, Switch, PhoneInput } from '@/inputs/Inputs';
import { StatusBadge, toast } from '@/modals/Notifications';
import { EmptyState } from '@/blocks/Blocks';
import { loadRoutingRules, createRoutingRule, updateRoutingRule, deleteRoutingRule, loadOperators } from '../api';

const ADMIN_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];

const CONDITION_TYPES = [
  { value: 'caller_pattern', label: 'По номеру звонящего (regex)' },
  { value: 'line_number',    label: 'По линии (входящему номеру)' },
  { value: 'hour_range',     label: 'По часам (расписание)' },
  { value: 'weekday',        label: 'По дню недели' }
];

const ACTION_TYPES = [
  { value: 'route_to_user',       label: '👤 На сотрудника' },
  { value: 'route_to_department', label: '🏢 На отдел' },
  { value: 'route_to_number',     label: '📞 На внешний номер' },
  { value: 'voicemail',           label: '📭 На голосовую почту' },
  { value: 'drop',                label: '🚫 Сбросить' }
];

const DEPARTMENTS = [
  { value: 'sales',   label: 'Продажи / ТО' },
  { value: 'support', label: 'Поддержка' },
  { value: 'buh',     label: 'Бухгалтерия' },
  { value: 'office',  label: 'Офис' }
];

const WEEKDAYS = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Вс' }
];

function describeCondition(rule) {
  const v = rule.condition_value ? (typeof rule.condition_value === 'string' ? safeJson(rule.condition_value) : rule.condition_value) : {};
  switch (rule.condition_type) {
    case 'caller_pattern': return v.pattern ? `номер ~ ${v.pattern}` : 'любой звонящий';
    case 'line_number':    return v.line ? `линия ${v.line}` : 'любая линия';
    case 'hour_range':     return `с ${v.from || '00:00'} до ${v.to || '23:59'}`;
    case 'weekday':        return `${(v.days || []).map((d) => (WEEKDAYS.find((w) => w.value === d) || {}).label || d).join(', ') || '—'}`;
    default: return rule.condition_type;
  }
}

function describeAction(rule, operators) {
  const v = rule.action_value ? (typeof rule.action_value === 'string' ? safeJson(rule.action_value) : rule.action_value) : {};
  switch (rule.action_type) {
    case 'route_to_user': {
      const u = operators.find((o) => String(o.id) === String(v.user_id));
      return `👤 ${u ? u.name : ('user #' + (v.user_id || '?'))}`;
    }
    case 'route_to_department': {
      const d = DEPARTMENTS.find((x) => x.value === v.department);
      return `🏢 ${d ? d.label : (v.department || '—')}`;
    }
    case 'route_to_number': return `📞 ${v.phone || '—'}`;
    case 'voicemail': return '📭 голосовая почта';
    case 'drop': return '🚫 сброс';
    default: return rule.action_type;
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

// ─── Модалка создания/редактирования ────────────────────────────────────────
function RoutingRuleModal({ rule, operators, onSaved }) {
  const { close } = useModal();
  const isNew = !rule || !rule.id;
  const initial = rule || {
    name: '',
    description: '',
    priority: 100,
    condition_type: 'caller_pattern',
    condition_value: {},
    action_type: 'route_to_user',
    action_value: {},
    is_active: true
  };
  const [form, setForm] = useState(() => {
    const cv = typeof initial.condition_value === 'string' ? safeJson(initial.condition_value) : (initial.condition_value || {});
    const av = typeof initial.action_value === 'string' ? safeJson(initial.action_value) : (initial.action_value || {});
    return { ...initial, condition_value: cv, action_value: av };
  });
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const setCV = (k, v) => setForm((s) => ({ ...s, condition_value: { ...s.condition_value, [k]: v } }));
  const setAV = (k, v) => setForm((s) => ({ ...s, action_value: { ...s.action_value, [k]: v } }));

  const submit = async () => {
    if (!form.name?.trim()) return toast.warn('Укажите название правила');
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description || '',
        priority: Number(form.priority) || 0,
        condition_type: form.condition_type,
        condition_value: form.condition_value || {},
        action_type: form.action_type,
        action_value: form.action_value || {},
        is_active: !!form.is_active
      };
      if (isNew) await createRoutingRule(payload);
      else await updateRoutingRule(rule.id, payload);
      toast.success(isNew ? 'Правило создано' : 'Правило обновлено');
      onSaved?.();
      close();
    } catch (e) {
      toast.error(e?.message || 'Не удалось сохранить');
    } finally { setBusy(false); }
  };

  return (
    <MCard className="modal-md">
      <MHead icon="↪" title={isNew ? 'Новое правило маршрутизации' : `Правило #${rule.id}`} onClose={close} />
      <MBody>
        <div className="col gap-10">
          <Field label="Название" required>
            <TextInput value={form.name} onChange={(v) => set('name', v)} placeholder="Например: Звонки с Москвы в нерабочее время → диспетчер" />
          </Field>
          <Field label="Описание">
            <TextareaInput value={form.description || ''} onChange={(v) => set('description', v)} minRows={2} maxRows={4} />
          </Field>
          <div className="grid-2 gap-8">
            <Field label="Приоритет" help="чем выше — тем раньше срабатывает">
              <NumberInput value={form.priority} onChange={(v) => set('priority', v)} min={0} max={9999} />
            </Field>
            <Field label="Активно">
              <Switch checked={!!form.is_active} onChange={(v) => set('is_active', v)} label={form.is_active ? 'Включено' : 'Выключено'} />
            </Field>
          </div>

          <Field label="Условие">
            <SelectInput value={form.condition_type} onChange={(v) => set('condition_type', v)} options={CONDITION_TYPES} />
          </Field>

          {form.condition_type === 'caller_pattern' && (
            <Field label="Regex / маска" help="например ^7495 (Москва) или 79\\d{9}">
              <TextInput value={form.condition_value.pattern || ''} onChange={(v) => setCV('pattern', v)} placeholder="^7495" />
            </Field>
          )}
          {form.condition_type === 'line_number' && (
            <Field label="Линия (входящий номер)">
              <PhoneInput value={form.condition_value.line || ''} onChange={(v) => setCV('line', v)} />
            </Field>
          )}
          {form.condition_type === 'hour_range' && (
            <div className="grid-2 gap-8">
              <Field label="С (часы)">
                <TextInput value={form.condition_value.from || ''} onChange={(v) => setCV('from', v)} placeholder="09:00" />
              </Field>
              <Field label="По (часы)">
                <TextInput value={form.condition_value.to || ''} onChange={(v) => setCV('to', v)} placeholder="18:00" />
              </Field>
            </div>
          )}
          {form.condition_type === 'weekday' && (
            <Field label="Дни недели">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {WEEKDAYS.map((w) => {
                  const days = Array.isArray(form.condition_value.days) ? form.condition_value.days : [];
                  const on = days.includes(w.value);
                  return (
                    <button key={w.value}
                            type="button"
                            className={'m-btn ' + (on ? 'primary' : 'ghost')}
                            style={{ padding: '4px 10px', minWidth: 38 }}
                            onClick={() => setCV('days', on ? days.filter((d) => d !== w.value) : [...days, w.value])}>
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          <Field label="Действие">
            <SelectInput value={form.action_type} onChange={(v) => set('action_type', v)} options={ACTION_TYPES} />
          </Field>

          {form.action_type === 'route_to_user' && (
            <Field label="Сотрудник">
              <SelectInput
                value={String(form.action_value.user_id || '')}
                onChange={(v) => setAV('user_id', v ? Number(v) : null)}
                options={[{ value: '', label: '— выбрать —' }, ...operators.map((o) => ({ value: String(o.id), label: o.name }))]}
              />
            </Field>
          )}
          {form.action_type === 'route_to_department' && (
            <Field label="Отдел">
              <SelectInput
                value={form.action_value.department || ''}
                onChange={(v) => setAV('department', v)}
                options={[{ value: '', label: '— выбрать —' }, ...DEPARTMENTS]}
              />
            </Field>
          )}
          {form.action_type === 'route_to_number' && (
            <Field label="Внешний номер">
              <PhoneInput value={form.action_value.phone || ''} onChange={(v) => setAV('phone', v)} />
            </Field>
          )}
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Сохраняем…' : (isNew ? '✓ Создать' : '✓ Сохранить')}</Btn>
      </MFoot>
    </MCard>
  );
}

export default function RoutingTab() {
  const { user } = useAuth();
  const modal = useModal();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const [rules, setRules] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    Promise.all([loadRoutingRules(), loadOperators()])
      .then(([r, ops]) => { setRules(r); setOperators(ops); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const toggleActive = async (rule) => {
    try {
      await updateRoutingRule(rule.id, { is_active: !rule.is_active });
      toast.success(rule.is_active ? 'Правило выключено' : 'Правило включено');
      refresh();
    } catch (e) {
      toast.error('Не удалось переключить');
    }
  };

  const handleDelete = (rule) => {
    modal.open(
      <ConfirmModal
        title="Удалить правило"
        message={`Удалить правило «${rule.name}»? Это действие нельзя отменить.`}
        okText="Удалить"
        tone="danger"
        onConfirm={async () => {
          try {
            await deleteRoutingRule(rule.id);
            toast.success('Правило удалено');
            refresh();
          } catch (e) {
            toast.error('Не удалось удалить');
          }
        }}
      />
    );
  };

  return (
    <div className="col gap-12">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="fw-600">Правила маршрутизации входящих звонков</div>
          <div className="c-t3 fs-12">
            Условие → действие. Чем выше приоритет, тем раньше срабатывает правило.
            {!isAdmin && ' Управление доступно ADMIN / DIRECTOR_GEN / DIRECTOR_COMM.'}
          </div>
        </div>
        {isAdmin && (
          <div style={{ marginLeft: 'auto' }}>
            <Btn variant="primary" onClick={() => modal.open(<RoutingRuleModal operators={operators} onSaved={refresh} />)}>
              + Новое правило
            </Btn>
          </div>
        )}
      </div>

      {loading ? (
        <div className="card card-empty">⏳ Загружаем правила…</div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon="↪"
          title="Правил пока нет"
          hint={isAdmin ? 'Создайте первое правило, чтобы автоматически направлять звонки на нужных сотрудников' : 'Обратитесь к администратору'}
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="t-list w-full tbl-base">
              <thead>
                <tr className="bg-inner tbl-row-brd">
                  <th className="w-60" style={{ textAlign: 'center' }}>Приор.</th>
                  <th>Название</th>
                  <th>Условие</th>
                  <th>Действие</th>
                  <th className="w-110">Статус</th>
                  <th className="w-220" style={{ textAlign: 'right' }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="row-hover">
                    <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.priority}</td>
                    <td>
                      <div className="fw-600">{r.name}</div>
                      {r.description && <div className="fs-11 c-t3">{r.description}</div>}
                      {r.created_by_name && <div className="fs-10 c-t3">создал: {r.created_by_name}</div>}
                    </td>
                    <td className="fs-12">{describeCondition(r)}</td>
                    <td className="fs-12">{describeAction(r, operators)}</td>
                    <td>
                      <StatusBadge tone={r.is_active ? 'approved' : 'draft'} label={r.is_active ? 'Активно' : 'Выкл.'} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {isAdmin ? (
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <Btn size="sm" variant="ghost" onClick={() => toggleActive(r)}>
                            {r.is_active ? 'Выключить' : 'Включить'}
                          </Btn>
                          <Btn size="sm" variant="ghost" onClick={() => modal.open(<RoutingRuleModal rule={r} operators={operators} onSaved={refresh} />)}>
                            ✎
                          </Btn>
                          <Btn size="sm" variant="ghost" onClick={() => handleDelete(r)}>🗑</Btn>
                        </div>
                      ) : <span className="c-t3 fs-12">— только просмотр —</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
