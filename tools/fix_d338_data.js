'use strict';
/**
 * D-338/D-339/D-340: исправление данных на ПРОДЕ, найденных 22.10.2026.
 * Режим: dry-run по умолчанию, --apply для применения.
 *
 *  1. Дубль #1597 (контрагент = наш ИНН) + заявка #31 → помечаем, что дубль #1523.
 *  2. НДС #1598 / #1589 (Ozon): vat == gross при net == gross → «без НДС».
 *  3. Поставщик 6101006049 «Утилизация отходов» — карточка с реквизитами из счёта.
 *  4. Договор 1302АСГ-УО/У-ХВ — создать и привязать к #1599.
 */
const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');
const OWN_INN = '7736244785';
const OWN_NAME = 'ООО "АСГАРД-СЕРВИС"';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);

  console.log(`РЕЖИМ: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}\n`);

  // ── 1. Дубль ДС-26027738 ───────────────────────────────────────────────
  console.log('=== 1. ДУБЛЬ #1597 (наш ИНН как контрагент) ===');
  const dups = await q(`SELECT id, invoice_number, counterparty_name, counterparty_inn,
        amount_gross, payment_invoice_id, created_at
      FROM doc_registry WHERE invoice_number='ДС-26027738' ORDER BY id`);
  for (const d of dups) console.log(`  #${d.id} inn=${d.counterparty_inn} pay=${d.payment_invoice_id || '-'} | ${d.counterparty_name}`);

  const bad = dups.find((d) => String(d.counterparty_inn) === OWN_INN);
  const good = dups.find((d) => String(d.counterparty_inn) !== OWN_INN);
  if (!bad || !good) {
    console.log('  → дубля нет / уже исправлено');
  } else {
    console.log(`  → удаляю дубль #${bad.id}, оставляю #${good.id}`);
    const pi = await q(`SELECT id, status, amount FROM payment_invoices WHERE id=$1`, [bad.payment_invoice_id]);
    console.log(`     заявка #${bad.payment_invoice_id}: ${pi[0] ? pi[0].status : 'нет'}`);
    if (APPLY) {
      // Мягкое удаление дубля и его заявки: истории не теряем, откат возможен.
      await q(`UPDATE payment_invoices SET status='rejected', updated_at=NOW()
               WHERE id=$1 AND status IN ('draft','awaiting_dir')`, [bad.payment_invoice_id]);
      await q(`UPDATE doc_registry
                  SET deleted_at=NOW(), updated_at=NOW(),
                      comment_text = COALESCE(comment_text,'') || ' [D-338: дубль #' || $2 || ', контрагент был наш ИНН]'
                WHERE id=$1`, [bad.id, good.id]);
      // Расход/офисный расход, если успели создать, снимаем.
      await q(`DELETE FROM office_expenses WHERE id IN
                (SELECT office_expense_id FROM doc_registry WHERE id=$1 AND office_expense_id IS NOT NULL)`, [bad.id]);
      console.log('     ✓ дубль удалён (мягко), заявка отклонена');
    }
  }

  // ── 2. НДС Ozon ────────────────────────────────────────────────────────
  console.log('\n=== 2. НДС Ozon: vat == gross при net == gross ===');
  const vatBad = await q(`SELECT id, invoice_number, amount_gross, amount_net, vat_amount, has_vat, vat_rate
      FROM doc_registry
     WHERE deleted_at IS NULL AND dir='in' AND has_vat=true
       AND abs(vat_amount - amount_gross) < 0.01 AND amount_gross > 0
       AND abs(amount_net - amount_gross) < 0.01`);
  if (!vatBad.length) console.log('  → таких счетов нет');
  for (const v of vatBad) {
    console.log(`  #${v.id} ${v.invoice_number} сумма=${v.amount_gross} net=${v.amount_net} vat=${v.vat_amount} → станет vat=0, has_vat=false`);
    if (APPLY) {
      // vat_rate объявлен NOT NULL — «нет ставки» кодируем нулём, не NULL.
      await q(`UPDATE doc_registry
                  SET vat_amount=0, has_vat=false, vat_rate=0, updated_at=NOW()
                WHERE id=$1`, [v.id]);
      console.log('     ✓ исправлено');
    }
  }

  // ── 3. Поставщик «Утилизация отходов» ──────────────────────────────────
  console.log('\n=== 3. ПОСТАВЩИК 6101006049 «УТИЛИЗАЦИЯ ОТХОДОВ» ===');
  let supId = null;
  {
    const sup = await q(`SELECT id, name, inn FROM suppliers
        WHERE regexp_replace(coalesce(inn,''),'\\D','','g')='6101006049'`);
    if (sup.length) {
      supId = sup[0].id;
      console.log(`  карточка есть: #${supId} ${sup[0].name}`);
    } else if (APPLY) {
      const ins = await q(`INSERT INTO suppliers
          (name, inn, kpp, bank_name, bik, rs, ks, address, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()) RETURNING id`,
        ['ООО "УТИЛИЗАЦИЯ ОТХОДОВ"', '6101006049', '610101001',
          'ЮГО-ЗАПАДНЫЙ БАНК ПАО СБЕРБАНК г. Ростов-на-Дону',
          '046015602', '40702810952740002717', '30101810600000000602',
          '346770, Ростовская область, м.р-н Азовский, с.п. Кагальницкое, х Узяк, ул Платова, дом 212']);
      supId = ins[0].id;
      console.log(`  ✓ создан поставщик #${supId}`);
    } else {
      console.log('  карточки НЕТ — при --apply создадим');
    }
  }

  // Привязка к документам — независимо от того, создали карточку или она была.
  if (supId && APPLY) {
    const upd = await q(`UPDATE doc_registry SET supplier_id=$1, updated_at=NOW()
                          WHERE deleted_at IS NULL
                            AND (regexp_replace(coalesce(counterparty_inn,''),'\\D','','g')='6101006049'
                                 OR counterparty_name ILIKE '%утилизац%')
                          RETURNING id`, [supId]);
    console.log(`  ✓ привязан к документам: ${upd.map((x) => '#' + x.id).join(', ') || 'нет'}`);
  }

  // ── 4. Договор 1302АСГ-УО/У-ХВ ─────────────────────────────────────────
  console.log('\n=== 4. ДОГОВОР 1302АСГ-УО/У-ХВ ===');
  const exists = await q(`SELECT id, number, counterparty_name, customer_inn FROM contracts
      WHERE regexp_replace(coalesce(number,''), '[^a-zA-Z0-9а-яА-ЯёЁ/\\-]', '', 'g')
            ILIKE '%1302АСГ%' OR coalesce(number,'') ILIKE '%1302%УО%'`);
  console.log('  найденные:', exists.length ? JSON.stringify(exists) : 'НЕТ');
  if (APPLY && !exists.length) {
    const ins = await q(`INSERT INTO contracts
        (number, type, counterparty_name, customer_inn, amount, start_date, status, comment, created_at, updated_at)
      VALUES ($1,'supply',$2,$3,$4,$5::date,'active',$6,NOW(),NOW()) RETURNING id`,
      ['1302АСГ-УО/У-ХВ', 'ООО "УТИЛИЗАЦИЯ ОТХОДОВ"', '6101006049', 62850, '2026-10-22',
        'Создан автоматически из счёта #1599 — реквизиты требуют проверки бухгалтерией']);
    const cid = ins[0].id;
    console.log(`  ✓ договор #${cid} создан`);
    const link = await q(`UPDATE doc_registry
        SET contract_id=$1, contract_mode='linked',
            contract_label=COALESCE(NULLIF(contract_label,''), '1302АСГ-УО/У-ХВ'),
            updated_at=NOW()
        WHERE id=1599 RETURNING id, contract_id`, [cid]);
    console.log(`  ✓ привязан к #1599:`, JSON.stringify(link[0] || 'не найден'));
  } else if (exists.length && APPLY) {
    const cid = exists[0].id;
    await q(`UPDATE doc_registry
        SET contract_id=$1, contract_mode='linked', updated_at=NOW()
        WHERE id=1599 AND contract_id IS NULL`, [cid]);
    console.log(`  → привязан существующий #${cid} к #1599`);
  }

  // Признак неполноты «договор не найден» снимаем у #1599, если договор есть.
  // ВАЖНО: incomplete_reasons — NOT NULL, поэтому пустой массив, а не NULL.
  if (APPLY) {
    await q(`UPDATE doc_registry
        SET incomplete_reasons = (SELECT COALESCE(array_agg(x), '{}'::text[]) FROM unnest(
              COALESCE(incomplete_reasons,'{}'::text[])) AS x WHERE x <> 'contract_not_found'),
            is_incomplete = (SELECT count(*) > 0 FROM unnest(
              COALESCE(incomplete_reasons,'{}'::text[])) AS x WHERE x <> 'contract_not_found'),
            updated_at=NOW()
        WHERE id=1599 AND contract_id IS NOT NULL`);
    console.log('  ✓ причина contract_not_found пересчитана');
  }

  console.log(`\n${APPLY ? 'ГОТОВО' : 'это был dry-run, для применения: --apply'}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
