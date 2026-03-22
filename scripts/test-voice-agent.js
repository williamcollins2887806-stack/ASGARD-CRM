#!/usr/bin/env node
'use strict';

/**
 * ASGARD FREYA — Voice Agent Test Suite
 * ═══════════════════════════════════════
 * Module 1: Unit tests (no network)
 * Module 2: AI quality tests (requires API keys)
 *
 * Usage: node scripts/test-voice-agent.js [--verbose] [--unit-only]
 */

const path = require('path');
const fs = require('fs');
const https = require('https');

const CRM_ROOT = path.resolve(__dirname, '..');

// Load .env
try { require('dotenv').config({ path: path.join(CRM_ROOT, '.env') }); } catch (e) {
  try {
    const envContent = fs.readFileSync(path.join(CRM_ROOT, '.env'), 'utf8');
    envContent.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const eq = line.indexOf('=');
      if (eq === -1) return;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    });
  } catch (_) {}
}

const VERBOSE = process.argv.includes('--verbose');
const UNIT_ONLY = process.argv.includes('--unit-only');

/* ── Import helpers ── */
const {
  CACHED_INTENTS, pickRandom, fillTemplate,
  detectIntentByKeywords, parseAIResponse
} = require(path.join(CRM_ROOT, 'src/helpers/voice-helpers'));

/* ── Test framework ── */
let totalTests = 0, passed = 0, failed = 0, warned = 0, skipped = 0;
const failures = [];
const warnings = [];

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passed++;
    if (VERBOSE) console.log(`    \x1b[32m✓\x1b[0m ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.log(`    \x1b[31m✗\x1b[0m ${message}`);
  }
}

function warn(condition, message) {
  if (!condition) {
    warned++;
    warnings.push(message);
    console.log(`    \x1b[33m⚠\x1b[0m ${message}`);
  }
}

function skip(message) {
  skipped++;
  console.log(`    \x1b[36m◌\x1b[0m ${message} [SKIPPED]`);
}

/* ══════════════════════════════════════════════════════
   MODULE 1: UNIT TESTS
   ══════════════════════════════════════════════════════ */

function test_1_1_intentDetection() {
  console.log('\n  1.1 detectIntentByKeywords');

  const ctx = { isInternal: false, employees: [
    { name: 'Хосе Александр', display_name: 'Хосе Александр', role: 'PM', fallback_mobile: '79161234567' },
    { name: 'Иванова А.', display_name: 'Иванова Анна', role: 'BUH', fallback_mobile: '79162345678' },
    { name: 'Петров С.', display_name: 'Петров Сергей', role: 'PROC', fallback_mobile: '79163456789' },
  ]};

  const cases = [
    // [phrase, expected intent, expected action, description]
    ['нам нужна информация по тендеру', 'tender', 'continue', 'тендер → confirm'],
    ['хотим участвовать в аукционе', 'tender', 'continue', 'аукцион → confirm'],
    ['конкурс на очистку', 'tender', 'continue', 'конкурс → confirm'],
    ['позовите директора', 'refuse_director', 'continue', 'директор → отказ'],
    ['соедините с Кудряшовым', 'refuse_director', 'continue', 'Кудряшов → отказ'],
    ['соедините с руководством', 'refuse_director', 'continue', 'руководство → отказ'],
    ['предлагаем SEO продвижение', 'spam', 'hangup', 'SEO → спам'],
    ['реклама в интернете', 'spam', 'hangup', 'реклама → спам'],
    ['кредит для бизнеса', 'spam', 'hangup', 'кредит → спам'],
    ['вебинар по маркетингу', 'spam', 'hangup', 'вебинар → спам'],
    ['есть ли у вас вакансия', 'career', 'continue', 'вакансия → карьера'],
    ['хочу трудоустроиться к вам', 'career', 'continue', 'трудоустройство → карьера'],
    ['бухгалтерия нужна', 'accounting', 'continue', 'бухгалтерия → confirm'],
    ['по оплате вопрос', 'accounting', 'continue', 'оплата → бухгалтерия'],
    ['отдел закупок', 'procurement', 'continue', 'закупки → confirm'],
    ['соединить со снабжением', 'procurement', 'continue', 'снабжение → confirm'],
    // Should return null (→ LLM)
    ['нам нужна промывка оборудования', null, null, 'промывка → LLM'],
    ['добрый день', null, null, 'приветствие → LLM'],
    ['какие у вас услуги', null, null, 'общий вопрос → LLM'],
    // Spam exclusion: промывка + реклама → не спам
    ['очистка теплообменников рекламная акция', null, null, 'очистка+реклама → LLM (не спам)'],
  ];

  for (const [phrase, expectedIntent, expectedAction, desc] of cases) {
    const result = detectIntentByKeywords(phrase, ctx, null);
    if (expectedIntent === null) {
      assert(result === null, `"${desc}": null (→ LLM)`);
    } else {
      assert(result !== null && result.intent === expectedIntent, `"${desc}": intent=${expectedIntent} (got ${result ? result.intent : 'null'})`);
      assert(result !== null && result.action === expectedAction, `"${desc}": action=${expectedAction} (got ${result ? result.action : 'null'})`);
    }
  }

  // Pending route confirmation
  console.log('\n    Pending route confirmation:');
  const pendingRoute = { intent: 'tender', department: 'tender', route_to: '79161234567', route_name: 'Хосе Александр' };

  const confirmYes = detectIntentByKeywords('да, соединяй', ctx, pendingRoute);
  assert(confirmYes !== null && confirmYes.action === 'route', 'confirm "да" → route');
  assert(confirmYes !== null && confirmYes.route_to === '79161234567', 'confirm → correct phone');

  const confirmNo = detectIntentByKeywords('нет, не надо', ctx, pendingRoute);
  assert(confirmNo !== null && confirmNo.intent === 'cancel_route', 'cancel "нет" → cancel_route');
  assert(confirmNo !== null && confirmNo.action === 'continue', 'cancel → continue');

  const confirmUnclear = detectIntentByKeywords('не знаю что сказать', ctx, pendingRoute);
  assert(confirmUnclear === null, 'unclear pending → null (→ LLM)');

  // Transfer by name
  console.log('\n    Transfer by name:');
  const transferHose = detectIntentByKeywords('соедините с Хосе', ctx, null);
  assert(transferHose !== null && transferHose.intent === 'transfer_request', 'Хосе → transfer_request');
  assert(transferHose !== null && transferHose.route_to === '79161234567', 'Хосе → correct phone');

  // Internal caller can reach directors
  const internalCtx = { ...ctx, isInternal: true };
  const directorInternal = detectIntentByKeywords('позовите директора', internalCtx, null);
  assert(directorInternal === null, 'internal + директор → null (не отказ)');

  // Empty/null
  assert(detectIntentByKeywords('', ctx, null) === null, 'empty → null');
  assert(detectIntentByKeywords(null, ctx, null) === null, 'null → null');
}

function test_1_2_parseAIResponse() {
  console.log('\n  1.2 parseAIResponse');

  // Text-first format
  const r1 = parseAIResponse('Здравствуйте! Чем могу помочь?', '{"action":"continue","intent":"new_client"}');
  assert(r1.text === 'Здравствуйте! Чем могу помочь?', 'text-first: text correct');
  assert(r1.action === 'continue', 'text-first: action=continue');
  assert(r1.intent === 'new_client', 'text-first: intent parsed');

  // Route with phone normalization
  const r2 = parseAIResponse('Соединяю', '{"action":"route","route_to":"89161234567","route_name":"Иванов","intent":"tender"}');
  assert(r2.action === 'route', 'route: action=route');
  assert(r2.route_to === '79161234567', 'route: 8→7 normalization');
  assert(r2.route_name === 'Иванов', 'route: route_name');

  // Invalid phone
  const r3 = parseAIResponse('Соединяю', '{"action":"route","route_to":"123","intent":"tender"}');
  assert(r3.route_to === null, 'invalid phone → null');

  // Legacy JSON format (text is pure JSON)
  const r4 = parseAIResponse('{"text":"Соединяю","action":"route","route_to":"79161234567","intent":"tender"}', '');
  assert(r4.action === 'route', 'legacy JSON: action=route');
  assert(r4.route_to === '79161234567', 'legacy JSON: phone');
  assert(r4.text === 'Соединяю', 'legacy JSON: text');

  // Plain text, no JSON
  const r5 = parseAIResponse('Секундочку, уточню.', '');
  assert(r5.action === 'continue', 'plain text: action=continue');
  assert(r5.text === 'Секундочку, уточню.', 'plain text: text preserved');
  assert(r5.intent === 'unknown', 'plain text: intent=unknown');

  // JSON with ```json``` wrapper
  const r6 = parseAIResponse('Ок', '```json\n{"action":"hangup","intent":"spam"}\n```');
  assert(r6.action === 'hangup', 'json wrapper: action=hangup');
  assert(r6.intent === 'spam', 'json wrapper: intent=spam');

  // Invalid JSON → fallback
  const r7 = parseAIResponse('Алло?', '{invalid json here}');
  assert(r7.action === 'continue', 'invalid JSON → continue');
  assert(r7.text === 'Алло?', 'invalid JSON → text preserved');

  // Empty
  const r8 = parseAIResponse('', '');
  assert(r8.text === '(нет ответа)', 'empty → (нет ответа)');
  assert(r8.action === 'continue', 'empty → continue');

  // Invalid action → continue
  const r9 = parseAIResponse('Привет', '{"action":"invalid_action","intent":"test"}');
  assert(r9.action === 'continue', 'invalid action → continue');
}

function test_1_3_cachedIntents() {
  console.log('\n  1.3 CACHED_INTENTS completeness');

  let totalPhrases = 0;
  let templatePhrases = 0;
  const categories = [];

  function countPhrases(obj, prefix) {
    if (Array.isArray(obj)) {
      obj.forEach(p => {
        totalPhrases++;
        if (p.includes('{')) templatePhrases++;
      });
    } else if (typeof obj === 'object' && obj !== null) {
      for (const [key, val] of Object.entries(obj)) {
        categories.push(prefix ? `${prefix}.${key}` : key);
        countPhrases(val, prefix ? `${prefix}.${key}` : key);
      }
    }
  }
  countPhrases(CACHED_INTENTS, '');

  assert(totalPhrases >= 30, `>= 30 phrases total (got ${totalPhrases})`);
  assert(templatePhrases <= 5, `<= 5 template phrases (got ${templatePhrases})`);
  assert(totalPhrases - templatePhrases >= 30, `>= 30 cacheable (got ${totalPhrases - templatePhrases})`);

  // Required categories
  const requiredCategories = [
    'greetings', 'route_tender', 'route_accounting', 'refuse_director',
    'silence_first', 'silence_second', 'silence_hangup', 'spam',
    'goodbye', 'confirm_tender', 'confirm_accounting'
  ];
  for (const cat of requiredCategories) {
    const exists = categories.some(c => c === cat || c.startsWith(cat + '.'));
    assert(exists, `category "${cat}" exists`);
  }

  // Each array has at least 2 variants
  function checkVariants(obj, prefix) {
    if (Array.isArray(obj)) {
      assert(obj.length >= 2, `${prefix}: >= 2 variants (got ${obj.length})`);
    } else if (typeof obj === 'object' && obj !== null) {
      for (const [key, val] of Object.entries(obj)) {
        checkVariants(val, prefix ? `${prefix}.${key}` : key);
      }
    }
  }
  checkVariants(CACHED_INTENTS, '');

  // Phrases don't contain raw JSON
  function checkNoJSON(obj) {
    if (Array.isArray(obj)) {
      obj.forEach(p => {
        assert(!p.includes('"action"'), `no raw JSON in phrase: "${p.slice(0, 30)}..."`);
      });
    } else if (typeof obj === 'object' && obj !== null) {
      Object.values(obj).forEach(v => checkNoJSON(v));
    }
  }
  checkNoJSON(CACHED_INTENTS);
}

function test_1_4_helpers() {
  console.log('\n  1.4 pickRandom & fillTemplate');

  // pickRandom returns element from array
  const arr = ['a', 'b', 'c'];
  const result = pickRandom(arr);
  assert(arr.includes(result), 'pickRandom returns valid element');

  // fillTemplate
  assert(fillTemplate('Hello, {name}!', { name: 'Nikita' }) === 'Hello, Nikita!', 'fillTemplate single var');
  assert(fillTemplate('{a} and {b}', { a: 'X', b: 'Y' }) === 'X and Y', 'fillTemplate multiple vars');
  assert(fillTemplate('{name}, {name}!', { name: 'Hi' }) === 'Hi, Hi!', 'fillTemplate repeated var');
  assert(fillTemplate('No vars here', {}) === 'No vars here', 'fillTemplate no vars');
}

/* ══════════════════════════════════════════════════════
   MODULE 2: AI QUALITY TESTS
   ══════════════════════════════════════════════════════ */

const YANDEX_GPT_KEY = process.env.YANDEX_GPT_API_KEY || '';
const YANDEX_FOLDER = process.env.YANDEX_SPEECHKIT_FOLDER_ID || process.env.YANDEX_FOLDER_ID || '';

function callYandexGPTTest(systemPrompt, userMessage, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      modelUri: `gpt://${YANDEX_FOLDER}/yandexgpt/latest`,
      completionOptions: { stream: true, temperature: 0.3, maxTokens: '200' },
      messages: [
        { role: 'system', text: systemPrompt },
        { role: 'user', text: userMessage }
      ]
    });

    const options = {
      hostname: 'llm.api.cloud.yandex.net', port: 443,
      path: '/foundationModels/v1/completion', method: 'POST',
      headers: {
        'Authorization': `Api-Key ${YANDEX_GPT_KEY}`,
        'x-folder-id': YANDEX_FOLDER,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const t0 = Date.now();
    let firstTokenMs = 0;
    let prevText = '';
    let responseText = '';
    let rawBuf = '';

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', c => errBody += c.toString());
        res.on('end', () => reject(new Error(`YandexGPT ${res.statusCode}: ${errBody.slice(0, 100)}`)));
        return;
      }
      res.on('data', (chunk) => {
        rawBuf += chunk.toString();
        const lines = rawBuf.split('\n');
        rawBuf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            const alts = data.result && data.result.alternatives;
            if (alts && alts[0] && alts[0].message && alts[0].message.text) {
              const fullText = alts[0].message.text;
              if (fullText !== prevText) {
                if (!firstTokenMs) firstTokenMs = Date.now() - t0;
                prevText = fullText;
                responseText = fullText;
              }
            }
          } catch (_) {}
        }
      });
      res.on('end', () => {
        if (rawBuf.trim()) {
          try {
            const data = JSON.parse(rawBuf.trim());
            const alts = data.result && data.result.alternatives;
            if (alts && alts[0] && alts[0].message && alts[0].message.text) {
              responseText = alts[0].message.text;
              if (!firstTokenMs) firstTokenMs = Date.now() - t0;
            }
          } catch (_) {}
        }
        resolve({ text: responseText, firstTokenMs: firstTokenMs || (Date.now() - t0), totalMs: Date.now() - t0 });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function validateAIResponse(fullText, scenario) {
  const issues = [];

  // 1. Has ---JSON--- separator
  if (!fullText.includes('---JSON---')) {
    issues.push('MISSING ---JSON--- separator');
  }

  const textPart = fullText.split('---JSON---')[0] || '';

  // 2. Digits in text (except year like 2024/2025/2026)
  const digitPattern = /\b\d{2,}\b/g;
  const digits = textPart.match(digitPattern) || [];
  const yearPattern = /^(19|20)\d{2}$/;
  const badDigits = digits.filter(d => !yearPattern.test(d));
  if (badDigits.length > 0) {
    issues.push(`DIGITS in text: ${badDigits.join(', ')}`);
  }

  // 3. Forbidden chars in spoken text
  const forbidden = ['%', '№', '$', '(', ')'];
  for (const ch of forbidden) {
    if (textPart.includes(ch)) issues.push(`FORBIDDEN char: "${ch}"`);
  }

  // 4. Max 4 sentences
  const sentences = textPart.split(/[.!?]+/).filter(s => s.trim());
  if (sentences.length > 4) {
    issues.push(`TOO LONG: ${sentences.length} sentences`);
  }

  // 5. Valid JSON part
  if (fullText.includes('---JSON---')) {
    const jsonStr = fullText.split('---JSON---')[1] || '';
    try {
      let cleaned = jsonStr.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      const data = JSON.parse(cleaned.trim());
      if (!['continue', 'route', 'record', 'hangup'].includes(data.action)) {
        issues.push(`INVALID action: ${data.action}`);
      }
    } catch (e) {
      issues.push(`INVALID JSON: ${e.message}`);
    }
  }

  return issues;
}

async function test_2_1_aiQuality() {
  console.log('\n  2.1 AI prompt quality (YandexGPT Pro)');

  let systemPrompt;
  try {
    const { VOICE_OPERATOR_SYSTEM, VOICE_OPERATOR_USER } = require(path.join(CRM_ROOT, 'src/prompts/voice-secretary-prompt'));
    const ctx = { employeeList: 'Хосе Александр — тендерный отдел\nИванова Анна — бухгалтерия', timeModeDesc: 'рабочее время', isInternal: false, clientName: null, timeMode: 'full', isFullWorkHours: true };
    systemPrompt = VOICE_OPERATOR_SYSTEM(ctx);
  } catch (e) {
    console.log(`    Cannot load prompt: ${e.message}`);
    return;
  }

  const scenarios = [
    { desc: 'Вопрос об услугах', msg: 'Здравствуйте, вы занимаетесь промывкой теплообменников?' },
    { desc: 'Вопрос о цене', msg: 'Сколько стоит промывка пластинчатого теплообменника?' },
    { desc: 'Технический вопрос', msg: 'Чем отличается CIP-промывка от гидродинамической?' },
    { desc: 'Тендер', msg: 'Мы проводим тендер на очистку теплообменников, хотим пригласить вас' },
    { desc: 'Рекламация', msg: 'У нас протечка после ваших работ на объекте в Химках' },
    { desc: 'Нерелевантный', msg: 'Вы занимаетесь ремонтом квартир?' },
    { desc: 'Агрессивный клиент', msg: 'Почему ваши рабочие не приехали вовремя, безобразие!' },
    { desc: 'Срочная задача', msg: 'Нам срочно нужна очистка, авария на заводе' },
    { desc: 'Простое алло', msg: 'Алло, вы здесь?' },
    { desc: 'Спам', msg: 'Здравствуйте, предлагаем рекламу в интернете для вашего бизнеса' },
  ];

  let okCount = 0;
  for (const s of scenarios) {
    try {
      const result = await callYandexGPTTest(systemPrompt, s.msg, 15000);
      const issues = validateAIResponse(result.text, s);

      if (issues.length === 0) {
        okCount++;
        totalTests++; passed++;
        if (VERBOSE) console.log(`    \x1b[32m✓\x1b[0m ${s.desc} (${result.firstTokenMs}ms) → ${result.text.split('---JSON---')[0].trim().slice(0, 60)}`);
      } else {
        totalTests++;
        // Digits and length are warnings, rest are failures
        const hardIssues = issues.filter(i => !i.startsWith('DIGITS') && !i.startsWith('TOO LONG'));
        if (hardIssues.length > 0) {
          failed++;
          failures.push(`2.1 ${s.desc}: ${hardIssues.join('; ')}`);
          console.log(`    \x1b[31m✗\x1b[0m ${s.desc}: ${hardIssues.join('; ')}`);
        } else {
          okCount++;
          passed++;
          warned++;
          warnings.push(`2.1 ${s.desc}: ${issues.join('; ')}`);
          console.log(`    \x1b[33m⚠\x1b[0m ${s.desc}: ${issues.join('; ')}`);
        }
      }
      if (VERBOSE) console.log(`       Full: ${result.text.slice(0, 150)}...`);
    } catch (e) {
      totalTests++; failed++;
      failures.push(`2.1 ${s.desc}: ERROR ${e.message}`);
      console.log(`    \x1b[31m✗\x1b[0m ${s.desc}: ${e.message}`);
    }
  }
  console.log(`    Result: ${okCount}/${scenarios.length}`);
}

async function test_2_2_latency() {
  console.log('\n  2.2 AI latency (YandexGPT Pro)');

  const SYSTEM = 'Ты секретарь компании. Отвечай кратко.';
  const prompts = [
    'Здравствуйте, мне нужен тендерный отдел',
    'Алло, а кто это?',
    'Я звоню по поводу рекламации',
  ];

  const latencies = [];
  for (const p of prompts) {
    try {
      const result = await callYandexGPTTest(SYSTEM, p, 10000);
      latencies.push(result.firstTokenMs);
      if (VERBOSE) console.log(`    ${p.slice(0, 40)}... → ft=${result.firstTokenMs}ms total=${result.totalMs}ms`);
    } catch (e) {
      console.log(`    \x1b[31m✗\x1b[0m ${p.slice(0, 40)}...: ${e.message}`);
    }
  }

  if (latencies.length > 0) {
    const avg = Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length);
    const max = Math.max(...latencies);

    totalTests++;
    if (avg < 2000) { passed++; console.log(`    \x1b[32m✓\x1b[0m Avg latency: ${avg}ms (< 2000ms)`); }
    else if (avg < 5000) { passed++; warned++; warnings.push(`Latency avg=${avg}ms`); console.log(`    \x1b[33m⚠\x1b[0m Avg latency: ${avg}ms (warn: > 2000ms)`); }
    else { failed++; failures.push(`Latency avg=${avg}ms > 5000ms`); console.log(`    \x1b[31m✗\x1b[0m Avg latency: ${avg}ms (FAIL: > 5000ms)`); }

    totalTests++;
    if (max < 3000) { passed++; console.log(`    \x1b[32m✓\x1b[0m Max latency: ${max}ms (< 3000ms)`); }
    else { warned++; warnings.push(`Max latency ${max}ms`); console.log(`    \x1b[33m⚠\x1b[0m Max latency: ${max}ms`); totalTests--; }
  }
}

async function test_2_3_fallbackCascade() {
  console.log('\n  2.3 Fallback cascade');

  // Test routerai.ru as fallback
  let aiProvider;
  try {
    aiProvider = require(path.join(CRM_ROOT, 'src/services/ai-provider'));
  } catch (e) {
    skip(`Cannot load ai-provider: ${e.message}`);
    return;
  }

  try {
    const t0 = Date.now();
    const response = await aiProvider.complete({
      system: 'Ты секретарь. Ответь одним предложением.',
      messages: [{ role: 'user', content: 'Алло?' }],
      maxTokens: 100, temperature: 0.3,
      model: 'google/gemini-2.5-flash-lite'
    });
    const ms = Date.now() - t0;
    const text = typeof response === 'string' ? response : (response.text || response.content || '');

    totalTests++;
    if (text && text.length > 5) {
      passed++;
      console.log(`    \x1b[32m✓\x1b[0m routerai/gemini fallback: ${ms}ms → "${text.slice(0, 60)}"`);
    } else {
      failed++;
      failures.push('Fallback routerai returned empty response');
      console.log(`    \x1b[31m✗\x1b[0m routerai fallback: empty response`);
    }
  } catch (e) {
    totalTests++;
    failed++;
    failures.push(`Fallback error: ${e.message}`);
    console.log(`    \x1b[31m✗\x1b[0m routerai fallback: ${e.message}`);
  }
}

/* ══════════════════════════════════════════════════════
   MAIN
   ══════════════════════════════════════════════════════ */

async function main() {
  const startTime = new Date();

  console.log('\n\x1b[1m╔══════════════════════════════════════════════════╗');
  console.log('║   ASGARD FREYA — VOICE AGENT TEST SUITE          ║');
  console.log(`║   ${startTime.toISOString().slice(0, 19).replace('T', ' ')}                       ║`);
  console.log('╠══════════════════════════════════════════════════╣\x1b[0m');

  // ── Module 1: Unit Tests ──
  console.log('\n\x1b[1m  MODULE 1: UNIT TESTS\x1b[0m');
  test_1_1_intentDetection();
  test_1_2_parseAIResponse();
  test_1_3_cachedIntents();
  test_1_4_helpers();

  const unitPassed = passed;
  const unitFailed = failed;
  const unitTotal = totalTests;

  // ── Module 2: AI Quality Tests ──
  if (UNIT_ONLY) {
    console.log('\n\x1b[36m  MODULE 2: SKIPPED (--unit-only)\x1b[0m');
  } else if (!YANDEX_GPT_KEY || !YANDEX_FOLDER) {
    console.log('\n\x1b[36m  MODULE 2: SKIPPED (no YANDEX_GPT_API_KEY)\x1b[0m');
  } else {
    console.log('\n\x1b[1m  MODULE 2: AI QUALITY TESTS\x1b[0m');
    await test_2_1_aiQuality();
    await test_2_2_latency();
    await test_2_3_fallbackCascade();
  }

  // ── Summary ──
  const duration = Date.now() - startTime.getTime();

  console.log('\n\x1b[1m╠══════════════════════════════════════════════════╣');
  console.log('║   RESULTS                                        ║');
  console.log('╠══════════════════════════════════════════════════╣\x1b[0m');
  console.log(`  Unit tests:     ${unitPassed}/${unitTotal} ${unitFailed === 0 ? '\x1b[32m✅\x1b[0m' : '\x1b[31m❌\x1b[0m'}`);
  if (!UNIT_ONLY && YANDEX_GPT_KEY) {
    console.log(`  AI tests:       ${passed - unitPassed}/${totalTests - unitTotal} ${failed - unitFailed === 0 ? '\x1b[32m✅\x1b[0m' : '\x1b[31m❌\x1b[0m'}`);
  }
  console.log(`  Total:          ${passed}/${totalTests} passed, ${failed} failed, ${warned} warnings, ${skipped} skipped`);
  console.log(`  Duration:       ${duration}ms`);

  if (failures.length > 0) {
    console.log('\n  \x1b[31mFAILURES:\x1b[0m');
    failures.forEach(f => console.log(`    ✗ ${f}`));
  }
  if (warnings.length > 0) {
    console.log('\n  \x1b[33mWARNINGS:\x1b[0m');
    warnings.forEach(w => console.log(`    ⚠ ${w}`));
  }

  const status = failed > 0 ? 'FAIL' : (warned > 0 ? 'WARN' : 'PASS');
  const statusColor = failed > 0 ? '\x1b[31m' : (warned > 0 ? '\x1b[33m' : '\x1b[32m');

  console.log(`\n\x1b[1m╠══════════════════════════════════════════════════╣`);
  console.log(`║   ${statusColor}${status}\x1b[0m\x1b[1m — ${passed}/${totalTests} (${Math.round(passed / totalTests * 100)}%)${' '.repeat(Math.max(0, 30 - status.length - String(passed).length - String(totalTests).length))}║`);
  console.log(`╚══════════════════════════════════════════════════╝\x1b[0m\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
