/**
 * EmptyState — красивое пустое состояние
 * Анимированная иконка, заголовок, описание, CTA
 * Floating rune particles
 */

const RUNES = ['ᚱ', 'ᚨ', 'ᚷ', 'ᚾ', 'ᛟ', 'ᚲ', 'ᛏ', 'ᛒ'];

export function EmptyState({
  icon: Icon,
  iconColor = 'var(--gold)',
  iconBg = 'var(--gold-glow)',
  title,
  description,
  badge,
  children,
}) {
  return (
    <div className="flex flex-col items-center justify-center pt-12 pb-8 relative overflow-hidden">
      {/* Floating rune particles */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {RUNES.slice(0, 5).map((rune, i) => (
          <span
            key={i}
            className="rune-particle"
            style={{
              left: `${15 + i * 18}%`,
              bottom: '10%',
              animationDelay: `${i * 0.8}s`,
              animationDuration: `${3.5 + i * 0.5}s`,
              fontSize: `${14 + i * 2}px`,
            }}
          >
            {rune}
          </span>
        ))}
      </div>

      {/* Icon container */}
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5 relative"
        style={{
          backgroundColor: iconBg,
          animation: 'fadeInUp var(--motion-slow) var(--ease-spring) forwards',
        }}
      >
        {Icon && <Icon size={36} style={{ color: iconColor }} />}
        {/* Subtle glow ring */}
        <div
          className="absolute inset-[-4px] rounded-3xl"
          style={{
            border: `1.5px solid color-mix(in srgb, ${iconColor} 15%, transparent)`,
            animation: 'pulseGold 3s ease-in-out infinite',
          }}
        />
      </div>

      {/* Title */}
      <h3
        className="text-lg font-bold mb-1.5"
        style={{
          color: 'var(--text-primary)',
          animation: 'fadeInUp var(--motion-slow) var(--ease-enter) 100ms both',
        }}
      >
        {title}
      </h3>

      {/* Description */}
      <p
        className="text-sm text-center max-w-[260px] leading-relaxed"
        style={{
          color: 'var(--text-secondary)',
          animation: 'fadeInUp var(--motion-slow) var(--ease-enter) 200ms both',
        }}
      >
        {description}
      </p>

      {/* Badge */}
      {badge && (
        <div
          className="mt-4 px-4 py-1.5 rounded-full text-xs font-semibold"
          style={{
            background: 'var(--gold-gradient)',
            color: '#fff',
            animation: 'fadeInUp var(--motion-slow) var(--ease-spring) 300ms both',
            boxShadow: '0 2px 12px rgba(200, 168, 78, 0.3)',
          }}
        >
          {badge}
        </div>
      )}

      {/* CTA / children */}
      {children && (
        <div
          style={{
            animation: 'fadeInUp var(--motion-slow) var(--ease-enter) 400ms both',
          }}
          className="mt-5"
        >
          {children}
        </div>
      )}
    </div>
  );
}
