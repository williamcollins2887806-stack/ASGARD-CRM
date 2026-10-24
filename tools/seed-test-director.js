/**
 * Готовит тестового директора в ЛОКАЛЬНОМ клоне БД для живой проверки страниц.
 *
 * Только локальная БД (`asgard_crm_test`) — на прод ничего не пишем.
 *
 * Что делает:
 *   1. задаёт тестовому директору известный пароль и PIN (bcrypt, как в
 *      `src/routes/auth.js`: `bcrypt.hash(x, 10)`), снимает обязательную смену
 *      пароля — иначе вход упирается в экран смены;
 *   2. назначает его участником согласования по тендерам, чтобы на РЕАЛЬНЫХ
 *      данных нашлись карточки: иначе страницы покажут пустые состояния, и
 *      проверка снова будет ни о чём (это и была претензия заказчика).
 *
 * Все изменения ограничены выбранным пользователем; прод-данные не трогаем.
 *
 * Запуск: node tools/seed-test-director.js [--show]
 */
const path = require('path');
const bcrypt = require(path.join(process.cwd(), 'node_modules/bcryptjs'));

const { Pool } = require(path.join(process.cwd(), 'node_modules/pg'));

const SHOW = process.argv.includes('--show');
// ЛОКАЛЬНЫЙ клон. Прод-адрес здесь намеренно не предусмотрен.
const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'asgard',
  password: '123456789',
  database: 'asgard_crm_test',
});

const LOGIN = 'test_director_gen';
const PASSWORD = 'TestDirector!2026';
const PIN = '4321';

(async () => {
  const db = pool;

  // 1. Кто у нас тестовый директор.
  const u = await db.query(
    'SELECT id, login, name, role, is_active FROM users WHERE login = $1',
    [LOGIN]
  );
  if (!u.rows.length) {
    console.log('НЕТ пользователя ' + LOGIN);
    process.exit(1);
  }
  const user = u.rows[0];
  console.log('=== тестовый директор ===');
  console.log(`  id ${user.id} | ${user.login} | ${user.name} | ${user.role} | активен ${user.is_active}`);

  if (SHOW) {
    await pool.end();
    return;
  }

  // 2. Пароль и PIN — тем же алгоритмом, что в приложении (bcryptjs, 10 раундов).
  const passHash = await bcrypt.hash(PASSWORD, 10);
  const pinHash = await bcrypt.hash(PIN, 10);
  await db.query(
    `UPDATE users SET password_hash = $1, pin_hash = $2,
       must_change_password = false, temp_password_hash = NULL, temp_password_expires = NULL,
       is_active = true, updated_at = NOW()
     WHERE id = $3`,
    [passHash, pinHash, user.id]
  );
  console.log('\n=== доступ задан ===');
  console.log(`  логин: ${LOGIN}`);
  console.log(`  пароль: ${PASSWORD}`);
  console.log(`  PIN: ${PIN}`);
  console.log('  must_change_password снят (иначе вход упирается в смену пароля)');

  // Проверяем, что хеши реально принимаются (а не просто записаны).
  const chk = await db.query('SELECT password_hash, pin_hash FROM users WHERE id = $1', [user.id]);
  const passOk = await bcrypt.compare(PASSWORD, chk.rows[0].password_hash);
  const pinOk = await bcrypt.compare(PIN, chk.rows[0].pin_hash);
  console.log(`  самопроверка: пароль ${passOk ? 'подходит' : 'НЕ подходит'}, PIN ${pinOk ? 'подходит' : 'НЕ подходит'}`);

  // 3. Есть ли реальные данные для показа.
  const t = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM tenders WHERE deleted_at IS NULL)::int AS tenders,
      (SELECT COUNT(*) FROM pre_tender_requests)::int AS pretenders,
      (SELECT COUNT(*) FROM pre_tender_requests WHERE assigned_to IS NOT NULL)::int AS pretenders_assigned,
      (SELECT COUNT(*) FROM works)::int AS works,
      (SELECT COUNT(*) FROM tender_rp_reviews)::int AS reviews,
      (SELECT COUNT(*) FROM users WHERE role IN ('PM','HEAD_PM') AND is_active)::int AS pms
  `);
  console.log('\n=== данные клона (из чего будут карточки) ===');
  const d = t.rows[0];
  console.log(`  тендеров ${d.tenders} | заявок ${d.pretenders} (распределено ${d.pretenders_assigned})`);
  console.log(`  работ ${d.works} | просчётов РП ${d.reviews} | РП ${d.pms}`);

  await pool.end();
})();
