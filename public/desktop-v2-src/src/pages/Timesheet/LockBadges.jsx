/**
 * LockBadges — статусы закрытия месяца.
 *
 * FIX 1: ВСЕ 4 scope-бейджа (warehouse/medical/travel/global) с обоими состояниями
 *        (открытый/закрытый), не только активные.
 * FIX 2: Для mode='global' — таблица ВСЕХ РП компании с их статусами закрытия,
 *        отсортированных «открытые сверху». Кнопка «Напомнить» (для будущего эндпоинта).
 * FIX 15: Сгруппирован заголовок «Закрытие месяца — <Период>», три ряда:
 *        РП / Доп. виды / Общий.
 *
 * Источник данных — closureStatus (от parent через getClosureStatus()).
 * Старый prop locks[] оставлен для обратной совместимости (для не-global mode'ов
 * без closureStatus используем locks-источник).
 *
 * Props:
 *   mode          — 'pm'|'warehouse'|'medical'|'travel'|'global'
 *   closureStatus — { pm_locks: [...], scope_locks: { warehouse,medical,travel,global } }
 *   locks         — legacy fallback, [{ scope, scope_user_id, scope_user_fio, locked_at, locked_by_fio, id }]
 *   year, month
 *   currentUserId — для определения «свой РП-лок»
 *   canUnlock     — (lockShape) => boolean
 *   onUnlock      — (lockShape) => Promise<void>
 *   onLockGlobal  — () => void (только если canLockMy для global)
 *   onLockScope   — (scope) => void (только если canLockMy для своего scope)
 *   onRemindPm    — (pm_lock) => void (опционально; если null — кнопка скрыта)
 *   canLockMy     — boolean (можно закрыть СВОЙ scope; для остальных кнопка скрыта)
 *   myScope       — что считается «своим» (lockScope текущего mode)
 */
import { Btn, Pill } from '@/modals/parts';
import { fmtDateTime, monthLabel } from './api';

const SCOPE_META = {
  pm:        { icon: '👥', label: 'РП' },
  warehouse: { icon: '📦', label: 'Склад' },
  medical:   { icon: '🏥', label: 'МО' },
  travel:    { icon: '✈️', label: 'Дорога' },
  global:    { icon: '🔒', label: 'Общий' }
};

const SCOPE_ORDER = ['warehouse', 'medical', 'travel'];

export default function LockBadges({
  mode,
  closureStatus = null,
  locks = [],
  year,
  month,
  currentUserId,
  canUnlock,
  onUnlock,
  onLockGlobal,
  onLockScope,
  onRemindPm = null,
  canLockMy = false,
  myScope = null
}) {
  /* ─── Источник scope-локов: closureStatus.scope_locks (новое) или fallback из locks[] ─── */
  const scopeLocks = closureStatus?.scope_locks || buildScopeLocksFromLegacy(locks);
  const pmLocks = closureStatus?.pm_locks || buildPmLocksFromLegacy(locks);

  const isGlobalMode = mode === 'global';

  /* ─── My-scope бейдж для не-global mode'ов ─── */
  const myScopeBadge = (() => {
    if (isGlobalMode || !myScope || myScope === 'pm') return null; // pm имеет свой ниже
    const sl = scopeLocks[myScope];
    if (!sl) return null;
    return sl;
  })();

  /* ─── Свой PM-лок для PM-режима ─── */
  const myPmLock = (() => {
    if (mode !== 'pm' || !currentUserId) return null;
    return pmLocks.find((p) => p.user_id === currentUserId);
  })();

  /* ─── Render ─── */
  return (
    <div className="ts-lock-bar" role="region" aria-label={`Статусы закрытия за ${monthLabel(year, month)}`}>
      <div className="ts-lock-bar-title">
        Закрытие месяца — {monthLabel(year, month)}
      </div>

      {/* GLOBAL — три ряда: РП / Доп.виды / Общий */}
      {isGlobalMode && (
        <>
          {/* Ряд 1: ВСЕ РП с их статусами */}
          {pmLocks.length > 0 && (
            <div className="ts-lock-row" style={{ alignItems: 'flex-start' }}>
              <div className="ts-lock-row-label">РП:</div>
              <div className="ts-pm-locks-grid">
                {sortPmLocks(pmLocks).map((p) => (
                  <PmLockChip
                    key={p.user_id}
                    pmLock={p}
                    canUnlock={canUnlock}
                    onUnlock={onUnlock}
                    onRemind={onRemindPm}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Ряд 2: Доп. виды */}
          <div className="ts-lock-row">
            <div className="ts-lock-row-label">Доп. виды:</div>
            {SCOPE_ORDER.map((s) => (
              <ScopeBadge
                key={s}
                scope={s}
                sl={scopeLocks[s]}
                canUnlock={canUnlock}
                onUnlock={onUnlock}
              />
            ))}
          </div>

          {/* Ряд 3: Общий */}
          <div className="ts-lock-row">
            <div className="ts-lock-row-label">Общий:</div>
            <ScopeBadge
              scope="global"
              sl={scopeLocks.global}
              canUnlock={canUnlock}
              onUnlock={onUnlock}
            />
            {canLockMy && !scopeLocks.global?.locked && (
              <Btn variant="primary" size="sm" onClick={onLockGlobal}>
                🔒 Закрыть месяц
              </Btn>
            )}
          </div>
        </>
      )}

      {/* NON-GLOBAL: одна строка со «своим» статусом + 3 справочных бейджа доп.видов */}
      {!isGlobalMode && (
        <>
          {/* Свой статус (PM сам / WAREHOUSE / TO / OFFICE_MANAGER) */}
          {mode === 'pm' && myPmLock && (
            <div className="ts-lock-row">
              <div className="ts-lock-row-label">Мой табель:</div>
              <PmLockChip
                pmLock={myPmLock}
                canUnlock={canUnlock}
                onUnlock={onUnlock}
                onRemind={null}
              />
              {canLockMy && !myPmLock.locked && (
                <Btn variant="primary" size="sm" onClick={onLockGlobal}>
                  🔒 Закрыть свой табель
                </Btn>
              )}
            </div>
          )}

          {mode !== 'pm' && myScopeBadge && (
            <div className="ts-lock-row">
              <div className="ts-lock-row-label">Мой scope:</div>
              <ScopeBadge
                scope={myScope}
                sl={myScopeBadge}
                canUnlock={canUnlock}
                onUnlock={onUnlock}
              />
              {canLockMy && !myScopeBadge.locked && (
                <Btn variant="primary" size="sm" onClick={onLockGlobal}>
                  🔒 Закрыть месяц
                </Btn>
              )}
            </div>
          )}

          {/* Справочные бейджи остальных scope (без управления) */}
          <div className="ts-lock-row">
            <div className="ts-lock-row-label">Статус:</div>
            {['warehouse', 'medical', 'travel', 'global'].map((s) => (
              <ScopeBadge
                key={s}
                scope={s}
                sl={scopeLocks[s]}
                canUnlock={null}
                onUnlock={null}
                dim={true}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── ScopeBadge — бейдж scope-лока с обоими состояниями ─── */
function ScopeBadge({ scope, sl, canUnlock, onUnlock, dim = false }) {
  const meta = SCOPE_META[scope] || { icon: '🔒', label: scope };
  const locked = !!sl?.locked;
  if (locked) {
    const tip = `Закрыл: ${sl.locked_by_fio || '—'}\n${fmtDateTime(sl.locked_at)}`;
    return (
      <span className="ts-lock-badge locked" title={tip}>
        <span aria-hidden="true">🔒</span>
        <span>{meta.icon} {meta.label}: закрыт {sl.locked_by_fio ? `· ${sl.locked_by_fio}` : ''}</span>
        {canUnlock?.(asLegacyLock(scope, sl)) && (
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => onUnlock?.(asLegacyLock(scope, sl))}
            style={{ padding: '2px 6px', fontSize: 10, marginLeft: 4 }}
            aria-label="Открыть месяц"
          >
            Открыть
          </Btn>
        )}
      </span>
    );
  }
  return (
    <span
      className="ts-lock-badge unlocked"
      title={`${meta.label}: открыт для отметок`}
      style={dim ? { opacity: 0.75 } : undefined}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span>{meta.label}: открыт</span>
    </span>
  );
}

/* ─── PmLockChip — один РП в таблице ─── */
function PmLockChip({ pmLock, canUnlock, onUnlock, onRemind }) {
  const locked = !!pmLock.locked;
  const dt = pmLock.locked_at ? fmtDateTime(pmLock.locked_at) : '';
  return (
    <div className={'ts-pm-lock-chip ' + (locked ? 'locked' : 'open')}>
      <div className="fio" title={pmLock.fio}>
        {locked ? '✅' : '❌'} {pmLock.fio}
      </div>
      <div className="status">
        {locked ? (
          <>
            <span title={`Закрыл: ${pmLock.fio}\n${dt}`}>{dt}</span>
            {canUnlock?.(asLegacyLock('pm', pmLock)) && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => onUnlock?.(asLegacyLock('pm', pmLock))}
                style={{ padding: '2px 6px', fontSize: 10, marginLeft: 4 }}
                aria-label={`Открыть месяц ${pmLock.fio}`}
              >
                Открыть
              </Btn>
            )}
          </>
        ) : (
          <>
            <span>Не закрыл</span>
            {onRemind && (
              <button
                className="ts-pm-remind"
                onClick={() => onRemind(pmLock)}
                style={{ marginLeft: 4 }}
                title="Напомнить РП закрыть месяц"
              >
                Напомнить
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

// Сортируем: открытые (не закрыл) сверху, потом закрытые (по ФИО)
function sortPmLocks(pmLocks) {
  return [...pmLocks].sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? 1 : -1;
    return String(a.fio || '').localeCompare(String(b.fio || ''));
  });
}

// Преобразуем { locked, lock_id, locked_at, locked_by_fio } в legacy lock-shape
// чтобы canUnlock/onUnlock из родителя продолжили работать.
function asLegacyLock(scope, sl) {
  return {
    scope,
    scope_user_id: sl.user_id || null,
    scope_user_fio: sl.fio || null,
    locked: !!sl.locked,
    locked_at: sl.locked_at || null,
    locked_by: sl.locked_by || null,
    locked_by_fio: sl.locked_by_fio || null,
    id: sl.lock_id || null
  };
}

// Если closure-status недоступен — собираем суррогат из старого locks[].
function buildScopeLocksFromLegacy(locks) {
  const out = {
    warehouse: { locked: false, locked_by_fio: null, locked_at: null, lock_id: null },
    medical:   { locked: false, locked_by_fio: null, locked_at: null, lock_id: null },
    travel:    { locked: false, locked_by_fio: null, locked_at: null, lock_id: null },
    global:    { locked: false, locked_by_fio: null, locked_at: null, lock_id: null }
  };
  for (const l of (locks || [])) {
    if (!l.locked_at) continue;
    if (!out[l.scope]) continue;
    if (l.scope === 'pm') continue; // pm обрабатываем отдельно
    out[l.scope] = {
      locked: true,
      locked_by_fio: l.locked_by_fio || null,
      locked_at: l.locked_at || null,
      lock_id: l.id || null
    };
  }
  return out;
}

function buildPmLocksFromLegacy(locks) {
  return (locks || [])
    .filter((l) => l.scope === 'pm' && l.locked_at)
    .map((l) => ({
      user_id: l.scope_user_id,
      fio: l.scope_user_fio || '—',
      locked: true,
      locked_at: l.locked_at,
      lock_id: l.id || null
    }));
}

export { Pill };
