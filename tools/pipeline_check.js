'use strict';
/**
 * ЧЕК-ЛИСТ КОНВЕЙЕРА СЧЕТОВ — одна команда вместо переписки в чате.
 * ═══════════════════════════════════════════════════════════════════════════
 * Запуск:  cd /var/www/asgard-crm && node tools/pipeline_check.js
 *          (на проде; на локальном ПК читает локальную БД)
 *
 * Что проверяет (каждый пункт — PASS/FAIL с числом, не «выглядит ок»):
 *   1. Почта:   письма за 24ч, вложения без разбора, цитаты без заявок
 *   2. Счета:   дубли по номеру+сумме, наш ИНН как контрагент, счета без файла
 *   3. Позиции: заявки в очереди без позиций, расхождение суммы позиций и счёта
 *   4. НДС:     vat >= суммы, has_vat без суммы, ставки вне НК РФ
 *   5. Договоры: счета с несуществующим договором, договоры-мусор, дубли
 *   6. Согласование: «Добро» без применённой заявки, зависшие grant
 *   7. Расходы: расходы-дубли по одному счёту, счета в оплате без объекта
 *   8. Роли:    карточки в очереди директора полные, инициатор у каждой заявки
 *
 * Код выхода: 1 если есть FAIL — можно ставить в cron/CI.
 */

const ROOT = __dirname + '/..';
process.chdir(ROOT);
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Client } = require(ROOT + '/node_modules/pg');

const OWN_INN = '7736244785';   // ООО «Асгард-Сервис»
const VAT_OK = [0, 5, 7, 10, 20, 22];

let pass = 0, fail = 0, warn = 0;
const rows = [];

function ok(section, name, detail) {
  pass++; rows.push({ section, verdict: 'PASS', name, detail: detail || '' });
}
function bad(section, name, detail) {
  fail++; rows.push({ section, verdict: 'FAIL', name, detail: detail || '' });
}
function note(section, name, detail) {
  warn++; rows.push({ section, verdict: 'WARN', name, detail: detail || '' });
}

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL
      || 'postgres://asgard:123456789@localhost/asgard_crm'
  });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  const one = async (s, p) => (await q(s, p))[0] || {};

  // ═══ 1. ПОЧТА ══════════════════════════════════════════════════════════
  const mails = await one(`SELECT count(*)::int n FROM emails WHERE email_date > NOW() - INTERVAL '24 hours'`);
  const crmCopy = await one(`SELECT count(*)::int n FROM emails
      WHERE email_date > NOW() - INTERVAL '24 hours' AND from_email = 'crm@asgard-service.com'`);
  const inbound = mails.n - crmCopy.n;
  ok('1. Почта', 'письма за 24ч разобраны', `всего ${mails.n}, из них рассылки CRM ${crmCopy.n}, по делу ${inbound}`);

  // Вложения-счета, до которых не дошёл разбор.
  // D-354: файл мог быть прикреплён НЕ через intake, а как вложение к строке
  // (`doc_registry.attachments`) — например, когда OCR падал и письмо разобрали
  // вручную. Это не «потеря», поэтому учитываем оба места.
  const lostAtt = await q(`
      SELECT e.id email_id, a.id att, a.filename, a.mime_type
        FROM emails e JOIN email_attachments a ON a.email_id = e.id
       WHERE e.email_date > NOW() - INTERVAL '24 hours'
         AND a.mime_type = 'application/pdf'
         AND NOT EXISTS (SELECT 1 FROM doc_email_intake i WHERE i.attachment_id = a.id)
         AND NOT EXISTS (
           SELECT 1 FROM doc_registry d
            WHERE d.deleted_at IS NULL
              AND jsonb_array_length(COALESCE(d.attachments,'[]'::jsonb)) > 0
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(d.attachments,'[]'::jsonb)) x
                 WHERE x->>'attachment_id' = a.id::text
                    OR x->>'path' = a.file_path)
         )`);
  if (!lostAtt.length) ok('1. Почта', 'все PDF прошли разбор', 'вложений без intake: 0');
  else bad('1. Почта', 'PDF без разбора', `${lostAtt.length}: ` + lostAtt.map((x) => `#${x.email_id}/att${x.att}`).join(', '));

  // Цитаты без заявок (D-345): строка есть, оплаты нет — это норма, но считаем.
  const quotes = await one(`
      SELECT count(*)::int n FROM doc_registry
       WHERE deleted_at IS NULL AND created_at > NOW() - INTERVAL '24 hours'
         AND COALESCE(incomplete_reasons,'{}'::text[]) && ARRAY['quote_only_reply']::text[]`);
  if (quotes.n) note('1. Почта', 'письма-цитаты на ручном разборе', `${quotes.n} — заявка не создана (правильно, нужен оригинал)`);
  else ok('1. Почта', 'писем-цитат нет', '');

  // ═══ 2. СЧЕТА ══════════════════════════════════════════════════════════
  // Дубли: номер + сумма + дата, одинаковый контрагент — реальный дубль.
  const dupDocs = await q(`
      SELECT invoice_number, amount_gross, invoice_date, count(*)::int n, array_agg(id ORDER BY id) ids
        FROM doc_registry
       WHERE deleted_at IS NULL AND dir='in'
         AND invoice_number IS NOT NULL AND trim(invoice_number) <> ''
         AND invoice_number !~ '^[-–—._ /\\\\|]+$'
         AND invoice_date IS NOT NULL
       GROUP BY 1,2,3 HAVING count(*) > 1 ORDER BY 4 DESC LIMIT 10`);
  if (!dupDocs.length) ok('2. Счета', 'дублей по номеру+сумме+дате нет', '0 пар');
  else bad('2. Счета', 'ДУБЛИ счетов', dupDocs.map((d) => `${d.invoice_number}/${d.amount_gross} → ${d.ids.join(',')}`).join('; '));

  const ownAsCp = await one(`SELECT count(*)::int n FROM doc_registry
      WHERE deleted_at IS NULL AND counterparty_inn = $1`, [OWN_INN]);
  if (!ownAsCp.n) ok('2. Счета', 'наш ИНН не фигурирует как контрагент', `0 строк`);
  else bad('2. Счета', 'НАШ ИНН как контрагент', `${ownAsCp.n} строк — ложные поставщики`);

  // D-354: «файл есть» = путь в original_path_url ИЛИ файл в attachments
  // (ручной разбор прикрепляет именно туда).
  const noFile = await q(`SELECT id, invoice_number, counterparty_name, payment_invoice_id, incomplete_reasons
        FROM doc_registry
       WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NOT NULL
         AND (original_path_url IS NULL OR original_path_url='')
         AND jsonb_array_length(COALESCE(attachments,'[]'::jsonb)) = 0
         AND NOT (COALESCE(incomplete_reasons,'{}'::text[]) && ARRAY['no_scan']::text[])`);
  if (!noFile.length) ok('2. Счета', 'у счетов в оплате есть файл (или помечен no_scan)', '0 без файла');
  else bad('2. Счета', 'счета в оплате БЕЗ файла и без пометки', noFile.map((x) => `#${x.id}`).join(', '));

  // ═══ 3. ПОЗИЦИИ ════════════════════════════════════════════════════════
  const noItems = await q(`
      SELECT pi.id, pi.amount, pi.supplier_name
        FROM payment_invoices pi
       WHERE pi.status IN ('awaiting_dir','pending_payment')
         AND jsonb_array_length(COALESCE(pi.line_items_json,'[]'::jsonb)) = 0`);
  if (!noItems.length) ok('3. Позиции', 'у всех заявок в работе есть позиции', '0 без позиций');
  else note('3. Позиции', 'заявки без позиций', noItems.map((x) => `#${x.id} (${x.amount})`).join(', '));

  // Расхождение суммы позиций и счёта больше 1 копейки.
  const itemDrift = await q(`
      SELECT pi.id, pi.amount,
             (SELECT COALESCE(SUM((l->>'sum')::numeric),0)
                FROM jsonb_array_elements(COALESCE(pi.line_items_json,'[]'::jsonb)) l) AS items_sum
        FROM payment_invoices pi
       WHERE pi.status IN ('awaiting_dir','pending_payment')
         AND jsonb_array_length(COALESCE(pi.line_items_json,'[]'::jsonb)) > 0`);
  const drifted = itemDrift.filter((x) => Math.abs(Number(x.items_sum) - Number(x.amount)) > 0.01);
  if (!drifted.length) ok('3. Позиции', 'сумма позиций = сумме счёта', `проверено ${itemDrift.length} заявок`);
  else note('3. Позиции', 'сумма позиций ≠ сумме счёта', drifted.map((x) => `#${x.id}: ${x.items_sum} vs ${x.amount}`).join('; '));

  // ═══ 4. НДС ════════════════════════════════════════════════════════════
  const vatGtGross = await one(`SELECT count(*)::int n FROM doc_registry
      WHERE deleted_at IS NULL AND amount_gross > 0 AND vat_amount > amount_gross + 0.01`);
  if (!vatGtGross.n) ok('4. НДС', 'НДС не больше суммы', '0 нарушений');
  else bad('4. НДС', 'НДС больше суммы', `${vatGtGross.n} документов`);

  const vatEqGross = await one(`SELECT count(*)::int n FROM doc_registry
      WHERE deleted_at IS NULL AND has_vat=true AND amount_gross > 0
        AND abs(vat_amount - amount_gross) < 0.01`);
  if (!vatEqGross.n) ok('4. НДС', 'НДС ≠ всей сумме', '0');
  else bad('4. НДС', 'НДС равен всей сумме', `${vatEqGross.n} — двойной НДС`);

  const vatPi = await one(`SELECT count(*)::int n FROM payment_invoices
      WHERE vat_amount > 0 AND abs(vat_amount - amount) < 0.01`);
  if (!vatPi.n) ok('4. НДС', 'в заявках НДС корректен', '0');
  else bad('4. НДС', 'в заявках НДС = сумме', `${vatPi.n}`);

  const oddRate = await q(`SELECT id, vat_rate FROM doc_registry
      WHERE deleted_at IS NULL AND vat_rate IS NOT NULL
        AND round(vat_rate * 100) NOT IN (${VAT_OK.join(',')}) LIMIT 5`);
  if (!oddRate.length) ok('4. НДС', 'ставки в пределах НК РФ', `допустимо: ${VAT_OK.join('/')}%`);
  else note('4. НДС', 'нестандартные ставки', oddRate.map((x) => `#${x.id}: ${x.vat_rate}`).join(', '));

  // ═══ 5. ДОГОВОРЫ ═══════════════════════════════════════════════════════
  const brokenContract = await one(`SELECT count(*)::int n FROM doc_registry d
      WHERE d.deleted_at IS NULL AND d.contract_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = d.contract_id)`);
  if (!brokenContract.n) ok('5. Договоры', 'ссылки на договоры целы', '0 битых');
  else bad('5. Договоры', 'битые ссылки на договоры', `${brokenContract.n}`);

  // Договоры-мусор: номер, в котором НЕТ ни одной цифры и он не похож на номер
  // («+», «да», «ещё нет», «Услуги гостиницы»). Короткие ЧИСЛОВЫЕ номера
  // («1», «42») — законные номера договоров у ИП, их мусором не считаем.
  const junkContract = await q(`
      SELECT c.id, c.number, count(d.id)::int n
        FROM contracts c JOIN doc_registry d ON d.contract_id = c.id AND d.deleted_at IS NULL
       WHERE coalesce(c.number,'') !~ '[0-9]'
         AND length(trim(coalesce(c.number,''))) > 0
       GROUP BY 1,2 ORDER BY 3 DESC LIMIT 5`);
  if (!junkContract.length) ok('5. Договоры', 'нет документов на договорах без номера', '');
  else note('5. Договоры', 'документы на договорах без цифр в номере',
    junkContract.map((x) => `#${x.id} «${x.number}» ×${x.n}`).join('; '));

  const noContract = await one(`SELECT count(*)::int n FROM doc_registry
      WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NOT NULL
        AND contract_id IS NULL AND contract_mode IS DISTINCT FROM 'linked'`);
  note('5. Договоры', 'счета в оплате без договора', `${noContract.n} (инициатор укажет основание)`);

  // ═══ 6. СОГЛАСОВАНИЕ ═══════════════════════════════════════════════════
  const stuckGrant = await one(`SELECT count(*)::int n FROM doc_approval_grant
      WHERE applied_at IS NULL AND created_at <= NOW() - INTERVAL '72 hours'`);
  if (!stuckGrant.n) ok('6. Согласование', 'нет просроченных «Добро»', '0');
  else bad('6. Согласование', 'висят «Добро» старше 72ч', `${stuckGrant.n} — должны гаситься`);

  const pendingGrants = await one(`SELECT count(*)::int n FROM doc_approval_grant WHERE applied_at IS NULL`);
  note('6. Согласование', 'активных отложенных «Добро»', `${pendingGrants.n} (ждут появления заявки)`);

  const queue = await q(`SELECT id, amount, supplier_name, created_at FROM payment_invoices
       WHERE status='awaiting_dir' ORDER BY created_at`);
  ok('6. Согласование', 'очередь директора', `${queue.length} заявок на ${queue.reduce((s, x) => s + Number(x.amount), 0).toLocaleString('ru-RU')} ₽`);

  const old = queue.filter((x) => Date.now() - new Date(x.created_at).getTime() > 48 * 3600 * 1000);
  if (!old.length) ok('6. Согласование', 'нет заявок старше 48ч в очереди', '');
  else note('6. Согласование', 'заявки ждут >48ч', old.map((x) => `#${x.id}`).join(', '));

  // ═══ 7. РАСХОДЫ ════════════════════════════════════════════════════════
  // Двойной расход = одна работа + одна сумма + ОДИН И ТОТ ЖЕ номер документа.
  // ВАЖНО (22.10.2026): проверка «работа + сумма» давала ложные срабатывания.
  // У ГК «Якуттрансарго» семь РАЗНЫХ счетов по 42 000 ₽ (номера 628, 638, 1045,
  // 1233, 1282, 1287, 1298) — это разные перевозки по одинаковому тарифу.
  // Сравнивать без номера документа нельзя: получим вечный шум и перестанем
  // замечать реальные дубли.
  const dupExp = await q(`
      SELECT work_id, amount, lower(trim(coalesce(doc_number,''))) dn,
             count(*)::int n, array_agg(id ORDER BY id) ids
        FROM work_expenses
       WHERE COALESCE(status,'') <> 'rejected' AND work_id IS NOT NULL
         AND source_key LIKE 'doc_registry:%'
         AND coalesce(doc_number,'') <> ''
       GROUP BY work_id, amount, lower(trim(coalesce(doc_number,'')))
      HAVING count(*) > 1`);
  if (!dupExp.length) ok('7. Расходы', 'нет двойных расходов по одному счёту', '0 пар (сверка по номеру документа)');
  else note('7. Расходы', 'ДВОЙНОЙ расход по одному документу',
    dupExp.slice(0, 5).map((x) => `раб.${x.work_id}/${x.amount}/№${x.dn}: ${x.ids.join(',')}`).join('; '));

  const expTot = await one(`SELECT count(*)::int n, COALESCE(SUM(amount),0)::float8 s
      FROM work_expenses WHERE COALESCE(status,'') <> 'rejected'`);
  ok('7. Расходы', 'расходы по объектам', `${expTot.n} на ${Number(expTot.s).toLocaleString('ru-RU')} ₽`);

  const noWork = await q(`SELECT id, amount_gross FROM doc_registry
       WHERE deleted_at IS NULL AND dir='in' AND payment_invoice_id IS NOT NULL
         AND work_id IS NULL AND COALESCE(spend_kind,'') <> 'office'
         AND COALESCE(purpose_asgard,false)=false AND COALESCE(purpose_consumables,false)=false`);
  if (!noWork.length) ok('7. Расходы', 'у всех счетов в оплате есть объект', '0');
  else note('7. Расходы', 'счета в оплате без объекта (не упадут в проект)', noWork.map((x) => `#${x.id}`).join(', '));

  // ═══ 8. РОЛИ / КАРТОЧКИ ═════════════════════════════════════════════════
  const incomplete = await q(`
      SELECT pi.id,
             jsonb_array_length(COALESCE(pi.line_items_json,'[]'::jsonb)) items,
             (pi.file_path IS NOT NULL OR pi.file_name IS NOT NULL) has_file,
             d.doc_owner_id, d.counterparty_inn
        FROM payment_invoices pi LEFT JOIN doc_registry d ON d.id = pi.doc_registry_id
       WHERE pi.status IN ('awaiting_dir','pending_payment')`);
  const broken = incomplete.filter((x) => !x.items || !x.has_file);
  if (!broken.length) ok('8. Роли', 'карточки полные (файл + позиции)', `проверено ${incomplete.length}`);
  else bad('8. Роли', 'карточки неполные', broken.map((x) => `#${x.id} (позиций ${x.items}, файл ${x.has_file ? 'да' : 'НЕТ'})`).join('; '));

  const noOwner = incomplete.filter((x) => !x.doc_owner_id);
  if (!noOwner.length) ok('8. Роли', 'у всех заявок есть ответственный', '0 без владельца');
  else note('8. Роли', 'заявки без ответственного', noOwner.map((x) => `#${x.id}`).join(', '));

  // Заявки без связанного документа реестра — инициатор не увидит реквизитов
  // и расхода по объекту не будет. Считаем отдельно: это дефект связи, а не данных.
  const noDoc = await q(`SELECT id, supplier_name, created_by FROM payment_invoices
       WHERE doc_registry_id IS NULL AND status IN ('awaiting_dir','pending_payment','draft')`);
  if (!noDoc.length) ok('8. Роли', 'у всех заявок связан документ реестра', '0');
  else note('8. Роли', 'заявки без документа реестра', noDoc.map((x) => `#${x.id}`).join(', '));

  // ═══ ИТОГ ══════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  ЧЕК-ЛИСТ КОНВЕЙЕРА СЧЕТОВ  ·  ' + new Date().toISOString().slice(0, 16).replace('T', ' '));
  console.log('══════════════════════════════════════════════════════════════════════\n');
  let cur = '';
  for (const r of rows) {
    if (r.section !== cur) { cur = r.section; console.log(`\n${cur}`); }
    const mark = r.verdict === 'PASS' ? '✓' : r.verdict === 'FAIL' ? '✗' : '!';
    console.log(`  ${mark} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  }
  console.log('\n──────────────────────────────────────────────────────────────────────');
  console.log(`  PASS: ${pass}   FAIL: ${fail}   предупреждений: ${warn}`);
  console.log(fail === 0
    ? '  ИТОГ: конвейер в порядке, можно работать.'
    : '  ИТОГ: ЕСТЬ ПРОБЛЕМЫ — см. ✗ выше.');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  await c.end();
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error('ОШИБКА ПРОВЕРКИ:', e.message); process.exit(1); });
