'use strict';

/**
 * Тесты серверного учёта времени СРМ (crm-activity).
 * Чистые функции: без БД и сети.
 *
 * Запуск: npx jest tests/unit/crm-activity.test.js
 */

const crmActivity = require('../../src/services/crm-activity');

beforeEach(() => {
  crmActivity._reset();
});

describe('crm-activity: московское время', () => {
  test('минута считается в MSK (UTC+3), а не в UTC', () => {
    // 11:05 UTC = 14:05 MSK
    const m = crmActivity.mskMinute(Date.UTC(2026, 10, 3, 11, 5));
    expect(m.day).toBe('2026-11-03');
    expect(m.minute).toBe('2026-11-03T14:05');
  });

  test('минута после полуночи MSK попадает в следующий день', () => {
    // 22:30 UTC = 01:30 MSK следующего дня
    const m = crmActivity.mskMinute(Date.UTC(2026, 10, 3, 22, 30));
    expect(m.day).toBe('2026-11-04');
    expect(m.minute).toBe('2026-11-04T01:30');
  });
});

describe('crm-activity: шумные пути не считаются работой', () => {
  test('свой пульс присутствия исключён', () => {
    expect(crmActivity.isNoisePath('/api/daily-presence/heartbeat')).toBe(true);
  });

  test('SSE, пульс и подписка на пуш исключены', () => {
    expect(crmActivity.isNoisePath('/api/sse')).toBe(true);
    expect(crmActivity.isNoisePath('/api/events?since=5')).toBe(true);
    expect(crmActivity.isNoisePath('/api/push/subscribe')).toBe(true);
    expect(crmActivity.isNoisePath('/api/notifications/unread-count')).toBe(true);
  });

  test('чтение уведомлений и остальной пуш СЧИТАЮТСЯ', () => {
    // Верификатор 03.11.2026: широкие префиксы /api/notifications и /api/push
    // глушили 19 роутов, из которых стримом был один. Чтение уведомлений —
    // реальное действие человека.
    expect(crmActivity.isNoisePath('/api/notifications')).toBe(false);
    expect(crmActivity.isNoisePath('/api/notifications/5/read')).toBe(false);
    expect(crmActivity.isNoisePath('/api/push/test')).toBe(false);
  });

  test('рабочие ручки считаются', () => {
    expect(crmActivity.isNoisePath('/api/works/123')).toBe(false);
    expect(crmActivity.isNoisePath('/api/office-schedule')).toBe(false);
    expect(crmActivity.isNoisePath('/api/tenders?status=new')).toBe(false);
  });

  test('SSE-стримы не считаются работой (верификатор P2-5)', () => {
    // Открытый стрим держит соединение, но это не действие человека.
    expect(crmActivity.isNoisePath('/api/mimir/chat-stream')).toBe(true);
    expect(crmActivity.isNoisePath('/api/mimir/auto-estimate')).toBe(true);
    expect(crmActivity.isNoisePath('/api/mimir-conductor/conductor/events')).toBe(true);
    expect(crmActivity.isNoisePath('/api/tkp/12/autofill')).toBe(true);
    expect(crmActivity.isNoisePath('/api/tkp-quick/sessions/x/calculate')).toBe(true);
    expect(crmActivity.isNoisePath('/api/tkp-quick/sessions/x/chat')).toBe(true);
    expect(crmActivity.isNoisePath('/api/chat-groups/5/mimir-stream')).toBe(true);
    expect(crmActivity.isNoisePath('/api/admin-system/logs/stream')).toBe(true);
  });

  test('реальная работа в ТКП и чатах СЧИТАЕТСЯ (не глушится префиксом)', () => {
    // Верификатор 03.11.2026: первая версия шумового списка содержала
    // префиксы /api/tkp/, /api/tkp-quick/, /api/chat-groups/ и глушила
    // 84 роута, из которых стримов было 4. Работа в ТКП и чатах переставала
    // считаться активностью и давала ложную недоработку.
    expect(crmActivity.isNoisePath('/api/tkp/12/approve')).toBe(false);
    expect(crmActivity.isNoisePath('/api/tkp/12/send')).toBe(false);
    expect(crmActivity.isNoisePath('/api/tkp/12/client-decision')).toBe(false);
    expect(crmActivity.isNoisePath('/api/chat-groups/7/messages')).toBe(false);
    expect(crmActivity.isNoisePath('/api/chat-groups/7/send')).toBe(false);
    expect(crmActivity.isNoisePath('/api/tkp-quick/sessions/x/save-to-card')).toBe(false);
    expect(crmActivity.isNoisePath('/api/tkp-quick/sessions/x/finalize')).toBe(false);
    expect(crmActivity.isNoisePath('/api/mimir/chat')).toBe(false);
    expect(crmActivity.isNoisePath('/api/office-attendance/map')).toBe(false);
  });

  test('не-/api/ путь не считается', () => {
    expect(crmActivity.isNoisePath('/uploads/mail/a.pdf')).toBe(true);
    expect(crmActivity.isNoisePath('/m/home')).toBe(true);
  });

  test('tick не пишет шумный путь', () => {
    expect(crmActivity.tick(5, '/api/sse', Date.UTC(2026, 10, 3, 8, 0))).toBe(false);
    expect(crmActivity._buffer().size).toBe(0);
  });

  test('tick без user_id — no-op', () => {
    expect(crmActivity.tick(null, '/api/works', Date.UTC(2026, 10, 3, 8, 0))).toBe(false);
    expect(crmActivity.tick(0, '/api/works', Date.UTC(2026, 10, 3, 8, 0))).toBe(false);
  });
});

describe('crm-activity: сессии и склейка', () => {
  test('разрыв 14 минут склеивается в одну сессию', () => {
    const r = crmActivity.buildSessions([
      { minute: '10:00', hits: 1 },
      { minute: '10:14', hits: 1 }
    ]);
    expect(r.sessions.length).toBe(1);
    expect(r.sessions[0].minutes).toBe(15); // 10:00..10:14 включительно
  });

  test('разрыв 16 минут даёт две сессии', () => {
    const r = crmActivity.buildSessions([
      { minute: '10:00', hits: 1 },
      { minute: '10:16', hits: 1 }
    ]);
    expect(r.sessions.length).toBe(2);
    expect(r.totalMinutes).toBe(2); // две сессии по одной минуте
  });

  test('сессия из одной минуты = 1 минута, а не 15 (нет миражей)', () => {
    const r = crmActivity.buildSessions([{ minute: '09:30', hits: 7 }]);
    expect(r.totalMinutes).toBe(1);
    expect(r.sessions[0]).toEqual({ from: '09:30', to: '09:30', minutes: 1, hits: 7 });
  });

  test('сквозной пример из плана: 3 запроса в 10:00, 2 в 10:05, 1 в 12:00 → 7 минут в двух сессиях', () => {
    const r = crmActivity.buildSessions([
      { minute: '12:00', hits: 1 },
      { minute: '10:05', hits: 2 },
      { minute: '10:00', hits: 3 }
    ]);
    expect(r.totalMinutes).toBe(7);
    expect(r.sessions.length).toBe(2);
    expect(r.sessions[0]).toEqual({ from: '10:00', to: '10:05', minutes: 6, hits: 5 });
    expect(r.sessions[1]).toEqual({ from: '12:00', to: '12:00', minutes: 1, hits: 1 });
  });

  test('потолок дня обрезает забытую вкладку с автообновлением', () => {
    const minutes = [];
    for (let m = 0; m < 20 * 60; m++) {
      minutes.push({ minute: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, hits: 1 });
    }
    const r = crmActivity.buildSessions(minutes, { maxDayMinutes: 720 });
    expect(r.totalMinutes).toBe(720);
    expect(r.capped).toBe(true);
  });

  test('пустой день — ноль, без исключений', () => {
    const r = crmActivity.buildSessions([]);
    expect(r.totalMinutes).toBe(0);
    expect(r.sessions).toEqual([]);
  });

  test('минуты считаются от первой до последней включительно (обед внутри сессии не вычитается)', () => {
    // 09:00 и 09:59: разрыв 59 мин > 15 → разные сессии
    const r = crmActivity.buildSessions([
      { minute: '09:00', hits: 1 },
      { minute: '09:59', hits: 1 }
    ]);
    expect(r.sessions.length).toBe(2);
    // а 09:00, 09:10, 09:20 — одна сессия 09:00–09:20 = 21 минута
    const r2 = crmActivity.buildSessions([
      { minute: '09:00', hits: 1 },
      { minute: '09:10', hits: 1 },
      { minute: '09:20', hits: 1 }
    ]);
    expect(r2.totalMinutes).toBe(21);
  });
});

describe('crm-activity: буфер в памяти', () => {
  test('несколько запросов в одну минуту накапливаются в hits', () => {
    const t = Date.UTC(2026, 10, 3, 8, 0, 10); // 11:00 MSK
    crmActivity.tick(7, '/api/works', t);
    crmActivity.tick(7, '/api/tenders', t + 5000);
    crmActivity.tick(7, '/api/clients', t + 12000);
    const key = '7|2026-11-03T11:00';
    expect(crmActivity._buffer().get(key)).toBe(3);
  });

  test('разные минуты — разные ключи', () => {
    crmActivity.tick(7, '/api/works', Date.UTC(2026, 10, 3, 8, 0, 10));
    crmActivity.tick(7, '/api/works', Date.UTC(2026, 10, 3, 8, 1, 10));
    expect(crmActivity._buffer().size).toBe(2);
  });

  test('flush без БД не теряет буфер', async () => {
    crmActivity.tick(7, '/api/works', Date.UTC(2026, 10, 3, 8, 0, 10));
    const before = crmActivity._buffer().size;
    await crmActivity.flush();
    expect(crmActivity._buffer().size).toBe(before);
  });

  test('flush пишет пачкой в crm_activity_token и очищает буфер', async () => {
    const calls = [];
    const fakeDb = {
      query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; }
    };
    crmActivity.start(fakeDb, { intervalMs: 60 * 60 * 1000 });
    crmActivity.tick(7, '/api/works', Date.UTC(2026, 10, 3, 8, 0, 10));
    crmActivity.tick(8, '/api/tenders', Date.UTC(2026, 10, 3, 8, 0, 40));
    const res = await crmActivity.flush();
    expect(res.written).toBe(2);
    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain('ON CONFLICT (user_id, minute_ts)');
    expect(calls[0].sql).toContain('hits = crm_activity_token.hits + EXCLUDED.hits');
    expect(calls[0].params[0]).toBe(7);
    expect(calls[0].params[1]).toBe('2026-11-03 11:00');
    expect(calls[0].params[3]).toBe(8);
    expect(crmActivity._buffer().size).toBe(0);
    await crmActivity.stop();
    crmActivity._reset();
  });

  test('сбой БД при flush возвращает данные в буфер (ничего не теряется)', async () => {
    const fakeDb = { query: async () => { throw new Error('connection lost'); } };
    crmActivity.start(fakeDb, { intervalMs: 60 * 60 * 1000 });
    crmActivity.tick(9, '/api/works', Date.UTC(2026, 10, 3, 9, 0, 0));
    await expect(crmActivity.flush()).rejects.toThrow(/connection lost/);
    expect(crmActivity._buffer().size).toBe(1);
    expect(crmActivity._buffer().get('9|2026-11-03T12:00')).toBe(1);
    await crmActivity.stop().catch(() => {});
    crmActivity._reset();
  });
});
