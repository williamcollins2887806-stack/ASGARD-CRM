import React, { useCallback, useRef, useState } from 'react';
import {
  Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { COLORS, FONT, RADIUS } from './theme';
import { Lock } from './icons';

const MARK = require('./assets/mark.png');

/**
 * Экран входа. Один экран, два поля: код комнаты и PIN.
 *
 * На ТВ важнее фокус, чем форма: поле получает золотую рамку при фокусе,
 * Enter/OK переводит к следующему, кнопка «Войти» — последняя в цепочке.
 */
function Field({ label, hint, inputRef, value, onChangeText, onSubmitEditing, placeholder, secure, focusNext, compact }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.fieldBlock, compact && styles.fieldBlockCompact]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        style={[styles.input, compact && styles.inputCompact, focused && styles.inputFocused]}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={COLORS.t3}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!!secure}
        returnKeyType={focusNext ? 'next' : 'go'}
        blurOnSubmit={false}
        selectionColor={COLORS.gold}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export default function JoinScreen({ onJoin, busy, error, onSpeed }) {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [ctaFocused, setCtaFocused] = useState(false);
  const [speedFocused, setSpeedFocused] = useState(false);
  const pinRef = useRef(null);

  /* D-407: на Android TV плотность экрана часто 2.0 (1920x1080 → 960x540 dp).
     Карточка с width:1080 в dp — это 2160 физических пикселей, то есть шире
     экрана: правая часть и кнопка «Войти» уезжали за границу (фото «не
     помещается»). Считаем размеры от ФАКТИЧЕСКОЙ ширины в dp, а не в px. */
  const { width, height } = useWindowDimensions();
  const compact = height < 640;
  const cardWidth = Math.min(width - 48, 1180);

  const submit = useCallback(() => {
    const c = String(code || '').trim().toLowerCase();
    if (!c || busy) return;
    onJoin && onJoin(c, String(pin || '').trim());
  }, [code, pin, busy, onJoin]);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, compact && styles.scrollCompact]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { width: cardWidth }, compact && styles.cardCompact]}>
          <View style={[styles.head, compact && styles.headCompact]}>
            <Image source={MARK} style={[styles.mark, compact && styles.markCompact]} resizeMode="contain" />
            <View style={styles.headText}>
              <Text style={[styles.brand, compact && styles.brandCompact]}>Тинг</Text>
              <Text style={styles.brandSub}>переговорная ASGARD</Text>
            </View>
            <View style={styles.chip}>
              <Text style={styles.chipText}>ЗАЛ</Text>
            </View>
          </View>

          <Text style={[styles.h1, compact && styles.h1Compact]}>Войти в совещание</Text>
          <Text style={[styles.lead, compact && styles.leadCompact]}>
            Код комнаты из карточки Тинга в CRM — шесть цифр или буквенный код.
          </Text>

          <View style={[styles.grid, compact && styles.gridCompact]}>
            <View style={[styles.left, compact && styles.leftCompact]}>
              <Field
                label="Код комнаты"
                value={code}
                onChangeText={setCode}
                onSubmitEditing={() => { try { pinRef.current && pinRef.current.focus(); } catch (_) {} }}
                placeholder="например 482917"
                focusNext
                compact={compact}
              />
              <Field
                label="PIN"
                hint="Если организатор задал PIN"
                inputRef={pinRef}
                value={pin}
                onChangeText={setPin}
                onSubmitEditing={submit}
                placeholder="необязательно"
                secure
                compact={compact}
              />
            </View>

            {/* D-409: на 540 dp подсказка занимала половину высоты и выталкивала
                кнопки за экран. В компактном режиме она идёт строкой под полями. */}
            {!compact ? (
              <View style={styles.right}>
                <View style={styles.tipBox}>
                  <Lock size={24} color={COLORS.gold} />
                  <Text style={styles.tipTitle}>Без логина CRM</Text>
                  <Text style={styles.tipText}>
                    Зал входит по коду комнаты. Войти можно не раньше чем за час до начала.
                  </Text>
                </View>
              </View>
            ) : null}
          </View>

          {compact ? (
            <Text style={styles.tipInline}>Без логина CRM · вход по коду, не раньше чем за час до начала</Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Войти в зал"
            focusable
            onPress={submit}
            onFocus={() => setCtaFocused(true)}
            onBlur={() => setCtaFocused(false)}
            style={[
              styles.cta,
              compact && styles.ctaCompact,
              ctaFocused && styles.ctaFocused,
              busy && styles.ctaBusy,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={COLORS.ink} />
            ) : (
              <Text style={[styles.ctaText, compact && styles.ctaTextCompact]}>Войти в Тинг</Text>
            )}
          </Pressable>

          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Замерить скорость до сервера"
            focusable
            onPress={() => onSpeed && onSpeed()}
            onFocus={() => setSpeedFocused(true)}
            onBlur={() => setSpeedFocused(false)}
            style={[styles.speedBtn, compact && styles.speedBtnCompact, speedFocused && styles.speedBtnFocused]}
          >
            <Text style={styles.speedText}>Замерить скорость до сервера</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /* D-409: ScrollView — страховка. Даже если карточка чуть выше экрана,
     содержимое доступно пультом, а не обрезается насовсем. */
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 16 },
  scrollCompact: { paddingVertical: 8 },
  card: {
    paddingHorizontal: 48,
    paddingVertical: 36,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  /* D-407/D-409: на 540 dp по высоте полноразмерная карточка не влезает. */
  cardCompact: { paddingHorizontal: 28, paddingVertical: 18 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 26 },
  headCompact: { marginBottom: 12 },
  mark: { width: 68, height: 68, marginRight: 18 },
  markCompact: { width: 44, height: 44, marginRight: 12 },
  headText: { flex: 1 },
  brand: { color: COLORS.t1, fontSize: FONT.display, fontWeight: '800', letterSpacing: 0.4 },
  brandCompact: { fontSize: 30 },
  brandSub: { color: COLORS.t2, fontSize: FONT.small, marginTop: 2 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.goldDim,
    backgroundColor: COLORS.goldGlow,
  },
  chipText: { color: COLORS.gold, fontSize: FONT.tiny, fontWeight: '800', letterSpacing: 1.2 },
  h1: { color: COLORS.t1, fontSize: FONT.h1, fontWeight: '800', marginBottom: 10 },
  h1Compact: { fontSize: 26, marginBottom: 4 },
  lead: { color: COLORS.t2, fontSize: FONT.body, lineHeight: 26, maxWidth: 700 },
  leadCompact: { fontSize: 14, lineHeight: 20 },

  grid: { flexDirection: 'row', gap: 36, marginTop: 28 },
  /* D-409: на низком экране колонки встают друг под друга. */
  gridCompact: { flexDirection: 'column', gap: 8, marginTop: 12 },
  left: { flex: 1, minWidth: 420 },
  leftCompact: { minWidth: 0 },
  right: { width: 300, justifyContent: 'flex-start' },
  fieldBlock: { marginBottom: 20 },
  fieldBlockCompact: { marginBottom: 8 },
  label: { color: COLORS.t2, fontSize: FONT.tiny, fontWeight: '700', marginBottom: 8, letterSpacing: 0.4 },
  input: {
    backgroundColor: COLORS.panelHi,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.line,
    color: COLORS.t1,
    fontSize: FONT.h2,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  inputCompact: { fontSize: 20, paddingHorizontal: 16, paddingVertical: 10 },
  inputFocused: {
    borderColor: COLORS.gold,
    backgroundColor: 'rgba(200,168,78,0.10)',
  },
  hint: { color: COLORS.t3, fontSize: FONT.tiny, marginTop: 7 },
  tipInline: { color: COLORS.t2, fontSize: 12, marginTop: 8 },
  tipBox: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.goldDim,
    backgroundColor: COLORS.goldGlow,
    padding: 20,
    gap: 10,
  },
  tipTitle: { color: COLORS.gold, fontSize: FONT.small, fontWeight: '800' },
  tipText: { color: COLORS.t2, fontSize: FONT.tiny, lineHeight: 21 },
  error: { color: COLORS.danger, fontSize: FONT.small, marginTop: 12, fontWeight: '700' },
  cta: {
    marginTop: 30,
    height: 74,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  ctaCompact: { marginTop: 14, height: 54 },
  ctaFocused: {
    backgroundColor: COLORS.goldLite,
    borderColor: COLORS.t1,
  },
  ctaBusy: { opacity: 0.75 },
  ctaText: { color: COLORS.ink, fontSize: FONT.h2, fontWeight: '800', letterSpacing: 0.3 },
  ctaTextCompact: { fontSize: 20 },
  speedBtn: {
    marginTop: 14,
    height: 58,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.lineStrong,
    backgroundColor: COLORS.panelHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedBtnCompact: { marginTop: 10, height: 46 },
  speedBtnFocused: { borderColor: COLORS.gold, backgroundColor: COLORS.goldGlow },
  speedText: { color: COLORS.t1, fontSize: FONT.small, fontWeight: '700' },
});
