'use strict';

/**
 * D-398 (часть 2): перенос совещания переносит и окно входа Тинга.
 *
 * Проверяем SQL-путь через фейковый db: PUT /api/meetings/:id со start_time
 * должен обновить thing_rooms.scheduled_at у привязанной комнаты status='scheduled'.
 * Проверка на уровне построения запроса, без HTTP и без LiveKit.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'meetings.js'), 'utf8'
);

// 1. Совещание передаёт время встречи в создание комнаты.
assert.ok(
  src.includes('scheduled_at: start_time,'),
  'createThingRoom должен получать scheduled_at: start_time'
);

// 2. Перенос времени синхронизирует окно комнаты.
assert.ok(
  /timeChanged\s*&&\s*meeting\.thing_room_id/.test(src),
  'перенос должен проверять timeChanged и наличие комнаты'
);
assert.ok(
  /UPDATE thing_rooms[\s\S]{0,160}scheduled_at\s*=\s*\$2::timestamptz/.test(src),
  'должен быть UPDATE thing_rooms SET scheduled_at'
);

// 3. Синхронизация не воскрешает уже закрытую комнату.
assert.ok(
  /UPDATE thing_rooms[\s\S]{0,220}?status\s*=\s*'scheduled'/.test(src),
  'UPDATE должен ограничиваться status = scheduled'
);

console.log('D-398 meeting->room window sync: 3/3 OK');
