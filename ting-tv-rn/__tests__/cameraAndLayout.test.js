'use strict';

/**
 * D-408: «камера залипает в выкл» и UI не влезает в экран ТВ.
 *
 * Причина 1 (камера): setCameraEnabled(true) без ограничений берёт дефолтные
 * constraints с facingMode: 'user'. У USB-камеры такого facing нет — трек
 * создаётся и сразу гасится: индикатор на камере вспыхивает и пропадает,
 * кнопка возвращается в «выкл».
 *
 * Причина 2 (вёрстка): на Android TV плотность 2.0, экран 1920x1080 px — это
 * 960x540 dp. Карточка width:1080 в dp шире экрана: правая колонка и кнопка
 * уезжают за границу.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const meeting = fs.readFileSync(path.join(root, 'src', 'MeetingScreen.js'), 'utf8');
const join = fs.readFileSync(path.join(root, 'src', 'JoinScreen.js'), 'utf8');

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('TV client: камера и масштаб (D-408)', () => {
  it('камера включается с явным deviceId из enumerateDevices', () => {
    assert.ok(/mediaDevices\.enumerateDevices\(\)/.test(meeting), 'нет enumerateDevices');
    assert.ok(/deviceId:\s*String\(cam\.deviceId\)/.test(meeting), 'deviceId не передаётся в ограничения');
  });

  it('размер задаётся через resolution, а не width/height', () => {
    /* Ключевой дефект: VideoCaptureOptions не принимает width/height —
       только resolution. Со «свободными» ключами USB-камера гасла. */
    assert.ok(/resolution:\s*\{\s*width:/.test(meeting), 'нет resolution в опциях захвата');
    assert.ok(!/setCameraEnabled\(true,\s*\{[^}]*\bwidth:\s*1280/.test(meeting),
      'width передан вне resolution — SDK его игнорирует');
  });

  it('дефолты захвата заданы на уровне комнаты', () => {
    assert.ok(/videoCaptureDefaults/.test(meeting), 'нет videoCaptureDefaults');
    assert.ok(/audioCaptureDefaults/.test(meeting), 'нет audioCaptureDefaults');
  });

  it('есть повторная попытка с минимальными ограничениями', () => {
    assert.ok(/attempts\.push\(\{\}\)/.test(meeting), 'нет финальной попытки без ограничений');
  });

  it('проверяется результат публикации, а не только отсутствие исключения', () => {
    assert.ok(/const pub = await localParticipant\.setCameraEnabled/.test(meeting),
      'setCameraEnabled может вернуть undefined без ошибки');
    assert.ok(/if \(pub && /.test(meeting), 'нет проверки на отсутствие трека');
  });

  it('переключение камеры использует resolution и deviceId', () => {
    const code = stripComments(meeting);
    const toggle = code.slice(code.indexOf('const toggleCam'));
    const body = toggle.slice(0, 1200);
    assert.ok(/resolution/.test(body), 'в toggleCam нет resolution');
    assert.ok(/deviceId/.test(body), 'в toggleCam нет deviceId');
  });

  it('экран входа считает ширину от реального экрана, а не фиксированные 1080', () => {
    assert.ok(/useWindowDimensions/.test(join), 'нет useWindowDimensions');
    const code = stripComments(join);
    assert.ok(!/width:\s*1080/.test(code), 'остался фиксированный width: 1080 dp');
    assert.ok(/cardWidth/.test(code), 'нет расчёта ширины карточки');
  });

  it('при низкой высоте раскладка становится вертикальной', () => {
    assert.ok(/compact/.test(join), 'нет компактного режима');
    assert.ok(/gridCompact/.test(join), 'нет вертикальной сетки для низкого экрана');
  });
});
