'use strict';

/**
 * Тесты единого дайджеста по тендерам.
 *
 * ── Что защищаем ───────────────────────────────────────────────────────────
 * Дайджест существует, чтобы НЕ спамить: одно письмо утром, одно вечером,
 * ночью — ничего. Поэтому главные проверки — про ВРЕМЯ и ДЕДУП:
 *   • ночь и выходные → отправка запрещена;
 *   • рабочее время вне окон → запрещена, кроме срочного;
 *   • окна 09:00–10:00 и 17:00–18:00 МСК → разрешена;
 *   • одно событие не попадает в дайджест дважды.
 *
 * Часовой пояс фиксирован (UTC+3): сервер живёт в UTC, и без пересчёта
 * «9 утра» означало бы полдень по Москве.
 */

const assert = require('assert');
const path = require('path');

const digest = require(path.join(__dirname, '..', 'src', 'services', 'tender-digest.js'));

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('FAIL ' + name + ' — ' + e.message);
  }
}

/** Собирает Date так, чтобы в Москве было указанное время. */
function msk(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0));
}

// ── Часовой пояс ───────────────────────────────────────────────────────────
check('московское время считается от UTC+3', () => {
  // 06:00 UTC = 09:00 МСК.
  const ts = digest.moscowNow(new Date(Date.UTC(2026, 10, 9, 6, 0, 0)));
  assert.strictEqual(ts.hour, 9, 'час должен быть 9, получено ' + ts.hour);
  assert.strictEqual(ts.day, 9);
});

// ── Окна отправки ──────────────────────────────────────────────────────────
check('утреннее окно 09:00–10:00 разрешает отправку', () => {
  const r = digest.canSendNow(msk(2026, 11, 9, 9, 30));
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.window, 'morning');
});

check('вечернее окно 17:00–18:00 разрешает отправку', () => {
  const r = digest.canSendNow(msk(2026, 11, 9, 17, 30));
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.window, 'evening');
});

check('ночью отправка запрещена', () => {
  for (const h of [0, 3, 6, 7, 8, 23]) {
    const r = digest.canSendNow(msk(2026, 11, 9, h, 30));
    assert.strictEqual(r.allowed, false, 'в ' + h + ':30 отправка разрешена');
  }
});

check('рабочее время вне окон — запрещено без срочности', () => {
  const r = digest.canSendNow(msk(2026, 11, 9, 13, 0));
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.window, 'work');
});

check('срочный дедлайн в рабочее время — разрешено', () => {
  const r = digest.canSendNow(msk(2026, 11, 9, 13, 0), { urgent: true });
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.window, 'urgent');
});

check('срочный дедлайн НОЧЬЮ всё равно запрещён', () => {
  const r = digest.canSendNow(msk(2026, 11, 9, 2, 0), { urgent: true });
  assert.strictEqual(r.allowed, false, 'ночью срочность не оправдывает отправку');
});

check('в выходные отправка запрещена', () => {
  // 7 ноября 2026 — суббота, 8-е — воскресенье.
  const sat = digest.canSendNow(msk(2026, 11, 7, 9, 30));
  const sun = digest.canSendNow(msk(2026, 11, 8, 9, 30));
  assert.strictEqual(sat.allowed, false, 'суббота');
  assert.strictEqual(sun.allowed, false, 'воскресенье');
});

// ── Дедупликация ───────────────────────────────────────────────────────────
check('ключ события стабилен и различает события', () => {
  const a = digest.eventKey({ kind: 'analysis', tender_id: 2138 });
  const b = digest.eventKey({ kind: 'analysis', tender_id: 2138 });
  const c = digest.eventKey({ kind: 'analysis', tender_id: 2146 });
  assert.strictEqual(a, b, 'один ключ для одного события');
  assert.notStrictEqual(a, c, 'разные тендеры — разные ключи');
});

check('разные виды события — разные ключи', () => {
  const a = digest.eventKey({ kind: 'analysis', tender_id: 1 });
  const b = digest.eventKey({ kind: 'deadline', tender_id: 1 });
  assert.notStrictEqual(a, b);
});

// ── Группировка ────────────────────────────────────────────────────────────
check('горящие дедлайны идут первыми, срочные внутри — сверху', () => {
  const groups = digest.groupEvents([
    { kind: 'calc', tender_id: 1, title: 'Просчёт' },
    { kind: 'deadline', tender_id: 2, title: 'Не срочно', deadline: '2026-11-20' },
    { kind: 'deadline', tender_id: 3, title: 'Срочно', urgent: true, deadline: '2026-11-10' }
  ]);
  assert.strictEqual(groups[0].kind, 'deadline', 'первый раздел — дедлайны');
  assert.strictEqual(groups[0].items[0].title, 'Срочно', 'срочное сверху');
});

check('незнакомый вид события не теряется', () => {
  const groups = digest.groupEvents([{ kind: 'unknown_kind', tender_id: 1, title: 'Что-то' }]);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].title, 'Прочее');
});

// ── Письмо ─────────────────────────────────────────────────────────────────
check('тема письма отражает срочность и количество', () => {
  const events = [
    { kind: 'deadline', tender_id: 1, title: 'A', urgent: true },
    { kind: 'calc', tender_id: 2, title: 'B' }
  ];
  const subject = digest.buildSubject(events, 'morning');
  assert.ok(subject.includes('срочно: 1'), 'нет счётчика срочных: ' + subject);
  assert.ok(subject.includes('всего: 2'), 'нет общего счётчика: ' + subject);
});

check('HTML содержит разделы и позиции', () => {
  const html = digest.buildHtml([
    { kind: 'deadline', tender_id: 1, registry_no: '2138', title: 'Очистка', urgent: true }
  ], { window: 'morning' });
  assert.ok(html.includes('ГОРЯТ ДЕДЛАЙНЫ'), 'нет раздела дедлайнов');
  assert.ok(html.includes('2138'), 'нет номера тендера');
  assert.ok(html.includes('СРОЧНО'), 'нет пометки срочности');
  assert.ok(html.includes('Очистка'), 'нет названия');
});

check('пустой дайджест не падает', () => {
  const html = digest.buildHtml([], { window: 'morning' });
  assert.ok(html.includes('Событий нет'));
  assert.strictEqual(digest.buildText([], {}).includes('Событий: 0'), true);
});

check('текстовая версия содержит те же позиции', () => {
  const text = digest.buildText([
    { kind: 'analysis', tender_id: 5, registry_no: '2158', title: 'Гидрочистка' }
  ], { window: 'evening' });
  assert.ok(text.includes('2158'), 'нет номера');
  assert.ok(text.includes('Гидрочистка'), 'нет названия');
  assert.ok(/итоги дня/i.test(text), 'нет заголовка вечера');
});

check('границы окон: 10:00 и 18:00 — уже НЕ окно', () => {
  // Дефект: тесты не проверяли сами границы, и замена `<` на `<=`
  // прошла бы незамеченной (найдено верификатором).
  assert.strictEqual(digest.canSendNow(msk(2026, 11, 9, 9, 0)).allowed, true, '09:00 — начало утра');
  assert.strictEqual(digest.canSendNow(msk(2026, 11, 9, 10, 0)).allowed, false, '10:00 — уже не окно');
  assert.strictEqual(digest.canSendNow(msk(2026, 11, 9, 17, 0)).allowed, true, '17:00 — начало вечера');
  assert.strictEqual(digest.canSendNow(msk(2026, 11, 9, 18, 0)).allowed, false, '18:00 — уже не окно');
});

check('рабочие часы: 08:59 и 18:00 — вне', () => {
  assert.strictEqual(digest.canSendNow(msk(2026, 11, 9, 8, 59)).allowed, false);
  assert.strictEqual(digest.canSendNow(msk(2026, 11, 9, 18, 0), { urgent: true }).allowed, false);
});

check('срочность по дедлайну: меньше суток', () => {
  const now = msk(2026, 11, 9, 10, 0);
  // 12 часов вперёд — срочно.
  const soon = new Date(now.getTime() + 12 * 3600 * 1000);
  // 3 дня вперёд — не срочно.
  const later = new Date(now.getTime() + 72 * 3600 * 1000);
  // Просрочен — срочно.
  const past = new Date(now.getTime() - 3600 * 1000);
  assert.strictEqual(digest.isUrgentDeadline(soon.toISOString(), now), true, '12 часов — срочно');
  assert.strictEqual(digest.isUrgentDeadline(later.toISOString(), now), false, '3 дня — не срочно');
  assert.strictEqual(digest.isUrgentDeadline(past.toISOString(), now), true, 'просрочен — срочно');
  assert.strictEqual(digest.isUrgentDeadline(null, now), false, 'нет дедлайна — не срочно');
});

check('nextWindow возвращает НАЧАЛО окна, а не текущую минуту', () => {
  // Дефект: при now=09:04 возвращалось «09:04», при 09:06 — «17:01».
  const a = digest.nextWindow(msk(2026, 11, 9, 9, 4));
  assert.ok(a.at && a.at.endsWith('17:00'), 'в 09:04 должно быть вечернее окно 17:00, а не ' + a.at);
  const b = digest.nextWindow(msk(2026, 11, 9, 8, 0));
  assert.ok(b.at && b.at.endsWith('09:00'), 'в 08:00 должно быть утреннее 09:00, а не ' + b.at);
  // Из пятницы вечером — понедельник утром.
  const fri = digest.nextWindow(msk(2026, 11, 13, 19, 0));
  assert.ok(fri.at && fri.at.endsWith('09:00'), 'в пятницу вечером — утро понедельника');
});

check('nextWindow принимает дату строкой', () => {
  // Дефект: строка молча игнорировалась, подставлялось текущее время.
  const r = digest.nextWindow('2026-11-09T08:00:00+03:00');
  assert.ok(r.at && r.at.includes('2026-11-09'), 'строка не разобрана: ' + r.at);
});

  check('в письме русская дата, а не сырой объект Date', () => {
    // Владелец 09.11.2026 получил «Срок: Fri Dec 31 2027 00:00:00 GMT+0300
    // (Moscow Standard Time)» — в HTML уходил String(Date).
    const ev = [{
      kind: 'reminder', tender_id: 1240, registry_no: '457',
      title: 'Зачистка резервуаров',
      deadline: new Date('2027-12-31T00:00:00+03:00')
    }];
    const html = digest.buildHtml(ev, { window: 'evening' });
    assert.ok(!/GMT|Moscow Standard|00:00:00/.test(html), 'в HTML попал сырой Date');
    assert.ok(/31\.12\.2027/.test(html), 'нет русской даты 31.12.2027');

    const text = digest.buildText(ev, { window: 'evening' });
    assert.ok(!/GMT|Moscow Standard/.test(text), 'в тексте сырой Date');
    assert.ok(/31\.12\.2027/.test(text), 'нет даты в текстовой версии');
  });

  check('срок словами: осталось / просрочен', () => {
    const now = new Date('2026-11-09T12:00:00+03:00');
    const y = digest.daysLeft(new Date('2027-12-31T00:00:00+03:00'), now);
    assert.ok(/осталось/.test(y.text), 'нет «осталось» для далёкого срока: ' + y.text);
    const over = digest.daysLeft(new Date('2026-08-06T00:00:00+03:00'), now);
    assert.ok(/просрочен/.test(over.text), 'просрочка не распознана: ' + over.text);
    assert.strictEqual(over.tone, 'over');
    const today = digest.daysLeft(new Date('2026-11-09T00:00:00+03:00'), now);
    assert.ok(/сегодня/.test(today.text), 'срок сегодня не распознан: ' + today.text);
  });

  check('виды крона попадают в понятные разделы, а не в «Прочее»', () => {
    // Крон ставит analysis_idle / analysis_deadline / analysis_overdue,
    // а разделы назывались deadline/analysis/calc/stale → всё падало
    // в безымянное «Прочее».
    const ev = [
      { kind: 'analysis_idle', tender_id: 1, title: 'A' },
      { kind: 'analysis_deadline', tender_id: 2, title: 'B' },
      { kind: 'analysis_overdue', tender_id: 3, title: 'C' }
    ];
    const groups = digest.groupEvents(ev);
    const titles = groups.map((g) => g.title);
    assert.ok(!titles.includes('Прочее'), 'события ушли в «Прочее»: ' + titles.join(','));
    assert.ok(titles.includes('Без движения'), 'analysis_idle не стал «Без движения»');
    assert.ok(titles.includes('Горят дедлайны'), 'дедлайны не попали в свою группу');
  });

  check('шапка письма показывает счётчики', () => {
    const ev = [
      { kind: 'reminder', tender_id: 1, title: 'A', urgent: true,
        deadline: new Date('2026-11-09T00:00:00+03:00') },
      { kind: 'reminder', tender_id: 2, title: 'B',
        deadline: new Date('2026-08-01T00:00:00+03:00') }
    ];
    const html = digest.buildHtml(ev, { window: 'morning', generatedAt: new Date('2026-11-09T12:00:00+03:00') });
    assert.ok(/Событий/.test(html) && /Срочных/.test(html) && /Просрочено/.test(html),
      'нет счётчиков в шапке');
  });

  const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
