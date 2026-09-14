/**
 * Lightweight SVG preview of what a shop item looks like on the warrior
 * (or profile chrome). No WebGL — safe for shop grids.
 */
import { colorForAsset, SLOT_LABEL_RU } from '@/lib/cosmeticColors';

function ProfileChromePreview({ equipSlot, assetKey, size }) {
  const c = colorForAsset(equipSlot, assetKey);
  if (equipSlot === 'frame') {
    return (
      <svg width={size} height={size} viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="28" fill="#1a2030" stroke={c} strokeWidth="3" />
        <circle cx="40" cy="40" r="22" fill="none" stroke={c} strokeWidth="1" strokeDasharray="3 4" opacity=".7" />
        <circle cx="40" cy="36" r="10" fill="#B87448" />
        <rect x="30" y="46" width="20" height="14" rx="4" fill="#606878" />
        <text x="40" y="74" textAnchor="middle" fontSize="7" fill={c} fontWeight="700">РАМКА</text>
      </svg>
    );
  }
  if (equipSlot === 'theme') {
    return (
      <svg width={size} height={size} viewBox="0 0 80 80">
        <defs>
          <linearGradient id="th" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity=".55" />
            <stop offset="100%" stopColor="#0a0e1a" />
          </linearGradient>
        </defs>
        <rect x="8" y="8" width="64" height="64" rx="12" fill="url(#th)" stroke={c} strokeWidth="1.5" />
        <circle cx="40" cy="34" r="9" fill="#B87448" />
        <rect x="28" y="44" width="24" height="16" rx="5" fill="#404858" />
        <text x="40" y="72" textAnchor="middle" fontSize="7" fill="#fff" fontWeight="700">ТЕМА</text>
      </svg>
    );
  }
  // badge
  return (
    <svg width={size} height={size} viewBox="0 0 80 80">
      <circle cx="40" cy="36" r="22" fill="#141828" stroke={c} strokeWidth="2" />
      <path d="M40 18 L44 30 L56 30 L46 38 L50 50 L40 42 L30 50 L34 38 L24 30 L36 30 Z" fill={c} />
      <text x="40" y="72" textAnchor="middle" fontSize="7" fill={c} fontWeight="700">БЕЙДЖ</text>
    </svg>
  );
}

/** Silhouette warrior with the equipped slot highlighted in asset color */
export default function GearPreview({ equipSlot, assetKey, size = 72, label = true }) {
  const accent = colorForAsset(equipSlot, assetKey);
  const skin = '#B87448';
  const baseArmor = '#4a5568';
  const baseHelm = '#6a7580';
  const baseBoot = '#2a1810';
  const baseCape = '#2a1a10';

  if (['frame', 'theme', 'badge'].includes(equipSlot)) {
    return (
      <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ProfileChromePreview equipSlot={equipSlot} assetKey={assetKey} size={size} />
      </div>
    );
  }

  const helm = equipSlot === 'helmet' ? accent : baseHelm;
  const armor = equipSlot === 'armor' || equipSlot === 'avatar' ? accent : baseArmor;
  const cape = equipSlot === 'cape' ? accent : baseCape;
  const boot = equipSlot === 'boots' ? accent : baseBoot;
  const face = equipSlot === 'face_paint' ? accent : skin;
  const weapon = equipSlot === 'weapon' ? accent : '#8A9BAC';
  const bodySkin = equipSlot === 'avatar' ? accent : skin;

  return (
    <div style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} viewBox="0 0 80 90" style={{ display: 'block' }}>
        {/* Cape */}
        <path d="M22 38 Q10 55 14 78 Q40 70 66 78 Q70 55 58 38 Z" fill={cape} opacity={equipSlot === 'cape' ? 1 : 0.35} />
        {/* Body / armor */}
        <path d="M28 40 Q40 36 52 40 L56 72 Q40 78 24 72 Z" fill={armor} />
        {/* Head */}
        <ellipse cx="40" cy="28" rx="14" ry="13" fill={bodySkin} />
        {/* Face paint mark */}
        {equipSlot === 'face_paint' && (
          <path d="M32 26 L36 30 M44 26 L48 30 M34 34 Q40 38 46 34" stroke={face} strokeWidth="2" fill="none" strokeLinecap="round" />
        )}
        {/* Helmet */}
        <path d="M26 26 Q26 14 40 12 Q54 14 54 26 L52 30 Q40 26 28 30 Z" fill={helm} />
        {(equipSlot === 'helmet' || !equipSlot) && (
          <rect x="28" y="24" width="24" height="5" rx="2" fill="#D4A843" opacity=".85" />
        )}
        {/* Boots */}
        <ellipse cx="32" cy="78" rx="7" ry="5" fill={boot} />
        <ellipse cx="48" cy="78" rx="7" ry="5" fill={boot} />
        {/* Weapon */}
        {(equipSlot === 'weapon' || true) && (
          <g opacity={equipSlot === 'weapon' ? 1 : 0.25}>
            <rect x="58" y="34" width="4" height="28" rx="1" fill={weapon} transform="rotate(18 60 48)" />
            <path d="M56 32 L64 28 L66 36 Z" fill={weapon} />
          </g>
        )}
      </svg>
      {label && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          fontSize: Math.max(8, size * 0.11), fontWeight: 800, textAlign: 'center',
          color: accent, textShadow: '0 1px 2px rgba(0,0,0,.9)', letterSpacing: '.02em',
        }}>
          {SLOT_LABEL_RU[equipSlot] || 'Вещь'}
        </div>
      )}
    </div>
  );
}
