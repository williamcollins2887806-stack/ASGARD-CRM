/**
 * FieldHall — visit a colleague's warrior hall (read-only 3D + stats + praise).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Heart, Swords, BookOpen, Trophy } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { VikingAvatarLazy } from '@/components/field/VikingAvatar3D';
import { useHaptic } from '@/hooks/useHaptic';
import { getLevel, getRank } from '@/lib/fieldRanks';

export default function FieldHall() {
  const { id } = useParams();
  const navigate = useNavigate();
  const haptic = useHaptic();
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
      <div style={{ minHeight: '100vh', background: '#080d1f', color: '#9ca3af', padding: 24, textAlign: 'center' }}>
        Открываем зал воина…
      </div>
    );
  }

  if (error || !data?.host) {
    return (
      <div style={{ minHeight: '100vh', background: '#080d1f', padding: 24 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#D4A843' }}>← Назад</button>
        <p style={{ color: '#ef4444', marginTop: 16 }}>{error || 'Воин не найден'}</p>
      </div>
    );
  }

  const h = data.host;
  // Same XP→level curve as FieldProfile (not backend xp/100)
  const level = getLevel(h.xp || 0);
  const rankInfo = getRank(level);

  return (
    <div style={{ minHeight: '100vh', background: '#080d1f', paddingBottom: 100 }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, padding: '14px 16px',
        background: 'linear-gradient(180deg,#080d1f 70%, transparent)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 10, padding: 8, cursor: 'pointer' }}
        >
          <ArrowLeft size={20} color="#9ca3af" />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>Зал воина</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>{h.fio}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 16px 24px', gap: 16 }}>
        <VikingAvatarLazy
          assets={h.assets || {}}
          cosmetics={h.cosmetics || {}}
          level={level}
          size={Math.min(300, window.innerWidth - 48)}
          interactive
        />

        <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: 0, textAlign: 'center' }}>{h.fio}</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <StatChip icon={<Trophy size={12} />} label={`#${h.rank || '—'}`} color="#D4A843" />
          <StatChip icon={<Swords size={12} />} label={`${rankInfo.rune} ${rankInfo.title} · Ур.${level}`} color={rankInfo.color} />
          <StatChip icon={<BookOpen size={12} />} label={`${h.lessons_passed} рун`} color="#60a5fa" />
          <StatChip icon={<Heart size={12} />} label={`${h.praise_count} ✦`} color="#f472b6" />
        </div>

        {/* Compare strength bars */}
        <div style={{
          width: '100%', maxWidth: 360, borderRadius: 16, padding: 14,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', marginBottom: 10, letterSpacing: 1 }}>СИЛА</div>
          <Bar label="XP" value={h.xp} max={Math.max(h.xp, 500)} color="#a855f7" />
          <Bar label="Руны" value={h.runes} max={Math.max(h.runes, 200)} color="#D4A843" />
          <Bar label="Уровень" value={level} max={Math.max(level, 20)} color="#f97316" />
        </div>

        {/* Equipped showcase */}
        <div style={{
          width: '100%', maxWidth: 360, borderRadius: 16, padding: 14,
          background: 'rgba(212,168,67,0.06)', border: '1px solid rgba(212,168,67,0.2)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#D4A843', marginBottom: 10 }}>АМУНИЦИЯ</div>
          {[
            ['Шлем', h.cosmetics?.active_helmet],
            ['Оружие', h.cosmetics?.active_weapon],
            ['Броня', h.cosmetics?.active_armor],
            ['Аватар', h.cosmetics?.active_avatar],
          ].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', color: '#cbd5e1' }}>
              <span style={{ color: '#6b7280' }}>{label}</span>
              <span>{val || '—'}</span>
            </div>
          ))}
        </div>

        {!data.is_self && (
          <button
            onClick={praise}
            disabled={praising}
            style={{
              width: '100%', maxWidth: 360, padding: '14px 0', borderRadius: 14, border: 'none',
              background: 'linear-gradient(135deg,#D4A843,#b8860b)', color: '#111', fontWeight: 800,
              fontSize: 14, cursor: praising ? 'wait' : 'pointer', opacity: praising ? 0.7 : 1,
            }}
          >
            ✦ Похвалить (1/день)
          </button>
        )}
        {praiseMsg && (
          <p style={{ color: '#D4A843', fontSize: 12, margin: 0 }}>{praiseMsg}</p>
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
      background: `${color}18`, color, border: `1px solid ${color}44`,
    }}>
      {icon}{label}
    </span>
  );
}

function Bar({ label, value, max, color }) {
  const pct = Math.min(100, Math.round((Number(value) || 0) / (max || 1) * 100));
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ color }}>{Number(value || 0).toLocaleString('ru-RU')}</span>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: color, transition: 'width .6s ease' }} />
      </div>
    </div>
  );
}
