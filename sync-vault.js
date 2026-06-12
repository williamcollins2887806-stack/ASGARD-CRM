#!/usr/bin/env node
/**
 * sync-vault.js — синхронизация Obsidian vault с реальным кодом CRM
 * Запуск: node sync-vault.js
 * Читает routes/, public/assets/js/, src/ и migrations/
 * Генерирует/обновляет markdown файлы в vault
 */

const fs = require('fs');
const path = require('path');

const CRM_DIR = __dirname;
// Путь к vault кросс-платформенный:
//   1) переменная окружения VAULT_DIR (приоритет) — удобно на сервере
//   2) по умолчанию — папка ASGARD-CRM-Vault рядом с репозиторием
// На Windows (C:\...\ASGARD-CRM) дефолт даёт C:\...\ASGARD-CRM-Vault — как раньше.
// На сервере (/var/www/asgard-crm) дефолт даёт /var/www/asgard-crm-vault.
const VAULT_DIR = process.env.VAULT_DIR || path.join(CRM_DIR, '..', 'ASGARD-CRM-Vault');
const AUTO_DIR = path.join(VAULT_DIR, '⚙️ Авто-генерация');

// Создать директорию авто-генерации
if (!fs.existsSync(AUTO_DIR)) fs.mkdirSync(AUTO_DIR, { recursive: true });

// ─────────────────────────────────────────────────
// УТИЛИТЫ
// ─────────────────────────────────────────────────

function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function writeVault(filename, content) {
  const filePath = path.join(AUTO_DIR, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  ✓ ${filename}`);
}

function getFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) {
        if (!['node_modules', '.git', 'dist', '_attachments'].includes(f)) walk(full);
      } else if (ext.some(e => f.endsWith(e))) {
        result.push(full);
      }
    }
  }
  walk(dir);
  return result;
}

// ─────────────────────────────────────────────────
// ПАРСЕР РОУТОВ (routes/*.js)
// ─────────────────────────────────────────────────

function parsePrefixMap() {
  // Читает src/index.js и собирает mapping: имя_файла_роута → /api/префикс
  const indexFile = path.join(CRM_DIR, 'src', 'index.js');
  if (!fs.existsSync(indexFile)) return {};
  const content = readFile(indexFile);
  const map = {};
  const re = /fastify\.register\s*\(\s*require\s*\(\s*['"`]\.\/routes\/([^'"`]+)['"`]\s*\)\s*,\s*\{\s*prefix\s*:\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    map[m[1] + '.js'] = m[2]; // 'tenders.js' → '/api/tenders'
  }
  return map;
}

const PREFIX_MAP = parsePrefixMap();

function parseRoutes() {
  const routesDir = path.join(CRM_DIR, 'src', 'routes');
  if (!fs.existsSync(routesDir)) return [];

  const routes = [];
  for (const file of fs.readdirSync(routesDir).filter(f => f.endsWith('.js'))) {
    const content = readFile(path.join(routesDir, file));
    const endpoints = [];
    const tables = new Set();

    // Извлекаем HTTP методы и пути — поддержка Express (router.x), Fastify (fastify.x, app.x, instance.x),
    // и Fastify-объектного стиля fastify.route({ method, url })
    const routeRe = /(?:router|fastify|app|instance|server|f)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let m;
    while ((m = routeRe.exec(content)) !== null) {
      endpoints.push(`${m[1].toUpperCase()} ${m[2]}`);
    }
    // Fastify .route({ method:'GET', url:'/x' })
    const routeObjRe = /\.route\s*\(\s*\{[^}]*method\s*:\s*['"`]([A-Z]+)['"`][^}]*url\s*:\s*['"`]([^'"`]+)['"`]/gi;
    while ((m = routeObjRe.exec(content)) !== null) {
      endpoints.push(`${m[1]} ${m[2]}`);
    }
    // и обратный порядок ключей url:..,method:..
    const routeObjRe2 = /\.route\s*\(\s*\{[^}]*url\s*:\s*['"`]([^'"`]+)['"`][^}]*method\s*:\s*['"`]([A-Z]+)['"`]/gi;
    while ((m = routeObjRe2.exec(content)) !== null) {
      endpoints.push(`${m[2]} ${m[1]}`);
    }

    // Извлекаем таблицы БД (FROM, JOIN, INSERT INTO, UPDATE, DELETE FROM)
    const tableRe = /(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["'`]?(\w+)["'`]?/gi;
    while ((m = tableRe.exec(content)) !== null) {
      const t = m[1].toLowerCase();
      if (!['where', 'set', 'select', 'null', 'true', 'false', 'and', 'or', 'not', 'in', 'on'].includes(t)) {
        tables.add(t);
      }
    }

    // Дополнительно: прямые упоминания таблиц в строках запросов
    const directRe = /`\s*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*\bFROM\s+(\w+)/gi;
    while ((m = directRe.exec(content)) !== null) {
      tables.add(m[1].toLowerCase());
    }

    const prefix = PREFIX_MAP[file] || '';
    // Полные endpoints (с префиксом): GET /api/tenders/:id
    const fullEndpoints = endpoints.map(e => {
      const [method, p] = e.split(/\s+/);
      let full = prefix + (p === '/' ? '' : p);
      // Нормализуем :id для матчинга с фронтом
      full = full.replace(/\/:[^/]+/g, '/:id');
      return `${method} ${full || '/'}`;
    });

    routes.push({
      file,
      prefix,
      endpoints: [...new Set(endpoints)],
      fullEndpoints: [...new Set(fullEndpoints)],
      tables: [...tables].filter(t => t.length > 2).sort()
    });
  }
  return routes.sort((a, b) => a.file.localeCompare(b.file));
}

// ─────────────────────────────────────────────────
// ПАРСЕР DESKTOP JS (public/assets/js/*.js)
// ─────────────────────────────────────────────────

function parseDesktopJS() {
  const jsDir = path.join(CRM_DIR, 'public', 'assets', 'js');
  if (!fs.existsSync(jsDir)) return [];

  const files = [];
  function scanDir(dir) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) {
        scanDir(full);
      } else if (f.endsWith('.js')) {
        const content = readFile(full);
        const apis = new Set();
        const addApi = (raw) => {
          let api = raw;
          if (!api.startsWith('/')) api = '/' + api;
          // Desktop вызывает преимущественно полные /api/... — оставляем как есть, иначе добавляем префикс
          if (!api.startsWith('/api/') && !api.startsWith('/api')) api = '/api' + api;
          if (api.length > 4 && api.includes('/')) apis.add(api);
        };

        // fetch('/api/...) или fetch(`/api/...`)
        const fetchRe = /fetch\s*\(\s*[`'"](\/api\/[^`'"?#\s]+)/g;
        let m;
        while ((m = fetchRe.exec(content)) !== null) addApi(m[1]);

        // axios.get/post('/api/...')
        const axiosRe = /axios\.[a-z]+\s*\(\s*[`'"](\/api\/[^`'"?#\s]+)/g;
        while ((m = axiosRe.exec(content)) !== null) addApi(m[1]);

        // строки вида '/api/...' (в request, $.ajax и т.п.)
        const strRe = /['"`](\/api\/[\w\-\/]+)['"`]/g;
        while ((m = strRe.exec(content)) !== null) {
          if (m[1].split('/').length >= 3) addApi(m[1]);
        }

        // AsgardAPI/api wrapper: AsgardAPI.get('/tenders'), api.post(...)
        const apiWrapRe = /\b(?:AsgardAPI|api)\.(?:get|post|put|patch|delete|head)\s*\(\s*[`'"]([^`'"?#\s${}]+)/g;
        while ((m = apiWrapRe.exec(content)) !== null) addApi(m[1]);

        const rel = path.relative(jsDir, full).replace(/\\/g, '/');
        files.push({ file: rel, apis: [...apis].sort() });
      }
    }
  }
  scanDir(jsDir);
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

// ─────────────────────────────────────────────────
// ПАРСЕР MOBILE JSX (src/**/*.jsx,tsx,js)
// ─────────────────────────────────────────────────

function parseMobileJSX() {
  const srcDir = path.join(CRM_DIR, 'public', 'mobile-app', 'src');
  if (!fs.existsSync(srcDir)) return [];

  const files = getFiles(srcDir, ['.jsx', '.tsx', '.js']);
  return files.map(full => {
    const content = readFile(full);
    const apis = new Set();

    const patterns = [
      // fetch('/api/...') или fetch(`/api/...`)
      /fetch\s*\(\s*[`'"](\/api\/[^`'"?#\s]+)/g,
      // axios.get('/api/...')
      /axios\.[a-z]+\s*\(\s*[`'"](\/api\/[^`'"?#\s]+)/g,
      // голые строки '/api/...' в коде
      /['"`](\/api\/[\w\-\/]+)['"`]/g,
      // api.get('/tenders'), api.post('/works/:id/...') — путь БЕЗ /api/ префикса
      /\bapi\.(?:get|post|put|patch|delete|head)\s*\(\s*[`'"]([^`'"?#\s${}]+)/g,
      // client.get('/tenders'), fieldApi.post('/...')
      /\b(?:client|fieldApi|fieldClient)\.(?:get|post|put|patch|delete|head)\s*\(\s*[`'"]([^`'"?#\s${}]+)/g,
    ];

    for (const re of patterns) {
      let m;
      while ((m = re.exec(content)) !== null) {
        let api = m[1];
        if (!api.startsWith('/')) api = '/' + api;
        // Приводим к полному виду с /api префиксом (как у роутов после парсинга prefix)
        if (!api.startsWith('/api/') && !api.startsWith('/api')) api = '/api' + api;
        if (api.length > 4 && api.includes('/')) apis.add(api);
      }
    }

    const rel = path.relative(srcDir, full).replace(/\\/g, '/');
    return { file: rel, apis: [...apis].sort() };
  }).sort((a, b) => a.file.localeCompare(b.file));
}

// ─────────────────────────────────────────────────
// ПАРСЕР SERVICES / HELPERS / LIB (src/services/*, src/helpers/*, src/lib/*)
// Не имеют endpoint-ов, но трогают таблицы БД, импортируются роутами.
// ─────────────────────────────────────────────────

function parseBackendModule(dir, label) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) continue;
    if (!f.endsWith('.js')) continue;
    const content = readFile(full);
    const tables = new Set();
    // FROM/JOIN/INSERT INTO/UPDATE/DELETE FROM <table>
    const tableRe = /(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["'`]?(\w+)["'`]?/gi;
    let m;
    while ((m = tableRe.exec(content)) !== null) {
      const t = m[1].toLowerCase();
      if (!['where','set','select','null','true','false','and','or','not','in','on'].includes(t) && t.length > 2) {
        tables.add(t);
      }
    }
    // Кто кого require/import
    const requires = new Set();
    const reqRe = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    while ((m = reqRe.exec(content)) !== null) {
      if (m[1].startsWith('./') || m[1].startsWith('../')) requires.add(m[1]);
    }
    files.push({
      file: f,
      module: label,
      tables: [...tables].sort(),
      requires: [...requires].sort(),
      lines: content.split('\n').length,
    });
  }
  return files.sort((a,b) => a.file.localeCompare(b.file));
}

function parseConductor() {
  const dir = path.join(CRM_DIR, 'src', 'services', 'mimir-conductor');
  if (!fs.existsSync(dir)) return [];
  // Рекурсивно собрать все .js в conductor
  const files = [];
  function walk(d, sub = '') {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      const rel = sub ? `${sub}/${f}` : f;
      if (fs.statSync(full).isDirectory()) { walk(full, rel); continue; }
      if (!f.endsWith('.js')) continue;
      const content = readFile(full);
      const tables = new Set();
      const tableRe = /(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["'`]?(\w+)["'`]?/gi;
      let m;
      while ((m = tableRe.exec(content)) !== null) {
        const t = m[1].toLowerCase();
        if (!['where','set','select','null','true','false','and','or','not','in','on'].includes(t) && t.length > 2) {
          tables.add(t);
        }
      }
      files.push({ file: rel, tables: [...tables].sort(), lines: content.split('\n').length });
    }
  }
  walk(dir);
  return files.sort((a,b) => a.file.localeCompare(b.file));
}

// ─────────────────────────────────────────────────
// ПАРСЕР МИГРАЦИЙ (migrations/*.sql)
// ─────────────────────────────────────────────────

function parseMigrations() {
  const migrDir = path.join(CRM_DIR, 'migrations');
  if (!fs.existsSync(migrDir)) return [];

  return fs.readdirSync(migrDir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(file => {
      const content = readFile(path.join(migrDir, file));
      const tables = new Set();

      const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi;
      const alterRe  = /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?/gi;
      const addColRe = /ADD\s+COLUMN\s+\w+.*?(?:REFERENCES\s+["'`]?(\w+)["'`]?)?/gi;

      let m;
      while ((m = createRe.exec(content)) !== null) tables.add({ name: m[1], action: 'CREATE' });
      while ((m = alterRe.exec(content))  !== null) tables.add({ name: m[1], action: 'ALTER' });

      // Извлекаем все таблицы из CREATE TABLE
      const allTables = [];
      const cr2 = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(/gi;
      while ((m = cr2.exec(content)) !== null) allTables.push(m[1]);

      const alterTables = [];
      const al2 = /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?/gi;
      while ((m = al2.exec(content)) !== null) alterTables.push(m[1]);

      return { file, creates: allTables, alters: alterTables };
    });
}

// ─────────────────────────────────────────────────
// ГЕНЕРАЦИЯ VAULT ФАЙЛОВ
// ─────────────────────────────────────────────────

function generateRoutesFile(routes) {
  const now = new Date().toLocaleString('ru-RU');
  let md = `# Роуты — Авто-карта (${now})\n`;
  md += `> Сгенерировано автоматически из \`routes/\`. Запусти \`node sync-vault.js\` для обновления.\n\n`;
  md += `Всего файлов: **${routes.length}**\n\n`;

  for (const r of routes) {
    md += `## ${r.file}\n`;
    if (r.endpoints.length > 0) {
      md += `### Endpoints\n\`\`\`\n`;
      for (const e of r.endpoints) md += `${e}\n`;
      md += `\`\`\`\n`;
    }
    if (r.tables.length > 0) {
      md += `### Таблицы БД\n`;
      md += r.tables.map(t => `- \`${t}\``).join('\n') + '\n';
    }
    md += '\n';
  }
  writeVault('Роуты — Авто-карта.md', md);
}

function generateDesktopFile(files) {
  const now = new Date().toLocaleString('ru-RU');
  let md = `# Desktop JS — Авто-карта (${now})\n`;
  md += `> Сгенерировано из \`public/assets/js/\`. Запусти \`node sync-vault.js\` для обновления.\n\n`;
  md += `Всего файлов: **${files.length}**\n\n`;

  for (const f of files) {
    md += `## ${f.file}\n`;
    if (f.apis.length > 0) {
      md += `**API вызовы:**\n`;
      md += f.apis.map(a => `- \`${a}\``).join('\n') + '\n';
    } else {
      md += `*Нет явных API вызовов*\n`;
    }
    md += '\n';
  }
  writeVault('Desktop JS — Авто-карта.md', md);
}

function generateMobileFile(files) {
  const now = new Date().toLocaleString('ru-RU');
  let md = `# Mobile JSX — Авто-карта (${now})\n`;
  md += `> Сгенерировано из \`src/\`. Запусти \`node sync-vault.js\` для обновления.\n\n`;
  md += `Всего файлов: **${files.length}**\n\n`;

  for (const f of files) {
    md += `## ${f.file}\n`;
    if (f.apis.length > 0) {
      md += `**API вызовы:**\n`;
      md += f.apis.map(a => `- \`${a}\``).join('\n') + '\n';
    } else {
      md += `*Нет явных API вызовов*\n`;
    }
    md += '\n';
  }
  writeVault('Mobile JSX — Авто-карта.md', md);
}

function generateBackendModulesFile(services, helpers, lib, conductor) {
  const now = new Date().toLocaleString('ru-RU');
  let md = `# Backend модули (services/helpers/lib/conductor) — Авто-карта (${now})\n`;
  md += `> Файлы без HTTP-endpoint-ов, но трогающие БД. Подгружаются роутами или cron-ами.\n`;
  md += `> Запусти \`node sync-vault.js\` для обновления.\n\n`;

  function section(title, files) {
    md += `## ${title} (${files.length})\n\n`;
    if (files.length === 0) { md += `*Пусто.*\n\n`; return; }
    md += `| Файл | Строк | Таблицы БД |\n|------|------:|------------|\n`;
    for (const f of files) {
      const tables = f.tables.length ? f.tables.map(t => `\`${t}\``).join(', ') : '—';
      md += `| \`${f.file}\` | ${f.lines} | ${tables} |\n`;
    }
    md += `\n`;
  }
  section('src/services/', services);
  section('src/services/mimir-conductor/ (рекурсивно)', conductor);
  section('src/helpers/', helpers);
  section('src/lib/', lib);

  writeVault('Backend модули — Авто-карта.md', md);
}

function generateMigrationsFile(migrations) {
  const now = new Date().toLocaleString('ru-RU');
  let md = `# Миграции — Авто-карта (${now})\n`;
  md += `> Сгенерировано из \`migrations/\`. Запусти \`node sync-vault.js\` для обновления.\n\n`;
  md += `Всего миграций: **${migrations.length}**\n\n`;

  for (const m of migrations) {
    md += `## ${m.file}\n`;
    if (m.creates.length > 0) {
      md += `**CREATE TABLE:** ${m.creates.map(t => `\`${t}\``).join(', ')}\n`;
    }
    if (m.alters.length > 0) {
      md += `**ALTER TABLE:** ${m.alters.map(t => `\`${t}\``).join(', ')}\n`;
    }
    md += '\n';
  }
  writeVault('Миграции — Авто-карта.md', md);
}

function generateApiMatrix(routes, desktopFiles, mobileFiles) {
  const now = new Date().toLocaleString('ru-RU');

  // ─── 1. Reverse-map: какие фронт-файлы зовут каждый endpoint-path ───
  // Ключ — нормализованный путь endpoint (/tenders, /tenders/:id, /works/:id/finances).
  // Значение — { desktop: [файлы], mobile: [файлы] }.
  const callersByPath = {};

  function normPath(p) {
    // Все :id-сегменты → :id для матчинга
    return p.replace(/\/:[^/]+/g, '/:id').replace(/\/\d+/g, '/:id').replace(/\/+$/, '') || '/';
  }

  for (const f of desktopFiles) {
    for (const api of f.apis) {
      const key = normPath(api);
      if (!callersByPath[key]) callersByPath[key] = { desktop: new Set(), mobile: new Set() };
      callersByPath[key].desktop.add(f.file);
    }
  }
  for (const f of mobileFiles) {
    for (const api of f.apis) {
      const key = normPath(api);
      if (!callersByPath[key]) callersByPath[key] = { desktop: new Set(), mobile: new Set() };
      callersByPath[key].mobile.add(f.file);
    }
  }

  // ─── 2. Сводная таблица (по endpoint-ам, с привязкой к роуту+таблицам) ───
  // Собираем все endpoint-ы со всех роутов в плоский список с метаданными.
  const rows = [];
  for (const route of routes) {
    for (const fullEp of route.fullEndpoints) {
      const [method, fullPath] = fullEp.split(/\s+/);
      const key = normPath(fullPath);
      const c = callersByPath[key] || { desktop: new Set(), mobile: new Set() };
      rows.push({
        method,
        fullPath,
        routeFile: route.file,
        tables: route.tables,
        desktop: [...c.desktop].sort(),
        mobile: [...c.mobile].sort(),
      });
    }
  }
  rows.sort((a, b) => (a.fullPath + a.method).localeCompare(b.fullPath + b.method));

  // ─── 3. Генерируем markdown ───
  let md = `# Матрица: Фронт → API → БД (${now})\n`;
  md += `> Для каждого backend-endpoint показано: какой роут его обрабатывает, какие таблицы БД он трогает, и кто его зовёт из desktop/mobile фронта.\n`;
  md += `> Сгенерировано из \`src/routes/*.js\` + \`src/index.js\` (префиксы) + парсинга API-вызовов в \`public/assets/js\` и \`public/mobile-app/src\`.\n`;
  md += `> Запусти \`node sync-vault.js\` для обновления.\n\n`;
  md += `**Всего endpoint-ов:** ${rows.length} | **С известными вызывающими:** ${rows.filter(r => r.desktop.length + r.mobile.length > 0).length}\n\n`;

  // ─── 3a. Главная таблица (плоская, для быстрого поиска) ───
  md += `## Сводная таблица (отсортирована по пути)\n\n`;
  md += `| Endpoint | Backend route | Таблицы БД | Desktop callers | Mobile callers |\n`;
  md += `|----------|---------------|------------|-----------------|----------------|\n`;
  for (const r of rows) {
    const ep = `\`${r.method} ${r.fullPath}\``;
    const route = `\`src/routes/${r.routeFile}\``;
    const tables = r.tables.length ? r.tables.map(t => `\`${t}\``).join(', ') : '—';
    const desk = r.desktop.length ? r.desktop.map(f => `\`${f}\``).join('<br>') : '—';
    const mob = r.mobile.length ? r.mobile.map(f => `\`${f}\``).join('<br>') : '—';
    md += `| ${ep} | ${route} | ${tables} | ${desk} | ${mob} |\n`;
  }
  md += `\n`;

  // ─── 3b. Группировка по роутам (для аудитного чтения по доменам) ───
  md += `\n---\n\n## По роутам (группировка)\n\n`;
  for (const route of routes) {
    md += `### \`src/routes/${route.file}\` (prefix: \`${route.prefix || '—'}\`)\n`;
    if (route.tables.length > 0) {
      md += `**Таблицы:** ${route.tables.map(t => `\`${t}\``).join(', ')}\n\n`;
    }
    if (route.fullEndpoints.length === 0) {
      md += `*Endpoint-ы не извлечены (нестандартный паттерн регистрации).*\n\n`;
      continue;
    }
    md += `| Endpoint | Desktop | Mobile |\n|----------|---------|--------|\n`;
    for (const fullEp of route.fullEndpoints) {
      const [method, fullPath] = fullEp.split(/\s+/);
      const key = normPath(fullPath);
      const c = callersByPath[key] || { desktop: new Set(), mobile: new Set() };
      const desk = c.desktop.size ? [...c.desktop].sort().map(f => `\`${f}\``).join('<br>') : '—';
      const mob = c.mobile.size ? [...c.mobile].sort().map(f => `\`${f}\``).join('<br>') : '—';
      md += `| \`${method} ${fullPath}\` | ${desk} | ${mob} |\n`;
    }
    md += `\n`;
  }

  // ─── 3c. «Сироты» — фронт зовёт что-то, чего нет в роутах (или не распознали) ───
  md += `\n---\n\n## Сироты — фронт зовёт endpoint, не покрытый матчингом\n\n`;
  md += `> Возможные причины: (а) endpoint не распарсился из роута; (б) фронт зовёт несуществующий endpoint (мёртвая ссылка/баг); (в) endpoint регистрируется иначе.\n\n`;
  const matchedKeys = new Set(rows.map(r => normPath(r.fullPath)));
  const orphans = [];
  for (const [key, c] of Object.entries(callersByPath)) {
    if (!matchedKeys.has(key)) {
      orphans.push({ key, desktop: [...c.desktop].sort(), mobile: [...c.mobile].sort() });
    }
  }
  orphans.sort((a, b) => a.key.localeCompare(b.key));
  if (orphans.length === 0) {
    md += `*Сирот нет (все вызовы фронта матчатся с роутами).*\n`;
  } else {
    md += `| Endpoint (нормализованный) | Desktop callers | Mobile callers |\n|---|---|---|\n`;
    for (const o of orphans) {
      const desk = o.desktop.length ? o.desktop.map(f => `\`${f}\``).join('<br>') : '—';
      const mob = o.mobile.length ? o.mobile.map(f => `\`${f}\``).join('<br>') : '—';
      md += `| \`${o.key}\` | ${desk} | ${mob} |\n`;
    }
    md += `\n*Всего сирот:* **${orphans.length}**.\n`;
  }

  writeVault('Матрица Фронт-API-БД.md', md);
}

function generateChangelog() {
  // Читаем git log для последних изменений в CRM
  const { execSync } = require('child_process');
  let gitLog = '';
  try {
    gitLog = execSync('git log --oneline -30', { cwd: CRM_DIR, encoding: 'utf8' });
  } catch {
    gitLog = 'Git log недоступен\n';
  }

  const now = new Date().toLocaleString('ru-RU');
  let md = `# Последние изменения в коде (${now})\n`;
  md += `> Автоматически из \`git log\`. Запусти \`node sync-vault.js\` для обновления.\n\n`;
  md += `\`\`\`\n${gitLog}\`\`\`\n`;

  // Новые файлы (добавленные после последнего запуска)
  let newFiles = '';
  try {
    newFiles = execSync('git status --short', { cwd: CRM_DIR, encoding: 'utf8' });
  } catch {}

  if (newFiles.trim()) {
    md += `\n## Незакоммиченные изменения\n\`\`\`\n${newFiles}\`\`\`\n`;
  }

  writeVault('Git — Последние изменения.md', md);
}

function generateIndex(routes, desktopFiles, mobileFiles, migrations) {
  const now = new Date().toLocaleString('ru-RU');
  let md = `# ⚙️ Авто-генерация — Индекс\n`;
  md += `> Все файлы в этой папке генерируются автоматически скриптом \`sync-vault.js\`.\n`;
  md += `> Не редактируй вручную — изменения будут перезаписаны.\n\n`;
  md += `**Последнее обновление:** ${now}\n\n`;
  md += `| Файл | Содержимое |\n|------|----------|\n`;
  md += `| [[Роуты — Авто-карта]] | ${routes.length} файлов routes/ с endpoints и таблицами БД |\n`;
  md += `| [[Desktop JS — Авто-карта]] | ${desktopFiles.length} JS файлов с API вызовами |\n`;
  md += `| [[Mobile JSX — Авто-карта]] | ${mobileFiles.length} JSX/JS файлов с API вызовами |\n`;
  md += `| [[Backend модули — Авто-карта]] | services/helpers/lib/mimir-conductor — таблицы БД, связи |\n`;
  md += `| [[Миграции — Авто-карта]] | ${migrations.length} SQL миграций |\n`;
  md += `| [[Матрица Фронт-API-БД]] | Главное: endpoint → роут → таблицы → desktop+mobile callers, плюс «сироты» |\n`;
  md += `| [[Git — Последние изменения]] | git log последних 30 коммитов |\n\n`;
  md += `## Как запустить\n`;
  md += `\`\`\`bash\ncd C:\\Users\\Nikita-ASGARD\\ASGARD-CRM\nnode sync-vault.js\n\`\`\`\n\n`;
  md += `## Когда запускать\n`;
  md += `- После добавления нового роута\n`;
  md += `- После добавления React компонента с API вызовами\n`;
  md += `- После новой миграции\n`;
  md += `- Перед началом работы над задачей (чтобы видеть актуальное состояние)\n`;

  writeVault('📋 Индекс.md', md);
}

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────

console.log('\n🔄 ASGARD CRM → Obsidian Vault Sync\n');

console.log('📂 Читаю routes/...');
const routes = parseRoutes();
console.log(`   Найдено ${routes.length} файлов роутов`);

console.log('📂 Читаю public/assets/js/...');
const desktopFiles = parseDesktopJS();
console.log(`   Найдено ${desktopFiles.length} JS файлов`);

console.log('📂 Читаю src/...');
const mobileFiles = parseMobileJSX();
console.log(`   Найдено ${mobileFiles.length} JSX/JS файлов`);

console.log('📂 Читаю src/services/, helpers/, lib/, mimir-conductor/...');
const services = parseBackendModule(path.join(CRM_DIR, 'src', 'services'), 'services').filter(f => !f.file.includes('mimir-conductor'));
const helpers = parseBackendModule(path.join(CRM_DIR, 'src', 'helpers'), 'helpers');
const lib = parseBackendModule(path.join(CRM_DIR, 'src', 'lib'), 'lib');
const conductor = parseConductor();
console.log(`   services=${services.length} | helpers=${helpers.length} | lib=${lib.length} | conductor=${conductor.length}`);

console.log('📂 Читаю migrations/...');
const migrations = parseMigrations();
console.log(`   Найдено ${migrations.length} миграций`);

console.log('\n📝 Генерирую vault файлы...');
generateRoutesFile(routes);
generateDesktopFile(desktopFiles);
generateMobileFile(mobileFiles);
generateBackendModulesFile(services, helpers, lib, conductor);
generateMigrationsFile(migrations);
generateApiMatrix(routes, desktopFiles, mobileFiles);
generateChangelog();
generateIndex(routes, desktopFiles, mobileFiles, migrations);

console.log(`\n✅ Готово! Файлы в: ${AUTO_DIR}`);
console.log(`   Роутов: ${routes.length} | Desktop JS: ${desktopFiles.length} | Mobile: ${mobileFiles.length} | Миграций: ${migrations.length}`);
console.log(`   Backend services: ${services.length} | helpers: ${helpers.length} | lib: ${lib.length} | conductor: ${conductor.length}\n`);
