import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, RADIUS, textShadow } from './theme';
import { MicOn, MicOff, CamOn, CamOff, People, Hang } from './icons';

/**
 * Нижний док. На ТВ главное — предсказуемый фокус: пульт ходит по кнопкам
 * влево/вправо, OK нажимает. Поэтому каждая кнопка — Pressable с onFocus и
 * явной золотой рамкой фокуса, как в веб-версии (--ttv-focus).
 */
function DockButton({ icon, label, onPress, danger, active, accessibilityLabel }) {
  const [focused, setFocused] = useState(false);
  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      focusable
      onPress={onPress}
      onFocus={handleFocus}
      onBlur={handleBlur}
      style={[
        styles.btn,
        danger && styles.btnDanger,
        active === false && styles.btnOff,
        focused && styles.btnFocused,
      ]}
    >
      {icon}
      <Text
        style={[styles.btnLabel, danger && styles.btnLabelOnDanger, focused && styles.btnLabelFocused]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function Dock({ micOn, camOn, onToggleMic, onToggleCam, onPeople, onLeave, peopleOpen }) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.inner}>
        <DockButton
          icon={micOn ? <MicOn /> : <MicOff />}
          label={micOn ? 'Микрофон' : 'Выкл'}
          active={micOn}
          onPress={onToggleMic}
          accessibilityLabel={micOn ? 'Выключить микрофон' : 'Включить микрофон'}
        />
        <DockButton
          icon={camOn ? <CamOn /> : <CamOff />}
          label={camOn ? 'Камера' : 'Выкл'}
          active={camOn}
          onPress={onToggleCam}
          accessibilityLabel={camOn ? 'Выключить камеру' : 'Включить камеру'}
        />
        <DockButton
          icon={<People />}
          label="Участники"
          active={!peopleOpen}
          onPress={onPeople}
          accessibilityLabel="Список участников"
        />
        <DockButton
          icon={<Hang size={26} color={COLORS.dangerDeep || '#fff'} />}
          label="Выйти"
          danger
          onPress={onLeave}
          accessibilityLabel="Выйти из зала"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingBottom: 22,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(10,13,18,0.92)',
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  btn: {
    minWidth: 108,
    height: 62,
    paddingHorizontal: 18,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(20,25,34,0.9)',
    borderWidth: 1,
    borderColor: COLORS.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  btnOff: { borderColor: COLORS.dangerDim },
  btnDanger: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
  /* Фокус: две рамки (тёмная внутри, золотая снаружи) — тот же приём,
     что --ttv-focus в вебе. Видно с трёх метров. */
  btnFocused: {
    borderColor: COLORS.gold,
    backgroundColor: 'rgba(200,168,78,0.20)',
    transform: [{ scale: 1.04 }],
  },
  btnLabel: { color: COLORS.t1, fontSize: FONT.small, fontWeight: '700', ...textShadow },
  btnLabelOnDanger: { color: '#fff' },
  btnLabelFocused: { color: COLORS.goldLite },
});
