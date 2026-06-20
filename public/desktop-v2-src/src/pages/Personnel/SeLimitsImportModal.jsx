/**
 * Модалка «📥 Импорт остатков СЗ» — 3 шага.
 *
 * Шаг 1: выбор файла (.xlsx, Озон-Банк).
 * Шаг 2: предпросмотр + редактирование решений по каждой строке
 *        (обновить / создать СЗ / создать получателя + привязать / пропустить).
 * Шаг 3: применение (POST /api/staff/se-limits/apply) с прогресс-индикатором.
 *
 * Backend (см. src/routes/staff.js FIN_ROLES_ARRAY):
 *   POST /api/staff/se-limits/preview (multipart `file`) → { file_name, total_rows, matched, not_matched,
 *                                                            monthly_limit, year, month, rows[] }
 *   POST /api/staff/se-limits/apply   (JSON {year,month,rows:[{action,...}]}) → { updated, created, errors[] }
 *   GET  /api/staff/se-limits/last-import → { last_import_at, last_import_by_fio }
 *
 * RBAC (FIN_ROLES): ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, BUH.
 *
 * Источник истины — vanilla `personnel.js openSeImportModal()`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { postMultipart } from '@/api/upload';
import { api } from '@/api/client';
import { loadReadiness } from './api';

const MONTHLY_LIMIT_DEFAULT = 350_000;

function fmtMoney(n) {
  if (n == null || !isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}

function actionLabel(act) {
  switch (act) {
    case 'update':       return 'обновить';
    case 'create_se':    return 'создать СЗ';
    case 'create_payee': return 'создать получателя + привязать';
    case 'skip':         return 'пропустить';
    default:             return act || '—';
  }
}

// Постельные тона строк по действию.
function rowBgStyle(checked, action) {
  if (!checked) return { background: '#F5F5F5' };
  if (action === 'update') return { background: '#E8F5E9' };       // мягкий зелёный
  if (action === 'create_se' || action === 'create_payee') return { background: '#FFF8E1' }; // мягкий золотой
  return { background: '#F5F5F5' };
}

/** Главный компонент модалки. */
export function SeLimitsImportModal({ onApplied }) {
  const { close } = useModal();
  const [step, setStep] = useState(1);         // 1 → 2 → 3
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null); // backend /preview response
  const [decisions, setDecisions] = useState([]); // user decisions per row
  const [employees, setEmployees] = useState([]); // для autocomplete привязки
  const fileInputRef = useRef(null);

  // Подгружаем рабочих один раз — нужны для autocomplete «привязать к рабочему» (create_payee).
  useEffect(() => {
    loadReadiness().then(({ employees }) => {
      // только НЕ-СЗ рабочие — получатель обычно привязан к рабочему,
      // который сам выплат не получает (выплаты идут на родственника).
      const elig = (employees || []).filter((e) => !e.is_self_employed);
      setEmployees(elig);
    }).catch(() => { /* silent */ });
  }, []);

  /* ─── Шаг 1 → preview ─── */
  const onPickFile = (e) => {
    const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    setFile(f);
    setErr('');
  };

  const goToPreview = async () => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await postMultipart('/api/staff/se-limits/preview', fd);
      if (!data || !Array.isArray(data.rows)) {
        throw new Error('Бэкенд вернул некорректный ответ');
      }
      // Подготовим начальные решения.
      const ds = data.rows.map((r) => {
        if (r.matched) {
          return {
            row_idx: r.row_idx,
            checked: true,
            action: 'update',
            employee_id: r.employee_id,
            employee_fio: r.employee_fio,
            fio: null,
            phone: null,
            remaining: r.remaining_in_file,
            linked_to_employee_id: null,
            linked_to_employee_fio: '',
            _src: r,
          };
        }
        const sug = r.suggested_action === 'create_new' ? 'create_se' : 'skip';
        return {
          row_idx: r.row_idx,
          checked: sug !== 'skip',
          action: sug,
          employee_id: null,
          employee_fio: null,
          fio: r.fio_raw || '',
          phone: r.phone_raw || '',
          remaining: r.remaining_in_file,
          linked_to_employee_id: null,
          linked_to_employee_fio: '',
          _src: r,
        };
      });
      setPreview(data);
      setDecisions(ds);
      setStep(2);
    } catch (e) {
      setErr(e?.message || 'Не удалось загрузить файл');
    } finally {
      setBusy(false);
    }
  };

  /* ─── Шаг 2: правки решений ─── */
  const updateDec = (idx, patch) => {
    setDecisions((arr) => arr.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const matchedDec = useMemo(() => decisions.filter((d) => d._src && d._src.matched), [decisions]);
  const newDec     = useMemo(() => decisions.filter((d) => d._src && !d._src.matched), [decisions]);

  const checkedSummary = useMemo(() => {
    let upd = 0, ne = 0, pay = 0, skip = 0;
    for (const d of decisions) {
      if (!d.checked || d.action === 'skip') { skip++; continue; }
      if (d.action === 'update')       upd++;
      else if (d.action === 'create_se')    ne++;
      else if (d.action === 'create_payee') pay++;
    }
    return { upd, ne, pay, skip };
  }, [decisions]);

  /* ─── Шаг 3: применить ─── */
  const applyDecisions = async () => {
    const rows = decisions
      .filter((d) => d.checked && d.action !== 'skip')
      .map((d) => {
        const out = { action: d.action };
        if (d.action === 'update') {
          out.employee_id = d.employee_id;
          out.remaining = d.remaining;
        } else if (d.action === 'create_se' || d.action === 'create_payee') {
          out.fio = (d.fio || '').trim();
          if (d.phone) out.phone = (d.phone || '').trim() || null;
          if (d.remaining != null) out.remaining = d.remaining;
          if (d.action === 'create_payee' && d.linked_to_employee_id) {
            out.linked_to_employee_id = Number(d.linked_to_employee_id);
          }
        }
        return out;
      });
    if (!rows.length) {
      toast.warn('Все строки помечены «пропустить». Включите хотя бы одну.');
      return;
    }
    setBusy(true);
    setStep(3);
    try {
      const result = await api('/api/staff/se-limits/apply', {
        method: 'POST',
        body: { year: preview.year, month: preview.month, rows },
        timeout: 60000,
        silent: true,
      });
      const errCount = (result.errors || []).length;
      const okMsg = `Обновлено: ${result.updated || 0}, создано: ${result.created || 0}`;
      if (errCount === 0) {
        toast.success(okMsg);
        // Дёргаем обновление списка персонала + закрываем модалку.
        window.dispatchEvent(new CustomEvent('asgard:personnel:changed'));
        onApplied?.(result);
        close();
      } else {
        // Покажем сводку с ошибками в той же модалке.
        setBusy(false);
        setPreview((p) => ({ ...p, _applyResult: result }));
      }
    } catch (e) {
      setBusy(false);
      setErr(e?.message || 'Не удалось применить');
      setStep(2);
      toast.error('Ошибка применения: ' + (e?.message || ''));
    }
  };

  /* ─── Рендер ─── */
  return (
    <MCard className="modal-wide">
      <MHead
        icon="📥"
        title="Импорт остатков СЗ из Excel"
        subtitle={step === 1
          ? 'Шаг 1 из 3 — выбор файла Озон-Банка'
          : step === 2
            ? `Шаг 2 из 3 — предпросмотр (${preview?.total_rows || 0} ${preview?.total_rows === 1 ? 'строка' : 'строк'})`
            : 'Шаг 3 из 3 — применение'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {step === 1 && (
          <Step1
            file={file}
            err={err}
            busy={busy}
            onPick={onPickFile}
            inputRef={fileInputRef}
          />
        )}
        {step === 2 && preview && (
          <Step2
            preview={preview}
            matchedDec={matchedDec}
            newDec={newDec}
            decisions={decisions}
            employees={employees}
            updateDec={updateDec}
          />
        )}
        {step === 3 && (
          <Step3
            busy={busy}
            applyResult={preview?._applyResult}
          />
        )}
      </MBody>
      <MFoot>
        {step === 1 && (
          <>
            <Btn onClick={close}>Отмена</Btn>
            <Btn variant="primary" disabled={!file || busy} onClick={goToPreview}>
              {busy ? 'Загружаем…' : 'Далее: предпросмотр →'}
            </Btn>
          </>
        )}
        {step === 2 && !preview?._applyResult && (
          <>
            <Btn onClick={() => { setStep(1); setPreview(null); setDecisions([]); }}>◄ Назад</Btn>
            <div className="grow" />
            <Btn onClick={close}>Отмена</Btn>
            <Btn variant="primary" disabled={busy} onClick={applyDecisions}>
              Применить → ({checkedSummary.upd + checkedSummary.ne + checkedSummary.pay})
            </Btn>
          </>
        )}
        {step === 3 && preview?._applyResult && (
          <Btn variant="primary" onClick={() => { onApplied?.(preview._applyResult); close(); }}>
            Закрыть
          </Btn>
        )}
      </MFoot>
    </MCard>
  );
}

/* ─── Шаг 1: выбор файла ─── */
function Step1({ file, err, busy, onPick, inputRef }) {
  return (
    <div className="col gap-14">
      <div className="fs-13 c-t2" style={{ lineHeight: 1.55 }}>
        Загрузите файл выгрузки из <b>Озон-Банка</b> (формат <code>.xlsx</code>,
        3 колонки: Телефон, ФИО, Оставшийся лимит).
      </div>

      <div className="row gap-10" style={{ alignItems: 'center' }}>
        <label className="m-btn primary" style={{ cursor: 'pointer', display: 'inline-block' }}>
          📁 Выбрать файл
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={onPick}
            disabled={busy}
          />
        </label>
        <span className="fs-13 c-t3">
          {file ? file.name : 'Файл не выбран'}
        </span>
      </div>

      {err && (
        <div className="fs-12" style={{ color: 'var(--err)' }}>{err}</div>
      )}

      <div
        className="fs-12 c-t2"
        style={{
          padding: '10px 12px',
          background: 'var(--bg-2, var(--bar-bg))',
          borderRadius: 'var(--r-md)',
          lineHeight: 1.55,
          marginTop: 6,
        }}
      >
        Текущий месячный лимит системы: <b>{fmtMoney(MONTHLY_LIMIT_DEFAULT)}</b>.<br />
        Если у СЗ остаток <b>&gt; {fmtMoney(MONTHLY_LIMIT_DEFAULT)}</b> — будет включён
        {' '}<code>can_exceed_limit</code> (банковский потолок выше).
      </div>
    </div>
  );
}

/* ─── Шаг 2: предпросмотр + правка решений ─── */
function Step2({ preview, matchedDec, newDec, decisions, employees, updateDec }) {
  const limit = preview.monthly_limit || MONTHLY_LIMIT_DEFAULT;
  return (
    <div className="col gap-12">
      {/* Сводка */}
      <div
        className="row gap-14"
        style={{
          flexWrap: 'wrap',
          alignItems: 'baseline',
          paddingBottom: 10,
          borderBottom: '1px solid var(--brd-2)',
          fontSize: 13,
          color: 'var(--t-2)',
        }}
      >
        <div>Файл: <b>{preview.file_name || '—'}</b></div>
        <div>Найдено в БД: <b>{preview.matched}</b></div>
        <div>Новые: <b>{preview.not_matched}</b></div>
        <div>Всего: <b>{preview.total_rows}</b></div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--t-3)' }}>
          Лимит: {fmtMoney(limit)} · период: {preview.month}/{preview.year}
        </div>
      </div>

      <div style={{ maxHeight: '58vh', overflow: 'auto', paddingRight: 4 }}>
        {matchedDec.length > 0 && (
          <>
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'var(--t-3)',
                fontWeight: 800,
              }}
            >
              ✅ Найдены в БД ({matchedDec.length})
            </div>
            <SeMatchedTable
              rows={matchedDec}
              decisions={decisions}
              updateDec={updateDec}
              limit={limit}
            />
          </>
        )}

        {newDec.length > 0 && (
          <>
            <div
              style={{
                marginTop: 18,
                fontSize: 11,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'var(--t-3)',
                fontWeight: 800,
              }}
            >
              ➕ Не найдены в БД ({newDec.length})
            </div>
            <SeNewTable
              rows={newDec}
              decisions={decisions}
              updateDec={updateDec}
              employees={employees}
              limit={limit}
            />
          </>
        )}

        {!matchedDec.length && !newDec.length && (
          <div className="t-center c-t3" style={{ padding: 24 }}>
            Файл не содержит строк для обработки
          </div>
        )}
      </div>
    </div>
  );
}

/* Таблица «найдены» (matched=true). */
function SeMatchedTable({ rows, decisions, updateDec, limit }) {
  return (
    <table className="prs-table" style={{ marginTop: 6 }}>
      <thead>
        <tr>
          <th style={{ width: 34, textAlign: 'center' }}>✓</th>
          <th style={{ width: 160 }}>Действие</th>
          <th>ФИО</th>
          <th>Было → Стало</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const idx = decisions.indexOf(d);
          const r = d._src;
          const wasCurrent = r.current_monthly_remaining;
          const will = r.remaining_in_file;
          const wasFmt = wasCurrent == null ? '∞' : fmtMoney(wasCurrent);
          const willFmt = will == null ? '—' : fmtMoney(will);
          const exceed = will != null && will > limit;
          const bigDiff = wasCurrent != null && will != null &&
            (Math.abs(will - wasCurrent) >= 100000 ||
             (wasCurrent > 0 && Math.abs(will - wasCurrent) / wasCurrent > 0.5));
          return (
            <tr key={idx} style={rowBgStyle(d.checked, d.action)}>
              <td style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={d.checked}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    updateDec(idx, {
                      checked,
                      action: !checked ? 'skip' : (d.action === 'skip' ? 'update' : d.action),
                    });
                  }}
                  aria-label={`Применить для ${r.employee_fio}`}
                />
              </td>
              <td>
                <SelectInput
                  value={d.action}
                  onChange={(v) => updateDec(idx, { action: v, checked: v !== 'skip' })}
                  options={[
                    { value: 'update', label: 'обновить' },
                    { value: 'skip',   label: 'пропустить' },
                  ]}
                />
              </td>
              <td>
                <div className="prs-fio">{r.employee_fio || '—'}</div>
                {r.is_se_payee && (
                  <div style={{ fontSize: 10, color: 'var(--info)', fontWeight: 700 }}>получатель</div>
                )}
              </td>
              <td>
                <span style={{ fontWeight: bigDiff ? 700 : 400 }}>{wasFmt}</span>
                <span style={{ color: 'var(--t-3)', margin: '0 6px' }}>→</span>
                <span style={{ fontWeight: bigDiff ? 700 : 400, color: bigDiff ? 'var(--t-1)' : 'var(--t-2)' }}>
                  {willFmt}
                </span>
                {exceed && (
                  <div style={{ fontSize: 11, color: '#BF360C', marginTop: 2 }}>
                    can_exceed_limit включится
                  </div>
                )}
                {bigDiff && (
                  <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 2 }}>
                    ⚠ Большая разница
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* Таблица «не найдены» (matched=false). */
function SeNewTable({ rows, decisions, updateDec, employees, limit }) {
  return (
    <table className="prs-table" style={{ marginTop: 6 }}>
      <thead>
        <tr>
          <th style={{ width: 34, textAlign: 'center' }}>✓</th>
          <th style={{ width: 220 }}>Действие</th>
          <th>ФИО / Телефон</th>
          <th style={{ width: 180 }}>Остаток</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const idx = decisions.indexOf(d);
          const exceed = d.remaining != null && d.remaining > limit;
          return (
            <tr key={idx} style={rowBgStyle(d.checked, d.action)}>
              <td style={{ textAlign: 'center', verticalAlign: 'top', paddingTop: 12 }}>
                <input
                  type="checkbox"
                  checked={d.checked}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    updateDec(idx, {
                      checked,
                      action: !checked ? 'skip' : (d.action === 'skip' ? 'create_se' : d.action),
                    });
                  }}
                />
              </td>
              <td style={{ verticalAlign: 'top' }}>
                <SelectInput
                  value={d.action}
                  onChange={(v) => updateDec(idx, { action: v, checked: v !== 'skip' })}
                  options={[
                    { value: 'create_se',    label: 'создать СЗ' },
                    { value: 'create_payee', label: 'создать получателя + привязать' },
                    { value: 'skip',         label: 'пропустить' },
                  ]}
                />
                {d.action === 'create_payee' && (
                  <PayeeLinkPicker
                    decision={d}
                    employees={employees}
                    onPick={(emp) => updateDec(idx, {
                      linked_to_employee_id: emp ? emp.id : null,
                      linked_to_employee_fio: emp ? emp.fio : '',
                    })}
                  />
                )}
              </td>
              <td style={{ verticalAlign: 'top' }}>
                <TextInput
                  value={d.fio || ''}
                  onChange={(v) => updateDec(idx, { fio: v })}
                  placeholder="ФИО"
                />
                <div style={{ marginTop: 4 }}>
                  <TextInput
                    value={d.phone || ''}
                    onChange={(v) => updateDec(idx, { phone: v })}
                    placeholder="Телефон"
                  />
                </div>
              </td>
              <td style={{ verticalAlign: 'top' }}>
                <div style={{ fontSize: 13, color: 'var(--t-2)' }}>
                  {d.remaining == null ? '—' : fmtMoney(d.remaining)}
                </div>
                {exceed && (
                  <div style={{ fontSize: 11, color: '#BF360C', marginTop: 2 }}>
                    can_exceed_limit включится
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* Inline-picker для «привязать к рабочему» (поиск по списку НЕ-СЗ employees). */
function PayeeLinkPicker({ decision, employees, onPick }) {
  const [q, setQ] = useState(decision.linked_to_employee_fio || '');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const lq = q.trim().toLowerCase();
    if (!lq || lq.length < 2) return [];
    return employees
      .filter((e) => (e.fio || '').toLowerCase().includes(lq) ||
                     (e.phone || '').toLowerCase().includes(lq))
      .slice(0, 8);
  }, [q, employees]);

  return (
    <div style={{ marginTop: 6 }}>
      <div className="fs-12 c-t3">└ Привязать к рабочему:</div>
      <TextInput
        value={q}
        onChange={(v) => { setQ(v); setOpen(true); if (!v) onPick(null); }}
        placeholder="Введите ФИО рабочего…"
      />
      {decision.linked_to_employee_id && (
        <div style={{ fontSize: 11, color: 'var(--ok)', marginTop: 2 }}>
          ✓ Привязано к id={decision.linked_to_employee_id}
        </div>
      )}
      {open && filtered.length > 0 && (
        <div
          style={{
            marginTop: 4,
            border: '1px solid var(--brd-2)',
            borderRadius: 'var(--r-sm)',
            background: 'var(--inner-bg)',
            maxHeight: 160,
            overflow: 'auto',
          }}
        >
          {filtered.map((emp) => (
            <button
              key={emp.id}
              type="button"
              className="row gap-8"
              onClick={() => {
                onPick(emp);
                setQ(emp.fio);
                setOpen(false);
              }}
              style={{
                width: '100%',
                padding: '6px 10px',
                fontSize: 12,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ flex: 1, color: 'var(--t-1)' }}>{emp.fio}</span>
              <span style={{ color: 'var(--t-3)' }}>{emp.phone || ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Шаг 3: применение / результат ─── */
function Step3({ busy, applyResult }) {
  if (busy) {
    return (
      <div className="col gap-12 t-center" style={{ padding: 36 }}>
        <div style={{ fontSize: 32 }} aria-hidden="true">⏳</div>
        <div className="fs-14">Применяем изменения…</div>
        <div className="fs-12 c-t3">Не закрывайте окно</div>
      </div>
    );
  }
  if (applyResult) {
    const errCount = (applyResult.errors || []).length;
    return (
      <div className="col gap-12">
        <div className="fs-14" style={{ color: 'var(--ok)' }}>
          Обновлено: <b>{applyResult.updated || 0}</b>, создано: <b>{applyResult.created || 0}</b>
        </div>
        {errCount > 0 && (
          <>
            <div className="fs-13" style={{ color: 'var(--err)' }}>
              Ошибки ({errCount}):
            </div>
            <div
              style={{
                maxHeight: 280,
                overflow: 'auto',
                padding: 10,
                background: 'var(--bg-2, var(--bar-bg))',
                borderRadius: 'var(--r-sm)',
                fontSize: 12,
                color: 'var(--t-2)',
              }}
            >
              {applyResult.errors.map((e, i) => (
                <div key={i} style={{ padding: '3px 0' }}>
                  • row #{e.idx}: {e.error}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }
  return <div className="t-center c-t3" style={{ padding: 30 }}>Готово</div>;
}
