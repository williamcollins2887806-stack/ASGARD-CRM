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
  }, [employee?.id, plan?.work_id]);

  const workOptions = works.map((w) => ({
    value: String(w.id),
    label: (w.work_title || 'Работа #' + w.id).slice(0, 80),
  }));

  const save = async () => {
    if (!workId) {
      toast.warn('Выберите проект');
      return;
    }
    setSaving(true);
    try {
      const res = await setPlannedEngagement(employee.id, {
        work_id: Number(workId),
        planned_from: from || null,
        planned_to: to || null,
        note: note.trim() || null,
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
              Сейчас на объекте: {onSite.work_title}. План на другой проект не меняет статус «На объекте».
            </p>
          )}
        </>
      )}
    </div>
  );
}
