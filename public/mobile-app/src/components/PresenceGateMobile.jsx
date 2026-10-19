import { useEffect, useState, useCallback } from 'react';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';

/**
 * Гейт присутствия для офисных сотрудников в мобильной СРМ (/m/).
 *
 * Заказчик (18.10.2026): сотрудник заполняет РАБОЧУЮ НЕДЕЛЮ (пн–пт) целиком,
 * а не только «сегодня». Зашёл не в понедельник — спрашиваем текущую неделю.
 * Тот же источник, что у десктопа: POST /api/daily-presence/week → staff_plan,
 * поэтому отметка сразу видна в «Графике офиса».
 */
export default function PresenceGateMobile() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState({});   // { 'YYYY-MM-DD': code }
  const [workId, setWorkId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const check = useCallback(async () => {
    if (!token || !user) return;
    let res;
    try { res = await api.get('/daily-presence/week'); }
    catch (e) { return; }                       // сеть упала — не блокируем
    const weekStart = res?.week_start || res?.server_date || new Date().toISOString().slice(0, 10);
    const lsKey = 'presence_week_done_' + weekStart;
    if (localStorage.getItem(lsKey) === '1') return;
    if (!res?.required) { localStorage.setItem(lsKey, '1'); return; }
    setInfo({ ...res, lsKey });
    // Предзаполняем тем, что уже отмечено
    const init = {};
    (res.days || []).forEach((d) => { if (d.status_code && !d.on_vacation) init[d.date] = d.status_code; });
    setPicked(init);
    setOpen(true);
  }, [token, user]);

  useEffect(() => { check(); }, [check]);

  if (!open || !info) return null;

  const statuses = (info.statuses && info.statuses.length) ? info.statuses : [
    { code: 'оф', label: 'В офисе' }, { code: 'уд', label: 'Удалёнка' },
    { code: 'км', label: 'Командировка' }, { code: 'бн', label: 'Больничный' },
    { code: 'сс', label: 'За свой счёт' }, { code: 'вх', label: 'Выходной' },
  ];
  const works = info.works || [];
  const days = info.days || [];
  const firstName = (user?.name || '').trim().split(/\s+/).slice(-1)[0];
  const greet = firstName ? `Привет, ${firstName}!` : 'Доброго дня, воин!';
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const dayLabel = (iso) => {
    const p = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return `${WD[dt.getUTCDay()]}, ${String(p[2]).padStart(2, '0')}.${String(p[1]).padStart(2, '0')}`;
  };

  async function save() {
    const payload = Object.keys(picked)
      .filter((d) => picked[d])
      .map((d) => ({ date: d, status_code: picked[d], work_id: picked[d] === 'об' ? (parseInt(workId, 10) || null) : null }));
    if (!payload.length) { setErr('Отметь хотя бы один день'); return; }
    if (payload.some((p) => p.status_code === 'об') && !workId) { setErr('Выбери работу для «На объекте»'); return; }

    setSaving(true); setErr('');
    try {
      await api.post('/daily-presence/week', { days: payload });
      localStorage.setItem(info.lsKey, '1');
      setOpen(false);
    } catch (e) {
      setErr(e?.message || 'Не удалось сохранить. Повтори.');
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100000, display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'rgba(6,9,16,0.94)', backdropFilter: 'blur(6px)', padding: 16,
    }}>
      <div style={{
        width: 'min(460px,94vw)', maxHeight: '92vh', overflow: 'auto',
        background: 'linear-gradient(160deg,#10182b,#161019)', border: '1px solid #2a3550',
        borderRadius: 18, padding: '24px 20px', boxShadow: '0 20px 60px #000a, inset 0 0 0 1px #d8b15a22',
        color: '#e9eff8',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 24 }}>🛡️</span>
          <div style={{ fontSize: 19, fontWeight: 900 }}>{greet}</div>
        </div>
        <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 3 }}>
          Заполни рабочую неделю — где ты будешь держать строй?
        </div>
        <div style={{ fontSize: 11.5, opacity: 0.5, marginBottom: 14 }}>
          Только рабочие дни (пн–пт). Запись попадёт в «График офиса».
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {days.map((d) => {
            if (d.on_vacation) {
              return (
                <div key={d.date} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 10, background: '#16233a',
                }}>
                  <span style={{ width: 70, fontSize: 12, opacity: 0.7 }}>{dayLabel(d.date)}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#e9c46a' }}>Отпуск</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.55 }}>согласовано</span>
                </div>
              );
            }
            return (
              <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 70, fontSize: 12, opacity: 0.7 }}>{dayLabel(d.date)}</span>
                <select
                  value={picked[d.date] || ''}
                  onChange={(e) => { setPicked((p) => ({ ...p, [d.date]: e.target.value })); setErr(''); }}
                  style={{
                    flex: 1, padding: 9, borderRadius: 9, background: '#111726',
                    color: '#e9eff8', border: '1px solid #2a3550', fontSize: 13,
                  }}
                >
                  <option value="">— выбери —</option>
                  {statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
              </div>
            );
          })}
        </div>

        {Object.values(picked).includes('об') && (
          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 12, opacity: 0.7 }}>Работа (для «На объекте»)</label>
            <select value={workId} onChange={(e) => setWorkId(e.target.value)}
              style={{
                width: '100%', marginTop: 5, padding: 10, borderRadius: 10,
                background: '#111726', color: '#e9eff8', border: '1px solid #2a3550',
              }}>
              <option value="">— выбери —</option>
              {works.map((w) => (
                <option key={w.id} value={w.id}>{w.title}{w.place ? ` · ${w.place}` : ''}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ color: '#f85149', fontSize: 12, marginTop: 10, minHeight: 16 }}>{err}</div>
        <button onClick={save} disabled={saving}
          style={{
            width: '100%', marginTop: 6, padding: 13, border: 'none', borderRadius: 11, cursor: 'pointer',
            background: 'linear-gradient(135deg,#1f6fff,#7a3aff)', color: '#fff', fontSize: 15, fontWeight: 800,
            opacity: saving ? 0.7 : 1,
          }}>
          {saving ? 'Сохранение...' : '⚔ В строй'}
        </button>
      </div>
    </div>
  );
}
