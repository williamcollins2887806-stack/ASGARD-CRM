/**
 * FieldHall — visit a colleague's warrior hall (read-only 3D + stats + praise).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Heart, Swords, BookOpen, Trophy } from 'lucide-react';
import { Card, IconTile, KeyButton, SectionLabel } from '@/components/field/ui';
import './field-screens.css';
import { fieldApi } from '@/api/fieldClient';
import { VikingAvatarLazy } from '@/components/field/VikingAvatar3D';
import { useHaptic } from '@/hooks/useHaptic';
import { getLevel, getRank, rankColor } from '@/lib/fieldRanks';
import { useThemeStore } from '@/stores/themeStore';

export default function FieldHall() {
  const { id } = useParams();
  const navigate = useNavigate();
  const haptic = useHaptic();
  const theme = useThemeStore((s) => s.theme);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [praising, setPraising] = useState(false);
  const [praiseMsg, setPraiseMsg] = useState(null);

  useEffect(() => {
    setLoading(true);
    fieldApi.get(`/hall/${id}`)
      .then(setData)
      .catch((e) => setError(e.message || 'Не удалось открыть зал'))
      .finally(() => setLoading(false));
  }, [id]);

  const praise = async () => {
    if (praising || data?.is_self) return;
    haptic.medium();
    setPraising(true);
    try {
      await fieldApi.post(`/hall/${id}/praise`);
      setPraiseMsg('Похвалили! +5 XP хозяину');
      setData((d) => d ? {
        ...d,
        host: { ...d.host, praise_count: (d.host.praise_count || 0) + 1 },
      } : d);
    } catch (e) {
      setPraiseMsg(e.message || 'Уже хвалили сегодня');
    } finally {
      setPraising(false);
    }
  };

  if (loading) {
    return (
      <div className="fs-root" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ color: 'var(--text-secondary)' }}>Открываем зал воина…</div>
      </div>
    );
  }

  if (error || !data?.host) {
    return (
      <div className="fs-root" style={{ padding: 24 }}>
        <button onClick={() => navigate(-1)} className="fs-head__btn" aria-label="Назад"><ArrowLeft size={20} strokeWidth={2.3} /></button>
        <p style={{ color: 'var(--danger-ink)', marginTop: 16 }}>{error || 'Воин не найден'}</p>
      </div>
    );
  }

  const h = data.host;
  // Same XP→level curve as FieldProfile (not backend xp/100)
  const level = getLevel(h.xp || 0);
  const rankInfo = getRank(level);

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div style={{
        position: 'sticky', top: 0, zIndex: 10, padding: '14px 16px',
        paddingTop: 'max(env(safe-area-inset-top), 14px)',
        background: 'color-mix(in oklab, var(--bg-primary) 88%, transparent)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.5)', backdropFilter: 'blur(14px) saturate(1.5)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => navigate(-1)} className="fs-head__btn" aria-label="Назад">
          <ArrowLeft size={20} strokeWidth={2.3} />
        </button>
        <div style={{ flex: 1 }}>
          <div className="fs-head__title" style={{ fontSize: 16 }}>Зал воина</div>
          <div className="fs-head__sub">{h.fio}</div>
        </div>
      </div>

      <div style={{ position: 'relative', zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 16px 24px', gap: 16 }}>
        <VikingAvatarLazy
          assets={h.assets || {}}
          cosmetics={h.cosmetics || {}}
          level={level}
          size={Math.min(300, window.innerWidth - 48)}
          interactive
        />

        <h1 style={{ color: 'var(--text-primary)', fontSize: 20, fontWeight: 800, margin: 0, textAlign: 'center' }}>{h.fio}</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <StatChip icon={<Trophy size={12} strokeWidth={2.4} />} label={`#${h.rank || '—'}`} color="var(--value-ink)" />
          <StatChip icon={<Swords size={12} strokeWidth={2.4} />} label={`${rankInfo.rune} ${rankInfo.title} · Ур.${level}`} color={rankColor(rankInfo, theme)} />
          <StatChip icon={<BookOpen size={12} strokeWidth={2.4} />} label={`${h.lessons_passed} рун`} color="var(--acc)" />
          <StatChip icon={<Heart size={12} strokeWidth={2.4} />} label={`${h.praise_count}`} color="var(--danger-ink)" />
        </div>

        {/* Compare strength bars */}
        <Card variant="raised" style={{ width: '100%', maxWidth: 360, padding: 14 }}>
          <SectionLabel>Сила</SectionLabel>
          <Bar label="XP" value={h.xp} max={Math.max(h.xp, 500)} color="var(--acc)" />
          <Bar label="Руны" value={h.runes} max={Math.max(h.runes, 200)} color="var(--value)" />
          <Bar label="Уровень" value={level} max={Math.max(level, 20)} color="var(--value)" />
        </Card>

        {/* Equipped showcase */}
        <Card variant="raised" tone="value" style={{ width: '100%', maxWidth: 360, padding: 14 }}>
          <SectionLabel>Амуниция</SectionLabel>
          {[
            ['Шлем', h.cosmetics?.active_helmet],
            ['Оружие', h.cosmetics?.active_weapon],
            ['Броня', h.cosmetics?.active_armor],
            ['Аватар', h.cosmetics?.active_avatar],
          ].map(([label, val]) => (
            <div key={label} className="fs-row">
              <span className="fs-row__k">{label}</span>
              <span className="fs-row__v">{val || '—'}</span>
            </div>
          ))}
        </Card>

        {!data.is_self && (
          <KeyButton
            tone="value"
            block
            icon={Heart}
            style={{ maxWidth: 360 }}
            onClick={praise}
            disabled={praising}
          >
            Похвалить (1/день)
          </KeyButton>
        )}
        {praiseMsg && (
          <p style={{ color: 'var(--value-ink)', fontSize: 12, margin: 0 }}>{praiseMsg}</p>
        )}
      </div>
    </div>
  );
}

function StatChip({ icon, label, color }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: `color-mix(in oklab, ${color} 12%, transparent)`, color, border: `1px solid color-mix(in oklab, ${color} 30%, transparent)`,
    }}>
      {icon}{label}
    </span>
  );
}

function Bar({ label, value, max, color }) {
  const pct = Math.min(100, Math.round((Number(value) || 0) / (max || 1) * 100));
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{Number(value || 0).toLocaleString('ru-RU')}</span>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: 'var(--bg-surface-alt)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: color, transition: 'width .6s ease' }} />
      </div>
    </div>
  );
}
