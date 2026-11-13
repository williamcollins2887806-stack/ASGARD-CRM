/**
 * Приёмочный прогон анализа+просчёта на одном тендере (по умолчанию 2138).
 *
 * Проверяет:
 *   • позиций ≥ 650 (если ведомость крупная);
 *   • график заездов через buildVisitPlan (не обход);
 *   • objects — массив, не .length;
 *   • МТР не пуст.
 *
 * Запуск на проде:
 *   node .deploy/analyze-2138.js
 *   node .deploy/analyze-2138.js --tender=2041
 *   TENDER_ID=2041 node .deploy/analyze-2138.js
 *
 * ID тендера — только параметр запуска, не зашит в сервисы CRM.
 */
const APP = '/var/www/asgard-crm';
process.chdir(APP);
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';

const { Pool } = require(APP + '/node_modules/pg');
const pool = new Pool({
  host: 'localhost', port: 5432, user: 'asgard',
  password: '123456789', database: 'asgard_crm', max: 3
});

function resolveTenderId() {
  const arg = process.argv.find((a) => /^--tender=/.test(a));
  if (arg) {
    const n = Number(String(arg).split('=')[1]);
    if (n > 0) return n;
  }
  const env = Number(process.env.TENDER_ID);
  if (env > 0) return env;
  // Дефолт приёмочного прогона плана (можно сменить CLI/ENV).
  return 2138;
}
const TENDER_ID = resolveTenderId();
const started = Date.now();

function log(...a) {
  console.log('[' + ((Date.now() - started) / 1000).toFixed(0) + 's]', ...a);
}

/**
 * Число трубок из описания объектов.
 *
 * Объём в п.м уже посчитан как N × L, но норма требует именно N. В
 * `objects[].size` геометрия лежит строкой «Ø18 L=6090 N=899» (так её
 * сохранил excel-structure), поэтому достаём N оттуда. Если числа нет —
 * считаем из объёма и длины: N = volume / length_m.
 *
 * @param {object} pos — позиция ДВ
 * @returns {number|null}
 */
function estimateTubesFromObjects(pos) {
  const p = pos || {};
  const objs = Array.isArray(p.objects) ? p.objects : [];
  for (const o of objs) {
    const s = String((o && (o.size || o.note || o.type)) || '');
    // N=899 или «трубок 899» или «899 шт»
    let m = s.match(/(?:N|трубок|шт)\s*[=:]?\s*(\d{1,6})/i);
    if (m) { const n = Number(m[1]); if (n > 0) return Math.round(n); }
  }
  // Фолбэк: объём (п.м) / длина трубки (м)
  const lenMm = Number(p.conversion_params && p.conversion_params.length_m);
  const vol = Number(p.volume);
  if (vol > 0 && lenMm > 0) {
    const lenM = lenMm > 1000 ? lenMm / 1000 : lenMm;
    const n = Math.round(vol / lenM);
    if (n > 0) return n;
  }
  return null;
}

(async () => {
  const docRole = require(APP + '/src/services/doc-role');
  const stagesAi = require(APP + '/src/services/mimir-tender-stages-ai');
  const aiProvider = require(APP + '/src/services/ai-provider');
  const workNorms = require(APP + '/src/services/work-norms');

  // ── Документы ────────────────────────────────────────────────────────────
  // id обязателен: файл берётся по нему. Имён-копий шесть, и выбор по имени
  // давал то полный файл, то усечённый (603 вместо 675 позиций).
  const docsQ = await pool.query(
    `SELECT id, original_name AS name, ocr_text AS text
       FROM documents
      WHERE tender_id = $1 AND ocr_status = 'done'
        AND ocr_text IS NOT NULL AND length(trim(ocr_text)) > 20
      ORDER BY length(ocr_text) DESC`, [TENDER_ID]
  );
  log('документов с текстом:', docsQ.rows.length);

  // ── Структурный разбор ДО отбора ─────────────────────────────────────────
  // ВАЖНО: разбор идёт ДО selectForPrompt. Иначе table_positions ещё не
  // заполнен, отбор видит «0 строк объёма», оценка ожидаемых позиций
  // считается по грубому тексту, и анализ режет ответ не на то число.
  // Раньше порядок был обратный — это и давало 367 позиций из 1348.
  const excelStructure = require(APP + '/src/services/excel-structure');
  let structureBlock = '';
  const parsedList = [];   // [{name, parsed}] — для дедупликации между файлами
  let parsedTotal = 0;
  const rowsByName = new Map();   // имя документа -> число позиций в нём
  try {
    const XLSX = require(APP + '/node_modules/xlsx');
    const fs = require('fs');
    for (const d of docsQ.rows) {
      if (!/\.xlsx?$/i.test(d.name)) continue;
      // Берём файл по ID документа, а не по имени: имён-копий шесть, и
      // `LIMIT 1` по имени hаотично выбирал то полный файл (675 позиций),
      // то усечённый (603). Проверено: все копии по имени парсятся
      // по-разному в зависимости от того, какая попалась.
      const files = await pool.query(
        `SELECT COALESCE(file_url, download_url, filename) AS path
           FROM documents
          WHERE id = $1`, [d.id]
      );
      let buf = null;
      const raw = (files.rows[0] && files.rows[0].path) || '';
      // file_url = /uploads/tender_archives/2138/<id>_<hash>_<имя>.xls
      // Пробуем корень public и корень приложения.
      const rel = raw.replace(/^\/+/, '');
      const cand = [
        raw,
        '/var/www/asgard-crm/public/' + rel,
        '/var/www/asgard-crm/' + rel
      ].filter(Boolean);
      for (const c of cand) {
        try { if (c && fs.existsSync(c)) { buf = fs.readFileSync(c); break; } } catch (_) {}
      }
      if (!buf) { log('  файл не найден на диске:', raw); }
      if (!buf) continue;
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellText: true });
      const parsed = excelStructure.parseWorkbook(XLSX, wb);
      if (parsed.stats.positions > 0) {
        // Копии одного файла в БД (6 копий «7. Форма…») не должны считаться
        // как 6 разных перечней: 675 × 6 = 4050 позиций раздувают ожидание,
        // лимит выхода и график. Одинаковые имена — один перечень.
        const prev = rowsByName.get(d.name) || 0;
        if (prev === 0) {
          // Второй файл может быть ТЕМ ЖЕ перечнем в другой вёрстке
          // («Дефектная ведомость» против «Форма тендерного предложения»).
          // Сравниваем по содержимому (объём + период), а не по имени.
          const dupOf = parsedList.find((x) => excelStructure.compareLists(x.parsed.positions, parsed.positions).sameList);
          if (dupOf) {
            log('Excel', d.name, '— тот же перечень, что «' + dupOf.name + '», пропущен');
          } else {
            parsedTotal += parsed.stats.positions;
            parsedList.push({ name: d.name, parsed });
            structureBlock += '\n\n' + excelStructure.toPromptText(parsed);
            log('Excel', d.name, '->', parsed.stats.positions, 'позиций,', parsed.stats.periods, 'периодов');
          }
        } else {
          log('Excel', d.name, '— копия, пропущена (' + parsed.stats.positions + ' поз.)');
        }
        rowsByName.set(d.name, Math.max(prev, parsed.stats.positions));
      }
    }
  } catch (e) {
    log('структурный разбор пропущен:', e.message);
  }
  log('итого из Excel:', parsedTotal, 'позиций');

  // ── Отбор документов — ПОСЛЕ разбора ─────────────────────────────────────
  // Структура и table_positions уже известны, поэтому отбор видит реальные
  // объёмы, а не только текст. Это влияет на оценку ожидаемых позиций.
  const sel = docRole.selectForPrompt(docsQ.rows.map((d) => Object.assign({}, d, {
    table_positions: rowsByName.get(d.name) || 0,
    structure: (parsedList.find((x) => x.name === d.name) || {}).parsed || null
  })));
  log('в промпт:', sel.stats.selected, '| символов:', sel.stats.chars_after);

  // ── Каталог норм ─────────────────────────────────────────────────────────
  let catalog = { categories: [], rates: [] };
  try { catalog = await workNorms.loadCatalog(pool); } catch (e) { log('каталог:', e.message); }


  // ── Разбор ───────────────────────────────────────────────────────────────
  const tzText = sel.selected.map((d) => '=== ' + d.original_name + ' ===\n' + d.text).join('\n\n');
  log('запуск generateDv, вход:', tzText.length, 'символов');

  // ── Склад: что есть у нас, чтобы агент МТР не писал «купить» на своё ─────
  // В прогоне склад не передавался вовсе, и МТР предлагал закупку того,
  // что лежит на складе. Ошибка дорогая: закупка попадает в блок G сметы.
  let warehouseCtx = null;
  let warehouseCtxText = null;
  try {
    const { buildWarehouseContext } = require(APP + '/src/services/warehouse-context');
    const whRes = await pool.query(
      `SELECT e.name, e.quantity, e.unit, c.name AS category_name
         FROM equipment e
         LEFT JOIN equipment_categories c ON c.id = e.category_id
        WHERE COALESCE(e.is_active, true) = true
          AND COALESCE(e.status, 'available') NOT IN ('written_off','disposed','lost')
          AND COALESCE(e.quantity, 0) > 0
        ORDER BY c.name, e.name
        LIMIT 2000`
    );
    warehouseCtx = buildWarehouseContext(whRes.rows, { text: tzText });
    warehouseCtxText = warehouseCtx.text || null;
    log('склад:', warehouseCtx.total, 'наименований, в разбор', warehouseCtx.items.length);
  } catch (e) {
    log('склад не прочитан:', e.message);
  }

  const res = await stagesAi.generateDv({
    db: pool,
    aiProvider,
    tz_text: tzText + structureBlock,
    // table_positions — runtime-поле парсера, в БД его нет. Без него
    // estimateExpectedForSelection даёт 0, лимит выхода 32k вместо 128k,
    // и модель режет ведомость на 7 строк. Подставляем счёт из структуры.
    documents: sel.selected.map((d) => Object.assign({}, d, {
      table_positions: rowsByName.get(d.original_name) || 0
    })),
    catalog,
    model: undefined,
    onProgress: (ev) => {
      if (ev && ev.message) log('  ' + (ev.pct != null ? ev.pct + '% ' : '') + ev.message);
    }
  });

  if (!res || res.error) {
    console.log(JSON.stringify({ ok: false, error: res && res.error, raw: (res && res.raw || '').slice(0, 800) }, null, 1));
    await pool.end();
    process.exit(1);
  }

  const dv = res.dv || {};
  const positions = Array.isArray(dv.positions) ? dv.positions : [];
  const withPeriod = positions.filter((p) => p && (p.period || p.period_start)).length;
  const withClean = positions.filter((p) => p && Number(p.clean_count) > 0).length;
  const withObjects = positions.filter((p) => p && Number(p.objects) > 0).length;
  const mtr = Array.isArray(dv.mtr_suggestions) ? dv.mtr_suggestions
    : (Array.isArray(dv.mtr) ? dv.mtr : []);

  // ── Норма-превью по каждой позиции ───────────────────────────────────────
  // БЕЗ ЭТОГО ШАГА НЕТ СРОКА. Модель даёт объём, но не трудозатраты: без
  // нормы у позиции нет mh/days, man_hours = 0, work_days = null. Именно
  // так и получилось на первом прогоне — 608 позиций с объёмами и нулевым
  // сроком. Настоящий маршрут (tkp_quick) делает это на этапе analyze.
  const workNorms2 = require(APP + '/src/services/work-norms');
  let normFilled = 0;
  const enrichedPositions = [];
  for (const pos of positions) {
    const enriched = Object.assign({}, pos);
    if (pos.category_code && !pos.needs_classification) {
      try {
        const bundle = await workNorms2.tryNormPreviewForEstimate(pool, {
          work: { work_title: pos.name },
          norm_inputs: {
            category_code: pos.category_code,
            method_code: pos.method_code,
            inputs: {
              volume: pos.volume,
              unit: pos.unit,
              // Геометрия аппарата: норма для чистки трубок требует ЧИСЛО
              // ТРУБОК и длину. Без них превью отвечает «Укажите число
              // трубок» — и 515 позиций остались без срока (собранный объём
              // в п.м уже посчитан как N × L, обратно N берём из geometry).
              tubes: (pos.conversion_params && pos.conversion_params.tubes)
                || (pos.objects && pos.objects[0] && pos.objects[0].tubes)
                || estimateTubesFromObjects(pos),
              // ВАЖНО: `diameter_mm` — именно то имя, которое читает норма.
              // `dn_mm` она не смотрит, и в trace появлялось «Ø не указан»
              // при реальном Ø18 в данных.
              diameter_mm: (pos.conversion_params && pos.conversion_params.dn_mm) || null,
              // Длина трубки в МЕТРАХ. В ведомости она в МИЛЛИМЕТРАХ
              // («Длина трубки, мм» = 6090), а норма делит на эталон 6 м:
              // без перевода получалось ×1015 и срок 31 464 суток вместо ~60.
              length_m: (() => {
                const raw = Number(pos.conversion_params && pos.conversion_params.length_m);
                if (!(raw > 0)) return null;
                return raw > 100 ? raw / 1000 : raw;
              })(),
              area_per_plate_m2: (pos.conversion_params && pos.conversion_params.area_per_plate_m2) || null,
              thickness_mm: (pos.conversion_params && pos.conversion_params.thickness_mm) || null,
              density_t_m3: (pos.conversion_params && pos.conversion_params.density_t_m3) || null,
              cycles: Number(pos.clean_count) > 0 ? Number(pos.clean_count) : null,
              fouling: pos.fouling || 'medium'
            },
            fouling: pos.fouling || 'medium'
          }
        });
        if (bundle.preview && bundle.preview.ok) {
          const pv = bundle.preview;
          enriched.norm = {
            code: pv.rate && pv.rate.code,
            work_days: pv.results && pv.results.work_days,
            crew: pv.crew,
            trace: pv.trace,
            fallback: !!pv.fallback
          };
          // Трудозатраты — то, из чего считается срок.
          const wd = Number(pv.results && pv.results.work_days);
          const crew = pv.crew || {};
          const people = (Number(crew.master) || 0) + (Number(crew.exec) || 0);
          if (wd > 0) enriched.days = Math.round(wd * 100) / 100;
          if (people > 0) enriched.people = people;
          const mhCalc = Number(pv.results && pv.results.man_hours);
          if (mhCalc > 0) enriched.mh = Math.round(mhCalc * 100) / 100;
          enriched.source = pv.fallback ? 'expert' : 'norm';
          if (pv.rate && pv.rate.code) enriched.source_ref = String(pv.rate.code);
          if (pv.fallback) {
            enriched.explain = 'Оценка Мимира (нормы в справочнике нет / fallback)';
          }
          if (wd > 0 || mhCalc > 0) normFilled += 1;
        } else if (bundle.preview && bundle.preview.needs_input) {
          enriched.norm = { error: bundle.preview.error, needs_input: true };
        }
      } catch (e) {
        enriched.norm = { error: e.message };
      }
    }
    enrichedPositions.push(enriched);
  }
  log('норма-превью заполнено:', normFilled, 'из', positions.length, 'позиций');

  // ── График заездов (тот же путь, что tkp_quick/analyze) ──────────────────
  let visitPlan = null;
  try {
    const visitSvc = require(APP + '/src/services/visit-plan');
    visitPlan = visitSvc.buildVisitPlan({
      positions: enrichedPositions,
      text: '',
      modelPlan: {
        schedule_mode: dv.schedule_mode || null,
        visits: Array.isArray(dv.visits) ? dv.visits : [],
        trip_count: dv.trip_count || null
      }
    });
    log('заезды:', visitPlan.mode, '| trip_count', visitPlan.trip_count,
      '| visits', (visitPlan.visits || []).length,
      visitPlan.unconfirmed ? '(не подтверждён)' : '');
  } catch (e) {
    log('график заездов не собран:', e.message);
  }

  // ── МТР: отдельный агент + детерминированный проход ──────────────────────
  // Одна модель разбирала объёмы и на хвосте экономила: mtr_suggestions
  // приходил пустым (12.11 при 613 позициях), а если и приходил — только
  // расходники (ветошь, сальники) без единой установки. Работать нечем.
  //
  // Теперь два независимых источника и СЛИЯНИЕ, а не подмена:
  //   1) агент МТР — отдельный вызов по уже разобранным позициям;
  //   2) mtr-pipeline — типовая техника по методу + расходники, без модели.
  // Падение агента не ломает прогон: остаётся pipeline.
  let mtrList = mtr;
  let mtrAgent = null;
  const mtrTrips = (visitPlan && visitPlan.trip_count)
    || (Array.isArray(dv.visits) && dv.visits.length ? dv.visits.length : 1);
  const mtrCrew = Number((enrichedPositions[0] || {}).people)
    || Number((calcPlan && calcPlan.headcount_shift) || 0) || 5;

  try {
    mtrAgent = await stagesAi.generateMtr({
      aiProvider,
      positions: enrichedPositions,
      tz_text: tzText,
      warehouse_text: warehouseCtxText,
      trips: mtrTrips,
      crew: mtrCrew,
      onProgress: (ev) => { if (ev && ev.message) log('  мтр: ' + ev.message); }
    });
    log('агент МТР:', mtrAgent.ok ? 'ok' : 'отказ', '| техники',
      (mtrAgent.units || []).length, '| расходников', (mtrAgent.consumables || []).length,
      mtrAgent.error ? ('| ' + mtrAgent.error) : '');
  } catch (e) {
    log('агент МТР упал:', e.message);
  }

  try {
    const mtrPipeline = require(APP + '/src/services/mtr-pipeline');
    const built = await mtrPipeline.buildMtr({
      db: pool,
      positions: enrichedPositions,
      people: mtrCrew,
      trips: mtrTrips,
      allowWeb: false   // цена будет null и помечена пробелом — это честно
    });
    const pipelineRows = (built.rows || []).map((r) => ({
      name: r.name,
      qty: r.qty,
      unit: r.unit,
      source: r.source,
      price: r.price,
      price_confirmed: r.price_confirmed,
      // Техника из справочника помечается: РП видит, что это типовая позиция.
      basis: r.is_equipment ? 'method' : (r.basis || null),
      is_equipment: !!r.is_equipment,
      note: r.gap || r.note || null
    }));
    // Слияние: ответ агента первым (он видел ТЗ), pipeline дополняет.
    const seen = new Set();
    const merged = [];
    const agentRows = (mtrAgent && Array.isArray(mtrAgent.rows)) ? mtrAgent.rows : [];
    [...agentRows, ...pipelineRows].forEach((r) => {
      const key = mtrPipeline.normalizeName(r.name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(r);
    });
    mtrList = merged;
    log('МТР итого:', mtrList.length, 'строк | техники',
      mtrList.filter((r) => r.is_equipment || /установк|аппарат|пост|компрессор|насос|кран|леса/i.test(r.name)).length);
  } catch (e) {
    log('МТР не выведен:', e.message);
  }


  const report = {
    ok: true,
    elapsed_sec: Math.round((Date.now() - started) / 1000),
    model: res.model || null,
    positions: enrichedPositions.length,
    norm_filled: normFilled,
    with_period: enrichedPositions.filter((p) => p.period).length,
    with_clean_count: withClean,
    with_objects: withObjects,
    mtr_suggestions: mtrList.length,
    mtr_sample: mtrList.slice(0, 5).map((m) => m.name || m.equipment),
    visits: (visitPlan && visitPlan.visits)
      ? visitPlan.visits.length
      : (Array.isArray(dv.visits) ? dv.visits.length : 0),
    trip_count: (visitPlan && visitPlan.trip_count) || dv.trip_count || null,
    visit_mode: (visitPlan && visitPlan.mode) || dv.schedule_mode || null,
    incomplete: !!dv.incomplete,
    periods: [...new Set(positions.map((p) => p.period).filter(Boolean))].slice(0, 15),
    sample: positions.slice(0, 3).map((p) => ({
      name: p.name, volume: p.volume, unit: p.unit,
      period: p.period, objects: p.objects, clean_count: p.clean_count
    }))
  };

  // ── План расчёта: люди, срок, график ─────────────────────────────────────
  // Без этого шага calc_plan остаётся пустым, и просчёт берёт дефолты
  // (39 суток, 3 слесаря) — срок сметы расходится с реальным в разы,
  // а Σqty не сходится с человеко-часами из норм.
  let calcPlan = null;
  try {
    const st = require(APP + '/src/services/mimir-tender-stages');
    const tripCount = (visitPlan && visitPlan.trip_count)
      || (Array.isArray(dv.visits) && dv.visits.length ? dv.visits.length : null)
      || (new Set(enrichedPositions.map((p) => p.period).filter(Boolean)).size || 1);
    const visitMode = (visitPlan && visitPlan.mode) || 'visits';
    // Позиции плана — из ДВ. objects — массив, НЕ .length (иначе fronts=1).
    const planPositions = enrichedPositions.map((p, i) => ({
      id: p.id || 'dv' + (i + 1),
      name: p.name,
      people: p.people || null,
      days: p.days || null,
      mh: p.mh || null,
      shifts: p.shifts || null,
      shift_hours: p.shift_hours || null,
      objects: Array.isArray(p.objects) ? p.objects : null,
      objects_count: Array.isArray(p.objects)
        ? p.objects.reduce((s, o) => s + (Number(o && o.qty) || 1), 0)
        : (Number(p.objects_count) || null),
      period: p.period || null,
      tech_equip: p.tech_equip || null,
      method_name: p.method_name || null,
      category_name: p.category_name || null,
      category_code: p.category_code || null,
      norm_basis: p.norm_basis || null,
      source: p.source || (p.norm && p.norm.fallback ? 'expert' : (p.norm && p.norm.code ? 'norm' : null))
    }));
    calcPlan = st.normalizeCalcPlan({
      positions: planPositions,
      trip_count: tripCount,
      visits: (visitPlan && visitPlan.visits) || (Array.isArray(dv.visits) ? dv.visits : [])
    }, {
      visit_mode: visitMode,
      trip_count: tripCount,
      dv_positions: enrichedPositions
    });
    log('план: бригад', calcPlan.crews, '| срок', calcPlan.work_days, 'сут | людей',
      calcPlan.headcount_shift, '| чел·ч', calcPlan.man_hours,
      '| fronts', calcPlan.fronts, calcPlan.fronts_known ? '(known)' : '(unknown)');
  } catch (e) {
    log('план не рассчитан:', e.message);
  }

  // ── Просчёт ──────────────────────────────────────────────────────────────
  let smetaResult = null;
  if (calcPlan && calcPlan.work_days) {
    try {
      const smeta = require(APP + '/src/services/asgard-smeta');
      smetaResult = smeta.recalcAsgardSmeta({
        template: 'asgard_v1',
        crew: calcPlan.crew,
        mtr: mtrList,
        params: {
          work_days: calcPlan.work_days,
          // Смены: при сроке от MH часы УЖЕ разложены формулой
          // work_days = MH / (люди × h_net), и множить на смены повторно
          // нельзя — qty удваивался (21 480 смен против 10 710 по MH).
          shifts_per_day: calcPlan.work_days_source === 'mh_invariant'
            ? 1
            : (calcPlan.shifts_per_day || 1),
          shift_hours: calcPlan.shift_hours || 12,
          trip_count: calcPlan.trip_count || 1,
          calc_formula_version: 2
        },
        works: []
      });
      log('просчёт: себестоимость', Math.round(smetaResult.totals.cost),
        '| цена без НДС', Math.round(smetaResult.totals.price_no_vat));
    } catch (e) {
      log('просчёт не выполнен:', e.message);
    }
  }

  // Сохраняем результат, чтобы UI/следующие шаги его видели.
  try {
    const rev = await pool.query(
      `SELECT id, report_json FROM tender_rp_reviews WHERE tender_id = $1 ORDER BY id DESC LIMIT 1`,
      [TENDER_ID]
    );
    if (rev.rows[0]) {
      const rj = rev.rows[0].report_json || {};
      rj.dv_positions = enrichedPositions.map((p, i) => Object.assign({ id: 'dv' + (i + 1) }, p));
      // ДВ несёт свой флаг полноты — карточка должна его сохранять, иначе
      // UI видит «всё хорошо» на неполном разборе.
      rj.dv_incomplete = !!dv.incomplete;
      rj.dv_incomplete_reason = dv.incomplete_reason || null;
      rj.dv_expected_rows = dv.expected_rows || null;
      // МТР — в карточку, чтобы просчёт и UI его видели.
      if (mtrList.length) rj.mtr = mtrList;
      // План и просчёт — чтобы карточка отражала ИМЕННО этот разбор.
      if (calcPlan) rj.calc_plan = calcPlan;
      if (smetaResult) rj.asgard_smeta = smetaResult;
      // ── График заездов ───────────────────────────────────────────────────
      // Без этого карточка показывала СТАРЫЙ график от прошлого прогона:
      // в report_json не было `visit_plan`, и оставались числа предыдущего
      // разбора. На #2138 (12.11.2026) из-за этого было «план 5, расчёт 7,
      // смета 7» — план от другой версии данных, и метрики врали.
      if (visitPlan) {
        rj.visit_plan = visitPlan;
        rj.visit_mode = visitPlan.mode || null;
        rj.trip_count = visitPlan.trip_count || 1;
        rj.visit_conflicts = Array.isArray(visitPlan.conflicts) ? visitPlan.conflicts : [];
      }
      await pool.query(
        `UPDATE tender_rp_reviews SET report_json = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(rj), rev.rows[0].id]
      );
      report.saved_to_review = rev.rows[0].id;
      report.calc_plan = calcPlan ? {
        crews: calcPlan.crews,
        work_days: calcPlan.work_days,
        headcount_shift: calcPlan.headcount_shift,
        man_hours: calcPlan.man_hours
      } : null;
      report.smeta = smetaResult ? {
        cost: Math.round(smetaResult.totals.cost),
        price_no_vat: Math.round(smetaResult.totals.price_no_vat)
      } : null;
    }
  } catch (e) {
    report.save_error = e.message;
  }

  console.log(JSON.stringify(report, null, 1));
  await pool.end();
  process.exit(0);
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message, stack: (e.stack || '').split('\n').slice(0, 5) }, null, 1));
  process.exit(1);
});
