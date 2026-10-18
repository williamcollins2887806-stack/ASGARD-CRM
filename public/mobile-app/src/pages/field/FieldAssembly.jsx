/**
 * FieldAssembly.jsx — Сбор паллет рабочими (Field PWA).
 * Список ведомостей моих работ → переход в сборщик паллет.
 * Решает главную боль: рабочие собирают паллеты в телефоне, а не «на листочек».
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import {
  ArrowLeft, Package, Boxes, Truck, RefreshCw, ChevronRight, ClipboardList,
} from 'lucide-react';
import { Card, IconTile, KeyButton, ProgressBar, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

const TYPE_META = {
  mobilization: { label: 'Мобилизация', icon: Truck, color: 'var(--value)' },
  demobilization: { label: 'Демобилизация', icon: Boxes, color: 'var(--acc)' },
  transfer: { label: 'Перемещение', icon: RefreshCw, color: 'var(--ok)' },
};
const STATUS_LABEL = {
  draft: 'Черновик', confirmed: 'К сборке', packing: 'Идёт сборка', packed: 'Собрано',
  in_transit: 'В пути', received: 'Принято', returned: 'Возвращено', closed: 'Закрыто',
};

export default function FieldAssembly() {
  const nav = useNavigate();
  const haptic = useHaptic();
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const d = await fieldApi.get('/assembly/my');
      setLists(d.items || []);
    } catch (e) { setErr(e.message || 'Ошибка загрузки'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      {/* Шапка */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingInline: 16, paddingBottom: 12,
        background: 'color-mix(in oklab, var(--bg-primary) 88%, transparent)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.5)', backdropFilter: 'blur(14px) saturate(1.5)',
        borderBottom: '1px solid var(--tile-brd)',
      }}>
        <div className="flex items-center gap-3">
          <button onClick={() => { haptic.light(); nav(-1); }} className="fs-head__btn" aria-label="Назад" style={{ marginLeft: -8 }}>
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Package} tone="value" size={38} />
          <div className="flex-1 min-w-0">
            <div className="fs-head__title" style={{ fontSize: 17 }}>Сбор паллет</div>
            <div className="fs-head__sub">Комплектация на склад и объект</div>
          </div>
          <button onClick={() => { haptic.light(); load(); }} className="fs-head__btn" aria-label="Обновить">
            <RefreshCw size={18} strokeWidth={2.3} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="fs-content space-y-3" style={{ paddingTop: 12 }}>
        {loading && <SkeletonList count={3} />}

        {err && !loading && (
          <EmptyState
            icon={Package}
            title="Не удалось загрузить"
            description={err}
          />
        )}
        {err && !loading && (
          <KeyButton tone="value" block icon={RefreshCw} onClick={load}>Повторить</KeyButton>
        )}

        {!loading && !err && lists.length === 0 && (
          <EmptyState
            icon={ClipboardList}
            title="Нет ведомостей"
            description="Когда РП создаст сбор для вашей работы, он появится здесь."
          />
        )}

        {!loading && !err && lists.map((l) => {
          const meta = TYPE_META[l.type] || TYPE_META.mobilization;
          const Icon = meta.icon;
          const pct = l.items_count > 0 ? Math.round((l.packed_count / l.items_count) * 100) : 0;
          return (
            <Card
              key={l.id}
              as="button"
              variant="raised"
              className="w-full text-left active:scale-[.98]"
              onClick={() => { haptic.light(); nav(`/field/assembly/${l.id}`); }}
              style={{ borderColor: 'color-mix(in oklab, var(--value) 14%, transparent)' }}
            >
              <div className="flex items-center gap-3">
                <IconTile icon={Icon} tone="value" size={44} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{l.title || meta.label}</div>
                  <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>{l.work_title}{l.object_name ? ` • ${l.object_name}` : ''}</div>
                </div>
                <ChevronRight size={18} style={{ color: 'var(--text-tertiary)' }} className="flex-shrink-0" />
              </div>
              <div className="flex items-center gap-3 mt-3">
                <span className="text-[11px] px-2 py-0.5 rounded-full font-bold"
                  style={{ background: `color-mix(in oklab, ${meta.color} 13%, transparent)`, color: meta.color }}>
                  {STATUS_LABEL[l.status] || l.status}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{l.items_count || 0} поз. • {l.pallets_count || 0} мест</span>
              </div>
              {/* прогресс */}
              <div className="mt-2.5 flex items-center gap-2">
                <div className="flex-1">
                  <ProgressBar value={pct} color={meta.color} />
                </div>
                <span className="text-[11px] w-9 text-right" style={{ color: 'var(--text-tertiary)' }}>{pct}%</span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
