/**
 * Раздача входящих тендеров (TO/HEAD_TO/ADMIN).
 * Vanilla-источник: tenders.js → renderDistribution (~715..865).
 *
 * Кнопки:
 *   • "→ Передать РП на просчёт" → POST /assign-calculator { kind:'pm', user_id }
 *   • "✓ Считает ТО" (только HEAD_TO/ADMIN) → POST /assign-calculator { kind:'to' }
 *
 * НЕ через PUT /api/tenders { pm_id } — vanilla явно использует /assign-calculator,
 * который выставляет calculator_user_id + статус и пишет аудит.
 */
import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { SelectInput } from '@/inputs/Inputs';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { loadUsers } from '../api';

export default function DistributionPanel({ user }) {
  const [pending, setPending] = useState([]);
  const [pms, setPms] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(true);

  const role = user?.role;
  const allowed = ['TO', 'HEAD_TO', 'ADMIN'].includes(role);
  const canAssignToTo = ['HEAD_TO', 'ADMIN'].includes(role);

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    Promise.all([
      api('/api/tenders?status=draft&limit=100').then((d) => d.tenders || d.items || []).catch(() => []),
      loadUsers('PM,HEAD_PM') // F2: vanilla tenders.js:717 показывает обе роли
    ])
      .then(([list, pmList]) => {
        setPending(list.filter((t) => !t.pm_id).slice(0, 10));
        setPms(pmList);
      })
      .finally(() => setLoading(false));
  }, [allowed]);

  if (!allowed || (!loading && !pending.length)) return null;

  /* Отдать конкретному РП в просчёт. */
  const assignToPm = async (tenderId) => {
    const pmId = Number(assignments[tenderId] || 0);
    if (!pmId) return toast('Анализ', 'Выберите РП', 'warn');
    setBusyId(`pm-${tenderId}`);
    try {
      await api(`/api/tenders/${tenderId}/assign-calculator`, {
        method: 'POST',
        body: { kind: 'pm', user_id: pmId }
      });
      const pmName = pms.find((u) => String(u.id) === String(pmId))?.name || 'РП';
      toast('Анализ', `Тендер отправлен в просчёт РП ${pmName}`, 'ok');
      setPending((cur) => cur.filter((x) => x.id !== tenderId));
      setAssignments((a) => { const c = { ...a }; delete c[tenderId]; return c; });
      window.dispatchEvent(new CustomEvent('asgard:tenders:changed'));
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusyId(null);
    }
  };

  /* Передать на просчёт ТО (HEAD_TO/ADMIN). */
  const assignToTo = async (tenderId) => {
    setBusyId(`to-${tenderId}`);
    try {
      await api(`/api/tenders/${tenderId}/assign-calculator`, {
        method: 'POST',
        body: { kind: 'to' }
      });
      toast('Анализ', 'Тендер отдан на просчёт ТО', 'ok');
      setPending((cur) => cur.filter((x) => x.id !== tenderId));
      window.dispatchEvent(new CustomEvent('asgard:tenders:changed'));
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card tnd-panel tnd-panel--cyan">
      <div className="tnd-panel-head">
        <strong className="tnd-panel-title tnd-panel-title--cyan">
          📥 Раздать новые ({pending.length})
        </strong>
      </div>
      <div className="tnd-panel-grid">
        {pending.map((t) => (
          <div key={t.id} className="tnd-panel-card">
            <div>
              <span className="tnd-panel-card-id">#{t.id}</span>{' '}
              <strong className="tnd-panel-card-name">{t.customer_name || '—'}</strong>
            </div>
            <SelectInput
              value={assignments[t.id] || ''}
              onChange={(v) => setAssignments((a) => ({ ...a, [t.id]: v }))}
              options={[
                { value: '', label: '— РП для просчёта —' },
                ...pms.map((u) => ({
                  value: String(u.id),
                  // F2: HEAD_PM визуально отличаем префиксом «(Ст.РП)».
                  label: (u.role === 'HEAD_PM' ? '(Ст.РП) ' : '') + (u.name || u.login || '?')
                }))
              ]}
            />
            <div className="tnd-panel-card-actions">
              <Btn
                size="sm"
                variant="primary"
                disabled={busyId === `pm-${t.id}`}
                onClick={() => assignToPm(t.id)}
              >
                {busyId === `pm-${t.id}` ? '…' : '→ Передать РП'}
              </Btn>
              {canAssignToTo && (
                <Btn
                  size="sm"
                  disabled={busyId === `to-${t.id}`}
                  onClick={() => assignToTo(t.id)}
                >
                  {busyId === `to-${t.id}` ? '…' : '✓ Считает ТО'}
                </Btn>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
