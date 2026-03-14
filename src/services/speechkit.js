'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SpeechKitService {
  constructor(apiKey, folderId) {
    this.apiKey = apiKey || process.env.YANDEX_SPEECHKIT_API_KEY || '';
    this.folderId = folderId || process.env.YANDEX_FOLDER_ID || '';
    this.sttUrl = 'https://stt.api.cloud.yandex.net';
    this.ttsUrl = 'https://tts.api.cloud.yandex.net';
    this.operationsUrl = 'https://operation.api.cloud.yandex.net';
    if (!this.apiKey || !this.folderId) {
      console.warn('[SpeechKit] API key or folder ID not configured — SpeechKit disabled');
    }
  }

  isConfigured() {
    return !!(this.apiKey && this.folderId);
  }

  // === Асинхронное распознавание (для длинных записей > 30 сек) ===

  /**
   * Транскрибация аудиофайла (async long-running)
   * @param {string} filePath — путь к аудиофайлу
   * @param {Object} [options] — настройки
   * @returns {Promise<{text: string, segments: Array}>}
   */
  async transcribeFile(filePath, options = {}) {
    const {
      languageCode = 'ru-RU',
      model = 'general',
      audioEncoding = this._detectEncoding(filePath),
      sampleRate = 48000,
      audioChannelCount = 1,
      enableSpeakerDiarization = true,
      maxSpeakers = 2,
      profanityFilter = false,
      rawResults = false
    } = options;

    // Читаем файл и конвертируем в base64
    const audioContent = fs.readFileSync(filePath);
    const audioBase64 = audioContent.toString('base64');

    // Отправляем на распознавание
    const requestBody = JSON.stringify({
      config: {
        specification: {
          languageCode,
          model,
          audioEncoding,
          sampleRateHertz: sampleRate,
          audioChannelCount,
          enableWordTimeOffsets: true,
          enableSpeakerDiarization,
          speakerDiarizationConfig: enableSpeakerDiarization ? {
            enableSpeakerDiarization: true,
            maxSpeakerCount: maxSpeakers
          } : undefined,
          profanityFilter,
          rawResults
        }
      },
      audio: {
        content: audioBase64
      }
    });

    const operation = await this._httpsRequest({
      hostname: 'transcribe.api.cloud.yandex.net',
      path: '/speech/stt/v2/longRunningRecognize',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${this.apiKey}`,
        'x-folder-id': this.folderId
      },
      timeout: 30000
    }, requestBody);

    if (!operation.id) {
      throw new Error('SpeechKit: no operation ID returned');
    }

    // Поллинг операции до готовности
    const result = await this._pollOperation(operation.id, {
      maxAttempts: 120, // 10 минут макс
      intervalMs: 5000
    });

    return this._parseTranscriptionResult(result);
  }

  /**
   * Синхронное распознавание (для коротких записей < 30 сек)
   * @param {Buffer|string} audio — Buffer с аудио или путь к файлу
   * @param {Object} [options]
   * @returns {Promise<string>} — распознанный текст
   */
  async recognizeShort(audio, options = {}) {
    const {
      languageCode = 'ru-RU',
      model = 'general',
      audioEncoding = 'oggopus',
      sampleRate = 48000,
      topic = 'general'
    } = options;

    const audioBuffer = Buffer.isBuffer(audio) ? audio : fs.readFileSync(audio);

    const params = new URLSearchParams({
      lang: languageCode,
      folderId: this.folderId,
      format: audioEncoding,
      sampleRateHertz: String(sampleRate),
      topic
    });

    const result = await this._httpsRequest({
      hostname: 'stt.api.cloud.yandex.net',
      path: `/speech/v1/stt:recognize?${params.toString()}`,
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${this.apiKey}`,
        'Content-Type': `audio/${audioEncoding === 'oggopus' ? 'ogg' : audioEncoding}`,
        'Transfer-Encoding': 'chunked'
      },
      timeout: 30000
    }, audioBuffer);

    return result.result || '';
  }

  // === Синтез речи (TTS) ===

  /**
   * Синтезировать речь из текста
   * @param {string} text — текст для синтеза (макс 5000 символов)
   * @param {Object} [options]
   * @returns {Promise<Buffer>} — аудио данные
   */
  async synthesize(text, options = {}) {
    const {
      voice = 'alena',
      emotion = 'neutral',
      speed = '1.0',
      format = 'oggopus',
      sampleRate = 48000,
      ssml = false
    } = options;

    const params = new URLSearchParams({
      folderId: this.folderId,
      voice,
      emotion,
      speed: String(speed),
      format,
      sampleRateHertz: String(sampleRate)
    });

    if (ssml) {
      params.set('ssml', text);
    } else {
      params.set('text', text);
    }

    const body = params.toString();

    const result = await this._httpsRequestRaw({
      hostname: 'tts.api.cloud.yandex.net',
      path: '/speech/v1/tts:synthesize',
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${this.apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 15000
    }, body);

    return result;
  }

  /**
   * Синтезировать с кэшированием
   * @param {Object} db — database connection
   * @param {string} text — текст
   * @param {Object} [options]
   * @returns {Promise<string>} — путь к файлу
   */
  async synthesizeCached(db, text, options = {}) {
    const { voice = 'alena', format = 'oggopus', cacheDir = './uploads/ivr_cache' } = options;
    const textHash = crypto.createHash('sha256').update(text).digest('hex');

    // Проверяем кэш в БД
    const cached = await db.query(
      'SELECT file_path FROM ivr_audio_cache WHERE text_hash = $1 AND voice = $2',
      [textHash, voice]
    );

    if (cached.rows.length > 0 && fs.existsSync(cached.rows[0].file_path)) {
      // Обновляем last_used_at
      await db.query(
        'UPDATE ivr_audio_cache SET last_used_at = NOW() WHERE text_hash = $1 AND voice = $2',
        [textHash, voice]
      );
      return cached.rows[0].file_path;
    }

    // Синтезируем
    const audioBuffer = await this.synthesize(text, { voice, format });

    // Сохраняем файл
    const ext = format === 'oggopus' ? 'ogg' : format === 'lpcm' ? 'raw' : 'mp3';
    const fileName = `${textHash}_${voice}.${ext}`;
    const dir = path.resolve(cacheDir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, audioBuffer);

    // Сохраняем в БД
    await db.query(
      `INSERT INTO ivr_audio_cache (text_hash, text, file_path, voice, format, file_size)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (text_hash, voice)
       DO UPDATE SET file_path = $3, file_size = $6, last_used_at = NOW()`,
      [textHash, text, filePath, voice, format, audioBuffer.length]
    );

    return filePath;
  }

  // === Внутренние методы ===

  _detectEncoding(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ogg': case '.opus': return 'OGG_OPUS';
      case '.mp3': return 'MP3';
      case '.wav': return 'LINEAR16_PCM';
      case '.flac': return 'FLAC';
      default: return 'MP3';
    }
  }

  async _pollOperation(operationId, { maxAttempts = 120, intervalMs = 5000 } = {}) {
    for (let i = 0; i < maxAttempts; i++) {
      const op = await this._httpsRequest({
        hostname: 'operation.api.cloud.yandex.net',
        path: `/operations/${operationId}`,
        method: 'GET',
        headers: {
          'Authorization': `Api-Key ${this.apiKey}`
        },
        timeout: 10000
      });

      if (op.done) {
        if (op.error) {
          throw new Error(`SpeechKit operation failed: ${op.error.message || JSON.stringify(op.error)}`);
        }
        return op.response;
      }

      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`SpeechKit operation ${operationId} timed out after ${maxAttempts * intervalMs / 1000}s`);
  }

  _parseTranscriptionResult(response) {
    const chunks = response.chunks || [];
    const segments = [];
    let fullText = '';

    for (const chunk of chunks) {
      const alternatives = chunk.alternatives || [];
      if (alternatives.length === 0) continue;

      const best = alternatives[0];
      const text = best.text || '';
      fullText += (fullText ? ' ' : '') + text;

      // Парсим слова с временными метками
      const words = best.words || [];
      if (words.length > 0) {
        // Группируем по спикерам
        let currentSpeaker = null;
        let segmentText = '';
        let segmentStart = null;
        let segmentEnd = null;

        for (const word of words) {
          const speaker = word.speakerTag || 1;
          const startTime = this._parseTime(word.startTime);
          const endTime = this._parseTime(word.endTime);

          if (speaker !== currentSpeaker) {
            if (currentSpeaker !== null && segmentText) {
              segments.push({
                speaker: currentSpeaker,
                speakerLabel: currentSpeaker === 1 ? 'Оператор' : 'Клиент',
                start: segmentStart,
                end: segmentEnd,
                text: segmentText.trim()
              });
            }
            currentSpeaker = speaker;
            segmentText = '';
            segmentStart = startTime;
          }
          segmentText += word.word + ' ';
          segmentEnd = endTime;
        }

        // Последний сегмент
        if (segmentText) {
          segments.push({
            speaker: currentSpeaker,
            speakerLabel: currentSpeaker === 1 ? 'Оператор' : 'Клиент',
            start: segmentStart,
            end: segmentEnd,
            text: segmentText.trim()
          });
        }
      } else {
        // Без деления по словам
        const channelTag = chunk.channelTag || 1;
        segments.push({
          speaker: channelTag,
          speakerLabel: channelTag === 1 ? 'Оператор' : 'Клиент',
          start: 0,
          end: 0,
          text
        });
      }
    }

    return {
      text: fullText.trim(),
      segments,
      rawChunks: chunks
    };
  }

  _parseTime(timeStr) {
    if (!timeStr) return 0;
    // Yandex формат: "1.5s" или { seconds: 1, nanos: 500000000 }
    if (typeof timeStr === 'string') {
      return parseFloat(timeStr.replace('s', ''));
    }
    if (typeof timeStr === 'object') {
      return (timeStr.seconds || 0) + (timeStr.nanos || 0) / 1e9;
    }
    return 0;
  }

  _httpsRequest(options, body) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              const err = new Error(`SpeechKit HTTP ${res.statusCode}: ${parsed.message || data}`);
              err.statusCode = res.statusCode;
              err.response = parsed;
              reject(err);
            } else {
              resolve(parsed);
            }
          } catch (e) {
            if (res.statusCode >= 400) {
              reject(new Error(`SpeechKit HTTP ${res.statusCode}: ${data}`));
            } else {
              resolve({ raw: data });
            }
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('SpeechKit request timeout')); });
      if (body) req.write(body);
      req.end();
    });
  }

  _httpsRequestRaw(options, body) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode >= 400) {
            reject(new Error(`SpeechKit TTS HTTP ${res.statusCode}: ${buffer.toString()}`));
          } else {
            resolve(buffer);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('SpeechKit TTS timeout')); });
      if (body) req.write(body);
      req.end();
    });
  }
}

// Singleton
let instance = null;
function getSpeechKitService() {
  if (!instance) {
    instance = new SpeechKitService();
  }
  return instance;
}

module.exports = SpeechKitService;
module.exports.getSpeechKitService = getSpeechKitService;
