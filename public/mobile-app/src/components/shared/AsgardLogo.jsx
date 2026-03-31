/**
 * AsgardLogo — настоящий логотип ASGARD CRM
 * Использует /asgard-logo.png (треугольник A + CRM)
 * Размеры: sm (40) / md (64) / lg (100)
 */

const SIZES = { sm: 40, md: 64, lg: 100 };

export function AsgardLogo({ size = 'md', animate = true, className = '' }) {
  const px = SIZES[size] || SIZES.md;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{
        width: px,
        height: px,
        animation: animate ? 'goldGlowPulse 3s ease-in-out infinite' : 'none',
      }}
    >
      <img
        src={import.meta.env.BASE_URL + 'asgard-logo.png'}
        alt="ASGARD CRM"
        draggable={false}
        style={{
          width: px,
          height: 'auto',
          userSelect: 'none',
          filter: animate
            ? 'drop-shadow(0 0 12px rgba(200, 41, 59, 0.2))'
            : 'none',
        }}
      />

      {/* Shimmer overlay */}
      {animate && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.15) 50%, transparent 60%)',
              animation: 'logoShimmer 3s ease-in-out infinite',
            }}
          />
        </div>
      )}
    </div>
  );
}
