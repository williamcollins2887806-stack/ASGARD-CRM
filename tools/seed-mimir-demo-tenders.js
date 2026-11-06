#!/usr/bin/env node
'use strict';
/**
 * seed-mimir-demo-tenders.js — 9 тендеров по архетипам для демо этапов Мимира.
 *
 * Зачем именно 9: чтобы проверить, что конвейер не «заточен под мойку».
 * Каждый архетип — свой метод, своя единица объёма и своя оснастка:
 *   1. химчистка котла          (boilers.chem,        м³)
 *   2. пластинчатый ТО CIP      (plates.chem_cip,     м³ контура)
 *   3. ГДО трубок               (tubes.gdo,           трубки)
 *   4. сварка шва               (repair_weld.weld,    м)
 *   5. огневые работы           (repair_weld.fire_works, точки)
 *   6. монтаж/такелаж           (mount.rigging,       операции)
 *   7. теплоизоляция            (insulation.insul,    м²)
 *   8. вентиляция/дезинфекция   (vent_sewer.disinfect, м²)
 *   9. опрессовка контура       (pipelines.hydrotest, контур)
 *
 * Часть тендеров — без документов и с неполными объёмами: так видно паузу (clarify).
 *
 * Запуск: node tools/seed-mimir-demo-tenders.js [--db=asgard_crm_test] [--clean]
 */
require('dotenv').config();
const { Client } = require('pg');

const DB = (process.argv.find((a) => a.startsWith('--db=')) || '').split('=')[1] || 'asgard_crm_test';
const CLEAN = process.argv.includes('--clean');
const PREFIX = '[ДЕМО Мимир]';
// Автор демо-сессий: по умолчанию тестовый РП, под которым идёт Playwright.
// Иначе сессии создаются на admin и тест «не видит» их в своём списке.
const AUTHOR_LOGIN = (process.argv.find((a) => a.startsWith('--author=')) || '').split('=')[1] || 'test_pm';

const ARCHETYPES = [
  {
    key: 'boiler-chem',
    title: 'Химическая промывка котлов котельной',
    customer: 'Демо · Котельная Северная',
    region: 'Мурманская область',
    description: 'Промывка двух водогрейных котлов КВГМ по 2 м³. Отложения: карбонат кальция, плотные. Режим две смены. Требуется нейтрализация и опрессовка после промывки.',
    docs: true,
    contact: 'Главный инженер, +7 900 000-00-01'
  },
  {
    key: 'plates-cip',
    title: 'Безразборная химическая очистка пластинчатых теплообменников',
    customer: 'Демо · ЖКХ Центральный',
    region: 'Кировская область',
    description: 'CIP-промывка четырёх пластинчатых ТО в ИТП. Объём контура 2,3 м³, 3 цикла. Отложения средние. Доступ в подвал, пропуска на объект.',
    docs: true,
    contact: 'Начальник участка, +7 900 000-00-02'
  },
  {
    key: 'tubes-gdo',
    title: 'Гидродинамическая очистка трубного пучка подогревателя',
    customer: 'Демо · НПЗ Западный',
    region: 'Краснодарский край',
    description: 'ГДО трубного пучка кожухотрубного подогревателя: 480 трубок Ø25, длина 6 м. Отложения углеводородные, средние. Работы по наряду-допуску.',
    docs: true,
    contact: 'Механик установки, +7 900 000-00-03'
  },
  {
    key: 'weld',
    title: 'Сварка технологического трубопровода Ду200',
    customer: 'Демо · Завод Минеральные удобрения',
    region: 'Пермский край',
    description: 'Сварка 12 метровых стыков трубопровода Ду200, сталь 20. Аттестация НАКС обязательна, контроль ВИК. Работы в цехе, действующее производство.',
    docs: true,
    contact: 'Мастер участка, +7 900 000-00-04'
  },
  {
    key: 'fire-works',
    title: 'Огневые работы на ёмкостном оборудовании',
    customer: 'Демо · Нефтебаза Южная',
    region: 'Самарская область',
    description: 'Огневые работы: 4 точки на РВС после зачистки. Наряд-допуск, наблюдающий, пропарка. Требуется анализ воздушной среды.',
    docs: false,
    contact: 'Инженер ОТ, +7 900 000-00-05'
  },
  {
    key: 'mount-rigging',
    title: 'Демонтаж и такелаж теплообменного аппарата',
    customer: 'Демо · ЦБК Восточный',
    region: 'Архангельская область',
    description: 'Демонтаж кожухотрубного аппарата массой 8 тонн и перемещение на площадку хранения. Кран 25 т, строповка по схеме.',
    docs: false,
    contact: 'Механик цеха, +7 900 000-00-06'
  },
  {
    key: 'insulation',
    title: 'Теплоизоляция трубопроводов и оборудования',
    customer: 'Демо · ТЭЦ Приморская',
    region: 'Приморский край',
    description: 'Изоляция трубопроводов Ду159 матами минераловатными, толщина 60 мм, покрытие стеклопластиком. Объём 100 м². Работы на высоте до 6 м.',
    docs: true,
    contact: 'Начальник котельного цеха, +7 900 000-00-07'
  },
  {
    key: 'vent-disinfect',
    title: 'Дезинфекция систем вентиляции промышленного корпуса',
    customer: 'Демо · Пищевое производство',
    region: 'Московская область',
    description: 'Дезинфекция воздуховодов и поверхностей корпуса 400 м². Требования СанПиН, дезинфектант с экспозицией, СИЗ. Работы в ночную смену.',
    docs: false,
    contact: 'Служба эксплуатации, +7 900 000-00-08'
  },
  {
    key: 'hydrotest',
    title: 'Опрессовка технологического контура',
    customer: 'Демо · Химический комбинат',
    region: 'Нижегородская область',
    description: 'Гидроиспытания контура после монтажа: 100 м трубопровода Ду159, давление 1,6 МПа. Опрессовочный насос, манометры, журнал испытаний.',
    docs: false,
    contact: 'Инженер по надзору, +7 900 000-00-09'
  }
];

function docText(a) {
  return [
    `Техническое задание: ${a.title}`,
    `Заказчик: ${a.customer}`,
    `Регион: ${a.region}`,
    '',
    a.description,
    '',
    'Требования:',
    '- работы выполнить в соответствии с требованиями охраны труда и промышленной безопасности;',
    '- перед началом работ оформить наряд-допуск;',
    '- по завершении передать исполнительную документацию.',
    '',
    `Контакт: ${a.contact}`
  ].join('\n');
}

(async () => {
  const c = new Client({
    host: 'localhost', port: 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB
  });
  await c.connect();

  const { rows: [author] } = await c.query(
    `SELECT id, login FROM users WHERE login = $1`,
    [AUTHOR_LOGIN]
  ).then(async (r) => {
    if (r.rows[0]) return r;
    return c.query('SELECT id, login FROM users ORDER BY id LIMIT 1');
  });
  if (!author) {
    console.error('Нет пользователей в БД — некуда привязать демо-тендеры');
    process.exit(1);
  }
  console.log('автор демо-сессий:', author.login, '#' + author.id);
  // Статус: для демо нужен именно «На анализе» — иначе карточки не попадут
  // в очередь дежурного РП и тест будет проверять не тот экран.
  const status = 'На анализе';

  if (CLEAN) {
    // Сначала зависимые записи: у documents/tkp_quick_sessions внешние ключи без
    // ON DELETE CASCADE, и простой DELETE по tenders падает.
    const ids = (await c.query(
      `SELECT id FROM tenders WHERE tender_title LIKE $1`, [PREFIX + '%']
    )).rows.map((r) => r.id);
    if (ids.length) {
      await c.query('DELETE FROM tkp_quick_sessions WHERE tender_id = ANY($1::int[])', [ids]);
      await c.query('DELETE FROM documents WHERE tender_id = ANY($1::int[])', [ids]);
      const del = await c.query('DELETE FROM tenders WHERE id = ANY($1::int[]) RETURNING id', [ids]);
      console.log('удалено демо-тендеров:', del.rowCount);
    } else {
      console.log('демо-тендеров для удаления нет');
    }
  }

  const created = [];
  for (const a of ARCHETYPES) {
    const title = `${PREFIX} ${a.title}`;
  const inserted = await c.query(
      `INSERT INTO tenders (
         tender_title, customer_name, tender_region, tender_description,
         tender_status, status, registry_status, created_by, docs_deadline
       ) VALUES ($1,$2,$3,$4,$5,$5,'рассмотрение',$6, NOW() + INTERVAL '14 days')
       RETURNING id`,
      [title, a.customer, a.region, a.description, status, author.id]
    );
    const t = inserted.rows[0];

    // ТЗ текстом всегда: так видно разницу «есть текст» / «нет документов».
    if (a.docs) {
      const text = docText(a);
      await c.query(
        `INSERT INTO documents (
           filename, original_name, mime_type, size, type, tender_id, uploaded_by,
           download_url, ocr_status, ocr_text, created_at
         ) VALUES ($1,$2,'text/plain',$3,'tz',$4,$5,$6,'done',$7, NOW())`,
        [`demo-${a.key}.txt`, `ТЗ_${a.key}.txt`,
          Buffer.byteLength(text), t.id, author.id,
          `/uploads/demo/${a.key}.txt`, text]
      );
    }

    // Сессия Мимира в состоянии «ещё не начинали» — РП нажмёт «Анализ Мимир».
    await c.query(
      `INSERT INTO tkp_quick_sessions (
         session_uid, author_id, customer_name, tender_id, tz_text, status
       ) VALUES ($1,$2,$3,$4,$5,'draft')`,
      [`demo-${a.key}-${Date.now()}`, author.id, a.customer, t.id, docText(a)]
    );

    created.push({ id: t.id, key: a.key, docs: a.docs, title: a.title });
  }

  console.log('=== демо-тендеры созданы ===');
  console.log('БД:', DB, '| статус:', status);
  for (const x of created) {
    console.log(`#${String(x.id).padEnd(6)} ${x.key.padEnd(16)} документы: ${x.docs ? 'да' : 'нет'} — ${x.title}`);
  }
  console.log('\nвсего:', created.length);
  await c.end();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
