import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Check, X as XIcon, MessageCircle, Wallet, Clock, ChevronRight, AlertTriangle } from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';

/**
 * DirectorApprovals — главная страница согласования cash_requests для DIRECTOR_COMM.
 *
 * Бизнес-логика (Stage W):
 *   • DIRECTOR_COMM открывает на мобилке → видит все ожидающие запросы (status='requested')
 *   • Сортировка: новые сверху по created_at
 *   • Тап → BottomSheet «Заявка на выдачу»: кто/сумма/категория/назначение/комментарий + «🏦 В кассе: X → После: X−amount»
 *   • 3 кнопки: ✅ Одобрить / ❓ Уточнить / ❌ Отказать (большие, тапабельные ≥56px)
 *   • Push: подписка на `asgard:cash:changed` → авто-refresh списка
 */

/* ── 12 категорий (стандарт Stage W) ───────────────────────────── */
const CASH_CATEGORIES = {
  fuel_service:     { icon: '⛽', label: 'ГСМ служ.' },
  fuel_personal:    { icon: '⛽', label: 'ГСМ личн.' },
  taxi:             { icon: '🚕', label: 'Такси' },
  accommodation:    { icon: '🏨', label: 'Проживание' },
  food_brigade:     { icon: '🍲', label: 'Продукты бригаде' },
  materials:        { icon: '🧱', label: 'Материалы' },
  tool:             { icon: '🔧', label: 'Инструмент' },
  tech_rent:        { icon: '🚛', label: 'Аренда техники' },
  communication:    { icon: '📞', label: 'Связь/интернет' },
  representational: { icon: '🥂', label: 'Представит.' },
  urgent_repair:    { icon: '🚨', label: 'Срочный ремонт' },
  other:            { icon: '📦', label: 'Другое' },
};

function getCategoryIcon(code) {
  return (CASH_CATEGORIES[code] || {}).icon || '💼';
}
function getCategoryLabel(code) {
  return (CASH_CATEGORIES[code] || {}).label || (code || '—');
}

/* ── Тип заявки → подпись ──────────────────────────────────────── */
const TYPE_LABELS = {
  advance: 'Аванс',
  office:  'Офис',
  other:   'Прочее',
};

export default function DirectorApprovals() {
  const user      = useAuthStore((s) => s.user);
  const navigate  = useNavigate();
  const haptic    = useHaptic();
  // 17.10.2026: тап по виджету на главной открывает нужную вкладку
  // (/director-approvals?tab=payouts|cash|invoices|plan) — так «выплаты» из
  // виджета ведут сразу к выплатам, а не на «Кассу» по умолчанию.
  const [searchParams, setSearchParams] = useSearchParams();

  const [pending,     setPending]     = useState([]);
  const [balance,     setBalance]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [opened,      setOpened]      = useState(null);
  const [actionBusy,  setActionBusy]  = useState(false);
  // V391: единый экран директора = 4 вкладки (заказчик 15.10.2026).
  // 17.10.2026: стартовую вкладку берём из URL (?tab=...) — тап по виджету
  // на главной ведёт СРАЗУ на нужную очередь (счета/выплаты/касса/план).
  const [tab,         setTab]         = useState(() => {
    const t = searchParams.get('tab');
    return ['cash', 'invoices', 'payouts', 'plan'].includes(t) ? t : 'cash';
  });
  // Выплаты (корзина Димы)
  const [payBatch,    setPayBatch]    = useState([]);
  const [payBusy,     setPayBusy]     = useState(false);
  // План на 1-е число
  const [plan,        setPlan]        = useState(null);
  const [invoices,    setInvoices]    = useState([]);
  const [invBusy,     setInvBusy]     = useState(false);
  // V391: шторка причины возврата — вместо window.prompt (не премиум-уровень).
  // askReason = { title, onConfirm } | null
  const [askReason,   setAskReason]   = useState(null);
  const [reasonText,  setReasonText]  = useState('');

  /* ── Loader ────────────────────────────────────────────────── */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, balRes, payRes, invRes] = await Promise.all([
        api.get('/cash/all?status=requested').catch(() => null),
        api.get('/cash/balance').catch(() => null),
        api.get('/payout-cart/pending').catch(() => null),
        api.get('/payment-invoices?status=awaiting_dir').catch(() => null),
      ]);

      let rows = api.extractRows(reqRes) || [];
      // Бэк может вернуть весь список — на всякий случай фильтруем по статусу
      rows = rows.filter((r) => r.status === 'requested');
      // Сверху самые срочные = старые сверху? Нет — новые сверху, чтоб не пропустить свежее.
      // По контракту: «Сортировка: сверху самые срочные (по created_at)».
      // Интерпретируем как «давно ждут» = старые сверху (срочнее).
      rows.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
      setPending(rows);
      setBalance(balRes);
      // V391: список выплат от Димы
      const payItems = (payRes && (payRes.items || payRes.rows)) || [];
      setPayBatch(Array.isArray(payItems) ? payItems : []);
      // V391: счета, ждущие решения директора
      let inv = api.extractRows(invRes) || [];
      if (!inv.length && invRes && Array.isArray(invRes)) inv = invRes;
      setInvoices(Array.isArray(inv) ? inv : []);
    } catch {
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 17.10.2026: синхронизируем вкладку с URL — при обновлении страницы и
  // возврате «назад» директор попадает на ту же очередь, а не на «Кассу».
  useEffect(() => {
    const cur = searchParams.get('tab');
    if (cur !== tab) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', tab);
      setSearchParams(next, { replace: true });
    }
  }, [tab, searchParams, setSearchParams]);

  /* ── Push-event subscription (asgard:cash:changed) ─────────── */
  useEffect(() => {
    const handler = () => { fetchData(); };
    window.addEventListener('asgard:cash:changed', handler);
    // Дополнительно — мягкий polling 60с (на случай отсутствия push)
    const t = setInterval(fetchData, 60000);
    return () => {
      window.removeEventListener('asgard:cash:changed', handler);
      clearInterval(t);
    };
  }, [fetchData]);

  /* ── RBAC-guard ────────────────────────────────────────────── */
  const role = user?.role || '';
  const isAuthorized =
    role === 'DIRECTOR_COMM' ||
    role === 'DIRECTOR_GEN' ||
    role === 'DIRECTOR_DEV' ||
    role === 'ADMIN';

  /* ── V391: шторка причины (замена window.prompt) ───────────── */
  const openReasonSheet = useCallback((title) => {
    setReasonText('');
    return new Promise((resolve) => {
      setAskReason({ title, resolve });
    });
  }, []);

  const closeReasonSheet = useCallback((value) => {
    setAskReason((cur) => {
      if (cur) cur.resolve(value);
      return null;
    });
    setReasonText('');
  }, []);

  /* ── Действия ──────────────────────────────────────────────── */
  const handleAction = useCallback(async (action) => {
    if (!opened || actionBusy) return;
    setActionBusy(true);
    try {
      if (action === 'approve') {
        haptic.success();
        await api.put(`/cash/${opened.id}/approve`);
      } else if (action === 'reject') {
        const comment = await openReasonSheet('Причина отказа');
        if (comment == null) { setActionBusy(false); return; }
        haptic.medium();
        await api.put(`/cash/${opened.id}/reject`, { comment });
      } else if (action === 'question') {
        const message = await openReasonSheet('Что уточнить у автора?');
        if (message == null) { setActionBusy(false); return; }
        haptic.light();
        await api.put(`/cash/${opened.id}/question`, { message, comment: message });
      }
      // Локально убираем заявку из pending
      setPending((p) => p.filter((r) => r.id !== opened.id));
      setOpened(null);
      // Сообщаем другим подписчикам
      window.dispatchEvent(new CustomEvent('asgard:cash:changed'));
    } catch (e) {
      haptic.error();
      window.alert('Ошибка: ' + (e.message || 'не удалось выполнить'));
    } finally {
      setActionBusy(false);
    }
  }, [opened, actionBusy, haptic, openReasonSheet]);

  const cashBalance = useMemo(() => {
    if (!balance) return 0;
    return Number(
      balance.total_balance ?? balance.balance ?? balance.on_hand ?? 0
    );
  }, [balance]);

  /* ── V391: решения по списку выплат ─────────────────────────── */
  const payDecide = useCallback(async (itemId, action) => {
    if (payBusy) return;
    if (action === 'reject') {
      // Причина обязательна — спрашиваем шторкой, не браузерным prompt.
      const reason = await openReasonSheet('Возврат выплаты Дмитрию Путкову');
      if (reason == null) return;
      setPayBusy(true);
      try {
        haptic.medium();
        await api.post(`/payout-cart/items/${itemId}/reject`, { reason });
        setPayBatch((p) => p.filter((x) => x.item_id !== itemId));
      } catch (e) {
        haptic.error();
        window.alert('Ошибка: ' + (e.message || 'не удалось выполнить'));
      } finally { setPayBusy(false); }
      return;
    }
    setPayBusy(true);
    try {
      haptic.success();
      await api.post(`/payout-cart/items/${itemId}/approve`);
      setPayBatch((p) => p.filter((x) => x.item_id !== itemId));
    } catch (e) {
      haptic.error();
      window.alert('Ошибка: ' + (e.message || 'не удалось выполнить'));
    } finally { setPayBusy(false); }
  }, [payBusy, haptic]);

  const payApproveAll = useCallback(async () => {
    if (!payBatch.length || payBusy) return;
    setPayBusy(true);
    try {
      haptic.success();
      await api.post(`/payout-cart/batch/${payBatch[0].batch_id}/approve-all`);
      setPayBatch([]);
    } catch (e) {
      haptic.error();
      window.alert('Ошибка: ' + (e.message || 'не удалось утвердить'));
    } finally { setPayBusy(false); }
  }, [payBatch, payBusy, haptic]);

  /* ── V391: вернуть весь список с причиной ─────────────────────── */
  const payRejectAll = useCallback(async () => {
    if (!payBatch.length || payBusy) return;
    const reason = await openReasonSheet('Возврат всего списка');
    if (reason == null) return;
    setPayBusy(true);
    try {
      haptic.medium();
      await api.post(`/payout-cart/batch/${payBatch[0].batch_id}/reject`, { reason });
      setPayBatch([]);
    } catch (e) {
      haptic.error();
      window.alert('Ошибка: ' + (e.message || 'не удалось вернуть'));
    } finally { setPayBusy(false); }
  }, [payBatch, payBusy, haptic, openReasonSheet]);

  /* ── V391: план на 1-е число ───────────────────────────────── */
  const loadPlan = useCallback(async () => {
    try {
      const now = new Date();
      const y = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
      const m = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
      const res = await api.get(`/payout-plan/${y}/${m}`);
      setPlan(res);
    } catch { setPlan(null); }
  }, []);

  useEffect(() => { if (tab === 'plan') loadPlan(); }, [tab, loadPlan]);

  /* ── V391: решения по счетам ───────────────────────────────── */
  const invoiceDecide = useCallback(async (id, action) => {
    if (invBusy) return;
    if (action === 'reject') {
      const reason = await openReasonSheet('Возврат счёта поставщику');
      if (reason == null) return;
      setInvBusy(true);
      try {
        haptic.medium();
        await api.post(`/payment-invoices/${id}/dir-reject`, { reason });
        setInvoices((p) => p.filter((x) => x.id !== id));
      } catch (e) {
        haptic.error();
        window.alert('Ошибка: ' + (e.message || 'не удалось выполнить'));
      } finally { setInvBusy(false); }
      return;
    }
    setInvBusy(true);
    try {
      haptic.success();
      await api.post(`/payment-invoices/${id}/dir-approve`);
      setInvoices((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      haptic.error();
      window.alert('Ошибка: ' + (e.message || 'не удалось выполнить'));
    } finally { setInvBusy(false); }
  }, [invBusy, haptic, openReasonSheet]);

  if (!isAuthorized) {
    return (
      <PageShell title="Согласование" showBack>
        <div className="p-6">
          <div
            className="dapr-no-access rounded-2xl p-5 text-center"
            style={{
              background: 'color-mix(in srgb, var(--red-soft) 8%, var(--bg-surface))',
              border: '0.5px solid color-mix(in srgb, var(--red-soft) 25%, var(--border-norse))',
            }}
          >
            <AlertTriangle size={32} style={{ color: 'var(--red)', margin: '0 auto 8px' }} />
            <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              Доступ только для коммерческого директора
            </p>
            <p className="mt-1" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              Ваша роль: {role || '—'}
            </p>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Согласование"
      showBack
      onBack={() => navigate('/')}
    >
      <PullToRefresh onRefresh={fetchData}>
        {/* ─── Header: count + balance ─────────────────────── */}
        <div
          className="dapr-header rounded-2xl px-5 py-4 mb-3"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--blue) 14%, var(--bg-surface)), color-mix(in srgb, var(--gold) 6%, var(--bg-surface)))',
            border: '0.5px solid color-mix(in srgb, var(--blue) 25%, var(--border-norse))',
            animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards',
          }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p
                className="dapr-count"
                style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.05 }}
              >
                {tab === 'payouts' ? payBatch.length : tab === 'invoices' ? invoices.length : pending.length}
              </p>
              <p
                className="dapr-count-label"
                style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}
              >
                {(() => {
                  const n = tab === 'payouts' ? payBatch.length : tab === 'invoices' ? invoices.length : pending.length;
                  return n === 0 ? 'нет ожидающих' : 'ждут согласования';
                })()}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p
                className="dapr-balance"
                style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}
              >
                🏦 В кассе
              </p>
              <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--gold)', marginTop: 2 }}>
                {formatMoney(cashBalance, { short: true })}
              </p>
            </div>
          </div>
        </div>

        {/* ─── V391: Вкладки — Касса / Счета / Выплаты / План ── */}
        <div className="dapr-tabs flex gap-1.5 overflow-x-auto pb-1 mb-3">
          {[
            { id: 'cash',     label: 'Касса',   n: pending.length },
            { id: 'invoices', label: 'Счета',   n: invoices.length },
            { id: 'payouts',  label: 'Выплаты', n: payBatch.length },
            { id: 'plan',     label: 'План',    n: 0 },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => { haptic.light(); setTab(t.id); }}
              className="spring-tap shrink-0"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '10px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                minHeight: 44,
                background: tab === t.id
                  ? 'color-mix(in srgb, var(--gold) 16%, var(--bg-surface))'
                  : 'color-mix(in srgb, var(--bg-surface) 80%, transparent)',
                border: tab === t.id
                  ? '0.5px solid color-mix(in srgb, var(--gold) 45%, var(--border-norse))'
                  : '0.5px solid var(--border-norse)',
                color: tab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {t.label}
              {t.n > 0 && (
                <span
                  style={{
                    minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                    background: 'var(--value)', color: 'var(--value-ink)',
                    fontSize: 11, fontWeight: 800, display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {t.n}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ─── List (по вкладкам) ──────────────────────────── */}
        {loading ? (
          <SkeletonList count={4} />
        ) : tab === 'cash' ? (
          pending.length === 0 ? (
            <EmptyState
              icon={Check}
              iconColor="var(--green)"
              iconBg="color-mix(in srgb, var(--green) 10%, transparent)"
              title="Всё согласовано"
              description="Новые заявки появятся здесь автоматически"
            />
          ) : (
            <div className="flex flex-col gap-2 pb-4">
              {pending.map((req, i) => (
                <RequestCard
                  key={req.id}
                  req={req}
                  index={i}
                  onTap={() => { haptic.light(); setOpened(req); }}
                />
              ))}
            </div>
          )
        ) : tab === 'payouts' ? (
          <PayoutsTab
            items={payBatch}
            busy={payBusy}
            onDecide={payDecide}
            onApproveAll={payApproveAll}
            onRejectAll={payRejectAll}
          />
        ) : tab === 'invoices' ? (
          <InvoicesTab
            items={invoices}
            busy={invBusy}
            onDecide={invoiceDecide}
          />
        ) : (
          <PlanTab plan={plan} />
        )}
      </PullToRefresh>

      {opened && (
        <RequestDetailSheet
          req={opened}
          cashBalance={cashBalance}
          busy={actionBusy}
          onAction={handleAction}
          onClose={() => setOpened(null)}
        />
      )}

      {/* V391: причина возврата — своя шторка вместо window.prompt */}
      <BottomSheet
        open={!!askReason}
        onClose={() => closeReasonSheet(null)}
        title={askReason?.title || 'Причина возврата'}
        footer={
          <div className="flex gap-2">
            <button
              onClick={() => closeReasonSheet(null)}
              className="spring-tap flex-1"
              style={{
                minHeight: 46, borderRadius: 14, fontWeight: 600, fontSize: 14,
                background: 'transparent', border: '0.5px solid var(--border-norse)',
                color: 'var(--text-secondary)',
              }}
            >
              Отмена
            </button>
            <button
              onClick={() => { if (reasonText.trim()) closeReasonSheet(reasonText.trim()); }}
              disabled={!reasonText.trim()}
              className="spring-tap flex-1"
              style={{
                minHeight: 46, borderRadius: 14, fontWeight: 700, fontSize: 14,
                background: reasonText.trim()
                  ? 'color-mix(in srgb, var(--red-soft) 18%, var(--bg-surface))'
                  : 'color-mix(in srgb, var(--text-tertiary) 12%, var(--bg-surface))',
                border: '0.5px solid color-mix(in srgb, var(--red-soft) 40%, var(--border-norse))',
                color: 'var(--text-primary)',
                opacity: reasonText.trim() ? 1 : 0.55,
              }}
            >
              Вернуть с причиной
            </button>
          </div>
        }
      >
        <div className="px-1 pb-2">
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 10 }}>
            Причина обязательна — её увидит отправитель.
          </p>
          <textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Например: уточните сумму, нет лимита НПД, неверный получатель"
            style={{
              width: '100%', minHeight: 96, padding: 12, borderRadius: 12, fontSize: 15,
              background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
              border: '0.5px solid var(--border-norse)',
              color: 'var(--text-primary)', resize: 'none',
            }}
          />
        </div>
      </BottomSheet>
    </PageShell>
  );
}

/* ══════════════════════════════════════════════════════════════
   V391: Вкладка «Выплаты» — список от Димы Путкова
   ══════════════════════════════════════════════════════════════ */
function PayoutsTab({ items, busy, onDecide, onApproveAll, onRejectAll }) {
  if (!items || !items.length) {
    return (
      <div className="pb-4">
        <EmptyState
          icon={Check}
          iconColor="var(--green)"
          iconBg="color-mix(in srgb, var(--green) 10%, transparent)"
          title="Всё согласовано"
          description="Дмитрий Путков ещё не отправлял новую корзину"
        />
      </div>
    );
  }
  const totalTransfer = items.reduce((s, x) => s + Number(x.transfer_amount || 0), 0);
  const totalGot = items.reduce((s, x) => s + Number(x.info_amount || 0), 0);
  const totalPay = items.reduce((s, x) => s + Number(x.pay_amount || 0), 0);

  return (
    <div className="flex flex-col gap-2 pb-4">
      <div
        className="rounded-2xl px-4 py-3 mb-1"
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--gold) 14%, var(--bg-surface)), var(--bg-surface))',
          border: '0.5px solid color-mix(in srgb, var(--gold) 30%, var(--border-norse))',
        }}
      >
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
          Всего к переводу · {items.length} чел.
        </p>
        <p style={{ fontSize: 26, fontWeight: 800, color: 'var(--gold)', lineHeight: 1.1, marginTop: 2 }}>
          {formatMoney(totalTransfer)}
        </p>
        <div className="flex justify-between mt-2" style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
          <span>Выплачиваем <b style={{ color: 'var(--text-primary)' }}>{formatMoney(totalPay)}</b></span>
          <span>Налог/сбор <b style={{ color: 'var(--text-primary)' }}>{formatMoney(totalTransfer - totalGot)}</b></span>
        </div>
        <div className="flex justify-between mt-1" style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
          <span>Получат работники</span>
          <b style={{ color: 'var(--green)' }}>{formatMoney(totalGot)}</b>
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.4 }}>
          Рабочий получит уведомление и подтвердит получение кодом. Каждый — отдельно.
        </p>
      </div>

      {items.map((it, i) => (
        <PayoutCard key={it.item_id || it.employee_id} it={it} index={i} busy={busy} onDecide={onDecide} />
      ))}

      <button
        onClick={onApproveAll}
        disabled={busy}
        className="spring-tap w-full"
        style={{
          marginTop: 6, minHeight: 46, borderRadius: 14, fontWeight: 700, fontSize: 14,
          background: 'color-mix(in srgb, var(--green) 18%, var(--bg-surface))',
          border: '0.5px solid color-mix(in srgb, var(--green) 45%, var(--border-norse))',
          color: 'var(--text-primary)', opacity: busy ? 0.6 : 1,
        }}
      >
        Согласовать всех ({items.length})
      </button>
      <button
        onClick={onRejectAll}
        disabled={busy}
        className="spring-tap w-full"
        style={{
          marginTop: 6, minHeight: 44, borderRadius: 14, fontWeight: 600, fontSize: 13.5,
          background: 'transparent',
          border: '0.5px solid color-mix(in srgb, var(--red-soft) 40%, var(--border-norse))',
          color: 'var(--text-secondary)', opacity: busy ? 0.6 : 1,
        }}
      >
        Вернуть весь список
      </button>
    </div>
  );
}

function PayoutCard({ it, index, busy, onDecide }) {
  const tag = it.is_self_employed
    ? { t: 'СЗ', bg: 'color-mix(in srgb, var(--blue) 12%, transparent)', c: 'var(--blue)' }
    : it.official_transfer
      ? { t: 'НДФЛ +15%', bg: 'color-mix(in srgb, var(--purple) 14%, transparent)', c: 'var(--purple)' }
      : { t: 'Наличные', bg: 'color-mix(in srgb, var(--text-tertiary) 12%, transparent)', c: 'var(--text-secondary)' };
  const fio = it.fio || '—';
  const parts = fio.split(' ');
  const shortFio = parts.slice(0, 2).join(' ');
  const initials = ((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '');
  const got = Number(it.info_amount || 0);
  const total = Number(it.transfer_amount || 0);
  const pay = Number(it.pay_amount || 0);
  const tax = total - got;
  // Ставка/природа сбора — как в рендере mApprovals («сбор+НДС 22%» / «+15% НДФЛ» / «1:1»).
  const taxNote = it.is_self_employed ? 'сбор+НДС 22%' : (it.official_transfer ? '+15% НДФЛ' : '1:1');

  return (
    <div
      className="rounded-2xl"
      style={{
        background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
        border: it.reapproved
          ? '0.5px solid color-mix(in srgb, var(--gold) 45%, var(--border-norse))'
          : '0.5px solid var(--border-norse)',
        padding: '14px 16px',
        animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${index * 35}ms both`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          {/* Аватар с инициалами — как m-card__ic в рендере */}
          <div
            aria-hidden="true"
            style={{
              width: 36, height: 36, borderRadius: 999, flexShrink: 0,
              display: 'grid', placeItems: 'center',
              fontSize: 12.5, fontWeight: 800, color: '#fff',
              background: 'linear-gradient(150deg, var(--blue), color-mix(in srgb, var(--blue) 60%, #000))',
              letterSpacing: 0.3,
            }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{shortFio}</p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: tag.bg, color: tag.c }}>{tag.t}</span>
              {it.reapproved && (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'color-mix(in srgb, var(--gold) 18%, transparent)', color: 'var(--gold)' }}>
                  повторно
                </span>
              )}
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {it.kind === 'advance' ? 'Аванс' : 'Зарплата'}{it.payee_fio ? ` · через ${it.payee_fio.split(' ')[0]}` : ''}
              </span>
            </div>
          </div>
        </div>
        <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{formatMoney(pay)}</span>
      </div>

      <div className="mt-2.5" style={{ display: 'grid', gap: 4 }}>
        <MKV label="Остаток" value={formatMoney(Number(it.carry_debt || 0) - Number(it.carry_advance || 0))} />
        <MKV label="Начислено" value={formatMoney(Number(it.accrued || 0))} />
        <MKV label="Выплачиваем" value={formatMoney(pay)} />
        <MKV label={`Налог / сбор (${taxNote})`} value={formatMoney(tax)} />
        <MKV label="Всего к переводу" value={formatMoney(total)} color="var(--gold)" bold />
        <MKV label="Человеку придёт" value={formatMoney(got)} color="var(--green)" bold />
        {it.is_self_employed && it.se_remaining != null && (
          <MKV label="Лимит НПД свободно" value={formatMoney(Number(it.se_remaining))} />
        )}
      </div>

      {/* Статус-бейдж состояния позиции — как в рендере */}
      <div className="flex items-center justify-between mt-2.5">
        <span
          style={{
            fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
            background: 'color-mix(in srgb, var(--gold) 15%, transparent)',
            color: 'var(--gold)',
            border: '0.5px solid color-mix(in srgb, var(--gold) 35%, transparent)',
          }}
        >
          {it.reapproved ? 'правка после согласования' : 'ждёт вашего решения'}
        </span>
      </div>

      {it.comment && (
        <p className="mt-2" style={{ fontSize: 11.5, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>«{it.comment}» — Дима</p>
      )}

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onDecide(it.item_id, 'approve')}
          disabled={busy}
          className="spring-tap flex-1"
          style={{
            minHeight: 40, borderRadius: 12, fontWeight: 700, fontSize: 13,
            background: 'color-mix(in srgb, var(--green) 18%, var(--bg-surface))',
            border: '0.5px solid color-mix(in srgb, var(--green) 45%, var(--border-norse))',
            color: 'var(--text-primary)', opacity: busy ? 0.6 : 1,
          }}
        >
          Согласовать
        </button>
        <button
          onClick={() => onDecide(it.item_id, 'reject')}
          disabled={busy}
          className="spring-tap"
          style={{
            minHeight: 40, padding: '0 16px', borderRadius: 12, fontWeight: 600, fontSize: 13,
            background: 'transparent',
            border: '0.5px solid var(--border-norse)', color: 'var(--text-secondary)',
            opacity: busy ? 0.6 : 1,
          }}
        >
          Вернуть
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   V391: Вкладка «Счета» — счета, ждущие решения директора
   ══════════════════════════════════════════════════════════════ */
/** TTL 72ч: бейдж остатка на решение директора. */
function ttlBadge(expiresAt) {
  if (!expiresAt) return null;
  const left = new Date(expiresAt) - Date.now();
  if (left <= 0) return <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--red)' }}>срок истёк</span>;
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const urgent = h < 12;
  return (
    <span style={{ fontSize: 10.5, fontWeight: 600, color: urgent ? 'var(--red)' : 'var(--text-tertiary)' }}>
      ⏱ {h} ч {m} мин
    </span>
  );
}

function InvoicesTab({ items, busy, onDecide }) {
  if (!items || !items.length) {
    return (
      <div className="pb-4">
        <EmptyState
          icon={Check}
          iconColor="var(--green)"
          iconBg="color-mix(in srgb, var(--green) 10%, transparent)"
          title="Нет счетов на согласовании"
          description="Все счета рассмотрены"
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 pb-4">
      {items.map((inv, i) => (
        <div
          key={inv.id}
          className="rounded-2xl"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
            border: '0.5px solid var(--border-norse)',
            padding: '14px 16px',
            animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 35}ms both`,
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                {inv.supplier_name || `Счёт #${inv.id}`}
              </p>
              <p style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 2 }}>
                {inv.basis_text ? String(inv.basis_text).slice(0, 60) : 'Основание не указано'}
              </p>
              {/* 17.10: директору нужно больше контекста — от кого счёт и сколько осталось на решение (TTL 72ч). */}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {inv.initiator_name && (
                  <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>от {String(inv.initiator_name).split(' ')[0]}</span>
                )}
                {inv.supplier_inn && (
                  <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>ИНН {inv.supplier_inn}</span>
                )}
                {ttlBadge(inv.approval_expires_at)}
              </div>
            </div>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
              {formatMoney(Number(inv.amount || 0))}
            </span>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onDecide(inv.id, 'approve')}
              disabled={busy}
              className="spring-tap flex-1"
              style={{
                minHeight: 40, borderRadius: 12, fontWeight: 700, fontSize: 13,
                background: 'color-mix(in srgb, var(--green) 18%, var(--bg-surface))',
                border: '0.5px solid color-mix(in srgb, var(--green) 45%, var(--border-norse))',
                color: 'var(--text-primary)', opacity: busy ? 0.6 : 1,
              }}
            >
              Согласовать
            </button>
            <button
              onClick={() => onDecide(inv.id, 'reject')}
              disabled={busy}
              className="spring-tap"
              style={{
                minHeight: 40, padding: '0 16px', borderRadius: 12, fontWeight: 600, fontSize: 13,
                background: 'transparent',
                border: '0.5px solid var(--border-norse)', color: 'var(--text-secondary)',
                opacity: busy ? 0.6 : 1,
              }}
            >
              Вернуть
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   V391: Вкладка «План» — планирование выплат на 1-е число
   ══════════════════════════════════════════════════════════════ */
function PlanTab({ plan }) {
  if (!plan) {
    return <div className="pb-4"><SkeletonList count={4} /></div>;
  }
  const rows = (plan.rows || []).filter((r) => Number(r.to_pay) > 0 || Number(r.max_amount) > 0);
  const totalToPay = rows.reduce((s, r) => s + Number(r.to_pay || 0), 0);
  const approvedSum = rows.filter((r) => r.approved).reduce((s, r) => s + Number(r.to_transfer || 0), 0);
  const approvedCnt = rows.filter((r) => r.approved).length;

  return (
    <div className="flex flex-col gap-2 pb-4">
      <div
        className="rounded-2xl px-4 py-3"
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--blue) 12%, var(--bg-surface)), var(--bg-surface))',
          border: '0.5px solid color-mix(in srgb, var(--blue) 28%, var(--border-norse))',
        }}
      >
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
          К выплате всего · {rows.length} чел.
        </p>
        <p style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1, marginTop: 2 }}>
          {formatMoney(totalToPay)}
        </p>
        <div className="mt-2">
          <div className="flex justify-between" style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <span>Согласовано</span>
            <span><b style={{ color: 'var(--green)' }}>{formatMoney(approvedSum)}</b> · {approvedCnt}/{rows.length}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'color-mix(in srgb, var(--text-tertiary) 20%, transparent)', marginTop: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${rows.length ? Math.round(approvedCnt / rows.length * 100) : 0}%`, background: 'var(--green)', borderRadius: 3, transition: 'width 300ms ease' }} />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          iconColor="var(--gold)"
          iconBg="color-mix(in srgb, var(--gold) 10%, transparent)"
          title="Нет данных за период"
          description="План появится после закрытия табеля"
        />
      ) : (
        rows.slice(0, 40).map((r, i) => (
          <div
            key={r.employee_id}
            className="rounded-2xl"
            style={{
              background: r.approved
                ? 'color-mix(in srgb, var(--green) 8%, var(--bg-surface))'
                : 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
              border: r.approved
                ? '0.5px solid color-mix(in srgb, var(--green) 32%, var(--border-norse))'
                : '0.5px solid var(--border-norse)',
              padding: '12px 14px',
              animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 25}ms both`,
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                  {(r.fio || '—').split(' ').slice(0, 2).join(' ')}
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {r.is_self_employed ? 'СЗ' : r.is_officially_employed ? 'НДФЛ +15%' : 'Наличные'}
                  {r.is_self_employed && r.se_remaining != null ? ` · лимит свободно ${formatMoney(r.se_remaining, { short: true })}` : ''}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{formatMoney(r.to_pay)}</p>
                <p style={{ fontSize: 11, color: 'var(--gold)' }}>макс. {formatMoney(r.max_amount, { short: true })}</p>
              </div>
            </div>
          </div>
        ))
      )}
      {rows.length > 40 && (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>
          и ещё {rows.length - 40} получателей… (полный план — на десктопе)
        </p>
      )}
    </div>
  );
}

function MKV({ label, value, color, bold }) {
  return (
    <div className="flex justify-between" style={{ fontSize: 12.5 }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color: color || 'var(--text-primary)', fontWeight: bold ? 700 : 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   RequestCard — карточка заявки в списке
   ══════════════════════════════════════════════════════════════ */
function RequestCard({ req, index, onTap }) {
  const author =
    req.user_fio ||
    req.user_name ||
    req.author_fio ||
    req.author_name ||
    (req.user_login ? `@${req.user_login}` : '—');
  const amount = Number(req.amount || 0);

  // Сколько ждёт — раскраска
  const waitingMs = Date.now() - new Date(req.created_at || Date.now()).getTime();
  const waitingH = Math.floor(waitingMs / 3600000);
  const isUrgent = waitingH >= 24;

  return (
    <button
      onClick={onTap}
      className="dapr-card w-full text-left spring-tap"
      style={{
        background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: isUrgent
          ? '0.5px solid color-mix(in srgb, var(--red-soft) 30%, var(--border-norse))'
          : '0.5px solid var(--border-norse)',
        borderRadius: 16,
        padding: '14px 16px',
        animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${index * 35}ms both`,
      }}
    >
      <div className="dapr-card-top flex items-start justify-between gap-2">
        <p
          className="dapr-card-author"
          style={{
            fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
            lineHeight: 1.2, minWidth: 0, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {author}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="dapr-card-amount"
            style={{ fontSize: 16, fontWeight: 800, color: 'var(--gold)' }}
          >
            {formatMoney(amount, { short: true })}
          </span>
          <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />
        </div>
      </div>

      <div
        className="dapr-card-mid flex items-center gap-1.5 mt-1.5 flex-wrap"
        style={{ minHeight: 18 }}
      >
        <span
          className="dapr-cat"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 600,
            padding: '2px 8px', borderRadius: 999,
            background: 'color-mix(in srgb, var(--blue) 10%, transparent)',
            color: 'var(--blue)',
          }}
        >
          <span style={{ fontSize: 13 }}>{getCategoryIcon(req.category)}</span>
          {getCategoryLabel(req.category)}
        </span>
        {req.purpose && (
          <span
            className="dapr-purpose"
            style={{
              fontSize: 12, color: 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 220,
            }}
          >
            · {req.purpose}
          </span>
        )}
      </div>

      <div
        className="dapr-card-bot flex items-center gap-1 mt-2"
        style={{ fontSize: 11, color: isUrgent ? 'var(--red)' : 'var(--text-tertiary)' }}
      >
        <Clock size={11} />
        <span style={{ fontWeight: isUrgent ? 700 : 500 }}>
          {relativeTime(req.created_at)}
        </span>
        {isUrgent && (
          <span style={{ marginLeft: 6, fontWeight: 700 }}>· ждёт {waitingH}ч</span>
        )}
      </div>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════
   RequestDetailSheet — BottomSheet с деталями + 3 кнопки
   ══════════════════════════════════════════════════════════════ */
function RequestDetailSheet({ req, cashBalance, busy, onAction, onClose }) {
  const author =
    req.user_fio ||
    req.user_name ||
    req.author_fio ||
    req.author_name ||
    (req.user_login ? `@${req.user_login}` : '—');

  const amount = Number(req.amount || 0);
  const cashAfter = cashBalance - amount;
  const willBeNegative = cashAfter < 0;

  const useSe = !!req.use_se_payee;

  return (
    <BottomSheet open onClose={onClose} title="Заявка на выдачу">
      <div className="dapr-detail flex flex-col gap-3 pb-4">
        {/* ── Поля ─────────────────────────────────────────── */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '0.5px solid var(--border-norse)' }}
        >
          <DKV label="Кто" value={author} />
          <DKV label="Тип" value={TYPE_LABELS[req.type] || req.type || '—'} />
          <DKV label="Сумма" value={formatMoney(amount)} valueColor="var(--gold)" valueBold />
          <DKV
            label="Категория"
            value={
              <span>
                <span style={{ marginRight: 6 }}>{getCategoryIcon(req.category)}</span>
                {getCategoryLabel(req.category)}
              </span>
            }
          />
          <DKV label="Назначение" value={req.purpose || '—'} multiline />
          {req.work_title && <DKV label="Проект" value={req.work_title} />}
          {req.created_at && <DKV label="Создано" value={relativeTime(req.created_at)} />}
        </div>

        {/* ── Пояснительная записка ────────────────────────── */}
        {req.cover_letter && (
          <div
            className="dapr-d-letter rounded-xl px-4 py-3"
            style={{
              background: 'color-mix(in srgb, var(--blue) 6%, var(--bg-surface))',
              border: '0.5px solid color-mix(in srgb, var(--blue) 20%, var(--border-norse))',
            }}
          >
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>
              📝 Пояснительная записка
            </p>
            <p style={{ fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
              {req.cover_letter}
            </p>
          </div>
        )}

        {/* ── Описание «Другое» ────────────────────────────── */}
        {req.category === 'other' && req.category_other_desc && (
          <div
            className="dapr-d-other rounded-xl px-4 py-3"
            style={{
              background: 'color-mix(in srgb, var(--gold) 6%, var(--bg-surface))',
              border: '0.5px solid color-mix(in srgb, var(--gold) 20%, var(--border-norse))',
            }}
          >
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>
              «Другое» — описание
            </p>
            <p style={{ fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
              {req.category_other_desc}
            </p>
          </div>
        )}

        {/* ── СЗ-перевод flag ─────────────────────────────── */}
        {useSe && (
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-2"
            style={{
              background: 'color-mix(in srgb, var(--green) 8%, var(--bg-surface))',
              border: '0.5px solid color-mix(in srgb, var(--green) 25%, var(--border-norse))',
            }}
          >
            <span style={{ fontSize: 18 }}>💳</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>
                Выдача через СЗ-перевод
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                Не из кассы — на лимит самозанятого
                {req.se_payee_fio && ` · ${req.se_payee_fio}`}
              </p>
            </div>
          </div>
        )}

        {/* ── Balance preview ─────────────────────────────── */}
        <div
          className={`dapr-balance-preview rounded-xl px-4 py-3 ${willBeNegative ? 'warn' : 'ok'}`}
          style={{
            background: willBeNegative
              ? 'color-mix(in srgb, var(--red-soft) 10%, var(--bg-surface))'
              : 'color-mix(in srgb, var(--green) 8%, var(--bg-surface))',
            border: willBeNegative
              ? '0.5px solid color-mix(in srgb, var(--red-soft) 30%, var(--border-norse))'
              : '0.5px solid color-mix(in srgb, var(--green) 20%, var(--border-norse))',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>🏦 В кассе</p>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatMoney(cashBalance)}
              </p>
            </div>
            <span style={{ fontSize: 18, color: 'var(--text-tertiary)' }}>→</span>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>После</p>
              <p
                style={{
                  fontSize: 15, fontWeight: 700,
                  color: willBeNegative ? 'var(--red)' : 'var(--green)',
                }}
              >
                {useSe ? formatMoney(cashBalance) /* СЗ не трогает кассу */ : formatMoney(cashAfter)}
              </p>
            </div>
          </div>
          {willBeNegative && !useSe && (
            <div className="error mt-2 flex items-center gap-1.5" style={{ color: 'var(--red)', fontSize: 12, fontWeight: 600 }}>
              <AlertTriangle size={13} /> Не хватит в кассе!
            </div>
          )}
        </div>

        {/* ── Действия ────────────────────────────────────── */}
        <div className="dapr-actions flex flex-col gap-2 mt-1">
          <button
            className="dapr-btn dapr-approve"
            onClick={() => onAction('approve')}
            disabled={busy}
            style={{
              minHeight: 56,
              borderRadius: 16,
              fontSize: 16,
              fontWeight: 700,
              background: 'color-mix(in srgb, var(--green) 18%, transparent)',
              color: 'var(--green)',
              border: '0.5px solid color-mix(in srgb, var(--green) 30%, var(--border-norse))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: busy ? 0.6 : 1,
              transition: 'opacity var(--motion-fast)',
            }}
          >
            <Check size={20} /> Одобрить
          </button>

          <button
            className="dapr-btn dapr-question"
            onClick={() => onAction('question')}
            disabled={busy}
            style={{
              minHeight: 56,
              borderRadius: 16,
              fontSize: 16,
              fontWeight: 700,
              background: 'color-mix(in srgb, var(--blue) 14%, transparent)',
              color: 'var(--blue)',
              border: '0.5px solid color-mix(in srgb, var(--blue) 28%, var(--border-norse))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: busy ? 0.6 : 1,
            }}
          >
            <MessageCircle size={20} /> Уточнить
          </button>

          <button
            className="dapr-btn dapr-reject"
            onClick={() => onAction('reject')}
            disabled={busy}
            style={{
              minHeight: 56,
              borderRadius: 16,
              fontSize: 16,
              fontWeight: 700,
              background: 'color-mix(in srgb, var(--red-soft) 14%, transparent)',
              color: 'var(--red)',
              border: '0.5px solid color-mix(in srgb, var(--red-soft) 28%, var(--border-norse))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: busy ? 0.6 : 1,
            }}
          >
            <XIcon size={20} /> Отказать
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

/* ── Маленький KV-ряд ──────────────────────────────────────── */
function DKV({ label, value, valueColor, valueBold, multiline }) {
  return (
    <div
      className="dapr-d-kv px-4 py-3"
      style={{
        background: 'var(--bg-surface)',
        borderBottom: '0.5px solid var(--border-norse)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: multiline ? 'flex-start' : 'center',
        gap: 12,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 14,
          color: valueColor || 'var(--text-primary)',
          fontWeight: valueBold ? 700 : 500,
          textAlign: 'right',
          whiteSpace: multiline ? 'pre-wrap' : 'normal',
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
    </div>
  );
}
