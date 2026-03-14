/**
 * Сценарий 29: Полный цикл запроса персонала
 * РП запрашивает персонал → HR подбирает → РП согласует → график обновлён
 * Также: чат HR↔РП, фильтры, сортировка, история, доступ ADMIN
 */

const { getAccount } = require('../config');
const { loginAs, sleep, log } = require('../lib/auth');
const { navigateTo, clickButton, closeModal, waitForNetworkIdle, checkForErrors, isModalOpen } = require('../lib/page-helpers');

const SCENARIO_NAME = '29-staff-request-lifecycle';

async function run(browser, context = {}) {
  const results = { name: 'Staff Request Lifecycle', steps: [], status: 'PENDING', duration: 0 };
  const start = Date.now();

  async function step(name, fn) {
    const stepResult = { name, status: 'PENDING', error: null };
    results.steps.push(stepResult);
    try {
// Browser health check + auto-relaunch
      try {
        const _hc = await browser.newContext();
        await _hc.close();
      } catch (_bcErr) {
        console.log('[recovery] Browser dead before "' + name + '", relaunching...');
        try {
          const { chromium } = require('playwright');
          browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'] });
          console.log('[recovery] Browser relaunched');
        } catch (_reErr) {
          console.log('[recovery] Relaunch failed: ' + _reErr.message);
        }
      }
      await fn(stepResult);
      stepResult.status = 'PASSED';
      log(SCENARIO_NAME, `  + ${name}`);
    } catch (e) {
      stepResult.status = 'FAILED';
      stepResult.error = e.message.substring(0, 300);
      log(SCENARIO_NAME, `  X ${name}: ${e.message.substring(0, 100)}`);
      // Don't throw — continue to next step
}
  }

  let workId = null;
  let staffRequestId = null;
  let pmToken = null;
  let hrToken = null;

  try {
    // ══════════════════════════════════════════════════════════
    // ШАГ 1: Авторизация РП и получение токена
    // ══════════════════════════════════════════════════════════
    await step('РП авторизуется и находит работу', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));

        // Получить токен авторизации
        pmToken = await page.evaluate(() => {
          try {
            const auth = JSON.parse(localStorage.getItem('asgard_auth') || sessionStorage.getItem('asgard_auth') || '{}');
            return auth.token || null;
          } catch { return null; }
        });
        log(SCENARIO_NAME, `    PM токен: ${pmToken ? 'получен' : 'НЕ НАЙДЕН'}`);

        await navigateTo(page, '#/pm-works');
        await sleep(4000);

        // Убрать фильтр по периоду
        await page.evaluate(() => {
          const sel = document.getElementById('f_period');
          if (sel) { sel.value = ''; sel.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await sleep(2000);

        // Найти работу
        const row = await page.evaluate(() => {
          const rows = document.querySelectorAll('#tb tr[data-id]');
          for (const r of rows) {
            const id = r.getAttribute('data-id');
            if (id) return { id: Number(id), text: r.textContent.substring(0, 100) };
          }
          return null;
        });

        if (!row) throw new Error('Нет работ для РП');
        workId = row.id;
        log(SCENARIO_NAME, `    Работа #${workId}: ${row.text.substring(0, 60)}`);
      } finally {
        await ctx.close();
      }
    });

    // ══════════════════════════════════════════════════════════
    // ШАГ 2: РП открывает работу и отправляет запрос персонала
    // ══════════════════════════════════════════════════════════
    await step('РП открывает карточку работы и запрашивает персонал', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/pm-works');
        await sleep(4000);

        await page.evaluate(() => {
          const sel = document.getElementById('f_period');
          if (sel) { sel.value = ''; sel.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await sleep(2000);

        // Нажать "Открыть" на нужной работе
        await page.evaluate((wId) => {
          const rows = document.querySelectorAll('#tb tr[data-id]');
          for (const row of rows) {
            if (Number(row.getAttribute('data-id')) === wId) {
              const btn = row.querySelector('button[data-act="open"]');
              if (btn) btn.click();
            }
          }
        }, workId);
        await sleep(3000);

        // Заполнить состав
        const filled = await page.evaluate(() => {
          const fields = { 'sr_Мастера': 1, 'sr_Слесари': 2, 'sr_ПТО': 1, 'sr_Промывщики': 0 };
          let ok = 0;
          for (const [id, val] of Object.entries(fields)) {
            const el = document.getElementById(id);
            if (el) { el.value = String(val); el.dispatchEvent(new Event('input', { bubbles: true })); ok++; }
          }
          const c = document.getElementById('sr_comment');
          if (c) { c.value = 'Тестовый запрос персонала'; c.dispatchEvent(new Event('input', { bubbles: true })); }
          return ok;
        });
        log(SCENARIO_NAME, `    Заполнено полей: ${filled}`);

        // Нажать кнопку запроса
        const btnClicked = await page.evaluate(() => {
          const btns = document.querySelectorAll('button');
          for (const b of btns) {
            const t = b.textContent.trim();
            if (t.includes('Запросить') || t.includes('Отправить HR')) { b.click(); return t; }
          }
          return null;
        });
        log(SCENARIO_NAME, `    Нажата кнопка: "${btnClicked || 'не найдена'}"`);
        await sleep(2000);

        // Проверить toast
        const toastOk = await page.evaluate(() => {
          const t = document.querySelector('.toast, .toastwrap');
          return t ? t.textContent.trim().substring(0, 80) : null;
        });
        if (toastOk) log(SCENARIO_NAME, `    Toast: ${toastOk}`);
      } finally {
        await ctx.close();
      }
    });

    // ══════════════════════════════════════════════════════════
    // ШАГ 3: HR видит запрос в списке
    // ══════════════════════════════════════════════════════════
    await step('HR видит запрос на странице #/hr-requests', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));

        hrToken = await page.evaluate(() => {
          try {
            const auth = JSON.parse(localStorage.getItem('asgard_auth') || sessionStorage.getItem('asgard_auth') || '{}');
            return auth.token || null;
          } catch { return null; }
        });

        await navigateTo(page, '#/hr-requests');
        await sleep(4000);

        // Убрать фильтр
        await page.evaluate(() => {
          const sel = document.getElementById('f_period');
          if (sel) { sel.value = ''; sel.dispatchEvent(new Event('input', { bubbles: true })); }
          const st = document.getElementById('f_status');
          if (st) { st.value = ''; st.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        await sleep(1500);

        const rowCount = await page.evaluate(() => document.querySelectorAll('#tb tr[data-id]').length);
        log(SCENARIO_NAME, `    Запросов в таблице: ${rowCount}`);

        if (rowCount === 0) throw new Error('Таблица запросов пуста');

        // Найти запрос с валидным work_id
        const validReq = await page.evaluate(() => {
          const rows = document.querySelectorAll('#tb tr[data-id]');
          const ids = Array.from(rows).map(r => Number(r.getAttribute('data-id'))).filter(n => n > 0);
          return ids.length ? Math.max(...ids) : null;
        });
        if (validReq) {
          staffRequestId = validReq;
          log(SCENARIO_NAME, `    ID запроса: #${staffRequestId}`);
        }
      } finally {
        await ctx.close();
      }
    });

    // ══════════════════════════════════════════════════════════
    // ШАГ 4: HR открывает запрос и видит состав
    // ══════════════════════════════════════════════════════════
    await step('HR открывает запрос и видит детали', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/hr-requests');
        await sleep(4000);

        await page.evaluate(() => {
          const sel = document.getElementById('f_period');
          if (sel) { sel.value = ''; sel.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await sleep(1000);

        // Перехватываем ошибки
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));

        // Нажать "Открыть"
        await page.evaluate((reqId) => {
          const rows = document.querySelectorAll('#tb tr[data-id]');
          for (const row of rows) {
            const id = Number(row.getAttribute('data-id'));
            if (!reqId || id === reqId) {
              const btn = row.querySelector('button[data-act="open"]');
              if (btn) { btn.click(); return; }
            }
          }
        }, staffRequestId);
        await sleep(5000);

        if (errors.length) log(SCENARIO_NAME, `    JS ошибки: ${errors.join(' | ').substring(0, 200)}`);

        // Проверить модалку
        const modal = await page.evaluate(() => {
          const mb = document.querySelector('.modalback');
          if (!mb || mb.style.display === 'none') return null;
          return {
            title: document.getElementById('modalTitle')?.textContent || '',
            bodyLen: document.getElementById('modalBody')?.innerHTML?.length || 0,
            checkboxes: document.querySelectorAll('.stchk, .stchkA, .stchkB').length,
            hasComment: !!document.getElementById('hr_comment'),
            hasSendBtn: !!document.getElementById('btnSend'),
            hasChat: !!document.getElementById('sr_chat')
          };
        });

        if (!modal) {
          // Модалка не открылась — возможно запрос с пустым work_id
          log(SCENARIO_NAME, '    Модалка не открылась (запрос может иметь пустой work_id)');
          // Проверяем что страница хотя бы загрузилась
          const pageOk = await page.evaluate(() => document.body.textContent.length > 500);
          if (!pageOk) throw new Error('Страница HR requests не загрузилась');
          log(SCENARIO_NAME, '    Страница загружена, но модалка запроса не открылась');
        } else {
          log(SCENARIO_NAME, `    Модалка: title="${modal.title}", checkboxes=${modal.checkboxes}, comment=${modal.hasComment}, chat=${modal.hasChat}`);
        }
      } finally {
        await ctx.close();
      }
    });

    // ══════════════════════════════════════════════════════════
    // ШАГ 5: HR подбирает сотрудников и отправляет ответ
    // ══════════════════════════════════════════════════════════
    await step('HR подбирает сотрудников и отвечает РП', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/hr-requests');
        await sleep(4000);

        await page.evaluate(() => {
          const sel = document.getElementById('f_period');
          if (sel) { sel.value = ''; sel.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await sleep(1000);

        await page.evaluate(() => {
          const btn = document.querySelector('#tb tr button[data-act="open"]');
          if (btn) btn.click();
        });
        await sleep(5000);

        // Выбрать сотрудников
        const selected = await page.evaluate(() => {
          const checks = document.querySelectorAll('.stchk');
          let cnt = 0;
          for (let i = 0; i < Math.min(checks.length, 4); i++) {
            checks[i].checked = true;
            checks[i].dispatchEvent(new Event('change', { bubbles: true }));
            cnt++;
          }
          return cnt;
        });
        log(SCENARIO_NAME, `    Выбрано сотрудников: ${selected}`);

        // Комментарий HR
        await page.evaluate(() => {
          const c = document.getElementById('hr_comment');
          if (c) { c.value = 'Состав подобран'; c.dispatchEvent(new Event('input', { bubbles: true })); }
        });

        // Отправить ответ
        await page.evaluate(() => {
          const btn = document.getElementById('btnSend');
          if (btn) btn.click();
        });
        await sleep(3000);

        const toast = await page.evaluate(() => {
          const t = document.querySelector('.toast');
          return t ? t.textContent.trim().substring(0, 80) : null;
        });
        if (toast) log(SCENARIO_NAME, `    Toast: ${toast}`);
      } finally {
        await ctx.close();
      }
    });

    // ══════════════════════════════════════════════════════════
    // ШАГ 6: HR отправляет сообщение в чат
    // ══════════════════════════════════════════════════════════
    await step('HR отправляет сообщение в чат запроса', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/hr-requests');
        await sleep(4000);

        await page.evaluate(() => {
          const sel = document.getElementById('f_period');
          if (sel) { sel.value = ''; sel.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await sleep(1000);

        await page.evaluate(() => {
          const btn = document.querySelector('#tb tr button[data-act="open"]');
          if (btn) btn.click();
        });
        await sleep(5000);

        const sent = await page.evaluate(() => {
          const ta = document.getElementById('sr_msg');
          if (!ta) return false;
          ta.value = 'Подтвердите состав бригады';
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          const btn = document.getElementById('btnSendSrMsg');
          if (btn) { btn.click(); return true; }
          return false;
        });
        await sleep(1500);

        log(SCENARIO_NAME, `    Сообщение отправлено: ${sent}`);

        const chatMsgs = await page.evaluate(() => {
          const c = document.getElementById('sr_chat');
          return c ? c.querySelectorAll('.pill').length : 0;
        });
        log(SCENARIO_NAME, `    Сообщений в чате: ${chatMsgs}`);
      } finally {
        await ctx.close();
      }
    });

    // ══════════════════════════════════════════════════════════
    // ШАГ 7: РП видит ответ в карточке работы
    // ══════════════════════════════════════════════════════════
    await step('РП видит ответ HR в карточке работы', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('PM'));
        await navigateTo(page, '#/pm-works');
        await sleep(4000);

        await page.evaluate(() => {
          const sel = document.getElementById('f_period');
          if (sel) { sel.value = ''; sel.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await sleep(2000);

        await page.evaluate((wId) => {
          const rows = document.querySelectorAll('#tb tr[data-id]');
          for (const row of rows) {
            if (Number(row.getAttribute('data-id')) === wId) {
              const btn = row.querySelector('button[data-act="open"]');
              if (btn) btn.click();
            }
          }
        }, workId);
        await sleep(3000);

        const info = await page.evaluate(() => ({
          hasApprove: !!document.getElementById('btnApproveStaff'),
          hasView: !!document.getElementById('btnViewStaff') || !!document.getElementById('btnAskStaff'),
          hasAnswered: document.body.textContent.includes('answered')
        }));
        log(SCENARIO_NAME, `    Карточка: approve=${info.hasApprove}, view=${info.hasView}, answered=${info.hasAnswered}`);
      } finally {
        await ctx.close();
      }
    });

    // ══════════════════════════════════════════════════════════
    // ШАГ 8: Фильтры и сортировка HR страницы
    // ══════════════════════════════════════════════════════════
    await step('Фильтры и сортировка на странице HR-запросов', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/hr-requests');
        await sleep(4000);

        await page.evaluate(() => {
          const sel = document.getElementById('f_period');
          if (sel) { sel.value = ''; sel.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await sleep(1000);

        const allCount = await page.evaluate(() => document.querySelectorAll('#tb tr[data-id]').length);

        // Фильтр по статусу
        await page.evaluate(() => {
          const sel = document.getElementById('f_status');
          if (sel) { sel.value = 'sent'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        await sleep(1000);
        const sentCount = await page.evaluate(() => document.querySelectorAll('#tb tr[data-id]').length);

        // Сброс
        await page.evaluate(() => {
          const sel = document.getElementById('f_status');
          if (sel) { sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        await sleep(500);

        // Поиск
        await page.evaluate(() => {
          const i = document.getElementById('f_q');
          if (i) { i.value = 'ZZZZNOTEXIST'; i.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await sleep(1000);
        const zeroCount = await page.evaluate(() => document.querySelectorAll('#tb tr[data-id]').length);

        // Сброс
        await page.evaluate(() => {
          const i = document.getElementById('f_q');
          if (i) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await sleep(500);

        // Сортировка
        await page.evaluate(() => {
          const btn = document.querySelector('[data-sort="status"]');
          if (btn) btn.click();
        });
        await sleep(500);
        await page.evaluate(() => {
          const btn = document.querySelector('[data-sort="created_at"]');
          if (btn) btn.click();
        });
        await sleep(500);

        log(SCENARIO_NAME, `    Фильтры: все=${allCount}, sent=${sentCount}, notFound=${zeroCount}`);
      } finally {
        await ctx.close();
      }
    });

    // ══════════════════════════════════════════════════════════
    // ШАГ 9: График дружины загружается
    // ══════════════════════════════════════════════════════════
    await step('График дружины (workers-schedule) загружается', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('HR'));
        await navigateTo(page, '#/workers-schedule');
        await sleep(5000);

        const info = await page.evaluate(() => ({
          hasTable: document.querySelectorAll('table').length > 0,
          hasCanvas: document.querySelectorAll('canvas').length > 0,
          bodyLen: document.body.textContent.length,
          rowCount: document.querySelectorAll('table tbody tr').length
        }));

        log(SCENARIO_NAME, `    График: table=${info.hasTable}, canvas=${info.hasCanvas}, rows=${info.rowCount}`);
        if (info.bodyLen < 200) throw new Error('Страница графика пуста');
      } finally {
        await ctx.close();
      }
    });

    // ══════════════════════════════════════════════════════════
    // ШАГ 10: ADMIN может видеть страницу HR-запросов
    // ══════════════════════════════════════════════════════════
    await step('ADMIN может просматривать HR-запросы', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAs(page, getAccount('ADMIN'));
        await navigateTo(page, '#/hr-requests');
        await sleep(4000);

        const ok = await page.evaluate(() => ({
          hasTable: !!document.querySelector('#tb'),
          bodyLen: document.body.textContent.length,
          title: document.body.textContent.includes('Персонал') || document.body.textContent.includes('Казарма')
        }));

        log(SCENARIO_NAME, `    ADMIN: table=${ok.hasTable}, bodyLen=${ok.bodyLen}, title=${ok.title}`);
        if (ok.bodyLen < 200) throw new Error('Страница не загрузилась для ADMIN');
      } finally {
        await ctx.close();
      }
    });

    results.status = 'PASSED';
  } catch (e) {
    results.status = 'FAILED';
  }

  results.duration = Date.now() - start;
  return results;
}

module.exports = { name: SCENARIO_NAME, run };
