/** Shared tint colors for shop previews + 3D cosmetics (hex numbers). */
export const HELMET_COLORS = {
  helmet_horned: 0x8A9BAC, helmet_steel: 0x7a8794, helmet_jarl: 0xD4A843,
  helmet_berserk: 0x5a4030, helmet_dome: 0x6a7580, helmet_scout: 0x4a5560,
  helmet_dragon: 0x3d6b4f, helmet_ice: 0x88ccff, helmet_fire: 0xc04020,
  helmet_raven: 0x1a1a22, helmet_skull: 0xEEE8D0, helmet_gold: 0xD4A843,
  helmet_rune: 0x708090, helmet_valkyrie: 0xc0c8d8,
};
export const ARMOR_COLORS = {
  armor_chain: 0x606878, armor_jarl: 0x8A9BAC, armor_leather: 0x3a2410,
  armor_plate: 0x707888, armor_rune: 0x556070, armor_dragon: 0x2d5a40,
  armor_ice: 0x6aa8c8, armor_fire: 0xa03820, armor_shadow: 0x1a1a24, armor_gold: 0xD4A843,
};
export const CAPE_COLORS = {
  cape_bear: 0x3a2010, cape_wolf: 0x4a4a55, cape_crimson: 0x8b1a1a,
  cape_night: 0x12121a, cape_frost: 0x4a78a0, cape_ember: 0xb04018,
  cape_raven: 0x0e0e14, cape_gold: 0xC9A227,
};
export const BOOT_COLORS = {
  boots_travel: 0x2a1810, boots_steel: 0x555555, boots_shadow: 0x111118,
  boots_jarl: 0x5a4020, boots_ice: 0x3a6080, boots_fire: 0x6a2010,
};
export const PAINT_COLORS = {
  paint_warrior: 0x2A5A90, paint_berserk: 0x8B0000, paint_runes: 0xD4A843,
  paint_shadow: 0x111111, paint_ice: 0x88ccff, paint_fire: 0xff4400,
  paint_lightning: 0x88aaff,
};
export const SKIN_TINT = {
  body_odin: 0xB87448, body_thor: 0xC88858, body_warrior: 0xB87448,
  body_berserk: 0xA06040, body_volva: 0xC89878, body_skald: 0xB88060,
  body_guard: 0xA87850, body_smith: 0x9A6840, body_hunter: 0xB07048,
  body_jarl: 0xC89060, body_valkyrie: 0xD0A888, body_shadow: 0x8A6050,
};
export const WEAPON_TINT = {
  weapon_axe: 0x8A9BAC, weapon_hammer: 0xD4A843, weapon_spear: 0x707888,
  weapon_sword: 0x9aa8b8, weapon_handaxe: 0x7a8794, weapon_battleaxe: 0x606878,
  weapon_jarl_sword: 0xD4A843, weapon_dagger: 0x708090, weapon_bow: 0x5a4030,
  weapon_axe_shield: 0x8A9BAC, weapon_trident: 0x88ccff, weapon_forge_hammer: 0xc04020,
  weapon_guard_spear: 0x7a8794, weapon_flame_sword: 0xff4400,
};

export function hexCss(n) {
  if (n == null) return '#8A9BAC';
  return `#${Number(n).toString(16).padStart(6, '0')}`;
}

export function colorForAsset(equipSlot, assetKey) {
  const k = assetKey || '';
  if (equipSlot === 'helmet') return hexCss(HELMET_COLORS[k] || 0x7a8794);
  if (equipSlot === 'armor') return hexCss(ARMOR_COLORS[k] || 0x606878);
  if (equipSlot === 'cape') return hexCss(CAPE_COLORS[k] || 0x3a2010);
  if (equipSlot === 'boots') return hexCss(BOOT_COLORS[k] || 0x2a1810);
  if (equipSlot === 'face_paint') return hexCss(PAINT_COLORS[k] || 0x2A5A90);
  if (equipSlot === 'avatar') return hexCss(SKIN_TINT[k] || 0xB87448);
  if (equipSlot === 'weapon') return hexCss(WEAPON_TINT[k] || 0x8A9BAC);
  if (equipSlot === 'frame') {
    if (k.includes('fire')) return '#ff8c30';
    if (k.includes('ice')) return '#88ccff';
    return '#F0C850';
  }
  if (equipSlot === 'theme') {
    if (k.includes('dark') || k.includes('berserk')) return '#444';
    if (k.includes('fire')) return '#ff6030';
    if (k.includes('ice')) return '#88ccff';
    return '#F0C850';
  }
  if (equipSlot === 'badge') return '#F0C850';
  return '#F0C850';
}

export const SLOT_LABEL_RU = {
  helmet: 'Шлем',
  weapon: 'Оружие',
  armor: 'Броня',
  cape: 'Плащ',
  boots: 'Сапоги',
  face_paint: 'Раскраска',
  avatar: 'Облик',
  frame: 'Рамка профиля',
  theme: 'Тема профиля',
  badge: 'Бейдж профиля',
};
