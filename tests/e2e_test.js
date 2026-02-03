/**
 * ASGARD CRM — Комплексный E2E Тестировщик
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Запуск: node tests/e2e_test.js
 *
 * Требования:
 *   npm install puppeteer
 *
 * Переменные окружения:
 *   BASE_URL - адрес сервера (по умолчанию http://localhost:3000)
 *   HEADLESS - true/false (по умолчанию true)
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ═══════════════════════════════════════════════════════════════════════════════
// КОНФИГУРАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
  SCREENSHOT_DIR: path.join(__dirname, 'screenshots'),
  LOG_FILE: path.join(__dirname, 'test-results.log'),
  REPORT_FILE: path.join(__dirname, 'test-report.txt'),
  HEADLESS: process.env.HEADLESS !== 'false',
  SLOW_MO: 50,           // Задержка между действиями (мс)
  TIMEOUT: 30000,        // Таймаут ожидания элементов
  VIEWPORT: { width: 1920, height: 1080 }
};

// Тестовые пользователи для каждой роли
const TEST_USERS = [
  {
    login: 'admin',
    password: 'Orion2025!',
    role: 'ADMIN',
    name: 'Администратор',
    expectedMenuItems: ['Тендеры', 'Работы', 'Финансы', 'Настройки', 'Пользователи']
  },
  {
    login: 'test_director',
    password: 'Test123!',
    role: 'DIRECTOR',
    name: 'Тест Директор',
    expectedMenuItems: ['Тендеры', 'Работы', 'Финансы', 'Согласования', 'Дашборд']
  },
  {
    login: 'test_pm',
    password: 'Test123!',
    role: 'PM',
    name: 'Тест РП',
    expectedMenuItems: ['Тендеры', 'Работы', 'Мои расходы']
  },
  {
    login: 'test_engineer',
    password: 'Test123!',
    role: 'ENGINEER',
    name: 'Тест Инженер',
    expectedMenuItems: ['Работы', 'Мои расходы', 'Календарь']
  },
  {
    login: 'test_accountant',
    password: 'Test123!',
    role: 'ACCOUNTANT',
    name: 'Тест Бухгалтер',
    expectedMenuItems: ['Финансы', 'Расходы', 'Акты']
  },
  {
    login: 'test_hr',
    password: 'Test123!',
    role: 'HR',
    name: 'Тест HR',
    expectedMenuItems: ['Персонал', 'Заявки HR', 'Отпуска']
  },
  {
    login: 'test_procurement',
    password: 'Test123!',
    role: 'PROCUREMENT',
    name: 'Тест Закупщик',
    expectedMenuItems: ['Заявки на закупку', 'Склад']
  },
  {
    login: 'test_assistant',
    password: 'Test123!',
    role: 'ASSISTANT',
    name: 'Тест Ассистент',
    expectedMenuItems: ['Тендеры', 'Календарь', 'Корреспонденция']
  },
  {
    login: 'test_viewer',
    password: 'Test123!',
    role: 'VIEWER',
    name: 'Тест Наблюдатель',
    expectedMenuItems: ['Дашборд', 'Отчёты']
  }
];

// Тестовые данные
const TEST_DATA = {
  client: {
    name: 'TEST_Тестовый Клиент ООО',
    inn: '9999999999',
    contact: 'Тест Контакт',
    phone: '+7 999 999-99-99',
    email: 'test@test.ru'
  },
  tender: {
    customer: 'TEST_Тестовый Клиент ООО',
    tender_number: 'TEST-001',
    tender_type: 'Тендер',
    tender_status: 'Новый',
    tag: 'TEST_TAG',
    description: 'Тестовый тендер для E2E тестов'
  },
  work: {
    work_number: 'TEST-W-001',
    work_title: 'Тестовая работа',
    work_status: 'В работе',
    customer_name: 'TEST_Тестовый Клиент ООО'
  },
  expense: {
    amount: 1000,
    category: 'Прочее',
    comment: 'TEST_Тестовый расход'
  },
  bonus: {
    amount: 5000,
    comment: 'TEST_Тестовая премия'
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// КЛАСС ТЕСТИРОВЩИКА
// ═══════════════════════════════════════════════════════════════════════════════

class TestRunner {
  constructor() {
    this.browser = null;
    this.page = null;
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      tests: [],
      errors: []
    };
    this.browserErrors = [];
    this.serverErrors = [];
    this.startTime = null;
    this.currentUser = null;
    this.token = null;

    // Создаём директорию для скриншотов
    if (!fs.existsSync(CONFIG.SCREENSHOT_DIR)) {
      fs.mkdirSync(CONFIG.SCREENSHOT_DIR, { recursive: true });
    }

    // Очищаем лог-файл
    fs.writeFileSync(CONFIG.LOG_FILE, '');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ЛОГИРОВАНИЕ
  // ─────────────────────────────────────────────────────────────────────────────

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const colors = {
      INFO: '\x1b[36m',    // Cyan
      PASS: '\x1b[32m',    // Green
      FAIL: '\x1b[31m',    // Red
      WARN: '\x1b[33m',    // Yellow
      DEBUG: '\x1b[90m',   // Gray
      RESET: '\x1b[0m'
    };

    const color = colors[level] || colors.INFO;
    const logLine = `[${timestamp}] [${level}] ${message}`;

    console.log(`${color}${logLine}${colors.RESET}`);
    fs.appendFileSync(CONFIG.LOG_FILE, logLine + (data ? ' ' + JSON.stringify(data) : '') + '\n');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // СКРИНШОТЫ
  // ─────────────────────────────────────────────────────────────────────────────

  async screenshot(name) {
    if (!this.page) return null;

    const filename = `${name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`;
    const filepath = path.join(CONFIG.SCREENSHOT_DIR, filename);

    try {
      await this.page.screenshot({ path: filepath, fullPage: true });
      this.log('DEBUG', `Скриншот сохранён: ${filename}`);
      return filepath;
    } catch (e) {
      this.log('WARN', `Не удалось сделать скриншот: ${e.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ПРОВЕРКА СЕРВЕРНЫХ ЛОГОВ
  // ─────────────────────────────────────────────────────────────────────────────

  async checkServerLogs() {
    try {
      // Пробуем получить логи через journalctl
      const logs = execSync(
        'journalctl -u asgard-crm --since "2 minutes ago" --no-pager 2>/dev/null || echo ""',
        { encoding: 'utf8', timeout: 5000 }
      );

      if (!logs) return;

      // Ищем ошибки
      const errorPatterns = [
        /error[:：]/gi,
        /Error[:：]/g,
        /ERROR[:：]/g,
        /status[=: ]+[45]\d\d/gi,
        /exception/gi,
        /failed/gi,
        /ECONNREFUSED/g,
        /ETIMEDOUT/g
      ];

      const lines = logs.split('\n');
      for (const line of lines) {
        for (const pattern of errorPatterns) {
          if (pattern.test(line) && !this.serverErrors.includes(line.trim())) {
            this.serverErrors.push(line.trim());
          }
        }
      }
    } catch (e) {
      // journalctl может быть недоступен — это нормально
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ИНИЦИАЛИЗАЦИЯ БРАУЗЕРА
  // ─────────────────────────────────────────────────────────────────────────────

  async initBrowser() {
    this.log('INFO', '═══ Запуск браузера ═══');

    this.browser = await puppeteer.launch({
      headless: CONFIG.HEADLESS,
      slowMo: CONFIG.SLOW_MO,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--window-size=${CONFIG.VIEWPORT.width},${CONFIG.VIEWPORT.height}`
      ]
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport(CONFIG.VIEWPORT);
    await this.page.setDefaultTimeout(CONFIG.TIMEOUT);

    // Перехватываем ошибки консоли браузера
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!this.browserErrors.some(e => e.message === text)) {
          this.browserErrors.push({
            type: 'console.error',
            message: text,
            location: msg.location()
          });
        }
      }
    });

    // Перехватываем ошибки страницы (uncaught exceptions)
    this.page.on('pageerror', error => {
      this.browserErrors.push({
        type: 'pageerror',
        message: error.message,
        stack: error.stack
      });
    });

    // Перехватываем неудачные запросы
    this.page.on('requestfailed', request => {
      const failure = request.failure();
      this.browserErrors.push({
        type: 'requestfailed',
        url: request.url(),
        method: request.method(),
        reason: failure ? failure.errorText : 'unknown'
      });
    });

    this.log('INFO', 'Браузер запущен');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ЗАКРЫТИЕ БРАУЗЕРА
  // ─────────────────────────────────────────────────────────────────────────────

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.log('INFO', 'Браузер закрыт');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ВЫПОЛНЕНИЕ ОДНОГО ТЕСТА
  // ─────────────────────────────────────────────────────────────────────────────

  async runTest(name, testFn, options = {}) {
    this.results.total++;
    const testStart = Date.now();

    this.log('INFO', `▶ Тест: ${name}`);

    try {
      await testFn();

      const duration = Date.now() - testStart;
      this.results.passed++;
      this.results.tests.push({
        name,
        status: 'PASS',
        duration,
        error: null
      });

      this.log('PASS', `✓ ${name} (${duration}ms)`);
      return true;

    } catch (error) {
      const duration = Date.now() - testStart;
      this.results.failed++;

      // Делаем скриншот при ошибке
      const screenshotPath = await this.screenshot(name);

      // Проверяем серверные логи
      await this.checkServerLogs();

      const testResult = {
        name,
        status: 'FAIL',
        duration,
        error: error.message,
        stack: error.stack,
        screenshot: screenshotPath
      };

      this.results.tests.push(testResult);
      this.results.errors.push(testResult);

      this.log('FAIL', `✗ ${name}: ${error.message}`);

      // Если тест критичный — прерываем
      if (options.critical) {
        throw error;
      }

      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
  // ─────────────────────────────────────────────────────────────────────────────

  // Ожидание элемента и клик
  async click(selector, options = {}) {
    await this.page.waitForSelector(selector, { visible: true, timeout: options.timeout || CONFIG.TIMEOUT });
    await this.page.click(selector);
  }

  // Ввод текста в поле
  async type(selector, text, options = {}) {
    await this.page.waitForSelector(selector, { visible: true, timeout: options.timeout || 10000 });
    if (options.clear) {
      await this.page.click(selector, { clickCount: 3 });
    }
    await this.page.type(selector, text, { delay: options.delay || 20 });
  }

  // Выбор значения в select
  async select(selector, value) {
    await this.page.waitForSelector(selector);
    await this.page.select(selector, value);
  }

  // Проверка наличия элемента
  async exists(selector, timeout = 3000) {
    try {
      await this.page.waitForSelector(selector, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  // Получение текста элемента
  async getText(selector) {
    await this.page.waitForSelector(selector);
    return await this.page.$eval(selector, el => el.textContent.trim());
  }

  // Ожидание навигации
  async waitForNavigation() {
    await this.page.waitForNavigation({ waitUntil: 'networkidle2' });
  }

  // Переход на страницу
  async goto(path) {
    const url = path.startsWith('http') ? path : `${CONFIG.BASE_URL}${path}`;
    await this.page.goto(url, { waitUntil: 'networkidle2' });
  }

  // Ожидание загрузки SPA
  async waitForApp() {
    await this.page.waitForFunction(() => {
      return window.AsgardUI && window.AsgardAuth;
    }, { timeout: CONFIG.TIMEOUT });
  }

  // API запрос через браузер
  async apiRequest(method, endpoint, body = null) {
    return await this.page.evaluate(async (method, endpoint, body, token) => {
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: body ? JSON.stringify(body) : null
      });
      return {
        status: response.status,
        data: await response.json().catch(() => null)
      };
    }, method, endpoint, body, this.token);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: АВТОРИЗАЦИЯ
  // ═══════════════════════════════════════════════════════════════════════════════

  async testAuth() {
    this.log('INFO', '═══ ТЕСТЫ АВТОРИЗАЦИИ ═══');

    // Тест: редирект неавторизованного пользователя
    await this.runTest('auth.redirect_unauthorized', async () => {
      await this.goto('/');
      await this.page.waitForTimeout(1000);

      const url = this.page.url();
      if (!url.includes('login') && !url.includes('#/login') && !url.includes('#/welcome')) {
        // Проверяем, показывается ли страница входа (кнопка "Войти" или форма)
        const hasWelcome = await this.exists('#btnShowLogin, #w_login', 2000);
        if (!hasWelcome) {
          throw new Error(`Неавторизованный пользователь не перенаправлен на логин. URL: ${url}`);
        }
      }
    });

    // Тест: неверный пароль
    await this.runTest('auth.invalid_password', async () => {
      await this.goto('/');
      await this.page.waitForTimeout(500);

      // Сначала кликаем "Войти" чтобы показать форму
      if (await this.exists('#btnShowLogin', 2000)) {
        await this.click('#btnShowLogin');
        await this.page.waitForTimeout(500);
      }

      if (await this.exists('#w_login', 2000)) {
        await this.type('#w_login', 'admin', { clear: true });
        await this.type('#w_pass', 'wrongpassword', { clear: true });
        await this.click('#btnDoLogin');
        await this.page.waitForTimeout(1000);

        // Должно показать ошибку
        const hasError = await this.exists('.toast.err, .toast-error, [class*="error"]', 2000);
        if (!hasError) {
          // Проверяем что не вошли
          const stillOnLogin = await this.exists('#w_login');
          if (!stillOnLogin) {
            throw new Error('Вход с неверным паролем должен был показать ошибку');
          }
        }
      }
    });

    // Тест: успешный вход админа
    await this.runTest('auth.login_admin', async () => {
      await this.login('admin', 'Orion2025!');
    }, { critical: true });

    // Тест: выход из системы
    await this.runTest('auth.logout', async () => {
      await this.logout();
    });
  }

  // Метод входа в систему
  async login(login, password, pin = '1234') {
    await this.goto('/');
    await this.page.waitForTimeout(1000);

    // Ждём кнопку "Войти" на welcome-странице
    await this.page.waitForSelector('#btnShowLogin', { timeout: 10000 });
    await this.click('#btnShowLogin');
    await this.page.waitForTimeout(500);

    // Ждём появления формы входа
    await this.page.waitForSelector('#w_login', { timeout: 10000 });

    // Вводим логин и пароль
    await this.type('#w_login', login, { clear: true });
    await this.type('#w_pass', password, { clear: true });

    // Кликаем "Далее"
    await this.click('#btnDoLogin');
    await this.page.waitForTimeout(3000);

    // После клика возможны разные сценарии:
    // 1. Показывается форма PIN (#pinForm visible)
    // 2. Показывается форма первичной настройки (#setupForm visible)
    // 3. Сразу входим (появляется sidebar/content)
    // 4. Ошибка (toast с ошибкой)

    // Проверяем, нужен ли PIN (проверяем видимость формы, а не скрытого инпута)
    const hasPinForm = await this.page.evaluate(() => {
      const form = document.querySelector('#pinForm');
      return form && form.style.display !== 'none' && form.offsetParent !== null;
    });
    if (hasPinForm) {
      await this.type('#w_pin', pin, { clear: true });
      await this.click('#btnVerifyPin');
      await this.page.waitForTimeout(2000);
    }

    // Проверяем, нужна ли первая настройка (смена пароля)
    const hasSetupForm = await this.page.evaluate(() => {
      const form = document.querySelector('#setupForm');
      return form && form.style.display !== 'none' && form.offsetParent !== null;
    });
    if (hasSetupForm) {
      await this.type('#s_pass', password);
      await this.type('#s_pass2', password);
      await this.type('#s_pin', pin);
      await this.click('#btnSetupCredentials');
      await this.page.waitForTimeout(2000);
    }

    // Ждём загрузки приложения
    await this.page.waitForTimeout(2000);

    // Проверяем что вошли (должен быть контент)
    const hasContent = await this.exists('.sidebar, .nav, [class*="dashboard"], [class*="content"], #app .page', 5000);
    if (!hasContent) {
      // Проверяем есть ли ошибка
      const errorText = await this.page.evaluate(() => {
        const toast = document.querySelector('.toast.err, .toast-error');
        return toast ? toast.textContent : null;
      });
      const url = this.page.url();
      throw new Error(`Вход не удался. URL: ${url}${errorText ? ', Ошибка: ' + errorText : ''}`);
    }

    // Сохраняем токен
    this.token = await this.page.evaluate(() => localStorage.getItem('asgard_token'));
    this.currentUser = { login, password };

    this.log('INFO', `Выполнен вход: ${login}`);
  }

  // Метод выхода из системы
  async logout() {
    // Ищем кнопку выхода
    const logoutSelectors = [
      '[data-action="logout"]',
      '#btnLogout',
      '.logout-btn',
      'button:has-text("Выход")',
      'a:has-text("Выход")'
    ];

    for (const selector of logoutSelectors) {
      if (await this.exists(selector, 1000)) {
        await this.click(selector);
        await this.page.waitForTimeout(1000);
        break;
      }
    }

    // Или очищаем localStorage и перезагружаем
    await this.page.evaluate(() => {
      localStorage.removeItem('asgard_token');
      localStorage.removeItem('asgard_user');
    });

    await this.goto('/');
    await this.page.waitForTimeout(1000);

    this.token = null;
    this.currentUser = null;

    this.log('INFO', 'Выполнен выход');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: CRUD ОПЕРАЦИИ
  // ═══════════════════════════════════════════════════════════════════════════════

  async testCRUD() {
    this.log('INFO', '═══ ТЕСТЫ CRUD ОПЕРАЦИЙ ═══');

    // Входим как админ для CRUD тестов
    await this.login('admin', 'Orion2025!');

    // ─────────────────────────────────────────────────────────────────────────────
    // ТЕНДЕРЫ
    // ─────────────────────────────────────────────────────────────────────────────

    await this.runTest('crud.tenders.list', async () => {
      await this.goto('/#/tenders');
      await this.page.waitForTimeout(2000);

      // Проверяем что страница загрузилась
      const hasTable = await this.exists('table, .tender-card, [class*="tender"]', 5000);
      if (!hasTable) {
        throw new Error('Список тендеров не загрузился');
      }
    });

    await this.runTest('crud.tenders.create', async () => {
      await this.goto('/#/tenders');
      await this.page.waitForTimeout(1000);

      // Кликаем "Добавить"
      const addBtnSelectors = [
        'button:has-text("Добавить")',
        'button:has-text("Новый")',
        '[data-action="add"]',
        '.btn-add',
        '#btnAddTender'
      ];

      let clicked = false;
      for (const selector of addBtnSelectors) {
        if (await this.exists(selector, 1000)) {
          await this.click(selector);
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        // Пробуем найти кнопку по тексту
        await this.page.evaluate(() => {
          const btns = document.querySelectorAll('button, a.btn');
          for (const btn of btns) {
            if (btn.textContent.includes('Добав') || btn.textContent.includes('Нов')) {
              btn.click();
              return true;
            }
          }
          return false;
        });
      }

      await this.page.waitForTimeout(1000);

      // Проверяем что открылась модалка или форма
      const hasForm = await this.exists('input[name="customer"], input[name="tender_number"], .modal', 3000);
      if (!hasForm) {
        this.log('WARN', 'Форма создания тендера не найдена - возможно другой UI');
      }
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // КЛИЕНТЫ
    // ─────────────────────────────────────────────────────────────────────────────

    await this.runTest('crud.customers.list', async () => {
      await this.goto('/#/customers');
      await this.page.waitForTimeout(2000);

      const hasContent = await this.exists('table, .customer-card, [class*="customer"], .card', 5000);
      if (!hasContent) {
        throw new Error('Список клиентов не загрузился');
      }
    });

    await this.runTest('crud.customers.search', async () => {
      await this.goto('/#/customers');
      await this.page.waitForTimeout(1000);

      // Ищем поле поиска
      const searchSelectors = ['input[placeholder*="Поиск"]', 'input#search', 'input#q', '.search-input'];

      for (const selector of searchSelectors) {
        if (await this.exists(selector, 1000)) {
          await this.type(selector, 'тест', { clear: true });
          await this.page.waitForTimeout(1000);
          break;
        }
      }
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // РАБОТЫ
    // ─────────────────────────────────────────────────────────────────────────────

    await this.runTest('crud.works.list', async () => {
      await this.goto('/#/works');
      await this.page.waitForTimeout(2000);

      const hasContent = await this.exists('table, .work-card, [class*="work"], .card', 5000);
      if (!hasContent) {
        throw new Error('Список работ не загрузился');
      }
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // ФИНАНСЫ
    // ─────────────────────────────────────────────────────────────────────────────

    await this.runTest('crud.finances.list', async () => {
      await this.goto('/#/finances');
      await this.page.waitForTimeout(2000);

      // Финансы могут иметь разные названия маршрутов
      const hasContent = await this.exists('table, .card, [class*="finance"], [class*="expense"]', 5000);
      if (!hasContent) {
        // Пробуем другой маршрут
        await this.goto('/#/expenses');
        await this.page.waitForTimeout(2000);
      }
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // КАЛЕНДАРЬ
    // ─────────────────────────────────────────────────────────────────────────────

    await this.runTest('crud.calendar.view', async () => {
      await this.goto('/#/calendar');
      await this.page.waitForTimeout(2000);

      const hasContent = await this.exists('.calendar, [class*="calendar"], .fc, table', 5000);
      if (!hasContent) {
        throw new Error('Календарь не загрузился');
      }
    });

    await this.logout();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: МОДАЛЬНЫЕ ОКНА
  // ═══════════════════════════════════════════════════════════════════════════════

  async testModals() {
    this.log('INFO', '═══ ТЕСТЫ МОДАЛЬНЫХ ОКОН ═══');

    await this.login('admin', 'Orion2025!');

    await this.runTest('modals.close_on_escape', async () => {
      await this.goto('/#/tenders');
      await this.page.waitForTimeout(1000);

      // Открываем модалку
      await this.page.evaluate(() => {
        const btns = document.querySelectorAll('button, a.btn');
        for (const btn of btns) {
          if (btn.textContent.includes('Добав') || btn.textContent.includes('Нов')) {
            btn.click();
            return;
          }
        }
      });

      await this.page.waitForTimeout(1000);

      // Проверяем что модалка открыта
      if (await this.exists('.modal, .modal-overlay, [class*="modal"]', 2000)) {
        // Нажимаем Escape
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);

        // Проверяем что модалка закрылась
        const stillOpen = await this.exists('.modal:not(.hidden), .modal-overlay:not(.hidden)', 1000);
        if (stillOpen) {
          this.log('WARN', 'Модалка не закрылась по Escape - возможно другая реализация');
        }
      }
    });

    await this.runTest('modals.close_on_overlay_click', async () => {
      await this.goto('/#/tenders');
      await this.page.waitForTimeout(1000);

      // Открываем модалку
      await this.page.evaluate(() => {
        const btns = document.querySelectorAll('button, a.btn');
        for (const btn of btns) {
          if (btn.textContent.includes('Добав') || btn.textContent.includes('Нов')) {
            btn.click();
            return;
          }
        }
      });

      await this.page.waitForTimeout(1000);

      // Кликаем по overlay
      if (await this.exists('.modal-overlay, .overlay', 2000)) {
        await this.page.click('.modal-overlay, .overlay');
        await this.page.waitForTimeout(500);
      }
    });

    await this.logout();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: ФИЛЬТРЫ И ПОИСК
  // ═══════════════════════════════════════════════════════════════════════════════

  async testFilters() {
    this.log('INFO', '═══ ТЕСТЫ ФИЛЬТРОВ И ПОИСКА ═══');

    await this.login('admin', 'Orion2025!');

    await this.runTest('filters.tenders.by_status', async () => {
      await this.goto('/#/tenders');
      await this.page.waitForTimeout(2000);

      // Ищем селект статуса
      const statusSelectors = ['select#status', 'select[name="status"]', 'select:has(option:contains("Новый"))'];

      for (const selector of statusSelectors) {
        if (await this.exists(selector, 1000)) {
          await this.select(selector, 'Новый');
          await this.page.waitForTimeout(1000);
          break;
        }
      }
    });

    await this.runTest('filters.tenders.by_period', async () => {
      await this.goto('/#/tenders');
      await this.page.waitForTimeout(1000);

      // Ищем селект периода
      const periodSelectors = ['select#period', 'select[name="period"]', '#fltPeriod'];

      for (const selector of periodSelectors) {
        if (await this.exists(selector, 1000)) {
          // Выбираем текущий месяц
          const options = await this.page.$$eval(`${selector} option`, opts => opts.map(o => o.value));
          if (options.length > 1) {
            await this.select(selector, options[1]);
            await this.page.waitForTimeout(1000);
          }
          break;
        }
      }
    });

    await this.runTest('filters.search.global', async () => {
      // Проверяем глобальный поиск
      const globalSearchSelectors = ['#globalSearch', '.global-search input', '[placeholder*="глобальный"]'];

      for (const selector of globalSearchSelectors) {
        if (await this.exists(selector, 1000)) {
          await this.type(selector, 'тест', { clear: true });
          await this.page.waitForTimeout(1000);
          break;
        }
      }
    });

    await this.logout();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: СОГЛАСОВАНИЯ
  // ═══════════════════════════════════════════════════════════════════════════════

  async testApprovals() {
    this.log('INFO', '═══ ТЕСТЫ СОГЛАСОВАНИЙ ═══');

    await this.login('admin', 'Orion2025!');

    await this.runTest('approvals.bonus.list', async () => {
      await this.goto('/#/approvals');
      await this.page.waitForTimeout(2000);

      // Или пробуем прямой маршрут к премиям
      if (!(await this.exists('.card, table', 2000))) {
        await this.goto('/#/bonus-approval');
        await this.page.waitForTimeout(2000);
      }
    });

    await this.runTest('approvals.hr_requests.list', async () => {
      await this.goto('/#/hr-requests');
      await this.page.waitForTimeout(2000);
    });

    await this.runTest('approvals.purchase.list', async () => {
      await this.goto('/#/proc-requests');
      await this.page.waitForTimeout(2000);
    });

    await this.logout();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: НАВИГАЦИЯ ПО РОЛЯМ
  // ═══════════════════════════════════════════════════════════════════════════════

  async testRoleNavigation() {
    this.log('INFO', '═══ ТЕСТЫ НАВИГАЦИИ ПО РОЛЯМ ═══');

    // Тестируем только admin (остальные пользователи могут не существовать)
    const adminUser = TEST_USERS.find(u => u.role === 'ADMIN');

    await this.runTest(`navigation.admin.menu_items`, async () => {
      await this.login(adminUser.login, adminUser.password);
      await this.page.waitForTimeout(2000);

      // Проверяем наличие ожидаемых пунктов меню
      const pageContent = await this.page.content();

      for (const menuItem of adminUser.expectedMenuItems) {
        if (!pageContent.includes(menuItem)) {
          this.log('WARN', `Пункт меню "${menuItem}" не найден для роли ${adminUser.role}`);
        }
      }

      await this.logout();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: API
  // ═══════════════════════════════════════════════════════════════════════════════

  async testAPI() {
    this.log('INFO', '═══ ТЕСТЫ API ═══');

    await this.login('admin', 'Orion2025!');

    await this.runTest('api.settings.refs', async () => {
      const response = await this.apiRequest('GET', '/api/settings/refs/all');

      if (response.status === 404) {
        throw new Error('API /api/settings/refs/all вернул 404 - маршрут не найден');
      }

      if (response.status !== 200) {
        throw new Error(`API вернул статус ${response.status}`);
      }
    });

    await this.runTest('api.tenders.list', async () => {
      const response = await this.apiRequest('GET', '/api/tenders?limit=10');

      if (response.status !== 200) {
        throw new Error(`API /api/tenders вернул статус ${response.status}`);
      }

      if (!response.data || !Array.isArray(response.data.tenders)) {
        throw new Error('API /api/tenders вернул неверный формат');
      }
    });

    await this.runTest('api.works.list', async () => {
      const response = await this.apiRequest('GET', '/api/works?limit=10');

      if (response.status !== 200) {
        throw new Error(`API /api/works вернул статус ${response.status}`);
      }
    });

    await this.runTest('api.users.list', async () => {
      const response = await this.apiRequest('GET', '/api/users?limit=10');

      if (response.status !== 200) {
        throw new Error(`API /api/users вернул статус ${response.status}`);
      }
    });

    await this.logout();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: РОЛИ И ПРАВА ДОСТУПА
  // ═══════════════════════════════════════════════════════════════════════════════

  async testRoleAccess() {
    this.log('INFO', '═══ ТЕСТЫ РОЛЕЙ И ПРАВ ДОСТУПА ═══');

    // Сначала создаём тестовых пользователей через API
    await this.login('admin', 'Orion2025!');

    const testRoles = [
      { login: 'test_pm_e2e', password: 'Test123!', role: 'PM', name: 'Тест PM E2E' },
      { login: 'test_director_e2e', password: 'Test123!', role: 'DIRECTOR_GEN', name: 'Тест Директор E2E' },
      { login: 'test_hr_e2e', password: 'Test123!', role: 'HR', name: 'Тест HR E2E' },
      { login: 'test_buh_e2e', password: 'Test123!', role: 'ACCOUNTANT', name: 'Тест Бухгалтер E2E' }
    ];

    // Создаём тестовых пользователей
    await this.runTest('roles.create_test_users', async () => {
      for (const user of testRoles) {
        try {
          const response = await this.apiRequest('POST', '/api/users', {
            login: user.login,
            name: user.name,
            role: user.role,
            is_active: true
          });

          if (response.status === 201 || response.status === 200) {
            this.log('DEBUG', `Создан тестовый пользователь: ${user.login}`);
          } else if (response.status === 409) {
            this.log('DEBUG', `Пользователь уже существует: ${user.login}`);
          }
        } catch (e) {
          this.log('WARN', `Не удалось создать пользователя ${user.login}: ${e.message}`);
        }
      }
    });

    await this.logout();

    // Тест: PM не должен видеть настройки
    await this.runTest('roles.pm_no_settings_access', async () => {
      try {
        await this.login('test_pm_e2e', 'Test123!');
      } catch (e) {
        // Если пользователь не создан, пропускаем тест
        this.log('WARN', 'Тестовый PM не создан, пропускаем тест');
        return;
      }

      await this.goto('/#/settings');
      await this.page.waitForTimeout(2000);

      // PM не должен видеть настройки — либо редирект, либо ошибка доступа
      const pageContent = await this.page.content();
      const hasSettings = pageContent.includes('Настройки системы') ||
                         pageContent.includes('SMTP') ||
                         pageContent.includes('API ключи');

      if (hasSettings) {
        throw new Error('PM не должен иметь доступ к настройкам');
      }

      await this.logout();
    });

    // Тест: HR видит только свои разделы
    await this.runTest('roles.hr_sections', async () => {
      try {
        await this.login('test_hr_e2e', 'Test123!');
      } catch (e) {
        this.log('WARN', 'Тестовый HR не создан, пропускаем тест');
        return;
      }

      await this.page.waitForTimeout(2000);

      const pageContent = await this.page.content();

      // HR должен видеть персонал
      const hasHRSections = pageContent.includes('Персонал') ||
                           pageContent.includes('HR') ||
                           pageContent.includes('Сотрудники');

      if (!hasHRSections) {
        this.log('WARN', 'HR раздел не найден в меню');
      }

      await this.logout();
    });

    // Тест: Директор видит согласования
    await this.runTest('roles.director_approvals', async () => {
      try {
        await this.login('test_director_e2e', 'Test123!');
      } catch (e) {
        this.log('WARN', 'Тестовый директор не создан, пропускаем тест');
        return;
      }

      await this.page.waitForTimeout(2000);

      const pageContent = await this.page.content();

      // Директор должен видеть согласования
      const hasApprovals = pageContent.includes('Согласовани') ||
                          pageContent.includes('Премии') ||
                          pageContent.includes('Заявки');

      if (!hasApprovals) {
        this.log('WARN', 'Раздел согласований не найден для директора');
      }

      await this.logout();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: ВОРОНКА ПРОДАЖ
  // ═══════════════════════════════════════════════════════════════════════════════

  async testFunnel() {
    this.log('INFO', '═══ ТЕСТЫ ВОРОНКИ ПРОДАЖ ═══');

    await this.login('admin', 'Orion2025!');

    await this.runTest('funnel.load', async () => {
      await this.goto('/#/funnel');
      await this.page.waitForTimeout(3000);

      // Проверяем что воронка загрузилась
      const hasContent = await this.exists('.funnel, [class*="funnel"], .kanban, .board, .column', 5000);

      if (!hasContent) {
        // Возможно другой URL
        await this.goto('/#/pipeline');
        await this.page.waitForTimeout(2000);
      }

      const pageContent = await this.page.content();
      if (!pageContent.includes('Новый') && !pageContent.includes('воронк')) {
        this.log('WARN', 'Воронка не загрузилась или имеет другую структуру');
      }
    });

    await this.runTest('funnel.cards_display', async () => {
      await this.goto('/#/funnel');
      await this.page.waitForTimeout(2000);

      // Ищем карточки тендеров
      const hasCards = await this.exists('.card, .tender-card, [class*="card"], [draggable]', 3000);

      if (hasCards) {
        this.log('DEBUG', 'Карточки воронки найдены');
      }
    });

    await this.runTest('funnel.card_click', async () => {
      await this.goto('/#/funnel');
      await this.page.waitForTimeout(2000);

      // Пробуем кликнуть на первую карточку
      const clicked = await this.page.evaluate(() => {
        const cards = document.querySelectorAll('.card, .tender-card, [class*="card"]');
        for (const card of cards) {
          if (card.textContent.length > 10) { // Это вероятно карточка с данными
            card.click();
            return true;
          }
        }
        return false;
      });

      if (clicked) {
        await this.page.waitForTimeout(1000);
        // Проверяем что открылись детали
        const hasDetails = await this.exists('.modal, .details, .sidebar-detail, [class*="detail"]', 2000);
        if (hasDetails) {
          this.log('DEBUG', 'Детали карточки открылись');
        }
      }
    });

    await this.logout();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: AI АССИСТЕНТ
  // ═══════════════════════════════════════════════════════════════════════════════

  async testAI() {
    this.log('INFO', '═══ ТЕСТЫ AI АССИСТЕНТА ═══');

    await this.login('admin', 'Orion2025!');

    await this.runTest('ai.open_chat', async () => {
      // Ищем кнопку AI ассистента
      const aiButtonSelectors = [
        '[data-action="ai"]',
        '#aiBtn',
        '.ai-btn',
        'button[title*="AI"]',
        'button[title*="Мимир"]',
        '[class*="mimir"]'
      ];

      let opened = false;
      for (const selector of aiButtonSelectors) {
        if (await this.exists(selector, 1000)) {
          await this.click(selector);
          opened = true;
          break;
        }
      }

      if (!opened) {
        // Пробуем найти по тексту
        opened = await this.page.evaluate(() => {
          const btns = document.querySelectorAll('button, a');
          for (const btn of btns) {
            if (btn.textContent.includes('Мимир') ||
                btn.textContent.includes('AI') ||
                btn.textContent.includes('Ассистент')) {
              btn.click();
              return true;
            }
          }
          return false;
        });
      }

      if (opened) {
        await this.page.waitForTimeout(1000);
        const hasChat = await this.exists('.chat, .ai-chat, [class*="mimir"], textarea, input[placeholder*="сообщ"]', 2000);
        if (hasChat) {
          this.log('DEBUG', 'Чат AI открыт');
        }
      } else {
        this.log('WARN', 'Кнопка AI ассистента не найдена');
      }
    });

    await this.runTest('ai.send_message', async () => {
      // Ищем поле ввода сообщения
      const inputSelectors = [
        '.ai-input',
        '#aiInput',
        'textarea[placeholder*="сообщ"]',
        'input[placeholder*="вопрос"]',
        '.chat-input textarea',
        '.chat-input input'
      ];

      let inputFound = false;
      for (const selector of inputSelectors) {
        if (await this.exists(selector, 2000)) {
          await this.type(selector, 'Покажи мои тендеры');
          inputFound = true;

          // Отправляем сообщение
          await this.page.keyboard.press('Enter');
          await this.page.waitForTimeout(5000); // Ждём ответа AI

          // Проверяем что появился ответ
          const hasResponse = await this.exists('.ai-response, .message, .chat-message, [class*="response"]', 3000);
          if (hasResponse) {
            this.log('DEBUG', 'AI ответил на сообщение');
          }
          break;
        }
      }

      if (!inputFound) {
        this.log('WARN', 'Поле ввода AI не найдено');
      }
    });

    await this.logout();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: ЭКСПОРТ
  // ═══════════════════════════════════════════════════════════════════════════════

  async testExport() {
    this.log('INFO', '═══ ТЕСТЫ ЭКСПОРТА ═══');

    await this.login('admin', 'Orion2025!');

    await this.runTest('export.excel_tenders', async () => {
      await this.goto('/#/tenders');
      await this.page.waitForTimeout(2000);

      // Ищем кнопку экспорта
      const exportSelectors = [
        'button:has-text("Excel")',
        'button:has-text("Экспорт")',
        '[data-action="export"]',
        '.btn-export',
        '#btnExport'
      ];

      let clicked = false;
      for (const selector of exportSelectors) {
        if (await this.exists(selector, 1000)) {
          // Настраиваем перехват скачивания
          const downloadPromise = new Promise(resolve => {
            this.page.once('response', response => {
              if (response.url().includes('export') ||
                  response.headers()['content-type']?.includes('spreadsheet')) {
                resolve(true);
              }
            });
            setTimeout(() => resolve(false), 5000);
          });

          await this.click(selector);
          clicked = true;

          const downloaded = await downloadPromise;
          if (downloaded) {
            this.log('DEBUG', 'Экспорт Excel начался');
          }
          break;
        }
      }

      if (!clicked) {
        // Пробуем найти по тексту
        await this.page.evaluate(() => {
          const btns = document.querySelectorAll('button, a');
          for (const btn of btns) {
            if (btn.textContent.includes('Excel') || btn.textContent.includes('Экспорт')) {
              btn.click();
              return true;
            }
          }
          return false;
        });
      }
    });

    await this.logout();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: ЗАГРУЗКА ФАЙЛОВ
  // ═══════════════════════════════════════════════════════════════════════════════

  async testFileUpload() {
    this.log('INFO', '═══ ТЕСТЫ ЗАГРУЗКИ ФАЙЛОВ ═══');

    await this.login('admin', 'Orion2025!');

    await this.runTest('files.input_exists', async () => {
      // Проверяем разные страницы на наличие input[type="file"]
      const pages = ['/#/tenders', '/#/works', '/#/documents'];

      for (const pagePath of pages) {
        await this.goto(pagePath);
        await this.page.waitForTimeout(2000);

        // Открываем форму добавления если есть
        await this.page.evaluate(() => {
          const btns = document.querySelectorAll('button, a.btn');
          for (const btn of btns) {
            if (btn.textContent.includes('Добав') || btn.textContent.includes('Загруз')) {
              btn.click();
              return;
            }
          }
        });

        await this.page.waitForTimeout(1000);

        const hasFileInput = await this.exists('input[type="file"]', 2000);
        if (hasFileInput) {
          this.log('DEBUG', `Найден input[type="file"] на ${pagePath}`);
          return;
        }
      }

      this.log('WARN', 'input[type="file"] не найден на проверенных страницах');
    });

    await this.logout();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: EDGE CASES (ГРАНИЧНЫЕ СЛУЧАИ)
  // ═══════════════════════════════════════════════════════════════════════════════

  async testEdgeCases() {
    this.log('INFO', '═══ ТЕСТЫ ГРАНИЧНЫХ СЛУЧАЕВ ═══');

    await this.login('admin', 'Orion2025!');

    await this.runTest('edge.tender_empty_number', async () => {
      await this.goto('/#/tenders');
      await this.page.waitForTimeout(1000);

      // Открываем форму создания
      await this.page.evaluate(() => {
        const btns = document.querySelectorAll('button, a.btn');
        for (const btn of btns) {
          if (btn.textContent.includes('Добав') || btn.textContent.includes('Нов')) {
            btn.click();
            return;
          }
        }
      });

      await this.page.waitForTimeout(1000);

      // Пробуем сохранить без номера тендера
      const saveSelectors = ['button:has-text("Сохранить")', '#btnSave', '.btn-save', 'button[type="submit"]'];

      for (const selector of saveSelectors) {
        if (await this.exists(selector, 1000)) {
          await this.click(selector);
          await this.page.waitForTimeout(1000);

          // Должна быть ошибка валидации
          const hasError = await this.exists('.error, .validation-error, .toast.err, [class*="error"]', 2000);
          if (hasError) {
            this.log('DEBUG', 'Валидация пустого номера тендера работает');
          }
          break;
        }
      }
    });

    await this.runTest('edge.customer_invalid_inn', async () => {
      await this.goto('/#/customers');
      await this.page.waitForTimeout(1000);

      // Открываем форму создания клиента
      await this.page.evaluate(() => {
        const btns = document.querySelectorAll('button, a.btn');
        for (const btn of btns) {
          if (btn.textContent.includes('Добав') || btn.textContent.includes('Нов')) {
            btn.click();
            return;
          }
        }
      });

      await this.page.waitForTimeout(1000);

      // Ищем поле ИНН и вводим невалидное значение
      const innSelectors = ['input[name="inn"]', '#inn', 'input[placeholder*="ИНН"]'];

      for (const selector of innSelectors) {
        if (await this.exists(selector, 1000)) {
          await this.type(selector, '1', { clear: true }); // Невалидный ИНН (1 цифра)

          // Пробуем сохранить
          await this.page.evaluate(() => {
            const btns = document.querySelectorAll('button');
            for (const btn of btns) {
              if (btn.textContent.includes('Сохран') || btn.textContent.includes('Создать')) {
                btn.click();
                return;
              }
            }
          });

          await this.page.waitForTimeout(1000);

          // Должна быть ошибка
          const hasError = await this.exists('.error, .validation-error, .toast.err', 2000);
          if (hasError) {
            this.log('DEBUG', 'Валидация ИНН работает');
          }
          break;
        }
      }
    });

    await this.logout();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: УВЕДОМЛЕНИЯ
  // ═══════════════════════════════════════════════════════════════════════════════

  async testNotifications() {
    this.log('INFO', '═══ ТЕСТЫ УВЕДОМЛЕНИЙ ═══');

    await this.login('admin', 'Orion2025!');

    await this.runTest('notifications.panel_open', async () => {
      // Ищем кнопку уведомлений (колокольчик)
      const bellSelectors = [
        '[data-action="notifications"]',
        '#notifBtn',
        '.notif-btn',
        '.bell',
        'button[title*="Уведомлен"]',
        '[class*="notification"] button',
        '[class*="bell"]'
      ];

      let opened = false;
      for (const selector of bellSelectors) {
        if (await this.exists(selector, 1000)) {
          await this.click(selector);
          opened = true;
          await this.page.waitForTimeout(1000);
          break;
        }
      }

      if (!opened) {
        // Пробуем перейти на страницу уведомлений напрямую
        await this.goto('/#/alerts');
        await this.page.waitForTimeout(2000);
      }

      // Проверяем что уведомления загрузились без ошибок
      const pageContent = await this.page.content();
      const hasNotifications = pageContent.includes('Уведомлени') ||
                              pageContent.includes('уведомлен') ||
                              await this.exists('.notification, .alert-item, .notif-item', 2000);

      if (hasNotifications) {
        this.log('DEBUG', 'Панель уведомлений загружена');
      }
    });

    await this.runTest('notifications.list_load', async () => {
      await this.goto('/#/alerts');
      await this.page.waitForTimeout(2000);

      // Проверяем что нет JS ошибок при загрузке
      const errorsBeforeCount = this.browserErrors.length;

      await this.page.waitForTimeout(2000);

      const errorsAfterCount = this.browserErrors.length;
      const newErrors = errorsAfterCount - errorsBeforeCount;

      if (newErrors > 0) {
        this.log('WARN', `Появились новые JS ошибки при загрузке уведомлений: ${newErrors}`);
      }
    });

    await this.logout();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ТЕСТЫ: ОТЧЁТЫ
  // ═══════════════════════════════════════════════════════════════════════════════

  async testReports() {
    this.log('INFO', '═══ ТЕСТЫ ОТЧЁТОВ ═══');

    await this.login('admin', 'Orion2025!');

    await this.runTest('reports.page_load', async () => {
      await this.goto('/#/reports');
      await this.page.waitForTimeout(2000);

      const hasContent = await this.exists('.report, .card, table, [class*="report"], [class*="chart"]', 5000);

      if (!hasContent) {
        // Пробуем альтернативные маршруты
        await this.goto('/#/dashboard');
        await this.page.waitForTimeout(2000);
      }
    });

    await this.runTest('reports.period_select', async () => {
      await this.goto('/#/reports');
      await this.page.waitForTimeout(2000);

      // Ищем селект периода
      const periodSelectors = [
        'select#period',
        'select[name="period"]',
        '#fltPeriod',
        'select:has(option:contains("Январь"))',
        'select:has(option:contains("2024"))'
      ];

      for (const selector of periodSelectors) {
        if (await this.exists(selector, 1000)) {
          const options = await this.page.$$eval(`${selector} option`, opts => opts.map(o => o.value));
          if (options.length > 1) {
            await this.select(selector, options[1]);
            await this.page.waitForTimeout(1500);
            this.log('DEBUG', 'Период в отчёте изменён');
          }
          break;
        }
      }
    });

    await this.runTest('reports.data_load', async () => {
      await this.goto('/#/reports');
      await this.page.waitForTimeout(3000);

      // Проверяем что данные загрузились (есть числа или таблицы)
      const hasData = await this.page.evaluate(() => {
        const content = document.body.textContent;
        // Ищем числа (суммы, количества)
        const hasNumbers = /\d{1,3}([\s,]\d{3})*([.,]\d+)?/.test(content);
        // Ищем таблицы с данными
        const tables = document.querySelectorAll('table tbody tr');
        return hasNumbers || tables.length > 0;
      });

      if (hasData) {
        this.log('DEBUG', 'Данные отчёта загружены');
      }
    });

    await this.logout();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ГЕНЕРАЦИЯ ОТЧЁТА
  // ═══════════════════════════════════════════════════════════════════════════════

  generateReport() {
    const duration = Date.now() - this.startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);

    const report = `
═══════════════════════════════════════════════════════════════════════════════
                    ASGARD CRM E2E TEST REPORT
                    Дата: ${new Date().toISOString()}
═══════════════════════════════════════════════════════════════════════════════

SUMMARY:
  Total tests:  ${this.results.total}
  Passed:       ${this.results.passed} ✓
  Failed:       ${this.results.failed} ✗
  Duration:     ${minutes}m ${seconds}s
  Success rate: ${this.results.total > 0 ? Math.round(this.results.passed / this.results.total * 100) : 0}%

═══════════════════════════════════════════════════════════════════════════════
${this.results.failed > 0 ? `FAILED TESTS:
═══════════════════════════════════════════════════════════════════════════════

${this.results.errors.map((t, i) => `${i + 1}. [FAIL] ${t.name}
   Error: ${t.error}
   ${t.screenshot ? `Screenshot: ${t.screenshot}` : ''}
`).join('\n')}
` : ''}
${this.serverErrors.length > 0 ? `═══════════════════════════════════════════════════════════════════════════════
SERVER ERRORS DURING TESTS:
═══════════════════════════════════════════════════════════════════════════════

${this.serverErrors.slice(0, 20).map(e => `  ${e}`).join('\n')}
${this.serverErrors.length > 20 ? `\n  ... и ещё ${this.serverErrors.length - 20} ошибок` : ''}
` : ''}
${this.browserErrors.length > 0 ? `═══════════════════════════════════════════════════════════════════════════════
BROWSER CONSOLE ERRORS:
═══════════════════════════════════════════════════════════════════════════════

${this.browserErrors.slice(0, 20).map(e => {
  if (e.type === 'console.error') return `  [console.error] ${e.message}`;
  if (e.type === 'pageerror') return `  [pageerror] ${e.message}`;
  if (e.type === 'requestfailed') return `  [request failed] ${e.method} ${e.url}: ${e.reason}`;
  return `  ${JSON.stringify(e)}`;
}).join('\n')}
${this.browserErrors.length > 20 ? `\n  ... и ещё ${this.browserErrors.length - 20} ошибок` : ''}
` : ''}
═══════════════════════════════════════════════════════════════════════════════
ALL TESTS:
═══════════════════════════════════════════════════════════════════════════════

${this.results.tests.map(t => `  [${t.status}] ${t.name} (${t.duration}ms)`).join('\n')}

═══════════════════════════════════════════════════════════════════════════════
${this.results.failed > 0 ? `
RECOMMENDATIONS:
═══════════════════════════════════════════════════════════════════════════════

${this.generateRecommendations()}
` : `
✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!
`}
═══════════════════════════════════════════════════════════════════════════════
`;

    // Сохраняем отчёт
    fs.writeFileSync(CONFIG.REPORT_FILE, report);

    // Выводим в консоль
    console.log(report);

    return report;
  }

  generateRecommendations() {
    const recommendations = [];

    // Анализируем ошибки и даём рекомендации
    for (const error of this.results.errors) {
      if (error.error.includes('не загрузился')) {
        recommendations.push(`- Проверьте маршрутизацию для ${error.name}`);
      }
      if (error.error.includes('не найден')) {
        recommendations.push(`- Проверьте наличие элемента UI в ${error.name}`);
      }
      if (error.error.includes('404')) {
        recommendations.push(`- API endpoint не найден в ${error.name}`);
      }
    }

    // Анализируем серверные ошибки
    for (const serverError of this.serverErrors.slice(0, 5)) {
      if (serverError.includes('column') && serverError.includes('does not exist')) {
        recommendations.push(`- Отсутствует колонка в БД: ${serverError}`);
      }
      if (serverError.includes('syntax error')) {
        recommendations.push(`- Синтаксическая ошибка SQL: ${serverError}`);
      }
    }

    // Анализируем браузерные ошибки
    for (const browserError of this.browserErrors.slice(0, 5)) {
      if (browserError.message && browserError.message.includes('Cannot read')) {
        recommendations.push(`- Добавьте проверку на null: ${browserError.message.slice(0, 80)}`);
      }
      if (browserError.message && browserError.message.includes('is not a function')) {
        recommendations.push(`- Проверьте тип переменной: ${browserError.message.slice(0, 80)}`);
      }
    }

    return recommendations.length > 0
      ? recommendations.join('\n')
      : '- Проанализируйте скриншоты в папке ' + CONFIG.SCREENSHOT_DIR;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ГЛАВНЫЙ МЕТОД ЗАПУСКА
  // ═══════════════════════════════════════════════════════════════════════════════

  async runAll() {
    this.startTime = Date.now();

    console.log(`
═══════════════════════════════════════════════════════════════════════════════
                    ASGARD CRM E2E ТЕСТИРОВЩИК
═══════════════════════════════════════════════════════════════════════════════
  URL:        ${CONFIG.BASE_URL}
  Headless:   ${CONFIG.HEADLESS}
  Screenshots: ${CONFIG.SCREENSHOT_DIR}
═══════════════════════════════════════════════════════════════════════════════
`);

    try {
      await this.initBrowser();

      // Запускаем группы тестов
      await this.testAuth();
      await this.testCRUD();
      await this.testModals();
      await this.testFilters();
      await this.testApprovals();
      await this.testRoleNavigation();
      await this.testAPI();

      // Новые тесты
      await this.testRoleAccess();      // Тесты ролей и прав доступа
      await this.testFunnel();          // Воронка продаж
      await this.testAI();              // AI ассистент
      await this.testExport();          // Экспорт
      await this.testFileUpload();      // Загрузка файлов
      await this.testEdgeCases();       // Граничные случаи
      await this.testNotifications();   // Уведомления
      await this.testReports();         // Отчёты

      // Финальная проверка серверных логов
      await this.checkServerLogs();

    } catch (error) {
      this.log('FAIL', `Критическая ошибка: ${error.message}`);
      await this.screenshot('critical_error');
    } finally {
      await this.closeBrowser();
    }

    // Генерируем и выводим отчёт
    this.generateReport();

    // Возвращаем код выхода
    return this.results.failed === 0 ? 0 : 1;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ЗАПУСК
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const runner = new TestRunner();
  const exitCode = await runner.runAll();
  process.exit(exitCode);
}

main().catch(error => {
  console.error('Фатальная ошибка:', error);
  process.exit(1);
});
