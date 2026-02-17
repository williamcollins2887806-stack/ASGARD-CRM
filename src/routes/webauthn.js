/**
 * WebAuthn (Biometric Login) Routes — Phase 3
 *
 * Registration (requires authenticated session):
 *   POST /api/webauthn/register/options  — get challenge for navigator.credentials.create()
 *   POST /api/webauthn/register/verify   — verify and store credential
 *
 * Authentication (public):
 *   POST /api/webauthn/login/options     — get challenge for navigator.credentials.get()
 *   POST /api/webauthn/login/verify      — verify assertion and create session
 *
 * Management (requires authenticated session):
 *   GET    /api/webauthn/credentials     — list user's devices
 *   DELETE /api/webauthn/credentials/:id — remove device
 *   PATCH  /api/webauthn/credentials/:id — rename device
 */

let simpleWebAuthn;
try {
  simpleWebAuthn = require('@simplewebauthn/server');
} catch (e) {
  simpleWebAuthn = null;
}

async function routes(fastify) {
  const db = fastify.db;

  // Determine RP (Relying Party) settings from environment
  function getRpConfig() {
    const origin = process.env.WEBAUTHN_ORIGIN || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:3000';
    const rpID = process.env.WEBAUTHN_RP_ID || new URL(origin).hostname;
    return {
      rpName: 'ASGARD CRM',
      rpID,
      origin
    };
  }

  // Clean up expired challenges (older than 5 minutes)
  async function cleanupChallenges() {
    await db.query("DELETE FROM webauthn_challenges WHERE created_at < NOW() - INTERVAL '5 minutes'");
  }

  // Store challenge for verification
  async function storeChallenge(userId, challenge, type) {
    await cleanupChallenges();
    await db.query(
      'INSERT INTO webauthn_challenges (user_id, challenge, type) VALUES ($1, $2, $3)',
      [userId, challenge, type]
    );
  }

  // Get and consume challenge
  async function getChallenge(userId, type) {
    const res = await db.query(
      "SELECT challenge FROM webauthn_challenges WHERE user_id = $1 AND type = $2 AND created_at > NOW() - INTERVAL '5 minutes' ORDER BY created_at DESC LIMIT 1",
      [userId, type]
    );
    if (res.rows.length === 0) return null;
    // Delete used challenge
    await db.query('DELETE FROM webauthn_challenges WHERE user_id = $1 AND type = $2', [userId, type]);
    return res.rows[0].challenge;
  }

  // ══════════════════════════════════════════════════════════════════════
  // REGISTRATION — requires authenticated session
  // ══════════════════════════════════════════════════════════════════════

  // POST /register/options — generate registration challenge
  fastify.post('/register/options', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!simpleWebAuthn) return reply.code(501).send({ error: 'WebAuthn not configured (install @simplewebauthn/server)' });

    const userId = request.user.id;
    const rp = getRpConfig();

    // Get existing credentials to exclude
    const existing = await db.query(
      'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1',
      [userId]
    );

    const excludeCredentials = existing.rows.map(c => ({
      id: c.credential_id,
      transports: c.transports || ['internal']
    }));

    // Get user info
    const userRes = await db.query('SELECT id, login, name FROM users WHERE id = $1', [userId]);
    if (!userRes.rows[0]) return reply.code(404).send({ error: 'User not found' });
    const user = userRes.rows[0];

    const options = await simpleWebAuthn.generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpID,
      userID: String(userId),
      userName: user.login || user.name,
      userDisplayName: user.name || user.login,
      excludeCredentials,
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required'
      },
      attestationType: 'none'
    });

    // Store challenge server-side
    await storeChallenge(userId, options.challenge, 'registration');

    return options;
  });

  // POST /register/verify — verify registration response
  fastify.post('/register/verify', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!simpleWebAuthn) return reply.code(501).send({ error: 'WebAuthn not configured' });

    const userId = request.user.id;
    const rp = getRpConfig();
    const expectedChallenge = await getChallenge(userId, 'registration');

    if (!expectedChallenge) {
      return reply.code(400).send({ error: 'Challenge expired or not found. Try again.' });
    }

    try {
      const verification = await simpleWebAuthn.verifyRegistrationResponse({
        response: request.body,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true
      });

      if (!verification.verified || !verification.registrationInfo) {
        return reply.code(400).send({ error: 'Verification failed' });
      }

      const { credential, credentialDeviceType } = verification.registrationInfo;
      const deviceName = request.body.device_name || detectDeviceName(request);

      await db.query(`
        INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, device_name, transports)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        userId,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        deviceName,
        credential.transports || ['internal']
      ]);

      return { verified: true, device_name: deviceName };
    } catch (err) {
      fastify.log.error('WebAuthn registration verify error:', err.message);
      return reply.code(400).send({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // AUTHENTICATION — public (no auth required)
  // ══════════════════════════════════════════════════════════════════════

  // POST /login/options — generate authentication challenge
  fastify.post('/login/options', async (request, reply) => {
    if (!simpleWebAuthn) return reply.code(501).send({ error: 'WebAuthn not configured' });

    const { username } = request.body || {};
    if (!username) return reply.code(400).send({ error: 'username is required' });

    const rp = getRpConfig();

    // Find user
    const userRes = await db.query(
      'SELECT id, is_active FROM users WHERE login = $1',
      [username.trim().toLowerCase()]
    );

    if (!userRes.rows[0]) {
      return reply.code(404).send({ error: 'User not found' });
    }

    if (!userRes.rows[0].is_active) {
      return reply.code(403).send({ error: 'Account is blocked' });
    }

    const userId = userRes.rows[0].id;

    // Get user's credentials
    const creds = await db.query(
      'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1',
      [userId]
    );

    if (creds.rows.length === 0) {
      return reply.code(404).send({ error: 'No biometric credentials registered for this user' });
    }

    const allowCredentials = creds.rows.map(c => ({
      id: c.credential_id,
      transports: c.transports || ['internal']
    }));

    const options = await simpleWebAuthn.generateAuthenticationOptions({
      rpID: rp.rpID,
      allowCredentials,
      userVerification: 'required'
    });

    // Store challenge
    await storeChallenge(userId, options.challenge, 'authentication');

    return { ...options, userId };
  });

  // POST /login/verify — verify authentication and create session
  fastify.post('/login/verify', async (request, reply) => {
    if (!simpleWebAuthn) return reply.code(501).send({ error: 'WebAuthn not configured' });

    const { userId } = request.body || {};
    if (!userId) return reply.code(400).send({ error: 'userId is required' });

    const rp = getRpConfig();
    const expectedChallenge = await getChallenge(userId, 'authentication');

    if (!expectedChallenge) {
      return reply.code(400).send({ error: 'Challenge expired. Try again.' });
    }

    // Find credential in DB
    const credentialId = request.body.id;
    const credRes = await db.query(
      'SELECT id, credential_id, public_key, counter, transports FROM webauthn_credentials WHERE credential_id = $1 AND user_id = $2',
      [credentialId, userId]
    );

    if (!credRes.rows[0]) {
      return reply.code(400).send({ error: 'Credential not found' });
    }

    const dbCred = credRes.rows[0];

    try {
      const verification = await simpleWebAuthn.verifyAuthenticationResponse({
        response: request.body,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
        credential: {
          id: dbCred.credential_id,
          publicKey: dbCred.public_key,
          counter: Number(dbCred.counter),
          transports: dbCred.transports || ['internal']
        }
      });

      if (!verification.verified) {
        return reply.code(400).send({ error: 'Authentication failed' });
      }

      // Update counter and last_used_at (replay protection)
      await db.query(
        'UPDATE webauthn_credentials SET counter = $1, last_used_at = NOW() WHERE id = $2',
        [verification.authenticationInfo.newCounter, dbCred.id]
      );

      // Verify user is still active
      const userRes = await db.query(
        'SELECT id, login, name, role, is_active FROM users WHERE id = $1',
        [userId]
      );

      if (!userRes.rows[0] || !userRes.rows[0].is_active) {
        return reply.code(403).send({ error: 'Account is blocked' });
      }

      const user = userRes.rows[0];

      // Update last_login_at
      await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);

      // Load permissions and menu settings (same as normal login)
      let permissions = {};
      let menuSettings = {};
      try {
        const permRes = await db.query(
          'SELECT module_key, can_read, can_write, can_delete FROM user_permissions WHERE user_id = $1',
          [userId]
        );
        if (permRes.rows.length > 0) {
          permRes.rows.forEach(r => {
            permissions[r.module_key] = { read: r.can_read, write: r.can_write, delete: r.can_delete };
          });
        } else {
          // Fallback to role presets
          const presetRes = await db.query(
            'SELECT module_key, can_read, can_write, can_delete FROM role_presets WHERE role = $1',
            [user.role]
          );
          presetRes.rows.forEach(r => {
            permissions[r.module_key] = { read: r.can_read, write: r.can_write, delete: r.can_delete };
          });
        }

        const menuRes = await db.query(
          "SELECT value_json FROM settings WHERE key = $1",
          ['menu_' + userId]
        );
        if (menuRes.rows[0]?.value_json) {
          menuSettings = JSON.parse(menuRes.rows[0].value_json);
        }
      } catch (e) {
        // Non-critical — proceed without permissions
      }

      // Create JWT token (full access — biometric bypasses PIN and 2FA)
      const token = fastify.jwt.sign({
        id: user.id,
        role: user.role,
        pinVerified: true
      });

      // Log the biometric login
      try {
        await db.query(`
          INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
          VALUES ($1, 'Вход через биометрию', $2, 'system', true, NOW())
        `, [userId, `Вход с устройства: ${detectDeviceName(request)}`]);
      } catch (e) { /* non-critical */ }

      return {
        status: 'ok',
        token,
        user: {
          id: user.id,
          login: user.login,
          name: user.name,
          role: user.role,
          permissions,
          menu_settings: menuSettings
        }
      };
    } catch (err) {
      fastify.log.error('WebAuthn auth verify error:', err.message);
      return reply.code(400).send({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // CREDENTIAL MANAGEMENT — requires auth
  // ══════════════════════════════════════════════════════════════════════

  // GET /credentials — list user's registered devices
  fastify.get('/credentials', { preHandler: [fastify.authenticate] }, async (request) => {
    const res = await db.query(
      'SELECT id, device_name, created_at, last_used_at FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at DESC',
      [request.user.id]
    );
    return { credentials: res.rows };
  });

  // DELETE /credentials/:id — remove a device
  fastify.delete('/credentials/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const res = await db.query(
      'DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2 RETURNING id',
      [request.params.id, request.user.id]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'Not found' });
    return { success: true };
  });

  // PATCH /credentials/:id — rename a device
  fastify.patch('/credentials/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { device_name } = request.body || {};
    if (!device_name) return reply.code(400).send({ error: 'device_name is required' });

    const res = await db.query(
      'UPDATE webauthn_credentials SET device_name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, device_name',
      [device_name.trim().slice(0, 255), request.params.id, request.user.id]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'Not found' });
    return { success: true, credential: res.rows[0] };
  });

  // ── Helper: detect device name from User-Agent ──
  function detectDeviceName(request) {
    const ua = (request.headers['user-agent'] || '');
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Устройство';
  }
}

module.exports = routes;
