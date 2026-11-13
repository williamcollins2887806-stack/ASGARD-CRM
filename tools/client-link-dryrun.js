'use strict';
/**
 * Сухой прогон резолва клиента на РЕАЛЬНЫХ звонках (без записи в БД).
 * Показывает, что бы сделал linkCallToCustomer: связал, создал или в очередь.
 *
 * Запуск на сервере:
 *   node tools/client-link-dryrun.js --limit=40
 */

const path = require('path');

function arg(name, def = null) {
  const p = process.argv.find((a) => a.startsWith('--' + name));
  if (!p) return def;
  const v = p.split('=')[1];
  return v === undefined ? true : v;
}

async function main() {
  const limit = parseInt(arg('limit', '30'), 10) || 30;
  const db = require('../src/services/db');
  const link = require('../src/services/call-client-link');
  const dadata = require('../src/services/dadata');

  // Звонки, где есть транскрипт (значит ИИ уже мог вытащить client_card),
  // и где client_inn ещё не проставлен.
  const r = await db.query(
    `SELECT id, client_number, from_number, ai_lead_data, ai_is_target, transcript_status
       FROM call_history
      WHERE client_inn IS NULL
        AND COALESCE(client_number, from_number) IS NOT NULL
        AND transcript_status = 'done'
      ORDER BY id DESC
      LIMIT $1`,
    [limit]
  );

  const stats = { known: 0, dadata_inn: 0, web: 0, queued: 0, errors: 0 };
  const rows = [];

  for (const call of r.rows) {
    let card = {};
    try {
      const ld = typeof call.ai_lead_data === 'string' ? JSON.parse(call.ai_lead_data) : (call.ai_lead_data || {});
      card = ld.client_card || {};
    } catch (_) { card = {}; }

    const phone = call.client_number || call.from_number || '';

    // Шаг 1: номер известен?
    let step = 'queued';
    let inn = null;
    let company = null;
    try {
      const known = await link.findCustomerByPhone(db, phone);
      if (known) { step = 'known_phone'; inn = known.inn; company = known.name; stats.known += 1; }
      else if (card.inn) {
        const org = await dadata.resolveByInn(card.inn);
        if (org && org.name) { step = 'ai_inn'; inn = org.inn; company = org.name; stats.dadata_inn += 1; }
      }
      if (!inn && card.company_name) {
        // Веб-поиск НЕ запускаем в сухом прогоне по умолчанию (деньги),
        // только показываем, что бы попробовали.
        step = 'would_web';
      }
      if (step === 'queued' || step === 'would_web') stats.queued += 1;
    } catch (e) {
      stats.errors += 1;
      step = 'error: ' + e.message;
    }

    rows.push({
      call_id: call.id,
      phone,
      card_company: card.company_name || null,
      card_inn: card.inn || null,
      card_city: card.city || null,
      step,
      inn,
      company,
    });
  }

  console.log('\n=== СУХОЙ ПРОГОН: резолв клиента ===');
  console.log(`Звонков проверено: ${r.rows.length}`);
  console.log(JSON.stringify(stats, null, 2));
  console.log('\n--- по звонкам ---');
  for (const row of rows) {
    console.log(
      `#${row.call_id}  ${row.phone}  компания=${row.card_company || '—'}  ИНН=${row.card_inn || '—'}  ` +
      `→ ${row.step}${row.company ? ' | ' + row.company : ''}`
    );
  }

  // Сколько ИИ вообще заполняет client_card
  const cardFill = await db.query(
    `SELECT
       COUNT(*)::int total,
       COUNT(*) FILTER (WHERE (ai_lead_data->'client_card'->>'company_name') IS NOT NULL)::int with_company,
       COUNT(*) FILTER (WHERE (ai_lead_data->'client_card'->>'inn') IS NOT NULL)::int with_inn,
       COUNT(*) FILTER (WHERE (ai_lead_data->'client_card'->>'city') IS NOT NULL)::int with_city
     FROM call_history
     WHERE transcript_status = 'done'
       AND created_at >= NOW() - INTERVAL '90 days'`
  );
  console.log('\n=== заполняемость client_card у ИИ ===');
  console.log(cardFill.rows[0]);

  await db.pool.end();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
