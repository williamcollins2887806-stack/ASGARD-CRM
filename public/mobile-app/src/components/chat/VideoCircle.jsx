import { useState, useRef } from 'react';
import { Play } from 'lucide-react';

/**
 * VideoCircle — круглый видеоплеер 180×180
 */
export function VideoCircle({ fileUrl, duration }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef(null);

  const toggle = () => {
    if (!videoRef.current) return;
    if (playing) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(() => {});
    }
    setPlaying(!playing);
  };

  const formatDur = (sec) => {
    const s = Math.round(sec || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div
      className="relative overflow-hidden cursor-pointer"
      onClick={toggle}
      style={{
        width: 180,
        height: 180,
        borderRadius: '50%',
        border: '2px solid var(--red)',
      }}
    >
      <video
        ref={videoRef}
        src={fileUrl}
        playsInline
        loop
        muted
        className="w-full h-full object-cover"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      {/* Play overlay */}
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <div
            className="flex items-center justify-center rounded-full"
            style={{
              width: 44,
              height: 44,
              background: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(4px)',
            }}
          >
            <Play size={22} color="#fff" className="ml-0.5" />
          </div>
        </div>
      )}

      {/* Duration badge */}
      <div
        className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
        style={{
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
        }}
      >
        {formatDur(duration)}
      </div>
    </div>
  );
}
