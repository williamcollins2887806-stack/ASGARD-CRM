import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  AudioSession,
  LiveKitRoom,
  useTracks,
  useParticipants,
  useLocalParticipant,
  useConnectionState,
} from '@livekit/react-native';
import { Track } from 'livekit-client';
import Hall from './Hall';
import {
  API_BASE,
  ENDPOINTS,
  TOKENS,
  TYPE,
  apiPost,
  hallModeFor,
} from './api';

/**
 * Внутренний экран зала: монтируется только внутри LiveKitRoom, где
 * доступны хуки. Отдельный компонент нужен, потому что хуки LiveKit
 * требуют контекста комнаты.
 */
function RoomBody({ roomTitle, selfName }) {
  const participants = useParticipants();
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();

  /* Видео-треки всех участников. Аудио монтируется отдельно самим SDK. */
  const videoTracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: false,
  });

  const tiles = React.useMemo(() => {
    const out = [];
    const me = localParticipant;
    if (me) {
      const myTrack = videoTracks.find(
        (t) => t.participant && me.identity && t.participant.identity === me.identity,
      );
      out.push({
        id: me.identity || 'me',
        participant: me,
        track: myTrack ? myTrack.publication.track : null,
        isLocal: true,
        isSpeaking: !!me.isSpeaking,
        label: selfName || 'Вы',
        muted: !me.isMicrophoneEnabled,
      });
    }
    participants.forEach((p) => {
      if (!p || p.identity === (me && me.identity)) return;
      const pub = videoTracks.find(
        (t) => t.participant && t.participant.identity === p.identity,
      );
      out.push({
        id: p.identity,
        participant: p,
        track: pub ? pub.publication.track : null,
        isLocal: false,
        isSpeaking: !!p.isSpeaking,
        label: p.name || p.identity,
        muted: !p.isMicrophoneEnabled,
      });
    });
    return out;
  }, [participants, videoTracks, localParticipant, selfName]);

  const remoteCount = Math.max(0, tiles.length - 1);
  const mode = hallModeFor(remoteCount, false);

  return (
    <View style={styles.room}>
      <View style={styles.topBar}>
        <View style={styles.brandDot} />
        <Text style={styles.title} numberOfLines={1}>{roomTitle || 'Тинг'}</Text>
        <Text style={styles.state}>{labelForState(connectionState)}</Text>
      </View>
      <Hall
        mode={mode}
        tiles={tiles}
        title={roomTitle}
        connecting={connectionState !== 'connected'}
      />
      <View style={styles.bottomBar}>
        <Text style={styles.footNote}>
          {tiles.length} {plural(tiles.length, 'участник', 'участника', 'участников')}
          {' · '}микрофон {localParticipant && localParticipant.isMicrophoneEnabled ? 'включён' : 'выключен'}
        </Text>
      </View>
    </View>
  );
}

function labelForState(s) {
  switch (String(s)) {
    case 'connected': return 'на связи';
    case 'connecting': return 'подключение';
    case 'reconnecting': return 'переподключение';
    case 'disconnected': return 'отключено';
    default: return String(s || '');
  }
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/**
 * Корневой экран: получает токен у нашего бэкенда и поднимает LiveKitRoom.
 * Публикация камеры и микрофона идёт нативно (AudioRecord/Camera2 через
 * react-native-webrtc) — именно это решает исходную проблему с микрофоном.
 */
export default function MeetingScreen({ code, pin, onLeave }) {
  const [token, setToken] = useState(null);
  const [serverUrl, setServerUrl] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [identity, setIdentity] = useState('');
  const left = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        /* Аудиосессия обязательна до подключения: без неё WebRTC не получит
           маршрут вывода и звук уйдёт «в никуда». */
        await AudioSession.startAudioSession();

        const res = await apiPost(ENDPOINTS.guestToken(code), {
          pin: pin || undefined,
          name: 'Зал совещаний',
          kind: 'tv',
        });
        if (cancelled) return;
        if (!res || !res.token) throw new Error('сервер не выдал токен');
        setToken(res.token);
        setServerUrl(res.url || res.server_url || API_BASE);
        setTitle((res.room && (res.room.title || res.room.slug)) || code);
        setIdentity(res.identity || '');
      } catch (e) {
        if (!cancelled) setError(String((e && e.message) || e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
      if (!left.current) {
        try { apiPost(ENDPOINTS.leave(code), { identity }).catch(() => {}); } catch (_) {}
      }
      try { AudioSession.stopAudioSession(); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, pin]);

  const handleDisconnect = useCallback(() => {
    if (left.current) return;
    left.current = true;
    try { apiPost(ENDPOINTS.leave(code), { identity }).catch(() => {}); } catch (_) {}
    onLeave && onLeave();
  }, [code, identity, onLeave]);

  if (busy) {
    return (
      <View style={styles.center}>
        <Text style={styles.wait}>Готовим зал…</Text>
      </View>
    );
  }

  if (error || !token || !serverUrl) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Не удалось войти</Text>
        <Text style={styles.errorBody}>{error || 'нет токена'}</Text>
      </View>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect
      audio
      video
      /* Звук с ТВ — только приём: свой микрофон публикуем отдельно. */
      options={{ adaptiveStream: true, dynacast: true }}
      onDisconnected={handleDisconnect}
      onError={(e) => setError(String((e && e.message) || e))}
    >
      <RoomBody roomTitle={title} selfName="Зал совещаний" />
    </LiveKitRoom>
  );
}

const styles = StyleSheet.create({
  room: { flex: 1, backgroundColor: TOKENS.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 10,
  },
  brandDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: TOKENS.gold, marginRight: 12,
  },
  title: { color: TOKENS.text, fontSize: TYPE.h2, fontWeight: '700', flex: 1 },
  state: { color: TOKENS.textMuted, fontSize: TYPE.tiny },
  bottomBar: { paddingHorizontal: 24, paddingVertical: 14, alignItems: 'center' },
  footNote: { color: TOKENS.textMuted, fontSize: TYPE.tiny },
  center: { flex: 1, backgroundColor: TOKENS.bg, alignItems: 'center', justifyContent: 'center' },
  wait: { color: TOKENS.text, fontSize: TYPE.h2 },
  errorTitle: { color: TOKENS.danger, fontSize: TYPE.h1, fontWeight: '700', marginBottom: 12 },
  errorBody: { color: TOKENS.textMuted, fontSize: TYPE.body, textAlign: 'center', paddingHorizontal: 40 },
});
