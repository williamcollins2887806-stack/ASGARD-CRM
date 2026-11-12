/**
 * Чистая проверка формата сэмпла и дельты packetsLost — без LiveKit/RN.
 */
import { collectSample } from '../src/tvMetrics';

function fakeReport(entries) {
  const map = new Map(entries.map((e) => [e.id || e.type + Math.random(), e]));
  return {
    forEach: (fn) => map.forEach(fn),
    get: (id) => map.get(id),
  };
}

function fakeTransport(report) {
  return { getStats: async () => report };
}

describe('tvMetrics.collectSample', () => {
  it('берёт outbound fps/limiter и inbound packetsLost как дельту', async () => {
    const pub = fakeTransport(fakeReport([
      {
        id: 'out1', type: 'outbound-rtp', kind: 'video',
        frameWidth: 1280, frameHeight: 720, framesPerSecond: 29.7,
        targetBitrate: 1700000, qualityLimitationReason: 'bandwidth',
      },
      {
        id: 'cp1', type: 'candidate-pair', state: 'succeeded', selected: true,
        currentRoundTripTime: 0.042, localCandidateId: 'loc1',
      },
      { id: 'loc1', type: 'local-candidate', candidateType: 'relay', protocol: 'udp' },
    ]));
    const sub = fakeTransport(fakeReport([
      {
        id: 'in1', type: 'inbound-rtp', kind: 'video',
        packetsLost: 10, jitter: 0.012, freezeCount: 2, codecId: 'c1',
      },
      { id: 'c1', type: 'codec', mimeType: 'video/H264' },
    ]));

    const lastLost = { value: null };
    const first = await collectSample(pub, sub, lastLost);
    expect(first.width).toBe(1280);
    expect(first.height).toBe(720);
    expect(first.fps).toBe(30);
    expect(first.bitrateKbps).toBe(1700);
    expect(first.limiter).toBe('bandwidth');
    expect(first.rttMs).toBe(42);
    expect(first.icePair).toBe('relay/udp');
    expect(first.codec).toBe('h264');
    expect(first.freezeCount).toBe(2);
    expect(first.packetsLost).toBeNull(); /* первый сэмпл — база, не дельта */

    const sub2 = fakeTransport(fakeReport([
      {
        id: 'in1', type: 'inbound-rtp', kind: 'video',
        packetsLost: 15, jitter: 0.01, freezeCount: 3,
      },
    ]));
    const second = await collectSample(pub, sub2, lastLost);
    expect(second.packetsLost).toBe(5);
  });
});
