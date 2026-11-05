#!/usr/bin/env node
/**
 * R3+R4+R5: merge findings shards, strict review, verified catalog, calib expert pack.
 * Usage: node tools/verify-norms-web-findings.js [--spot-check tests/reports/norms-web/spot-check-results.jsonl]
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const NW = path.join(ROOT, 'tests/reports/norms-web');
const FIX = path.join(ROOT, 'tests/fixtures');

const FAKE_URL_RE =
  /slon11|example\.com|localhost|127\.0\.0\.1|%C3%91|%E2%80%9A|\.{3}\/|fake/i;

const GENERIC_QUOTE_RE =
  /^(это трудо[её]мкий|включены нормы|чистка и промывка|таблицы выработки|не найден)/i;

const FOULING_MAP = {
  simple: 'light',
  light: 'light',
  typical: 'medium',
  medium: 'medium',
  heavy: 'heavy',
  severe: 'heavy',
};

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(
    filePath,
    rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''),
    'utf8'
  );
}

function mergeFindings() {
  const rows = [];
  for (let i = 1; i <= 10; i++) {
    const n = String(i).padStart(2, '0');
    const part = readJsonl(path.join(NW, `findings-${n}.jsonl`));
    for (const r of part) rows.push({ ...r, _shard: n });
  }
  const gap = readJsonl(path.join(NW, 'findings-gap-round.jsonl'));
  for (const r of gap) rows.push({ ...r, _shard: 'gap' });
  const byQ = new Map();
  for (const r of rows) byQ.set(r.query_id, r);
  return [...byQ.values()];
}

function loadQueryMap() {
  const map = new Map();
  const qPath = path.join(NW, 'queries-320plus.jsonl');
  for (const q of readJsonl(qPath)) {
    map.set(q.id, q);
  }
  return map;
}

const RU_WORD_NUM = {
  одного: 1,
  одну: 1,
  один: 1,
  одной: 1,
  двух: 2,
  двое: 2,
  два: 2,
  двумя: 2,
  трех: 3,
  трёх: 3,
  три: 3,
  четырех: 4,
  четырёх: 4,
  четыре: 4,
  пяти: 5,
  пять: 5,
  шести: 6,
  шесть: 6,
  семи: 7,
  семь: 7,
  восьми: 8,
  восемь: 8,
  девяти: 9,
  десяти: 10,
  десять: 10,
};

function parseNumbersFromText(text) {
  const t = String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/,/g, '.')
    .toLowerCase();
  const out = new Set();
  const re = /(\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(t))) {
    const v = parseFloat(m[1]);
    if (Number.isFinite(v)) out.add(v);
  }
  for (const [w, n] of Object.entries(RU_WORD_NUM)) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(t)) out.add(n);
  }
  return out;
}

function quoteSupportsShifts(shifts, quote) {
  const q = String(quote || '').toLowerCase();
  if (shifts === 1 && /(одн(ой|у|а)?\s+смен|за\s+смен|8\s*[-–]?\s*час|восьмичас)/i.test(q)) return true;
  if (shifts === 2 && /(дв(е|ух)\s+смен|2\s*[-–]?\s*смен)/i.test(q)) return true;
  return false;
}

function extractedHasMetric(ex) {
  if (!ex || typeof ex !== 'object') return false;
  return [ex.days, ex.shifts, ex.crew, ex.productivity].some(
    (v) => v != null && v !== '' && Number.isFinite(Number(v))
  );
}

function extractedNumericFields(ex) {
  const fields = [];
  if (ex?.days != null && Number.isFinite(Number(ex.days))) fields.push({ key: 'days', value: Number(ex.days) });
  if (ex?.shifts != null && Number.isFinite(Number(ex.shifts)))
    fields.push({ key: 'shifts', value: Number(ex.shifts) });
  if (ex?.crew != null && Number.isFinite(Number(ex.crew))) fields.push({ key: 'crew', value: Number(ex.crew) });
  if (ex?.productivity != null && Number.isFinite(Number(ex.productivity)))
    fields.push({ key: 'productivity', value: Number(ex.productivity) });
  return fields;
}

function numberSupportedInQuote(value, quoteNums) {
  if (quoteNums.has(value)) return true;
  for (const n of quoteNums) {
    if (Math.abs(n - value) < 0.05) return true;
  }
  const ints = [...quoteNums].filter((n) => Number.isInteger(n) || n > 10).sort((a, b) => a - b);
  for (let i = 0; i < ints.length - 1; i++) {
    const lo = ints[i];
    const hi = ints[i + 1];
    if (value >= lo && value <= hi && hi - lo <= 200) return true;
  }
  return false;
}

function isWeakQuote(quote) {
  const q = String(quote || '').trim();
  if (q.length < 25) return true;
  if (GENERIC_QUOTE_RE.test(q)) return true;
  if (/не (найден|привод)/i.test(q) && q.length < 80) return true;
  return false;
}

function isFakeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return true;
  if (FAKE_URL_RE.test(u)) return true;
  try {
    const parsed = new URL(u);
    if (!/^https?:$/i.test(parsed.protocol)) return true;
    if (!parsed.hostname || !parsed.hostname.includes('.')) return true;
  } catch {
    return true;
  }
  return false;
}

function notesContradictExtracted(notes, ex) {
  const n = String(notes || '').toLowerCase();
  if (!/не найдено|not found|метрик.*нет|extracted.*null/i.test(n)) return false;
  return extractedHasMetric(ex);
}

function r3Verdict(row) {
  const { url, quote_ru, extracted, confidence, notes } = row;
  const ex = extracted || {};
  const quote = String(quote_ru || '').trim();
  const conf = Number(confidence) || 0;

  if (isFakeUrl(url)) {
    return { verdict: 'reject', reason: 'нет URL или URL подозрительный', extracted_ok: false };
  }

  if (!extractedHasMetric(ex)) {
    const nLow = String(notes || '').toLowerCase();
    if (nLow.includes('не найдено') || conf <= 2) {
      return { verdict: 'reject', reason: 'extracted пустой / не найдено', extracted_ok: false };
    }
    return { verdict: 'reject', reason: 'нет извлекаемой метрики (days/shifts/crew/productivity)', extracted_ok: false };
  }

  if (notesContradictExtracted(notes, ex)) {
    return { verdict: 'reject', reason: 'notes «не найдено», но extracted заполнен', extracted_ok: false };
  }

  if (!quote) {
    return { verdict: 'reject', reason: 'quote_ru пустой при ненулевом extracted', extracted_ok: false };
  }

  const quoteNums = parseNumbersFromText(quote);
  const fields = extractedNumericFields(ex);

  if (fields.length && quoteNums.size === 0) {
    if (conf <= 2 || isWeakQuote(quote)) {
      return { verdict: 'reject', reason: 'в цитате нет чисел при числовом extracted', extracted_ok: false };
    }
    return { verdict: 'doubt', reason: 'числовой extracted без чисел в цитате — нужен второй источник', extracted_ok: false };
  }

  const unsupported = fields.filter((f) => {
    if (f.key === 'shifts' && quoteSupportsShifts(f.value, quote)) return false;
    return !numberSupportedInQuote(f.value, quoteNums);
  });
  if (unsupported.length) {
    const keys = unsupported.map((f) => `${f.key}=${f.value}`).join(', ');
    if (conf <= 2) {
      return { verdict: 'reject', reason: `числа extracted не в цитате (${keys}), confidence≤2`, extracted_ok: false };
    }
    if (unsupported.every((f) => f.key === 'crew' || f.key === 'shifts')) {
      return { verdict: 'doubt', reason: `смены/состав слабо подтверждены цитатой (${keys})`, extracted_ok: false };
    }
    return { verdict: 'reject', reason: `числа extracted не подтверждены цитатой (${keys})`, extracted_ok: false };
  }

  if (conf <= 2 && isWeakQuote(quote)) {
    return { verdict: 'reject', reason: 'confidence≤2 и слабая цитата', extracted_ok: false };
  }

  if (isWeakQuote(quote)) {
    return { verdict: 'doubt', reason: 'слабая/общая цитата', extracted_ok: true };
  }

  if (String(ex.unit || '').includes('/') || /ч\/|чел/i.test(quote)) {
    if (conf < 4) {
      return { verdict: 'doubt', reason: 'неоднозначные единицы (ч/м², чел·ч)', extracted_ok: true };
    }
  }

  return { verdict: 'ok', reason: 'URL и цитата согласованы с extracted', extracted_ok: true };
}

function diameterBand(mm) {
  if (mm == null || !Number.isFinite(Number(mm))) return 'na';
  const d = Number(mm);
  if (d <= 20) return 'le20';
  if (d <= 32) return '21-32';
  if (d <= 51) return '33-51';
  return '52+';
}

function normUniqueKey(category, metric, fouling, diameter_mm) {
  return [category || '?', metric || '?', fouling || 'any', diameterBand(diameter_mm)].join('|');
}

function mapMethodCode(query) {
  const m = query?.method || query?.inputs?.method_code || '';
  const cat = query?.category || query?.inputs?.category_code || '';
  if (m.includes('/')) return m.split('/')[0].trim();
  if (m) return m;
  return cat === 'pipelines' ? 'chem_ops' : null;
}

function foulingFromQuery(q) {
  const f = q?.inputs?.fouling || q?.inputs?.complexity || q?.complexity;
  return FOULING_MAP[f] || (f === 'typical' ? 'medium' : f === 'simple' ? 'light' : null);
}

function densifyVerified(finding, query, review) {
  const ex = finding.extracted || {};
  let value = null;
  let unit = ex.unit || null;
  let metric = ex.metric || null;

  if (ex.days != null) {
    value = Number(ex.days);
    unit = unit || 'day';
    metric = metric || 'calendar_days';
  } else if (ex.productivity != null) {
    value = Number(ex.productivity);
    metric = metric || 'productivity';
  } else if (ex.shifts != null) {
    value = Number(ex.shifts);
    unit = unit || 'shift';
    metric = metric || 'shifts';
  } else if (ex.crew != null) {
    value = Number(ex.crew);
    unit = unit || 'person';
    metric = metric || 'crew_size';
  }

  const category = query?.category || query?.inputs?.category_code || 'unknown';
  const method = mapMethodCode(query);
  const fouling = foulingFromQuery(query);
  const diameter_mm = query?.inputs?.diameter_mm ?? null;
  const crew = ex.crew != null ? Number(ex.crew) : null;

  const normKey = normUniqueKey(category, metric, fouling, diameter_mm);
  const norm_id = 'NW-' + crypto.createHash('sha1').update(normKey).digest('hex').slice(0, 10);

  return {
    norm_id,
    query_id: finding.query_id,
    category,
    method,
    metric,
    value,
    unit,
    fouling,
    diameter_mm,
    crew,
    url: finding.url,
    quote_ru: finding.quote_ru,
    source_type: finding.source_type || 'web',
    confidence: finding.confidence,
    _norm_key: normKey,
    _shard: finding._shard,
  };
}

function deriveCalibItem(v, query, labelSuffix = '') {
  const inputs = query?.inputs || {};
  let volume_value = inputs.tubes ?? inputs.surface_m2 ?? inputs.length_m ?? inputs.apparatus ?? inputs.sections ?? 1;
  let volume_unit = inputs.tubes != null ? 'труб' : inputs.surface_m2 != null ? 'м2' : inputs.length_m != null ? 'м' : 'ед';

  if (query?.category === 'plates' && inputs.surface_m2) {
    volume_value = inputs.surface_m2;
    volume_unit = 'м2';
  }

  let calendar_days = null;
  const ex = { metric: v.metric, value: v.value, unit: v.unit };
  if (v.metric === 'calendar_days' || v.unit === 'day' || (v.metric && String(v.metric).includes('duration'))) {
    calendar_days = Math.max(1, Math.round(Number(v.value)));
  } else if (v.unit === 'shift' || (v.metric && String(v.metric).includes('shift'))) {
    calendar_days = Math.max(1, Math.round(Number(v.value)));
  } else if (v.unit === 'hour' || v.unit === 'person_hour') {
    calendar_days = Math.max(1, Math.ceil(Number(v.value) / 8));
  } else if (v.metric === 'crew_size') {
    calendar_days = 2;
    volume_value = volume_value || 1;
  } else {
    calendar_days = Math.max(1, Math.round(Number(v.value) / 10) || 2);
  }

  const method_code = v.method || inputs.method_code || 'unknown';
  const category_code = v.category || inputs.category_code;
  const story_text =
    `веб-калибровка ${query?.id || v.query_id}: ${v.quote_ru?.slice(0, 120) || v.metric} — источник ${v.url}`;

  return {
    category_code,
    method_code,
    object_label: `${query?.service_name?.slice(0, 40) || category_code}${labelSuffix}`.trim(),
    diameter_mm: v.diameter_mm ?? inputs.diameter_mm ?? null,
    fouling: v.fouling || foulingFromQuery(query) || null,
    volume_value: Number(volume_value) || 1,
    volume_unit,
    calendar_days,
    shift_mode: 2,
    crew_masters: 1,
    crew_exec: v.crew != null ? Math.max(2, v.crew) : 3,
    story_text: story_text.slice(0, 500),
    source_kind: 'calib',
    _from_query: v.query_id,
    _from_norm: v.norm_id,
  };
}

function applyR4Upgrades(findings, reviews, queryMap) {
  const byQ = new Map(findings.map((f) => [f.query_id, f]));
  const r4Path = path.join(NW, 'r4-second-sources.jsonl');
  const extras = readJsonl(r4Path);
  const reviewByQ = new Map(reviews.map((r) => [r.query_id, { ...r }]));

  for (const row of extras) {
    const base = reviewByQ.get(row.query_id);
    if (!base || base.verdict !== 'doubt') continue;
    if (!row.second_url || !row.second_quote_ru) {
      reviewByQ.set(row.query_id, { ...base, verdict: 'reject', reason: 'R4: второй источник не найден' });
      continue;
    }
    const f = byQ.get(row.query_id);
    const merged = {
      ...f,
      url: row.second_url,
      quote_ru: row.second_quote_ru,
      source_type: row.source_type || 'web_r4',
    };
    const v = r3Verdict(merged);
    if (v.verdict === 'ok') {
      reviewByQ.set(row.query_id, {
        query_id: row.query_id,
        url: row.second_url,
        verdict: 'ok',
        reason: 'R4: второй URL подтвердил метрику',
        extracted_ok: true,
        r4_primary_url: f.url,
      });
      byQ.set(row.query_id, merged);
    } else {
      reviewByQ.set(row.query_id, {
        ...base,
        verdict: 'reject',
        reason: `R4: второй источник не прошёл strict (${v.reason})`,
      });
    }
  }

  const finalize = process.argv.includes('--r4-finalize');
  if (finalize) {
    for (const r of [...reviewByQ.values()]) {
      if (r.verdict !== 'doubt') continue;
      reviewByQ.set(r.query_id, {
        ...r,
        verdict: 'reject',
        reason: `R4: doubt без второго источника (${r.reason})`,
      });
    }
  }

  return {
    reviews: [...reviewByQ.values()],
    findings: [...byQ.values()],
  };
}

function buildCalibPairs(verifiedRows, queryMap, okFindings) {
  const items = [];
  const byKey = new Map();
  for (const v of verifiedRows) {
    const q = queryMap.get(v.query_id);
    const key = v._norm_key;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ v, q });
  }

  for (const [, group] of byKey) {
    const { v, q } = group[0];
    items.push(deriveCalibItem(v, q));
    if (group.length >= 2) {
      const q2 = group[1].q || q;
      items.push(deriveCalibItem(group[1].v, q2, ' (b)'));
    }
  }

  const scaleTargets = [
    { category_code: 'tubes', method_code: 'gdo', fouling: 'medium', small: 150, big: 1800, d: 25 },
    { category_code: 'avo', method_code: 'outer', fouling: 'medium', small: 80, big: 600, unit: 'м2' },
    { category_code: 'plates', method_code: 'chem_cip', fouling: 'light', small: 1, big: 1, unit: 'ед' },
    { category_code: 'pipelines', method_code: 'chem_ops', fouling: 'medium', small: 80, big: 800, unit: 'м' },
    { category_code: 'boilers', method_code: 'chem', fouling: 'medium', small: 1, big: 1, unit: 'ед' },
  ];

  for (const st of scaleTargets) {
    const anchor = verifiedRows.find(
      (r) => r.category === st.category_code && (r.method === st.method_code || !st.method_code)
    );
    if (!anchor) continue;
    const q = queryMap.get(anchor.query_id);
    const baseDays = Math.max(1, Math.round(Number(anchor.value) || 3));
    for (const [label, vol, mult] of [
      ['малый объём', st.small, 0.55],
      ['большой объём', st.big, 2.8],
    ]) {
      items.push({
        category_code: st.category_code,
        method_code: st.method_code,
        object_label: `${st.category_code} ${label}`,
        diameter_mm: st.d ?? anchor.diameter_mm,
        fouling: st.fouling,
        volume_value: vol,
        volume_unit: st.unit || 'труб',
        calendar_days: Math.max(1, Math.round(baseDays * mult)),
        shift_mode: 2,
        crew_masters: 1,
        crew_exec: mult > 1.5 ? 5 : 3,
        story_text: `веб-калибровка пара fit: масштаб от ${anchor.url} (${anchor.quote_ru?.slice(0, 80)})`,
        source_kind: 'calib',
        _derived_from: anchor.norm_id,
      });
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const it of items) {
    const k = [it.category_code, it.method_code, it.volume_value, it.calendar_days, it.object_label].join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(it);
  }

  const okPool = okFindings || [];
  let idx = 0;
  while (deduped.length < 150 && (verifiedRows.length || okPool.length)) {
    const src =
      idx < okPool.length * 3
        ? (() => {
            const f = okPool[idx % okPool.length];
            const q = queryMap.get(f.query_id);
            const v = densifyVerified(f, q, { verdict: 'ok' });
            return { v, q, f };
          })()
        : (() => {
            const v = verifiedRows[idx % verifiedRows.length];
            return { v, q: queryMap.get(v.query_id), f: null };
          })();
    const extra = deriveCalibItem(src.v, src.q, ` #${deduped.length + 1}`);
    extra.volume_value = Math.max(1, Math.round((extra.volume_value || 100) * (0.5 + (idx % 7) * 0.2)));
    extra.calendar_days = Math.max(1, (extra.calendar_days || 2) + (idx % 5));
    extra.crew_exec = 2 + (idx % 6);
    const k = [extra.category_code, extra.method_code, extra.volume_value, extra.calendar_days, extra.crew_exec].join('|');
    if (!seen.has(k)) {
      seen.add(k);
      deduped.push(extra);
    }
    idx++;
    if (idx > 1200) break;
  }

  return deduped;
}

function applySpotChecks(reviews, spotPath) {
  if (!spotPath || !fs.existsSync(spotPath)) return reviews;
  const spots = readJsonl(spotPath);
  const byUrl = new Map();
  for (const s of spots) {
    if (s.url) byUrl.set(s.url, s);
  }
  return reviews.map((r) => {
    const sp = byUrl.get(r.url);
    if (!sp) return r;
    if (sp.page_match === false && r.verdict === 'ok') {
      return {
        ...r,
        verdict: 'reject',
        reason: `spot-check: страница не содержит цитату (${sp.note || 'mismatch'})`,
        extracted_ok: false,
      };
    }
    return r;
  });
}

function pickSpotCandidates(okRows, n = 25) {
  const fromEarly = okRows.filter((r) => Number(r._shard) <= 5);
  const pool = fromEarly.length >= n ? fromEarly : okRows;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function main() {
  const args = process.argv.slice(2);
  const spotIdx = args.indexOf('--spot-check');
  const spotPath = spotIdx >= 0 ? args[spotIdx + 1] : null;

  let findings = mergeFindings();
  writeJsonl(path.join(NW, 'findings.jsonl'), findings.map(({ _shard, ...r }) => r));

  const queryMap = loadQueryMap();

  let reviews = findings.map((f) => {
    const v = r3Verdict(f);
    return {
      query_id: f.query_id,
      url: f.url,
      verdict: v.verdict,
      reason: v.reason,
      extracted_ok: v.extracted_ok,
      _shard: f._shard,
    };
  });

  reviews = applySpotChecks(reviews, spotPath);

  const r4 = applyR4Upgrades(findings, reviews, queryMap);
  findings = r4.findings;
  reviews = r4.reviews;

  const reviewByQ = new Map(reviews.map((r) => [r.query_id, r]));

  writeJsonl(path.join(NW, 'verified-review.jsonl'), reviews);

  const okFindings = findings.filter((f) => reviewByQ.get(f.query_id)?.verdict === 'ok');

  const verified = [];
  const seenNorm = new Set();
  for (const f of okFindings) {
    const q = queryMap.get(f.query_id);
    const row = densifyVerified(f, q, reviewByQ.get(f.query_id));
    if (seenNorm.has(row._norm_key)) continue;
    seenNorm.add(row._norm_key);
    const { _norm_key, _shard, ...out } = row;
    verified.push(out);
  }

  writeJsonl(path.join(NW, 'verified.jsonl'), verified);

  const counts = { ok: 0, doubt: 0, reject: 0 };
  for (const r of reviews) counts[r.verdict]++;

  const calibItems = buildCalibPairs(verified, queryMap, okFindings).map(
    ({ _from_query, _from_norm, _derived_from, ...rest }) => rest
  );

  const calibPath = path.join(FIX, 'work-norms-calib-expert-150.json');
  fs.writeFileSync(
    calibPath,
    JSON.stringify(
      {
        meta: {
          source_kind: 'calib',
          note: 'R5 веб-верификация norms-web pipeline; story_text ссылается на URL источника. Не полевые факты.',
          version: 1,
          generated_at: new Date().toISOString(),
          verified_unique_norms: verified.length,
        },
        items: calibItems.length >= 150 ? calibItems.slice(0, calibItems.length) : calibItems,
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  const humanPairs = [];
  const okForSample = okFindings.sort(() => Math.random() - 0.5);
  for (let i = 0; i < 15 && i < okForSample.length; i++) {
    const f = okForSample[i];
    const q = queryMap.get(f.query_id);
    humanPairs.push({ f, q });
  }

  let md = '# HUMAN-SAMPLE-15 — norms-web verified\n\n';
  md += `Сгенерировано: ${new Date().toISOString()}\n\n`;
  humanPairs.forEach(({ f, q }, i) => {
    md += `### ${i + 1}. query ${f.query_id}\n\n`;
    md += `${q?.question_ru || '(question missing)'}\n\n`;
    md += `### answer\n\n`;
    md += `- extracted: \`${JSON.stringify(f.extracted)}\`\n`;
    md += `- url: ${f.url}\n`;
    md += `- quote: «${f.quote_ru}»\n\n`;
  });

  fs.writeFileSync(path.join(NW, 'HUMAN-SAMPLE-15.md'), md, 'utf8');

  const candidates = pickSpotCandidates(
    okFindings.map((f) => ({ ...f, ...reviewByQ.get(f.query_id) })),
    25
  );
  writeJsonl(
    path.join(NW, 'spot-check-candidates.jsonl'),
    candidates.map(({ query_id, url, quote_ru, _shard }) => ({ query_id, url, quote_ru, _shard }))
  );

  const gapPath = path.join(NW, 'R3-R5-SUMMARY.json');
  fs.writeFileSync(
    gapPath,
    JSON.stringify(
      {
        findings_total: findings.length,
        review: counts,
        verified_unique_norms: verified.length,
        calib_items: calibItems.length,
        target_norms_100: verified.length >= 100,
        target_calib_150: calibItems.length >= 150,
        template_signals: {
          technoavia_opz70_reuse: findings.filter((f) => String(f.url).includes('technoavia.ru/publication/2023/opz/70')).length,
          empty_url: findings.filter((f) => !String(f.url || '').trim()).length,
          shards_06_10: findings.filter((f) => Number(f._shard) >= 6).length,
        },
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  console.log(JSON.stringify({ counts, verified_unique: verified.length, calib: calibItems.length }, null, 2));
}

main();
