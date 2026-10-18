import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * Несжимаемый баннер расчётной ведомости (мобильный PWA /m/).
 * ═══════════════════════════════════════════════════════════════════════════
 * Показывается рабочему после выплаты, пока он не подтвердит получение
 * (код из SMS/MAX) или не нажмёт «Не согласен / не получил».
 * Закрыть нельзя — по образцу PresenceGateMobile (fixed inset:0, без «×»).
 *
 * Источник: GET /api/payouts/my/pending (field_token).
 * Подтверждение: POST /api/payouts/my/:id/confirm { code }.
 * Спор: POST /api/payouts/my/:id/dispute { reason } → 2 телефона.
 *
 * Только токены темы мобильного приложения (var(--...)), без хардкод-цветов.
 */

const FIELD_TOKEN_KEY = 'field_token';
const BASE = '/api/payouts';

const KIND_LABELS = { advance: 'Аванс', salary: 'Зарплата' };
const TYPE_LABELS = { advance: 'Аванс', salary: 'Зарплата', bonus: 'Премия', penalty: 'Удержание', per_diem: 'Суточные' };

function money(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat('ru-RU').format(Math.round(v * 100) / 100) + ' ₽';
}

async function apiReq(method, path, body) {
  const token = localStorage.getItem(FIELD_TOKEN_KEY);
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || data.message || ('HTTP ' + res.status));
    e.body = data; e.status = res.status;
    throw e;
  }
  return data;
}

/** Активные неподтверждённые выплаты текущего рабочего. */
export function usePendingPayouts() {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!localStorage.getItem(FIELD_TOKEN_KEY)) { setReady(true); return; }
    try {
      const data = await apiReq('GET', '/my/pending');
      setItems(data.payments || []);
    } catch { /* сеть/авторизация — не блокируем приложение */ }
    finally { setReady(true); }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { items, ready, reload: load };
}

export default function PayoutStatementBanner() {
  const { items, ready, reload } = usePendingPayouts();
  const [step, setStep] = useState('view');   // view | confirm | dispute
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [contacts, setContacts] = useState(null);
  // Повторная отправка кода (заказчик 19.10.2026: рабочий должен уметь запросить
  // код сам, а не ждать, пока это сделает Дима).
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

  if (!ready || !items.length) return null;
  const p = items[0];
  const overdue = p.confirmation_deadline && new Date(p.confirmation_deadline) < new Date();

  async function submitConfirm() {
    // Код подтверждения выплаты — 5 цифр (см. src/lib/payout-notify.js, CODE_LENGTH=5).
    // Пробелы/дефисы из мессенджера убираем: рабочий часто копирует код из MAX.
    const clean = String(code).replace(/\D/g, '');
    if (clean.length !== 5) { setErr('Введите 5 цифр из SMS или MAX'); return; }
    setBusy(true); setErr('');
    try {
      await apiReq('POST', `/my/${p.id}/confirm`, { code: clean });
      await reload();
    } catch (e) {
      setErr(e.body && e.body.error === 'invalid_code' ? 'Неверный код' : (e.message || 'Ошибка'));
      setBusy(false);
    }
  }

  async function submitDispute() {
    setBusy(true); setErr('');
    try {
      const res = await apiReq('POST', `/my/${p.id}/dispute`, { reason });
      setContacts(res.contacts || {});
      setStep('dispute');
    } catch (e) { setErr(e.message || 'Ошибка'); }
    finally { setBusy(false); }
  }

  /** Запросить код повторно (рабочий сам, не через Диму). */
  async function requestNewCode() {
    if (resendBusy) return;
    setResendBusy(true); setResendMsg(''); setErr('');
    try {
      const r = await apiReq('POST', `/my/${p.id}/resend-code`, {});
      setResendMsg(r.message || 'Код отправлен. Проверьте SMS и чат MAX.');
    } catch (e) {
      // Кулдаун — не ошибка: показываем мягко, с остатком секунд.
      const b = e.body || {};
      setResendMsg(b.message || e.message || 'Не удалось отправить код');
    } finally {
      setResendBusy(false);
    }
  }

  return createPortal(
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 22 }}>💰</span>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--gold)' }}>
            Вам произведена выплата
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Подтвердите получение — это ваша расписка.
          {overdue && <span style={{ color: 'var(--danger-ink)' }}> Срок (72 ч) истёк, подтвердите.</span>}
        </div>

        {/* Расчётная ведомость. По ТЗ заказчика рабочему показываем ТОЛЬКО
            итоговую сумму (СЗ: X × 1.064). Комиссия площадки и НДС — внутренняя
            кухня компании, рабочему не показываем. */}
        <div style={statementStyle}>
          <Row label="Тип" value={KIND_LABELS[p.type] || TYPE_LABELS[p.type] || p.type} />
          {p.pay_year && <Row label="Период" value={`${String(p.pay_month).padStart(2, '0')}.${p.pay_year}`} />}
          <Row
            label="К выплате"
            value={money(p.info_amount != null ? p.info_amount : (p.transfer_amount || p.amount))}
            strong
          />
          {p.payout_platform && <Row label="Способ" value={payoutLabel(p.payout_platform)} />}
          {p.payout_recipient_note && <Row label="Кому обращаться" value={p.payout_recipient_note} />}
        </div>

        {step === 'view' && (
          <>
            <button onClick={() => { setStep('confirm'); setErr(''); }} disabled={busy} style={btnPrimary}>
              Подтвердить получение
            </button>
            <button onClick={() => { setStep('dispute'); setErr(''); }} disabled={busy} style={btnGhost}>
              Не согласен / не получил
            </button>
          </>
        )}

        {step === 'confirm' && (
          <>
            <label style={lbl}>Код из SMS или MAX (5 цифр)</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={5}
              placeholder="•••••"
              style={{ ...input, letterSpacing: 8, fontSize: 20, textAlign: 'center', fontWeight: 700 }}
            />
            <div style={errBox}>{err}</div>
            <button onClick={submitConfirm} disabled={busy} style={btnPrimary}>
              {busy ? 'Проверка…' : 'Подтвердить'}
            </button>
            {/* Повторный запрос кода: рабочий сам, не дожидаясь Димы. */}
            <button
              onClick={requestNewCode}
              disabled={resendBusy}
              style={{ ...btnGhost, opacity: resendBusy ? 0.6 : 1 }}
            >
              {resendBusy ? 'Отправляем…' : 'Не пришёл код? Отправить ещё раз'}
            </button>
            {resendMsg && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, marginBottom: 4, lineHeight: 1.35 }}>
                {resendMsg}
              </div>
            )}
            <button onClick={() => { setStep('view'); setErr(''); setResendMsg(''); }} style={btnGhost}>Назад</button>
          </>
        )}

        {step === 'dispute' && (
          contacts ? (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Обратитесь к ним — разберёмся:
              </div>
              {contacts.manager_phone && <ContactRow role="Выплаты" phone={contacts.manager_phone} />}
              {contacts.pm_phone && <ContactRow role="РП" phone={contacts.pm_phone} />}
              <button onClick={() => { setStep('view'); setErr(''); setContacts(null); reload(); }} style={btnGhost}>
                Закрыть
              </button>
            </>
          ) : (
            <>
              <label style={lbl}>Что не так? (необязательно)</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="например: не получил / сумма не та" style={input} />
              <div style={errBox}>{err}</div>
              <button onClick={submitDispute} disabled={busy} style={btnPrimary}>
                {busy ? 'Отправка…' : 'Отправить'}
              </button>
              <button onClick={() => { setStep('view'); setErr(''); }} style={btnGhost}>Назад</button>
            </>
          )
        )}
      </div>
    </div>,
    document.body
  );
}

function Row({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', fontSize: 13.5 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: strong ? 800 : 600, color: strong ? 'var(--gold)' : 'var(--text-primary)', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function ContactRow({ role, phone }) {
  const tel = String(phone).replace(/[^\d+]/g, '');
  return (
    <a href={`tel:${tel}`} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '11px 13px', borderRadius: 11, marginBottom: 8, textDecoration: 'none',
      background: 'var(--bg-surface-alt)', border: '1px solid var(--border-norse)',
      color: 'var(--text-primary)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{role}</span>
      <span style={{ fontWeight: 700 }}>{phone}</span>
    </a>
  );
}

function payoutLabel(p) {
  return { restaff: 'СЗ-сервис', card: 'С карты', bank: 'Через банк', cash: 'Наличные', other: 'Иное' }[p] || p;
}

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 100100, display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: 'var(--field-overlay)', backdropFilter: 'blur(6px)', padding: 16,
};
const cardStyle = {
  width: 'min(440px,94vw)', maxHeight: '92vh', overflow: 'auto',
  background: 'var(--bg-surface)', border: '1px solid var(--gold)',
  borderRadius: 18, padding: '22px 18px', color: 'var(--text-primary)',
  boxShadow: '0 20px 60px rgba(0,0,0,.55)',
};
const statementStyle = { background: 'var(--bg-surface-alt)', borderRadius: 12, padding: 14, marginBottom: 12 };
const btnPrimary = {
  width: '100%', padding: 14, marginBottom: 8, border: 'none', borderRadius: 12, cursor: 'pointer',
  background: 'var(--gold-gradient)', color: 'var(--text-on-gold)', fontSize: 15, fontWeight: 800,
};
const btnGhost = {
  width: '100%', padding: 12, border: '1px solid var(--border-light)', borderRadius: 12,
  cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600,
};
const input = {
  width: '100%', padding: 12, marginTop: 4, marginBottom: 6, borderRadius: 11,
  background: 'var(--bg-surface-alt)', color: 'var(--text-primary)',
  border: '1px solid var(--border-light)', fontSize: 15,
};
const lbl = { fontSize: 12, color: 'var(--text-secondary)' };
const errBox = { color: 'var(--danger-ink)', fontSize: 12.5, minHeight: 16, marginBottom: 6 };
