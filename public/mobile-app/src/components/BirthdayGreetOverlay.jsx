import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { GiftArt, GIFT_META } from '@/lib/birthdayArt';
import './birthday-greet.css';

const TONE_META = { warm: 'Тёплый', saga: 'Сага', light: 'Лёгкий' };
const OPEN_EVENT = 'asgard:bd-open-atelier';

function mskDayKey() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

function initials(name) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return 'А';
  return ((p[0][0] || '') + (p[1]?.[0] || '')).toUpperCase();
}

function haptic(pattern = [16, 36, 16]) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch { /* ignore */ }
}

export function openBirthdayAtelier(person) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: person }));
}

/**
 * Mobile birthday ritual — premium parity with desktop.
 */
export default function BirthdayGreetOverlay() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const [mode, setMode] = useState(null);
  const [today, setToday] = useState([]);
  const [selected, setSelected] = useState(null);
  const [gift, setGift] = useState('flowers');
  const [tone, setTone] = useState('warm');
  const [sending, setSending] = useState(false);
  const [inbox, setInbox] = useState([]);
  const [asgard, setAsgard] = useState(null);
  const [idx, setIdx] = useState(-1);
  const [error, setError] = useState('');

  const userId = user?.id;
  const dismissKey = useMemo(() => (userId ? `bd_banner_${userId}_${mskDayKey()}` : ''), [userId]);
  const revealKey = useMemo(() => (userId ? `bd_reveal_seen_${userId}_${mskDayKey()}` : ''), [userId]);

  const close = useCallback(() => setMode(null), []);

  const openAtelierFor = useCallback((person) => {
    if (!person?.id) return;
    setSelected(person);
    setGift('flowers');
    setTone('warm');
    setSending(false);
    setError('');
    setMode('atelier');
  }, []);

  useEffect(() => {
    const onOpen = (e) => openAtelierFor(e.detail);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [openAtelierFor]);

  const load = useCallback(async () => {
    if (!userId || loading) return;
    try {
      const force = typeof window !== 'undefined'
        && /bd_reveal=1/.test(window.location.search + window.location.hash);
      const inboxRes = await api.get('/birthday-gifts/inbox?unread=1');
      const items = inboxRes.items || [];
      const unread = inboxRes.unread || 0;
      if (unread > 0 || (force && (items.length || inboxRes.asgard))) {
        setInbox(items);
        setAsgard(inboxRes.asgard || null);
        setIdx(items.length ? -1 : 0);
        setMode('reveal');
        haptic([18, 40, 18, 40, 24]);
        return;
      }

      if (localStorage.getItem(dismissKey) === '1') return;

      const todayRes = await api.get('/birthday-gifts/today');
      const peers = (todayRes.items || []).filter((it) => !it.is_me);
      if (!peers.length) return;
      setToday(todayRes.items || []);
      setSelected(peers[0]);
      setMode('invite');
    } catch {
      /* optional overlay */
    }
  }, [userId, loading, dismissKey]);

  useEffect(() => {
    if (loading || !userId) return undefined;
    const t = setTimeout(load, 1800);
    return () => clearTimeout(t);
  }, [load, loading, userId]);

  const currentGift = inbox[idx];
  const currentGiftId = currentGift?.id;
  const currentGiftReady = currentGift?.message_status === 'ready' && !!currentGift?.message_text;
  const showHall = mode === 'reveal' && idx < 0 && inbox.length > 0;
  const showAsgardFinale = mode === 'reveal' && idx >= inbox.length && asgard;
  const showGift = mode === 'reveal' && currentGift && !showAsgardFinale && idx >= 0;

  useEffect(() => {
    if (!showGift || !currentGiftId || currentGiftReady) return undefined;
    const giftId = currentGiftId;
    const t = setInterval(async () => {
      try {
        const fresh = await api.get('/birthday-gifts/inbox');
        const updated = (fresh.items || []).find((x) => Number(x.id) === Number(giftId));
        if (updated && updated.message_status === 'ready' && updated.message_text) {
          setInbox((prev) => prev.map((it) => (Number(it.id) === Number(giftId) ? { ...it, ...updated } : it)));
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(t);
  }, [showGift, currentGiftId, currentGiftReady]);

  async function sendGift() {
    if (!selected || sending) return;
    setSending(true);
    setError('');
    try {
      await api.post('/birthday-gifts', {
        to_user_id: selected.id,
        gift_type: gift,
        tone,
      });
      haptic([12, 30, 12]);
      setMode('fly');
      try { localStorage.setItem(dismissKey, '1'); } catch { /* ignore */ }
      setTimeout(() => setMode(null), 1250);
    } catch (e) {
      setError(e?.status === 409 ? 'Ты уже поздравил' : (e?.message || 'Не удалось отправить'));
      setSending(false);
    }
  }

  async function finishReveal() {
    try { await api.post('/birthday-gifts/inbox/open-all', {}); } catch { /* ignore */ }
    try { localStorage.setItem(revealKey, '1'); } catch { /* ignore */ }
    setMode(null);
  }

  async function openCurrentGift() {
    const g = inbox[idx];
    if (g?.id) {
      try { await api.post(`/birthday-gifts/${g.id}/open`, {}); } catch { /* ignore */ }
    }
    if (idx + 1 < inbox.length) {
      setIdx((v) => v + 1);
      haptic([10, 24, 10]);
      return;
    }
    if (asgard) {
      setIdx(inbox.length);
      return;
    }
    await finishReveal();
  }

  if (!mode) return null;

  const peers = today.filter((it) => !it.is_me);
  const meta = GIFT_META[gift] || GIFT_META.flowers;
  const giftMeta = currentGift ? (GIFT_META[currentGift.gift_type] || GIFT_META.flowers) : null;

  return (
    <div className="mbd-root" role="dialog" aria-modal="true">
      <div
        className="mbd-dim"
        onClick={() => {
          if (mode === 'invite') {
            try { localStorage.setItem(dismissKey, '1'); } catch { /* ignore */ }
            close();
          }
        }}
      />
      <div className="mbd-stage">
        {mode === 'invite' && (
          <div className="mbd-card">
            <div className="mbd-eyebrow">Асгард · день воина</div>
            <h2 className="mbd-title">В зале сегодня праздник</h2>
            <p className="mbd-sub">Оставь дар — текст напишет Асгард по дороге</p>
            <div className="mbd-hall">
              {peers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`mbd-person ${selected?.id === p.id ? 'is-on' : ''}`}
                  onClick={() => setSelected(p)}
                >
                  <div className="mbd-av">{initials(p.name)}</div>
                  <div className="mbd-name">{p.name}</div>
                  <div className="mbd-meta">{p.age != null ? `сегодня ${p.age} лет` : 'сегодня'}</div>
                  {p.already_sent ? <div className="mbd-sent">дар уже отправлен</div> : null}
                </button>
              ))}
            </div>
            <div className="mbd-actions">
              <button
                type="button"
                className="mbd-btn mbd-btn-ghost"
                onClick={() => {
                  try { localStorage.setItem(dismissKey, '1'); } catch { /* ignore */ }
                  close();
                }}
              >
                Позже
              </button>
              <button
                type="button"
                className="mbd-btn mbd-btn-gold"
                disabled={!selected || selected.already_sent}
                onClick={() => openAtelierFor(selected)}
              >
                Поздравить
              </button>
            </div>
          </div>
        )}

        {mode === 'atelier' && selected && (
          <div className="mbd-card">
            <div className="mbd-eyebrow">Ателье даров</div>
            <h2 className="mbd-title">Дар для {selected.name}</h2>
            <p className="mbd-sub">Выбери материю и тон — свиток напишется сам</p>
            <div className="mbd-gifts">
              {Object.keys(GIFT_META).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`mbd-gift ${gift === k ? 'is-on' : ''}`}
                  onClick={() => setGift(k)}
                >
                  <div className="mbd-gift-art-wrap"><GiftArt type={k} /></div>
                  <div className="mbd-gift-name">{GIFT_META[k].name}</div>
                  <div className="mbd-gift-hint">{GIFT_META[k].hint}</div>
                </button>
              ))}
            </div>
            <div className="mbd-tones">
              {Object.entries(TONE_META).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`mbd-tone ${tone === k ? 'is-on' : ''}`}
                  onClick={() => setTone(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            {error ? <div className="mbd-error">{error}</div> : null}
            <div className="mbd-actions">
              <button
                type="button"
                className="mbd-btn mbd-btn-ghost"
                onClick={() => (peers.length ? setMode('invite') : close())}
              >
                Назад
              </button>
              <button type="button" className="mbd-btn mbd-btn-gold" disabled={sending} onClick={sendGift}>
                {sending ? 'Отправка…' : 'Отправить дар'}
              </button>
            </div>
            <p className="mbd-sub" style={{ marginTop: 10, marginBottom: 0 }}>{meta.scene}</p>
          </div>
        )}

        {mode === 'fly' && (
          <div className="mbd-card mbd-fly">
            <div className="mbd-orb" />
            <div>Дар улетел в зал</div>
          </div>
        )}

        {showHall && (
          <div className="mbd-card">
            <div className="mbd-eyebrow">Зал даров</div>
            <h2 className="mbd-title">Тебе оставили дары</h2>
            <p className="mbd-sub">
              {inbox.length === 1 ? 'Один дар ждёт тебя' : `Даров в зале: ${inbox.length}`}
            </p>
            <div className="mbd-actions">
              <button type="button" className="mbd-btn mbd-btn-ghost" onClick={finishReveal}>Позже</button>
              <button
                type="button"
                className="mbd-btn mbd-btn-gold"
                onClick={() => { setIdx(0); haptic([10, 24, 10]); }}
              >
                Открыть
              </button>
            </div>
          </div>
        )}

        {showGift && (
          <div className="mbd-card">
            <div className="mbd-eyebrow">Дар {idx + 1} из {inbox.length}</div>
            <h2 className="mbd-title">{giftMeta?.name || 'Дар'}</h2>
            <p className="mbd-sub">от {currentGift.from_name}{giftMeta?.scene ? ` · ${giftMeta.scene}` : ''}</p>
            <div className="mbd-scene">
              <GiftArt type={currentGift.gift_type} />
            </div>
            {currentGiftReady ? (
              <div className="mbd-letter">
                <div className="mbd-letter-from">От {currentGift.from_name}</div>
                {currentGift.message_text}
              </div>
            ) : (
              <div className="mbd-pending">Свиток ещё пишется золотыми нитями…</div>
            )}
            <div className="mbd-actions">
              <button type="button" className="mbd-btn mbd-btn-ghost" onClick={finishReveal}>Закрыть</button>
              <button type="button" className="mbd-btn mbd-btn-gold" onClick={openCurrentGift}>
                {idx + 1 < inbox.length || asgard ? 'Далее' : 'В добрый путь'}
              </button>
            </div>
          </div>
        )}

        {showAsgardFinale && (
          <div className="mbd-card">
            <div className="mbd-eyebrow">И от всего Асгарда</div>
            <h2 className="mbd-title">День воина</h2>
            <p className="mbd-sub">официальное слово команды</p>
            <div className="mbd-letter">{asgard.message_email || asgard.message_sms}</div>
            <div className="mbd-actions">
              <span />
              <button type="button" className="mbd-btn mbd-btn-gold" onClick={finishReveal}>В добрый путь</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
