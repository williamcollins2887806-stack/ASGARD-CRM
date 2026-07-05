/**
 * ASGARD CRM — Mimir Conductor: ядро agent loop (Сессия 6b — нативный tool-use)
 * ═══════════════════════════════════════════════════════════════════════════
 * Главный мозг просчёта. Запускается в фоне после POST /conductor/start.
 *
 * НАТИВНЫЙ TOOL-USE LOOP (Сессия 6b): Conductor сам решает каких агентов и в
 * каком порядке вызывать. На каждой итерации completeWithStream({tools}) возвращает
 * tool_uses; conductor.js их исполняет (executeTool), возвращает tool_results в
 * историю и продолжает loop, пока модель не вызовет emit_final_estimate.
 *
 *  • STUB (dev, по умолчанию): completeWithStream отдаёт детерминированный сценарий
 *    tool_uses (generateStubToolUses) — баланс не тратится. Логика loop одна и та же.
 *  • LIVE (живые ключи): реальный Claude через routerai сам выбирает инструменты.
 *
 * Hard-rules остаются ТОЛЬКО safety floor: canFinalize() проверяет полноту перед
 * emit_final_estimate. Они НЕ оркеструют вызовы — это делает Conductor.
 *
 * Fallback: при process.env.MIMIR_FORCE_DETERMINISTIC=true используется старый
 * детерминированный путь Сессии 2 (для дебага). UI/SSE одинаков в обоих режимах.
 *
 * Стейт живёт в БД (mimir_conductor_runs / agent_runs / artifacts / events),
 * переживает рестарты. Async: при ask_customer(blocking) run переходит в
 * BLOCKED_BY_CUSTOMER и Conductor завершает фоновую работу (продолжится позже).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../db');
const aiProvider = require('../ai-provider');
const cr = require('./conductor-run');
const { REGISTRY } = require('./agents-registry');
const hardRules = require('./hard-rules');
const { callAgent, executeTool, buildToolSchemas } = require('./tool-executor');
const { buildConductorSystemPrompt } = require('./prompts/conductor');
const { pickConductorModel } = require('./models-config');

const MAX_ITERATIONS = 30;
const MAX_RUN_COST_RUB = 800; // потолок стоимости одного просчёта (Сессия 6b)

// Опус-фикс 19.06.2026: per-agent timeout. Без него зависающий агент
// (например, work_scope_researcher с web-plugin) держит весь Conductor-loop
// и упирается в семафор RUN_SEMAPHORE — другие РП ждут вечно. По умолчанию
// 5 минут на агента; override через env AGENT_TIMEOUT_MS.
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || 5 * 60 * 1000);

/**
 * Обернуть вызов агента в Promise.race с таймаутом.
 * При срабатывании таймаута reject с понятным сообщением; вызывающий код
 * (executeTool / callAgent) уже умеет писать ERROR в БД через finishAgentRun
 * и эмитить событие в War Room.
 *
 * Поскольку Promise.race не «убивает» подвисшую промизу, фактически агент
 * продолжит крутить AI-запросы в фоне до своего внутреннего таймаута —
 * это не идеально, но (а) разблокирует Conductor-loop и семафор немедленно,
 * (б) промеж-таймауты на attempt в work_scope_researcher (3 мин на попытку)
 * гарантируют что фоновая работа всё равно ограничена.
 */
async function runAgentWithTimeout(agentFn, agentName) {
  let timeoutId = null;
  const minutes = Math.round(AGENT_TIMEOUT_MS / 1000 / 60);
  try {
    return await Promise.race([
      agentFn(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`agent_timeout_${minutes}min_${agentName}`)),
          AGENT_TIMEOUT_MS
        );
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// Опус-логирование (19.06.2026): какой агент был последним вызван по этому
// run-id. Память процесса; при рестарте сбрасывается — это ОК, в БД остаются
// уже записанные next_step события.
const _lastAgentName = new Map();

// Sliding-window для conductor messages (tool-use loop может раздуться на
// MAX_ITERATIONS=30 шагах с большими tool_result'ами). Лимит совпадает с Quick.
const { _applySlidingWindow: applyConductorSlidingWindow } = require('../mimir-tkp-quick');

/**
 * Sliding-window для Conductor messages с защитой пары tool_use ↔ tool_result.
 * Anthropic-формат: каждый assistant tool_use ОБЯЗАН иметь следующий user tool_result.
 * Если обрезать посередине пары — модель упадёт с 400 «tool_use without tool_result».
 * Поэтому: применяем стандартный sliding-window, но если первый kept-msg = user
 * tool_result без предшествующего tool_use в kept — отрезаем и его (и так до
 * выравнивания). Минимум сохраняем последнюю пару assistant→user.
 */
function _slideConductorMessages(messages, runId) {
  const initial = applyConductorSlidingWindow(messages, `conductor:run-${runId}`);
  if (initial.length === messages.length) return initial; // не отрезалось
  // Выравниваем: убираем ведущие user-tool_result, у которых нет соответствующего assistant
  let kept = initial.slice();
  while (kept.length > 0) {
    const head = kept[0];
    if (head.role === 'user' && Array.isArray(head.content)
        && head.content.some(c => c && c.type === 'tool_result')) {
      kept.shift();
      continue;
    }
    break;
  }
  // Если совсем зачистили — оставляем последние 2 msgs (safety)
  if (kept.length === 0 && messages.length >= 2) {
    kept = messages.slice(-2);
  }
  return kept;
}

/**
 * Fire-and-forget событие в War Room: не блокируем loop, но потерянный промис
 * при ошибке логируем (раньше addEvent вызывался без await и .catch — fix #6).
 */
function emitEvent(runId, agentRunId, type, payload) {
  Promise.resolve(cr.addEvent(runId, agentRunId, type, payload)).catch((err) => {
    console.warn(`[conductor] addEvent(${type}) failed for run ${runId}: ${err.message}`);
  });
}

/**
 * Собрать стартовый контекст: работа + метаданные документов.
 */
async function buildInitialContext(run) {
  let work = {};
  let documents = [];
  if (run.work_id) {
    const wr = await db.query(
      `SELECT id, work_title, customer_name, customer_inn, object_name, object_address,
              city, address, start_plan, end_plan, contract_value, tender_id, estimate_id, pm_id
       FROM works WHERE id = $1`,
      [run.work_id]
    );
    work = wr.rows[0] || {};
    // Метаданные документов работы/тендера (без содержимого — его читает парсер)
    try {
      const dr = await db.query(
        `SELECT id, file_name, file_type FROM documents
         WHERE (work_id = $1 OR tender_id = $2) AND (deleted_at IS NULL)
         ORDER BY id ASC LIMIT 200`,
        [run.work_id, work.tender_id || run.tender_id || null]
      );
      documents = dr.rows;
    } catch (_) { documents = []; }
  }

  const contractValue = run.contract_value != null
    ? Number(run.contract_value)
    : (work.contract_value != null ? Number(work.contract_value) : 0);

  return { work, documents, contract_value: contractValue };
}

/**
 * Грубая классификация сложности по tz_summary и контексту.
 * В Сессии 2 — простые эвристики; реальная классификация — в сессии 4.
 */
function classifyComplexity(tzSummary, ctx, runFlags = {}) {
  const flags = { ...(runFlags || {}) };
  const v = Number(ctx.contract_value) || 0;
  if (v >= 1000000) flags.risk_medium_plus = true;
  if ((ctx.documents || []).length > 0 && flags.has_drawings == null) {
    flags.has_drawings = (ctx.documents || []).some((d) => /чертеж|drawing|\.dwg/i.test(d.file_name || ''));
  }
  // tz_summary-сигналы (когда агент уже отработал и вернул содержимое)
  const s = tzSummary || {};
  if (s.has_volumes != null) flags.has_volumes = s.has_volumes;
  if (s.method) flags.method = s.method;
  return flags;
}

/**
 * Финализация просчёта.
 */
async function finalizeRun(runId, input = {}) {
  const finalData = {
    summary: input.executive_summary || input.summary || null,
    decision_reasoning: input.decision_reasoning || null,
    recommendation: input.recommendation || 'THINK',
    key_assumptions: input.key_assumptions || []
  };
  emitEvent(runId, null, 'final_estimate', finalData);
  await cr.updateRunStatus(runId, 'READY_FOR_REVIEW', { finalEstimateData: finalData, completedAt: true });

  // Генерация смета.xlsx + отчёт.docx после успешной финализации.
  // Изолировано try/catch: ошибки артефактов не должны откатывать финал прогона.
  try {
    await _generateConductorArtifacts(runId, finalData);
  } catch (e) {
    console.warn(`[conductor] generateArtifacts failed for run ${runId}: ${e.message}`);
    emitEvent(runId, null, 'warning', { text: `Артефакты не сгенерировались: ${e.message}` });
  }
}

/**
 * Сгенерировать смета.xlsx + отчёт.docx для финализированного Conductor-run
 * и сохранить в pre_tender_requests.manual_documents / works.manual_documents /
 * tenders.manual_documents.
 *
 * @param {number} runId
 * @param {Object} finalData — { summary, decision_reasoning, recommendation, key_assumptions }
 */
async function _generateConductorArtifacts(runId, finalData) {
  const docGen = require('../document-generator');
  const run = await cr.getRun(runId);
  if (!run) return;

  // Артефакт final_estimate содержит ssr/analysis/assumptions/warnings (см. final_consolidator.run).
  const finalArt = await cr.getArtifact(runId, 'final_estimate');
  const finalEstimate = (finalArt && finalArt.content) || {};
  const ssr = finalEstimate.ssr || {};
  const analysisObj = finalEstimate.analysis || {};

  // ════════════════════════════════════════════════════════════════════════
  // Опус-фикс 20.06.2026: fallback из отдельных артефактов Conductor.
  // Раньше Generator получал только ssr — если final_consolidator не положил
  // calculation/estimate в ssr (а это **типичный** случай для текущей версии
  // агента), смета выходила пустой. Теперь читаем labor_cost / consumables /
  // travel_cost / routing_plan / crew_plan / indirects напрямую и собираем
  // calculation.* массивы для Generator.
  // ════════════════════════════════════════════════════════════════════════
  const _safeArt = async (type) => {
    try {
      const a = await cr.getArtifact(runId, type);
      return (a && a.content) || null;
    } catch (_) { return null; }
  };
  const laborArt        = await _safeArt('labor_cost');
  const consumablesArt  = await _safeArt('consumables');
  const travelArt       = await _safeArt('travel_cost');
  const routingArt      = await _safeArt('routing_plan');
  const crewArt         = await _safeArt('crew_plan');
  const indirectsArt    = await _safeArt('indirects');
  const ratesArt        = await _safeArt('rates_research');
  const siteArt         = await _safeArt('site_conditions');

  // Разложить crew_plan.crew (массив сотрудников) по ролям для согласованности отчёта со сметой.
  // Раньше отчёт показывал «0 мастеров, 0 рабочих, 1 ИТР» хотя в смете A. Персонал был 6 строк.
  const _crewBreakdown = (() => {
    const roles = { itr: 0, foremen: 0, workers: 0, observers: 0 };
    if (crewArt && Array.isArray(crewArt.crew)) {
      crewArt.crew.forEach(p => {
        const r = String(p.role || p.position || '').toLowerCase();
        if (/итр|итп|руководит|инженер|рп\b/i.test(r)) roles.itr++;
        else if (/мастер|бригадир|foreman/i.test(r)) roles.foremen++;
        else if (/наблюдающ|спасат|observer|safety/i.test(r)) roles.observers++;
        else roles.workers++;
      });
    } else if (laborArt && Array.isArray(laborArt.personnel)) {
      laborArt.personnel.forEach(p => {
        const name = String(p.role || p.item || p.name || '').toLowerCase();
        const qty = Number(p.count || p.qty || 1);
        if (/итр|итп|руководит|инженер|рп\b/i.test(name)) roles.itr += qty;
        else if (/мастер|бригадир|foreman/i.test(name)) roles.foremen += qty;
        else if (/наблюдающ|спасат|observer|safety/i.test(name)) roles.observers += qty;
        else if (/рабоч|слесар|помощ|worker|сварщ/i.test(name)) roles.workers += qty;
      });
    }
    return roles;
  })();

  // Сборка estimate (work_days/road_days/crew_count/shifts) с приоритетом:
  // ssr.estimate → labor_cost → crew_plan → дефолты.
  // ВАЖНО (20.06.2026): НЕ подставлять finalData.summary в title — это полный текст
  // executive summary (200+ символов), который ломает шапку сметы. Title должен быть
  // коротким человеческим названием. Если ssr.estimate.title нет — оставляем null,
  // Generator подхватит project.subject (work_description) и пропустит через _shortenTitle.
  const fbEstimate = {
    title: (ssr.estimate && ssr.estimate.title) || null,
    site_category: (ssr.estimate && ssr.estimate.site_category) || ssr.site_category || (siteArt && siteArt.site_category) || null,
    crew_count: (ssr.estimate && ssr.estimate.crew_count) || ssr.crew_count || ssr.crew_size
              || (crewArt && (crewArt.total_count || (Array.isArray(crewArt.crew) && crewArt.crew.length) || crewArt.workers)) || null,
    workers_per_shift: (ssr.estimate && ssr.estimate.workers_per_shift)
              || (crewArt && (crewArt.workers || crewArt.helpers)) || _crewBreakdown.workers || null,
    foremen_per_shift: (ssr.estimate && ssr.estimate.foremen_per_shift)
              || (crewArt && crewArt.foremen) || _crewBreakdown.foremen || null,
    // Поля для отчёта (директорский отчёт берёт их в section_2_text «Режим работы и бригада»).
    itr_count: _crewBreakdown.itr || 1,
    foremen_count: _crewBreakdown.foremen,
    workers_count: _crewBreakdown.workers,
    observers_count: _crewBreakdown.observers,
    work_days: (ssr.estimate && ssr.estimate.work_days) || ssr.work_days
              || (laborArt && laborArt.work_days) || null,
    road_days: (ssr.estimate && ssr.estimate.road_days) || ssr.road_days
              || (laborArt && laborArt.road_days) || null,
    mob_days: (ssr.estimate && ssr.estimate.mob_days) || ssr.mob_days
              || (laborArt && laborArt.mob_days) || null,
    markup_multiplier: (ssr.estimate && ssr.estimate.markup_multiplier) || ssr.markup_multiplier
              || (ratesArt && ratesArt.markup_multiplier) || null,
    shifts_per_day: (ssr.estimate && ssr.estimate.shifts_per_day) || ssr.shifts_per_day
              || (crewArt && crewArt.shifts) || null
  };

  // Сборка calculation.* массивов с приоритетом: ssr.calculation → артефакты → []
  const fbCalculation = ssr.calculation && Object.keys(ssr.calculation).length ? ssr.calculation : {};
  if (!fbCalculation.personnel && laborArt && Array.isArray(laborArt.personnel) && laborArt.personnel.length) {
    fbCalculation.personnel = laborArt.personnel;
  }
  if (!fbCalculation.current_costs && consumablesArt && Array.isArray(consumablesArt.items) && consumablesArt.items.length) {
    fbCalculation.current_costs = consumablesArt.items;
  }
  if (!fbCalculation.travel && travelArt && Array.isArray(travelArt.legs) && travelArt.legs.length) {
    fbCalculation.travel = travelArt.legs;
  }
  if (!fbCalculation.transport && routingArt && Array.isArray(routingArt.legs) && routingArt.legs.length) {
    // routing_plan.legs — это {to, from, who, road_days, transport, distance_km} per человек.
    // Сгруппируем по {from, to} в строки доставок с qty=count.
    const grouped = new Map();
    routingArt.legs.forEach((leg) => {
      const k = `${leg.from || ''}→${leg.to || ''}|${leg.transport || ''}`;
      const prev = grouped.get(k) || { name: `Доставка ${leg.from || ''}→${leg.to || ''} (${leg.transport || 'транспорт'})`, qty: 0, unit: 'чел', price: 0 };
      prev.qty += 1;
      grouped.set(k, prev);
    });
    if (grouped.size) fbCalculation.transport = Array.from(grouped.values());
  }

  // Сборка totals — приоритет ssr.totals → собрать из артефактов → собрать из массивов calculation.
  // 21.06.2026 (фикс расхождения смета/отчёт): отчёт показывал «Себестоимость 0,00 млн ₽» даже
  // когда смета содержала реальные позиции, потому что ssr.totals и labor_cost.subtotal_fot
  // оставались 0. Теперь, если артефактные subtotal'ы пустые, СУММИРУЕМ ПО САМИМ МАССИВАМ
  // calculation.* (теми же что Generator кладёт в смету). Это гарантирует что отчёт всегда
  // согласован со сметой — оба используют одни и те же числа.
  const fbTotals = ssr.totals || {};
  if (!fbTotals.total_cost && !fbTotals.cost_no_vat) {
    const _sumArr = (arr) => Array.isArray(arr)
      ? arr.reduce((s, x) => s + (Number(x && (x.total || x.amount || x.sum)) || (Number(x && (x.qty || x.count || x.days)) || 1) * (Number(x && (x.price || x.rate || x.rate_per_day)) || 0)), 0)
      : 0;
    let fotSubtotal = (laborArt && laborArt.subtotal_fot) || 0;
    if (!fotSubtotal) fotSubtotal = _sumArr(fbCalculation.personnel);
    let currentTotal = _sumArr(fbCalculation.current_costs);
    let consumablesTotal = (consumablesArt && consumablesArt.total_consumables) || 0;
    if (!consumablesTotal) consumablesTotal = _sumArr(fbCalculation.chemistry);
    let travelTotal = (travelArt && travelArt.total_travel) || 0;
    if (!travelTotal) travelTotal = _sumArr(fbCalculation.travel);
    const transportTotal = _sumArr(fbCalculation.transport);
    const directSum = fotSubtotal + currentTotal + consumablesTotal + travelTotal + transportTotal;
    // Налог на ФОТ (~30%), накладные (15%), непредвиденные (12%) — стандартные нормативы Асгарда.
    const fotTax = fotSubtotal * 0.30;
    const overhead = (directSum + fotTax) * 0.15;
    const contingency = (directSum + fotTax + overhead) * 0.12;
    const costNoVat = directSum + fotTax + overhead + contingency;
    if (costNoVat > 0) {
      fbTotals.total_cost = costNoVat;
      fbTotals.cost_no_vat = costNoVat;
      const markup = fbEstimate.markup_multiplier || 2.2;
      const vat = (ssr.vat_pct || (indirectsArt && indirectsArt.vat_pct) || 22) / 100;
      fbTotals.total_with_vat = costNoVat * markup * (1 + vat);
      fbTotals.vat_pct = (ssr.vat_pct || (indirectsArt && indirectsArt.vat_pct) || 22);
      fbTotals.markup_multiplier = markup;
      // Детализация для отчёта (видно ИЗ ЧЕГО состоит cost)
      fbTotals.personnel_subtotal = fotSubtotal;
      fbTotals.current_subtotal = currentTotal;
      fbTotals.travel_subtotal = travelTotal;
      fbTotals.transport_subtotal = transportTotal;
      fbTotals.chemistry_subtotal = consumablesTotal;
      fbTotals.fot_tax = fotTax;
      fbTotals.overhead = overhead;
      fbTotals.contingency = contingency;
    }
  }

  const recomputedLike = {
    estimate: fbEstimate,
    calculation: fbCalculation,
    totals: fbTotals,
    settings: ssr.settings || {},
    analysis: {
      assumptions: finalEstimate.assumptions || [],
      warnings: finalEstimate.warnings || [],
      summary: finalData.summary || null,
      recommendation: finalData.recommendation || analysisObj.recommendation || null,
      decision_reasoning: finalData.decision_reasoning || analysisObj.decision_reasoning || null,
      key_risks: analysisObj.key_risks || [],
      recommendations: finalEstimate.key_findings || []
    }
  };

  // Достаём work / tender / pre_tender — для project и customer.
  let work = {};
  let tender = null;
  let preTender = null;
  let preTenderId = null;
  try {
    if (run.work_id) {
      const wr = await db.query(
        `SELECT id, work_title, customer_name, customer_inn, object_name, object_address,
                address, start_plan, end_plan, contract_value, tender_id, pm_id
           FROM works WHERE id = $1`,
        [run.work_id]
      );
      work = wr.rows[0] || {};
    }
    if (work.tender_id || run.tender_id) {
      try {
        const tr = await db.query(
          `SELECT id, tender_title, customer_name, customer_inn FROM tenders WHERE id = $1`,
          [work.tender_id || run.tender_id]
        );
        tender = tr.rows[0] || null;
      } catch (_) { /* ok */ }
    }
    const cf = run.complexity_flags || {};
    // 20.06.2026: поддерживаем разные имена ключей в complexity_flags.
    // Test-conductor.js кладёт { entity_kind: 'pre_tender', entity_id: 968 }, а старый
    // код искал только cf.pre_tender_id — поэтому preTender не подгружался → title не находил.
    preTenderId = cf.pre_tender_id || cf.preTenderId
                || (cf.entity_kind === 'pre_tender' && cf.entity_id ? Number(cf.entity_id) : null)
                || null;
    if (!preTenderId && run.tender_id) {
      try {
        const r = await db.query(
          'SELECT id FROM pre_tender_requests WHERE created_tender_id = $1 LIMIT 1',
          [run.tender_id]
        );
        if (r.rows[0]) preTenderId = Number(r.rows[0].id);
      } catch (_) { /* ok */ }
    }
    if (preTenderId) {
      try {
        // 20.06.2026 фикс: pt.author_id не существует. Реальные — assigned_to (РП) и created_by.
        const r = await db.query(
          `SELECT id, customer_name, customer_inn, contact_person, work_description,
                  work_location, work_deadline,
                  COALESCE(assigned_to, created_by) AS author_id
             FROM pre_tender_requests WHERE id = $1`,
          [preTenderId]
        );
        preTender = r.rows[0] || null;
      } catch (e) {
        console.warn('[conductor] preTender SELECT failed:', e.message);
      }
    }
  } catch (e) {
    console.warn(`[conductor] не удалось подгрузить контекст для артефактов run ${runId}: ${e.message}`);
  }

  // 21.06.2026 фикс: если Conductor НИЧЕГО не нашёл (все артефакты blocked, totals.total_cost=0),
  // используем Quick estimate из той же pre_tender как baseline. Гарантирует что отчёт получит
  // реальные числа и согласован со сметой. preTenderId уже определён выше.
  //
  // 21.06.2026 (v2): чтобы СМЕТА и ОТЧЁТ показывали ОДИНАКОВЫЕ числа, не только totals
  // (это попадает в отчёт), но и calculation.* секции (это попадает в смету как позиции).
  // Если у Conductor сумма позиций < Quick total_cost — добавляем corrector-позиции
  // в каждую секцию, чтобы итог сметы = Quick total.
  if (!recomputedLike.totals.total_cost && preTenderId) {
    try {
      const qr = await db.query(
        `SELECT estimate_draft FROM tkp_quick_sessions
         WHERE pre_tender_id = $1 AND estimate_draft IS NOT NULL
           AND status IN ('chatting', 'completed', 'sent')
         ORDER BY updated_at DESC LIMIT 1`,
        [preTenderId]
      );
      if (qr.rows[0]) {
        const quickMeta = (qr.rows[0].estimate_draft && qr.rows[0].estimate_draft.ai_meta)
          ? qr.rows[0].estimate_draft.ai_meta
          : qr.rows[0].estimate_draft;
        if (quickMeta && quickMeta.totals) {
          // Подтягиваем все totals + calculation + estimate из Quick.
          Object.assign(recomputedLike.totals, quickMeta.totals);
          if (quickMeta.calculation) {
            for (const k of Object.keys(quickMeta.calculation)) {
              if (!recomputedLike.calculation[k] || (Array.isArray(recomputedLike.calculation[k]) && !recomputedLike.calculation[k].length)) {
                recomputedLike.calculation[k] = quickMeta.calculation[k];
              }
            }
          }
          if (quickMeta.estimate) {
            for (const k of ['crew_count', 'work_days', 'road_days', 'mob_days', 'shifts_per_day', 'workers_per_shift', 'foremen_per_shift']) {
              if (!recomputedLike.estimate[k] && quickMeta.estimate[k]) recomputedLike.estimate[k] = quickMeta.estimate[k];
            }
            // crew_breakdown тоже (для отчёта)
            const cb = quickMeta.estimate.crew_breakdown || {};
            recomputedLike.estimate.itr_count = recomputedLike.estimate.itr_count || cb.itr || 1;
            recomputedLike.estimate.foremen_count = recomputedLike.estimate.foremen_count || cb.masters_per_shift || cb.foremen_per_shift || 0;
            recomputedLike.estimate.workers_count = recomputedLike.estimate.workers_count || cb.executors_per_shift || cb.workers_per_shift || 0;
            recomputedLike.estimate.observers_count = recomputedLike.estimate.observers_count || cb.observers_per_shift || cb.rescuers_per_shift || 0;
          }

          // === НОВОЕ (21.06.2026): синхронизация СЕКЦИЙ сметы с Quick subtotals ===
          // У Quick есть детальные subtotals по группам: personnel_subtotal, current_subtotal,
          // travel_subtotal, transport_subtotal, consumables, chemistry_subtotal.
          // Если в смете уже есть позиции от Conductor, но их сумма < Quick subtotal —
          // добавляем corrector-позицию «Дополнение по укрупнённой оценке» так, чтобы
          // итог секции вышел в Quick subtotal. Если позиций совсем нет — создаём ОДНУ
          // целиком из Quick subtotal.
          const qt = quickMeta.totals;
          // ВНИМАНИЕ: document-generator читает calc[sectionKey] КАК МАССИВ строк (через
          // _normalizeCalcArray). Не объект с .items, а сам массив. Поэтому записываем массив.
          // Items могут иметь поля {name|role|item, qty|count|days, price|rate|rate_per_day, total|amount}.
          const _injectCorrector = (sectionKey, targetSum, label) => {
            const cur = recomputedLike.calculation[sectionKey];
            const items = Array.isArray(cur) ? cur.slice() : [];
            const _itSum = (it) => {
              if (!it || typeof it !== 'object') return 0;
              const total = Number(it.total || it.amount || it.sum || 0);
              if (total) return total;
              const qty = Number(it.qty || it.count || it.days || it.quantity || 1) || 1;
              const price = Number(it.price || it.rate || it.rate_per_day || it.unit_price || 0) || 0;
              return qty * price;
            };
            const curSum = items.reduce((s, it) => s + _itSum(it), 0);
            const delta = Math.max(0, Number(targetSum || 0) - curSum);
            console.log('[conductor] _injectCorrector('+sectionKey+'): target=' + targetSum + ' curSum=' + curSum + ' items=' + items.length + ' delta=' + delta);
            if (delta > 1) {
              items.push({
                name: label,
                qty: 1,
                unit: 'компл.',
                price: delta,
                total: delta
              });
              recomputedLike.calculation[sectionKey] = items;
            } else if (Number(targetSum || 0) > 0 && !items.length) {
              // Секция полностью пустая, а Quick знает целевую сумму → создаём одну строку
              items.push({
                name: label,
                qty: 1,
                unit: 'компл.',
                price: Number(targetSum),
                total: Number(targetSum)
              });
              recomputedLike.calculation[sectionKey] = items;
            }
          };
          // personnel_with_tax включает ФОТ + страх. взносы; для сметы B-секция = ФОТ голый
          // (страх. сами рассчитаются через C25). Поэтому берём personnel_subtotal.
          // ВАЖНО: имена секций должны совпадать с теми, что читает document-generator
          // (см. document-generator.js _normalizeCalcArray(calc.personnel/current_costs/travel/transport/chemistry)).
          if (qt.personnel_subtotal) _injectCorrector('personnel', qt.personnel_subtotal, 'ФОТ бригады (уточнение по укрупнённой оценке)');
          if (qt.current_subtotal)   _injectCorrector('current_costs', qt.current_subtotal, 'Текущие расходы (уточнение)');
          if (qt.travel_subtotal)    _injectCorrector('travel', qt.travel_subtotal, 'Командировочные (уточнение)');
          if (qt.transport_subtotal) _injectCorrector('transport', qt.transport_subtotal, 'Транспорт (уточнение)');
          const matTarget = Number(qt.consumables || 0) + Number(qt.chemistry_subtotal || 0);
          if (matTarget) _injectCorrector('chemistry', matTarget, 'Материалы и реагенты (уточнение)');

          console.log('[conductor] Quick fallback применён: cost=' + recomputedLike.totals.total_cost
                      + ' (синхр. секции: personnel=' + qt.personnel_subtotal + ', current=' + qt.current_subtotal
                      + ', travel=' + qt.travel_subtotal + ', transport=' + qt.transport_subtotal + ', mat=' + matTarget + ')');

          // 21.06.2026: УСТАРЕВШИЕ warnings/recommendations из исходного final_estimate
          // (когда total_cost=0) теперь противоречат новой смете. Фильтруем по «маркерам нуля»
          // и подменяем актуальными сообщениями. Без этого отчёт показывает «Себестоимость
          // 1,50 млн ₽» и тут же «ФОТ равен 0 ₽, ССР не может быть принята» — юзер думает баг.
          // Универсальный matcher для устаревших фраз. Покрывает все вариации
          // «=0 ₽», «: 0 ₽», «равен 0», «ССР обнулена», «ФОТ не посчитан/рассчитан»,
          // «Не подавать/выпускать КП», «нулевая ССР/стоимость/себестоимость», и т.д.
          // ВНИМАНИЕ: «0 ₽» в любом месте строки — БЕЗОПАСНЫЙ матчер: после Quick fallback
          // все суммы > 0, поэтому фраза с «0 ₽» автоматически устаревшая.
          const _staleRe = /(\b0\s*₽|=\s*0\b|:\s*0\s*₽|равен\s+0|ССР.*не\s+может\s+быть\s+принят|не\s+(?:выпускать|подавать)\s+(?:КП|заказчику)|total_with_vat\s*=\s*0|эвристически|standby_reserve|base_fot\s+не\s+посчитан|нулевой\s+базе|ФОТ\s+не\s+(?:посчитан|рассчитан|дал)|расч[её]т\s+труда\s+не\s+дал|нулев(?:ая|ой|ой|ыми|ую)\s+(?:ССР|стоимост|себестоимост|цен)|с\s+нулев[оа]й\s+(?:ценой|себестоимостью|стоимостью)|собрана\s+с\s+нулев|формально.*к\s+нулев|(?:до|перед|после)\s+пересч[её]т\w*|пересч[её]т\w*\s+(?:исправить|запросить)|агрегаци[июя]\s+ССР|консолидаци[июя]\s+ССР|включить\s+(?:pre_mob_cost|travel_cost|docs_plan|standby_reserve|warranty|docs_cost)|материал[ыа]\s+равн[ыа]\s+0|исполнительная.*равн[ыа]\s+0|логистика\s+заблокирована|расходники\s+заблокирован|исполнительная\s+документация\s+заблокирован|критическое\s+расхождение|объ[её]м\s+работ\s+не\s+определ[её]н|нет\s+(?:сроков|длительности|норм)|ССР.*?обнулен|обнулен.*?ССР|полностью\s+обнулен|не\s+попал[аои]\s+в\s+(?:итогову[юй]\s+)?ССР|восстановить\s+расч[её]т|восстановить\s+ФОТ|заполнить\s+(?:нормы|стоимост|цен)|заново\s+прогнать|ресурсная\s+ведомость\s+пуста|не\s+распарсилось|Request\s+error|не\s+вкл(?:юч|ад)\w*\s+в\s+ССР|ошибк[аи]\s+консолидации|не\s+предоставлен[ыа]|не\s+включена\s+рассчитанная)/i;
          const _flatText = (w) => (typeof w === 'string' ? w : String((w && (w.text || w.message || w.detail || w.title)) || ''));
          const _filterStale = (arr) => Array.isArray(arr)
            ? arr.filter(w => { const t = _flatText(w); return t && !_staleRe.test(t); })
            : [];
          recomputedLike.analysis.warnings = _filterStale(recomputedLike.analysis.warnings);
          recomputedLike.analysis.recommendations = _filterStale(recomputedLike.analysis.recommendations);
          recomputedLike.analysis.assumptions = _filterStale(recomputedLike.analysis.assumptions);
          recomputedLike.analysis.key_risks = _filterStale(recomputedLike.analysis.key_risks);
          // recommendations (раздел 5 «Решение руководства») должен быть содержательным.
          // Если после фильтра пусто — даём deterministic-набор, привязанный к реальности проекта.
          if (!recomputedLike.analysis.recommendations.length) {
            recomputedLike.analysis.recommendations = [
              'Утвердить рекомендуемую цену по раздельной наценке либо стандартной — на усмотрение руководства.',
              'Подтвердить с заказчиком объёмы, режим работы и сроки выполнения; уточнить требования по СИЗ/допускам.',
              'Закрепить ставки бригады и нормы расходки на этапе подписания договора по фактическим данным.',
              'Назначить РП, проверить наличие оборудования и инициировать подготовку (ППР, мобилизация).'
            ];
          }
          // Аналогично warnings — должен быть короткий и адекватный, без обвинений в нулевой ССР.
          if (!recomputedLike.analysis.warnings.length) {
            recomputedLike.analysis.warnings = [{
              title: 'Уточнение по укрупнённой оценке',
              text: 'Себестоимость и состав работ финализированы по укрупнённой оценке Quick. Для финального КП рекомендуется повторный нормоконтроль на фактических данных заказчика.'
            }];
          }
          // decision_reasoning (если был сгенерирован под нулевую базу) — обнуляем чтобы AI summary
          // в отчёте не показал противоречивый текст.
          if (recomputedLike.analysis.decision_reasoning && _staleRe.test(String(recomputedLike.analysis.decision_reasoning))) {
            recomputedLike.analysis.decision_reasoning = null;
          }
          // summary тоже — если есть «total_cost=0 ₽», заменяем
          if (recomputedLike.analysis.summary && _staleRe.test(String(recomputedLike.analysis.summary))) {
            recomputedLike.analysis.summary = null;
          }
          // 21.06.2026: ВСЕГДА обнуляем кэшированный summary/section_2 при Quick fallback,
          // иначе старый текст с числами «1,50 млн / 4,02 млн» остаётся после правки маржи
          // и противоречит новым числам. AI пересоздаст с актуальными значениями.
          recomputedLike.analysis.summary = null;
          recomputedLike.analysis.section_2_text = null;
        }
      }
    } catch (e) {
      console.warn('[conductor] Quick fallback не удался:', e.message);
    }
  }

  // Приводим английские «"...">> к русским «...» — единый стандарт оформления.
  const _ruQuote = (s) => {
    if (!s) return s;
    let str = String(s);
    // Заменяем парные ASCII-кавычки на « и »
    let opening = true;
    str = str.replace(/"/g, () => { opening = !opening; return opening ? '»' : '«'; });
    // Чиним кейс одиночной непарной кавычки
    if (str.includes('«') && !str.includes('»')) str = str.replace(/«([^«»]+)$/, '«$1»');
    return str;
  };
  const _isAutoTender = (s) => /^auto[-\s]?tender\b|\bpt-\d+\b/i.test(String(s || ''));
  // Project.subject: фильтр на «Auto-tender для pt-X» (тестовое имя из test-conductor-pt.js).
  // Если tender.tender_title начинается с Auto-tender — используем work_description.
  const rawSubject = (recomputedLike.estimate && recomputedLike.estimate.title)
    || work.work_title
    || (preTender && preTender.work_description)
    || (tender && tender.tender_title && !_isAutoTender(tender.tender_title) ? tender.tender_title : null)
    || (preTender && preTender.ai_summary)
    || `Просчёт #${runId}`;
  const project = {
    subject: _ruQuote(rawSubject),
    title: _ruQuote(rawSubject),
    title_short: _ruQuote(rawSubject),
    object: work.object_name || work.address || (preTender && preTender.work_location) || '',
    deadline: work.start_plan && work.end_plan
      ? `${new Date(work.start_plan).toLocaleDateString('ru-RU')} – ${new Date(work.end_plan).toLocaleDateString('ru-RU')}`
      : ((preTender && preTender.work_deadline)
          ? new Date(preTender.work_deadline).toLocaleDateString('ru-RU')
          : '')
  };
  const customer = {
    name: _ruQuote((preTender && preTender.customer_name)
      || work.customer_name
      || (tender && tender.customer_name)
      || ''),
    inn: (preTender && preTender.customer_inn)
      || work.customer_inn
      || (tender && tender.customer_inn)
      || '',
    address: work.address || work.object_address || (preTender && preTender.work_location) || '',
    contact_person: (preTender && preTender.contact_person) || null
  };

  // PM-автор: pm работы → initiated_by run → author pre_tender.
  let pmUser = null;
  try {
    const pmId = work.pm_id || run.initiated_by || (preTender && preTender.author_id);
    if (pmId) {
      const u = await db.query(
        `SELECT id, name, phone, email, role FROM users WHERE id = $1`,
        [pmId]
      );
      pmUser = u.rows[0] || null;
    }
  } catch (e) {
    console.warn(`[conductor] не удалось подгрузить pmUser: ${e.message}`);
  }

  // 21.06.2026: assumptions/warnings берём из УЖЕ ОТФИЛЬТРОВАННОГО analysis (см. Quick fallback
  // блок выше), а не сырых finalEstimate.warnings — иначе устаревшие тексты «=0 ₽», «Не выпускать
  // КП» из старого артефакта Conductor протекут в отчёт через opts.warnings.
  const opts = {
    author: pmUser ? {
      name: pmUser.name || '—',
      phone: pmUser.phone || '',
      email: pmUser.email || ''
    } : undefined,
    workCategory: ssr.site_category || (run.complexity_flags && run.complexity_flags.method) || 'ground',
    assumptions: Array.isArray(recomputedLike.analysis.assumptions) && recomputedLike.analysis.assumptions.length
      ? recomputedLike.analysis.assumptions
      : (Array.isArray(finalEstimate.assumptions) ? finalEstimate.assumptions : (finalData.key_assumptions || [])),
    warnings: Array.isArray(recomputedLike.analysis.warnings) ? recomputedLike.analysis.warnings : []
  };

  // Генерация буферов параллельно. При ошибке любого — пишем что получилось.
  const tasks = await Promise.allSettled([
    docGen.generateSmetaXlsx(recomputedLike, project, customer, opts),
    docGen.generateDirectorReportDocx(recomputedLike, project, customer, recomputedLike.analysis, opts)
  ]);

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const docs = [];
  if (tasks[0].status === 'fulfilled') {
    docs.push({
      filename: `Смета_run${runId}_${stamp}.xlsx`,
      buffer: tasks[0].value,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      kind: 'mimir_smeta'
    });
  } else {
    console.warn(`[conductor] smeta generation failed: ${tasks[0].reason && tasks[0].reason.message}`);
  }
  if (tasks[1].status === 'fulfilled') {
    docs.push({
      filename: `Отчёт_run${runId}_${stamp}.docx`,
      buffer: tasks[1].value,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      kind: 'mimir_director_report'
    });
  } else {
    console.warn(`[conductor] director_report generation failed: ${tasks[1].reason && tasks[1].reason.message}`);
  }

  if (!docs.length) return;

  // Сохраняем — приоритет pre_tender, затем work, затем tender.
  const entityKind = preTenderId ? 'pre_tender' : (run.work_id ? 'work' : (run.tender_id ? 'tender' : null));
  const entityId = preTenderId || run.work_id || run.tender_id;
  if (!entityKind || !entityId) {
    console.warn(`[conductor] run ${runId}: некуда привязать артефакты (нет pre_tender/work/tender)`);
    return;
  }

  try {
    const { saved } = await docGen.saveDocumentsForEntity(entityKind, entityId, docs);
    emitEvent(runId, null, 'docs_generated', {
      entity_kind: entityKind, entity_id: entityId,
      kinds: saved.map(s => s.kind), count: saved.length
    });
  } catch (e) {
    console.warn(`[conductor] saveDocumentsForEntity(${entityKind}#${entityId}) failed: ${e.message}`);
    emitEvent(runId, null, 'warning', { text: `Сохранение артефактов сорвалось: ${e.message}` });
  }
}

/**
 * Минимальный порог "критических" блокирующих уточнений, ПРИ КОТОРОМ
 * мы ставим run на паузу и формируем письмо клиенту.
 *
 * Просьба пользователя (20.06.2026): «запрос мы пишем только в том случае
 * если не можем вообще посчитать без каких-то документов и данных, мы не
 * должны каждый просчёт делать запрос клиенту, а только если прям совсем
 * не можем обойти это».
 *
 * Алгоритм: blocking=true И default_assumption IS NULL/пусто → реально
 * критический пункт. Если таких >= 3 — пауза и письмо.
 * Если меньше — продолжаем считать с default_assumption, событие "blocking_below_threshold"
 * пишется в war room, но смета финализируется.
 */
const CUSTOMER_LETTER_THRESHOLD = 3;

async function _countCriticalCustomerBlockers(runId) {
  try {
    // default_assumption — jsonb (NULL / 'null' / {} = считаем пустым).
    // blocking — boolean (без NULL по схеме).
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM mimir_clarifications
        WHERE conductor_run_id = $1
          AND channel = 'CUSTOMER'
          AND status = 'OPEN'
          AND blocking = true
          AND (default_assumption IS NULL
               OR default_assumption::text = 'null'
               OR default_assumption::text = '{}'
               OR default_assumption::text = '""')`,
      [runId]
    );
    return (r.rows[0] && r.rows[0].n) || 0;
  } catch (e) {
    console.warn('[conductor] count critical blockers failed:', e.message);
    return 0;
  }
}

/**
 * Пауза в ожидании заказчика.
 * Если критических блокеров (без default_assumption) меньше CUSTOMER_LETTER_THRESHOLD —
 * не паузим, выпускаем смету с допущениями, событие в war room.
 * Если столько или больше — паузим и пытаемся автоматически сформировать письмо.
 */
async function pauseRunForCustomer(runId, clarificationResult) {
  const critical = await _countCriticalCustomerBlockers(runId);
  if (critical < CUSTOMER_LETTER_THRESHOLD) {
    emitEvent(runId, null, 'blocking_below_threshold', {
      critical_blockers: critical,
      threshold: CUSTOMER_LETTER_THRESHOLD,
      action: 'continue_with_defaults',
      message: `Критических блокеров без default_assumption всего ${critical} (порог ${CUSTOMER_LETTER_THRESHOLD}). Продолжаем расчёт с допущениями, письмо клиенту НЕ генерируется.`
    });
    return; // продолжаем pipeline
  }
  emitEvent(runId, null, 'paused', {
    reason: 'awaiting_customer',
    critical_blockers: critical,
    clarification: clarificationResult
  });
  await cr.updateRunStatus(runId, 'BLOCKED_BY_CUSTOMER', {
    blockedReason: `Ожидание ответа заказчика: ${critical} критических уточнений без default_assumption`
  });
  // Автоматически генерим draft письма (silent fail — не критично, можно вручную).
  try {
    const { generateClarificationLetter } = require('./letter-generator');
    const run = await cr.getRun(runId);
    const pmUserId = (run && (run.initiated_by || run.created_by)) || null;
    const res = await generateClarificationLetter({ runId, pmUserId });
    emitEvent(runId, null, 'letter_drafted_auto', {
      letter_id: res.letterId, letter_number: res.letterNumber,
      questions_count: (res.questions || []).length
    });
  } catch (e) {
    emitEvent(runId, null, 'warning', { text: `Авто-генерация письма не удалась: ${e.message}` });
  }
}

/**
 * Главный прогон Conductor — нативный tool-use agent loop (Сессия 6b).
 *
 * Claude (или stub-сценарий) сам выбирает каких агентов и в каком порядке звать.
 * Hard-rules проверяются только перед emit_final_estimate (safety floor).
 *
 * @param {number} runId
 * @param {Object} [opts]
 */
async function runConductor(runId, opts = {}) {
  // PRODUCTION-режим: детерминированный pipeline из 29 шагов (повторяемость 5/5).
  // Включается env-переменной MIMIR_DETERMINISTIC_PIPELINE=true ИЛИ opts.mode='deterministic'.
  if (process.env.MIMIR_DETERMINISTIC_PIPELINE === 'true' || opts.mode === 'deterministic') {
    const { runDeterministic } = require('./deterministic-conductor');
    return runDeterministic(runId, opts);
  }

  // Дебаг-fallback: старый детерминированный путь Сессии 2.
  if (process.env.MIMIR_FORCE_DETERMINISTIC === 'true') {
    return runConductorDeterministic(runId, opts);
  }

  // FIFO-очередь Conductor-loop. Если другой РП уже запустил просчёт — этот
  // ждёт в очереди (max 1 active одновременно — снижает rate-limit давление
  // на RouterAI и стабилизирует прогоны).
  const { RUN_SEMAPHORE } = require('./semaphore');
  if (RUN_SEMAPHORE.active >= RUN_SEMAPHORE.max) {
    const sStatus = RUN_SEMAPHORE.status();
    await cr.updateRunStatus(runId, 'WAITING_FOR_SLOT', { reason: `Очередь: впереди ${sStatus.active + sStatus.queued} просчётов` });
    cr.addEvent(runId, null, 'queue_wait', { semaphore: sStatus, message: 'Жду свободного слота — другой РП сейчас считает' });
  }
  await RUN_SEMAPHORE.acquire();
  try {
    return await _runConductorCore(runId, opts);
  } finally {
    RUN_SEMAPHORE.release();
  }
}

async function _runConductorCore(runId, opts = {}) {
  const run = await cr.getRun(runId);
  if (!run) throw new Error(`ConductorRun ${runId} не найден`);

  const ctx = await buildInitialContext(run);

  // 1. Прелюдия: парсер документов + аналитик ТЗ (Conductor не работает без tz_summary).
  await cr.updateRunStatus(runId, 'RUNNING', {});
  try {
    await runAgentWithTimeout(
      () => callAgent('document_parser', { documents: (ctx.documents || []).map((d) => d.id) }, runId),
      'document_parser'
    );
  } catch (e) {
    emitEvent(runId, null, 'warning', { text: `document_parser упал по таймауту/ошибке: ${e.message} — продолжаем без распарсенных документов` });
  }
  try {
    await runAgentWithTimeout(
      () => callAgent('tz_analyst', { documents: (ctx.documents || []).map((d) => d.id), focus_areas: ['all'] }, runId),
      'tz_analyst'
    );
  } catch (e) {
    emitEvent(runId, null, 'warning', { text: `tz_analyst упал по таймауту/ошибке: ${e.message} — продолжаем без tz_summary` });
  }

  const tzArt = await cr.getArtifact(runId, 'tz_summary');
  const tzSummary = tzArt ? tzArt.content : null;

  // 2. Классификация сложности + выбор модели Conductor.
  const complexityFlags = classifyComplexity(tzSummary, ctx, run.complexity_flags);
  const conductorModel = pickConductorModel(ctx.contract_value);
  await cr.updateRunStatus(runId, 'RUNNING', { conductorModel });
  await db.query('UPDATE mimir_conductor_runs SET complexity_flags = $2 WHERE id = $1', [runId, JSON.stringify(complexityFlags)]);

  // 3. Agent_run для самого Conductor.
  const conductorAgentRunId = await cr.startAgentRun(runId, {
    agentName: 'conductor', model: conductorModel, promptHash: ''
  });

  // 4. Системный промпт + tools + stub-контекст.
  const required = hardRules.getRequiredAgents(tzSummary, ctx.contract_value, complexityFlags);
  const systemPrompt = buildConductorSystemPrompt(ctx, tzSummary, complexityFlags);
  const tools = buildToolSchemas(REGISTRY, required);
  const stubCtx = { complexity_flags: complexityFlags, contract_value: ctx.contract_value, required_agents: required };

  emitEvent(runId, conductorAgentRunId, 'mode', {
    stub: aiProvider.isStubMode(), conductor_model: conductorModel, required_agents: required
  });

  // 5. История диалога (Anthropic-формат: content-блоки).
  const messages = [{
    role: 'user',
    content: 'Начни работу по сборке сметы. Используй инструменты для вызова агентов. ' +
      'Перед emit_final_estimate убедись, что завершены обязательные агенты: ' +
      (required.length ? required.join(', ') : '(жёстких требований нет — действуй по ситуации)') + '.'
  }];

  // 6. Native tool-use loop.
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Sliding-window: если messages раздулся > MAX_HISTORY_TOKENS (500K) —
    // обрезаем FIFO с защитой пар tool_use↔tool_result. DeepSeek контекст 1M,
    // но мы держим запас под system_prompt + tools + новые tool_results.
    const slidedMessages = _slideConductorMessages(messages, runId);
    if (slidedMessages.length !== messages.length) {
      const dropped = messages.length - slidedMessages.length;
      emitEvent(runId, conductorAgentRunId, 'context_trimmed', {
        dropped_msgs: dropped, kept_msgs: slidedMessages.length, iteration
      });
      // Мутируем messages — иначе следующая итерация снова посчитает с нуля
      messages.splice(0, dropped);
    }

    const result = await aiProvider.completeWithStream({
      system: systemPrompt,
      messages,
      model: conductorModel,
      tools,
      tool_choice: 'auto',
      stubCtx,
      onThought: (text) => emitEvent(runId, conductorAgentRunId, 'thought', { text }),
      onText: (text) => emitEvent(runId, conductorAgentRunId, 'conductor_message', { text }),
      onToolCall: (tu) => emitEvent(runId, conductorAgentRunId, 'tool_call', { tool: tu.name, input: tu.input })
    });

    // Записываем полный assistant-ответ (text + tool_use блоки) в историю.
    messages.push({ role: 'assistant', content: result.content_blocks || [] });

    const toolUses = result.tool_uses || [];

    // Conductor завершил без вызова инструмента — аномалия: подталкиваем к явному emit.
    if (result.stop_reason !== 'tool_use' || !toolUses.length) {
      messages.push({
        role: 'user',
        content: 'Ты завершил ход без вызова инструмента. Либо вызови нужного агента, ' +
          'либо emit_final_estimate (если все обязательные готовы).'
      });
      continue;
    }

    // Опус-логирование (19.06.2026): каждый шаг — событие next_step, чтобы
    // в War Room было видно с какого агента на какой переход и на чём именно
    // run застрял. Тип события — `next_step`, payload: { from, to, decided_by, ts }.
    {
      const prevAgent = _lastAgentName.get(runId) || null;
      for (const tu of toolUses) {
        emitEvent(runId, conductorAgentRunId, 'next_step', {
          from: prevAgent, to: tu.name,
          decided_by: 'llm_tool_use', iteration, ts: Date.now()
        });
      }
      // Запомним последний вызванный агент (имя инструмента) — для следующей итерации
      const last = toolUses[toolUses.length - 1];
      if (last) _lastAgentName.set(runId, last.name);
    }

    // Исполняем все tool_uses (параллельно — independent-агенты ускоряются).
    const toolResults = await Promise.all(
      toolUses.map((tu) => _runOneTool(tu, runId, conductorAgentRunId))
    );

    // ── Особый случай: ask_customer + blocking → пауза прогона.
    const blockingIdx = toolUses.findIndex(
      (tu) => tu.name === 'ask_customer' && tu.input && tu.input.blocking !== false
    );
    if (blockingIdx !== -1) {
      await pauseRunForCustomer(runId, toolResults[blockingIdx].raw);
      await cr.finishAgentRun(conductorAgentRunId, { status: 'SUCCESS', outputSummary: 'Пауза: ожидание заказчика' });
      return;
    }
    // Агент мог поднять блокирующее уточнение к заказчику сам (внутри callAgent).
    const agentBlocked = toolResults.find((tr) => tr.blockingCustomer);
    if (agentBlocked) {
      await pauseRunForCustomer(runId, agentBlocked.blockingCustomer);
      await cr.finishAgentRun(conductorAgentRunId, { status: 'SUCCESS', outputSummary: 'Пауза: ожидание заказчика' });
      return;
    }

    // ── Особый случай: emit_final_estimate → проверка canFinalize.
    const emitIdx = toolUses.findIndex((tu) => tu.name === 'emit_final_estimate');
    if (emitIdx !== -1) {
      const canFin = await hardRules.canFinalize(runId, ctx.contract_value, complexityFlags);
      if (canFin.ok) {
        await finalizeRun(runId, toolUses[emitIdx].input || {});
        await cr.finishAgentRun(conductorAgentRunId, {
          status: 'SUCCESS', outputSummary: 'Просчёт финализирован', durationMs: null
        });
        return;
      }
      // Hard-rules отклонили финал — возвращаем is_error, Conductor продолжит loop.
      toolResults[emitIdx] = {
        tool_use_id: toolUses[emitIdx].id,
        content: `ОТКАЗ финализации: ${canFin.reason}. Запусти недостающих агентов и попробуй снова.`,
        is_error: true
      };
      emitEvent(runId, conductorAgentRunId, 'warning', { text: `emit_final_estimate отклонён: ${canFin.reason}` });
    }

    // Возвращаем tool_results в историю.
    messages.push({
      role: 'user',
      content: toolResults.map((tr) => ({
        type: 'tool_result',
        tool_use_id: tr.tool_use_id,
        content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
        is_error: !!tr.is_error
      }))
    });

    // Safety: лимит стоимости.
    const totalCost = await cr.getTotalCost(runId);
    if (totalCost > MAX_RUN_COST_RUB) {
      await cr.addEvent(runId, conductorAgentRunId, 'error', { text: `Лимит стоимости ${MAX_RUN_COST_RUB}₽ достигнут` });
      await cr.finishAgentRun(conductorAgentRunId, { status: 'ERROR', errorText: 'Cost limit exceeded' });
      throw new Error('Cost limit exceeded');
    }
  }

  await cr.finishAgentRun(conductorAgentRunId, { status: 'ERROR', errorText: `MAX_ITERATIONS=${MAX_ITERATIONS}` });
  throw new Error(`Conductor превысил MAX_ITERATIONS (${MAX_ITERATIONS})`);
}

/**
 * Исполнить один tool_use и привести результат к форме tool_result.
 * Возвращает { tool_use_id, content, is_error?, raw?, blockingCustomer? }.
 */
async function _runOneTool(toolUse, runId, conductorAgentRunId) {
  // emit_final_estimate обрабатывается в loop (canFinalize) — здесь только ack.
  if (toolUse.name === 'emit_final_estimate') {
    return { tool_use_id: toolUse.id, content: 'acknowledged', raw: { acknowledged: true } };
  }
  try {
    // Per-agent timeout: подвисший агент не должен держать весь Conductor-loop.
    const res = await runAgentWithTimeout(
      () => executeTool(toolUse, runId, conductorAgentRunId),
      toolUse.name || 'unknown_tool'
    );
    // Блокирующее уточнение к заказчику, поднятое самим агентом.
    const blockingCustomer = (res.clarifications_raised || []).find(
      (c) => c.status === 'awaiting_customer_letter' && c.blocking
    );
    // Компактная сводка для модели (не весь артефакт).
    const summary = res.success === false
      ? `Ошибка: ${res.error}`
      : (res.summary || res.content || res.status || 'готово');
    return {
      tool_use_id: toolUse.id,
      content: typeof summary === 'string' ? summary : JSON.stringify(summary),
      is_error: res.success === false,
      raw: res,
      blockingCustomer: blockingCustomer || null
    };
  } catch (e) {
    return { tool_use_id: toolUse.id, content: `Ошибка инструмента: ${e.message}`, is_error: true };
  }
}

/**
 * СТАРЫЙ детерминированный путь (Сессия 2). Сохранён как fallback за env-флагом
 * MIMIR_FORCE_DETERMINISTIC=true для дебага. Не оркеструет через Claude — гоняет
 * обязательных агентов по hard-rules последовательно.
 */
async function runConductorDeterministic(runId, opts = {}) {
  const run = await cr.getRun(runId);
  if (!run) throw new Error(`ConductorRun ${runId} не найден`);

  const ctx = await buildInitialContext(run);

  await cr.updateRunStatus(runId, 'RUNNING', {});
  try {
    await runAgentWithTimeout(
      () => callAgent('document_parser', { documents: (ctx.documents || []).map((d) => d.id) }, runId),
      'document_parser'
    );
  } catch (e) {
    emitEvent(runId, null, 'warning', { text: `document_parser timeout/ошибка: ${e.message}` });
  }
  try {
    await runAgentWithTimeout(
      () => callAgent('tz_analyst', { documents: (ctx.documents || []).map((d) => d.id), focus_areas: ['all'] }, runId),
      'tz_analyst'
    );
  } catch (e) {
    emitEvent(runId, null, 'warning', { text: `tz_analyst timeout/ошибка: ${e.message}` });
  }

  const tzArt = await cr.getArtifact(runId, 'tz_summary');
  const tzSummary = tzArt ? tzArt.content : null;

  const complexityFlags = classifyComplexity(tzSummary, ctx, run.complexity_flags);
  const conductorModel = pickConductorModel(ctx.contract_value);
  await cr.updateRunStatus(runId, 'RUNNING', { conductorModel });
  await db.query('UPDATE mimir_conductor_runs SET complexity_flags = $2 WHERE id = $1', [runId, JSON.stringify(complexityFlags)]);

  const conductorAgentRunId = await cr.startAgentRun(runId, {
    agentName: 'conductor', model: conductorModel, promptHash: ''
  });

  const required = hardRules.getRequiredAgents(tzSummary, ctx.contract_value, complexityFlags);
  emitEvent(runId, conductorAgentRunId, 'mode', { stub: aiProvider.isStubMode(), conductor_model: conductorModel, required_agents: required, deterministic: true });

  let iteration = 0;
  const done = new Set(await cr.getCompletedAgents(runId));
  const queue = required.filter((a) => !done.has(a) && a !== 'tz_analyst');

  for (const agentName of queue) {
    if (++iteration > MAX_ITERATIONS) throw new Error(`Conductor превысил MAX_ITERATIONS (${MAX_ITERATIONS})`);
    // Опус-логирование: переход в детерминированной цепочке
    {
      const prevAgent = _lastAgentName.get(runId) || null;
      emitEvent(runId, conductorAgentRunId, 'next_step', {
        from: prevAgent, to: `call_${agentName}`,
        decided_by: 'deterministic', iteration, ts: Date.now()
      });
      _lastAgentName.set(runId, `call_${agentName}`);
    }
    await ensureDependencies(agentName, runId, conductorAgentRunId);
    let res;
    try {
      res = await runAgentWithTimeout(
        () => executeTool({ name: `call_${agentName}`, input: {}, id: `auto-${agentName}` }, runId, conductorAgentRunId),
        agentName
      );
    } catch (e) {
      // Опциональный — продолжаем pipeline. Hard-rules в canFinalize ниже поймают
      // если этот агент был обязательный — переведут run в BLOCKED_BY_PM.
      emitEvent(runId, conductorAgentRunId, 'warning', { text: `Агент ${agentName} timeout/ошибка: ${e.message} — продолжаем` });
      res = { success: false, error: e.message };
    }
    const blockingCustomer = (res.clarifications_raised || []).find((c) => c.status === 'awaiting_customer_letter' && c.blocking);
    if (blockingCustomer) {
      await pauseRunForCustomer(runId, blockingCustomer);
      await cr.finishAgentRun(conductorAgentRunId, { status: 'SUCCESS', outputSummary: 'Пауза: ожидание заказчика' });
      return;
    }
    const totalCost = await cr.getTotalCost(runId);
    if (totalCost > MAX_RUN_COST_RUB) {
      await cr.addEvent(runId, conductorAgentRunId, 'error', { text: `Лимит стоимости ${MAX_RUN_COST_RUB}₽ достигнут` });
      throw new Error('Cost limit exceeded');
    }
  }

  const finalCheck = await hardRules.canFinalize(runId, ctx.contract_value, complexityFlags);
  if (!finalCheck.ok) {
    emitEvent(runId, conductorAgentRunId, 'warning', { text: `Не готов к финалу: ${finalCheck.reason}` });
    await cr.updateRunStatus(runId, 'BLOCKED_BY_PM', { blockedReason: finalCheck.reason });
    await cr.finishAgentRun(conductorAgentRunId, { status: 'SUCCESS', outputSummary: finalCheck.reason });
    return;
  }

  const finalArt = await cr.getArtifact(runId, 'final_estimate');
  await finalizeRun(runId, {
    summary: finalArt?.content?.summary || 'Просчёт собран (детерминированный режим).',
    decision_reasoning: 'Детерминированная сборка обязательных артефактов по hard-rules.',
    recommendation: 'THINK',
    key_assumptions: ['Детерминированный fallback-режим.']
  });
  await cr.finishAgentRun(conductorAgentRunId, { status: 'SUCCESS', outputSummary: 'Просчёт финализирован' });
}

/**
 * Упрощённый разрешитель зависимостей: дотягивает недостающие requires_artifacts
 * агента, рекурсивно запуская их провайдеров. Только для Сессии 2 (моки).
 */
async function ensureDependencies(agentName, runId, conductorAgentRunId, depth = 0) {
  if (depth > 6) return; // защита от циклов
  const spec = REGISTRY[agentName];
  if (!spec) return;
  for (const at of spec.requires_artifacts || []) {
    const existing = await cr.getArtifact(runId, at);
    if (existing) continue;
    // Найти агента, который производит этот артефакт
    const providerName = Object.keys(REGISTRY).find(
      (k) => REGISTRY[k].output_artifact_type === at
    );
    if (!providerName) continue;
    await ensureDependencies(providerName, runId, conductorAgentRunId, depth + 1);
    try {
      await runAgentWithTimeout(
        () => executeTool({ name: `call_${providerName}`, input: {}, id: `dep-${providerName}` }, runId, conductorAgentRunId),
        providerName
      );
    } catch (e) {
      // Зависимость не докрутилась — не валим всю цепочку, основной агент
      // упадёт на missing artifact и Conductor получит понятную ошибку.
      cr.addEvent(runId, conductorAgentRunId, 'warning', { text: `Зависимость ${providerName} timeout/ошибка: ${e.message}` }).catch(() => {});
    }
  }
}

module.exports = {
  runConductor,
  runConductorDeterministic,
  buildInitialContext,
  classifyComplexity,
  finalizeRun,
  pauseRunForCustomer,
  ensureDependencies,
  // Опус-фикс 20.06.2026: экспортируем для deterministic-conductor.js,
  // чтобы в детерминированном режиме тоже генерировались смета+отчёт.
  _generateConductorArtifacts,
  MAX_ITERATIONS,
  MAX_RUN_COST_RUB
};
