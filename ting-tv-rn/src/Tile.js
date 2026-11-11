import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { RTCView } from '@livekit/react-native-webrtc';
import { COLORS, FONT, RADIUS, textShadow } from './theme';
import { MicOff } from './icons';

const MARK = require('./assets/mark-round.png');

/**
 * Плитка участника.
 *
 * Требования зала: кадр 16:9 без обрезки (objectFit contain), подпись читается
 * на любой картинке, речь видна с трёх метров, выключенный микрофон заметен
 * сразу. Тени и блюр не используем — они пересчитываются на каждом кадре
 * видео и роняют FPS на телеке.
 */
export default function Tile({ stall, isSpeaking, label, muted, isLocal }) {
  const streamURL = useMemo(() => {
    if (!stall) return null;
    const ms = stall.mediaStreamTrack;
    if (!ms) return null;
    try {
      return ms.toURL ? ms.toURL() : null;
    } catch (_) {
      return null;
    }
  }, [stall]);

  return (
    <View style={[styles.tile, isSpeaking && styles.speaking]}>
      {streamURL ? (
        <RTCView
          streamURL={streamURL}
          style={styles.video}
          objectFit="contain"
          mirror={!!isLocal}
          zOrder={0}
        />
      ) : (
        <View style={styles.empty}>
          <Image source={MARK} style={styles.mark} resizeMode="contain" />
          <Text style={styles.emptyName} numberOfLines={2}>{label || 'Участник'}</Text>
        </View>
      )}

      <View style={styles.bar}>
        <View style={styles.namePill}>
          <Text style={styles.name} numberOfLines={1}>{label || 'Участник'}</Text>
        </View>
        {muted ? (
          <View style={styles.mutePill}>
            <MicOff size={16} color={COLORS.danger} />
            <Text style={styles.muteText}>выкл</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    aspectRatio: 16 / 9,
    backgroundColor: COLORS.panelSolid,
    borderRadius: RADIUS.lg,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    margin: 6,
  },
  /* Индикатор речи — только рамка: тень вокруг плитки перерисовывалась бы
     на каждом кадре видео. */
  speaking: { borderColor: COLORS.gold },
  video: { flex: 1, backgroundColor: '#000' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.panelHi,
  },
  mark: { width: 96, height: 96, opacity: 0.9 },
  emptyName: {
    marginTop: 18,
    color: COLORS.t2,
    fontSize: FONT.h3,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  namePill: {
    backgroundColor: 'rgba(6,8,12,0.80)',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: '72%',
  },
  name: { color: COLORS.t1, fontSize: FONT.small, fontWeight: '700', ...textShadow },
  mutePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(6,8,12,0.80)',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  muteText: { color: COLORS.danger, fontSize: FONT.tiny, fontWeight: '700' },
});
