/**
 * LessonInteractive.jsx — встроенные тренажёры внутри Руны (фаза D)
 *
 * Блок в academy_lessons.blocks:
 * {
 *   "type": "interactive",
 *   "kind": "slider" | "hotspots" | "order",
 *   "title": "...", "lead": "...",
 *   "image": "/uploads/academy/lesson-XX/foo.png",   // опционально
 *   ...payload по типу (см. ниже)
 * }
 *
 * Механики (все считаются кодом, картинка — только фон):
 *  - slider   : параметр + формула → вердикт (sling_angle | linear | ratio | scale)
 *  - hotspots : найти N целей на изображении, ведётся счёт попаданий
 *  - order    : выложить шаги в правильной последовательности
 *
 * Прогресс тренажёра хранится локально по ключу lessonId+index и не блокирует
 * чтение Руны: даже без прохождения урока лекция доступна.
 */
import { useState, useMemo, useCallback, useRef } from 'react';

const C = {
  gold: '#c8a84b', rune: '#7b61ff', green: '#22c55e', red: '#ef4444',
  amber: '#f59e0b', card: 'var(--field-card)', text: 'var(--field-text)', muted: '#8E8E93',
};

const LEVEL = {
  ok: { color: C.green, icon: '✓' },
  warn: { color: C.amber, icon: '⚠' },
  danger: { color: C.red, icon: '⛔' },
};

function doneKey(lessonId, idx) {
  return `academy_interactive_${lessonId}_${idx}`;
}

// ── Общая обвязка: заголовок + зачёт ────────────────────────────────────────

function Shell({ block, done, onDone, children, footer }) {
  return (
    <div style={{
      margin: '16px 0', background: C.card, border: `1px solid ${C.gold}33`,
      borderRadius: 16, overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8,
        background: `linear-gradient(90deg, ${C.gold}1a, transparent)`,
        borderBottom: `1px solid #ffffff10`,
      }}>
        <span style={{ fontSize: 16 }}>🎯</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.gold, textTransform: 'uppercase', letterSpacing: 1 }}>
          Тренажёр
        </span>
        {done && (
          <span style={{
            marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: C.green,
            background: `${C.green}1a`, border: `1px solid ${C.green}44`,
            borderRadius: 20, padding: '3px 9px',
          }}>
            ✓ пройден
          </span>
        )}
      </div>

      <div style={{ padding: 14 }}>
        {block.title && (
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 6 }}>{block.title}</div>
        )}
        {block.lead && (
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55, marginBottom: 14 }}>{block.lead}</div>
        )}
        {children}
        {footer}
      </div>

      {onDone && !done && (
        <button
          onClick={onDone}
          style={{
            width: '100%', padding: '12px 0', background: `${C.rune}22`,
            border: 'none', borderTop: `1px solid ${C.rune}44`,
            color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Отметить тренажёр пройденным
        </button>
      )}
    </div>
  );
}

// ── 1. SLIDER ───────────────────────────────────────────────────────────────

function computeValue(cfg, x) {
  const t = cfg.type;
  if (t === 'sling_angle') {
    // Нагрузка на одну ветвь: S = G / (n · cos(α/2)); α — угол между ветвями (°)
    const half = (x * Math.PI) / 180 / 2;
    const cos = Math.max(0.01, Math.cos(half));
    const s = cfg.load / (cfg.legs * cos);
    return { value: s, pct: (s / cfg.capacity) * 100 };
  }
  if (t === 'linear') return { value: cfg.a + cfg.b * x };
  if (t === 'ratio') return { value: cfg.a * x };
  if (t === 'scale') return { value: x * (cfg.k || 1) };
  return { value: x };
}

function verdictFor(verdicts, x, pct) {
  for (const v of verdicts || []) {
    if (v.max != null && x <= v.max) return v;
    if (v.pct_max != null && pct != null && pct <= v.pct_max) return v;
  }
  return (verdicts || [])[(verdicts || []).length - 1] || { level: 'ok', text: '' };
}

function SliderTrainer({ block }) {
  const s = block.slider || {};
  const [x, setX] = useState(Number(s.default ?? s.min ?? 0));
  const { value, pct } = useMemo(() => computeValue(s.compute || {}, x), [s.compute, x]);
  const v = verdictFor(s.verdicts, x, pct);
  const lv = LEVEL[v.level] || LEVEL.ok;
  const fill = pct != null ? Math.min(100, pct) : Math.min(100, ((x - (s.min || 0)) / ((s.max || 100) - (s.min || 0))) * 100);
  const barColor = lv.color;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: C.muted, minWidth: 92 }}>{s.label || 'Параметр'}:</span>
        <input
          type="range" min={s.min ?? 0} max={s.max ?? 100} step={s.step ?? 1} value={x}
          onChange={(e) => setX(Number(e.target.value))}
          style={{ flex: 1, accentColor: C.gold }}
        />
        <span style={{ fontSize: 15, fontWeight: 900, color: C.gold, minWidth: 58, textAlign: 'right' }}>
          {x}{s.unit || ''}
        </span>
      </div>

      <div style={{ height: 14, borderRadius: 7, background: '#ffffff12', overflow: 'hidden', marginTop: 10 }}>
        <div style={{ height: '100%', width: `${fill}%`, background: barColor, transition: 'width .25s, background .25s' }} />
      </div>

      <div style={{ marginTop: 10, fontSize: 14, fontWeight: 800, color: lv.color }}>
        {lv.icon} {v.text}
        {value != null && (
          <span style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>
            {' '}({s.resultLabel || 'значение'}: {Number(value).toFixed(2)}{s.resultUnit || ''})
          </span>
        )}
      </div>

      {s.note && <div style={{ marginTop: 8, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{s.note}</div>}
    </div>
  );
}

// ── 2. HOTSPOTS ─────────────────────────────────────────────────────────────

function HotspotsTrainer({ block }) {
  const h = block.hotspots || {};
  const points = h.points || [];
  const tol = Number(h.tolerance ?? 11); // % радиус попадания в цель
  const [found, setFound] = useState(() => new Set());
  const [miss, setMiss] = useState(0);
  const ref = useRef(null);
  const allFound = points.length > 0 && found.size === points.length;

  function onTap(e) {
    if (allFound) return;
    const box = ref.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return;
    const x = ((e.clientX - box.left) / box.width) * 100;
    const y = ((e.clientY - box.top) / box.height) * 100;
    let hit = -1;
    let best = Infinity;
    points.forEach((p, i) => {
      if (found.has(i)) return;
      const d = Math.hypot(Number(p.x) - x, Number(p.y) - y);
      if (d < best) { best = d; hit = i; }
    });
    if (hit >= 0 && best <= tol) {
      setFound((prev) => new Set(prev).add(hit));
    } else {
      setMiss((m) => m + 1);
    }
  }

  return (
    <div>
      <div
        ref={ref}
        onClick={onTap}
        style={{
          position: 'relative', borderRadius: 14, overflow: 'hidden',
          border: '1px solid #ffffff1a', background: '#f4f1ea',
          cursor: allFound ? 'default' : 'crosshair', touchAction: 'manipulation',
        }}
      >
        {h.image || block.image ? (
          <img src={h.image || block.image} alt="" draggable={false} style={{ width: '100%', display: 'block', pointerEvents: 'none' }} />
        ) : (
          <div style={{ padding: 24, color: C.muted, fontSize: 12 }}>изображение не задано</div>
        )}
        {/* галочки — ровно в найденных точках */}
        {points.map((p, i) => found.has(i) ? (
          <span key={i} style={{
            position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%,-50%)',
            width: 28, height: 28, borderRadius: 14, background: `${C.green}ee`, border: '3px solid #fff',
            color: '#04240f', fontSize: 14, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', boxShadow: '0 2px 8px #0006',
          }}>✓</span>
        ) : null)}
      </div>

      <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: allFound ? C.green : C.text }}>
        {allFound
          ? `${LEVEL.ok.icon} ${h.success || 'Все дефекты найдены!'}`
          : `Найдено ${found.size} из ${points.length}${miss ? ` · промахов ${miss}` : ''}`}
      </div>
      {h.hint && !allFound && (
        <div style={{ marginTop: 6, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{h.hint}</div>
      )}
      {allFound && h.explain && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{h.explain}</div>
      )}
    </div>
  );
}

// ── 3. ORDER ────────────────────────────────────────────────────────────────

function OrderTrainer({ block }) {
  const o = block.order || {};
  const items = useMemo(() => (o.items || []), [o.items]);
  const [picked, setPicked] = useState([]);
  const [wrong, setWrong] = useState(false);

  const done = picked.length === items.length;
  const isCorrect = done && picked.every((id, i) => id === items[i].id);

  function tap(item) {
    if (picked.includes(item.id)) return;
    const expected = items[picked.length]?.id;
    if (item.id === expected) {
      setWrong(false);
      setPicked(prev => [...prev, item.id]);
    } else {
      setWrong(true);
    }
  }

  // Показываем варианты в перемешанном (детерминированно) порядке, чтобы
  // правильная последовательность не читалась слева-направо.
  const shown = useMemo(() => {
    if (o.shuffle === false) return items;
    return items.slice().reverse();
  }, [items, o.shuffle]);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {shown.map((it) => {
          const pos = picked.indexOf(it.id);
          const isPicked = pos >= 0;
          return (
            <button
              key={it.id}
              onClick={() => tap(it)}
              disabled={isPicked}
              style={{
                padding: '9px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: isPicked ? 800 : 500,
                background: isPicked ? `${C.rune}22` : '#ffffff0d',
                border: `1px solid ${isPicked ? C.rune : '#ffffff1c'}`,
                color: isPicked ? 'var(--acc)' : C.text, cursor: isPicked ? 'default' : 'pointer',
              }}
            >
              {isPicked ? `${pos + 1}. ` : ''}{it.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {items.map((it, i) => (
          <div key={it.id || i} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: i < picked.length ? C.rune : '#ffffff14',
          }} />
        ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: isCorrect ? C.green : wrong ? C.red : C.muted }}>
        {isCorrect
          ? `${LEVEL.ok.icon} ${o.success || 'Верная последовательность!'}`
          : wrong
            ? `${LEVEL.danger.icon} ${o.wrong || 'Не тот шаг. Подумай, что идёт раньше.'}`
            : `Выбрано ${picked.length} из ${items.length}`}
      </div>
      {isCorrect && o.explain && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{o.explain}</div>
      )}
    </div>
  );
}

// ── Экспорт ─────────────────────────────────────────────────────────────────

export default function LessonInteractive({ block, lessonId, index }) {
  const [done, setDone] = useState(() => {
    if (lessonId == null || index == null) return false;
    try { return localStorage.getItem(doneKey(lessonId, index)) === '1'; } catch { return false; }
  });

  const markDone = useCallback(() => {
    setDone(true);
    if (lessonId != null && index != null) {
      try { localStorage.setItem(doneKey(lessonId, index), '1'); } catch { /* */ }
    }
  }, [lessonId, index]);

  const body = () => {
    switch (block.kind) {
      case 'slider': return <SliderTrainer block={block} />;
      case 'hotspots': return <HotspotsTrainer block={block} />;
      case 'order': return <OrderTrainer block={block} />;
      default: return (
        <div style={{ fontSize: 12, color: C.muted }}>
          Неизвестный тип тренажёра: {String(block.kind || '—')}
        </div>
      );
    }
  };

  return <Shell block={block} done={done} onDone={markDone}>{body()}</Shell>;
}
