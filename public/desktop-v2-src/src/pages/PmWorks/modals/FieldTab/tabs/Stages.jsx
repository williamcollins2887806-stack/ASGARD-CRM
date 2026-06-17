/**
 * Stages — этапы командировки сотрудников.
 *
 * Бэк (src/routes/field-stages.js):
 *   POST   /api/field/stages                          — создать (PM)
 *   GET    /api/field/stages/project/:work_id         — список с группировкой по сотрудникам
 *   GET    /api/field/stages/project/:work_id/calendar — календарная сетка
 *   PUT    /api/field/stages/:id/approve              — подтвердить (PM)
 *   PUT    /api/field/stages/:id/reject               — отклонить с обязательной причиной
 *   POST   /api/field/stages/bulk                     — массовое создание (employee_ids[])
 *
 * Vanilla coverage checklist (field-tab.js:2463/2615/2655):
 *   ✅ матрица календаря (сотрудники × дни) — была
 *   ✅ approve / reject кнопки + ConfirmModal/PromptModal — добавлено
 *   ✅ bulk-создание «типовых этапов» — добавлено через STAGE_TEMPLATES
 *   ✅ summary: всего/завершено/в работе/просрочено — добавлено
 *
 * ВНИМАНИЕ: vanilla использовал stage_type = medical/travel/waiting/warehouse/day_off/object
 * — теперь и React тоже (раньше пересылал mob/shift/rest/... которые backend не принимал → 400).
 */
import { useEffect, useState } from 'react';
import { Btn, MCard, MHead, MBody, MFoot } from '@/modals/parts';
import { EmptyState } from '@/blocks/Blocks';
import { toast } from '@/modals/Notifications';
import { Field, SelectInput, DatePicker, TextareaInput, Checkbox } from '@/inputs/Inputs';
import { useModal, ConfirmModal, PromptModal } from '@/modals';
import {
  loadStagesCalendar, loadStagesProject, loadCrew,
  createStage, approveStage, rejectStage, bulkCreateStages
} from '../api';
import { STAGE_COLORS, STAGE_LABELS, STAGE_TEMPLATES } from '../constants';

const STAGE_TYPES = Object.keys(STAGE_LABELS).map((v) => ({ value: v, label: STAGE_LABELS[v], color: STAGE_COLORS[v] }));

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

function isOverdue(stage) {
  if (!stage) return false;
  if (stage.status === 'approved' || stage.status === 'adjusted' || stage.status === 'rejected' || stage.status === 'completed') return false;
  const end = stage.date_to || stage.date_from;
  if (!end) return false;
  return new Date(end) < new Date(new Date().toISOString().slice(0, 10));
}

export default function StagesTab({ work }) {
  const { open } = useModal();
  const [cal, setCal] = useState(null);
  const [proj, setProj] = useState(null);
  const [crew, setCrew] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employee_id: '', stage_type: 'medical', date_from: '', date_to: '', details: '' });
  const [busy, setBusy] = useState(false);

  const reload = () => Promise.all([
    loadStagesCalendar(work.id),
    loadStagesProject(work.id)
  ]).then(([c, p]) => { setCal(c); setProj(p); });

  useEffect(() => {
    reload();
    loadCrew(work.id).then(setCrew);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id]);

  const submit = async () => {
    if (!form.employee_id) return toast('Сотрудник', 'Выбери сотрудника', 'warn');
    if (!form.date_from) return toast('Дата', 'Укажи дату начала', 'warn');
    setBusy(true);
    try {
      await createStage({
        work_id: work.id,
        employee_id: Number(form.employee_id),
        stage_type: form.stage_type,
        date_from: form.date_from,
        date_to: form.date_to || form.date_from,
        note: form.details || null
      });
      toast('Этап добавлен', '', 'ok');
      setForm({ employee_id: form.employee_id, stage_type: 'medical', date_from: '', date_to: '', details: '' });
      setShowForm(false);
      reload();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const onApprove = (stage) => {
    open(<ConfirmModal
      title="Подтвердить этап"
      message={`Подтвердить «${STAGE_LABELS[stage.stage_type] || stage.stage_type}» (${stage.days_count} дн., ${fmtMoney(stage.amount_earned)})?`}
      tone="success"
      okText="✓ Подтвердить"
      onConfirm={async () => {
        try {
          await approveStage(stage.id);
          toast('Подтверждён', '', 'ok');
          reload();
        } catch (e) {
          toast('Ошибка', String(e?.message || e), 'err');
        }
      }}
    />);
  };

  const onReject = (stage) => {
    open(<PromptModal
      title="Отклонить этап"
      label="Причина отклонения (обязательно)"
      placeholder="Например: дата не совпадает с табелем"
      multiline
      required
      okText="Отклонить"
      icon="⚠️"
      accent="danger"
      onSubmit={async (note) => {
        try {
          await rejectStage(stage.id, note);
          toast('Отклонён', '', 'ok');
          reload();
        } catch (e) {
          toast('Ошибка', String(e?.message || e), 'err');
        }
      }}
    />);
  };

  const openBulk = () => {
    open(
      <BulkStageModal
        work={work}
        crew={crew}
        employees={proj?.employees || []}
        onChanged={reload}
      />,
      { size: 'wide' }
    );
  };

  // ── Summary
  const allStages = (proj?.employees || []).flatMap((e) => (e.stages || []).map((s) => ({ ...s, employee_fio: e.fio })));
  const summary = {
    total: allStages.length,
    completed: allStages.filter((s) => s.status === 'approved' || s.status === 'adjusted' || s.status === 'completed').length,
    in_progress: allStages.filter((s) => s.status === 'active' || s.status === 'planned').length,
    overdue: allStages.filter(isOverdue).length
  };

  const employees = cal?.employees || [];
  const days = [];
  if (cal?.date_from && cal?.date_to) {
    const cur = new Date(cal.date_from);
    const end = new Date(cal.date_to);
    while (cur <= end) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
  }

  return (
    <div className="ft-stack">
      <div className="row-spread">
        <div>
          <strong className="ft-toolbar-title">Этапы командировки</strong>
          <div className="ft-toolbar-sub">{employees.length} сотрудник{plChel(employees.length)} · {days.length} дн. в матрице</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={openBulk}>📋 Типовые этапы</Btn>
          <Btn variant="primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? '× Скрыть' : '+ Добавить этап'}
          </Btn>
        </div>
      </div>

      {/* Summary KPI */}
      <div className="ft-kpis ft-kpis-narrow">
        <div className="ft-kpi">
          <div className="ft-kpi-label">Всего этапов</div>
          <div className="ft-kpi-value">{summary.total}</div>
        </div>
        <div className="ft-kpi ft-kpi--ok">
          <div className="ft-kpi-label">Завершено</div>
          <div className="ft-kpi-value">{summary.completed}</div>
        </div>
        <div className="ft-kpi ft-kpi--info">
          <div className="ft-kpi-label">В работе</div>
          <div className="ft-kpi-value">{summary.in_progress}</div>
        </div>
        <div className="ft-kpi ft-kpi--err">
          <div className="ft-kpi-label">Просрочено</div>
          <div className="ft-kpi-value">{summary.overdue}</div>
        </div>
      </div>

      {showForm && (
        <div className="ft-add-form">
          <div className="ft-row-grid-2">
            <Field label="Сотрудник" required>
              <SelectInput
                value={form.employee_id}
                onChange={(v) => setForm({ ...form, employee_id: v })}
                options={[{ value: '', label: '— выбрать —' }, ...crew.map((c) => ({
                  value: String(c.employee_id || c.id),
                  label: c.employee_name || c.name || c.fio || `#${c.employee_id}`
                }))]}
              />
            </Field>
            <Field label="Тип этапа">
              <SelectInput
                value={form.stage_type}
                onChange={(v) => setForm({ ...form, stage_type: v })}
                options={STAGE_TYPES.map((s) => ({ value: s.value, label: s.label }))}
              />
            </Field>
          </div>
          <div className="ft-row-grid-2">
            <Field label="С" required>
              <DatePicker value={form.date_from} onChange={(v) => setForm({ ...form, date_from: v })} />
            </Field>
            <Field label="По">
              <DatePicker value={form.date_to} onChange={(v) => setForm({ ...form, date_to: v })} />
            </Field>
          </div>
          <Field label="Комментарий">
            <TextareaInput value={form.details} onChange={(v) => setForm({ ...form, details: v })} minRows={1} maxRows={3} />
          </Field>
          <div className="ft-row-r">
            <Btn onClick={() => setShowForm(false)}>Отмена</Btn>
            <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Сохраняем…' : 'Добавить'}</Btn>
          </div>
        </div>
      )}

      {/* Легенда */}
      <div className="ft-stg-legend">
        {STAGE_TYPES.map((s) => (
          <span key={s.value} className="ft-stg-legend-item">
            <span className="ft-stg-legend-sw" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      {cal === null && <div className="muted">⏳ Загружаем матрицу…</div>}

      {cal && employees.length === 0 && (
        <EmptyState icon="🗺" title="Этапов нет" hint="Добавь первый этап кнопкой выше" />
      )}

      {cal && employees.length > 0 && (
        <div className="card ft-stg-matrix-card">
          <table className="t-list ft-stg-matrix">
            <thead>
              <tr>
                <th className="ft-stg-th-fio">Сотрудник</th>
                {days.map((d) => (
                  <th key={d} className="ft-stg-th-day">
                    {String(d).split('-').slice(-1)[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.employee_id} className="row-hover">
                  <td className="ft-stg-fio">{e.fio || `#${e.employee_id}`}</td>
                  {days.map((d) => {
                    const stage = e.days?.[d];
                    return (
                      <td
                        key={d}
                        className="ft-stg-cell"
                        style={{ background: stage ? (STAGE_COLORS[stage.type] || 'var(--bg-3)') : 'transparent' }}
                        title={stage ? `${STAGE_LABELS[stage.type] || stage.type} · ${stage.status}` : ''}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Список этапов по сотрудникам с approve/reject ────────── */}
      {(proj?.employees || []).length > 0 && (
        <div className="ft-stack-10" style={{ marginTop: 12 }}>
          <strong className="ft-section-title">Этапы по сотрудникам</strong>
          {proj.employees.map((emp) => (
            <div key={emp.employee_id} className="ft-card-soft">
              <div className="ft-card-eyebrow ft-card-eyebrow--lg">
                <strong>{emp.fio}</strong>
                <span style={{ color: 'var(--gold)' }}>{emp.total_days} дн. · {fmtMoney(emp.total_earned)}</span>
              </div>
              {(emp.stages || []).map((s) => {
                const canAct = !['approved', 'adjusted', 'rejected'].includes(s.status);
                const overdue = isOverdue(s);
                return (
                  <div key={s.id} className="ft-stg-row">
                    <span className="ft-stg-num" style={{ background: STAGE_COLORS[s.stage_type] || 'var(--bg-3)' }} />
                    <div style={{ flex: 1 }}>
                      <div>
                        <strong>{STAGE_LABELS[s.stage_type] || s.stage_type}</strong>
                        {' · '}
                        <span style={{ color: 'var(--t-3)' }}>{fmtDate(s.date_from)}{s.date_to && s.date_to !== s.date_from ? ' – ' + fmtDate(s.date_to) : ''} · {s.days_count || 1}д.</span>
                        {overdue && <span style={{ color: 'var(--err)', marginLeft: 8 }}>⏰ просрочено</span>}
                      </div>
                      {s.note && <div className="ft-row-name-s">{s.note}</div>}
                      {s.adjustment_note && <div className="ft-row-name-s" style={{ color: 'var(--err)' }}>Причина: {s.adjustment_note}</div>}
                    </div>
                    <div style={{ minWidth: 100, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(s.amount_earned)}</div>
                    <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                      {s.status === 'approved' || s.status === 'adjusted' ? <span title="Подтверждён">✅</span> : null}
                      {s.status === 'rejected' ? <span title="Отклонён">❌</span> : null}
                      {canAct && <Btn size="sm" variant="ghost" onClick={() => onApprove(s)} title="Подтвердить">✅</Btn>}
                      {canAct && <Btn size="sm" variant="ghost" onClick={() => onReject(s)} title="Отклонить">❌</Btn>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function plChel(n) {
  const a = n % 10, b = n % 100;
  if (b > 10 && b < 20) return 'ов';
  if (a === 1) return '';
  if (a > 1 && a < 5) return 'а';
  return 'ов';
}

/* ════════════════════════════════════════════════════════════════════════
 * Bulk: создать «типовые этапы» (медосмотр / дорога / склад / ...).
 * UI: чекбоксы сотрудников + чекбоксы шаблонов + базовая дата.
 * Делаем сериями POST /stages/bulk — по одному типу для всех выбранных.
 * ════════════════════════════════════════════════════════════════════════ */
function BulkStageModal({ work, crew, employees, onChanged }) {
  const { close } = useModal();
  const [pickedEmps, setPickedEmps] = useState(() => new Set());
  const [pickedTpls, setPickedTpls] = useState(() => new Set(STAGE_TEMPLATES.map((t) => t.stage_type)));
  const [baseDate, setBaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  // Источник списка сотрудников: уже отмеченные в проекте + бригада.
  // Соединяем по employee_id, чтобы покрыть и тех, у кого ещё нет этапов.
  const seen = new Set();
  const empList = [];
  for (const e of employees) {
    if (seen.has(e.employee_id)) continue;
    seen.add(e.employee_id);
    empList.push({ id: e.employee_id, fio: e.fio });
  }
  for (const c of crew) {
    const id = c.employee_id || c.id;
    if (seen.has(id)) continue;
    seen.add(id);
    empList.push({ id, fio: c.employee_name || c.name || c.fio || `#${id}` });
  }

  const toggleEmp = (id) => {
    setPickedEmps((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleTpl = (t) => {
    setPickedTpls((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t); else n.add(t);
      return n;
    });
  };
  const allOn = () => setPickedEmps(new Set(empList.map((e) => e.id)));
  const allOff = () => setPickedEmps(new Set());

  const submit = async () => {
    const empIds = [...pickedEmps];
    if (empIds.length === 0) return toast('Сотрудники', 'Выбери минимум одного', 'warn');
    if (pickedTpls.size === 0) return toast('Этапы', 'Выбери минимум один шаблон', 'warn');
    if (!baseDate) return toast('Базовая дата', 'Укажи', 'warn');

    setBusy(true);
    let createdTotal = 0;
    try {
      const base = new Date(baseDate);
      for (const tpl of STAGE_TEMPLATES) {
        if (!pickedTpls.has(tpl.stage_type)) continue;
        const date = new Date(base);
        date.setDate(date.getDate() + (tpl.offset || 0));
        const dStr = date.toISOString().slice(0, 10);
        try {
          const r = await bulkCreateStages({
            employee_ids: empIds,
            work_id: work.id,
            stage_type: tpl.stage_type,
            date_from: dStr
          });
          createdTotal += r?.created_count || 0;
        } catch (e) {
          // дубликаты пропускаются бэком; иные ошибки показываем
          toast('Ошибка ' + tpl.label, String(e?.message || e), 'err');
        }
      }
      toast('Создано этапов', String(createdTotal), createdTotal ? 'ok' : 'warn');
      onChanged?.();
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="📋" title="Типовые этапы бригады" subtitle="Сгенерируем медосмотр + дорогу + склад одной кнопкой" onClose={close} />
      <MBody>
        <div className="ft-row-grid-2">
          {/* Сотрудники */}
          <div>
            <div className="ft-section-title">Сотрудники ({pickedEmps.size}/{empList.length})</div>
            <div style={{ display: 'flex', gap: 8, margin: '6px 0' }}>
              <Btn size="sm" variant="ghost" onClick={allOn}>Все</Btn>
              <Btn size="sm" variant="ghost" onClick={allOff}>Никого</Btn>
            </div>
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--brd)', borderRadius: 8, padding: 8 }}>
              {empList.length === 0 && <div className="muted">В бригаде нет сотрудников</div>}
              {empList.map((e) => (
                <div key={e.id} style={{ padding: '4px 0' }}>
                  <Checkbox checked={pickedEmps.has(e.id)} onChange={() => toggleEmp(e.id)} label={e.fio} />
                </div>
              ))}
            </div>
          </div>

          {/* Шаблоны */}
          <div>
            <div className="ft-section-title">Шаблоны этапов</div>
            <Field label="Базовая дата" required help="День 0 — от него считаются смещения шаблона">
              <DatePicker value={baseDate} onChange={setBaseDate} />
            </Field>
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--brd)', borderRadius: 8, padding: 8, marginTop: 8 }}>
              {STAGE_TEMPLATES.map((t) => (
                <div key={t.stage_type} style={{ padding: '4px 0' }}>
                  <Checkbox
                    checked={pickedTpls.has(t.stage_type)}
                    onChange={() => toggleTpl(t.stage_type)}
                    label={
                      <>
                        <span className="ft-stg-legend-sw" style={{ background: STAGE_COLORS[t.stage_type] }} />
                        {' '}
                        {t.label}
                        {' '}
                        <span style={{ color: 'var(--t-3)', fontSize: 11 }}>(день {t.offset >= 0 ? '+' : ''}{t.offset})</span>
                      </>
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="ft-section-sub" style={{ marginTop: 12 }}>
          Дубликаты (этап такого типа уже на эту дату) пропускаются автоматически — повторный запуск безопасен.
        </div>
      </MBody>
      <MFoot>
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? 'Создаём…' : `Создать (${pickedEmps.size}×${pickedTpls.size})`}</Btn>
      </MFoot>
    </MCard>
  );
}
