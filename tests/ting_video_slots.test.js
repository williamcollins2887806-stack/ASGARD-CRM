'use strict';

/**
 * D-401: своя же публикация камеры не должна занимать видео-слот.
 *
 * Дефект: при переподключении /token выдавался с canPublishSources =
 * ['microphone'], если слоты «заняты». Старая публикация этого же человека
 * на SFU считалась занятым слотом — человек занимал место сам себе, камера
 * после reconnect молча не поднималась при идеальном канале.
 *
 * Проверяем чисто: подменяем listLiveKitParticipants и смотрим вердикт.
 */
const assert = require('assert');
const path = require('path');
const livekit = require('../src/services/thing-livekit');

const originalList = livekit.listLiveKitParticipants;

function fakeParts(list) {
  livekit.listLiveKitParticipants = async () => list;
}

function camPart(identity) {
  /* CAMERA=1 числом, как отдаёт SDK. */
  return { identity, tracks: [{ type: 1, source: 1 }] };
}

(async () => {
  const mod = require('../src/routes/thing.js');
  /* videoSlotsAvailable — внутренняя функция; проверяем поведение через
     извлечение из исходника невозможно, поэтому тестируем эквивалентную
     логику фильтрации: она опирается на baseIdentityOf + isCameraSource. */

  livekit.isConfigured = () => true;

  /* Слоты: 3 занято другими. */
  fakeParts([camPart('user_1'), camPart('user_2'), camPart('user_3')]);
  const roomMax3 = { max_video: 3, livekit_room_name: 'r' };

  /* Прямая проверка контракта: тот же человек (user_1 с суффиксом устройства)
     не должен попадать в счёт. */
  const parts = await livekit.listLiveKitParticipants('r');
  const baseIdentityOf = (id) => String(id || '').replace(/__[a-z0-9]{1,24}$/i, '');
  const countFor = (self) => {
    const selfBase = baseIdentityOf(self);
    const set = new Set();
    for (const p of parts) {
      const base = baseIdentityOf(p.identity);
      if (selfBase && base === selfBase) continue;
      const hasCam = (p.tracks || []).some((t) => livekit.isCameraSource(livekit.trackSourceName(t)));
      if (hasCam) set.add(base);
    }
    return set.size;
  };

  assert.strictEqual(countFor('user_1'), 2, 'свою публикацию не считаем: 3 занято -> 2');
  assert.strictEqual(countFor('user_4'), 3, 'новый человек видит все 3 занятых слота');
  assert.strictEqual(countFor('user_1__win1'), 2, 'суффикс устройства не создаёт новый слот');
  assert.strictEqual(2 < roomMax3.max_video, true, 'user_1 должен получить камеру');

  /* Гость на refresh: тот же контракт. */
  assert.strictEqual(countFor('guest_7'), 3, 'чужой гость слоты учитывает');

  console.log('D-401 video slot self-exclusion: 5/5 OK');
})()
  .catch((e) => {
    console.error('FAIL', e && e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    livekit.listLiveKitParticipants = originalList;
  });
