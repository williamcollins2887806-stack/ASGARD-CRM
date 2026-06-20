import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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

  const [pending,     setPending]     = useState([]);
  const [balance,     setBalance]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [opened,      setOpened]      = useState(null);
  const [actionBusy,  setActionBusy]  = useState(false);

  /* ── Loader ────────────────────────────────────────────────── */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, balRes] = await Promise.all([
        api.get('/cash/all?status=requested').catch(() => null),
        api.get('/cash/balance').catch(() => null),
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
    } catch {
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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

  /* ── Действия ──────────────────────────────────────────────── */
  const handleAction = useCallback(async (action) => {
    if (!opened || actionBusy) return;
    setActionBusy(true);
    try {
      if (action === 'approve') {
        haptic.success();
        await api.put(`/cash/${opened.id}/approve`);
      } else if (action === 'reject') {
        const comment = window.prompt('Причина отказа?');
        if (comment === null) { setActionBusy(false); return; }
        haptic.medium();
        await api.put(`/cash/${opened.id}/reject`, { comment });
      } else if (action === 'question') {
        const message = window.prompt('Что уточнить у автора?');
        if (message === null) { setActionBusy(false); return; }
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
  }, [opened, actionBusy, haptic]);

  const cashBalance = useMemo(() => {
    if (!balance) return 0;
    return Number(
      balance.total_balance ?? balance.balance ?? balance.on_hand ?? 0
    );
  }, [balance]);

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
                {pending.length}
              </p>
              <p
                className="dapr-count-label"
                style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}
              >
                {pending.length === 0 ? 'нет ожидающих' : 'ждут согласования'}
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

        {/* ─── List ────────────────────────────────────────── */}
        {loading ? (
          <SkeletonList count={4} />
        ) : pending.length === 0 ? (
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
    </PageShell>
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
