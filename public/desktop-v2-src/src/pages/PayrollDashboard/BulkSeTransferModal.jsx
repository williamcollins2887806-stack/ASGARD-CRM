/**
 * BulkSeTransferModal — массовая выплата СЗ (раздел 5A в API_SPEC_BULK_SE.md).
 *
 * Один экран на 4 логических блока (НЕ Wizard — скроллящаяся форма):
 *   1) Период (year/month наследуются от PayrollDashboardPage, отображаются readonly)
 *   2) Выбор СЗ — чекбоксы (bulk-select 15-20 СЗ)
 *   3) Настройка — inline-editable таблица для отмеченных:
 *        Тип | Перевод ₽ | Заработал ₽ | Остаток | Куда остаток | Работа
 *      • earned_amount autofill через getSummary(year, month) → ищется по employee_id
 *      • при destination='pm' валидируется наличие pm_id у выбранной работы
 *   4) Preview снизу — сводка (кол-во, Σ transfer, Σ earned, Σ остаток РП, Σ остаток Касса)
 *
 * Submit → createSeTransfersBulk → если response.errors[]: подсветить строки + остаться в модалке.
 * При полном успехе — закрыть + toast.
 *
 * Источник истины поведения: AgreementTransferModal.jsx (single agreement_transfer) + спека.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Pill } from '@/modals/parts';
import { MoneyInput, SelectInput, TextareaInput, Checkbox, TextInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import {
  getSelfEmployedLimits, getSummary, createSeTransfersBulk,
  fmtMoney, fmtPeriod
} from './api';

const TYPE_OPTIONS_BULK = [
  { value: 'work_transfer',      label: 'За работу (salary)' },
  { value: 'agreement_transfer', label: 'По договорённости (pure)' }
];

const DEST_OPTIONS = [
  { value: 'pm',      label: '🤝 РП (handover)' },
  { value: 'company', label: '🏦 Касса Асгарда' }
];

const DEFAULT_MONTHLY = 350000;

/** Загрузка работ (для select «Работа» в строке). Возвращает [{id, work_title, pm_id, pm_name}]. */
function loadWorksForBulk() {
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || d || [])
    .catch(() => []);
}

export function BulkSeTransferModal({ year, month, onDone }) {
  const { close } = useModal();

  // справочники
  const [seList, setSeList] = useState([]);            // [{employee_id, fio, transferred_year, yearly_limit, remaining}]
  const [monthlyLimit, setMonthlyLimit] = useState(DEFAULT_MONTHLY);
  const [yearlyLimit, setYearlyLimit] = useState(2400000);
  const [works, setWorks] = useState([]);              // [{id, work_title, pm_id, pm_name}]
  const [summaryItems, setSummaryItems] = useState([]); // raw summary.items для autofill earned

  const [loadingRefs, setLoadingRefs] = useState(true);
  const [busy, setBusy] = useState(false);

  // фильтр поиска по списку СЗ
  const [q, setQ] = useState('');

  // map по employee_id для удобства лукапа
  const seById = useMemo(() => {
    const m = new Map();
    seList.forEach((s) => m.set(Number(s.employee_id), s));
    return m;
  }, [seList]);

  // Состояние выбора + per-row настройки.
  // rows: Map<employee_id, {operation_type, transfer_amount, earned_amount, earned_autofilled, remainder_destination, work_id, comment, error?}>
  const [rows, setRows] = useState(() => new Map());

  // ─── 1. Загрузка справочников ───
  useEffect(() => {
    let cancelled = false;
    setLoadingRefs(true);
    Promise.allSettled([
      getSelfEmployedLimits(),
      loadWorksForBulk(),
      getSummary(year, month).catch(() => null)
    ]).then(([limRes, wRes, sRes]) => {
      if (cancelled) return;
      if (limRes.status === 'fulfilled') {
        const d = limRes.value || {};
        const arr = d.employees || d.limits || [];
        const normalized = arr.map((w) => ({
          employee_id: Number(w.employee_id ?? w.id),
          fio: w.fio || w.name || '—',
          transferred_year: Number(w.transferred_year ?? w.yearly_transferred ?? 0),
          yearly_limit: Number(w.yearly_limit ?? d.yearly_limit ?? 2400000),
          remaining: Number(
            w.remaining ?? ((w.yearly_limit ?? d.yearly_limit ?? 2400000) - (w.transferred_year ?? w.yearly_transferred ?? 0))
          )
        })).filter((w) => Number.isFinite(w.employee_id) && w.employee_id > 0);
        setSeList(normalized);
        if (d.monthly_limit) setMonthlyLimit(Number(d.monthly_limit));
        if (d.yearly_limit) setYearlyLimit(Number(d.yearly_limit));
      } else {
        toast.error('Не удалось загрузить лимиты СЗ');
      }
      if (wRes.status === 'fulfilled') {
        const arr = (wRes.value || []).map((w) => ({
          id: Number(w.id),
          work_title: w.work_title || w.work_name || `Работа #${w.id}`,
          pm_id: w.pm_id || w.responsible_pm_id || null,
          pm_name: w.pm_name || null
        })).filter((w) => Number.isFinite(w.id));
        setWorks(arr);
      }
      // summary может быть null (404) — это ок, autofill даст 0 с пометкой
      if (sRes.status === 'fulfilled' && sRes.value) {
        const items = sRes.value.items || sRes.value.transfers || sRes.value.employees || [];
        setSummaryItems(Array.isArray(items) ? items : []);
      } else {
        setSummaryItems([]);
      }
    }).finally(() => { if (!cancelled) setLoadingRefs(false); });
    return () => { cancelled = true; };
  }, [year, month]);

  // ─── Helpers ───

  /** Поиск earned для (employee_id [, work_id]) в summary. */
  const lookupEarned = useCallback((empId, workId) => {
    if (!summaryItems.length) return { value: 0, found: false };
    const empMatch = summaryItems.filter((i) => Number(i.employee_id ?? i.id) === Number(empId));
    if (!empMatch.length) return { value: 0, found: false };
    let pick = empMatch[0];
    if (workId) {
      const wm = empMatch.find((i) => Number(i.work_id) === Number(workId));
      if (wm) pick = wm;
    }
    const v = Number(pick.earned ?? pick.earned_amount ?? 0);
    return { value: Number.isFinite(v) ? v : 0, found: true };
  }, [summaryItems]);

  /** Создание дефолтной строки для нового выбранного СЗ. */
  const makeDefaultRow = useCallback((empId) => {
    const se = seById.get(Number(empId));
    const remaining = se ? Number(se.remaining || 0) : Number(monthlyLimit);
    // По умолчанию transfer = min(monthly, remaining); 0 если remaining<=0 (UI покажет ошибку)
    const transfer = Math.max(0, Math.min(Number(monthlyLimit), remaining || 0));
    return {
      operation_type: 'work_transfer',
      transfer_amount: String(transfer),
      earned_amount: '0',
      earned_autofilled: false,    // флаг: нашли в summary?
      remainder_destination: 'pm',
      work_id: '',
      comment: '',
      error: null
    };
  }, [seById, monthlyLimit]);

  /** Toggle СЗ в наборе. При добавлении — autofill earned (если summary знает). */
  const toggleEmployee = useCallback((empId, on) => {
    setRows((prev) => {
      const next = new Map(prev);
      if (!on) {
        next.delete(Number(empId));
        return next;
      }
      const def = makeDefaultRow(empId);
      // earned autofill — без работы (общая сумма заработанного за месяц)
      const f = lookupEarned(empId, null);
      def.earned_amount = String(Math.round(f.value || 0));
      def.earned_autofilled = f.found;
      next.set(Number(empId), def);
      return next;
    });
  }, [makeDefaultRow, lookupEarned]);

  const setRow = useCallback((empId, patch) => {
    setRows((prev) => {
      const next = new Map(prev);
      const cur = next.get(Number(empId));
      if (!cur) return prev;
      next.set(Number(empId), { ...cur, ...patch, error: null });
      return next;
    });
  }, []);

  // При смене work_id — переавтофилл earned (если включён work-mode и не правили вручную)
  const onChangeWork = useCallback((empId, workIdStr) => {
    setRows((prev) => {
      const next = new Map(prev);
      const cur = next.get(Number(empId));
      if (!cur) return prev;
      const workIdNum = workIdStr ? Number(workIdStr) : null;
      let earnedPatch = {};
      if (cur.operation_type === 'work_transfer') {
        // Не затираем правки юзера — обновляем только если значение совпадает с autofilled.
        const f = lookupEarned(empId, workIdNum);
        if (f.found) {
          earnedPatch = { earned_amount: String(Math.round(f.value || 0)), earned_autofilled: true };
        }
      }
      next.set(Number(empId), { ...cur, work_id: workIdStr, error: null, ...earnedPatch });
      return next;
    });
  }, [lookupEarned]);

  // При смене operation_type — earned обнуляется для agreement_transfer
  const onChangeType = useCallback((empId, type) => {
    setRows((prev) => {
      const next = new Map(prev);
      const cur = next.get(Number(empId));
      if (!cur) return prev;
      const patch = { operation_type: type, error: null };
      if (type === 'agreement_transfer') {
        patch.earned_amount = '0';
        patch.earned_autofilled = false;
        patch.work_id = '';
      }
      next.set(Number(empId), { ...cur, ...patch });
      return next;
    });
  }, []);

  // ─── Список для отображения (поиск по ФИО) ───
  const visibleSe = useMemo(() => {
    if (!q.trim()) return seList;
    const needle = q.trim().toLowerCase();
    return seList.filter((s) => (s.fio || '').toLowerCase().includes(needle));
  }, [seList, q]);

  // bulk-select helpers
  const selectedCount = rows.size;
  const allVisibleChecked = visibleSe.length > 0 && visibleSe.every((s) => rows.has(s.employee_id));
  const someVisibleChecked = visibleSe.some((s) => rows.has(s.employee_id));

  const toggleAllVisible = useCallback(() => {
    setRows((prev) => {
      const next = new Map(prev);
      if (allVisibleChecked) {
        visibleSe.forEach((s) => next.delete(s.employee_id));
      } else {
        visibleSe.forEach((s) => {
          if (!next.has(s.employee_id)) {
            const def = makeDefaultRow(s.employee_id);
            const f = lookupEarned(s.employee_id, null);
            def.earned_amount = String(Math.round(f.value || 0));
            def.earned_autofilled = f.found;
            next.set(s.employee_id, def);
          }
        });
      }
      return next;
    });
  }, [allVisibleChecked, visibleSe, makeDefaultRow, lookupEarned]);

  // ─── Preview-метрики ───
  const preview = useMemo(() => {
    let count = 0;
    let sumTransfer = 0;
    let sumEarned = 0;
    let sumRemPm = 0;
    let sumRemCompany = 0;
    let invalidRows = 0;

    rows.forEach((r) => {
      count++;
      const t = Number(r.transfer_amount) || 0;
      const e = Number(r.earned_amount) || 0;
      sumTransfer += t;
      sumEarned += e;
      const remainder = Math.max(0, t - e);
      if (r.remainder_destination === 'pm') sumRemPm += remainder;
      else sumRemCompany += remainder;
      if (t <= 0) invalidRows++;
    });
    return { count, sumTransfer, sumEarned, sumRemPm, sumRemCompany, invalidRows };
  }, [rows]);

  // ─── Валидация перед submit ───
  /**
   * Возвращает { ok: bool, errors: Map<empId, msg> }.
   * Не падает на первой ошибке — собирает все, чтобы UI подсветил все плохие строки.
   */
  const validate = useCallback(() => {
    const errs = new Map();
    if (rows.size === 0) {
      return { ok: false, errors: errs, global: 'Выберите хотя бы одного СЗ' };
    }
    if (rows.size > 100) {
      return { ok: false, errors: errs, global: 'Не более 100 переводов за один раз' };
    }
    rows.forEach((r, empId) => {
      const t = Number(r.transfer_amount);
      const e = Number(r.earned_amount);
      const se = seById.get(empId);
      if (!Number.isFinite(t) || t <= 0) {
        errs.set(empId, 'Сумма перевода > 0'); return;
      }
      if (r.operation_type === 'work_transfer') {
        if (!Number.isFinite(e) || e <= 0) {
          errs.set(empId, 'За работу: укажите «Заработал» > 0'); return;
        }
      } else if (r.operation_type === 'agreement_transfer') {
        if (Number(r.earned_amount) !== 0) {
          errs.set(empId, 'По договорённости: earned = 0'); return;
        }
      }
      // Лимиты: transfer + transferred_year не должны превышать yearly_limit
      if (se && Number.isFinite(se.transferred_year) && Number.isFinite(se.yearly_limit)) {
        if (t + se.transferred_year > se.yearly_limit) {
          errs.set(empId, `Превышен годовой лимит: остаток ${fmtMoney(se.remaining)}`); return;
        }
      }
      // destination=pm требует work с pm_id
      if (r.remainder_destination === 'pm') {
        const remainder = Math.max(0, t - e);
        if (remainder > 0) {
          // нужен work_id с pm_id (РП существует)
          if (!r.work_id) {
            errs.set(empId, 'Для остатка → РП выберите работу с назначенным РП'); return;
          }
          const w = works.find((x) => x.id === Number(r.work_id));
          if (!w || !w.pm_id) {
            errs.set(empId, 'У выбранной работы нет РП — выберите другую или «→ Касса»'); return;
          }
        }
      }
    });
    return { ok: errs.size === 0, errors: errs };
  }, [rows, seById, works]);

  const onSubmit = async () => {
    const v = validate();
    if (!v.ok) {
      if (v.global) { toast.warn(v.global); return; }
      // подсветить строки + общий toast
      setRows((prev) => {
        const next = new Map(prev);
        v.errors.forEach((msg, empId) => {
          const cur = next.get(empId);
          if (cur) next.set(empId, { ...cur, error: msg });
        });
        return next;
      });
      toast.warn(`Исправьте ошибки в ${v.errors.size} строк${v.errors.size === 1 ? 'е' : 'ах'}`);
      return;
    }

    // Сборка payload
    const transfers = [];
    rows.forEach((r, empId) => {
      transfers.push({
        employee_id: Number(empId),
        work_id: r.work_id ? Number(r.work_id) : null,
        operation_type: r.operation_type,
        transfer_amount: Number(r.transfer_amount),
        earned_amount: Number(r.earned_amount || 0),
        remainder_destination: r.remainder_destination,
        comment: (r.comment || '').trim() || undefined
      });
    });

    setBusy(true);
    try {
      const res = await createSeTransfersBulk({ year, month, transfers });
      const errors = Array.isArray(res?.errors) ? res.errors : [];
      const successCount = Array.isArray(res?.transfers) ? res.transfers.length : Math.max(0, transfers.length - errors.length);

      if (errors.length > 0) {
        // Подсветить плохие строки по index → empId
        setRows((prev) => {
          const next = new Map(prev);
          errors.forEach((e) => {
            const idx = Number(e.index);
            const original = transfers[idx];
            if (original) {
              const cur = next.get(original.employee_id);
              if (cur) next.set(original.employee_id, { ...cur, error: e.error || 'Ошибка' });
            } else if (e.employee_id) {
              const cur = next.get(Number(e.employee_id));
              if (cur) next.set(Number(e.employee_id), { ...cur, error: e.error || 'Ошибка' });
            }
          });
          // Удалить успешные строки (response.transfers содержит созданные)
          if (Array.isArray(res?.transfers)) {
            const failedEmpIds = new Set(errors.map((e) => {
              const idx = Number(e.index);
              return transfers[idx]?.employee_id ?? Number(e.employee_id);
            }).filter(Boolean));
            // Удаляем те, кого нет в failed и кто был отправлен
            transfers.forEach((t) => {
              if (!failedEmpIds.has(t.employee_id)) next.delete(t.employee_id);
            });
          }
          return next;
        });
        if (successCount > 0) toast.warn(`Создано: ${successCount}. Ошибок: ${errors.length}`);
        else toast.error(`Не создано ни одной операции (${errors.length} ошибок)`);
        onDone?.();
        return;
      }

      // Полный успех
      const s = res?.summary || {};
      const parts = [];
      if (s.se_transfers != null) parts.push(`${s.se_transfers} переводов`);
      if (s.handovers != null && s.handovers > 0) parts.push(`${s.handovers} handover`);
      if (s.cash_log_income != null && s.cash_log_income > 0) parts.push(`${s.cash_log_income} → касса`);
      toast.success('Готово: ' + (parts.join(' · ') || `${transfers.length} переводов`));
      onDone?.();
      close();
    } catch (err) {
      const data = err?.data;
      // Возможно бэк вернул валидационную ошибку с errors[]
      if (data && Array.isArray(data.errors)) {
        setRows((prev) => {
          const next = new Map(prev);
          data.errors.forEach((e) => {
            const idx = Number(e.index);
            const empId = transfers[idx]?.employee_id ?? Number(e.employee_id);
            if (empId) {
              const cur = next.get(empId);
              if (cur) next.set(empId, { ...cur, error: e.error || 'Ошибка' });
            }
          });
          return next;
        });
        toast.warn(`Ошибок: ${data.errors.length}`);
      } else {
        toast.error(err?.serverMsg || err?.message || 'Не удалось выполнить массовую выплату');
      }
    } finally {
      setBusy(false);
    }
  };

  // ─── Список опций для select «Работа» ───
  const workOptsAll = useMemo(() => [
    { value: '', label: '— Работа (нужна для остатка → РП) —' },
    ...works.map((w) => ({
      value: String(w.id),
      label: `${w.work_title} ${w.pm_name ? '· РП ' + w.pm_name : '· без РП'}`
    }))
  ], [works]);

  // ─── Render ───
  return (
    <MCard className="modal-lg bulkse-modal">
      <MHead
        icon="🚀"
        title="Массовая выплата СЗ"
        subtitle={`Период: ${fmtPeriod(year, month)} · ${seList.length} самозанятых в реестре`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {loadingRefs ? (
          <div className="bulkse-loading">⏳ Загружаем реестр СЗ, работы и сводку…</div>
        ) : (
          <>
            {/* Блок 1: контекст лимитов */}
            <div className="bulkse-context-row">
              <Pill tone="info">Месячный лимит: {fmtMoney(monthlyLimit)}</Pill>
              <Pill tone="info">Годовой лимит: {fmtMoney(yearlyLimit)}</Pill>
              {summaryItems.length === 0 && (
                <Pill tone="warn">Сводка за период недоступна — earned автозаполнен 0</Pill>
              )}
            </div>

            {/* Блок 2: Выбор СЗ */}
            <div className="bulkse-section">
              <div className="bulkse-section-head">
                <h4 className="bulkse-section-h">1. Выбор самозанятых</h4>
                <div className="bulkse-section-meta">
                  Выбрано: <b>{selectedCount}</b> из {seList.length}
                </div>
              </div>
              <div className="bulkse-pickers-row">
                <div className="bulkse-search">
                  <TextInput
                    icon="🔎"
                    value={q}
                    onChange={setQ}
                    placeholder="Поиск по ФИО…"
                    clearable
                  />
                </div>
                <Checkbox
                  checked={allVisibleChecked}
                  indeterminate={!allVisibleChecked && someVisibleChecked}
                  onChange={toggleAllVisible}
                  label={allVisibleChecked ? 'Снять видимых' : 'Выбрать видимых'}
                />
              </div>

              <div className="bulkse-pickers-grid">
                {visibleSe.length === 0 ? (
                  <div className="bulkse-empty">Никто не найден по запросу</div>
                ) : (
                  visibleSe.map((s) => {
                    const checked = rows.has(s.employee_id);
                    const noRoom = s.remaining <= 0;
                    return (
                      <label
                        key={s.employee_id}
                        className={'bulkse-picker' + (checked ? ' checked' : '') + (noRoom ? ' noroom' : '')}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={noRoom && !checked}
                          onChange={(e) => toggleEmployee(s.employee_id, e.target.checked)}
                        />
                        <div className="bulkse-picker-body">
                          <div className="bulkse-picker-fio">{s.fio}</div>
                          <div className={'bulkse-picker-meta' + (noRoom ? ' err' : '')}>
                            {noRoom ? '⚠ Лимит исчерпан' : `Остаток ${fmtMoney(s.remaining)}`}
                          </div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Блок 3: Inline-editable таблица настройки */}
            {selectedCount > 0 && (
              <div className="bulkse-section">
                <div className="bulkse-section-head">
                  <h4 className="bulkse-section-h">2. Настройка переводов</h4>
                  <div className="bulkse-section-meta">
                    Изменение «Работы» при типе «За работу» переавтозаполнит «Заработал».
                  </div>
                </div>

                <div className="bulkse-table-wrap">
                  <table className="bulkse-table">
                    <thead>
                      <tr>
                        <th className="bulkse-th-fio">ФИО</th>
                        <th className="bulkse-th">Тип</th>
                        <th className="bulkse-th bulkse-th-r">Перевод ₽</th>
                        <th className="bulkse-th bulkse-th-r">Заработал ₽</th>
                        <th className="bulkse-th bulkse-th-r">Остаток</th>
                        <th className="bulkse-th">Куда остаток</th>
                        <th className="bulkse-th">Работа</th>
                        <th className="bulkse-th bulkse-th-act"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...rows.entries()].map(([empId, r]) => {
                        const se = seById.get(empId);
                        const tNum = Number(r.transfer_amount) || 0;
                        const eNum = Number(r.earned_amount) || 0;
                        const remainder = Math.max(0, tNum - eNum);
                        const isSalary = r.operation_type === 'work_transfer';
                        const hasErr = !!r.error;
                        // help-текст под earned: показываем источник
                        const earnedHelp = isSalary
                          ? (r.earned_autofilled
                              ? '✓ из сводки field_checkins'
                              : 'не определено (правьте вручную)')
                          : '0 — по договорённости';
                        return (
                          <tr key={empId} className={'bulkse-row' + (hasErr ? ' err' : '')}>
                            <td className="bulkse-td bulkse-td-fio">
                              <div className="bulkse-row-fio">{se?.fio || `СЗ #${empId}`}</div>
                              <div className="bulkse-row-sub">
                                Остаток года: {fmtMoney(se?.remaining)}
                              </div>
                            </td>
                            <td className="bulkse-td">
                              <SelectInput
                                value={r.operation_type}
                                onChange={(v) => onChangeType(empId, v)}
                                options={TYPE_OPTIONS_BULK}
                                placeholder="Тип"
                              />
                            </td>
                            <td className="bulkse-td bulkse-td-money">
                              <MoneyInput
                                value={r.transfer_amount}
                                onChange={(v) => setRow(empId, { transfer_amount: v })}
                              />
                            </td>
                            <td className="bulkse-td bulkse-td-money">
                              {isSalary ? (
                                <>
                                  <MoneyInput
                                    value={r.earned_amount}
                                    onChange={(v) => setRow(empId, { earned_amount: v, earned_autofilled: false })}
                                  />
                                  <div className={'bulkse-cell-hint' + (r.earned_autofilled ? '' : ' warn')}>
                                    {earnedHelp}
                                  </div>
                                </>
                              ) : (
                                <div className="bulkse-cell-readonly">0 ₽</div>
                              )}
                            </td>
                            <td className="bulkse-td bulkse-td-money">
                              <div className={'bulkse-cell-readonly ' + (remainder > 0 ? 'gold' : 'muted')}>
                                {fmtMoney(remainder)}
                              </div>
                            </td>
                            <td className="bulkse-td">
                              <SelectInput
                                value={r.remainder_destination}
                                onChange={(v) => setRow(empId, { remainder_destination: v })}
                                options={DEST_OPTIONS}
                                placeholder="Куда"
                              />
                            </td>
                            <td className="bulkse-td bulkse-td-work">
                              <SelectInput
                                value={r.work_id}
                                onChange={(v) => onChangeWork(empId, v)}
                                options={workOptsAll}
                                placeholder="— Работа —"
                              />
                            </td>
                            <td className="bulkse-td bulkse-td-act">
                              <button
                                type="button"
                                className="bulkse-del"
                                onClick={() => toggleEmployee(empId, false)}
                                title="Убрать из массовой выплаты"
                                aria-label="Убрать"
                              >×</button>
                            </td>
                            {hasErr && (
                              <td className="bulkse-row-err-cell" colSpan={8}>
                                ⚠ {r.error}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Универсальный комментарий — необязательное поле под таблицей */}
                <div className="bulkse-bulk-comment">
                  <Field label="Общий комментарий (применится к каждой пустой строке)">
                    <TextareaInput
                      value={[...rows.values()][0]?.comment || ''}
                      onChange={(v) => {
                        setRows((prev) => {
                          const next = new Map(prev);
                          next.forEach((r, k) => {
                            // Перетираем только пустые/совпадающие комментарии — чтобы не затереть индивидуальные
                            if (!r.comment || r.comment === [...prev.values()][0]?.comment) {
                              next.set(k, { ...r, comment: v });
                            }
                          });
                          return next;
                        });
                      }}
                      minRows={2}
                      maxRows={3}
                      placeholder="Например: «Расчёт за июль КАО Азот»"
                    />
                  </Field>
                </div>
              </div>
            )}

            {/* Блок 4: Preview */}
            <div className="bulkse-preview">
              <div className="bulkse-preview-head">Превью</div>
              <div className="bulkse-preview-grid">
                <PreviewMetric label="Создаём переводов" value={preview.count} tone={preview.count ? 'info' : 'muted'} />
                <PreviewMetric label="Σ transfer" value={fmtMoney(preview.sumTransfer)} tone="info" />
                <PreviewMetric label="Σ earned" value={fmtMoney(preview.sumEarned)} tone="muted" />
                <PreviewMetric label="Σ остаток → РП" value={fmtMoney(preview.sumRemPm)} tone="gold" />
                <PreviewMetric label="Σ остаток → Касса" value={fmtMoney(preview.sumRemCompany)} tone="amber" />
              </div>
              {preview.invalidRows > 0 && (
                <div className="bulkse-preview-warn">
                  ⚠ Строк с нулевым переводом: {preview.invalidRows} — заполните до отправки.
                </div>
              )}
            </div>
          </>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn
          variant="primary"
          onClick={onSubmit}
          disabled={busy || loadingRefs || preview.count === 0}
        >
          {busy ? 'Отправка…' : `🚀 Создать ${preview.count} переводов`}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function PreviewMetric({ label, value, tone = 'muted' }) {
  const toneClass = 'bulkse-metric-' + tone;
  return (
    <div className={'bulkse-metric ' + toneClass}>
      <div className="bulkse-metric-label">{label}</div>
      <div className="bulkse-metric-value">{value}</div>
    </div>
  );
}

export default BulkSeTransferModal;
