/**
 * Дизайн-система зала. Токены повторяют веб-версию (ting-tv.css), чтобы
 * нативный клиент не выглядел «другим продуктом»: те же цвета, радиусы,
 * плотность. Всё, что касается вида, живёт здесь — экраны только собирают.
 */
import { StyleSheet } from 'react-native';

export const COLORS = {
  bg0: '#050608',
  bg1: '#07090D',
  bg2: '#0D1118',
  panel: 'rgba(16,20,28,0.94)',
  panelSolid: '#10141C',
  panelHi: '#161C26',
  line: 'rgba(255,255,255,0.12)',
  lineStrong: 'rgba(255,255,255,0.20)',
  gold: '#C8A84E',
  goldLite: '#E3C97A',
  goldDim: 'rgba(200,168,78,0.35)',
  goldGlow: 'rgba(200,168,78,0.16)',
  danger: '#E8475A',
  dangerDim: 'rgba(232,71,90,0.18)',
  live: '#4CC38A',
  t1: '#F4F6F8',
  t2: 'rgba(244,246,248,0.72)',
  t3: 'rgba(244,246,248,0.48)',
  ink: '#0A0C10',
};

export const RADIUS = { sm: 10, md: 14, lg: 22, xl: 28, pill: 999 };

/* Плотность под 1080p: ТВ смотрят с 2–3 метров, поэтому кегль крупнее,
   чем на десктопе. Значения выведены из веб-версии (clamp 22–40px). */
export const FONT = {
  display: 46,
  h1: 34,
  h2: 26,
  h3: 21,
  body: 18,
  small: 16,
  tiny: 14,
};

/** Панель со стеклянной подложкой — база для карточек и дока. */
export const surfaces = StyleSheet.create({
  panel: {
    backgroundColor: COLORS.panel,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  panelTight: {
    backgroundColor: COLORS.panel,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.goldDim,
    backgroundColor: COLORS.goldGlow,
  },
  chipText: { color: COLORS.gold, fontSize: FONT.tiny, fontWeight: '700', letterSpacing: 0.6 },
});

/**
 * Текст с мягкой тенью: на ТВ под ним может оказаться любая картинка,
 * и без тени подпись читается плохо.
 */
export const textShadow = {
  textShadowColor: 'rgba(0,0,0,0.85)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
};
