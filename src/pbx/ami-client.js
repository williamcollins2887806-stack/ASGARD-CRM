'use strict';

const net = require('net');
const { EventEmitter } = require('events');
const { config, amiConfigured } = require('./config');

class AmiClient extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.host = opts.host || config.ami.host;
    this.port = opts.port || config.ami.port;
    this.user = opts.user || config.ami.user;
    this.secret = opts.secret || config.ami.secret;
    this.socket = null;
    this.buffer = '';
    this.connected = false;
    this.loggedIn = false;
    this._reconnectTimer = null;
    this._pending = new Map();
    this._actionId = 0;
  }

  _requireConfigured() {
    if (!this.user || !this.secret) {
      throw new Error('AMI not configured: set AMI_USER and AMI_SECRET');
    }
  }

  connect() {
    this._requireConfigured();
    if (this.socket) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.host, port: this.port }, () => {
        this.connected = true;
        this._readLoop();
        this._login().then(resolve).catch(reject);
      });
      this.socket.on('error', (err) => {
        this.emit('error', err);
        if (!this.loggedIn) reject(err);
      });
      this.socket.on('close', () => {
        this.connected = false;
        this.loggedIn = false;
        this.socket = null;
        this._scheduleReconnect();
      });
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (amiConfigured()) {
        this.connect().catch(() => {});
      }
    }, 3000);
  }

  _readLoop() {
    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let idx;
      while ((idx = this.buffer.indexOf('\r\n\r\n')) !== -1) {
        const block = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 4);
        this._handleBlock(block);
      }
    });
  }

  _handleBlock(block) {
    const lines = block.split('\r\n');
    const msg = {};
    for (const line of lines) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const key = line.slice(0, colon).trim();
      const val = line.slice(colon + 1).trim();
      msg[key] = val;
    }
    if (msg.Event) {
      this.emit('event', msg);
      return;
    }
    if (msg.Response) {
      const id = msg.ActionID;
      if (id && this._pending.has(id)) {
        const { resolve, reject } = this._pending.get(id);
        this._pending.delete(id);
        if (msg.Response === 'Success' || msg.Response === 'Follows') resolve(msg);
        else reject(new Error(msg.Message || 'AMI action failed'));
      }
    }
  }

  _write(lines) {
    if (!this.socket) throw new Error('AMI socket not connected');
    const payload = lines.join('\r\n') + '\r\n\r\n';
    this.socket.write(payload);
  }

  async _login() {
    const actionId = String(++this._actionId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(actionId);
        reject(new Error('AMI login timeout'));
      }, 5000);
      this._pending.set(actionId, {
        resolve: (msg) => {
          clearTimeout(timer);
          this.loggedIn = true;
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this._write([
        'Action: Login',
        `Username: ${this.user}`,
        `Secret: ${this.secret}`,
        'Events: on',
        `ActionID: ${actionId}`,
      ]);
    });
  }

  async action(fields) {
    await this.connect();
    const actionId = String(++this._actionId);
    const lines = ['Action: ' + fields.Action, 'ActionID: ' + actionId];
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'Action') continue;
      lines.push(`${k}: ${v}`);
    }
    return new Promise((resolve, reject) => {
      this._pending.set(actionId, { resolve, reject });
      this._write(lines);
      setTimeout(() => {
        if (this._pending.has(actionId)) {
          this._pending.delete(actionId);
          reject(new Error('AMI action timeout'));
        }
      }, 15000);
    });
  }

  async originate({ channel, context, exten, priority, callerId, variable, timeout, async }) {
    const fields = {
      Action: 'Originate',
      Channel: channel,
      Context: context,
      Exten: exten,
      Priority: String(priority ?? 1),
      CallerID: callerId || '',
      Timeout: String(timeout ?? 30000),
      Async: async ? 'true' : 'false',
    };
    if (variable) fields.Variable = variable;
    return this.action(fields);
  }

  async redirect(channel, context, exten, priority = 1) {
    return this.action({
      Action: 'Redirect',
      Channel: channel,
      Context: context,
      Exten: exten,
      Priority: String(priority),
    });
  }

  async hangup(channel) {
    return this.action({ Action: 'Hangup', Channel: channel });
  }

  /** Список активных каналов (для снятия всех плеч звонка по Linkedid/Uniqueid). */
  async coreShowChannels() {
    const res = await this.action({ Action: 'CoreShowChannels' });
    return res;
  }

  async setVar(channel, variable, value) {
    return this.action({
      Action: 'Setvar',
      Channel: channel,
      Variable: variable,
      Value: value,
    });
  }

  async getVar(channel, variable) {
    const res = await this.action({
      Action: 'Getvar',
      Channel: channel,
      Variable: variable,
    });
    return res.Value;
  }

  async bridge(channel1, channel2) {
    return this.action({
      Action: 'Bridge',
      Channel1: channel1,
      Channel2: channel2,
    });
  }

  /**
   * Play DTMF and wait for digit (via channel variable polling — упрощённо для тестов).
   */
  async waitForDtmf(channel, digit, timeoutMs = 10000) {
    const want = String(digit);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let val;
      try {
        val = await this.getVar(channel, 'DTMF_DIGIT');
      } catch (_) {
        val = null;
      }
      if (val === want) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }

  async playDtmf(channel, digits) {
    return this.action({
      Action: 'PlayDTMF',
      Channel: channel,
      Digit: String(digits),
    });
  }

  close() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.socket) this.socket.end();
    this.socket = null;
  }
}

let singleton = null;

function getAmiClient() {
  if (!singleton) singleton = new AmiClient();
  return singleton;
}

module.exports = { AmiClient, getAmiClient, amiConfigured };
