'use strict';

const path = require('path');
const { createPool, pickActiveUserId, assertLocalDb, DEFAULT_DATABASE_URL } = require('../integration/harness');
const { startMockCmd } = require('./mock-cmd');

const MANGO_KEY = process.env.EMU_MANGO_KEY || 'emu_test_key_asgard';
const MANGO_SALT = process.env.EMU_MANGO_SALT || 'emu_test_salt_asgard';
const CMD_SECRET = process.env.EMU_PBX_CMD_SECRET || 'emu-cmd-secret';

function clearRequireCache(substr) {
  Object.keys(require.cache)
    .filter((k) => k.includes(substr))
    .forEach((k) => delete require.cache[k]);
}

/**
 * Ephemeral Fastify: telephony + telephony-pbx against asgard_crm_test + Mock CMD.
 */
async function startEmuApp(opts = {}) {
  process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
  process.env.DB_USER = process.env.DB_USER || 'asgard';
  process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
  process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
  assertLocalDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL);

  process.env.MANGO_API_KEY = MANGO_KEY;
  process.env.MANGO_API_SALT = MANGO_SALT;
  process.env.PBX_CMD_SECRET = CMD_SECRET;
  process.env.TELEPHONY_EMU_MOCK = '1';

  clearRequireCache(`${path.sep}src${path.sep}services${path.sep}mango`);
  clearRequireCache(`${path.sep}src${path.sep}routes${path.sep}telephony`);
  clearRequireCache(`${path.sep}src${path.sep}routes${path.sep}telephony-pbx`);
  clearRequireCache(`${path.sep}src${path.sep}pbx${path.sep}config`);

  const pool = createPool();
  const userId = opts.userId || (await pickActiveUserId(pool, 0));
  const { rows: urows } = await pool.query(
    `SELECT id, login, role, name FROM users WHERE id = $1`,
    [userId]
  );
  const user = urows[0] || { id: userId, login: 'emu', role: 'ADMIN', name: 'Emu Admin' };

  const cmd = await startMockCmd({ secret: CMD_SECRET, ami: opts.ami });
  process.env.PBX_CMD_HOST = '127.0.0.1';
  process.env.CMD_PORT = String(cmd.port);

  const fastify = require('fastify')({ logger: false });
  fastify.decorate('db', pool);
  fastify.decorate('authenticate', async (req) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      const err = new Error('Unauthorized');
      err.statusCode = 401;
      throw err;
    }
    req.user = {
      id: user.id,
      login: user.login,
      role: user.role || 'ADMIN',
      name: user.name,
      permissions: {},
    };
  });
  fastify.decorate('requireRoles', function (roles) {
    return async (req) => {
      if (!roles.includes(req.user.role)) {
        const err = new Error('Forbidden');
        err.statusCode = 403;
        throw err;
      }
    };
  });
  fastify.decorate('requirePermission', function () {
    return async () => {};
  });

  await fastify.register(require('../../../src/routes/telephony'), { prefix: '/api/telephony' });
  await fastify.register(require('../../../src/routes/telephony-pbx'), { prefix: '/api/telephony/pbx' });
  await fastify.listen({ host: '127.0.0.1', port: 0 });

  const port = fastify.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    pool,
    user,
    cmd,
    mangoKey: MANGO_KEY,
    mangoSalt: MANGO_SALT,
    baseUrl,
    token: 'emu-token',
    async close() {
      await fastify.close();
      await cmd.close();
      await pool.end();
    },
  };
}

async function api(app, method, pathname, body) {
  const headers = {
    Authorization: 'Bearer ' + app.token,
  };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(app.baseUrl + pathname, { method, headers, body: payload });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = { raw: text };
  }
  return { status: res.status, body: json, text };
}

function mangoSign(apiKey, json, apiSalt) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(apiKey + json + apiSalt).digest('hex');
}

async function postWebhook(app, pathSuffix, data, opts = {}) {
  const key = opts.key != null ? opts.key : app.mangoKey;
  const salt = opts.salt != null ? opts.salt : app.mangoSalt;
  const json = JSON.stringify(data);
  const sign = opts.badSign ? 'deadbeef' : mangoSign(key, json, salt);
  const form = new URLSearchParams({
    vpbx_api_key: key,
    sign,
    json,
  });
  const res = await fetch(app.baseUrl + '/api/telephony/webhook/events/' + pathSuffix, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const text = await res.text();
  return { status: res.status, text };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

module.exports = {
  startEmuApp,
  api,
  postWebhook,
  mangoSign,
  assert,
  MANGO_KEY,
  MANGO_SALT,
  CMD_SECRET,
};
