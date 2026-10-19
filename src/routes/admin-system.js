'use strict';

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const fs   = require('fs');
const path = require('path');

const execAsync = promisify(exec);
const db = require('../services/db');

const PROJECT_ROOT = '/var/www/asgard-crm';

// РџСѓС‚Рё РґРѕСЃС‚СѓРїРЅС‹Рµ РњРёРјРёСЂСѓ РґР»СЏ С‡С‚РµРЅРёСЏ (С‚РѕР»СЊРєРѕ src/ Рё migrations/)
function isSafePath(filePath) {
  const norm = path.normalize(filePath).replace(/\\/g, '/');
  if (norm.includes('..')) return false;
  if (/\.env|node_modules|\.git|package-lock/i.test(norm)) return false;
  return /^(src\/|migrations\/|public\/assets\/js\/)/.test(norm);
}

// в”Ђв”Ђв”Ђ CRM Passport (С‚РµС…РЅРёС‡РµСЃРєР°СЏ РґРѕРєСѓРјРµРЅС‚Р°С†РёСЏ) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const CRM_PASSPORT = {
  project: {
    name:    'РђРЎР“РђР Р” CRM',
    desc:    'CRM РґР»СЏ СѓРїСЂР°РІР»РµРЅРёСЏ С‚РµРЅРґРµСЂР°РјРё, СЂР°Р±РѕС‚Р°РјРё, РїРµСЂСЃРѕРЅР°Р»РѕРј Рё С„РёРЅР°РЅСЃР°РјРё СЃС‚СЂРѕРёС‚РµР»СЊРЅРѕР№ РєРѕРјРїР°РЅРёРё РђРЎР“РђР Р”-РЎР•Р Р’РРЎ',
    version: 'v20.x',
    branch:  'mobile-v3',
  },
  server: {
    ip:           '92.242.61.184',
    user:         'root',
    project_path: '/var/www/asgard-crm',
    service:      'asgard-crm (systemd)',
    port:         3000,
    proxy:        'nginx в†’ localhost:3000',
    restart:      'systemctl restart asgard-crm',
    status:       'systemctl is-active asgard-crm',
    logs:         'journalctl -u asgard-crm -f --no-pager',
  },
  ssh: {
    connect:  'ssh -i ~/.ssh/asgard_crm_deploy root@92.242.61.184',
    key_file: '~/.ssh/asgard_crm_deploy (Ed25519)',
    deploy_method: 'Python 3.12 + paramiko (SFTP) вЂ” РќР• git push РЅР° GitHub',
    scripts:  ['deploy_reports_tkp.py', 'banner_v*.py (Р±Р°РЅРЅРµСЂ РѕР±РЅРѕРІР»РµРЅРёСЏ)'],
  },
  database: {
    type:    'PostgreSQL 14',
    name:    'asgard_crm',
    user:    'asgard',
    host:    'localhost',
    psql_cmd: 'PGPASSWORD=123456789 psql -U asgard -d asgard_crm',
    note:    'РџР°СЂРѕР»СЊ С…СЂР°РЅРёС‚СЃСЏ РІ .env в†’ DB_PASSWORD',
  },
  stack: {
    backend:  ['Node.js v20', 'Fastify v4', 'node-cron', 'ExcelJS', 'Puppeteer (PDF)'],
    frontend: ['Vanilla JS ES6+ (desktop)', 'React 18 + Vite (mobile /m/)', 'ES5 legacy (field /field/)'],
    ai:       ['routerai.ru (OpenAI-СЃРѕРІРјРµСЃС‚РёРјС‹Р№ РїСЂРѕРєСЃРё)', 'РњРѕРґРµР»СЊ: deepseek/deepseek-v4.1-flash', 'РљР»СЋС‡ РІ DB: settings.ai_config'],
    infra:    ['nginx (СЂРµРІРµСЂСЃ-РїСЂРѕРєСЃРё)', 'systemd (СЃРµСЂРІРёСЃ)', 'PostgreSQL (Р‘Р”)'],
  },
  structure: {
    'src/index.js':            'Р“Р»Р°РІРЅС‹Р№ С„Р°Р№Р» вЂ” Fastify, РїР»Р°РіРёРЅС‹, middleware, СЂРµРіРёСЃС‚СЂР°С†РёСЏ СЂРѕСѓС‚РѕРІ',
    'src/routes/':             'API РјР°СЂС€СЂСѓС‚С‹ (РѕРґРёРЅ С„Р°Р№Р» = РѕРґРёРЅ РјРѕРґСѓР»СЊ, prefix /api/...)',
    'src/services/':           'Р¤РѕРЅРѕРІС‹Рµ СЃРµСЂРІРёСЃС‹: ai-provider, db, push, cron, mango (SMS)',
    'src/lib/':                'Р’СЃРїРѕРјРѕРіР°С‚РµР»СЊРЅС‹Рµ Р±РёР±Р»РёРѕС‚РµРєРё (worker-finances Рё РґСЂ.)',
    'public/assets/js/':       'Desktop JS СЃС‚СЂР°РЅРёС†С‹ (ES6+, window.AsgardXxxPage)',
    'public/assets/css/':      'РЎС‚РёР»Рё (design-tokens.css, components.css, app.css)',
    'public/mobile-app/src/':  'React РјРѕР±РёР»СЊРЅРѕРµ РїСЂРёР»РѕР¶РµРЅРёРµ (РёСЃС…РѕРґРЅРёРєРё JSX/hooks)',
    'public/m/':               'РЎР±РѕСЂРєР° React-РїСЂРёР»РѕР¶РµРЅРёСЏ (npm run build в†’ cp dist/* ../m/)',
    'migrations/':             'SQL РјРёРіСЂР°С†РёРё (V001__...sql в†’ V0NN__...sql)',
  },
  deploy_rules: [
    'РџСЂРё РєР°Р¶РґРѕРј РґРµРїР»РѕРµ desktop JS вЂ” Р±Р°РјРїРёС‚СЊ SHELL_VERSION РІ index.html (РёРЅР°С‡Рµ SW РєСЌС€)',
    'РџСЂРё РєР°Р¶РґРѕРј РґРµРїР»РѕРµ вЂ” РґРѕР±Р°РІР»СЏС‚СЊ Р·Р°РїРёСЃСЊ РІ app_updates СЃ changelog',
    'Р”РµРїР»РѕР№ С‡РµСЂРµР· SFTP/paramiko вЂ” РќРРљРћР“Р”Рђ РЅРµ git push РЅР° GitHub',
    'Mobile: npm run build в†’ cp -r dist/* ../m/ в†’ systemctl restart asgard-crm',
  ],
  roles: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','HR','HR_MANAGER','BUH',
          'DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','OFFICE_MANAGER',
          'CHIEF_ENGINEER','WAREHOUSE','PROC'],
  cron_jobs: [
    { name:'AcademyCron',  time:'Р’РѕСЃРєСЂРµСЃРµРЅСЊРµ 20:00 РњРЎРљ',  desc:'Р“РµРЅРµСЂР°С†РёСЏ РЅРµРґРµР»СЊРЅРѕРіРѕ СѓСЂРѕРєР° (РњРёРјРёСЂ)' },
    { name:'AcademyCron',  time:'Р•Р¶РµРґРЅРµРІРЅРѕ 07:00 РњРЎРљ',    desc:'Р¤Р°РєС‚ РґРЅСЏ (РњРёРјРёСЂ)' },
    { name:'MimirCron',    time:'09:00 Рё 13:30 РњРЎРљ',      desc:'РЈС‚СЂРµРЅРЅРёР№ Рё РґРЅРµРІРЅРѕР№ РґР°Р№РґР¶РµСЃС‚' },
    { name:'PerDiemCron',  time:'Р•Р¶РµРґРЅРµРІРЅРѕ (РїРѕ С‡РµРєРёРЅР°Рј)', desc:'РђРІС‚РѕРЅР°С‡РёСЃР»РµРЅРёРµ СЃСѓС‚РѕС‡РЅС‹С… СЂР°Р±РѕС‡РёРј' },
    { name:'SLA cron',     time:'РљР°Р¶РґС‹Рµ 5 РјРёРЅСѓС‚',         desc:'SLA С‚РёРєРµС‚С‹, СѓРІРµРґРѕРјР»РµРЅРёСЏ' },
  ],
  test_accounts: [
    { login:'test_pm',       role:'PM',           password:'Test123!', pin:'1234' },
    { login:'test_director', role:'DIRECTOR_GEN', password:'Test123!', pin:'0000' },
  ],
  key_files: {
    'src/routes/estimates.js':     'РџСЂРѕСЃС‡С‘С‚С‹ С‚РµРЅРґРµСЂРѕРІ вЂ” approve-finalize, РѕС‚С‡С‘С‚С‹ PDF/Excel',
    'src/routes/tenders.js':       'РўРµРЅРґРµСЂС‹ вЂ” СЃС‚Р°С‚СѓСЃС‹, РјР°С‚СЂРёС†Р° РїРµСЂРµС…РѕРґРѕРІ',
    'src/services/academy-cron.js':'РђРєР°РґРµРјРёСЏ РњРёРјРёСЂР° вЂ” РіРµРЅРµСЂР°С†РёСЏ СѓСЂРѕРєРѕРІ Рё С„Р°РєС‚РѕРІ',
    'src/services/ai-provider.js': 'AI РїСЂРѕРІР°Р№РґРµСЂ вЂ” routerai.ru, fallback Р»РѕРіРёРєР°',
    'src/services/mango.js':       'SMS С‡РµСЂРµР· Mango VPBX API',
    'src/services/per-diem-cron.js':'РЎСѓС‚РѕС‡РЅС‹Рµ вЂ” Р°РІС‚РѕРЅР°С‡РёСЃР»РµРЅРёРµ',
    'public/index.html':           'SPA entry point вЂ” SHELL_VERSION, СЃРєСЂРёРїС‚С‹, СЃС‚РёР»Рё',
    'public/assets/js/app.js':     'Р“Р»Р°РІРЅС‹Р№ JS вЂ” СЂРѕСѓС‚РµСЂ, РЅР°РІРёРіР°С†РёСЏ, layout',
  },
};

// в”Ђв”Ђв”Ђ Mimir system prompt в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const MIMIR_SYSTEM = `РўС‹ вЂ” РњРёРјРёСЂ, AI-Р°РЅР°Р»РёС‚РёРє РґР»СЏ CRM-СЃРёСЃС‚РµРјС‹ РђРЎР“РђР Р” (Node.js/Fastify/PostgreSQL).
РђРЅР°Р»РёР·РёСЂСѓР№ Р»РѕРіРё СЃРµСЂРІРµСЂР°. РџСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё С‡РёС‚Р°Р№ РєРѕРґ С‡РµСЂРµР· РёРЅСЃС‚СЂСѓРјРµРЅС‚С‹ read_file Рё grep_code.

Р’РµСЂРЅСѓС‚СЊ РўРћР›Р¬РљРћ JSON (Р±РµР· markdown), СЃС‚СЂСѓРєС‚СѓСЂР°:
{
  "severity": "ok|info|warn|error|critical",
  "summary": "РљСЂР°С‚РєРѕРµ СЂРµР·СЋРјРµ 1-2 РїСЂРµРґР»РѕР¶РµРЅРёСЏ РїСЂРѕСЃС‚С‹Рј СЏР·С‹РєРѕРј",
  "issues": [
    {
      "title": "РќР°Р·РІР°РЅРёРµ РїСЂРѕР±Р»РµРјС‹",
      "description": "РџРѕРґСЂРѕР±РЅРѕРµ РѕР±СЉСЏСЃРЅРµРЅРёРµ вЂ” С‡С‚Рѕ СЃР»РѕРјР°Р»РѕСЃСЊ Рё РїРѕС‡РµРјСѓ",
      "severity": "warn|error|critical",
      "fix_type": "quick|complex|none",
      "commands": ["РєРѕРјР°РЅРґР° РµСЃР»Рё quick"],
      "claude_prompt": "РџРѕРґСЂРѕР±РЅС‹Р№ РїСЂРѕРјРїС‚ РґР»СЏ Claude Code РµСЃР»Рё complex, РёРЅР°С‡Рµ РїСѓСЃС‚Р°СЏ СЃС‚СЂРѕРєР°"
    }
  ]
}

РџСЂР°РІРёР»Р°:
- fix_type=quick в†’ 1-3 shell-РєРѕРјР°РЅРґС‹ РєРѕС‚РѕСЂС‹Рµ РёСЃРїСЂР°РІР»СЏСЋС‚ РїСЂРѕР±Р»РµРјСѓ
- fix_type=complex в†’ РїРѕРґСЂРѕР±РЅС‹Р№ РїСЂРѕРјРїС‚ РґР»СЏ Claude Code: С‡С‚Рѕ С‡РёС‚Р°С‚СЊ, РіРґРµ РѕС€РёР±РєР°, С‡С‚Рѕ РёСЃРїСЂР°РІРёС‚СЊ
- fix_type=none в†’ РЅРµ С‚СЂРµР±СѓРµС‚ РґРµР№СЃС‚РІРёР№
- Р•СЃР»Рё Р»РѕРіРё С‡РёСЃС‚С‹Рµ в†’ severity=ok, issues=[], summary=РѕРїРёСЃР°РЅРёРµ С‡С‚Рѕ РІСЃС‘ С…РѕСЂРѕС€Рѕ
- РџРёС€Рё РїРѕ-СЂСѓСЃСЃРєРё`;

const MIMIR_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Р§РёС‚Р°РµС‚ С„Р°Р№Р» РёР· РєРѕРґРѕРІРѕР№ Р±Р°Р·С‹ CRM. РСЃРїРѕР»СЊР·СѓР№ РєРѕРіРґР° РІРёРґРёС€СЊ РїСѓС‚СЊ Рє С„Р°Р№Р»Сѓ РІ СЃС‚РµРє-С‚СЂРµР№СЃРµ.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'РџСѓС‚СЊ РѕС‚ РєРѕСЂРЅСЏ РїСЂРѕРµРєС‚Р°: src/routes/estimates.js' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_code',
      description: 'РџРѕРёСЃРє РїРѕ РєРѕРґСѓ CRM. Р’РѕР·РІСЂР°С‰Р°РµС‚ СЃС‚СЂРѕРєРё СЃ СЃРѕРІРїР°РґРµРЅРёСЏРјРё.',
      parameters: {
        type: 'object',
        properties: {
          pattern:   { type: 'string', description: 'Р РµРіСѓР»СЏСЂРЅРѕРµ РІС‹СЂР°Р¶РµРЅРёРµ' },
          directory: { type: 'string', description: 'РџР°РїРєР° РґР»СЏ РїРѕРёСЃРєР° (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ src/)' }
        },
        required: ['pattern']
      }
    }
  }
];

async function executeTool(name, args) {
  if (name === 'read_file') {
    const filePath = (args.path || '').replace(/^\//, '');
    if (!isSafePath(filePath)) return 'РћРЁРР‘РљРђ: РґРѕСЃС‚СѓРї Рє СЌС‚РѕРјСѓ С„Р°Р№Р»Сѓ Р·Р°РїСЂРµС‰С‘РЅ';
    try {
      const full = path.join(PROJECT_ROOT, filePath);
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      return lines.slice(0, 200).join('\n') + (lines.length > 200 ? '\n...(РѕР±СЂРµР·Р°РЅРѕ РґРѕ 200 СЃС‚СЂРѕРє)' : '');
    } catch (e) {
      return `РћРЁРР‘РљРђ: С„Р°Р№Р» РЅРµ РЅР°Р№РґРµРЅ вЂ” ${args.path}`;
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
      return stdout || '(РЅРёС‡РµРіРѕ РЅРµ РЅР°Р№РґРµРЅРѕ)';
    } catch (_) { return '(РЅРёС‡РµРіРѕ РЅРµ РЅР°Р№РґРµРЅРѕ)'; }
  }
  return 'РћРЁРР‘РљРђ: РЅРµРёР·РІРµСЃС‚РЅС‹Р№ РёРЅСЃС‚СЂСѓРјРµРЅС‚';
}

// в”Ђв”Ђв”Ђ Route plugin в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
module.exports = async function(fastify) {

  const adminOnly = {
    preHandler: [fastify.authenticate, async (req, reply) => {
      if (req.user.role !== 'ADMIN') {
        return reply.code(403).send({ error: 'РўРѕР»СЊРєРѕ РґР»СЏ ADMIN' });
      }
    }]
  };

  // в”Ђв”Ђ GET /health в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

  // в”Ђв”Ђ GET /logs в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.get('/logs', adminOnly, async (req, reply) => {
    const lines = Math.min(parseInt(req.query.lines || '300'), 1000);
    const level = req.query.level || 'all';

    // D-2 fix: journalctl is Linux-only. On non-Linux (dev/Windows/macOS)
    // gracefully return an empty list instead of 500 so /diag still loads.
    if (process.platform !== 'linux') {
      return { logs: [], total: 0, note: 'logs not available on ' + process.platform };
    }

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
      // Graceful degrade вЂ” don't break the page.
      return { logs: [], total: 0, error: e.message };
    }
  });

  // в”Ђв”Ђ GET /logs/stream вЂ” SSE в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.get('/logs/stream', adminOnly, async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
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

  // в”Ђв”Ђ POST /analyze вЂ” РњРёРјРёСЂ СЃ tool-calling в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.post('/analyze', adminOnly, async (req, reply) => {
    const { logs } = req.body || {};
    if (!logs || !logs.trim()) return reply.code(400).send({ error: 'logs РѕР±СЏР·Р°С‚РµР»РµРЅ' });

    const aiProvider = require('../services/ai-provider');
    await aiProvider._loadKeysFromDB();

    let messages = [
      { role: 'user', content: `РџСЂРѕР°РЅР°Р»РёР·РёСЂСѓР№ Р»РѕРіРё СЃРµСЂРІРµСЂР° Рё РЅР°Р№РґРё РїСЂРѕР±Р»РµРјС‹:\n\n${logs.slice(0, 8000)}` }
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
      analysis = { severity: 'warn', summary: finalText || 'РњРёРјРёСЂ РЅРµ СЃРјРѕРі СЂР°Р·РѕР±СЂР°С‚СЊ РѕС‚РІРµС‚', issues: [] };
    }

    return { ok: true, analysis };
  });

  // в”Ђв”Ђ POST /action в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.post('/action', adminOnly, async (req, reply) => {
    const { action, command } = req.body || {};

    if (action === 'restart') {
      setTimeout(() => exec('systemctl restart asgard-crm', () => {}), 800);
      return { ok: true, message: 'Р РµСЃС‚Р°СЂС‚ Р·Р°РїСѓС‰РµРЅ. РЎРµСЂРІРёСЃ РІРµСЂРЅС‘С‚СЃСЏ С‡РµСЂРµР· ~5 СЃРµРєСѓРЅРґ.' };
    }

    if (action === 'bump-version') {
      try {
        const htmlPath = path.join(PROJECT_ROOT, 'public/index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        const m = html.match(/ASGARD_SHELL_VERSION\s*=\s*'([^']+)'/);
        if (!m) return reply.code(400).send({ error: 'SHELL_VERSION РЅРµ РЅР°Р№РґРµРЅ РІ index.html' });

        const parts = m[1].split('.');
        parts[parts.length - 1] = String(parseInt(parts[parts.length - 1]) + 1);
        const newVer = parts.join('.');
        html = html.replace(/ASGARD_SHELL_VERSION\s*=\s*'[^']+'/, `ASGARD_SHELL_VERSION = '${newVer}'`);
        fs.writeFileSync(htmlPath, html, 'utf8');
        return { ok: true, message: `SHELL_VERSION РѕР±РЅРѕРІР»С‘РЅ: ${m[1]} в†’ ${newVer}`, new_version: newVer };
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

    return reply.code(400).send({ error: `РќРµРёР·РІРµСЃС‚РЅРѕРµ РґРµР№СЃС‚РІРёРµ: ${action}` });
  });

  // в”Ђв”Ђ GET /updates в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.get('/updates', adminOnly, async (req, reply) => {
    const { rows } = await db.query(
      `SELECT id, version, title, changes, target, published_at
       FROM app_updates ORDER BY published_at DESC LIMIT 30`
    );
    return { updates: rows };
  });

  // в”Ђв”Ђ GET /crm-info в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.get('/crm-info', adminOnly, async (req, reply) => {
    return { info: CRM_PASSPORT };
  });

  // в”Ђв”Ђ GET /ai-config в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // РўРµРєСѓС‰Р°СЏ РєРѕРЅС„РёРіСѓСЂР°С†РёСЏ AI-РїСЂРѕРІР°Р№РґРµСЂРѕРІ (РјР°СЃРєРёСЂРѕРІР°РЅРЅС‹Рµ РєР»СЋС‡Рё, СЃС‚Р°С‚СѓСЃ РїРѕРґРєР»СЋС‡РµРЅРёСЏ).
  fastify.get('/ai-config', adminOnly, async (req, reply) => {
    const aiProvider = require('../services/ai-provider');
    try { await aiProvider._loadKeysFromDB(); } catch (_) {}
    const cfg = aiProvider.getConfig();

    let dbConfig = {};
    try {
      const r = await db.query("SELECT value_json FROM settings WHERE key = 'ai_config'");
      if (r.rows[0]?.value_json) {
        let parsed = JSON.parse(r.rows[0].value_json);
        dbConfig = parsed.value_json ? JSON.parse(parsed.value_json) : parsed;
      }
    } catch (_) {}

    function maskKey(k) {
      if (!k) return '';
      if (k.length < 8) return '****';
      return k.slice(0, 4) + '****' + k.slice(-4);
    }

    return {
      provider: cfg.provider,
      model: cfg.model,
      hasAnthropicKey: cfg.hasAnthropicKey,
      hasOpenAIKey:    cfg.hasOpenAIKey,
      anthropic_model: dbConfig.anthropic_model || '',
      openai_model:    dbConfig.openai_model    || '',
      openai_url:      dbConfig.openai_url      || '',
      // РњР°СЃРєРё (РЅРёРєРѕРіРґР° РЅРµ РІРѕР·РІСЂР°С‰Р°РµРј СЃР°Рј РєР»СЋС‡)
      anthropic_key_mask: maskKey(dbConfig.anthropic_api_key || ''),
      openai_key_mask:    maskKey(dbConfig.openai_api_key || '')
    };
  });

  // в”Ђв”Ђ POST /ai-config вЂ” СЃРѕС…СЂР°РЅРёС‚СЊ РЅР°СЃС‚СЂРѕР№РєРё AI (РєР»СЋС‡Рё + provider) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.post('/ai-config', adminOnly, async (req, reply) => {
    const body = req.body || {};
    // Р§РёС‚Р°РµРј С‚РµРєСѓС‰РёР№ ai_config, С‡С‚РѕР±С‹ РЅРµ Р·Р°С‚РµСЂРµС‚СЊ РєР»СЋС‡Рё РєРѕС‚РѕСЂС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РјРµРЅСЏР»
    let current = {};
    try {
      const r = await db.query("SELECT value_json FROM settings WHERE key = 'ai_config'");
      if (r.rows[0]?.value_json) {
        let parsed = JSON.parse(r.rows[0].value_json);
        current = parsed.value_json ? JSON.parse(parsed.value_json) : parsed;
      }
    } catch (_) {}

    const next = { ...current };
    // РўРµРєСЃС‚РѕРІС‹Рµ РїРѕР»СЏ Р±РµР· РєР»СЋС‡РµР№ вЂ” РїРµСЂРµР·Р°РїРёСЃС‹РІР°РµРј РІСЃРµРіРґР°
    if (body.provider          !== undefined) next.provider          = String(body.provider);
    if (body.anthropic_model   !== undefined) next.anthropic_model   = String(body.anthropic_model || '');
    if (body.openai_model      !== undefined) next.openai_model      = String(body.openai_model    || '');
    if (body.openai_url        !== undefined) next.openai_url        = String(body.openai_url      || '');
    // РљР»СЋС‡Рё: РїРёС€РµРј С‚РѕР»СЊРєРѕ РµСЃР»Рё РїСЂРёС€Р»Рё РЅРµРїСѓСЃС‚С‹Рµ
    if (body.anthropic_api_key && String(body.anthropic_api_key).trim()) next.anthropic_api_key = String(body.anthropic_api_key).trim();
    if (body.openai_api_key    && String(body.openai_api_key).trim())    next.openai_api_key    = String(body.openai_api_key).trim();
    // РћС‡РёСЃС‚РєР° РєР»СЋС‡Р° вЂ” РѕС‚РґРµР»СЊРЅС‹Рј С„Р»Р°РіРѕРј
    if (body.clear_anthropic_key) delete next.anthropic_api_key;
    if (body.clear_openai_key)    delete next.openai_api_key;
    // Р—Р°С‡РёСЃС‚РёРј legacy Yandex-РєР»СЋС‡Рё РµСЃР»Рё РѕРЅРё РµС‰С‘ РІ Р‘Р” РѕС‚ СЃС‚Р°СЂРѕР№ РІРµСЂСЃРёРё
    delete next.yandex_gpt_api_key;
    delete next.yandex_folder_id;
    delete next.yandex_model;

    await db.query(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES ('ai_config', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
    `, [JSON.stringify(next)]);

    // РЎР±СЂРѕСЃРёРј РєСЌС€ ai-provider, С‡С‚РѕР±С‹ РЅРѕРІС‹Рµ РєР»СЋС‡Рё РїРµСЂРµС‡РёС‚Р°Р»РёСЃСЊ РЅР° СЃР»РµРґСѓСЋС‰РёР№ Р·Р°РїСЂРѕСЃ
    try {
      const aiProvider = require('../services/ai-provider');
      if (aiProvider._resetKeysCache) aiProvider._resetKeysCache();
    } catch (_) {}

    return { ok: true };
  });

  // в”Ђв”Ђ POST /ai-test вЂ” РѕС‚РїСЂР°РІРёС‚СЊ РїСЂРѕР±РЅС‹Р№ Р·Р°РїСЂРѕСЃ С‚РµРєСѓС‰РµРјСѓ РїСЂРѕРІР°Р№РґРµСЂСѓ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // Body: { provider?: 'auto'|'anthropic'|'openai', prompt?: string }
  fastify.post('/ai-test', adminOnly, async (req, reply) => {
    const aiProvider = require('../services/ai-provider');
    const { provider, prompt } = req.body || {};
    const userPrompt = (prompt && String(prompt).trim()) || 'РћС‚РІРµС‚СЊ РѕРґРЅРѕР№ С„СЂР°Р·РѕР№: В«AI РіРѕС‚РѕРІ Рє СЂР°Р±РѕС‚РµВ». РќРёС‡РµРіРѕ РЅРµ РґРѕР±Р°РІР»СЏР№.';

    try {
      await aiProvider._loadKeysFromDB();
    } catch (_) {}

    // Р•СЃР»Рё РїРѕРїСЂРѕСЃРёР»Рё РєРѕРЅРєСЂРµС‚РЅРѕРіРѕ РїСЂРѕРІР°Р№РґРµСЂР° вЂ” РІСЂРµРјРµРЅРЅРѕ РїРµСЂРµРѕРїСЂРµРґРµР»РёРј С‡РµСЂРµР· РѕРїС†РёРё complete()
    const callOpts = {
      system: 'РўС‹ вЂ” С‚РµСЃС‚РѕРІС‹Р№ Р±РѕС‚ РґР»СЏ РїСЂРѕРІРµСЂРєРё СЃРѕРµРґРёРЅРµРЅРёСЏ. РћС‚РІРµС‡Р°Р№ РєСЂР°С‚РєРѕ (РѕРґРЅР° С„СЂР°Р·Р°).',
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 80,
      temperature: 0.2
    };
    if (provider && provider !== 'auto') callOpts.provider = provider;

    const t0 = Date.now();
    try {
      const r = await aiProvider.complete(callOpts);
      return {
        ok: true,
        text:     r.text || '',
        provider: r.provider || provider || 'auto',
        model:    r.model    || '?',
        usage:    r.usage    || null,
        ms:       Date.now() - t0
      };
    } catch (e) {
      return reply.code(502).send({
        ok: false,
        error: e.message || 'AI request failed',
        ms: Date.now() - t0
      });
    }
  });

  // в”Ђв”Ђ GET /terminal вЂ” WebSocket PTY в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // РџСЂРѕРІРµСЂСЏРµРј С‡С‚Рѕ @fastify/websocket Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ Рё node-pty РґРѕСЃС‚СѓРїРµРЅ
  let nodePty = null;
  try { nodePty = require('node-pty'); } catch (_) {}

  if (nodePty && fastify.websocketServer) {
    fastify.get('/terminal', { websocket: true }, (socket, req) => {
      // РђСѓС‚РµРЅС‚РёС„РёРєР°С†РёСЏ: С‚РѕРєРµРЅ РїРµСЂРµРґР°С‘С‚СЃСЏ С‡РµСЂРµР· query ?token=xxx
      const token = req.query.token;
      try {
        const decoded = fastify.jwt.verify(token);
        if (decoded.role !== 'ADMIN') {
          socket.send(JSON.stringify({ type: 'error', data: '\r\n\x1b[31mР”РѕСЃС‚СѓРї Р·Р°РїСЂРµС‰С‘РЅ: С‚РѕР»СЊРєРѕ ADMIN\x1b[0m\r\n' }));
          socket.close();
          return;
        }
      } catch (e) {
        socket.send(JSON.stringify({ type: 'error', data: '\r\n\x1b[31mРћС€РёР±РєР° Р°РІС‚РѕСЂРёР·Р°С†РёРё\x1b[0m\r\n' }));
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

  // в”Ђв”Ђв”Ђ РўР°СЂРёС„РЅР°СЏ СЃРµС‚РєР° (HR Module v2) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // Р”РѕСЃС‚СѓРї: ADMIN, DIRECTOR_GEN
  const adminOrDirector = {
    preHandler: [fastify.authenticate, async (req, reply) => {
      const r = req.user.role;
      if (!['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','BUH'].includes(r)) {
        return reply.code(403).send({ error: 'РўРѕР»СЊРєРѕ ADMIN/Р”РёСЂРµРєС‚РѕСЂ/Р‘СѓС…РіР°Р»С‚РµСЂ' });
      }
    }]
  };

  fastify.get('/settings/tariffs', adminOrDirector, async (req, reply) => {
    try {
      const { rows } = await db.query(`
        SELECT id, category, position_name, points, rate_per_shift, is_combinable
        FROM field_tariff_grid
        ORDER BY category, position_name
      `);
      return { tariffs: rows };
    } catch (e) {
      return reply.code(500).send({ error: 'field_tariff_grid РЅРµРґРѕСЃС‚СѓРїРЅР°: ' + e.message });
    }
  });

  fastify.put('/settings/tariffs/:id', adminOrDirector, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const { points, rate_per_shift, is_combinable } = req.body || {};
    const updates = [];
    const values  = [];
    let idx = 1;
    if (points         !== undefined) { updates.push(`points = $${idx}`);         values.push(points);         idx++; }
    if (rate_per_shift !== undefined) { updates.push(`rate_per_shift = $${idx}`); values.push(rate_per_shift); idx++; }
    if (is_combinable  !== undefined) { updates.push(`is_combinable = $${idx}`);  values.push(!!is_combinable); idx++; }
    if (!updates.length) return reply.code(400).send({ error: 'РќРµС‚ РґР°РЅРЅС‹С…' });
    values.push(id);
    const { rows } = await db.query(
      `UPDATE field_tariff_grid SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!rows[0]) return reply.code(404).send({ error: 'РўР°СЂРёС„ РЅРµ РЅР°Р№РґРµРЅ' });
    return { tariff: rows[0] };
  });

  fastify.get('/settings/finance-limits', adminOrDirector, async () => {
    const { rows } = await db.query(`
      SELECT key, value_json FROM settings
      WHERE key IN ('self_employed_monthly_limit', 'self_employed_yearly_limit')
    `);
    const out = { monthly: 350000, yearly: 2400000 };
    for (const r of rows) {
      const v = parseFloat(String(r.value_json).replace(/[^\d.\-]/g, ''));
      if (r.key === 'self_employed_monthly_limit' && Number.isFinite(v)) out.monthly = v;
      if (r.key === 'self_employed_yearly_limit'  && Number.isFinite(v)) out.yearly  = v;
    }
    return out;
  });

  fastify.put('/settings/finance-limits', adminOrDirector, async (req, reply) => {
    const { monthly, yearly } = req.body || {};
    const updates = [];
    if (monthly !== undefined) {
      const v = parseFloat(monthly);
      if (!Number.isFinite(v) || v < 0) return reply.code(400).send({ error: 'monthly РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ С‡РёСЃР»РѕРј >= 0' });
      await db.query(`
        INSERT INTO settings (key, value_json, updated_at) VALUES ('self_employed_monthly_limit', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()
      `, [String(v)]);
      updates.push({ key: 'self_employed_monthly_limit', value: v });
    }
    if (yearly !== undefined) {
      const v = parseFloat(yearly);
      if (!Number.isFinite(v) || v < 0) return reply.code(400).send({ error: 'yearly РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ С‡РёСЃР»РѕРј >= 0' });
      await db.query(`
        INSERT INTO settings (key, value_json, updated_at) VALUES ('self_employed_yearly_limit', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()
      `, [String(v)]);
      updates.push({ key: 'self_employed_yearly_limit', value: v });
    }
    return { ok: true, updated: updates };
  });
};
