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
import { mediaDevices } from '@livekit/react-native-webrtc';
import Hall from './Hall';
import Dock from './Dock';
import { COLORS, FONT } from './theme';
import { API_BASE, ENDPOINTS, apiPost, hallModeFor } from './api';
import { startTvMetrics } from './tvMetrics';
import { ensureMediaPermissions, permissionHint } from './permissions';
import { setLogRoom, flushLogs } from './remoteLog';

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

  /* D-411: удалённый звук идёт по peer connection и воспроизводится нативно
     самим react-native-webrtc — отдельный компонент для этого не нужен. */

  useEffect(() => {
    const t = setInterval(() => {
      setTimer(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  /* D-410: КОРЕНЬ «камера не захватывается».
     Прошлый фикс передавал { deviceId, width, height }, но у VideoCaptureOptions
     (livekit-client 2.x) НЕТ полей width/height — размер задаётся только через
     resolution: { width, height }. Лишние ключи SDK молча игнорирует, размер
     остаётся неопределённым, и USB-камера на ТВ отдаёт трек, который сразу
     гасится: индикатор вспыхивает и пропадает, кнопка возвращается в «выкл».
     Микрофон тоже включаем с явными опциями (AEC/NS/AGC), иначе на части
     прошивок аудиотрак не стартует.
     Сначала пробуем deviceId + resolution, затем resolution без deviceId,
     затем голые опции — три ступени, а не одна. */
  useEffect(() => {
    if (!localParticipant) return undefined;
    let cancelled = false;

    const pickCameraId = async () => {
      try {
        const devices = await mediaDevices.enumerateDevices();
        const cams = (devices || []).filter((d) => d.kind === 'videoinput');
        console.info('[TingTV] камер найдено', cams.length,
          JSON.stringify(cams.map((c) => ({ id: (c.deviceId || '').slice(0, 12), label: c.label }))));
        const cam = cams.find((d) => d.deviceId);
        return cam && cam.deviceId ? String(cam.deviceId) : null;
      } catch (e) {
        console.warn('[TingTV] enumerate', e && e.name, e && e.message);
        return null;
      }
    };

    (async () => {
      /* Микрофон: явные опции обработки звука. */
      try {
        await localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
      } catch (e) {
        console.warn('[TingTV] mic', e && e.name, e && e.message);
      }
      if (cancelled) return;

      const camId = await pickCameraId();
      if (cancelled) return;

      const resolution = { width: 1280, height: 720, frameRate: 30 };
      const attempts = [];
      if (camId) attempts.push({ deviceId: camId, resolution });
      attempts.push({ resolution });
      attempts.push({});

      for (let i = 0; i < attempts.length; i += 1) {
        if (cancelled) return;
        const opts = attempts[i];
        try {
          const pub = await localParticipant.setCameraEnabled(true, opts);
          console.info('[TingTV] camera attempt', i + 1, '->',
            pub ? ('pub sid=' + (pub.trackSid || '?') + ' kind=' + (pub.track ? pub.track.kind : 'нет')) : 'undefined',
            JSON.stringify(opts));
          if (pub && (pub.track || pub.videoTrack)) {
            try {
              const mt = pub.track && pub.track.mediaStreamTrack;
              const s = mt && mt.getSettings ? mt.getSettings() : {};
              console.info('[TingTV] camera settings', JSON.stringify({
                w: s.width, h: s.height, fps: s.frameRate, device: (s.deviceId || '').slice(0, 12),
              }));
            } catch (_) { /* */ }
            return;
          }
        } catch (e) {
          console.warn('[TingTV] camera', i + 1, e && e.name, e && e.message);
        }
      }
      console.warn('[TingTV] camera: все попытки неудачны');
    })();

    return () => {
      cancelled = true;
    };
  }, [localParticipant]);

  /* Непрерывная телеметрия surface='tv' → thing_client_metrics. */
  useEffect(() => {
    if (!room || !code) return undefined;
    const stop = startTvMetrics({ room, code, identity });
    return () => {
      try { stop(); } catch (_) { /* */ }
    };
  }, [room, code, identity]);

  /* D-406: только ПОДПИСАННЫЕ треки. С onlySubscribed:false useTracks отдаёт и
     публикации, на которые мы ещё не подписаны, — у них publication.track = null.
     В плитке получался пустой RTCView: человек «есть», картинки нет.
     Default SDK = true, и это правильно для отрисовки чужого видео. */
  const videoTracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);

  /* D-413: видно, какие треки реально приходят и подписаны ли мы на них. */
  useEffect(() => {
    try {
      const info = videoTracks.map((t) => ({
        who: t.participant ? t.participant.identity : '?',
        local: !!(t.participant && t.participant.isLocal),
        hasTrack: !!(t.publication && t.publication.track),
        subscribed: !!(t.publication && t.publication.isSubscribed),
      }));
      console.info('[TingTV] видеотреков', info.length, JSON.stringify(info));
    } catch (_) { /* */ }
  }, [videoTracks]);

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
    try {
      if (next) {
        /* D-408/D-412: те же ограничения, что в дефолтах комнаты. Ключевое —
           resolution, а не width/height: у VideoCaptureOptions других полей нет. */
        let opts = { resolution: { width: 1280, height: 720, frameRate: 30 } };
        try {
          const devices = await mediaDevices.enumerateDevices();
          const cam = (devices || []).find((d) => d.kind === 'videoinput' && d.deviceId);
          if (cam && cam.deviceId) {
            opts = {
              deviceId: String(cam.deviceId),
              resolution: { width: 1280, height: 720, frameRate: 30 },
            };
          }
        } catch (_) { /* */ }
        const pub = await localParticipant.setCameraEnabled(true, opts);
        if (!pub) throw new Error('нет публикации');
      } else {
        await localParticipant.setCameraEnabled(false);
      }
    } catch (e) {
      console.warn('[TingTV] toggleCam', e && e.name, e && e.message);
      setCamOn(!next);
    }
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
  const [permissionNote, setPermissionNote] = useState('');
  const startedAt = useRef(Date.now()).current;
  const left = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      /* D-413: логи привязываются к комнате — только тогда уходят на сервер. */
      setLogRoom(code);
      console.info('[TingTV] вход в комнату', code, 'pin', pin ? 'да' : 'нет');
      try {
        /* D-405: сначала разрешения. Без них AudioRecord/Camera2 отдадут пустой
           поток, и в зале будет «камера не работает» без объяснения причины.
           Запрос идёт ДО аудиосессии: Android не даёт открыть микрофон, пока
           разрешение не выдано. */
        const granted = await ensureMediaPermissions();
        console.info('[TingTV] разрешения', JSON.stringify(granted));
        if (cancelled) return;
        if (!granted.camera || !granted.mic) {
          setPermissionNote(permissionHint(granted));
        }

        /* Аудиосессия обязательна до подключения: без неё WebRTC не получит
           аудиомаршрут, и звук уйдёт в никуда на части прошивок ТВ. */
        await AudioSession.startAudioSession();
        console.info('[TingTV] аудиосессия запущена');

        const res = await apiPost(ENDPOINTS.guestToken(code), {
          pin: pin || undefined,
          name: 'Зал совещаний',
          kind: 'tv',
        });
        if (cancelled) return;
        if (!res || !res.token) throw new Error('сервер не выдал токен');
        console.info('[TingTV] токен получен, identity', res.identity);
        setToken(res.token);
        setServerUrl(res.url || res.server_url || API_BASE);
        setTitle((res.room && (res.room.title || res.room.slug)) || code);
        setIdentity(res.identity || '');
      } catch (e) {
        console.error('[TingTV] вход не удался', e && e.name, e && e.message);
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
    console.info('[TingTV] выход из комнаты');
    flushLogs();
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
    <View style={styles.fill}>
      {permissionNote ? (
        <View style={styles.permBanner} pointerEvents="none">
          <Text style={styles.permText}>{permissionNote}</Text>
        </View>
      ) : null}
      <LiveKitRoom
        serverUrl={serverUrl}
        token={token}
        connect
        audio
        video
        options={{
          adaptiveStream: true,
          dynacast: true,
          /* D-412: КОРЕНЬ «камера/микрофон не захватываются на ТВ».
             Комната создавалась без дефолтов захвата, поэтому SDK брал
             встроенные пресеты с facingMode: 'user' — у USB-камеры (4K, для ТВ)
             такого facing нет, и трек гасился сразу после открытия.
             Задаём дефолты здесь: они применяются и к первичной публикации,
             и к повторному включению кнопкой, и к автопубликации при connect.
             Размер — ровно 1280x720 (720p): больше на ТВ не нужно, а 4K-камера
             без ограничения отдаёт поток, который энкодер не тянет. */
          videoCaptureDefaults: {
            resolution: { width: 1280, height: 720, frameRate: 30 },
          },
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }}
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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  /* D-405: видимая причина, если разрешения не выданы. */
  permBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: 'rgba(232,71,90,0.94)',
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  permText: { color: '#fff', fontSize: FONT.small, fontWeight: '700', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 18 },
  bigMark: { width: 140, height: 140, opacity: 0.9 },
  waitTitle: { color: COLORS.t1, fontSize: FONT.h1, fontWeight: '800' },
  errorTitle: { color: COLORS.danger, fontSize: FONT.h1, fontWeight: '800' },
  errorBody: { color: COLORS.t2, fontSize: FONT.body, textAlign: 'center', maxWidth: 720, lineHeight: 26 },
  errorHint: { color: COLORS.gold, fontSize: FONT.body, fontWeight: '700', marginTop: 10 },
});
