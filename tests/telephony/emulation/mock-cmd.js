'use strict';

/**
 * Mock PBX CMD HTTP server — AMI actions recorded, no real Asterisk.
 * Mirrors createCmdServer paths used by telephony-pbx.js.
 */
const http = require('http');
const { MockAmi } = require('../scenarios/_mocks');
const {
  cmdTransferBlind,
  cmdTransferConsult,
  cmdHold,
  cmdHangup,
  cmdOriginateOutbound,
} = require('../integration/cmd-contract');

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      if (!buf) return resolve({});
      try {
        resolve(JSON.parse(buf));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {{ secret: string, ami?: import('../scenarios/_mocks').MockAmi }} opts
 */
function startMockCmd(opts) {
  const secret = opts.secret || 'emu-cmd-secret';
  const ami = opts.ami || new MockAmi();
  const log = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(200, { ok: true, ami: true, mock: true });
      }

      const hdr = req.headers['x-pbx-secret'];
      if (hdr !== secret) {
        return send(401, { error: 'Unauthorized' });
      }

      let body = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        body = await parseBody(req);
      }

      log.push({ method: req.method, path: url.pathname, body });

      if (req.method === 'POST' && url.pathname === '/call/answer') {
        return send(200, { ok: true, answered: true, channel: body.channel || null });
      }
      if (req.method === 'POST' && url.pathname === '/call/hangup') {
        try {
          await cmdHangup(ami, body);
          return send(200, { ok: true });
        } catch (e) {
          return send(400, { error: e.message });
        }
      }
      if (req.method === 'POST' && url.pathname === '/call/hold') {
        try {
          await cmdHold(ami, body);
          return send(200, { ok: true, hold: body.hold !== false });
        } catch (e) {
          return send(400, { error: e.message });
        }
      }
      if (req.method === 'POST' && url.pathname === '/call/transfer') {
        try {
          const mode = body.mode || 'blind';
          if (mode === 'consult') await cmdTransferConsult(ami, body);
          else await cmdTransferBlind(ami, body);
          return send(200, { ok: true, mode });
        } catch (e) {
          return send(400, { error: e.message });
        }
      }
      if (req.method === 'POST' && (url.pathname === '/call/outbound' || url.pathname === '/call/originate')) {
        try {
          await cmdOriginateOutbound(ami, {
            Channel: body.channel || body.Channel || 'PJSIP/trunk',
            Exten: body.number || body.exten || body.Exten,
            CallerID: body.callerId || 'CRM',
          });
          return send(200, { ok: true, originated: true });
        } catch (e) {
          return send(400, { error: e.message });
        }
      }
      if (req.method === 'POST' && url.pathname === '/operator/webrtc') {
        return send(200, { ok: true });
      }

      return send(404, { error: 'unknown path ' + url.pathname });
    } catch (e) {
      return send(500, { error: e.message });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        secret,
        ami,
        log,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((r, j) => server.close((e) => (e ? j(e) : r()))),
      });
    });
  });
}

module.exports = { startMockCmd };
