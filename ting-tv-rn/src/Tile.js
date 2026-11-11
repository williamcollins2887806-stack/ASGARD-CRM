import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RTCView } from '@livekit/react-native-webrtc';
import { TOKENS, TYPE, initials } from '../api';

/**
 * Плитка участника. Видео держит 16:9 (aspectRatio) и вписывается в ячейку
 * без обрезки: на ТВ это критично, иначе лицо «как в масштабе».
 */
export default function Tile({ participant, track, isLocal, isSpeaking, label, muted }) {
  useEffect(() => {
    /* На ТВ элемент монтируется заново при смене раскладки — RTCView сам
       отпускает поток при размонтировании, поэтому cleanup не требуется.
       Пустой эффект оставлен намеренно: он фиксирует это решение. */
    return undefined;
  }, []);

  const streamURL = track && track.mediaStreamTrack
    ? (track.mediaStreamTrack.toURL ? track.mediaStreamTrack.toURL() : null)
    : null;

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
        <View style={styles.fallback}>
          <View style={[styles.avatar, muted && styles.avatarMuted]}>
            <Text style={styles.avatarText}>{initials(label)}</Text>
          </View>
        </View>
      )}
      <View style={styles.labelRow}>
        <Text style={styles.label} numberOfLines={1}>{label || 'Участник'}</Text>
        {muted ? <Text style={styles.micOff}>выкл</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    aspectRatio: 16 / 9,
    backgroundColor: TOKENS.surface,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    margin: 5,
  },
  /* Индикатор речи — рамка, без тени: тень перерисовывается на каждом кадре. */
  speaking: { borderColor: TOKENS.gold },
  video: { flex: 1, backgroundColor: '#000' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: TOKENS.surfaceHi },
  avatar: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: TOKENS.goldSoft,
    borderWidth: 2, borderColor: TOKENS.gold,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarMuted: { borderColor: TOKENS.line, backgroundColor: TOKENS.surface },
  avatarText: { color: TOKENS.gold, fontSize: 40, fontWeight: '800' },
  labelRow: {
    position: 'absolute', left: 12, bottom: 12, right: 12,
    flexDirection: 'row', alignItems: 'center',
  },
  label: {
    color: TOKENS.text,
    backgroundColor: 'rgba(10,12,16,0.78)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: TYPE.small,
    overflow: 'hidden',
  },
  micOff: {
    marginLeft: 8,
    color: TOKENS.danger,
    backgroundColor: 'rgba(10,12,16,0.78)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: TYPE.tiny,
  },
});
