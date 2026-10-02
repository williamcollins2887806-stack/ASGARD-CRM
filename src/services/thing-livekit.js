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
  const { AccessToken } = await getSdk();
  const at = new AccessToken(env('LIVEKIT_API_KEY'), env('LIVEKIT_API_SECRET'), {
    identity: opts.identity,
    name: opts.name,
    ttl: opts.ttlSec || 4 * 60 * 60
  });
  at.addGrant({
    roomJoin: true,
    room: opts.roomName,
    canPublish: opts.canPublish !== false,
    canSubscribe: true,
    canPublishData: opts.canPublishData !== false,
    roomAdmin: Boolean(opts.roomAdmin)
  });
  const token = await at.toJwt();
  return {
    token,
    url: publicWsUrl(),
    identity: opts.identity
  };
}

/**
 * Старт room composite egress → файл на диск сервера.
 * filepath шаблон: /var/lib/asgard-thing/recordings/{room}/{egress_id}.mp4
 */
async function startRoomEgress(livekitRoomName, filePath) {
  if (!isConfigured()) throw new Error('LiveKit не настроен');
  const { EncodedFileOutput, EncodedFileType } = await getSdk();
  const egress = await getEgressClient();
  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: filePath,
    disableManifest: true
  });
  const info = await egress.startRoomCompositeEgress(livekitRoomName, output, {
    layout: 'speaker',
    audioOnly: false
  });
  return { egressId: info.egressId || info.egress_id || String(info.egressId), raw: info };
}

async function stopEgress(egressId) {
  if (!isConfigured()) throw new Error('LiveKit не настроен');
  const egress = await getEgressClient();
  return egress.stopEgress(egressId);
}

module.exports = {
  isConfigured,
  publicWsUrl,
  roomNameFor,
  ensureLiveKitRoom,
  deleteLiveKitRoom,
  createAccessToken,
  startRoomEgress,
  stopEgress
};
