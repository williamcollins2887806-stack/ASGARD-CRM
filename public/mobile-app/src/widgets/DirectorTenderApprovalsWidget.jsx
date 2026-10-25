import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { WidgetShell } from './WidgetShell';
import { Check, ChevronRight } from 'lucide-react';
import { loadDirectorReviewQueueCount } from '@/api/tendersRegistry';

/**
 * DirectorTenderApprovalsWidget — виджет на главной для директора.
 *
 * Показывает число просчётов, ожидающих решения, и ведёт на страницу
 * `/director-tender-approvals`.
 *
 * ДЕФЕКТ, который здесь исправлен (24.10.2026). Виджет не нажимался, потому что
 * передавал `WidgetShell` пропсы, которых тот НЕ принимает:
 *   • `title`   — шелл читает только `name` → заголовок был пустой;
 *   • `onClick` — шелла кликом не заканчивается вовсе, он игнорировался;
 *   • `badge`   — такого пропса нет, счётчик терялся.
 * Плюс использовался класс `.muted`, которого нет в CSS-системе.
 *
 * Образец верной разметки — `DirectorApprovalsWidget.jsx`: клик живёт ВНУТРИ
 * виджета, на `<button className="spring-tap">`, а шелл даёт только рамку.
 */
export default function DirectorTenderApprovalsWidget() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const role = user?.role || '';
  const isVisible = ['DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV', 'ADMIN'].includes(role);

  const fetchCount = useCallback(async () => {
    if (!isVisible) return;
    setLoading(true);
    try {
      const res = await loadDirectorReviewQueueCount();
      setCount(Number(res?.count) || 0);
    } catch {
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [isVisible]);

  useEffect(() => { fetchCount(); }, [fetchCount]);

  useEffect(() => {
    if (!isVisible) return undefined;
    const handler = () => fetchCount();
    window.addEventListener('asgard:tender:registry:changed', handler);
    return () => window.removeEventListener('asgard:tender:registry:changed', handler);
  }, [isVisible, fetchCount]);

  if (!isVisible) return null;

  const hasPending = count > 0;
  const accent = hasPending ? 'var(--gold)' : 'var(--green)';

  return (
    <WidgetShell name="Согласование тендеров" icon="✅" loading={loading}>
      {/* Клик — внутри виджета: WidgetShell кликом не наделён. */}
      <button
        type="button"
        className="w-full text-left spring-tap"
        onClick={() => { haptic?.light?.(); navigate('/director-tender-approvals'); }}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}
      >
        <div
          style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: hasPending
              ? 'color-mix(in srgb, var(--gold) 18%, transparent)'
              : 'color-mix(in srgb, var(--green) 18%, transparent)',
            position: 'relative',
          }}
        >
          <Check size={20} style={{ color: accent }} />
          {hasPending && (
            <span
              style={{
                position: 'absolute', top: -4, right: -4,
                minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10,
                background: 'var(--red)', color: '#fff',
                fontSize: 11, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="c-primary" style={{ fontSize: 14, fontWeight: 700 }}>
            {hasPending ? 'Нужно решение' : 'Очередь пуста'}
          </div>
          {/* Без `.muted` — класса нет в системе, берём `c-tertiary`. */}
          <div className="c-tertiary" style={{ fontSize: 12, marginTop: 2 }}>
            {hasPending
              ? `${count} ${plural(count, 'просчёт', 'просчёта', 'просчётов')} ждёт`
              : 'Просчёты свыше 10 млн без НДС'}
          </div>
        </div>

        <ChevronRight size={16} style={{ color: accent, flexShrink: 0 }} />
      </button>
    </WidgetShell>
  );
}

function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}
