import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Check, Wallet, Send, AlertTriangle, ChevronRight } from 'lucide-react';
import { formatMoney } from '@/lib/utils';

/**
 * V391 — мобильная КОРЗИНА ВЫПЛАТ (экран бухгалтера/платёжного менеджера).
 * ═══════════════════════════════════════════════════════════════════════════
 * Зеркало рендера mDimaCart (prototypes/payout-approvals/assets/views.js).
 * Поток: собрать корзину → «Отправить на согласование» → директор одобряет
 * (поштучно/списком) или возвращает с причиной → выплата ТОЛЬКО после одобрения.
 *
 * Источник правды — серверный контур /api/payout-cart. Локально только кэш.
 */

const CART_READY = 'Готова к отправке';

function initials(fio) {
  const p = String(fio || '').trim().split(/\s+/);
  return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || '');
}
function shortFio(fio) {
  return String(fio || '').trim().split(/\s+/).slice(0, 2).join(' ') || '—';
}

export default function PmPayoutCart() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const haptic = useHaptic();

  const [items, setItems] = useState([]);       // позиции корзины/списка за период
  const [period, setPeriod] = useState(null);   // {year, month}
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const role = user?.role || '';

  /* Период выплат — предыдущий календарный месяц (как на десктопе). */
  const computePeriod = useCallback(() => {
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth();           // 0-based → это уже предыдущий месяц в 1-based
    if (m < 1) { m = 12; y -= 1; }
    return { year: y, month: m };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = computePeriod();
      setPeriod(p);
      const res = await api.get(`/payout-cart/${p.year}/${p.month}`);
      const list = (res.items || []).map((i) => ({
        itemId: i.item_id,
        batchId: i.batch_id,
        employeeId: i.employee_id,
        fio: i.fio,
        kind: i.kind,
        payAmount: Number(i.pay_amount || 0),
        transferAmount: Number(i.transfer_amount || 0),
        infoAmount: Number(i.info_amount || 0),
        approvalStatus: i.approval_status,
        reapproved: !!i.reapproved,
        rejectReason: i.reject_reason,
        comment: i.comment,
        batchStatus: i.status,
        // V391: способ выплаты — для правильной ставки налога/сбора
        // (СЗ → сбор+НДС 22%, НДФЛ → +15%, наличные → 1:1).
        isSelfEmployed: !!i.is_self_employed,
        officialTransfer: !!i.official_transfer,
      }));
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [computePeriod]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2600); };

  /* Отправить корзину на согласование директору. */
  const submit = useCallback(async () => {
    if (!period || busy) return;
    setBusy(true);
    try {
      haptic.success();
      await api.post('/payout-cart/submit', { year: period.year, month: period.month });
      showToast('Отправлено директору на согласование');
      await load();
    } catch (e) {
      haptic.error();
      showToast('Ошибка: ' + (e.message || 'не удалось отправить'));
    } finally { setBusy(false); }
  }, [period, busy, haptic, load]);

  const toApprove = items.filter((i) => i.approvalStatus !== 'approved');
  const toPay = items.filter((i) => i.approvalStatus === 'approved');
  const sum = (arr, k) => arr.reduce((s, x) => s + Number(x[k] || 0), 0);
  const totalTransfer = sum(items, 'transferAmount');
  const totalGot = sum(items, 'infoAmount');
  const totalPay = sum(items, 'payAmount');

  if (!role) return null;

  return (
    <PageShell title="Корзина выплат" showBack onBack={() => navigate('/pm')}>
      <PullToRefresh onRefresh={load}>
        {/* Итоги списка */}
        <div
          className="rounded-2xl px-5 py-4 mb-3"
          style={{
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--gold) 14%, var(--bg-surface)), var(--bg-surface))',
            border: '0.5px solid color-mix(in srgb, var(--gold) 30%, var(--border-norse))',
          }}
        >
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            Всего к переводу · {items.length} чел.
          </p>
          <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--gold)', lineHeight: 1.05, marginTop: 2 }}>
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
        </div>

        {/* Группы: на согласование / согласовано */}
        {loading ? (
          <SkeletonList count={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Wallet}
            iconColor="var(--gold)"
            iconBg="color-mix(in srgb, var(--gold) 10%, transparent)"
            title="Корзина пуста"
            description="Отметьте выплаты на странице «Выплаты» — они появятся здесь"
          />
        ) : (
          <>
            {toApprove.length > 0 && (
              <GroupHeader
                label={`На согласование · ${toApprove.length}`}
                sum={formatMoney(sum(toApprove, 'transferAmount'))}
              />
            )}
            {toApprove.map((it, i) => (
              <CartCard key={it.itemId || it.employeeId} it={it} index={i} />
            ))}
            {toPay.length > 0 && (
              <GroupHeader
                label={`Согласовано — к выплате · ${toPay.length}`}
                sum={formatMoney(sum(toPay, 'transferAmount'))}
              />
            )}
            {toPay.map((it, i) => (
              <CartCard key={it.itemId || it.employeeId} it={it} index={i} />
            ))}

            <div className="flex items-center justify-between mt-4 px-1" style={{ fontSize: 13 }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Итого к переводу</span>
              <b style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{formatMoney(totalTransfer)}</b>
            </div>
          </>
        )}

        {/* Действия */}
        {toApprove.length > 0 && (
          <button
            onClick={submit}
            disabled={busy}
            className="spring-tap w-full"
            style={{
              marginTop: 14, minHeight: 50, borderRadius: 14, fontWeight: 700, fontSize: 15,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: 'color-mix(in srgb, var(--gold) 20%, var(--bg-surface))',
              border: '0.5px solid color-mix(in srgb, var(--gold) 50%, var(--border-norse))',
              color: 'var(--text-primary)', opacity: busy ? 0.6 : 1,
            }}
          >
            <Send size={17} />
            Отправить на согласование ({toApprove.length})
          </button>
        )}
        {toPay.length > 0 && (
          <button
            onClick={() => navigate('/director-approvals')}
            className="spring-tap w-full"
            style={{
              marginTop: 10, minHeight: 46, borderRadius: 14, fontWeight: 600, fontSize: 13.5,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: 'transparent', border: '0.5px solid var(--border-norse)',
              color: 'var(--text-secondary)',
            }}
          >
            Согласовано {toPay.length} — выплачивает директор
            <ChevronRight size={15} />
          </button>
        )}
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
          Неодобренные уйдут директору на согласование. Выплата проводится только после согласования.
        </p>
      </PullToRefresh>

      {toast && (
        <div
          style={{
            position: 'fixed', left: '50%', transform: 'translateX(-50%)',
            bottom: 'calc(max(0px, var(--tabbar-total) + var(--tabbar-lift, 0px)) + 16px)', zIndex: 80,
            padding: '10px 16px', borderRadius: 12, fontSize: 13.5, fontWeight: 600,
            background: 'color-mix(in srgb, var(--gold) 20%, var(--bg-surface))',
            border: '0.5px solid color-mix(in srgb, var(--gold) 40%, transparent)',
            color: 'var(--text-primary)', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}
        >
          {toast}
        </div>
      )}
    </PageShell>
  );
}

function GroupHeader({ label, sum }) {
  return (
    <div
      className="flex items-center gap-2 mt-3 mb-1.5"
      style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-tertiary)' }}
    >
      <span>{label} · {sum}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--border-norse)' }} />
    </div>
  );
}

function CartCard({ it, index }) {
  const tax = Number(it.transferAmount || 0) - Number(it.infoAmount || 0);
  const taxNote = it.isSelfEmployed ? 'сбор+НДС 22%' : (it.officialTransfer ? '+15% НДФЛ' : '1:1');
  const approved = it.approvalStatus === 'approved';
  const rejected = it.approvalStatus === 'rejected';

  return (
    <div
      className="rounded-2xl mb-2"
      style={{
        background: approved
          ? 'color-mix(in srgb, var(--green) 8%, var(--bg-surface))'
          : 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
        border: approved
          ? '0.5px solid color-mix(in srgb, var(--green) 30%, var(--border-norse))'
          : rejected
            ? '0.5px solid color-mix(in srgb, var(--red-soft) 35%, var(--border-norse))'
            : '0.5px solid var(--border-norse)',
        padding: '13px 15px',
        animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${index * 30}ms both`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <div
            aria-hidden="true"
            style={{
              width: 34, height: 34, borderRadius: 999, flexShrink: 0,
              display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, color: '#fff',
              background: 'linear-gradient(150deg, var(--blue), color-mix(in srgb, var(--blue) 60%, #000))',
            }}
          >
            {initials(it.fio)}
          </div>
          <div className="min-w-0">
            <p style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{shortFio(it.fio)}</p>
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {it.kind === 'advance' ? 'Аванс' : 'Зарплата'}
            </p>
          </div>
        </div>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
          {formatMoney(it.payAmount)}
        </span>
      </div>

      <div className="mt-2.5" style={{ display: 'grid', gap: 4 }}>
        <MKV label="Налог / сбор" hint={taxNote} value={formatMoney(tax)} />
        <MKV label="Всего к переводу" value={formatMoney(it.transferAmount)} color="var(--gold)" bold />
        <MKV label="Человеку придёт" value={formatMoney(it.infoAmount)} color="var(--green)" bold />
      </div>

      {it.comment && (
        <p style={{ fontSize: 11.5, color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: 8 }}>«{it.comment}»</p>
      )}

      <div className="flex items-center gap-1.5 mt-2.5">
        {approved ? (
          <Badge icon={Check} text="к выплате" tone="ok" />
        ) : rejected ? (
          <Badge icon={AlertTriangle} text={`возврат: ${it.rejectReason || '—'}`} tone="err" />
        ) : (
          <Badge icon={Send} text={it.batchStatus === 'draft' ? CART_READY : 'ждёт согласования директора'} tone="warn" />
        )}
      </div>
    </div>
  );
}

function Badge({ icon: Icon, text, tone }) {
  const map = {
    ok: { bg: 'color-mix(in srgb, var(--green) 14%, transparent)', c: 'var(--green)', b: 'color-mix(in srgb, var(--green) 35%, transparent)' },
    warn: { bg: 'color-mix(in srgb, var(--gold) 15%, transparent)', c: 'var(--gold)', b: 'color-mix(in srgb, var(--gold) 35%, transparent)' },
    err: { bg: 'color-mix(in srgb, var(--red-soft) 12%, transparent)', c: 'var(--red)', b: 'color-mix(in srgb, var(--red-soft) 35%, transparent)' },
  }[tone] || {};
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
        background: map.bg, color: map.c, border: `0.5px solid ${map.b}`,
      }}
    >
      {Icon && <Icon size={12} />}
      {text}
    </span>
  );
}

function MKV({ label, hint, value, color, bold }) {
  return (
    <div className="flex justify-between" style={{ fontSize: 12.5 }}>
      <span style={{ color: 'var(--text-tertiary)' }}>
        {label}{hint ? <span style={{ opacity: 0.75 }}> ({hint})</span> : ''}
      </span>
      <span style={{ color: color || 'var(--text-primary)', fontWeight: bold ? 700 : 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
