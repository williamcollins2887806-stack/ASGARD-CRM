'use strict';

/**
 * Транскрибация через RouterAI (OpenAI-совместимый /audio/transcriptions).
 *
 * Зачем: ключ RouterAI уже рабочий, а Yandex SpeechKit-ключ может быть мёртвым.
 * Модель по умолчанию — microsoft/mai-transcribe-2 (60 языков, RU, дёшево),
 * переопределяется через STT_MODEL.
 *
 * Длинные записи: провайдеры рвут соединение на 2 часах одним куском (524),
 * поэтому файл режется ffmpeg на чанки (STT_CHUNK_SEC, по умолчанию 900 с),
 * расшифровывается по частям и склеивается в один транскрипт.
 *
 * Вход: любой медиафайл, который понимает ffmpeg (в т.ч. mp4 от egress Тинга).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ai = require('./ai-provider');

const DEFAULT_MODEL = 'microsoft/mai-transcribe-2';
const DEFAULT_CHUNK_SEC = 900;
const PARALLEL = 2;          // провайдер отдаёт 429 при большей параллельности
const MAX_RETRIES = 5;       // 429/503/timeout — ретраим с экспоненциальным бэкоффом

function model() {
  return process.env.STT_MODEL || DEFAULT_MODEL;
}

function chunkSec() {
  const n = parseInt(process.env.STT_CHUNK_SEC || String(DEFAULT_CHUNK_SEC), 10);
  return Number.isFinite(n) && n >= 60 ? n : DEFAULT_CHUNK_SEC;
}

/** Ключ и базовый URL берём из той же конфигурации AI, что и протокол. */
async function creds() {
  try { await ai._loadKeysFromDB(); } catch (_) { /* не критично */ }
  const cfg = ai.getConfig();
  const key = cfg.openaiKey || process.env.OPENAI_API_KEY || '';
  const chatUrl = cfg.openaiUrl || process.env.OPENAI_URL || 'https://routerai.ru/api/v1/chat/completions';
  const url = /\/chat\/completions$/.test(chatUrl)
    ? chatUrl.replace(/\/chat\/completions$/, '/audio/transcriptions')
    : chatUrl.replace(/\/+$/, '') + '/audio/transcriptions';
  return { key, url };
}

function isConfigured() {
  return !!(ai.getConfig().openaiKey || process.env.OPENAI_API_KEY);
}

/** Асинхронная проверка (ключ может лежать в БД settings). */
async function isConfiguredAsync() {
  try { await ai._loadKeysFromDB(); } catch (_) { /* ignore */ }
  return isConfigured();
}

function _ffmpeg(args) {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', windowsHide: true, timeout: 30 * 60 * 1000 });
  if (r.status !== 0) {
    throw new Error('ffmpeg: ' + String(r.stderr || r.stdout || '').slice(-300));
  }
  return r;
}

function _duration(filePath) {
  const r = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath
  ], { encoding: 'utf8', windowsHide: true });
  const d = parseFloat(String(r.stdout || '').trim());
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** Аудио из любого контейнера: mono 16 kHz mp3 (малый файл, понимает любой STT). */
function _extractAudio(src, dst, { start = null, duration = null } = {}) {
  const args = ['-y'];
  if (start != null) args.push('-ss', String(start));
  args.push('-i', src);
  if (duration != null) args.push('-t', String(duration));
  args.push('-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', dst);
  _ffmpeg(args);
  return dst;
}

async function _postChunkOnce(url, key, filePath, modelId) {
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/mpeg' }), path.basename(filePath));
  fd.append('model', modelId);
  fd.append('language', 'ru');
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error('RouterAI STT HTTP ' + r.status + ': ' + text.slice(0, 300));
    err.status = r.status;
    const m = text.match(/"retry_after_seconds\\?":\s*(\d+)/);
    err.retryAfter = m ? Number(m[1]) : null;
    throw err;
  }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { parsed = { text }; }
  return String((parsed && (parsed.text || parsed.transcription)) || '').trim();
}

/** Ретраи: 429/5xx/сетевые — временные, длинные записи обязательно переживут троттлинг. */
async function _postChunk(url, key, filePath, modelId) {
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await _postChunkOnce(url, key, filePath, modelId);
    } catch (e) {
      lastErr = e;
      const s = Number(e && e.status) || 0;
      const retryable = s === 429 || s === 503 || s === 502 || s === 500 || s === 0;
      if (!retryable || attempt === MAX_RETRIES) break;
      const wait = (e.retryAfter ? e.retryAfter * 1000 : Math.min(30000, 1500 * Math.pow(2, attempt)));
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/**
 * Разбить текст чанка на псевдо-сегменты с оценкой времени по длине
 * (диаризации у провайдера нет — для протокола важнее контент и порядок).
 */
function _segmentsFromText(text, offsetSec, spanSec) {
  const parts = String(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return [];
  const total = parts.reduce((n, s) => n + s.length, 0) || 1;
  let cur = offsetSec;
  return parts.map((s) => {
    const dur = Math.max(1, Math.round((s.length / total) * spanSec));
    const seg = { start: _fmt(cur), end: _fmt(cur + dur), speaker: 'SPEAKER_00', text: s };
    cur += dur;
    return seg;
  });
}

function _fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
}

async function _mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * @returns {Promise<{text: string, segments: Array, provider: string, chunks: number}>}
 */
async function transcribeFile(filePath, opts = {}) {
  const { languageCode = 'ru-RU' } = opts;
  void languageCode;
  if (!fs.existsSync(filePath)) throw new Error('Файл записи не найден: ' + filePath);
  const { key, url } = await creds();
  if (!key) throw new Error('RouterAI STT не настроен (нет ключа)');
  const modelId = model();
  const span = chunkSec();

  const duration = _duration(filePath);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asgard-stt-'));
  const cleanup = (dir) => {
    try {
      for (const f of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
      fs.rmdirSync(dir);
    } catch (_) {}
  };

  try {
    // Короткая запись — одним запросом
    if (duration > 0 && duration <= span + 5) {
      const audio = _extractAudio(filePath, path.join(tmpDir, 'one.mp3'));
      const text = await _postChunk(url, key, audio, modelId);
      return {
        text,
        segments: _segmentsFromText(text, 0, duration || 0),
        provider: 'routerai:' + modelId,
        chunks: 1
      };
    }

    // Длинная запись — нарезка ffmpeg на чанки и параллельная расшифровка
    const chunkPattern = path.join(tmpDir, 'c_%04d.mp3');
    _ffmpeg(['-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000',
      '-c:a', 'libmp3lame', '-b:a', '32k',
      '-f', 'segment', '-segment_time', String(span), chunkPattern]);
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.mp3')).sort();
    if (!files.length) throw new Error('Не удалось нарезать запись на чанки');

    const texts = await _mapLimit(files, PARALLEL, (f) => _postChunk(url, key, path.join(tmpDir, f), modelId));

    const segments = [];
    const joined = [];
    texts.forEach((t, i) => {
      if (!t) return;
      joined.push(t);
      segments.push(..._segmentsFromText(t, i * span, span));
    });
    return {
      text: joined.join('\n\n'),
      segments,
      provider: 'routerai:' + modelId,
      chunks: files.length
    };
  } finally {
    cleanup(tmpDir);
  }
}

module.exports = { transcribeFile, isConfigured, isConfiguredAsync, model, chunkSec };
