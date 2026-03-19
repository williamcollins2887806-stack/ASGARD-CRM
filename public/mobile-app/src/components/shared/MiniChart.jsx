/**
 * MiniChart — bar chart для динамики (напр. тендеры по месяцам)
 */
export function MiniChart({ data = [], labels = [], color = 'var(--blue)', height = 80, className = '' }) {
  const max = Math.max(...data, 1);
  const barW = 100 / (data.length || 1);

  return (
    <div className={className}>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {data.map((v, i) => {
          const pct = (v / max) * 100;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
              <div
                className="w-full rounded-t-sm"
                style={{
                  height: `${Math.max(pct, 2)}%`,
                  background: color,
                  opacity: v > 0 ? 0.85 : 0.15,
                  transition: `height 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 40}ms`,
                }}
              />
            </div>
          );
        })}
      </div>
      {labels.length > 0 && (
        <div className="flex gap-[3px] mt-1">
          {labels.map((l, i) => (
            <span
              key={i}
              className="flex-1 text-center"
              style={{ fontSize: 8, color: 'var(--text-tertiary)', fontWeight: 500 }}
            >
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
