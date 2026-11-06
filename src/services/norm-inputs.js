'use strict';

/**
 * Перевод объёма позиции ДВ в входы нормы.
 * ═══════════════════════════════════════════════════════════════════════════
 * КОРЕНЬ (06.11.2026). Раньше маршрут `tkp_quick` подбирал входы нормы
 * списком «если категория такая — подставь такие-то значения», и часть
 * значений была ВЫДУМАНА:
 *
 *     cycles: 2, dn_mm: 159, manways: 2, cells: 1,
 *     diameter_mm: 25, length_m: 6, boilers: 1, apparatus: 1
 *
 * Последствия — не косметика:
 *   • трудоёмкость считалась по чужому диаметру (25 мм) и чужой длине (6 м);
 *   • у тендера 2131 (28 трубных позиций с реальной длиной 2.9–4.6 м)
 *     норма вообще не сработала: в ДВ диаметр лежит в `dn_mm`, а норма
 *     трубок читает `diameter_mm` — ключи не совпали, и 31 позиция
 *     осталась без расчёта;
 *   • «cycles: 2» на химии означало два цикла промывки там, где в ТЗ
 *     мог быть один — то есть заведомо завышенная трудоёмкость.
 *
 * Теперь источник правды — сама норма: `work_norm_categories.input_schema_json`
 * объявляет поля (key/label/unit/optional) для каждого метода. Мы только
 * раскладываем по ним объём из ДВ и параметры пересчёта. Чего в ДВ нет —
 * не подставляем: норма честно ответит «Укажите Ø, мм», и РП дополнит.
 *
 * Так это работает на ЛЮБОМ тендере и для любого метода, включая новые,
 * которые появятся в каталоге позже.
 */

/** Число из ДВ: только положительное, иначе null (не 0 и не выдумка). */
function posNum(x) {
  const n = Number(x);
  return n > 0 ? n : null;
}

/** Что за единица измерения пришла из ВОР. */
function classifyUnit(unit) {
  // Нормализация: убираем пробелы и точки, которые ставят в ВОР по-разному
  // («п.м.», «п. м.», «м.п.», «п.м»). Без этого «п.м.» не распознавалось
  // как погонный метр и уходило пустым (тендер 2127, каналы 450 п.м.).
  const raw = String(unit || '').trim();
  const u = raw.toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(/\/$/, '');

  const isM3 = u.includes('м³') || u.includes('м3') || u.includes('куб');
  const isM2 = u.includes('м²') || u.includes('м2') || u.includes('кв');
  // Тонны: объём задан массой, пересчитывается в м³ через плотность.
  // Без этого признака позиция «1353 т» уходила пустой (тендер 2127, шлак).
  const isTon = /^(т|тн|тонн|тонна|тонны)$/.test(u);
  const isLitre = /^(л|литр|литров|литры)$/.test(u);
  const isTube = u.includes('труб');
  const isJoint = u.includes('стык') || u.includes('шов');
  const isPlate = u.includes('пластин');
  const isSection = u.includes('секц');
  const isPiece = /шт|компл|аппарат/.test(u);
  // Погонный метр: «пм», «погм», «мп», просто «м», а также «метр/метров».
  // ВАЖНО: проверяем ПОСЛЕ м²/м³ — иначе объём уедет в длину.
  const isRunM = !isM3 && !isM2 && (
    /^(пм|погм|ппм|мп|м|метр|метров|метра)$/.test(u)
  );
  return { raw, isM3, isM2, isTon, isLitre, isTube, isJoint, isPlate, isSection, isPiece, isRunM };
}

/**
 * Построить входы нормы для позиции ДВ.
 *
 * @param {object} pos — позиция ДВ (volume, unit, category_code, method_code,
 *   conversion_params)
 * @param {object} [catalog] — loadCatalog(): { categories: [...] }
 * @returns {object} inputs для tryNormPreviewForEstimate
 */
function inputsForPosition(pos, catalog) {
  const p = pos || {};
  const v = Number(p.volume) || 0;
  const cat = String(p.category_code || '');
  const method = String(p.method_code || '');
  const unit = classifyUnit(p.unit);

  // Объёма нет — отдаём пусто. Иначе в норму уходил «surface_m2: 0»
  // и она считала ноль работ вместо честного «укажите объём».
  if (!(v > 0)) return {};

  // Параметры пересчёта из ДВ. Только реальные: «средних по отрасли» нет.
  const cp = p.conversion_params || {};
  const realDn = posNum(cp.dn_mm);
  const realLen = posNum(cp.length_m);
  const realThick = posNum(cp.thickness_mm);
  const realAreaPlate = posNum(cp.area_per_plate_m2);
  const realDensity = posNum(cp.density_t_m3);

  /**
   * Значение для поля схемы. null → поля нет в ДВ, ключ не ставим.
   *
   * Разделение важное:
   *   • объёмные поля получают объём ТОЛЬКО при совпадающей единице
   *     (м³ → volume_m3, м² → surface_m2, трубки → tubes);
   *   • параметры пересчёта (Ø, длина, толщина, плотность) — из ДВ;
   *   • поля сценария (cycles, manways, cells, boilers, apparatus, points,
   *     objects, lifts) в ВОР не приходят. Их не выдумываем — пусть норма
   *     попросит, а РП решит.
   */
  function valueFor(key) {
    const k = String(key);

    // ── Параметры пересчёта ────────────────────────────────────────────────
    if (k === 'diameter_mm' || k === 'dn_mm') return realDn;
    if (k === 'length_m') {
      // Два разных смысла: длина одной трубки и длина трубы/сети/реза.
      if (unit.isTube) return realLen;
      return unit.isRunM ? v : realLen;
    }
    if (k === 'thickness_mm') return realThick;
    if (k === 'area_per_plate_m2') return realAreaPlate;
    if (k === 'density_t_m3') return realDensity;

    // ── Объёмные ───────────────────────────────────────────────────────────
    // Тонны и литры приводим к м³, если в ДВ есть плотность. Без плотности
    // поле остаётся пустым: норма попросит параметр, а не посчитает наугад.
    // Это НЕ выдумка — плотность пришла из ДВ (conversion_params).
    if (k === 'volume_m3' || k === 'circuit_m3') {
      if (unit.isM3) return v;
      if (unit.isTon && realDensity) return Math.round((v / realDensity) * 100) / 100;
      if (unit.isLitre) return Math.round((v / 1000) * 100) / 100;
      return null;
    }
    if (k === 'surface_m2') return unit.isM2 ? v : null;

    // ── Счётные из ВОР ─────────────────────────────────────────────────────
    if (k === 'tubes') return unit.isTube ? v : null;
    if (k === 'joints') return unit.isJoint ? v : null;
    if (k === 'plates') return unit.isPlate ? v : null;
    if (k === 'sections') return unit.isSection ? v : null;
    if (k === 'qty') return unit.isPiece ? v : null;

    // ── Сценарий: в ВОР не приходит ────────────────────────────────────────
    return null;
  }

  // Схема категории — источник правды.
  const schema = catalog && Array.isArray(catalog.categories)
    ? catalog.categories.find((c) => c && c.code === cat)
    : null;
  const methods = (schema && schema.input_schema_json && schema.input_schema_json.methods) || {};
  const methodSchema = methods[method] || null;

  const out = {};

  if (methodSchema && Array.isArray(methodSchema.fields)) {
    for (const f of methodSchema.fields) {
      if (!f || !f.key) continue;
      const val = valueFor(f.key);
      if (val != null && val !== '') out[f.key] = val;
    }
    // Параметры пересчёта кладём ВСЕГДА, даже если схема их не перечислила:
    // они нужны движку пересчёта единиц (м²→м³ по толщине, т→м³ по
    // плотности), а не самому расчёту нормы. Выдумки здесь нет — только
    // то, что пришло из ДВ.
    if (realThick && out.thickness_mm == null) out.thickness_mm = realThick;
    if (realDensity && out.density_t_m3 == null) out.density_t_m3 = realDensity;
    if (realAreaPlate && out.area_per_plate_m2 == null) out.area_per_plate_m2 = realAreaPlate;

    // Если объём не попал в ожидаемое поле нормы (например «т», «дюймы»),
    // отдаём измеренную единицу и значение — движок пересчёта (unit-convert)
    // сам приведёт их к тому, что ждёт норма, либо честно попросит параметр
    // (плотность, толщину). Без этого позиция в тоннах уходила пустой.
    const { expectedInputField } = require('./work-norms');
    const expected = expectedInputField(cat, method, null, null);
    if (expected && out[expected] == null && v > 0) {
      out._measured_unit = unit.raw || String(p.unit || '').trim();
      out._measured_value = v;
    }
    return out;
  }

  // Схемы нет (новый метод, которого ещё нет в каталоге) — отдаём объём
  // под ходовые имена. Это не выдумка: все ключи означают РОВНО тот объём,
  // что в ДВ, а норма читает только свой. Лишний ключ безвреден.
  if (unit.isM3) { out.volume_m3 = v; out.circuit_m3 = v; }
  if (unit.isM2) out.surface_m2 = v;
  if (unit.isTube) out.tubes = v;
  if (unit.isJoint) out.joints = v;
  if (unit.isPlate) out.plates = v;
  if (unit.isSection) out.sections = v;
  if (unit.isPiece) out.qty = v;
  if (realDn) out.diameter_mm = realDn;
  if (realLen) out.length_m = realLen;
  if (realThick) out.thickness_mm = realThick;
  if (unit.isRunM) out.length_m = out.length_m || v;
  return out;
}

module.exports = { inputsForPosition, classifyUnit };
