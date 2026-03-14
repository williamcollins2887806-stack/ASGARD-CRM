const nodemailer = require('nodemailer');
const fs = require('fs');

const SEND_TO = ['ok', 'go', 'a.storozhev', 'hv'];

const SMTP_HOST = 'smtp.yandex.ru';
const SMTP_PORT = 465;
const SMTP_USER = 'crm@asgard-service.com';
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_NAME = 'ASGARD CRM';
const CRM_URL = 'https://asgard-crm.ru';

const vikingQuotes = [
  { quote: 'Великий ярл не ждёт попутного ветра — он поднимает парус при любом.', author: 'Древняя мудрость Мидгарда' },
  { quote: 'Ворон Одина видит далеко, но мудрый вождь видит дальше — он видит путь.', author: 'Сага о стратегах' },
  { quote: 'Кто строит крепость — тот хранит будущее. Кто разрушает — лишь прошлое.', author: 'Речи Высокого' },
  { quote: 'Архитектор победы — тот, кто видит целое, когда другие видят части.', author: 'Мудрость Мимира' },
];

const roleDescriptions = {
  'DIRECTOR_GEN': 'Генеральный директор — полный доступ ко всем разделам CRM: управление проектами, финансами, персоналом, тендерами и аналитикой. Вы видите все данные компании и можете принимать решения на любом уровне.',
  'DIRECTOR_COMM': 'Коммерческий директор — доступ к тендерам, клиентам, воронке продаж, финансовой аналитике и отчётам. Вы управляете коммерческой стратегией и контролируете доходную часть бизнеса.',
  'DIRECTOR_DEV': 'Директор по развитию — доступ к проектам, аналитике, тендерам, планированию и стратегическим отчётам. Вы определяете вектор развития компании и контролируете ключевые инициативы.',
  'HEAD_TO': 'Руководитель тендерного отдела — полный доступ к тендерам, предварительным заявкам, воронке продаж и аналитике отдела. Вы управляете тендерной деятельностью компании.',
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
          <td style="color:#e5e7eb;font-size:16px;padding:8px 0;font-weight:600;font-family:monospace;">${user.login}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;font-size:12px;padding:8px 0;text-transform:uppercase;letter-spacing:1px;">Временный пароль</td>
          <td style="color:#e5e7eb;font-size:16px;padding:8px 0;font-weight:600;font-family:monospace;">${user.password}</td>
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

(async () => {
  const credentials = JSON.parse(fs.readFileSync('/tmp/user_credentials.json', 'utf8'));
  const targets = credentials.filter(u => SEND_TO.includes(u.login));

  console.log('Sending to ' + targets.length + ' users:');
  targets.forEach(u => console.log('  ' + u.login + ' -> ' + u.email));

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  for (let i = 0; i < targets.length; i++) {
    const u = targets[i];
    const html = generateEmailHTML(u, i);
    try {
      await transporter.sendMail({
        from: `"${FROM_NAME}" <${SMTP_USER}>`,
        to: u.email,
        subject: '⚔️ Добро пожаловать в АСГАРД CRM — ваши учётные данные',
        html: html
      });
      console.log('✅ ' + u.name + ' (' + u.email + ')');
    } catch(e) {
      console.error('❌ ' + u.email + ': ' + e.message);
    }
    if (i < targets.length - 1) await new Promise(r => setTimeout(r, 2000));
  }
  console.log('\nDone!');
})();
