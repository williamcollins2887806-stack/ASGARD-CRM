// ASGARD CRM — Viking-themed Invitation Emails
const nodemailer = require('nodemailer');
const fs = require('fs');

// SMTP config — NEEDS TO BE FILLED
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.yandex.ru';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const SMTP_USER = process.env.SMTP_USER || 'crm@asgard-service.com';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_NAME = 'ASGARD CRM';
const FROM_EMAIL = SMTP_USER;
const CRM_URL = 'https://asgard-crm.ru';

// Viking quotes — unique for each person
const vikingQuotes = [
  { quote: 'Великий ярл не ждёт попутного ветра — он поднимает парус при любом.', author: 'Древняя мудрость Мидгарда' },
  { quote: 'Ворон Одина видит далеко, но мудрый вождь видит дальше — он видит путь.', author: 'Сага о стратегах' },
  { quote: 'Кто строит крепость — тот хранит будущее. Кто разрушает — лишь прошлое.', author: 'Речи Высокого' },
  { quote: 'Меч без мастера — железо. Мастер без знаний — путник без дороги.', author: 'Кузнечная сага' },
  { quote: 'Дружина сильна не числом, а тем, как каждый знает своё место в строю.', author: 'Наставления Тюра' },
  { quote: 'Тендер — это битва, в которой побеждает не сильнейший, а мудрейший.', author: 'Хроники тендерных сражений' },
  { quote: 'Руны не лгут: кто ведёт счёт — тот ведёт корабль к цели.', author: 'Сага о цифрах' },
  { quote: 'Первым в поход выходит разведчик, но славу дружине приносит каждый.', author: 'Путь воина' },
  { quote: 'Море не прощает слабых, но щедро награждает храбрых и упорных.', author: 'Морская мудрость' },
  { quote: 'Молот Тора бьёт точно — так и проект должен быть завершён в срок.', author: 'Заветы проектного ярла' },
  { quote: 'Корабль без руля — бревно в море. Проект без плана — битва без стратегии.', author: 'Наставления Фрейра' },
  { quote: 'Один дал людям руны, чтобы те записывали мудрость, а не повторяли ошибки.', author: 'Эдда знаний' },
  { quote: 'Торговец, знающий цену каждому гвоздю, построит дракар из щепок.', author: 'Мудрость Ньёрда' },
  { quote: 'Склад — это сердце крепости. Без него дружина голодна, а мечи тупы.', author: 'Хранители Вальхаллы' },
  { quote: 'Золото любит точный счёт, как корабль — верный курс.', author: 'Слово казначея Асгарда' },
  { quote: 'Два меча рядом крепче одного — вместе мы кладём начало великим делам.', author: 'Закон дружины' },
  { quote: 'Порядок в зале — порядок в битве. Офис — крепость, из которой начинается поход.', author: 'Устав крепости' },
  { quote: 'Зоркий глаз находит золотую жилу там, где другие видят лишь камни.', author: 'Сага о первопроходцах' },
  { quote: 'Перо летописца острее меча — ибо слово переживёт и сталь, и время.', author: 'Хроники рунописцев' },
  { quote: 'Архитектор победы — тот, кто видит целое, когда другие видят части.', author: 'Мудрость Мимира' },
];

const roleDescriptions = {
  'DIRECTOR_GEN': 'Генеральный директор — полный доступ ко всем разделам CRM: управление проектами, финансами, персоналом, тендерами и аналитикой. Вы видите все данные компании и можете принимать решения на любом уровне.',
  'DIRECTOR_COMM': 'Коммерческий директор — доступ к тендерам, клиентам, воронке продаж, финансовой аналитике и отчётам. Вы управляете коммерческой стратегией и контролируете доходную часть бизнеса.',
  'DIRECTOR_DEV': 'Директор по развитию — доступ к проектам, аналитике, тендерам, планированию и стратегическим отчётам. Вы определяете вектор развития компании и контролируете ключевые инициативы.',
  'CHIEF_ENGINEER': 'Главный инженер — управление складом оборудования, контроль ТМЦ, техническое обеспечение проектов. Вы отвечаете за техническую готовность и ресурсное обеспечение.',
  'HEAD_PM': 'Руководитель ПТО — управление всеми работами и проектами, контроль смет, согласование актов и документации. Вы координируете работу руководителей проектов.',
  'HEAD_TO': 'Руководитель тендерного отдела — полный доступ к тендерам, предварительным заявкам, воронке продаж и аналитике отдела. Вы управляете тендерной деятельностью компании.',
  'PM': 'Руководитель проектов — управление работами, сметами, согласованиями, командой на объекте. Вы ведёте свои проекты от старта до завершения.',
  'TO': 'Менеджер тендерного отдела — работа с тендерами, подготовка ТКП, анализ конкурентов и ведение клиентской базы.',
  'BUH': 'Бухгалтер — управление финансами: счета, акты, кассовые заявки, банковские операции и платёжный реестр.',
  'PROC': 'Руководитель закупок — управление закупками, заявками на ТМЦ, логистикой и взаимодействием с поставщиками.',
  'WAREHOUSE': 'Заведующий складом — полный контроль складских операций: приём, выдача, инвентаризация оборудования и ТМЦ.',
  'OFFICE_MANAGER': 'Офис-менеджер — управление офисными расходами, корреспонденцией, договорами и организационными вопросами.',
  'HR': 'HR-специалист — управление персоналом: запросы на подбор, обучение, допуски и кадровая документация.',
  'HR_MANAGER': 'HR-менеджер — расширенное управление персоналом с доступом к аналитике и рейтингам сотрудников.',
};

function generateEmailHTML(user, quoteIdx) {
  const q = vikingQuotes[quoteIdx % vikingQuotes.length];
  const roleDesc = roleDescriptions[user.role] || 'Доступ к основным разделам CRM системы.';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0e17;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:20px;">

  <!-- Header -->
  <div style="text-align:center;padding:40px 20px 30px;background:linear-gradient(135deg, #1a1f35 0%, #0d1117 100%);border-radius:16px 16px 0 0;border-bottom:3px solid #c9a84c;">
    <div style="font-size:48px;margin-bottom:8px;">⚔️</div>
    <h1 style="color:#c9a84c;font-size:28px;margin:0;letter-spacing:2px;font-weight:700;">АСГАРД CRM</h1>
    <div style="color:#8b95a5;font-size:13px;margin-top:8px;letter-spacing:4px;">ᚠᚢᚦᚨᚱᚲ • СИСТЕМА УПРАВЛЕНИЯ</div>
  </div>

  <!-- Quote -->
  <div style="background:#12162a;padding:24px 30px;border-left:4px solid #c9a84c;">
    <div style="color:#e8d9b0;font-style:italic;font-size:15px;line-height:1.6;">«${q.quote}»</div>
    <div style="color:#6b7280;font-size:12px;margin-top:8px;">— ${q.author}</div>
  </div>

  <!-- Main Content -->
  <div style="background:#151929;padding:30px;">
    <h2 style="color:#e5e7eb;font-size:20px;margin:0 0 16px;">Добро пожаловать, ${user.name.split(' ')[1] || user.name.split(' ')[0]}!</h2>
    <p style="color:#9ca3af;font-size:14px;line-height:1.7;margin:0 0 24px;">
      Для вас создана учётная запись в корпоративной CRM-системе АСГАРД.
      Ниже — ваши данные для входа.
    </p>

    <!-- Credentials Card -->
    <div style="background:#1e2340;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid #2d3555;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="color:#6b7280;font-size:12px;padding:8px 0;text-transform:uppercase;letter-spacing:1px;">Логин</td>
          <td style="color:#e5e7eb;font-size:16px;padding:8px 0;font-weight:600;font-family:monospace;" id="login-val">${user.login}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;font-size:12px;padding:8px 0;text-transform:uppercase;letter-spacing:1px;">Временный пароль</td>
          <td style="color:#e5e7eb;font-size:16px;padding:8px 0;font-weight:600;font-family:monospace;" id="pass-val">${user.password}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;font-size:12px;padding:8px 0;text-transform:uppercase;letter-spacing:1px;">Роль</td>
          <td style="color:#c9a84c;font-size:14px;padding:8px 0;font-weight:600;">${user.title}</td>
        </tr>
      </table>
    </div>

    <!-- Role Description -->
    <div style="background:#1a1f35;border-radius:8px;padding:16px 20px;margin-bottom:24px;border-left:3px solid #3b82f6;">
      <div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Ваши возможности</div>
      <div style="color:#d1d5db;font-size:13px;line-height:1.6;">${roleDesc}</div>
    </div>

    <!-- Login Instructions -->
    <div style="background:#1a1f35;border-radius:8px;padding:16px 20px;margin-bottom:28px;">
      <div style="color:#c9a84c;font-size:13px;font-weight:600;margin-bottom:10px;">📋 Как войти:</div>
      <ol style="color:#9ca3af;font-size:13px;line-height:2;margin:0;padding-left:20px;">
        <li>Откройте сайт по ссылке ниже</li>
        <li>Нажмите <strong style="color:#e5e7eb;">«Войти»</strong></li>
        <li>Введите логин и временный пароль</li>
        <li>Система предложит вам <strong style="color:#e5e7eb;">создать постоянный пароль и PIN-код</strong></li>
      </ol>
    </div>

    <!-- CTA Button -->
    <div style="text-align:center;margin-bottom:20px;">
      <a href="${CRM_URL}" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#b8962e);color:#0a0e17;text-decoration:none;padding:16px 48px;border-radius:8px;font-size:16px;font-weight:700;letter-spacing:1px;">
        ⚔️ ВОЙТИ В CRM
      </a>
    </div>

    <!-- Copy Instructions -->
    <div style="text-align:center;margin-bottom:8px;">
      <div style="color:#6b7280;font-size:11px;">Скопируйте учётные данные:</div>
      <div style="color:#9ca3af;font-size:12px;margin-top:4px;font-family:monospace;background:#1e2340;display:inline-block;padding:8px 16px;border-radius:6px;">
        ${user.login} / ${user.password}
      </div>
      <div style="color:#6b7280;font-size:11px;margin-top:8px;">⚠️ При первом входе вы создадите постоянный пароль и PIN-код</div>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#0d1117;padding:20px 30px;border-radius:0 0 16px 16px;text-align:center;border-top:1px solid #1e2340;">
    <div style="color:#4b5563;font-size:11px;line-height:1.6;">
      АСГАРД CRM • Корпоративная система управления<br>
      Это автоматическое письмо. При возникновении вопросов обратитесь к администратору.
    </div>
  </div>

</div>
</body>
</html>`;
}

// Main
(async () => {
  const credentials = JSON.parse(fs.readFileSync('/tmp/user_credentials.json', 'utf8'));

  if (!SMTP_PASS) {
    console.log('SMTP_PASS not set. Generating HTML previews only.');

    // Generate test email for Androsov
    const androsov = credentials.find(u => u.login === 'n.androsov');
    if (androsov) {
      const html = generateEmailHTML(androsov, 19);
      fs.writeFileSync('/tmp/invitation_preview.html', html);
      console.log('Preview saved to /tmp/invitation_preview.html');
      console.log('Send to: ' + androsov.email);
    }

    // Generate all previews
    credentials.forEach((u, i) => {
      const html = generateEmailHTML(u, i);
      fs.writeFileSync('/tmp/invitation_' + u.login + '.html', html);
    });
    console.log('All ' + credentials.length + ' invitation HTMLs saved to /tmp/invitation_*.html');
    return;
  }

  // Create transporter
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  // Test mode — send only to Androsov first
  const testMode = process.argv.includes('--test');
  const targets = testMode
    ? credentials.filter(u => u.login === 'n.androsov')
    : credentials;

  for (let i = 0; i < targets.length; i++) {
    const u = targets[i];
    const html = generateEmailHTML(u, i);

    try {
      await transporter.sendMail({
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to: u.email,
        subject: '⚔️ Добро пожаловать в АСГАРД CRM — ваши учётные данные',
        html: html
      });
      console.log('✅ Sent to ' + u.email + ' (' + u.name + ')');
    } catch(e) {
      console.error('❌ Failed ' + u.email + ': ' + e.message);
    }

    // Small delay between sends
    if (i < targets.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\nDone! Sent ' + targets.length + ' invitations.');
})();
