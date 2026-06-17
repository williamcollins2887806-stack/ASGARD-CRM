/**
 * Модалка HR «Подбор» — split-screen.
 * Источник: vanilla `hr_requests.js` openHrView + loadAvailableWorkers + loadAssigned.
 *
 * Слева: детали заявки, прогресс позиций, назначенные рабочие (можно убрать).
 * Справа: доступные рабочие с фильтром по роли и поиском, кнопка «+ Добавить».
 *
 * Действия:
 *   • При status='new' — авто «Взять в работу»
 *   • 💾 Сохранить и выйти
 *   • 📤 Отправить РП — sent_to_pm
 *   • ✅ Утвердить    — approved
 *   • 🔄 Вернуть      — rework (с обязательным комментарием через PromptModal)
 */
import { useState, useEffect, useCallback } from 'react';
import { useModal, PromptModal, ConfirmModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import {  SearchInput, SelectInput } from '@/inputs/Inputs';
import { toast, StatusBadge } from '@/modals/Notifications';
import {
  describeStatus, loadRequest, loadAvailableWorkers,
  takeRequest, assignWorker, unassignWorker,
  sendToPm, approveRequest, reworkRequest,
  fmtDate,
} from './api';

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:hr-requests:changed'));
}

export function HrSplitModal({ requestId, onChanged }) {
  const { close, open } = useModal();
  const [req, setReq] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshReq = useCallback(async () => {
    try {
      const r = await loadRequest(requestId);
      setReq(r);
      return r;
    } catch (e) {
      toast.error('Не удалось загрузить заявку: ' + (e?.message || e));
      return null;
    }
  }, [requestId]);

  const refreshWorkers = useCallback(async (role = roleFilter) => {
    try {
      const w = await loadAvailableWorkers(requestId, role);
      setWorkers(w);
    } catch (e) {
      toast.error('Не удалось загрузить рабочих: ' + (e?.message || e));
    }
  }, [requestId, roleFilter]);

  // Первая загрузка: взять заявку в работу, если статус new
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    (async () => {
      const r = await refreshReq();
      if (cancel || !r) return;
      if (r.status_v2 === 'new') {
        try {
          await takeRequest(requestId);
          await refreshReq();
        } catch (e) {
          if (!/409|конфликт|уже в работе/i.test(String(e?.message || ''))) {
            // не блокируем — просто покажем тост
            toast.warn('Заявка уже у другого HR');
          }
        }
      }
      await refreshWorkers('');
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  useEffect(() => {
    refreshWorkers(roleFilter);
  }, [roleFilter, refreshWorkers]);

  if (loading || !req) {
    return (
      <MCard className="modal-wide">
        <MHead icon="📋" title={`Заявка #${requestId}`} subtitle="Подбор рабочих" onClose={close} />
        <MBody>
          <div className="t-center p-40 c-t3">⏳ Загружаем…</div>
        </MBody>
      </MCard>
    );
  }

  const meta = describeStatus(req.status_v2 || req.status);
  const positions = req.positions || [];
  const assignments = req.assignments || [];

  const filteredWorkers = search.trim()
    ? workers.filter((w) => (w.fio || '').toLowerCase().includes(search.toLowerCase().trim()))
    : workers;

  const onAddWorker = async (worker) => {
    const targetPos = roleFilter
      ? positions.find((p) => p.role_key === roleFilter)
      : positions.find((p) => (p.filled_count || 0) < p.required_count);
    if (!targetPos) {
      toast.warn('Все позиции заполнены');
      return;
    }
    setBusy(true);
    try {
      await assignWorker(req.id, {
        employee_id: worker.employee_id || worker.id,
        position_id: targetPos.id,
        assigned_role: targetPos.role_key,
      });
      toast.success(`${worker.fio} добавлен`);
      emitChanged();
      onChanged?.();
      await Promise.all([refreshReq(), refreshWorkers(roleFilter)]);
    } catch (e) {
      toast.error('Не удалось добавить: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onRemoveAssign = async (assignment) => {
    setBusy(true);
    try {
      await unassignWorker(req.id, assignment.id);
      toast.success('Убран');
      emitChanged();
      onChanged?.();
      await Promise.all([refreshReq(), refreshWorkers(roleFilter)]);
    } catch (e) {
      toast.error('Не удалось убрать: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onSendToPm = async () => {
    setBusy(true);
    try {
      await sendToPm(req.id);
      toast.success('Отправлено РП');
      emitChanged();
      onChanged?.();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
      setBusy(false);
    }
  };

  const onApprove = () => {
    open(
      <ConfirmModal
        tone="success"
        title="Утвердить заявку?"
        message={`Утвердить заявку #${req.id}? Назначенные рабочие получат статус «approved», а тем, кому не хватает допусков — автоматически создадутся записи в worker_training.`}
        okText="✓ Утвердить"
        onConfirm={async () => {
          setBusy(true);
          try {
            await approveRequest(req.id);
            toast.success('Заявка утверждена');
            emitChanged();
            onChanged?.();
            close();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
            setBusy(false);
          }
        }}
      />
    );
  };

  const onRework = () => {
    open(
      <PromptModal
        title="Вернуть на доработку"
        subtitle={`Заявка #${req.id}`}
        label="Комментарий"
        placeholder="Укажите, что нужно поправить РП…"
        multiline
        required
        okText="🔄 Вернуть"
        accent="warn"
        onSubmit={async (comment) => {
          setBusy(true);
          try {
            await reworkRequest(req.id, comment);
            toast.success('Возвращено на доработку');
            emitChanged();
            onChanged?.();
            close();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
            setBusy(false);
          }
        }}
      />
    );
  };

  return (
    <MCard className="modal-wide">
      <MHead
        icon="📋"
        title={`Заявка #${req.id} — Подбор`}
        subtitle={`${req.work_title || '—'}${req.customer_name ? ' · ' + req.customer_name : ''} · РП: ${req.pm_name || '—'}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="hr-split">
          {/* Left */}
          <div className="hr-split-left">
            <div className="row gap-10 u-wrap mb-12">
              <StatusBadge tone={meta.tone} label={meta.label} />
              <span className="c-t3 fs-13">{fmtDate(req.created_at)}</span>
            </div>

            {req.work_description && (
              <div className="p-10 bg-inner r-sm mb-12 fs-13 c-t2">
                {req.work_description}
              </div>
            )}

            <div className="hr-split-eyebrow">Прогресс по позициям</div>
            <div className="hr-pos mb-16" >
              {positions.map((p) => <PositionRow key={p.id} pos={p} />)}
            </div>

            <div className="hr-split-eyebrow">Добавленные рабочие</div>
            {assignments.length === 0 ? (
              <div className="c-t3 p-10 fs-13">Пока никого не добавлено</div>
            ) : (
              <div className="col gap-6">
                {assignments.map((a) => (
                  <div key={a.id} className="hr-assign-row">
                    <div>
                      <b>{a.fio || a.employee_name || '—'}</b>
                      <span className="c-t3 ml-6 fs-11">{a.assigned_role || ''}</span>
                      {a.role_mismatch && <span className="c-amber fs-11"> ⚠️</span>}
                    </div>
                    <Btn size="sm" variant="ghost" onClick={() => onRemoveAssign(a)} disabled={busy}>
                      ✕ Убрать
                    </Btn>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right */}
          <div className="hr-split-right">
            <div className="hr-split-search-row">
              <SearchInput value={search} onChange={setSearch} placeholder="Поиск по ФИО…" />
              <div className="min-w-160">
                <SelectInput
                  value={roleFilter}
                  onChange={setRoleFilter}
                  options={[
                    { value: '', label: 'Все роли' },
                    ...positions.map((p) => ({ value: p.role_key, label: p.role_label })),
                  ]}
                />
              </div>
            </div>

            {filteredWorkers.length === 0 ? (
              <div className="c-t3 p-16 t-center">
                Нет доступных рабочих
              </div>
            ) : (
              <div>
                {filteredWorkers.map((w) => (
                  <WorkerRow key={w.id || w.employee_id} worker={w} onAdd={() => onAddWorker(w)} disabled={busy} />
                ))}
              </div>
            )}
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>💾 Сохранить и выйти</Btn>
        <div className="u-flex gap-6">
          <Btn variant="ghost" onClick={onRework} disabled={busy} title="Вернуть РП">🔄 Вернуть</Btn>
          <Btn onClick={onSendToPm} disabled={busy}>📤 Отправить РП</Btn>
          <Btn variant="primary" onClick={onApprove} disabled={busy}>✅ Утвердить</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}

function PositionRow({ pos }) {
  const pct = pos.required_count > 0 ? Math.round((pos.filled_count || 0) / pos.required_count * 100) : 0;
  const isFull = pct >= 100;
  return (
    <div className={`hr-pos-row ${isFull ? 'hr-pos-row--full' : 'hr-pos-row--part'}`} style={{ opacity: isFull ? 0.7 : 1 }}>
      <div className="hr-pos-head">
        <span>{pos.role_label}{isFull ? ' ✅' : ''}</span>
        <span style={{ fontWeight: 700, color: isFull ? 'var(--ok)' : 'var(--amber)' }}>
          {pos.filled_count || 0} / {pos.required_count}
        </span>
      </div>
      <div className="hr-pos-fill">
        <div style={{ width: Math.min(100, pct) + '%' }} />
      </div>
    </div>
  );
}

function WorkerRow({ worker, onAdd, disabled }) {
  const rat = Number(worker.rating_avg || 0);
  const ratColor = rat >= 8 ? 'var(--ok)' : rat >= 6 ? 'var(--gold)' : rat > 0 ? 'var(--t-3)' : 'var(--t-3)';
  const hasMismatch = worker.conflict_reason === 'role_mismatch';
  const missingPermits = worker.conflict_reason === 'missing_permits';
  return (
    <div className="hr-worker-row">
      <div>
        <div className="hr-worker-fio">{worker.fio || '—'}</div>
        <div className="hr-worker-meta">
          {worker.position || worker.role_tag || ''}
          {worker.city && ' · ' + worker.city}
          {rat > 0 && (
            <>
              {' · '}
              <span style={{ color: ratColor, fontWeight: 700 }}>★ {rat.toFixed(1)}</span>
            </>
          )}
        </div>
        {hasMismatch && <div style={{ fontSize: 11, color: 'var(--amber)' }}>⚠️ Роль не совпадает</div>}
        {missingPermits && <div className="fs-11 c-err">🔴 Нет допусков</div>}
      </div>
      <Btn size="sm" variant="primary" onClick={onAdd} disabled={disabled}>+ Добавить</Btn>
    </div>
  );
}
