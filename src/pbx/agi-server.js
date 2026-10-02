'use strict';

const net = require('net');
const { EventEmitter } = require('events');

/**
 * Minimal FastAGI server: читает AGI env block, отдаёт handler.
 */
class AgiServer extends EventEmitter {
  constructor(port, handler) {
    super();
    this.port = port;
    this.handler = handler;
    this.server = null;
  }

  start() {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => this._onConnection(socket));
      this.server.listen(this.port, '127.0.0.1', () => {
        this.emit('listening', this.port);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  async _onConnection(socket) {
    const session = new AgiSession(socket);
    try {
      await session.readEnv();
      if (typeof this.handler === 'function') {
        await this.handler(session);
      }
    } catch (err) {
      this.emit('error', err);
      try {
        await session.verbose(`AGI error: ${err.message}`, 1);
      } catch (_) { /* ignore */ }
    } finally {
      socket.end();
    }
  }
}

class AgiSession {
  constructor(socket) {
    this.socket = socket;
    this.env = {};
    this._buf = '';
  }

  readEnv() {
    return new Promise((resolve, reject) => {
      const onData = (chunk) => {
        this._buf += chunk.toString('utf8');
        if (this._buf.includes('\n\n')) {
          this.socket.removeListener('data', onData);
          const lines = this._buf.split('\n');
          for (const line of lines) {
            if (!line.trim()) break;
            const sp = line.indexOf(':');
            if (sp === -1) continue;
            const k = line.slice(0, sp).trim();
            const v = line.slice(sp + 1).trim();
            this.env[k] = v;
          }
          resolve(this.env);
        }
      };
      this.socket.on('data', onData);
      this.socket.on('error', reject);
    });
  }

  async command(cmd) {
    return new Promise((resolve, reject) => {
      this.socket.write(cmd + '\n');
      let buf = '';
      const onData = (chunk) => {
        buf += chunk.toString('utf8');
        if (buf.includes('\n')) {
          this.socket.removeListener('data', onData);
          const line = buf.split('\n')[0];
          const code = parseInt(line.split(' ')[0], 10);
          const rest = line.slice(line.indexOf(' ') + 1);
          if (code === 200) resolve({ code, result: rest });
          else reject(new Error(`AGI ${code}: ${rest}`));
        }
      };
      this.socket.on('data', onData);
      this.socket.on('error', reject);
    });
  }

  verbose(msg, level = 1) {
    return this.command(`VERBOSE "${String(msg).replace(/"/g, '')}" ${level}`);
  }

  answer() {
    return this.command('ANSWER');
  }

  hangup() {
    return this.command('HANGUP');
  }

  setVariable(name, value) {
    return this.command(`SET VARIABLE ${name} "${String(value).replace(/"/g, '')}"`);
  }

  getVariable(name) {
    return this.command(`GET VARIABLE ${name}`);
  }

  streamFile(file, escapeDigits) {
    const esc = escapeDigits ? `"${escapeDigits}"` : '""';
    return this.command(`STREAM FILE ${file} ${esc}`);
  }

  getData(file, timeoutMs, maxDigits) {
    return this.command(`GET DATA ${file} ${timeoutMs} ${maxDigits}`);
  }
}

module.exports = { AgiServer, AgiSession };
