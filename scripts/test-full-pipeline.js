#!/usr/bin/env node
'use strict';

/**
 * ASGARD — Full Pipeline Benchmark
 * TTS(test phrase) → STT → YandexGPT Pro → TTS(response)
 * Measures each stage + total end-to-end latency
 */

const path = require('path');
const fs = require('fs');
const https = require('https');

const CRM_ROOT = path.resolve(__dirname, '..');
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

/* ── Config ── */
const YANDEX_API_KEY = process.env.YANDEX_SPEECHKIT_API_KEY || '';
const YANDEX_FOLDER_ID = process.env.YANDEX_SPEECHKIT_FOLDER_ID || process.env.YANDEX_FOLDER_ID || '';
const YANDEX_GPT_KEY = process.env.YANDEX_GPT_API_KEY || YANDEX_API_KEY;

console.log(`SpeechKit Key: ${YANDEX_API_KEY.slice(0, 8)}...`);
console.log(`GPT Key: ${YANDEX_GPT_KEY.slice(0, 8)}...`);
console.log(`Folder: ${YANDEX_FOLDER_ID}`);

/* ── gRPC ── */
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PROTO_DIR = path.resolve(CRM_ROOT, 'proto');

function loadProto(protoPath) {
  return protoLoader.loadSync(protoPath, {
    keepCase: false, longs: String, enums: String,
    defaults: true, oneofs: true,
    includeDirs: [PROTO_DIR]
  });
}

const sttPkgDef = loadProto(path.join(PROTO_DIR, 'yandex/cloud/ai/stt/v3/stt_service.proto'));
const sttProto = grpc.loadPackageDefinition(sttPkgDef);
const sttClient = new sttProto.speechkit.stt.v3.Recognizer(
  'stt.api.cloud.yandex.net:443', grpc.credentials.createSsl()
);

const ttsPkgDef = loadProto(path.join(PROTO_DIR, 'yandex/cloud/ai/tts/v3/tts_service.proto'));
const ttsProto = grpc.loadPackageDefinition(ttsPkgDef);
const ttsSynthesizer = new ttsProto.speechkit.tts.v3.Synthesizer(
  'tts.api.cloud.yandex.net:443', grpc.credentials.createSsl()
);

function sttMeta() {
  const md = new grpc.Metadata();
  md.add('authorization', `Api-Key ${YANDEX_API_KEY}`);
  md.add('x-folder-id', YANDEX_FOLDER_ID);
  return md;
}

/* ══════════════════════════════════════════
   STAGE 1: TTS — синтезируем тестовую фразу
   ══════════════════════════════════════════ */
function synthesize(text) {
  return new Promise((resolve, reject) => {
    const request = {
      text,
      outputAudioSpec: { rawAudio: { audioEncoding: 'LINEAR16_PCM', sampleRateHertz: 8000 } },
      hints: [{ voice: 'dasha' }, { role: 'friendly' }, { speed: 1.0 }],
      loudnessNormalizationType: 'LUFS'
    };
    const chunks = [];
    const call = ttsSynthesizer.utteranceSynthesis(request, sttMeta());
    call.on('data', (r) => { if (r.audioChunk && r.audioChunk.data) chunks.push(Buffer.from(r.audioChunk.data)); });
    call.on('end', () => resolve(Buffer.concat(chunks)));
    call.on('error', reject);
    setTimeout(() => { call.cancel(); reject(new Error('TTS timeout')); }, 15000);
  });
}

/* ══════════════════════════════════════════
   STAGE 2: STT — распознаём аудио
   ══════════════════════════════════════════ */
function recognize(pcmBuffer) {
  return new Promise((resolve, reject) => {
    const stream = sttClient.recognizeStreaming(sttMeta());
    let result = '';
    let firstTextMs = 0;
    const t0 = Date.now();

    stream.write({
      sessionOptions: {
        recognitionModel: {
          model: 'general',
          audioFormat: { rawAudio: { audioEncoding: 'LINEAR16_PCM', sampleRateHertz: 8000, audioChannelCount: 1 } },
          textNormalization: { textNormalization: 'TEXT_NORMALIZATION_ENABLED', profanityFilter: false },
          languageRestriction: { restrictionType: 'WHITELIST', languageCode: ['ru-RU'] },
          audioProcessingType: 'FULL_DATA'
        }
      }
    });

    stream.on('data', (response) => {
      if (response.partial) {
        const alts = response.partial.alternatives || [];
        if (alts[0] && alts[0].text) {
          if (!firstTextMs) firstTextMs = Date.now() - t0;
          result = alts[0].text;
        }
      }
      if (response.final) {
        const alts = response.final.alternatives || [];
        if (alts[0] && alts[0].text) result = alts[0].text;
      }
      if (response.finalRefinement) {
        const alts = response.finalRefinement.normalizedText && response.finalRefinement.normalizedText.alternatives;
        if (alts && alts[0] && alts[0].text) result = alts[0].text;
      }
    });

    stream.on('end', () => resolve({ text: result, firstTextMs }));
    stream.on('error', reject);

    // Send audio in chunks (simulate real-time, but faster)
    const CHUNK_SIZE = 3200; // 200ms worth
    let offset = 0;
    function sendChunk() {
      if (offset >= pcmBuffer.length) {
        stream.end();
        return;
      }
      const chunk = pcmBuffer.slice(offset, Math.min(offset + CHUNK_SIZE, pcmBuffer.length));
      stream.write({ chunk: { data: chunk } });
      offset += CHUNK_SIZE;
      setTimeout(sendChunk, 10); // fast send, not real-time pacing
    }
    sendChunk();

    setTimeout(() => reject(new Error('STT timeout')), 15000);
  });
}

/* ══════════════════════════════════════════
   STAGE 3: YandexGPT Pro — streaming AI
   ══════════════════════════════════════════ */
function callYandexGPT(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      modelUri: `gpt://${YANDEX_FOLDER_ID}/yandexgpt/latest`,
      completionOptions: { stream: true, temperature: 0.3, maxTokens: '200' },
      messages: [
        { role: 'system', text: systemPrompt },
        { role: 'user', text: userMessage }
      ]
    });

    const options = {
      hostname: 'llm.api.cloud.yandex.net',
      port: 443,
      path: '/foundationModels/v1/completion',
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${YANDEX_GPT_KEY}`,
        'x-folder-id': YANDEX_FOLDER_ID,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const t0 = Date.now();
    let firstTokenMs = 0;
    let prevText = '';
    let responseText = '';
    let updates = 0;
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
                updates++;
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
        resolve({ text: responseText, firstTokenMs: firstTokenMs || (Date.now() - t0), totalMs: Date.now() - t0, updates });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('GPT timeout')); });
    req.write(body);
    req.end();
  });
}

/* ══════════════════════════════════════════
   STAGE 4: TTS — озвучиваем ответ (streaming)
   ══════════════════════════════════════════ */
function synthesizeStreaming(text) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let firstAudioMs = 0;
    let totalBytes = 0;

    const call = ttsSynthesizer.streamSynthesis(sttMeta());

    call.write({
      options: {
        voice: 'dasha', role: 'friendly', speed: 1.0,
        outputAudioSpec: { rawAudio: { audioEncoding: 'LINEAR16_PCM', sampleRateHertz: 8000 } },
        loudnessNormalizationType: 'LUFS'
      }
    });

    call.write({ synthesisInput: { text } });
    call.write({ forceSynthesis: {} });
    call.end();

    call.on('data', (r) => {
      if (r.audioChunk && r.audioChunk.data) {
        if (!firstAudioMs) firstAudioMs = Date.now() - t0;
        totalBytes += r.audioChunk.data.length;
      }
    });

    call.on('end', () => {
      resolve({ firstAudioMs: firstAudioMs || (Date.now() - t0), totalMs: Date.now() - t0, totalBytes });
    });

    call.on('error', reject);
    setTimeout(() => reject(new Error('TTS stream timeout')), 15000);
  });
}

/* ══════════════════════════════════════════
   MAIN — Full Pipeline Test
   ══════════════════════════════════════════ */
const SYSTEM = 'Ты секретарь компании Асгард Сервис по имени Фрейя. Отвечай кратко 1-2 предложения на русском. Если клиент просит конкретный отдел - скажи что соединяешь.';

const TEST_PHRASES = [
  // ── ЛЁГКИЕ (короткие, быстрые) ──
  { text: 'Здравствуйте',                              tag: 'EASY' },
  { text: 'Алло',                                      tag: 'EASY' },
  { text: 'Мне нужна бухгалтерия',                     tag: 'EASY' },
  { text: 'Соедините с тендерным отделом',              tag: 'EASY' },

  // ── СРЕДНИЕ (конкретные вопросы) ──
  { text: 'Здравствуйте, я хотел бы узнать статус оплаты по нашему договору номер сто двадцать три', tag: 'MED' },
  { text: 'Добрый день, подскажите, занимаетесь ли вы промывкой теплообменников?',                   tag: 'MED' },
  { text: 'Мне нужно поговорить с кем-нибудь по поводу рекламации, оборудование не работает',        tag: 'MED' },
  { text: 'А вы можете выслать коммерческое предложение на промывку котла?',                          tag: 'MED' },

  // ── СЛОЖНЫЕ (длинные, контекстные) ──
  { text: 'Послушайте, мы заказывали у вас промывку системы отопления в прошлом году, сейчас опять батареи холодные, нужно повторить, когда вы можете приехать и сколько это будет стоить?', tag: 'HARD' },
  { text: 'У нас объект на Ленинградском шоссе, нужна химическая промывка теплообменника и замена уплотнений, объём работ большой, хотим обсудить сроки и стоимость',                     tag: 'HARD' },

  // ── СПАМ ──
  { text: 'Здравствуйте, хотим предложить вам продвижение сайта в топ Яндекса, у нас выгодные условия', tag: 'SPAM' },
  { text: 'Добрый день, вас беспокоят из компании Кредит Плюс, хотим предложить выгодный кредит для бизнеса', tag: 'SPAM' },
  { text: 'Мы проводим бесплатный вебинар по увеличению продаж, хотите зарегистрироваться?',               tag: 'SPAM' },
];

async function runTest(item) {
  const phrase = typeof item === 'string' ? item : item.text;
  const tag = typeof item === 'string' ? '' : item.tag;
  const tagStr = tag ? ` [${tag}]` : '';

  console.log(`\n${'─'.repeat(80)}`);
  console.log(`TEST${tagStr}: "${phrase}"`);
  console.log(`${'─'.repeat(80)}`);

  const T_START = Date.now();

  // Stage 1: TTS — синтезируем фразу клиента
  const t1 = Date.now();
  const clientAudio = await synthesize(phrase);
  const stage1ms = Date.now() - t1;
  const audioDuration = Math.round(clientAudio.length / 2 / 8000 * 1000);
  console.log(`  [1] TTS (клиент):  ${stage1ms}ms → ${clientAudio.length} bytes (${audioDuration}ms audio)`);

  // Stage 2: STT — распознаём
  const t2 = Date.now();
  const sttResult = await recognize(clientAudio);
  const stage2ms = Date.now() - t2;
  console.log(`  [2] STT:           ${stage2ms}ms → "${sttResult.text}" (first_text=${sttResult.firstTextMs}ms)`);

  // Stage 3: AI — YandexGPT Pro
  const t3 = Date.now();
  const aiResult = await callYandexGPT(SYSTEM, sttResult.text || phrase);
  const stage3ms = Date.now() - t3;
  const aiShort = aiResult.text.replace(/\n/g, ' ').slice(0, 80);
  console.log(`  [3] AI (GPT Pro):  ${stage3ms}ms → "${aiShort}" (ft=${aiResult.firstTokenMs}ms, upd=${aiResult.updates})`);

  // Stage 4: TTS — озвучиваем ответ (только речевую часть, без JSON)
  const spokenPart = aiResult.text.split('---JSON---')[0].trim();
  const t4 = Date.now();
  const ttsResult = await synthesizeStreaming(spokenPart || aiResult.text);
  const stage4ms = Date.now() - t4;
  const respDuration = Math.round(ttsResult.totalBytes / 2 / 8000 * 1000);
  console.log(`  [4] TTS (ответ):   ${stage4ms}ms → ${ttsResult.totalBytes} bytes (${respDuration}ms audio, first_audio=${ttsResult.firstAudioMs}ms)`);

  const TOTAL = Date.now() - T_START;
  const realLatency = sttResult.firstTextMs + aiResult.firstTokenMs + ttsResult.firstAudioMs;

  console.log(`\n  TOTAL sequential:  ${TOTAL}ms`);
  console.log(`  REAL latency:      ~${realLatency}ms (STT=${sttResult.firstTextMs} + AI_ft=${aiResult.firstTokenMs} + TTS_fa=${ttsResult.firstAudioMs})`);

  return { phrase, tag, stage1ms, stage2ms, stage3ms, stage4ms, total: TOTAL, realLatency, sttText: sttResult.text, aiText: aiResult.text, aiFirstToken: aiResult.firstTokenMs, ttsFirstAudio: ttsResult.firstAudioMs };
}

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('  ASGARD Full Pipeline Benchmark');
  console.log('  TTS(client) → STT → YandexGPT Pro → TTS(response)');
  console.log('═'.repeat(80));

  const results = [];
  for (const phrase of TEST_PHRASES) {
    try {
      const r = await runTest(phrase);
      results.push(r);
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
    }
  }

  // Summary
  if (results.length > 0) {
    console.log(`\n${'═'.repeat(80)}`);
    console.log('  ИТОГО — ОБЩАЯ СВОДКА');
    console.log('═'.repeat(80));

    function avg(arr, fn) { return arr.length ? Math.round(arr.reduce((s, r) => s + fn(r), 0) / arr.length) : 0; }
    function printGroup(label, group) {
      if (!group.length) return;
      console.log(`\n  ── ${label} (${group.length} тестов) ──`);
      console.log(`  Avg REAL latency:  ${avg(group, r=>r.realLatency)}ms`);
      console.log(`  Avg STT:           ${avg(group, r=>r.stage2ms)}ms`);
      console.log(`  Avg AI first_tok:  ${avg(group, r=>r.aiFirstToken)}ms | total: ${avg(group, r=>r.stage3ms)}ms`);
      console.log(`  Avg TTS first_aud: ${avg(group, r=>r.ttsFirstAudio)}ms | total: ${avg(group, r=>r.stage4ms)}ms`);
    }

    const tags = ['EASY', 'MED', 'HARD', 'SPAM'];
    for (const t of tags) {
      printGroup(t, results.filter(r => r.tag === t));
    }
    printGroup('ALL', results);

    const a = avg(results, r=>r.stage2ms);
    const b = avg(results, r=>r.aiFirstToken);
    const c = avg(results, r=>r.ttsFirstAudio);
    console.log(`\n  Pipeline:  Речь → [${a}ms STT] → [${b}ms AI ft] → [${c}ms TTS fa] → Звук`);
    console.log(`  Средняя задержка: ~${a+b+c}ms`);

    // Таблица по каждому тесту
    console.log(`\n  ── ДЕТАЛИ ──`);
    console.log(`  ${'#'.padEnd(3)} ${'TAG'.padEnd(5)} ${'REAL'.padStart(6)} ${'STT'.padStart(6)} ${'AI_ft'.padStart(6)} ${'TTS_fa'.padStart(6)} ${'TOTAL'.padStart(7)}  PHRASE`);
    results.forEach((r, i) => {
      console.log(`  ${String(i+1).padEnd(3)} ${(r.tag||'-').padEnd(5)} ${String(r.realLatency+'ms').padStart(6)} ${String(r.stage2ms+'ms').padStart(6)} ${String(r.aiFirstToken+'ms').padStart(6)} ${String(r.ttsFirstAudio+'ms').padStart(6)} ${String(r.total+'ms').padStart(7)}  ${r.phrase.slice(0,50)}`);
    });
  }

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
