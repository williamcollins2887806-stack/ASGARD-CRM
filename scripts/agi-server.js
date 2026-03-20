#!/usr/bin/env node
'use strict';

/**
 * ASGARD CRM — Asterisk AGI Voice Agent Server
 *
 * AI-оператор первой линии. Отвечает на ВСЕ входящие звонки,
 * ведёт диалог, маршрутизирует на сотрудников через SIP-транк.
 *
 * Запуск: node scripts/agi-server.js
 * Asterisk: AGI(agi://127.0.0.1:4573/incoming)
 */

const net = require('net');
const path = require('path');
const fs = require('fs');

/* ── Load .env ──────────────────────────────────────────────── */
const CRM_ROOT = path.resolve(__dirname, '..');
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
} catch (e) {
  console.error('[AGI] Warning: .env not loaded:', e.message);
}

/* ── Database ───────────────────────────────────────────────── */
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm',
  user: process.env.DB_USER || 'asgard_user',
  password: process.env.DB_PASSWORD || '',
  max: 5,
});
const db = { query: (text, params) => pool.query(text, params) };

/* ── Notify CRM (HTTP POST for live monitoring) ──────────────── */
const http = require('http');

function notifyCRM(type, data) {
  const payload = JSON.stringify({ type, ...data, timestamp: Date.now() });
  const req = http.request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/telephony/internal/agi-event',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    timeout: 3000
  }, (res) => {
    res.resume(); // drain
  });
  req.on('error', (e) => {
    if (e.code !== 'ECONNREFUSED') console.error('[AGI] CRM notify error:', e.message);
  });
  req.write(payload);
  req.end();
}

/* ── Services ───────────────────────────────────────────────── */
const SpeechKitService = require(path.join(CRM_ROOT, 'src/services/speechkit'));
const VoiceAgent = require(path.join(CRM_ROOT, 'src/services/voice-agent'));

// AI Provider — используем тот же что и CRM
let aiProvider;
try {
  aiProvider = require(path.join(CRM_ROOT, 'src/services/ai-provider'));
  console.log('[AGI] AI Provider loaded, complete:', typeof aiProvider.complete);
} catch (e) {
  // Fallback: простой Claude API клиент
  const https = require('https');
  aiProvider = {
    complete: async ({ system, messages, maxTokens, temperature }) => {
      return new Promise((resolve, reject) => {
        const body = JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: maxTokens || 400,
          temperature: temperature || 0.3,
          system: system,
          messages: messages
        });
        const req = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          }
        }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (res.statusCode >= 400) return reject(new Error(data));
              resolve(parsed.content[0].text);
            } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    }
  };
}

const speechKit = new SpeechKitService(
  process.env.YANDEX_SPEECHKIT_API_KEY,
  process.env.YANDEX_SPEECHKIT_FOLDER_ID || process.env.YANDEX_FOLDER_ID
);

const voiceAgent = new VoiceAgent(speechKit, aiProvider, db);

// Прогрев кэша TTS при старте сервера
setTimeout(() => {
  voiceAgent.warmupCache().catch(e => console.warn('[AGI] Cache warmup error:', e.message));
}, 3000); // Через 3 сек после старта, чтобы не замедлять инициализацию

// Wire live events to CRM
voiceAgent.onEvent = (type, data) => {
  notifyCRM(type, { ...data, caller: voiceAgent._currentCaller || 'unknown' });
};

/* ── Constants ──────────────────────────────────────────────── */
const AGI_PORT = parseInt(process.env.AGI_PORT || '4573', 10);
const SIP_TRUNK = 'mango-trunk';
const TRANSFER_TIMEOUT = 25;

/* ── AGI Session ────────────────────────────────────────────── */
class AGISession {
  constructor(socket) {
    this.socket = socket;
    this.vars = {};
    this.buffer = '';
    this.closed = false;
  }

  parseVars(data) {
    return new Promise((resolve) => {
      this.buffer += data;
      const lines = this.buffer.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') {
          this.buffer = '';
          return resolve(this.vars);
        }
        const match = trimmed.match(/^agi_(\w+):\s*(.*)$/);
        if (match) this.vars[match[1]] = match[2];
      }
      this.socket.once('data', (more) => {
        this.buffer += more.toString();
        this.parseVars('').then(resolve);
      });
    });
  }

  command(cmd) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Session closed'));
      this.socket.write(cmd + '\n');
      const onData = (data) => {
        const response = data.toString().trim();
        const match = response.match(/^(\d+)\s+result=(-?\d+)(?:\s+\((.+)\))?/);
        if (match) {
          resolve({ code: parseInt(match[1]), result: parseInt(match[2]), data: match[3] || null });
        } else {
          resolve({ code: 200, result: 0, data: response });
        }
      };
      this.socket.once('data', onData);
      setTimeout(() => {
        this.socket.removeListener('data', onData);
        reject(new Error('AGI command timeout'));
      }, 15000);
    });
  }

  async answer() { return this.command('ANSWER'); }

  async hangup() {
    this.closed = true;
    return this.command('HANGUP').catch(() => {});
  }

  async streamFile(filename) {
    return this.command(`STREAM FILE "${filename}" ""`);
  }

  async recordFile(filename, format, escapeDigits, timeout, offsetSamples, beep, silence) {
    const beepStr = beep ? 'BEEP' : '';
    return this.command(`RECORD FILE "${filename}" "${format}" "${escapeDigits || '#'}" ${timeout || 12000} ${offsetSamples || 0} ${beepStr} s=${silence || 3}`);
  }

  async exec(app, args) {
    return this.command(`EXEC ${app} ${args || ''}`);
  }

  async getVariable(name) {
    const res = await this.command(`GET VARIABLE ${name}`);
    return res.data;
  }

  async setVariable(name, value) {
    return this.command(`SET VARIABLE ${name} "${value}"`);
  }

  /**
   * Перевод звонка через SIP-транк на мобильный номер
   */
  async dialMobile(phoneNumber, timeout) {
    const clean = phoneNumber.replace(/[^0-9]/g, '');
    console.log(`[AGI] Dialing SIP/${SIP_TRUNK}/${clean} (timeout: ${timeout || TRANSFER_TIMEOUT}s)`);
    return this.exec('Dial', `SIP/${SIP_TRUNK}/${clean},${timeout || TRANSFER_TIMEOUT},tTgm`);
  }
}

/* ── Call Handler ─────────────────────────────────────────────── */
async function handleIncomingCall(session) {
  const callerNumber = session.vars.callerid || session.vars.calleridnum || 'unknown';
  const calledNumber = session.vars.dnid || session.vars.extension || '';

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[AGI] Incoming call: ${callerNumber} → ${calledNumber}`);
  console.log(`[AGI] Time: ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(60)}`);

  try {
    await session.answer();
    voiceAgent._currentCaller = callerNumber;
    notifyCRM("call_start", { caller: callerNumber, called: calledNumber, time: new Date().toISOString() });
    const callKey = callerNumber.replace(/[^0-9]/g, '').slice(-10);
    const activeCall = { caller: callerNumber, session, started: new Date(), ended: false, pendingTransfer: null };
    activeCalls.set(callKey, activeCall);
    // Persist to DB for resilience
    try {
      await db.query(
        "INSERT INTO telephony_events_log (event_type, payload, created_at) VALUES ('agi_active_call', $1, NOW())",
        [JSON.stringify({ caller: callerNumber, called: calledNumber, key: callKey })]
      );
    } catch (e) { /* ignore */ }
    voiceAgent.getPendingTransfer = () => {
      if (activeCall.pendingTransfer) {
        const pt = activeCall.pendingTransfer;
        activeCall.pendingTransfer = null;
        return pt;
      }
      return null;
    };

    // AI-оператор обрабатывает звонок
    let result = await voiceAgent.handleIncoming(session, callerNumber);

    if (!result) {
      console.log('[AGI] VoiceAgent returned null — hanging up');
      await session.hangup();
      return;
    }

    console.log(`[AGI] Result: action=${result.action}, intent=${result.intent}, route_to=${result.route_to || 'none'}`);

    // Цикл обработки — может повторяться при неудачных переводах
    let attempts = 0;
    const MAX_TOTAL_ATTEMPTS = 3;

    while (result && attempts < MAX_TOTAL_ATTEMPTS) {
      switch (result.action) {
        case 'route': {
          // Перевод звонка на сотрудника
          let phone = result.route_to;
          let name = result.route_name || 'Сотрудник';
          // CRM override transfer
          if (typeof voiceAgent.getPendingTransfer === "function") {
            const pt = voiceAgent.getPendingTransfer();
            if (pt) { phone = pt.phone; name = pt.name || "CRM Transfer"; console.log("[AGI] CRM override → " + phone); }
          }

          if (!phone) {
            console.log('[AGI] No phone for route — falling back to record');
            result = { action: 'record', intent: result.intent, collected_data: result.collected_data, conversationHistory: result.conversationHistory };
            continue;
          }

          console.log(`[AGI] Transferring to ${name} (${phone})`);
          notifyCRM('transfer_start', { caller: callerNumber, name, phone });
          const dialResult = await session.dialMobile(phone, TRANSFER_TIMEOUT);

          // Проверяем результат
          let dialStatus = 'UNKNOWN';
          try {
            dialStatus = await session.getVariable('DIALSTATUS');
            console.log(`[AGI] DIALSTATUS: ${dialStatus}`);
          } catch (e) {
            if (dialResult.result === 0) dialStatus = 'ANSWER';
          }

          if (dialStatus === 'ANSWER') {
            console.log(`[AGI] Call transferred successfully to ${name}`);
            notifyCRM('transfer_success', { caller: callerNumber, name, phone });
            // Успешный перевод — выходим из цикла
            result = null;
          } else {
            // Перевод не удался — возвращаемся к AI
            console.log(`[AGI] Transfer failed (${dialStatus}) — returning to AI`);
            notifyCRM('transfer_failed', { caller: callerNumber, name, phone, status: dialStatus });
            attempts++;

            if (attempts >= MAX_TOTAL_ATTEMPTS) {
              // Слишком много попыток — запись
              try {
                await speakTTS(session, `К сожалению, ни один специалист сейчас не может ответить. Оставьте сообщение, и мы обязательно перезвоним.`);
              } catch (e) { /* ignore */ }
              await recordVoicemail(session, callerNumber, result);
              result = null;
            } else {
              // Возвращаемся к ИИ — он предложит альтернативы
              const newResult = await voiceAgent.handleTransferFailed(
                session,
                callerNumber,
                name,
                result.conversationHistory || [],
                result.context || null
              );

              if (newResult) {
                console.log(`[AGI] AI decided after failed transfer: action=${newResult.action}, route_to=${newResult.route_to || 'none'}`);
                result = newResult;
              } else {
                // AI не ответил — запись
                await recordVoicemail(session, callerNumber, result);
                result = null;
              }
            }
          }
          break;
        }

        case 'record': {
          await recordVoicemail(session, callerNumber, result);
          result = null;
          break;
        }

        case 'hangup': {
          console.log(`[AGI] Hangup (intent: ${result.intent}, reason: ${result.reason || 'spam'})`);
          result = null;
          break;
        }

        default: {
          result = null;
          break;
        }
      }
    }

    // Логируем в БД
    notifyCRM('call_end', { caller: callerNumber, action: (result || {}).action || 'completed', intent: (result || {}).intent || 'unknown' });
    const ek = callerNumber.replace(/[^0-9]/g, '').slice(-10);
    const ec = activeCalls.get(ek);
    if (ec) { ec.ended = true; setTimeout(() => activeCalls.delete(ek), 30000); }
    await logCall(callerNumber, calledNumber, result || { action: 'completed', intent: 'unknown' });

    try { await session.hangup(); } catch (e) { /* уже закрыт */ }

  } catch (err) {
    console.error(`[AGI] Error handling call from ${callerNumber}:`, err);
    try { await session.hangup(); } catch (e) { /* ignore */ }
  }
}

/* ── TTS helper ──────────────────────────────────────────────── */
async function speakTTS(session, text) {
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(text).digest('hex').slice(0, 12);
  const dir = '/var/lib/asterisk/sounds/asgard';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `tts_${hash}`);

  // synthesizeSmart: LINEAR16_PCM 8kHz для чистого звука в телефонии
  const ttsVoice = process.env.TTS_VOICE || 'dasha';
  const ttsRole = process.env.TTS_ROLE || 'friendly';
  const audioBuffer = await speechKit.synthesizeSmart(text, {
    voice: ttsVoice,
    role: ttsRole,
    emotion: 'good',
    speed: '1.0',
    telephony: true,
    ssml: false
  });
  fs.writeFileSync(filePath + '.slin', audioBuffer);
  await session.streamFile(filePath);
}

/* ── Voicemail ───────────────────────────────────────────────── */
async function recordVoicemail(session, callerNumber, context) {
  try {
    // Предлагаем оставить сообщение (если ещё не сказали)
    try {
      notifyCRM('voicemail_start', { caller: callerNumber || 'unknown' });
    await speakTTS(session, 'Оставьте ваше сообщение после сигнала. Когда закончите, нажмите решётку.');
    } catch (e) { /* ignore */ }

    const ts = Date.now();
    const vmDir = '/var/spool/asterisk/voicemail/asgard';
    if (!fs.existsSync(vmDir)) fs.mkdirSync(vmDir, { recursive: true });
    const vmFile = path.join(vmDir, `vm_${ts}`);

    await session.recordFile(vmFile, 'wav', '#', 120000, 0, true, 4);

    // Транскрибируем
    const wavPath = vmFile + '.wav';
    let transcript = '';
    if (fs.existsSync(wavPath) && fs.statSync(wavPath).size > 1000) {
      try {
        transcript = await speechKit.recognizeShort(wavPath, {
          audioEncoding: 'lpcm',
          sampleRate: 8000
        });
        console.log(`[AGI] Voicemail transcript: ${transcript}`);
      } catch (e) {
        console.error('[AGI] Voicemail STT error:', e.message);
      }
    }

    // Благодарим
    try {
      await speakTTS(session, 'Спасибо! Ваше сообщение записано, мы перезвоним. До свидания!');
    } catch (e) { /* ignore */ }

    // Создаём задачу на перезвон
    await createCallbackTask(callerNumber, transcript, context || {});

  } catch (err) {
    console.error('[AGI] Voicemail error:', err.message);
  }
}

/* ── Создание задачи на перезвон ──────────────────────────────── */
async function createCallbackTask(callerNumber, transcript, context) {
  try {
    const collected = context.collected_data || {};
    const description = [
      `Звонок от: ${callerNumber}`,
      collected.company ? `Компания: ${collected.company}` : null,
      collected.contact_person ? `Контакт: ${collected.contact_person}` : null,
      collected.need ? `Потребность: ${collected.need}` : null,
      collected.object ? `Объект: ${collected.object}` : null,
      transcript ? `Сообщение: ${transcript}` : null,
      context.intent ? `Тип: ${context.intent}` : null
    ].filter(Boolean).join('\n');

    // Находим кому назначить (первая линия — Хосе)
    const assignee = await db.query(
      `SELECT u.id FROM users u WHERE u.role = 'HEAD_TO' AND u.is_active = true LIMIT 1`
    );
    const assigneeId = assignee.rows.length ? assignee.rows[0].id : null;

    if (!assigneeId) {
      console.error('[AGI] No assignee found for callback task');
      return;
    }

    await db.query(
      `INSERT INTO tasks (title, description, creator_id, assignee_id, deadline, status, priority, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'open', 'high', NOW(), NOW())`,
      [
        `Перезвонить: ${callerNumber}${collected.company ? ' (' + collected.company + ')' : ''}`,
        description,
        assigneeId,
        assigneeId,
        new Date(Date.now() + 30 * 60000)
      ]
    );
    console.log(`[AGI] Callback task created for ${callerNumber}`);

    // Уведомление
    try {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, type, created_at)
         VALUES ($1, $2, $3, 'call_missed', NOW())`,
        [assigneeId, `Пропущенный звонок: ${callerNumber}`, description]
      );
    } catch (e) { /* ignore */ }

  } catch (err) {
    console.error('[AGI] Task creation error:', err.message);
  }
}

/* ── Логирование звонка ──────────────────────────────────────── */
async function logCall(callerNumber, calledNumber, result) {
  try {
    await db.query(
      `INSERT INTO telephony_events_log (event_type, payload, created_at)
       VALUES ('agi_call', $1, NOW())`,
      [JSON.stringify({
        caller: callerNumber,
        called: calledNumber,
        action: result.action,
        intent: result.intent,
        route_to: result.route_to,
        route_name: result.route_name,
        collected_data: result.collected_data,
        conversation: result.conversationHistory ? result.conversationHistory.map(h => ({
          role: h.role,
          text: (h.text || '').slice(0, 200)
        })) : []
      })]
    );
  } catch (err) {
    console.error('[AGI] Log error:', err.message);
  }
}

/* ── Active Calls Map (for CRM control) ─────────────────────── */
const activeCalls = new Map();

/* ── HTTP Control Server (port 4574) ─────────────────────────── */
const httpControl = require('http').createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/transfer') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { phone, name } = JSON.parse(body);
        if (!phone) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'phone required' })); }
        let found = null;
        for (const [, call] of activeCalls) {
          if (!call.ended) { found = call; break; }
        }
        if (!found) { res.writeHead(404); return res.end(JSON.stringify({ ok: false, error: 'No active call' })); }
        found.pendingTransfer = { phone: phone.replace(/[^0-9]/g, ''), name: name || '' };
        console.log('[AGI-CTRL] Transfer signal for ' + found.caller + ' → ' + phone);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message })); }
    });
  } else if (req.method === 'GET' && req.url === '/status') {
    const calls = [];
    for (const [, c] of activeCalls) calls.push({ caller: c.caller, ended: !!c.ended });
    res.writeHead(200); res.end(JSON.stringify({ ok: true, calls }));
  } else { res.writeHead(404); res.end('Not found'); }
});
httpControl.listen(4574, '127.0.0.1', () => console.log('[AGI-CTRL] Control server on 4574'));
httpControl.on('error', e => console.error('[AGI-CTRL] Error:', e.message));

/* ── TCP Server (FastAGI) ────────────────────────────────────── */
const server = net.createServer((socket) => {
  socket.setEncoding('utf8');
  socket.setTimeout(300000); // 5 мин таймаут (звонок может быть длинным с повторными переводами)

  const session = new AGISession(socket);

  socket.once('data', async (data) => {
    try {
      await session.parseVars(data);
      console.log(`[AGI] Session: caller=${session.vars.callerid}, ext=${session.vars.extension}`);

      const script = session.vars.request || session.vars.network_script || '';
      if (script.includes('incoming')) {
        await handleIncomingCall(session);
      } else {
        console.log(`[AGI] Unknown script: ${script}`);
        await session.hangup();
      }
    } catch (err) {
      console.error('[AGI] Session error:', err);
      try { socket.end(); } catch (_) {}
    }
  });

  socket.on('error', (err) => {
    if (err.code !== 'ECONNRESET') console.error('[AGI] Socket error:', err.message);
  });
  socket.on('timeout', () => { session.closed = true; socket.end(); });
});

server.listen(AGI_PORT, '127.0.0.1', () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ASGARD AI Voice Operator`);
  console.log(`  Listening on 127.0.0.1:${AGI_PORT}`);
  console.log(`  SpeechKit: ${speechKit.isConfigured() ? 'OK' : 'NOT configured'}`);
  console.log(`  AI Provider: ${aiProvider ? 'OK' : 'NOT configured'}`);
  console.log(`  SIP Trunk: ${SIP_TRUNK}`);
  console.log(`${'═'.repeat(60)}\n`);
});

server.on('error', (err) => {
  console.error('[AGI] Server error:', err.message);
  process.exit(1);
});

/* ── Graceful shutdown ───────────────────────────────────────── */
const shutdown = (sig) => {
  console.log(`[AGI] ${sig} received, shutting down...`);
  server.close(() => { pool.end().then(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 5000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
