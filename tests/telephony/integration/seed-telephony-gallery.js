'use strict';
/**
 * Seed rich demo call_history rows for telephony UI gallery — LOCAL test DB only.
 * Usage: node tests/telephony/integration/seed-telephony-gallery.js
 * Note: client_name/manager_name are JOIN aliases, not columns.
 */
require('dotenv').config();
const { Pool } = require('pg');

const dbName = process.env.DB_NAME || 'asgard_crm_test';
if (!String(dbName).includes('test')) {
  console.error('REFUSE: DB_NAME must contain "test", got', dbName);
  process.exit(1);
}

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    database: dbName,
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
    port: Number(process.env.DB_PORT || 5432),
  });

  const u = await pool.query(
    `SELECT id, name FROM users WHERE role IN ('ADMIN','DIRECTOR_GEN','HEAD_TO','TO','PM')
     AND (is_active IS NULL OR is_active = true) ORDER BY id LIMIT 5`
  );
  const uid = u.rows[0] && u.rows[0].id;
  if (!uid) {
    console.error('No user for seed');
    process.exit(1);
  }

  // Demo customer for JOIN client_name
  await pool.query(
    `INSERT INTO customers (name, contact_person, inn, phone)
     VALUES ('DEMO · ООО Север', 'Иван Петров', '7700000001', '+74951234567')
     ON CONFLICT DO NOTHING`
  ).catch(async () => {
    // inn unique may differ — try update/insert by inn
    const ex = await pool.query(`SELECT id FROM customers WHERE inn = '7700000001' LIMIT 1`);
    if (!ex.rows.length) {
      await pool.query(
        `INSERT INTO customers (name, contact_person, phone) VALUES ('DEMO · ООО Север', 'Иван Петров', '+74951234567')`
      );
    }
  });
  let cust = await pool.query(`SELECT id, inn FROM customers WHERE name LIKE 'DEMO ·%' OR inn = '7700000001' LIMIT 1`);
  if (!cust.rows.length) {
    cust = await pool.query(
      `INSERT INTO customers (name, contact_person, phone) VALUES ('DEMO · ООО Север', 'Иван Петров', '+74951234567') RETURNING id, inn`
    );
  }
  const clientInn = cust.rows[0].inn || '7700000001';
  if (!cust.rows[0].inn) {
    await pool.query(`UPDATE customers SET inn = '7700000001' WHERE id = $1 AND (inn IS NULL OR inn = '')`, [
      cust.rows[0].id,
    ]).catch(() => {});
  }

  await pool.query(`DELETE FROM call_history WHERE from_number LIKE '+7499VIS%' OR to_number LIKE '+7499VIS%'`);

  const segmentsDone = JSON.stringify([
    { start: 0, end: 4.2, speaker: 1, text: 'Здравствуйте, компания Север. Нужна химическая очистка теплообменников на объекте в Мытищах.' },
    { start: 4.5, end: 9.1, speaker: 0, text: 'Добрый день! Меня зовут Алексей, Асгард Сервис. Подскажите объём и желаемые сроки.' },
    { start: 9.4, end: 14.0, speaker: 1, text: 'Два контура, ориентировочно до конца месяца. Можно выезд на обследование?' },
    { start: 14.3, end: 19.8, speaker: 0, text: 'Да, запишу выезд на четверг. Пришлю КП после осмотра. Удобно на этот номер?' },
    { start: 20.0, end: 22.5, speaker: 1, text: 'Да, жду. Спасибо!' },
  ]);

  const leadDone = {
    company_name: 'ООО Север',
    contact_person: 'Иван Петров',
    contact_phone: '+74951234567',
    work_type: 'chemical_cleaning',
    object_description: 'Теплообменники, Мытищи',
    location: 'Мытищи',
    desired_timeline: 'до конца месяца',
    quality_score: 9,
    quality_notes: 'Менеджер уточнил объём и зафиксировал следующий шаг',
    key_requirements: ['химочистка 2 контуров', 'выезд на обследование'],
    next_steps: ['Согласовать выезд на четверг', 'Подготовить КП после осмотра'],
    classification: 'new_inquiry',
    urgency: 'medium',
  };

  const rows = [
    {
      call_type: 'inbound',
      from_number: '+7499VIS0001',
      to_number: '74991234567',
      line_number: '74991234567',
      duration_seconds: 186,
      client_inn: clientInn,
      transcript_status: 'done',
      transcript:
        'Клиент: Здравствуйте, нужна химическая очистка.\nМенеджер: Добрый день! Уточню объём и сроки.\nКлиент: Два контура, до конца месяца.\nМенеджер: Запишу выезд на четверг.',
      transcript_segments: segmentsDone,
      ai_summary:
        'DEMO · Клиент из ООО Север запросил химочистку теплообменников в Мытищах (2 контура). Договорились о выезде на обследование в четверг и КП после осмотра.',
      ai_sentiment: 'positive',
      ai_is_target: true,
      ai_lead_data: JSON.stringify(leadDone),
      ai_quality_score: 9,
      record_path: '/tmp/demo-visual-call.wav',
      dadata_city: 'Москва',
      dadata_region: 'Московская область',
      dadata_operator: 'МТС',
      note: 'Клиент ждёт подтверждение выезда',
      mins_ago: 12,
    },
    {
      call_type: 'inbound',
      from_number: '+7499VIS0002',
      to_number: '74991234567',
      duration_seconds: 95,
      transcript_status: 'processing',
      record_path: '/tmp/demo-visual-call.wav',
      dadata_city: 'Казань',
      ai_summary: null,
      mins_ago: 25,
    },
    {
      call_type: 'missed',
      from_number: '+7499VIS0003',
      to_number: '74991234567',
      duration_seconds: 0,
      transcript_status: 'none',
      dadata_city: 'Санкт-Петербург',
      mins_ago: 40,
    },
    {
      call_type: 'inbound',
      from_number: '+7499VIS0004',
      to_number: '74991234567',
      duration_seconds: 120,
      transcript_status: 'done',
      transcript: 'Клиент: Нужен прайс.\nМенеджер: Сейчас уточню и перезвоню.',
      transcript_segments: JSON.stringify([
        { start: 0, end: 3, speaker: 1, text: 'Нужен прайс на промывку.' },
        { start: 3.2, end: 6, speaker: 0, text: 'Сейчас уточню и перезвоню.' },
      ]),
      ai_summary: 'Ошибка ИИ-анализа: недостаточно средств на балансе RouterAI',
      record_path: '/tmp/demo-visual-call.wav',
      mins_ago: 55,
    },
    {
      call_type: 'outbound',
      from_number: '74991234567',
      to_number: '+7499VIS0005',
      line_number: '74991234567',
      duration_seconds: 64,
      transcript_status: 'done',
      transcript: 'Менеджер: Перезваниваю по КП.\nКлиент: Да, смотрим.',
      transcript_segments: JSON.stringify([
        { start: 0, end: 4, speaker: 0, text: 'Перезваниваю по коммерческому предложению.' },
        { start: 4.2, end: 7, speaker: 1, text: 'Да, смотрим, перезвоните завтра.' },
      ]),
      record_path: '/tmp/demo-visual-call.wav',
      mins_ago: 70,
    },
  ];

  for (const r of rows) {
    const dur = r.duration_seconds || 0;
    const mins = r.mins_ago || 10;
    const st = dur === 0 ? 'missed' : 'answered';
    await pool.query(
      `INSERT INTO call_history (
        call_id, caller_number, called_number, timestamp, duration,
        user_id, call_type, from_number, to_number, line_number, duration_seconds,
        client_inn, transcript_status, transcript, transcript_segments,
        ai_summary, ai_sentiment, ai_is_target, ai_lead_data, ai_quality_score,
        record_path, dadata_city, dadata_region, dadata_operator, note,
        created_at, updated_at, started_at, ended_at, direction, status
      ) VALUES (
        $23, $3, COALESCE($4, $5), NOW() - make_interval(mins => $21::int), $6,
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10::jsonb,
        $11,$12,$13,$14::jsonb,$15,
        $16,$17,$18,$19,$20,
        NOW() - make_interval(mins => $21::int), NOW(),
        NOW() - make_interval(mins => $21::int) - make_interval(secs => $6::int),
        NOW() - make_interval(mins => $21::int),
        $2, $22
      )`,
      [
        uid,
        r.call_type,
        r.from_number,
        r.to_number || null,
        r.line_number || null,
        dur,
        r.client_inn || null,
        r.transcript_status,
        r.transcript || null,
        r.transcript_segments || null,
        r.ai_summary || null,
        r.ai_sentiment || null,
        r.ai_is_target != null ? r.ai_is_target : null,
        r.ai_lead_data || null,
        r.ai_quality_score || null,
        r.record_path || null,
        r.dadata_city || null,
        r.dadata_region || null,
        r.dadata_operator || null,
        r.note || null,
        mins,
        st,
        'demo-vis-' + r.from_number.replace(/\D/g, '') + '-' + mins,
      ]
    );
  }

  const cnt = await pool.query(
    `SELECT count(*)::int AS n FROM call_history WHERE from_number LIKE '+7499VIS%' OR to_number LIKE '+7499VIS%'`
  );
  console.log('SEEDED', cnt.rows[0].n, 'demo calls on', dbName, 'uid', uid);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
