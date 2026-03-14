'use strict';

const net = require('net');
const VoiceAgent = require('./voice-agent');
const { getSpeechKitService } = require('./speechkit');

const DEFAULT_PORT = 4573;

/**
 * AGI-сервер для Asterisk — принимает входящие звонки и передаёт в VoiceAgent
 *
 * Запуск: node src/services/asterisk-agi.js
 * Или: require('./asterisk-agi').startAgiServer(db, aiProvider)
 *
 * В Asterisk extensions.conf:
 *   [incoming]
 *   exten => _X.,1,Answer()
 *   exten => _X.,n,AGI(agi://127.0.0.1:4573)
 *   exten => _X.,n,Hangup()
 */

class AgiChannel {
  constructor(socket) {
    this.socket = socket;
    this.variables = {};
    this.ready = false;
    this._buffer = '';
    this._responseCallbacks = [];
  }

  /**
   * Парсит AGI-переменные из начального блока
   */
  parseInit(data) {
    const lines = data.split('\n');
    for (const line of lines) {
      const match = line.match(/^agi_(\w+):\s*(.*)$/);
      if (match) {
        this.variables[match[1]] = match[2].trim();
      }
    }
    this.ready = true;
  }

  /**
   * Отправить AGI-команду и дождаться ответа
   */
  async command(cmd) {
    return new Promise((resolve, reject) => {
      this._responseCallbacks.push({ resolve, reject });
      this.socket.write(cmd + '\n');
    });
  }

  /**
   * Обработка входящих данных от Asterisk
   */
  handleData(data) {
    this._buffer += data;
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Ответ на AGI-команду: "200 result=X" или "5XX error"
      if (/^\d{3}\s/.test(trimmed)) {
        const cb = this._responseCallbacks.shift();
        if (cb) {
          const code = parseInt(trimmed.slice(0, 3));
          const resultMatch = trimmed.match(/result=(-?\d+)/);
          const result = resultMatch ? parseInt(resultMatch[1]) : 0;
          const dataMatch = trimmed.match(/\((.+?)\)/);
          cb.resolve({
            code,
            result,
            data: dataMatch ? dataMatch[1] : null,
            raw: trimmed
          });
        }
      }
    }
  }

  // ── AGI-команды высокого уровня ──

  async answer() {
    return this.command('ANSWER');
  }

  async hangup() {
    return this.command('HANGUP');
  }

  /**
   * Воспроизвести аудиофайл
   * @param {string} filePath - путь к файлу без расширения
   * @param {string} [escapeDigits=''] - DTMF-клавиши для прерывания
   */
  async streamFile(filePath, escapeDigits = '') {
    return this.command(`STREAM FILE "${filePath}" "${escapeDigits}"`);
  }

  /**
   * Записать аудиофайл
   * @param {string} filePath - путь к файлу без расширения
   * @param {string} format - формат (wav, gsm, etc.)
   * @param {string} escapeDigits - клавиши для остановки
   * @param {number} timeout - максимальная длительность (мс)
   * @param {number} [offsetSamples=0] - смещение
   * @param {boolean} [beep=true] - бип перед записью
   * @param {number} [silence=2] - секунды тишины для автостопа
   */
  async recordFile(filePath, format, escapeDigits, timeout, offsetSamples = 0, beep = true, silence = 2) {
    const beepStr = beep ? 'BEEP' : '';
    const cmd = `RECORD FILE "${filePath}" "${format}" "${escapeDigits}" ${timeout} ${offsetSamples} ${beepStr} s=${silence}`;
    const res = await this.command(cmd);
    if (res.result >= 0) return filePath;
    return null;
  }

  /**
   * Получить переменную канала
   */
  async getVariable(name) {
    const res = await this.command(`GET VARIABLE "${name}"`);
    return res.data || null;
  }

  /**
   * Установить переменную канала
   */
  async setVariable(name, value) {
    return this.command(`SET VARIABLE "${name}" "${value}"`);
  }

  /**
   * Перевести звонок (через Dial)
   * @param {string} extension - SIP extension
   * @param {number} timeout - таймаут в секундах
   */
  async dial(extension, timeout = 30) {
    return this.command(`EXEC Dial "SIP/${extension},${timeout},tT"`);
  }

  /**
   * Переключить на очередь
   */
  async queue(queueName, timeout = 60) {
    return this.command(`EXEC Queue "${queueName},,,,${timeout}"`);
  }

  /**
   * Выполнить произвольный Asterisk application
   */
  async exec(app, args = '') {
    return this.command(`EXEC ${app} "${args}"`);
  }

  /**
   * Verbose-лог
   */
  async verbose(message, level = 1) {
    return this.command(`VERBOSE "${message}" ${level}`);
  }
}


/**
 * Запуск AGI TCP-сервера
 */
function startAgiServer(db, aiProvider, options = {}) {
  const port = options.port || parseInt(process.env.AGI_PORT) || DEFAULT_PORT;
  const speechKit = getSpeechKitService();
  const voiceAgent = new VoiceAgent(speechKit, aiProvider, db);

  const server = net.createServer((socket) => {
    const channel = new AgiChannel(socket);
    let initData = '';
    let initialized = false;

    socket.setEncoding('utf8');
    socket.setTimeout(120000); // 2 мин таймаут

    socket.on('data', async (data) => {
      if (!initialized) {
        initData += data;
        // AGI init блок заканчивается пустой строкой
        if (initData.includes('\n\n')) {
          initialized = true;
          channel.parseInit(initData);

          const callerNumber = channel.variables.callerid || channel.variables.calleridnum || '';
          const calledNumber = channel.variables.dnid || channel.variables.extension || '';

          console.log(`[AGI] Incoming call from ${callerNumber} to ${calledNumber}`);

          try {
            await channel.answer();
            await channel.verbose(`ASGARD AI Agent handling call from ${callerNumber}`);

            const result = await voiceAgent.handleIncoming(channel, callerNumber);

            if (result) {
              switch (result.action) {
                case 'route':
                  console.log(`[AGI] Routing to ${result.route_to}`);
                  if (result.route_to === 'queue') {
                    await channel.queue('default');
                  } else {
                    await channel.dial(result.route_to, 30);
                  }
                  break;

                case 'record':
                  console.log('[AGI] Recording voicemail');
                  await channel.streamFile('/var/lib/asterisk/sounds/asgard/leave-message');
                  await channel.recordFile('/var/spool/asterisk/voicemail/' + Date.now(), 'wav', '#', 60000, 0, true, 5);
                  break;

                case 'hangup':
                  console.log('[AGI] Hangup');
                  break;
              }
            }

            await channel.hangup();
          } catch (err) {
            console.error('[AGI] Error handling call:', err.message);
            try { await channel.hangup(); } catch (_) {}
          }

          socket.end();
        }
        return;
      }

      // После инициализации — обработка ответов на AGI-команды
      channel.handleData(data);
    });

    socket.on('timeout', () => {
      console.warn('[AGI] Socket timeout, closing');
      socket.end();
    });

    socket.on('error', (err) => {
      if (err.code !== 'ECONNRESET') {
        console.error('[AGI] Socket error:', err.message);
      }
    });

    socket.on('close', () => {
      // Cleanup
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[AGI] ASGARD AI Voice Agent listening on 127.0.0.1:${port}`);
  });

  server.on('error', (err) => {
    console.error('[AGI] Server error:', err.message);
  });

  return server;
}

module.exports = { AgiChannel, startAgiServer };
