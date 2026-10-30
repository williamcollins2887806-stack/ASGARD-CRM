'use strict';

const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

// Ленивый require, чтобы не создать цикл (mango → db → …). Нужен только для
// чтения локального журнала отправок в getSmsStatus().
let _db = null;
function getDb() {
  if (!_db) { try { _db = require('./db'); } catch (_) { _db = null; } }
  return _db;
}

const BASE_URL = 'https://app.mango-office.ru/vpbx/';

/**
 * Номер-отправитель SMS для Mango.
 *
 * MANGO_SMS_EXTENSION (в проде = 10) — рабочий внутренний номер.
 * Раньше часть роутов читала MANGO_SMS_FROM, которой нет в .env → уходила
 * ПУСТАЯ строка, и Mango отвечал «3103» (invite-SMS не отправлялись, хотя
 * SMS-код входа работал). Единый источник — эта функция.
 */
function smsSenderExtension() {
  return String(
    process.env.MANGO_SMS_EXTENSION
    || process.env.MANGO_SMS_FROM
    || ''
  ).trim();
}

class MangoService {
  constructor(apiKey, apiSalt) {
    this.apiKey = apiKey || process.env.MANGO_API_KEY || '';
    this.apiSalt = apiSalt || process.env.MANGO_API_SALT || '';
    if (!this.apiKey || !this.apiSalt) {
      console.warn('[MangoService] API key or salt not configured — Mango integration disabled');
    }
  }

  // === Подпись запросов ===

  sign(jsonString) {
    return crypto
      .createHash('sha256')
      .update(this.apiKey + jsonString + this.apiSalt)
      .digest('hex');
  }

  verifyWebhook(vpbxApiKey, sign, jsonString) {
    if (!this.apiKey || !this.apiSalt) return false;
    if (vpbxApiKey !== this.apiKey) return false;
    const expected = this.sign(jsonString);
    return crypto.timingSafeEqual(
      Buffer.from(sign, 'hex'),
      Buffer.from(expected, 'hex')
    );
  }

  // === HTTP,запросы к API ===

  async request(endpoint, data = {}) {
    const jsonString = JSON.stringify(data);
    const body = querystring.stringify({
      vpbx_api_key: this.apiKey,
      sign: this.sign(jsonString),
      json: jsonString
    });

    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, BASE_URL);
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 15000
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const contentType = res.headers['content-type'] || '';
          const httpOk = res.statusCode >= 200 && res.statusCode < 300;
          const isTextResponse = contentType.includes('application/json') || contentType.includes('text/');
          if (!isTextResponse) {
            if (!httpOk) {
              reject(new Error(`Mango HTTP error (http: ${res.statusCode})`));
              return;
            }
            resolve({ raw: Buffer.from(data, 'binary'), contentType });
            return;
          }

          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (_) {
            // Некоторые методы Mango отвечают текстовым числовым кодом (например,
            // "1000"). Не превращаем такой ответ и любой другой 4xx/5xx текст в
            // объект raw, который вызывающая сторона могла ошибочно принять за успех.
            const plainCode = String(data || '').trim();
            if (/^\\d{1,4}$/.test(plainCode)) parsed = { result: plainCode };
            else {
              reject(new Error(httpOk
                ? 'Mango returned an unreadable response'
                : `Mango HTTP error (http: ${res.statusCode})`));
              return;
            }
          }

          const code = parsed.code != null ? Number(parsed.code) : null;
          const resultField = parsed.result != null ? String(parsed.result) : null;
          const codeFail = code != null && code !== 1000;
          const resultFail = resultField != null &&
            resultField !== '1000' && resultField !== '0' && !/^ok$/i.test(resultField);
          if (!httpOk || codeFail || resultFail) {
            const err = new Error(`Mango API error: ${parsed.message || parsed.result || 'Unknown'} (code: ${code != null ? code : resultField}, http: ${res.statusCode})`);
            err.code = code != null ? code : resultField;
            err.response = parsed;
            err.statusCode = res.statusCode;
            reject(err);
            return;
          }
          resolve(parsed);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Mango API request timeout'));
      });
      req.write(body);
      req.end();
    });
  }

  async callback(fromExtension, toNumber, lineNumber, commandId) {
    const data = {
      from: { extension: String(fromExtension) },
      to_number: String(toNumber)
    };
    if (lineNumber) data.line_number = String(lineNumber);
    if (commandId) data.command_id = commandId;
    return this.request('commands/callback', data);
  }

  async callbackGroup(groupExtension, toNumber, lineNumber, commandId) {
    const data = {
      from: String(groupExtension),
      to: String(toNumber)
    };
    if (lineNumber) data.line_number = String(lineNumber);
    if (commandId) data.command_id = commandId;
    return this.request('commands/callback_group', data);
  }

  async route(callId, toNumber, commandId) {
    const data = { call_id: callId, to_number: String(toNumber) };
    if (commandId) data.command_id = commandId;
    return this.request('commands/route', data);
  }

  async transfer(callId, method, toNumber, initiator, commandId) {
    const data = {
      call_id: callId,
      method: method || 'blind',
      to_number: String(toNumber),
      initiator: String(initiator)
    };
    if (commandId) data.command_id = commandId;
    return this.request('commands/transfer', data);
  }

  async hangup(callId, commandId) {
    const data = { call_id: callId };
    if (commandId) data.command_id = commandId;
    return this.request('commands/call/hangup', data);
  }

  async startRecording(callId, partyNumber, commandId) {
    const data = {
      call_id: callId,
      call_party_number: String(partyNumber)
    };
    if (commandId) data.command_id = commandId;
    return this.request('commands/recording/start', data);
  }

  async playAudio(callId, audioFileId) {
    return this.request('commands/play/start', {
      call_id: callId,
      internal_id: audioFileId
    });
  }

  async sendSms(fromExtension, toNumber, text, senderName) {
    // Пустой отправитель = Mango 3103. Если вызвали без номера — берём
    // MANGO_SMS_EXTENSION; если и его нет — явная ошибка, а не «3103 непонятно».
    const from = String(fromExtension == null ? '' : fromExtension).trim() || smsSenderExtension();
    if (!from) throw new Error('SMS: не задан номер отправителя (MANGO_SMS_EXTENSION в .env)');
    const payload = {
      command_id: `sms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from_extension: from,
      to_number: String(toNumber),
      text,
    };
    // Имя вроде ASGARD без регистрации у оператора часто молча дропается.
    // Пустой sender → дефолт из ЛК Mango (обычно цифровой номер).
    const sender = (senderName || process.env.MANGO_SMS_SENDER || '').trim();
    if (sender && !/^ASGARD$/i.test(sender)) payload.sms_sender = sender;
    const response = await this.request('commands/sms', payload);
    // command_id is generated locally for webhook correlation. Some Mango
    // responses omit it; never replace it with a synthetic "sent" placeholder.
    const responseObject = response && typeof response === 'object' && !Buffer.isBuffer(response)
      ? response
      : { response };
    return {
      ...responseObject,
      command_id: String(responseObject.command_id || payload.command_id),
    };
  }

  // 26.06.2026: Прямая проверка статуса SMS через Mango Office API.
  // Полезна когда delivery-webhook не настроен.
  //
  // ВАЖНО (16.10.2026): раньше метод звал `queries/sms`, которого в API НЕТ —
  // Mango отвечает `3128 Недействительный URL` на любой такой запрос. Проверено
  // на проде: `queries/sms` / `queries/users` / `queries/balance` — все 3128.
  // Поэтому статус теперь берём из собственного журнала `field_sms_log`, куда
  // пишет webhook `/webhook/events/sms` (поле `reason`, см. telephony.js).
  //
  // Если нужен именно запрос в Mango — используй `events/sms`-webhook или ЛК; в
  // публичном API ВАТС прямого query по SMS нет.
  async getSmsStatus(commandId) {
    if (!commandId) throw new Error('command_id обязателен');
    const db = getDb();
    if (!db) return { found: false, error: 'db unavailable' };
    try {
      const { rows } = await db.query(
        `SELECT command_id, delivery_status, delivered_at, status, phone, created_at
           FROM field_sms_log
          WHERE command_id::text = $1::text
          ORDER BY id DESC LIMIT 1`,
        [String(commandId)]
      );
      if (!rows.length) return { found: false, source: 'field_sms_log' };
      const r = rows[0];
      return {
        found: true,
        source: 'field_sms_log',
        command_id: r.command_id,
        status: r.delivery_status || r.status || 'unknown',
        sent_at: r.created_at,
        delivered_at: r.delivered_at,
        to_number: r.phone,
      };
    } catch (e) {
      return { found: false, error: e.message };
    }
  }
  async getRecordingLink(recordingId, expires = 3600) {
    return this.request('queries/recording/link', {
      recording_id: recordingId,
      expires
    });
  }

  async downloadRecording(recordingId) {
    const jsonString = JSON.stringify({
      recording_id: recordingId,
      action: 'download'
    });
    const body = querystring.stringify({
      vpbx_api_key: this.apiKey,
      sign: this.sign(jsonString),
      json: jsonString
    });

    return new Promise((resolve, reject) => {
      const url = new URL('queries/recording/post', BASE_URL);
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 60000
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            buffer,
            contentType: res.headers['content-type'] || 'audio/mpeg',
            size: buffer.length
          });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Recording download timeout')); });
      req.write(body);
      req.end();
    });
  }

  downloadRecordingStream(recordingId) {
    const jsonString = JSON.stringify({
      recording_id: recordingId,
      action: 'download'
    });
    const body = querystring.stringify({
      vpbx_api_key: this.apiKey,
      sign: this.sign(jsonString),
      json: jsonString
    });

    return new Promise((resolve, reject) => {
      const url = new URL('queries/recording/post', BASE_URL);
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 120000
      }, (res) => {
        resolve({
          stream: res,
          contentType: res.headers['content-type'] || 'audio/mpeg',
          contentLength: parseInt(res.headers['content-length'] || '0', 10)
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Recording stream timeout')); });
      req.write(body);
      req.end();
    });
  }
  async getUsers() {
    return this.request('config/users/request', {});
  }

  async requestStats(dateFrom, dateTo, fields, filters = {}) {
    const data = {
      date_from: typeof dateFrom === 'number' ? dateFrom : Math.floor(new Date(dateFrom).getTime() / 1000),
      date_to: typeof dateTo === 'number' ? dateTo : Math.floor(new Date(dateTo).getTime() / 1000)
    };
    if (fields) data.fields = Array.isArray(fields) ? fields.join(',') : fields;
    Object.assign(data, filters);
    return this.request('stats/request', data);
  }

  async getStatsResult(key) {
    return this.request('stats/result', { key });
  }

  // Extended Stats API (JSON, includes recording_id in context_calls)
  async requestCallStats(startDate, endDate, options = {}) {
    const data = {
      start_date: startDate,   // format: "DD.MM.YYYY HH:MM:SS"
      end_date: endDate,
      limit: String(options.limit || 1000),
      offset: String(options.offset || 0)
    };
    return this.request('stats/calls/request', data);
  }

  async getCallStatsResult(key) {
    return this.request('stats/calls/result/', { key });
  }

  async getGroups() {
    return this.request('groups', {});
  }

  async getSchemas() {
    return this.request('schemas/', {});
  }

  async setSchema(schemaId) {
    return this.request('schema/set/', { schema_id: schemaId });
  }

  static normalizePhone(phone) {
    if (!phone) return '';
    let clean = phone.replace(/[^0-9+]/g, '');
    if (clean.startsWith('8') && clean.length === 11) {
      clean = '+7' + clean.slice(1);
    } else if (clean.startsWith('7') && clean.length === 11) {
      clean = '+' + clean;
    } else if (!clean.startsWith('+')) {
      clean = '+' + clean;
    }
    return clean;
  }

  static getCallDirection(callDirection) {
    switch (Number(callDirection)) {
      case 1: return 'inbound';
      case 2: return 'outbound';
      default: return 'internal';
    }
  }

  isConfigured() {
    return !!(this.apiKey && this.apiSalt);
  }
}

let instance = null;

function getMangoService() {
  if (!instance) {
    instance = new MangoService();
  }
  return instance;
}

module.exports = MangoService;
module.exports.getMangoService = getMangoService;
module.exports.normalizePhone = MangoService.normalizePhone;
module.exports.getCallDirection = MangoService.getCallDirection;
module.exports.smsSenderExtension = smsSenderExtension;
