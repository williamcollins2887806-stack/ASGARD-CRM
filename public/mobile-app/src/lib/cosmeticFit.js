/**
 * Soft cosmetic compatibility for Wheel / Shop / Inventory.
 * 3D avatar today = rank GLB + color tints + optional weapon mesh.
 * Almost all gear "fits" any rank; clashes are thematic, not technical.
 */

export const SET_LABELS = {
  neutral: { label: 'Универсальный', hint: 'Сядет на любого воина' },
  dragon: { label: 'Сет Дракон', hint: 'Лучше вместе: драконий шлем/броня' },
  ice: { label: 'Сет Лёд', hint: 'Синий северный стиль' },
  fire: { label: 'Сет Огонь', hint: 'Красная закалка кузни' },
  shadow: { label: 'Сет Тень', hint: 'Чёрный скрытный стиль' },
  jarl: { label: 'Сет Ярл', hint: 'Золото и статус' },
  valkyrie: { label: 'Сет Валькирия', hint: 'К крылатому облику' },
  berserk: { label: 'Сет Берсерк', hint: 'К берсерку и боевой раскраске' },
};

/** Slots that tint / attach on the 3D warrior */
export const AVATAR3D_SLOTS = new Set([
  'helmet', 'weapon', 'armor', 'cape', 'boots', 'face_paint', 'avatar',
]);

/** Slots that only change profile chrome (not the 3D mesh) */
export const PROFILE_SLOTS = new Set(['frame', 'theme', 'badge']);

export function wearTarget(equipSlot) {
  if (!equipSlot) return 'unknown';
  if (AVATAR3D_SLOTS.has(equipSlot)) return 'avatar3d';
  if (PROFILE_SLOTS.has(equipSlot)) return 'profile';
  return 'unknown';
}

export function wearTargetLabel(equipSlot) {
  const t = wearTarget(equipSlot);
  if (t === 'avatar3d') return 'На воина (3D)';
  if (t === 'profile') return 'На профиль (рамка/тема)';
  return 'Предмет';
}

export function deriveSetTag(assetKey, equipSlot, explicit) {
  if (explicit) return explicit;
  const k = (assetKey || '').toLowerCase();
  if (!k) return equipSlot && AVATAR3D_SLOTS.has(equipSlot) ? 'neutral' : null;
  if (k.includes('dragon')) return 'dragon';
  if (k.includes('ice') || k.includes('frost')) return 'ice';
  if (k.includes('fire') || k.includes('flame') || k.includes('ember')) return 'fire';
  if (k.includes('shadow') || k.includes('night') || k === 'helmet_skull' || k === 'helmet_raven' || k === 'cape_raven') {
    return 'shadow';
  }
  if (k.includes('jarl') || k.includes('gold')) return 'jarl';
  if (k.includes('valkyrie')) return 'valkyrie';
  if (k.includes('berserk')) return 'berserk';
  if (AVATAR3D_SLOTS.has(equipSlot)) return 'neutral';
  return null;
}

/**
 * Soft advice when equipping item onto current body/assets.
 * Never hard-blocks — tint system accepts any combo.
 */
export function softFitAdvice({ equipSlot, assetKey, setTag, bodyKey }) {
  const target = wearTarget(equipSlot);
  if (target === 'profile') {
    return { ok: true, level: 'info', message: 'Меняет оформление профиля, не 3D-воина' };
  }
  if (target !== 'avatar3d') {
    return { ok: true, level: 'info', message: null };
  }
  const set = deriveSetTag(assetKey, equipSlot, setTag);
  const body = (bodyKey || '').toLowerCase();
  if (set === 'valkyrie' && body && !body.includes('valkyrie') && equipSlot !== 'avatar') {
    return { ok: true, level: 'warn', message: 'Крылатый стиль лучше смотрится на облике Валькирии' };
  }
  if (set === 'berserk' && body && !body.includes('berserk') && equipSlot !== 'avatar') {
    return { ok: true, level: 'warn', message: 'Берсерк-сет ярче на облике Берсерка' };
  }
  if (set && set !== 'neutral' && SET_LABELS[set]) {
    return { ok: true, level: 'ok', message: SET_LABELS[set].hint };
  }
  return { ok: true, level: 'ok', message: 'Сядет на любого воина' };
}
