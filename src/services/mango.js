'use strict';

const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

const BASE_URL = 'https://app.mango-office.ru/vpbx/';

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
          try {
            const contentType = res.headers['content-type'] || '';
            if (contentType.includes('application/json') || contentType.includes('text/')) {
              const parsed = JSON.parse(data);
              if (parsed.code && parsed.code !== 1000) {
                const err = new Error(`Mango API error: ${parsed.message || 'Unknown'} (code: ${parsed.code})`);
                err.code = parsed.code;
                err.response = parsed;
                reject(err);
              } else {
                resolve(parsed);
              }
            } else {
              resolve({ raw: Buffer.from(data, 'binary'), contentType });
            }
          } catch (e) {
            resolve({ raw: data, statusCode: res.statusCode });
          }
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
    return this.request('commands/sms', {
      command_id: `sms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from_extension: String(fromExtension),
      to_number: String(toNumber),
      text,
      sms_sender: senderName || process.env.MANGO_SMS_SENDER || 'ASGARD'
    });
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
