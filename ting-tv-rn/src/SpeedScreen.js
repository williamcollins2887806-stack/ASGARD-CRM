import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { COLORS, FONT, RADIUS } from './theme';
import { measureDownload, measureUpload, verdict } from './speedtest';

/**
 * Экран замера скорости до НАШЕГО сервера.
 *
 * Сторонние замеры бесполезны: они меряют до чужих дата-центров. Здесь важна
 * одна цифра — сколько реально проходит между телевизором и asgard-crm.ru,
 * потому что именно по этому маршруту идут медиапотоки зала.
 *
 * Замер запускается сам при открытии: с пульта лишние нажатия — лишний повод
 * ошибиться.
 */
function Big({ value, unit, label, tone, compact }) {
  return (
    <View style={[styles.bigBox, compact && styles.bigBoxCompact]}>
      <View style={styles.bigRow}>
        <Text style={[styles.bigValue, compact && styles.bigValueCompact, tone && { color: tone }]}>{value}</Text>
        <Text style={styles.bigUnit}>{unit}</Text>
      </View>
      <Text style={styles.bigLabel}>{label}</Text>
    </View>
  );
}

export default function SpeedScreen({ code, onBack }) {
  const [down, setDown] = useState(null);
  const [up, setUp] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);
  const [backFocused, setBackFocused] = useState(false);
  const started = useRef(false);

  /* D-409: экран замера тоже не влезал на 540 dp — карточка 920 dp по ширине
     при 960 dp экрана и высота больше самого экрана. Считаем от реальных dp. */
  const { width, height } = useWindowDimensions();
  const compact = height < 640;
  const cardWidth = Math.min(width - 48, 920);

  const run = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setError('');
    setDown(null);
    setUp(null);
    try {
      setPhase('down');
      const d = await measureDownload(6000, 4);
      setDown(d);

      setPhase('up');
      /* Без кода комнаты отдачу мерить некуда — тогда пропускаем шаг. */
      if (code) {
        const u = await measureUpload(code, 5000);
        setUp(u);
      }
      setPhase('done');
    } catch (e) {
      setError(String((e && e.message) || e));
      setPhase('done');
    }
  }, [code]);

  useEffect(() => { run(); }, [run]);

  const v = verdict({
    down: down ? down.mbps : 0,
    up: up ? up.mbps : 0,
    viewers: 2,
  });

  const toneFor = (lvl) => (lvl === 'bad' ? COLORS.danger : lvl === 'warn' ? COLORS.gold : COLORS.live);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, compact && styles.scrollCompact]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { width: cardWidth }, compact && styles.cardCompact]}>
          <Text style={[styles.title, compact && styles.titleCompact]}>Скорость до нашего сервера</Text>
          <Text style={[styles.sub, compact && styles.subCompact]}>
            Маршрут до asgard-crm.ru — именно по нему идут видео и звук зала.
          </Text>

          <View style={[styles.row, compact && styles.rowCompact]}>
            <Big
              value={down ? down.mbps.toFixed(1) : '—'}
              unit="Мбит/с"
              label="Приём от сервера"
              tone={down ? toneFor(v.level) : undefined}
              compact={compact}
            />
            <Big
              value={up ? up.mbps.toFixed(1) : (code ? '—' : 'н/д')}
              unit="Мбит/с"
              label="Отдача на сервер"
              tone={up ? (up.mbps < v.needUp ? COLORS.danger : COLORS.live) : undefined}
              compact={compact}
            />
          </View>

          {phase !== 'done' ? (
            <View style={styles.progress}>
              <ActivityIndicator color={COLORS.gold} />
              <Text style={styles.progressText}>
                {phase === 'down' ? 'Меряем приём…' : phase === 'up' ? 'Меряем отдачу…' : 'Готовим замер…'}
              </Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>Не удалось: {error}</Text> : null}

          {phase === 'done' ? (
            <View style={[styles.verdict, compact && styles.verdictCompact, v.level === 'bad' && styles.verdictBad, v.level === 'warn' && styles.verdictWarn]}>
              <Text style={[styles.verdictText, compact && styles.verdictTextCompact, { color: toneFor(v.level) }]}>{v.text}</Text>
              <Text style={styles.verdictHint}>
                Нужно примерно {v.needDown.toFixed(1)} Мбит/с на приём для двух собеседников
                и {v.needUp.toFixed(1)} Мбит/с на отдачу для 720p.
              </Text>
            </View>
          ) : null}

          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Повторить замер"
            focusable
            onPress={() => { started.current = false; run(); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[styles.cta, compact && styles.ctaCompact, focused && styles.ctaFocused]}
          >
            <Text style={[styles.ctaText, compact && styles.ctaTextCompact]}>Повторить замер</Text>
          </Pressable>

          {/* D-409: раньше «Назад» был Text с onPress — пультом его не выбрать,
              и с экрана замера было НЕ ВЫЙТИ. Теперь это focusable Pressable. */}
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Назад к вводу кода"
            focusable
            onPress={() => onBack && onBack()}
            onFocus={() => setBackFocused(true)}
            onBlur={() => setBackFocused(false)}
            style={[styles.backBtn, compact && styles.backBtnCompact, backFocused && styles.backBtnFocused]}
          >
            <Text style={[styles.backText, backFocused && styles.backTextFocused]}>Назад к вводу кода</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 16 },
  scrollCompact: { paddingVertical: 8 },
  card: {
    paddingHorizontal: 48,
    paddingVertical: 40,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  cardCompact: { paddingHorizontal: 28, paddingVertical: 18 },
  title: { color: COLORS.t1, fontSize: FONT.h1, fontWeight: '800' },
  titleCompact: { fontSize: 24 },
  sub: { color: COLORS.t2, fontSize: FONT.small, lineHeight: 24, marginTop: 10, maxWidth: 760 },
  subCompact: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  row: { flexDirection: 'row', gap: 24, marginTop: 28 },
  rowCompact: { gap: 14, marginTop: 12 },
  bigBox: {
    flex: 1,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.panelHi,
    paddingVertical: 22,
    paddingHorizontal: 24,
  },
  bigBoxCompact: { paddingVertical: 10, paddingHorizontal: 16 },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  bigValue: { color: COLORS.t1, fontSize: 64, fontWeight: '800', letterSpacing: -1 },
  bigValueCompact: { fontSize: 42 },
  bigUnit: { color: COLORS.t2, fontSize: FONT.small, fontWeight: '700' },
  bigLabel: { color: COLORS.t3, fontSize: FONT.tiny, marginTop: 6, letterSpacing: 0.4 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24 },
  progressText: { color: COLORS.t2, fontSize: FONT.small },
  error: { color: COLORS.danger, fontSize: FONT.small, marginTop: 16, fontWeight: '700' },
  verdict: {
    marginTop: 24,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: 'rgba(76,195,138,0.4)',
    backgroundColor: 'rgba(76,195,138,0.10)',
    padding: 20,
    gap: 8,
  },
  verdictCompact: { marginTop: 12, padding: 14, gap: 4 },
  verdictBad: { borderColor: 'rgba(232,71,90,0.45)', backgroundColor: 'rgba(232,71,90,0.10)' },
  verdictWarn: { borderColor: COLORS.goldDim, backgroundColor: COLORS.goldGlow },
  verdictText: { fontSize: FONT.h3, fontWeight: '800' },
  verdictTextCompact: { fontSize: 17 },
  verdictHint: { color: COLORS.t2, fontSize: FONT.tiny, lineHeight: 21 },
  cta: {
    marginTop: 28,
    height: 66,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.gold,
    borderWidth: 3,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaCompact: { marginTop: 12, height: 50 },
  ctaFocused: { backgroundColor: COLORS.goldLite, borderColor: COLORS.t1 },
  ctaText: { color: COLORS.ink, fontSize: FONT.h3, fontWeight: '800' },
  ctaTextCompact: { fontSize: 17 },
  /* D-409: «Назад» — focusable кнопка: пультом выбирается и нажимается. */
  backBtn: {
    marginTop: 16,
    height: 58,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.lineStrong,
    backgroundColor: COLORS.panelHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnCompact: { marginTop: 10, height: 46 },
  backBtnFocused: { borderColor: COLORS.gold, backgroundColor: COLORS.goldGlow },
  backText: { color: COLORS.t1, fontSize: FONT.small, fontWeight: '700' },
  backTextFocused: { color: COLORS.goldLite },
});
