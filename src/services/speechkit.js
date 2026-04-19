'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// gRPC для API v3
let grpc, protoLoader;
try {
  grpc = require('@grpc/grpc-js');
  protoLoader = require('@grpc/proto-loader');
} catch (e) {
  console.warn('[SpeechKit] @grpc/grpc-js not installed — v3 API disabled, using v1 fallback');
}

class SpeechKitService {
  constructor(apiKey, folderId) {
    this.apiKey = apiKey || process.env.YANDEX_SPEECHKIT_API_KEY || '';
    this.folderId = folderId || process.env.YANDEX_FOLDER_ID || '';
    this.sttUrl = 'https://stt.api.cloud.yandex.net';
    this.ttsUrl = 'https://tts.api.cloud.yandex.net';
    this.operationsUrl = 'https://operation.api.cloud.yandex.net';
    this._ttsGrpcClient = null;
    this._grpcAvailable = !!(grpc && protoLoader);
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

  // === TTS API v3 (gRPC) — голоса нового поколения ===

  /**
   * Инициализация gRPC клиента для TTS v3
   * Ленивая — создаётся при первом вызове
   */
  _initTtsGrpc() {
    if (this._ttsGrpcClient) return this._ttsGrpcClient;
    if (!this._grpcAvailable) return null;

    try {
      const protoPath = path.resolve(__dirname, '../../proto/yandex/cloud/ai/tts/v3/tts_service.proto');
      if (!fs.existsSync(protoPath)) {
        console.warn('[SpeechKit] Proto files not found at', protoPath, '— v3 disabled');
        return null;
      }

      const packageDef = protoLoader.loadSync(protoPath, {
        keepCase: false,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [path.resolve(__dirname, '../../proto')]
      });

      const proto = grpc.loadPackageDefinition(packageDef);
      const Synthesizer = proto.speechkit.tts.v3.Synthesizer;

      const channelCreds = grpc.credentials.createSsl();
      this._ttsGrpcClient = new Synthesizer(
        'tts.api.cloud.yandex.net:443',
        channelCreds
      );

      console.log('[SpeechKit] TTS gRPC v3 client initialized (dasha + friendly available)');
      return this._ttsGrpcClient;
    } catch (e) {
      console.error('[SpeechKit] gRPC v3 init failed:', e.message);
      this._grpcAvailable = false;
      return null;
    }
  }

  /**
   * gRPC metadata с авторизацией
   */
  _grpcMetadata() {
    const metadata = new grpc.Metadata();
    metadata.add('authorization', `Api-Key ${this.apiKey}`);
    metadata.add('x-folder-id', this.folderId);
    return metadata;
  }

  /**
   * Синтез речи через API v3 (gRPC) — полный буфер
   * Возвращает Buffer, совместимый с v1 synthesize()
   *
   * @param {string} text — текст или SSML
   * @param {Object} [options]
   * @returns {Promise<Buffer>} — аудио данные
   */
  async synthesizeV3(text, options = {}) {
    const {
      voice = 'dasha',
      role = 'friendly',
      speed = 1.0,
      format = 'OGG_OPUS',
      telephony = false,
      ssml = false
    } = options;

    const client = this._initTtsGrpc();
    if (!client) {
      throw new Error('gRPC v3 not available');
    }

    // Убираем SSML-теги если они были (v3 принимает plain text и сам расставляет интонации)
    let plainText = text;
    if (ssml) {
      plainText = text
        .replace(/<speak>/g, '')
        .replace(/<\/speak>/g, '')
        .replace(/<break[^>]*\/>/g, ', ')
        .replace(/<[^>]+>/g, '')
        .trim();
    }

    // Для телефонии: LINEAR16_PCM 8kHz — без двойной конвертации в Asterisk
    // Для остального: OGG_OPUS (высокое качество)
    const outputAudioSpec = telephony
      ? { rawAudio: { audioEncoding: 'LINEAR16_PCM', sampleRateHertz: 8000 } }
      : { containerAudio: { containerAudioType: format } };

    const request = {
      text: plainText,
      outputAudioSpec,
      hints: [
        { voice: voice },
        { role: role },
        { speed: speed }
      ],
      loudnessNormalizationType: 'LUFS',
      unsafeMode: plainText.length > 250
    };

    return new Promise((resolve, reject) => {
      const metadata = this._grpcMetadata();
      const chunks = [];
      const startTime = Date.now();

      const call = client.utteranceSynthesis(request, metadata);

      call.on('data', (response) => {
        if (response.audioChunk && response.audioChunk.data) {
          chunks.push(Buffer.from(response.audioChunk.data));
        }
      });

      call.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const elapsed = Date.now() - startTime;
        console.log(`[SpeechKit v3] TTS done: ${voice}/${role}, ${plainText.length} chars, ${buffer.length} bytes, ${elapsed}ms`);
        resolve(buffer);
      });

      call.on('error', (err) => {
        console.error(`[SpeechKit v3] TTS error: ${err.message}`);
        reject(err);
      });

      // Таймаут 15 секунд
      setTimeout(() => {
        call.cancel();
        reject(new Error('SpeechKit v3 TTS timeout'));
      }, 15000);
    });
  }

  /**
   * Синтез речи v3 с потоковым возвратом (async generator)
   * Отдаёт аудио чанки по мере синтеза — для мгновенного воспроизведения
   *
   * @param {string} text — текст
   * @param {Object} [options]
   * @yields {Buffer} — аудио чанки
   */
  async *synthesizeV3Stream(text, options = {}) {
    const {
      voice = 'dasha',
      role = 'friendly',
      speed = 1.0,
      format = 'OGG_OPUS',
      telephony = false,
      ssml = false
    } = options;

    const client = this._initTtsGrpc();
    if (!client) {
      throw new Error('gRPC v3 not available');
    }

    let plainText = text;
    if (ssml) {
      plainText = text
        .replace(/<speak>/g, '').replace(/<\/speak>/g, '')
        .replace(/<break[^>]*\/>/g, ', ')
        .replace(/<[^>]+>/g, '').trim();
    }

    const outputAudioSpec = telephony
      ? { rawAudio: { audioEncoding: 'LINEAR16_PCM', sampleRateHertz: 8000 } }
      : { containerAudio: { containerAudioType: format } };

    const request = {
      text: plainText,
      outputAudioSpec,
      hints: [
        { voice: voice },
        { role: role },
        { speed: speed }
      ],
      loudnessNormalizationType: 'LUFS',
      unsafeMode: plainText.length > 250
    };

    const metadata = this._grpcMetadata();
    const call = client.utteranceSynthesis(request, metadata);

    // Преобразуем gRPC stream в async iterable
    const queue = [];
    let resolve = null;
    let done = false;
    let error = null;

    call.on('data', (response) => {
      if (response.audioChunk && response.audioChunk.data) {
        const chunk = Buffer.from(response.audioChunk.data);
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: chunk, done: false });
        } else {
          queue.push(chunk);
        }
      }
    });

    call.on('end', () => {
      done = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined, done: true });
      }
    });

    call.on('error', (err) => {
      error = err;
      done = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined, done: true });
      }
    });

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift();
          continue;
        }
        if (done) break;
        const result = await new Promise(r => { resolve = r; });
        if (result.done) break;
        yield result.value;
      }
    } finally {
      if (!done) call.cancel();
    }

    if (error) throw error;
  }

  /**
   * Bidirectional streaming TTS v3 (для pipe AI output → TTS)
   * Отправляет текст частями, получает аудио по мере готовности
   *
   * @param {Object} [options] — voice, role, speed, format
   * @returns {{ write(text), end(), audioStream: AsyncGenerator<Buffer> }}
   */
  createStreamingSynthesis(options = {}) {
    const {
      voice = 'dasha',
      role = 'friendly',
      speed = 1.0,
      format = 'OGG_OPUS'
    } = options;

    const client = this._initTtsGrpc();
    if (!client) return null;

    const metadata = this._grpcMetadata();
    const call = client.streamSynthesis(metadata);

    // Первое сообщение — настройки
    call.write({
      options: {
        voice: voice,
        role: role,
        speed: speed,
        outputAudioSpec: {
          containerAudio: { containerAudioType: format }
        },
        loudnessNormalizationType: 'LUFS'
      }
    });

    // Очередь аудио чанков
    const audioQueue = [];
    let audioResolve = null;
    let streamDone = false;
    let streamError = null;

    call.on('data', (response) => {
      if (response.audioChunk && response.audioChunk.data) {
        const chunk = Buffer.from(response.audioChunk.data);
        if (audioResolve) {
          const r = audioResolve;
          audioResolve = null;
          r({ value: chunk, done: false });
        } else {
          audioQueue.push(chunk);
        }
      }
    });

    call.on('end', () => {
      streamDone = true;
      if (audioResolve) {
        const r = audioResolve;
        audioResolve = null;
        r({ value: undefined, done: true });
      }
    });

    call.on('error', (err) => {
      streamError = err;
      streamDone = true;
      if (audioResolve) {
        const r = audioResolve;
        audioResolve = null;
        r({ value: undefined, done: true });
      }
    });

    return {
      /** Отправить фрагмент текста в TTS */
      write(text) {
        call.write({ synthesisInput: { text: text } });
      },

      /** Принудительно синтезировать буфер */
      flush() {
        call.write({ forceSynthesis: {} });
      },

      /** Завершить отправку текста */
      end() {
        call.end();
      },

      /** Async generator аудио чанков */
      async *audioStream() {
        while (true) {
          if (audioQueue.length > 0) {
            yield audioQueue.shift();
            continue;
          }
          if (streamDone) break;
          const result = await new Promise(r => { audioResolve = r; });
          if (result.done) break;
          yield result.value;
        }
        if (streamError) throw streamError;
      }
    };
  }

  /**
   * Умный синтез: пробует v3 (dasha/friendly), при ошибке — v1 (alena/good)
   *
   * @param {string} text — текст или SSML
   * @param {Object} [options]
   * @returns {Promise<Buffer>}
   */
  async synthesizeSmart(text, options = {}) {
    const telephony = !!options.telephony;

    // Пробуем v3 (лучший голос)
    if (this._grpcAvailable && this.isConfigured()) {
      try {
        return await this.synthesizeV3(text, {
          voice: options.voice || 'dasha',
          role: options.role || options.emotion || 'friendly',
          speed: parseFloat(options.speed) || 1.0,
          telephony,
          ssml: options.ssml || false
        });
      } catch (e) {
        console.warn('[SpeechKit] v3 failed, falling back to v1:', e.message);
      }
    }

    // Fallback на v1 (lpcm 8kHz для телефонии, oggopus для остального)
    return this.synthesize(text, {
      voice: options.voice === 'dasha' ? 'alena' : (options.voice || 'alena'),
      emotion: options.emotion || options.role || 'good',
      speed: options.speed || '1.0',
      format: telephony ? 'lpcm' : (options.format || 'oggopus'),
      sampleRate: telephony ? 8000 : (options.sampleRate || 48000),
      ssml: options.ssml || false
    });
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
