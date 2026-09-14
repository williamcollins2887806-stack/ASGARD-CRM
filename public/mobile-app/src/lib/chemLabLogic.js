/**
 * Клиентская логика Химцеха — зеркало src/services/chemLabEngine.js
 * (без Node crypto; только реакция / pour / win).
 */

export const CAPACITY = 4;

export const REAGENTS = {
  water:       { code: 'water',       short: 'H₂O',   name: 'Вода',                 color: '#2ea7ff', hazard: false, family: 'neutral' },
  acid_isk:    { code: 'acid_isk',    short: 'ИСК-1', name: 'Кислотный ИСК-1',      color: '#ff9a1f', hazard: true,  family: 'acid' },
  hydro_acid:  { code: 'hydro_acid',  short: 'HCl',   name: 'Соляная кислота',      color: '#ff4b78', hazard: true,  family: 'acid' },
  ortho:       { code: 'ortho',       short: 'H₃PO₄', name: 'Ортофосфорная кислота', color: '#f0c43a', hazard: true,  family: 'acid' },
  alkali_sh:   { code: 'alkali_sh',   short: 'ЩС-2',  name: 'Щелочной ЩС-2',        color: '#8b6bff', hazard: true,  family: 'alkali' },
  soda:        { code: 'soda',        short: 'NaOH',  name: 'Каустическая сода',     color: '#f472e6', hazard: true,  family: 'alkali' },
  solvent:     { code: 'solvent',     short: 'АСПО',  name: 'Растворитель АСПО',     color: '#7b8ca3', hazard: false, family: 'solvent' },
  passivator:  { code: 'passivator',  short: 'П-1',   name: 'Пассиватор П-1',       color: '#22d3ee', hazard: false, family: 'finish' },
  bleach:      { code: 'bleach',      short: 'ClO⁻',  name: 'Гипохлорит',           color: '#a3e635', hazard: true,  family: 'oxidizer' },
  dilute_acid: { code: 'dilute_acid', short: 'р-р',   name: 'Рабочий раствор',      color: '#ffe566', hazard: false, family: 'dilute' },
  cip_blend:   { code: 'cip_blend',   short: 'CIP',   name: 'CIP-раствор',          color: '#7dffb3', hazard: false, family: 'blend' },
  aspo_film:   { code: 'aspo_film',   short: 'плёнка', name: 'Плёнка АСПО',         color: '#c4b5fd', hazard: false, family: 'blend' },
  rinse:       { code: 'rinse',       short: 'пром.', name: 'Промывка',             color: '#67e8f9', hazard: false, family: 'blend' },
  cip_plus:    { code: 'cip_plus',    short: 'CIP+',  name: 'CIP с ингибитором',    color: '#bef264', hazard: false, family: 'blend' },
  inhibitor:   { code: 'inhibitor',   short: 'инг.',  name: 'Ингибитор',            color: '#fb923c', hazard: false, family: 'additive' },
  neutral:     { code: 'neutral',     short: 'OK',    name: 'Нейтрализат',          color: '#34f1a0', hazard: false, family: 'safe' },
};

export function topOf(can) {
  return can.layers.length ? can.layers[can.layers.length - 1] : null;
}

export function spaceOf(can) {
  return (can.capacity || CAPACITY) - can.layers.length;
}

export function cloneCans(cans) {
  return cans.map((c) => ({ capacity: c.capacity || CAPACITY, layers: c.layers.slice() }));
}

export function resolveReaction(srcCode, dstCode) {
  if (!srcCode) return { outcome: 'noop', ok: false };
  if (!dstCode) return { outcome: 'stack', ok: true };
  if (srcCode === dstCode) return { outcome: 'stack', ok: true };

  const src = REAGENTS[srcCode];
  const dst = REAGENTS[dstCode];
  if (!src || !dst) {
    return {
      outcome: 'exotherm', ok: false, fail: true, vfx: 'explosion',
      title: 'Несовместимо',
      fact: 'Несовместимые реагенты. Смотри паспорт вещества и протокол смены.',
    };
  }

  if (src.family === 'acid' && dstCode === 'water') {
    return { outcome: 'dilute_ok', ok: true, produce: 'dilute_acid', consumeDst: true, vfx: 'steam' };
  }
  if (srcCode === 'water' && dst.family === 'acid') {
    return {
      outcome: 'dilute_fail', ok: false, fail: true, vfx: 'boil',
      title: 'Воду в кислоту — вскипание',
      fact: 'Правило: КИСЛОТУ В ВОДУ, никогда воду в кислоту. Иначе экзотермия и разбрызгивание.',
    };
  }
  if ((src.family === 'acid' && dstCode === 'bleach') || (srcCode === 'bleach' && dst.family === 'acid')) {
    return {
      outcome: 'toxic_gas', ok: false, fail: true, vfx: 'gas',
      title: 'Выделение хлора',
      fact: 'Кислота + гипохлорит = газ хлор. Несколько вдохов — отравление. Несовместимо.',
    };
  }
  if (src.family === 'acid' && (dstCode === 'soda' || dst.family === 'alkali')) {
    return { outcome: 'neutralize', ok: true, produce: 'neutral', consumeDst: true, vfx: 'foam' };
  }
  if ((srcCode === 'soda' || src.family === 'alkali') && dst.family === 'acid') {
    return { outcome: 'neutralize', ok: true, produce: 'neutral', consumeDst: true, vfx: 'foam' };
  }
  if (src.family === 'acid' && dst.family === 'acid' && srcCode !== dstCode) {
    return {
      outcome: 'exotherm', ok: false, fail: true, vfx: 'explosion',
      title: 'Смешение кислот',
      fact: 'Разные кислоты без протокола — экзотермия. Смешивать только по наряду.',
    };
  }
  const pair = (a, b) => (srcCode === a && dstCode === b) || (srcCode === b && dstCode === a);
  if (pair('passivator', 'dilute_acid')) {
    return { outcome: 'blend', ok: true, produce: 'cip_blend', consumeDst: true, vfx: 'steam' };
  }
  if (pair('solvent', 'passivator')) {
    return { outcome: 'blend', ok: true, produce: 'aspo_film', consumeDst: true, vfx: 'foam' };
  }
  if (pair('cip_blend', 'water')) {
    return { outcome: 'blend', ok: true, produce: 'rinse', consumeDst: true, vfx: 'steam' };
  }
  if (pair('inhibitor', 'cip_blend')) {
    return { outcome: 'blend', ok: true, produce: 'cip_plus', consumeDst: true, vfx: 'foam' };
  }
  return {
    outcome: 'exotherm', ok: false, fail: true, vfx: 'explosion',
    title: 'Несовместимые реагенты',
    fact: 'Несовместимые реагенты. Смотри паспорт вещества и протокол смены.',
  };
}

export function applyPour(cans, from, to) {
  if (from === to || from < 0 || to < 0 || from >= cans.length || to >= cans.length) {
    return { ok: false };
  }
  const next = cloneCans(cans);
  const src = next[from];
  const dst = next[to];
  const srcTop = topOf(src);
  if (!srcTop || spaceOf(dst) <= 0) return { ok: false };

  const reaction = resolveReaction(srcTop, topOf(dst));
  const color = REAGENTS[srcTop]?.color || '#888';

  if (reaction.fail) {
    return { ok: false, fail: true, cans: next, reaction, color };
  }

  if (reaction.outcome === 'stack') {
    let n = 0;
    const space = spaceOf(dst);
    for (let i = src.layers.length - 1; i >= 0 && src.layers[i] === srcTop && n < space; i--) n++;
    for (let i = 0; i < n; i++) dst.layers.push(src.layers.pop());
    return { ok: true, cans: next, reaction, poured: n, color };
  }
  if (reaction.outcome === 'dilute_ok') {
    src.layers.pop();
    if (reaction.consumeDst) dst.layers.pop();
    dst.layers.push(reaction.produce || 'dilute_acid');
    return { ok: true, cans: next, reaction, poured: 1, color: REAGENTS.dilute_acid.color };
  }
  if (reaction.outcome === 'neutralize') {
    src.layers.pop();
    if (reaction.consumeDst) dst.layers.pop();
    if (spaceOf(dst) > 0) dst.layers.push(reaction.produce || 'neutral');
    return { ok: true, cans: next, reaction, poured: 1, color: REAGENTS.neutral.color };
  }
  if (reaction.outcome === 'blend') {
    src.layers.pop();
    if (reaction.consumeDst) dst.layers.pop();
    dst.layers.push(reaction.produce);
    const produced = REAGENTS[reaction.produce];
    return { ok: true, cans: next, reaction, poured: 1, color: produced?.color || color };
  }
  return { ok: false };
}

export function isSorted(cans) {
  const seen = new Set();
  for (const c of cans) {
    if (!c.layers.length) continue;
    const first = c.layers[0];
    if (!c.layers.every((x) => x === first)) return false;
    if (seen.has(first)) return false;
    seen.add(first);
  }
  return true;
}

export function hasGoal(cans, goal) {
  if (!goal || goal.type === 'sort') return isSorted(cans);
  if (goal.type === 'has_reagent') {
    let count = 0;
    for (const c of cans) for (const l of c.layers) if (l === goal.code) count++;
    return count >= (goal.minCount || 1);
  }
  return isSorted(cans);
}

/** Индексы канистр, куда можно безопасно/осмысленно лить с from (включая fail-ходы как «возможные»). */
export function pourPreview(cans, from) {
  const srcTop = topOf(cans[from]);
  if (!srcTop) return { valid: [], danger: [], blocked: [] };
  const valid = [];
  const danger = [];
  const blocked = [];
  for (let to = 0; to < cans.length; to++) {
    if (to === from) continue;
    if (spaceOf(cans[to]) <= 0) {
      blocked.push(to);
      continue;
    }
    const rx = resolveReaction(srcTop, topOf(cans[to]));
    if (rx.fail) danger.push(to);
    else if (rx.ok) valid.push(to);
    else blocked.push(to);
  }
  return { valid, danger, blocked };
}

export function goalLabel(goal) {
  if (!goal || goal.type === 'sort') return 'Разложи реагенты — каждый в свою канистру';
  if (goal.type === 'has_reagent') {
    const r = REAGENTS[goal.code];
    const name = r?.name || goal.code;
    const n = goal.minCount || 1;
    return n > 1 ? `Получи ${n}× ${name}` : `Получи: ${name}`;
  }
  return 'Выполни наряд';
}

export function recipeHint(goal) {
  if (!goal || goal.type !== 'has_reagent') return '';
  const map = {
    dilute_acid: 'кислота → в воду',
    cip_blend: 'кислота → вода → пассиватор',
    aspo_film: 'АСПО + пассиватор',
    rinse: 'кислота → вода → CIP → вода',
    cip_plus: 'CIP, затем ингибитор сверху',
    neutral: 'кислота + щёлочь / сода',
  };
  return map[goal.code] || '';
}

/**
 * Паспорт вещества для UI: что можно / нельзя лить.
 * Зеркало правил resolveReaction.
 */
export function buildPassport(code) {
  const r = REAGENTS[code];
  if (!r) return null;

  const byFamily = {
    neutral: {
      tip: 'Разбавитель. Кислоту льют в воду — никогда воду в кислоту.',
      rule: 'КИСЛОТУ → В ВОДУ',
      allow: [
        'Принимает кислоту → получается рабочий раствор',
        'Складывается сам с собой и в пустую канистру',
      ],
      forbid: [
        'Лить воду в кислоту — вскипание и разбрызгивание',
        'Смешивать с гипохлоритом без наряда',
      ],
    },
    acid: {
      tip: 'Концентрированная кислота. Льётся в воду; с щёлочью даёт нейтрализат. С хлором — яд.',
      rule: 'В ВОДУ · НЕ С ГИПОХЛОРИТОМ · НЕ С ДРУГОЙ КИСЛОТОЙ',
      allow: [
        'В воду → рабочий раствор',
        'На щёлочь / каустик → нейтрализат (пена)',
        'На такую же кислоту или в пустую канистру',
      ],
      forbid: [
        'Воду в эту кислоту — экзотермия',
        'Гипохлорит (ClO⁻) — газ хлор',
        'Другую кислоту — без протокола нельзя',
        'Растворитель, пассиватор и прочее «мимо наряда»',
      ],
    },
    alkali: {
      tip: 'Щёлочь. Нейтрализует кислоты по протоколу. Беречь глаза и кожу.',
      rule: 'С КИСЛОТОЙ → НЕЙТРАЛИЗАТ',
      allow: [
        'На кислоту → нейтрализат',
        'Складывается сам с собой и в пустую канистру',
      ],
      forbid: [
        'Гипохлорит, растворитель, пассиватор — несовместимо',
        'Смешивать разные щёлочи без наряда',
      ],
    },
    oxidizer: {
      tip: 'Гипохлорит. С кислотой даёт хлор — отравление.',
      rule: 'НЕ С КИСЛОТАМИ',
      allow: [
        'Складывается сам с собой и в пустую канистру',
      ],
      forbid: [
        'Любая кислота — выделение хлора',
        'Щёлочи и прочие реагенты без наряда',
      ],
    },
    solvent: {
      tip: 'Растворитель АСПО. С пассиватором даёт защитную плёнку. Иначе — только своя канистра.',
      rule: 'С ПАССИВАТОРОМ → ПЛЁНКА · ИНАЧЕ СВОЯ КАНИСТРА',
      allow: [
        'На пассиватор → защитная плёнка',
        'На такой же АСПО или в пустую канистру',
      ],
      forbid: [
        'Кислоты, щёлочи, гипохлорит — несовместимо',
      ],
    },
    finish: {
      tip: 'Пассиватор. С рабочим раствором даёт CIP. С АСПО — плёнку.',
      rule: 'НА РАБОЧИЙ РАСТВОР → CIP · С АСПО → ПЛЁНКА',
      allow: [
        'На рабочий раствор → CIP-раствор',
        'На АСПО → защитная плёнка',
        'На такой же П-1 или в пустую канистру',
      ],
      forbid: [
        'Кислоты, щёлочи, гипохлорит — авария',
      ],
    },
    dilute: {
      tip: 'Рабочий раствор (кислота в воду). Дальше можно пассиватор → CIP.',
      rule: 'ПАССИВАТОР → CIP · НЕ С ГИПОХЛОРИТОМ',
      allow: [
        'Пассиватор сверху → CIP-раствор',
        'Складывается сам с собой и в пустую канистру',
      ],
      forbid: [
        'Гипохлорит и посторонние реагенты без наряда',
      ],
    },
    blend: {
      tip: 'Готовый состав по наряду. CIP в воду — промывка; CIP + ингибитор — CIP+.',
      rule: 'ГОТОВЫЙ ПРОДУКТ СМЕНЫ',
      allow: [
        'CIP на воду → промывка (три шага)',
        'Ингибитор на CIP → CIP+',
        'Складывается сам с собой и в пустую канистру',
      ],
      forbid: [
        'Кислоты, щёлочи, гипохлорит без наряда',
      ],
    },
    additive: {
      tip: 'Ингибитор — добавка. На CIP даёт защищённый раствор.',
      rule: 'НА CIP → CIP+ · ИНАЧЕ СВОЯ КАНИСТРА',
      allow: [
        'На CIP-раствор → CIP с ингибитором',
        'На такой же ингибитор или в пустую канистру',
      ],
      forbid: [
        'Кислоты, щёлочи, гипохлорит — авария',
      ],
    },
    safe: {
      tip: 'Нейтрализат — результат безопасной нейтрализации. Цель многих нарядов.',
      rule: 'ГОТОВЫЙ ПРОДУКТ',
      allow: [
        'Складывается сам с собой и в пустую канистру',
      ],
      forbid: [
        'Снова лить на него кислоту/щёлочь без наряда',
      ],
    },
  };

  const card = byFamily[r.family] || {
    tip: 'Смотри совместимость в протоколе смены.',
    rule: 'ТОЛЬКО ПО НАРЯДУ',
    allow: ['В пустую канистру или на такое же вещество'],
    forbid: ['Чужие реагенты без протокола'],
  };

  return {
    reagent: r,
    tip: card.tip,
    rule: card.rule,
    allow: card.allow,
    forbid: card.forbid,
  };
}

export function playTone(freq = 440, dur = 0.08, type = 'sine', gain = 0.06) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!playTone._ctx) playTone._ctx = new Ctx();
    const ctx = playTone._ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.stop(ctx.currentTime + dur);
  } catch { /* silent */ }
}
