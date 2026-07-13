#!/usr/bin/env node
/**
 * Smoke-тест корреспонденции для OFFICE_MANAGER.
 * Создаёт временную запись (external registration) и удаляет её в конце.
 * Не создаёт пользователей. Не оставляет мусор при успешном cleanup.
 */
'use strict';

const https = require('https');
const { api, assertOk, BASE_URL } = require('../tests/config');

const TEST_NUMBER = `АС-SMOKE-${Date.now()}`;

async function run() {
  let createdId = null;
  const errors = [];

  try {
    // 1. Endpoints
    let resp = await api('GET', '/api/correspondence/outgoing-number-status', { role: 'OFFICE_MANAGER' });
    assertOk(resp, 'outgoing-number-status');
    console.log('✅ outgoing-number-status');

    resp = await api('POST', '/api/correspondence/check-outgoing-number', {
      role: 'OFFICE_MANAGER',
      body: { number: TEST_NUMBER }
    });
    assertOk(resp, 'check-outgoing-number');
    if (!resp.data?.available) throw new Error('test number should be available');
    console.log('✅ check-outgoing-number');

    // 2. External registration (minimal — без файла ожидаем 400, проверяем что route жив)
    resp = await api('POST', '/api/correspondence', {
      role: 'OFFICE_MANAGER',
      body: {
        registration_mode: 'external',
        direction: 'outgoing',
        number: TEST_NUMBER,
        date: '2026-07-08',
        subject: `[SMOKE] OM correspondence ${Date.now()}`,
        counterparty: 'Smoke Test LLC',
        signing_status: 'finalized',
        doc_type: 'letter',
        letter_kind: 'free',
        file_path: '/uploads/smoke-placeholder.pdf'
      }
    });
    if (resp.ok && (resp.data?.id || resp.data?.item?.id)) {
      createdId = resp.data.id || resp.data.item.id;
      console.log('✅ external registration created id=' + createdId);
    } else if (resp.status === 400 || resp.status === 409) {
      console.log('⚠️ external registration rejected (expected without real file):', resp.status, JSON.stringify(resp.data).slice(0, 120));
    } else {
      throw new Error('unexpected external reg: ' + resp.status + ' ' + JSON.stringify(resp.data));
    }

    // 3. List access
    resp = await api('GET', '/api/data/correspondence?limit=3', { role: 'OFFICE_MANAGER' });
    assertOk(resp, 'list');
    console.log('✅ OM list');

    // 4. mark-sent only if we created a finalized record
    if (createdId) {
      resp = await api('POST', `/api/correspondence/${createdId}/mark-sent`, {
        role: 'OFFICE_MANAGER',
        body: { sent_at: '2026-07-08', channel: 'manual', note: 'smoke' }
      });
      assertOk(resp, 'mark-sent');
      console.log('✅ mark-sent');

      resp = await api('GET', `/api/correspondence/${createdId}/attachments`, { role: 'OFFICE_MANAGER' });
      assertOk(resp, 'attachments');
      console.log('✅ attachments');
    }

    console.log('\nSMOKE OK');
  } catch (e) {
    errors.push(e.message || String(e));
    console.error('❌', e.message || e);
  } finally {
    if (createdId) {
      try {
        const del = await api('DELETE', `/api/correspondence/${createdId}`, { role: 'OFFICE_MANAGER' });
        if (del.ok) {
          console.log('🧹 cleaned up correspondence id=' + createdId);
        } else {
          console.error('⚠️ cleanup failed:', del.status, JSON.stringify(del.data));
          process.exitCode = 1;
        }
      } catch (ce) {
        console.error('⚠️ cleanup error:', ce.message || ce);
        process.exitCode = 1;
      }
    }
    if (errors.length) process.exitCode = 1;
  }
}

run();
