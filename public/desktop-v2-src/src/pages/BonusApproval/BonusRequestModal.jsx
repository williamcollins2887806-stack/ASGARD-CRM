/**
 * Модалка создания заявки на премию (для РП).
 * Источник vanilla: AsgardBonusApproval.openBonusModal() (bonus_approval.js).
 *
 * Шаги:
 *   1. Выбрать работу
 *   2. Загрузить рабочих, назначенных на работу (employee_assignments)
 *   3. Указать сумму премии для каждого + обоснование
 *   4. POST /api/data/bonus_requests со статусом 'pending'
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { SelectInput, MoneyInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import {
  loadWorks, loadAssignments, loadEmployees, createBonusRequest, notifyApproval,
  fmtMoney, fmtDate
} from './api';

export function BonusRequestModal({ workId: initialWorkId, workTitle: initialWorkTitle, pmName, onDone }) {
  const { close } = useModal();
  const [works, setWorks] = useState([]);
  const [workId, setWorkId] = useState(initialWorkId ? String(initialWorkId) : '');
  const [workTitle, setWorkTitle] = useState(initialWorkTitle || '');
  const [employees, setEmployees] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [amounts, setAmounts] = useState({}); // { employee_id: amount }
  const [comment, setComment] = useState('');
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Загрузка работ (если не передан конкретный)
  useEffect(() => {
    if (initialWorkId) return;
    loadWorks().then(setWorks).catch(() => setWorks([]));
  }, [initialWorkId]);

  // Загрузка справочника рабочих
  useEffect(() => {
    loadEmployees().then(setEmployees).catch(() => setEmployees([]));
  }, []);

  // Загрузка assignments при выборе работы
  useEffect(() => {
    if (!workId) { setAssignments([]); return; }
    setLoadingWorkers(true);
    loadAssignments(workId)
      .then(setAssignments)
      .catch(() => setAssignments([]))
      .finally(() => setLoadingWorkers(false));
  }, [workId]);

  // Объединяем assignments с employees для отображения
  const workers = useMemo(() => {
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return assignments
      .map((a) => {
        const emp = empMap.get(a.employee_id);
        if (!emp) return null;
        return {
          employee_id: a.employee_id,
          fio: emp.fio || emp.full_name || `Рабочий #${a.employee_id}`,
          role: emp.role_tag || a.role_on_work || '—',
          date_from: a.date_from,
          date_to: a.date_to
        };
      })
      .filter(Boolean);
  }, [assignments, employees]);

  const total = useMemo(
    () => Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0),
    [amounts]
  );

  const setWorkSel = (v) => {
    setWorkId(v);
    const w = works.find((x) => String(x.id) === String(v));
    if (w) setWorkTitle(w.work_title || w.title || `Работа #${w.id}`);
    setAmounts({});
  };

  const setAmt = (empId, val) => {
    setAmounts((s) => ({ ...s, [empId]: val }));
  };

  const submit = async () => {
    if (!workId) { toast('Ошибка', 'Выберите работу', 'err'); return; }
    if (!comment.trim()) { toast('Ошибка', 'Укажите обоснование премий', 'err'); return; }

    const bonuses = workers
      .map((w) => ({ employee_id: w.employee_id, amount: Number(amounts[w.employee_id]) || 0 }))
      .filter((b) => b.amount > 0);

    if (!bonuses.length) {
      toast('Ошибка', 'Укажите хотя бы одну премию', 'err');
      return;
    }

    const payload = {
      work_id: Number(workId),
      work_title: workTitle,
      pm_name: pmName || '',
      bonuses: bonuses,
      bonuses_json: JSON.stringify(bonuses),
      total_amount: total,
      comment: comment.trim(),
      status: 'pending'
    };

    setSubmitting(true);
    try {
      const created = await createBonusRequest(payload);
      const newId = created?.id || created?.bonus_request?.id;

      // Telegram-уведомления всем директорам (синхронно с vanilla bonus_approval.js:257)
      try {
        const dirs = await api('/api/users?role=DIRECTOR_GEN&limit=20')
          .then((d) => d.users || d.items || [])
          .catch(() => []);
        for (const d of dirs) {
          if (!d?.id) continue;
          await notifyApproval({
            type: 'bonus',
            action: 'created',
            entityId: newId || 0,
            toUserId: d.id,
            details: `РП ${pmName || ''} запрашивает согласование премий.\nРабота: ${workTitle || ''}\nСумма: ${fmtMoney(total)}`
          });
        }
      } catch { /* noop */ }

      toast('Отправлено', 'Запрос на согласование отправлен директору', 'ok');
      window.dispatchEvent(new CustomEvent('asgard:bonus-approval:changed'));
      onDone?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setSubmitting(false);
    }
  };

  const workOptions = useMemo(() => {
    const list = works.map((w) => ({
      value: String(w.id),
      label: `#${w.id} · ${w.customer_name ? w.customer_name + ' — ' : ''}${w.work_title || w.title || 'Работа'}`
    }));
    if (initialWorkId && !list.find((o) => o.value === String(initialWorkId))) {
      list.unshift({ value: String(initialWorkId), label: workTitle || `Работа #${initialWorkId}` });
    }
    return list;
  }, [works, initialWorkId, workTitle]);

  return (
    <MCard className="modal-lg">
      <MHead icon="🏆" title="Согласование премий" subtitle={workTitle} accent="gold" onClose={close} />
      <MBody style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {!initialWorkId && (
          <Field label="Работа" required>
            <SelectInput
              value={workId}
              onChange={setWorkSel}
              options={workOptions}
              placeholder="Выберите работу…"
            />
          </Field>
        )}

        {workId && (
          <>
            <div className="mt-12 mb-8 fs-12 c-t3 upper fw-700 ls-1">
              Рабочие на работе
            </div>
            {loadingWorkers ? (
              <div className="p-20 t-center c-t3">⏳ Загружаем рабочих…</div>
            ) : workers.length === 0 ? (
              <div className="p-16 t-center c-t3 bg-inner r-md">
                На работе нет назначенных рабочих
              </div>
            ) : (
              <div className="card card-pad-overflow">
                <table className="t-list w-full tbl-base">
                  <thead>
                    <tr className="bg-inner tbl-row-brd">
                      <th className="pad-cell-lg t-left fw-600">Рабочий</th>
                      <th className="pad-cell-lg t-left fw-600">Должность</th>
                      <th className="pad-cell-lg t-left fw-600">Период</th>
                      <th className="pad-cell-lg t-right fw-600 w-160">Премия (₽)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workers.map((w) => (
                      <tr key={w.employee_id} className="tbl-row-brd">
                        <td className="pad-cell-md fw-600">{w.fio}</td>
                        <td className="pad-cell-md c-t2">{w.role}</td>
                        <td className="pad-cell-md c-t3 fs-12">
                          {fmtDate(w.date_from)} — {fmtDate(w.date_to)}
                        </td>
                        <td className="pad-cell-md">
                          <MoneyInput
                            value={amounts[w.employee_id] ?? ''}
                            onChange={(v) => setAmt(w.employee_id, v)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-inner">
                      <td colSpan={3} className="pad-cell-lg t-right fw-700">Итого:</td>
                      <td className="pad-cell-lg t-right fw-800 c-gold fs-15">
                        {fmtMoney(total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="mt-14">
              <Field label="Обоснование премий" required help="За что начисляется премия, обоснование суммы">
                <TextareaInput
                  value={comment}
                  onChange={setComment}
                  placeholder="Опишите за что и почему начисляется премия…"
                  minRows={3}
                  maxRows={6}
                />
              </Field>
            </div>
          </>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn
          variant="primary"
          onClick={submit}
          disabled={submitting || !workId || workers.length === 0 || total <= 0 || !comment.trim()}
        >
          {submitting ? '…' : 'Отправить на согласование'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
