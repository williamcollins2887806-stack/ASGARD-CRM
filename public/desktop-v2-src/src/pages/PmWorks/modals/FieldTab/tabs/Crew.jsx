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
import { Field, SelectInput, MoneyInput, TextInput } from '@/inputs/Inputs';
import { useModal, ConfirmModal } from '@/modals';
import {
  loadCrew, loadTariffs, loadAvailableEmployees, loadPaymentsList,
  addCrewMember, hardRemoveCrewMember,
  sendCrewInvites, sendCrewMaxInvites, sendSingleInvite,
  activateFieldProject, loadRoleBaseRates
} from '../api';
import {
  CATEGORIES, ROLES, SHIFTS, mapRoleTagToFieldRole,
  filterTariffsForFieldRole, defaultTariffIdForRole, tariffIdFromRoleBaseRates
} from '../constants';
import TariffEditor from './Crew/TariffEditor';
import DepartureModal from './Crew/DepartureModal';
import DepartedList from './Crew/DepartedList';
import LaunchFieldModal from './Crew/LaunchFieldModal';
import { openBaseRatesModal } from './Crew/BaseRatesModal';
import { formatMoney as fmtMoney } from '@/lib/money';

function byFio(a, b) {
  return String(a?.employee_name || '').localeCompare(String(b?.employee_name || ''), 'ru', { sensitivity: 'base' });
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
    employee_id: '', role: 'worker', shift: 'day', tariff_id: '',
    combo_ids: [], manual_extra: ''
  });
  const [busy, setBusy] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [sendingMax, setSendingMax] = useState(false);
  const [activating, setActivating] = useState(false);
  const [fioQuery, setFioQuery] = useState('');
  const [roleBaseRates, setRoleBaseRates] = useState(null);

  const reload = () => Promise.all([
    loadCrew(work.id),
    loadTariffs('all').then((d) => Array.isArray(d) ? d : []),
    // bypass cached wrapper for specials — vanilla тоже их получает отдельно
    loadAvailableEmployees(work.id),
    loadPaymentsList(work.id),
    loadRoleBaseRates(work.id)
  ]).then(([members, allTariffs, av, pays, rbr]) => {
    setAllMembers(members || []);
    // У нас loadTariffs отдаёт только массив `tariffs`. Спец-тарифы (для совмещения)
    // подгружаем отдельным запросом из всех (category=special).
    setTariffs(allTariffs.filter((t) => t.category !== 'special'));
    setSpecials(allTariffs.filter((t) => t.category === 'special'));
    setAvailable(av || []);
    setPayments(Array.isArray(pays) ? pays : []);
    setRoleBaseRates(rbr?.role_base_rates || null);
    if (rbr?.site_category) setCategory(rbr.site_category);
    // Соберём справочник имён/телефонов (на случай если у назначения нет employee_name)
    const dict = (av || []).map((e) => ({
      id: e.id,
      name: e.fio || e.full_name || `${e.last_name || ''} ${e.first_name || ''}`.trim() || `#${e.id}`,
      phone: e.phone || e.mobile || null,
      position: e.position || e.role_display || e.role || '',
      role_tag: e.role_tag || ''
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
      active:   allMembers.filter((a) => a.is_active !== false && !a.departure_date).map(enrich).sort(byFio),
      departed: allMembers.filter((a) => a.is_active === false || !!a.departure_date).map(enrich).sort(byFio)
    };
  }, [allMembers, employees, payments]);

  const filteredActive = useMemo(() => {
    const q = fioQuery.trim().toLowerCase();
    if (!q) return active;
    return active.filter((m) => String(m.employee_name || '').toLowerCase().includes(q));
  }, [active, fioQuery]);

  // Тарифы для совмещения = (specials ∪ tariffs с is_combinable) в категории
  const comboTariffs = useMemo(() => {
    const combo = [];
    tariffs.forEach((t) => {
      if (t.is_combinable && t.category === category) combo.push(t);
    });
    specials.forEach((t) => { if (t.is_combinable) combo.push(t); });
    return combo;
  }, [tariffs, specials, category]);

  const categoryTariffs = useMemo(
    () => tariffs.filter((t) => t.category === category),
    [tariffs, category]
  );

  const addFormTariffs = useMemo(
    () => filterTariffsForFieldRole(categoryTariffs, addForm.role, category),
    [categoryTariffs, addForm.role, category]
  );

  const addFormCalc = useMemo(() => {
    const t = addFormTariffs.find((x) => String(x.id) === String(addForm.tariff_id))
      || categoryTariffs.find((x) => String(x.id) === String(addForm.tariff_id));
    const basePoints = t ? Number(t.points) || 0 : 0;
    const baseRate = t ? Number(t.rate_per_shift) || 0 : 0;
    let comboPoints = 0;
    let comboRate = 0;
    for (const id of addForm.combo_ids || []) {
      const c = comboTariffs.find((x) => String(x.id) === String(id));
      if (!c) continue;
      comboPoints += Number(c.points) || 0;
      comboRate += Number(c.rate_per_shift) || 0;
    }
    let manual = Number(String(addForm.manual_extra || '').replace(',', '.'));
    if (!Number.isFinite(manual) || manual < 0) manual = 0;
    manual = Math.round(manual * 100) / 100;
    const pv = t?.point_value != null ? Number(t.point_value) : 500;
    return {
      basePoints, baseRate, comboPoints, comboRate, manual,
      totalPoints: basePoints + comboPoints + manual,
      totalRate: baseRate + comboRate + manual * pv
    };
  }, [addForm, addFormTariffs, categoryTariffs, comboTariffs]);

  const resolveTariffForRole = (role, rates = roleBaseRates) => {
    const fromBase = tariffIdFromRoleBaseRates(rates, role);
    if (fromBase) return fromBase;
    return defaultTariffIdForRole(categoryTariffs, role, category);
  };

  if (!allMembers) return <div className="ft-loading">⏳ Загружаем бригаду…</div>;

  /* ─── Добавление в бригаду ─── */
  const submitAdd = async () => {
    if (!addForm.employee_id) {
      toast('Сотрудник', 'Выбери из доступных', 'warn');
      return;
    }
    const emp = available.find((e) => String(e.id) === String(addForm.employee_id));
    if (emp?.is_busy && emp.busy_with?.length) {
      const w = emp.busy_with[0];
      const endStr = w.end_date ? new Date(w.end_date).toLocaleDateString('ru-RU') : '—';
      const ok = window.confirm(
        `⚠️ Этот сотрудник уже на объекте:\n«${w.work_title || '?'}»\nдо ${endStr}\n\nНазначить всё равно?`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const ids = (addForm.combo_ids || []).map(Number).filter((n) => n > 0);
      await addCrewMember(work.id, {
        employee_id: Number(addForm.employee_id),
        field_role: addForm.role,
        shift_type: addForm.shift,
        tariff_id: addForm.tariff_id ? Number(addForm.tariff_id) : null,
        combination_tariff_id: ids[0] || null,
        combo_tariff_ids: ids,
        manual_extra_points: addFormCalc.manual
        // суточные — только из настроек проекта (toolbar), не per-person при добавлении
      });
      const empName = emp?.fio || available.find((e) => String(e.id) === String(addForm.employee_id))?.fio || '';
      toast('Добавлен в бригаду', empName || '', 'ok');
      setAddForm({
        employee_id: '', role: 'worker', shift: 'day', tariff_id: '',
        combo_ids: [], manual_extra: ''
      });
      setShowAdd(false);
      reload();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  /* ─── ✕ Убрать из бригады (назначение). Сотрудник в справочнике остаётся. ─── */
  const onRemove = (employeeId, name) => {
    open(<ConfirmModal
      title="Убрать из бригады?"
      message={
        `Убрать ${name || '#' + employeeId} из бригады этой работы?\n\n` +
        `Карточка в справочнике останется. Удалится только назначение на объект ` +
        `(и смены на нём). Дорога/корабль Хосе сохранятся.\n\n` +
        `Для отъезда с датой в истории — «Отъезд».`
      }
      tone="danger"
      okText="Убрать из бригады"
      onConfirm={async () => {
        try {
          await hardRemoveCrewMember(work.id, employeeId);
          toast('Убран из бригады', name || '', 'ok');
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
      openBaseRatesModal(open, {
        workId: work.id,
        workTitle: work.work_title || work.customer_name,
        siteCategory: category,
        onSaved: () => reload()
      });
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setActivating(false);
    }
  };

  const onOpenBaseRates = () => {
    openBaseRatesModal(open, {
      workId: work.id,
      workTitle: work.work_title || work.customer_name,
      siteCategory: category,
      onSaved: () => reload()
    });
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
          <Btn variant="ghost" onClick={onOpenBaseRates} title="Базовые ставки по ролям">
            💰 Базовые ставки
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

      {/* ── Поиск по ФИО ── */}
      <div className="ft-crew-filter-bar">
        <div className="ft-crew-search">
          <TextInput
            icon="🔍"
            clearable
            value={fioQuery}
            onChange={setFioQuery}
            placeholder="Поиск по ФИО…"
          />
        </div>
        <span className="ft-crew-filter-hint">
          {fioQuery.trim()
            ? `Найдено: ${filteredActive.length} из ${active.length}`
            : (active.length ? `${active.length} чел. · А→Я` : '')}
        </span>
      </div>

      {/* ── Форма добавления ── */}
      {showAdd && (
        <div className="ft-add-form">
          <Field label="Свободный сотрудник" required help={`${available.length} в наличии`}>
            <SelectInput
              value={addForm.employee_id}
              onChange={(v) => {
                const emp = available.find((e) => String(e.id) === String(v));
                const mapped = mapRoleTagToFieldRole(emp?.role_tag);
                const next = {
                  ...addForm,
                  employee_id: v,
                  role: mapped,
                  tariff_id: resolveTariffForRole(mapped),
                  combo_ids: []
                };
                setAddForm(next);
                if (emp?.is_busy && emp.busy_with?.length) {
                  const w = emp.busy_with[0];
                  toast(
                    'Уже на объекте',
                    `«${emp.fio || 'Сотрудник'}»: ${w.work_title || 'другая работа'}${w.end_date ? ' до ' + new Date(w.end_date).toLocaleDateString('ru-RU') : ''}`,
                    'warn'
                  );
                }
              }}
              options={[
                { value: '', label: '— выбрать из свободных —' },
                ...available.map((e) => {
                  const busy = e.is_busy && e.busy_with?.length
                    ? ` 🔴 ${(e.busy_with[0].work_title || 'занят').slice(0, 40)}`
                    : (e.is_busy ? ' 🔴 занят' : '');
                  return {
                    value: String(e.id),
                    label: `${e.fio || e.full_name || `#${e.id}`}${e.role_tag || e.specialty ? ' · ' + (e.role_tag || e.specialty) : ''}${busy}`
                  };
                })
              ]}
            />
          </Field>
          <div className="ft-row-grid-2">
            <Field label="Роль в поле">
              <SelectInput
                value={addForm.role}
                onChange={(v) => {
                  setAddForm({
                    ...addForm,
                    role: v,
                    tariff_id: resolveTariffForRole(v)
                  });
                }}
                options={ROLES.map((r) => ({ value: r.value, label: r.label }))}
              />
            </Field>
            <Field label="Смена">
              <SelectInput value={addForm.shift} onChange={(v) => setAddForm({ ...addForm, shift: v })}
                options={SHIFTS.map((s) => ({ value: s.value, label: s.label }))} />
            </Field>
          </div>

          <div className="ft-assign-rate-grid">
            <div className="ft-assign-rate-col ft-assign-rate-col--base">
              <div className="ft-assign-rate-col__title">База</div>
              <p className="ft-assign-rate-hint">
                {roleBaseRates
                  ? 'Подставлена из базовых ставок объекта (можно сменить).'
                  : 'Задайте базовые ставки кнопкой «💰 Базовые ставки» или выберите тариф.'}
              </p>
              <Field label="Тариф">
                <SelectInput value={addForm.tariff_id} onChange={(v) => setAddForm({ ...addForm, tariff_id: v })}
                  options={[
                    { value: '', label: '— по дефолту —' },
                    ...addFormTariffs.map((t) => ({
                      value: String(t.id),
                      label: `${t.position_name || t.label || t.name} · ${t.points || 0}б · ${fmtMoney(t.rate_per_shift)}/смена`
                    }))
                  ]}
                />
              </Field>
            </div>
            <div className="ft-assign-rate-col ft-assign-rate-col--extra">
              <div className="ft-assign-rate-col__title">Доплата</div>
              <p className="ft-assign-rate-hint">Только этому человеку · галочки и/или ручные баллы (3.5…)</p>
              <Field label="Ручные баллы">
                <input
                  className="m-input"
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="0"
                  value={addForm.manual_extra}
                  onChange={(e) => setAddForm({ ...addForm, manual_extra: e.target.value })}
                />
              </Field>
              <div className="ft-assign-rate-checks">
                {comboTariffs.filter((t) => t.is_combinable).map((t) => {
                  const id = String(t.id);
                  const checked = (addForm.combo_ids || []).includes(id);
                  return (
                    <label key={id} className="ft-assign-rate-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const cur = addForm.combo_ids || [];
                          setAddForm({
                            ...addForm,
                            combo_ids: checked ? cur.filter((x) => x !== id) : [...cur, id]
                          });
                        }}
                      />
                      <span>{t.position_name || t.name} (+{t.points || 1}б)</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="ft-tariff-editor__calc ft-assign-rate-total">
            <div>
              <span className="ft-tariff-editor__calc-l">Итого:</span>
              <strong>
                {addFormCalc.totalPoints}б · {addFormCalc.totalRate ? fmtMoney(addFormCalc.totalRate) : '—'}
              </strong>
            </div>
          </div>

          <div className="ft-row-r">
            <Btn onClick={() => setShowAdd(false)}>Отмена</Btn>
            <Btn variant="primary" disabled={busy} onClick={submitAdd}>{busy ? 'Сохраняем…' : 'Добавить'}</Btn>
          </div>
        </div>
      )}

      {/* ── Таблица бригады ── */}
      {active.length === 0 && !showAdd ? (
        <EmptyState icon="👥" title="Бригада пуста" hint="Добавь рабочих кнопкой выше" />
      ) : active.length === 0 ? null : filteredActive.length === 0 ? (
        <EmptyState icon="🔍" title="Никого не найдено" hint="Сбрось поиск или уточни ФИО" />
      ) : (
        <div className="card ft-table-wrap">
          <div className="ft-table-scroll">
            <table className="t-list ft-table ft-crew-table">
              <thead>
                <tr>
                  <th style={{ width: 36, textAlign: 'center' }}>#</th>
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
                {filteredActive.map((m, idx) => {
                  const tariff = tariffs.find((t) => Number(t.id) === Number(m.tariff_id));
                  const memberComboIds = Array.isArray(m.combo_tariff_ids) && m.combo_tariff_ids.length
                    ? m.combo_tariff_ids
                    : (m.combination_tariff_id ? [m.combination_tariff_id] : []);
                  const combos = memberComboIds
                    .map((id) => comboTariffs.find((t) => Number(t.id) === Number(id)))
                    .filter(Boolean);
                  const manualPts = Number(m.manual_extra_points) || 0;
                  const role = ROLES.find((r) => r.value === (m.field_role || m.role_in_field)) || { label: m.field_role || '—' };
                  const points = m.tariff_points != null
                    ? Number(m.tariff_points)
                    : (tariff?.points || 0) + combos.reduce((s, c) => s + (Number(c.points) || 0), 0) + manualPts;
                  const rate = (Number(tariff?.rate_per_shift) || 0)
                    + combos.reduce((s, c) => s + (Number(c.rate_per_shift) || 0), 0)
                    + manualPts * (Number(tariff?.point_value) || 500);
                  const comboLabel = [
                    ...combos.map((c) => c.position_name || c.name),
                    manualPts > 0 ? `+${manualPts}б` : null
                  ].filter(Boolean).join(', ') || '—';
                  const isEditing = editingMemberId === m.employee_id;
                  const memberRole = m.field_role || m.role_in_field || 'worker';
                  let roleTariffs = filterTariffsForFieldRole(categoryTariffs, memberRole, category);
                  if (m.tariff_id && !roleTariffs.some((t) => Number(t.id) === Number(m.tariff_id))) {
                    const cur = tariffs.find((t) => Number(t.id) === Number(m.tariff_id));
                    if (cur) roleTariffs = [cur, ...roleTariffs];
                  }

                  // Inline-редактор ниже строки
                  if (isEditing) {
                    return (
                      <tr key={`${m.id || m.employee_id}-edit`} className="ft-crew-edit-row">
                        <td colSpan={12}>
                          <TariffEditor
                            member={m}
                            tariffs={roleTariffs}
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
                      <td className="ft-crew-num" style={{ textAlign: 'center', color: 'var(--t3)' }}>{idx + 1}</td>
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
                      <td className="ft-crew-num">{comboLabel}</td>
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
        tariffs={categoryTariffs}
        comboTariffs={comboTariffs}
        category={category}
        onReturned={() => reload()}
        onTariffSaved={() => reload()}
      />
    </div>
  );
}
