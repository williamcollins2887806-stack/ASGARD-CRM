import { useState, useRef, useMemo } from 'react';
import { Play, Pause } from 'lucide-react';

/**
 * VoicePlayer — голосовое сообщение с waveform bars
 */
export function VoicePlayer({ fileUrl, duration, isMine }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef(null);

  // Pseudo-random bars from URL hash
  const bars = useMemo(() => {
    const seed = (fileUrl || '').length;
    return Array.from({ length: 20 }, (_, i) => {
      const v = Math.sin(seed * 0.1 + i * 0.7) * 0.5 + 0.5;
      return 8 + v * 20;
    });
  }, [fileUrl]);

  const formatDur = (sec) => {
    const s = Math.round(sec || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(fileUrl);
      audioRef.current.addEventListener('timeupdate', () => {
        const a = audioRef.current;
        if (a.duration) setProgress(a.currentTime / a.duration);
      });
      audioRef.current.addEventListener('ended', () => {
        setPlaying(false);
        setProgress(0);
      });
    }
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setPlaying(!playing);
  };

  const filledBars = Math.floor(progress * bars.length);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggle}
        className="shrink-0 flex items-center justify-center rounded-full"
        style={{
          width: 36,
          height: 36,
          background: isMine ? 'rgba(255,255,255,0.15)' : 'var(--bg-elevated)',
          color: isMine ? '#fff' : 'var(--text-primary)',
        }}
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>

      <div className="flex items-end gap-[1px]">
        {bars.map((h, i) => (
          <div
            key={i}
            className="rounded-full"
            style={{
              width: 3,
              height: h,
              background:
                i < filledBars
                  ? isMine
                    ? '#fff'
                    : 'var(--blue)'
                  : isMine
                    ? 'rgba(255,255,255,0.3)'
                    : 'var(--text-tertiary)',
              transition: 'background 100ms ease',
            }}
          />
        ))}
      </div>

      <span
        className="text-[11px] ml-1 shrink-0"
        style={{ color: isMine ? 'rgba(255,255,255,0.6)' : 'var(--text-tertiary)' }}
      >
        {formatDur(duration)}
      </span>
    </div>
  );
}
