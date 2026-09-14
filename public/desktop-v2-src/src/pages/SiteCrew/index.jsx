/**
 * SiteCrew — матрица «Кто на объектах» (HEAD_TO / ADMIN / directors).
 * Аккордеон-блоки + поиск ФИО / объект / РП.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { Btn } from '@/modals/parts';
import { SelectInput, TextInput } from '@/inputs/Inputs';
import './site-crew.css';

const ROLES = ['ADMIN', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function norm(s) {
  return String(s || '').toLowerCase().trim();
}

function filterWorks(works, qRaw) {
  const q = norm(qRaw);
  if (!q) {
    return (works || []).map((w) => ({ work: w, metaHit: false, crewHits: new Set() }));
  }
  const out = [];
  for (const w of works || []) {
    const metaHit = [w.work_title, w.customer_name, w.city, w.pm_name]
      .some((x) => norm(x).includes(q));
    const crewHits = new Set();
    for (const c of w.crew || []) {
      if (norm(c.fio).includes(q) || norm(c.position).includes(q)) {
        crewHits.add(c.employee_id);
      }
    }
    if (metaHit || crewHits.size) out.push({ work: w, metaHit, crewHits });
  }
  return out;
}

function Field({ label, children }) {
  return (
    <label className="m-field" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--t-2)' }}>{label}</span>
      {children}
    </label>
  );
}

function WarnModal({ workId, employeeId, fio, onDone }) {
  const modal = useModal();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 360, padding: 4 }}>
      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--t-1)' }}>Предупреждение РП</div>
      <div>Отправить РП письмо: снять <b>{fio}</b> в течение 24 часов?</div>
      <Field label="Причина">
        <textarea
          className="inp-text"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={() => modal.close()}>Отмена</Btn>
        <Btn
          variant="primary"
          disabled={busy || !reason.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await api('/api/site-crew/remove-warn', {
                method: 'POST',
                body: { work_id: workId, employee_id: employeeId, reason: reason.trim() }
              });
              toast.success('РП уведомлён');
              modal.close();
              onDone?.();
            } catch (e) {
              toast.error(e?.serverMsg || e?.message || String(e));
            } finally {
              setBusy(false);
            }
          }}
        >Отправить</Btn>
      </div>
    </div>
  );
}

function ForceModal({ workId, employeeId, fio, onDone }) {
  const modal = useModal();
  const [reason, setReason] = useState('');
  const [dep, setDep] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 360, padding: 4 }}>
      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--t-1)' }}>Принудительное снятие</div>
      <div>Снять <b>{fio}</b> с объекта сейчас?</div>
      <Field label="Причина">
        <textarea
          className="inp-text"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </Field>
      <Field label="Дата отъезда">
        <TextInput type="date" value={dep} onChange={setDep} />
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={() => modal.close()}>Отмена</Btn>
        <Btn
          variant="danger"
          disabled={busy || !reason.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await api('/api/site-crew/remove-force', {
                method: 'POST',
                body: {
                  work_id: workId,
                  employee_id: employeeId,
                  reason: reason.trim(),
                  departure_date: dep
                }
              });
              toast.success('Снят с объекта');
              modal.close();
              onDone?.();
            } catch (e) {
              toast.error(e?.serverMsg || e?.message || String(e));
            } finally {
              setBusy(false);
            }
          }}
        >Снять</Btn>
      </div>
    </div>
  );
}

function AddModal({ onDone }) {
  const modal = useModal();
  const [works, setWorks] = useState([]);
  const [workId, setWorkId] = useState('');
  const [q, setQ] = useState('');
  const [emps, setEmps] = useState([]);
  const [empId, setEmpId] = useState('');
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/site-crew/works')
      .then((r) => {
        const list = r?.works || [];
        setWorks(list);
        if (list[0]) setWorkId(String(list[0].id));
      })
      .catch((e) => toast.error(e?.serverMsg || e?.message || String(e)));
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) return undefined;
    const t = setTimeout(() => {
      api(`/api/staff/employees?search=${encodeURIComponent(q.trim())}&limit=20`)
        .then((r) => {
          const list = r?.employees || [];
          setEmps(list);
          if (list[0]) setEmpId(String(list[0].id));
        })
        .catch(() => setEmps([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 420, padding: 4 }}>
      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--t-1)' }}>Добавить на объект</div>
      <Field label="Объект">
        <SelectInput
          value={workId}
          onChange={setWorkId}
          options={works.map((w) => ({ value: String(w.id), label: w.label || w.title }))}
        />
      </Field>
      <Field label="Рабочий (поиск ФИО)">
        <TextInput value={q} onChange={setQ} placeholder="Начните вводить ФИО…" />
      </Field>
      <Field label="Выбор">
        <SelectInput
          value={empId}
          onChange={setEmpId}
          options={emps.map((e) => ({
            value: String(e.id),
            label: e.fio || e.full_name || `#${e.id}`
          }))}
          placeholder={emps.length ? '—' : 'Никого не найдено'}
        />
      </Field>
      <Field label="Дата с">
        <TextInput type="date" value={dateFrom} onChange={setDateFrom} />
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={() => modal.close()}>Отмена</Btn>
        <Btn
          variant="primary"
          disabled={busy || !workId || !empId}
          onClick={async () => {
            setBusy(true);
            try {
              await api('/api/site-crew/add', {
                method: 'POST',
                body: {
                  work_id: Number(workId),
                  employee_id: Number(empId),
                  date_from: dateFrom
                }
              });
              toast.success('Добавлен, РП уведомлён');
              modal.close();
              onDone?.();
            } catch (e) {
              toast.error(e?.serverMsg || e?.message || String(e));
            } finally {
              setBusy(false);
            }
          }}
        >Добавить</Btn>
      </div>
    </div>
  );
}

function CrewRow({ workId, c, hit, onDone }) {
  const modal = useModal();
  const rem = c.removal;
  const dir = c.last_travel_direction === 'to_site' ? '→ туда'
    : (c.last_travel_direction === 'from_site' ? '← обратно' : '—');

  let action = (
    <Btn
      variant="ghost"
      size="sm"
      onClick={() => modal.open(
        <WarnModal workId={workId} employeeId={c.employee_id} fio={c.fio} onDone={onDone} />
      )}
    >Снять с объекта</Btn>
  );
  if (rem?.can_force) {
    action = (
      <Btn
        variant="danger"
        size="sm"
        onClick={() => modal.open(
          <ForceModal workId={workId} employeeId={c.employee_id} fio={c.fio} onDone={onDone} />
        )}
      >Снять принудительно</Btn>
    );
  } else if (rem) {
    action = <span style={{ fontSize: 12, color: 'var(--t-2)' }}>Ждём РП · ещё ~{rem.hours_left || '?'} ч</span>;
  }

  return (
    <tr className={hit ? 'sc-hit' : undefined}>
      <td>
        <b style={{ color: 'var(--t-1)' }}>{c.fio}</b>
        {c.position && <div style={{ fontSize: 11, color: 'var(--t-2)' }}>{c.position}</div>}
      </td>
      <td>{c.since || '—'}</td>
      <td>{dir}</td>
      <td style={{ textAlign: 'right' }}>{action}</td>
    </tr>
  );
}

export default function SiteCrewPage() {
  const { user } = useAuth();
  const modal = useModal();
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  const hasAccess = !!(user && ROLES.includes(user.role));

  const load = useCallback(() => {
    if (!hasAccess) return;
    setLoading(true);
    api('/api/site-crew/matrix')
      .then((r) => setWorks(r?.works || []))
      .catch((e) => toast.error(e?.serverMsg || e?.message || String(e)))
      .finally(() => setLoading(false));
  }, [hasAccess]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  const filtered = useMemo(() => filterWorks(works, qDebounced), [works, qDebounced]);

  useEffect(() => {
    const qn = norm(qDebounced);
    if (!qn || !filtered.length) return;
    const next = new Set(expanded);
    let changed = false;
    const onlyOne = filtered.length === 1;
    for (const row of filtered) {
      if (row.crewHits.size > 0 || onlyOne) {
        if (!next.has(row.work.work_id)) {
          next.add(row.work.work_id);
          changed = true;
        }
      }
    }
    if (changed) setExpanded(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to filter changes
  }, [qDebounced, filtered]);

  const toggle = (workId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(workId)) next.delete(workId);
      else next.add(workId);
      return next;
    });
  };

  const totalPeople = works.reduce((s, w) => s + ((w.crew || []).length), 0);
  const filteredPeople = filtered.reduce((s, x) => s + ((x.work.crew || []).length), 0);
  const statText = qDebounced.trim()
    ? `${filtered.length} из ${works.length} объектов · ${filteredPeople} чел.`
    : `${works.length} объектов · ${totalPeople} чел.`;

  if (!hasAccess) {
    return (
      <AccessDenied
        allowed={ROLES}
        userRole={user?.role || '—'}
        title="Кто на объектах"
        message="Страница доступна Рук. ТО, администратору и директорам."
      />
    );
  }

  return (
    <div className="page">
      <TopActionsBar
        kicker="Дружина"
        title="Кто на объектах"
        subtitle="Активные назначения · предупреждение РП · принудительное снятие"
        actions={(
          <>
            <Btn variant="primary" onClick={() => modal.open(<AddModal onDone={load} />)}>
              ＋ Добавить на объект
            </Btn>
            <Btn variant="ghost" onClick={load}>↻ Обновить</Btn>
          </>
        )}
      />

      <div className="sc-page-filters">
        <TextInput
          value={q}
          onChange={setQ}
          placeholder="ФИО, объект или РП…"
          clearable
          aria-label="Поиск по ФИО, объекту или РП"
        />
        <span className="sc-stat">{statText}</span>
      </div>

      {loading && <div style={{ color: 'var(--t-2)', padding: 12 }}>Загрузка…</div>}
      {!loading && !works.length && (
        <EmptyState title="Нет активных назначений" hint="Добавьте рабочего на объект" />
      )}
      {!loading && works.length > 0 && !filtered.length && (
        <EmptyState title="Ничего не найдено" hint="Измените запрос ФИО / объект / РП" />
      )}

      {!loading && filtered.map(({ work: w, crewHits }) => {
        const open = expanded.has(w.work_id);
        const meta = [w.customer_name, w.city, w.pm_name ? `РП: ${w.pm_name}` : null]
          .filter(Boolean)
          .join(' · ');
        return (
          <div key={w.work_id} className={'sc-block' + (open ? ' open' : '')}>
            <button
              type="button"
              className="sc-block-head"
              aria-expanded={open}
              onClick={() => toggle(w.work_id)}
            >
              <span className="sc-chevron" aria-hidden="true">▶</span>
              <div className="sc-block-title">{w.work_title}</div>
              <div className="sc-block-meta">{meta}</div>
              <span className="sc-badge">{(w.crew || []).length} чел.</span>
            </button>
            {open && (
              <div className="sc-block-body">
                <table>
                  <thead>
                    <tr>
                      <th>Рабочий</th>
                      <th>На объекте с</th>
                      <th>Дорога</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(w.crew || []).map((c) => (
                      <CrewRow
                        key={c.employee_id}
                        workId={w.work_id}
                        c={c}
                        hit={crewHits.has(c.employee_id)}
                        onDone={load}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
