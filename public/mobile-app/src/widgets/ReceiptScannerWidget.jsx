import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * ReceiptScannerWidget — сканер чеков (камера)
 * NO API, запрашивает доступ к камере через navigator.mediaDevices
 */
export default function ReceiptScannerWidget() {
  const handleTap = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      // Остановить все треки — камера не нужна дальше
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      console.log('Камера недоступна:', err);
    }
  };

  return (
    <WidgetShell name="Сканер чеков" icon="📷">
      <button
        className="w-full flex items-center gap-3 spring-tap"
        onClick={handleTap}
      >
        {/* Icon container */}
        <div
          className="shrink-0 flex items-center justify-center rounded-xl"
          style={{
            width: 48,
            height: 48,
            backgroundColor: 'rgba(198,40,40,0.1)',
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>📷</span>
        </div>

        {/* Text */}
        <div className="flex flex-col text-left">
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            Сканер чеков
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
              marginTop: 2,
            }}
          >
            Нажмите для сканирования
          </span>
        </div>
      </button>
    </WidgetShell>
  );
}
