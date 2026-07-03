/**
 * Выигранные тендеры без созданной работы — назначить РП и создать работу.
 * Vanilla: tenders.js → renderWinAssignPanel.
 *
 * Расширения:
 *   • При выборе РП — детект пересечений по датам с другими его работами
 *     (start_plan..end_plan). Показываем «у этого РП уже есть работа Х в эти даты».
 *   • Кнопка «⚠ Запросить override» — отправляет уведомление директорам
 *     (POST /api/notifications/notify-role). Назначение всё равно выполняется
 *     (бэк решит), но в notify-role логе для аудита остаётся причина.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/api/client';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, SelectInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  loadWinPending, loadUsers, loadWorksForPm, requestAssignOverride
} from '../api';

/* Утилита пересечения двух интервалов [a..b] / [c..d] (закрытых).
   Если у работы нет end_plan — считаем "открытой" и пересекающейся с любой более поздней. */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart && !aEnd) return false;
  if (!bStart && !bEnd) return false;
  const aS = aStart ? new Date(aStart).getTime() : -Infinity;
  const aE = aEnd ? new Date(aEnd).getTime() : Infinity;
  const bS = bStart ? new Date(bStart).getTime() : -Infinity;
  const bE = bEnd ? new Date(bEnd).getTime() : Infinity;
  if (!Number.isFinite(aS) && !Number.isFinite(aE)) return false;
  if (!Number.isFinite(bS) && !Number.isFinite(bE)) return false;
  return aS <= bE && bS <= aE;
}

function fmtRange(s, e) {
  const f = (d) => d ? new Date(d).toLocaleDateString('ru-RU') : '?';
  return `${f(s)} — ${f(e)}`;
}

/* Окно «Запросить override» — для пересечений. */
function OverrideRequestModal({ tender, pmId, pmName, conflicts, onSent }) {
  const { close } = useModal();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!reason.trim() || reason.trim().length < 10) {
      return toast('Override', 'Укажите причину (минимум 10 символов)', 'warn');
    }
    setBusy(true);
    try {
      await requestAssignOverride({
        tender_id: tender.id,
        pm_id: pmId,
        pm_name: pmName,
        reason: reason.trim(),
        conflicts
      });
      toast('Override', 'Запрос отправлен директорам', 'ok');
      onSent?.();
      close();
    } catch (e) {
      toast('Override', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="⚠️" title="Запрос override на назначение РП" subtitle={`#${tender.id} → ${pmName}`} accent="warn" />
      <MBody>
        <div className="col gap-12">
          <div className="alert-warn-soft">
            У РП обнаружены пересечения по датам:
            <ul className="mt-6">
              {conflicts.map((c) => (
                <li key={c.id}>
                  <strong>{c.work_title || `Работа #${c.id}`}</strong> · {c.dates}
                </li>
              ))}
            </ul>
            Назначение через override требует подтверждения директора. Опишите почему всё-таки этот РП.
          </div>
          <Field label="Причина override" required help="Минимум 10 символов">
            <TextareaInput
              value={reason}
              onChange={setReason}
              placeholder="Например: «Андросов работал у этого заказчика, остальные РП загружены до сентября»"
              minRows={3}
              maxRows={6}
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="warn" disabled={busy} onClick={send}>{busy ? '…' : '⚠ Отправить запрос'}</Btn>
      </MFoot>
    </MCard>
  );
}

export default function WinAssignPanel({ user }) {
  const modal = useModal();
  const [items, setItems] = useState([]);
  const [pms, setPms] = useState([]);
  const [picks, setPicks] = useState({});           // { [tenderId]: pmId }
  const [conflictsByTender, setConflictsByTender] = useState({}); // { [tenderId]: [{id, work_title, dates}] }
  const [overrideSent, setOverrideSent] = useState({}); // { [tenderId]: true }
  const [busyId, setBusyId] = useState(null);

  const allowed = ['TO', 'HEAD_TO', 'HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  useEffect(() => {
    if (!allowed) return;
    // F2: и PM, и HEAD_PM (vanilla tenders.js:717). Backend comma-list.
    Promise.all([loadWinPending(), loadUsers('PM,HEAD_PM')]).then(([list, pmList]) => {
      setItems(list);
      setPms(pmList);
    });
  }, [allowed]);

  /* Проверка пересечений при смене выбора РП. Кэш загруженных работ — на сессию (Map). */
  const worksCacheRef = useMemo(() => new Map(), []);

  const checkConflicts = useCallback(async (tender, pmId) => {
    if (!pmId) {
      setConflictsByTender((c) => ({ ...c, [tender.id]: [] }));
      return;
    }
    let works = worksCacheRef.get(pmId);
    if (!works) {
      works = await loadWorksForPm(pmId);
      worksCacheRef.set(pmId, works);
    }
    // Интервал тендера — work_start_plan..work_end_plan; если их нет — start_plan/end_plan.
    const tStart = tender.work_start_plan || tender.start_plan || null;
    const tEnd   = tender.work_end_plan   || tender.end_plan   || null;
    // Если у тендера НЕТ дат — пересечений не проверяем (информации недостаточно).
    if (!tStart && !tEnd) {
      setConflictsByTender((c) => ({ ...c, [tender.id]: [] }));
      return;
    }
    const conflicts = works.filter((w) => {
      // Игнорируем закрытые работы и снесённые soft-delete (бэк уже фильтрует deleted_at).
      const finalStatuses = new Set(['Закрыта', 'Закрытие', 'Отменена', 'Архив', 'Завершена']);
      if (finalStatuses.has(w.work_status)) return false;
      const wS = w.start_plan || w.start_in_work_date || w.start_date || null;
      const wE = w.end_plan || w.end_fact || null;
      return rangesOverlap(tStart, tEnd, wS, wE);
    }).map((w) => ({
      id: w.id,
      work_title: w.work_title || w.customer_name || `работа #${w.id}`,
      dates: fmtRange(w.start_plan || w.start_in_work_date, w.end_plan || w.end_fact)
    }));
    setConflictsByTender((c) => ({ ...c, [tender.id]: conflicts }));
  }, [worksCacheRef]);

  const onPickPm = (tender, pmId) => {
    setPicks((p) => ({ ...p, [tender.id]: pmId }));
    setOverrideSent((s) => ({ ...s, [tender.id]: false }));
    checkConflicts(tender, pmId);
  };

  if (!allowed || !items.length) return null;

  /* Источник: vanilla tenders.js → renderWinAssignPanel (~970..992).
     Используем POST /api/tenders/:id/assign-work-pm { pm_id } — он создаст работу
     с правильными статусами/аудит-логом, в отличие от /works/addendum. */
  const assignAndCreate = async (t, override = false) => {
    const pmId = picks[t.id];
    if (!pmId) return toast('Назначение', 'Выберите РП для работ', 'warn');
    setBusyId(t.id);
    try {
      const body = { pm_id: Number(pmId) };
      if (override) body.override_reason = 'Подтверждено директором (override)';
      await api(`/api/tenders/${t.id}/assign-work-pm`, { method: 'POST', body });
      toast('Назначение', 'Работа создана и назначена РП', 'ok');
      setItems((all) => all.filter((x) => x.id !== t.id));
      window.dispatchEvent(new CustomEvent('asgard:tenders:changed'));
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusyId(null);
    }
  };

  const openOverride = (t) => {
    const pmId = Number(picks[t.id] || 0);
    const pmName = pms.find((u) => String(u.id) === String(pmId))?.name || `РП #${pmId}`;
    const conflicts = conflictsByTender[t.id] || [];
    modal.open(
      <OverrideRequestModal
        tender={t}
        pmId={pmId}
        pmName={pmName}
        conflicts={conflicts}
        onSent={() => setOverrideSent((s) => ({ ...s, [t.id]: true }))}
      />
    );
  };

  return (
    <div className="card tnd-panel tnd-panel--ok">
      <strong className="tnd-panel-title tnd-panel-title--ok">
        🏆 Выиграны — назначить РП ({items.length})
      </strong>
      <div className="tnd-panel-grid mt-10">
        {items.map((t) => {
          const conflicts = conflictsByTender[t.id] || [];
          const hasPick = !!picks[t.id];
          const blocked = hasPick && conflicts.length > 0 && !overrideSent[t.id];
          return (
            <div key={t.id} className="tnd-panel-card">
              <div className="mb-8">
                <span className="tnd-panel-card-id">#{t.id}</span>{' '}
                <strong className="tnd-panel-card-name">{t.customer_name}</strong>
                {t.tender_name && <div className="tnd-panel-card-sub">{t.tender_name}</div>}
                {(t.work_start_plan || t.work_end_plan) && (
                  <div className="tnd-panel-card-dates fs-11 c-t3 mt-4">
                    📅 {fmtRange(t.work_start_plan, t.work_end_plan)}
                  </div>
                )}
              </div>
              <div className="row gap-6">
                <SelectInput
                  value={picks[t.id] || ''}
                  onChange={(v) => onPickPm(t, v)}
                  options={[
                    { value: '', label: '— РП —' },
                    ...pms.map((u) => ({
                      value: String(u.id),
                      // F2: HEAD_PM визуально отличаем префиксом «(Ст.РП)».
                      label: (u.role === 'HEAD_PM' ? '(Ст.РП) ' : '') + (u.name || u.login)
                    }))
                  ]}
                />
                <Btn
                  size="sm"
                  variant="primary"
                  disabled={busyId === t.id || blocked}
                  onClick={() => assignAndCreate(t, overrideSent[t.id])}
                  title={blocked ? 'Пересечение по датам — нужен override' : 'Создать работу для РП'}
                >
                  {busyId === t.id ? '…' : (overrideSent[t.id] ? '→ Создать (override)' : '→ Создать работу')}
                </Btn>
              </div>
              {hasPick && conflicts.length > 0 && (
                <div className="tnd-panel-conflict mt-8">
                  <div className="fs-12 c-warn">
                    ⚠ Пересечение по датам ({conflicts.length}):
                  </div>
                  <ul className="tnd-panel-conflict-list">
                    {conflicts.slice(0, 3).map((c) => (
                      <li key={c.id}>
                        <span className="ellipsis">{c.work_title}</span>
                        <span className="fs-11 c-t3 ml-6">{c.dates}</span>
                      </li>
                    ))}
                    {conflicts.length > 3 && (
                      <li className="fs-11 c-t3">…ещё {conflicts.length - 3}</li>
                    )}
                  </ul>
                  {!overrideSent[t.id] ? (
                    <Btn size="sm" variant="warn" onClick={() => openOverride(t)}>
                      ⚠ Запросить override
                    </Btn>
                  ) : (
                    <div className="fs-11 c-t3 mt-4">✓ Override запрошен — можно создавать работу</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
