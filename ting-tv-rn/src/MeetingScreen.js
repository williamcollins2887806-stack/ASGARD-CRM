import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import {
  AudioSession,
  LiveKitRoom,
  useTracks,
  useParticipants,
  useLocalParticipant,
  useConnectionState,
  useRoomContext,
} from '@livekit/react-native';
import { Track } from 'livekit-client';
import Hall from './Hall';
import Dock from './Dock';
import { COLORS, FONT } from './theme';
import { API_BASE, ENDPOINTS, apiPost, hallModeFor } from './api';
import { startTvMetrics } from './tvMetrics';

const MARK = require('./assets/mark.png');

/** Секунды → mm:ss, как в веб-версии. */
function fmtTimer(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
}

function stateLabel(s) {
  switch (String(s)) {
    case 'connected': return 'на связи';
    case 'connecting': return 'подключение';
    case 'reconnecting': return 'переподключение';
    case 'disconnected': return 'отключено';
    default: return '';
  }
}

/**
 * Внутри LiveKitRoom: собирает плитки из треков, рисует зал и док.
 * Отдельный компонент, потому что хуки LiveKit требуют контекста комнаты.
 */
function RoomBody({ roomTitle, selfName, onLeave, startedAt, code, identity }) {
  const room = useRoomContext();
  const participants = useParticipants();
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [timer, setTimer] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setTimer(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  /* Непрерывная телеметрия surface='tv' → thing_client_metrics. */
  useEffect(() => {
    if (!room || !code) return undefined;
    const stop = startTvMetrics({ room, code, identity });
    return () => {
      try { stop(); } catch (_) { /* */ }
    };
  }, [room, code, identity]);

  /* Обе камеры и шаринг экрана: тип источника задаём явно, иначе camera
     выбранной пользователем камеры может не оказаться в списке. */
  const videoTracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: false,
  });

  const tiles = useMemo(() => {
    const out = [];
    const me = localParticipant;
    if (me) {
      const mine = videoTracks.find(
        (t) => t.participant && me.identity && t.participant.identity === me.identity,
      );
      out.push({
        id: me.identity || 'me',
        track: mine && mine.publication ? mine.publication.track : null,
        isLocal: true,
        isSpeaking: !!me.isSpeaking,
        label: selfName || 'Зал',
        muted: !micOn,
      });
    }
    participants.forEach((p) => {
      if (!p || p.identity === (me && me.identity)) return;
      const pub = videoTracks.find(
        (t) => t.participant && t.participant.identity === p.identity,
      );
      out.push({
        id: p.identity,
        track: pub && pub.publication ? pub.publication.track : null,
        isLocal: false,
        isSpeaking: !!p.isSpeaking,
        label: p.name || p.identity,
        muted: !p.isMicrophoneEnabled,
      });
    });
    return out;
  }, [participants, videoTracks, localParticipant, selfName, micOn]);

  const remoteCount = Math.max(0, tiles.length - 1);
  const mode = hallModeFor(remoteCount, false);

  const toggleMic = useCallback(async () => {
    if (!localParticipant) return;
    const next = !micOn;
    setMicOn(next);
    try { await localParticipant.setMicrophoneEnabled(next); } catch (_) { setMicOn(!next); }
  }, [localParticipant, micOn]);

  const toggleCam = useCallback(async () => {
    if (!localParticipant) return;
    const next = !camOn;
    setCamOn(next);
    try { await localParticipant.setCameraEnabled(next); } catch (_) { setCamOn(!next); }
  }, [localParticipant, camOn]);

  return (
    <View style={styles.fill}>
      <Hall
        tiles={tiles}
        title={roomTitle}
        timer={fmtTimer(timer)}
        stateLabel={stateLabel(connectionState)}
        mode={mode}
        peopleOpen={peopleOpen}
        connecting={connectionState === 'connecting'}
      />
      <Dock
        micOn={micOn}
        camOn={camOn}
        peopleOpen={peopleOpen}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onPeople={() => setPeopleOpen((v) => !v)}
        onLeave={onLeave}
      />
    </View>
  );
}

/**
 * Корневой экран зала. Получает токен у нашего бэкенда и поднимает
 * LiveKitRoom. Публикация камеры и микрофона идёт нативно (AudioRecord и
 * Camera2 внутри react-native-webrtc) — именно это решает проблему WebView,
 * где микрофон отдавал цифровую тишину.
 */
export default function MeetingScreen({ code, pin, onLeave }) {
  const [token, setToken] = useState(null);
  const [serverUrl, setServerUrl] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [identity, setIdentity] = useState('');
  const startedAt = useRef(Date.now()).current;
  const left = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        /* Аудиосессия обязательна до подключения: без неё WebRTC не получит
           аудиомаршрут, и звук уйдёт в никуда на части прошивок ТВ. */
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

  const handleLeave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    try { apiPost(ENDPOINTS.leave(code), { identity }).catch(() => {}); } catch (_) {}
    try { AudioSession.stopAudioSession(); } catch (_) {}
    onLeave && onLeave();
  }, [code, identity, onLeave]);

  if (busy) {
    return (
        <View style={styles.center}>
          <Image source={MARK} style={styles.bigMark} resizeMode="contain" />
          <ActivityIndicator color={COLORS.gold} size="large" />
          <Text style={styles.waitTitle}>Готовим зал</Text>
        </View>
    );
  }

  if (error || !token || !serverUrl) {
    return (
        <View style={styles.center}>
          <Image source={MARK} style={styles.bigMark} resizeMode="contain" />
          <Text style={styles.errorTitle}>Не удалось войти</Text>
          <Text style={styles.errorBody}>{error || 'нет токена'}</Text>
          <Text style={styles.errorHint} onPress={onLeave}>Вернуться к вводу кода</Text>
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
        options={{ adaptiveStream: true, dynacast: true }}
        onDisconnected={handleLeave}
        onError={(e) => setError(String((e && e.message) || e))}
      >
        <RoomBody
          roomTitle={title}
          selfName="Зал совещаний"
          onLeave={handleLeave}
          startedAt={startedAt}
          code={code}
          identity={identity}
        />
      </LiveKitRoom>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 18 },
  bigMark: { width: 140, height: 140, opacity: 0.9 },
  waitTitle: { color: COLORS.t1, fontSize: FONT.h1, fontWeight: '800' },
  errorTitle: { color: COLORS.danger, fontSize: FONT.h1, fontWeight: '800' },
  errorBody: { color: COLORS.t2, fontSize: FONT.body, textAlign: 'center', maxWidth: 720, lineHeight: 26 },
  errorHint: { color: COLORS.gold, fontSize: FONT.body, fontWeight: '700', marginTop: 10 },
});
