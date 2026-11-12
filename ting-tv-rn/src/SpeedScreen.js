import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, RADIUS, textShadow } from './theme';
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
function Big({ value, unit, label, tone }) {
  return (
    <View style={styles.bigBox}>
      <View style={styles.bigRow}>
        <Text style={[styles.bigValue, tone && { color: tone }]}>{value}</Text>
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
  const started = useRef(false);

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
      <View style={styles.card}>
        <Text style={styles.title}>Скорость до нашего сервера</Text>
        <Text style={styles.sub}>
          Маршрут до asgard-crm.ru — именно по нему идут видео и звук зала.
          Сторонние замеры показывают другие направления и для нас не показательны.
        </Text>

        <View style={styles.row}>
          <Big
            value={down ? down.mbps.toFixed(1) : '—'}
            unit="Мбит/с"
            label="Приём от сервера"
            tone={down ? toneFor(v.level) : undefined}
          />
          <Big
            value={up ? up.mbps.toFixed(1) : (code ? '—' : 'н/д')}
            unit="Мбит/с"
            label="Отдача на сервер"
            tone={up ? (up.mbps < v.needUp ? COLORS.danger : COLORS.live) : undefined}
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
          <View style={[styles.verdict, v.level === 'bad' && styles.verdictBad, v.level === 'warn' && styles.verdictWarn]}>
            <Text style={[styles.verdictText, { color: toneFor(v.level) }]}>{v.text}</Text>
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
          style={[styles.cta, focused && styles.ctaFocused]}
        >
          <Text style={styles.ctaText}>Повторить замер</Text>
        </Pressable>

        <Text style={styles.foot} onPress={onBack}>Назад к вводу кода</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  card: {
    width: 920,
    maxWidth: '96%',
    paddingHorizontal: 48,
    paddingVertical: 40,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  title: { color: COLORS.t1, fontSize: FONT.h1, fontWeight: '800' },
  sub: { color: COLORS.t2, fontSize: FONT.small, lineHeight: 24, marginTop: 10, maxWidth: 760 },
  row: { flexDirection: 'row', gap: 24, marginTop: 28 },
  bigBox: {
    flex: 1,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.panelHi,
    paddingVertical: 22,
    paddingHorizontal: 24,
  },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  bigValue: { color: COLORS.t1, fontSize: 64, fontWeight: '800', letterSpacing: -1 },
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
  verdictBad: { borderColor: 'rgba(232,71,90,0.45)', backgroundColor: 'rgba(232,71,90,0.10)' },
  verdictWarn: { borderColor: COLORS.goldDim, backgroundColor: COLORS.goldGlow },
  verdictText: { fontSize: FONT.h3, fontWeight: '800' },
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
  ctaFocused: { backgroundColor: COLORS.goldLite, borderColor: COLORS.t1 },
  ctaText: { color: COLORS.ink, fontSize: FONT.h3, fontWeight: '800' },
  foot: { color: COLORS.gold, fontSize: FONT.small, fontWeight: '700', marginTop: 20, ...textShadow },
});
