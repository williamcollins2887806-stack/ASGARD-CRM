'use strict';

/** Коды причин — дублируют seed V462 / LOSS_REASON_LABELS в tenders-registry.js */
const LOSS_REASON_CODES = new Set([
  'price', 'deadline', 'qual', 'docs', 'lobby', 'cancel', 'nobid'
]);

const LOSS_REASON_LABELS = {
  price: 'Цена выше конкурентов',
  deadline: 'Сроки / график не устроили',
  qual: 'Не прошли квалификацию / допуск',
  docs: 'Ошибка или неполнота документов',
  lobby: 'Предпочтение другому подрячику',
  cancel: 'Закупка отменена / не состоялась',
  nobid: 'Не подали заявку'
};

/** Легаси free-text из модалки «Тендеры» → код V462. */
const LEGACY_LOSS_TEXT_TO_CODE = {
  'Цена выше конкурента': 'price',
  'Сроки не подошли заказчику': 'deadline',
  'Выбрали другого подрядчика': 'lobby',
  'Не прошли квалификацию': 'qual',
  'Отказались от выполнения': 'nobid',
  'Технические требования': 'qual',
  'Конкурент с админ. ресурсом': 'lobby',
  'Другое': 'docs'
};

function normalizeLossReasonCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (LOSS_REASON_CODES.has(s)) return s;
  return LEGACY_LOSS_TEXT_TO_CODE[s] || null;
}

function parseOptionalNum(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(raw) {
  const n = parseOptionalNum(raw);
  if (n == null) return null;
  const i = Math.trunc(n);
  return Number.isFinite(i) ? i : null;
}

function computeLossPriceGapPct(ourNoVat, winnerNoVat) {
  if (!(Number.isFinite(ourNoVat) && Number.isFinite(winnerNoVat) && winnerNoVat > 0)) return null;
  return Math.round(((ourNoVat - winnerNoVat) / winnerNoVat) * 10000) / 100;
}

/**
 * Собирает поля аналитики проигрыша из тела запроса и текущей строки tenders.
 * @returns {object|null} null если body пуст по расширенным полям
 */
function buildLossAnalyticsFields(body, tenderRow) {
  const b = body || {};
  const t = tenderRow || {};

  const vatPct = b.vat_pct != null && b.vat_pct !== ''
    ? Number(b.vat_pct)
    : (t.vat_pct != null ? Number(t.vat_pct) : 22);

  let ourNoVat = parseOptionalNum(b.our_price_no_vat);
  let ourWithVat = parseOptionalNum(b.our_price_with_vat);
  if (ourNoVat == null && ourWithVat == null && t.submission_price != null) {
    ourNoVat = Number(t.submission_price);
  }
  if (ourWithVat == null && ourNoVat != null && Number.isFinite(vatPct)) {
    ourWithVat = Math.round(ourNoVat * (1 + vatPct / 100) * 100) / 100;
  }
  if (ourNoVat == null && ourWithVat != null && Number.isFinite(vatPct) && vatPct >= 0) {
    ourNoVat = Math.round((ourWithVat / (1 + vatPct / 100)) * 100) / 100;
  }

  let winnerNoVat = parseOptionalNum(b.winner_price_no_vat);
  let winnerWithVat = parseOptionalNum(b.winner_price_with_vat);
  const legacyWinner = parseOptionalNum(b.winner_price);
  if (winnerNoVat == null && winnerWithVat == null && legacyWinner != null) {
    winnerNoVat = legacyWinner;
  }
  if (winnerWithVat == null && winnerNoVat != null && Number.isFinite(vatPct)) {
    winnerWithVat = Math.round(winnerNoVat * (1 + vatPct / 100) * 100) / 100;
  }

  const nmck = parseOptionalNum(b.nmck_snapshot)
    ?? parseOptionalNum(t.tender_price)
    ?? parseOptionalNum(t.estimated_sum);

  const lossPlace = parseOptionalInt(b.loss_place);
  const participants = parseOptionalInt(b.participants_count);

  let lossReasonCode = b.loss_reason_code != null && String(b.loss_reason_code).trim()
    ? String(b.loss_reason_code).trim()
    : null;
  if (!lossReasonCode && Array.isArray(b.loss_reasons) && b.loss_reasons.length) {
    lossReasonCode = normalizeLossReasonCode(b.loss_reasons[0]) || String(b.loss_reasons[0]);
  }
  if (!lossReasonCode && b.reject_reason) {
    lossReasonCode = normalizeLossReasonCode(b.reject_reason);
  }
  if (lossReasonCode && !LOSS_REASON_CODES.has(lossReasonCode)) {
    lossReasonCode = normalizeLossReasonCode(lossReasonCode);
  }

  let lossReport = b.loss_report;
  if (lossReport != null && typeof lossReport === 'string' && lossReport.trim()) {
    lossReport = { text: lossReport.trim() };
  } else if (lossReport != null && typeof lossReport !== 'object') {
    lossReport = null;
  }

  const resultAt = b.result_at ? new Date(b.result_at) : null;
  const resultAtValid = resultAt && Number.isFinite(resultAt.getTime()) ? resultAt : null;

  const gap = computeLossPriceGapPct(ourNoVat, winnerNoVat);

  return {
    our_price_no_vat: ourNoVat,
    our_price_with_vat: ourWithVat,
    nmck_snapshot: nmck,
    winner_inn: b.winner_inn != null && String(b.winner_inn).trim()
      ? String(b.winner_inn).trim().slice(0, 12) : null,
    winner_price_no_vat: winnerNoVat,
    winner_price_with_vat: winnerWithVat,
    loss_winner_price: winnerNoVat,
    loss_place: lossPlace,
    participants_count: participants,
    loss_price_gap_pct: gap,
    loss_report: lossReport,
    loss_reason_code: lossReasonCode,
    result_protocol_url: b.result_protocol_url != null && String(b.result_protocol_url).trim()
      ? String(b.result_protocol_url).trim() : null,
    result_at: resultAtValid
  };
}

/**
 * Upsert строк протокола в tender_competitors (V461).
 */
async function upsertTenderCompetitors(db, tenderId, competitors, opts = {}) {
  if (!Array.isArray(competitors) || !competitors.length) return { upserted: 0 };
  const source = opts.source || 'manual';
  let upserted = 0;
  for (const row of competitors) {
    if (!row || row.place == null) continue;
    const place = parseOptionalInt(row.place);
    if (place == null || place < 1) continue;
    await db.query(
      `INSERT INTO tender_competitors
         (tender_id, place, company_name, company_inn, price_no_vat, price_with_vat,
          is_winner, source, protocol_url, raw_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (tender_id, place) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         company_inn = EXCLUDED.company_inn,
         price_no_vat = EXCLUDED.price_no_vat,
         price_with_vat = EXCLUDED.price_with_vat,
         is_winner = EXCLUDED.is_winner,
         source = EXCLUDED.source,
         protocol_url = COALESCE(EXCLUDED.protocol_url, tender_competitors.protocol_url),
         raw_json = COALESCE(EXCLUDED.raw_json, tender_competitors.raw_json)`,
      [
        tenderId,
        place,
        row.company_name != null ? String(row.company_name) : null,
        row.company_inn != null ? String(row.company_inn).slice(0, 12) : null,
        parseOptionalNum(row.price_no_vat),
        parseOptionalNum(row.price_with_vat),
        row.is_winner === true || row.is_winner === 'true' || row.is_winner === 1,
        row.source != null ? String(row.source) : source,
        row.protocol_url != null ? String(row.protocol_url) : null,
        row.raw_json != null ? JSON.stringify(row.raw_json) : null
      ]
    );
    upserted += 1;
  }
  return { upserted };
}

module.exports = {
  LOSS_REASON_CODES,
  LOSS_REASON_LABELS,
  LEGACY_LOSS_TEXT_TO_CODE,
  normalizeLossReasonCode,
  buildLossAnalyticsFields,
  upsertTenderCompetitors,
  computeLossPriceGapPct,
  parseOptionalNum
};
