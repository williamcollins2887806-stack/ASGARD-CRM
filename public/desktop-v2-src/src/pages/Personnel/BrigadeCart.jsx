/**
 * Brigade cart (v2) — паритет vanilla brigade-cart.js.
 * Persist: localStorage asgard-brigade-cart:{userId}
 * Без заглушек: Excel / матрица / на объект / в план / оценка.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { api } from '@/api/client';
import './brigade-cart.css';

const LS_PREFIX = 'asgard-brigade-cart:';
const ASSIGN_ROLES = new Set(['PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN']);
const RATE_ROLES = new Set(['PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN']);
const COMMENT_CHIPS = ['дисциплина', 'качество', 'повторил бы', 'не брать'];

function authToken() {
  try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; }
}

async function postBlob(path, body) {
  const r = await fetch('/api' + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + authToken(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || j.message || ('HTTP ' + r.status));
  }
  return r.blob();
}

function loadIds(userId) {
  if (!userId) return [];
  try {
    const arr = JSON.parse(localStorage.getItem(LS_PREFIX + userId) || '[]');
    return Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
  } catch { return []; }
}

function saveIds(userId, ids) {
  if (!userId) return;
  try { localStorage.setItem(LS_PREFIX + userId, JSON.stringify(ids)); } catch (_) {}
}

function initials(fio) {
  const p = String(fio || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[1][0]).toUpperCase();
}

export function useBrigadeCart(employees = []) {
  const { user } = useAuth();
  const userId = user?.id;
  const [ids, setIds] = useState(() => loadIds(userId));

  useEffect(() => { setIds(loadIds(userId)); }, [userId]);

  const cache = useMemo(() => {
    const m = {};
    (employees || []).forEach((e) => { if (e?.id != null) m[e.id] = e; });
    return m;
  }, [employees]);

  const setAndPersist = useCallback((next) => {
    setIds(next);
    saveIds(userId, next);
  }, [userId]);

  const has = useCallback((id) => ids.includes(Number(id)), [ids]);
  const add = useCallback((id) => {
    const n = Number(id);
    if (!Number.isFinite(n) || ids.includes(n)) return;
    setAndPersist([...ids, n]);
  }, [ids, setAndPersist]);
  const remove = useCallback((id) => {
    setAndPersist(ids.filter((x) => x !== Number(id)));
  }, [ids, setAndPersist]);
  const clear = useCallback(() => {
    if (!ids.length) return;
    if (!window.confirm(`Убрать ${ids.length} человек из корзины?`)) return;
    setAndPersist([]);
  }, [ids, setAndPersist]);

  const reset = useCallback(() => setAndPersist([]), [setAndPersist]);

  const people = useMemo(
    () => ids.map((id) => cache[id] || { id, fio: '#' + id }),
    [ids, cache]
  );

  return { ids, people, has, add, remove, clear, reset, count: ids.length, user };
}

function WorkPicker({ title, needDates, onCancel, onGo }) {
  const [works, setWorks] = useState([]);
  const [workId, setWorkId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [clearAfter, setClearAfter] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/works?limit=200')
      .then((j) => setWorks(j.works || []))
      .catch((e) => toast.error(e.message || 'Не удалось загрузить работы'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bc-modal is-on" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bc-modal__card">
        <div className="bc-modal__inner">
          <div className="bc-modal__head">
            <span>{title}</span>
            <button type="button" className="bc-drawer__close" onClick={onCancel}>✕</button>
          </div>
          {loading ? <div className="bc-loading">Загрузка…</div> : (
            <div className="bc-form">
              <label className="bc-form-label">Работа
                <select className="input" value={workId} onChange={(e) => setWorkId(e.target.value)}>
                  <option value="">— выберите —</option>
                  {works.map((w) => (
                    <option key={w.id} value={w.id}>{w.work_title || ('#' + w.id)}</option>
                  ))}
                </select>
              </label>
              {needDates && (
                <div className="bc-form-row">
                  <label>С <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                  <label>По <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
                </div>
              )}
              <label className="bc-pdn">
                <input type="checkbox" checked={clearAfter} onChange={(e) => setClearAfter(e.target.checked)} />
                очистить корзину после назначения
              </label>
            </div>
          )}
          <div className="bc-modal__foot">
            <Btn onClick={() => {
              const id = parseInt(workId, 10);
              if (!Number.isFinite(id)) { toast.warn('Выберите работу'); return; }
              const titleText = works.find((w) => Number(w.id) === id)?.work_title || '';
              onGo({ workId: id, workTitle: titleText, planned_from: from || null, planned_to: to || null, clearAfter });
            }}>Далее</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConflictModal({ items, onAll, onFree, onRemove, onCancel }) {
  return (
    <div className="bc-modal is-on" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bc-modal__card">
        <div className="bc-modal__inner">
          <div className="bc-modal__head">Конфликты · {items.length}</div>
          <ul className="bc-conflict-list">
            {items.map((c) => {
              let why = '';
              if (c.on_site) why = `уже на объекте «${c.on_site.work_title || ''}»`;
              else if (c.planned) why = `уже план на «${c.planned.work_title || ''}»`;
              return <li key={c.employee_id}><b>{c.fio || c.employee_id}</b> — {why}</li>;
            })}
          </ul>
          <div className="bc-modal__foot bc-modal__foot--col">
            <Btn onClick={onAll}>Продолжить для всех</Btn>
            <Btn variant="ghost" onClick={onFree}>Назначить только свободных</Btn>
            <Btn variant="ghost" onClick={onRemove}>Убрать конфликтных из корзины</Btn>
            <Btn variant="ghost" onClick={onCancel}>Отмена</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BrigadeCartChrome({ cart }) {
  const [open, setOpen] = useState(false);
  const [includePdn, setIncludePdn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(null); // 'assign' | 'plan' | null
  const [conflicts, setConflicts] = useState(null);
  const [pending, setPending] = useState(null);
  const [rate, setRate] = useState(null);

  const role = cart.user?.role;
  const canAssign = ASSIGN_ROLES.has(role) || String(role || '').startsWith('DIRECTOR_');
  const canRate = RATE_ROLES.has(role) || String(role || '').startsWith('DIRECTOR_');

  async function downloadExcel() {
    setBusy(true);
    try {
      const blob = await postBlob('/staff/brigade-cart/export', {
        employee_ids: cart.ids,
        include_pdn: includePdn,
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'brigada.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success('Состав скачан');
    } catch (e) {
      toast.error(e.message || 'Ошибка Excel');
    } finally {
      setBusy(false);
    }
  }

  async function downloadPermits() {
    setBusy(true);
    try {
      const blob = await postBlob('/staff/brigade-cart/permits-export', { employee_ids: cart.ids });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dopuski_brigada.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success('Матрица скачана');
    } catch (e) {
      toast.error(e.message || 'Ошибка Excel допусков');
    } finally {
      setBusy(false);
    }
  }

  async function startAction(mode, opts) {
    setPicker(null);
    const conf = await api('/staff/brigade-cart/conflicts', {
      method: 'POST',
      body: { employee_ids: cart.ids },
      silent: true,
    }).catch(() => ({ items: [] }));
    const bad = (conf.items || []).filter((i) => i.conflict);
    const ctx = { ...opts, mode };
    if (!bad.length) {
      await runAction(ctx, cart.ids, 'all');
      return;
    }
    setPending(ctx);
    setConflicts(bad);
  }

  async function runAction(ctx, ids, assignMode) {
    setConflicts(null);
    setBusy(true);
    try {
      if (ctx.mode === 'plan') {
        const j = await api('/staff/planned-engagements/bulk', {
          method: 'POST',
          body: {
            work_id: ctx.workId,
            planned_from: ctx.planned_from,
            planned_to: ctx.planned_to,
            employee_ids: ids,
            mode: assignMode,
          },
        });
        toast.success(`В план: ${j.assigned_count || 0}, пропуск ${j.skipped_count || 0}`);
      } else {
        let target = ids;
        if (assignMode === 'free_only') {
          const conf = await api('/staff/brigade-cart/conflicts', {
            method: 'POST',
            body: { employee_ids: ids },
            silent: true,
          });
          const busyIds = new Set((conf.items || []).filter((i) => i.conflict).map((i) => i.employee_id));
          target = ids.filter((id) => !busyIds.has(id));
        }
        if (!target.length) {
          toast.warn('Нет свободных');
          return;
        }
        await api(`/field/manage/projects/${ctx.workId}/crew`, {
          method: 'POST',
          body: { employees: target.map((employee_id) => ({ employee_id, field_role: 'worker' })) },
        });
        toast.success(`Назначено ${target.length}. Ставки — в работе.`);
        window.location.hash = `#/pm-works?open=${ctx.workId}`;
      }
      if (ctx.clearAfter) cart.reset();
      setOpen(false);
    } catch (e) {
      toast.error(e.message || 'Ошибка назначения');
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <>
      <button type="button" className="btn ghost prs-bc-open" onClick={() => setOpen(true)}>
        Корзина
        {cart.count > 0 && <span className="bc-badge">{cart.count}</span>}
      </button>

      {cart.count > 0 && (
        <div className="bc-bar">
          <div className="bc-bar__left">
            <div className="bc-bar__title">Бригада · <span>{cart.count}</span></div>
            <div className="bc-bar__chips">
              {cart.people.slice(0, 12).map((p) => (
                <span key={p.id} className={`bc-chip${p.on_site_info ? ' bc-chip--warn' : ''}`} title={p.fio || ''}>
                  <span className="bc-chip__av">{initials(p.fio)}</span>
                  <button type="button" className="bc-chip__x" onClick={() => cart.remove(p.id)} aria-label="Убрать">×</button>
                </span>
              ))}
            </div>
          </div>
          <div className="bc-bar__actions">
            <Btn variant="ghost" onClick={cart.clear}>Очистить</Btn>
            <Btn onClick={() => setOpen(true)}>Открыть корзину</Btn>
          </div>
        </div>
      )}

      {open && (
        <>
          <div className="bc-overlay is-on" onClick={() => setOpen(false)} />
          <aside className="bc-drawer bc-drawer--open">
            <div className="bc-drawer__topline" />
            <div className="bc-drawer__head">
              <div>
                <div className="bc-drawer__title">Корзина бригады</div>
                <div className="bc-drawer__sub"><b>{cart.count}</b> человек</div>
              </div>
              <button type="button" className="bc-drawer__close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="bc-drawer__body">
              {!cart.count ? (
                <div className="bc-empty">
                  <div className="bc-empty__t">Корзина пуста</div>
                  <div className="bc-empty__s">Выберите людей кнопкой «+»</div>
                </div>
              ) : cart.people.map((p) => (
                <div className="bc-card" key={p.id}>
                  <div className="bc-card__av">{initials(p.fio)}</div>
                  <div className="bc-card__main">
                    <div className="bc-card__fio">{p.fio || '—'}</div>
                    <div className="bc-card__meta">
                      {p.phone
                        ? <a className="bc-card__phone" href={`tel:${p.phone}`}>{p.phone}</a>
                        : <span className="bc-card__muted">нет телефона</span>}
                      {p.rating_avg != null && <span className="bc-card__rate">★ {Number(p.rating_avg).toFixed(1)}</span>}
                    </div>
                    {p.on_site_info && (
                      <div className="bc-card__warn">⚠ на объекте: {p.on_site_info.work_title || ''}</div>
                    )}
                  </div>
                  <button type="button" className="bc-card__rm" onClick={() => cart.remove(p.id)}>×</button>
                </div>
              ))}
            </div>
            <div className="bc-drawer__foot">
              <label className="bc-pdn">
                <input type="checkbox" checked={includePdn} onChange={(e) => setIncludePdn(e.target.checked)} />
                Включить ПДн в Excel
              </label>
              <div className="bc-cta">
                <Btn disabled={!cart.count || busy} onClick={downloadExcel}>Excel состав</Btn>
                <Btn variant="ghost" disabled={!cart.count || busy} onClick={downloadPermits}>Допуски</Btn>
                {canAssign && (
                  <>
                    <Btn disabled={!cart.count || busy} onClick={() => setPicker('assign')}>На объект</Btn>
                    <Btn variant="ghost" disabled={!cart.count || busy} onClick={() => setPicker('plan')}>В план</Btn>
                  </>
                )}
                {canRate && (
                  <Btn variant="ghost" className="bc-cta__primary" disabled={!cart.count || busy} onClick={() => setRate(true)}>
                    Оценить
                  </Btn>
                )}
              </div>
              <div className="bc-cta-secondary">
                <Btn variant="ghost" onClick={cart.clear}>Очистить корзину</Btn>
              </div>
            </div>
          </aside>
        </>
      )}

      {picker && (
        <WorkPicker
          title={picker === 'plan' ? 'Планируемое привлечение' : 'Назначить на объект'}
          needDates={picker === 'plan'}
          onCancel={() => setPicker(null)}
          onGo={(opts) => startAction(picker, opts)}
        />
      )}

      {conflicts && pending && (
        <ConflictModal
          items={conflicts}
          onCancel={() => { setConflicts(null); setPending(null); }}
          onAll={() => runAction(pending, cart.ids, 'all')}
          onFree={() => runAction(pending, cart.ids, 'free_only')}
          onRemove={() => {
            const bad = new Set(conflicts.map((c) => Number(c.employee_id)));
            bad.forEach((id) => cart.remove(id));
            const left = cart.ids.filter((id) => !bad.has(id));
            if (!left.length) {
              toast.warn('Некого назначать');
              setConflicts(null);
              setPending(null);
              return;
            }
            runAction(pending, left, 'all');
          }}
        />
      )}

      {rate && (
        <RatingWizard
          people={cart.people}
          onClose={() => setRate(false)}
        />
      )}
    </>
  );
}

function RatingWizard({ people, onClose }) {
  const [works, setWorks] = useState([]);
  const [workId, setWorkId] = useState('');
  const [started, setStarted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [queue, setQueue] = useState(() => people.map((p) => ({
    id: p.id, fio: p.fio, score: null, comment: '', skipped: false,
  })));

  useEffect(() => {
    api('/works?limit=200').then((j) => setWorks(j.works || [])).catch((e) => toast.error(e.message));
  }, []);

  async function finish() {
    const items = queue.filter((q) => q.score != null).map((q) => ({
      employee_id: q.id, score: q.score, comment: q.comment || '',
    }));
    if (!items.length) { toast.warn('Нет оценок'); onClose(); return; }
    try {
      const j = await api('/staff/reviews/bulk', {
        method: 'POST',
        body: { work_id: Number(workId), items },
      });
      toast.success(`Сохранено ${j.saved_count || items.length}`);
      onClose();
    } catch (e) {
      toast.error(e.message || 'Ошибка оценки');
    }
  }

  const q = queue[idx];
  const done = queue.filter((x) => x.score != null || x.skipped).length;

  return (
    <div className="bc-modal is-on" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bc-modal__card">
        <div className="bc-modal__inner">
          {!started ? (
            <>
              <div className="bc-modal__head">
                <span>Оценить бригаду</span>
                <button type="button" className="bc-drawer__close" onClick={onClose}>✕</button>
              </div>
              <label className="bc-form-label">Работа (обязательно)
                <select className="input" value={workId} onChange={(e) => setWorkId(e.target.value)}>
                  <option value="">— выберите —</option>
                  {works.map((w) => <option key={w.id} value={w.id}>{w.work_title || ('#' + w.id)}</option>)}
                </select>
              </label>
              <div className="bc-modal__foot">
                <Btn onClick={() => {
                  if (!workId) { toast.warn('Выберите работу'); return; }
                  setStarted(true);
                }}>Начать</Btn>
              </div>
            </>
          ) : !q ? (
            <>
              <div className="bc-modal__head">Готово</div>
              <div className="bc-modal__foot"><Btn onClick={finish}>Сохранить</Btn></div>
            </>
          ) : (
            <>
              <div className="bc-modal__head">
                <span>Оценка · {idx + 1}/{queue.length}</span>
                <button type="button" className="bc-drawer__close" onClick={onClose}>✕</button>
              </div>
              <div className="bc-rate-progress">
                <div className="bc-rate-progress__bar" style={{ '--bc-pct': `${Math.round((done / queue.length) * 100)}%` }} />
              </div>
              <div className="bc-rate-fio">{q.fio || ('#' + q.id)}</div>
              <div className="bc-rate-scale">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`bc-rate-n${q.score === n ? ' is-on' : ''}`}
                    onClick={() => setQueue((arr) => arr.map((x, i) => (i === idx ? { ...x, score: n } : x)))}
                  >{n}</button>
                ))}
              </div>
              <div className="bc-rate-chips">
                {COMMENT_CHIPS.map((c) => {
                  const on = (q.comment || '').includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`bc-chip-btn${on ? ' is-on' : ''}`}
                      onClick={() => {
                        const parts = (q.comment || '').split(',').map((x) => x.trim()).filter(Boolean);
                        const i = parts.indexOf(c);
                        if (i >= 0) parts.splice(i, 1);
                        else parts.push(c);
                        const comment = parts.join(', ');
                        setQueue((arr) => arr.map((x, ix) => (ix === idx ? { ...x, comment } : x)));
                      }}
                    >{c}</button>
                  );
                })}
              </div>
              <textarea
                className="input bc-textarea"
                rows={2}
                value={q.comment || ''}
                onChange={(e) => setQueue((arr) => arr.map((x, i) => (i === idx ? { ...x, comment: e.target.value } : x)))}
                placeholder="Комментарий"
              />
              <div className="bc-modal__foot">
                <Btn variant="ghost" onClick={() => {
                  setQueue((arr) => arr.map((x, i) => (i === idx ? { ...x, skipped: true, score: null } : x)));
                  setIdx((i) => i + 1);
                }}>Пропуск</Btn>
                <Btn onClick={() => {
                  if (q.score == null) { toast.warn('Выберите балл или пропуск'); return; }
                  setIdx((i) => i + 1);
                }}>Далее</Btn>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function BrigadeCartToggle({ cart, employeeId, emp }) {
  const on = cart.has(employeeId);
  return (
    <button
      type="button"
      className={`bc-row-btn${on ? ' bc-row-btn--on' : ''}`}
      aria-pressed={on}
      title={on ? 'Убрать из корзины' : 'В корзину'}
      onClick={(e) => {
        e.stopPropagation();
        if (on) cart.remove(employeeId);
        else {
          cart.add(employeeId);
          if (emp?.on_site_info) {
            toast.warn(`${emp.fio || 'Рабочий'} сейчас на объекте «${emp.on_site_info.work_title || ''}»`);
          }
        }
      }}
    >
      {on ? '✓' : '+'}
    </button>
  );
}
