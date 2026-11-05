'use strict';
/**
 * Кластеризация номенклатуры → типы карточек маркетплейса.
 * Input: tests/reports/market-card-clusters/{products,equipment}_nomen.csv
 *        + AGENT-TAXONOMY.json
 * Output: CARD-CLUSTERS-REPORT.md + CARD-CLUSTERS.json
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'tests', 'reports', 'market-card-clusters');
const TAX = JSON.parse(fs.readFileSync(path.join(DIR, 'AGENT-TAXONOMY.json'), 'utf8'));

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length);
  const rows = [];
  for (const line of lines) {
    const parts = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
          continue;
        }
        q = !q;
        continue;
      }
      if (c === ',' && !q) {
        parts.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    parts.push(cur);
    rows.push(parts);
  }
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => {
      o[h] = r[i] != null ? r[i] : '';
    });
    return o;
  });
}

/** JS \\b ломается на кириллице — заменяем на границы «не буква/цифра». */
function fixCyrBoundary(raw) {
  return String(raw)
    .replace(/\\b/g, '(?:^|[^0-9A-Za-zА-Яа-яЁё])')
    .replace(/\(\?\<\!\[[^\]]*\]\)/g, ''); // lookbehind упрощаем — иначе часть правил падает
}

function compileOne(a) {
  const hints = a.match_hints || [];
  const regexHints = hints.filter((h) => h.startsWith('regex:'));
  const negHints = hints.filter((h) => h.startsWith('negative:'));
  const groupHints = hints
    .filter((h) => h.startsWith('search_group:'))
    .map((h) => h.slice('search_group:'.length).trim());
  const unitHints = hints
    .filter((h) => h.startsWith('unit:'))
    .map((h) => h.slice('unit:'.length).trim());

  let re = null;
  if (regexHints.length) {
    const raw = fixCyrBoundary(regexHints[0].slice('regex:'.length).trim());
    try {
      re = new RegExp(raw, 'i');
    } catch (e) {
      console.warn('bad regex', a.key, e.message, raw);
    }
  }
  const negatives = negHints
    .map((h) => {
      const raw = fixCyrBoundary(h.slice('negative:'.length).trim());
      try {
        return new RegExp(raw, 'i');
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);

  return { ...a, re, negatives, groupHints, unitHints };
}

function compileRules(archetypes) {
  const base = archetypes.map(compileOne);
  // доп. правила на частый «хвост» other (порядок = приоритет внутри EXTRA)
  const EXTRA = [
    {
      key: 'hose_rvd',
      title: 'Рукав высокого давления (РВД)',
      match_hints: ['regex: \\bрвд\\b|рукав\\s*высок'],
    },
    {
      key: 'tool_angle_grinder',
      title: 'УШМ / болгарка',
      match_hints: ['regex: ушм|болгарк|углова?я\\s*шлиф|углошлиф'],
    },
    {
      key: 'equip_flashlight_head',
      title: 'Фонарь налобный',
      match_hints: ['regex: налобн\\w*\\s*фонар|фонар\\w*\\s*налобн'],
    },
    {
      key: 'equip_flashlight_hand',
      title: 'Фонарь ручной / переносной',
      match_hints: ['regex: фонар'],
    },
    {
      key: 'tool_extension_reel',
      title: 'Удлинитель / переноска на катушке',
      match_hints: ['regex: удлинител|переноск'],
    },
    {
      key: 'equip_hoist_chain',
      title: 'Таль цепная / ручная',
      match_hints: ['regex: \\bталь\\b'],
    },
    {
      key: 'equip_ladder',
      title: 'Лестница',
      match_hints: ['regex: лестниц'],
    },
    {
      key: 'scaffold_parts',
      title: 'Элементы лесов (стойка/связь/хомут лесов)',
      match_hints: ['regex: лес(ов|а)\\b|стойка\\s*лесов|связь\\s*(лесов|горизонт)|лх\\s*\\('],
    },
    {
      key: 'ppe_mask_welding',
      title: 'Маска сварщика',
      match_hints: ['regex: маск\\w*\\s*свар'],
    },
    {
      key: 'ppe_respirator',
      title: 'Респиратор / полумаска',
      match_hints: ['regex: респиратор|полумаск'],
    },
    {
      key: 'tool_socket_set',
      title: 'Набор головок / ключей',
      match_hints: ['regex: набор.*(ключ|головок|инструмент)|головк\\w*\\s*(торцев|ударн)'],
    },
    {
      key: 'welding_inverter',
      title: 'Сварочный инвертор / аппарат',
      match_hints: ['regex: сварочн\\w*\\s*(инвертор|аппарат)|инвертор\\s*ресанта|\\bir\\s*\\d{2,3}\\b'],
    },
    {
      key: 'tool_metal_shears',
      title: 'Ножницы по металлу',
      match_hints: ['regex: ножниц\\w*.*металл|гидравлическ\\w*\\s*ножниц'],
    },
    {
      key: 'battery_makita_pack',
      title: 'АКБ / зарядка для электроинструмента',
      match_hints: ['regex: аккумулятор.*(makita|зубр|шуруповер|инструмент)|зарядн\\w*\\s*устрой'],
    },
  ].map(compileOne);

  // EXTRA после базовых: базовые уже отработали узкие кейсы
  return base.concat(EXTRA);
}

function matchArchetype(row, rules) {
  const name = String(row.name || '');
  const unit = String(row.unit || '');
  const g = String(row.search_group || '');
  for (const r of rules) {
    if (r.negatives.some((n) => n.test(name))) continue;
    if (r.re && r.re.test(name)) return r.key;
    if (r.unitHints.length && r.unitHints.some((u) => new RegExp(u, 'i').test(unit))) return r.key;
    if (r.groupHints.length && r.groupHints.includes(g) && !r.re) {
      // только group без regex — слабый матч, пропускаем здесь (иначе всё housing)
    }
  }
  // second pass: search_group-only for housing/food/services when name empty-ish
  for (const r of rules) {
    if (!r.groupHints.length) continue;
    if (r.groupHints.includes(g) && (r.key.startsWith('housing') || r.key.startsWith('food') || r.key.startsWith('services'))) {
      if (r.re && !r.re.test(name) && !r.unitHints.some((u) => new RegExp(u, 'i').test(unit))) continue;
      if (r.re && r.re.test(name)) return r.key;
      if (!r.re && r.groupHints.includes(g)) return r.key;
    }
  }
  return 'other_fallback';
}

function main() {
  const products = parseCsv(fs.readFileSync(path.join(DIR, 'products_nomen.csv'), 'utf8'));
  const equipment = parseCsv(fs.readFileSync(path.join(DIR, 'equipment_nomen.csv'), 'utf8'));
  const rules = compileRules(TAX.archetypes.filter((a) => a.key !== 'other_fallback'));
  const titleByKey = Object.fromEntries(TAX.archetypes.map((a) => [a.key, a.title]));
  titleByKey.other_fallback = 'Прочее / нужна ручная карточка';

  const clusters = new Map();
  const bump = (key, item) => {
    if (!clusters.has(key)) {
      clusters.set(key, {
        key,
        title: titleByKey[key] || key,
        products: [],
        equipment: [],
        in_stock_products: 0,
        stock_qty: 0,
        equipment_on_warehouse: 0,
        examples: [],
      });
    }
    const c = clusters.get(key);
    if (item.kind === 'product') {
      c.products.push(item);
      const qty = Number(item.stock_qty) || 0;
      if (qty > 0) {
        c.in_stock_products += 1;
        c.stock_qty += qty;
      }
    } else {
      c.equipment.push(item);
      if (item.status === 'on_warehouse') c.equipment_on_warehouse += 1;
    }
    if (c.examples.length < 5) c.examples.push(item.name);
  };

  for (const p of products) {
    const key = matchArchetype(p, rules);
    bump(key, {
      kind: 'product',
      id: +p.id,
      name: p.name,
      unit: p.unit,
      search_group: p.search_group,
      category: p.category,
      stock_qty: +p.stock_qty || 0,
      has_photo: +p.has_photo || 0,
    });
  }

  // equipment: name = brand + model often separate
  for (const e of equipment) {
    const name = [e.name, e.brand, e.model].filter(Boolean).join(' ').trim();
    const row = { name, unit: '', search_group: 'equipment' };
    const key = matchArchetype(row, rules);
    bump(key, {
      kind: 'equipment',
      id: +e.id,
      name: e.name || name,
      brand: e.brand,
      model: e.model,
      status: e.status,
      has_photo: +e.has_photo || 0,
    });
  }

  const list = [...clusters.values()].map((c) => ({
    key: c.key,
    title: c.title,
    n_products: c.products.length,
    n_equipment: c.equipment.length,
    n_total: c.products.length + c.equipment.length,
    in_stock_products: c.in_stock_products,
    stock_qty: Math.round(c.stock_qty * 1000) / 1000,
    equipment_on_warehouse: c.equipment_on_warehouse,
    needs_card: true,
    examples: c.examples,
    // ids for mapping
    product_ids: c.products.map((p) => p.id),
    equipment_ids: c.equipment.map((e) => e.id),
  }));

  list.sort((a, b) => b.n_total - a.n_total);

  const withMembers = list.filter((c) => c.n_total > 0);
  const cardCandidates = withMembers.filter((c) => c.key !== 'other_fallback');
  const other = withMembers.find((c) => c.key === 'other_fallback');

  // Priority cards: anything with stock OR >=3 members OR equipment on wh
  const priority = cardCandidates.filter(
    (c) => c.in_stock_products > 0 || c.equipment_on_warehouse > 0 || c.n_total >= 3
  );
  const rare = cardCandidates.filter(
    (c) => c.in_stock_products === 0 && c.equipment_on_warehouse === 0 && c.n_total < 3
  );

  const report = {
    at: new Date().toISOString(),
    totals: {
      products: products.length,
      equipment: equipment.length,
      products_in_stock: products.filter((p) => +p.stock_qty > 0).length,
      equipment_on_warehouse: equipment.filter((e) => e.status === 'on_warehouse').length,
      with_photo_products: products.filter((p) => +p.has_photo > 0).length,
      with_photo_equipment: equipment.filter((e) => +e.has_photo > 0).length,
    },
    cards: {
      archetypes_with_members: cardCandidates.length,
      other_fallback_items: other ? other.n_total : 0,
      recommended_generate_now: priority.length,
      can_defer_rare: rare.length,
      estimate_cost_flash_rub: Math.round(priority.length * 4.06),
      estimate_cost_pro_rub: Math.round(priority.length * 14.6),
    },
    clusters: withMembers.map(({ product_ids, equipment_ids, ...rest }) => rest),
    mapping: Object.fromEntries(
      withMembers.map((c) => [
        c.key,
        { product_ids: c.product_ids, equipment_ids: c.equipment_ids },
      ])
    ),
  };

  fs.writeFileSync(path.join(DIR, 'CARD-CLUSTERS.json'), JSON.stringify(report, null, 2), 'utf8');

  const md = [];
  md.push('# Карточки маркетплейса — кластеры номенклатуры');
  md.push('');
  md.push(`Дата: ${report.at}`);
  md.push('');
  md.push('## Сколько позиций всего');
  md.push('');
  md.push(`| Источник | Кол-во |`);
  md.push(`|---|---:|`);
  md.push(`| Товары (products, active) | **${report.totals.products}** |`);
  md.push(`| из них с остатком на складе | **${report.totals.products_in_stock}** |`);
  md.push(`| Единицы оборудования (equipment) | **${report.totals.equipment}** |`);
  md.push(`| из них на складе (on_warehouse) | **${report.totals.equipment_on_warehouse}** |`);
  md.push(`| С фото сейчас | products ${report.totals.with_photo_products} / equipment ${report.totals.with_photo_equipment} |`);
  md.push('');
  md.push('## Сколько карточек генерировать');
  md.push('');
  md.push(`Похожие SKU схлопываются в **один тип карточки** (одна AI/реальная фотка на группу).`);
  md.push('');
  md.push(`| Метрика | Значение |`);
  md.push(`|---|---:|`);
  md.push(`| Типов карточек с матчем правил | **${report.cards.archetypes_with_members}** |`);
  md.push(`| Рекомендуем сделать сейчас (склад / ≥3 шт / техника на складе) | **${report.cards.recommended_generate_now}** |`);
  md.push(`| Редкие (1–2 шт, нет на складе) — можно отложить | ${report.cards.can_defer_rare} |`);
  md.push(`| Не попали в правила → other (ручная разборка) | **${report.cards.other_fallback_items}** |`);
  md.push(`| Оценка ₽ Flash (~4 ₽) на приоритет | ~${report.cards.estimate_cost_flash_rub} |`);
  md.push(`| Оценка ₽ Pro (~15 ₽) на приоритет | ~${report.cards.estimate_cost_pro_rub} |`);
  md.push('');
  md.push('## Приоритетные карточки (генерировать)');
  md.push('');
  md.push('| # | Карточка | Товаров | Оборуд. | На складе (тов.) | Техника на складе | Примеры |');
  md.push('|---:|---|---:|---:|---:|---:|---|');
  priority
    .sort((a, b) => b.n_total - a.n_total)
    .forEach((c, i) => {
      md.push(
        `| ${i + 1} | ${c.title} (\`${c.key}\`) | ${c.n_products} | ${c.n_equipment} | ${c.in_stock_products} | ${c.equipment_on_warehouse} | ${(c.examples || []).slice(0, 2).map((x) => x.replace(/\|/g, '/')).join('; ')} |`
      );
    });
  md.push('');
  md.push('## Other / ручная разборка (топ по объёму — см. JSON)');
  md.push('');
  if (other) {
    md.push(`Позиций в \`other_fallback\`: **${other.n_total}** (products ${other.n_products}, equipment ${other.n_equipment}).`);
    md.push('Примеры: ' + (other.examples || []).join(' · '));
  }
  md.push('');
  md.push('Файлы: `CARD-CLUSTERS.json` (полный маппинг id→карточка), `AGENT-TAXONOMY.json` (правила).');
  fs.writeFileSync(path.join(DIR, 'CARD-CLUSTERS-REPORT.md'), md.join('\n'), 'utf8');

  console.log(JSON.stringify({
    totals: report.totals,
    cards: report.cards,
    top10: priority.slice(0, 10).map((c) => ({ key: c.key, title: c.title, n: c.n_total, stock: c.in_stock_products })),
  }, null, 2));
}

main();
