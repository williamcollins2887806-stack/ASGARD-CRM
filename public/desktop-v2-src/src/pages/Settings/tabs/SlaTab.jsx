/**
 * Settings → таб «SLA и лимиты»: дедлайны, рабочие дни, лимиты, расписания.
 */
import { num, parseLines } from '../api';
import { SelectInput } from '@/inputs/Inputs';

export default function SlaTab({ app, setApp, refs }) {
  const sla = app.sla || {};
  const limits = app.limits || {};
  const schedules = app.schedules || {};

  const setSla = (k, v) => setApp((a) => ({ ...a, sla: { ...(a.sla || {}), [k]: v } }));
  const setLimits = (k, v) => setApp((a) => ({ ...a, limits: { ...(a.limits || {}), [k]: v } }));
  const setSchedules = (k, v) =>
    setApp((a) => ({ ...a, schedules: { ...(a.schedules || {}), [k]: v } }));

  return (
    <div className="sett-grid">
      <div className="sett-card">
        <h3>⏱ SLA и напоминания</h3>
        <p className="sett-hint">
          Сроки и интервалы напоминаний. Движок уведомлений использует эти значения для PM и директоров.
        </p>

        <div className="sett-row">
          <div className="sett-field">
            <label>Дедлайн заявки: напоминать за N дней</label>
            <input
              type="number" min="0" step="1"
              className="inp-text"
              value={sla.docs_deadline_notice_days ?? 5}
              onChange={(e) =>
                setSla('docs_deadline_notice_days', Math.max(0, Math.round(num(e.target.value, 5))))
              }
            />
          </div>
          <div className="sett-field">
            <label>ДР: напоминать за N дней</label>
            <input
              type="number" min="0" step="1"
              className="inp-text"
              value={sla.birthday_notice_days ?? 5}
              onChange={(e) =>
                setSla('birthday_notice_days', Math.max(0, Math.round(num(e.target.value, 5))))
              }
            />
          </div>
          <div className="sett-field">
            <label>РП: срок просчёта, рабочих дней</label>
            <input
              type="number" min="0" step="1"
              className="inp-text"
              value={sla.pm_calc_due_workdays ?? 3}
              onChange={(e) =>
                setSla('pm_calc_due_workdays', Math.max(0, Math.round(num(e.target.value, 3))))
              }
            />
          </div>
          <div className="sett-field">
            <label>Директор: срок согласования, рабочих дней</label>
            <input
              type="number" min="0" step="1"
              className="inp-text"
              value={sla.director_approval_due_workdays ?? 2}
              onChange={(e) =>
                setSla(
                  'director_approval_due_workdays',
                  Math.max(0, Math.round(num(e.target.value, 2)))
                )
              }
            />
          </div>
          <div className="sett-field">
            <label>РП: срок доработки, рабочих дней</label>
            <input
              type="number" min="0" step="1"
              className="inp-text"
              value={sla.pm_rework_due_workdays ?? 1}
              onChange={(e) =>
                setSla('pm_rework_due_workdays', Math.max(0, Math.round(num(e.target.value, 1))))
              }
            />
          </div>
          <div className="sett-field">
            <label>Автоудаление напоминаний, часов</label>
            <input
              type="number" min="1" step="1"
              className="inp-text"
              value={app.reminder_auto_delete_hours ?? 48}
              onChange={(e) =>
                setApp((a) => ({
                  ...a,
                  reminder_auto_delete_hours: Math.max(1, Math.round(num(e.target.value, 48)))
                }))
              }
            />
            <div className="sett-help">Завершённые напоминания удаляются через N часов</div>
          </div>
          <div className="sett-field">
            <label>Прямой запрос: дедлайн по умолчанию, дней</label>
            <input
              type="number" min="0" step="1"
              className="inp-text"
              value={sla.direct_request_deadline_days ?? 5}
              onChange={(e) =>
                setSla(
                  'direct_request_deadline_days',
                  Math.max(0, Math.round(num(e.target.value, 5)))
                )
              }
            />
          </div>
          <div className="sett-field">
            <label>ТКП Follow-up: первое напоминание через N дней</label>
            <input
              type="number" min="1" step="1"
              className="inp-text"
              value={sla.tkp_followup_first_delay_days ?? 3}
              onChange={(e) =>
                setSla(
                  'tkp_followup_first_delay_days',
                  Math.max(1, Math.round(num(e.target.value, 3)))
                )
              }
            />
            <div className="sett-help">
              Затем ежедневно до закрытия — для «Прямой запрос» после статуса «ТКП отправлено».
            </div>
          </div>
        </div>
      </div>

      <div className="sett-card">
        <h3>📊 Лимиты РП</h3>
        <p className="sett-hint">Ограничения на параллельную нагрузку.</p>

        <div className="sett-row">
          <div className="sett-field">
            <label>Лимит активных просчётов на 1 РП</label>
            <input
              type="number" min="1" step="1"
              className="inp-text"
              value={limits.pm_active_calcs_limit ?? 5}
              onChange={(e) =>
                setLimits('pm_active_calcs_limit', Math.max(1, Math.round(num(e.target.value, 5))))
              }
            />
          </div>
        </div>

        <div className="sett-field mt-10" >
          <label>Просчёт НЕ считается активным при статусах</label>
          <input
            type="text"
            className="inp-text"
            value={limits.pm_active_calcs_done_statuses ?? ''}
            placeholder="через запятую: Согласование ТКП, ТКП согласовано, Выиграли, Проиграли"
            onChange={(e) => setLimits('pm_active_calcs_done_statuses', e.target.value)}
          />
          <div className="sett-help">Используется для лимита активных просчётов (этап 6)</div>
        </div>
      </div>

      <div className="sett-card">
        <h3>📅 Календарь / правила</h3>
        <p className="sett-hint">Бизнес-правила для броней и сдвигов.</p>

        <label className="sett-checkbox-row">
          <input
            type="checkbox"
            checked={schedules.office_strict_own !== false}
            onChange={(e) => setSchedules('office_strict_own', e.target.checked)}
          />
          <span>Офис: строго «только свои статусы»</span>
        </label>

        <label className="sett-checkbox-row">
          <input
            type="checkbox"
            checked={schedules.block_on_conflict !== false}
            onChange={(e) => setSchedules('block_on_conflict', e.target.checked)}
          />
          <span>Запрет согласования заявки персонала при конфликте брони</span>
        </label>

        <div className="sett-field mt-10" >
          <label>Рабочие: кто может сдвигать/править бронь</label>
          <input
            type="text"
            className="inp-text"
            value={(schedules.workers_shift_logins || []).join(',')}
            placeholder="логины через запятую"
            onChange={(e) =>
              setSchedules('workers_shift_logins', parseLines(e.target.value.replace(/,/g, '\n')))
            }
          />
        </div>

        <div className="sett-field mt-10" >
          <label>Контракты: статус, при котором доступна «Работы завершены»</label>
          <SelectInput
            value={app.work_close_trigger_status || ''}
            onChange={(v) => setApp((a) => ({ ...a, work_close_trigger_status: v }))}
            options={(refs.work_statuses || []).map((s) => ({ value: s, label: s }))}
          />
          <div className="sett-help">
            РП сможет закрывать контракт через мастер «Работы завершены» только при этом статусе.
          </div>
        </div>
      </div>
    </div>
  );
}
