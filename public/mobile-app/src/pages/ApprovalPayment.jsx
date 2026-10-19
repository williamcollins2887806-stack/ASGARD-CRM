import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { CreditCard, ChevronRight, Check, X } from 'lucide-react';
import { formatMoney } from '@/lib/utils';

/**
 * V412: СОГЛАСОВАНИЕ СЧЕТОВ НА МОБИЛЬНОМ — паритет с десктопом.
 * Заказчик 19.10.2026: «мобильная для директора обязательно!!!».
 *
 * Директор на телефоне делает ТО ЖЕ, что на десктопе:
 *   • видит партии счетов (одна заявка = N счетов);
 *   • открывает партию и решает по КАЖДОМУ счёту выборочно (галочки);
 *   • «Согласовать выбранные» / «Отклонить выбранные»;
 *   • смотрит превью счёта и реквизиты.
 *
 * Бухгалтерия на телефоне: очередь оплаты и проведение платежа (п/п).
 */
const BUH_ROLES = ['BUH', 'ADMIN'];
const DIRECTOR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const STAGE = {
  awaiting_dir: { label: 'У директора', cls: 'c-gold' },
  pending_payment: { label: 'К оплате', cls: 'c-blue' },
  paid: { label: 'Оплачен', cls: 'c-green' },
  rejected: { label: 'Отклонён', cls: 'c-red' },
};

export default function ApprovalPayment() {
  const haptic = useHaptic();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const isBuh = BUH_ROLES.includes(role);
  const isDirector = DIRECTOR_ROLES.includes(role);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openBatch, setOpenBatch] = useState(null);   // { id, items, batch }
  const [busy, setBusy] = useState(false);

  /** Загружаем СЧЕТА (новый контур), а не старые approval-заявки. */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/payment-invoices/my?all=1');
      setRows(res?.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  // Группируем: партии + одиночные счета.
  const groups = useMemo(() => {
    const byBatch = new Map();
    const singles = [];
    for (const r of rows) {
      if (r.batch_id) {
        if (!byBatch.has(r.batch_id)) byBatch.set(r.batch_id, []);
        byBatch.get(r.batch_id).push(r);
      } else singles.push(r);
    }
    return { batches: [...byBatch.entries()], singles };
  }, [rows]);

  const openOne = async (batchId) => {
    haptic.light();
    try {
      const d = await api.get('/payment-invoices/batches/' + batchId);
      setOpenBatch({ id: batchId, batch: d.batch, items: d.items || [], summary: d.summary || {} });
    } catch { setOpenBatch(null); }
  };

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const waiting = rows.filter((r) => r.status === 'awaiting_dir').length;

  return (
    <PageShell title={isBuh ? 'Оплаты' : 'Согласование счетов'}>
      <PullToRefresh onRefresh={fetchData}>
        {!loading && (
          <div className="card-hero mb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <p className="input-label">{isBuh ? 'К оплате' : 'На согласовании'}</p>
            <p className="text-[24px] font-bold c-primary">{formatMoney(total)}</p>
            <p className="text-[12px] mt-1 c-secondary">
              Счетов: {rows.length}{waiting ? ` · ждут решения: ${waiting}` : ''}
            </p>
          </div>
        )}

        {loading ? <SkeletonList count={4} /> : rows.length === 0 ? (
          <EmptyState icon={CreditCard} iconColor="var(--green)" iconBg="rgba(48,209,88,0.1)"
            title={isBuh ? 'Нет платежей' : 'Нет счетов на согласовании'}
            description={isBuh ? 'Очередь оплат пуста' : 'Новые счета появятся здесь'} />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {/* Партии */}
            {groups.batches.map(([bid, items], bi) => {
              const sum = items.reduce((s, x) => s + Number(x.amount || 0), 0);
              const pend = items.filter((x) => x.status === 'awaiting_dir').length;
              return (
                <button key={'b' + bid}
                  onClick={() => openOne(bid)}
                  className="w-full text-left card-glass px-4 py-3 spring-tap"
                  style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${bi * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="status-badge c-gold" style={{ background: 'color-mix(in srgb, var(--gold) 15%, transparent)' }}>
                          Партия №{bid}
                        </span>
                        <span className="text-[10px] c-tertiary">{items.length} {items.length === 1 ? 'счёт' : 'счетов'}</span>
                      </div>
                      <p className="text-[14px] font-semibold c-primary">{formatMoney(sum)}</p>
                      <p className="text-[11px] c-tertiary mt-0.5">
                        {items[0]?.supplier_name || '—'}{items.length > 1 ? ` +${items.length - 1}` : ''}
                        {pend ? ` · ждут: ${pend}` : ''}
                      </p>
                    </div>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                </button>
              );
            })}
            {/* Одиночные счета */}
            {groups.singles.map((item, i) => {
              const st = STAGE[item.status] || { label: item.status, cls: 'c-tertiary' };
              return (
                <button key={item.id} onClick={() => { haptic.light(); setOpenBatch({ id: null, single: item }); }}
                  className="w-full text-left card-glass px-4 py-3 spring-tap"
                  style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${(groups.batches.length + i) * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold c-primary truncate">{item.supplier_name || '—'}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[12px] font-semibold c-gold">{formatMoney(item.amount)}</span>
                        <span className={`text-[10px] ${st.cls}`}>{st.label}</span>
                        {item.invoice_number && <span className="text-[10px] c-tertiary">№ {item.invoice_number}</span>}
                      </div>
                    </div>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      <BatchSheet
        data={openBatch}
        busy={busy}
        isBuh={isBuh}
        isDirector={isDirector}
        onClose={() => setOpenBatch(null)}
        onDone={() => { setOpenBatch(null); fetchData(); }}
        setBusy={setBusy}
      />
    </PageShell>
  );
}

/** Экран партии: галочки по счетам, выборочное решение (или оплата для бухгалтерии). */
function BatchSheet({ data, busy, isBuh, isDirector, onClose, onDone, setBusy }) {
  const haptic = useHaptic();
  const [checked, setChecked] = useState(() => new Set());
  const [pp, setPp] = useState('');
  const [ppDate, setPpDate] = useState(new Date().toISOString().slice(0, 10));
  const items = data?.items || [];
  const single = data?.single;

  useEffect(() => { setChecked(new Set()); setPp(''); }, [data?.id, single?.id]);

  const pending = items.filter((x) => x.status === 'awaiting_dir');
  const payable = items.filter((x) => x.status === 'pending_payment' || x.payment_status === 'pending_payment');

  const toggle = (id) => {
    haptic.light();
    setChecked((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const allOn = () => { haptic.medium(); setChecked(new Set(pending.map((x) => x.id))); };
  const allOff = () => { haptic.light(); setChecked(new Set()); };

  const decide = async (mode) => {
    const ids = [...checked];
    if (!ids.length) return;
    setBusy(true);
    try {
      await api.post(`/payment-invoices/batches/${data.id}/decide`,
        mode === 'approve' ? { approve: ids } : { reject: ids });
      haptic.success?.();
      onDone();
    } catch (_) { haptic.error?.(); }
    finally { setBusy(false); }
  };

  const payOne = async (id) => {
    if (!pp.trim()) return;
    setBusy(true);
    try {
      await api.post(`/payment-invoices/${id}/pay-bank`, { pp_number: pp.trim(), pp_date: ppDate });
      haptic.success?.();
      onDone();
    } catch (_) { haptic.error?.(); }
    finally { setBusy(false); }
  };

  // Одиночный счёт — показываем карточку одного счёта.
  if (single) {
    const st = STAGE[single.status] || { label: single.status, cls: 'c-tertiary' };
    return (
      <BottomSheet open onClose={onClose} title="Счёт" maxHeight="90vh">
        <div className="flex flex-col gap-3 pb-6">
          <div>
            <p className="input-label">Поставщик</p>
            <p className="text-[16px] font-semibold c-primary">{single.supplier_name || '—'}</p>
          </div>
          <div className="flex items-center gap-3">
            <div><p className="input-label">Сумма</p><p className="text-[18px] font-bold c-primary">{formatMoney(single.amount)}</p></div>
            <div><p className="input-label">Статус</p><p className={`text-[13px] font-semibold ${st.cls}`}>{st.label}</p></div>
          </div>
          {single.invoice_number && <div><p className="input-label">Счёт</p><p className="text-[14px] c-primary">№ {single.invoice_number}</p></div>}
          {single.contract_basis_number && <div><p className="input-label">Договор</p><p className="text-[14px] c-primary">{single.contract_basis_number}</p></div>}
          {single.vat_amount ? <div><p className="input-label">НДС</p><p className="text-[14px] c-primary">{formatMoney(single.vat_amount)}{single.vat_rate ? ` (${single.vat_rate}%)` : ''}</p></div> : null}
          {single.has_file && (
            <a href={`/api/payment-invoices/preview/${single.id}?token=${encodeURIComponent(localStorage.getItem('asgard_token') || '')}`}
              target="_blank" rel="noreferrer"
              className="w-full rounded-xl px-4 py-3 text-center font-semibold spring-tap"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
              Открыть счёт
            </a>
          )}
        </div>
      </BottomSheet>
    );
  }

  if (!data?.id) return null;

  return (
    <BottomSheet open onClose={onClose} title={`Партия №${data.id}`} maxHeight="92vh">
      <div className="flex flex-col gap-2 pb-6">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[12px] c-secondary">
            {items.length} {items.length === 1 ? 'счёт' : 'счетов'} · ждут решения: {pending.length}
          </p>
          {pending.length > 0 && (
            <div className="flex gap-1.5">
              <button onClick={allOn} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg spring-tap"
                style={{ background: 'color-mix(in srgb, var(--blue) 15%, transparent)', color: 'var(--text-primary)' }}>Все</button>
              <button onClick={allOff} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg spring-tap"
                style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>Снять</button>
            </div>
          )}
        </div>

        {items.map((it) => {
          const isPending = it.status === 'awaiting_dir';
          const isPayable = it.status === 'pending_payment' || it.payment_status === 'pending_payment';
          const isPaid = it.status === 'paid' || it.payment_status === 'paid';
          const st = STAGE[it.status] || { label: it.status, cls: 'c-tertiary' };
          const on = checked.has(it.id);
          return (
            <div key={it.id}
              className="rounded-xl px-3 py-2.5"
              style={{
                background: isPaid ? 'color-mix(in srgb, var(--green) 6%, var(--bg-card))' : 'var(--bg-card)',
                border: `1px solid ${on ? 'color-mix(in srgb, var(--gold) 60%, transparent)' : 'var(--border-subtle)'}`,
              }}>
              <div className="flex items-start gap-2.5">
                {isPending && (
                  <button onClick={() => toggle(it.id)} aria-label="Выбрать счёт"
                    className="spring-tap flex items-center justify-center"
                    style={{
                      width: 24, height: 24, borderRadius: 7, flexShrink: 0, marginTop: 2,
                      background: on ? 'var(--gold)' : 'var(--bg-card)',
                      border: `2px solid ${on ? 'var(--gold)' : 'var(--border-strong)'}`,
                    }}>
                    {on ? <Check size={14} style={{ color: '#000' }} /> : null}
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold c-primary truncate">{it.supplier_name || '—'}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[12px] font-semibold c-gold">{formatMoney(it.amount)}</span>
                    <span className={`text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                    {it.invoice_number && <span className="text-[10px] c-tertiary">№ {it.invoice_number}</span>}
                    {it.vat_rate ? <span className="text-[10px] c-tertiary">НДС {it.vat_rate}%</span> : null}
                  </div>
                  {isPaid && it.pp_number && <p className="text-[10px] c-tertiary mt-0.5">п/п {it.pp_number}</p>}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {isPending && (
                    <button onClick={() => toggle(it.id)}
                      className="text-[10px] font-semibold px-2 py-1 rounded-md spring-tap"
                      style={{ background: on ? 'color-mix(in srgb, var(--green) 18%, transparent)' : 'var(--bg-card)', color: 'var(--text-primary)' }}>
                      {on ? 'Согласовать' : 'Выбрать'}
                    </button>
                  )}
                  {isPayable && isBuh && (
                    <button onClick={() => payOne(it.id)}
                      className="text-[10px] font-semibold px-2 py-1 rounded-md spring-tap"
                      style={{ background: 'color-mix(in srgb, var(--blue) 18%, transparent)', color: 'var(--text-primary)' }}>
                      Оплатить
                    </button>
                  )}
                  {it.has_file && (
                    <a href={`/api/payment-invoices/preview/${it.id}?token=${encodeURIComponent(localStorage.getItem('asgard_token') || '')}`}
                      target="_blank" rel="noreferrer"
                      className="text-[10px] font-semibold px-2 py-1 rounded-md text-center"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>Счёт</a>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Оплата у бухгалтерии: п/п */}
        {isBuh && payable.length > 0 && (
          <div className="mt-2 p-3 rounded-xl" style={{ background: 'var(--bg-card)' }}>
            <p className="input-label">Платёжное поручение</p>
            <div className="flex gap-2">
              <input value={pp} onChange={(e) => setPp(e.target.value)} placeholder="№ п/п"
                className="flex-1 rounded-lg px-3 py-2 text-[14px]"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }} />
              <input type="date" value={ppDate} onChange={(e) => setPpDate(e.target.value)}
                className="rounded-lg px-2 py-2 text-[13px]"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }} />
            </div>
            <p className="text-[10px] c-tertiary mt-1">Укажите № и нажмите «Оплатить» у нужного счёта.</p>
          </div>
        )}

        {/* Решение директора */}
        {isDirector && pending.length > 0 && (
          <div className="flex gap-2 mt-2">
            <button disabled={busy || !checked.size} onClick={() => decide('reject')}
              className="flex-1 py-3 rounded-xl font-semibold spring-tap flex items-center justify-center gap-1.5"
              style={{
                background: checked.size ? 'color-mix(in srgb, var(--red) 14%, transparent)' : 'var(--bg-card)',
                color: checked.size ? 'var(--text-primary)' : 'var(--text-tertiary)',
                opacity: busy ? 0.5 : 1,
              }}>
              <X size={16} /> Отклонить
            </button>
            <button disabled={busy || !checked.size} onClick={() => decide('approve')}
              className="flex-[1.4] py-3 rounded-xl font-semibold spring-tap flex items-center justify-center gap-1.5"
              style={{
                background: checked.size ? 'var(--green)' : 'var(--bg-card)',
                color: checked.size ? '#000' : 'var(--text-tertiary)',
                opacity: busy ? 0.5 : 1,
              }}>
              <Check size={16} /> Согласовать {checked.size ? `(${checked.size})` : ''}
            </button>
          </div>
        )}
        {isDirector && pending.length === 0 && (
          <p className="text-[12px] c-tertiary text-center py-2">Все счета этой партии рассмотрены</p>
        )}
      </div>
    </BottomSheet>
  );
}
