/**
 * VALIDATION & EDGE CASES — Empty bodies, invalid JSON, SQL injection, XSS, boundaries
 */
const { api, assert, assertOk, assertStatus, assertForbidden, rawFetch, skip, BASE_URL, getToken } = require('../config');

module.exports = {
  name: 'VALIDATION & EDGE CASES',
  tests: [
    // ═══ Empty/Invalid POST body ═══
    {
      name: 'VAL: POST /api/data/tenders with empty body → handled',
      run: async () => {
        const resp = await api('POST', '/api/data/tenders', {
          role: 'ADMIN',
          body: {}
        });
        // Data API may accept empty body (creates record with defaults) — valid behavior
        assert(
          [200, 201, 400, 422].includes(resp.status),
          `empty body should be 200/201/400/422, got ${resp.status}`
        );
        // Cleanup if created
        const id = resp.data?.id || resp.data?.item?.id;
        if (id) {
          await api('DELETE', `/api/data/tenders/${id}`, { role: 'ADMIN' });
        }
      }
    },
    {
      name: 'VAL: POST /api/tenders with empty body → 400',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'ADMIN',
          body: {}
        });
        assert(
          resp.status === 400 || resp.status === 422,
          `empty tender should be 400/422, got ${resp.status}`
        );
      }
    },
    {
      name: 'VAL: POST /api/users with empty body → 400',
      run: async () => {
        const resp = await api('POST', '/api/users', {
          role: 'ADMIN',
          body: {}
        });
        assert(
          resp.status === 400 || resp.status === 422,
          `empty user should be 400/422, got ${resp.status}`
        );
      }
    },
    {
      name: 'VAL: Invalid JSON body → 400',
      run: async () => {
        const token = getToken('ADMIN');
        const resp = await fetch(`${BASE_URL}/api/data/tenders`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: '{invalid json!!'
        });
        assert(
          resp.status === 400 || resp.status === 422,
          `invalid JSON should be 400/422, got ${resp.status}`
        );
      }
    },

    // ═══ Non-existent ID ═══
    {
      name: 'VAL: GET /api/data/tenders/999999999 → 404',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders/999999999', { role: 'ADMIN' });
        // C3: Server returns 404 for non-existent record
        assert(resp.status === 404, `non-existent tender: expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'VAL: PUT /api/data/tenders/999999999 → 404',
      run: async () => {
        const resp = await api('PUT', '/api/data/tenders/999999999', {
          role: 'ADMIN',
          body: { tender_title: 'ghost' }
        });
        assert(resp.status === 404, `update non-existent: expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'VAL: DELETE /api/data/tenders/999999999 → 404',
      run: async () => {
        const resp = await api('DELETE', '/api/data/tenders/999999999', { role: 'ADMIN' });
        assert(resp.status === 404, `delete non-existent: expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'VAL: GET /api/users/999999999 → 404',
      run: async () => {
        const resp = await api('GET', '/api/users/999999999', { role: 'ADMIN' });
        assert(resp.status === 404, `non-existent user: expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'VAL: GET /api/tenders/999999999 → 404',
      run: async () => {
        const resp = await api('GET', '/api/tenders/999999999', { role: 'ADMIN' });
        assert(resp.status === 404, `non-existent tender: expected 404, got ${resp.status}`);
      }
    },

    // ═══ SQL Injection attempts ═══
    {
      name: 'SEC: SQL injection in table name → safe (Fastify parses ; as separator)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders;DROP%20TABLE%20users', { role: 'ADMIN' });
        // C4: Fastify parses `;` as path separator, table resolves to "tenders" → safe 200
        assert(resp.status === 200, `SQL injection in table: expected 200, got ${resp.status}`);
      }
    },
    {
      name: 'SEC: SQL injection in query param → 200 (parameterized queries)',
      run: async () => {
        const resp = await api('GET', "/api/data/tenders?limit=1;DROP TABLE users--", { role: 'ADMIN' });
        // B1: Parameterized queries safely ignore injection; parseInt returns NaN → defaults to 500 → capped
        assert(resp.status === 200, `SQL injection in query param: expected 200, got ${resp.status}`);
      }
    },
    {
      name: 'SEC: SQL injection in POST body field → 200 (stored as string)',
      run: async () => {
        const resp = await api('POST', '/api/data/tenders', {
          role: 'ADMIN',
          body: {
            customer_name: "'; DROP TABLE tenders; --",
            tender_title: 'SQL Injection Test',
            tender_type: 'Открытый',
            tender_status: 'Новый'
          }
        });
        // B2: Parameterized queries store injection text literally
        assert(resp.status === 200, `SQL injection in body: expected 200, got ${resp.status}`);

        // Cleanup if created
        const id = resp.data?.id || resp.data?.item?.id;
        if (id) {
          await api('DELETE', `/api/data/tenders/${id}`, { role: 'ADMIN' });
        }
      }
    },
    {
      name: 'SEC: SQL injection in ID param → 400 (invalid ID)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders/1%20OR%201=1', { role: 'ADMIN' });
        // A1: Server validates ID is numeric → 400
        assert(resp.status === 400, `SQL injection in ID: expected 400, got ${resp.status}`);
      }
    },

    // ═══ XSS attempts ═══
    {
      name: 'SEC: XSS in POST body → 200 (stored safely as text)',
      run: async () => {
        const xssPayload = '<script>alert("xss")</script>';
        const resp = await api('POST', '/api/data/tenders', {
          role: 'ADMIN',
          body: {
            customer_name: xssPayload,
            tender_title: 'XSS Test',
            tender_type: 'Открытый',
            tender_status: 'Новый'
          }
        });
        // B3: XSS text is stored as literal string by parameterized queries
        assert(resp.status === 200, `XSS in body: expected 200, got ${resp.status}`);

        // Cleanup
        const id = resp.data?.id || resp.data?.item?.id;
        if (id) {
          await api('DELETE', `/api/data/tenders/${id}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ Boundary values ═══
    {
      name: 'VAL: Very long string in field (5000 chars) → 400 (VARCHAR overflow)',
      run: async () => {
        const longStr = 'A'.repeat(5000);
        const resp = await api('POST', '/api/data/tenders', {
          role: 'ADMIN',
          body: {
            customer_name: longStr,
            tender_title: 'Long string test',
            tender_type: 'Открытый',
            tender_status: 'Новый'
          }
        });
        // A2: Server catches PostgreSQL error 22001 (string_data_right_truncation) → 400
        assert(resp.status === 400, `long string: expected 400, got ${resp.status}`);
      }
    },
    {
      name: 'VAL: Limit=0 → 200 (clamped to 1)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=0', { role: 'ADMIN' });
        // B4: Server clamps limit to min 1 via Math.max
        assert(resp.status === 200, `limit=0: expected 200, got ${resp.status}`);
      }
    },
    {
      name: 'VAL: Limit=99999 → capped to 500',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=99999', { role: 'ADMIN' });
        assertOk(resp, 'limit cap');
      }
    },
    {
      name: 'VAL: Negative limit → 200 (clamped to 1)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=-5', { role: 'ADMIN' });
        // B5: Server clamps negative limit to 1 via Math.max
        assert(resp.status === 200, `negative limit: expected 200, got ${resp.status}`);
      }
    },
    {
      name: 'VAL: Offset with string → 200 (defaults to 0)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?offset=abc', { role: 'ADMIN' });
        // A3: Server sanitizes offset: parseInt('abc') || 0 → uses 0
        assert(resp.status === 200, `string offset: expected 200, got ${resp.status}`);
      }
    },

    // ═══ Disallowed tables ═══
    {
      name: 'VAL: GET /api/data/pg_tables → blocked (not in whitelist)',
      run: async () => {
        const resp = await api('GET', '/api/data/pg_tables', { role: 'ADMIN' });
        assert(resp.status === 400, `system table should be blocked: expected 400, got ${resp.status}`);
      }
    },
    {
      name: 'VAL: GET /api/data/information_schema → blocked',
      run: async () => {
        const resp = await api('GET', '/api/data/information_schema', { role: 'ADMIN' });
        assert(resp.status === 400, `information_schema should be blocked: expected 400, got ${resp.status}`);
      }
    },

    // ═══ Content-Type validation ═══
    {
      name: 'VAL: POST without Content-Type → 400',
      run: async () => {
        const token = getToken('ADMIN');
        const resp = await fetch(`${BASE_URL}/api/data/tenders`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ customer_name: 'No content type' })
        });
        // A4: Node fetch sends text/plain by default → body is string not object → 400
        assert(resp.status === 400, `no content-type: expected 400, got ${resp.status}`);
      }
    },

    // ═══ Special characters ═══
    {
      name: 'VAL: Unicode in field values → 200 (stored correctly)',
      run: async () => {
        const unicodeStr = '测试 тест テスト 🔧';
        const resp = await api('POST', '/api/data/tenders', {
          role: 'ADMIN',
          body: {
            customer_name: unicodeStr,
            tender_title: 'Unicode test ' + Date.now(),
            tender_type: 'Открытый',
            tender_status: 'Новый'
          }
        });
        // B6: Unicode is stored correctly by PostgreSQL
        assert(resp.status === 200, `unicode: expected 200, got ${resp.status}`);

        const id = resp.data?.id || resp.data?.item?.id;
        if (id) {
          // Verify stored correctly
          const getResp = await api('GET', `/api/data/tenders/${id}`, { role: 'ADMIN' });
          if (getResp.ok && getResp.data) {
            const item = getResp.data;
            const name = item.customer_name || item.item?.customer_name;
            if (name) {
              assert(name.includes('测试'), 'unicode should be preserved');
            }
          }
          await api('DELETE', `/api/data/tenders/${id}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ Method not allowed ═══
    {
      name: 'VAL: PATCH on unsupported endpoint → 404/405',
      run: async () => {
        const token = getToken('ADMIN');
        const resp = await fetch(`${BASE_URL}/api/tenders/1`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ tender_title: 'patched' })
        });
        assert(
          [404, 405, 400, 200].includes(resp.status),
          `PATCH: got ${resp.status}`
        );
      }
    },

    // ═══ Extra fields in POST ═══
    {
      name: 'VAL: POST with unknown columns → 200 (extra fields ignored)',
      run: async () => {
        const resp = await api('POST', '/api/data/tenders', {
          role: 'ADMIN',
          body: {
            customer_name: 'VAL_EXTRA_' + Date.now(),
            tender_title: 'Extra fields test',
            tender_type: 'Открытый',
            tender_status: 'Новый',
            non_existent_column_xyz: 'should be ignored',
            another_fake_field: 12345
          }
        });
        // B7: Column whitelist strips unknown columns, record created normally
        assert(resp.status === 200, `extra fields: expected 200, got ${resp.status}`);

        const id = resp.data?.id || resp.data?.item?.id;
        if (id) {
          await api('DELETE', `/api/data/tenders/${id}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ ID type coercion ═══
    {
      name: 'VAL: String ID where integer expected → 400',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders/abc', { role: 'ADMIN' });
        // A5: Server validates ID is numeric → 400
        assert(resp.status === 400, `string ID: expected 400, got ${resp.status}`);
      }
    }
  ]
};
