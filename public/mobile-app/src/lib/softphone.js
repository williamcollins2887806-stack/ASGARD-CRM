import JsSIP from 'jssip';
import { api } from '@/api/client';

const PASS_KEY = (user) => `asgard_sip_pass_${user}`;

function wsUrlFromCreds(creds) {
  let ws = creds.ws_url || '/pbx/ws';
  if (ws.startsWith('/')) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = `${proto}//${window.location.host}${ws}`;
  }
  return ws;
}

function sipDomainFromWs(ws) {
  try {
    return new URL(ws.replace(/^ws/, 'http')).hostname;
  } catch {
    return window.location.hostname;
  }
}

function pickNumber(meta = {}, session) {
  return (
    meta.from_number ||
    meta.from ||
    meta.fromNumber ||
    meta.number ||
    (session && session.remote_identity && session.remote_identity.uri && session.remote_identity.uri.user) ||
    ''
  );
}

export function createMobileSoftphone({ onIncoming, onHangup, onState } = {}) {
  let ua = null;
  let activeSession = null;
  let remoteAudioEl = null;
  let callMeta = {};
  let state = 'idle';

  function setState(s) {
    state = s;
    onState && onState(s);
  }

  function attachRemote(session) {
    const pc = session.connection;
    if (!pc) return;
    const bind = (stream) => {
      if (remoteAudioEl) {
        remoteAudioEl.srcObject = stream;
        remoteAudioEl.play && remoteAudioEl.play().catch(() => {});
      }
    };
    pc.addEventListener('track', (ev) => {
      if (ev.streams && ev.streams[0]) bind(ev.streams[0]);
    });
  }

  function bindSession(session) {
    activeSession = session;
    attachRemote(session);
    session.on('ended', () => {
      activeSession = null;
      callMeta = {};
      setState('registered');
      onHangup && onHangup();
    });
    session.on('failed', () => {
      activeSession = null;
      callMeta = {};
      setState('registered');
      onHangup && onHangup();
    });
    session.on('accepted', () => setState('in_call'));
    session.on('confirmed', () => setState('in_call'));
  }

  function startUA(creds) {
    if (ua) {
      try { ua.stop(); } catch { /* ignore */ }
      ua = null;
    }
    const ws = wsUrlFromCreds(creds);
    const domain = sipDomainFromWs(ws);
    const socket = new JsSIP.WebSocketInterface(ws);
    const configuration = {
      sockets: [socket],
      uri: `sip:${creds.sip_username}@${domain}`,
      password: creds.sip_password || '',
      register: true,
      session_timers: false,
    };
    if (creds.stun) {
      configuration.pcConfig = { iceServers: [{ urls: creds.stun }] };
    }
    ua = new JsSIP.UA(configuration);
    ua.on('registered', () => {
      setState('registered');
      api.post('/telephony/pbx/operator/webrtc', { registered: true }).catch(() => {});
    });
    ua.on('unregistered', () => {
      api.post('/telephony/pbx/operator/webrtc', { registered: false }).catch(() => {});
    });
    ua.on('newRTCSession', (data) => {
      const session = data.session;
      if (data.originator === 'remote') {
        bindSession(session);
        const number = pickNumber(callMeta, session);
        callMeta = { ...callMeta, number, direction: 'inbound' };
        setState('ringing');
        onIncoming && onIncoming({ ...callMeta, number });
      } else {
        bindSession(session);
      }
    });
    ua.start();
  }

  async function resolveCreds() {
    let creds = await api.get('/telephony/pbx/softphone/credentials');
    const cached = creds.sip_username ? localStorage.getItem(PASS_KEY(creds.sip_username)) : null;
    if (!creds.sip_password && cached) {
      creds = { ...creds, sip_password: cached };
    }
    if (!creds.sip_password) {
      creds = await api.get('/telephony/pbx/softphone/credentials?regenerate=1');
    }
    if (creds.sip_username && creds.sip_password) {
      localStorage.setItem(PASS_KEY(creds.sip_username), creds.sip_password);
    }
    return creds;
  }

  return {
    setRemoteAudioEl(el) {
      remoteAudioEl = el;
    },
    applyIncoming(meta) {
      callMeta = { ...callMeta, ...meta };
      const number = pickNumber(callMeta);
      callMeta.number = number;
      callMeta.pbx_uid = meta.pbx_uid || (meta.call_id ? String(meta.call_id).replace(/^pbx_/, '') : callMeta.pbx_uid);
      setState('ringing');
      onIncoming && onIncoming(callMeta);
      return callMeta;
    },
    async goOnline(receiveMode = 'browser') {
      const mode = receiveMode === 'mobile' ? 'mobile' : (receiveMode === 'both' ? 'both' : 'browser');
      const creds = await resolveCreds();
      await api.post('/telephony/pbx/operator/status', { on_line: true, receive_mode: mode });
      startUA(creds);
      setState('connecting');
      return { ok: true };
    },
    async goOffline() {
      try {
        await api.post('/telephony/pbx/operator/status', { on_line: false });
      } catch { /* ignore */ }
      try {
        if (activeSession) activeSession.terminate();
      } catch { /* ignore */ }
      activeSession = null;
      if (ua) {
        try { ua.stop(); } catch { /* ignore */ }
        ua = null;
      }
      setState('idle');
      return { ok: true };
    },
    async answer() {
      if (activeSession) {
        activeSession.answer({ mediaConstraints: { audio: true, video: false } });
      }
      await api.post('/telephony/pbx/call/answer', {
        channel: callMeta.channel,
        pbx_uid: callMeta.pbx_uid,
        call_id: callMeta.call_id,
      }).catch(() => {});
      setState('in_call');
      return { ok: true };
    },
    hangup() {
      try {
        if (activeSession) activeSession.terminate();
      } catch { /* ignore */ }
      api.post('/telephony/pbx/call/hangup', { channel: callMeta.channel }).catch(() => {});
      setState(ua ? 'registered' : 'idle');
      onHangup && onHangup();
    },
    stopLocal() {
      try {
        if (activeSession) activeSession.terminate();
      } catch { /* ignore */ }
      activeSession = null;
      if (ua) {
        try { ua.stop(); } catch { /* ignore */ }
        ua = null;
      }
    },
    getState() {
      return state;
    },
  };
}
