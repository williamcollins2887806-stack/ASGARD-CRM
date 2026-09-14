import { useState, useEffect } from 'react';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { Field, SelectInput, DatePicker, TextareaInput } from '@/inputs/Inputs';
import {
  loadWorksLookup,
  setPlannedEngagement,
  clearPlannedEngagement,
  fmtDate,
} from './api';

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:personnel:changed'));
}

export function EmployeePlannedEngagement({ employee, canEdit, onSaved }) {
  const plan = employee?.planned_info;
  const onSite = employee?.on_site_info;

  const [works, setWorks] = useState([]);
  const [workId, setWorkId] = useState(plan?.work_id ? String(plan.work_id) : '');
  const [from, setFrom] = useState(plan?.planned_from ? String(plan.planned_from).slice(0, 10) : '');
  const [to, setTo] = useState(plan?.planned_to ? String(plan.planned_to).slice(0, 10) : '');
  const [note, setNote] = useState(plan?.note || '');
  const [inbound, setInbound] = useState(plan?.inbound_transport || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadWorksLookup().then((list) => {
      const active = (list || []).filter((w) => w.deleted_at == null && w.work_status !== 'Архив');
      setWorks(active.sort((a, b) => (a.work_title || '').localeCompare(b.work_title || '', 'ru')));
    });
  }, []);

  useEffect(() => {
    setWorkId(plan?.work_id ? String(plan.work_id) : '');
    setFrom(plan?.planned_from ? String(plan.planned_from).slice(0, 10) : '');
    setTo(plan?.planned_to ? String(plan.planned_to).slice(0, 10) : '');
    setNote(plan?.note || '');
    setInbound(plan?.inbound_transport || '');
  }, [employee?.id, plan?.work_id]);

  const workOptions = works.map((w) => {
    const base = (w.work_title || 'Работа #' + w.id).slice(0, 70);
    const isCurrent = onSite && Number(onSite.work_id) === Number(w.id);
    return {
      value: String(w.id),
      label: isCurrent ? `${base} · уже на объекте` : base,
    };
  });

  const save = async () => {
    if (!workId) {
      toast.warn('Выберите проект');
      return;
    }
    if (onSite && Number(onSite.work_id) === Number(workId)) {
      toast.warn(
        `«${employee.fio || 'Сотрудник'}» уже на объекте «${onSite.work_title || ''}». Выберите другой проект или оформите отъезд.`
      );
      return;
    }
    setSaving(true);
    try {
      const res = await setPlannedEngagement(employee.id, {
        work_id: Number(workId),
        planned_from: from || null,
        planned_to: to || null,
        note: note.trim() || null,
        inbound_transport: inbound || null,
      });
      if (res.warnings?.length) {
        toast.warn(res.warnings.join('; '));
      }
      toast.success('План сохранён');
      emitChanged();
      onSaved?.();
    } catch (e) {
      toast.error(e?.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      await clearPlannedEngagement(employee.id);
      toast.success('Снят с плана');
      setWorkId('');
      setFrom('');
      setTo('');
      setNote('');
      setInbound('');
      emitChanged();
      onSaved?.();
    } catch (e) {
      toast.error(e?.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit && !plan) return null;

  return (
    <div className="prs-planned-block">
      {plan && !canEdit && (
        <div className="prs-detail-card">
          <div className="prs-detail-loc-title">План: {plan.work_title}</div>
          {plan.pm_name && <div className="prs-detail-loc-pm">РП: {plan.pm_name}</div>}
          {(plan.planned_from || plan.planned_to) && (
            <div className="prs-detail-loc-pm">
              {plan.planned_from && `с ${fmtDate(plan.planned_from)}`}
              {plan.planned_to && ` по ${fmtDate(plan.planned_to)}`}
            </div>
          )}
          {plan.inbound_transport && (
            <div className="prs-detail-loc-pm">
              Завоз: {plan.inbound_transport === 'ship' ? 'корабль' : 'вертолёт'}
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <>
          <Field label="Проект">
            <SelectInput
              value={workId}
              onChange={setWorkId}
              options={[{ value: '', label: '— выберите работу —' }, ...workOptions]}
            />
          </Field>
          <div className="row gap-12 u-wrap">
            <Field label="С даты">
              <DatePicker value={from} onChange={(v) => setFrom(v || '')} />
            </Field>
            <Field label="По дату">
              <DatePicker value={to} onChange={(v) => setTo(v || '')} />
            </Field>
          </div>
          <Field label="Чем завозим (МЛСП)">
            <SelectInput
              value={inbound}
              onChange={setInbound}
              options={[
                { value: '', label: '— не указано —' },
                { value: 'helicopter', label: 'Вертолёт' },
                { value: 'ship', label: 'Корабль' },
              ]}
            />
          </Field>
          <Field label="Комментарий">
            <TextareaInput value={note} onChange={setNote} minRows={2} maxRows={3} placeholder="Необязательно" />
          </Field>
          <div className="row gap-8 u-wrap">
            <Btn variant="primary" size="sm" disabled={saving} onClick={save}>
              {saving ? 'Сохраняем…' : 'Сохранить план'}
            </Btn>
            {plan && (
              <Btn variant="ghost" size="sm" disabled={saving} onClick={clear}>
                Снять с плана
              </Btn>
            )}
          </div>
          {onSite && (
            <p className="prs-planned-hint muted fs-12">
              Сейчас на объекте: <b>{onSite.work_title}</b>
              {onSite.pm_name ? ` · РП: ${onSite.pm_name}` : ''}.
              {' '}План на другой проект не снимает его с текущего. Чтобы перевести — сначала отъезд.
            </p>
          )}
        </>
      )}
    </div>
  );
}
