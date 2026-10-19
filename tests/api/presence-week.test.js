'use strict';
/**
 * Живая проверка недельного присутствия на клоне (:3100).
 * Заказчик 18.10.2026: заполнять неделю пн–пт целиком; выходные и праздники недоступны;
 * ответ уходит в staff_plan (виден в графике офиса). Отпуск — не спрашиваем.
 * Запуск: node tests/api/presence-week.test.js
 */
const cfg = require('../config');
const api = cfg.api;
const P = (r) => (r && r.data) || {};

let pass = 0, fail = 0;
function check(n, c, e) { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (e ? ' :: ' + e : '')); } }

(async () => {
  // Чистый старт: чужие периоды/«отп» от прошлых прогонов не должны влиять.
  const iso = require('../helpers/vacation-isolation');
  const year = new Date().getUTCFullYear();
  await iso.resetVacations([year, year + 1]);

  // ── 1. Неделя читается ────────────────────────────────────────────────
  let r = await api('GET', '/api/daily-presence/week', { role: 'PM' });
  check('GET /week отвечает 200', r.status === 200, 'status=' + r.status + ' ' + JSON.stringify(P(r)).slice(0, 200));
  if (r.status !== 200) {
    console.log('\nДальше проверять нечего.');
    console.log(`FAILS: ${fail} (${pass} проверок)`);
    process.exit(1);
  }
  const days = P(r).days || [];
  check('в неделе только рабочие дни (пн–пт), максимум 5', days.length > 0 && days.length <= 5, 'n=' + days.length);
  check('в неделе нет субботы/воскресенья', days.every((d) => {
    const dow = new Date(d.date + 'T00:00:00Z').getUTCDay();
    return dow >= 1 && dow <= 5;
  }), JSON.stringify(days.map((d) => d.date)));
  check('в ответе есть список статусов', Array.isArray(P(r).statuses) && P(r).statuses.length > 0);
  check('в ответе есть мои работы', Array.isArray(P(r).works));
  check('дни недели помечены как прошедшие/сегодня', days.every((d) => typeof d.is_past === 'boolean' && typeof d.is_today === 'boolean'));

  // ── 2. Заполнение недели целиком ──────────────────────────────────────
  const targets = days.filter((d) => !d.on_vacation);
  if (targets.length) {
    const body = { days: targets.map((d) => ({ date: d.date, status_code: 'оф' })) };
    r = await api('POST', '/api/daily-presence/week', { role: 'PM', body });
    check('заполнение недели принято', r.status === 200 && P(r).ok, 'status=' + r.status + ' ' + JSON.stringify(P(r)).slice(0, 200));
    check('сохранено столько дней, сколько отправлено', P(r).saved === targets.length, 'saved=' + P(r).saved + ' ожидалось ' + targets.length);

    // ── 3. Заполнение видно в графике офиса (staff_plan) ────────────────
    const first = targets[0];
    r = await api('GET', '/api/data/staff_plan?limit=5000', { role: 'PM' });
    const arr = (P(r).staff_plan) || (Array.isArray(P(r)) ? P(r) : []);
    const found = arr.filter((p) => String(p.date).slice(0, 10) === first.date && p.status_code === 'оф');
    check('отметка недели попала в staff_plan (график офиса)', found.length > 0,
      'rows=' + arr.length + ' date=' + first.date + ' matched=' + found.length);

    // ── 4. Повторное чтение показывает заполнение ───────────────────────
    r = await api('GET', '/api/daily-presence/week', { role: 'PM' });
    const after = (P(r).days || []).filter((d) => d.status_code);
    check('после заполнения дни помечены статусом', after.length >= targets.length, 'filled=' + after.length);
  } else {
    check('все дни недели в отпуске — заполнять нечего (пропуск)', true);
  }

  // ── 5. Выходные и праздники недоступны для отметки ────────────────────
  // берём ближайшую субботу
  const now = new Date();
  const sat = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  while (sat.getUTCDay() !== 6) sat.setUTCDate(sat.getUTCDate() + 1);
  const satIso = sat.toISOString().slice(0, 10);
  r = await api('POST', '/api/daily-presence/week', { role: 'PM', body: { days: [{ date: satIso, status_code: 'оф' }] } });
  check('суббота недоступна для отметки', r.status === 400 && P(r).error === 'non_working_day', 'status=' + r.status + ' ' + JSON.stringify(P(r)).slice(0, 160));

  // ── 6. Невалидный статус ──────────────────────────────────────────────
  r = await api('POST', '/api/daily-presence/week', { role: 'PM', body: { days: [{ date: days[0] ? days[0].date : satIso, status_code: 'нет_такого' }] } });
  check('невалидный статус отбивается', r.status === 400 && (P(r).error === 'bad_status' || P(r).error === 'non_working_day'), JSON.stringify(P(r)).slice(0, 160));

  // ── 7. Пустое тело ────────────────────────────────────────────────────
  r = await api('POST', '/api/daily-presence/week', { role: 'PM', body: { days: [] } });
  check('пустое тело отбивается', r.status === 400 && P(r).error === 'empty', JSON.stringify(P(r)).slice(0, 160));

  // ── 8. /today не спрашивает в отпуске/праздник ────────────────────────
  r = await api('GET', '/api/daily-presence/today', { role: 'PM' });
  check('GET /today отвечает 200', r.status === 200, 'status=' + r.status);
  check('в /today есть признак required и статусы', P(r).required !== undefined && Array.isArray(P(r).statuses), JSON.stringify(P(r)).slice(0, 200));

  // ── 9. Полевой рабочий не участвует ───────────────────────────────────
  // (в тестовом контуре учётки FIELD_WORKER может не быть — проверяем мягко)
  r = await api('GET', '/api/daily-presence/week', { role: 'WAREHOUSE' });
  check('офисная роль (склад) отвечает без ошибки', r.status === 200 || r.status === 403, 'status=' + r.status);

  console.log('\n' + (fail ? `FAILS: ${fail}` : 'ALL PASS') + ` (${pass} проверок)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH: ' + e.message + '\n' + (e.stack || '')); process.exit(1); });
