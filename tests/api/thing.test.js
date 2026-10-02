/**
 * THING — Тинг API (V361)
 */
const { api, assert, assertOk } = require('../config');

let roomId = null;
let slug = null;

module.exports = {
  name: 'THING (Тинг)',
  tests: [
    {
      name: 'Health endpoint',
      run: async () => {
        const resp = await api('GET', '/api/thing/health');
        assertOk(resp, 'thing health');
        assert(resp.data && resp.data.ok === true, 'ok flag');
      }
    },
    {
      name: 'ADMIN creates instant Ting with dial_code',
      run: async () => {
        const resp = await api('POST', '/api/thing/rooms', {
          role: 'ADMIN',
          body: {
            title: 'API Ting ' + Date.now(),
            mode: 'instant',
            protocol_enabled: true
          }
        });
        assertOk(resp, 'create thing');
        assert(resp.data.room, 'room payload');
        assert(/^[0-9]{6}$/.test(resp.data.room.dial_code), 'dial_code 6 digits got ' + resp.data.room.dial_code);
        assert(resp.data.room.slug, 'slug');
        assert(resp.data.room.protocol_enabled === true, 'protocol_enabled');
        roomId = resp.data.room.id;
        slug = resp.data.room.slug;
      }
    },
    {
      name: 'Public card hides dial_code',
      run: async () => {
        assert(slug, 'slug from create');
        const resp = await api('GET', `/api/thing/public/${slug}`);
        assertOk(resp, 'public');
        assert(!('dial_code' in resp.data), 'no dial_code on public');
      }
    },
    {
      name: 'Token without LiveKit returns 503 (honest)',
      run: async () => {
        assert(roomId, 'roomId');
        const resp = await api('POST', `/api/thing/rooms/${roomId}/token`, { role: 'ADMIN', body: {} });
        // 200 if LiveKit configured, 503 if not — both valid
        assert(resp.status === 200 || resp.status === 503, 'token status ' + resp.status);
        if (resp.status === 503) {
          assert(resp.data.code === 'LIVEKIT_NOT_CONFIGURED', 'LIVEKIT_NOT_CONFIGURED');
        }
      }
    },
    {
      name: 'Host ends Ting',
      run: async () => {
        assert(roomId, 'roomId');
        const resp = await api('POST', `/api/thing/rooms/${roomId}/end`, { role: 'ADMIN', body: {} });
        assertOk(resp, 'end');
        assert(resp.data.room.status === 'ended', 'ended');
      }
    },
    {
      name: 'protocol_enabled=false → skipped on end',
      run: async () => {
        const resp = await api('POST', '/api/thing/rooms', {
          role: 'ADMIN',
          body: { title: 'No proto ' + Date.now(), protocol_enabled: false }
        });
        assertOk(resp, 'create no proto');
        const end = await api('POST', `/api/thing/rooms/${resp.data.room.id}/end`, { role: 'ADMIN', body: {} });
        assertOk(end, 'end no proto');
        assert(
          end.data.protocol.protocol === 'skipped' || end.data.protocol.protocol === 'no_recording',
          'skipped branch'
        );
      }
    },
    {
      name: 'Meeting create with ting flag',
      run: async () => {
        const start = new Date(Date.now() + 3600000).toISOString();
        const resp = await api('POST', '/api/meetings', {
          role: 'ADMIN',
          body: {
            title: 'Meeting+Ting ' + Date.now(),
            start_time: start,
            create_thing: true,
            protocol_enabled: true,
            send_invites: false
          }
        });
        assertOk(resp, 'meeting+ting');
        assert(resp.data.thing && resp.data.thing.dial_code, 'thing on meeting');
        assert(/^[0-9]{6}$/.test(resp.data.thing.dial_code), 'meeting dial_code');
      }
    }
  ]
};
