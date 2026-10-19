'use strict';
/**
 * V410: засев алиасов почт из присланного заказчиком списка (19.10.2026).
 * Сопоставление: точная почта → логин (local-part) → ФИО (две части имени).
 * Без совпадения — записываем как «непривязанный» (user_id=NULL) для офис-менеджера.
 */
const { Pool } = require('pg');
require('dotenv').config();

const LIST = [
  ['go@asgard-service.com', 'Гажилиев Олег Викторович'],
  ['ok@asgard-service.com', 'Кудряшов Олег Сергеевич'],
  ['buh@asgard-service.com', 'Бухгалтер АСГАРД-Сервис'],
  ['glavbuh@asgard-service.com', 'Бухгалтер АСГАРД-Сервис'],
  ['a.storozhev@asgard-service.com', 'Сторожев Андрей Александрович'],
  ['n.androsov@asgard-service.com', 'Андросов Никита Андреевич'],
  ['d.putkov@asgard-service.com', 'Путков Дмитрий Вадимович'],
  ['a.iakovlev@asgard-service.com', 'Яковлев Антон Анатольевич'],
  ['d.klimakin@asgard-service.com', 'Климакин Дмитрий Владимирович'],
  ['a.tapenov@asgard-service.com', 'Тапенов Асан Сирикбаевич'],
  ['r.zuban@asgard-service.com', 'Зубань Руслан Владимирович'],
  ['r.rochshupkin@asgard-service.com', 'Рощупкин Роман Владимирович'],
  ['s.piraev@asgard-service.com', 'Пираев Сергей Викторович'],
  ['iu.ivaneikin@asgard-service.com', 'Иванейкин Юрий Николаевич'],
  ['i.morozov@asgard-service.com', 'Морозов Иван Михайлович'],
  ['e.danilova@asgard-service.com', 'Данилова Елизавета Олеговна'],
  ['hv@asgard-service.com', 'Хосе Александр Вилявисенсио-Мятов'],
  ['ev@asgard-service.com', 'Иванова Елена Васильевна'],
  ['g.gazretov@asgard-service.com', 'Газретов Гаджи Алимурадович'],
  ['agpz@asgard-service.com', 'АГПЗ АСГАРД-Сервис'],
  ['bv@asgard-service.com', 'Баринов Виктор Александрович'],
  // Алиасы из реального трафика (pd@ = Путков — видно по from_name писем).
  ['pd@asgard-service.com', 'Путков Дмитрий Вадимович'],
  // Личная почта Андросова (письмо Re: МЛСП со счётом).
  ['andr0sov.nikita@yandex.ru', 'Андросов Никита Андреевич']
];

// Явные привязки: несколько почт на ОДИН аккаунт (заказчик 19.10.2026:
// «Пираев — это АГПЗ, 2 почты, 1 аккаунт»). Значение — почта-эталон, чей аккаунт берём.
const ALIAS_OVERRIDES = [
  ['s.piraev@asgard-service.com', 'agpz@asgard-service.com', 'АГПЗ (Пираев Сергей Викторович)']
];

(async () => {
  const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME || 'asgard_crm_test', user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  let linked = 0, unlinked = 0, failed = 0;
  for (const [email, fio] of LIST) {
    const e = email.toLowerCase();
    let userId = null;
    // 1) точная почта
    let r = await pool.query(`SELECT id FROM users WHERE lower(email)=$1 AND is_active IS NOT FALSE LIMIT 1`, [e]);
    if (r.rows[0]) userId = r.rows[0].id;
    // 2) по логину (local-part)
    if (!userId) {
      r = await pool.query(`SELECT id FROM users WHERE lower(login)=$1 AND is_active IS NOT FALSE LIMIT 1`, [e.split('@')[0]]);
      if (r.rows[0]) userId = r.rows[0].id;
    }
    // 3) по ФИО (первые две части имени)
    if (!userId) {
      const parts = fio.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        r = await pool.query(
          `SELECT id FROM users WHERE lower(name) LIKE $1 AND lower(name) LIKE $2 AND is_active IS NOT FALSE ORDER BY id LIMIT 1`,
          ['%' + parts[0].toLowerCase() + '%', '%' + parts[1].toLowerCase() + '%']);
        if (r.rows[0]) userId = r.rows[0].id;
      }
    }
    const ins = await pool.query(
      `INSERT INTO user_email_aliases(email, user_id, source, label)
       VALUES($1,$2,'import',$3)
       ON CONFLICT (lower(email)) DO UPDATE SET user_id=EXCLUDED.user_id, source='import', label=EXCLUDED.label, updated_at=NOW()
       RETURNING user_id`,
      [e, userId, fio]);
    if (userId) { linked++; console.log('  OK   ' + e + '  → #' + userId + '  ' + fio); }
    else { unlinked++; console.log('  НЕТ  ' + e + '  (аккаунт не найден — оставит офис-менеджеру)'); }
  }
  console.log(`\nЗасеяно: привязано ${linked}, непривязано ${unlinked}`);

  // Явные привязки: несколько почт на один аккаунт (Пираев = АГПЗ).
  for (const [email, refEmail, label] of ALIAS_OVERRIDES) {
    const ref = (await pool.query(`SELECT user_id FROM user_email_aliases WHERE lower(email)=$1`, [refEmail.toLowerCase()])).rows[0];
    const uid = ref ? ref.user_id : null;
    await pool.query(
      `INSERT INTO user_email_aliases(email, user_id, source, label)
       VALUES($1,$2,'import',$3)
       ON CONFLICT (lower(email)) DO UPDATE SET user_id=EXCLUDED.user_id, source='import', label=EXCLUDED.label, updated_at=NOW()`,
      [email.toLowerCase(), uid, label]);
    console.log(uid ? `  OK   ${email}  → #${uid}  ${label} (через ${refEmail})`
                    : `  НЕТ  ${email}  (эталон ${refEmail} не привязан)`);
  }

  const all = await pool.query(`SELECT count(*)::int AS n FROM user_email_aliases`);
  console.log('всего алиасов:', all.rows[0].n);
  await pool.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
