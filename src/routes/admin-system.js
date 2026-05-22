'use strict';

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const fs   = require('fs');
const path = require('path');

const execAsync = promisify(exec);
const db = require('../services/db');

const PROJECT_ROOT = '/var/www/asgard-crm';

// Пути доступные Мимиру для чтения (только src/ и migrations/)
function isSafePath(filePath) {
  const norm = path.normalize(filePath).replace(/\\/g, '/');
  if (norm.includes('..')) return false;
  if (/\.env|node_modules|\.git|package-lock/i.test(norm)) return false;
  return /^(src\/|migrations\/|public\/assets\/js\/)/.test(norm);
}

// ─── CRM Passport (техническая документация) ─────────────────────────────────
const CRM_PASSPORT = {
  project: {
    name:    'АСГАРД CRM',
    desc:    'CRM для управления тендерами, работами, персоналом и финансами строительной компании АСГАРД-СЕРВИС',
    version: 'v20.x',
    branch:  'mobile-v3',
  },
  server: {
    ip:           '92.242.61.184',
    user:         'root',
    project_path: '/var/www/asgard-crm',
    service:      'asgard-crm (systemd)',
    port:         3000,
    proxy:        'nginx → localhost:3000',
    restart:      'systemctl restart asgard-crm',
    status:       'systemctl is-active asgard-crm',
    logs:         'journalctl -u asgard-crm -f --no-pager',
  },
  ssh: {
    connect:  'ssh -i ~/.ssh/asgard_crm_deploy root@92.242.61.184',
    key_file: '~/.ssh/asgard_crm_deploy (Ed25519)',
    deploy_method: 'Python 3.12 + paramiko (SFTP) — НЕ git push на GitHub',
    scripts:  ['deploy_reports_tkp.py', 'banner_v*.py (баннер обновления)'],
  },
  database: {
    type:    'PostgreSQL 14',
    name:    'asgard_crm',
    user:    'asgard',
    host:    'localhost',
    psql_cmd: 'PGPASSWORD=123456789 psql -U asgard -d asgard_crm',
    note:    'Пароль хранится в .env → DB_PASSWORD',
  },
  stack: {
    backend:  ['Node.js v20', 'Fastify v4', 'node-cron', 'ExcelJS', 'Puppeteer (PDF)'],
    frontend: ['Vanilla JS ES6+ (desktop)', 'React 18 + Vite (mobile /m/)', 'ES5 legacy (field /field/)'],
    ai:       ['routerai.ru (OpenAI-совместимый прокси)', 'Модель: anthropic/claude-opus-4.6', 'Ключ в DB: settings.ai_config'],
    infra:    ['nginx (реверс-прокси)', 'systemd (сервис)', 'PostgreSQL (БД)'],
  },
  structure: {
    'src/index.js':            'Главный файл — Fastify, плагины, middleware, регистрация роутов',
    'src/routes/':             'API маршруты (один файл = один модуль, prefix /api/...)',
    'src/services/':           'Фоновые сервисы: ai-provider, db, push, cron, mango (SMS)',
    'src/lib/':                'Вспомогательные библиотеки (worker-finances и др.)',
    'public/assets/js/':       'Desktop JS страницы (ES6+, window.AsgardXxxPage)',
    'public/assets/css/':      'Стили (design-tokens.css, components.css, app.css)',
    'public/mobile-app/src/':  'React мобильное приложение (исходники JSX/hooks)',
    'public/m/':               'Сборка React-приложения (npm run build → cp dist/* ../m/)',
    'migrations/':             'SQL миграции (V001__...sql → V0NN__...sql)',
  },
  deploy_rules: [
    'При каждом деплое desktop JS — бампить SHELL_VERSION в index.html (иначе SW кэш)',
    'При каждом деплое — добавлять запись в app_updates с changelog',
    'Деплой через SFTP/paramiko — НИКОГДА не git push на GitHub',
    'Mobile: npm run build → cp -r dist/* ../m/ → systemctl restart asgard-crm',
  ],
  roles: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','HR','HR_MANAGER','BUH',
          'DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','OFFICE_MANAGER',
          'CHIEF_ENGINEER','WAREHOUSE','PROC'],
  cron_jobs: [
    { name:'AcademyCron',  time:'Воскресенье 20:00 МСК',  desc:'Генерация недельного урока (Мимир)' },
    { name:'AcademyCron',  time:'Ежедневно 07:00 МСК',    desc:'Факт дня (Мимир)' },
    { name:'MimirCron',    time:'09:00 и 13:30 МСК',      desc:'Утренний и дневной дайджест' },
    { name:'PerDiemCron',  time:'Ежедневно (по чекинам)', desc:'Автоначисление суточных рабочим' },
    { name:'SLA cron',     time:'Каждые 5 минут',         desc:'SLA тикеты, уведомления' },
  ],
  test_accounts: [
    { login:'test_pm',       role:'PM',           password:'Test123!', pin:'1234' },
    { login:'test_director', role:'DIRECTOR_GEN', password:'Test123!', pin:'0000' },
  ],
  key_files: {
    'src/routes/estimates.js':     'Просчёты тендеров — approve-finalize, отчёты PDF/Excel',
    'src/routes/tenders.js':       'Тендеры — статусы, матрица переходов',
    'src/services/academy-cron.js':'Академия Мимира — генерация уроков и фактов',
    'src/services/ai-provider.js': 'AI провайдер — routerai.ru, fallback логика',
    'src/services/mango.js':       'SMS через Mango VPBX API',
    'src/services/per-diem-cron.js':'Суточные — автоначисление',
    'public/index.html':           'SPA entry point — SHELL_VERSION, скрипты, стили',
    'public/assets/js/app.js':     'Главный JS — роутер, навигация, layout',
  },
};

// ─── Mimir system prompt ──────────────────────────────────────────────────────
const MIMIR_SYSTEM = `Ты — Мимир, AI-аналитик для CRM-системы АСГАРД (Node.js/Fastify/PostgreSQL).
Анализируй логи сервера. При необходимости читай код через инструменты read_file и grep_code.

Вернуть ТОЛЬКО JSON (без markdown), структура:
{
  "severity": "ok|info|warn|error|critical",
  "summary": "Краткое резюме 1-2 предложения простым языком",
  "issues": [
    {
      "title": "Название проблемы",
      "description": "Подробное объяснение — что сломалось и почему",
      "severity": "warn|error|critical",
      "fix_type": "quick|complex|none",
      "commands": ["команда если quick"],
      "claude_prompt": "Подробный промпт для Claude Code если complex, иначе пустая строка"
    }
  ]
}

Правила:
- fix_type=quick → 1-3 shell-команды которые исправляют проблему
- fix_type=complex → подробный промпт для Claude Code: что читать, где ошибка, что исправить
- fix_type=none → не требует действий
- Если логи чистые → severity=ok, issues=[], summary=описание что всё хорошо
- Пиши по-русски`;

const MIMIR_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Читает файл из кодовой базы CRM. Используй когда видишь путь к файлу в стек-трейсе.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь от корня проекта: src/routes/estimates.js' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_code',
      description: 'Поиск по коду CRM. Возвращает строки с совпадениями.',
      parameters: {
        type: 'object',
        properties: {
          pattern:   { type: 'string', description: 'Регулярное выражение' },
          directory: { type: 'string', description: 'Папка для поиска (по умолчанию src/)' }
        },
        required: ['pattern']
      }
    }
  }
];

async function executeTool(name, args) {
  if (name === 'read_file') {
    const filePath = (args.path || '').replace(/^\//, '');
    if (!isSafePath(filePath)) return 'ОШИБКА: доступ к этому файлу запрещён';
    try {
      const full = path.join(PROJECT_ROOT, filePath);
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      return lines.slice(0, 200).join('\n') + (lines.length > 200 ? '\n...(обрезано до 200 строк)' : '');
    } catch (e) {
      return `ОШИБКА: файл не найден — ${args.path}`;
    }
  }
  if (name === 'grep_code') {
    const pattern = (args.pattern || '').replace(/"/g, '\\"');
    const dir = args.directory
      ? path.join(PROJECT_ROOT, args.directory)
      : path.join(PROJECT_ROOT, 'src');
    try {
      const { stdout } = await execAsync(
        `grep -r --include="*.js" -n "${pattern}" "${dir}" 2>/dev/null | head -40`,
        { timeout: 8000 }
      );
      return stdout || '(ничего не найдено)';
    } catch (_) { return '(ничего не найдено)'; }
  }
  return 'ОШИБКА: неизвестный инструмент';
}

// ─── Route plugin ─────────────────────────────────────────────────────────────
module.exports = async function(fastify) {

  const adminOnly = {
    preHandler: [fastify.authenticate, async (req, reply) => {
      if (req.user.role !== 'ADMIN') {
        return reply.code(403).send({ error: 'Только для ADMIN' });
      }
    }]
  };

  // ── GET /health ─────────────────────────────────────────────────────────────
  fastify.get('/health', adminOnly, async (req, reply) => {
    const [memR, diskR, uptR, svcR, cpuR] = await Promise.allSettled([
      execAsync('free -m', { timeout: 5000 }),
      execAsync('df -h / 2>/dev/null', { timeout: 5000 }),
      execAsync('uptime -p', { timeout: 5000 }),
      execAsync('systemctl is-active asgard-crm', { timeout: 5000 }),
      execAsync("top -bn1 2>/dev/null | grep 'Cpu(s)'", { timeout: 5000 }),
    ]);

    // RAM
    let ram = { total: 0, used: 0, free: 0, pct: 0 };
    if (memR.status === 'fulfilled') {
      const line = memR.value.stdout.split('\n').find(l => l.startsWith('Mem:'));
      if (line) {
        const p = line.split(/\s+/);
        ram = { total: +p[1], used: +p[2], free: +p[3], pct: Math.round((+p[2] / +p[1]) * 100) };
      }
    }

    // Disk
    let disk = { size: '?', used: '?', avail: '?', pct: '?' };
    if (diskR.status === 'fulfilled') {
      const line = diskR.value.stdout.split('\n')[1];
      if (line) {
        const p = line.split(/\s+/);
        disk = { size: p[1], used: p[2], avail: p[3], pct: p[4] };
      }
    }

    // CPU
    let cpu_pct = null;
    if (cpuR.status === 'fulfilled') {
      const m = cpuR.value.stdout.match(/(\d+[\.,]\d+)\s*id/);
      if (m) cpu_pct = Math.round(100 - parseFloat(m[1].replace(',', '.')));
    }

    // Service
    const service_active = svcR.status === 'fulfilled' && svcR.value.stdout.trim() === 'active';
    const uptime = uptR.status === 'fulfilled' ? uptR.value.stdout.trim() : '';

    // DB
    let db_ok = false, db_ms = 0;
    try {
      const t0 = Date.now();
      await db.query('SELECT 1');
      db_ok = true; db_ms = Date.now() - t0;
    } catch (_) {}

    // Active users (logged in last 30 min)
    let active_users = 0;
    try {
      const { rows } = await db.query(
        "SELECT COUNT(*) AS cnt FROM users WHERE last_login_at > NOW() - INTERVAL '30 minutes'"
      );
      active_users = parseInt(rows[0]?.cnt || 0);
    } catch (_) {}

    // Process memory
    const proc_mem = Math.round(process.memoryUsage().rss / 1024 / 1024);

    return {
      ram, disk, cpu_pct,
      service_active, uptime,
      db_ok, db_ms,
      active_users, proc_mem,
      node_version: process.version,
      ts: new Date().toISOString()
    };
  });

  // ── GET /logs ───────────────────────────────────────────────────────────────
  fastify.get('/logs', adminOnly, async (req, reply) => {
    const lines = Math.min(parseInt(req.query.lines || '300'), 1000);
    const level = req.query.level || 'all';

    try {
      const { stdout } = await execAsync(
        `journalctl -u asgard-crm -n ${lines} --no-pager -o short 2>/dev/null`,
        { timeout: 10000 }
      );

      let parsed = stdout.split('\n').filter(Boolean).map(line => {
        let sev = 'info';
        if (/\b(error|fatal|crash|exception|uncaught|unhandled rejection|ECONNREFUSED|ETIMEDOUT|Cannot find|module not found)\b/i.test(line)) sev = 'error';
        else if (/\b(warn|warning|deprecated|timeout|failed)\b/i.test(line)) sev = 'warn';
        return { line, sev };
      });

      if (level === 'error') parsed = parsed.filter(l => l.sev === 'error');
      else if (level === 'warn') parsed = parsed.filter(l => l.sev !== 'info');

      return { logs: parsed.reverse(), total: parsed.length };
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // ── GET /logs/stream — SSE ──────────────────────────────────────────────────
  fastify.get('/logs/stream', adminOnly, async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const proc = spawn('journalctl', ['-u', 'asgard-crm', '-f', '--no-pager', '-o', 'short', '-n', '0']);

    function pushLine(line) {
      let sev = 'info';
      if (/\b(error|fatal|crash|exception|uncaught)\b/i.test(line)) sev = 'error';
      else if (/\b(warn|warning|failed)\b/i.test(line)) sev = 'warn';
      reply.raw.write(`data: ${JSON.stringify({ line, sev, ts: new Date().toISOString() })}\n\n`);
    }

    proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(pushLine));
    proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(pushLine));

    const beat = setInterval(() => reply.raw.write(': ping\n\n'), 20000);

    req.raw.on('close', () => { clearInterval(beat); proc.kill('SIGTERM'); });
  });

  // ── POST /analyze — Мимир с tool-calling ────────────────────────────────────
  fastify.post('/analyze', adminOnly, async (req, reply) => {
    const { logs } = req.body || {};
    if (!logs || !logs.trim()) return reply.code(400).send({ error: 'logs обязателен' });

    const aiProvider = require('../services/ai-provider');
    await aiProvider._loadKeysFromDB();

    let messages = [
      { role: 'user', content: `Проанализируй логи сервера и найди проблемы:\n\n${logs.slice(0, 8000)}` }
    ];

    let finalText = '';
    const MAX_ITER = 6;

    for (let i = 0; i < MAX_ITER; i++) {
      const resp = await aiProvider.complete({
        system: MIMIR_SYSTEM,
        messages,
        tools: MIMIR_TOOLS,
        maxTokens: 3000,
        temperature: 0.2,
      });

      if (resp.tool_calls && resp.tool_calls.length > 0) {
        messages.push({ role: 'assistant', content: resp.text || null, tool_calls: resp.tool_calls });
        for (const tc of resp.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
          const result = await executeTool(tc.function.name, args);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
      } else {
        finalText = resp.text || '';
        break;
      }
    }

    let analysis = null;
    try {
      const clean = finalText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(clean);
    } catch (_) {
      analysis = { severity: 'warn', summary: finalText || 'Мимир не смог разобрать ответ', issues: [] };
    }

    return { ok: true, analysis };
  });

  // ── POST /action ────────────────────────────────────────────────────────────
  fastify.post('/action', adminOnly, async (req, reply) => {
    const { action, command } = req.body || {};

    if (action === 'restart') {
      setTimeout(() => exec('systemctl restart asgard-crm', () => {}), 800);
      return { ok: true, message: 'Рестарт запущен. Сервис вернётся через ~5 секунд.' };
    }

    if (action === 'bump-version') {
      try {
        const htmlPath = path.join(PROJECT_ROOT, 'public/index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        const m = html.match(/ASGARD_SHELL_VERSION\s*=\s*'([^']+)'/);
        if (!m) return reply.code(400).send({ error: 'SHELL_VERSION не найден в index.html' });

        const parts = m[1].split('.');
        parts[parts.length - 1] = String(parseInt(parts[parts.length - 1]) + 1);
        const newVer = parts.join('.');
        html = html.replace(/ASGARD_SHELL_VERSION\s*=\s*'[^']+'/, `ASGARD_SHELL_VERSION = '${newVer}'`);
        fs.writeFileSync(htmlPath, html, 'utf8');
        return { ok: true, message: `SHELL_VERSION обновлён: ${m[1]} → ${newVer}`, new_version: newVer };
      } catch (e) {
        return reply.code(500).send({ error: e.message });
      }
    }

    if (action === 'run-command') {
      if (!command) return reply.code(400).send({ error: 'command required' });
      try {
        const { stdout, stderr } = await execAsync(command, { timeout: 30000, cwd: PROJECT_ROOT });
        return { ok: true, output: (stdout || '') + (stderr ? '\n[stderr]:\n' + stderr : '') };
      } catch (e) {
        return { ok: false, output: (e.message || '') + '\n' + (e.stderr || '') };
      }
    }

    return reply.code(400).send({ error: `Неизвестное действие: ${action}` });
  });

  // ── GET /updates ─────────────────────────────────────────────────────────────
  fastify.get('/updates', adminOnly, async (req, reply) => {
    const { rows } = await db.query(
      `SELECT id, version, title, changes, target, published_at
       FROM app_updates ORDER BY published_at DESC LIMIT 30`
    );
    return { updates: rows };
  });

  // ── GET /crm-info ─────────────────────────────────────────────────────────────
  fastify.get('/crm-info', adminOnly, async (req, reply) => {
    return { info: CRM_PASSPORT };
  });

  // ── GET /terminal — WebSocket PTY ──────────────────────────────────────────
  // Проверяем что @fastify/websocket зарегистрирован и node-pty доступен
  let nodePty = null;
  try { nodePty = require('node-pty'); } catch (_) {}

  if (nodePty && fastify.websocketServer) {
    fastify.get('/terminal', { websocket: true }, (socket, req) => {
      // Аутентификация: токен передаётся через query ?token=xxx
      const token = req.query.token;
      try {
        const decoded = fastify.jwt.verify(token);
        if (decoded.role !== 'ADMIN') {
          socket.send(JSON.stringify({ type: 'error', data: '\r\n\x1b[31mДоступ запрещён: только ADMIN\x1b[0m\r\n' }));
          socket.close();
          return;
        }
      } catch (e) {
        socket.send(JSON.stringify({ type: 'error', data: '\r\n\x1b[31mОшибка авторизации\x1b[0m\r\n' }));
        socket.close();
        return;
      }

      const pty = nodePty.spawn('/bin/bash', [], {
        name:  'xterm-256color',
        cols:  120,
        rows:  30,
        cwd:   PROJECT_ROOT,
        env:   Object.assign({}, process.env, { TERM: 'xterm-256color' }),
      });

      pty.onData(data => {
        try { socket.send(JSON.stringify({ type: 'output', data })); } catch (_) {}
      });

      pty.onExit(() => {
        try { socket.send(JSON.stringify({ type: 'exit' })); socket.close(); } catch (_) {}
      });

      socket.on('message', raw => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'input')  pty.write(msg.data);
          if (msg.type === 'resize') pty.resize(Math.max(2, msg.cols), Math.max(2, msg.rows));
        } catch (_) {}
      });

      socket.on('close', () => {
        try { pty.kill(); } catch (_) {}
      });
    });
  }
};
