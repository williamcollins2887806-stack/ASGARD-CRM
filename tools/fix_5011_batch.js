'use strict';
/**
 * D-351: разбор пачки #5011 / #5016 / #5019 (23.10.2026). Режим: dry-run / --apply.
 *
 * ЧТО ВЫЯСНЕНО ЧТЕНИЕМ ФАЙЛОВ (не догадки):
 *
 * 1. РЕАЛЬНЫЕ счета поставщика «Безопасность Труда» (ИНН 3017052355):
 *      УТ-2372 — 20 147,88 ₽
 *      УТ-2373 — 20 510,00 ₽
 *      УТ-2374 — 23 440,00 ₽
 *      УТ-2375 —  7 965,99 ₽
 *    Они лежат в письме #5011 (склад, Пираев): att#1186 (3 страницы = 3 счёта:
 *    2373, 2374, 2372) и att#1187 (2375). Это НАСТОЯЩИЕ счёта поставщика.
 *
 * 2. Письма #5016 и #5019 (Путков, «Дублирую письма для банка») содержат НАШИ
 *    исходящие сопроводительные письма «Исх. №261023-07…10 — счёт УТ-2372…2375»:
 *    поставщик в них — ООО «Асгард-Сервис» (наш ИНН 7736244785), а внутри
 *    цитируется счёт Безопасности Труда и договор № 12.03/1339.
 *
 * 3. ИИ разобрал наши сопроводительные письма и создал документы #1603–1606
 *    с контрагентом «ООО Асгард-Сервис» (то есть МЫ САМИ) и заявки #37–40.
 *    Деньги в заявках — реальные (это счёта поставщика), но КАРТОЧКИ неверные:
 *    контрагент мы, ИНН пустой, поставщик не привязан, скана счёта нет.
 *
 * 4. Настоящие PDF из #5011 не попали в разбор вовсе — записей в
 *    doc_email_intake по att#1186/1187 НЕТ (OCR в тот момент падал из-за
 *    отсутствия денег на ИИ, текст выходил пустым и файл молча пропускался).
 *
 * ЧТО ДЕЛАЕМ (не удаляем и не откатываем — исправляем):
 *   a) #1603–1606: контрагент → «Безопасность Труда», ИНН 3017052355,
 *      supplier_id = 465 (карточка с полными реквизитами уже есть), owner → склад.
 *   b) Прикрепляем настоящие сканы из #5011 (att#1186, att#1187) к документам —
 *      по одному счёту одна строка, скан внутри.
 *   c) Заявки #37–40: поставщик и supplier_id → Безопасность Труда.
 *   d) #1608 (0 ₽) → is_incomplete + no_amount.
 */
const ROOT = '/var/www/asgard-crm';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');

const APPLY = process.argv.includes('--apply');
const SUPPLIER_ID = 465;
const SUPPLIER_INN = '3017052355';
const SUPPLIER_NAME = 'Общество с ограниченной ответственностью "Безопасность Труда"';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://asgard:123456789@localhost/asgard_crm' });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  console.log(`РЕЖИМ: ${APPLY ? 'ПРИМЕНЕНИЕ' : 'dry-run'}\n`);

  // 0. Проверяем карточку поставщика.
  const sup = (await q(`SELECT id, name, inn, kpp, bik, rs FROM suppliers WHERE id=$1`, [SUPPLIER_ID]))[0];
  console.log('=== 0. Карточка поставщика ===');
  console.log(`  #${sup.id} ${sup.name} ИНН ${sup.inn} КПП ${sup.kpp} БИК ${sup.bik} р/с ${sup.rs}`);
  if (String(sup.inn) !== SUPPLIER_INN) { console.log('  !!! ИНН не совпал, останавливаюсь'); await c.end(); return; }

  // 1. Документы #1603-1606.
  console.log('\n=== 1. Документы #1603–1606: контрагент → Безопасность Труда ===');
  const docs = await q(`SELECT id, invoice_number, counterparty_name, counterparty_inn,
        seller_inn, supplier_id, amount_gross, doc_owner_id,
        jsonb_array_length(COALESCE(attachments,'[]'::jsonb)) atts
      FROM doc_registry WHERE id BETWEEN 1603 AND 1606 ORDER BY id`);
  for (const d of docs)
    console.log(`  #${d.id} ${d.invoice_number} ${d.amount_gross} | сейчас: «${d.counterparty_name}» ИНН=${d.counterparty_inn || 'пусто'} supplier=${d.supplier_id || '-'} вложений=${d.atts}`);

  // 2. Сканы из #5011.
  console.log('\n=== 2. Настоящие сканы из письма #5011 ===');
  const scans = await q(`SELECT id, original_filename, file_path, mime_type, size
      FROM email_attachments WHERE email_id=5011 AND mime_type='application/pdf'
        AND (original_filename ILIKE '%счет%' OR original_filename ILIKE '%счёт%')
      ORDER BY id`);
  for (const s of scans) console.log(`  att#${s.id} ${s.original_filename} (${Math.round(s.size / 1024)} КБ)`);

  if (APPLY) {
    // 2a. Правим карточки.
    for (const d of docs) {
      await q(`UPDATE doc_registry SET
            counterparty_name=$1,
            counterparty_inn=$2,
            supplier_id=$3,
            seller_name=NULL,
            seller_inn=NULL,
            updated_at=NOW()
          WHERE id=$4`, [SUPPLIER_NAME, SUPPLIER_INN, SUPPLIER_ID, d.id]);
    }
    console.log(`  ✓ исправлено карточек: ${docs.length}`);

    // 2b. Прикрепляем сканы. att#1186 = УТ-2373+2374+2372 (3 стр),
    //     att#1187 = УТ-2375. Раскладываем по номерам счетов.
    const docAtt = require(ROOT + '/src/services/doc-attachments');
    const map = {
      'УТ-2373': [scans[0]],
      'УТ-2374': [scans[0]],
      'УТ-2372': [scans[0]],
      'УТ-2375': [scans[1]]
    };
    for (const d of docs) {
      const files = map[d.invoice_number] || [];
      if (!files.length || !files[0]) continue;
      const res = await docAtt.attachFilesToDoc(c, d.id, 5011, files, { kind: 'scan', log: console });
      console.log(`  #${d.id} ${d.invoice_number}: прикреплено ${res.added} (всего ${res.total})`);
    }

    // 3. Заявки #37–40.
    const pi = await q(`UPDATE payment_invoices SET
          supplier_name=$1, supplier_id=$2, updated_at=NOW()
        WHERE id BETWEEN 37 AND 40 RETURNING id`, [SUPPLIER_NAME, SUPPLIER_ID]);
    console.log(`\n=== 3. Заявки #37–40: поставщик → Безопасность Труда (${pi.length}) ===`);

    // 4. #1608: сумма 0 → неполная.
    await q(`UPDATE doc_registry SET
          is_incomplete=true,
          incomplete_reasons=(SELECT array_agg(DISTINCT x) FROM unnest(
            COALESCE(incomplete_reasons,'{}'::text[]) || ARRAY['no_amount']) AS x),
          comment_text=COALESCE(NULLIF(comment_text,''), 'Документ без суммы: это договор, а не счёт — требует ручного разбора'),
          updated_at=NOW()
        WHERE id=1608`);
    console.log('=== 4. #1608 (0 ₽) → помечен no_amount ===');
  }

  // Итоговая сверка.
  console.log('\n=== СВЕРКА ===');
  for (const d of await q(`SELECT d.id, d.invoice_number, d.counterparty_name, d.counterparty_inn,
        d.supplier_id, d.amount_gross, d.doc_owner_id,
        jsonb_array_length(COALESCE(d.attachments,'[]'::jsonb)) atts,
        pi.status, pi.amount pi_amount, pi.supplier_name pi_sup
      FROM doc_registry d LEFT JOIN payment_invoices pi ON pi.id = d.payment_invoice_id
     WHERE d.id BETWEEN 1603 AND 1606 ORDER BY d.id`))
    console.log(`  #${d.id} ${d.invoice_number} ${d.amount_gross} | ${String(d.counterparty_name).slice(0, 40)} ИНН=${d.counterparty_inn || '-'} sup=${d.supplier_id || '-'} вложений=${d.atts} | заявка ${d.status} ${d.pi_amount}`);

  console.log(`\n${APPLY ? 'ГОТОВО' : 'это dry-run, для применения: --apply'}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
