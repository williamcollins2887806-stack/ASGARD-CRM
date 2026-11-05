'use strict';

/**
 * LiveKit server facade for Тинг.
 * Env (не в git): LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
 * Optional: LIVEKIT_WS_URL (публичный wss для клиента)
 *
 * Без ключей: isConfigured()=false; createRoomLocalOnly — только имя в БД.
 * AccessToken / egress требуют конфигурации (anti-stub: не выдаём фейковый media).
 */

const crypto = require('crypto');

/**
 * Protobuf-enum приходят из SDK ЧИСЛАМИ, а не строками.
 * Раньше код сравнивал String(t.source) с /camera/i — не совпадало никогда,
 * из-за чего не работали max_video, mute, podium и защита от двойного egress.
 */
const TRACK_SOURCE = {
  0: 'unknown',
  1: 'camera',
  2: 'microphone',
  3: 'screen_share',
  4: 'screen_share_audio'
};

const EGRESS_STATUS = {
  0: 'starting',
  1: 'active',
  2: 'ending',
  3: 'complete',
  4: 'failed',
  5: 'aborted',
  6: 'limit_reached'
};

/** Нормализует source трека (число или строка) в нижний регистр строкой. */
function trackSourceName(track) {
  if (!track) return '';
  const raw = track.source != null ? track.source : track.type;
  if (typeof raw === 'number') return TRACK_SOURCE[raw] || String(raw);
  return String(raw || '').toLowerCase().replace(/^track_source_/, '');
}

function isAudioSource(name) {
  return name === 'microphone' || name === 'audio';
}

function isCameraSource(name) {
  return name === 'camera' || name === 'video';
}

function isScreenSource(name) {
  return name.indexOf('screen') === 0;
}

/** Нормализует status egress в строку. */
function egressStatusName(status) {
  if (typeof status === 'number') return EGRESS_STATUS[status] || String(status);
  return String(status || '').toLowerCase().replace(/^egress_/, '');
}

function isEgressTerminal(statusName) {
  return ['complete', 'failed', 'aborted', 'limit_reached'].includes(statusName);
}


function env(name, fallback = '') {
  const v = process.env[name];
  return v == null || v === '' ? fallback : String(v).trim();
}

function isConfigured() {
  return Boolean(env('LIVEKIT_URL') && env('LIVEKIT_API_KEY') && env('LIVEKIT_API_SECRET'));
}

function publicWsUrl() {
  return env('LIVEKIT_WS_URL') || env('LIVEKIT_URL');
}

function roomNameFor(slug) {
  return `ting_${slug}_${crypto.randomBytes(3).toString('hex')}`;
}

async function getSdk() {
  // lazy require — пакет ставится отдельно
  // eslint-disable-next-line import/no-unresolved
  const sdk = require('livekit-server-sdk');
  return sdk;
}

async function getRoomService() {
  if (!isConfigured()) {
    throw new Error('LiveKit не настроен (LIVEKIT_URL / API_KEY / API_SECRET)');
  }
  const { RoomServiceClient } = await getSdk();
  return new RoomServiceClient(env('LIVEKIT_URL'), env('LIVEKIT_API_KEY'), env('LIVEKIT_API_SECRET'));
}

async function getEgressClient() {
  if (!isConfigured()) {
    throw new Error('LiveKit не настроен');
  }
  const { EgressClient } = await getSdk();
  return new EgressClient(env('LIVEKIT_URL'), env('LIVEKIT_API_KEY'), env('LIVEKIT_API_SECRET'));
}

/**
 * Создать комнату на LiveKit (или только имя, если SFU ещё не поднят — P1).
 * @returns {{ livekitRoomName: string, createdOnServer: boolean }}
 */
async function ensureLiveKitRoom(slug, { emptyTimeout = 60 * 60, maxParticipants = 50 } = {}) {
  const livekitRoomName = roomNameFor(slug);
  if (!isConfigured()) {
    return { livekitRoomName, createdOnServer: false };
  }
  const svc = await getRoomService();
  await svc.createRoom({
    name: livekitRoomName,
    emptyTimeout,
    maxParticipants
  });
  return { livekitRoomName, createdOnServer: true };
}

async function deleteLiveKitRoom(livekitRoomName) {
  if (!isConfigured() || !livekitRoomName) return;
  try {
    const svc = await getRoomService();
    await svc.deleteRoom(livekitRoomName);
  } catch (e) {
    // комната могла уже исчезнуть
    if (!/not found|does not exist/i.test(String(e.message || e))) throw e;
  }
}

/**
 * JWT для участника.
 * @param {object} opts
 * @param {string} opts.roomName
 * @param {string} opts.identity
 * @param {string} opts.name
 * @param {boolean} [opts.canPublish=true]
 * @param {boolean} [opts.canPublishData=true]
 * @param {boolean} [opts.roomAdmin=false]
 * @param {number} [opts.ttlSec=14400]
 */
async function createAccessToken(opts) {
  if (!isConfigured()) {
    throw new Error('LiveKit не настроен — нельзя выдать media-токен');
  }
  const roomName = opts && opts.roomName ? String(opts.roomName).trim() : '';
  if (!roomName) {
    const err = new Error('livekit_room_name пуст — нельзя выдать media-токен');
    err.code = 'LIVEKIT_ROOM_MISSING';
    throw err;
  }
  const identity = opts && opts.identity ? String(opts.identity).trim() : '';
  if (!identity) {
    const err = new Error('identity пуст — нельзя выдать media-токен');
    err.code = 'LIVEKIT_IDENTITY_MISSING';
    throw err;
  }
  const { AccessToken } = await getSdk();
  /* T31: хост/CRM — 4 ч; гостевой первичный вход — короткий TTL (≤ 30 мин).
     Длинные встречи держатся на refresh до reconnect, а не на «вечном» JWT. */
  const ttlSec = Math.max(60, Number(opts.ttlSec) || 4 * 60 * 60);
  const at = new AccessToken(env('LIVEKIT_API_KEY'), env('LIVEKIT_API_SECRET'), {
    identity,
    name: opts.name || identity,
    ttl: ttlSec
  });
  const grant = {
    roomJoin: true,
    room: roomName,
    canPublish: opts.canPublish !== false,
    canSubscribe: true,
    canPublishData: opts.canPublishData !== false,
    roomAdmin: Boolean(opts.roomAdmin)
  };
  /* D3: audio-only вход, когда видео-слоты заняты.
     SDK ждёт enum TrackSource, а не строки: строки роняют toJwt() с TypeError. */
  if (Array.isArray(opts.canPublishSources) && opts.canPublishSources.length) {
    try {
      const { TrackSource } = await getSdk();
      grant.canPublishSources = opts.canPublishSources.map((s) => {
        if (typeof s === 'number') return s;
        const key = String(s).toUpperCase();
        return TrackSource[key] != null ? TrackSource[key] : s;
      });
    } catch (_) {
      // Без enum не выдаём невалидный токен — просто не ограничиваем публикацию.
      console.warn('[thing-livekit] TrackSource enum unavailable, canPublishSources skipped');
    }
  }
  at.addGrant(grant);
  const token = await Promise.resolve(at.toJwt());
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  return {
    token,
    url: publicWsUrl(),
    identity,
    ttl_sec: ttlSec,
    expires_at: expiresAt
  };
}

/**
 * Старт room composite egress → файл на диск сервера.
 * filepath шаблон: /var/lib/asgard-thing/recordings/{room}/{egress_id}.mp4
 */
/**
 * Старт room composite egress.
 * D22: если задан S3 — пишем в объектное хранилище (не на локальный диск),
 * иначе локальный путь как staging. Локальный диск переполняется и роняет запись.
 *
 * filePath — путь для локального режима
 * s3Key    — ключ объекта для S3-режима
 */
async function startRoomEgress(livekitRoomName, filePath, { layout = 'speaker', s3Key = null } = {}) {
  if (!isConfigured()) throw new Error('LiveKit не настроен');
  const { EncodedFileOutput, EncodedFileType, S3Upload } = await getSdk();
  const egress = await getEgressClient();

  const useS3 = Boolean(
    s3Key
    && env('S3_BUCKET')
    && env('S3_ACCESS_KEY')
    && env('S3_SECRET_KEY')
  );

  let output;
  if (useS3) {
    const s3 = await buildS3Upload();
    if (!s3) throw new Error('S3 настроен не полностью: нужны S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY');
    output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: s3Key,
      disableManifest: true,
      output: { case: 's3', value: s3 }
    });
  } else {
    output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: filePath,
      disableManifest: true
    });
  }

  const info = await egress.startRoomCompositeEgress(livekitRoomName, output, {
    layout: layout || 'speaker',
    audioOnly: false
  });
  return {
    egressId: info.egressId || info.egress_id || String(info.egressId),
    storage: useS3 ? 's3' : 'local',
    raw: info
  };
}

/** Список egress по комнате — чтобы не запускать второй (D9). */
async function listEgress(livekitRoomName) {
  if (!isConfigured()) return [];
  const egress = await getEgressClient();
  try {
    const list = await egress.listEgress({ roomName: livekitRoomName });
    return Array.isArray(list) ? list : (list.items || []);
  } catch (_) {
    return [];
  }
}

/** Проверка подписи LiveKit webhook. Возвращает { event, ... } или null. */
async function receiveWebhook(rawBody, authHeader) {
  if (!isConfigured()) return null;
  const { WebhookReceiver } = await getSdk();
  const receiver = new WebhookReceiver(env('LIVEKIT_API_KEY'), env('LIVEKIT_API_SECRET'));
  return receiver.receive(rawBody, authHeader);
}

async function stopEgress(egressId) {
  if (!isConfigured()) throw new Error('LiveKit не настроен');
  const egress = await getEgressClient();
  return egress.stopEgress(egressId);
}

async function listLiveKitParticipants(livekitRoomName) {
  if (!isConfigured() || !livekitRoomName) return [];
  const svc = await getRoomService();
  const list = await svc.listParticipants(livekitRoomName);
  return Array.isArray(list) ? list : (list.participants || []);
}

async function removeLiveKitParticipant(livekitRoomName, identity) {
  if (!isConfigured()) throw new Error('LiveKit не настроен');
  const svc = await getRoomService();
  await svc.removeParticipant(livekitRoomName, identity);
}

async function muteLiveKitTrack(livekitRoomName, identity, trackSid, muted = true) {
  if (!isConfigured()) throw new Error('LiveKit не настроен');
  const svc = await getRoomService();
  await svc.mutePublishedTrack(livekitRoomName, identity, trackSid, muted);
}

/**
 * T09: data-пакет в комнату (опустить руку, уведомления).
 * destinationIdentities пустой → broadcast всем.
 */
async function sendData(livekitRoomName, payload, { destinationIdentities = [] } = {}) {
  if (!isConfigured()) throw new Error('LiveKit не настроен');
  const svc = await getRoomService();
  const data = Buffer.from(JSON.stringify(payload || {}), 'utf8');
  const opts = {};
  if (destinationIdentities && destinationIdentities.length) {
    opts.destinationIdentities = destinationIdentities;
  }
  /* SDK: sendData(room, data, kind, options) — kind 0 = RELIABLE */
  if (typeof svc.sendData === 'function') {
    await svc.sendData(livekitRoomName, data, 0, opts);
  }
  return { ok: true };
}

/** Mute all audio tracks for every participant except optional identity */
async function muteAllExcept(livekitRoomName, exceptIdentity) {
  const parts = await listLiveKitParticipants(livekitRoomName);
  let n = 0;
  for (const p of parts) {
    const id = p.identity || p.sid;
    if (!id || id === exceptIdentity) continue;
    const tracks = p.tracks || p.publishedTracks || [];
    for (const t of tracks) {
      const sid = t.sid || t.trackSid;
      if (sid && isAudioSource(trackSourceName(t))) {
        try {
          await muteLiveKitTrack(livekitRoomName, id, sid, true);
          n++;
        } catch (e) {
          console.warn('[thing-livekit] mute track skipped', e && e.message);
        }
      }
    }
  }
  return { muted_tracks: n };
}

/**
 * S3-выгрузка для egress (EncodedFileOutput).
 * @returns {object|null} S3Upload или null, если S3 не настроен
 */
async function buildS3Upload() {
  if (!env('S3_BUCKET') || !env('S3_ACCESS_KEY') || !env('S3_SECRET_KEY')) return null;
  const { S3Upload } = await getSdk();
  return new S3Upload({
    accessKey: env('S3_ACCESS_KEY'),
    secret: env('S3_SECRET_KEY'),
    region: env('S3_REGION') || 'ru-central-1',
    endpoint: env('S3_ENDPOINT'),
    bucket: env('S3_BUCKET'),
    forcePathStyle: true
  });
}

module.exports = {
  isConfigured,
  publicWsUrl,
  roomNameFor,
  ensureLiveKitRoom,
  deleteLiveKitRoom,
  createAccessToken,
  startRoomEgress,
  listEgress,
  receiveWebhook,
  stopEgress,
  listLiveKitParticipants,
  removeLiveKitParticipant,
  muteLiveKitTrack,
  muteAllExcept,
  sendData,
  /* Нормализаторы enum — единый источник истины для роутов */
  trackSourceName,
  isAudioSource,
  isCameraSource,
  isScreenSource,
  egressStatusName,
  isEgressTerminal,
  buildS3Upload
};
