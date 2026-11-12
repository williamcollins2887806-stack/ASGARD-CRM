/**
 * Телеметрия зала ТВ → thing_client_metrics.
 *
 * Тот же формат, что у веб-/ting-tv/: surface='tv', packetsLost — дельта
 * между сэмплами (накопительный счётчик WebRTC иначе врёт). Без этого
 * в таблице нет ни одной строки с телека, и выводы о качестве — «на глаз».
 *
 * PC берём из внутренностей LiveKit (engine.pcManager): публичного API нет,
 * путь стабилен в 2.x. Если SDK сменит структуру — цикл молча отключится,
 * звонок не пострадает.
 */
import { API_BASE, ENDPOINTS } from './api';

function num(v) {
  return typeof v === 'number' && isFinite(v);
}

/** publisher / subscriber PCTransport из LiveKit Room. */
export function peerTransports(room) {
  try {
    const engine = room && room.engine;
    const pcm = engine && engine.pcManager;
    const pub = pcm && pcm.publisher ? pcm.publisher : null;
    const sub = pcm && pcm.subscriber ? pcm.subscriber : null;
    return { pub, sub };
  } catch (_) {
    return { pub: null, sub: null };
  }
}

async function readReport(transport) {
  if (!transport) return null;
  try {
    if (typeof transport.getStats === 'function') {
      const report = await transport.getStats();
      return report || null;
    }
    const pc = transport._pc || transport.pc;
    if (pc && typeof pc.getStats === 'function') {
      return await pc.getStats();
    }
  } catch (_) { /* */ }
  return null;
}

/**
 * Нормализованный сэмпл для INSERT в thing_client_metrics.
 * lastLostRef — { value } между вызовами, чтобы слать дельту packetsLost.
 */
export async function collectSample(pubTransport, subTransport, lastLostRef) {
  const out = {
    width: null,
    height: null,
    fps: null,
    bitrateKbps: null,
    packetsLost: null,
    jitterMs: null,
    freezeCount: null,
    rttMs: null,
    icePair: null,
    limiter: null,
    codec: null,
    ts: new Date().toISOString(),
  };

  const pubReport = await readReport(pubTransport);
  const subReport = await readReport(subTransport);

  if (pubReport && typeof pubReport.forEach === 'function') {
    pubReport.forEach((s) => {
      if (s.type === 'outbound-rtp' && s.kind === 'video') {
        if (s.qualityLimitationReason) out.limiter = String(s.qualityLimitationReason);
        if (num(s.frameWidth)) out.width = s.frameWidth;
        if (num(s.frameHeight)) out.height = s.frameHeight;
        if (num(s.framesPerSecond)) out.fps = Math.round(s.framesPerSecond);
        if (num(s.targetBitrate)) out.bitrateKbps = Math.round(s.targetBitrate / 1000);
      }
      if (s.type === 'candidate-pair' && (s.selected || s.nominated || s.state === 'succeeded')) {
        if (num(s.currentRoundTripTime)) out.rttMs = Math.round(s.currentRoundTripTime * 1000);
        const loc = pubReport.get && pubReport.get(s.localCandidateId);
        if (loc && !out.icePair) {
          out.icePair = String(loc.candidateType || '?') + '/' + String(loc.protocol || '?');
        }
      }
    });
  }

  if (subReport && typeof subReport.forEach === 'function') {
    subReport.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') {
        if (num(s.packetsLost)) {
          const prev = lastLostRef ? lastLostRef.value : null;
          if (lastLostRef) lastLostRef.value = s.packetsLost;
          out.packetsLost = prev == null ? null : Math.max(0, s.packetsLost - prev);
        }
        if (num(s.jitter)) out.jitterMs = Math.round(s.jitter * 1000);
        if (num(s.freezeCount)) out.freezeCount = s.freezeCount;
        if (out.width == null && num(s.frameWidth)) out.width = s.frameWidth;
        if (out.height == null && num(s.frameHeight)) out.height = s.frameHeight;
        if (out.fps == null && num(s.framesPerSecond)) out.fps = Math.round(s.framesPerSecond);
        const codec = s.codecId && subReport.get && subReport.get(s.codecId);
        if (codec && codec.mimeType) {
          const m = /video\/([a-z0-9]+)/i.exec(String(codec.mimeType));
          if (m) out.codec = m[1].toLowerCase();
        }
      }
      if (s.type === 'candidate-pair' && (s.selected || s.nominated || s.state === 'succeeded')) {
        if (out.rttMs == null && num(s.currentRoundTripTime)) {
          out.rttMs = Math.round(s.currentRoundTripTime * 1000);
        }
        if (!out.icePair) {
          const locSub = subReport.get && subReport.get(s.localCandidateId);
          if (locSub) {
            out.icePair = String(locSub.candidateType || '?') + '/' + String(locSub.protocol || '?');
          }
        }
      }
    });
  }

  return out;
}

async function flushBatch(code, identity, batch) {
  if (!code || !batch || !batch.length) return;
  try {
    await fetch(API_BASE + ENDPOINTS.clientLog(code), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: identity || '',
        surface: 'tv',
        device_class: 'tv',
        samples: batch.slice(0, 20),
      }),
    });
  } catch (_) { /* офлайн — не критично */ }
}

/**
 * Запускает цикл: сэмпл каждые 5 с, flush при ≥12 сэмплах (~60 с).
 * Возвращает stop() — с финальным flush.
 */
export function startTvMetrics({ room, code, identity }) {
  const buf = [];
  const lastLost = { value: null };
  let timer = null;
  let stopped = false;

  async function sample() {
    if (stopped || !room) return;
    try {
      const pcs = peerTransports(room);
      if (!pcs.pub && !pcs.sub) return;
      const s = await collectSample(pcs.pub, pcs.sub, lastLost);
      if (stopped) return;
      buf.push(s);
      if (buf.length > 60) buf.splice(0, buf.length - 60);
    } catch (_) { /* */ }
  }

  function flush() {
    if (!buf.length) return;
    const batch = buf.splice(0, buf.length);
    flushBatch(code, identity, batch);
  }

  sample();
  timer = setInterval(() => {
    if (stopped) return;
    sample().then(() => {
      if (buf.length >= 12) flush();
    });
  }, 5000);

  return function stop() {
    stopped = true;
    if (timer) {
      try { clearInterval(timer); } catch (_) { /* */ }
      timer = null;
    }
    flush();
  };
}
