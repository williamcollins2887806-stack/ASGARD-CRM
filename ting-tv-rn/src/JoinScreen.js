import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { TOKENS, TYPE, initials } from '../api';

/**
 * Экран входа: код комнаты и PIN. Работает без пульта-мыши — на Android TV
 * поля получают фокус по D-pad, Enter подтверждает.
 */
export default function JoinScreen({ onJoin, busy, error }) {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const codeRef = useRef(null);
  const pinRef = useRef(null);

  useEffect(() => {
    /* Фокус на первом поле: на ТВ без этого пульт «не видит» курсора. */
    const t = setTimeout(() => { try { codeRef.current && codeRef.current.focus(); } catch (_) {} }, 400);
    return () => clearTimeout(t);
  }, []);

  const submit = useCallback(() => {
    const c = String(code || '').trim().toLowerCase();
    if (!c) return;
    onJoin && onJoin(c, String(pin || '').trim());
  }, [code, pin, onJoin]);

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.brandRow}>
          <View style={styles.mark}><Text style={styles.markText}>{initials('Тинг')}</Text></View>
          <View>
            <Text style={styles.brand}>Тинг</Text>
            <Text style={styles.brandSub}>Зал совещаний</Text>
          </View>
        </View>

        <Text style={styles.label}>Код комнаты</Text>
        <TextInput
          ref={codeRef}
          style={styles.input}
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="например nmv9ks"
          placeholderTextColor={TOKENS.textMuted}
          onSubmitEditing={() => { try { pinRef.current && pinRef.current.focus(); } catch (_) {} }}
          returnKeyType="next"
          editable={!busy}
          tvParallaxProperties={{ enabled: true }}
        />

        <Text style={styles.label}>PIN (если нужен)</Text>
        <TextInput
          ref={pinRef}
          style={styles.input}
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          placeholder="необязательно"
          placeholderTextColor={TOKENS.textMuted}
          onSubmitEditing={submit}
          returnKeyType="go"
          editable={!busy}
          secureTextEntry
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View
          style={[styles.cta, busy && styles.ctaBusy]}
          accessible
          accessibilityRole="button"
          focusable
          hasTVPreferredFocus={false}
          onStartShouldSetResponder={() => !busy}
          onResponderRelease={submit}
        >
          {busy
            ? <ActivityIndicator color={TOKENS.bg} />
            : <Text style={styles.ctaText}>Войти в зал</Text>}
        </View>

        <Text style={styles.hint}>
          Код показан в CRM в карточке комнаты. Войти можно не раньше чем за час.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: TOKENS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  card: {
    width: 720,
    maxWidth: '92%',
    backgroundColor: TOKENS.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: TOKENS.line,
    paddingHorizontal: 48,
    paddingVertical: 40,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  mark: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: TOKENS.goldSoft,
    borderWidth: 2, borderColor: TOKENS.gold,
    alignItems: 'center', justifyContent: 'center', marginRight: 18,
  },
  markText: { color: TOKENS.gold, fontSize: 22, fontWeight: '800' },
  brand: { color: TOKENS.text, fontSize: TYPE.title, fontWeight: '800' },
  brandSub: { color: TOKENS.textMuted, fontSize: TYPE.body, marginTop: 2 },
  label: { color: TOKENS.textMuted, fontSize: TYPE.small, marginBottom: 8, marginTop: 16 },
  input: {
    backgroundColor: TOKENS.surfaceHi,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: TOKENS.line,
    color: TOKENS.text,
    fontSize: TYPE.h2,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  error: { color: TOKENS.danger, fontSize: TYPE.small, marginTop: 14 },
  cta: {
    marginTop: 28,
    backgroundColor: TOKENS.gold,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  ctaBusy: { opacity: 0.7 },
  ctaText: { color: TOKENS.bg, fontSize: TYPE.h2, fontWeight: '800' },
  hint: { color: TOKENS.textMuted, fontSize: TYPE.tiny, marginTop: 18, lineHeight: 20 },
});
