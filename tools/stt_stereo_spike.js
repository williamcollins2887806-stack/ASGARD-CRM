'use strict';
/**
 * STT spike: проверяет, принимает ли SpeechKit v3/v2 стерео-файл (тело запроса).
 * Запуск: node tools/stt_stereo_spike.js [path/to.wav]
 * Без ключей — пишет SKIP в journal-friendly формате и exit 0.
 */
const fs = require('fs');
const path = require('path');
const SpeechKit = require('../src/services/speechkit');

async function main() {
  const sk = new SpeechKit();
  const out = {
    ts: new Date().toISOString(),
    configured: sk.isConfigured(),
    file: process.argv[2] || null,
    result: null,
    error: null,
  };

  if (!sk.isConfigured()) {
    out.result = 'SKIP_NO_KEYS';
    console.log(JSON.stringify(out, null, 2));
    fs.mkdirSync(path.join('tests', 'reports'), { recursive: true });
    fs.writeFileSync(path.join('tests', 'reports', 'STT-STEREO-SPIKE.json'), JSON.stringify(out, null, 2));
    return;
  }

  // Синтетический стерео WAV 1 с (тишина), если файл не передан
  let file = process.argv[2];
  if (!file) {
    file = path.join('tests', 'fixtures', 'telephony_stereo_silence.wav');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) {
      // минимальный WAV PCM 16-bit stereo 8kHz 0.25s
      const sampleRate = 8000;
      const samples = sampleRate / 4;
      const dataSize = samples * 2 * 2;
      const buf = Buffer.alloc(44 + dataSize);
      buf.write('RIFF', 0);
      buf.writeUInt32LE(36 + dataSize, 4);
      buf.write('WAVE', 8);
      buf.write('fmt ', 12);
      buf.writeUInt32LE(16, 16);
      buf.writeUInt16LE(1, 20);
      buf.writeUInt16LE(2, 22);
      buf.writeUInt32LE(sampleRate, 24);
      buf.writeUInt32LE(sampleRate * 4, 28);
      buf.writeUInt16LE(4, 32);
      buf.writeUInt16LE(16, 34);
      buf.write('data', 36);
      buf.writeUInt32LE(dataSize, 40);
      fs.writeFileSync(file, buf);
    }
    out.file = file;
  }

  try {
    // Короткая проверка: longRunningRecognize с content base64 (как в transcribeFile)
    const result = await sk.transcribeFile(file, {
      audioChannelCount: 2,
      enableSpeakerDiarization: false,
      sampleRate: 8000,
      audioEncoding: 'LINEAR16_PCM',
    });
    out.result = 'OK_BODY_UPLOAD';
    out.segments = (result.segments || []).length;
    out.textLen = (result.text || '').length;
  } catch (e) {
    out.error = e.message;
    if (/Object Storage|uri|storage|403|400/i.test(e.message)) {
      out.result = 'NEED_OBJECT_STORAGE';
    } else {
      out.result = 'FAIL';
    }
  }

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join('tests', 'reports', 'STT-STEREO-SPIKE.json'), JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
