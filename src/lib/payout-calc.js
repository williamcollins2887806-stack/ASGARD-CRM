'use strict';

/**
 * payout-calc — ЕДИНЫЙ источник формул пересчёта «выплата → перевод».
 * ═══════════════════════════════════════════════════════════════════════════
 * Зачем: та же арифметика нужна серверу (/pay, /preview) и фронту (предпросмотр
 * баннера рабочего). Дублировать формулы в двух местах = гарантированный
 * рассинхрон при смене ставки. Поэтому сервер считает и отдаёт КОЭФФИЦИЕНТЫ,
 * фронт их только перемножает (см. public/assets/js/payouts.js).
 *
 * Формулы (решение заказчика 14.10.2026):
 *
 *   Самозанятый (площадка ReStaff):
 *     X = сколько выплачиваем (в счёт начисленного)
 *     рабочему показываем  info    = X × 1.064              ← ровно это видит рабочий
 *     реальный перевод     transfer = X × (1.064/0.96) × 1.22
 *     зашито: комиссия ReStaff 3.5%, НДС 22%.
 *     Пример: X = 100 000 ₽ → рабочему 106 400 ₽, перевод 135 216,67 ₽.
 *
 *   «Переводим официально» (не-СЗ, галка):
 *     transfer = X × 1.15  (+15%). Пример: 100 000 → 115 000 ₽.
 *
 *   Обычная наличка (не-СЗ, без галки):
 *     transfer = X  (либо сумма, введённая вручную «переводим рабочему»).
 *
 * ВАЖНО: коэффициент реального перевода СЗ — из settings.payout_se_transfer_coef,
 * а НЕ пересобирается каждый раз из ставок. Так система считает ровно ту сумму,
 * что согласована с площадкой; ставки хранятся отдельно для прозрачности.
 */

const DEFAULT_SE_INFO_COEF = 1.064;
const DEFAULT_SE_TRANSFER_COEF = (1.064 / 0.96) * 1.22; // ≈ 1.3521666667
const DEFAULT_OFFICIAL_MARKUP = 0.15;

/** Достаёт число из settings.value_json (может быть '0.06' или 0.06 или '"0.06"'). */
function parseSettingNumber(raw, fallback) {
  if (raw == null) return fallback;
  let v = raw;
  if (typeof v === 'string') {
    v = v.replace(/[^\d.\-]/g, '');
  }
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Читает настройки формулы из settings (одним запросом).
 * @returns {Promise<{seInfoCoef:number, seTransferCoef:number, seCommissionRate:number,
 *                    seVatRate:number, officialMarkupRate:number}>}
 */
async function loadPayoutCalcSettings(db) {
  const out = {
    seInfoCoef: DEFAULT_SE_INFO_COEF,
    seTransferCoef: DEFAULT_SE_TRANSFER_COEF,
    seCommissionRate: 0.035,
    seVatRate: 0.22,
    officialMarkupRate: DEFAULT_OFFICIAL_MARKUP,
  };
  try {
    const { rows } = await db.query(
      `SELECT key, value_json FROM settings WHERE key IN
        ('payout_se_info_coef','payout_se_transfer_coef','payout_se_commission_rate',
         'payout_se_vat_rate','payout_official_markup_rate')`
    );
    for (const r of rows) {
      const v = parseSettingNumber(r.value_json, null);
      if (v === null) continue;
      if (r.key === 'payout_se_info_coef') out.seInfoCoef = v;
      else if (r.key === 'payout_se_transfer_coef') out.seTransferCoef = v;
      else if (r.key === 'payout_se_commission_rate') out.seCommissionRate = v;
      else if (r.key === 'payout_se_vat_rate') out.seVatRate = v;
      else if (r.key === 'payout_official_markup_rate') out.officialMarkupRate = v;
    }
  } catch (_) { /* нет таблицы/ключей — дефолты */ }
  return out;
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

/**
 * Полный расчёт выплаты. ЕДИНАЯ точка истины для сервера.
 *
 * @param {object} o
 * @param {number} o.payAmount      — сколько выплачиваем (X), в счёт начисленного
 * @param {boolean} o.isSelfEmployed
 * @param {boolean} o.officialTransfer — галка «переводим официально» (только не-СЗ)
 * @param {number|null} [o.transferAmountManual] — ручное «переводим рабочему» (не-СЗ)
 * @param {object} o.settings       — из loadPayoutCalcSettings()
 * @returns {{payAmount:number, infoAmount:number, transferAmount:number,
 *            taxAmount:number, officialTransfer:boolean, method:'self'|'official'|'cash'}}
 */
function calcPayout(o) {
  const payAmount = round2(o.payAmount);
  const s = o.settings || {};
  const seInfoCoef = s.seInfoCoef != null ? s.seInfoCoef : DEFAULT_SE_INFO_COEF;
  const seTransferCoef = s.seTransferCoef != null ? s.seTransferCoef : DEFAULT_SE_TRANSFER_COEF;
  const officialMarkupRate = s.officialMarkupRate != null ? s.officialMarkupRate : DEFAULT_OFFICIAL_MARKUP;

  if (o.isSelfEmployed) {
    // Рабочему показываем только X × 1.064 (внутренняя кухня Рестаф/НДС скрыта).
    const infoAmount = round2(payAmount * seInfoCoef);
    const transferAmount = round2(payAmount * seTransferCoef);
    // tax_amount в факте = то, что реально добавляется сверх «выплачиваем».
    return {
      payAmount,
      infoAmount,
      transferAmount,
      taxAmount: round2(transferAmount - payAmount),
      officialTransfer: false,
      method: 'self',
    };
  }

  if (o.officialTransfer) {
    const transferAmount = round2(payAmount * (1 + officialMarkupRate));
    return {
      payAmount,
      infoAmount: transferAmount,
      transferAmount,
      taxAmount: round2(transferAmount - payAmount),
      officialTransfer: true,
      method: 'official',
    };
  }

  // Обычная наличка: либо ручная сумма перевода, либо 1:1.
  let transferAmount = payAmount;
  if (o.transferAmountManual != null && Number.isFinite(Number(o.transferAmountManual))) {
    const ta = round2(o.transferAmountManual);
    if (ta > 0) transferAmount = ta;
  }
  return {
    payAmount,
    infoAmount: transferAmount,
    transferAmount,
    taxAmount: round2(transferAmount - payAmount),
    officialTransfer: false,
    method: 'cash',
  };
}

module.exports = {
  loadPayoutCalcSettings,
  calcPayout,
  parseSettingNumber,
  round2,
  DEFAULT_SE_INFO_COEF,
  DEFAULT_SE_TRANSFER_COEF,
  DEFAULT_OFFICIAL_MARKUP,
};
