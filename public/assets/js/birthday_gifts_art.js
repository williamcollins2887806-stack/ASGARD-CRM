/* Premium gift illustrations for Birthday Greet ritual */
(function (global) {
  'use strict';

  const META = {
    flowers: {
      name: 'Букет зала',
      hint: 'алый шёлк и золотая лента',
      scene: 'Тёплый свет, лепестки в воздухе',
    },
    fireworks: {
      name: 'Салют неба',
      hint: 'тихие искры над горизонтом',
      scene: 'Золотой залп без шума',
    },
    toy: {
      name: 'Сокровище воина',
      hint: 'шкатулка с руной удачи',
      scene: 'Блик на древнем даре',
    },
  };

  function flowersSvg() {
    return `<svg class="bd-art bd-art--flowers" viewBox="0 0 160 160" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="bdFlGlow" cx="50%" cy="40%" r="55%">
          <stop offset="0%" stop-color="#F3D989" stop-opacity=".55"/>
          <stop offset="100%" stop-color="#F3D989" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="bdFlPetal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#E8A0B0"/>
          <stop offset="55%" stop-color="#9B3D55"/>
          <stop offset="100%" stop-color="#5C2233"/>
        </linearGradient>
        <linearGradient id="bdFlGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#F0D078"/>
          <stop offset="100%" stop-color="#B8892E"/>
        </linearGradient>
        <filter id="bdFlSoft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2"/>
        </filter>
      </defs>
      <circle cx="80" cy="72" r="54" fill="url(#bdFlGlow)"/>
      <ellipse cx="80" cy="118" rx="28" ry="10" fill="#1A1410" opacity=".45"/>
      <path d="M80 118 C78 96 76 84 74 70" stroke="#3D5C3A" stroke-width="3" stroke-linecap="round"/>
      <path d="M80 118 C82 98 90 86 98 74" stroke="#4A6B45" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M80 118 C78 100 68 88 58 78" stroke="#4A6B45" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M58 78 C48 70 44 78 52 84 C58 88 62 84 58 78Z" fill="#3F6A3C" opacity=".9"/>
      <path d="M98 74 C110 66 114 76 104 82 C96 86 92 80 98 74Z" fill="#3F6A3C" opacity=".9"/>
      <g filter="url(#bdFlSoft)">
        <path d="M80 48 C68 34 48 38 52 58 C54 70 68 74 80 66 C92 74 106 70 108 58 C112 38 92 34 80 48Z" fill="url(#bdFlPetal)"/>
        <path d="M64 58 C50 52 42 66 56 74 C64 78 72 70 64 58Z" fill="url(#bdFlPetal)" opacity=".92"/>
        <path d="M96 58 C110 52 118 66 104 74 C96 78 88 70 96 58Z" fill="url(#bdFlPetal)" opacity=".92"/>
        <path d="M72 42 C66 28 84 24 86 40 C87 48 78 52 72 42Z" fill="url(#bdFlPetal)" opacity=".85"/>
        <path d="M88 42 C94 28 76 24 74 40 C73 48 82 52 88 42Z" fill="url(#bdFlPetal)" opacity=".85"/>
      </g>
      <circle cx="80" cy="58" r="9" fill="url(#bdFlGold)"/>
      <circle cx="80" cy="58" r="4" fill="#FFF4D0" opacity=".8"/>
      <path d="M54 96 C66 88 94 88 106 96" stroke="url(#bdFlGold)" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M58 100 C70 110 90 110 102 100" stroke="url(#bdFlGold)" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>
      <circle cx="46" cy="40" r="2.2" fill="#F0D078" opacity=".55"/>
      <circle cx="118" cy="48" r="1.8" fill="#F5F0E6" opacity=".45"/>
      <circle cx="36" cy="70" r="1.5" fill="#E8A0B0" opacity=".4"/>
    </svg>`;
  }

  function fireworksSvg() {
    return `<svg class="bd-art bd-art--fireworks" viewBox="0 0 160 160" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="bdFwCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FFF8E0"/>
          <stop offset="35%" stop-color="#E8C35A"/>
          <stop offset="100%" stop-color="#E8C35A" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="bdFwBeam" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FFF4C8" stop-opacity=".95"/>
          <stop offset="100%" stop-color="#D4A843" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="bdFwHorizon" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2A2218" stop-opacity="0"/>
          <stop offset="100%" stop-color="#D4A843" stop-opacity=".25"/>
        </linearGradient>
      </defs>
      <ellipse cx="80" cy="128" rx="52" ry="10" fill="#000" opacity=".35"/>
      <path d="M20 118 C48 104 112 104 140 118" stroke="#8B7340" stroke-width="1.2" opacity=".5"/>
      <rect x="18" y="90" width="124" height="36" fill="url(#bdFwHorizon)"/>
      <g stroke="url(#bdFwBeam)" stroke-width="2" stroke-linecap="round">
        <path d="M80 78 L80 28"/>
        <path d="M80 78 L118 42"/>
        <path d="M80 78 L42 42"/>
        <path d="M80 78 L128 78"/>
        <path d="M80 78 L32 78"/>
        <path d="M80 78 L112 108"/>
        <path d="M80 78 L48 108"/>
        <path d="M80 78 L100 30"/>
        <path d="M80 78 L60 30"/>
      </g>
      <g fill="#F5F0E6">
        <circle cx="80" cy="26" r="2.4"/>
        <circle cx="120" cy="40" r="2"/>
        <circle cx="40" cy="40" r="2"/>
        <circle cx="130" cy="78" r="1.8"/>
        <circle cx="30" cy="78" r="1.8"/>
        <circle cx="114" cy="110" r="1.6"/>
        <circle cx="46" cy="110" r="1.6"/>
        <circle cx="102" cy="28" r="1.4" fill="#E8C35A"/>
        <circle cx="58" cy="28" r="1.4" fill="#E8C35A"/>
      </g>
      <circle cx="80" cy="78" r="22" fill="url(#bdFwCore)"/>
      <circle cx="80" cy="78" r="5" fill="#FFF8E0"/>
      <circle cx="80" cy="78" r="2.2" fill="#B8892E"/>
    </svg>`;
  }

  function toySvg() {
    return `<svg class="bd-art bd-art--toy" viewBox="0 0 160 160" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="bdTyWood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3A2C1C"/>
          <stop offset="100%" stop-color="#1A120C"/>
        </linearGradient>
        <linearGradient id="bdTyGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#F0D078"/>
          <stop offset="50%" stop-color="#D4A843"/>
          <stop offset="100%" stop-color="#8B6914"/>
        </linearGradient>
        <linearGradient id="bdTyLid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4A3824"/>
          <stop offset="100%" stop-color="#2A1E14"/>
        </linearGradient>
        <radialGradient id="bdTyShine" cx="35%" cy="30%" r="60%">
          <stop offset="0%" stop-color="#FFF4D0" stop-opacity=".35"/>
          <stop offset="100%" stop-color="#FFF4D0" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="80" cy="128" rx="40" ry="9" fill="#000" opacity=".4"/>
      <path d="M36 78 H124 V118 C124 124 118 128 112 128 H48 C42 128 36 124 36 118 V78Z" fill="url(#bdTyWood)" stroke="#D4A843" stroke-width="1.8"/>
      <path d="M36 78 H124 V92 H36Z" fill="#24180F" opacity=".55"/>
      <rect x="34" y="52" width="92" height="30" rx="4" fill="url(#bdTyLid)" stroke="#D4A843" stroke-width="1.8"/>
      <path d="M34 66 H126" stroke="#E8C35A" stroke-width="2"/>
      <path d="M80 52 V128" stroke="#E8C35A" stroke-width="1.6" opacity=".75"/>
      <circle cx="80" cy="66" r="7" fill="url(#bdTyGold)" stroke="#F5E6B8" stroke-width="1"/>
      <path d="M80 61 L81.5 65.2 H86 L82.3 67.8 L83.8 72 L80 69.2 L76.2 72 L77.7 67.8 L74 65.2 H78.5 Z" fill="#1A120C"/>
      <path d="M48 44 H112 L124 56 H36 L48 44Z" fill="url(#bdTyGold)" opacity=".92"/>
      <path d="M52 44 L80 34 L108 44" stroke="#F5E6B8" stroke-width="1.2" fill="none" opacity=".7"/>
      <circle cx="80" cy="100" r="10" fill="url(#bdTyGold)" opacity=".25"/>
      <rect x="36" y="52" width="92" height="76" fill="url(#bdTyShine)"/>
      <path d="M44 108 H68" stroke="#D4A843" stroke-width="1" opacity=".35"/>
      <path d="M92 108 H116" stroke="#D4A843" stroke-width="1" opacity=".35"/>
    </svg>`;
  }

  function giftSvg(type) {
    if (type === 'fireworks') return fireworksSvg();
    if (type === 'toy') return toySvg();
    return flowersSvg();
  }

  function giftCardHtml(type, selected) {
    const m = META[type] || META.flowers;
    return `<button type="button" class="bd-gift ${selected ? 'is-on' : ''}" data-gift="${type}" aria-pressed="${selected ? 'true' : 'false'}">
      <div class="bd-gift__glow" aria-hidden="true"></div>
      <div class="bd-gift__art">${giftSvg(type)}</div>
      <div class="bd-gift__name">${m.name}</div>
      <div class="bd-gift__hint">${m.hint}</div>
    </button>`;
  }

  global.AsgardBirthdayArt = { META, giftSvg, giftCardHtml, flowersSvg, fireworksSvg, toySvg };
})(typeof window !== 'undefined' ? window : global);
