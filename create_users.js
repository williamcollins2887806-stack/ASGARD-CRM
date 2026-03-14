// Create ASGARD CRM users from the list
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  user: 'asgard',
  password: '123456789',
  host: 'localhost',
  database: 'asgard_crm',
  port: 5432
});

const users = [
  { login: 'ok', name: 'Кудряшов Олег Сергеевич', email: 'ok@asgard-service.com', role: 'DIRECTOR_GEN', phone: '+79164766332', title: 'Генеральный директор' },
  { login: 'go', name: 'Гажилиев Олег Викторович', email: 'go@asgard-service.com', role: 'DIRECTOR_COMM', phone: '+79651403332', title: 'Коммерческий директор' },
  { login: 'a.storozhev', name: 'Сторожев Андрей Александрович', email: 'a.storozhev@asgard-service.com', role: 'DIRECTOR_DEV', phone: '+79017342575', title: 'Директор по развитию' },
  { login: 'd.klimakin', name: 'Климакин Дмитрий Владимирович', email: 'd.klimakin@asgard-service.com', role: 'CHIEF_ENGINEER', phone: '+79179946600', title: 'и.о. Главного инженера' },
  { login: 'iu.ivaneikin', name: 'Иванейкин Юрий Николаевич', email: 'iu.ivaneikin@asgard-service.com', role: 'HEAD_PM', phone: '+79170666668', title: 'Руководитель ПТО' },
  { login: 'hv', name: 'Вилявисенсио-Мятов Хосе Александр', email: 'hv@asgard-service.com', role: 'HEAD_TO', phone: '+79168888934', title: 'Руководитель тендерного отдела' },
  { login: 'ev', name: 'Иванова Елена Васильевна', email: 'ev@asgard-service.com', role: 'TO', phone: '+79268992797', title: 'Менеджер тендерного отдела' },
  { login: 'a.trukhin', name: 'Трухин Антон Сергеевич', email: 'a.trukhin@asgard-service.com', role: 'PM', phone: '+79173001881', title: 'Руководитель направления МЛСП «Приразломная»' },
  { login: 'r.rochshupkin', name: 'Рощупкин Роман Владимирович', email: 'r.rochshupkin@asgard-service.com', role: 'PM', phone: '+79376355170', title: 'Руководитель направления «Астраханский ГПЗ»' },
  { login: 'e.zisser', name: 'Зиссер Елисей Олегович', email: 'e.zisser@asgard-service.com', role: 'PM', phone: '+79244099044', title: 'Руководитель проектов' },
  { login: 'd.putkov', name: 'Путков Дмитрий Вадимович', email: 'd.putkov@asgard-service.com', role: 'PM', phone: '+79671153099', title: 'Руководитель проектов' },
  { login: 'a.iakovlev', name: 'Яковлев Антон Анатольевич', email: 'a.iakovlev@asgard-service.com', role: 'PM', phone: '+79856110065', title: 'Руководитель проектов' },
  { login: 'bv', name: 'Баринов Виктор Александрович', email: 'bv@asgard-service.com', role: 'PROC', phone: '+79295891937', title: 'Руководитель закупок и логистики' },
  { login: 'a.pantuzenko', name: 'Пантузенко Александр Викторович', email: 'a.pantuzenko@asgard-service.com', role: 'WAREHOUSE', phone: '+79858531445', title: 'Заведующий складом' },
  { login: 'glavbuh', name: 'Скрипник Елена Анатольевна', email: 'glavbuh@asgard-service.com', role: 'BUH', phone: '+79162424280', title: 'Главный бухгалтер' },
  { login: 'buh', name: 'Кононова Анастасия Викторовна', email: 'buh@asgard-service.com', role: 'BUH', phone: '+79269005064', title: 'Бухгалтер' },
  { login: 'office', name: 'Тумаева Виктория Анатольевна', email: 'office@asgard-service.com', role: 'OFFICE_MANAGER', phone: '+79199900139', title: 'Офис-менеджер' },
  { login: 'g.gazretov', name: 'Газретов Гаджи Алимурадович', email: 'g.gazretov@asgard-service.com', role: 'TO', phone: '+79205476586', title: 'Менеджер тендерного отдела' },
  { login: 'e.danilova', name: 'Данилова Елизавета Олеговна', email: 'e.danilova@asgard-service.com', role: 'TO', phone: '+79502574254', title: 'Менеджер тендерного отдела' },
  { login: 'n.androsov', name: 'Андросов Никита Андреевич', email: 'n.androsov@asgard-service.com', role: 'PM', phone: '+79160614809', title: 'Руководитель проекта' },
];

// Generate passwords: first letter of name + last name in latin + 4 digits
function generatePassword(name) {
  const parts = name.split(' ');
  const lastName = parts[0];
  // Simple transliteration
  const translit = {
    'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'E','Ж':'Zh','З':'Z','И':'I','Й':'Y',
    'К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F',
    'Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Sch','Ы':'Y','Э':'E','Ю':'Yu','Я':'Ya',
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
    'х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ы':'y','э':'e','ю':'yu','я':'ya',
    'ъ':'','ь':'','-':'-'
  };
  const latinLast = lastName.split('').map(c => translit[c] || c).join('');
  const num = String(Math.floor(1000 + Math.random() * 9000));
  return latinLast + num;
}

const DEFAULT_PIN = '1234';

(async () => {
  const created = [];

  for (const u of users) {
    const password = generatePassword(u.name);
    const passwordHash = await bcrypt.hash(password, 10);
    const pinHash = await bcrypt.hash(DEFAULT_PIN, 10);

    try {
      const result = await pool.query(`
        INSERT INTO users (login, password_hash, pin_hash, name, email, role, phone, is_active, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
        RETURNING id, login, name, role
      `, [u.login, passwordHash, pinHash, u.name, u.email, u.role, u.phone]);

      const row = result.rows[0];
      created.push({
        id: row.id,
        login: u.login,
        password: password,
        pin: DEFAULT_PIN,
        name: u.name,
        email: u.email,
        role: u.role,
        title: u.title,
        phone: u.phone
      });

      console.log(`+ ${u.login} (${u.role}) -> ID ${row.id}`);
    } catch(e) {
      console.error(`! ${u.login}: ${e.message}`);
    }
  }

  // Save credentials to file (for email sending)
  const fs = require('fs');
  fs.writeFileSync('/tmp/user_credentials.json', JSON.stringify(created, null, 2));
  console.log('\nCreated: ' + created.length + ' users');
  console.log('Credentials saved to /tmp/user_credentials.json');

  // Print table
  console.log('\n--- CREDENTIALS ---');
  created.forEach(u => {
    console.log(`${u.name} | ${u.login} | ${u.password} | PIN: ${u.pin} | ${u.role} | ${u.email}`);
  });

  await pool.end();
})();
