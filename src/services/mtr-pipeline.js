'use strict';
/**
 * mtr-pipeline.js — МТР после разбора ДВ.
 *
 * ── Почему отдельный шаг ──────────────────────────────────────────────────
 * МТР приходил нулевым не потому, что модели нечем ответить, а потому что
 * его никто не спрашивал системно: разбор ДВ отдавал позиции объёмов, и на
 * этом заканчивался. Здесь отдельный проход: по видам работ собранного ДВ
 * определяем, что нужно физически, сверяем со СКЛАДОМ и, если позиции нет,
 * ищем цену в интернете.
 *
 * ── Агрегация, а не позиция в позицию ─────────────────────────────────────
 * 603 позиции ДВ не должны дать 603 строки МТР. Шланг на 219 аппаратов — это
 * одна потребность с количеством, а не 219 строк. Группируем по нормализован-
 * ному имени, суммируем количество, оставляем первую ссылку на ДВ.
 *
 * ── Что попадает в смету ──────────────────────────────────────────────────
 *   warehouse → раздел B (есть в наличии, цена = 0, только количество)
 *   purchase  → раздел G (закупка, цена из поиска)
 * Если цена не подтверждена (stub-поиск, нет результата) — строка помечается
 * `price_confirmed: false` и НЕ уходит в итог молча: РП должен увидеть пробел.
 */

const td = require('./tool-dispatcher');

/** Какие ресурсы нужны по виду работ. Ключ — подстрока в названии/методе. */
const RESOURCE_HINTS = [
  {
    match: /гидро|гидрод|гидроструйн|рвд|высок\w*\s+давлен/i,
    items: [
      { name: 'шланг высокого давления (РВД)', unit: 'шт', qty_per: 0.02, note: 'износ и обрыв на аппарат' },
      { name: 'форсунка гидроструйная', unit: 'шт', qty_per: 0.01, note: 'износ сопла' },
      { name: 'сальник / уплотнение насоса', unit: 'компл', qty_per: 0.02, note: 'ремкомплект насоса' }
    ]
  },
  {
    match: /химическ|кислотн|щелочн|промывк\w*\s+реагент|ингибитор|пассивац/i,
    items: [
      { name: 'ингибитор коррозии', unit: 'кг', qty_per: 0.05, note: 'на объём промывки' },
      { name: 'кислота техническая', unit: 'кг', qty_per: 0.25, note: 'рабочий раствор' },
      { name: 'нейтрализатор', unit: 'кг', qty_per: 0.08, note: 'слив после промывки' }
    ]
  },
  {
    match: /сварк|сварочн|наплавк|резк|накс/i,
    items: [
      { name: 'электроды сварочные', unit: 'кг', qty_per: 0.15, note: 'на стык' },
      { name: 'круг отрезной', unit: 'шт', qty_per: 0.05, note: 'зачистка' }
    ]
  },
  {
    match: /изоляц|теплоизол|минват|скорлуп/i,
    items: [
      { name: 'изоляция (минвата/скорлупа)', unit: 'м', qty_per: 0.3, note: 'на погонный метр' },
      { name: 'лента армированная', unit: 'рул', qty_per: 0.02, note: 'обмотка' }
    ]
  },
  {
    match: /монтаж|демонтаж|установк|замен/i,
    items: [
      { name: 'крепёж (болты, гайки, шпильки)', unit: 'компл', qty_per: 0.1, note: 'на узел' },
      { name: 'прокладка уплотнительная', unit: 'шт', qty_per: 0.1, note: 'на фланец' }
    ]
  },
  {
    match: /чистк|очистк|мойк|промыв/i,
    items: [
      { name: 'моющее средство техническое', unit: 'кг', qty_per: 0.02, note: 'на аппарат' },
      { name: 'ветошь обтирочная', unit: 'кг', qty_per: 0.01, note: 'уборка' }
    ]
  }
];

/** Всегда нужные позиции — СИЗ и расходники идут отдельно в смете, но в
 *  списке МТР должны быть, чтобы РП видел полную потребность. */
const BASE_ITEMS = [
  { name: 'перчатки защитные', unit: 'пар', qty_per_man: 1, note: 'на человека на выезд' }
];

/**
 * Типовая ТЕХНИКА по методу работ — не расходники.
 *
 * ── Зачем ─────────────────────────────────────────────────────────────────
 * `RESOURCE_HINTS` выше описывает расходники (РВД, форсунки, ветошь), и на
 * тендере 2138 МТР вышел из 8 строк расходников без единой установки. Причина
 * не в модели: работу физически нечем выполнить, а в списке этого не было.
 *
 * Ключ — подстрока в названии/методе/`tech_equip`. Отдаём тип техники, а не
 * марку: заказчик марку не пишет, и это не повод молчать.
 *
 * `price_hint` — заглушка верхней границы из MODULE-norms-asgard-v1:377-395.
 * Это НЕ цена сделки: она нужна, чтобы строка не была нулевой в блоке закупки
 * и РП видел порядок. Подтверждает цену человек или веб-поиск.
 */
const EQUIPMENT_HINTS = [
  {
    match: /гидро|гидрод|гидроструйн|гдо|авд|высок\w*\s+давлен|сверхвысок/i,
    items: [
      { name: 'установка гидроструйной очистки высокого давления (АВД)', unit: 'шт',
        per: 'post', price_hint: 350000, note: '1 установка = 1 фронт работ' },
      { name: 'шланг высокого давления (РВД) в комплекте', unit: 'компл',
        per: 'unit', price_hint: 45000, note: 'расходник на установку' }
    ]
  },
  {
    match: /химическ|кислотн|щелочн|промывк|ингибитор|пассивац|cip|реагент/i,
    items: [
      { name: 'насосная станция дозирования реагента', unit: 'шт',
        per: 'post', price_hint: 150000, note: 'подача раствора в контур' },
      { name: 'ёмкость с обвязкой (CIP-контур)', unit: 'компл',
        per: 'post', price_hint: 200000, note: 'приготовление и слив раствора' },
      { name: 'pH-метр / расходомер', unit: 'компл',
        per: 'post', price_hint: 40000, note: 'контроль раствора' }
    ]
  },
  {
    match: /сварк|сварочн|наплавк|резк|накс|трубопровод|заварить|стык/i,
    items: [
      { name: 'сварочный пост (аппарат + оснастка)', unit: 'шт',
        per: 'post', price_hint: 200000, note: 'на сварщика' },
      { name: 'баллон защитного газа с редуктором', unit: 'компл',
        per: 'post', price_hint: 25000, note: 'аргон/смесь' }
    ]
  },
  {
    match: /изоляц|теплоизол|минват|скорлуп/i,
    items: [
      { name: 'инструмент для монтажа изоляции', unit: 'компл',
        per: 'post', price_hint: 30000, note: 'нож, степлер, раскрой' }
    ]
  },
  {
    match: /монтаж|демонтаж|замен|подъ[её]м|такелаж/i,
    items: [
      { name: 'автокран / манипулятор (аренда)', unit: 'смена',
        per: 'trip', price_hint: 25000, note: 'аренда, не покупка' },
      { name: 'леса / подмости (аренда)', unit: 'компл',
        per: 'post', price_hint: 60000, note: 'работы на высоте' }
    ]
  },
  {
    match: /очистк|чистк|накип|отложен|шлам|мойк|промыв/i,
    items: [
      { name: 'установка гидроструйной очистки высокого давления (АВД)', unit: 'шт',
        per: 'post', price_hint: 350000, note: 'механическая очистка поверхностей' },
      { name: 'насадка / шарошка для очистки труб', unit: 'компл',
        per: 'post', price_hint: 35000, note: 'очистка внутренних поверхностей' }
    ]
  },
  {
    match: /пескоструй|абразив|дробеструй|дробеочистк/i,
    items: [
      { name: 'пескоструйная установка', unit: 'шт',
        per: 'post', price_hint: 250000, note: '1 установка = 1 пост' },
      { name: 'компрессор воздушный', unit: 'шт',
        per: 'post', price_hint: 150000, note: 'питание пескоструя' }
    ]
  },
  {
    match: /высот|промальп|люльк|верхолаз/i,
    items: [
      { name: 'страховочная привязь', unit: 'компл',
        per: 'man', price_hint: 50000, note: 'на работающего на высоте' },
      { name: 'верёвка статика 11 мм', unit: 'м',
        per: 'man', price_hint: 200, note: 'спуск/подъём, 50 м на человека' }
    ]
  },
  {
    match: /газоопасн|загазован|драгер|газоанализ|азот|инертн/i,
    items: [
      { name: 'газоанализатор многоканальный', unit: 'шт',
        per: 'post', price_hint: 70000, note: 'контроль среды перед спуском' }
    ]
  },
  {
    match: /бетон|стяжк|фундамент|кирпич|кладк|штукатур/i,
    items: [
      { name: 'бетоносмеситель', unit: 'шт',
        per: 'post', price_hint: 80000, note: 'приготовление смеси' },
      { name: 'вибратор глубинный', unit: 'шт',
        per: 'post', price_hint: 25000, note: 'уплотнение бетона' }
    ]
  },
  {
    match: /землян|котлован|транше|экскават|грунт/i,
    items: [
      { name: 'экскаватор (аренда)', unit: 'смена',
        per: 'trip', price_hint: 35000, note: 'аренда' }
    ]
  },
  {
    match: /покрас|окрас|антикорроз|грунтовк|лакокрас/i,
    items: [
      { name: 'краскопульт / окрасочный агрегат', unit: 'шт',
        per: 'post', price_hint: 60000, note: 'наносимый состав' }
    ]
  },
  {
    match: /электромонтаж|кабел|щит|электрик|электрооборуд/i,
    items: [
      { name: 'инструмент электромонтажника', unit: 'компл',
        per: 'post', price_hint: 45000, note: 'опрессовка, прозвонка' }
    ]
  }
];

/**
 * Подбирает типовую технику по тексту позиций.
 *
 * Возвращает строки с `source: 'typical'` и `basis: 'method'`: это НЕ факт
 * наличия на складе, а «такая техника нужна по методу». Склад подставится
 * отдельным матчингом, РП подтвердит.
 *
 * @param {Array} positions — позиции ДВ (name, tech_equip, method_name, objects, volume, unit)
 * @param {object} [opts]
 * @param {number} [opts.trips=1] — заездов, для аренды посменной техники
 * @param {number} [opts.crew=0] — людей в смене, для «на человека»
 * @returns {Array<{name:string, unit:string, qty:number, source:string, basis:string, price_hint:number, note:string}>}
 */
function deriveEquipment(positions, opts) {
  const o = opts || {};
  const list = Array.isArray(positions) ? positions : [];
  const trips = Math.max(1, Number(o.trips) || 1);
  const crew = Math.max(0, Number(o.crew) || 0);

  const buckets = new Map();

  list.forEach((pos) => {
    if (!pos) return;
    const hay = [pos.name, pos.tech_equip, pos.method_name, pos.category_name]
      .filter(Boolean).join(' ');
    if (!hay) return;

    // Сколько параллельных фронтов даёт эта позиция.
    let fronts = 0;
    if (Array.isArray(pos.objects) && pos.objects.length) {
      fronts = pos.objects.reduce((s, o2) => s + (Number(o2 && o2.qty) || 0), 0);
    }
    if (!(fronts > 0)) fronts = Number(pos.objects_count) || 0;
    if (!(fronts > 0)) fronts = 1;
    // Потолок: столько бригад на объект не встанет, остальное — ошибка распознавания.
    fronts = Math.min(fronts, 12);

    EQUIPMENT_HINTS.forEach((group) => {
      if (!group.match.test(hay)) return;
      group.items.forEach((item) => {
        let qty = 1;
        if (item.per === 'post') qty = fronts;
        else if (item.per === 'trip') qty = trips;
        else if (item.per === 'man') qty = crew > 0 ? crew : 1;
        else if (item.per === 'unit') qty = fronts;
        // Погонные метры на человека (верёвка): на человека не 1 м, а длина спуска.
        if (item.unit === 'м' && item.per === 'man') qty *= 50;

        const key = normalizeName(item.name) + '|' + item.unit;
        const cur = buckets.get(key) || {
          name: item.name,
          unit: item.unit,
          qty: 0,
          source: 'typical',
          basis: 'method',
          price_hint: item.price_hint || null,
          note: item.note || '',
          hits: 0
        };
        // Не суммируем фронты по всем позициям: одна установка на пост,
        // а не по установке на каждую строку ведомости.
        cur.qty = Math.max(cur.qty, qty);
        cur.hits += 1;
        buckets.set(key, cur);
      });
    });
  });

  return Array.from(buckets.values()).map((x) => ({
    name: x.name,
    unit: x.unit,
    qty: Math.max(1, Math.ceil(x.qty)),
    source: x.source,
    basis: x.basis,
    price_hint: x.price_hint,
    note: x.note,
    hits: x.hits
  }));
}

/** Справочник техники для промпта: «метод → что нужно». */
function equipmentHintText() {
  return EQUIPMENT_HINTS.map((g) => {
    const items = g.items.map((i) => `${i.name} (${i.unit}, на ${i.per === 'post' ? 'пост' : i.per === 'trip' ? 'заезд' : i.per === 'man' ? 'человека' : 'единицу'})`);
    return '- ' + items.join('; ');
  }).join('\n');
}


/** Нормализует имя для группировки. */
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Определяет, какие ресурсы нужны, по ДВ.
 *
 * @param {object} p
 * @param {Array} p.positions — нормализованные позиции ДВ
 * @param {number} [p.people] — людей в смене (для СИЗ)
 * @param {number} [p.trips=1]
 * @returns {Array<{name:string, unit:string, qty:number, note:string, basis:string}>}
 */
function deriveNeeds(p) {
  const o = p || {};
  const positions = Array.isArray(o.positions) ? o.positions : [];
  const trips = Math.max(1, Number(o.trips) || 1);

  // Считаем «единицы объёма» по каждому виду: сколько аппаратов/тонн/метров.
  const buckets = new Map(); // ключ ресурса → { qty, unit, note, hits }

  const addNeed = (item, volumeUnits, basis) => {
    const key = normalizeName(item.name) + '|' + item.unit;
    const cur = buckets.get(key) || {
      name: item.name,
      unit: item.unit,
      qty: 0,
      note: item.note,
      basis,
      hits: 0
    };
    const q = Number(item.qty_per) > 0 ? Number(item.qty_per) * volumeUnits : 0;
    cur.qty += q;
    cur.hits += 1;
    buckets.set(key, cur);
  };

  if (!positions.length) {
    // ДВ пуст — не выдумываем потребность. Отдаём только базу по людям.
    const people = Math.max(0, Number(o.people) || 0);
    if (people > 0) {
      for (const it of BASE_ITEMS) {
        buckets.set(normalizeName(it.name) + '|' + it.unit, {
          name: it.name,
          unit: it.unit,
          qty: Math.ceil(people * (Number(it.qty_per_man) || 1) * trips),
          note: it.note,
          basis: 'люди',
          hits: 1
        });
      }
    }
    return [...buckets.values()];
  }

  for (const pos of positions) {
    const hay = [pos.name, pos.tech_equip, pos.method_name, pos.category_name]
      .filter(Boolean).join(' ');
    if (!hay) continue;

    // Сколько единиц оборудования в позиции. Приоритет:
    //   1) objects[].qty — реальное число аппаратов;
    //   2) трубок по объёму / длине — для чистки трубок;
    //   3) объём в п.м / типовая длина 6 м — грубая, но не «1».
    // Без этого 613 позиций давали «шланг × 1», что бессмысленно.
    let units = 0;
    if (Array.isArray(pos.objects) && pos.objects.length) {
      units = pos.objects.reduce((s, o) => s + (Number(o && o.qty) || 0), 0);
    }
    if (!(units > 0)) {
      const lenM = Number(pos.conversion_params && pos.conversion_params.length_m);
      const lenNorm = lenM > 100 ? lenM / 1000 : lenM;
      const vol = Number(pos.volume);
      if (vol > 0 && lenNorm > 0) units = vol / lenNorm;
      else if (vol > 0) units = vol / 6;
    }
    if (!(units > 0)) units = 1;

    // Расходники гидрочистки зависят от ПОГОННЫХ МЕТРОВ, а не от числа
    // аппаратов: шланг и форсунка изнашиваются на каждый метр прохода.
    // Норма расхода: ~1 комплект шланга на 5000 п.м, форсунка на 10000 п.м.
    // Без этого 46 800 п.м давали «шланг × 1».
    const runM = /п\.?\s*м|пог\.?\s*м/i.test(String(pos.unit || ''))
      ? Number(pos.volume) || 0
      : 0;
    if (runM > 0) units = Math.max(units, runM / 5000);

    let matched = false;
    for (const hint of RESOURCE_HINTS) {
      if (!hint.match.test(hay)) continue;
      matched = true;
      for (const item of hint.items) addNeed(item, units, pos.category_name || 'по видам работ');
    }
    if (!matched) {
      // Вид работ не распознан — берём самый общий расходник, но помечаем.
      addNeed(
        { name: 'расходные материалы (уточнить)', unit: 'компл', qty_per: 0.01, note: 'вид работ не распознан' },
        units,
        'не распознано'
      );
    }
  }

  // СИЗ по людям — отдельной строкой, если люди известны.
  const people = Math.max(0, Number(o.people) || 0);
  if (people > 0) {
    for (const it of BASE_ITEMS) {
      const key = normalizeName(it.name) + '|' + it.unit;
      const cur = buckets.get(key);
      const q = Math.ceil(people * (Number(it.qty_per_man) || 1) * trips);
      if (cur) cur.qty = Math.max(cur.qty, q);
      else {
        buckets.set(key, {
          name: it.name, unit: it.unit, qty: q, note: it.note, basis: 'люди', hits: 1
        });
      }
    }
  }

  // Округляем вверх: «0.02 шланга» бессмысленно, нужно целое.
  return [...buckets.values()]
    .map((x) => Object.assign({}, x, { qty: Math.max(0, Math.ceil(x.qty)) }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.hits - a.hits);
}

/**
 * Сверяет потребности со складом и ищет цены для отсутствующего.
 *
 * @param {object} p
 * @param {object} p.db
 * @param {Array} p.needs — из deriveNeeds
 * @param {boolean} [p.allowWeb=true]
 * @returns {Promise<Array>} строки МТР
 */
async function resolveMtr(p) {
  const o = p || {};
  const needs = Array.isArray(o.needs) ? o.needs : [];
  const allowWeb = o.allowWeb !== false;
  const out = [];

  for (const need of needs) {
    const wh = await td.searchWarehouse(o.db, { query: need.name, limit: 5 });

    if (wh.total > 0) {
      // Берём лучшую позицию по количеству и совпадению имени.
      const best = wh.items[0];
      out.push({
        name: best.name,
        unit: best.unit || need.unit,
        qty: need.qty,
        source: 'warehouse',
        stock_qty: best.qty,
        stock_enough: best.qty >= need.qty,
        price: 0,                     // со склада — уже наше
        price_confirmed: true,
        basis: need.basis,
        note: need.note,
        // Если на складе меньше нужного, разницу докупаем.
        shortfall: Math.max(0, need.qty - best.qty)
      });
      continue;
    }

    // На складе нет — ищем цену. Без подтверждения цена остаётся null.
    let price = null;
    let confirmed = false;
    let cite = null;
    if (allowWeb) {
      const w = await td.webSearch({ query: 'цена ' + need.name + ' купить' });
      if (!w.stub && w.answer) {
        // Ищем первое РАЗУМНОЕ число рублей в ответе. Не берём «2026» (год)
        // и не берём числа больше 10 млн — это опечатки и оптовые партии.
        const nums = (w.answer.match(/(\d[\d\s]{2,9})(?:\s*(?:руб|₽|р\.))/gi) || [])
          .map((s) => Number(s.replace(/[^\d]/g, '')))
          .filter((n) => n >= 50 && n <= 10_000_000);
        if (nums.length) {
          price = nums[0];
          confirmed = true;
          cite = (w.citations && w.citations[0] && w.citations[0].url) || null;
        }
      }
    }

    out.push({
      name: need.name,
      unit: need.unit,
      qty: need.qty,
      source: 'purchase',
      stock_qty: 0,
      stock_enough: false,
      price,
      price_confirmed: confirmed,
      price_citation: cite,
      basis: need.basis,
      note: need.note,
      // Неподтверждённая цена — это пробел, который должен видеть РП.
      gap: confirmed ? null : 'цена не подтверждена — уточните у снабжения'
    });
  }

  return out;
}

/**
 * Раскладывает МТР по разделам сметы.
 *
 * @param {Array} rows — из resolveMtr
 * @returns {{section_b:Array, section_g:Array, gaps:Array, totals:object}}
 */
function splitForSmeta(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const sectionB = list.filter((r) => r.source === 'warehouse');
  const sectionG = list.filter((r) => r.source === 'purchase');
  const gaps = list.filter((r) => r.gap);

  const gSum = sectionG.reduce((s, r) => s + (Number(r.price) || 0) * (Number(r.qty) || 0), 0);

  return {
    section_b: sectionB,
    section_g: sectionG,
    gaps,
    totals: {
      warehouse_items: sectionB.length,
      purchase_items: sectionG.length,
      purchase_sum: Math.round(gSum * 100) / 100,
      unconfirmed: gaps.length
    }
  };
}

/**
 * Полный проход: ДВ → потребности → склад/поиск → разделы сметы.
 *
 * @param {object} p
 * @returns {Promise<object>}
 */
async function buildMtr(p) {
  const o = p || {};
  const needs = deriveNeeds({
    positions: o.positions,
    people: o.people,
    trips: o.trips
  });

  // ── Техника по методу ────────────────────────────────────────────────────
  // Раньше МТР состоял только из расходников: на тендере 2138 вышло 8 строк
  // (ветошь, сальники), но ни одной установки — работать было нечем.
  // Здесь типовая техника добавляется к расходникам, а не заменяет их.
  const equipment = deriveEquipment(o.positions, {
    trips: o.trips,
    crew: o.people
  });
  const equipNeeds = equipment.map((e) => ({
    name: e.name,
    unit: e.unit,
    qty: e.qty,
    basis: e.basis,
    note: e.note,
    source_hint: e.source,
    price_hint: e.price_hint,
    is_equipment: true
  }));

  if (!needs.length && !equipNeeds.length) {
    return {
      needs: [],
      rows: [],
      section_b: [],
      section_g: [],
      gaps: [],
      totals: { warehouse_items: 0, purchase_items: 0, purchase_sum: 0, unconfirmed: 0 },
      note: 'МТР не определён: нет ни позиций ДВ, ни данных о людях'
    };
  }

  const consumRows = needs.length
    ? await resolveMtr({ db: o.db, needs, allowWeb: o.allowWeb })
    : [];
  // Техника: склад сверяем, но веб-поиск по каждой установке — дорого и
  // неточно. Если цены нет, ставим price_hint из справочника и помечаем,
  // что она не подтверждена.
  const equipRows = equipNeeds.length
    ? await resolveMtr({ db: o.db, needs: equipNeeds.map((n) => ({ ...n, qty_per: 0 })), allowWeb: false })
      .catch(() => [])
    : [];

  // resolveMtr не знает про price_hint — переносим его и помечаем пробел.
  const equipByName = new Map(equipNeeds.map((n) => [normalizeName(n.name), n]));
  equipRows.forEach((r) => {
    const hint = equipByName.get(normalizeName(r.name));
    if (!hint) return;
    if (!(Number(r.price) > 0) && Number(hint.price_hint) > 0) {
      r.price = Number(hint.price_hint);
      r.price_confirmed = false;
      r.price_hint_used = true;
      r.gap = 'цена типовая (справочник) — уточните у снабжения';
    }
    r.is_equipment = true;
    r.basis = hint.basis || r.basis;
  });

  // Слияние с дедупом по имени: одна строка на ресурс.
  const merged = [];
  const seen = new Map();
  [...equipRows, ...consumRows].forEach((r) => {
    const key = normalizeName(r.name) + '|' + String(r.unit || '').toLowerCase();
    if (seen.has(key)) {
      // Дубликат: берём максимум по количеству, склад важнее закупки.
      const cur = seen.get(key);
      cur.qty = Math.max(Number(cur.qty) || 0, Number(r.qty) || 0);
      if (r.source === 'warehouse') {
        cur.source = 'warehouse';
        cur.price = 0;
        cur.price_confirmed = true;
        cur.stock_qty = r.stock_qty;
        cur.stock_enough = r.stock_enough;
      }
      return;
    }
    seen.set(key, r);
    merged.push(r);
  });

  return Object.assign({
    needs: needs.concat(equipNeeds),
    rows: merged,
    equipment: equipRows
  }, splitForSmeta(merged));
}

module.exports = {
  RESOURCE_HINTS,
  EQUIPMENT_HINTS,
  BASE_ITEMS,
  normalizeName,
  deriveNeeds,
  deriveEquipment,
  equipmentHintText,
  resolveMtr,
  splitForSmeta,
  buildMtr
};
