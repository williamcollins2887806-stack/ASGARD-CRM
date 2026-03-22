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
const VOICE_AI_MODEL = process.env.VOICE_AI_MODEL || 'google/gemini-2.5-flash-lite';
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
          asteriskUniqueId: astId,
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
        asteriskUniqueId: null,
      };
    }
    return { callerNumber: 'unknown', channelName: null, asteriskUniqueId: null };
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

/* ══════════════════════════════════════════════════════
   CACHED INTENTS — кэшированные фразы с вариациями
   Мгновенный ответ без LLM для типовых запросов
   ══════════════════════════════════════════════════════ */

const CACHED_INTENTS = {
  greetings: {
    standard: [
      'Здравствуйте! Компания Асгард Сервис, меня зовут Фрейя. Чем могу помочь?',
      'Добрый день! Асгард Сервис, Фрейя на связи. Слушаю вас!',
      'Здравствуйте! Асгард Сервис. Подскажите, чем могу быть полезна?',
      'Добрый день! Компания Асгард Сервис. Рада вас слышать, чем помочь?',
    ],
    known_client: [
      'Здравствуйте, {name}! Рада снова слышать вас. Чем могу помочь?',
      'Добрый день, {name}! Как ваши дела? Слушаю вас.',
      '{name}, здравствуйте! На связи Фрейя. Чем могу помочь?',
    ],
    after_hours: [
      'Добрый вечер! Компания Асгард Сервис. Сейчас нерабочее время, но я могу записать ваш вопрос и передать специалистам. Они перезвонят в рабочие часы.',
      'Здравствуйте! Асгард Сервис. К сожалению, наши специалисты сейчас недоступны. Оставьте сообщение, и мы обязательно перезвоним.',
      'Добрый вечер! Сейчас офис закрыт, но я запишу ваше обращение. Наши специалисты свяжутся с вами в ближайший рабочий день.',
    ],
  },
  route_tender: [
    'Соединяю вас с тендерным отделом, с Хосе Александром. Одну секунду.',
    'Сейчас переведу на тендерный отдел. Хосе Александр вам поможет.',
    'Переключаю на Хосе Александра, он у нас отвечает за тендеры. Минуточку!',
  ],
  route_accounting: [
    'Соединяю вас с бухгалтерией. Одну минуту.',
    'Сейчас переведу на бухгалтерию, подождите секундочку.',
    'Переключаю на бухгалтерию. Не кладите трубку.',
  ],
  route_procurement: [
    'Соединяю с отделом закупок. Секундочку.',
    'Переключаю вас на отдел снабжения. Одну минуту.',
  ],
  refuse_director: [
    'К сожалению, руководство не принимает звонки напрямую. Но я обязательно передам вашу информацию. Подскажите, по какому вопросу вы звоните?',
    'Прямое соединение с руководством не предусмотрено, но я помогу разобраться с вашим вопросом. Расскажите подробнее?',
    'Руководство сейчас недоступно для звонков. Давайте я запишу ваш вопрос и передам, или может быть я смогу помочь?',
  ],
  silence_first: [
    'Алло? Слушаю вас!',
    'Алло, вы на связи?',
    'Алло? Я вас слушаю.',
  ],
  silence_second: [
    'Простите, не расслышала. Подскажите, чем могу помочь?',
    'Извините, плохо слышно. Повторите, пожалуйста?',
    'Не могу вас расслышать. Скажите ещё раз, пожалуйста.',
  ],
  silence_hangup: [
    'К сожалению, не слышу вас. Перезвоните, пожалуйста, когда будет удобно. До свидания!',
    'Видимо, связь прервалась. Перезвоните нам по номеру четыре девять девять, три два два, тридцать, шестьдесят два. До свидания!',
  ],
  spam: [
    'Спасибо, нам это не требуется. Всего доброго!',
    'Благодарю за предложение, но мы не заинтересованы. До свидания!',
    'Спасибо, не актуально. Хорошего дня!',
  ],
  route_specialist: [
    'Секундочку, соединю вас со специалистом.',
    'Одну минуту, переключаю на специалиста, который поможет.',
    'Сейчас переведу вас на нужного специалиста. Не кладите трубку.',
  ],
  record_message: [
    'Оставьте, пожалуйста, ваше имя, номер телефона и коротко суть вопроса. Мы перезвоним.',
    'Запишу ваше обращение. Назовите имя, контактный телефон и по какому вопросу звоните.',
  ],
  goodbye: [
    'Рада была помочь! Обращайтесь, если будут вопросы. До свидания!',
    'Всего доброго! Будем рады видеть вас среди наших клиентов.',
    'Спасибо за звонок! Хорошего дня!',
    'До свидания! Если что — звоните, мы всегда на связи.',
  ],
  // Подтверждение перевода
  confirm_tender: [
    'Соединяю с Хосе Александром из тендерного отдела, верно?',
    'Переключить на тендерный отдел, к Хосе Александру?',
  ],
  confirm_accounting: [
    'Переключить на бухгалтерию?',
    'Соединить с бухгалтерией, верно?',
  ],
  confirm_procurement: [
    'Переключить на отдел закупок?',
    'Соединить с отделом снабжения?',
  ],
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fillTemplate(text, vars) {
  let result = text;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), val || '');
  }
  return result;
}

/* ══════════════════════════════════════════════════════
   INTENT DETECTION — быстрое определение без LLM
   ══════════════════════════════════════════════════════ */

/**
 * Быстрое определение intent без LLM.
 * Возвращает { intent, response, action, route_to, route_name } или null если нужен LLM.
 * pendingRoute используется для подтверждения перевода.
 */
function detectIntentByKeywords(text, context, pendingRoute) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // ── Подтверждение ожидающего перевода ──
  if (pendingRoute) {
    if (/да|верно|соединяй|переключай|конечно|давай|ага|угу|точно/i.test(lower)) {
      return {
        intent: pendingRoute.intent,
        response: pickRandom(CACHED_INTENTS['route_' + pendingRoute.department] || CACHED_INTENTS.route_specialist),
        action: 'route',
        route_to: pendingRoute.route_to,
        route_name: pendingRoute.route_name,
      };
    }
    if (/нет|не надо|не нужно|отмен|другой|другое/i.test(lower)) {
      return {
        intent: 'cancel_route',
        response: 'Хорошо, не переключаю. Чем ещё могу помочь?',
        action: 'continue',
        route_to: null,
        route_name: null,
      };
    }
    // Непонятный ответ — пусть LLM разберётся
    return null;
  }

  // ── ДИРЕКТОРА — отказ (только для внешних) ──
  if (!context.isInternal && /директор|руководител|руководств|генеральн|коммерческ|кудряшов|гажилиев|сторожев/i.test(lower)) {
    return {
      intent: 'refuse_director',
      response: pickRandom(CACHED_INTENTS.refuse_director),
      action: 'continue',
      route_to: null,
      route_name: null,
    };
  }

  // ── ТЕНДЕР / КОНКУРС — подтверждение ──
  if (/тендер|конкурс|аукцион|котировк|запрос.+предложен|торг/i.test(lower)) {
    const hose = (context.employees || []).find(e => /хосе|jose/i.test(e.name || e.display_name || ''));
    const phone = hose ? (hose.fallback_mobile || '').replace(/[^0-9]/g, '') : null;
    return {
      intent: 'tender',
      response: pickRandom(CACHED_INTENTS.confirm_tender),
      action: 'continue',
      route_to: null,
      route_name: null,
      _pendingRoute: { intent: 'tender', department: 'tender', route_to: phone, route_name: 'Хосе Александр' },
    };
  }

  // ── БУХГАЛТЕРИЯ — подтверждение ──
  if (/бухгалтер|бухгалтери|счёт|счет|акт.+сверк|налогов|ндс|платёж|оплат/i.test(lower)) {
    if (/предлага|услуг|аутсорс/i.test(lower)) return null;
    const buh = (context.employees || []).find(e => e.role === 'BUH' && e.fallback_mobile);
    const phone = buh ? buh.fallback_mobile.replace(/[^0-9]/g, '') : null;
    return {
      intent: 'accounting',
      response: pickRandom(CACHED_INTENTS.confirm_accounting),
      action: 'continue',
      route_to: null,
      route_name: null,
      _pendingRoute: { intent: 'accounting', department: 'accounting', route_to: phone, route_name: buh ? (buh.display_name || buh.name) : 'бухгалтерия' },
    };
  }

  // ── ЗАКУПКИ / СНАБЖЕНИЕ — подтверждение ──
  if (/закупк|снабжен|отдел.+закуп|поставщик/i.test(lower) && !/тендер/i.test(lower)) {
    const proc = (context.employees || []).find(e => e.role === 'PROC' && e.fallback_mobile);
    const phone = proc ? proc.fallback_mobile.replace(/[^0-9]/g, '') : null;
    return {
      intent: 'procurement',
      response: pickRandom(CACHED_INTENTS.confirm_procurement),
      action: 'continue',
      route_to: null,
      route_name: null,
      _pendingRoute: { intent: 'procurement', department: 'procurement', route_to: phone, route_name: proc ? (proc.display_name || proc.name) : 'отдел закупок' },
    };
  }

  // ── ЯВНЫЙ СПАМ ──
  if (/реклам|продвижен|seo|сео|кредит|лизинг|тренинг|вебинар|опрос|автоинформатор/i.test(lower)) {
    if (/очист|промыв|ремонт|теплообменник|котёл|котел|трубопровод/i.test(lower)) return null;
    return {
      intent: 'spam',
      response: pickRandom(CACHED_INTENTS.spam),
      action: 'hangup',
      route_to: null,
      route_name: null,
    };
  }

  // ── ПЕРЕВОД НА КОНКРЕТНОГО ЧЕЛОВЕКА ПО ИМЕНИ — сразу route ──
  if (/соедин|переведи|переключи|перевод|связ|позови|позвать/i.test(lower)) {
    for (const emp of (context.employees || [])) {
      const empName = (emp.display_name || emp.name || '').toLowerCase();
      const nameParts = empName.split(/\s+/);
      for (const part of nameParts) {
        if (part.length >= 3 && lower.includes(part)) {
          const phone = (emp.fallback_mobile || '').replace(/[^0-9]/g, '');
          if (phone && phone.length === 11) {
            return {
              intent: 'transfer_request',
              response: `Конечно, соединяю вас с ${emp.display_name || emp.name}. Одну секунду.`,
              action: 'route',
              route_to: phone,
              route_name: emp.display_name || emp.name,
            };
          }
        }
      }
    }
    return null;
  }

  // ── КАРЬЕРА / ВАКАНСИИ ──
  if (/вакансия|работа.+у.+вас|трудоустро|резюме|собеседован/i.test(lower)) {
    return {
      intent: 'career',
      response: 'Вакансии можно посмотреть на нашем сайте: асгард-сервис точка ком, раздел Карьера. Если хотите, я могу переключить на отдел кадров.',
      action: 'continue',
      route_to: null,
      route_name: null,
    };
  }

  return null;
}

/* ══════════════════════════════════════════════════════
   YandexGPT Lite + Claude Haiku Direct (streaming)
   ══════════════════════════════════════════════════════ */

const YANDEX_GPT_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

async function* callYandexGPTStream(systemPrompt, userMessage) {
  const folderId = process.env.YANDEX_SPEECHKIT_FOLDER_ID || process.env.YANDEX_FOLDER_ID || '';
  const apiKey = process.env.YANDEX_SPEECHKIT_API_KEY || '';
  if (!folderId || !apiKey) throw new Error('Yandex credentials not configured');

  const body = JSON.stringify({
    modelUri: `gpt://${folderId}/yandexgpt-lite/latest`,
    completionOptions: {
      stream: true,
      temperature: 0.3,
      maxTokens: '300'
    },
    messages: [
      { role: 'system', text: systemPrompt },
      { role: 'user', text: userMessage }
    ]
  });

  const response = await fetch(YANDEX_GPT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Api-Key ${apiKey}`,
      'x-folder-id': folderId
    },
    body
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`YandexGPT ${response.status}: ${errText.slice(0, 200)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let prevText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        const alts = data.result && data.result.alternatives;
        if (alts && alts.length > 0 && alts[0].message && alts[0].message.text) {
          const fullText = alts[0].message.text;
          if (fullText.length > prevText.length) {
            const delta = fullText.slice(prevText.length);
            prevText = fullText;
            yield { type: 'text', content: delta };
          }
          if (alts[0].status === 'ALTERNATIVE_STATUS_FINAL') {
            yield { type: 'done' };
            return;
          }
        }
      } catch (e) { /* skip malformed */ }
    }
  }
  yield { type: 'done' };
}

async function* callClaudeHaikuStream(systemPrompt, userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2024-10-22'
    },
    body: JSON.stringify({
      model: process.env.VOICE_AI_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      temperature: 0.3,
      stream: true,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude ${response.status}: ${errText.slice(0, 200)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        const event = JSON.parse(jsonStr);
        if (event.type === 'content_block_delta' && event.delta && event.delta.text) {
          yield { type: 'text', content: event.delta.text };
        }
        if (event.type === 'message_delta') {
          yield { type: 'done' };
          return;
        }
      } catch (e) { /* skip */ }
    }
  }
  yield { type: 'done' };
}

/* ── Кэш фраз (pre-synthesized PCM) ─────────────────── */
const phraseCache = new Map();

async function warmupPhraseCache() {
  console.log('[AudioSocket] Warming up phrase cache with all variants...');
  let cached = 0, total = 0;

  const allPhrases = new Set();
  function addPhrases(obj) {
    if (Array.isArray(obj)) {
      obj.forEach(p => allPhrases.add(p));
    } else if (typeof obj === 'object' && obj !== null) {
      Object.values(obj).forEach(v => addPhrases(v));
    }
  }
  addPhrases(CACHED_INTENTS);
  total = allPhrases.size;

  for (const phrase of allPhrases) {
    if (phrase.includes('{')) continue; // шаблоны кэшируются при первом использовании
    try {
      const pcm = await synthesizeToPCM(phrase);
      if (pcm && pcm.length > 0) { phraseCache.set(phrase, pcm); cached++; }
    } catch (e) {
      console.warn('[AudioSocket] Cache failed:', phrase.slice(0, 30), e.message);
    }
  }

  console.log(`[AudioSocket] Phrase cache ready: ${cached}/${total} phrases`);
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
  let asteriskUniqueId = null;
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

  socket.setNoDelay(true); // Disable Nagle — send frames immediately
  socket.on('error', (e) => { console.error('[AudioSocket] Socket error:', e.message); cleanup(); });
  socket.on('close', () => cleanup());

  /* ── Отправить PCM в AudioSocket (paced, 20ms per frame) ── */
  function sendAudio(pcmBuffer) {
    return new Promise((resolve) => {
      if (destroyed || !socket.writable) {
        console.log(`[AudioSocket] sendAudio: skip (destroyed=${destroyed}, writable=${socket.writable})`);
        return resolve();
      }
      const CHUNK_SIZE = 320; // 20ms @ 8kHz slin16
      let offset = 0;
      let framesSent = 0;

      function sendNext() {
        if (offset >= pcmBuffer.length || destroyed || !socket.writable) {
          console.log(`[AudioSocket] sendAudio: done, ${framesSent} frames sent`);
          return resolve();
        }
        const chunk = pcmBuffer.slice(offset, Math.min(offset + CHUNK_SIZE, pcmBuffer.length));
        try {
          socket.write(makeAudioFrame(chunk));
          framesSent++;
        } catch (e) {
          console.error('[AudioSocket] sendAudio write error:', e.message);
          return resolve();
        }
        offset += CHUNK_SIZE;
        setTimeout(sendNext, 20);
      }
      sendNext();
    });
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
    await sendAudio(pcm);
    // Small buffer after playback
    await new Promise(r => setTimeout(r, 200));
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

    let finalSent = false; // дедупликация: eouUpdate и finalRefinement могут прийти оба
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
        if (text && !finalSent) { finalSent = true; onFinal(text); }
      }

      // FinalRefinement — нормализованный текст (более точный)
      if (response.finalRefinement) {
        const alts = response.finalRefinement.normalizedText &&
          response.finalRefinement.normalizedText.alternatives;
        if (alts && alts.length > 0 && alts[0].text) {
          const text = alts[0].text.trim();
          currentPartialText = '';
          if (text && !finalSent) { finalSent = true; onFinal(text); }
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

  /* ── AI streaming → TTS streaming pipeline (text-first) ── */
  /*
   * Формат ответа AI:
   *   Текст для озвучки (plain text)
   *   ---JSON---
   *   {"action":"route","route_to":"7916...","intent":"tender"}
   *
   * Стримим AI токены → как только набирается предложение → отправляем в TTS.
   * После ---JSON--- прекращаем TTS, парсим JSON метаданные.
   * Результат: первый звук через ~0.5с (AI first_token + TTS first_audio).
   */
  async function generateAndSpeak(context) {
    const systemPrompt = VOICE_OPERATOR_SYSTEM(context);
    const userPrompt = VOICE_OPERATOR_USER(context);
    const t0 = Date.now();

    try {
      // ═══ Каскад AI провайдеров: YandexGPT Lite → Claude Haiku → aiProvider ═══
      const voiceProvider = process.env.VOICE_AI_PROVIDER || 'yandexgpt';
      let streamParser;

      try {
        if (voiceProvider === 'yandexgpt') {
          console.log('[AudioSocket] AI: YandexGPT Lite');
          streamParser = callYandexGPTStream(systemPrompt, userPrompt);
        } else if (voiceProvider === 'claude') {
          console.log('[AudioSocket] AI: Claude Haiku Direct');
          streamParser = callClaudeHaikuStream(systemPrompt, userPrompt);
        } else {
          console.log('[AudioSocket] AI: aiProvider (' + VOICE_AI_MODEL + ')');
          const streamResponse = await aiProvider.stream({
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
            maxTokens: 300, temperature: 0.3, model: VOICE_AI_MODEL
          });
          streamParser = aiProvider.parseStream(streamResponse);
        }
      } catch (primaryErr) {
        console.warn(`[AudioSocket] Primary AI (${voiceProvider}) failed:`, primaryErr.message);
        try {
          if (voiceProvider === 'yandexgpt') {
            console.log('[AudioSocket] Fallback: Claude Haiku Direct');
            streamParser = callClaudeHaikuStream(systemPrompt, userPrompt);
          } else {
            console.log('[AudioSocket] Fallback: aiProvider (routerai)');
            const streamResponse = await aiProvider.stream({
              system: systemPrompt,
              messages: [{ role: 'user', content: userPrompt }],
              maxTokens: 300, temperature: 0.3, model: VOICE_AI_MODEL
            });
            streamParser = aiProvider.parseStream(streamResponse);
          }
        } catch (fallbackErr) {
          console.error('[AudioSocket] All AI providers failed:', fallbackErr.message);
          isSpeaking = false;
          return null;
        }
      }

      // ── Аккумуляторы ──
      let fullOutput = '';        // всё что прислал AI
      let textPart = '';          // текст для озвучки (до ---JSON---)
      let jsonPart = '';          // JSON метаданные (после ---JSON---)
      let hitJsonSeparator = false;
      let sentenceBuf = '';       // буфер текущего предложения для TTS
      let firstTokenTime = 0;

      // ── TTS StreamSynthesis (bidirectional) ──
      isSpeaking = true;
      const ttsCall = ttsSynthesizer.streamSynthesis(grpcMetadata());
      let ttsOptionsWritten = false;
      let firstAudioTime = 0;
      let totalAudioBytes = 0;
      let ttsDone = false;

      // Слушаем аудио от TTS → сразу в AudioSocket
      const ttsFinished = new Promise((resolve) => {
        ttsCall.on('data', (r) => {
          if (r.audioChunk && r.audioChunk.data && !destroyed && socket.writable) {
            if (!firstAudioTime) firstAudioTime = Date.now();
            const buf = Buffer.from(r.audioChunk.data);
            totalAudioBytes += buf.length;
            const CHUNK_SIZE = 320;
            for (let i = 0; i < buf.length; i += CHUNK_SIZE) {
              const chunk = buf.slice(i, Math.min(i + CHUNK_SIZE, buf.length));
              try { socket.write(makeAudioFrame(chunk)); } catch (_) { break; }
            }
          }
        });
        ttsCall.on('end', () => { ttsDone = true; resolve(); });
        ttsCall.on('error', (err) => {
          console.error('[AudioSocket] TTS stream error:', err.message);
          ttsDone = true;
          resolve();
        });
        setTimeout(() => { if (!ttsDone) resolve(); }, 20000);
      });

      // Функция: отправить предложение в TTS
      function flushSentenceToTTS(sentence) {
        if (!sentence.trim() || destroyed) return;
        if (!ttsOptionsWritten) {
          ttsCall.write({
            options: {
              voice: process.env.TTS_VOICE || 'dasha',
              role: process.env.TTS_ROLE || 'friendly',
              speed: 1.0,
              outputAudioSpec: {
                rawAudio: { audioEncoding: 'LINEAR16_PCM', sampleRateHertz: 8000 }
              },
              loudnessNormalizationType: 'LUFS'
            }
          });
          ttsOptionsWritten = true;
        }
        ttsCall.write({ synthesisInput: { text: sentence.trim() } });
        ttsCall.write({ forceSynthesis: {} });
      }

      // ── Основной цикл: читаем AI токены ──
      for await (const event of streamParser) {
        if (event.type === 'text') {
          if (!firstTokenTime) firstTokenTime = Date.now();
          const chunk = event.content;
          fullOutput += chunk;

          if (hitJsonSeparator) {
            // Уже после ---JSON--- → копим JSON
            jsonPart += chunk;
          } else {
            // Проверяем: не появился ли разделитель?
            const sepIdx = fullOutput.indexOf('---JSON---');
            if (sepIdx !== -1) {
              hitJsonSeparator = true;
              // Текст = всё до разделителя
              textPart = fullOutput.slice(0, sepIdx).trim();
              // JSON = всё после разделителя + \n
              jsonPart = fullOutput.slice(sepIdx + 10).trim();

              // Отправляем остаток текста в TTS
              const remaining = textPart.slice(textPart.length - sentenceBuf.length);
              // sentenceBuf может содержать часть, пересчитаем
              // Просто отправим весь оставшийся sentenceBuf
              if (sentenceBuf.trim()) {
                flushSentenceToTTS(sentenceBuf);
                sentenceBuf = '';
              }
              // Закрываем TTS вход
              try { ttsCall.end(); } catch (_) {}
            } else {
              // Ещё текст для озвучки — копим по предложениям
              sentenceBuf += chunk;
              // Агрессивный flush: запятая/точка/5+ слов
              const shouldFlush =
                (/[.!?,;:…]\s*$/.test(sentenceBuf) && sentenceBuf.trim().length > 5) ||
                (sentenceBuf.split(/\s+/).length >= 5);
              if (shouldFlush) {
                flushSentenceToTTS(sentenceBuf);
                sentenceBuf = '';
              }
            }
          }
        }
        if (event.type === 'done' || event.type === 'error') break;
      }

      const aiMs = Date.now() - t0;
      const firstTokenMs = firstTokenTime ? firstTokenTime - t0 : aiMs;

      // Если разделитель не найден — fallback: весь текст = plain text
      if (!hitJsonSeparator) {
        textPart = fullOutput.trim();
        jsonPart = '';
        // Отправляем остаток буфера
        if (sentenceBuf.trim()) flushSentenceToTTS(sentenceBuf);
        try { ttsCall.end(); } catch (_) {}
      }

      console.log(`[AudioSocket] AI: ${fullOutput.length} chars, text=${textPart.length}, json=${jsonPart.length}, total=${aiMs}ms, first_token=${firstTokenMs}ms`);

      // Ждём завершения TTS
      await ttsFinished;

      const ttsMs = firstAudioTime ? Date.now() - firstAudioTime : 0;
      const firstAudioMs = firstAudioTime ? firstAudioTime - t0 : 0;

      // Ждём пока аудио доиграет
      if (totalAudioBytes > 0) {
        const audioDurationMs = (totalAudioBytes / 2 / 8000) * 1000;
        const elapsed = Date.now() - (firstAudioTime || t0);
        if (audioDurationMs > elapsed) {
          await new Promise(r => setTimeout(r, audioDurationMs - elapsed + 100));
        }
      }

      isSpeaking = false;

      const totalMs = Date.now() - t0;
      console.log(`[AudioSocket] TTS: "${textPart.slice(0, 50)}..." ${totalAudioBytes}b`);
      console.log(`[AudioSocket] TIMING: first_token=${firstTokenMs}ms, first_audio=${firstAudioMs}ms, AI=${aiMs}ms, total=${totalMs}ms`);

      // Парсим JSON часть
      const parsed = parseAIResponse(textPart, jsonPart);
      return parsed;

    } catch (err) {
      console.error('[AudioSocket] AI+TTS error:', err.message);
      isSpeaking = false;

      // Fallback: обычный complete() → speak()
      try {
        console.log('[AudioSocket] Fallback: using complete()...');
        const response = await aiProvider.complete({
          system: VOICE_OPERATOR_SYSTEM(context),
          messages: [{ role: 'user', content: VOICE_OPERATOR_USER(context) }],
          maxTokens: 500, temperature: 0.3
        });
        const text = typeof response === 'string' ? response : (response.text || response.content || '');
        const parsed = parseAIResponse(text, '');
        if (parsed && parsed.text) await speak(parsed.text);
        return parsed;
      } catch (e2) {
        console.error('[AudioSocket] Fallback failed:', e2.message);
        return null;
      }
    }
  }

  /* ── Парсер ответа AI (text-first формат) ──────── */
  /*
   * Новый формат: textPart (plain text) + jsonPart (JSON метаданные)
   * Старый формат (чистый JSON) — тоже поддерживается как fallback
   */
  function parseAIResponse(textPart, jsonPart) {
    const spokenText = (textPart || '').trim().slice(0, 300);

    // Пробуем парсить JSON-часть
    if (jsonPart && jsonPart.trim()) {
      let cleaned = jsonPart.trim();
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
          text: spokenText || String(data.text || '').slice(0, 300),
          action: ['route', 'record', 'hangup', 'continue'].includes(data.action) ? data.action : 'continue',
          route_to: routeTo,
          route_name: data.route_name || null,
          intent: data.intent || 'unknown',
          collected_data: data.collected_data || {},
          reason: data.reason || null
        };
      } catch (_) {
        console.warn('[AudioSocket] JSON parse failed, raw:', cleaned.slice(0, 100));
      }
    }

    // Fallback: может весь textPart — это старый JSON формат?
    if (!jsonPart && spokenText.startsWith('{')) {
      try {
        let cleaned = spokenText;
        if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
        if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
        const data = JSON.parse(cleaned.trim());
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
      } catch (_) {}
    }

    // Текст есть, JSON нет — считаем action=continue
    return {
      text: spokenText || '(нет ответа)',
      action: 'continue',
      route_to: null,
      route_name: null,
      intent: 'unknown',
      collected_data: {},
      reason: null
    };
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
        const recPath = asteriskUniqueId ? `/var/spool/asterisk/recordings/${asteriskUniqueId}.wav` : null;
        notifyCRM('call_end', { caller: callerNumber, uuid, reason: 'hangup', recordingPath: recPath });
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
      asteriskUniqueId = resolved.asteriskUniqueId;
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

    // ── Приветствие Фрейи ──
    console.log('[AudioSocket] Playing Freya greeting...');

    // Сотрудник — персональное приветствие в стиле Асгарда
    if (context.isInternal) {
      const fullName = context.internalCaller.name || '';
      const parts = fullName.trim().split(/\s+/);
      const firstName = parts.length >= 2 ? parts[1] : (parts[0] || 'воин');
      console.log(`[AudioSocket] Internal call: ${fullName} → firstName: ${firstName}`);
      const greetings = [
        `Приветствую, воин Асга+рда ${firstName}! Чем могу помочь?`,
        `Хе+й, ${firstName}! Рада слышать тебя, воин! Куда тебя направить?`,
        `Славься, ${firstName}! Какой путь тебе указать сегодня?`,
        `${firstName}, приветствую тебя в чертогах Асга+рда! Чем помочь?`,
      ];
      const greetingText = greetings[Math.floor(Math.random() * greetings.length)];
      notifyCRM('greeting', { caller: callerNumber, internal: true, employee: fullName, text: greetingText });
      await speak(greetingText);

    // Известный клиент с менеджером в рабочее время — сразу перевод
    } else if (context.clientName && context.responsibleManager && context.isFullWorkHours) {
      const greeting = fillTemplate(pickRandom(CACHED_INTENTS.greetings.known_client), { name: context.clientName });
      const transferMsg = `Сейчас соединю вас с вашим менеджером, ${context.responsibleManager}. Одну минуточку.`;
      notifyCRM('greeting', { caller: callerNumber, client: context.clientName, text: greeting });
      await speak(greeting);
      notifyCRM('ai_response', { caller: callerNumber, text: transferMsg, action: 'route', intent: 'known_client' });
      await speak(transferMsg);

      if (context.managerPhone && ami.connected && channelName) {
        try {
          console.log(`[AudioSocket] AMI redirect: channel=${channelName} → phone=${context.managerPhone} (${context.responsibleManager})`);
          await ami.redirect(channelName, context.managerPhone);
          notifyCRM('transfer', { caller: callerNumber, name: context.responsibleManager, phone: context.managerPhone });
        } catch (e) {
          console.error(`[AudioSocket] AMI redirect FAILED: channel=${channelName}, phone=${context.managerPhone}, error=${e.message}`);
          notifyCRM('transfer_failed', { caller: callerNumber, name: context.responsibleManager, phone: context.managerPhone, error: e.message });
        }
      }
      return;

    // Нерабочее время
    } else if (context.timeMode === 'off') {
      const afterHoursText = pickRandom(CACHED_INTENTS.greetings.after_hours);
      notifyCRM('greeting', { caller: callerNumber, text: afterHoursText });
      await speak(afterHoursText);
      notifyCRM('after_hours', { caller: callerNumber });
      return;

    // Стандартное приветствие
    } else {
      const stdGreeting = pickRandom(CACHED_INTENTS.greetings.standard);
      notifyCRM('greeting', { caller: callerNumber, text: stdGreeting });
      await speak(stdGreeting);
    }

    // ── Цикл диалога ──
    const conversationHistory = [];
    let collectedData = {};
    let lastIntent = 'unknown';
    let pendingRoute = null; // для подтверждения перевода

    for (let turn = 0; turn < MAX_TURNS && !destroyed; turn++) {
      // Слушаем клиента
      const clientText = await listenForUtterance(12000);
      if (destroyed) break;

      // Тишина
      if (!clientText) {
        if (turn === 0) { await speak(pickRandom(CACHED_INTENTS.silence_first)); continue; }
        if (turn <= 1) { await speak(pickRandom(CACHED_INTENTS.silence_second)); continue; }
        await speak(pickRandom(CACHED_INTENTS.silence_hangup));
        break;
      }

      console.log(`[AudioSocket] Client (turn ${turn}): "${clientText}"`);
      conversationHistory.push({ role: 'client', text: clientText });
      notifyCRM('client_speech', { caller: callerNumber, text: clientText, turn });

      // ═══ БЫСТРЫЙ INTENT DETECTION (0ms AI) ═══
      const quickIntent = detectIntentByKeywords(clientText, context, pendingRoute);
      if (quickIntent) {
        console.log(`[AudioSocket] Quick intent: ${quickIntent.intent} (no LLM needed)`);
        await speak(quickIntent.response);
        conversationHistory.push({ role: 'secretary', text: quickIntent.response });
        notifyCRM('ai_response', { caller: callerNumber, text: quickIntent.response, action: quickIntent.action, intent: quickIntent.intent });

        // Сохранить pending route для подтверждения
        if (quickIntent._pendingRoute) {
          pendingRoute = quickIntent._pendingRoute;
        } else {
          pendingRoute = null;
        }

        if (quickIntent.action === 'route' && quickIntent.route_to) {
          notifyCRM('transfer', { caller: callerNumber, name: quickIntent.route_name, phone: quickIntent.route_to });
          if (ami.connected && channelName) {
            try { await ami.redirect(channelName, quickIntent.route_to); } catch (e) {
              console.error('[AudioSocket] AMI redirect failed:', e.message);
            }
          }
          return;
        }
        if (quickIntent.action === 'hangup') break;
        continue; // action === 'continue' → следующий ход
      }
      pendingRoute = null; // сбросить если LLM отвечает

      // ═══ LLM (YandexGPT Lite → Claude Haiku fallback) ═══
      const response = await generateAndSpeak({
        ...context,
        conversationHistory,
        lastClientMessage: clientText
      });

      if (!response) {
        await speak(pickRandom(CACHED_INTENTS.route_specialist));
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

    const recPath = asteriskUniqueId ? `/var/spool/asterisk/recordings/${asteriskUniqueId}.wav` : null;
    notifyCRM('call_end', { caller: callerNumber, uuid, turns: conversationHistory.length, recordingPath: recPath });
    cleanup();
  }
}

/* ══════════════════════════════════════════════════════
   ЗАПУСК
   ══════════════════════════════════════════════════════ */

const server = net.createServer(handleConnection);

server.listen(AUDIOSOCKET_PORT, '127.0.0.1', () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ASGARD Freya — Voice AI Secretary`);
  console.log(`  Port: ${AUDIOSOCKET_PORT}`);
  console.log(`  STT:  SpeechKit v3 gRPC streaming`);
  console.log(`  TTS:  SpeechKit v3 gRPC streaming (dasha/friendly)`);
  console.log(`  AI:   ${process.env.VOICE_AI_PROVIDER || 'yandexgpt'} (primary) → Claude Haiku (fallback)`);
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
