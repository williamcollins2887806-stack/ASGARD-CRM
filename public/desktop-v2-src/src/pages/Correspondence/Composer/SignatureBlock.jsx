/**
 * SignatureBlock.jsx — переключатели «подпись / печать» + превью PNG.
 *
 * Контракт §1 (signature_on, stamp_on колонки в V252). При генерации DOCX/PDF
 * (renderLetterUrl) флаги передаются через query, бекенд при false подставляет
 * пустой буфер вместо PNG.
 *
 * Файлы подписи/печати лежат на бекенде (templates/ или public/assets/img/).
 * Здесь — лёгкие тумблеры, превью миниатюрами 80×40.
 */
export function SignatureBlock({ draft, onChange, disabled }) {
  const sigOn   = draft.signature_on !== false;  // default true
  const stampOn = draft.stamp_on     !== false;  // default true

  const Toggle = ({ checked, onChange: handle, label }) => (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none'
      }}
    >
      <span
        style={{
          width: 36, height: 20,
          background: checked ? 'var(--ok)' : 'var(--bg4, var(--brd))',
          borderRadius: 10,
          position: 'relative',
          transition: 'background var(--fast)',
          flexShrink: 0
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 16, height: 16,
            background: 'var(--bg1)',
            borderRadius: '50%',
            transition: 'left var(--fast)',
            boxShadow: 'var(--shadow-sm)'
          }}
        />
      </span>
      <span style={{ fontSize: 13, color: 'var(--t-1)' }}>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => !disabled && handle(e.target.checked)}
        style={{ display: 'none' }}
      />
    </label>
  );

  return (
    <div
      className="col gap-10"
      style={{
        padding: 12,
        background: 'var(--inner-bg, var(--bg2))',
        border: '1px solid var(--brd-2, var(--brd))',
        borderRadius: 'var(--r-sm)'
      }}
    >
      <div style={{
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 1,
        color: 'var(--t-3)'
      }}>
        Подпись и печать
      </div>

      <div className="u-flex" style={{ flexWrap: 'wrap', gap: 16 }}>
        <Toggle
          checked={sigOn}
          onChange={(v) => onChange({ signature_on: v })}
          label="Подпись"
        />
        <Toggle
          checked={stampOn}
          onChange={(v) => onChange({ stamp_on: v })}
          label="Печать"
        />
      </div>

      <div className="u-flex" style={{ gap: 12, marginTop: 4 }}>
        <div
          title="Превью PNG-подписи"
          style={{
            width: 110, height: 48,
            background: 'var(--bg1)',
            border: '1px dashed var(--brd-2, var(--brd))',
            borderRadius: 'var(--r-sm)',
            overflow: 'hidden',
            position: 'relative'
          }}
        >
          {sigOn ? (
            <img
              src="/assets/img/signature.png"
              alt="signature.png"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <span style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: 'var(--t-3)'
            }}>
              без подписи
            </span>
          )}
        </div>
        <div
          title="Превью PNG-печати"
          style={{
            width: 64, height: 64,
            background: 'var(--bg1)',
            border: '1px dashed var(--brd-2, var(--brd))',
            borderRadius: 'var(--r-sm)',
            overflow: 'hidden',
            position: 'relative'
          }}
        >
          {stampOn ? (
            <img
              src="/assets/img/stamp.png"
              alt="stamp.png"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <span style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: 'var(--t-3)'
            }}>
              без печати
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
