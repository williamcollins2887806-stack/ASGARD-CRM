'use strict';

/**
 * Генерация звуковых подсказок PBX локальным Silero TTS.
 * Текст из настроек (pbx_config) → 8 kHz mono WAV в /var/lib/asterisk/sounds/custom.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SOUNDS_DIR = process.env.ASTERISK_SOUNDS_DIR || '/var/lib/asterisk/sounds';
const SILERO_URL = process.env.SILERO_URL || 'http://127.0.0.1:5500';
const SILERO_SPEAKER = process.env.SILERO_SPEAKER || 'aidar';
const SILERO_SPEED = process.env.SILERO_SPEED || '0.9';
const TTL_MS = 5 * 60 * 1000;

const _mem = new Map(); // slug -> { text, file, at }

function slugify(text) {
  const h = crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 12);
  return 'asgard_' + h;
}

function fetchSileroOnce(text) {
  const url = `${SILERO_URL}/tts?text=${encodeURIComponent(text)}&speaker=${encodeURIComponent(SILERO_SPEAKER)}&speed=${encodeURIComponent(SILERO_SPEED)}`;
  const lib = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('silero HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(40000, () => { req.destroy(new Error('silero timeout')); });
  });
}

async function fetchSilero(text) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const buf = await fetchSileroOnce(text);
      if (buf && buf.length > 400) return buf;
      lastErr = new Error('silero too short');
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw lastErr || new Error('silero failed');
}

function toAsteriskWav(rawWav, outPath) {
  const tmp = outPath + '.src.wav';
  fs.writeFileSync(tmp, rawWav);
  // 8 kHz mono 16-bit PCM — формат Asterisk sln/wav
  const r = spawnSync('sox', [tmp, '-r', '8000', '-c', '1', '-b', '16', outPath], { encoding: 'utf8' });
  try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  if (r.status !== 0 || !fs.existsSync(outPath)) {
    throw new Error('sox failed: ' + (r.stderr || r.error || r.status));
  }
}

/**
 * Вернуть звуковой файл для произвольного текста (кэш по хэшу текста).
 * @returns {Promise<string|null>} абсолютный путь внутри sounds dir (без расширения .wav)
 */
async function ensurePrompt(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const slug = slugify(t);
  const customDir = path.join(SOUNDS_DIR, 'custom');
  try { fs.mkdirSync(customDir, { recursive: true }); } catch (_) { /* ignore */ }
  const outPath = path.join(customDir, slug + '.wav');
  const mem = _mem.get(slug);
  if (mem && mem.text === t && Date.now() - mem.at < TTL_MS && fs.existsSync(outPath)) {
    return path.join('custom', slug);
  }
  if (fs.existsSync(outPath)) {
    _mem.set(slug, { text: t, file: outPath, at: Date.now() });
    return path.join('custom', slug);
  }
  const raw = await fetchSilero(t);
  if (!raw || raw.length < 400) throw new Error('silero too short');
  toAsteriskWav(raw, outPath);
  _mem.set(slug, { text: t, file: outPath, at: Date.now() });
  return path.join('custom', slug);
}

/**
 * Явно сгенерировать список подсказок.
 * @param {{name:string, text:string, speaker?:string}[]} defs
 * @returns {Promise<{name:string, path:string}[]>}
 */
async function generatePrompt(defs) {
  const out = [];
  for (const d of defs) {
    if (!d || !d.name || !String(d.text || '').trim()) continue;
    const customDir = path.join(SOUNDS_DIR, 'custom');
    try { fs.mkdirSync(customDir, { recursive: true }); } catch (_) { /* ignore */ }
    const outPath = path.join(customDir, d.name + '.wav');
    const raw = await fetchSilero(String(d.text).trim());
    if (!raw || raw.length < 400) throw new Error(`${d.name}: silero too short`);
    toAsteriskWav(raw, outPath);
    out.push({ name: d.name, path: outPath });
  }
  return out;
}

module.exports = { ensurePrompt, generatePrompt, SOUNDS_DIR };
