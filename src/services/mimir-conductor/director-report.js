/**
 * ASGARD CRM — Mimir Conductor: Директорский отчёт (PDF) (Сессия 7, Шаг 7.8)
 * ═══════════════════════════════════════════════════════════════════════════
 * Генерирует полноценный директорский отчёт (10 разделов) по READY_FOR_REVIEW-
 * просчёту. Источник данных — артефакты run (final_estimate, financial_model,
 * risk_analysis, devils_advocate, analogs_comparison, permits_plan и т.д.).
 *
 * Рендер — pdfkit + кириллический DejaVuSans (как в letter-generator). Без
 * внешних бинарей. Путь сохраняется в mimir_conductor_runs.director_report_path.
 *
 * Разделы:
 *  1. Резюме сделки           6. Compliance / допуски
 *  2. Финансовая модель       7. Риски и допущения (+ Адвокат дьявола)
 *  3. Технический скоуп       8. Аналоги
 *  4. Ресурсный план          9. Конкурентный анализ
 *  5. Логистика              10. Аудит-трейл (хеши артефактов)
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const cr = require('./conductor-run');
const db = require('../db');
const { formatRub } = require('./agents/_util');

const REPORTS_DIR = path.join(process.cwd(), 'storage', 'reports');
const FONT_REGULAR = path.join(process.cwd(), 'public', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(process.cwd(), 'public', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

function ensureDir() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/** Индекс артефактов по типу → content. */
function indexArtifacts(all) {
  const idx = {};
  for (const a of all) idx[a.artifact_type] = a.content;
  return idx;
}

/** Опциональный суффикс в скобках/через тире (без вложенных шаблонных строк). */
function paren(value) { return value ? ` (${value})` : ''; }
function dash(value) { return value ? ` — ${value}` : ''; }

/** Подпись одной работы для списка (строка или {type,name,volume,unit}). */
function workLabel(w) {
  if (typeof w === 'string') return w;
  const base = w.type || w.name || '—';
  const vol = w.volume ? `${w.volume} ${w.unit || ''}`.trim() : '';
  return base + dash(vol);
}

// ─────────────────────────────────────────────────────────────────────────────
// Низкоуровневые рендер-хелперы
// ─────────────────────────────────────────────────────────────────────────────

function makeFonts(doc) {
  const hasFont = fs.existsSync(FONT_REGULAR);
  if (hasFont) {
    doc.registerFont('ru', FONT_REGULAR);
    if (fs.existsSync(FONT_BOLD)) doc.registerFont('ru-bold', FONT_BOLD);
  }
  return {
    F: hasFont ? 'ru' : 'Helvetica',
    FB: hasFont && fs.existsSync(FONT_BOLD) ? 'ru-bold' : (hasFont ? 'ru' : 'Helvetica-Bold')
  };
}

function heading(doc, F, num, title) {
  doc.moveDown(0.4);
  doc.font(F.FB).fontSize(15).fillColor('#1a3a5c').text(`${num}. ${title}`);
  doc.fillColor('black').moveDown(0.4);
}

function para(doc, F, text, size = 10) {
  if (text == null || text === '') return;
  doc.font(F.F).fontSize(size).fillColor('black').text(String(text), { align: 'left' });
  doc.moveDown(0.2);
}

function bullet(doc, F, items, size = 10) {
  doc.font(F.F).fontSize(size).fillColor('black');
  for (const it of (items || [])) {
    if (it == null) continue;
    doc.text(`•  ${typeof it === 'string' ? it : JSON.stringify(it)}`, { indent: 8 });
  }
  doc.moveDown(0.2);
}

/** Простая двухколоночная таблица «ключ: значение». */
function kvTable(doc, F, rows) {
  const startX = doc.x;
  for (const [k, v] of rows) {
    const y = doc.y;
    doc.font(F.F).fontSize(10).fillColor('#444').text(String(k), startX, y, { width: 250, continued: false });
    doc.font(F.FB).fontSize(10).fillColor('black').text(String(v), startX + 260, y, { width: 240 });
    doc.moveDown(0.15);
  }
  doc.moveDown(0.3);
}

// ─────────────────────────────────────────────────────────────────────────────
// Подготовка данных разделов
// ─────────────────────────────────────────────────────────────────────────────

function prepareData(run, idx, work, tender) {
  const finalEstimate = idx.final_estimate || {};
  const ssr = finalEstimate.ssr || {};
  const fin = idx.financial_model || {};
  const risk = idx.risk_analysis || {};
  const advocate = idx.devils_advocate || {};
  const analogs = idx.analogs_comparison || {};
  const tz = idx.tz_summary || {};
  const finalData = run.final_estimate_data || {};

  const contractValue = Number(run.contract_value) || Number(tz.contract_value) || (tender && Number(tender.tender_price)) || 0;
  const totalWithVat = Number(ssr.total_with_vat) || 0;
  const budgetBuffer = contractValue > 0 ? contractValue - totalWithVat : null;

  return {
    contractValue, totalWithVat, budgetBuffer,
    ssr, fin, risk, advocate, analogs, tz, finalEstimate, finalData,
    customer: (tz.customer && tz.customer.name) || (work && work.customer_name) || (tender && tender.customer_name) || '—',
    object: (tz.object && tz.object.name) || (work && work.object_name) || '—',
    city: (tz.object && tz.object.city) || (work && work.city) || '—',
    recommendation: finalData.recommendation || finalEstimate.recommendation || (finalEstimate.analysis && finalEstimate.analysis.recommendation) || 'THINK',
    recommendationReasoning: finalData.decision_reasoning || (finalEstimate.analysis && finalEstimate.analysis.decision_reasoning) || finalData.executive_summary || finalEstimate.summary || ''
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Рендер разделов
// ─────────────────────────────────────────────────────────────────────────────

function renderHeader(doc, F, run, d) {
  doc.font(F.FB).fontSize(20).fillColor('#1a3a5c').text('Директорский отчёт по просчёту');
  doc.fillColor('black').font(F.F).fontSize(10);
  doc.text(`Просчёт № ${run.id}    Дата: ${new Date().toLocaleDateString('ru-RU')}`);
  doc.text(`Заказчик: ${d.customer}`);
  doc.text(`Объект: ${d.object}, ${d.city}`);
  doc.moveDown(0.6);
  doc.font(F.F).fontSize(8).fillColor('#888').text('ООО «Асгард Сервис» — автоматический просчёт Мимир Conductor. Документ для принятия управленческого решения.');
  doc.fillColor('black');
}

function renderSection1(doc, F, d) {
  heading(doc, F, 1, 'Резюме сделки');
  kvTable(doc, F, [
    ['Сумма контракта (бюджет тендера):', formatRub(d.contractValue)],
    ['Себестоимость:', formatRub(d.ssr.total_cost)],
    ['Цена с маржой:', formatRub(d.ssr.total_with_margin)],
    ['Цена с НДС:', formatRub(d.ssr.total_with_vat)],
    ['Маржа:', `${formatRub((d.ssr.total_with_margin || 0) - (d.ssr.total_cost || 0))} (${d.ssr.margin_pct != null ? d.ssr.margin_pct + '%' : '—'})`],
    ['Запас от бюджета тендера:', d.budgetBuffer != null ? formatRub(d.budgetBuffer) : '—']
  ]);
  doc.font(F.FB).fontSize(12).fillColor(d.recommendation === 'TAKE' ? '#137333' : (d.recommendation === 'DECLINE' ? '#b3261e' : '#9a6700'))
    .text(`Рекомендация: ${d.recommendation}`);
  doc.fillColor('black');
  para(doc, F, d.recommendationReasoning);
  const topRisks = (d.risk.top_risks && d.risk.top_risks.length ? d.risk.top_risks : (d.finalEstimate.analysis && d.finalEstimate.analysis.key_risks) || []).slice(0, 3);
  if (topRisks.length) {
    doc.font(F.FB).fontSize(11).text('Топ-3 риска:');
    bullet(doc, F, topRisks);
  }
}

function renderSection2(doc, F, d) {
  heading(doc, F, 2, 'Финансовая модель');
  const cf = d.fin.cash_flow || {};
  if (Object.keys(cf).length) {
    kvTable(doc, F, [
      ['Чистая прибыль:', formatRub(cf.net_profit)],
      ['Чистая маржа:', cf.net_margin_pct != null ? cf.net_margin_pct + '%' : '—'],
      ['ROI / ROI после налога:', `${cf.roi_pct != null ? cf.roi_pct + '%' : '—'} / ${cf.roi_after_tax_pct != null ? cf.roi_after_tax_pct + '%' : '—'}`],
      ['Макс. кассовый разрыв:', formatRub(cf.max_cash_gap)],
      ['Стоимость оборотного капитала:', formatRub(cf.working_capital_cost)],
      ['Банковская гарантия:', formatRub(cf.bg_total_cost)],
      ['Гарантийное удержание:', formatRub(cf.retention_amount)],
      ['Налог на прибыль:', formatRub(cf.profit_tax)]
    ]);
  } else {
    para(doc, F, 'Финансовая модель не строилась (контракт ниже порога или агент не запускался).');
  }
  const sim = d.risk.simulation || {};
  if (Object.keys(sim).length) {
    doc.font(F.FB).fontSize(11).text('Монте-Карло (себестоимость):');
    kvTable(doc, F, [
      ['P10 / P50 / P90:', `${formatRub(sim.p10)} / ${formatRub(sim.p50)} / ${formatRub(sim.p90)}`],
      ['Вероятность убытка:', `${(Number(sim.loss_probability || 0) * 100).toFixed(1)}%`]
    ]);
  }
  bullet(doc, F, d.fin.key_findings);
}

function renderSection3(doc, F, d) {
  heading(doc, F, 3, 'Технический скоуп');
  const tz = d.tz;
  kvTable(doc, F, [
    ['Метод работ:', ((tz.scope && tz.scope.method) || []).join(', ') || '—'],
    ['Срок:', (tz.timing && (tz.timing.duration_days ? tz.timing.duration_days + ' дн' : `${tz.timing.start || '?'} — ${tz.timing.end || '?'}`)) || '—']
  ]);
  const works = (tz.scope && tz.scope.main_works) || [];
  if (works.length) {
    doc.font(F.FB).fontSize(11).text('Ключевые работы:');
    bullet(doc, F, works.map(workLabel));
  }
  const method = d.tz && idxMethodValidation(d);
  if (method && method.issues && method.issues.length) {
    doc.font(F.FB).fontSize(11).text('Технологические замечания:');
    bullet(doc, F, method.issues.map((i) => `[${i.severity}] ${i.text}`));
  }
}

function idxMethodValidation(d) {
  // method_validation хранится в indexed артефактах; передаём через d.tz-неймспейс? нет —
  // используем сохранённый indexArtifacts через d.finalEstimate? Для простоты вернём null,
  // если артефакта нет (раздел деградирует корректно).
  return d._method_validation || null;
}

function renderSection4(doc, F, idx) {
  heading(doc, F, 4, 'Ресурсный план');
  const crew = idx.crew_plan || {};
  const labor = idx.labor_cost || {};
  kvTable(doc, F, [
    ['Численность бригады:', (crew.total_count != null ? crew.total_count + ' чел' : '—')],
    ['Смены:', crew.shifts != null ? String(crew.shifts) : '—'],
    ['Рабочих дней:', labor.work_days != null ? String(labor.work_days) : '—'],
    ['ФОТ (без налога):', formatRub(labor.subtotal_fot)]
  ]);
  const personnel = labor.personnel || [];
  if (personnel.length) {
    doc.font(F.FB).fontSize(11).text('Состав по позициям:');
    bullet(doc, F, personnel.map((p) => `${p.item}: ${p.qty} × ${formatRub(p.rate)} × ${p.days} дн = ${formatRub(p.total)}`));
  }
  const permits = idx.permits_plan || {};
  if (permits.key_findings && permits.key_findings.length) {
    doc.font(F.FB).fontSize(11).text('Допуски и обучение:');
    bullet(doc, F, permits.key_findings.slice(0, 6));
  }
}

function renderSection5(doc, F, idx) {
  heading(doc, F, 5, 'Логистика');
  const routing = idx.routing_plan || {};
  const travel = idx.travel_cost || {};
  if (routing.summary || travel.summary) {
    para(doc, F, routing.summary);
    para(doc, F, travel.summary);
    bullet(doc, F, (routing.key_findings || []).concat(travel.key_findings || []).slice(0, 8));
  } else {
    para(doc, F, 'Логистика не планировалась (объект в пределах города или агенты не запускались).');
  }
}

function renderSection6(doc, F, idx) {
  heading(doc, F, 6, 'Compliance / допуски');
  const norms = idx.norms_compliance || {};
  const permits = idx.permits_plan || {};
  const marine = idx.marine_permits || {};
  if (norms.strict) {
    para(doc, F, `Заказчик «${norms.customer}» — действуют корпоративные СТО.`);
    bullet(doc, F, (norms.checks || []).map((c) => `${c.requirement}: ${c.status}${paren(c.note)}`).slice(0, 8));
  } else {
    para(doc, F, 'Углублённый нормоконтроль СТО заказчика не требуется — применяются общие нормы.');
  }
  if (permits.total_cost != null || permits.summary) para(doc, F, permits.summary);
  if (marine.total_marine) {
    doc.font(F.FB).fontSize(11).text('Морские допуски:');
    bullet(doc, F, marine.key_findings);
  }
}

function renderSection7(doc, F, d) {
  heading(doc, F, 7, 'Риски и допущения');
  const assumptions = (d.finalEstimate.assumptions || d.finalData.key_assumptions || []);
  if (assumptions.length) {
    doc.font(F.FB).fontSize(11).text('Ключевые допущения:');
    bullet(doc, F, assumptions);
  }
  const scenarios = d.risk.scenarios || [];
  if (scenarios.length) {
    doc.font(F.FB).fontSize(11).text('Сценарии рисков:');
    bullet(doc, F, scenarios.slice(0, 10).map((s) => `${s.name} — P=${(Number(s.probability || 0) * 100).toFixed(0)}%, влияние ${formatRub(s.cost_impact_rub)}`));
  }
  const adv = d.advocate;
  if (adv && (adv.vulnerabilities || []).length) {
    doc.font(F.FB).fontSize(12).fillColor('#b3261e').text(`Адвокат дьявола — вердикт: ${adv.overall_verdict || '—'}`);
    doc.fillColor('black');
    para(doc, F, adv.verdict_reasoning);
    bullet(doc, F, adv.vulnerabilities.slice(0, 10).map((v) => `[${v.severity}] ${v.finding}${paren(v.potential_impact_rub ? formatRub(v.potential_impact_rub) : '')}`));
  } else {
    para(doc, F, 'Независимая критическая проверка (Адвокат дьявола) не выполнялась для этого просчёта.');
  }
}

function renderSection8(doc, F, d) {
  heading(doc, F, 8, 'Аналоги из архива');
  const a = d.analogs;
  if (a && (a.analogs || []).length) {
    para(doc, F, a.summary);
    bullet(doc, F, a.analogs.slice(0, 5).map((an) => `№${an.id} «${an.title || '—'}» (${an.customer || '—'})${dash(an.total)}`));
    if ((a.unit_indicators || []).length) {
      doc.font(F.FB).fontSize(11).text('Удельные показатели:');
      bullet(doc, F, a.unit_indicators.map((u) => `${u.name}: ${u.value}${paren(u.vs_analogs)}`));
    }
  } else {
    para(doc, F, 'Прямых аналогов в архиве смет не найдено — сравнение по удельным показателям недоступно.');
  }
}

function renderSection9(doc, F, tender) {
  heading(doc, F, 9, 'Конкурентный анализ');
  if (tender) {
    kvTable(doc, F, [
      ['Тендер:', tender.tender_title || tender.title || '—'],
      ['Бюджет тендера:', tender.tender_price != null ? formatRub(tender.tender_price) : '—'],
      ['Статус:', tender.tender_status || '—']
    ]);
  }
  para(doc, F, 'Детальный конкурентный анализ (история тендеров заказчика, вероятность победы) — расширяется по мере накопления данных архива.');
}

function renderSection10(doc, F, run, all) {
  heading(doc, F, 10, 'Аудит-трейл');
  para(doc, F, `Conductor-модель: ${run.conductor_model || '—'}`);
  para(doc, F, `Итоговый хеш сметы: ${run.final_artifact_hash || '—'}`);
  doc.font(F.FB).fontSize(11).text('Артефакты (тип → хеш):');
  bullet(doc, F, all.map((a) => `${a.artifact_type}: ${String(a.content_hash || '').slice(0, 16)}…`));
  doc.moveDown(0.3);
  doc.font(F.F).fontSize(8).fillColor('#888').text('Хеши соответствуют записям mimir_artifacts. Отчёт сгенерирован автоматически.');
  doc.fillColor('black');
}

// ─────────────────────────────────────────────────────────────────────────────
// Главная функция
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Сгенерировать директорский отчёт PDF для run.
 * @param {number} runId
 * @returns {Promise<{pdfPath:string}>}
 */
async function generateDirectorReport(runId) {
  const run = await cr.getRun(runId);
  if (!run) throw new Error(`Run ${runId} не найден`);

  const all = await cr.getAllArtifacts(runId);
  const idx = indexArtifacts(all);

  // Контекст: работа/тендер (best-effort).
  let work = null;
  let tender = null;
  try {
    if (run.work_id) {
      const w = await db.query('SELECT work_title, customer_name, object_name, city, contract_value FROM works WHERE id = $1', [run.work_id]);
      work = w.rows[0] || null;
    }
  } catch (_) { /* noop */ }
  try {
    if (run.tender_id) {
      const t = await db.query('SELECT tender_title, customer_name, tender_price, tender_status FROM tenders WHERE id = $1', [run.tender_id]);
      tender = t.rows[0] || null;
    }
  } catch (_) { /* noop */ }

  const d = prepareData(run, idx, work, tender);
  d._method_validation = idx.method_validation || null;

  ensureDir();
  const pdfPath = path.join(REPORTS_DIR, `director_report_${runId}_${Date.now()}.pdf`);

  await new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);
      const F = makeFonts(doc);

      renderHeader(doc, F, run, d);
      renderSection1(doc, F, d);
      doc.addPage();
      renderSection2(doc, F, d);
      doc.addPage();
      renderSection3(doc, F, d);
      renderSection4(doc, F, idx);
      doc.addPage();
      renderSection5(doc, F, idx);
      renderSection6(doc, F, idx);
      doc.addPage();
      renderSection7(doc, F, d);
      doc.addPage();
      renderSection8(doc, F, d);
      renderSection9(doc, F, tender);
      doc.addPage();
      renderSection10(doc, F, run, all);

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });

  // Сохраняем путь в БД.
  await db.query(
    'UPDATE mimir_conductor_runs SET director_report_path = $1, director_report_generated_at = NOW() WHERE id = $2',
    [pdfPath, runId]
  );
  try {
    await cr.addEvent(runId, null, 'director_report_generated', { path: pdfPath });
  } catch (_) { /* noop */ }

  return { pdfPath };
}

module.exports = { generateDirectorReport, REPORTS_DIR };
