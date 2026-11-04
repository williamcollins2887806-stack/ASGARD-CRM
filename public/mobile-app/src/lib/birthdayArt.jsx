/** Premium gift SVG art — mirror of public/assets/js/birthday_gifts_art.js */

export const GIFT_META = {
  flowers: { name: 'Букет зала', hint: 'алый шёлк и золотая лента', scene: 'Тёплый свет, лепестки в воздухе' },
  fireworks: { name: 'Салют неба', hint: 'тихие искры над горизонтом', scene: 'Золотой залп без шума' },
  toy: { name: 'Сокровище воина', hint: 'шкатулка с руной удачи', scene: 'Блик на древнем даре' },
};

export function GiftArt({ type, className = '' }) {
  if (type === 'fireworks') {
    return (
      <svg className={className} viewBox="0 0 160 160" fill="none" aria-hidden="true">
        <defs>
          <radialGradient id="mFwCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFF8E0" />
            <stop offset="35%" stopColor="#E8C35A" />
            <stop offset="100%" stopColor="#E8C35A" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="mFwBeam" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFF4C8" stopOpacity=".95" />
            <stop offset="100%" stopColor="#D4A843" stopOpacity="0" />
          </linearGradient>
        </defs>
        <ellipse cx="80" cy="128" rx="52" ry="10" fill="#000" opacity=".35" />
        <path d="M20 118 C48 104 112 104 140 118" stroke="#8B7340" strokeWidth="1.2" opacity=".5" />
        <g stroke="url(#mFwBeam)" strokeWidth="2" strokeLinecap="round">
          <path d="M80 78 L80 28" />
          <path d="M80 78 L118 42" />
          <path d="M80 78 L42 42" />
          <path d="M80 78 L128 78" />
          <path d="M80 78 L32 78" />
          <path d="M80 78 L112 108" />
          <path d="M80 78 L48 108" />
        </g>
        <circle cx="80" cy="26" r="2.4" fill="#F5F0E6" />
        <circle cx="120" cy="40" r="2" fill="#F5F0E6" />
        <circle cx="40" cy="40" r="2" fill="#F5F0E6" />
        <circle cx="80" cy="78" r="22" fill="url(#mFwCore)" />
        <circle cx="80" cy="78" r="5" fill="#FFF8E0" />
      </svg>
    );
  }
  if (type === 'toy') {
    return (
      <svg className={className} viewBox="0 0 160 160" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="mTyWood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3A2C1C" />
            <stop offset="100%" stopColor="#1A120C" />
          </linearGradient>
          <linearGradient id="mTyGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F0D078" />
            <stop offset="50%" stopColor="#D4A843" />
            <stop offset="100%" stopColor="#8B6914" />
          </linearGradient>
        </defs>
        <ellipse cx="80" cy="128" rx="40" ry="9" fill="#000" opacity=".4" />
        <path d="M36 78 H124 V118 C124 124 118 128 112 128 H48 C42 128 36 124 36 118 V78Z" fill="url(#mTyWood)" stroke="#D4A843" strokeWidth="1.8" />
        <rect x="34" y="52" width="92" height="30" rx="4" fill="#2A1E14" stroke="#D4A843" strokeWidth="1.8" />
        <path d="M34 66 H126" stroke="#E8C35A" strokeWidth="2" />
        <path d="M80 52 V128" stroke="#E8C35A" strokeWidth="1.6" opacity=".75" />
        <circle cx="80" cy="66" r="7" fill="url(#mTyGold)" stroke="#F5E6B8" strokeWidth="1" />
        <path d="M80 61 L81.5 65.2 H86 L82.3 67.8 L83.8 72 L80 69.2 L76.2 72 L77.7 67.8 L74 65.2 H78.5 Z" fill="#1A120C" />
        <path d="M48 44 H112 L124 56 H36 L48 44Z" fill="url(#mTyGold)" opacity=".92" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 160 160" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="mFlGlow" cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#F3D989" stopOpacity=".55" />
          <stop offset="100%" stopColor="#F3D989" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mFlPetal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E8A0B0" />
          <stop offset="55%" stopColor="#9B3D55" />
          <stop offset="100%" stopColor="#5C2233" />
        </linearGradient>
        <linearGradient id="mFlGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F0D078" />
          <stop offset="100%" stopColor="#B8892E" />
        </linearGradient>
      </defs>
      <circle cx="80" cy="72" r="54" fill="url(#mFlGlow)" />
      <ellipse cx="80" cy="118" rx="28" ry="10" fill="#1A1410" opacity=".45" />
      <path d="M80 118 C78 96 76 84 74 70" stroke="#3D5C3A" strokeWidth="3" strokeLinecap="round" />
      <path d="M80 48 C68 34 48 38 52 58 C54 70 68 74 80 66 C92 74 106 70 108 58 C112 38 92 34 80 48Z" fill="url(#mFlPetal)" />
      <path d="M64 58 C50 52 42 66 56 74 C64 78 72 70 64 58Z" fill="url(#mFlPetal)" opacity=".92" />
      <path d="M96 58 C110 52 118 66 104 74 C96 78 88 70 96 58Z" fill="url(#mFlPetal)" opacity=".92" />
      <circle cx="80" cy="58" r="9" fill="url(#mFlGold)" />
      <circle cx="80" cy="58" r="4" fill="#FFF4D0" opacity=".8" />
      <path d="M54 96 C66 88 94 88 106 96" stroke="url(#mFlGold)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
