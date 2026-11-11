import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { COLORS } from './theme';

/**
 * Иконки дока. Векторные, а не шрифт/PNG: на 4K-панели растровые иконки
 * выглядят мылом, а символьные глифы зависят от шрифта системы.
 */

const S = ({ size = 26, color = COLORS.t1, children }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {children}
  </Svg>
);

export function MicOn({ size, color = COLORS.t1 }) {
  return (
    <S size={size} color={color}>
      <Rect x="9" y="2.5" width="6" height="11" rx="3" stroke={color} strokeWidth="1.8" />
      <Path d="M5.5 11a6.5 6.5 0 0 0 13 0" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M12 17.5V21M9 21h6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </S>
  );
}

export function MicOff({ size, color = COLORS.danger }) {
  return (
    <S size={size} color={color}>
      <Rect x="9" y="2.5" width="6" height="11" rx="3" stroke={color} strokeWidth="1.8" />
      <Path d="M5.5 11a6.5 6.5 0 0 0 13 0" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M12 17.5V21M9 21h6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M3.5 3.5l17 17" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </S>
  );
}

export function CamOn({ size, color = COLORS.t1 }) {
  return (
    <S size={size} color={color}>
      <Rect x="2.5" y="6" width="13" height="12" rx="3" stroke={color} strokeWidth="1.8" />
      <Path d="M15.5 10.5l6-3.2v9.4l-6-3.2" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </S>
  );
}

export function CamOff({ size, color = COLORS.danger }) {
  return (
    <S size={size} color={color}>
      <Rect x="2.5" y="6" width="13" height="12" rx="3" stroke={color} strokeWidth="1.8" />
      <Path d="M15.5 10.5l6-3.2v9.4l-6-3.2" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <Path d="M3.5 3.5l17 17" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </S>
  );
}

export function People({ size, color = COLORS.t1 }) {
  return (
    <S size={size} color={color}>
      <Circle cx="9" cy="8" r="3.4" stroke={color} strokeWidth="1.8" />
      <Path d="M2.8 19.5c0-3.3 2.8-5.4 6.2-5.4s6.2 2.1 6.2 5.4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M16.2 5.2a3.2 3.2 0 0 1 0 6.1M17.5 14.6c2.3.6 3.8 2.2 3.8 4.9" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </S>
  );
}

export function Hang({ size, color = '#fff' }) {
  return (
    <S size={size} color={color}>
      <Path
        d="M4.2 14.6c4.9-4.6 10.7-4.6 15.6 0l1.5-2.1c.5-.7.4-1.6-.2-2.2-5.6-5.2-13.9-5.2-19.5 0-.6.6-.7 1.5-.2 2.2l2.8 2.1z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </S>
  );
}

export function Speaker({ size, color = COLORS.t1 }) {
  return (
    <S size={size} color={color}>
      <Path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <Path d="M15.5 9c1.6 1.7 1.6 4.3 0 6M18.4 6.4c2.9 3.1 2.9 8.1 0 11.2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </S>
  );
}

export function Lock({ size, color = COLORS.t2 }) {
  return (
    <S size={size} color={color}>
      <Rect x="4.5" y="10" width="15" height="11" rx="3" stroke={color} strokeWidth="1.8" />
      <Path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </S>
  );
}
