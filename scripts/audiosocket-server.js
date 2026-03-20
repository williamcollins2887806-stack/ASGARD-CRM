#!/usr/bin/env node
'use strict';

/**
 * ASGARD CRM — AudioSocket Streaming Voice Agent
 * ═══════════════════════════════════════════════════
 * Фаза 3: полный streaming pipeline через Asterisk AudioSocket.
 * Замена AGI-сервера для голосового AI-оператора.
 *
 * Pipeline: AudioSocket ↔ STT v3 gRPC ↔ AI streaming ↔ TTS v3 gRPC
 * Целевая задержка: ~0.5с (вместо ~2.5с AGI pipeline)
 *
 * Asterisk dialplan: AudioSocket(${UNIQUEID},127.0.0.1:9092)
 * Запуск: node scripts/audiosocket-server.js
 */

const net = require('net');
const path = require('path');
const fs = require('fs');
const http = require('http');

/* ── Корень проекта + dotenv ──────────────────────── */
const CRM_ROOT = path.resolve(__dirname, '..');
try { require('dotenv').config({ path: path.join(CRM_ROOT, '.env') }); } catch (e) {
  // Ручной парсинг .env если dotenv не установлен
  try {
    const envContent = fs.readFileSync(path.join(CRM_ROOT, '.env'), 'utf8');
    envContent.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const eq = line.indexOf('=');
      if (eq === -1) return;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    });
  } catch (_) { /* .env not found */ }
}

/* ── Config ────────────────────────────────────────── */
const AUDIOSOCKET_PORT = parseInt(process.env.AUDIOSOCKET_PORT || '9092', 10);
const CRM_HTTP_PORT = parseInt(process.env.PORT || '3000', 10);
const YANDEX_API_KEY = process.env.YANDEX_SPEECHKIT_API_KEY || '';
const YANDEX_FOLDER_ID = process.env.YANDEX_SPEECHKIT_FOLDER_ID || process.env.YANDEX_FOLDER_ID || '';
const MAX_TURNS = 8;

/* ── gRPC ──────────────────────────────────────────── */
let grpc, protoLoader;
try {
  grpc = require('@grpc/grpc-js');
  protoLoader = require('@grpc/proto-loader');
} catch (e) {
  console.error('[AudioSocket] FATAL: @grpc/grpc-js not installed');
  process.exit(1);
}

/* ── AI Provider ───────────────────────────────────── */
const aiProvider = require(path.join(CRM_ROOT, 'src/services/ai-provider'));
const { VOICE_OPERATOR_SYSTEM, VOICE_OPERATOR_USER } = require(path.join(CRM_ROOT, 'src/prompts/voice-secretary-prompt'));
const VoiceAgent = require(path.join(CRM_ROOT, 'src/services/voice-agent'));
const db = require(path.join(CRM_ROOT, 'src/services/db'));

/* ── gRPC proto loading ───────────────────────────── */
const PROTO_DIR = path.resolve(CRM_ROOT, 'proto');

function loadProto(protoPath) {
  return protoLoader.loadSync(protoPath, {
    keepCase: false, longs: String, enums: String,
    defaults: true, oneofs: true,
    includeDirs: [PROTO_DIR]
  });
}

// STT v3 gRPC client
const sttPkgDef = loadProto(path.join(PROTO_DIR, 'yandex/cloud/ai/stt/v3/stt_service.proto'));
const sttProto = grpc.loadPackageDefinition(sttPkgDef);
const sttServiceClient = new sttProto.speechkit.stt.v3.Recognizer(
  'stt.api.cloud.yandex.net:443',
  grpc.credentials.createSsl()
);

// TTS v3 gRPC client
const ttsPkgDef = loadProto(path.join(PROTO_DIR, 'yandex/cloud/ai/tts/v3/tts_service.proto'));
const ttsProto = grpc.loadPackageDefinition(ttsPkgDef);
const ttsSynthesizer = new ttsProto.speechkit.tts.v3.Synthesizer(
  'tts.api.cloud.yandex.net:443',
  grpc.credentials.createSsl()
);

function grpcMetadata() {
  const md = new grpc.Metadata();
  md.add('authorization', `Api-Key ${YANDEX_API_KEY}`);
  md.add('x-folder-id', YANDEX_FOLDER_ID);
  return md;
}

/* ── Хелпер VoiceAgent для бизнес-логики ─────────── */
// Создаём заглушку SpeechKit — нам не нужен TTS через него,
// но VoiceAgent требует speechKit в конструкторе
const dummySpeechKit = { isConfigured: () => false };
const voiceAgentHelper = new VoiceAgent(dummySpeechKit, aiProvider, db);

/* ══════════════════════════════════════════════════════
   AMI Client — Asterisk Manager Interface
   ══════════════════════════════════════════════════════ */

class AMIClient {
  constructor() {
    this.host = '127.0.0.1';
    this.port = parseInt(process.env.AMI_PORT || '5038', 10);
    this.username = process.env.AMI_USERNAME || 'asgard';
    this.secret = process.env.AMI_SECRET || process.env.AMI_PASSWORD || '';
    this.socket = null;
    this.connected = false;
    this._buf = '';
    this._callbacks = new Map();
    this._counter = 0;
    this._eventHandlers = [];
    this._reconnectTimer = null;
    // CallerID mapping: Asterisk Uniqueid → CallerID number
    this.callerIdMap = new Map();
    // Channel mapping: Asterisk Uniqueid → channel name
    this.channelMap = new Map();
    // AUUID mapping: random UUID (from dialplan Set) → Asterisk uniqueid
    this.auuidMap = new Map();
  }

  async connect() {
    if (!this.secret) {
      console.warn('[AMI] No AMI_SECRET configured — transfers disabled');
      return;
    }

    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.port, this.host);
      let welcomed = false;

      this.socket.on('data', (data) => {
        this._buf += data.toString();
        if (!welcomed && this._buf.includes('Asterisk Call Manager')) {
          welcomed = true;
          this._send(`Action: Login\r\nUsername: ${this.username}\r\nSecret: ${this.secret}\r\n\r\n`);
        }
        this._parse();
      });

      const loginCheck = setInterval(() => {
        if (this.connected) { clearInterval(loginCheck); clearTimeout(timeout); resolve(); }
      }, 100);
      const timeout = setTimeout(() => { clearInterval(loginCheck); reject(new Error('AMI login timeout')); }, 5000);

      this.socket.on('error', (err) => {
        console.error('[AMI] Error:', err.message);
        this.connected = false;
      });

      this.socket.on('close', () => {
        this.connected = false;
        if (!this._reconnectTimer) {
          this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this.connect().catch(() => {});
          }, 5000);
        }
      });
    });
  }

  _send(data) { if (this.socket && !this.socket.destroyed) this.socket.write(data); }

  _parse() {
    const messages = this._buf.split('\r\n\r\n');
    this._buf = messages.pop() || '';

    for (const msg of messages) {
      if (!msg.trim()) continue;
      const h = {};
      for (const line of msg.split('\r\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) h[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
      }

      if (h.response === 'Success' && h.message === 'Authentication accepted') {
        this.connected = true;
        console.log('[AMI] Connected');
      }

      if (h.actionid && this._callbacks.has(h.actionid)) {
        const cb = this._callbacks.get(h.actionid);
        this._callbacks.delete(h.actionid);
        cb(h);
      }

      // Track CallerID: Newchannel event
      if (h.event === 'Newchannel' && h.calleridnum && h.uniqueid) {
        this.callerIdMap.set(h.uniqueid, h.calleridnum);
        this.channelMap.set(h.uniqueid, h.channel);
        // Track last incoming call for fallback lookup
        if (h.channel && h.channel.includes('mango-trunk')) {
          this.lastIncoming = { callerNumber: h.calleridnum, channelName: h.channel, time: Date.now() };
        }
      }

      // Track AUUID: VarSet event maps random UUID → Asterisk uniqueid
      if (h.event === 'VarSet' && h.variable === 'AUUID' && h.value && h.uniqueid) {
        this.auuidMap.set(h.value.trim(), h.uniqueid);
      }

      for (const handler of this._eventHandlers) {
        try { handler(h); } catch (_) {}
      }
    }
  }

  async action(params) {
    const id = `as-${++this._counter}`;
    let cmd = `ActionID: ${id}\r\n`;
    for (const [k, v] of Object.entries(params)) cmd += `${k}: ${v}\r\n`;
    cmd += '\r\n';

    return new Promise((resolve, reject) => {
      this._callbacks.set(id, resolve);
      this._send(cmd);
      setTimeout(() => {
        if (this._callbacks.has(id)) { this._callbacks.delete(id); reject(new Error('AMI timeout')); }
      }, 10000);
    });
  }

  /** Перевести канал на номер */
  async redirect(channelName, phoneNumber) {
    return this.action({
      Action: 'Redirect', Channel: channelName,
      Context: 'asgard-transfer', Exten: phoneNumber.replace(/[^0-9]/g, ''), Priority: '1'
    });
  }

  /** Хангап канала */
  async hangup(channelName) {
    return this.action({ Action: 'Hangup', Channel: channelName });
  }

  /** Получить CallerID для Uniqueid, если AMI-event ещё не пришёл — запрос через GetVar */
  async getCallerIdForUniqueId(uniqueid) {
    if (this.callerIdMap.has(uniqueid)) return this.callerIdMap.get(uniqueid);

    // Ждём немного — AMI event может прийти с задержкой
    await new Promise(r => setTimeout(r, 300));
    if (this.callerIdMap.has(uniqueid)) return this.callerIdMap.get(uniqueid);

    return null;
  }

  /** Получить имя канала для Uniqueid */
  getChannelName(uniqueid) {
    return this.channelMap.get(uniqueid) || null;
  }

  /** Resolve CallerID and channel by AudioSocket UUID (random UUID from dialplan) */
  async resolveByAuuid(auuid) {
    // Try VarSet mapping first (up to 1s)
    for (let i = 0; i < 3; i++) {
      const astId = this.auuidMap.get(auuid);
      if (astId) {
        return {
          callerNumber: this.callerIdMap.get(astId) || 'unknown',
          channelName: this.channelMap.get(astId) || null,
        };
      }
      await new Promise(r => setTimeout(r, 300));
    }
    // Fallback: use last incoming mango-trunk call (within 5 seconds)
    if (this.lastIncoming && (Date.now() - this.lastIncoming.time) < 5000) {
      console.log(`[AMI] Fallback CallerID: ${this.lastIncoming.callerNumber}`);
      return {
        callerNumber: this.lastIncoming.callerNumber,
        channelName: this.lastIncoming.channelName,
      };
    }
    return { callerNumber: 'unknown', channelName: null };
  }

  onEvent(handler) { this._eventHandlers.push(handler); }
}

const ami = new AMIClient();

/* ══════════════════════════════════════════════════════
   AudioSocket Protocol
   ══════════════════════════════════════════════════════ */

// Типы фреймов
const AS_TYPE_UUID    = 0x01; // от Asterisk: UUID канала
const AS_TYPE_AUDIO   = 0x10; // двунаправленный: аудио PCM
const AS_TYPE_HANGUP  = 0x00; // от Asterisk: канал закрылся
const AS_TYPE_ERROR   = 0xff; // ошибка

/** Парсер входящих AudioSocket фреймов */
function createFrameParser() {
  let buf = Buffer.alloc(0);
  return {
    push(data) {
      buf = Buffer.concat([buf, data]);
      const frames = [];
      while (buf.length >= 3) {
        const type = buf[0];
        const length = buf.readUInt16BE(1); // AudioSocket uses big-endian!
        if (buf.length < 3 + length) break;
        frames.push({ type, payload: buf.slice(3, 3 + length) });
        buf = buf.slice(3 + length);
      }
      return frames;
    }
  };
}

/** Сборка AudioSocket фрейма для отправки */
function makeAudioFrame(pcmData) {
  const header = Buffer.alloc(3);
  header[0] = AS_TYPE_AUDIO;
  header.writeUInt16BE(pcmData.length, 1); // big-endian
  return Buffer.concat([header, pcmData]);
}

/* ══════════════════════════════════════════════════════
   TTS — синтез в сырой PCM для AudioSocket
   ══════════════════════════════════════════════════════ */

/** Синтезировать текст в raw slin16 PCM 8kHz (полный буфер) */
function synthesizeToPCM(text) {
  return new Promise((resolve, reject) => {
    const request = {
      text: text,
      outputAudioSpec: {
        rawAudio: { audioEncoding: 'LINEAR16_PCM', sampleRateHertz: 8000 }
      },
      hints: [
        { voice: 'dasha' },
        { role: 'friendly' },
        { speed: 1.0 }
      ],
      loudnessNormalizationType: 'LUFS',
      unsafeMode: text.length > 250
    };

    const chunks = [];
    const call = ttsSynthesizer.utteranceSynthesis(request, grpcMetadata());
    call.on('data', (r) => { if (r.audioChunk && r.audioChunk.data) chunks.push(Buffer.from(r.audioChunk.data)); });
    call.on('end', () => resolve(Buffer.concat(chunks)));
    call.on('error', reject);
    setTimeout(() => { call.cancel(); reject(new Error('TTS timeout')); }, 15000);
  });
}

/* ── Кэш приветствий (pre-synthesized PCM) ─────────── */
const phraseCache = new Map();
const CACHED_PHRASES = [
  'Здравствуйте! Компания Асгард Сервис. Чем могу помочь?',
  'Алло? Я вас слушаю.',
  'Простите, не расслышал. Подскажите, чем могу помочь?',
  'Секундочку, соединяю вас со специалистом.',
  'Извините, не слышу вас. Если хотите, перезвоните нам позже. До свидания!',
  'Куда вас соединить?',
];

async function warmupPhraseCache() {
  console.log('[AudioSocket] Warming up phrase cache...');
  let ok = 0;
  for (const phrase of CACHED_PHRASES) {
    try {
      const pcm = await synthesizeToPCM(phrase);
      if (pcm.length > 0) { phraseCache.set(phrase, pcm); ok++; }
    } catch (e) {
      console.warn(`[AudioSocket] Cache failed: "${phrase.slice(0, 35)}..." — ${e.message}`);
    }
  }
  console.log(`[AudioSocket] Phrase cache: ${ok}/${CACHED_PHRASES.length}`);
}

/* ══════════════════════════════════════════════════════
   CRM notify (POST /api/telephony/internal/agi-event)
   ══════════════════════════════════════════════════════ */

function notifyCRM(type, data) {
  const payload = JSON.stringify({ type, ...data, timestamp: Date.now() });
  const req = http.request({
    hostname: '127.0.0.1', port: CRM_HTTP_PORT,
    path: '/api/telephony/internal/agi-event',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    timeout: 3000
  }, (res) => { res.resume(); });
  req.on('error', () => {});
  req.write(payload);
  req.end();
}

/* ══════════════════════════════════════════════════════
   ОБРАБОТКА ОДНОГО ЗВОНКА (AudioSocket соединение)
   ══════════════════════════════════════════════════════ */

async function handleConnection(socket) {
  const parser = createFrameParser();
  let uuid = null;
  let callerNumber = 'unknown';
  let channelName = null;
  let destroyed = false;
  let isSpeaking = false;

  // STT state
  let sttStream = null;
  let isListening = false;
  let currentPartialText = '';

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    if (sttStream) { try { sttStream.end(); } catch (_) {} sttStream = null; }
    isListening = false;
    socket.destroy();
    console.log(`[AudioSocket] Call ended: UUID=${uuid}, caller=${callerNumber}`);
  }

  socket.on('error', () => cleanup());
  socket.on('close', () => cleanup());

  /* ── Отправить PCM в AudioSocket ────────────────── */
  function sendAudio(pcmBuffer) {
    if (destroyed || !socket.writable) return;
    // Отправляем чанками по 320 байт (20ms при 8kHz slin16)
    const CHUNK_SIZE = 320;
    for (let i = 0; i < pcmBuffer.length; i += CHUNK_SIZE) {
      const chunk = pcmBuffer.slice(i, Math.min(i + CHUNK_SIZE, pcmBuffer.length));
      try { socket.write(makeAudioFrame(chunk)); } catch (_) { break; }
    }
  }

  /* ── Произнести фразу (кэш → синтез) ───────────── */
  async function speak(text) {
    if (destroyed) { console.log('[AudioSocket] speak: destroyed, skip'); return; }
    isSpeaking = true;

    let pcm = phraseCache.get(text);
    const cached = !!pcm;
    if (!pcm) {
      try { pcm = await synthesizeToPCM(text); } catch (e) {
        console.error('[AudioSocket] TTS error:', e.message);
        isSpeaking = false;
        return;
      }
    }

    console.log(`[AudioSocket] speak: "${text.slice(0, 40)}..." ${cached ? 'CACHED' : 'synthesized'}, ${pcm.length} bytes`);
    sendAudio(pcm);
    // Ждём пока аудио проиграется
    const durationMs = (pcm.length / 2 / 8000) * 1000;
    await new Promise(r => setTimeout(r, durationMs));
    isSpeaking = false;
  }

  /* ── Произнести потоком (TTS StreamSynthesis) ──── */
  async function speakStreaming(text) {
    if (destroyed) return;
    isSpeaking = true;

    try {
      const call = ttsSynthesizer.streamSynthesis(grpcMetadata());

      // Первое сообщение — настройки
      call.write({
        options: {
          voice: 'dasha', role: 'friendly', speed: 1.0,
          outputAudioSpec: {
            rawAudio: { audioEncoding: 'LINEAR16_PCM', sampleRateHertz: 8000 }
          },
          loudnessNormalizationType: 'LUFS'
        }
      });

      // Текст + force synthesis
      call.write({ synthesisInput: { text: text } });
      call.write({ forceSynthesis: {} });
      call.end();

      await new Promise((resolve, reject) => {
        call.on('data', (r) => {
          if (r.audioChunk && r.audioChunk.data && !destroyed) {
            sendAudio(Buffer.from(r.audioChunk.data));
          }
        });
        call.on('end', resolve);
        call.on('error', reject);
        setTimeout(resolve, 15000);
      });
    } catch (e) {
      console.error('[AudioSocket] TTS stream error:', e.message);
    }

    isSpeaking = false;
  }

  /* ── STT streaming session ─────────────────────── */
  function startSTT(onFinal) {
    if (sttStream) { try { sttStream.end(); } catch (_) {} }
    currentPartialText = '';

    sttStream = sttServiceClient.recognizeStreaming(grpcMetadata());

    // Первое сообщение — настройки
    sttStream.write({
      sessionOptions: {
        recognitionModel: {
          model: 'general',
          audioFormat: {
            rawAudio: {
              audioEncoding: 'LINEAR16_PCM',
              sampleRateHertz: 8000,
              audioChannelCount: 1
            }
          },
          textNormalization: {
            textNormalization: 'TEXT_NORMALIZATION_ENABLED',
            profanityFilter: false,
            literatureText: false
          },
          languageRestriction: {
            restrictionType: 'WHITELIST',
            languageCode: ['ru-RU']
          },
          audioProcessingType: 'REAL_TIME'
        },
        eouClassifier: {
          defaultClassifier: { type: 'DEFAULT' }
        }
      }
    });

    sttStream.on('data', (response) => {
      // Partial — промежуточный
      if (response.partial) {
        const alts = response.partial.alternatives || [];
        if (alts.length > 0 && alts[0].text) {
          currentPartialText = alts[0].text;
        }
      }

      // Final — финальный фрагмент
      if (response.final) {
        const alts = response.final.alternatives || [];
        if (alts.length > 0 && alts[0].text) {
          currentPartialText = alts[0].text;
        }
      }

      // EOU — конец высказывания
      if (response.eouUpdate) {
        const text = currentPartialText.trim();
        currentPartialText = '';
        if (text) onFinal(text);
      }

      // FinalRefinement — нормализованный текст (более точный)
      if (response.finalRefinement) {
        const alts = response.finalRefinement.normalizedText &&
          response.finalRefinement.normalizedText.alternatives;
        if (alts && alts.length > 0 && alts[0].text) {
          const text = alts[0].text.trim();
          currentPartialText = '';
          if (text) onFinal(text);
        }
      }
    });

    sttStream.on('error', (err) => {
      if (!destroyed) console.error('[AudioSocket] STT error:', err.message);
    });

    sttStream.on('end', () => { sttStream = null; });
    isListening = true;
  }

  function stopSTT() {
    isListening = false;
    if (sttStream) { try { sttStream.end(); } catch (_) {} sttStream = null; }
  }

  /* ── AI streaming → TTS streaming pipeline ─────── */
  async function generateAndSpeak(context) {
    const systemPrompt = VOICE_OPERATOR_SYSTEM(context);
    const userPrompt = VOICE_OPERATOR_USER(context);
    const startTime = Date.now();

    try {
      const streamResponse = await aiProvider.stream({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 400,
        temperature: 0.3
      });

      const streamParser = aiProvider.parseStream(streamResponse);
      let fullText = '';
      let sentenceBuf = '';
      isSpeaking = true;

      // Открываем TTS bidirectional stream
      const ttsCall = ttsSynthesizer.streamSynthesis(grpcMetadata());
      let ttsEnded = false;

      // Настройки TTS
      ttsCall.write({
        options: {
          voice: 'dasha', role: 'friendly', speed: 1.0,
          outputAudioSpec: {
            rawAudio: { audioEncoding: 'LINEAR16_PCM', sampleRateHertz: 8000 }
          },
          loudnessNormalizationType: 'LUFS'
        }
      });

      // Когда TTS отдаёт аудио — сразу в AudioSocket
      const ttsFinished = new Promise((resolve) => {
        ttsCall.on('data', (r) => {
          if (r.audioChunk && r.audioChunk.data && !destroyed) {
            sendAudio(Buffer.from(r.audioChunk.data));
          }
        });
        ttsCall.on('end', () => { ttsEnded = true; resolve(); });
        ttsCall.on('error', (err) => {
          console.error('[AudioSocket] TTS pipe error:', err.message);
          ttsEnded = true;
          resolve();
        });
        setTimeout(() => { if (!ttsEnded) resolve(); }, 20000);
      });

      // AI tokens → буфер → TTS по предложениям
      for await (const event of streamParser) {
        if (event.type === 'text') {
          fullText += event.content;
          sentenceBuf += event.content;

          // Отправляем в TTS при конце предложения
          if (/[.!?]\s*$/.test(sentenceBuf) && sentenceBuf.trim().length > 5) {
            ttsCall.write({ synthesisInput: { text: sentenceBuf.trim() } });
            ttsCall.write({ forceSynthesis: {} });
            sentenceBuf = '';
          }
        }
        if (event.type === 'done' || event.type === 'error') break;
      }

      // Остаток текста
      if (sentenceBuf.trim()) {
        ttsCall.write({ synthesisInput: { text: sentenceBuf.trim() } });
        ttsCall.write({ forceSynthesis: {} });
      }

      ttsCall.end();
      await ttsFinished;
      isSpeaking = false;

      const elapsed = Date.now() - startTime;
      console.log(`[AudioSocket] AI+TTS: ${fullText.length} chars, ${elapsed}ms`);

      return parseAIResponse(fullText);

    } catch (err) {
      console.error('[AudioSocket] AI+TTS error:', err.message);
      isSpeaking = false;

      // Fallback: обычный complete() → speak()
      try {
        const response = await aiProvider.complete({
          system: VOICE_OPERATOR_SYSTEM(context),
          messages: [{ role: 'user', content: VOICE_OPERATOR_USER(context) }],
          maxTokens: 400, temperature: 0.3
        });
        const text = typeof response === 'string' ? response : (response.text || response.content || '');
        const parsed = parseAIResponse(text);
        if (parsed && parsed.text) await speak(parsed.text);
        return parsed;
      } catch (e2) {
        console.error('[AudioSocket] Fallback failed:', e2.message);
        return null;
      }
    }
  }

  /* ── Парсер JSON ответа AI ─────────────────────── */
  function parseAIResponse(text) {
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    try {
      const data = JSON.parse(cleaned);
      let routeTo = data.route_to || null;
      if (routeTo && typeof routeTo === 'string') {
        routeTo = routeTo.replace(/[^0-9]/g, '');
        if (routeTo.startsWith('8') && routeTo.length === 11) routeTo = '7' + routeTo.slice(1);
        if (routeTo.length !== 11) routeTo = null;
      }

      return {
        text: String(data.text || '').slice(0, 300),
        action: ['route', 'record', 'hangup', 'continue'].includes(data.action) ? data.action : 'continue',
        route_to: routeTo,
        route_name: data.route_name || null,
        intent: data.intent || 'unknown',
        collected_data: data.collected_data || {},
        reason: data.reason || null
      };
    } catch (_) {
      return { text: cleaned.slice(0, 200), action: 'continue', route_to: null, intent: 'unknown', collected_data: {} };
    }
  }

  /* ── Слушать одно высказывание клиента ──────────── */
  function listenForUtterance(timeoutMs) {
    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; stopSTT(); resolve(null); }
      }, timeoutMs || 12000);

      startSTT((text) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          stopSTT();
          resolve(text);
        }
      });
    });
  }

  /* ══════════════════════════════════════════════════
     ОБРАБОТКА AudioSocket ФРЕЙМОВ
     ══════════════════════════════════════════════════ */

  socket.on('data', (data) => {
    const frames = parser.push(data);

    for (const frame of frames) {
      // UUID — первое сообщение
      if (frame.type === AS_TYPE_UUID) {
        uuid = frame.payload.toString('utf-8').replace(/\0/g, '').trim();
        console.log(`[AudioSocket] Connection: UUID=${uuid}`);
        // Запускаем обработку звонка
        processCall().catch(err => {
          console.error('[AudioSocket] Call error:', err.message);
          cleanup();
        });
      }

      // Аудио → STT (только когда слушаем и AI не говорит)
      if (frame.type === AS_TYPE_AUDIO && sttStream && isListening && !isSpeaking) {
        try { sttStream.write({ chunk: { data: frame.payload } }); } catch (_) {}
      }

      // Hangup
      if (frame.type === AS_TYPE_HANGUP) {
        console.log(`[AudioSocket] Hangup: UUID=${uuid}`);
        notifyCRM('call_end', { caller: callerNumber, uuid, reason: 'hangup' });
        cleanup();
      }
    }
  });

  /* ══════════════════════════════════════════════════
     ГЛАВНАЯ ФУНКЦИЯ ЗВОНКА
     ══════════════════════════════════════════════════ */

  async function processCall() {
    // Определяем CallerID через AMI (UUID от dialplan → Asterisk uniqueid → CallerID)
    if (ami.connected && uuid) {
      const resolved = await ami.resolveByAuuid(uuid);
      callerNumber = resolved.callerNumber;
      channelName = resolved.channelName;
    }
    console.log(`[AudioSocket] Call from: ${callerNumber}, channel: ${channelName}`);

    // Загружаем контекст из CRM (сотрудники, клиент, время и т.д.)
    let context;
    try {
      context = await voiceAgentHelper._buildContext(callerNumber);
      console.log(`[AudioSocket] Context: internal=${context.isInternal}, client=${context.clientName || 'none'}, timeMode=${context.timeMode}`);
    } catch (e) {
      console.error('[AudioSocket] _buildContext FAILED:', e.message);
      // Fallback context
      context = { isInternal: false, clientName: null, timeMode: 'full', isFullWorkHours: true, employeeList: '' };
    }

    notifyCRM('call_start', { caller: callerNumber, uuid, time: new Date().toISOString() });

    // ── Приветствие ──
    console.log('[AudioSocket] Playing greeting...');

    // Сотрудник — персональное приветствие
    if (context.isInternal) {
      const name = (context.internalCaller.display_name || context.internalCaller.name || '').split(' ')[0];
      console.log(`[AudioSocket] Internal call: ${context.internalCaller.name}`);
      notifyCRM('greeting', { caller: callerNumber, internal: true, employee: context.internalCaller.name });
      await speak(`Здравствуйте, ${name}! Куда вас соединить?`);

    // Известный клиент с менеджером в рабочее время — сразу перевод
    } else if (context.clientName && context.responsibleManager && context.isFullWorkHours) {
      notifyCRM('greeting', { caller: callerNumber, client: context.clientName });
      await speak(`Здравствуйте, ${context.clientName}! Компания Асгард Сервис. Сейчас соединю вас с вашим менеджером, ${context.responsibleManager}. Одну минуточку.`);

      // Перевод через AMI
      if (context.managerPhone && ami.connected && channelName) {
        try {
          await ami.redirect(channelName, context.managerPhone);
          notifyCRM('transfer', { caller: callerNumber, name: context.responsibleManager, phone: context.managerPhone });
        } catch (e) {
          console.error('[AudioSocket] Transfer failed:', e.message);
        }
      }
      return;

    // Нерабочее время
    } else if (context.timeMode === 'off') {
      await speak('Здравствуйте! Компания Асгард Сервис. Чем могу помочь?');
      await speak('Сейчас нерабочее время. Наши часы работы — с девяти до восемнадцати, понедельник — пятница. Оставьте сообщение, и мы перезвоним в ближайший рабочий день.');
      notifyCRM('after_hours', { caller: callerNumber });
      // TODO: запись голосового сообщения через AMI Redirect → asgard-voicemail
      return;

    // Стандартное приветствие
    } else {
      notifyCRM('greeting', { caller: callerNumber });
      await speak('Здравствуйте! Компания Асгард Сервис. Чем могу помочь?');
    }

    // ── Цикл диалога ──
    const conversationHistory = [];
    let collectedData = {};
    let lastIntent = 'unknown';

    for (let turn = 0; turn < MAX_TURNS && !destroyed; turn++) {
      // Слушаем клиента
      const clientText = await listenForUtterance(12000);
      if (destroyed) break;

      // Тишина
      if (!clientText) {
        if (turn === 0) { await speak('Алло? Я вас слушаю.'); continue; }
        if (turn <= 1) { await speak('Простите, не расслышал. Подскажите, чем могу помочь?'); continue; }
        await speak('Извините, не слышу вас. Если хотите, перезвоните нам позже. До свидания!');
        break;
      }

      console.log(`[AudioSocket] Client (turn ${turn}): "${clientText}"`);
      conversationHistory.push({ role: 'client', text: clientText });
      notifyCRM('client_speech', { caller: callerNumber, text: clientText, turn });

      // ── AI streaming → TTS streaming ──
      const response = await generateAndSpeak({
        ...context,
        conversationHistory,
        lastClientMessage: clientText
      });

      if (!response) {
        await speak('Секундочку, соединяю вас со специалистом.');
        // Fallback: перевод на первую линию
        const firstLinePhones = voiceAgentHelper._getFirstLinePhones(context.employees);
        if (firstLinePhones[0] && ami.connected && channelName) {
          try { await ami.redirect(channelName, firstLinePhones[0]); } catch (_) {}
        }
        break;
      }

      // Обработка internal_to_customer (сотрудник → клиент)
      if (context.isInternal && response.intent === 'internal_to_customer' && response.action === 'route') {
        const query = (response.collected_data && (response.collected_data.company || response.collected_data.contact_person)) || '';
        if (query && !response.route_to) {
          const customers = await voiceAgentHelper._findCustomerPhone(query);
          if (customers.length === 1) {
            response.route_to = customers[0].phone.replace(/[^0-9]/g, '');
            response.route_name = `${customers[0].contact_person || customers[0].name} (${customers[0].name})`;
            // Произносим кого нашли
            await speakStreaming(`Соединяю с ${response.route_name}. Одну секунду.`);
          } else if (customers.length > 1) {
            const names = customers.map(c => `${c.name} — ${c.contact_person || 'нет контакта'}`).join(', ');
            response.action = 'continue';
            // Ответ уже был произнесён в generateAndSpeak, но переопределяем
            await speakStreaming(`Нашёл несколько: ${names}. Кого именно?`);
          } else {
            response.action = 'continue';
            await speakStreaming(`Не нашёл клиента "${query}" в базе. Уточните название.`);
          }
        }
      }

      // Обновляем данные
      if (response.collected_data) collectedData = { ...collectedData, ...response.collected_data };
      lastIntent = response.intent || lastIntent;

      conversationHistory.push({ role: 'secretary', text: response.text });
      notifyCRM('ai_response', { caller: callerNumber, text: response.text, action: response.action });

      // Действия
      if (response.action === 'route' && response.route_to) {
        console.log(`[AudioSocket] Transfer → ${response.route_name} (${response.route_to})`);
        notifyCRM('transfer', { caller: callerNumber, name: response.route_name, phone: response.route_to });

        if (ami.connected && channelName) {
          try { await ami.redirect(channelName, response.route_to); } catch (e) {
            console.error('[AudioSocket] AMI redirect failed:', e.message);
          }
        }
        return; // канал перенаправлен, AudioSocket закроется автоматически
      }

      if (response.action === 'hangup') break;

      if (response.action === 'record') {
        // TODO: AMI Redirect → asgard-voicemail
        notifyCRM('voicemail', { caller: callerNumber, collected: collectedData });
        break;
      }

      // 'continue' — следующий ход
    }

    notifyCRM('call_end', { caller: callerNumber, uuid, turns: conversationHistory.length });
    cleanup();
  }
}

/* ══════════════════════════════════════════════════════
   ЗАПУСК
   ══════════════════════════════════════════════════════ */

const server = net.createServer(handleConnection);

server.listen(AUDIOSOCKET_PORT, '127.0.0.1', () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ASGARD Voice Agent — AudioSocket Streaming Pipeline`);
  console.log(`  Port: ${AUDIOSOCKET_PORT}`);
  console.log(`  STT:  SpeechKit v3 gRPC streaming (stt.api.cloud.yandex.net)`);
  console.log(`  TTS:  SpeechKit v3 gRPC streaming (dasha/friendly)`);
  console.log(`  AI:   ${process.env.AI_PROVIDER || 'openai'} streaming`);
  console.log(`${'═'.repeat(60)}\n`);
});

// AMI подключение
ami.connect().catch(err => {
  console.warn('[AMI] Not available:', err.message, '— transfers via AMI disabled');
});

// Прогрев кэша TTS (async, не блокирует)
setTimeout(() => warmupPhraseCache(), 2000);

// Graceful shutdown
process.on('SIGTERM', () => { console.log('[AudioSocket] SIGTERM'); server.close(); process.exit(0); });
process.on('SIGINT', () => { console.log('[AudioSocket] SIGINT'); server.close(); process.exit(0); });
server.on('error', (err) => { console.error('[AudioSocket] Server error:', err.message); });
