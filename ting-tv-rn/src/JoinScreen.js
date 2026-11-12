import React, { useCallback, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { COLORS, FONT, RADIUS, textShadow } from './theme';
import { Lock } from './icons';

const MARK = require('./assets/mark.png');

/**
 * Экран входа. Один экран, два поля: код комнаты и PIN.
 *
 * На ТВ важнее фокус, чем форма: поле получает золотую рамку при фокусе,
 * Enter/OK переводит к следующему, кнопка «Войти» — последняя в цепочке.
 */
function Field({ label, hint, inputRef, value, onChangeText, onSubmitEditing, placeholder, secure, focusNext }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        style={[styles.input, focused && styles.inputFocused]}
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

  const submit = useCallback(() => {
    const c = String(code || '').trim().toLowerCase();
    if (!c || busy) return;
    onJoin && onJoin(c, String(pin || '').trim());
  }, [code, pin, busy, onJoin]);

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.head}>
          <Image source={MARK} style={styles.mark} resizeMode="contain" />
          <View style={styles.headText}>
            <Text style={styles.brand}>Тинг</Text>
            <Text style={styles.brandSub}>переговорная ASGARD</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>ЗАЛ</Text>
          </View>
        </View>

        <Text style={styles.h1}>Войти в совещание</Text>
        <Text style={styles.lead}>
          Код комнаты из карточки Тинга в CRM — шесть цифр или буквенный код.
        </Text>

        <View style={styles.grid}>
          <View style={styles.left}>
            <Field
              label="Код комнаты"
              value={code}
              onChangeText={setCode}
              onSubmitEditing={() => { try { pinRef.current && pinRef.current.focus(); } catch (_) {} }}
              placeholder="например 482917"
              focusNext
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
            />
          </View>

          <View style={styles.right}>
            <View style={styles.tipBox}>
              <Lock size={24} color={COLORS.gold} />
              <Text style={styles.tipTitle}>Без логина CRM</Text>
              <Text style={styles.tipText}>
                Зал входит по коду комнаты. Войти можно не раньше чем за час до начала.
              </Text>
            </View>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Войти в зал"
          focusable
          onPress={submit}
          onFocus={() => setCtaFocused(true)}
          onBlur={() => setCtaFocused(false)}
          style={[styles.cta, ctaFocused && styles.ctaFocused, busy && styles.ctaBusy]}
        >
          {busy ? (
            <ActivityIndicator color={COLORS.ink} />
          ) : (
            <Text style={styles.ctaText}>Войти в Тинг</Text>
          )}
        </Pressable>

        <Text style={styles.foot}>
          Пульт: стрелки — выбор поля, OK — подтвердить.
        </Text>

        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Замерить скорость до сервера"
          focusable
          onPress={() => onSpeed && onSpeed()}
          onFocus={() => setSpeedFocused(true)}
          onBlur={() => setSpeedFocused(false)}
          style={[styles.speedBtn, speedFocused && styles.speedBtnFocused]}
        >
          <Text style={styles.speedText}>Замерить скорость до сервера</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  card: {
    width: 1080,
    maxWidth: '96%',
    paddingHorizontal: 56,
    paddingVertical: 44,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 26 },
  mark: { width: 68, height: 68, marginRight: 18 },
  headText: { flex: 1 },
  brand: { color: COLORS.t1, fontSize: FONT.display, fontWeight: '800', letterSpacing: 0.4 },
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
  lead: { color: COLORS.t2, fontSize: FONT.body, lineHeight: 26, maxWidth: 700 },
  grid: { flexDirection: 'row', gap: 36, marginTop: 28 },
  left: { flex: 1, minWidth: 420 },
  right: { width: 300, justifyContent: 'flex-start' },
  fieldBlock: { marginBottom: 20 },
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
  inputFocused: {
    borderColor: COLORS.gold,
    backgroundColor: 'rgba(200,168,78,0.10)',
  },
  hint: { color: COLORS.t3, fontSize: FONT.tiny, marginTop: 7 },
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
  ctaFocused: {
    backgroundColor: COLORS.goldLite,
    borderColor: COLORS.t1,
  },
  ctaBusy: { opacity: 0.75 },
  ctaText: { color: COLORS.ink, fontSize: FONT.h2, fontWeight: '800', letterSpacing: 0.3 },
  foot: { color: COLORS.t3, fontSize: FONT.tiny, marginTop: 18, ...textShadow },
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
  speedBtnFocused: { borderColor: COLORS.gold, backgroundColor: COLORS.goldGlow },
  speedText: { color: COLORS.t1, fontSize: FONT.small, fontWeight: '700' },
});
