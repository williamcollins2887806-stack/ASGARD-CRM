/**
 * Химцех — перелив реагентов, реакции, генерация уровней, валидация
 */
'use strict';

const crypto = require('crypto');

const CAPACITY = 4;

const REAGENTS = {
  water:       { code: 'water',       name: 'Вода',                 short: 'H₂O',   color: '#2ea7ff', family: 'neutral',  hazard: false },
  acid_isk:    { code: 'acid_isk',    name: 'Кислотный ИСК-1',      short: 'ИСК-1', color: '#ff9a1f', family: 'acid',     hazard: true },
  hydro_acid:  { code: 'hydro_acid',  name: 'Соляная кислота',      short: 'HCl',   color: '#ff4b78', family: 'acid',     hazard: true },
  ortho:       { code: 'ortho',       name: 'Ортофосфорная кислота', short: 'H₃PO₄', color: '#f0c43a', family: 'acid',     hazard: true },
  alkali_sh:   { code: 'alkali_sh',   name: 'Щелочной ЩС-2',        short: 'ЩС-2',  color: '#8b6bff', family: 'alkali',   hazard: true },
  soda:        { code: 'soda',        name: 'Каустическая сода',     short: 'NaOH',  color: '#f472e6', family: 'alkali',   hazard: true },
  solvent:     { code: 'solvent',     name: 'Растворитель АСПО',     short: 'АСПО',  color: '#7b8ca3', family: 'solvent',  hazard: false },
  passivator:  { code: 'passivator',  name: 'Пассиватор П-1',       short: 'П-1',   color: '#22d3ee', family: 'finish',   hazard: false },
  bleach:      { code: 'bleach',      name: 'Гипохлорит',           short: 'ClO⁻',  color: '#a3e635', family: 'oxidizer', hazard: true },
  dilute_acid: { code: 'dilute_acid', name: 'Рабочий раствор',      short: 'р-р',   color: '#ffe566', family: 'dilute',   hazard: false },
  cip_blend:   { code: 'cip_blend',   name: 'CIP-раствор',          short: 'CIP',   color: '#7dffb3', family: 'blend',    hazard: false },
  aspo_film:   { code: 'aspo_film',   name: 'Плёнка АСПО',          short: 'плёнка', color: '#c4b5fd', family: 'blend',    hazard: false },
  rinse:       { code: 'rinse',       name: 'Промывка',             short: 'пром.', color: '#67e8f9', family: 'blend',    hazard: false },
  cip_plus:    { code: 'cip_plus',    name: 'CIP с ингибитором',    short: 'CIP+',  color: '#bef264', family: 'blend',    hazard: false },
  inhibitor:   { code: 'inhibitor',   name: 'Ингибитор',            short: 'инг.',  color: '#fb923c', family: 'additive', hazard: false },
  neutral:     { code: 'neutral',     name: 'Нейтрализат',          short: 'OK',    color: '#34f1a0', family: 'safe',     hazard: false },
};

/** Крупные миры (фон / тон) */
const WORLDS = [
  { min: 1,   name: 'Участок АВО',   icon: '🌡️' },
  { min: 26,  name: 'Трубный',       icon: '🔧' },
  { min: 51,  name: 'Котлы',         icon: '🏭' },
  { min: 76,  name: 'ОЗП',           icon: '⚠️' },
  { min: 101, name: 'Ночная авария', icon: '🌑' },
];

/** Смены по 5 уровней — как эпизоды в больших играх */
const CHAPTER_NAMES = [
  { name: 'Склад', icon: '📦' },
  { name: 'Буфер', icon: '🧪' },
  { name: 'Протокол', icon: '📋' },
  { name: 'Хлор', icon: '☠️' },
  { name: 'Растворы', icon: '💧' },
  { name: 'CIP', icon: '🔄' },
  { name: 'АСПО', icon: '🛢️' },
  { name: 'Щёлочи', icon: '🟣' },
  { name: 'Давление', icon: '📈' },
  { name: 'АВО-2', icon: '🌡️' },
  { name: 'Трубный вход', icon: '🔧' },
  { name: 'Смешение', icon: '⚗️' },
  { name: 'Пассивация', icon: '✨' },
  { name: 'Ночь', icon: '🌙' },
  { name: 'Авария', icon: '🚨' },
  { name: 'Мастер', icon: '⭐' },
  { name: 'Ветеран', icon: '🏅' },
  { name: 'Бригадир', icon: '👔' },
  { name: 'Химцех+', icon: '🏭' },
  { name: 'Легенда', icon: '👑' },
];

function chapterForLevel(levelNum) {
  const idx = Math.max(0, Math.floor((levelNum - 1) / 5));
  const meta = CHAPTER_NAMES[idx % CHAPTER_NAMES.length];
  const min = idx * 5 + 1;
  const max = min + 4;
  return {
    index: idx + 1,
    min,
    max,
    name: meta.name,
    icon: meta.icon,
    title: `Смена ${idx + 1} · ${meta.name}`,
    stage: ((levelNum - 1) % 5) + 1, // 1..5 внутри смены
    total: 5,
  };
}

const FACTS = {
  dilute_fail: 'Правило: КИСЛОТУ В ВОДУ, никогда воду в кислоту. Иначе экзотермия и разбрызгивание.',
  toxic_gas:   'Кислота + гипохлорит = газ хлор. Несколько вдохов — отравление. Несовместимо.',
  exotherm:    'Конц. кислота + щёлочь без протокола = сильная экзотермия. Смешивать только по наряду.',
  default:     'Несовместимые реагенты. Смотри паспорт вещества и протокол смены.',
};

/** Паспорт вещества: что можно / нельзя (зеркало клиентского buildPassport). */
function buildPassport(code) {
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
      tip: 'Растворитель АСПО. С пассиватором даёт защитную плёнку.',
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
        'Ингибитор на CIP → CIP+ (сложный наряд)',
        'Складывается сам с собой и в пустую канистру',
      ],
      forbid: [
        'Кислоты, щёлочи, гипохлорит без наряда',
      ],
    },
    additive: {
      tip: 'Ингибитор — добавка. На CIP даёт защищённый раствор, иначе только своя канистра.',
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

/** Реакция при переливе topSrc → на topDst (или null если dest пуст). */
function resolveReaction(srcCode, dstCode) {
  if (!srcCode) return { outcome: 'noop', ok: false };
  if (!dstCode) return { outcome: 'stack', ok: true };

  if (srcCode === dstCode) return { outcome: 'stack', ok: true };

  const src = REAGENTS[srcCode];
  const dst = REAGENTS[dstCode];
  if (!src || !dst) {
    return { outcome: 'exotherm', ok: false, fail: true, vfx: 'explosion', fact: FACTS.default, title: 'Несовместимо' };
  }

  // Кислота → вода = разбавление OK
  if (src.family === 'acid' && dstCode === 'water') {
    return {
      outcome: 'dilute_ok', ok: true, produce: 'dilute_acid', consumeDst: true,
      vfx: 'steam', fact: 'Кислоту в воду — правильно. Получен рабочий раствор.',
    };
  }

  // Вода → кислота = FAIL
  if (srcCode === 'water' && dst.family === 'acid') {
    return {
      outcome: 'dilute_fail', ok: false, fail: true, vfx: 'boil',
      fact: FACTS.dilute_fail, title: 'Воду в кислоту — вскипание',
    };
  }

  // Кислота → гипохлорит = хлор
  if (src.family === 'acid' && dstCode === 'bleach') {
    return {
      outcome: 'toxic_gas', ok: false, fail: true, vfx: 'gas',
      fact: FACTS.toxic_gas, title: 'Выделение хлора',
    };
  }
  if (srcCode === 'bleach' && dst.family === 'acid') {
    return {
      outcome: 'toxic_gas', ok: false, fail: true, vfx: 'gas',
      fact: FACTS.toxic_gas, title: 'Выделение хлора',
    };
  }

  // Кислота + сода/щёлочь = нейтрализация (безопасный протокол)
  if (src.family === 'acid' && (dstCode === 'soda' || dst.family === 'alkali')) {
    return {
      outcome: 'neutralize', ok: true, produce: 'neutral', consumeDst: true,
      vfx: 'foam', fact: 'Нейтрализация выполнена. Остаток — нейтрализат.',
    };
  }
  if ((srcCode === 'soda' || src.family === 'alkali') && dst.family === 'acid') {
    return {
      outcome: 'neutralize', ok: true, produce: 'neutral', consumeDst: true,
      vfx: 'foam', fact: 'Нейтрализация выполнена. Остаток — нейтрализат.',
    };
  }

  // dilute onto dilute / acid stacks carefully — treat different acids as incompatible heat
  if (src.family === 'acid' && dst.family === 'acid' && srcCode !== dstCode) {
    return {
      outcome: 'exotherm', ok: false, fail: true, vfx: 'explosion',
      fact: FACTS.exotherm, title: 'Смешение кислот',
    };
  }

  const pair = (a, b) => (srcCode === a && dstCode === b) || (srcCode === b && dstCode === a);
  if (pair('passivator', 'dilute_acid')) {
    return {
      outcome: 'blend', ok: true, produce: 'cip_blend', consumeDst: true,
      vfx: 'steam', fact: 'Пассиватор на рабочий раствор — готов CIP-раствор.',
      title: 'CIP',
    };
  }
  if (pair('solvent', 'passivator')) {
    return {
      outcome: 'blend', ok: true, produce: 'aspo_film', consumeDst: true,
      vfx: 'foam', fact: 'АСПО + пассиватор — защитная плёнка.',
      title: 'Плёнка',
    };
  }
  if (pair('cip_blend', 'water')) {
    return {
      outcome: 'blend', ok: true, produce: 'rinse', consumeDst: true,
      vfx: 'steam', fact: 'CIP в воду — промывка контура. Три шага готовы.',
      title: 'Промывка',
    };
  }
  if (pair('inhibitor', 'cip_blend')) {
    return {
      outcome: 'blend', ok: true, produce: 'cip_plus', consumeDst: true,
      vfx: 'foam', fact: 'Ингибитор на CIP — раствор не ест металл. Сложный наряд закрыт.',
      title: 'CIP+',
    };
  }

  // Everything else incompatible
  return {
    outcome: 'exotherm', ok: false, fail: true, vfx: 'explosion',
    fact: FACTS.default, title: 'Несовместимые реагенты',
  };
}

function cloneCans(cans) {
  return cans.map((c) => ({ capacity: c.capacity || CAPACITY, layers: c.layers.slice() }));
}

function topOf(can) {
  if (!can.layers.length) return null;
  return can.layers[can.layers.length - 1];
}

function spaceOf(can) {
  return (can.capacity || CAPACITY) - can.layers.length;
}

function stateKey(cans) {
  return cans.map((c) => c.layers.join(',')).join('|');
}

/**
 * Применить перелив. amount = сколько единиц перелить (для stack — вся верхняя серия).
 * Возвращает { ok, fail, cans, moves, reaction, poured }
 */
function applyPour(cans, from, to) {
  if (from === to || from < 0 || to < 0 || from >= cans.length || to >= cans.length) {
    return { ok: false, error: 'Некорректный перелив' };
  }
  const next = cloneCans(cans);
  const src = next[from];
  const dst = next[to];
  const srcTop = topOf(src);
  if (!srcTop) return { ok: false, error: 'Канистра пуста' };
  const space = spaceOf(dst);
  if (space <= 0) return { ok: false, error: 'Нет места' };

  const dstTop = topOf(dst);
  const reaction = resolveReaction(srcTop, dstTop);

  if (reaction.fail) {
    return {
      ok: false, fail: true, cans: next, reaction,
      error: reaction.title || 'Реакция',
    };
  }

  if (reaction.outcome === 'stack') {
    // Переливаем непрерывную верхнюю серию того же кода
    let n = 0;
    for (let i = src.layers.length - 1; i >= 0 && src.layers[i] === srcTop && n < space; i--) n++;
    for (let i = 0; i < n; i++) {
      dst.layers.push(src.layers.pop());
    }
    return { ok: true, cans: next, reaction, poured: n, moves: 1 };
  }

  if (reaction.outcome === 'dilute_ok') {
    // 1 ед. кислоты + 1 ед. воды → 1 ед. dilute (вода снизу «съедается»)
    src.layers.pop();
    if (reaction.consumeDst) dst.layers.pop();
    if (spaceOf(dst) <= 0 && !reaction.consumeDst) {
      return { ok: false, error: 'Нет места для раствора' };
    }
    dst.layers.push(reaction.produce || 'dilute_acid');
    return { ok: true, cans: next, reaction, poured: 1, moves: 1 };
  }

  if (reaction.outcome === 'neutralize') {
    src.layers.pop();
    if (reaction.consumeDst) dst.layers.pop();
    if (spaceOf(dst) > 0) dst.layers.push(reaction.produce || 'neutral');
    return { ok: true, cans: next, reaction, poured: 1, moves: 1 };
  }

  if (reaction.outcome === 'blend') {
    src.layers.pop();
    if (reaction.consumeDst) dst.layers.pop();
    dst.layers.push(reaction.produce);
    return { ok: true, cans: next, reaction, poured: 1, moves: 1 };
  }

  return { ok: false, error: 'Неизвестный исход' };
}

/**
 * Победа sort: каждая непустая канистра монохромна,
 * и каждый реагент встречается ровно в одной канистре
 * (нельзя «выиграть», размазав ИСК-1 на две полупустые).
 */
function isSorted(cans) {
  const seen = new Set();
  for (const c of cans) {
    if (!c.layers.length) continue;
    const first = c.layers[0];
    if (!c.layers.every((x) => x === first)) return false;
    if (seen.has(first)) return false;
    seen.add(first);
  }
  return seen.size > 0 || cans.every((c) => !c.layers.length);
}

function hasGoal(cans, goal) {
  if (!goal) return isSorted(cans);
  if (goal.type === 'sort') return isSorted(cans);
  if (goal.type === 'has_reagent') {
    const need = goal.code;
    const minCount = goal.minCount || 1;
    let count = 0;
    for (const c of cans) {
      for (const layer of c.layers) {
        if (layer === need) count++;
      }
    }
    return count >= minCount && (goal.requireSorted ? isSorted(cans) : true);
  }
  if (goal.type === 'canister') {
    const c = cans[goal.index];
    if (!c) return false;
    if (goal.exact) {
      if (c.layers.length !== goal.exact.length) return false;
      return goal.exact.every((x, i) => c.layers[i] === x);
    }
    if (goal.top === topOf(c) && (!goal.full || c.layers.length === c.capacity)) return true;
    return false;
  }
  return isSorted(cans);
}

function reactionAllowedForGoal(rx, goal) {
  if (!rx.ok || rx.fail) return false;
  const gtype = goal?.type || 'sort';
  if (gtype === 'sort') {
    // Классическая сортировка — только stack (иначе химия ломает инвариант)
    return rx.outcome === 'stack';
  }
  return true;
}

/**
 * BFS: кратчайшее число безопасных ходов до цели.
 * maxDepth — ранний отсев слишком сложных кандидатов при генерации.
 */
function solveMinMoves(cans, goal, maxNodes = 80000, maxDepth = 40, deadline = 0) {
  const start = cloneCans(cans);
  if (hasGoal(start, goal)) return { moves: 0, path: [] };

  const q = [{ cans: start, moves: 0 }];
  let head = 0;
  const seen = new Set([stateKey(start)]);
  let nodes = 0;

  while (head < q.length && nodes < maxNodes) {
    if (deadline && (nodes & 63) === 0 && Date.now() > deadline) break;
    const cur = q[head++];
    nodes++;
    if (cur.moves >= maxDepth) continue;
    const n = cur.cans.length;
    for (let i = 0; i < n; i++) {
      if (!cur.cans[i].layers.length) continue;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (spaceOf(cur.cans[j]) <= 0) continue;
        const srcTop = topOf(cur.cans[i]);
        const dstTop = topOf(cur.cans[j]);
        const rx = resolveReaction(srcTop, dstTop);
        if (!reactionAllowedForGoal(rx, goal)) continue;
        const res = applyPour(cur.cans, i, j);
        if (!res.ok || res.fail) continue;
        const key = stateKey(res.cans);
        if (seen.has(key)) continue;
        const nextMoves = cur.moves + 1;
        if (hasGoal(res.cans, goal)) {
          return { moves: nextMoves, path: [{ from: i, to: j }] };
        }
        seen.add(key);
        if (nextMoves < maxDepth) q.push({ cans: res.cans, moves: nextMoves });
      }
    }
  }
  return null;
}

/** Подсказка: первый безопасный ход к решению (жадный BFS один шаг из решения). */
function hintNextMove(cans, goal) {
  const start = cloneCans(cans);
  if (hasGoal(start, goal)) return { ok: true, done: true };

  const q = [{ cans: start, first: null }];
  let head = 0;
  const seen = new Set([stateKey(start)]);
  let nodes = 0;
  const heavy = start.length >= 8 || ((start[0] && start[0].capacity) || CAPACITY) > 4;
  const maxNodes = heavy ? 8000 : 40000;
  const deadline = Date.now() + (heavy ? 90 : 180);

  while (head < q.length && nodes < maxNodes) {
    if ((nodes & 63) === 0 && Date.now() > deadline) break;
    const cur = q[head++];
    nodes++;
    const n = cur.cans.length;
    for (let i = 0; i < n; i++) {
      if (!cur.cans[i].layers.length) continue;
      for (let j = 0; j < n; j++) {
        if (i === j || spaceOf(cur.cans[j]) <= 0) continue;
        const rx = resolveReaction(topOf(cur.cans[i]), topOf(cur.cans[j]));
        if (!reactionAllowedForGoal(rx, goal)) continue;
        const res = applyPour(cur.cans, i, j);
        if (!res.ok || res.fail) continue;
        const first = cur.first || { from: i, to: j };
        if (hasGoal(res.cans, goal)) return { ok: true, from: first.from, to: first.to };
        const key = stateKey(res.cans);
        if (seen.has(key)) continue;
        seen.add(key);
        q.push({ cans: res.cans, first });
      }
    }
  }
  return { ok: false, error: 'Подсказка недоступна' };
}

function worldForLevel(level) {
  let w = WORLDS[0];
  for (const item of WORLDS) {
    if (level >= item.min) w = item;
  }
  if (level < 126) return w;
  const round = Math.floor((level - 101) / 25) + 1;
  const cycled = WORLDS[(round - 1) % WORLDS.length];
  return { name: `${cycled.name} · круг ${round}`, icon: cycled.icon };
}

/** Целевой коридор сложности (мин. ходов солвера) — плато по 5 уровней */
function targetMovesForLevel(levelNum) {
  const band = Math.floor((levelNum - 1) / 5);
  let lo = 2 + band;
  if (levelNum >= 80) lo = 17 + Math.floor((levelNum - 80) / 6);
  lo = Math.min(lo, 45);
  const span = 3 + Math.min(6, Math.floor(band / 6));
  const hi = Math.min(lo + span, 52);
  return { lo, hi, band };
}

function starThresholds(minMoves, moveLimit) {
  const three = Math.max(1, minMoves + 1);
  const two = Math.max(three + 1, (moveLimit || minMoves + 8) - 2);
  return { three, two, one: Infinity };
}

function seededRng(seed) {
  let h = crypto.createHash('sha256').update(String(seed)).digest();
  let i = 0;
  return () => {
    if (i >= h.length - 4) {
      h = crypto.createHash('sha256').update(h).digest();
      i = 0;
    }
    const v = h.readUInt32BE(i);
    i += 4;
    return v / 0x100000000;
  };
}

function can(layers, capacity = CAPACITY) {
  return { capacity, layers: layers.slice() };
}

/**
 * Случайная раскладка: перемешиваем единицы реагентов по канистрам.
 * (Легальный reverse-scramble из mono не создаёт смешанных стопок — уровни были тривиальны.)
 */
function dealPuzzle(colors, empties, rng, capacity = CAPACITY) {
  const units = [];
  for (const code of colors) {
    for (let i = 0; i < capacity; i++) units.push(code);
  }
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [units[i], units[j]] = [units[j], units[i]];
  }

  const tubeCount = colors.length + empties;
  const cans = Array.from({ length: tubeCount }, () => can([], capacity));
  // Равномерно раскладываем, оставляя empties пустыми
  const fillSlots = colors.length * capacity;
  let u = 0;
  for (let t = 0; t < colors.length && u < fillSlots; t++) {
    const fill = Math.min(capacity, fillSlots - u);
    // иногда недоливаем, чтобы были «рваные» стопки
    const take = fill;
    for (let k = 0; k < take; k++) cans[t].layers.push(units[u++]);
  }
  // Перемешаем сами канистры (кроме гарантии empties в хвосте)
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cans[i], cans[j]] = [cans[j], cans[i]];
  }
  return cans;
}

/** Доп. перемешивание слоёв внутри заполненных канистр */
function shakeLayers(cans, rng, passes) {
  const next = cloneCans(cans);
  for (let p = 0; p < passes; p++) {
    const a = Math.floor(rng() * next.length);
    const b = Math.floor(rng() * next.length);
    if (a === b) continue;
    if (!next[a].layers.length || spaceOf(next[b]) <= 0) continue;
    // намеренно кладём любой верх на любую цель — генерация, не ход игрока
    next[b].layers.push(next[a].layers.pop());
  }
  return next;
}

function analyzeDifficulty(cans, minMoves) {
  const nonEmpty = cans.filter((c) => c.layers.length).length;
  const empties = cans.filter((c) => !c.layers.length).length;
  const types = new Set();
  for (const c of cans) c.layers.forEach((l) => types.add(l));
  return {
    minMoves: minMoves || 0,
    canisters: cans.length,
    nonEmpty,
    empties,
    types: types.size,
  };
}

function topSeriesLen(can) {
  if (!can.layers.length) return 0;
  const top = can.layers[can.layers.length - 1];
  let n = 0;
  for (let i = can.layers.length - 1; i >= 0 && can.layers[i] === top; i--) n++;
  return n;
}

/**
 * Замес «назад»: с отсортированного стола льём верх на чужой цвет.
 * Каждый шаг — обращение легального stack, поэтому партия всегда решаема.
 */
function reverseScramble(colors, empties, capacity, steps, rng) {
  const cans = colors.map((c) => can(Array(capacity).fill(c), capacity));
  for (let i = 0; i < empties; i++) cans.push(can([], capacity));

  let applied = 0;
  const maxTry = Math.max(steps * 10, 24);
  for (let t = 0; t < maxTry && applied < steps; t++) {
    const froms = [];
    for (let i = 0; i < cans.length; i++) {
      if (cans[i].layers.length) froms.push(i);
    }
    if (!froms.length) break;
    const from = froms[Math.floor(rng() * froms.length)];
    const tos = [];
    for (let j = 0; j < cans.length; j++) {
      if (j === from) continue;
      if (spaceOf(cans[j]) <= 0) continue;
      tos.push(j);
    }
    if (!tos.length) continue;
    const mixers = tos.filter((j) => {
      const d = topOf(cans[j]);
      return d && d !== topOf(cans[from]);
    });
    const to = (mixers.length && rng() > 0.22)
      ? mixers[Math.floor(rng() * mixers.length)]
      : tos[Math.floor(rng() * tos.length)];

    const series = topSeriesLen(cans[from]);
    const space = spaceOf(cans[to]);
    let n = 1;
    if (rng() > 0.62) n = 1 + Math.floor(rng() * Math.min(series, space));
    n = Math.max(1, Math.min(n, series, space));
    for (let k = 0; k < n; k++) cans[to].layers.push(cans[from].layers.pop());
    applied++;
  }

  for (let i = cans.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cans[i], cans[j]] = [cans[j], cans[i]];
  }
  return { cans, applied };
}

function paramsForLevel(levelNum) {
  const band = Math.floor((levelNum - 1) / 5);
  let colors = 2;
  if (levelNum >= 8) colors = 3;
  if (levelNum >= 21) colors = 4;
  if (levelNum >= 48) colors = 5;
  if (levelNum >= 80) colors = 6;
  if (levelNum >= 130) colors = 7;
  if (levelNum >= 200) colors = 8;
  let capacity = 4;
  if (levelNum >= 90) capacity = 5;
  let empties = 2;
  if (levelNum >= 12) empties = 3;
  if (levelNum >= 80) empties = 4;
  const flasks = colors + empties;
  if (flasks > 14) empties = Math.max(2, 14 - colors);
  const includeHazard = levelNum >= 16;
  const includeAdditive = levelNum >= 45 && (levelNum % 5 === 0 || (levelNum >= 100 && levelNum % 3 === 0));
  return { colors, empties, includeHazard, capacity, band, includeAdditive };
}

/** Пулы: между разными кодами только stack/fail (без dilute/neutralize) — sort остаётся честным */
const SORT_POOLS = [
  ['acid_isk', 'solvent', 'passivator', 'ortho', 'hydro_acid', 'alkali_sh', 'soda', 'bleach'],
  ['hydro_acid', 'solvent', 'bleach', 'passivator', 'ortho', 'soda', 'inhibitor', 'acid_isk'],
  ['alkali_sh', 'soda', 'solvent', 'passivator', 'bleach', 'ortho', 'hydro_acid', 'inhibitor'],
  ['acid_isk', 'hydro_acid', 'ortho', 'bleach', 'solvent', 'passivator', 'alkali_sh', 'soda'],
];

/** Скриптованные миссии 1–16 */
function scriptedLevel(levelNum) {
  const brief = (title, text, danger) => ({ title, text, danger: !!danger });
  const W = worldForLevel(levelNum);

  const scripts = {
    1: {
      cans: [can(['acid_isk', 'acid_isk']), can(['acid_isk', 'acid_isk']), can([])],
      goal: { type: 'sort' },
      brief: brief('Наряд: склад', 'Слей один реагент в одну канистру. Тап — источник, тап — цель.'),
      teach: 'stack',
    },
    2: {
      cans: [
        can(['hydro_acid', 'solvent', 'hydro_acid']),
        can(['solvent', 'hydro_acid', 'solvent']),
        can([]),
      ],
      goal: { type: 'sort' },
      brief: brief('Наряд: разложить', 'Пустая канистра — буфер. Не мешай разные реагенты.'),
      teach: 'buffer',
    },
    3: {
      cans: [
        can(['acid_isk', 'solvent', 'acid_isk']),
        can(['solvent', 'acid_isk']),
        can(['solvent']),
        can([]),
      ],
      goal: { type: 'sort' },
      brief: brief('Наряд: буфер', 'Пустая канистра — твой инструмент. Думай на ход вперёд.'),
      teach: 'plan',
    },
    4: {
      cans: [can(['water', 'water']), can(['acid_isk']), can([])],
      goal: { type: 'has_reagent', code: 'dilute_acid', minCount: 1 },
      brief: brief('Наряд: рабочий раствор', 'КИСЛОТУ лей В ВОДУ. Получи рабочий раствор.'),
      teach: 'dilute_ok',
    },
    5: {
      // Демонстрация опасности: есть вода и кислота; цель — отсортировать БЕЗ воды→кислота
      cans: [
        can(['water', 'acid_isk']),
        can(['acid_isk', 'water']),
        can([]),
        can([]),
      ],
      goal: { type: 'sort' },
      brief: brief('Осторожно: разведение', 'Воду в кислоту лить нельзя — будет вскипание. Сортируй аккуратно.', true),
      teach: 'dilute_warn',
    },
    6: {
      cans: [
        can(['acid_isk', 'acid_isk']),
        can(['bleach', 'bleach']),
        can(['acid_isk', 'bleach']),
        can([]),
      ],
      goal: { type: 'sort' },
      brief: brief('Опасность: хлор', 'Кислота + гипохлорит = хлор. Не смешивай. Разложи по канистрам.', true),
      teach: 'toxic_gas',
    },
    7: {
      cans: [can(['acid_isk', 'acid_isk']), can(['soda']), can([])],
      goal: { type: 'has_reagent', code: 'neutral', minCount: 1 },
      brief: brief('Наряд: пролив', 'Нейтрализуй кислоту содой — получи нейтрализат.'),
      teach: 'neutralize',
    },
    8: {
      cans: [
        can(['ortho', 'passivator', 'ortho']),
        can(['passivator', 'ortho', 'passivator']),
        can([]),
      ],
      goal: { type: 'sort' },
      brief: brief('CIP: реагенты', 'Ортофосфорная и пассиватор — по своим канистрам.'),
      teach: 'cip',
    },
    9: {
      cans: [
        can(['solvent', 'acid_isk', 'solvent']),
        can(['acid_isk', 'solvent', 'acid_isk']),
        can(['solvent']),
        can([]),
      ],
      goal: { type: 'sort' },
      brief: brief('АСПО и кислота', 'Растворитель и кислота несовместимы. Только сортировка.'),
      teach: 'solvent',
    },
    10: {
      cans: [
        can(['water', 'water', 'water']),
        can(['hydro_acid', 'hydro_acid']),
        can([]),
      ],
      goal: { type: 'has_reagent', code: 'dilute_acid', minCount: 2 },
      brief: brief('Два раствора', 'Приготовь не меньше двух порций рабочего раствора (кислота → вода).'),
      teach: 'dilute_multi',
    },
    11: {
      cans: [
        can(['alkali_sh', 'soda', 'alkali_sh']),
        can(['soda', 'alkali_sh']),
        can(['soda']),
        can([]),
      ],
      goal: { type: 'sort' },
      brief: brief('Щёлочи', 'ЩС-2 и каустик — разные реагенты. Разложи.'),
      teach: 'alkali',
    },
    12: {
      cans: [
        can(['acid_isk', 'bleach', 'solvent']),
        can(['bleach', 'acid_isk']),
        can(['solvent', 'bleach']),
        can([]),
        can([]),
      ],
      goal: { type: 'sort' },
      brief: brief('Экзамен смены', 'Кислота, гипохлорит, АСПО. Ошибка = авария. Разложи без смешения.', true),
      teach: 'exam',
    },
    13: {
      cans: [
        can(['water', 'water']),
        can(['acid_isk']),
        can(['passivator']),
        can([]),
      ],
      goal: { type: 'has_reagent', code: 'cip_blend', minCount: 1 },
      brief: brief('Наряд: CIP', 'Два шага: кислоту в воду → рабочий раствор, затем пассиватор сверху. Получи CIP.'),
      teach: 'cip_blend',
    },
    14: {
      cans: [
        can(['solvent', 'solvent']),
        can(['passivator']),
        can(['solvent']),
        can([]),
      ],
      goal: { type: 'has_reagent', code: 'aspo_film', minCount: 1 },
      brief: brief('Наряд: плёнка', 'Слей АСПО с пассиватором — получи защитную плёнку.'),
      teach: 'aspo_film',
    },
    15: {
      cans: [
        can(['water', 'water', 'water']),
        can(['acid_isk']),
        can(['passivator']),
        can([]),
        can([]),
      ],
      goal: { type: 'has_reagent', code: 'rinse', minCount: 1 },
      brief: brief('Наряд: промывка', 'Три шага: кислота в воду → CIP (пассиватор на раствор) → CIP в оставшуюся воду.'),
      teach: 'rinse',
    },
    16: {
      cans: [
        can(['water', 'water']),
        can(['hydro_acid', 'hydro_acid']),
        can(['passivator', 'passivator']),
        can([]),
        can([]),
        can([]),
      ],
      goal: { type: 'has_reagent', code: 'cip_blend', minCount: 2 },
      brief: brief('Два CIP', 'Приготовь две порции CIP-раствора. Буферы — пустые канистры.'),
      teach: 'cip_multi',
    },
    17: {
      cans: [
        can(['water', 'water']),
        can(['acid_isk']),
        can(['passivator']),
        can(['inhibitor']),
        can([]),
        can([]),
      ],
      goal: { type: 'has_reagent', code: 'cip_plus', minCount: 1 },
      brief: brief('Наряд: CIP+', 'Три продукта: кислота в воду → CIP (пассиватор), затем ингибитор сверху.'),
      teach: 'cip_plus',
    },
  };

  const s = scripts[levelNum];
  if (!s) return null;

  const solved = solveMinMoves(s.cans, s.goal);
  const minMoves = solved ? solved.moves : 8;
  const softLimit = minMoves + Math.max(6, Math.floor(minMoves * 0.8));
  const chapter = chapterForLevel(levelNum);

  return {
    level: levelNum,
    cans: cloneCans(s.cans),
    goal: s.goal,
    brief: s.brief,
    teach: s.teach,
    world: W,
    chapter,
    minMoves,
    moveLimit: softLimit,
    stars: starThresholds(minMoves, softLimit),
    capacity: CAPACITY,
    mode: 'scripted',
  };
}

function wrapLevel(levelNum, cans, goal, opts = {}) {
  if (goal.type === 'sort' && isSorted(cans)) return null;
  let minMoves = opts.minMoves;
  if (minMoves == null) {
    const cap = (cans[0] && cans[0].capacity) || CAPACITY;
    const sol = solveMinMoves(cans, goal, cap > 4 ? 100000 : 80000, cap > 4 ? 42 : 40);
    if (!sol || sol.moves < 1) return null;
    minMoves = sol.moves;
  }
  if (minMoves < 1) return null;
  const softLimit = minMoves + Math.max(5, Math.floor(minMoves * 0.85));
  const chapter = chapterForLevel(levelNum);
  return {
    level: levelNum,
    cans: cloneCans(cans),
    goal,
    brief: opts.brief || {
      title: chapter.title,
      text: `Наряд ${levelNum} · этап ${chapter.stage}/${chapter.total}. Разложи реагенты без аварии.`,
      danger: !!opts.danger,
    },
    teach: opts.teach || null,
    world: worldForLevel(levelNum),
    chapter,
    minMoves,
    moveLimit: softLimit,
    stars: starThresholds(minMoves, softLimit),
    capacity: (cans[0] && cans[0].capacity) || CAPACITY,
    mode: opts.mode || 'procedural',
    difficulty: analyzeDifficulty(cans, minMoves),
  };
}

function pickColors(rng, p) {
  const pool = SORT_POOLS[Math.floor(rng() * SORT_POOLS.length)].slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const colors = pool.slice(0, Math.min(p.colors, pool.length));
  if (p.includeHazard && !colors.includes('bleach') && pool.includes('bleach') && rng() > 0.35) {
    colors[colors.length - 1] = 'bleach';
  }
  if (p.includeAdditive && !colors.includes('inhibitor')) colors.push('inhibitor');
  return colors;
}

function recipeLevel(levelNum) {
  const kind = Math.floor(levelNum / 7) % 4;
  if (kind === 0) {
    return wrapLevel(levelNum, [
      can(['water', 'water']),
      can(['acid_isk', 'acid_isk']),
      can(['passivator']),
      can([]),
      can([]),
    ], { type: 'has_reagent', code: 'cip_blend', minCount: 1 }, {
      brief: {
        title: 'CIP по наряду',
        text: 'Два шага: кислоту в воду, затем пассиватор на раствор.',
        danger: false,
      },
      mode: 'recipe',
    });
  }
  if (kind === 1) {
    return wrapLevel(levelNum, [
      can(['solvent', 'solvent']),
      can(['passivator', 'passivator']),
      can(['solvent']),
      can([]),
      can([]),
    ], { type: 'has_reagent', code: 'aspo_film', minCount: 1 }, {
      brief: {
        title: 'Плёнка АСПО',
        text: 'Слей растворитель с пассиватором — получи плёнку.',
        danger: false,
      },
      mode: 'recipe',
    });
  }
  if (kind === 2) {
    return wrapLevel(levelNum, [
      can(['water', 'water', 'water']),
      can(['acid_isk']),
      can(['passivator']),
      can([]),
      can([]),
    ], { type: 'has_reagent', code: 'rinse', minCount: 1 }, {
      brief: {
        title: 'Промывка контура',
        text: 'Три шага: кислота в воду → CIP, затем CIP в оставшуюся воду.',
        danger: false,
      },
      mode: 'recipe',
    });
  }
  return wrapLevel(levelNum, [
    can(['water', 'water']),
    can(['acid_isk']),
    can(['passivator']),
    can(['inhibitor']),
    can([]),
    can([]),
  ], { type: 'has_reagent', code: 'cip_plus', minCount: 1 }, {
    brief: {
      title: 'CIP с ингибитором',
      text: 'Сначала CIP (кислота в воду, пассиватор), потом ингибитор на CIP.',
      danger: false,
    },
    mode: 'recipe',
  });
}

function buildProcedural(levelNum, employeeId, attempt) {
  const rng = seededRng(`${levelNum}:${employeeId}:chemlab:v7:${attempt}`);
  const p = paramsForLevel(levelNum);
  const { lo, hi } = targetMovesForLevel(levelNum);
  const colors = pickColors(rng, p);
  const goal = { type: 'sort' };
  const steps = lo + Math.floor(rng() * Math.max(1, hi - lo + 1));
  const { cans, applied } = reverseScramble(colors, p.empties, p.capacity, steps, rng);
  if (isSorted(cans) || applied < 2) return null;

  let minMoves = Math.max(lo, Math.min(applied, hi));
  const small = colors.length <= 4 && cans.length <= 7 && p.capacity <= 4;
  if (small) {
    const sol = solveMinMoves(cans, goal, 15000, Math.min(30, hi + 8), Date.now() + 120);
    if (sol && sol.moves >= 1) minMoves = sol.moves;
  }

  return wrapLevel(levelNum, cans, goal, {
    mode: 'procedural',
    danger: colors.includes('bleach'),
    minMoves,
  });
}

function guaranteedLevel(levelNum) {
  const { lo, hi } = targetMovesForLevel(levelNum);
  const p = paramsForLevel(levelNum);
  const rng = seededRng(`guaranteed:v7:${levelNum}`);
  const colors = pickColors(rng, { ...p, includeAdditive: false });
  const steps = Math.max(4, lo);
  const { cans, applied } = reverseScramble(colors, Math.max(2, p.empties), p.capacity, steps, rng);
  if (cans && !isSorted(cans) && applied >= 2) {
    return wrapLevel(levelNum, cans, { type: 'sort' }, {
      mode: 'guaranteed',
      minMoves: Math.max(lo, Math.min(applied, hi)),
    });
  }
  const fallback = [
    can(['acid_isk', 'solvent', 'acid_isk', 'passivator']),
    can(['passivator', 'acid_isk', 'solvent']),
    can(['solvent', 'passivator']),
    can(['acid_isk']),
    can([]),
    can([]),
  ];
  return wrapLevel(levelNum, fallback, { type: 'sort' }, {
    mode: 'guaranteed',
    minMoves: Math.max(6, lo),
  });
}

function generateLevel(levelNum, employeeId) {
  if (levelNum >= 1 && levelNum <= 17) {
    const s = scriptedLevel(levelNum);
    if (s) return s;
  }
  if (levelNum > 17 && levelNum % 7 === 0) {
    const recipe = recipeLevel(levelNum, employeeId);
    if (recipe) return recipe;
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const level = buildProcedural(levelNum, employeeId, attempt);
    if (level) return level;
  }
  return guaranteedLevel(levelNum);
}

function cansEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if ((a[i].capacity || CAPACITY) !== (b[i].capacity || CAPACITY)) return false;
    if (a[i].layers.length !== b[i].layers.length) return false;
    for (let j = 0; j < a[i].layers.length; j++) {
      if (a[i].layers[j] !== b[i].layers[j]) return false;
    }
  }
  return true;
}

function recoverLevel(levelNum, employeeId, initialCans) {
  if (levelNum >= 1 && levelNum <= 17) {
    const s = scriptedLevel(levelNum);
    if (s && cansEqual(s.cans, initialCans)) return s;
  }
  if (levelNum > 17 && levelNum % 7 === 0) {
    const recipe = recipeLevel(levelNum);
    if (recipe && cansEqual(recipe.cans, initialCans)) return recipe;
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const level = buildProcedural(levelNum, employeeId, attempt);
    if (level && cansEqual(level.cans, initialCans)) return level;
  }
  const g = guaranteedLevel(levelNum);
  if (cansEqual(g.cans, initialCans)) return g;
  return null;
}

/**
 * Валидация complete: клиент шлёт финальные cans + moves_used + fail_count
 * Проверяем что цель достигнута; звёзды по эффективности (moveLimit — мягкий).
 */
function validateSubmission(initialCans, finalCans, goal, moveLimit, movesUsed, failCount = 0, storedMinMoves = null) {
  if (!initialCans || !finalCans || initialCans.length !== finalCans.length) {
    return { ok: false, error: 'Некорректные канистры' };
  }
  for (let i = 0; i < initialCans.length; i++) {
    if ((finalCans[i].capacity || CAPACITY) !== (initialCans[i].capacity || CAPACITY)) {
      return { ok: false, error: 'Подмена канистр' };
    }
  }
  if (!hasGoal(finalCans, goal || { type: 'sort' })) {
    return { ok: false, error: 'Наряд не выполнен' };
  }
  if (failCount > 0) {
    return { ok: false, error: 'Авария на смене — уровень не засчитан' };
  }

  const flasks = initialCans.length;
  const cap = (initialCans[0] && initialCans[0].capacity) || CAPACITY;
  const heavy = flasks >= 8 || cap > 4;
  let minMoves = storedMinMoves || 0;
  if (!heavy || !minMoves) {
    const sol = solveMinMoves(
      initialCans,
      goal || { type: 'sort' },
      heavy ? 6000 : 80000,
      heavy ? 22 : 40,
      Date.now() + (heavy ? 60 : 250)
    );
    if (sol && sol.moves >= 1) minMoves = sol.moves;
  }
  if (!minMoves) minMoves = storedMinMoves || 1;
  const limit = moveLimit || (minMoves + 8);
  const th = starThresholds(minMoves, limit);

  let stars = 1;
  if (movesUsed <= th.three) stars = 3;
  else if (movesUsed <= th.two) stars = 2;

  return { ok: true, stars, minMoves, thresholds: th };
}

function computeRewards(levelNum, stars, dailyLevels, dailyXp, dailyRunes) {
  let baseXp = levelNum <= 10 ? 5 : levelNum <= 30 ? 9 : 13;
  let baseRunes = levelNum <= 10 ? 1 : levelNum <= 30 ? 2 : 3;
  if (stars === 3) { baseXp = Math.round(baseXp * 1.5); baseRunes = Math.round(baseRunes * 1.5); }
  else if (stars === 2) { baseXp = Math.round(baseXp * 1.2); }

  let mult = 1;
  if (dailyLevels >= 20) mult = 0.25;
  else if (dailyLevels >= 10) mult = 0.5;

  let xp = Math.round(baseXp * mult);
  let runes = Math.round(baseRunes * mult);

  xp = Math.min(xp, Math.max(0, 200 - dailyXp));
  runes = Math.min(runes, Math.max(0, 30 - dailyRunes));

  return { xp, runes };
}

function publicReagents() {
  return Object.values(REAGENTS);
}

module.exports = {
  CAPACITY,
  REAGENTS,
  WORLDS,
  CHAPTER_NAMES,
  FACTS,
  resolveReaction,
  applyPour,
  hasGoal,
  isSorted,
  solveMinMoves,
  hintNextMove,
  generateLevel,
  recoverLevel,
  validateSubmission,
  computeRewards,
  worldForLevel,
  chapterForLevel,
  targetMovesForLevel,
  paramsForLevel,
  starThresholds,
  analyzeDifficulty,
  publicReagents,
  cloneCans,
  topOf,
  spaceOf,
  buildPassport,
};
