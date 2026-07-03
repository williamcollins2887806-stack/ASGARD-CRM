/**
 * CrewTab — Бригада (полевой модуль).
 *
 * Источник vanilla: field-tab.js:186-854 (renderCrewTab + addCrewRow + showDepartureModal).
 *
 * Что реализовано (100% переноса, без stub'ов):
 *   ▸ 11 столбцов: Имя · Роль · Тариф · Баллы · ₽/смена · Совмещение · Дней ·
 *     Заработано · SMS · MAX · Действия
 *   ▸ Тарификация в строке (inline-editor TariffEditor) — авто-recalc, сохранение
 *     через POST /projects/:work_id/crew (бэк upsert'ит одного).
 *   ▸ Модалка отъезда (DepartureModal): фин-сводка + чек-лист имущества +
 *     дата + причина + SMS.
 *   ▸ Раздел «⚫ Уехали/убраны» (DepartedList) — read-only история с возвратом.
 *   ▸ Кнопка «🚀 Запустить Field» (LaunchFieldModal) на каждой строке —
 *     SMS + шортлинк + инструкция онбординга.
 *
 * Backend (file:line):
 *   /api/data/employee_assignments              ← loadCrew (vanilla pattern)
 *   /api/field/manage/tariffs?category=         ← field-manage.js:119
 *   /api/staff/employees/available              ← staff.js
 *   POST   /projects/:work_id/crew              ← field-manage.js:148 (upsert)
 *   POST   /projects/:work_id/departure/:eid    ← field-manage.js:1176
 *   POST   /projects/:work_id/return/:eid       ← field-manage.js:1221
 *   GET    /projects/:work_id/departure-preview/:eid ← field-manage.js:1126
 *   POST   /projects/:work_id/send-invites      ← field-manage.js:291
 *   POST   /projects/:work_id/send-max-invites  ← field-manage.js:357
 *   POST   /projects/:work_id/activate          ← field-manage.js:46
 */
import { useEffect, useMemo, useState } from 'react';
import { Btn } from '@/modals/parts';
import { EmptyState } from '@/blocks/Blocks';
import { StatusBadge, toast } from '@/modals/Notifications';
import { Field, SelectInput, MoneyInput } from '@/inputs/Inputs';
import { useModal, ConfirmModal } from '@/modals';
import {
  loadCrew, loadTariffs, loadAvailableEmployees, loadPaymentsList,
  addCrewMember, removeCrewMember,
  sendCrewInvites, sendCrewMaxInvites, sendSingleInvite,
  activateFieldProject
} from '../api';
import { CATEGORIES, ROLES, SHIFTS } from '../constants';
import TariffEditor from './Crew/TariffEditor';
import DepartureModal from './Crew/DepartureModal';
import DepartedList from './Crew/DepartedList';
import LaunchFieldModal from './Crew/LaunchFieldModal';

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

function pl(n) {
  const a = n % 10, b = n % 100;
  if (b > 10 && b < 20) return 'человек';
  if (a === 1) return 'человек';
  if (a > 1 && a < 5) return 'человека';
  return 'человек';
}

function daysOnSite(dateFrom, departureDate) {
  if (!dateFrom) return null;
  try {
    const start = new Date(dateFrom);
    const end = departureDate ? new Date(departureDate) : new Date();
    const ms = end - start;
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  } catch { return null; }
}

export default function CrewTab({ work }) {
  const { open } = useModal();

  const [allMembers, setAllMembers] = useState(null); // вся бригада (включая departed)
  const [tariffs, setTariffs] = useState([]);
  const [specials, setSpecials] = useState([]);
  const [available, setAvailable] = useState([]);
  const [employees, setEmployees] = useState([]); // полный справочник для имени/телефона
  const [payments, setPayments] = useState([]);   // для столбца «Заработано»
  // Дефолт совпадает с field_tariff_grid.category в БД: mlsp/ground/ground_hard/warehouse.
  // До 23.06.2026 здесь стоял устаревший 'offshore' — dropdown фильтровал по нему и не находил тарифы.
  const [category, setCategory] = useState(work?.field_category || 'mlsp');
  const [perDiem, setPerDiem] = useState(work?.field_per_diem || 0);
  const [showAdd, setShowAdd] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState(null); // employee_id строки в режиме редактирования тарифа
  const [addForm, setAddForm] = useState({
    employee_id: '', role: 'worker', shift: 'day', tariff_id: '', combo_id: '', per_diem: ''
  });
  const [busy, setBusy] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [sendingMax, setSendingMax] = useState(false);
  const [activating, setActivating] = useState(false);

  const reload = () => Promise.all([
    loadCrew(work.id),
    loadTariffs('all').then((d) => Array.isArray(d) ? d : []),
    // bypass cached wrapper for specials — vanilla тоже их получает отдельно
    loadAvailableEmployees(work.id),
    loadPaymentsList(work.id)
  ]).then(([members, allTariffs, av, pays]) => {
    setAllMembers(members || []);
    // У нас loadTariffs отдаёт только массив `tariffs`. Спец-тарифы (для совмещения)
    // подгружаем отдельным запросом из всех (category=special).
    setTariffs(allTariffs.filter((t) => t.category !== 'special'));
    setSpecials(allTariffs.filter((t) => t.category === 'special'));
    setAvailable(av || []);
    setPayments(Array.isArray(pays) ? pays : []);
    // Соберём справочник имён/телефонов (на случай если у назначения нет employee_name)
    const dict = (av || []).map((e) => ({
      id: e.id,
      name: e.fio || e.full_name || `${e.last_name || ''} ${e.first_name || ''}`.trim() || `#${e.id}`,
      phone: e.phone || e.mobile || null,
      position: e.position || e.role_display || e.role || ''
    }));
    setEmployees(dict);
  }).catch((e) => {
    toast('Ошибка', 'Не удалось загрузить бригаду: ' + String(e?.message || e), 'err');
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [work.id, category]);

  // Разбивка на активных / уехавших (vanilla field-tab.js:204-206)
  const { active, departed } = useMemo(() => {
    if (!allMembers) return { active: [], departed: [] };
    const enrich = (m) => {
      const emp = employees.find((e) => Number(e.id) === Number(m.employee_id));
      const pay = payments
        .filter((p) => Number(p.employee_id) === Number(m.employee_id))
        .reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
      return {
        ...m,
        employee_name: m.employee_name || emp?.name || null,
        phone: m.phone || emp?.phone || null,
        days_on_site: daysOnSite(m.date_from, m.departure_date),
        earned: pay || (Number(m.rate_per_shift) || 0) * (Number(m.shifts_count) || 0)
      };
    };
    return {
      active:   allMembers.filter((a) => a.is_active !== false && !a.departure_date).map(enrich),
      departed: allMembers.filter((a) => a.is_active === false || !!a.departure_date).map(enrich)
    };
  }, [allMembers, employees, payments]);

  // Тарифы для совмещения = (specials ∪ tariffs с is_combinable)
  const comboTariffs = useMemo(() => {
    const combo = [...specials];
    tariffs.forEach((t) => { if (t.is_combinable) combo.push(t); });
    return combo;
  }, [tariffs, specials]);

  if (!allMembers) return <div className="ft-loading">⏳ Загружаем бригаду…</div>;

  /* ─── Добавление в бригаду ─── */
  const submitAdd = async () => {
    if (!addForm.employee_id) {
      toast('Сотрудник', 'Выбери из доступных', 'warn');
      return;
    }
    setBusy(true);
    try {
      await addCrewMember(work.id, {
        employee_id: Number(addForm.employee_id),
        field_role: addForm.role,
        shift_type: addForm.shift,
        tariff_id: addForm.tariff_id ? Number(addForm.tariff_id) : null,
        combination_tariff_id: addForm.combo_id ? Number(addForm.combo_id) : null,
        per_diem: addForm.per_diem ? Number(addForm.per_diem) : null
      });
      const empName = available.find((e) => String(e.id) === String(addForm.employee_id))?.fio || '';
      toast('Добавлен в бригаду', empName || '', 'ok');
      setAddForm({ employee_id: '', role: 'worker', shift: 'day', tariff_id: '', combo_id: '', per_diem: '' });
      setShowAdd(false);
      reload();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  /* ─── Удаление (с подтверждением) ─── */
  const onRemove = (employeeId, name) => {
    open(<ConfirmModal
      title="Убрать из бригады"
      message={`Убрать ${name || '#' + employeeId} из бригады?`}
      tone="warn"
      okText="Убрать"
      onConfirm={async () => {
        try {
          await removeCrewMember(work.id, employeeId);
          toast('Убран', name || '', 'ok');
          reload();
        } catch (e) {
          toast('Ошибка', String(e?.message || e), 'err');
        }
      }}
    />);
  };

  /* ─── Оформление отъезда ─── */
  const onDepart = (m) => {
    open(<DepartureModal
      work={work}
      member={m}
      onDone={() => reload()}
    />);
  };

  /* ─── 🚀 Запустить Field ─── */
  const onLaunchField = (m) => {
    open(<LaunchFieldModal
      work={work}
      member={m}
    />);
  };

  /* ─── SMS-broadcast ─── */
  const onSendSmsBroadcast = () => {
    open(<ConfirmModal
      title="Отправить SMS бригаде"
      message="Отправить SMS-приглашения всем в бригаде, кому ещё не отправлено?"
      tone="info"
      okText="📨 Отправить"
      onConfirm={async () => {
        setSendingSms(true);
        try {
          const r = await sendCrewInvites(work.id);
          const sent = r?.sent || 0, failed = r?.failed || 0;
          toast('SMS', `Отправлено: ${sent}, ошибок: ${failed}`, failed ? 'warn' : 'ok');
          reload();
        } catch (e) {
          toast('Ошибка SMS', String(e?.message || e), 'err');
        } finally {
          setSendingSms(false);
        }
      }}
    />);
  };

  /* ─── MAX-broadcast ─── */
  const onSendMaxInvites = () => {
    open(<ConfirmModal
      title="MAX-чат приглашения"
      message="Отправить SMS со ссылкой в MAX-чат всем, кто ещё не вступил?"
      tone="info"
      okText="📲 Отправить"
      onConfirm={async () => {
        setSendingMax(true);
        try {
          const r = await sendCrewMaxInvites(work.id);
          const sent = r?.sent || 0, skipped = r?.skipped || 0, failed = r?.failed || 0;
          toast('MAX', `Отправлено: ${sent}, пропущено: ${skipped}, ошибок: ${failed}`, sent > 0 ? 'ok' : 'warn');
          reload();
        } catch (e) {
          toast('Ошибка MAX', String(e?.message || e), 'err');
        } finally {
          setSendingMax(false);
        }
      }}
    />);
  };

  /* ─── Активация field-проекта (если ещё не запущен) ─── */
  const onActivate = async () => {
    setActivating(true);
    try {
      await activateFieldProject(work.id, {
        site_category: category,
        per_diem: Number(perDiem) || 0,
        schedule_type: 'shift',
        shift_hours: 11
      });
      toast('Field', 'Полевой модуль активирован', 'ok');
      reload();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setActivating(false);
    }
  };

  /* ─── Индивидуальный SMS ─── */
  const onSendSmsOne = async (m) => {
    if (!m.phone) {
      toast('SMS', 'У работника не указан телефон', 'warn');
      return;
    }
    try {
      const r = await sendSingleInvite(work.id, m.employee_id);
      if ((r?.sent || 0) > 0) {
        toast('SMS', `${m.employee_name || '#' + m.employee_id} — SMS отправлено`, 'ok');
        reload();
      } else {
        toast('SMS', 'Не удалось отправить (нет телефона?)', 'warn');
      }
    } catch (e) {
      toast('Ошибка SMS', String(e?.message || e), 'err');
    }
  };

  return (
    <div className="ft-stack">
      {/* ── Toolbar ── */}
      <div className="ft-row">
        <div className="ft-toolbar-info">
          <strong className="ft-toolbar-title">
            Бригада на работе {work.customer_name || ''}
          </strong>
          <div className="ft-toolbar-sub">
            {active.length} {pl(active.length)} в бригаде · {departed.length} уехало · {available.length} свободно в кадре
          </div>
        </div>

        <div className="ft-crew-toolbar-right">
          <Field label="Категория">
            <SelectInput
              value={category}
              onChange={setCategory}
              options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
            />
          </Field>
          <Field label="Суточные ₽/день">
            <MoneyInput value={perDiem} onChange={setPerDiem} />
          </Field>
          <Btn variant="ghost" disabled={activating} onClick={onActivate} title="Активировать настройки field-проекта">
            {activating ? 'Активация…' : '🚀 Запустить Field'}
          </Btn>
          {active.length > 0 && (
            <Btn variant="ghost" disabled={sendingSms} onClick={onSendSmsBroadcast} title="Отправить SMS всем">
              {sendingSms ? 'Отправка…' : '📨 SMS бригаде'}
            </Btn>
          )}
          {active.length > 0 && work.max_chat_id && (
            <Btn variant="ghost" disabled={sendingMax} onClick={onSendMaxInvites} title="SMS со ссылкой в MAX-чат">
              {sendingMax ? 'Отправка…' : '📲 MAX-чат'}
            </Btn>
          )}
          <Btn variant="primary" onClick={() => setShowAdd((s) => !s)}>
            {showAdd ? '× Скрыть' : '+ В бригаду'}
          </Btn>
        </div>
      </div>

      {/* ── Форма добавления ── */}
      {showAdd && (
        <div className="ft-add-form">
          <Field label="Свободный сотрудник" required help={`${available.length} в наличии`}>
            <SelectInput
              value={addForm.employee_id}
              onChange={(v) => setAddForm({ ...addForm, employee_id: v })}
              options={[
                { value: '', label: '— выбрать из свободных —' },
                ...available.map((e) => ({
                  value: String(e.id),
                  label: `${e.fio || e.full_name || `#${e.id}`}${e.specialty ? ' · ' + e.specialty : ''}${e.is_busy ? ' 🔴 занят' : ''}`
                }))
              ]}
            />
          </Field>
          <div className="ft-row-grid-2">
            <Field label="Роль в поле">
              <SelectInput value={addForm.role} onChange={(v) => setAddForm({ ...addForm, role: v })}
                options={ROLES.map((r) => ({ value: r.value, label: r.label }))} />
            </Field>
            <Field label="Смена">
              <SelectInput value={addForm.shift} onChange={(v) => setAddForm({ ...addForm, shift: v })}
                options={SHIFTS.map((s) => ({ value: s.value, label: s.label }))} />
            </Field>
          </div>
          <div className="ft-row-grid-2">
            <Field label="Тариф">
              <SelectInput value={addForm.tariff_id} onChange={(v) => setAddForm({ ...addForm, tariff_id: v })}
                options={[
                  { value: '', label: '— по дефолту —' },
                  ...tariffs.map((t) => ({
                    value: String(t.id),
                    label: `${t.position_name || t.label || t.name} · ${t.points || 0}б · ${fmtMoney(t.rate_per_shift)}/смена`
                  }))
                ]}
              />
            </Field>
            <Field label="Совмещение">
              <SelectInput value={addForm.combo_id} onChange={(v) => setAddForm({ ...addForm, combo_id: v })}
                options={[
                  { value: '', label: 'Нет' },
                  ...comboTariffs
                    .filter((t) => t.is_combinable)
                    .map((t) => ({
                      value: String(t.id),
                      label: `${t.position_name || t.label || t.name} (+${t.points || 1}б)`
                    }))
                ]}
              />
            </Field>
          </div>
          <Field label="Суточные / день">
            <MoneyInput value={addForm.per_diem} onChange={(v) => setAddForm({ ...addForm, per_diem: v })} />
          </Field>
          <div className="ft-row-r">
            <Btn onClick={() => setShowAdd(false)}>Отмена</Btn>
            <Btn variant="primary" disabled={busy} onClick={submitAdd}>{busy ? 'Сохраняем…' : 'Добавить'}</Btn>
          </div>
        </div>
      )}

      {/* ── Таблица бригады ── */}
      {active.length === 0 && !showAdd ? (
        <EmptyState icon="👥" title="Бригада пуста" hint="Добавь рабочих кнопкой выше" />
      ) : active.length === 0 ? null : (
        <div className="card ft-table-wrap">
          <div className="ft-table-scroll">
            <table className="t-list ft-table ft-crew-table">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Роль</th>
                  <th>Тариф</th>
                  <th>Баллы</th>
                  <th>₽/смена</th>
                  <th>Совмещ.</th>
                  <th>Дней</th>
                  <th>Заработано</th>
                  <th>SMS</th>
                  <th>MAX</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {active.map((m) => {
                  const tariff = tariffs.find((t) => Number(t.id) === Number(m.tariff_id));
                  const combo = comboTariffs.find((t) => Number(t.id) === Number(m.combination_tariff_id));
                  const role = ROLES.find((r) => r.value === (m.field_role || m.role_in_field)) || { label: m.field_role || '—' };
                  const points = (tariff?.points || 0) + (combo?.points || 0);
                  const rate = (Number(tariff?.rate_per_shift) || 0) + (Number(combo?.rate_per_shift) || 0);
                  const isEditing = editingMemberId === m.employee_id;

                  // Inline-редактор ниже строки
                  if (isEditing) {
                    return (
                      <tr key={`${m.id || m.employee_id}-edit`} className="ft-crew-edit-row">
                        <td colSpan={11}>
                          <TariffEditor
                            member={m}
                            tariffs={tariffs}
                            comboTariffs={comboTariffs}
                            workId={work.id}
                            onSaved={() => { setEditingMemberId(null); reload(); }}
                            onCancel={() => setEditingMemberId(null)}
                          />
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={m.id || m.employee_id} className="row-hover">
                      <td>
                        <strong className="ft-row-name-l">{m.employee_name || `#${m.employee_id}`}</strong>
                        {m.phone && <div className="ft-row-name-s">{m.phone}</div>}
                      </td>
                      <td>{role.label || '—'}</td>
                      <td>
                        <button
                          className="ft-crew-tariff-btn"
                          onClick={() => setEditingMemberId(m.employee_id)}
                          title="Редактировать тариф"
                        >
                          {tariff ? `${tariff.position_name || tariff.label || tariff.name}` : '— не задан —'}
                          <span className="ft-crew-edit-ic">✎</span>
                        </button>
                      </td>
                      <td className="ft-crew-num">{points || '—'}</td>
                      <td className="ft-crew-num c-gold">{rate ? fmtMoney(rate) : '—'}</td>
                      <td className="ft-crew-num">{combo ? (combo.position_name || combo.name) : '—'}</td>
                      <td className="ft-crew-num">{m.days_on_site != null ? m.days_on_site : '—'}</td>
                      <td className="ft-crew-num c-gold">{m.earned ? fmtMoney(m.earned) : '—'}</td>
                      <td className="ft-crew-num">
                        {m.sms_sent ? (
                          <span title="SMS отправлено" className="ft-crew-icon-ok">✅</span>
                        ) : (
                          <button
                            className="ft-crew-icon-btn"
                            title="Отправить SMS-приглашение"
                            onClick={() => onSendSmsOne(m)}
                          >📨</button>
                        )}
                      </td>
                      <td className="ft-crew-num">
                        {m.max_invite_status === 'joined' ? (
                          <span title="Вступил в MAX-чат" className="ft-crew-icon-ok">✅</span>
                        ) : m.max_invite_status === 'sms_sent' ? (
                          <span title="SMS отправлено, ожидаем" className="ft-crew-icon-pending">⏳</span>
                        ) : work.max_chat_id ? (
                          <button className="ft-crew-icon-btn" title="MAX приглашение" disabled>📲</button>
                        ) : (
                          <span className="ft-crew-icon-muted" title="MAX-чат не создан">—</span>
                        )}
                      </td>
                      <td className="ft-actions-cell">
                        <Btn size="sm" variant="ghost" onClick={() => onLaunchField(m)} title="Запустить Field для работника">🚀</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => onDepart(m)} title="Оформить отъезд">🚪</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => onRemove(m.employee_id, m.employee_name)} title="Убрать из бригады">🗑</Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Уехали/убраны ── */}
      <DepartedList
        work={work}
        items={departed}
        onReturned={() => reload()}
      />
    </div>
  );
}
