'use strict';

/**
 * D-405: разрешения камеры и микрофона должны запрашиваться в рантайме.
 *
 * Дефект: в AndroidManifest.xml CAMERA и RECORD_AUDIO объявлены, но с Android 6
 * этого мало — опасные разрешения выдаются только через диалог. Запроса не было
 * ни в одном месте, поэтому приложение открывалось молча, а LiveKit получал
 * пустой поток: «камера/микрофон не работают».
 *
 * Проверяем по исходникам: модуль запроса есть, оба разрешения в нём,
 * вызывается на старте приложения и перед входом в зал.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('TV client: runtime permissions (D-405)', () => {
  const perm = read('src/permissions.js');

  it('модуль запрашивает CAMERA и RECORD_AUDIO', () => {
    assert.ok(/PermissionsAndroid\.PERMISSIONS\.CAMERA/.test(perm), 'CAMERA не запрашивается');
    assert.ok(/PermissionsAndroid\.PERMISSIONS\.RECORD_AUDIO/.test(perm), 'RECORD_AUDIO не запрашивается');
    assert.ok(/requestMultiple/.test(perm), 'нет пакетного запроса');
  });

  it('уже выданные разрешения не переспрашивает', () => {
    assert.ok(/PermissionsAndroid\.check/.test(perm), 'нет проверки текущего состояния');
    assert.ok(/RESULTS\.GRANTED/.test(perm), 'не сверяет результат');
  });

  it('запрос вызывается на старте приложения', () => {
    const app = read('App.tsx');
    assert.ok(/ensureMediaPermissions\(\)/.test(app), 'App.tsx не запрашивает разрешения');
    assert.ok(/useEffect/.test(app), 'вызов вне useEffect');
  });

  it('запрос идёт ДО аудиосессии в зале', () => {
    const meeting = read('src/MeetingScreen.js');
    const permIdx = meeting.indexOf('ensureMediaPermissions()');
    const audioIdx = meeting.indexOf('startAudioSession()');
    assert.ok(permIdx > -1, 'MeetingScreen не запрашивает разрешения');
    assert.ok(audioIdx > -1, 'startAudioSession не найден');
    assert.ok(permIdx < audioIdx, 'разрешения должны запрашиваться ДО аудиосессии');
  });

  it('без разрешений показывает причину, а не молчит', () => {
    const meeting = read('src/MeetingScreen.js');
    assert.ok(/permissionHint/.test(meeting), 'нет подсказки о нехватке прав');
    assert.ok(/permissionNote/.test(meeting), 'нет отображения состояния');
  });

  it('манифест объявляет оба разрешения', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    assert.ok(/android\.permission\.CAMERA/.test(manifest), 'в манифесте нет CAMERA');
    assert.ok(/android\.permission\.RECORD_AUDIO/.test(manifest), 'в манифесте нет RECORD_AUDIO');
  });
});
