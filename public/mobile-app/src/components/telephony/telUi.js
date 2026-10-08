/** Blur только на фикс-слоях (оверлей входящего, шапка sheet). Не для скролла списка. */
export const glass = {
  background: 'color-mix(in srgb, var(--bg-surface) 78%, transparent)',
  border: '0.5px solid color-mix(in srgb, var(--gold) 18%, var(--border-norse))',
  backdropFilter: 'blur(16px) saturate(140%)',
  WebkitBackdropFilter: 'blur(16px) saturate(140%)',
};

export const rowSurface = {
  background: 'color-mix(in srgb, var(--bg-surface) 88%, transparent)',
  border: '0.5px solid color-mix(in srgb, var(--gold) 12%, var(--border-norse))',
};

export function avatarGradient(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const tones = ['var(--gold)', 'var(--blue)', 'var(--green-dim)'];
  const c = tones[h % tones.length];
  return `linear-gradient(145deg, color-mix(in srgb, ${c} 38%, var(--bg-elevated)), var(--bg-elevated))`;
}

export function taskFromCallPath(text) {
  const t = String(text || '').trim().slice(0, 240);
  const q = new URLSearchParams({ new: '1' });
  if (t) q.set('text', t);
  return `/tasks?${q.toString()}`;
}

export function digitsForTel(n) {
  const d = String(n || '').replace(/\D/g, '');
  if (d.length < 10) return '';
  if (d.length === 11 && d.startsWith('8')) return `+7${d.slice(1)}`;
  if (d.length === 11 && d.startsWith('7')) return `+${d}`;
  if (d.length === 10) return `+7${d}`;
  return `+${d}`;
}

export function initialsFrom(name) {
  const parts = String(name || '')
    .replace(/ооо|зао|пао|ип/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function dayLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const msk = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(msk)) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  if (diff < 7) return 'На этой неделе';
  return d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' });
}

export function groupByDay(items) {
  const groups = [];
  const map = new Map();
  for (const row of items || []) {
    const key = dayLabel(row.created_at) || 'Ранее';
    if (!map.has(key)) {
      const g = { key, items: [] };
      map.set(key, g);
      groups.push(g);
    }
    map.get(key).items.push(row);
  }
  return groups;
}

/** Грубая тональность по тексту резюме — не нейросеть, только подсветка. */
export function sentimentFromText(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  const bad = /отказ|негатив|зл|руга|претенз|жалоба|недоволен/;
  const good = /договор|соглас|спасибо|интерес|готов|куп/;
  if (bad.test(t) && !good.test(t)) {
    return {
      key: 'tense',
      level: 0,
      label: 'Напряжённо',
      caption: 'AI: клиент был настроен напряжённо',
      color: 'var(--red)',
    };
  }
  if (good.test(t)) {
    return {
      key: 'pos',
      level: 2,
      label: 'Позитивно',
      caption: 'AI: клиент был настроен позитивно',
      color: 'var(--green)',
    };
  }
  return {
    key: 'neu',
    level: 1,
    label: 'Нейтрально',
    caption: 'AI: клиент был настроен нейтрально',
    color: 'var(--text-secondary)',
  };
}

export function actionItemsFromSummary(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const items = [];
  const sentences = raw.split(/(?<=[.!?])\s+/).filter((s) => s.length > 12);
  for (const s of sentences) {
    if (/перезвон|связ|встреч|отправ|подготов|напомни|понедельник|вторник|завтра/i.test(s)) {
      items.push(s.replace(/\s+/g, ' ').trim());
    }
  }
  return items.slice(0, 3);
}
