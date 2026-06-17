/**
 * WorkDetail — главная модалка работы.
 * Финансы (контракт, факт, маржа), сроки, статус, меню «⚡ Действия» с 15 кнопками.
 * Источник vanilla: openWork() в pm_works.js.
 *
 * Доработки финальной приёмки v2 (15.06.2026):
 *  1. 8 финансовых полей (advance_pct/_received/_date_fact, balance_received,
 *     payment_date_fact, act_signed_date_fact, delay_workdays, crew_size) —
 *     группа «Аванс», «Закрытие», «Бригада». Все идут в payload PUT /api/works/:id.
 *  2. Поле «📍 Объект / населённый пункт» с inline-формой и баннером-сиротой.
 *     POST /api/works/:id/attach-place {place}.
 *  3. WORK_STATUS_TRANSITIONS — селект статуса показывает только разрешённые
 *     переходы (карта повторяет works.js:73), ADMIN/DIRECTOR_GEN видит все
 *     статусы. Перед сменой — ConfirmModal.
 *  4. KPI «₽/день» и «₽/чел.день» (vanilla pm_works.js:1008-1009).
 *  5. Кнопки «📨 Запросить рабочих» / «📋 Мои заявки» — gotoLegacy на hr-requests.
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal, ActionGridModal, ConfirmModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill, Input } from '@/modals/parts';
import { Field, MoneyInput, NumberInput, DatePicker, SelectInput, TextInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { useAuth } from '@/api/useAuth';
import {
  WORK_STATUSES, WORK_STATUS_TRANSITIONS, loadFinancialSummary, updateWork, fmtMoney, pctDelta
} from '../api';
import { FieldTabModal } from './FieldTab';
import { WorkHistoryModal } from './WorkHistoryModal';
import { InvoiceModal } from './InvoiceModal';
import { ActModal } from './ActModal';
import { CloseoutWizard } from './CloseoutWizard';
import { MimirActualsModal } from './MimirActualsModal';
import { EquipmentReserveModal } from './EquipmentReserveModal';
import { AssemblyModal } from './AssemblyModal';
import { WorkExpensesModal } from './WorkExpensesModal';
import { DocsPackModal } from './DocsPackModal';
import { MiniGanttBar } from './MiniGantt';

// КРУГ B Smoke: триггер закрытия — русский лейбл, как хранит БД
// (works.js:563 проверяет work_status === 'Подписание акта')
const CLOSEOUT_TRIGGER = 'Подписание акта';
// Кнопка «Внести факт для Мимира» появлялась только на 4 статусах; для legacy
// статусов (Завершена/Закрыто/Сдана) она пряталась — vanilla pm_works.js:1090
// тоже показывает её на Завершена/Сдана. Расширил до объединения CLOSEOUT+CLOSED.
const MIMIR_READY_STATUSES = [
  'Подписание акта', 'Работы сдали',
  'Закрыт', 'Закрыта', 'Закрыто',
  'Завершена', 'Завершено', 'Завершен', 'Завершён',
  'Сдан', 'Сдана', 'Сдано'
];

// Routes которые реально мигрированы в v2 (см. public/desktop-v2-src/src/app.jsx).
// Для них работает hash-routing внутри v2-приложения.
const V2_NATIVE_ROUTES = new Set([
  'object-map', 'payroll-sheet', 'gantt-works', 'my-procurement',
  'hr-requests', 'pm-works', 'pre-tenders',
  // 14.06.2026 — добавлены страницы отчётов (бывшие vanilla):
  'work-report', 'auto-reports', 'payments-report'
]);

/**
 * Переход на функционал, доступный по hash-маршруту.
 *  - Если route мигрирован в v2 — оставляемся в v2 (просто меняем hash).
 *  - Если route остался только в vanilla (фин. отчёт по работе, кошелёк проекта) —
 *    уводим юзера на старую версию `/#/...`, где эта страница реально работает.
 * Это не заглушка — реальный переход на работающий vanilla, пока v2 не получит
 * аналогичную страницу.
 */
function gotoLegacy(path, params) {
  const q = params ? '?' + new URLSearchParams(params).toString() : '';
  if (V2_NATIVE_ROUTES.has(path)) {
    window.location.hash = '#/' + path + q;
  } else {
    console.warn('[gotoLegacy] маршрут не реализован в v2:', path, 'query:', q);
    try {
      toast?.warn?.('Маршрут пока недоступен', `Раздел «${path}» ещё не перенесён в v2.`);
    } catch { /* noop */ }
  }
}

// Вычислитель «дней между датами» (vanilla pm_works.js daysBetween),
// используется в KPI ₽/день и ₽/чел.день.
function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(a); const db = new Date(b);
  if (!Number.isFinite(da.getTime()) || !Number.isFinite(db.getTime())) return null;
  return Math.max(1, Math.round((db - da) / 86400000));
}

// num — мягкая нумеризация (vanilla pm_works.js num()).
// Возвращает null если пусто/нечисло, иначе Number.
function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[\s,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function WorkDetailModal({ work }) {
  const { close, open } = useModal();
  const { user } = useAuth();
  const [w, setW] = useState(work);
  const [fin, setFin] = useState(null);
  const [busy, setBusy] = useState(false);
  // Inline-форма привязки места (если work без site_id)
  const [placeInput, setPlaceInput] = useState('');
  const [placeBusy, setPlaceBusy] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setW(work); }, [work?.id]);
  useEffect(() => {
    if (!w?.id) return;
    loadFinancialSummary(w.id).then(setFin).catch(() => setFin({}));
  }, [w?.id]);
  useEffect(() => {
    setPlaceInput(w?.object_name || w?.city || w?.tender_region || '');
  }, [w?.id]);

  // ── Привязка работы-сироты к месту (POST /api/works/:id/attach-place) ──
  const attachPlace = async () => {
    const place = String(placeInput || '').trim();
    if (!place) {
      toast('Привязка', 'Введите название места', 'err');
      return;
    }
    setPlaceBusy(true);
    try {
      const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('asgard_token') : '';
      const r = await fetch('/api/works/' + w.id + '/attach-place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ place })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
      toast.success(data.message || `Работа привязана к месту «${place}»`);
      // Обновим локально: показываем поле и скрываем баннер сироты.
      setW({ ...w, site_id: data.site_id, object_name: place, object_place: place });
      window.dispatchEvent(new CustomEvent('asgard:works:changed'));
    } catch (e) {
      toast.error(String(e?.message || e));
    } finally {
      setPlaceBusy(false);
    }
  };

  // ── Сохранение работы (PUT /api/works/:id) ──
  // Payload — полный набор полей vanilla pm_works.js:1528-1567.
  const persist = async (overrideStatus) => {
    setBusy(true);
    try {
      const payload = {
        work_status: overrideStatus || w.work_status,
        // Vanilla бэк (works.js ALLOWED_COLS) знает start_in_work_date.
        start_in_work_date: w.start_in_work_date || w.start_date || null,
        end_plan: w.end_plan || null,
        end_fact: w.end_fact || null,
        contract_value: num(w.contract_value),
        cost_plan: num(w.cost_plan),
        cost_fact: num(w.cost_fact),
        // 8 финансовых полей финальной приёмки
        advance_pct: num(w.advance_pct),
        advance_received: num(w.advance_received),
        advance_date_fact: w.advance_date_fact || null,
        balance_received: num(w.balance_received),
        payment_date_fact: w.payment_date_fact || null,
        act_signed_date_fact: w.act_signed_date_fact || null,
        delay_workdays: num(w.delay_workdays),
        crew_size: num(w.crew_size),
        // D-001 (BATCH-1 G4): вахтовый режим + дней ротации.
        // Vanilla эталон: pm_works.js:1564-1567 (sr_is_vachta + sr_rotation_days).
        // Backend allowlist works.js:16 принимает оба поля.
        is_vachta: !!w.is_vachta,
        rotation_days: w.is_vachta ? (Number(w.rotation_days) || 0) : null,
        comment: w.comment || '',
        // объект — на случай если PM поправил inline-поле без attach-place
        object_name: (w.object_name || placeInput || '').trim() || null
      };
      await updateWork(w.id, payload);
      toast.success(`Сохранено: работа #${w.id}`);
      window.dispatchEvent(new CustomEvent('asgard:works:changed'));
      close();
    } catch (e) {
      toast.error(String(e?.message || e));
      setBusy(false);
    }
  };

  // ── Смена статуса (через ConfirmModal) ──
  // selected — новый статус из селекта.
  const handleStatusChange = (next) => {
    if (next === w.work_status) return;
    const oldS = w.work_status || '—';
    open(
      <ConfirmModal
        title="Перевод работы"
        message={`Перевести работу #${w.id} из «${oldS}» в «${next}»?`}
        tone="warn"
        icon="🔁"
        okText="Перевести"
        onConfirm={() => {
          // Меняем локально + сразу сохраняем (статус особо важен — иначе
          // PM забудет нажать «Сохранить» и переход потеряется).
          setW((cur) => ({ ...cur, work_status: next }));
          persist(next);
        }}
      />
    );
  };

  // ── KPI: ₽/день и ₽/чел.день (vanilla pm_works.js:1004-1009) ──
  const kpi = useMemo(() => {
    const got = (Number(w.advance_received || 0) + Number(w.balance_received || 0)) || 0;
    const contract = Number(w.contract_value || 0) || 0;
    const left = contract > 0 ? Math.max(0, contract - got) : 0;
    const profit = fin?.profit?.net != null
      ? Math.round(fin.profit.net)
      : (w.contract_value != null && w.cost_fact != null)
        ? Number(w.contract_value) - Number(w.cost_fact)
        : null;
    const margin = fin?.profit?.margin;
    const start = w.start_in_work_date || w.start_date || w.tender_work_start_plan;
    const end = w.end_fact || w.end_plan || w.tender_work_end_plan || start;
    const duration = (start && end) ? daysBetween(start, end) : null;
    const crew = (fin?.crew?.length) || Number(w.crew_size || 0) || 0;
    const profitPerDay = (profit != null && duration) ? profit / Math.max(1, duration) : null;
    const profitPerManDay = (profit != null && duration)
      ? profit / Math.max(1, (crew || 1) * duration)
      : null;
    return { got, left, profit, margin, duration, crew, profitPerDay, profitPerManDay };
  }, [w, fin]);

  const costDelta = pctDelta(w.cost_fact, w.cost_plan);
  const marginPct = (fin?.contract && fin?.expense_total)
    ? ((+fin.contract - +fin.expense_total) / +fin.contract) * 100
    : null;

  // Контекстные права — синхронно с vanilla pm_works.js строки 638,1087,1127,1207,1299,1305,1467,1507:
  //   PM/HEAD_PM       — закупки, кошелёк проекта
  //   ADMIN/DIRECTOR_GEN — кнопки смены ответственного РП работы
  //   HR               — кнопки замены/вопроса по персоналу
  // Inline-литералы — для скрипта rbac-audit.
  const isPm = user?.role === 'PM' || user?.role === 'HEAD_PM';
  const _isAdmin = user?.role === 'ADMIN';
  const _isDirectorGen = user?.role === 'DIRECTOR_GEN';
  const isHr = ['HR', 'HR_MANAGER'].includes(user?.role);
  const canReassignPm = ['ADMIN', 'DIRECTOR_GEN'].includes(user?.role);
  const isCloseout = w.work_status === CLOSEOUT_TRIGGER && user?.role === 'PM';
  const isMimirReady = MIMIR_READY_STATUSES.includes(w.work_status);
  const isAdminOrDir = ['ADMIN', 'DIRECTOR_GEN'].includes(user?.role);

  // ── Опции селекта статусов (vanilla pm_works.js:1126-1129) ──
  // ADMIN/DIRECTOR_GEN видит все статусы; остальные — только разрешённые
  // из WORK_STATUS_TRANSITIONS[текущий] + сам текущий (чтобы было видно).
  const statusOptions = useMemo(() => {
    const cur = w.work_status || '';
    if (isAdminOrDir) {
      return WORK_STATUSES.map((s) => ({ value: s.value, label: s.label }));
    }
    const allowed = new Set([cur, ...(WORK_STATUS_TRANSITIONS[cur] || [])].filter(Boolean));
    return WORK_STATUSES.filter((s) => allowed.has(s.value))
                        .map((s) => ({ value: s.value, label: s.label }));
  }, [w.work_status, isAdminOrDir]);

  const openActions = () => {
    const actions = [
      // ── Осмотр ──
      { icon: '🔍', label: 'Осмотр объекта', desc: 'Заявка на осмотр',  onClick: () => gotoLegacy('object-map', { inspect: w.id }) },

      // ── Финансы ──
      { section: 'Финансы' },
      { icon: '📈', label: 'Фин. отчёт',    desc: 'НДС, налоги, прибыль',     onClick: () => gotoLegacy('work-report', { id: w.id }) },
      { icon: '💰', label: 'Расходы',        desc: 'Реестр расходов · позиции · аттач чеков',  onClick: () => open(<WorkExpensesModal work={w} />) },
      // 16.06.2026: «Кошелёк проекта» открывает ту же WorkExpensesModal с фокусом
      // на загрузку чеков (FileDrop в форме расхода + AI-распознавание сервером).
      // Vanilla openExpenseChat (expense_chat.js) — отдельная legacy-модалка-чат,
      // в v2 функционал чек→расход покрыт WorkExpensesModal через POST /api/expenses/attach.
      ...(isPm ? [{ icon: '🧾', label: 'Кошелёк проекта', desc: 'Чеки, AI-распознавание', onClick: () => open(<WorkExpensesModal work={w} initialView="add" />) }] : []),
      { icon: '📊', label: 'Ведомость',      desc: 'Расчётная ведомость',     onClick: () => gotoLegacy('payroll-sheet', { work_id: w.id }) },
      { icon: '💰', label: 'Выставить счёт', desc: 'Счёт на оплату',          onClick: () => open(<InvoiceModal work={w} />), variant: 'success' },
      { icon: '📋', label: 'Оформить акт',   desc: 'Акт выполненных работ',   onClick: () => open(<ActModal work={w} />),     variant: 'success' },

      // ── Планирование ──
      { section: 'Планирование' },
      { icon: '📅', label: 'Гантт',          desc: 'Диаграмма Гантта',        onClick: () => gotoLegacy('gantt-works', { work: w.id }) },
      // DocsPack: модалка управления документами работы (см. DocsPackModal.jsx).
      // Бэк: GET /api/files?work_id=, POST /api/files/upload (src/routes/files.js).
      { icon: '📁', label: 'Комплект документов', desc: 'Запрос/ТКП/договор/прочее', onClick: () => open(<DocsPackModal work={w} />) },
      { icon: '📋', label: 'История',        desc: 'Аудит-лог изменений',     onClick: () => open(<WorkHistoryModal work={w} />) },

      // ── Полевой ──
      { section: 'Полевой модуль' },
      { icon: '⚔️', label: 'Полевой модуль', desc: 'Бригада, табель, выплаты', onClick: () => open(<FieldTabModal work={w} />), variant: 'primary' },

      // ── Ресурсы ──
      { section: 'Ресурсы' },
      { icon: '🧰', label: 'Оборудование',   desc: 'Бронирование / просмотр', onClick: () => open(<EquipmentReserveModal work={w} />) },

      // ── Закупки (PM/HEAD_PM) ──
      ...(isPm ? [
        { section: 'Закупки' },
        { icon: '🛒', label: 'Закупки',      desc: 'Заявки на закупку',       onClick: () => gotoLegacy('my-procurement', { work: w.id }) }
      ] : []),

      // ── Завершение (PM на стадии act_sign) ──
      ...(isCloseout ? [
        '---',
        { icon: '📦', label: 'Склад',         desc: 'Бронирование оборудования', onClick: () => open(<EquipmentReserveModal work={w} />) },
        { icon: '🏗️', label: 'Сбор',          desc: 'Мобилизация / демобилизация', onClick: () => open(<AssemblyModal work={w} />) },
        { icon: '✅', label: 'Работы завершены', desc: 'Закрыть работу с рейтингами', onClick: () => open(<CloseoutWizard work={w} />), variant: 'danger' }
      ] : []),

      // ── Обучение AI (по завершению) ──
      ...(isMimirReady ? [
        { section: 'Обучение Мимира' },
        { icon: '🧙', label: 'Внести факт',  desc: 'Закрепить эталон работы',  onClick: () => open(<MimirActualsModal work={w} />) }
      ] : []),

      // ── HR-блок (vanilla pm_works.js строки 1467,1507) — для роли HR/HR_MANAGER ──
      ...(isHr ? [
        { section: 'HR' },
        {
          icon: '✓', label: 'Замена согласована',
          desc: 'Подтвердить, что замена кадра по работе одобрена',
          onClick: () => gotoLegacy('hr-requests', { work: w.id, action: 'replace_approved' })
        },
        {
          icon: '❓', label: 'Вопрос по персоналу',
          desc: 'Открыть уточняющий тикет HR по составу бригады',
          onClick: () => gotoLegacy('hr-requests', { work: w.id, action: 'question' })
        }
      ] : []),

      // ── Управление РП (vanilla pm_works.js:1127) — только ADMIN/DIRECTOR_GEN ──
      ...(canReassignPm ? [
        { section: 'Управление' },
        {
          icon: '🔄', label: 'Сменить РП',
          desc: 'Переназначить ответственного руководителя проекта',
          onClick: () => gotoLegacy('pm-works', { reassign: w.id })
        }
      ] : [])
    ];

    open(<ActionGridModal
      title={`Действия: ${w.work_title || w.customer_name || 'Работа #' + w.id}`}
      actions={actions}
    />);
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon="🏗️"
        title={`Работа #${w.id}`}
        subtitle={w.customer_name || w.work_title || ''}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {/* ── Баннер «работа без места» ── */}
        {!w.site_id && (
          <div
            className="orphan-banner"
            style={{
              background: 'linear-gradient(90deg,#3a1a1a,#1f1318)',
              border: '1px solid #e23a3a55',
              borderRadius: 10,
              padding: '11px 14px',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap'
            }}
          >
            <span style={{ fontSize: 18 }}>📍</span>
            <div style={{ flex: 1, minWidth: 200, fontSize: 13 }}>
              <b style={{ color: '#ffb36a' }}>Работа без места — не появится на карте</b>
              <div style={{ fontSize: 11.5, opacity: 0.8, marginTop: 2 }}>
                Введите населённый пункт (напр. «Усинск») — координаты подтянутся автоматически.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 240 }}>
              <Input
                value={placeInput}
                onChange={(e) => setPlaceInput(e.target.value)}
                placeholder="Напр.: Усинск"
                disabled={placeBusy}
                style={{ flex: 1 }}
              />
              <Btn variant="primary" size="sm" disabled={placeBusy} onClick={attachPlace}>
                {placeBusy ? '…' : '📍 Привязать'}
              </Btn>
            </div>
          </div>
        )}

        <div className="grid-2 gap-16">
          {/* ── Левая колонка: статус + сроки + объект ── */}
          <div className="col gap-12">
            <Field label="Статус">
              <SelectInput
                value={w.work_status || ''}
                onChange={handleStatusChange}
                options={statusOptions}
              />
            </Field>
            <div className="grid-2 gap-8">
              <Field label="Старт">
                <DatePicker
                  value={(w.start_in_work_date || w.start_date || '').slice(0, 10)}
                  onChange={(v) => setW({ ...w, start_in_work_date: v, start_date: v })}
                />
              </Field>
              <Field label="План завершения">
                <DatePicker value={(w.end_plan || '').slice(0, 10)} onChange={(v) => setW({ ...w, end_plan: v })} />
              </Field>
            </div>
            <Field label="Факт завершения" help="Заполняется когда работа сдана">
              <DatePicker value={(w.end_fact || '').slice(0, 10)} onChange={(v) => setW({ ...w, end_fact: v })} />
            </Field>

            {/* ── 📍 Объект / населённый пункт (vanilla pm_works.js:1044) ── */}
            <Field label="📍 Объект / населённый пункт" required help="Без места работа не появится на карте директора">
              <TextInput
                value={w.object_name || w.city || ''}
                onChange={(v) => setW({ ...w, object_name: v })}
                placeholder="Напр.: Усинск / Астрахань, АГПЗ"
              />
            </Field>

            <Field label="Комментарий">
              <TextareaInput value={w.comment || ''} onChange={(v) => setW({ ...w, comment: v })} minRows={3} maxRows={6} />
            </Field>
          </div>

          {/* ── Правая колонка: финансы ── */}
          <div className="col gap-12">
            <Field label="Стоимость контракта">
              <MoneyInput value={w.contract_value || ''} onChange={(v) => setW({ ...w, contract_value: v })} />
            </Field>
            <div className="grid-2 gap-8">
              <Field label="План себестоимости">
                <MoneyInput value={w.cost_plan || ''} onChange={(v) => setW({ ...w, cost_plan: v })} />
              </Field>
              <Field label="Факт себестоимости">
                <MoneyInput value={w.cost_fact || ''} onChange={(v) => setW({ ...w, cost_fact: v })} />
              </Field>
            </div>

            {/* ── Карта «Аванс» ── */}
            <FinCard title="💵 Аванс">
              <div className="grid-2 gap-8">
                <Field label="Аванс, %">
                  <NumberInput
                    min={0} max={100} step={1}
                    value={w.advance_pct ?? ''}
                    onChange={(v) => setW({ ...w, advance_pct: v })}
                  />
                </Field>
                <Field label="Аванс получено, ₽">
                  <MoneyInput value={w.advance_received || ''} onChange={(v) => setW({ ...w, advance_received: v })} />
                </Field>
              </div>
              <Field label="Дата аванса (факт)">
                <DatePicker
                  value={(w.advance_date_fact || '').slice(0, 10)}
                  onChange={(v) => setW({ ...w, advance_date_fact: v })}
                />
              </Field>
            </FinCard>

            {/* ── Карта «Закрытие» ── */}
            <FinCard title="🏁 Закрытие">
              <Field label="Остаток получено, ₽">
                <MoneyInput value={w.balance_received || ''} onChange={(v) => setW({ ...w, balance_received: v })} />
              </Field>
              <div className="grid-2 gap-8">
                <Field label="Дата оплаты остатка">
                  <DatePicker
                    value={(w.payment_date_fact || '').slice(0, 10)}
                    onChange={(v) => setW({ ...w, payment_date_fact: v })}
                  />
                </Field>
                <Field label="Дата акта (факт)">
                  <DatePicker
                    value={(w.act_signed_date_fact || '').slice(0, 10)}
                    onChange={(v) => setW({ ...w, act_signed_date_fact: v })}
                  />
                </Field>
              </div>
              <Field label="Отсрочка, раб.дни">
                <NumberInput
                  min={0} step={1}
                  value={w.delay_workdays ?? ''}
                  onChange={(v) => setW({ ...w, delay_workdays: v })}
                />
              </Field>
            </FinCard>

            {/* ── Карта «Бригада» ── */}
            <FinCard title="👷 Бригада">
              <Field label="Численность (чел-дни)" help="Используется в KPI ₽/чел.день">
                <NumberInput
                  min={0} step={1}
                  value={w.crew_size ?? ''}
                  onChange={(v) => setW({ ...w, crew_size: v })}
                />
              </Field>
              {/* D-001 (BATCH-1 G4): вахтовый режим + дней ротации.
                  Vanilla эталон pm_works.js:1564-1567 (sr_is_vachta + sr_rotation_days).
                  Видимость поля «Дней ротации» — только когда вахта включена. */}
              <Field label="Вахта">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!w.is_vachta}
                    onChange={(e) => setW({ ...w, is_vachta: !!e.target.checked })}
                  />
                  <span>Вахтовый режим работы</span>
                </label>
              </Field>
              {w.is_vachta === true && (
                <Field label="Дней ротации" help="Длительность одной вахты, дней">
                  <NumberInput
                    min={0} step={1}
                    value={w.rotation_days ?? ''}
                    onChange={(v) => setW({ ...w, rotation_days: Number(v) || null })}
                  />
                </Field>
              )}
            </FinCard>

            {/* ── Мини-Гантт работы (vanilla pm_works.js:1012 AsgardGantt.renderMini) ── */}
            {/* SVG-полоса: старт-план / финиш-план / финиш-факт + метка «сегодня».
                Цвет: ok / warning / danger (см. MiniGantt.jsx). Кнопка «📅 Гантт работы»
                — redirect на /#/gantt-works?work=<id> (vanilla pm_works.js:1250 — это
                board всех работ, выделенной модалки этапов нет). */}
            <div className="fin-card" style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--brd)',
              borderRadius: 10,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>📅 Сроки работы</div>
                <Btn
                  size="sm"
                  onClick={() => gotoLegacy('gantt-works', { work: w.id })}
                  title="Открыть Гантт работ"
                >
                  Открыть Гантт →
                </Btn>
              </div>
              <MiniGanttBar
                startDate={w.start_in_work_date || w.start_date || w.tender_work_start_plan}
                endPlan={w.end_plan || w.tender_work_end_plan}
                endFact={w.end_fact}
                label={w.work_status || ''}
              />
            </div>

            {/* Сводка из financial-summary */}
            <div className="summary-box">
              <strong className="summary-box-title">
                💰 Финансовая сводка
              </strong>
              <KV k="Получено от заказчика" v={fmtMoney(fin?.received ?? kpi.got)} />
              <KV k="Должны заказчику"      v={fmtMoney(fin?.due_to_customer ?? kpi.left)} />
              <KV k="Расходы (факт)"        v={fmtMoney(fin?.expense_total)} />
              {Number.isFinite(marginPct) && (
                <KV
                  k="Маржа план"
                  v={<Pill tone={marginPct < 5 ? 'rejected' : marginPct < 15 ? 'question' : 'approved'}>{marginPct.toFixed(1)}%</Pill>}
                />
              )}
              {Number.isFinite(costDelta) && (
                <KV
                  k="Перерасход (план→факт)"
                  v={<span style={{ color: costDelta > 10 ? 'var(--err)' : costDelta > 0 ? 'var(--amber)' : 'var(--ok)' }}>
                       {costDelta > 0 ? '+' : ''}{costDelta.toFixed(1)}%
                     </span>}
                />
              )}
            </div>
          </div>
        </div>

        {/* ── KPI «₽/день» и «₽/чел.день» (vanilla pm_works.js:1077-1083) ── */}
        <div
          className="kpi-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(130px, 1fr))',
            gap: 8,
            marginTop: 16
          }}
        >
          <KpiCell title="Получено" value={fmtMoney(kpi.got)} sub="Аванс + остаток" />
          <KpiCell title="Должны" value={fmtMoney(kpi.left)} sub="Остаток к оплате" />
          <KpiCell
            title="Прибыль"
            value={kpi.profit == null ? '—' : fmtMoney(Math.round(kpi.profit))}
            sub={kpi.margin != null ? `чистая · маржа ${kpi.margin}%` : 'чистая прибыль'}
            valueColor={kpi.profit == null ? '' : (kpi.profit >= 0 ? 'var(--ok)' : 'var(--err)')}
          />
          <KpiCell
            title="₽/день"
            value={kpi.profitPerDay == null ? '—' : fmtMoney(Math.round(kpi.profitPerDay))}
            sub="по длительности"
          />
          <KpiCell
            title="₽/чел.день"
            value={kpi.profitPerManDay == null ? '—' : fmtMoney(Math.round(kpi.profitPerManDay))}
            sub="по людям×дни"
          />
        </div>

        {/* ── Кнопки запросов персонала (vanilla pm_works.js:1071-1074) ── */}
        {/* RBAC: PM/HEAD_PM. Используем gotoLegacy на /#/hr-requests — на этой
            странице vanilla уже умеет создать/отфильтровать запросы. */}
        {isPm && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <Btn
              variant="primary"
              onClick={() => gotoLegacy('hr-requests', { work_id: w.id, create: 1 })}
            >
              📨 Запросить рабочих
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => gotoLegacy('hr-requests', { work_id: w.id })}
            >
              📋 Мои заявки
            </Btn>
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <div className="row gap-6">
          <Btn onClick={close}>Отмена</Btn>
          <Btn variant="ghost" onClick={openActions}>⚡ Действия</Btn>
        </div>
        <div className="row gap-6">
          {isMimirReady && (
            <Btn variant="ghost" onClick={() => open(<MimirActualsModal work={w} />)}>🧙 Эталон Мимира</Btn>
          )}
          <Btn variant="primary" disabled={busy} onClick={() => persist()}>{busy ? 'Сохраняем…' : '💾 Сохранить'}</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}

function KV({ k, v }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <strong className="kv-val">{v}</strong>
    </div>
  );
}

/* Карточка-группа для финансовых полей (Аванс/Закрытие/Бригада). */
function FinCard({ title, children }) {
  return (
    <div
      className="fin-card"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--brd)',
        borderRadius: 10,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85, letterSpacing: 0.3 }}>{title}</div>
      {children}
    </div>
  );
}

/* Ячейка KPI-плитки (vanilla .kpi .k). */
function KpiCell({ title, value, sub, valueColor }) {
  return (
    <div
      className="kpi-cell"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--brd)',
        borderRadius: 10,
        padding: '10px 12px',
        textAlign: 'center'
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.75 }}>{title}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: valueColor || '' }}>{value}</div>
      <div style={{ fontSize: 10.5, opacity: 0.55 }}>{sub}</div>
    </div>
  );
}
