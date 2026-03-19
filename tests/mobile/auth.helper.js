const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const JWT_SECRET = 'asgard-jwt-secret-2026';

const PUBLIC_DIR = path.resolve(__dirname, '../../public');

const DEFAULT_USER = {
  id: 1,
  role: 'ADMIN',
  login: 'admin',
  name: 'Администратор',
};

/**
 * Перехватить статику (CSS/JS) — отдавать из локальных файлов.
 * HTML/API идут с сервера.
 */
async function setupLocalAssets(page) {
  // CSS — из локальных файлов
  await page.route('**/*.css*', async (route) => {
    var url = new URL(route.request().url());
    if (!url.hostname.includes('asgard-crm.ru')) {
      return route.fulfill({ body: '', contentType: 'text/css' });
    }
    var localPath = path.join(PUBLIC_DIR, url.pathname);
    try {
      var body = fs.readFileSync(localPath);
      await route.fulfill({ body: body, contentType: 'text/css' });
    } catch (e) {
      await route.fulfill({ body: '', contentType: 'text/css' });
    }
  });

  // JS — из локальных файлов
  await page.route('**/*.js*', async (route) => {
    var url = new URL(route.request().url());
    if (!url.hostname.includes('asgard-crm.ru')) {
      return route.fulfill({ body: '', contentType: 'application/javascript' });
    }
    var localPath = path.join(PUBLIC_DIR, url.pathname);
    try {
      var body = fs.readFileSync(localPath);
      await route.fulfill({ body: body, contentType: 'application/javascript' });
    } catch (e) {
      await route.fulfill({ body: '', contentType: 'application/javascript' });
    }
  });

  // Google Fonts — пустой
  await page.route('**/fonts.googleapis.com/**', (route) =>
    route.fulfill({ body: '', contentType: 'text/css' })
  );
  await page.route('**/fonts.gstatic.com/**', (route) =>
    route.fulfill({ body: '', contentType: 'font/woff2' })
  );

  // unpkg (leaflet и др.) — пустой
  await page.route('**/unpkg.com/**', (route) =>
    route.fulfill({ body: '', contentType: 'text/css' })
  );
}

async function loginByToken(page, opts) {
  var user = Object.assign({}, DEFAULT_USER, opts || {});
  var token = jwt.sign(
    { id: user.id, role: user.role, login: user.login },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Перехват статики ПЕРЕД навигацией
  await setupLocalAssets(page);

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);

  await page.evaluate(function (data) {
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('asgard_mobile_state', JSON.stringify({
      user: {
        id: data.user.id,
        role: data.user.role,
        login: data.user.login,
        name: data.user.name,
        token: data.token,
      },
      theme: 'dark',
    }));
  }, { token: token, user: user });

  await page.goto('/#/home', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);
}

module.exports = { loginByToken, setupLocalAssets };
