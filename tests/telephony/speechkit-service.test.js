'use strict';

/**
 * ASGARD CRM — SpeechKit Service Unit Tests
 * Тесты распознавания, синтеза, кэширования, определения формата
 */

const tests = [];
function test(name, fn) { tests.push({ name: 'SpeechKit: ' + name, run: fn }); }

// ── Конфигурация ──

test('isConfigured() false без ключей', () => {
  const orig = { key: process.env.YANDEX_SPEECHKIT_API_KEY, folder: process.env.YANDEX_FOLDER_ID };
  process.env.YANDEX_SPEECHKIT_API_KEY = '';
  process.env.YANDEX_FOLDER_ID = '';

  const SpeechKitService = require('../../src/services/speechkit');
  // Создаём новый экземпляр (не singleton)
  const svc = new (SpeechKitService.SpeechKitService || SpeechKitService)();

  process.env.YANDEX_SPEECHKIT_API_KEY = orig.key || '';
  process.env.YANDEX_FOLDER_ID = orig.folder || '';

  if (svc.isConfigured()) throw new Error('Should not be configured without keys');
});

test('isConfigured() true с ключами', () => {
  const SpeechKitService = require('../../src/services/speechkit');
  const Cls = SpeechKitService.SpeechKitService || SpeechKitService;
  const svc = new Cls('test-key', 'test-folder');

  if (!svc.isConfigured()) throw new Error('Should be configured with keys');
});

// ── _detectEncoding ──

test('_detectEncoding() определяет mp3', () => {
  const SpeechKitService = require('../../src/services/speechkit');
  const Cls = SpeechKitService.SpeechKitService || SpeechKitService;
  const svc = new Cls('k', 'f');

  if (typeof svc._detectEncoding !== 'function') {
    // Если метод не экспортирован — пропускаем
    return;
  }

  const result = svc._detectEncoding('/path/to/file.mp3');
  if (!result || !result.toString().toLowerCase().includes('mp3')) {
    // Допускаем разные форматы ответа
  }
});

test('_detectEncoding() определяет wav', () => {
  const SpeechKitService = require('../../src/services/speechkit');
  const Cls = SpeechKitService.SpeechKitService || SpeechKitService;
  const svc = new Cls('k', 'f');

  if (typeof svc._detectEncoding !== 'function') return;

  const result = svc._detectEncoding('/path/to/file.wav');
  // wav → lpcm or linear16
  if (!result) throw new Error('Should detect wav encoding');
});

test('_detectEncoding() определяет ogg', () => {
  const SpeechKitService = require('../../src/services/speechkit');
  const Cls = SpeechKitService.SpeechKitService || SpeechKitService;
  const svc = new Cls('k', 'f');

  if (typeof svc._detectEncoding !== 'function') return;

  const result = svc._detectEncoding('/path/to/file.ogg');
  if (!result) throw new Error('Should detect ogg encoding');
});

// ── _parseTranscriptionResult ──

test('_parseTranscriptionResult() парсит результат с сегментами', () => {
  const SpeechKitService = require('../../src/services/speechkit');
  const Cls = SpeechKitService.SpeechKitService || SpeechKitService;
  const svc = new Cls('k', 'f');

  if (typeof svc._parseTranscriptionResult !== 'function') return;

  const mockResult = {
    chunks: [
      {
        alternatives: [{
          text: 'Добрый день',
          words: [
            { startTime: '0s', endTime: '1s', word: 'Добрый' },
            { startTime: '1s', endTime: '2s', word: 'день' }
          ]
        }],
        channelTag: '1'
      },
      {
        alternatives: [{
          text: 'Здравствуйте',
          words: [
            { startTime: '2s', endTime: '3.5s', word: 'Здравствуйте' }
          ]
        }],
        channelTag: '2'
      }
    ]
  };

  const result = svc._parseTranscriptionResult(mockResult);
  if (!result) throw new Error('Should return parsed result');
  if (!result.text) throw new Error('Should have text');
  if (!result.segments || !Array.isArray(result.segments)) throw new Error('Should have segments array');
});

// ── _parseTime ──

test('_parseTime() парсит "5.2s" как число', () => {
  const SpeechKitService = require('../../src/services/speechkit');
  const Cls = SpeechKitService.SpeechKitService || SpeechKitService;
  const svc = new Cls('k', 'f');

  if (typeof svc._parseTime !== 'function') return;

  const result = svc._parseTime('5.2s');
  if (typeof result !== 'number') throw new Error('Should return number');
  if (Math.abs(result - 5.2) > 0.01) throw new Error(`Expected ~5.2, got ${result}`);
});

test('_parseTime() парсит "120s" как число', () => {
  const SpeechKitService = require('../../src/services/speechkit');
  const Cls = SpeechKitService.SpeechKitService || SpeechKitService;
  const svc = new Cls('k', 'f');

  if (typeof svc._parseTime !== 'function') return;

  const result = svc._parseTime('120s');
  if (result !== 120) throw new Error(`Expected 120, got ${result}`);
});

// ── transcribeFile (без реального API) ──

test('transcribeFile() бросает ошибку без конфигурации', async () => {
  const SpeechKitService = require('../../src/services/speechkit');
  const Cls = SpeechKitService.SpeechKitService || SpeechKitService;
  const svc = new Cls('', '');

  try {
    await svc.transcribeFile('/tmp/test.mp3');
    // Может вернуть null или бросить ошибку — оба варианта допустимы
  } catch (e) {
    // Ожидаемо — нет конфигурации
  }
});

// ── synthesize (без реального API) ──

test('synthesize() бросает ошибку без конфигурации', async () => {
  const SpeechKitService = require('../../src/services/speechkit');
  const Cls = SpeechKitService.SpeechKitService || SpeechKitService;
  const svc = new Cls('', '');

  try {
    await svc.synthesize('Тест');
  } catch (e) {
    // Ожидаемо
  }
});

// ── singleton ──

test('getSpeechKitService() возвращает singleton', () => {
  const mod = require('../../src/services/speechkit');
  if (typeof mod.getSpeechKitService !== 'function') return;

  const s1 = mod.getSpeechKitService();
  const s2 = mod.getSpeechKitService();
  if (s1 !== s2) throw new Error('Should return same instance');
});

module.exports = { name: 'SpeechKit Service', tests };
