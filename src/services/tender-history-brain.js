'use strict';

function defaultExtractKeyword(text) {
  if (!text) return null;
  const STOP = new Set(['работ', 'работа', 'объект', 'цех', 'очистка', 'для', 'без', 'при', 'согласно', 'название']);
  const words = String(text).toLowerCase()
    .replace(/[«»"'\(\)\[\],.\d№#]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOP.has(w));
  return words[0] || null;
}

function median(nums) {
  const arr = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function pctDelta(our, theirs) {
  if (!(Number.isFinite(our) && Number.isFinite(theirs) && theirs > 0)) return null;
  return Math.round(((our - theirs) / theirs) * 1000) / 10;
}

function formatRub(n) {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('ru-RU') + ' ₽';
}

function firstLossReasonCode(row) {
  if (row.loss_reason_code) return row.loss_reason_code;
  let lr = row.loss_reasons;
  if (typeof lr === 'string') {
    try { lr = JSON.parse(lr); } catch (_) { lr = null; }
  }
  if (Array.isArray(lr) && lr.length) return lr[0];
  return null;
}

/**
 * Компактный блок истории для промпта Mimir (A3).
 * @param {object} db — pg client
 * @param {object} tender — строка tenders
 * @returns {Promise<string>} markdown-текст
 */
async function buildHistoryBlock(db, tender) {
  if (!tender) return '(нет данных тендера)';

  const customerInn = tender.customer_inn ? String(tender.customer_inn).trim() : null;
  const customerName = tender.customer_name ? String(tender.customer_name).trim() : null;
  if (!customerInn && (!customerName || customerName.length < 2)) {
    return '(заказчик не указан — история недоступна)';
  }

  const params = [];
  let where = 'WHERE t.deleted_at IS NULL AND (';
  const parts = [];
  if (customerInn) {
    params.push(customerInn);
    parts.push(`t.customer_inn = $${params.length}`);
  }
  if (customerName) {
    params.push(customerName);
    parts.push(`t.customer_name = $${params.length}`);
  }
  where += parts.join(' OR ') + ')';

  let rows = [];
  try {
    const res = await db.query(
      `SELECT t.id, t.tender_title, t.registry_status, t.tender_status,
              t.submission_price, t.our_price_no_vat, t.winner_price_no_vat,
              t.loss_winner_price, t.loss_reason_code, t.loss_reasons,
              t.loss_price_gap_pct, t.winner_inn, t.winner_name, t.lost_at, t.won_at,
              t.tender_price, t.estimated_sum
         FROM tenders t
         ${where}
         ORDER BY COALESCE(t.lost_at, t.won_at, t.updated_at) DESC NULLS LAST
         LIMIT 40`,
      params
    );
    rows = res.rows;
  } catch (e) {
    return `(ошибка загрузки истории: ${e.message})`;
  }

  const wins = rows.filter((r) => r.registry_status === 'выиграли' || r.tender_status === 'Выиграли');
  const losses = rows.filter((r) => r.registry_status === 'проиграли' || r.tender_status === 'Проиграли');

  const lines = [];
  lines.push(`Заказчик: ${customerName || '—'}${customerInn ? ` (ИНН ${customerInn})` : ''}`);
  lines.push(`Тендеров в выборке: ${rows.length} · выиграли: ${wins.length} · проиграли: ${losses.length}`);

  const reasonCounts = {};
  for (const r of losses) {
    const code = firstLossReasonCode(r);
    if (code) reasonCounts[code] = (reasonCounts[code] || 0) + 1;
  }
  if (Object.keys(reasonCounts).length) {
    lines.push('Частые причины проигрыша: ' + Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k}×${v}`)
      .join(', '));
  }

  const ourPrices = rows.map((r) =>
    Number(r.our_price_no_vat ?? r.submission_price)).filter((n) => Number.isFinite(n) && n > 0);
  const winPrices = losses.map((r) =>
    Number(r.winner_price_no_vat ?? r.loss_winner_price)).filter((n) => Number.isFinite(n) && n > 0);
  const medOur = median(ourPrices);
  const medWin = median(winPrices);
  if (medOur != null || medWin != null) {
    lines.push(`Медиана нашей цены (без НДС): ${formatRub(medOur)} · медиана цены победителя при проигрыше: ${formatRub(medWin)}`);
  }

  const gaps = losses.map((r) => Number(r.loss_price_gap_pct)).filter((n) => Number.isFinite(n));
  const medGap = median(gaps);
  if (medGap != null) {
    lines.push(`Медиана отклонения нашей цены от победителя при проигрыше: ${medGap > 0 ? '+' : ''}${medGap}%`);
  }

  const winnerInn = tender.winner_inn || (losses[0] && losses[0].winner_inn);
  if (winnerInn) {
    try {
      const wRes = await db.query(
        `SELECT t.id, t.tender_title, t.winner_price_no_vat, t.loss_winner_price, t.tender_price
           FROM tenders t
          WHERE t.deleted_at IS NULL
            AND (t.winner_inn = $1 OR EXISTS (
              SELECT 1 FROM tender_competitors c
               WHERE c.tender_id = t.id AND c.company_inn = $1 AND c.is_winner = true
            ))
          ORDER BY COALESCE(t.result_at, t.lost_at, t.updated_at) DESC NULLS LAST
          LIMIT 8`,
        [winnerInn]
      );
      if (wRes.rows.length) {
        lines.push(`Победитель ИНН ${winnerInn}: выиграл у нас в ${wRes.rows.length} закупках (по CRM)`);
        const sample = wRes.rows.slice(0, 3).map((r) => {
          const p = r.winner_price_no_vat ?? r.loss_winner_price;
          return `#${r.id} ${(r.tender_title || '').slice(0, 60)} — ${formatRub(p)}`;
        });
        lines.push('Примеры: ' + sample.join('; '));
      }
    } catch (_) { /* tender_competitors может отсутствовать до миграции */ }
  }

  const keyword = defaultExtractKeyword(tender.tender_title || '');
  if (keyword && tender.id) {
    try {
      const sim = await db.query(
        `SELECT t.id, t.tender_title, t.registry_status,
                t.submission_price, t.our_price_no_vat,
                t.winner_price_no_vat, t.loss_winner_price
           FROM tenders t
          WHERE t.deleted_at IS NULL AND t.id != $1
            AND t.tender_title ILIKE $2
            AND t.registry_status IN ('проиграли', 'выиграли')
          ORDER BY t.updated_at DESC
          LIMIT 6`,
        [tender.id, `%${keyword}%`]
      );
      if (sim.rows.length) {
        const deltas = sim.rows.map((r) => {
          const our = Number(r.our_price_no_vat ?? r.submission_price);
          const win = Number(r.winner_price_no_vat ?? r.loss_winner_price);
          return pctDelta(our, win);
        }).filter((d) => d != null);
        const medD = median(deltas);
        lines.push(`Похожие закупки («${keyword}»): ${sim.rows.length} шт.${medD != null ? ` · медиана Δ наш−победитель: ${medD > 0 ? '+' : ''}${medD}%` : ''}`);
      }
    } catch (_) { /* ignore */ }
  }

  if (rows.length < 5) {
    lines.push('⚠️ мало истории, вывод вероятностный');
  }

  return lines.join('\n');
}

module.exports = { buildHistoryBlock, median, pctDelta };
