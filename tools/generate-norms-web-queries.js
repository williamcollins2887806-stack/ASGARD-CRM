#!/usr/bin/env node
/**
 * R1: генерирует tests/reports/norms-web/queries-320plus.jsonl
 * Запуск: node tools/generate-norms-web-queries.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'tests', 'reports', 'norms-web', 'queries-320plus.jsonl');

/** @typedef {{ id:number, name:string, category:string, method:string|null, keyService?:boolean, extraVars?:number }} ServiceDef */

/** Каталог услуг (план Superbrain R1, asgard-service.com + дополнения). id=16 — реагенты, без запросов. */
const SERVICES = [
  { id: 1, name: 'Очистка и промывка пластинчатых ТО (безразборная химия)', category: 'plates', method: 'chem_cip', keyService: true },
  { id: 2, name: 'Гидродинамическая разборная очистка пластинчатых ТО', category: 'plates', method: 'hydro_dis', keyService: true },
  { id: 3, name: 'Промывка теплообменников (общий контур / кожухотрубные)', category: 'tubes', method: 'gdo' },
  { id: 4, name: 'Очистка теплообменников подогрева нефти', category: 'tubes', method: 'gdo' },
  { id: 5, name: 'Химическая и гидродинамическая очистка АВО', category: 'avo', method: 'outer', keyService: true },
  { id: 6, name: 'Очистка и промывка котлов всех типов', category: 'boilers', method: 'complex', keyService: true },
  { id: 7, name: 'Химическая промывка котлов', category: 'boilers', method: 'chem', keyService: true },
  { id: 8, name: 'Механическая чистка котлов и теплообменников', category: 'boilers', method: 'mech', keyService: true },
  { id: 9, name: 'Химическая очистка технологических трубопроводов', category: 'pipelines', method: 'chem_ops', keyService: true },
  { id: 10, name: 'Очистка технологических нефтепроводов от нефти и АСПО', category: 'pipelines', method: 'aspo', keyService: true },
  { id: 11, name: 'Протравка трубопроводов перед вводом в эксплуатацию', category: 'pipelines', method: 'pickle' },
  { id: 12, name: 'Очистка ёмкостного оборудования', category: 'vessels', method: 'clean' },
  { id: 13, name: 'Очистка градирен', category: 'towers_hvac', method: 'tower', keyService: true },
  { id: 14, name: 'Ремонт теплообменников типа «Компаблок»', category: 'repair_weld', method: 'compabloc' },
  { id: 15, name: 'Промывка оборудования на режиме (без остановки)', category: 'chem_circuits', method: 'cip' },
  { id: 16, name: 'Химические реагенты (прайс, не норма времени)', category: null, method: null, skipQueries: true },
  { id: 17, name: 'Химическая безразборная очистка пластинчатых ТО (ИТП/здания)', category: 'plates', method: 'chem_cip', keyService: true },
  { id: 18, name: 'Монтаж, ремонт, промывка ИТП', category: 'towers_hvac', method: 'itp', keyService: true },
  { id: 19, name: 'Ремонт и обслуживание инженерных систем, ИТП, ЦТП', category: 'towers_hvac', method: 'itp', keyService: true },
  { id: 20, name: 'Химическая промывка систем отопления', category: 'towers_hvac', method: 'heating' },
  { id: 21, name: 'Пневмоимпульсная промывка систем отопления', category: 'towers_hvac', method: 'pneumo' },
  { id: 22, name: 'Промывка систем хладоснабжения и ГВС', category: 'towers_hvac', method: 'heating' },
  { id: 23, name: 'Замена теплоносителя в инженерных системах', category: 'chem_circuits', method: 'cip' },
  { id: 24, name: 'Подготовка инженерных систем к отопительному периоду', category: 'towers_hvac', method: 'heating' },
  { id: 25, name: 'Очистка систем вентиляции', category: 'vent_sewer', method: 'vent' },
  { id: 26, name: 'Дезинфекция зданий и промышленных сооружений', category: 'vent_sewer', method: 'disinfect' },
  { id: 27, name: 'Промышленная сварка (допуски/аттестации)', category: 'repair_weld', method: 'weld' },
  { id: 28, name: 'Теплоизоляция трубопроводов и оборудования', category: 'insulation', method: 'insul', keyService: true },
  { id: 29, name: 'Монтаж / демонтаж технологического оборудования', category: 'mount', method: 'mount', keyService: true },
  { id: 30, name: 'Химическая подготовка колонного оборудования (пропарка/дегазация)', category: 'vessels', method: 'clean' },
  { id: 31, name: 'ГДО / ГМО трубных пучков ТО (по Ø и fouling)', category: 'tubes', method: 'gdo', keyService: true },
  { id: 32, name: 'Опрессовка контуров / гидроиспытания', category: 'pipelines', method: 'hydrotest' },
  { id: 33, name: 'Фланцевые соединения (сборка/разборка)', category: 'mount', method: 'flange' },
  { id: 34, name: 'Огневые работы + наблюдающий', category: 'repair_weld', method: 'weld' },
  { id: 35, name: 'Перетрубка / замена трубного пучка кожухотрубного ТО', category: 'tubes', method: 'gmo' },
  { id: 36, name: 'Очистка контуров охлаждения насосов/компрессоров', category: 'chem_circuits', method: 'cip' },
  { id: 37, name: 'Ремонт пакета пластин (замена пластин/уплотнений)', category: 'repair_weld', method: 'plates_pack' },
  { id: 38, name: 'Такелаж / строповка аппаратов', category: 'mount', method: 'rigging' },
  { id: 39, name: 'Пассивация / нейтрализация после химочистки', category: 'pipelines', method: 'pickle' },
  { id: 40, name: 'Комплекс «остановка → очистка → опрессовка → пуск»', category: 'chem_circuits', method: 'cip' },
];

const COMPLEXITY = ['simple', 'typical', 'hard', 'extreme'];

/** Число вариаций: ключевые 10, вторичные ключевые 9, остальные 7 (+ extraVars). */
function variationCount(svc) {
  if (svc.skipQueries) return 0;
  if (svc.keyService) return 10;
  if ([3, 4, 11, 12, 14, 15, 32].includes(svc.id)) return 8;
  if ([6, 7, 8, 9, 19].includes(svc.id)) return 9;
  return 7 + (svc.extraVars || 0);
}

function pickComplexity(variation, total) {
  const idx = Math.min(
    COMPLEXITY.length - 1,
    Math.floor(((variation - 1) / Math.max(total - 1, 1)) * (COMPLEXITY.length - 0.01))
  );
  return COMPLEXITY[idx];
}

const HINTS_COMMON = ['форум подрядчиков', 'ГЭСНм', 'ЕНиР', 'отчёт промывки', 'опыт НПЗ'];

function hintsFor(category, method) {
  const h = [...HINTS_COMMON];
  if (category === 'plates') h.push('пластинчатый теплообменник', 'CIP цикл');
  if (category === 'tubes') h.push('кожухотрубный', 'трубки за смену');
  if (category === 'avo') h.push('воздухоохладитель', 'секция АВО');
  if (category === 'boilers') h.push('котельная', 'ГЭСНр 69');
  if (category === 'pipelines') h.push('Ду трубопровода', method === 'aspo' ? 'АСПО парафины' : 'химпромывка');
  if (category === 'insulation') h.push('ЕНиР Е11', 'минвата');
  if (category === 'mount') h.push('такелаж', 'монтаж ТО');
  if (method === 'hydrotest') h.push('опрессовка', 'гидроиспытание');
  return h.slice(0, 5);
}

/** Шаблоны вопросов по variation 1..n */
function buildQuestion(svc, variation, total) {
  const { name } = svc;
  const tag = `«${name}»`;
  const v = variation;
  const axes = [
    `Сколько смен занимает ${tag} на малом объекте с лёгким загрязнением — есть ли опыт подрядчиков или ориентиры ГЭСН/ЕНиР по выработке бригады?`,
    `Какая типовая производительность (м²/смену, труб/смену или сут/аппарат) при ${tag} на среднем объекте и составе бригады 1 мастер + 3 исполнителя?`,
    `Сколько календарных дней и человеко-смен требуется для ${tag} при тяжёлом fouling / АСПО / биообрастании — что пишут на отраслевых форумах?`,
    `Как меняется длительность ${tag} при другом диаметре труб, большей площади теплообмена или объёме контура — есть ли таблицы выработки?`,
    `Сравнение сроков: химия против гидродинамики/механики для ${tag} — какой метод быстрее при том же качестве?`,
    `Сколько добавляет к срокам ${tag} работа в ОЗП, на высоте или в стеснённых условиях — как учитывают наблюдающих и спасателей в сроках?`,
    `Крайний случай: аварийный срок, несколько аппаратов подряд или повторная промывка после ${tag} — какая выработка реалистична по отзывам?`,
    `Нужна оценка трудозатрат (чел·ч или чел·смен) на ${tag} при двух параллельных постах — что встречается в сметах подрядчиков?`,
    `Какой состав смены и сколько циклов/проходов закладывают при ${tag} на крупном НПЗ — без ссылок на конкретные шифры норм, только практика?`,
    `Итоговая длительность «под ключ» для ${tag} с мобилизацией и демобилизацией бригады — какие диапазоны называют исполнители?`,
  ];
  let q = axes[(v - 1) % axes.length];
  q = injectContext(q, svc, v);
  return q;
}

function injectContext(q, svc, v) {
  const ctx = contextSnippets(svc, v);
  if (!ctx) return q;
  return `${q.replace(/\?$/, '')} (${ctx})?`;
}

function contextSnippets(svc, v) {
  const { category, method } = svc;
  const pools = {
    plates: [
      'контур 2–4 м³, 1 аппарат',
      '150–300 м² площади, 2 аппарата',
      'CIP 3–5 циклов, безразборно',
      'разбор 800–1200 пластин',
      'ИТП 50–120 м²',
    ],
    tubes: [
      '500–1500 трубок Ø16–25 мм',
      '3000+ трубок, длина 6–9 м',
      'пучок подогрева нефти',
      'ГМО после ГДО',
      'замена пучка 1 аппарат',
    ],
    avo: [
      '4–8 секций наружная мойка',
      'трубки секции Ø19',
      'комбинация химия + гидро',
      'MLSP / стеснённая площадка',
    ],
    boilers: [
      'водогрейный 20–50 Гкал/ч',
      'котёл-утилизатор',
      'контур 15–40 м³ химия',
      'механика золоудаления + ТО',
    ],
    pipelines: [
      'L=200 м, Ду150',
      'L=2 км нефтепровод АСПО',
      'протравка Ду300 перед пуском',
      'опрессовка 1 контур',
      'пассивация после кислоты',
    ],
    vessels: [
      'РВС 1000 м³, отложения 2 см',
      'колонна K-101 пропарка',
      'закрытое пространство',
    ],
    towers_hvac: [
      'градирня 5000 м² орошения',
      'ИТП 3–8 м³ контур',
      'отопление 120 м³',
      'пневмоимпульс 400 м сети',
    ],
    vent_sewer: [
      '500 м² воздуховодов',
      'дезинфекция 2000 м²',
    ],
    repair_weld: [
      'компаблок 1 шт',
      'сварка DN200',
      'пакет 400 пластин',
    ],
    insulation: [
      'DN150 минвата 50 мм',
      '1000 м² изоляции',
      'фланцы DN400',
    ],
    mount: [
      'демонтаж 1 ТО',
      'такелаж 12 т',
      '20 фланцевых стыков',
    ],
    chem_circuits: [
      'промывка на режиме',
      'замена теплоносителя 80 м³',
      'сквозной цикл остановка-пуск',
    ],
  };
  const list = pools[category] || ['типовой объект'];
  return list[(v - 1) % list.length];
}

function buildInputs(svc, variation, complexity) {
  const base = { complexity, variation_axis: variation };
  const { category, method } = svc;
  if (category === 'plates') {
    Object.assign(base, {
      apparatus: variation <= 3 ? 1 : 2,
      surface_m2: 80 + variation * 40,
      circuit_m3: 1.5 + variation * 0.8,
      cycles: method === 'chem_cip' ? 2 + (variation % 4) : undefined,
    });
  } else if (category === 'tubes') {
    Object.assign(base, {
      tubes: 200 * variation,
      diameter_mm: variation % 2 ? 16 : 25,
      length_m: 5 + variation * 0.5,
      fouling: complexity,
    });
  } else if (category === 'avo') {
    Object.assign(base, { sections: 2 + variation, surface_m2: 120 * variation });
  } else if (category === 'boilers') {
    Object.assign(base, { boilers: 1 + Math.floor(variation / 4), circuit_m3: 10 + variation * 3 });
  } else if (category === 'pipelines') {
    Object.assign(base, {
      length_m: 100 * variation,
      dn_mm: 100 + variation * 20,
      circuit_m3: method === 'hydrotest' ? 1 : 5 + variation,
    });
  } else if (category === 'vessels') {
    Object.assign(base, { volume_m3: 50 + variation * 100, deposit_cm: variation % 4 });
  } else if (category === 'towers_hvac') {
    Object.assign(base, {
      surface_m2: method === 'tower' ? 1000 * variation : undefined,
      circuit_m3: method !== 'tower' ? 5 + variation * 8 : undefined,
      length_m: method === 'pneumo' ? 50 * variation : undefined,
    });
  } else if (category === 'vent_sewer') {
    Object.assign(base, { surface_m2: 200 * variation, length_m: 30 * variation });
  } else if (category === 'insulation') {
    Object.assign(base, { surface_m2: 50 * variation, dn_mm: 108 + variation * 30 });
  } else if (category === 'mount') {
    Object.assign(base, { qty: variation, mass_t: 5 + variation * 2 });
  } else if (category === 'repair_weld') {
    Object.assign(base, { qty: 1, length_m: variation * 2, joints: 10 * variation });
  } else if (category === 'chem_circuits') {
    Object.assign(base, { circuit_m3: 10 + variation * 5, cycles: 1 + (variation % 3) });
  }
  if (method) base.method_code = method;
  if (category) base.category_code = category;
  return base;
}

function main() {
  const lines = [];
  let qNum = 0;
  for (const svc of SERVICES) {
    const n = variationCount(svc);
    for (let v = 1; v <= n; v++) {
      qNum += 1;
      const id = `Q${String(qNum).padStart(3, '0')}`;
      const complexity = pickComplexity(v, n);
      lines.push({
        id,
        service_id: svc.id,
        service_name: svc.name,
        category: svc.category,
        method: svc.method,
        variation: v,
        complexity,
        question_ru: buildQuestion(svc, v, n),
        search_hints: hintsFor(svc.category, svc.method),
        inputs: buildInputs(svc, v, complexity),
      });
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8');

  const bySvc = {};
  for (const row of lines) {
    bySvc[row.service_id] = (bySvc[row.service_id] || 0) + 1;
  }
  console.log(`Wrote ${lines.length} queries → ${OUT}`);
  console.log('Per service:', JSON.stringify(bySvc));
}

if (require.main === module) main();

module.exports = { SERVICES, variationCount, OUT };
