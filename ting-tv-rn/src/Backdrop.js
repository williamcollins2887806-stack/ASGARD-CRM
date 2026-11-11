import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, LinearGradient, Stop, Rect } from 'react-native-svg';
import { COLORS } from './theme';

/**
 * Фон зала. В веб-версии это radial-gradient со свечением сверху и линейный
 * переход вниз. В React Native нет CSS-градиентов, поэтому рисуем тем же
 * способом через SVG — результат идентичен и не требует картинок.
 */
export default function Backdrop({ children }) {
  return (
    <View style={styles.root}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="base" x1="0" y1="0" x2="0.4" y2="1">
            <Stop offset="0" stopColor={COLORS.bg2} stopOpacity="1" />
            <Stop offset="0.55" stopColor={COLORS.bg1} stopOpacity="1" />
            <Stop offset="1" stopColor={COLORS.bg0} stopOpacity="1" />
          </LinearGradient>
          <RadialGradient id="glow" cx="50%" cy="0%" rx="62%" ry="42%">
            <Stop offset="0" stopColor={COLORS.gold} stopOpacity="0.13" />
            <Stop offset="0.55" stopColor={COLORS.gold} stopOpacity="0.04" />
            <Stop offset="1" stopColor={COLORS.gold} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#base)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#glow)" />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg0 },
});
