'use strict';

/**
 * ASGARD CRM — Smart Hints API
 * Контекстные подсказки для каждой страницы.
 * Level 4: SQL-подсказки + AI-анализ Мимира с кешем на 24ч.
 */

const crypto = require('crypto');
const aiProvider = require('../services/ai-provider');

// ═══════════════════════════════════════════
// AI-анализ: кеш, circuit breaker, генерация
// ═══════════════════════════════════════════

const _generatingKeys = new Set();   // ключи в процессе генерации
let _circuitErrors = 0;              // счётчик последовательных ошибок AI
let _circuitOpenUntil = 0;           // timestamp до которого circuit открыт

const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_PAUSE_MS = 5 * 60 * 1000; // 5 мин

const TEASERS = [
  'Наведите — расскажу подробнее',
  'У меня есть мысли по этому поводу…',
  'Хотите узнать немного больше?',
  'Мимир видит кое-что интересное…',
  'Есть пара наблюдений для вас',
];

function randomTeaser() {
  return TEASERS[Math.floor(Math.random() * TEASERS.length)];
}

function buildCacheKey(user, page, params) {
  const role = user.role;
  // Для персональных страниц (employee) — индивидуальный ключ
  const personalPages = ['employee', 'my-dashboard'];
  if (personalPages.includes(page)) {
    const suffix = params && params.employee_id ? '_' + params.employee_id : '';
    return role + '_' + user.id + ':' + page + suffix;
  }
  return role + ':' + page;
}

function computeHintsHash(hints) {
  const payload = hints.map(h => h.id + ':' + h.text).join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

const ANALYSIS_SYSTEM = `Ты — Мимир, AI-аналитик CRM «АСГАРД». Дай краткий анализ на 2-5 предложений.
Выдели главное, сопоставь метрики, начни с опасных сигналов, дай рекомендацию.
НЕ перечисляй данные — интерпретируй. Обращайся на «вы». Без маркдауна.`;

async function generateAnalysis(db, cacheKey, role, page, userId, hints, hintsHash) {
  if (_generatingKeys.has(cacheKey)) return;
  if (Date.now() < _circuitOpenUntil) return;

  _generatingKeys.add(cacheKey);

  try {
    // Формируем user-промпт из подсказок
    const lines = hints.map((h, i) =>
      (i + 1) + '. [' + h.type + '] ' + (h.icon || '') + ' ' + h.text
    ).join('\n');

    const userPrompt = 'Метрики страницы «' + page + '» (' + role + '):\n' + lines;

    const result = await aiProvider.complete({
      system: ANALYSIS_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 2000,
      temperature: 0.3
    });

    const text = (result.text || '').trim();
    if (!text) return;

    // Сохраняем в кеш (upsert)
    await db.query(`
      INSERT INTO mimir_hint_analysis_cache
        (cache_key, role, page, user_id, hints_hash, analysis_text,
         hints_snapshot, tokens_input, tokens_output, model_used, duration_ms,
         generated_at, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW() + INTERVAL '24 hours')
      ON CONFLICT (cache_key) DO UPDATE SET
        hints_hash = EXCLUDED.hints_hash,
        analysis_text = EXCLUDED.analysis_text,
        hints_snapshot = EXCLUDED.hints_snapshot,
        tokens_input = EXCLUDED.tokens_input,
        tokens_output = EXCLUDED.tokens_output,
        model_used = EXCLUDED.model_used,
        duration_ms = EXCLUDED.duration_ms,
        generated_at = NOW(),
        expires_at = NOW() + INTERVAL '24 hours'
    `, [
      cacheKey, role, page, userId || null, hintsHash, text,
      JSON.stringify(hints),
      result.usage?.inputTokens || 0,
      result.usage?.outputTokens || 0,
      result.model || 'unknown',
      result.durationMs || 0
    ]);

    _circuitErrors = 0;
  } catch (err) {
    console.error('[Hints AI]', err.message);
    _circuitErrors++;
    if (_circuitErrors >= CIRCUIT_THRESHOLD) {
      _circuitOpenUntil = Date.now() + CIRCUIT_PAUSE_MS;
      console.warn('[Hints AI] Circuit breaker OPEN for 5 min after', _circuitErrors, 'errors');
    }
  } finally {
    _generatingKeys.delete(cacheKey);
  }
}

async function getAnalysis(db, cacheKey, hintsHash) {
  try {
    const { rows } = await db.query(`
      SELECT analysis_text, generated_at
      FROM mimir_hint_analysis_cache
      WHERE cache_key = $1 AND expires_at > NOW()
      LIMIT 1
    `, [cacheKey]);

    if (!rows.length) return null;

    // Если хеш совпал — кеш валиден
    const row = rows[0];
    return { text: row.analysis_text, generated_at: row.generated_at };
  } catch (_) {
    return null;
  }
}

async function getAnalysisWithHash(db, cacheKey, hintsHash) {
  try {
    const { rows } = await db.query(`
      SELECT analysis_text, hints_hash, generated_at
      FROM mimir_hint_analysis_cache
      WHERE cache_key = $1 AND expires_at > NOW()
      LIMIT 1
    `, [cacheKey]);

    if (!rows.length) return { status: 'none' };

    const row = rows[0];
    if (row.hints_hash === hintsHash) {
      return { status: 'ready', text: row.analysis_text, generated_at: row.generated_at };
    }
    // Хеш изменился — данные устарели
    return { status: 'stale' };
  } catch (_) {
    return { status: 'none' };
  }
}

// Склонение: plural(5, 'счёт', 'счёта', 'счетов') → '5 счетов'
function plural(n, one, few, many) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 19) return n + ' ' + many;
  if (mod10 === 1) return n + ' ' + one;
  if (mod10 >= 2 && mod10 <= 4) return n + ' ' + few;
  return n + ' ' + many;
}

// Карта доступа: страница → массив ролей (ADMIN всегда включён).
// Страницы НЕ в этой карте доступны всем ролям.
const _D = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const PAGE_ROLES = {
  'dashboard':          ['ADMIN', ..._D],
  'my-dashboard':       ['ADMIN', 'PM', 'TO', 'HR', 'OFFICE_MANAGER', 'BUH', ..._D, 'HEAD_PM', 'HEAD_TO'],
  'tenders':            ['ADMIN', 'TO', 'HEAD_TO', ..._D],
  'pre-tenders':        ['ADMIN', 'TO', 'HEAD_TO', ..._D],
  'funnel':             ['ADMIN', 'TO', 'HEAD_TO', ..._D],
  'customers':          ['ADMIN', 'TO', 'HEAD_TO', 'PM', 'HEAD_PM', 'OFFICE_MANAGER', ..._D],
  'pm-calcs':           ['ADMIN', 'PM', 'HEAD_PM', ..._D],
  'calculator':         ['ADMIN', 'PM', 'TO', 'HEAD_PM', 'HEAD_TO', ..._D],
  'approvals':          ['ADMIN', 'HEAD_PM', ..._D],
  'bonus-approval':     ['ADMIN', 'PM', 'HEAD_PM', ..._D],
  'pm-works':           ['ADMIN', 'PM', 'HEAD_PM', ..._D],
  'all-works':          ['ADMIN', 'HEAD_PM', ..._D],
  'all-estimates':      ['ADMIN', 'BUH', 'HEAD_PM', ..._D],
  'tasks-admin':        ['ADMIN'],
  'finances':           ['ADMIN', 'BUH', ..._D],
  'invoices':           ['ADMIN', 'PM', 'BUH', ..._D],
  'acts':               ['ADMIN', 'PM', 'BUH', ..._D],
  'buh-registry':       ['ADMIN', 'BUH', ..._D],
  'office-expenses':    ['ADMIN', 'OFFICE_MANAGER', ..._D],
  'cash':               ['ADMIN', 'PM', ..._D],
  'cash-admin':         ['ADMIN', 'BUH', ..._D],
  'approval-payment':   ['ADMIN', 'BUH', ..._D],
  'payroll':            ['ADMIN', 'PM', 'HEAD_PM', 'BUH', ..._D],
  'payroll-sheet':      ['ADMIN', 'PM', 'HEAD_PM', 'BUH', ..._D],
  'self-employed':      ['ADMIN', 'BUH', ..._D],
  'one-time-pay':       ['ADMIN', 'PM', 'HEAD_PM', 'BUH', ..._D],
  'tkp':                ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', ..._D],
  'pass-requests':      ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'HR', 'HR_MANAGER', ..._D],
  'tmc-requests':       ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH', ..._D],
  'purchase-requests':  ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH', ..._D],
  'my-equipment':       ['ADMIN', 'PM', 'HEAD_PM', 'CHIEF_ENGINEER', ..._D],
  'correspondence':     ['ADMIN', 'OFFICE_MANAGER', ..._D],
  'contracts':          ['ADMIN', 'OFFICE_MANAGER', 'BUH', ..._D],
  'seals':              ['ADMIN', 'OFFICE_MANAGER', ..._D],
  'proxies':            ['ADMIN', 'OFFICE_MANAGER', ..._D],
  'proc-requests':      ['ADMIN', 'PROC', ..._D],
  'personnel':          ['ADMIN', 'HR', 'HR_MANAGER', ..._D],
  'collections':        ['ADMIN', 'HR', 'HR_MANAGER', ..._D],
  'permits':            ['ADMIN', 'HR', 'HR_MANAGER', 'TO', 'HEAD_TO', 'PM', 'CHIEF_ENGINEER', ..._D],
  'permit-applications':['ADMIN', 'HR', 'HR_MANAGER', 'TO', 'HEAD_TO', ..._D],
  'workers-schedule':   ['ADMIN', 'HR', 'HR_MANAGER', ..._D],
  'hr-rating':          ['ADMIN', 'HR', 'HR_MANAGER', ..._D],
  'travel':             ['ADMIN', 'OFFICE_MANAGER', 'HR', 'HR_MANAGER', 'PM', ..._D],
  'telephony':          ['ADMIN', 'TO', 'HEAD_TO', 'PM', 'HEAD_PM', ..._D],
  'mailbox':            ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO'],
  'inbox-applications': ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO'],
};

async function hintsRoutes(fastify) {
  const db = fastify.db;

  fastify.get('/hints', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const page = request.query.page || '';
    const user = request.user;
    const userId = user.id;
    const role = user.role;
    const hints = [];

    // Проверка доступа: если страница не доступна роли — пустой ответ
    const allowedRoles = PAGE_ROLES[page];
    if (allowedRoles && !allowedRoles.includes(role)) {
      return { hints: [] };
    }

    try {

      // ═══════════════════════════════════════════
      // ОБЩИЕ ПОДСКАЗКИ (финансовые роли)
      // ═══════════════════════════════════════════

      if (['ADMIN','PM','BUH','HEAD_PM','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(role)) try {
        const overdue = await db.query(`
          SELECT COUNT(*) as cnt,
                 COALESCE(SUM(total_amount - COALESCE(paid_amount,0)), 0) as total_debt
          FROM invoices
          WHERE status NOT IN ('paid','cancelled')
            AND due_date < CURRENT_DATE
            AND (total_amount - COALESCE(paid_amount,0)) > 0
        `);
        const cnt = parseInt(overdue.rows[0]?.cnt) || 0;
        if (cnt > 0) {
          const debt = parseFloat(overdue.rows[0]?.total_debt) || 0;
          hints.push({
            id: 'overdue_invoices',
            type: 'warning',
            icon: '💰',
            text: plural(cnt, 'просроченный счёт', 'просроченных счёта', 'просроченных счетов') +
              ' на ' + Math.round(debt).toLocaleString('ru-RU') + ' ₽',
            link: '#/invoices?filter=overdue',
            actions: ['details']
          });
        }
      } catch (_) {}

      // ═══════════════════════════════════════════
      // ПОДСКАЗКИ ПО СТРАНИЦАМ
      // ═══════════════════════════════════════════

      switch (page) {

        case 'tenders':
        case 'pre-tenders':
        case 'funnel': {
          // Тендеры без ТКП
          try {
            const noTkp = await db.query(`
              SELECT COUNT(*) as cnt FROM tenders
              WHERE tender_status IN ('В просчёте','На просчёте','Просчитан')
                AND id NOT IN (SELECT DISTINCT tender_id FROM tkp WHERE tender_id IS NOT NULL)
            `);
            const noTkpCnt = parseInt(noTkp.rows[0]?.cnt) || 0;
            if (noTkpCnt > 0) {
              hints.push({
                id: 'tenders_no_tkp', type: 'info', icon: '📋',
                text: plural(noTkpCnt, 'просчитанный тендер', 'просчитанных тендера', 'просчитанных тендеров') +
                  ' без ТКП — создать КП?',
                actions: ['create_tkp']
              });
            }
          } catch (_) {}

          // Дедлайны 7 дней
          try {
            const urgentTenders = await db.query(`
              SELECT COUNT(*) as cnt FROM tenders
              WHERE deadline IS NOT NULL
                AND deadline > CURRENT_DATE
                AND deadline <= CURRENT_DATE + INTERVAL '7 days'
                AND tender_status NOT IN ('Выиграли','Проиграли','Отказ','Отменён')
            `);
            const urgCnt = parseInt(urgentTenders.rows[0]?.cnt) || 0;
            if (urgCnt > 0) {
              hints.push({
                id: 'tenders_urgent', type: 'warning', icon: '⏰',
                text: 'Дедлайн в ближайшие 7 дней: ' +
                  plural(urgCnt, 'тендер', 'тендера', 'тендеров')
              });
            }
          } catch (_) {}

          // Конверсия 30 дней
          try {
            const funnelStats = await db.query(`
              SELECT
                COUNT(*) FILTER (WHERE created_at > CURRENT_DATE - INTERVAL '30 days') as new_30d,
                COUNT(*) FILTER (WHERE tender_status IN ('Выиграли','Контракт')
                  AND updated_at > CURRENT_DATE - INTERVAL '30 days') as won_30d
              FROM tenders
            `);
            const newCnt = parseInt(funnelStats.rows[0]?.new_30d) || 0;
            const wonCnt = parseInt(funnelStats.rows[0]?.won_30d) || 0;
            if (newCnt > 0) {
              const rate = Math.round(wonCnt / newCnt * 100);
              hints.push({
                id: 'funnel_conversion', type: 'metric', icon: '📊',
                text: '% целевых заявок за 30 дней: ' + rate + '% (' + wonCnt + ' из ' + newCnt + ')'
              });
            }
          } catch (_) {}
          break;
        }

        case 'tkp': {
          try {
            const staleKp = await db.query(`
              SELECT COUNT(*) as cnt FROM tkp
              WHERE status = 'sent' AND sent_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
            `);
            const staleCnt = parseInt(staleKp.rows[0]?.cnt) || 0;
            if (staleCnt > 0) {
              hints.push({
                id: 'tkp_stale', type: 'warning', icon: '📨',
                text: plural(staleCnt, 'ТКП отправлено', 'ТКП отправлены', 'ТКП отправлены') +
                  ' более 7 дней назад без ответа — пора звонить?',
                actions: ['details']
              });
            }
          } catch (_) {}

          try {
            const oldDrafts = await db.query(`
              SELECT COUNT(*) as cnt FROM tkp
              WHERE status = 'draft' AND created_at < CURRENT_TIMESTAMP - INTERVAL '3 days'
            `);
            const draftCnt = parseInt(oldDrafts.rows[0]?.cnt) || 0;
            if (draftCnt > 0) {
              hints.push({
                id: 'tkp_old_drafts', type: 'info', icon: '📝',
                text: plural(draftCnt, 'черновик', 'черновика', 'черновиков') +
                  ' ТКП старше 3 дней — отправить или удалить?'
              });
            }
          } catch (_) {}
          // Метрика: всего ТКП
          try {
            const totalTkp = await db.query("SELECT COUNT(*) as cnt FROM tkp");
            const ttCnt = parseInt(totalTkp.rows[0]?.cnt) || 0;
            if (ttCnt > 0) {
              hints.push({ id: 'tkp_total', type: 'metric', icon: '📋', text: 'Всего ТКП: ' + ttCnt });
            }
          } catch (_) {}
          break;
        }

        case 'all-works':
        case 'pm-works': {
          try {
            const deadlines = await db.query(`
              SELECT COUNT(*) as cnt FROM works
              WHERE end_plan IS NOT NULL
                AND end_plan > CURRENT_DATE
                AND end_plan <= CURRENT_DATE + INTERVAL '14 days'
                AND work_status NOT IN ('Завершена','Отменена','Закрыта')
            `);
            const dlCnt = parseInt(deadlines.rows[0]?.cnt) || 0;
            if (dlCnt > 0) {
              hints.push({
                id: 'works_deadline', type: 'warning', icon: '🔔',
                text: 'Дедлайн в ближайшие 14 дней: ' +
                  plural(dlCnt, 'работа', 'работы', 'работ')
              });
            }
          } catch (_) {}

          try {
            const noTeam = await db.query(`
              SELECT COUNT(*) as cnt FROM works
              WHERE work_status IN ('Новая','Согласована','В подготовке')
                AND id NOT IN (SELECT DISTINCT work_id FROM employee_assignments WHERE work_id IS NOT NULL)
            `);
            const noTeamCnt = parseInt(noTeam.rows[0]?.cnt) || 0;
            if (noTeamCnt > 0) {
              hints.push({
                id: 'works_no_team', type: 'info', icon: '👷',
                text: plural(noTeamCnt, 'работа', 'работы', 'работ') + ' без назначенной бригады'
              });
            }
          } catch (_) {}
          // Метрика: активные работы
          try {
            const activeWorks = await db.query(`
              SELECT COUNT(*) as cnt FROM works
              WHERE work_status IN ('В работе','На мобилизации','На демобилизации')
            `);
            const awCnt = parseInt(activeWorks.rows[0]?.cnt) || 0;
            if (awCnt > 0) {
              hints.push({
                id: 'works_active', type: 'metric', icon: '🔧',
                text: plural(awCnt, 'активная работа', 'активные работы', 'активных работ')
              });
            }
          } catch (_) {}
          break;
        }

        case 'personnel': {
          try {
            const expiring = await db.query(`
              SELECT COUNT(*) as cnt FROM employees
              WHERE is_active = true AND (
                (naks_expiry IS NOT NULL AND naks_expiry <= CURRENT_DATE + INTERVAL '30 days' AND naks_expiry > CURRENT_DATE)
                OR (imt_expires IS NOT NULL AND imt_expires <= CURRENT_DATE + INTERVAL '30 days' AND imt_expires > CURRENT_DATE)
              )
            `);
            const expCnt = parseInt(expiring.rows[0]?.cnt) || 0;
            if (expCnt > 0) {
              hints.push({
                id: 'permits_expiring', type: 'warning', icon: '🪪',
                text: 'Допуски истекают в течение 30 дней у ' +
                  plural(expCnt, 'сотрудника', 'сотрудников', 'сотрудников'),
                actions: ['details']
              });
            }
          } catch (_) {}

          try {
            const expired = await db.query(`
              SELECT COUNT(*) as cnt FROM employees
              WHERE is_active = true AND (
                (naks_expiry IS NOT NULL AND naks_expiry < CURRENT_DATE)
                OR (imt_expires IS NOT NULL AND imt_expires < CURRENT_DATE)
              )
            `);
            const expiredCnt = parseInt(expired.rows[0]?.cnt) || 0;
            if (expiredCnt > 0) {
              hints.push({
                id: 'permits_expired', type: 'error', icon: '🚫',
                text: 'Просрочены допуски у ' +
                  plural(expiredCnt, 'активного сотрудника', 'активных сотрудников', 'активных сотрудников') + '!',
                actions: ['details']
              });
            }
          } catch (_) {}
          // Метрика: всего активных сотрудников
          try {
            const activeEmps = await db.query("SELECT COUNT(*) as cnt FROM employees WHERE is_active = true");
            const aeCnt = parseInt(activeEmps.rows[0]?.cnt) || 0;
            if (aeCnt > 0) {
              hints.push({
                id: 'personnel_total', type: 'metric', icon: '👥',
                text: 'Активных сотрудников: ' + aeCnt
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ЛИЧНОЕ ДЕЛО СОТРУДНИКА (employee?id=X)
        // ═══════════════════════════════════════════
        case 'employee': {
          const empId = parseInt(request.query.employee_id) || 0;
          if (!empId) break;

          const empResult = await db.query('SELECT * FROM employees WHERE id = $1', [empId]);
          const emp = empResult.rows[0];
          if (!emp) break;

          // НАКС
          if (emp.naks_expiry) {
            const naksDate = new Date(emp.naks_expiry);
            const now = new Date();
            const daysLeft = Math.ceil((naksDate - now) / (1000 * 60 * 60 * 24));
            if (daysLeft < 0) {
              hints.push({
                id: 'emp_naks_expired', type: 'error', icon: '🚫',
                text: 'НАКС просрочен ' + Math.abs(daysLeft) + ' дн. назад — нельзя на сварочные работы',
                actions: ['details']
              });
            } else if (daysLeft <= 60) {
              hints.push({
                id: 'emp_naks_expiring', type: 'warning', icon: '🪪',
                text: 'НАКС истекает через ' + daysLeft + ' дн. (' + naksDate.toLocaleDateString('ru-RU') + ') — переаттестация?',
                actions: ['details']
              });
            }
          }

          // ИМТ
          if (emp.imt_expires) {
            const imtDate = new Date(emp.imt_expires);
            const now = new Date();
            const daysLeft = Math.ceil((imtDate - now) / (1000 * 60 * 60 * 24));
            if (daysLeft < 0) {
              hints.push({
                id: 'emp_imt_expired', type: 'error', icon: '⚠️',
                text: 'ИМТ просрочен — допуск к работе ограничен'
              });
            } else if (daysLeft <= 30) {
              hints.push({
                id: 'emp_imt_expiring', type: 'warning', icon: '📋',
                text: 'ИМТ истекает через ' + daysLeft + ' дн. (' + imtDate.toLocaleDateString('ru-RU') + ')'
              });
            }
          }

          // Незаполненные критичные поля
          const missing = [];
          if (!emp.inn) missing.push('ИНН');
          if (!emp.snils) missing.push('СНИЛС');
          if (!emp.passport_series || !emp.passport_number) missing.push('паспорт');
          if (!emp.birth_date) missing.push('дата рождения');
          if (!emp.address && !emp.registration_address) missing.push('адрес');
          if (!emp.phone) missing.push('телефон');
          if (!emp.account_number && !emp.card_number) missing.push('банк. реквизиты');
          if (missing.length > 0) {
            hints.push({
              id: 'emp_missing_docs', type: missing.length >= 3 ? 'warning' : 'info', icon: '📄',
              text: 'Не заполнено: ' + missing.join(', ') + ' — карточка неполная'
            });
          }

          // Не на работах >90 дней
          try {
            const recentAssign = await db.query(`
              SELECT COUNT(*) as cnt FROM employee_assignments
              WHERE employee_id = $1
                AND (date_to IS NULL OR date_to > CURRENT_DATE - INTERVAL '90 days')
            `, [empId]);
            if ((parseInt(recentAssign.rows[0]?.cnt) || 0) === 0 && emp.is_active) {
              hints.push({
                id: 'emp_no_work', type: 'info', icon: '💤',
                text: 'Сотрудник не назначен на работы более 90 дней'
              });
            }
          } catch (_) {}

          // Текущая работа
          try {
            const currentAssign = await db.query(`
              SELECT ea.*, w.work_title, w.work_number, w.work_status
              FROM employee_assignments ea
              JOIN works w ON w.id = ea.work_id
              WHERE ea.employee_id = $1
                AND (ea.date_to IS NULL OR ea.date_to >= CURRENT_DATE)
                AND ea.date_from <= CURRENT_DATE
                AND w.work_status NOT IN ('Завершена','Отменена','Закрыта')
              ORDER BY ea.date_from DESC LIMIT 1
            `, [empId]);
            if (currentAssign.rows[0]) {
              const w = currentAssign.rows[0];
              hints.push({
                id: 'emp_current_work', type: 'metric', icon: '🔧',
                text: 'Сейчас на работе: ' + (w.work_number || '№' + w.work_id) + ' «' + (w.work_title || '') + '»',
                link: '#/all-works?id=' + w.work_id
              });
            }
          } catch (_) {}

          // Рейтинг
          if (emp.rating_avg && parseFloat(emp.rating_avg) > 0) {
            const rating = parseFloat(emp.rating_avg);
            const count = parseInt(emp.rating_count) || 0;
            if (rating < 5) {
              hints.push({
                id: 'emp_low_rating', type: 'warning', icon: '⭐',
                text: 'Средний рейтинг: ' + rating.toFixed(1) + '/10 (' +
                  plural(count, 'отзыв', 'отзыва', 'отзывов') + ') — обратить внимание?',
                actions: ['details']
              });
            }
          } else {
            try {
              const reviewCount = await db.query(
                'SELECT COUNT(*) as cnt FROM employee_reviews WHERE employee_id = $1', [empId]
              );
              if (parseInt(reviewCount.rows[0]?.cnt) === 0 && emp.is_active) {
                hints.push({
                  id: 'emp_no_reviews', type: 'info', icon: '📝',
                  text: 'Нет отзывов от РП — попросите оценить после первой работы'
                });
              }
            } catch (_) {}
          }

          // День рождения (14 дней)
          if (emp.birth_date) {
            const bd = new Date(emp.birth_date);
            const now = new Date();
            const thisYearBD = new Date(now.getFullYear(), bd.getMonth(), bd.getDate());
            if (thisYearBD < now) thisYearBD.setFullYear(now.getFullYear() + 1);
            const daysUntil = Math.ceil((thisYearBD - now) / (1000 * 60 * 60 * 24));
            if (daysUntil <= 14 && daysUntil >= 0) {
              const age = thisYearBD.getFullYear() - bd.getFullYear();
              hints.push({
                id: 'emp_birthday', type: 'metric', icon: '🎂',
                text: daysUntil === 0
                  ? 'Сегодня день рождения! ' + age + ' лет — поздравить!'
                  : 'День рождения через ' + daysUntil + ' дн. (' + thisYearBD.toLocaleDateString('ru-RU') + ', ' + age + ' лет)'
              });
            }
          }

          // Годовщина в компании
          if (emp.hire_date || emp.employment_date) {
            const hd = new Date(emp.hire_date || emp.employment_date);
            const now = new Date();
            const thisYearAnniv = new Date(now.getFullYear(), hd.getMonth(), hd.getDate());
            if (thisYearAnniv < now) thisYearAnniv.setFullYear(now.getFullYear() + 1);
            const daysUntil = Math.ceil((thisYearAnniv - now) / (1000 * 60 * 60 * 24));
            const years = thisYearAnniv.getFullYear() - hd.getFullYear();
            if (daysUntil <= 14 && daysUntil >= 0 && years > 0) {
              hints.push({
                id: 'emp_anniversary', type: 'metric', icon: '🏆',
                text: daysUntil === 0
                  ? 'Сегодня ' + years + ' лет в компании!'
                  : years + ' лет в компании через ' + daysUntil + ' дн.'
              });
            }
          }

          // Самозанятый
          if (emp.is_self_employed && emp.contract_type === 'self_employed') {
            hints.push({
              id: 'emp_self_employed', type: 'info', icon: '📱',
              text: 'Самозанятый — не забудьте запросить чек после оплаты'
            });
          }

          // ФСБ-допуск
          if (!emp.fsb_pass && emp.is_active) {
            try {
              const fsbWorks = await db.query(`
                SELECT COUNT(*) as cnt FROM employee_assignments ea
                JOIN works w ON w.id = ea.work_id
                WHERE ea.employee_id = $1
                  AND (w.work_title ILIKE '%приразломная%' OR w.work_title ILIKE '%нпз%'
                    OR w.work_title ILIKE '%аэс%' OR w.work_title ILIKE '%атом%')
              `, [empId]);
              if (parseInt(fsbWorks.rows[0]?.cnt) > 0) {
                hints.push({
                  id: 'emp_no_fsb', type: 'warning', icon: '🔒',
                  text: 'Работал на режимных объектах, но ФСБ-допуск не указан'
                });
              }
            } catch (_) {}
          }

          // Задолженность по зарплате
          try {
            const unpaid = await db.query(`
              SELECT SUM(pi.base_amount + COALESCE(pi.bonus,0) - COALESCE(pi.advance_paid,0) - COALESCE(pi.penalty,0)) as debt
              FROM payroll_items pi
              JOIN payroll_sheets ps ON ps.id = pi.sheet_id
              WHERE pi.employee_id = $1
                AND ps.status NOT IN ('paid','cancelled')
                AND ps.created_at > CURRENT_DATE - INTERVAL '3 months'
            `, [empId]);
            const debt = parseFloat(unpaid.rows[0]?.debt) || 0;
            if (debt > 1000) {
              hints.push({
                id: 'emp_unpaid', type: 'warning', icon: '💸',
                text: 'Невыплачено за 3 мес.: ' + Math.round(debt).toLocaleString('ru-RU') + ' ₽'
              });
            }
          } catch (_) {}

          break;
        }

        case 'finances':
        case 'invoices':
        case 'acts':
        case 'buh-registry': {
          try {
            const unpaidActs = await db.query(`
              SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM acts
              WHERE status NOT IN ('paid','cancelled') AND amount > 0
            `);
            const actsCnt = parseInt(unpaidActs.rows[0]?.cnt) || 0;
            if (actsCnt > 0) {
              const actsTotal = parseFloat(unpaidActs.rows[0]?.total) || 0;
              hints.push({
                id: 'unpaid_acts', type: 'info', icon: '📑',
                text: plural(actsCnt, 'неоплаченный акт', 'неоплаченных акта', 'неоплаченных актов') +
                  ' на ' + Math.round(actsTotal).toLocaleString('ru-RU') + ' ₽'
              });
            }
          } catch (_) {}
          // Метрика: неоплаченные счета
          try {
            const unpaidInv = await db.query(`
              SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount - COALESCE(paid_amount,0)),0) as total
              FROM invoices WHERE status NOT IN ('paid','cancelled') AND (total_amount - COALESCE(paid_amount,0)) > 0
            `);
            const uiCnt = parseInt(unpaidInv.rows[0]?.cnt) || 0;
            if (uiCnt > 0) {
              const uiTotal = parseFloat(unpaidInv.rows[0]?.total) || 0;
              hints.push({
                id: 'invoices_unpaid_total', type: 'metric', icon: '💰',
                text: plural(uiCnt, 'неоплаченный счёт', 'неоплаченных счёта', 'неоплаченных счетов') +
                  ' на ' + Math.round(uiTotal).toLocaleString('ru-RU') + ' ₽'
              });
            }
          } catch (_) {}
          break;
        }

        case 'contracts': {
          try {
            const expiringContracts = await db.query(`
              SELECT COUNT(*) as cnt FROM contracts
              WHERE status = 'active' AND end_date IS NOT NULL
                AND end_date <= CURRENT_DATE + INTERVAL '30 days' AND end_date > CURRENT_DATE
            `);
            const cntContr = parseInt(expiringContracts.rows[0]?.cnt) || 0;
            if (cntContr > 0) {
              hints.push({
                id: 'contracts_expiring', type: 'warning', icon: '📄',
                text: plural(cntContr, 'контракт истекает', 'контракта истекают', 'контрактов истекают') +
                  ' в ближайшие 30 дней'
              });
            }
          } catch (_) {}
          // Метрика: всего активных контрактов
          try {
            const totalContr = await db.query("SELECT COUNT(*) as cnt FROM contracts WHERE status = 'active'");
            const tcCnt = parseInt(totalContr.rows[0]?.cnt) || 0;
            if (tcCnt > 0) {
              hints.push({
                id: 'contracts_total', type: 'metric', icon: '📄',
                text: 'Действующих договоров: ' + tcCnt
              });
            }
          } catch (_) {}
          break;
        }

        case 'customers': {
          try {
            const dormant = await db.query(`
              SELECT COUNT(*) as cnt FROM customers c
              WHERE c.inn IS NOT NULL AND c.inn != ''
                AND NOT EXISTS (
                  SELECT 1 FROM tenders t WHERE t.customer_inn = c.inn AND t.created_at > CURRENT_DATE - INTERVAL '90 days'
                )
            `);
            const dormCnt = parseInt(dormant.rows[0]?.cnt) || 0;
            if (dormCnt > 0) {
              hints.push({
                id: 'dormant_customers', type: 'info', icon: '💤',
                text: plural(dormCnt, 'клиент', 'клиента', 'клиентов') +
                  ' без новых тендеров более 90 дней'
              });
            }
          } catch (_) {}
          break;
        }

        case 'warehouse':
        case 'my-equipment': {
          try {
            const equipExpiry = await db.query(`
              SELECT COUNT(*) as cnt FROM equipment
              WHERE auto_write_off = true AND balance_date IS NOT NULL AND useful_life_months IS NOT NULL
                AND balance_date + (useful_life_months || ' months')::INTERVAL <= CURRENT_DATE + INTERVAL '60 days'
                AND balance_date + (useful_life_months || ' months')::INTERVAL > CURRENT_DATE
                AND balance_status = 'active'
            `);
            const eqCnt = parseInt(equipExpiry.rows[0]?.cnt) || 0;
            if (eqCnt > 0) {
              hints.push({
                id: 'equipment_expiring', type: 'info', icon: '🔧',
                text: plural(eqCnt, 'единица', 'единицы', 'единиц') +
                  ' оборудования списывается в ближайшие 60 дней'
              });
            }
          } catch (_) {}
          // Метрика: оборудование на балансе
          try {
            const onBal = await db.query("SELECT COUNT(*) as cnt FROM equipment WHERE balance_status IN ('on_balance','active')");
            const obCnt = parseInt(onBal.rows[0]?.cnt) || 0;
            if (obCnt > 0) {
              hints.push({
                id: 'equipment_total', type: 'metric', icon: '🔧',
                text: 'Оборудование на балансе: ' + plural(obCnt, 'единица', 'единицы', 'единиц')
              });
            }
          } catch (_) {}
          break;
        }

        case 'dashboard':
        case 'my-dashboard': {
          try {
            const myTasks = await db.query(`
              SELECT COUNT(*) as cnt FROM tasks
              WHERE status NOT IN ('done','cancelled') AND assignee_id = $1
            `, [userId]);
            const taskCnt = parseInt(myTasks.rows[0]?.cnt) || 0;
            if (taskCnt > 0) {
              hints.push({
                id: 'my_tasks', type: 'info', icon: '✅',
                text: 'У вас ' + plural(taskCnt, 'активная задача', 'активные задачи', 'активных задач'),
                link: '#/tasks'
              });
            }
          } catch (_) {}
          break;
        }

        case 'pass-requests': {
          try {
            const pending = await db.query(`
              SELECT COUNT(*) as cnt FROM pass_requests WHERE status IN ('new','pending','in_progress')
            `);
            const pendCnt = parseInt(pending.rows[0]?.cnt) || 0;
            if (pendCnt > 0) {
              hints.push({
                id: 'pass_pending', type: 'info', icon: '🎫',
                text: plural(pendCnt, 'заявка', 'заявки', 'заявок') + ' на пропуск в обработке'
              });
            }
          } catch (_) {}
          break;
        }

        case 'calendar': {
          try {
            const today = await db.query(`
              SELECT COUNT(*) as cnt FROM calendar_events
              WHERE date = CURRENT_DATE OR (date <= CURRENT_DATE AND end_date >= CURRENT_DATE)
            `);
            const todayCnt = parseInt(today.rows[0]?.cnt) || 0;
            if (todayCnt > 0) {
              hints.push({
                id: 'today_events', type: 'info', icon: '📅',
                text: plural(todayCnt, 'событие', 'события', 'событий') + ' на сегодня'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ЗАРПЛАТА И ВЕДОМОСТИ
        // ═══════════════════════════════════════════
        case 'payroll':
        case 'payroll-sheet':
        case 'self-employed':
        case 'one-time-pay': {
          try {
            const draftSheets = await db.query(`
              SELECT COUNT(*) as cnt FROM payroll_sheets
              WHERE status NOT IN ('paid','cancelled','approved')
            `);
            const draftCnt = parseInt(draftSheets.rows[0]?.cnt) || 0;
            if (draftCnt > 0) {
              hints.push({
                id: 'payroll_drafts', type: 'info', icon: '📋',
                text: plural(draftCnt, 'ведомость', 'ведомости', 'ведомостей') +
                  ' в черновике или на согласовании'
              });
            }
          } catch (_) {}
          try {
            const unpaidSheets = await db.query(`
              SELECT COALESCE(SUM(total_payout),0) as total FROM payroll_sheets
              WHERE status = 'approved' AND payment_status != 'paid'
            `);
            const unpaidTotal = parseFloat(unpaidSheets.rows[0]?.total) || 0;
            if (unpaidTotal > 0) {
              hints.push({
                id: 'payroll_unpaid', type: 'warning', icon: '💸',
                text: 'Невыплаченные ведомости на ' + Math.round(unpaidTotal).toLocaleString('ru-RU') + ' ₽',
                link: '#/payroll?filter=approved'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ЗАДАЧИ И КАНБАН
        // ═══════════════════════════════════════════
        case 'tasks':
        case 'tasks-admin':
        case 'kanban': {
          try {
            const overdueTasks = await db.query(`
              SELECT COUNT(*) as cnt FROM tasks
              WHERE status NOT IN ('done','cancelled')
                AND deadline IS NOT NULL AND deadline < CURRENT_DATE
            `);
            const overdueCnt = parseInt(overdueTasks.rows[0]?.cnt) || 0;
            if (overdueCnt > 0) {
              hints.push({
                id: 'tasks_overdue', type: 'warning', icon: '⏰',
                text: plural(overdueCnt, 'просроченная задача', 'просроченные задачи', 'просроченных задач')
              });
            }
          } catch (_) {}
          try {
            const unassigned = await db.query(`
              SELECT COUNT(*) as cnt FROM tasks
              WHERE assignee_id IS NULL AND status NOT IN ('done','cancelled')
            `);
            const unaCnt = parseInt(unassigned.rows[0]?.cnt) || 0;
            if (unaCnt > 0) {
              hints.push({
                id: 'tasks_unassigned', type: 'info', icon: '👤',
                text: plural(unaCnt, 'задача', 'задачи', 'задач') + ' без исполнителя'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // НАПОМИНАНИЯ
        // ═══════════════════════════════════════════
        case 'reminders': {
          try {
            const todayReminders = await db.query(`
              SELECT COUNT(*) as cnt FROM reminders
              WHERE due_date <= CURRENT_DATE
                AND status NOT IN ('done','cancelled')
                AND dismissed IS NOT TRUE
            `);
            const remCnt = parseInt(todayReminders.rows[0]?.cnt) || 0;
            if (remCnt > 0) {
              hints.push({
                id: 'reminders_today', type: 'warning', icon: '🔔',
                text: plural(remCnt, 'активное напоминание', 'активных напоминания', 'активных напоминаний') +
                  ' на сегодня или просрочено'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // HR-РЕЙТИНГ
        // ═══════════════════════════════════════════
        case 'hr-rating': {
          try {
            const noRating = await db.query(`
              SELECT COUNT(*) as cnt FROM employees
              WHERE is_active = true AND rating_avg IS NULL
            `);
            const nrCnt = parseInt(noRating.rows[0]?.cnt) || 0;
            if (nrCnt > 0) {
              hints.push({
                id: 'hr_no_rating', type: 'info', icon: '⭐',
                text: plural(nrCnt, 'активный сотрудник', 'активных сотрудника', 'активных сотрудников') +
                  ' без оценки'
              });
            }
          } catch (_) {}
          // Метрика: средний рейтинг дружины
          try {
            const avgR = await db.query("SELECT AVG(rating_avg) as avg FROM employees WHERE is_active = true AND rating_avg IS NOT NULL");
            const avg = parseFloat(avgR.rows[0]?.avg) || 0;
            if (avg > 0) {
              hints.push({ id: 'hr_avg_rating', type: 'metric', icon: '📊', text: 'Средний рейтинг дружины: ' + avg.toFixed(1) + ' / 10' });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ПОДБОРКИ
        // ═══════════════════════════════════════════
        case 'collections': {
          try {
            const colCount = await db.query(`
              SELECT COUNT(*) as cnt FROM employee_collections
            `);
            const cCnt = parseInt(colCount.rows[0]?.cnt) || 0;
            hints.push({
              id: 'collections_total', type: 'metric', icon: '📚',
              text: 'Всего подборок: ' + cCnt
            });
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ОБУЧЕНИЕ
        // ═══════════════════════════════════════════
        case 'training': {
          try {
            const pendingTraining = await db.query(`
              SELECT COUNT(*) as cnt FROM training_applications
              WHERE status IN ('pending','new')
            `);
            const trCnt = parseInt(pendingTraining.rows[0]?.cnt) || 0;
            if (trCnt > 0) {
              hints.push({
                id: 'training_pending', type: 'info', icon: '🎓',
                text: plural(trCnt, 'заявка', 'заявки', 'заявок') + ' на обучение ожидает рассмотрения'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // КОМАНДИРОВКИ
        // ═══════════════════════════════════════════
        case 'travel': {
          try {
            const openTravel = await db.query(`
              SELECT COUNT(*) as cnt FROM business_trips
              WHERE status NOT IN ('closed','cancelled','completed')
            `);
            const tvCnt = parseInt(openTravel.rows[0]?.cnt) || 0;
            if (tvCnt > 0) {
              hints.push({
                id: 'travel_open', type: 'info', icon: '✈️',
                text: plural(tvCnt, 'незакрытая командировка', 'незакрытые командировки', 'незакрытых командировок')
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // КОРРЕСПОНДЕНЦИЯ
        // ═══════════════════════════════════════════
        case 'correspondence': {
          try {
            const noReply = await db.query(`
              SELECT COUNT(*) as cnt FROM correspondence
              WHERE direction = 'incoming' AND status NOT IN ('answered','cancelled','closed')
            `);
            const nrCnt = parseInt(noReply.rows[0]?.cnt) || 0;
            if (nrCnt > 0) {
              hints.push({
                id: 'correspondence_no_reply', type: 'warning', icon: '📨',
                text: plural(nrCnt, 'входящее письмо', 'входящих письма', 'входящих писем') + ' без ответа'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ПЕЧАТИ
        // ═══════════════════════════════════════════
        case 'seals': {
          try {
            const overdueSeals = await db.query(`
              SELECT COUNT(*) as cnt FROM seals
              WHERE status NOT IN ('office','destroyed','lost')
                AND issue_date IS NOT NULL
                AND issue_date < CURRENT_DATE - INTERVAL '30 days'
            `);
            const sCnt = parseInt(overdueSeals.rows[0]?.cnt) || 0;
            if (sCnt > 0) {
              hints.push({
                id: 'seals_overdue', type: 'warning', icon: '🔏',
                text: plural(sCnt, 'печать выдана', 'печати выданы', 'печатей выдано') +
                  ' более 30 дней назад и не возвращена'
              });
            }
          } catch (_) {}
          // Общая метрика
          try {
            const totalSeals = await db.query('SELECT COUNT(*) as cnt FROM seals');
            const tsCnt = parseInt(totalSeals.rows[0]?.cnt) || 0;
            if (tsCnt > 0) {
              hints.push({
                id: 'seals_total', type: 'metric', icon: '🔏',
                text: 'Всего печатей на учёте: ' + tsCnt
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ДОВЕРЕННОСТИ
        // ═══════════════════════════════════════════
        case 'proxies': {
          try {
            const expiringProxies = await db.query(`
              SELECT COUNT(*) as cnt FROM proxies
              WHERE status = 'active' AND valid_until IS NOT NULL
                AND valid_until <= CURRENT_DATE + INTERVAL '60 days'
                AND valid_until > CURRENT_DATE
            `);
            const pCnt = parseInt(expiringProxies.rows[0]?.cnt) || 0;
            if (pCnt > 0) {
              hints.push({
                id: 'proxies_expiring', type: 'warning', icon: '📜',
                text: plural(pCnt, 'доверенность истекает', 'доверенности истекают', 'доверенностей истекают') +
                  ' в ближайшие 60 дней'
              });
            }
          } catch (_) {}
          // Просроченные
          try {
            const expiredProxies = await db.query(`
              SELECT COUNT(*) as cnt FROM proxies
              WHERE status = 'active' AND valid_until IS NOT NULL
                AND valid_until < CURRENT_DATE
            `);
            const epCnt = parseInt(expiredProxies.rows[0]?.cnt) || 0;
            if (epCnt > 0) {
              hints.push({
                id: 'proxies_expired', type: 'error', icon: '📜',
                text: plural(epCnt, 'доверенность просрочена', 'доверенности просрочены', 'доверенностей просрочено') +
                  ', но всё ещё в статусе «активна»'
              });
            }
          } catch (_) {}
          // Метрика
          try {
            const activeProxies = await db.query(
              "SELECT COUNT(*) as cnt FROM proxies WHERE status = 'active'"
            );
            const apCnt = parseInt(activeProxies.rows[0]?.cnt) || 0;
            hints.push({
              id: 'proxies_total', type: 'metric', icon: '📜',
              text: 'Действующих доверенностей: ' + apCnt
            });
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ОФИСНЫЕ РАСХОДЫ
        // ═══════════════════════════════════════════
        case 'office-expenses': {
          try {
            const pendingExp = await db.query(`
              SELECT COUNT(*) as cnt FROM office_expenses
              WHERE status IN ('pending','new','on_approval','draft')
            `);
            const oeCnt = parseInt(pendingExp.rows[0]?.cnt) || 0;
            if (oeCnt > 0) {
              hints.push({
                id: 'office_expenses_pending', type: 'info', icon: '🧾',
                text: plural(oeCnt, 'расход ожидает', 'расхода ожидают', 'расходов ожидают') + ' согласования'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ЗАЯВКИ НА ЗАКУПКУ / ТМЦ
        // ═══════════════════════════════════════════
        case 'purchase-requests':
        case 'tmc-requests':
        case 'proc-requests': {
          try {
            const pendingReq = await db.query(`
              SELECT COUNT(*) as cnt FROM purchase_requests
              WHERE status IN ('pending','new')
            `);
            const prCnt = parseInt(pendingReq.rows[0]?.cnt) || 0;
            if (prCnt > 0) {
              hints.push({
                id: 'purchase_pending', type: 'info', icon: '🛒',
                text: plural(prCnt, 'заявка', 'заявки', 'заявок') + ' на закупку ожидает обработки'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ГРАФИКИ РАБОТЫ
        // ═══════════════════════════════════════════
        case 'workers-schedule':
        case 'office-schedule': {
          try {
            const noSchedule = await db.query(`
              SELECT COUNT(*) as cnt FROM employees
              WHERE is_active = true
                AND id NOT IN (
                  SELECT DISTINCT employee_id FROM employee_assignments
                  WHERE date_from <= CURRENT_DATE AND (date_to IS NULL OR date_to >= CURRENT_DATE)
                )
            `);
            const nsCnt = parseInt(noSchedule.rows[0]?.cnt) || 0;
            if (nsCnt > 0) {
              hints.push({
                id: 'schedule_missing', type: 'info', icon: '📆',
                text: plural(nsCnt, 'сотрудник', 'сотрудника', 'сотрудников') +
                  ' без назначений на текущий период'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // РАСЧЁТЫ / КАЛЬКУЛЯТОР
        // ═══════════════════════════════════════════
        case 'pm-calcs':
        case 'all-estimates':
        case 'calculator': {
          try {
            const pendingCalcs = await db.query(`
              SELECT COUNT(*) as cnt FROM estimates
              WHERE status IN ('pending','on_approval','draft')
            `);
            const pcCnt = parseInt(pendingCalcs.rows[0]?.cnt) || 0;
            if (pcCnt > 0) {
              hints.push({
                id: 'estimates_pending', type: 'info', icon: '🧮',
                text: plural(pcCnt, 'расчёт ожидает', 'расчёта ожидают', 'расчётов ожидают') + ' согласования'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ТЕЛЕФОНИЯ
        // ═══════════════════════════════════════════
        case 'telephony': {
          try {
            const missedCalls = await db.query(`
              SELECT COUNT(*) as cnt FROM call_history
              WHERE direction = 'inbound' AND status = 'missed'
                AND created_at::date = CURRENT_DATE
            `);
            const mcCnt = parseInt(missedCalls.rows[0]?.cnt) || 0;
            if (mcCnt > 0) {
              hints.push({
                id: 'telephony_missed', type: 'warning', icon: '📞',
                text: plural(mcCnt, 'пропущенный звонок', 'пропущенных звонка', 'пропущенных звонков') +
                  ' сегодня'
              });
            }
          } catch (_) {}
          // Общая статистика за сегодня
          try {
            const todayCalls = await db.query(`
              SELECT COUNT(*) as cnt FROM call_history
              WHERE created_at::date = CURRENT_DATE
            `);
            const tcCnt = parseInt(todayCalls.rows[0]?.cnt) || 0;
            if (tcCnt > 0) {
              hints.push({
                id: 'telephony_today', type: 'metric', icon: '📞',
                text: plural(tcCnt, 'звонок', 'звонка', 'звонков') + ' за сегодня'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // МЕССЕНДЖЕР / ЧАТ
        // ═══════════════════════════════════════════
        case 'messenger':
        case 'chat-groups': {
          try {
            const unread = await db.query(`
              SELECT COUNT(*) as cnt FROM chat_messages
              WHERE read_at IS NULL AND sender_id != $1
            `, [userId]);
            const urCnt = parseInt(unread.rows[0]?.cnt) || 0;
            if (urCnt > 0) {
              hints.push({
                id: 'chat_unread', type: 'info', icon: '💬',
                text: plural(urCnt, 'непрочитанное сообщение', 'непрочитанных сообщения', 'непрочитанных сообщений')
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ПОЧТА / ВХОДЯЩИЕ
        // ═══════════════════════════════════════════
        case 'mailbox':
        case 'my-mail':
        case 'inbox-applications': {
          try {
            const unprocessed = await db.query(`
              SELECT COUNT(*) as cnt FROM emails
              WHERE is_read = false AND direction = 'incoming'
                AND (owner_user_id IS NULL OR owner_user_id = $1)
            `, [userId]);
            const upCnt = parseInt(unprocessed.rows[0]?.cnt) || 0;
            if (upCnt > 0) {
              hints.push({
                id: 'mailbox_unprocessed', type: 'info', icon: '📬',
                text: plural(upCnt, 'непрочитанное входящее', 'непрочитанных входящих', 'непрочитанных входящих')
              });
            }
          } catch (_) {}
          // Заявки из входящих
          try {
            const apps = await db.query(`
              SELECT COUNT(*) as cnt FROM inbox_applications
              WHERE status IN ('new','pending')
            `);
            const appCnt = parseInt(apps.rows[0]?.cnt) || 0;
            if (appCnt > 0) {
              hints.push({
                id: 'inbox_apps_pending', type: 'info', icon: '📥',
                text: plural(appCnt, 'новая заявка', 'новые заявки', 'новых заявок') + ' из входящих'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // СОГЛАСОВАНИЯ
        // ═══════════════════════════════════════════
        case 'approvals':
        case 'bonus-approval':
        case 'approval-payment': {
          try {
            const pendingApprovals = await db.query(`
              SELECT COUNT(*) as cnt FROM estimate_approval_requests
              WHERE current_stage NOT IN ('approved','rejected','cancelled')
                AND finalized_at IS NULL
            `);
            const apCnt = parseInt(pendingApprovals.rows[0]?.cnt) || 0;
            if (apCnt > 0) {
              hints.push({
                id: 'approvals_pending', type: 'warning', icon: '✍️',
                text: plural(apCnt, 'документ ожидает', 'документа ожидают', 'документов ожидают') +
                  ' согласования',
                link: '#/approvals?filter=pending'
              });
            }
          } catch (_) {}
          // Бонусы
          try {
            const bonuses = await db.query(`
              SELECT COUNT(*) as cnt FROM bonus_requests
              WHERE status IN ('pending','new')
            `);
            const bCnt = parseInt(bonuses.rows[0]?.cnt) || 0;
            if (bCnt > 0) {
              hints.push({
                id: 'bonus_pending', type: 'info', icon: '🎁',
                text: plural(bCnt, 'заявка', 'заявки', 'заявок') + ' на премию ожидает решения'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // КАССА
        // ═══════════════════════════════════════════
        case 'cash':
        case 'cash-admin': {
          try {
            const pendingCash = await db.query(`
              SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total
              FROM cash_requests
              WHERE status IN ('pending','new','on_approval')
            `);
            const crCnt = parseInt(pendingCash.rows[0]?.cnt) || 0;
            if (crCnt > 0) {
              const crTotal = parseFloat(pendingCash.rows[0]?.total) || 0;
              hints.push({
                id: 'cash_pending', type: 'info', icon: '💵',
                text: plural(crCnt, 'заявка', 'заявки', 'заявок') +
                  ' на выдачу на ' + Math.round(crTotal).toLocaleString('ru-RU') + ' ₽'
              });
            }
          } catch (_) {}
          break;
        }

        // ═══════════════════════════════════════════
        // ДОПУСКИ / ЗАЯВКИ НА ДОПУСКИ
        // ═══════════════════════════════════════════
        case 'permits':
        case 'permit-applications': {
          try {
            const pendingPermits = await db.query(`
              SELECT COUNT(*) as cnt FROM permit_applications
              WHERE status IN ('pending','new','in_progress')
            `);
            const ppCnt = parseInt(pendingPermits.rows[0]?.cnt) || 0;
            if (ppCnt > 0) {
              hints.push({
                id: 'permits_pending', type: 'info', icon: '🪪',
                text: plural(ppCnt, 'заявка', 'заявки', 'заявок') + ' на допуск в обработке'
              });
            }
          } catch (_) {}
          break;
        }

      } // end switch

    } catch (e) {
      fastify.log.warn('Hints error page=' + page + ':', e.message);
    }

    // ═══════════════════════════════════════════
    // AI-анализ Мимира (Level 4)
    // ═══════════════════════════════════════════
    let analysis = null;

    if (hints.length > 0) {
      try {
        const params = { employee_id: request.query.employee_id };
        const cacheKey = buildCacheKey(user, page, params);
        const hintsHash = computeHintsHash(hints);
        const cached = await getAnalysisWithHash(db, cacheKey, hintsHash);

        if (cached.status === 'ready') {
          analysis = { text: cached.text, status: 'ready', teaser: randomTeaser(), generated_at: cached.generated_at };
        } else {
          // Запуск AI-генерации async (fire-and-forget)
          generateAnalysis(db, cacheKey, role, page, userId, hints, hintsHash);
          analysis = {
            text: null,
            status: _generatingKeys.has(cacheKey) ? 'generating' : 'pending',
            teaser: randomTeaser(),
            generated_at: null
          };
        }
      } catch (_) {
        // AI-анализ не должен ломать основные подсказки
      }
    }

    return { hints, analysis };
  });

  // ═══════════════════════════════════════════
  // GET /hints/analysis — поллинг статуса AI-анализа
  // ═══════════════════════════════════════════
  fastify.get('/hints/analysis', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const page = request.query.page || '';
    const user = request.user;
    const params = { employee_id: request.query.employee_id };
    const cacheKey = buildCacheKey(user, page, params);

    const cached = await getAnalysis(db, cacheKey, null);

    if (cached) {
      return {
        analysis: { text: cached.text, status: 'ready', generated_at: cached.generated_at }
      };
    }

    return {
      analysis: {
        text: null,
        status: _generatingKeys.has(cacheKey) ? 'generating' : 'pending'
      }
    };
  });
}

module.exports = hintsRoutes;
