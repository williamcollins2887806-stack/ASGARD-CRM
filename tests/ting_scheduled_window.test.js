'use strict';

/**
 * D-398: запланированная комната не должна закрываться sweeper'ом в момент
 * наступления времени встречи.
 *
 * Дефект был реальный: встреча стояла на 12.11 14:00, а в списке Тингов висело
 * «Завершён» — sweeper закрыл комнату 10.11, потому что окно входа осталось
 * от момента создания совещания.
 *
 * Проверяем три случая на фейковой БД (без сети и без LiveKit):
 *   1) окно в будущем            — не трогаем;
 *   2) наступило 5 минут назад    — не трогаем (встреча только началась);
 *   3) прошло 7 часов             — закрываем (люди не пришли).
 */
const assert = require('assert');
const lifecycle = require('../src/services/thing-lifecycle');

function fakeDb(room) {
  const updates = [];
  return {
    updates,
    query: async (sql) => {
      if (typeof sql === 'string' && sql.includes('FROM thing_rooms r')) {
        return { rows: [room] };
      }
      if (typeof sql === 'string' && sql.includes('UPDATE thing_rooms')) {
        updates.push(sql);
        return { rows: [{ ...room, status: 'ended' }] };
      }
      // COUNT-запросы участников и запись left_at
      return { rows: [{ n: 0 }], rowCount: 1 };
    },
  };
}

function roomAged({ scheduledOffsetMs, createdOffsetMs = -60 * 60 * 1000 }) {
  return {
    id: 319,
    status: 'scheduled',
    slug: 'dr4ne4',
    livekit_room_name: 'ting_dr4ne4',
    max_participants: 50,
    scheduled_at: new Date(Date.now() + scheduledOffsetMs),
    created_at: new Date(Date.now() + createdOffsetMs),
  };
}

(async () => {
  // 1. Встреча через 2 часа — sweeper молчит.
  {
    const db = fakeDb(roomAged({ scheduledOffsetMs: 2 * 60 * 60 * 1000 }));
    const r = await lifecycle.sweepStaleRooms(db, { staleMinutes: 20 });
    assert.deepStrictEqual(r.closed, [], 'будущая встреча закрыта быть не должна');
    assert.strictEqual(db.updates.length, 0, 'UPDATE не должен выполняться');
  }

  // 2. Встреча началась 5 минут назад — sweeper молчит (главный баг).
  {
    const db = fakeDb(roomAged({ scheduledOffsetMs: -5 * 60 * 1000 }));
    const r = await lifecycle.sweepStaleRooms(db, { staleMinutes: 20 });
    assert.deepStrictEqual(r.closed, [], 'только что начавшуюся встречу закрывать нельзя');
    assert.strictEqual(db.updates.length, 0, 'UPDATE не должен выполняться');
  }

  // 3. Прошло 7 часов, никто не пришёл — закрываем.
  {
    const db = fakeDb(roomAged({ scheduledOffsetMs: -7 * 60 * 60 * 1000 }));
    const r = await lifecycle.sweepStaleRooms(db, { staleMinutes: 20 });
    assert.deepStrictEqual(r.closed, [319], 'просроченная комната должна закрыться');
    assert.strictEqual(db.updates.length, 1, 'должен быть один UPDATE');
  }

  console.log('D-398 sweeper window: 3/3 OK');
})().catch((e) => {
  console.error('FAIL', e && e.message);
  process.exit(1);
});
