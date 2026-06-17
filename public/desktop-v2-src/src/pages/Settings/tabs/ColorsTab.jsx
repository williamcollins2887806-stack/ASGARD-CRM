/**
 * Settings → таб «Цвета статусов»: офис и рабочие (для календарей).
 */
const OFFICE_STATUS = [
  { code: 'оф', label: 'В офисе' },
  { code: 'уд', label: 'Удалёнка' },
  { code: 'бн', label: 'Больничный' },
  { code: 'сс', label: 'За свой счёт' },
  { code: 'км', label: 'Командировка' },
  { code: 'пг', label: 'Встреча/переговоры' },
  { code: 'уч', label: 'Учёба' },
  { code: 'ск', label: 'Склад' },
  { code: 'вх', label: 'Выходной' }
];

const WORKER_STATUS = [
  { code: 'free',   label: 'Свободен' },
  { code: 'office', label: 'Офис' },
  { code: 'trip',   label: 'Командировка' },
  { code: 'work',   label: 'Работа (контракт)' },
  { code: 'note',   label: 'Заметка' }
];

const DEFAULT_OFFICE = {
  оф: '#5fb3ff', уд: '#8c8df8', бн: '#ff8a80', сс: '#d4af37',
  км: '#7bd389', пг: '#f0a955', уч: '#b388ff', ск: '#80cbc4', вх: '#9aa0a6'
};
const DEFAULT_WORKER = {
  free: '#9aa0a6', office: '#5fb3ff', trip: '#f0a955', work: '#7bd389', note: '#d4af37'
};

function isHex(v) {
  return /^#([0-9a-fA-F]{6})$/.test(String(v || '').trim());
}

function ColorRow({ code, label, value, onChange }) {
  return (
    <div className="sett-color-row">
      <label>
        {label} <span className="muted">({code})</span>
      </label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (isHex(v) || v === '' || v.startsWith('#')) onChange(v);
        }}
      />
    </div>
  );
}

export default function ColorsTab({ app, setApp }) {
  const sc = app.status_colors || {};
  const off = { ...DEFAULT_OFFICE, ...(sc.office || {}) };
  const wk = { ...DEFAULT_WORKER, ...(sc.workers || {}) };

  const setOff = (code, v) =>
    setApp((a) => ({
      ...a,
      status_colors: {
        ...(a.status_colors || {}),
        office: { ...((a.status_colors || {}).office || {}), [code]: v }
      }
    }));
  const setWk = (code, v) =>
    setApp((a) => ({
      ...a,
      status_colors: {
        ...(a.status_colors || {}),
        workers: { ...((a.status_colors || {}).workers || {}), [code]: v }
      }
    }));

  return (
    <div className="sett-grid">
      <div className="sett-card">
        <h3>🎨 Офис</h3>
        <p className="sett-hint">
          Цвета статусов в календаре «Офис». Меняются локально и сразу.
        </p>
        <div className="col gap-4">
          {OFFICE_STATUS.map((it) => (
            <ColorRow
              key={it.code}
              code={it.code}
              label={it.label}
              value={off[it.code] || DEFAULT_OFFICE[it.code]}
              onChange={(v) => setOff(it.code, v)}
            />
          ))}
        </div>
      </div>

      <div className="sett-card">
        <h3>🎨 Рабочие</h3>
        <p className="sett-hint">Цвета статусов в календаре «Рабочие».</p>
        <div className="col gap-4">
          {WORKER_STATUS.map((it) => (
            <ColorRow
              key={it.code}
              code={it.code}
              label={it.label}
              value={wk[it.code] || DEFAULT_WORKER[it.code]}
              onChange={(v) => setWk(it.code, v)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
