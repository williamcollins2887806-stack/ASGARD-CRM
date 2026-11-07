'use strict';
/**
 * mimir-tender-stages-ai.js вЂ” РіРµРЅРµСЂР°С†РёСЏ Р”Р’ Рё РїР»Р°РЅР° РїСЂРѕСЃС‡С‘С‚Р° С‡РµСЂРµР· РјРѕРґРµР»СЊ.
 *
 * РћС‚РґРµР»СЊРЅС‹Р№ СЃР»РѕР№ РѕС‚ `mimir-tkp-quick.generateEstimate`: С‚Р°Рј РѕРґРЅР° РїСЂРѕСЃС‚С‹РЅСЏ
 * В«СЃРґРµР»Р°Р№ СЃРјРµС‚СѓВ», Р·РґРµСЃСЊ вЂ” РґРІР° СѓР·РєРёС… С€Р°РіР° СЃ Р¶С‘СЃС‚РєРѕР№ СЃС…РµРјРѕР№ РѕС‚РІРµС‚Р°:
 *   generateDv()        в†’ РїРѕР·РёС†РёРё СЃ РѕР±СЉС‘РјРѕРј, РјРµС‚РѕРґРѕРј, С‚РµС…РЅРѕР»РѕРіРёРµР№ Рё РёСЃС‚РѕС‡РЅРёРєРѕРј;
 *   generateCalcPlan()  в†’ Р»СЋРґРё, СЃСЂРѕРєРё, РѕР±РѕСЂСѓРґРѕРІР°РЅРёРµ РїРѕ Р°РїРїР°СЂР°С‚Р°Рј + РёСЃС‚РѕС‡РЅРёРє С†РёС„СЂС‹.
 *
 * РџСЂРёРЅС†РёРїС‹:
 *   вЂў РїСЂРѕРјРїС‚ РёР· С„Р°Р№Р»Р° (`templates/prompts/PROMPT-dv-v1.md`, `PROMPT-calc-plan-v1.md`);
 *   вЂў РѕС‚РІРµС‚ РІР°Р»РёРґРёСЂСѓРµС‚СЃСЏ РЅРѕСЂРјР°Р»РёР·Р°С‚РѕСЂР°РјРё РёР· `mimir-tender-stages`;
 *   вЂў РµСЃР»Рё РјРѕРґРµР»СЊ РІРµСЂРЅСѓР»Р° РјСѓСЃРѕСЂ вЂ” РЅРµ РїР°РґР°РµРј: РІРѕР·РІСЂР°С‰Р°РµРј `{ok:false, error}`,
 *     Рё UI РїРѕРєР°Р·С‹РІР°РµС‚ С‡РµР»РѕРІРµС‡РµСЃРєРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ СЃ РєРЅРѕРїРєРѕР№ В«РџРѕРІС‚РѕСЂРёС‚СЊВ»;
 *   вЂў РЅРёРєР°РєРѕР№ СЃРєСЂС‹С‚РѕР№ РїРѕРґСЃС‚Р°РЅРѕРІРєРё РѕР±СЉС‘РјРѕРІ: С‡РµРіРѕ РЅРµС‚ вЂ” С‚РѕРіРѕ РЅРµС‚.
 */

const promptLoader = require('./prompt-loader');
const stages = require('./mimir-tender-stages');
const estimateExpectedPositions = stages.estimateExpectedPositions;
const docRole = require('./doc-role');

// Р§С‚Рѕ СѓС€Р»Рѕ РІ РїСЂРѕРјРїС‚ РЅР° РїРѕСЃР»РµРґРЅРµРј РІС‹Р·РѕРІРµ вЂ” РґР»СЏ Р¶СѓСЂРЅР°Р»Р° Р°РЅР°Р»РёР·Р°.
// module-level: РІС‹Р·РѕРІС‹ РїРѕСЃР»РµРґРѕРІР°С‚РµР»СЊРЅС‹Рµ, РіРѕРЅРєРё РЅРµС‚.
let lastSelection = null;

/** РљР°С‚Р°Р»РѕРі РєР°С‚РµРіРѕСЂРёР№ Рё РјРµС‚РѕРґРѕРІ РІ РєРѕРјРїР°РєС‚РЅРѕРј РІРёРґРµ РґР»СЏ РїСЂРѕРјРїС‚Р°. */
function catalogForPrompt(catalog) {
  const cats = (catalog && Array.isArray(catalog.categories)) ? catalog.categories : [];
  const rates = (catalog && Array.isArray(catalog.rates)) ? catalog.rates : [];

  /**
   * РћРґРЅР° РЅРѕСЂРјР° РІ СЃС‚СЂРѕРєРµ РїСЂРѕРјРїС‚Р°: РєРѕРґ, РµРґРёРЅРёС†Р°, РґРѕРІРµСЂРёРµ, РїСЂРѕРёСЃС…РѕР¶РґРµРЅРёРµ
   * Рё РѕР±Р»Р°СЃС‚СЊ РїСЂРёРјРµРЅРёРјРѕСЃС‚Рё. Р‘РµР· СЌС‚РѕРіРѕ РјРѕРґРµР»СЊ РЅРµ РјРѕР¶РµС‚ СЂРµС€РёС‚СЊ, РґРѕРІРµСЂСЏС‚СЊ Р»Рё
   * С†РёС„СЂРµ, Рё РїСЂРёРјРµРЅСЏРµС‚ РµС‘ РЅРµ РїРѕ Р°РґСЂРµСЃСѓ (Р·Р°РїСЂРѕСЃ Р·Р°РєР°Р·С‡РёРєР° 06.11).
   */
  function rateLine(r) {
    const conf = r.confidence != null ? Number(r.confidence) : null;
    const confTxt = conf == null ? '' : ` | РґРѕРІРµСЂРёРµ ${conf.toFixed(2)}`;
    const basisTxt = r.basis ? ` | basis: ${r.basis}` : '';
    let app = '';
    const a = r.applicability && typeof r.applicability === 'object' ? r.applicability : null;
    if (a && Object.keys(a).length) {
      const bits = [];
      if (a.min_value != null && a.max_value != null) bits.push(`${a.min_value}вЂ“${a.max_value}`);
      else if (a.min_value != null) bits.push(`РѕС‚ ${a.min_value}`);
      else if (a.max_value != null) bits.push(`РґРѕ ${a.max_value}`);
      if (Array.isArray(a.fouling) && a.fouling.length) bits.push(`РѕС‚Р»РѕР¶РµРЅРёСЏ ${a.fouling.join('/')}`);
      if (a.method_note) bits.push(a.method_note);
      if (bits.length) app = ` | РїСЂРёРјРµРЅРёРјРѕ: ${bits.join(', ')}`;
    }
    const warn = (conf != null && conf < 0.4)
      ? ' | РћР¦Р•РќРљРђ, РЅРµ РЅРѕСЂРјР° вЂ” РѕР±СЉСЏСЃРЅРё РІ explain'
      : '';
    return `${r.code}: В«${r.unit}В», СЃС‡РёС‚Р°С‚СЊ РєР°Рє ${r.calc_kind}${basisTxt}${confTxt}${app}${warn}`;
  }

  return cats.map((c) => {
    const ms = Array.isArray(c.methods_json) ? c.methods_json : [];
    const lines = ms.map((m) => {
      // РџРѕРєР°Р·С‹РІР°РµРј Р’РЎР• РЅРѕСЂРјС‹ РјРµС‚РѕРґР°, Р° РЅРµ С‚РѕР»СЊРєРѕ primary: Сѓ С…РёРјРёРё РїРѕ РєРѕРЅС‚СѓСЂСѓ
      // РµСЃС‚СЊ hours_per_cycle, Рё Р±РµР· РЅРµРіРѕ РјРѕРґРµР»СЊ СЂРµС€Р°РµС‚, С‡С‚Рѕ РЅСѓР¶РЅС‹ С‚СЂСѓР±РєРё.
      const methodRates = rates.filter((r) => r.category_code === c.code && r.method_code === m.code);
      const primary = methodRates.find((r) => r.code === m.primary_rate_code) || methodRates[0] || null;
      const others = methodRates.filter((r) => r !== primary).slice(0, 3);
      const list = [primary, ...others].filter(Boolean).map(rateLine).join(' | ');
      return `  - ${m.code} (${m.label || m.code}): ${list || 'РµРґРёРЅРёС†Р° ' + (m.volume_unit || 'вЂ”')}`;
    });
    return `${c.code} вЂ” ${c.title || c.code}\n${lines.join('\n')}`;
  }).join('\n\n');
}

function safeJson(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  // РњРѕРґРµР»СЊ РјРѕР¶РµС‚ РѕР±РµСЂРЅСѓС‚СЊ РѕС‚РІРµС‚ РІ ```json ... ```
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  try { return JSON.parse(body); } catch (_) {}
  // РџРѕСЃР»РµРґРЅСЏСЏ РїРѕРїС‹С‚РєР°: РїРµСЂРІС‹Р№ { ... РїРѕСЃР»РµРґРЅРёР№ }
  const i = body.indexOf('{');
  const j = body.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try { return JSON.parse(body.slice(i, j + 1)); } catch (_) {}
  }
  // Р§Р°СЃС‚РёС‡РЅС‹Р№ РѕС‚РІРµС‚: РјРѕРґРµР»СЊ СѓРїС‘СЂР»Р°СЃСЊ РІ Р»РёРјРёС‚ С‚РѕРєРµРЅРѕРІ Рё РЅРµ Р·Р°РєСЂС‹Р»Р° JSON.
  // РЎРїР°СЃР°РµРј РІСЃРµ С†РµР»С‹Рµ РѕР±СЉРµРєС‚С‹ РёР· РјР°СЃСЃРёРІР° positions вЂ” Р»СѓС‡С€Рµ 6 РїРѕР·РёС†РёР№,
  // С‡РµРј РЅРѕР»СЊ Рё В«РїРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰С‘ СЂР°Р·В» (РїСЂРѕРґ 06.11, С‚РµРЅРґРµСЂ 2131: 30 РљР‘, stop=length).
  return salvagePartialDv(body);
}

/**
 * Р”РѕСЃС‚Р°С‘С‚ РёР· РѕР±СЂРµР·Р°РЅРЅРѕРіРѕ JSON РІСЃС‘, С‡С‚Рѕ СѓСЃРїРµР»Рѕ СЃС„РѕСЂРјРёСЂРѕРІР°С‚СЊСЃСЏ:
 * С†РµР»С‹Рµ РѕР±СЉРµРєС‚С‹ РјР°СЃСЃРёРІР° positions Рё decision_recommend.
 */
function salvagePartialDv(body) {
  const text = String(body || '');
  const decMatch = text.match(/"decision_recommend"\s*:\s*"(go|no_go|need_info)"/);
  const dec = decMatch ? decMatch[1] : 'need_info';

  const start = text.indexOf('"positions"');
  if (start < 0) return null;
  const arrStart = text.indexOf('[', start);
  if (arrStart < 0) return null;

  const positions = [];
  let depth = 0;
  let objStart = -1;
  let inStr = false;
  let esc = false;

  for (let i = arrStart + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0 && objStart >= 0) {
        const chunk = text.slice(objStart, i + 1);
        try {
          const obj = JSON.parse(chunk);
          if (obj && obj.name) positions.push(obj);
        } catch (_) { /* РїРѕРІСЂРµР¶РґС‘РЅРЅС‹Р№ РѕР±СЉРµРєС‚ РїСЂРѕРїСѓСЃРєР°РµРј */ }
        objStart = -1;
      }
      if (depth < 0) break;
    }
  }

  if (!positions.length) return null;

  /**
   * РЎС‚СЂРѕРєРѕРІРѕРµ РїРѕР»Рµ РёР· РѕР±СЂРµР·Р°РЅРЅРѕРіРѕ JSON.
   * РњРѕРґРµР»СЊ РїРёС€РµС‚ summary, volume_summary Рё risks Р”Рћ РјР°СЃСЃРёРІР° positions,
   * РїРѕСЌС‚РѕРјСѓ РїСЂРё СѓРїРѕСЂРµ РІ Р»РёРјРёС‚ С‚РѕРєРµРЅРѕРІ РѕРЅРё СѓР¶Рµ РµСЃС‚СЊ РІ С‚РµРєСЃС‚Рµ, РЅРѕ С‚РµСЂСЏР»РёСЃСЊ:
   * РєР°СЂС‚РѕС‡РєР° РїРѕРєР°Р·С‹РІР°Р»Р° РїСѓСЃС‚СѓСЋ В«РЎСѓС‚СЊ РґР»СЏ РўРћВ» РїСЂРё Р¶РёРІС‹С… РїРѕР·РёС†РёСЏС….
   */
  function strField(name) {
    const re = new RegExp('"' + name + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');
    const m = re.exec(text);
    if (!m) return null;
    try { return JSON.parse('"' + m[1] + '"'); } catch (_) { return m[1]; }
  }

  return {
    decision_recommend: dec,
    summary: strField('summary'),
    volume_summary: strField('volume_summary'),
    feasibility: strField('feasibility'),
    feasibility_note: strField('feasibility_note'),
    competition: strField('competition'),
    risks: strField('risks'),
    positions,
    questions_for_customer: [],
    _salvaged: true,
    _note: 'РћС‚РІРµС‚ РјРѕРґРµР»Рё РѕР±СЂРµР·Р°РЅ РїРѕ Р»РёРјРёС‚Сѓ вЂ” СЃРѕС…СЂР°РЅРµРЅС‹ РїРѕР»РЅРѕСЃС‚СЊСЋ СЃС„РѕСЂРјРёСЂРѕРІР°РЅРЅС‹Рµ РїРѕР·РёС†РёРё'
  };
}

/**
 * РЎРєР»РµРёРІР°РµС‚ С‚РµРєСЃС‚ РґРѕРєСѓРјРµРЅС‚РѕРІ РґР»СЏ РїСЂРѕРјРїС‚Р°.
 *
 * Р”РµС„РµРєС‚ 06.11: РїСЂРё 553 С‚С‹СЃ. СЃРёРјРІРѕР»РѕРІ РІ 22 РґРѕРєСѓРјРµРЅС‚Р°С… (С‚РµРЅРґРµСЂ 2133) РїСЂРѕРјРїС‚
 * РѕР±СЂРµР·Р°Р»СЃСЏ РґРѕ 60 С‚С‹СЃ., Рё РѕР±СЂРµР·Р°РЅРЅС‹Рј РѕРєР°Р·С‹РІР°Р»СЃСЏ РёРјРµРЅРЅРѕ Р’РћР  СЃ РѕР±СЉС‘РјР°РјРё вЂ”
 * РјРѕРґРµР»СЊ С‡РµСЃС‚РЅРѕ РѕС‚РІРµС‡Р°Р»Р° В«РїРµСЂРµС‡РµРЅСЊ РѕР±РѕСЂСѓРґРѕРІР°РЅРёСЏ РѕР±СЂРµР·Р°РЅ, РѕР±СЉС‘РјС‹ РЅРµ РІС‹РІРѕРґРёРјС‹В»
 * Рё РІРѕР·РІСЂР°С‰Р°Р»Р° 0 РїРѕР·РёС†РёР№.
 *
 * РџСЂРѕРІРµСЂРµРЅРѕ РЅР° РїСЂРѕРІР°Р№РґРµСЂРµ: РІС…РѕРґ РґРѕ 300 С‚С‹СЃ. СЃРёРјРІРѕР»РѕРІ РїСЂРѕС…РѕРґРёС‚ Р±РµР· РѕС€РёР±РєРё,
 * РїРѕСЌС‚РѕРјСѓ Р»РёРјРёС‚ РїРѕРґРЅСЏС‚ РґРѕ 400 С‚С‹СЃ. РџРѕСЂСЏРґРѕРє Рё РґРѕР»Рё СЃРѕС…СЂР°РЅРµРЅС‹: РґРѕРєСѓРјРµРЅС‚С‹
 * СЃ РѕР±СЉС‘РјР°РјРё (Р’РћР , РІРµРґРѕРјРѕСЃС‚СЊ) РёРґСѓС‚ РїРµСЂРІС‹РјРё Рё РїРѕР»СѓС‡Р°СЋС‚ Р±РѕР»СЊС€Рµ РјРµСЃС‚Р°.
 */
function docsToText(documents, limit = 400000) {
  const list = Array.isArray(documents) ? documents : [];

  // в”Ђв”Ђ РћС‚СЃРµРІ РјСѓСЃРѕСЂР° Рё РєРѕРїРёР№ (Р·Р°РјРµС‡Р°РЅРёРµ Р Рџ 06.11.2026) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // Р Р°РЅСЊС€Рµ РІ РїСЂРѕРјРїС‚ С€Р»Рё РґРѕРіРѕРІРѕСЂС‹, РЅР°С€Рё РўРљРџ, С€Р°Р±Р»РѕРЅС‹ Рё РїРѕ 5 РєРѕРїРёР№ РѕРґРЅРѕРіРѕ РўР—
  // РёР· СЂР°Р·РЅС‹С… Р°СЂС…РёРІРѕРІ: 1,3 РјР»РЅ СЃРёРјРІРѕР»РѕРІ, РёР· РЅРёС… 60вЂ“70 % Р±РµР· РѕР±СЉС‘РјРѕРІ.
  // РўРµРїРµСЂСЊ РЅР°Р·РЅР°С‡РµРЅРёРµ РѕРїСЂРµРґРµР»СЏРµС‚СЃСЏ РїРѕ РёРјРµРЅРё (doc-role.js), РєРѕРїРёРё СЃС…Р»РѕРїС‹РІР°СЋС‚СЃСЏ
  // РїРѕ РѕС‚РїРµС‡Р°С‚РєСѓ СЃРѕРґРµСЂР¶РёРјРѕРіРѕ, Р° РІ РїСЂРѕРјРїС‚ РѕСЃС‚Р°СЋС‚СЃСЏ С‚РѕР»СЊРєРѕ РёСЃС‚РѕС‡РЅРёРєРё РѕР±СЉС‘РјРѕРІ.
  const picked = docRole.selectForPrompt(list);
  lastSelection = picked;
  const items = picked.selected
    .map((d) => ({
      name: d.original_name || d.filename || d.name || 'РґРѕРєСѓРјРµРЅС‚',
      text: String(d.text || '').trim(),
      pr: d.doc_weight,
      role: d.doc_role,
      roleTitle: d.doc_role_title
    }))
    .filter((d) => d.text)
    .sort((a, b) => b.pr - a.pr || b.text.length - a.text.length);

  if (!items.length) return '';

  // РџСЂРёРѕСЂРёС‚РµС‚ вЂ” РЅРµ С‚РѕР»СЊРєРѕ РїРѕСЂСЏРґРѕРє, РЅРѕ Рё Р”РћР›РЇ Р»РёРјРёС‚Р°: РґРѕРєСѓРјРµРЅС‚ СЃ РѕР±СЉС‘РјР°РјРё
  // (Р’РћР , РІРµРґРѕРјРѕСЃС‚СЊ) РґРѕР»Р¶РµРЅ РїРѕР»СѓС‡РёС‚СЊ Р±РѕР»СЊС€Рµ РјРµСЃС‚Р°, С‡РµРј РґРѕРіРѕРІРѕСЂ РЅР° 200 СЃС‚СЂР°РЅРёС†.
  // Р”РµС„РµРєС‚ 06.11: Р’РћР  РЅР° 19 С‚С‹СЃ. СЃРёРјРІРѕР»РѕРІ СЂРµР·Р°Р»СЃСЏ РІРјРµСЃС‚Рµ СЃРѕ РІСЃРµРјРё, Рё РјРѕРґРµР»СЊ
  // С‡РµСЃС‚РЅРѕ РѕС‚РІРµС‡Р°Р»Р° В«РїРµСЂРµС‡РµРЅСЊ РѕР±РѕСЂСѓРґРѕРІР°РЅРёСЏ РѕР±СЂРµР·Р°РЅ, РѕР±СЉС‘РјС‹ РЅРµ РІС‹РІРѕРґРёРјС‹В».
  // Р’РµСЃР° С‚РµРїРµСЂСЊ РїСЂРёС…РѕРґСЏС‚ РёР· doc-role.js (5 вЂ” Р’РћР , 4 вЂ” РўР—, 0 вЂ” РјСѓСЃРѕСЂ).
  const totalWeight = items.reduce((s, it) => s + (it.pr || 1), 0);
  const minPer = 1500;
  const budget = Math.max(limit, items.length * minPer);

  // РџР РћРҐРћР” 1: СЂР°Р·РґР°С‘Рј РєРІРѕС‚С‹ РїРѕ РІРµСЃР°Рј.
  // РџР РћРҐРћР” 2: РѕСЃС‚Р°С‚РѕРє Р±СЋРґР¶РµС‚Р° РѕС‚РґР°С‘Рј С‚РµРј, РєС‚Рѕ РЅРµ РІР»РµР·.
  // Р”РµС„РµРєС‚ 06.11 (С‚РµРЅРґРµСЂ 2138): РґРµС„РµРєС‚РЅР°СЏ РІРµРґРѕРјРѕСЃС‚СЊ РЅР° 100 С‚С‹СЃ. СЃРёРјРІРѕР»РѕРІ
  // РѕР±СЂРµР·Р°Р»Р°СЃСЊ РґРѕ 50 С‚С‹СЃ., С…РѕС‚СЏ РІ Р±СЋРґР¶РµС‚Рµ Р»РµР¶Р°Р»Рѕ РµС‰С‘ 225 С‚С‹СЃ. РЅРµРёСЃРїРѕР»СЊР·РѕРІР°РЅРЅС‹С…:
  // РєРІРѕС‚С‹ РґРµР»РёР»РёСЃСЊ РїРѕСЂРѕРІРЅСѓ, Рё РјРµСЃС‚Рѕ РєРѕСЂРѕС‚РєРёС… РґРѕРєСѓРјРµРЅС‚РѕРІ РїСЂРѕСЃС‚Рѕ РїСЂРѕРїР°РґР°Р»Рѕ.
  // РњРѕРґРµР»СЊ РЅРµРґРѕСЃС‡РёС‚С‹РІР°Р»Р° РѕР±СЉС‘РјС‹ РёР·-Р·Р° РѕР±СЂРµР·РєРё СЃРµСЂРµРґРёРЅС‹ С‚Р°Р±Р»РёС†С‹.
  const alloc = items.map((it) => ({ it, quota: (budget * (it.pr || 1)) / totalWeight }));
  let free = budget - alloc.reduce((s, a) => s + Math.min(a.it.text.length, a.quota), 0);

  // РќСѓР¶РґР°СЋС‰РёРµСЃСЏ вЂ” РѕС‚ СЃР°РјРѕРіРѕ РІР°Р¶РЅРѕРіРѕ Рё СЃР°РјРѕРіРѕ РґР»РёРЅРЅРѕРіРѕ.
  const needy = alloc
    .filter((a) => a.it.text.length > a.quota)
    .sort((a, b) => (b.it.pr - a.it.pr) || (b.it.text.length - a.it.text.length));

  for (const a of needy) {
    if (free <= 0) break;
    const room = a.it.text.length - a.quota;
    const add = Math.min(room, Math.floor(free * 0.6));   // 60 %, С‡С‚РѕР±С‹ С…РІР°С‚РёР»Рѕ РІСЃРµРј
    a.quota += add;
    free -= add;
  }
  // Р’С‚РѕСЂРѕР№ РґРѕР±РѕСЂ: РµСЃР»Рё РїРѕСЃР»Рµ РїРµСЂРІРѕРіРѕ РєСЂСѓРіР° РѕСЃС‚Р°Р»РёСЃСЊ Рё РјРµСЃС‚Рѕ, Рё РЅСѓР¶РґР°.
  for (const a of needy) {
    if (free <= 0) break;
    const room = a.it.text.length - a.quota;
    if (room <= 0) continue;
    const add = Math.min(room, free);
    a.quota += add;
    free -= add;
  }

  const parts = [];
  for (const a of alloc) {
    const it = a.it;
    const head = `=== ${it.name}${it.roleTitle ? ` [${it.roleTitle}]` : ''} ===\n`;
    const room = Math.max(800, Math.floor(a.quota) - head.length);

    if (it.text.length <= room) {
      parts.push(head + it.text);
    } else {
      // Р‘РµСЂС‘Рј РЅР°С‡Р°Р»Рѕ Рё РєРѕРЅРµС†: РІ Р’РћР  С‚Р°Р±Р»РёС†Р° РёРґС‘С‚ СЃ РїРµСЂРІС‹С… СЃС‚СЂРѕРє,
      // Р° РёС‚РѕРіРё Рё РїСЂРёРјРµС‡Р°РЅРёСЏ вЂ” РІ РєРѕРЅС†Рµ.
      const headPart = Math.floor(room * 0.75);
      const tailPart = room - headPart - 70;
      parts.push(
        head + it.text.slice(0, headPart) +
        `\nвЂ¦ (СЃРµСЂРµРґРёРЅР° РѕРїСѓС‰РµРЅР°, РІСЃРµРіРѕ ${it.text.length} СЃРёРјРІ.) вЂ¦\n` +
        (tailPart > 200 ? it.text.slice(-tailPart) : '')
      );
    }
  }

  return parts.join('\n\n');
}

/**
 * Р“РµРЅРµСЂРёСЂСѓРµС‚ РІРµРґРѕРјРѕСЃС‚СЊ РѕР±СЉС‘РјРѕРІ (Р”Р’).
 *
 * @param {object} p
 * @param {object} p.db
 * @param {object} p.aiProvider вЂ” РјРѕРґСѓР»СЊ ai-provider (complete/runAgentLoop)
 * @param {string} p.tz_text
 * @param {Array}  p.documents
 * @param {string} p.history_block
 * @param {object} p.catalog вЂ” loadCatalog()
 * @returns {Promise<{ok:boolean, dv?:object, error?:string, model?:string, raw?:string}>}
 */
async function generateDv(p) {
  const o = p || {};
  const catalog = o.catalog || { categories: [], rates: [] };

  const tzText = String(o.tz_text || '(РўР— С‚РµРєСЃС‚РѕРј РЅРµ Р·Р°РґР°РЅРѕ)').slice(0, 40000);
  const docsText = docsToText(o.documents) || '(РґРѕРєСѓРјРµРЅС‚РѕРІ СЃ С‚РµРєСЃС‚РѕРј РЅРµС‚)';
  const system = promptLoader.buildPrompt('PROMPT-dv-v1.md', {
    catalog: catalogForPrompt(catalog),
    tz_text: tzText,
    documents_text: docsText,
    history_block: o.history_block || '(РёСЃС‚РѕСЂРёРё РЅРµС‚)'
  });

  let user = 'РЎРѕСЃС‚Р°РІСЊ РІРµРґРѕРјРѕСЃС‚СЊ РѕР±СЉС‘РјРѕРІ РїРѕ СЌС‚РёРј РґР°РЅРЅС‹Рј. Р’РµСЂРЅРё РўРћР›Р¬РљРћ JSON РїРѕ СЃС…РµРјРµ.';

  // в”Ђв”Ђ Р“РµРЅРµСЂР°С†РёСЏ РїРѕСЂС†РёСЏРјРё в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // Р”РµС„РµРєС‚ 06.11 (С‚РµРЅРґРµСЂ 2138, РґРµС„РµРєС‚РЅР°СЏ РІРµРґРѕРјРѕСЃС‚СЊ РЅР° 673 РїРѕР·РёС†РёРё):
  // РѕС‚РІРµС‚ СѓРїРёСЂР°Р»СЃСЏ РІ 32000 С‚РѕРєРµРЅРѕРІ, salvage СЃРїР°СЃР°Р» РЅР°С‡Р°Р»Рѕ, Р° РѕСЃС‚Р°Р»СЊРЅС‹Рµ
  // РїРѕР·РёС†РёРё С‚РµСЂСЏР»РёСЃСЊ РјРѕР»С‡Р°. Р§РµСЂРµР· API СЌС‚Рѕ РґР°РІР°Р»Рѕ 0 (РјРѕРґРµР»СЊ СѓСЃРїРµРІР°Р»Р°
  // РІРµСЂРЅСѓС‚СЊ С‚РѕР»СЊРєРѕ Р·Р°РіРѕР»РѕРІРѕРє), РїСЂРё РїСЂСЏРјРѕРј РІС‹Р·РѕРІРµ вЂ” 155 РёР· 673.
  //
  // 07.11: РїРѕРґРЅСЏР»Рё Р»РёРјРёС‚ РґРѕ 64000 (673 РїРѕР·РёС†РёРё РїРѕ ~50 С‚РѕРєРµРЅРѕРІ = ~34 С‚С‹СЃ.,
  // СЃ Р·Р°РїР°СЃРѕРј), Р° РґРѕР±РѕСЂ РІРєР»СЋС‡Р°РµРј РЅРµ С‚РѕР»СЊРєРѕ РїСЂРё РѕР±СЂРµР·РєРµ, РЅРѕ Рё РєРѕРіРґР° РјРѕРґРµР»СЊ
  // РІРµСЂРЅСѓР»Р° РїРѕРґРѕР·СЂРёС‚РµР»СЊРЅРѕ РјР°Р»Рѕ РѕС‚РЅРѕСЃРёС‚РµР»СЊРЅРѕ РѕР±СЉС‘РјР° РІРµРґРѕРјРѕСЃС‚Рё вЂ” РёРЅР°С‡Рµ РѕРґРёРЅ
  // Рё С‚РѕС‚ Р¶Рµ С‚РµРЅРґРµСЂ РґР°РІР°Р» С‚Рѕ 353, С‚Рѕ 1 РїРѕР·РёС†РёСЋ РѕС‚ РїСЂРѕРіРѕРЅР° Рє РїСЂРѕРіРѕРЅСѓ.
  const MAX_ROUNDS = 8;
  const allPositions = [];
  let firstDv = null;
  let lastRaw = '';
  let totalUsage = { inputTokens: 0, outputTokens: 0 };
  let salvaged = false;
  let usedModel = null;
  let usedProvider = null;
  let rounds = 0;

  // РЎРєРѕР»СЊРєРѕ РїРѕР·РёС†РёР№ РѕР¶РёРґР°С‚СЊ РїРѕ РґРѕРєСѓРјРµРЅС‚Р°Рј: СЃС‡РёС‚Р°РµРј СЃС‚СЂРѕРєРё С‚Р°Р±Р»РёС† РІ Р’РћР 
  // Рё РґРµС„РµРєС‚РЅС‹С… РІРµРґРѕРјРѕСЃС‚СЏС…. Р­С‚Рѕ РЅРёР¶РЅСЏСЏ РѕС†РµРЅРєР°, РЅСѓР¶РЅР° С‚РѕР»СЊРєРѕ РєР°Рє РїСЂРёР·РЅР°Рє
  // В«РјРѕРґРµР»СЊ СЏРІРЅРѕ РЅРµРґРѕР±СЂР°Р»Р°В».
  const expectedMin = estimateExpectedPositions(o.documents);

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let res;
    try {
      res = await o.aiProvider.complete({
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: 64000,
        temperature: 0.15,
        responseFormat: { type: 'json_object' },
        reasoning: { enabled: false }
      });
    } catch (e) {
      return { ok: false, error: 'РњРѕРґРµР»СЊ РЅРµРґРѕСЃС‚СѓРїРЅР°: ' + e.message };
    }
    rounds += 1;
    if (res && res.model) usedModel = res.model;
    if (res && res.provider) usedProvider = res.provider;

    if (res && res.usage) {
      totalUsage.inputTokens += Number(res.usage.inputTokens) || 0;
      totalUsage.outputTokens += Number(res.usage.outputTokens) || 0;
    }
    lastRaw = String((res && res.text) || '');

    const parsed = safeJson(lastRaw);
    if (!parsed) {
      // РџРµСЂРІС‹Р№ РєСЂСѓРі Р±РµР· СЂР°Р·Р±РѕСЂР° JSON вЂ” СЌС‚Рѕ РїСЂРѕРІР°Р». Р”Р°Р»СЊС€Рµ вЂ” РѕР±СЂС‹РІР°РµРј РґРѕР±РѕСЂ.
      if (!firstDv) {
        return {
          ok: false,
          error: 'РњРѕРґРµР»СЊ РІРµСЂРЅСѓР»Р° РѕС‚РІРµС‚ РЅРµ РїРѕ СЃС…РµРјРµ вЂ” РїРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰С‘ СЂР°Р·',
          raw: lastRaw.slice(0, 500)
        };
      }
      break;
    }

    const dvRound = stages.normalizeDv(parsed, catalog);
    if (!firstDv) firstDv = dvRound;

    const got = (dvRound.positions || []).length;
    for (const p of (dvRound.positions || [])) allPositions.push(p);

    // РћС‚РІРµС‚ РїРѕР»РЅС‹Р№ Рё РїРѕР·РёС†РёР№ РґРѕСЃС‚Р°С‚РѕС‡РЅРѕ вЂ” РґР°Р»СЊС€Рµ РґРѕР±РёСЂР°С‚СЊ РЅРµС‡РµРіРѕ.
    const enough = expectedMin > 0 && allPositions.length >= expectedMin;
    if (!parsed._salvaged && enough) break;

    // РћР±СЂРµР·РєР° РёР»Рё СЏРІРЅС‹Р№ РЅРµРґРѕР±РѕСЂ. РќРµРґРѕР±РѕСЂ РІРѕР·РјРѕР¶РµРЅ Рё Р±РµР· РѕР±СЂРµР·РєРё: РјРѕРґРµР»СЊ
    // РјРѕР¶РµС‚ В«РѕРєСЂСѓРіР»РёС‚СЊВ» РІРµРґРѕРјРѕСЃС‚СЊ РЅР° 673 СЃС‚СЂРѕРєРё РґРѕ РґРµСЃСЏС‚РєР° СѓРєСЂСѓРїРЅС‘РЅРЅС‹С…
    // РїРѕР·РёС†РёР№. Р Р°РЅСЊС€Рµ СЌС‚Рѕ РїСЂРёРЅРёРјР°Р»РѕСЃСЊ РєР°Рє РїРѕР»РЅС‹Р№ РѕС‚РІРµС‚, Рё СЂРµР·СѓР»СЊС‚Р°С‚
    // СЃРєР°РєР°Р» РѕС‚ РїСЂРѕРіРѕРЅР° Рє РїСЂРѕРіРѕРЅСѓ (353 в†’ 1 РЅР° С‚РѕРј Р¶Рµ С‚РµРЅРґРµСЂРµ).
    if (parsed._salvaged) salvaged = true;

    if (!parsed._salvaged && !enough) {
      // РќРµ РѕР±СЂРµР·Р°РЅРѕ, РЅРѕ РјР°Р»Рѕ. РџСЂРѕСЃРёРј РїСЂРѕРґРѕР»Р¶РёС‚СЊ РѕРґРёРЅ СЂР°Р·; РµСЃР»Рё Рё СЌС‚Рѕ РЅРµ
      // РїРѕРјРѕРіР»Рѕ вЂ” РѕСЃС‚Р°РІР»СЏРµРј РєР°Рє РµСЃС‚СЊ, С‡С‚РѕР±С‹ РЅРµ РєСЂСѓС‚РёС‚СЊСЃСЏ РІС…РѕР»РѕСЃС‚СѓСЋ.
      if (round > 0) break;
    }

    if (!got) break;

    // РџСЂРѕСЃРёРј РїСЂРѕРґРѕР»Р¶РёС‚СЊ СЃ РїРѕСЃР»РµРґРЅРµР№ РїРѕР»СѓС‡РµРЅРЅРѕР№ РїРѕР·РёС†РёРё.
    const last = allPositions[allPositions.length - 1] || {};
    user = `РџСЂРѕРґРѕР»Р¶Рё РІРµРґРѕРјРѕСЃС‚СЊ СЃ РїРѕР·РёС†РёРё В«${String(last.name || '').slice(0, 80)}В» (РµС‘ СѓР¶Рµ СѓС‡Р»Рё, РЅРµ РїРѕРІС‚РѕСЂСЏР№).
Р’РµСЂРЅРё РўРћР›Р¬РљРћ JSON СЃ РјР°СЃСЃРёРІРѕРј positions вЂ” РѕСЃС‚Р°Р»СЊРЅС‹Рµ РїРѕР·РёС†РёРё, РєРѕС‚РѕСЂС‹С… РµС‰С‘ РЅРµС‚.
РЈР¶Рµ СЃРѕР±СЂР°РЅРѕ ${allPositions.length} РїРѕР·РёС†РёР№. РќРµ РЅР°С‡РёРЅР°Р№ СЃРЅР°С‡Р°Р»Р°.`;
  }

  if (!firstDv) {
    return { ok: false, error: 'РњРѕРґРµР»СЊ РЅРµ РІРµСЂРЅСѓР»Р° СЂР°Р·Р±РѕСЂ вЂ” РїРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰С‘ СЂР°Р·', raw: lastRaw.slice(0, 500) };
  }

  // РЎРѕР±РёСЂР°РµРј РёС‚РѕРіРѕРІСѓСЋ Р”Р’: РїРѕР»СЏ-РѕРїРёСЃР°РЅРёСЏ РёР· РїРµСЂРІРѕРіРѕ РєСЂСѓРіР°, РїРѕР·РёС†РёРё вЂ” РІСЃРµ.
  const dv = Object.assign({}, firstDv, { positions: allPositions });

  return {
    ok: true,
    dv,
    salvaged,
    rounds,
    model: usedModel,
    provider: usedProvider,
    tokens: totalUsage
  };
}

/**
 * Р“РµРЅРµСЂРёСЂСѓРµС‚ РїР»Р°РЅ РїСЂРѕСЃС‡С‘С‚Р° (Р»СЋРґРё, СЃСЂРѕРєРё, РѕР±РѕСЂСѓРґРѕРІР°РЅРёРµ).
 *
 * @param {object} p
 * @param {object} p.aiProvider
 * @param {Array}  p.positions вЂ” СЃРѕРіР»Р°СЃРѕРІР°РЅРЅС‹Рµ РїРѕР·РёС†РёРё Р”Р’
 * @param {string} p.normPreviewMd вЂ” Р±Р»РѕРє NORM PREVIEW
 * @param {string} p.workersMd вЂ” Р±СЂРёРіР°РґР° Рё РґРѕРїСѓСЃРєР°
 * @param {number} p.dateWindow вЂ” РєР°Р»РµРЅРґР°СЂРЅС‹С… РґРЅРµР№ (РјРѕР¶РµС‚ Р±С‹С‚СЊ null)
 * @param {number} p.maxParallelPosts
 */
async function generateCalcPlan(p) {
  const o = p || {};
  const positions = Array.isArray(o.positions) ? o.positions : [];
  if (!positions.length) {
    return { ok: false, error: 'РќРµС‚ РїРѕР·РёС†РёР№ РґР»СЏ РїР»Р°РЅР° вЂ” СЃРЅР°С‡Р°Р»Р° Р·Р°РїРѕР»РЅРёС‚Рµ Р”Р’' };
  }

  const system = promptLoader.buildPrompt('PROMPT-calc-plan-v1.md', {
    positions: positions.map((x, i) =>
      `${i + 1}. ${x.name} вЂ” ${x.volume} ${x.unit} В· ${x.category_code}.${x.method_code || 'вЂ”'}` +
      (x.tech_equip ? `\n   С‚РµС…РЅРѕР»РѕРіРёСЏ: ${x.tech_equip}` : '') +
      (Array.isArray(x.objects) && x.objects.length
        ? `\n   Р°РїРїР°СЂР°С‚С‹: ${x.objects.map((ob) => ob.tag || ob.type).filter(Boolean).join(', ')}` : '')
    ).join('\n'),
    tech_equip: positions.map((x) => x.tech_equip).filter(Boolean).join('; ') || '(РЅРµ Р·Р°РґР°РЅР°)',
    norm_preview: o.normPreviewMd || '(РЅРѕСЂРјР°С‚РёРІРѕРІ РЅРµС‚)',
    workers: o.workersMd || '(РґР°РЅРЅС‹Рµ РїРѕ Р±СЂРёРіР°РґРµ РЅРµ РїРµСЂРµРґР°РЅС‹)',
    date_window: o.dateWindow != null ? String(o.dateWindow) : '(РЅРµ Р·Р°РґР°РЅРѕ)',
    max_parallel_posts: String(o.maxParallelPosts || 2)
  });

  const user = 'Р Р°Р·Р»РѕР¶Рё СЂР°Р±РѕС‚С‹ РїРѕ Р°РїРїР°СЂР°С‚Р°Рј: Р»СЋРґРё, СЃСЂРѕРєРё, РѕР±РѕСЂСѓРґРѕРІР°РЅРёРµ Рё РёСЃС‚РѕС‡РЅРёРє РєР°Р¶РґРѕР№ С†РёС„СЂС‹. РўРѕР»СЊРєРѕ JSON.';

  let res;
  try {
    res = await o.aiProvider.complete({
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 12000,
      temperature: 0.15,
      responseFormat: { type: 'json_object' },
      reasoning: { enabled: false }
    });
  } catch (e) {
    return { ok: false, error: 'РњРѕРґРµР»СЊ РЅРµРґРѕСЃС‚СѓРїРЅР°: ' + e.message };
  }

  const parsed = safeJson(res && res.text);
  if (!parsed) {
    return {
      ok: false,
      error: 'РњРѕРґРµР»СЊ РІРµСЂРЅСѓР»Р° РїР»Р°РЅ РЅРµ РїРѕ СЃС…РµРјРµ вЂ” РїРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰С‘ СЂР°Р·',
      raw: (res && res.text || '').slice(0, 500)
    };
  }

  const plan = stages.normalizeCalcPlan(parsed, {
    max_parallel_posts: o.maxParallelPosts,
    // РћРєРЅРѕ РґР°С‚ РЅСѓР¶РЅРѕ, С‡С‚РѕР±С‹ РїРѕРґРѕР±СЂР°С‚СЊ С‡РёСЃР»Рѕ Р±СЂРёРіР°Рґ РїРѕРґ РіСЂР°С„РёРє Р·Р°РєР°Р·С‡РёРєР°.
    window_days: o.dateWindow
  });
  return {
    ok: true,
    plan,
    model: res.model || null,
    provider: res.provider || null,
    tokens: res.usage || null
  };
}

/** РџСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ РєР°Р»РёР±СЂРѕРІРєРё СЃРїСЂР°РІРѕС‡РЅРёРєР°: С‡С‚Рѕ РёР·РјРµРЅРёС‚СЃСЏ РїРѕСЃР»Рµ СЃРѕС…СЂР°РЅРµРЅРёСЏ. */
function buildCalibrationPreview(positions, plan) {
  const calc = (plan && plan.positions) || [];
  const rows = [];
  for (const c of calc) {
    // Р”Р»СЏ РєР°Р»РёР±СЂРѕРІРєРё РЅСѓР¶РµРЅ РєРѕРґ РЅРѕСЂРјС‹ Рё СЃРІСЏР·СЊ СЃ РїРѕР·РёС†РёРµР№ Р”Р’. РЈ СЌРєСЃРїРµСЂС‚РЅС‹С… РѕС†РµРЅРѕРє
    // РЅРѕСЂРјС‹ РЅРµС‚ вЂ” РѕРЅРё РІ РѕР±СѓС‡РµРЅРёРµ РЅРµ РёРґСѓС‚ (СЌС‚Рѕ С„РёРєСЃРёСЂСѓРµС‚СЃСЏ РІ РѕС‚С‡С‘С‚Рµ, РЅРµ РјРѕР»С‡Р°).
    if (!c.source_ref) continue;
    if (c.source !== 'norm' && c.source !== 'history' && c.source !== 'analog') continue;
    const pos = (positions || []).find((x) => x.id === c.position_id)
      || (positions || []).find((x) => x.name === c.name)
      || null;
    if (!pos || !(Number(pos.volume) > 0) || !(Number(c.days) > 0)) continue;
    rows.push({
      code: c.source_ref,
      position: pos.name,
      source: c.source,
      train: c.source === 'norm',
      work_days: Number(c.days),
      people: Number(c.people) || null,
      inputs: { [volumeKeyFor(pos)]: Number(pos.volume) }
    });
  }
  return rows;
}

function volumeKeyFor(pos) {
  const u = String(pos && pos.unit || '').toLowerCase();
  if (u.includes('РјВі') || u.includes('Рј3')) return 'circuit_m3';
  if (u.includes('РјВІ') || u.includes('Рј2')) return 'surface_m2';
  if (u.includes('С‚СЂСѓР±')) return 'tubes';
  if (u.includes('СЃС‚С‹Рє')) return 'joints';
  if (u.includes('Рј')) return 'length_m';
  if (u.includes('С†РёРєР»')) return 'cycles';
  return 'qty';
}

module.exports = {
  generateDv,
  generateCalcPlan,
  buildCalibrationPreview,
  catalogForPrompt,
  docsToText,
  lastSelection: () => lastSelection,
  safeJson,
  volumeKeyFor
};

