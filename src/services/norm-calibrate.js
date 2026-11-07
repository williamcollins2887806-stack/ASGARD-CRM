'use strict';

/**
 * Калибровка справочника норм по результатам просчёта.
 * ═══════════════════════════════════════════════════════════════════════════
 * ЗАЧЕМ (07.11.2026):
 * РП спросил: «обучается ли справочник после просчёта». Ответ был — нет.
 * Справочник пополнялся только вручную (mimir-apply), поэтому в журнале
 * норм было 10 записей с июля, а опыт — 2 строки на всю компанию.
 *
 * ЧТО ДЕЛАЕТ:
 * После каждого просчёта берёт позиции, по которым БЫЛА норма, и сверяет
 * расчёт с фактом. Если расхождение заметное — двигает норму к факту
 * (частично, «average»), чтобы не шарахать её от одного тендера.
 *
 * ЧЕГО НЕ ДЕЛАЕТ:
 *   • не трогает позиции без нормы (это не калибровка, а создание — для
 *     него есть createRateFromEstimate, и нужен реальный закрытый объём);
 *   • не калибрует по позициям, где объём выведен по паспорту
 *     (confidence low) — там не факт, а наша же оценка;
 *   • не двигает норму больше чем на 30 % за раз;
 *   • не пишет ничего без work_days > 0.
 */

const MAX_SHIFT_PCT = 30;

/** Округление до 4 значащих, чтобы не плодить хвосты в БД. */
function round4(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

/**
 * @param {object} db
 * @param {object} p
 * @param {Array} p.positions — позиции ДВ (с norm.code и volume)
 * @param {Array} p.calcPositions — позиции плана (people, days)
 * @param {number} [p.tenderId]
 * @param {object} [p.user]
 * @returns {Promise<{updated:number, created:number, skipped:number, details:Array}>}
 */
async function calibrateNormsFromCalc(db, p) {
  const o = p || {};
  const positions = Array.isArray(o.positions) ? o.positions : [];
  const calcPositions = Array.isArray(o.calcPositions) ? o.calcPositions : [];
  const workNorms = require('./work-norms');

  const byPositionId = new Map();
  for (const c of calcPositions) {
    const key = String(c.position_id || c.id || '');
    if (key) byPositionId.set(key, c);
  }

  const details = [];
  let updated = 0;
  let skipped = 0;

  for (const pos of positions) {
    const code = pos && pos.norm && pos.norm.code;

    // Сутки по позиции лежат в ПЛАНЕ (calc.positions), а не в самой позиции ДВ.
    // Дефект 07.11: проверка читала pos.days, где всегда undefined, поэтому
    // калибровка пропускала ВСЕ позиции (skipped=154 вместо работы).
    const planForPos = byPositionId.get(String(pos.id)) || null;
    const days = Number((planForPos && planForPos.days) || pos.days);
    if (!code || !(days > 0)) { skipped += 1; continue; }

    // Паспортные объёмы — не факт: калибровать по ним нельзя.
    if (/^passport/.test(String(pos.volume_source || ''))) {
      skipped += 1;
      details.push({ id: pos.id, skipped: 'passport_volume' });
      continue;
    }
    // Позиция не подтверждена (нет объёма, нет категории) — тоже не факт.
    if (pos.volume == null || !pos.category_code) {
      skipped += 1;
      details.push({ id: pos.id, skipped: 'no_volume_or_category' });
      continue;
    }

    const plan = planForPos;
    const workers = Number((plan && plan.people) || pos.people) || null;

    // Пересчёт входа в норму — тем же путём, что при просчёте.
    let inputs;
    try {
      const { inputsForPosition } = require('./norm-inputs');
      const catalog = await workNorms.loadCatalog(db, { category: pos.category_code });
      inputs = inputsForPosition(pos, catalog);
    } catch (_) {
      skipped += 1;
      details.push({ id: pos.id, skipped: 'inputs_failed' });
      continue;
    }
    if (!inputs || !Object.keys(inputs).length) {
      skipped += 1;
      details.push({ id: pos.id, skipped: 'no_inputs' });
      continue;
    }

    // Проверяем, что расхождение вообще есть: без этого норму не трогаем.
    let preview = null;
    try {
      // previewCalc ждёт category_code/method_code — не category/method.
      // Дефект 07.11: с неверными именами он отвечал «Нет нормы для этой
      // категории/метода», и калибровка пропускала ВСЕ позиции.
      preview = await workNorms.previewCalc(db, {
        category_code: pos.category_code,
        method_code: pos.method_code,
        rate_code: code,
        inputs,
        fouling: pos.fouling || 'medium'
      });
    } catch (_) { /* нормы могло не стать — пропускаем */ }

    const normDays = preview && preview.ok && preview.results && preview.results.work_days;
    if (!(Number(normDays) > 0)) { skipped += 1; continue; }

    // План округляет сутки до целых, поэтому у мелких позиций («0.4 сут → 1»)
    // расхождение фиктивное: 1 vs 0.4 даёт +150 %. Калибровать по этому
    // нельзя — норма «съедет» на округлении. Берём только позиции, где
    // расчёт даёт хотя бы 2 суток: там округление ≤ 25 %.
    if (Number(normDays) < 2) {
      skipped += 1;
      details.push({ id: pos.id, skipped: 'too_small_for_calibration', norm_days: round4(normDays) });
      continue;
    }

    const deltaPct = ((days - Number(normDays)) / Number(normDays)) * 100;
    if (Math.abs(deltaPct) < 5) {
      // Меньше 5 % — шум округления, норму не двигаем.
      skipped += 1;
      details.push({ id: pos.id, skipped: 'within_noise', delta_pct: round4(deltaPct) });
      continue;
    }

    // Защита от шараханья: не больше MAX_SHIFT_PCT за раз.
    const applied = Math.max(-MAX_SHIFT_PCT, Math.min(MAX_SHIFT_PCT, deltaPct));

    try {
      const res = await workNorms.applyNormPatchFromSmetaEdit(db, {
        rate_code: code,
        category_code: pos.category_code,
        inputs,
        work_days: Number(normDays) * (1 + applied / 100),
        workers_per_shift: workers || undefined,
        mode: 'average',
        comment: `Просчёт тендера #${o.tenderId || '—'} от 07.11: `
          + `было ${round4(normDays)} сут, по ДВ ${round4(days)} сут `
          + `(${deltaPct > 0 ? '+' : ''}${round4(deltaPct)} %, применено ${round4(applied)} %)`
      }, o.user);
      updated += 1;
      details.push({ id: pos.id, rate_code: code, delta_pct: round4(deltaPct), applied_pct: round4(applied), ok: true, message: res && res.message });
    } catch (e) {
      skipped += 1;
      details.push({ id: pos.id, rate_code: code, error: String(e.message).slice(0, 120) });
    }
  }

  return { updated, created: 0, skipped, details };
}

module.exports = { calibrateNormsFromCalc, MAX_SHIFT_PCT };
