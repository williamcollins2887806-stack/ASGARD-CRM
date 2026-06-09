import { useEffect, useState, useCallback } from 'react';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';

/**
 * Гейт «где я сегодня» для офисных сотрудников в мобильной СРМ (/m/).
 * Тот же источник, что и десктоп/График офиса — POST /api/daily-presence (staff_plan).
 * Блокирует приложение, пока сотрудник не отметится.
 */
export default function PresenceGateMobile() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const [info, setInfo] = useState(null);     // ответ /today
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(null);
  const [workId, setWorkId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const check = useCallback(async () => {
    if (!token || !user) return;
    let res;
    try { res = await api.get('/daily-presence/today'); }
    catch (e) { return; }                       // сеть упала — не блокируем
    const serverDate = res?.server_date || new Date().toISOString().slice(0, 10);
    const lsKey = 'presence_done_' + serverDate;
    if (localStorage.getItem(lsKey) === '1') return;
    if (!res?.required) { localStorage.setItem(lsKey, '1'); return; }
    setInfo({ ...res, lsKey });
    setOpen(true);
  }, [token, user]);

  useEffect(() => { check(); }, [check]);

  if (!open || !info) return null;

  const statuses = (info.statuses && info.statuses.length) ? info.statuses : [
    { code: 'оф', label: 'В офисе', emoji: '🏢' }, { code: 'уд', label: 'Удалёнка', emoji: '🏠' },
    { code: 'км', label: 'Командировка', emoji: '🚗' }, { code: 'бн', label: 'Больничный', emoji: '🤒' },
    { code: 'сс', label: 'За свой счёт', emoji: '🌴' }, { code: 'вх', label: 'Выходной', emoji: '🛌' },
  ];
  const works = info.works || [];
  const firstName = (user?.name || '').trim().split(/\s+/).slice(-1)[0];
  const greet = firstName ? `Привет, ${firstName}!` : 'Доброго дня, воин!';

  async function save() {
    if (!chosen) { setErr('Выбери, где ты сегодня'); return; }
    let wid = null;
    if (chosen === 'об') {
      wid = parseInt(workId, 10) || null;
      if (!wid) { setErr('Выбери работу'); return; }
    }
    setSaving(true); setErr('');
    try {
      await api.post('/daily-presence', { status_code: chosen, work_id: wid });
      localStorage.setItem(info.lsKey, '1');
      setOpen(false);
    } catch (e) {
      setErr('Не удалось сохранить. Повтори.');
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100000, display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'rgba(6,9,16,0.94)', backdropFilter: 'blur(6px)', padding: 16,
    }}>
      <div style={{
        width: 'min(440px,94vw)', maxHeight: '92vh', overflow: 'auto',
        background: 'linear-gradient(160deg,#10182b,#161019)', border: '1px solid #2a3550',
        borderRadius: 18, padding: '24px 20px', boxShadow: '0 20px 60px #000a, inset 0 0 0 1px #d8b15a22',
        color: '#e9eff8',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 24 }}>🛡️</span>
          <div style={{
            fontSize: 19, fontWeight: 900,
            background: 'linear-gradient(90deg,#6aa6ff,#ffd36a)', WebkitBackgroundClip: 'text',
            backgroundClip: 'text', color: 'transparent',
          }}>{greet}</div>
        </div>
        <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 3 }}>Отметься в дружину — где ты сегодня держишь строй?</div>
        <div style={{ fontSize: 11.5, opacity: 0.5, marginBottom: 14 }}>Без отметки чертог закрыт. Запись попадёт в «График офиса».</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
          {statuses.map((o) => {
            const on = chosen === o.code;
            return (
              <button key={o.code} onClick={() => { setChosen(o.code); setErr(''); }}
                style={{
                  padding: '12px 10px', borderRadius: 11, cursor: 'pointer', fontSize: 13.5, fontWeight: 700,
                  textAlign: 'left', transition: '.15s', color: on ? '#fff' : '#cdd9ec',
                  background: on ? '#1a2236' : '#111726', border: `1.5px solid ${on ? '#d8b15a' : '#243049'}`,
                }}>
                {(o.emoji ? o.emoji + ' ' : '') + o.label}
              </button>
            );
          })}
        </div>

        {chosen === 'об' && (
          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 12, opacity: 0.7 }}>Твоя работа</label>
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
