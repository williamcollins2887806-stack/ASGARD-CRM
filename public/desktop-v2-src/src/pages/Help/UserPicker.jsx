/**
 * UserPicker — выбор сотрудника(ов) для help-задачи.
 *
 * Используется в HelpRequestModal (assignee + watchers), RedirectModal, ReassignModal.
 *
 * props:
 *   value             — id юзера (single) или массив id (если multi=true)
 *   onChange(v)       — id или массив id
 *   multi             — true для watchers
 *   exclude           — массив id-ов которые скрыть (например, creator, current assignee)
 *   limit             — макс. кол-во в multi (default 20)
 *   placeholder       — текст поиска
 *   allowEmpty        — может быть пустым (multi-only)
 *   compact           — узкий режим (для модалок действий)
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { loadActiveUsers, ROLE_LABELS, DEPARTMENT_FILTERS } from './api';

const RECENT_KEY = 'help_recent_users';

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function pushRecent(userId) {
  try {
    const arr = getRecent().filter(id => id !== userId);
    arr.unshift(userId);
    localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, 6)));
  } catch (e) {}
}

export function rememberPickedUser(userId) { pushRecent(userId); }

export function UserPicker({ value, onChange, multi=false, exclude=[], limit=20, placeholder='Имя сотрудника…', compact=false }) {
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dept, setDept]     = useState('');
  const [open, setOpen]     = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    loadActiveUsers()
      .then(arr => setAllUsers(arr.filter(u => u.is_active !== false)))
      .catch(() => setAllUsers([]))
      .finally(() => setLoading(false));
  }, []);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const excludeSet = useMemo(() => new Set(exclude.filter(Boolean)), [exclude]);

  const filtered = useMemo(() => {
    const norm = search.trim().toLowerCase();
    const allowedRoles = dept ? dept.split(',') : null;
    return allUsers.filter(u => {
      if (excludeSet.has(u.id)) return false;
      if (allowedRoles && !allowedRoles.includes(u.role)) return false;
      if (norm) {
        const name = String(u.name || u.login || '').toLowerCase();
        const role = String(ROLE_LABELS[u.role] || u.role || '').toLowerCase();
        if (!name.includes(norm) && !role.includes(norm)) return false;
      }
      return true;
    }).slice(0, 80);
  }, [allUsers, search, dept, excludeSet]);

  const recentList = useMemo(() => {
    if (search || dept) return [];
    const recent = getRecent();
    return recent
      .map(id => allUsers.find(u => u.id === id))
      .filter(u => u && !excludeSet.has(u.id))
      .slice(0, 6);
  }, [allUsers, excludeSet, search, dept]);

  const selectedIds = multi ? (Array.isArray(value) ? value : []) : (value ? [value] : []);
  const selectedUsers = selectedIds.map(id => allUsers.find(u => u.id === id)).filter(Boolean);

  const isPicked = (id) => selectedIds.includes(id);

  const togglePick = (id) => {
    if (multi) {
      let next = selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id];
      if (next.length > limit) next = next.slice(0, limit);
      onChange(next);
      pushRecent(id);
    } else {
      onChange(id);
      pushRecent(id);
      setOpen(false);
      setSearch('');
    }
  };

  const removePill = (id) => {
    if (multi) onChange(selectedIds.filter(x => x !== id));
    else onChange(null);
  };

  return (
    <div className={`help-picker ${compact ? 'help-picker--compact' : ''}`} ref={wrapRef}>
      {/* Pills с выбранными */}
      {selectedUsers.length > 0 && (
        <div className="help-picker-pills">
          {selectedUsers.map(u => (
            <span key={u.id} className="help-pill">
              <span className="help-pill-avatar" data-role={u.role}>{initials(u.name || u.login)}</span>
              <span className="help-pill-name">{u.name || u.login}</span>
              <span className="help-pill-role">{ROLE_LABELS[u.role] || u.role}</span>
              <button className="help-pill-x" type="button" onClick={() => removePill(u.id)} aria-label="убрать">×</button>
            </span>
          ))}
        </div>
      )}

      {/* Поле поиска */}
      {(multi || selectedUsers.length === 0) && (
        <div className="help-picker-input">
          <input
            type="text"
            value={search}
            placeholder={placeholder}
            onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
          />
          {multi && (
            <span className="help-picker-counter">{selectedUsers.length}/{limit}</span>
          )}
        </div>
      )}

      {/* Выпадашка */}
      {open && (
        <div className="help-picker-dropdown">
          <div className="help-picker-depts">
            {DEPARTMENT_FILTERS.map(d => (
              <button
                key={d.key}
                type="button"
                className={`help-dept-chip ${dept === d.key ? 'is-active' : ''}`}
                onClick={() => setDept(d.key)}>{d.label}</button>
            ))}
          </div>

          {loading ? (
            <div className="help-picker-empty">⏳ Загружаем сотрудников…</div>
          ) : (
            <>
              {recentList.length > 0 && (
                <>
                  <div className="help-picker-section">Чаще всего</div>
                  {recentList.map(u => (
                    <UserRow key={'r-'+u.id} u={u} picked={isPicked(u.id)} onClick={() => togglePick(u.id)} />
                  ))}
                </>
              )}
              {filtered.length > 0 ? (
                <>
                  <div className="help-picker-section">
                    {search ? `Найдено: ${filtered.length}` : 'Все сотрудники'}
                  </div>
                  {filtered.map(u => (
                    <UserRow key={u.id} u={u} picked={isPicked(u.id)} onClick={() => togglePick(u.id)} />
                  ))}
                </>
              ) : (
                <div className="help-picker-empty">Никого не нашли. Попробуй другое слово или отдел.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function UserRow({ u, picked, onClick }) {
  return (
    <button type="button" className={`help-user-row ${picked ? 'is-picked' : ''}`} onClick={onClick}>
      <span className="help-user-avatar" data-role={u.role}>{initials(u.name || u.login)}</span>
      <span className="help-user-meta">
        <span className="help-user-name">{u.name || u.login}</span>
        <span className="help-user-role">{ROLE_LABELS[u.role] || u.role}</span>
      </span>
      <span className="help-user-pick">{picked ? '✓' : '+'}</span>
    </button>
  );
}

function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
