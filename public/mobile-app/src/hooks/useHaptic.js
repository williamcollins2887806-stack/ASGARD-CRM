/**
 * useHaptic — Vibration API хук
 * Тактильный отклик для ключевых действий
 */
import { useCallback } from 'react';

const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;

function vibrate(pattern) {
  if (canVibrate) {
    try { navigator.vibrate(pattern); } catch {}
  }
}

export function useHaptic() {
  const light = useCallback(() => vibrate(10), []);
  const medium = useCallback(() => vibrate(20), []);
  const heavy = useCallback(() => vibrate(40), []);
  const success = useCallback(() => vibrate([10, 30, 10]), []);
  const error = useCallback(() => vibrate([30, 50, 30, 50, 30]), []);

  return { light, medium, heavy, success, error };
}
