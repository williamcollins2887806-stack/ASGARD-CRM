/**
 * RAF pour timeline — continuous volume transfer + keyframe callbacks.
 */

export const POUR_DURATION_MS = 1080;
export const FAIL_TILT_MS = 280;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/**
 * @param {object} opts
 * @param {number} [opts.duration]
 * @param {boolean} [opts.fail]
 * @param {boolean} [opts.reducedMotion]
 * @param {(frame: object) => void} opts.onFrame
 * @param {() => void} [opts.onStreamPeak]
 * @param {() => void} [opts.onCommit]
 * @param {() => void} [opts.onLand]
 * @param {() => void} opts.onEnd
 */
export function startPourTimeline(opts) {
  const {
    duration = POUR_DURATION_MS,
    fail = false,
    reducedMotion = false,
    onFrame,
    onStreamPeak,
    onCommit,
    onLand,
    onEnd,
  } = opts;

  if (reducedMotion) {
    onFrame?.({
      t: 1,
      progress: 1,
      transfer: fail ? 0 : 1,
      tilt: 0,
      lift: 0,
      streamAlpha: 0,
      wave: 0,
      phase: 'end',
    });
    if (!fail) {
      onCommit?.();
      onLand?.();
    }
    onEnd?.();
    return { cancel() {} };
  }

  const total = fail ? FAIL_TILT_MS : duration;
  const t0 = performance.now();
  let raf = 0;
  let cancelled = false;
  let didPeak = false;
  let didCommit = false;
  let didLand = false;

  const tick = (now) => {
    if (cancelled) return;
    const elapsed = now - t0;
    const t = Math.min(1, elapsed / total);

    let tilt = 0;
    let lift = 0;
    let transfer = 0;
    let streamAlpha = 0;
    let wave = 0;
    let phase = 'tilt';

    if (fail) {
      const p = easeOutCubic(t);
      tilt = Math.sin(p * Math.PI) * 0.55;
      lift = Math.sin(p * Math.PI) * 14;
      phase = t < 1 ? 'tilt' : 'end';
    } else {
      // 0–20% tilt+lift, 15–75% transfer+stream, 55% commit, 75–100% settle
      if (t < 0.2) {
        const p = easeOutCubic(t / 0.2);
        tilt = p;
        lift = p * 26;
        phase = 'tilt';
      } else if (t < 0.75) {
        tilt = 1;
        lift = 26;
        const u = (t - 0.15) / 0.6;
        transfer = easeInOutCubic(Math.max(0, Math.min(1, u)));
        streamAlpha = t < 0.22 ? (t - 0.15) / 0.07 : t > 0.68 ? (0.75 - t) / 0.07 : 1;
        streamAlpha = Math.max(0, Math.min(1, streamAlpha));
        phase = 'stream';
        if (!didPeak && t >= 0.35) {
          didPeak = true;
          onStreamPeak?.();
        }
        if (!didCommit && t >= 0.55) {
          didCommit = true;
          onCommit?.();
        }
      } else {
        const p = (t - 0.75) / 0.25;
        tilt = 1 - easeInOutCubic(p);
        lift = 26 * (1 - easeInOutCubic(p));
        transfer = 1;
        streamAlpha = 0;
        wave = Math.sin(p * Math.PI) * (1 - p) * 1.65;
        phase = 'settle';
        if (!didCommit) {
          didCommit = true;
          onCommit?.();
        }
        if (!didLand && t >= 0.78) {
          didLand = true;
          onLand?.();
        }
      }
    }

    onFrame?.({
      t,
      progress: t,
      transfer,
      tilt,
      lift,
      streamAlpha,
      wave,
      phase,
    });

    if (t < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      if (!fail && !didCommit) onCommit?.();
      if (!fail && !didLand) onLand?.();
      onEnd?.();
    }
  };

  raf = requestAnimationFrame(tick);

  return {
    cancel() {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
