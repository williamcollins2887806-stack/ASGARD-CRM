'use strict';
/**
 * D-369: демо-данные для скриншотов «Мои заявки».
 *
 * ВАЖНО: работает ТОЛЬКО с локальной dev-БД `asgard_crm_dev`, на прод не ходит.
 * Скрипт идемпотентен: сначала удаляет свои прежние записи (created_by = DEMO_USER
 * и supplier_name LIKE 'ТЕСТ-%'), потом создаёт заново. Реальные данные не трогает.
 *
 * Зачем: на локальной БД этапы неполные (нет awaiting_dir/rejected), и на
 * скриншотах не видно, как выглядит полная картина «у директора / ждут оплаты /
 * оплачен / возвращён». Для презентации нужны все четыре этапа.
 *
 * Суммы и названия — вымышленные: клиентские данные в презентацию не идут.
 */
const pg = require(process.cwd() + '/node_modules/pg');

const DB = 'postgres://asgard:123456789@localhost/asgard_crm_dev';

// Офис-менеджер: у него есть кнопка «Загрузить счёт» и он видит свои счета.
const DEMO_USER = 3471;
const MARK = 'ТЕСТ-';

const DEMO = [
  // [счёт, подпись этапа, сумма, поставщик, №, дата, статус, оплата, дней назад, spend_kind, комментарий]
  ['awaiting_dir', 248900.0, 'ООО «СтройМатериалы Плюс»', 'СМ-4471', -3, 'awaiting_dir', null, 3, 'work',
    'Оплатить до конца недели, объект закрываем'],
  ['awaiting_dir', 46350.5, 'ООО «ТехноСнаб»', 'ТС-1180', -2, 'awaiting_dir', null, 2, 'warehouse',
    'Расходники на склад, срочно'],
  ['pending_payment', 132400.0, 'ИП Кузнецов А.В.', 'КЗ-902', -8, 'pending_payment', 'pending_payment', 8, 'work', null],
  ['pending_payment', 7870.0, 'ООО «Канцелярия Опт»', 'КО-331', -5, 'pending_payment', 'pending_payment', 5, 'office',
    'Бумага, картриджи'],
  ['paid', 56120.0, 'ООО «ЭнергоМонтаж»', 'ЭМ-77', -21, 'paid', 'paid', 21, 'work', null],
  ['paid', 31900.0, 'ООО «Чистый Офис»', 'ЧО-512', -18, 'paid', 'paid', 18, 'office', null],
  ['rejected', 18750.0, 'ООО «ПромТорг»', 'ПТ-64', -6, 'rejected', null, 6, 'other',
    'Нет договора-основания, вернули на доработку']
];

(async () => {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();

  // 1) Убираем предыдущие демо-записи (только свои).
  const del = await c.query(
    `DELETE FROM payment_invoices WHERE created_by=$1 AND supplier_name LIKE $2`, [DEMO_USER, MARK + '%']);
  console.log('удалено прежних демо-счетов:', del.rowCount);

  // 2) Создаём заново.
  let n = 0;
  for (const [note, amount, supplier, num, dayOff, status, payStatus, daysAgo, spendKind, comment] of DEMO) {
    const vatRate = 22;
    const vatAmount = Math.round(amount * vatRate / (100 + vatRate) * 100) / 100;
    const netAmount = Math.round((amount - vatAmount) * 100) / 100;
    const ins = await c.query(
      `INSERT INTO payment_invoices(
         status, payment_status, supplier_name, amount, amount_net, vat_amount, vat_rate,
         invoice_number, invoice_date, due_date, file_path, file_name, basis_type, basis_text,
         created_by, pay_timing, spend_kind, sf_due_at, sf_basis, comment_text,
         counterparty_inn, submitted_at, dir_approved_at, buh_acted_at, draft_updated_at)
       VALUES($1::text, $2::text, $3::text, $4::numeric, $5::numeric, $6::numeric, $7::numeric,
              $8::text, (CURRENT_DATE + ($9::int || ' days')::interval)::date,
              (CURRENT_DATE + interval '14 days')::date,
              '/uploads/demo-invoice.pdf', ('Счёт ' || $8::text || '.pdf'),
              'other', 'Демонстрационный счёт для презентации',
              $10::int, 'immediate', $11::text,
              (CURRENT_DATE + interval '10 days')::date, 'invoice', $12::text, '7701234567',
              NOW() - ($13::int || ' days')::interval,
              CASE WHEN $1::text IN ('pending_payment','paid')
                   THEN NOW() - ($13::int || ' days')::interval + interval '4 hours' END,
              CASE WHEN $1::text = 'paid'
                   THEN NOW() - ($13::int || ' days')::interval + interval '2 days' END,
              NOW() - ($13::int || ' days')::interval)`,
      [status, payStatus, MARK + supplier.replace(/^ООО «|»$/g, ''), amount, netAmount, vatAmount, vatRate,
        num, dayOff, DEMO_USER, spendKind, comment, daysAgo]);
    n++;
  }
  console.log('создано демо-счетов:', n);

  // 3) Проверяем, что видит пользователь.
  const { myInvoices } = require(process.cwd() + '/src/services/my-invoices');
  const res = await myInvoices({ query: (s, p) => c.query(s, p) }, { id: DEMO_USER, role: 'OFFICE_MANAGER' }, {});
  console.log('всего у офис-менеджера:', res.items.length);
  console.log('KPI:', JSON.stringify(res.kpi));
  const byStage = {};
  for (const x of res.items) byStage[x.stage.code] = (byStage[x.stage.code] || 0) + 1;
  console.log('по этапам:', JSON.stringify(byStage));

  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
