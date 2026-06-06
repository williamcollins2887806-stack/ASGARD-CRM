/**
 * QRScanner.jsx — Сканер QR через нативный BarcodeDetector (Android Chrome/WebView).
 * Без сторонних библиотек. Если API недоступен — fallback на ручной ввод кода.
 * Используется для скана паллетов, ячеек, EAN-штрихкодов.
 */
import { useState, useEffect, useRef } from 'react';
import { X, Keyboard, ScanLine } from 'lucide-react';

export default function QRScanner({ onScan, onClose, title = 'Сканирование' }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [supported, setSupported] = useState(true);
  const [manual, setManual] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    let detector = null, stopped = false;
    async function start() {
      if (!('BarcodeDetector' in window)) { setSupported(false); return; }
      try {
        // eslint-disable-next-line no-undef
        detector = new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128'] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length) { handle(codes[0].rawValue); return; }
          } catch (_) {}
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) { setError('Нет доступа к камере'); setSupported(false); }
    }
    function handle(value) {
      stopped = true;
      cleanup();
      if (navigator.vibrate) navigator.vibrate(40);
      onScan(value);
    }
    function cleanup() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    }
    start();
    return () => { stopped = true; cleanup(); };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#000' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ background: 'rgba(0,0,0,.6)' }}>
        <span className="font-semibold text-white">{title}</span>
        <button onClick={onClose} className="p-2 rounded-xl active:scale-90"><X size={24} color="#fff" /></button>
      </div>

      {supported ? (
        <div className="flex-1 relative flex items-center justify-center overflow-hidden">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          {/* рамка прицела */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative" style={{ width: 240, height: 240 }}>
              <div className="absolute inset-0 rounded-2xl" style={{ border: '3px solid rgba(240,200,80,.9)', boxShadow: '0 0 0 9999px rgba(0,0,0,.45)' }} />
              <div className="absolute left-0 right-0 h-0.5" style={{ background: '#F0C850', animation: 'scanline 2s linear infinite', boxShadow: '0 0 10px #F0C850' }} />
            </div>
          </div>
          <div className="absolute bottom-6 inset-x-0 text-center text-white/70 text-sm">Наведите на QR-код</div>
          <style>{`@keyframes scanline{0%{top:0}50%{top:100%}100%{top:0}}`}</style>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
          <Keyboard size={48} className="opacity-40" color="#fff" />
          <div className="text-center text-white/70 text-sm">
            {error || 'Камера недоступна'}. Введите код вручную:
          </div>
          <input autoFocus value={manual} onChange={e => setManual(e.target.value)} placeholder="Код с этикетки"
            className="w-full max-w-xs px-4 py-3 rounded-xl text-base outline-none text-center"
            style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(240,200,80,.3)', color: '#fff' }} />
          <button onClick={() => manual.trim() && onScan(manual.trim())}
            className="px-6 py-3 rounded-xl font-bold active:scale-95 transition flex items-center gap-2"
            style={{ background: '#F0C850', color: '#1a1408' }}><ScanLine size={18} />Применить</button>
        </div>
      )}
    </div>
  );
}
