'use strict';

/**
 * ASGARD CRM — Smart Hints API
 * Контекстные подсказки для каждой страницы.
 * Чистый SQL, без AI. Быстро (<50ms).
 */

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

    try {

      // ═══════════════════════════════════════════
      // ОБЩИЕ ПОДСКАЗКИ (на ВСЕХ страницах)
      // ═══════════════════════════════════════════

      if (['ADMIN','PM','HEAD_PM','BUH','DIRECTOR_GEN','DIRECTOR_COMM'].includes(role)) {
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
            text: cnt + ' просроченных счетов на ' + Math.round(debt).toLocaleString('ru-RU') + ' ₽',
            link: '#/invoices?filter=overdue',
            actions: ['details']
          });
        }
      }

      // ═══════════════════════════════════════════
      // ПОДСКАЗКИ ПО СТРАНИЦАМ
      // ═══════════════════════════════════════════

      switch (page) {

        case 'tenders':
        case 'pre-tenders':
        case 'funnel': {
          // Тендеры без ТКП
          const noTkp = await db.query(`
            SELECT COUNT(*) as cnt FROM tenders
            WHERE tender_status IN ('В просчёте','На просчёте','Просчитан')
              AND id NOT IN (SELECT DISTINCT tender_id FROM tkp WHERE tender_id IS NOT NULL)
          `);
          const noTkpCnt = parseInt(noTkp.rows[0]?.cnt) || 0;
          if (noTkpCnt > 0) {
            hints.push({
              id: 'tenders_no_tkp', type: 'info', icon: '📋',
              text: noTkpCnt + ' просчитанных тендеров без ТКП. Создать КП?',
              actions: ['create_tkp']
            });
          }

          // Дедлайны 7 дней
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
              text: urgCnt + ' тендеров с дедлайном в ближайшие 7 дней'
            });
          }

          // Конверсия 30 дней
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
              text: 'Конверсия за 30 дней: ' + rate + '% (' + wonCnt + ' из ' + newCnt + ')'
            });
          }
          break;
        }

        case 'tkp': {
          const staleKp = await db.query(`
            SELECT COUNT(*) as cnt FROM tkp
            WHERE status = 'sent' AND sent_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
          `);
          const staleCnt = parseInt(staleKp.rows[0]?.cnt) || 0;
          if (staleCnt > 0) {
            hints.push({
              id: 'tkp_stale', type: 'warning', icon: '📨',
              text: staleCnt + ' ТКП отправлены более 7 дней назад без ответа. Пора звонить?',
              actions: ['details']
            });
          }

          const oldDrafts = await db.query(`
            SELECT COUNT(*) as cnt FROM tkp
            WHERE status = 'draft' AND created_at < CURRENT_TIMESTAMP - INTERVAL '3 days'
          `);
          const draftCnt = parseInt(oldDrafts.rows[0]?.cnt) || 0;
          if (draftCnt > 0) {
            hints.push({
              id: 'tkp_old_drafts', type: 'info', icon: '📝',
              text: draftCnt + ' черновиков ТКП старше 3 дней. Отправить или удалить?'
            });
          }
          break;
        }

        case 'all-works':
        case 'pm-works': {
          const deadlines = await db.query(`
            SELECT COUNT(*) as cnt FROM works
            WHERE work_end_plan IS NOT NULL
              AND work_end_plan > CURRENT_DATE
              AND work_end_plan <= CURRENT_DATE + INTERVAL '14 days'
              AND work_status NOT IN ('Завершена','Отменена','Закрыта')
          `);
          const dlCnt = parseInt(deadlines.rows[0]?.cnt) || 0;
          if (dlCnt > 0) {
            hints.push({
              id: 'works_deadline', type: 'warning', icon: '🔔',
              text: dlCnt + ' работ с дедлайном в ближайшие 14 дней'
            });
          }

          const noTeam = await db.query(`
            SELECT COUNT(*) as cnt FROM works
            WHERE work_status IN ('Новая','Согласована','В подготовке')
              AND id NOT IN (SELECT DISTINCT work_id FROM employee_assignments WHERE work_id IS NOT NULL)
          `);
          const noTeamCnt = parseInt(noTeam.rows[0]?.cnt) || 0;
          if (noTeamCnt > 0) {
            hints.push({
              id: 'works_no_team', type: 'info', icon: '👷',
              text: noTeamCnt + ' работ без назначенной бригады'
            });
          }
          break;
        }

        case 'personnel': {
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
              text: 'У ' + expCnt + ' сотрудников допуски истекают в течение 30 дней',
              actions: ['details']
            });
          }

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
              text: 'У ' + expiredCnt + ' активных сотрудников просрочены допуски!',
              actions: ['details']
            });
          }
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
                text: 'НАКС просрочен ' + Math.abs(daysLeft) + ' дней назад! Нельзя на сварочные работы.',
                actions: ['details']
              });
            } else if (daysLeft <= 60) {
              hints.push({
                id: 'emp_naks_expiring', type: 'warning', icon: '🪪',
                text: 'НАКС истекает через ' + daysLeft + ' дней (' + naksDate.toLocaleDateString('ru-RU') + '). Переаттестация?',
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
                text: 'ИМТ просрочен! Допуск к работе ограничен.'
              });
            } else if (daysLeft <= 30) {
              hints.push({
                id: 'emp_imt_expiring', type: 'warning', icon: '📋',
                text: 'ИМТ истекает через ' + daysLeft + ' дней (' + imtDate.toLocaleDateString('ru-RU') + ')'
              });
            }
          }

          // Незаполненные критичные поля
          const missing = [];
          if (!emp.inn) missing.push('ИНН');
          if (!emp.snils) missing.push('СНИЛС');
          if (!emp.passport_series || !emp.passport_number) missing.push('Паспорт');
          if (!emp.birth_date) missing.push('Дата рождения');
          if (!emp.address && !emp.registration_address) missing.push('Адрес');
          if (!emp.phone) missing.push('Телефон');
          if (!emp.account_number && !emp.card_number) missing.push('Банк. реквизиты');
          if (missing.length > 0) {
            hints.push({
              id: 'emp_missing_docs', type: missing.length >= 3 ? 'warning' : 'info', icon: '📄',
              text: 'Не заполнено: ' + missing.join(', ') + '. Карточка неполная.'
            });
          }

          // Не на работах >90 дней
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

          // Текущая работа
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
              text: 'Сейчас на работе: ' + (w.work_number || '№' + w.work_id) + ' "' + (w.work_title || '') + '"',
              link: '#/all-works?id=' + w.work_id
            });
          }

          // Рейтинг
          if (emp.rating_avg && parseFloat(emp.rating_avg) > 0) {
            const rating = parseFloat(emp.rating_avg);
            const count = parseInt(emp.rating_count) || 0;
            if (rating < 5) {
              hints.push({
                id: 'emp_low_rating', type: 'warning', icon: '⭐',
                text: 'Средний рейтинг: ' + rating.toFixed(1) + '/10 (' + count + ' отзывов). Обратить внимание?',
                actions: ['details']
              });
            }
          } else {
            const reviewCount = await db.query(
              'SELECT COUNT(*) as cnt FROM employee_reviews WHERE employee_id = $1', [empId]
            );
            if (parseInt(reviewCount.rows[0]?.cnt) === 0 && emp.is_active) {
              hints.push({
                id: 'emp_no_reviews', type: 'info', icon: '📝',
                text: 'Ни одного отзыва от РП. Попросите руководителя оценить после первой работы.'
              });
            }
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
                  ? 'Сегодня день рождения! ' + age + ' лет. Поздравить!'
                  : 'День рождения через ' + daysUntil + ' дней (' + thisYearBD.toLocaleDateString('ru-RU') + ', ' + age + ' лет)'
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
                text: daysUntil === 0 ? 'Сегодня ' + years + ' лет в компании!' : years + ' лет в компании через ' + daysUntil + ' дней'
              });
            }
          }

          // Самозанятый
          if (emp.is_self_employed && emp.contract_type === 'self_employed') {
            hints.push({
              id: 'emp_self_employed', type: 'info', icon: '📱',
              text: 'Самозанятый — не забудьте запросить чек после каждой оплаты'
            });
          }

          // ФСБ-допуск
          if (!emp.fsb_pass && emp.is_active) {
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
                text: 'Невыплачено за 3 месяца: ' + Math.round(debt).toLocaleString('ru-RU') + ' ₽'
              });
            }
          } catch (_) {}

          break;
        }

        case 'finances':
        case 'invoices':
        case 'acts':
        case 'buh-registry': {
          const unpaidActs = await db.query(`
            SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM acts
            WHERE status NOT IN ('paid','cancelled') AND amount > 0
          `);
          const actsCnt = parseInt(unpaidActs.rows[0]?.cnt) || 0;
          if (actsCnt > 0) {
            const actsTotal = parseFloat(unpaidActs.rows[0]?.total) || 0;
            hints.push({
              id: 'unpaid_acts', type: 'info', icon: '📑',
              text: actsCnt + ' неоплаченных актов на ' + Math.round(actsTotal).toLocaleString('ru-RU') + ' ₽'
            });
          }
          break;
        }

        case 'contracts': {
          const expiringContracts = await db.query(`
            SELECT COUNT(*) as cnt FROM contracts
            WHERE status = 'active' AND end_date IS NOT NULL
              AND end_date <= CURRENT_DATE + INTERVAL '30 days' AND end_date > CURRENT_DATE
          `);
          const cntContr = parseInt(expiringContracts.rows[0]?.cnt) || 0;
          if (cntContr > 0) {
            hints.push({
              id: 'contracts_expiring', type: 'warning', icon: '📄',
              text: cntContr + ' контрактов истекают в ближайшие 30 дней'
            });
          }
          break;
        }

        case 'customers': {
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
              text: dormCnt + ' клиентов без новых тендеров более 90 дней'
            });
          }
          break;
        }

        case 'warehouse':
        case 'my-equipment': {
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
              text: eqCnt + ' единиц оборудования списываются в ближайшие 60 дней'
            });
          }
          break;
        }

        case 'dashboard':
        case 'my-dashboard': {
          const myTasks = await db.query(`
            SELECT COUNT(*) as cnt FROM tasks
            WHERE status NOT IN ('done','cancelled') AND assignee_id = $1
          `, [userId]);
          const taskCnt = parseInt(myTasks.rows[0]?.cnt) || 0;
          if (taskCnt > 0) {
            hints.push({
              id: 'my_tasks', type: 'info', icon: '✅',
              text: 'У вас ' + taskCnt + ' активных задач', link: '#/tasks'
            });
          }
          break;
        }

        case 'pass-requests': {
          const pending = await db.query(`
            SELECT COUNT(*) as cnt FROM pass_requests WHERE status IN ('new','pending','in_progress')
          `);
          const pendCnt = parseInt(pending.rows[0]?.cnt) || 0;
          if (pendCnt > 0) {
            hints.push({
              id: 'pass_pending', type: 'info', icon: '🎫',
              text: pendCnt + ' заявок на пропуска в обработке'
            });
          }
          break;
        }

        case 'calendar': {
          const today = await db.query(`
            SELECT COUNT(*) as cnt FROM calendar_events
            WHERE date = CURRENT_DATE OR (date <= CURRENT_DATE AND end_date >= CURRENT_DATE)
          `);
          const todayCnt = parseInt(today.rows[0]?.cnt) || 0;
          if (todayCnt > 0) {
            hints.push({
              id: 'today_events', type: 'info', icon: '📅',
              text: todayCnt + ' событий на сегодня'
            });
          }
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
                text: draftCnt + ' ведомостей в статусе черновик/на согласовании'
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
                text: overdueCnt + ' просроченных задач'
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
                text: unaCnt + ' задач без исполнителя'
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
              WHERE (remind_at <= CURRENT_TIMESTAMP OR remind_at::date = CURRENT_DATE)
                AND status NOT IN ('done','dismissed')
            `);
            const remCnt = parseInt(todayReminders.rows[0]?.cnt) || 0;
            if (remCnt > 0) {
              hints.push({
                id: 'reminders_today', type: 'warning', icon: '🔔',
                text: remCnt + ' напоминаний на сегодня/просрочено'
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
                text: nrCnt + ' активных сотрудников без оценки'
              });
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
              SELECT COUNT(*) as cnt FROM collections
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
              SELECT COUNT(*) as cnt FROM training_requests
              WHERE status IN ('pending','new')
            `);
            const trCnt = parseInt(pendingTraining.rows[0]?.cnt) || 0;
            if (trCnt > 0) {
              hints.push({
                id: 'training_pending', type: 'info', icon: '🎓',
                text: trCnt + ' заявок на обучение ожидают рассмотрения'
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
              SELECT COUNT(*) as cnt FROM travel_requests
              WHERE status NOT IN ('closed','cancelled','completed')
            `);
            const tvCnt = parseInt(openTravel.rows[0]?.cnt) || 0;
            if (tvCnt > 0) {
              hints.push({
                id: 'travel_open', type: 'info', icon: '✈️',
                text: tvCnt + ' незакрытых командировок'
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
              WHERE direction = 'incoming' AND reply_date IS NULL AND status != 'cancelled'
            `);
            const nrCnt = parseInt(noReply.rows[0]?.cnt) || 0;
            if (nrCnt > 0) {
              hints.push({
                id: 'correspondence_no_reply', type: 'warning', icon: '📨',
                text: nrCnt + ' входящих писем без ответа'
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
              WHERE status = 'issued'
                AND issued_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
            `);
            const sCnt = parseInt(overdueSeals.rows[0]?.cnt) || 0;
            if (sCnt > 0) {
              hints.push({
                id: 'seals_overdue', type: 'warning', icon: '🔏',
                text: sCnt + ' печатей выданы более 30 дней назад и не возвращены'
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
                AND valid_until <= CURRENT_DATE + INTERVAL '30 days'
                AND valid_until > CURRENT_DATE
            `);
            const pCnt = parseInt(expiringProxies.rows[0]?.cnt) || 0;
            if (pCnt > 0) {
              hints.push({
                id: 'proxies_expiring', type: 'warning', icon: '📜',
                text: pCnt + ' доверенностей истекают в ближайшие 30 дней'
              });
            }
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
              WHERE status IN ('pending','new','on_approval')
            `);
            const oeCnt = parseInt(pendingExp.rows[0]?.cnt) || 0;
            if (oeCnt > 0) {
              hints.push({
                id: 'office_expenses_pending', type: 'info', icon: '🧾',
                text: oeCnt + ' расходов ожидают согласования'
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
                text: prCnt + ' заявок на закупку ожидают обработки'
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
                  SELECT DISTINCT employee_id FROM schedules
                  WHERE period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE
                )
            `);
            const nsCnt = parseInt(noSchedule.rows[0]?.cnt) || 0;
            if (nsCnt > 0) {
              hints.push({
                id: 'schedule_missing', type: 'info', icon: '📆',
                text: nsCnt + ' сотрудников без расписания на текущий период'
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
                text: pcCnt + ' расчётов ожидают согласования'
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
              SELECT COUNT(*) as cnt FROM call_records
              WHERE direction = 'incoming' AND status = 'missed'
                AND created_at::date = CURRENT_DATE
            `);
            const mcCnt = parseInt(missedCalls.rows[0]?.cnt) || 0;
            if (mcCnt > 0) {
              hints.push({
                id: 'telephony_missed', type: 'warning', icon: '📞',
                text: mcCnt + ' пропущенных звонков сегодня'
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
              WHERE recipient_id = $1 AND read_at IS NULL
            `, [userId]);
            const urCnt = parseInt(unread.rows[0]?.cnt) || 0;
            if (urCnt > 0) {
              hints.push({
                id: 'chat_unread', type: 'info', icon: '💬',
                text: urCnt + ' непрочитанных сообщений'
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
              SELECT COUNT(*) as cnt FROM mailbox
              WHERE status IN ('new','unread') AND (assignee_id IS NULL OR assignee_id = $1)
            `, [userId]);
            const upCnt = parseInt(unprocessed.rows[0]?.cnt) || 0;
            if (upCnt > 0) {
              hints.push({
                id: 'mailbox_unprocessed', type: 'info', icon: '📬',
                text: upCnt + ' необработанных входящих'
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
              SELECT COUNT(*) as cnt FROM approvals
              WHERE status IN ('pending','new')
                AND (approver_id = $1 OR approver_id IS NULL)
            `, [userId]);
            const apCnt = parseInt(pendingApprovals.rows[0]?.cnt) || 0;
            if (apCnt > 0) {
              hints.push({
                id: 'approvals_pending', type: 'warning', icon: '✍️',
                text: apCnt + ' документов ожидают вашего согласования',
                link: '#/approvals?filter=pending'
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
                text: crCnt + ' заявок на выдачу денег на ' + Math.round(crTotal).toLocaleString('ru-RU') + ' ₽'
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
                text: ppCnt + ' заявок на допуски в обработке'
              });
            }
          } catch (_) {}
          break;
        }

      } // end switch

    } catch (e) {
      fastify.log.warn('Hints error page=' + page + ':', e.message);
    }

    return { hints };
  });
}

module.exports = hintsRoutes;
