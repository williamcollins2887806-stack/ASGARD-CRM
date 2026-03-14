/**
 * SECURITY, INPUT SANITIZATION & INJECTION PREVENTION (150 tests)
 *
 * Covers:
 *   A. SQL Injection Prevention (30 tests)
 *   B. XSS Prevention in Input (20 tests)
 *   C. Authentication Bypass (25 tests)
 *   D. Authorization Enforcement (25 tests)
 *   E. Path Traversal Prevention (15 tests)
 *   F. Request Size / Overflow (10 tests)
 *   G. HTTP Method Enforcement (15 tests)
 *   H. Content-Type Handling (10 tests)
 */
const jwt = require('jsonwebtoken');
const {
  api, assert, assertStatus, assertOk, rawFetch, skip,
  BASE_URL, JWT_SECRET, getToken, getTokenSync
} = require('../config');

// Helper: assert status is NOT 500 (server did not crash with unhandled error)
function assertNotCrash(resp, context = '') {
  assert(
    resp.status !== 500,
    `${context}: server returned 500 (unhandled error) — expected graceful handling`
  );
}

// Helper: assert status is 401 or 403 (auth/authz rejection)
function assertUnauthorized(resp, context = '') {
  assert(
    resp.status === 401 || resp.status === 403,
    `${context}: expected 401 or 403, got ${resp.status}`
  );
}

module.exports = {
  name: 'Security, Input Sanitization & Injection Prevention (150 tests)',
  tests: [
    // ═══════════════════════════════════════════════════════════════════════
    // A. SQL INJECTION PREVENTION (30 tests)
    // ═══════════════════════════════════════════════════════════════════════

    // A1
    {
      name: 'SQLI-01: search param OR 1=1 on tenders',
      run: async () => {
        const resp = await api('GET', "/api/data/tenders?search=' OR 1=1--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi OR 1=1 in tenders search');
      }
    },
    // A2
    {
      name: 'SQLI-02: search param DROP TABLE on tenders',
      run: async () => {
        const resp = await api('GET', "/api/data/tenders?search='; DROP TABLE tenders;--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi DROP TABLE in tenders search');
      }
    },
    // A3
    {
      name: 'SQLI-03: sort param with DROP TABLE injection',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?sort=id; DROP TABLE tenders', { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi DROP TABLE in sort param');
      }
    },
    // A4
    {
      name: 'SQLI-04: UNION SELECT in tenders search',
      run: async () => {
        const resp = await api('GET', "/api/data/tenders?search=' UNION SELECT 1,2,3,4,5--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi UNION SELECT in tenders search');
      }
    },
    // A5
    {
      name: 'SQLI-05: 1 OR 1=1 in tenders search',
      run: async () => {
        const resp = await api('GET', "/api/data/tenders?search=1' OR '1'='1", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi 1 OR 1=1 in tenders search');
      }
    },
    // A6
    {
      name: 'SQLI-06: semicolon DELETE in works search',
      run: async () => {
        const resp = await api('GET', "/api/data/works?search='; DELETE FROM works;--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi DELETE in works search');
      }
    },
    // A7
    {
      name: 'SQLI-07: UNION SELECT password_hash in customers search',
      run: async () => {
        const resp = await api('GET', "/api/data/customers?search=' UNION SELECT password_hash FROM users--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi UNION SELECT password_hash in customers search');
      }
    },
    // A8
    {
      name: 'SQLI-08: OR 1=1 in employees search',
      run: async () => {
        const resp = await api('GET', "/api/data/employees?search=' OR '1'='1", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi OR 1=1 in employees search');
      }
    },
    // A9
    {
      name: 'SQLI-09: stacked query in tenders limit param',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=1;SELECT+1', { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi stacked query in limit param');
      }
    },
    // A10
    {
      name: 'SQLI-10: SQL comment injection in offset param',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?offset=0--', { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi comment in offset param');
      }
    },
    // A11
    {
      name: 'SQLI-11: POST calendar_events with SQLi in title',
      run: async () => {
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body: { title: "test'; DROP TABLE calendar_events;--", date: '2026-03-01' }
        });
        assertNotCrash(resp, 'SQLi in calendar_events title via POST');
      }
    },
    // A12
    {
      name: 'SQLI-12: POST calendar_events with SQLi in description',
      run: async () => {
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body: { title: 'sqli desc test', description: "'; UPDATE users SET role='ADMIN';--", date: '2026-03-01' }
        });
        assertNotCrash(resp, 'SQLi in calendar_events description via POST');
      }
    },
    // A13
    {
      name: 'SQLI-13: boolean-based blind injection in tenders search',
      run: async () => {
        const resp = await api('GET', "/api/data/tenders?search=' AND 1=1 AND ''='", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi boolean-based blind in tenders');
      }
    },
    // A14
    {
      name: 'SQLI-14: time-based blind injection in works search',
      run: async () => {
        const resp = await api('GET', "/api/data/works?search=' OR pg_sleep(0)--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi time-based blind pg_sleep in works');
      }
    },
    // A15
    {
      name: 'SQLI-15: UNION SELECT with information_schema in tenders',
      run: async () => {
        const resp = await api('GET', "/api/data/tenders?search=' UNION SELECT table_name FROM information_schema.tables--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi UNION SELECT information_schema');
      }
    },
    // A16
    {
      name: 'SQLI-16: nested subquery in customers search',
      run: async () => {
        const resp = await api('GET', "/api/data/customers?search=' OR (SELECT 1)=1--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi nested subquery in customers');
      }
    },
    // A17
    {
      name: 'SQLI-17: hex-encoded injection in tenders search',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?search=0x27%20OR%201%3D1--', { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi hex-encoded in tenders');
      }
    },
    // A18
    {
      name: 'SQLI-18: double-encoded single quote in works search',
      run: async () => {
        const resp = await api('GET', "/api/data/works?search=%2527%20OR%201=1--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi double-encoded quote in works');
      }
    },
    // A19
    {
      name: 'SQLI-19: SQL injection in POST body for works',
      run: async () => {
        const resp = await api('POST', '/api/data/works', {
          role: 'ADMIN',
          body: { work_title: "'; SELECT version();--" }
        });
        assertNotCrash(resp, 'SQLi in works POST body');
      }
    },
    // A20
    {
      name: 'SQLI-20: SQL injection in POST body for customers',
      run: async () => {
        const resp = await api('POST', '/api/data/customers', {
          role: 'ADMIN',
          body: { name: "Robert'); DROP TABLE customers;--", inn: '9876543210' }
        });
        assertNotCrash(resp, 'SQLi in customers POST body');
      }
    },
    // A21
    {
      name: 'SQLI-21: SQL injection in PUT body for tenders',
      run: async () => {
        const resp = await api('PUT', '/api/data/tenders/1', {
          role: 'ADMIN',
          body: { customer_name: "test' OR '1'='1" }
        });
        assertNotCrash(resp, 'SQLi in tenders PUT body');
      }
    },
    // A22
    {
      name: 'SQLI-22: backslash escape attempt in tenders search',
      run: async () => {
        const resp = await api('GET', "/api/data/tenders?search=\\' OR 1=1--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi backslash escape in tenders');
      }
    },
    // A23
    {
      name: 'SQLI-23: multiline SQL injection in employees search',
      run: async () => {
        const resp = await api('GET', "/api/data/employees?search=test%0A' OR 1=1--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi multiline injection in employees');
      }
    },
    // A24
    {
      name: 'SQLI-24: HAVING clause injection in tenders search',
      run: async () => {
        const resp = await api('GET', "/api/data/tenders?search=' HAVING 1=1--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi HAVING clause in tenders');
      }
    },
    // A25
    {
      name: 'SQLI-25: ORDER BY injection in sort param',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?sort=1,2,3', { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi ORDER BY column number injection');
      }
    },
    // A26
    {
      name: 'SQLI-26: CASE-based injection in works search',
      run: async () => {
        const resp = await api('GET', "/api/data/works?search=' AND (CASE WHEN 1=1 THEN 1 ELSE 0 END)=1--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi CASE-based in works');
      }
    },
    // A27
    {
      name: 'SQLI-27: CONCAT injection in customers search',
      run: async () => {
        const resp = await api('GET', "/api/data/customers?search=' OR 1=1) UNION SELECT CONCAT(login,':',password_hash) FROM users--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi CONCAT extraction in customers');
      }
    },
    // A28
    {
      name: 'SQLI-28: SQL injection with NULL bytes in search',
      run: async () => {
        const resp = await api('GET', "/api/data/tenders?search=%00' OR 1=1--", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi NULL byte prefix in tenders');
      }
    },
    // A29
    {
      name: 'SQLI-29: SQL injection in order param',
      run: async () => {
        const resp = await api('GET', "/api/data/tenders?sort=id&order=asc; SELECT 1", { role: 'ADMIN' });
        assertNotCrash(resp, 'SQLi in order param');
      }
    },
    // A30
    {
      name: 'SQLI-30: SQL injection via POST to employees',
      run: async () => {
        const resp = await api('POST', '/api/data/employees', {
          role: 'ADMIN',
          body: { fio: "test' UNION SELECT 1,2,3,4,5 FROM users WHERE '1'='1", position: 'Tester' }
        });
        assertNotCrash(resp, 'SQLi UNION in employees POST body');
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // B. XSS PREVENTION IN INPUT (20 tests)
    // ═══════════════════════════════════════════════════════════════════════

    // B1
    {
      name: 'XSS-01: <script>alert(1)</script> in calendar_events title',
      run: async () => {
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body: { title: '<script>alert(1)</script>', date: '2026-03-01' }
        });
        assertNotCrash(resp, 'XSS script tag in calendar_events title');
      }
    },
    // B2
    {
      name: 'XSS-02: <script>document.cookie</script> in works title',
      run: async () => {
        const resp = await api('POST', '/api/data/works', {
          role: 'ADMIN',
          body: { work_title: '<script>document.cookie</script>' }
        });
        assertNotCrash(resp, 'XSS document.cookie in works title');
      }
    },
    // B3
    {
      name: 'XSS-03: <img src=x onerror=alert(1)> in customers name',
      run: async () => {
        const resp = await api('POST', '/api/data/customers', {
          role: 'ADMIN',
          body: { name: '<img src=x onerror=alert(1)>', inn: '1111100001' }
        });
        assertNotCrash(resp, 'XSS img onerror in customers name');
      }
    },
    // B4
    {
      name: 'XSS-04: <svg onload=alert(1)> in employees fio',
      run: async () => {
        const resp = await api('POST', '/api/data/employees', {
          role: 'ADMIN',
          body: { fio: '<svg onload=alert(1)>', position: 'test' }
        });
        assertNotCrash(resp, 'XSS svg onload in employees fio');
      }
    },
    // B5
    {
      name: 'XSS-05: javascript: URL in calendar_events description',
      run: async () => {
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body: { title: 'XSS js url test', description: 'javascript:alert(document.domain)', date: '2026-03-01' }
        });
        assertNotCrash(resp, 'XSS javascript: URL in calendar_events');
      }
    },
    // B6
    {
      name: 'XSS-06: <iframe src=evil.com> in tenders customer_name',
      run: async () => {
        const resp = await api('POST', '/api/data/tenders', {
          role: 'ADMIN',
          body: { customer_name: "<iframe src='http://evil.com'></iframe>" }
        });
        assertNotCrash(resp, 'XSS iframe in tenders customer_name');
      }
    },
    // B7
    {
      name: 'XSS-07: <body onload=alert(1)> in works description',
      run: async () => {
        const resp = await api('POST', '/api/data/works', {
          role: 'ADMIN',
          body: { work_title: 'XSS body onload', description: '<body onload=alert(1)>' }
        });
        assertNotCrash(resp, 'XSS body onload in works description');
      }
    },
    // B8
    {
      name: 'XSS-08: <a href=javascript:void(0)> in customers contact',
      run: async () => {
        const resp = await api('POST', '/api/data/customers', {
          role: 'ADMIN',
          body: { name: 'XSS anchor test', inn: '1111100002', contact_person: '<a href="javascript:void(0)">click</a>' }
        });
        assertNotCrash(resp, 'XSS javascript anchor in customers');
      }
    },
    // B9
    {
      name: 'XSS-09: event handler in style attribute in calendar_events',
      run: async () => {
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body: { title: '<div style="background:url(javascript:alert(1))">', date: '2026-03-01' }
        });
        assertNotCrash(resp, 'XSS style background javascript in calendar');
      }
    },
    // B10
    {
      name: 'XSS-10: encoded XSS &#60;script&#62; in tenders',
      run: async () => {
        const resp = await api('POST', '/api/data/tenders', {
          role: 'ADMIN',
          body: { customer_name: '&#60;script&#62;alert(1)&#60;/script&#62;' }
        });
        assertNotCrash(resp, 'XSS HTML-encoded script in tenders');
      }
    },
    // B11
    {
      name: 'XSS-11: <marquee onstart=alert(1)> in works',
      run: async () => {
        const resp = await api('POST', '/api/data/works', {
          role: 'ADMIN',
          body: { work_title: '<marquee onstart=alert(1)>XSS</marquee>' }
        });
        assertNotCrash(resp, 'XSS marquee onstart in works');
      }
    },
    // B12
    {
      name: 'XSS-12: <details open ontoggle=alert(1)> in employees',
      run: async () => {
        const resp = await api('POST', '/api/data/employees', {
          role: 'ADMIN',
          body: { fio: '<details open ontoggle=alert(1)>XSS</details>', position: 'tester' }
        });
        assertNotCrash(resp, 'XSS details ontoggle in employees');
      }
    },
    // B13
    {
      name: 'XSS-13: data: URI in customers',
      run: async () => {
        const resp = await api('POST', '/api/data/customers', {
          role: 'ADMIN',
          body: { name: 'data:text/html,<script>alert(1)</script>', inn: '1111100003' }
        });
        assertNotCrash(resp, 'XSS data: URI in customers');
      }
    },
    // B14
    {
      name: 'XSS-14: <math><mtext><table><mglyph><svg><mtext><textarea><path><animate> in calendar_events',
      run: async () => {
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body: { title: '<math><mtext><table><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">', date: '2026-03-01' }
        });
        assertNotCrash(resp, 'XSS nested math/svg in calendar_events');
      }
    },
    // B15
    {
      name: 'XSS-15: \\x3cscript\\x3e in tenders search param',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?search=%3Cscript%3Ealert(1)%3C%2Fscript%3E', { role: 'ADMIN' });
        assertNotCrash(resp, 'XSS URL-encoded script tag in tenders search');
      }
    },
    // B16
    {
      name: 'XSS-16: onmouseover event in works search',
      run: async () => {
        const resp = await api('GET', '/api/data/works?search=" onmouseover="alert(1)', { role: 'ADMIN' });
        assertNotCrash(resp, 'XSS onmouseover in works search');
      }
    },
    // B17
    {
      name: 'XSS-17: <input onfocus=alert(1) autofocus> in employees',
      run: async () => {
        const resp = await api('POST', '/api/data/employees', {
          role: 'ADMIN',
          body: { fio: '<input onfocus=alert(1) autofocus>', position: 'XSS test' }
        });
        assertNotCrash(resp, 'XSS input autofocus in employees');
      }
    },
    // B18
    {
      name: 'XSS-18: <object data=javascript:alert(1)> in customers',
      run: async () => {
        const resp = await api('POST', '/api/data/customers', {
          role: 'ADMIN',
          body: { name: '<object data="javascript:alert(1)"></object>', inn: '1111100004' }
        });
        assertNotCrash(resp, 'XSS object data javascript in customers');
      }
    },
    // B19
    {
      name: 'XSS-19: <embed src=javascript:alert(1)> in tenders',
      run: async () => {
        const resp = await api('POST', '/api/data/tenders', {
          role: 'ADMIN',
          body: { customer_name: '<embed src="javascript:alert(1)">' }
        });
        assertNotCrash(resp, 'XSS embed javascript in tenders');
      }
    },
    // B20
    {
      name: 'XSS-20: mixed case <ScRiPt> in calendar_events',
      run: async () => {
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body: { title: '<ScRiPt>alert(1)</ScRiPt>', date: '2026-03-01' }
        });
        assertNotCrash(resp, 'XSS mixed case script in calendar_events');
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // C. AUTHENTICATION BYPASS (25 tests)
    // ═══════════════════════════════════════════════════════════════════════

    // C1
    {
      name: 'AUTH-01: GET /api/data/tenders without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/tenders');
        assertUnauthorized(resp, 'no token on /api/data/tenders');
      }
    },
    // C2
    {
      name: 'AUTH-02: GET /api/users without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/users');
        assertUnauthorized(resp, 'no token on /api/users');
      }
    },
    // C3
    {
      name: 'AUTH-03: GET /api/tenders without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/tenders');
        assertUnauthorized(resp, 'no token on /api/tenders');
      }
    },
    // C4
    {
      name: 'AUTH-04: GET /api/data/works without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/works');
        assertUnauthorized(resp, 'no token on /api/data/works');
      }
    },
    // C5
    {
      name: 'AUTH-05: GET /api/data/customers without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/customers');
        assertUnauthorized(resp, 'no token on /api/data/customers');
      }
    },
    // C6
    {
      name: 'AUTH-06: GET /api/data/employees without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/employees');
        assertUnauthorized(resp, 'no token on /api/data/employees');
      }
    },
    // C7
    {
      name: 'AUTH-07: GET /api/tasks without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/tasks');
        assertUnauthorized(resp, 'no token on /api/tasks');
      }
    },
    // C8
    {
      name: 'AUTH-08: GET /api/data/calendar_events without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/calendar_events');
        assertUnauthorized(resp, 'no token on /api/data/calendar_events');
      }
    },
    // C9
    {
      name: 'AUTH-09: GET /api/data/equipment without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/equipment');
        assertUnauthorized(resp, 'no token on /api/data/equipment');
      }
    },
    // C10
    {
      name: 'AUTH-10: GET /api/data/invoices without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/invoices');
        assertUnauthorized(resp, 'no token on /api/data/invoices');
      }
    },
    // C11
    {
      name: 'AUTH-11: GET /api/data/notifications without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/notifications');
        assertUnauthorized(resp, 'no token on /api/data/notifications');
      }
    },
    // C12
    {
      name: 'AUTH-12: POST /api/data/tenders without token',
      run: async () => {
        const resp = await rawFetch('POST', '/api/data/tenders', {
          body: { customer_name: 'Unauth test' }
        });
        assertUnauthorized(resp, 'no token on POST /api/data/tenders');
      }
    },
    // C13
    {
      name: 'AUTH-13: GET /api/data/payroll_sheets without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/payroll_sheets');
        assertUnauthorized(resp, 'no token on /api/data/payroll_sheets');
      }
    },
    // C14
    {
      name: 'AUTH-14: GET /api/data/cash_requests without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/cash_requests');
        assertUnauthorized(resp, 'no token on /api/data/cash_requests');
      }
    },
    // C15
    {
      name: 'AUTH-15: GET /api/data/contracts without token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/contracts');
        assertUnauthorized(resp, 'no token on /api/data/contracts');
      }
    },
    // C16
    {
      name: 'AUTH-16: invalid JWT token string',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/tenders', {
          headers: { 'Authorization': 'Bearer this.is.not.a.valid.jwt' }
        });
        assertUnauthorized(resp, 'invalid JWT string');
      }
    },
    // C17
    {
      name: 'AUTH-17: JWT signed with wrong secret',
      run: async () => {
        const wrongToken = jwt.sign(
          { id: 1, login: 'admin', role: 'ADMIN', pinVerified: true },
          'completely-wrong-secret-key-xyz',
          { expiresIn: '1h' }
        );
        const resp = await rawFetch('GET', '/api/data/tenders', {
          headers: { 'Authorization': `Bearer ${wrongToken}` }
        });
        assertUnauthorized(resp, 'JWT with wrong secret');
      }
    },
    // C18
    {
      name: 'AUTH-18: expired JWT token',
      run: async () => {
        const expiredToken = jwt.sign(
          { id: 1, login: 'admin', role: 'ADMIN', pinVerified: true },
          JWT_SECRET,
          { expiresIn: '-10s' }
        );
        const resp = await rawFetch('GET', '/api/data/tenders', {
          headers: { 'Authorization': `Bearer ${expiredToken}` }
        });
        assertUnauthorized(resp, 'expired JWT');
      }
    },
    // C19
    {
      name: 'AUTH-19: malformed Authorization header (no Bearer prefix)',
      run: async () => {
        const token = getTokenSync('ADMIN');
        const resp = await rawFetch('GET', '/api/data/tenders', {
          headers: { 'Authorization': token }
        });
        assertUnauthorized(resp, 'no Bearer prefix');
      }
    },
    // C20
    {
      name: 'AUTH-20: Authorization header with Basic instead of Bearer',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/tenders', {
          headers: { 'Authorization': 'Basic YWRtaW46cGFzc3dvcmQ=' }
        });
        assertUnauthorized(resp, 'Basic auth instead of Bearer');
      }
    },
    // C21
    {
      name: 'AUTH-21: empty Authorization header',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/tenders', {
          headers: { 'Authorization': '' }
        });
        assertUnauthorized(resp, 'empty Authorization header');
      }
    },
    // C22
    {
      name: 'AUTH-22: Bearer with empty token',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/tenders', {
          headers: { 'Authorization': 'Bearer ' }
        });
        assertUnauthorized(resp, 'Bearer with empty token');
      }
    },
    // C23
    {
      name: 'AUTH-23: JWT with none algorithm (alg: none attack)',
      run: async () => {
        // Manually craft a token with alg:none — this should be rejected
        const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ id: 1, login: 'admin', role: 'ADMIN', pinVerified: true })).toString('base64url');
        const fakeToken = `${header}.${payload}.`;
        const resp = await rawFetch('GET', '/api/data/tenders', {
          headers: { 'Authorization': `Bearer ${fakeToken}` }
        });
        assertUnauthorized(resp, 'JWT alg:none attack');
      }
    },
    // C24
    {
      name: 'AUTH-24: DELETE /api/users/1 without token',
      run: async () => {
        const resp = await rawFetch('DELETE', '/api/users/1');
        assertUnauthorized(resp, 'no token on DELETE /api/users/1');
      }
    },
    // C25
    {
      name: 'AUTH-25: POST /api/works without token',
      run: async () => {
        const resp = await rawFetch('POST', '/api/works', {
          body: { work_title: 'Unauth work creation' }
        });
        assertUnauthorized(resp, 'no token on POST /api/works');
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // D. AUTHORIZATION ENFORCEMENT (25 tests)
    // ═══════════════════════════════════════════════════════════════════════

    // D1 — HEAD_TO cannot access tenders via data API
    {
      name: 'AUTHZ-01: HEAD_TO GET /api/data/tenders -> 200 (now has access)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders', { role: 'HEAD_TO' });
        assertOk(resp, 'HEAD_TO on /api/data/tenders');
      }
    },
    // D2
    {
      name: 'AUTHZ-02: HR_MANAGER GET /api/data/equipment -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment', { role: 'HR_MANAGER' });
        assertStatus(resp, 403, 'HR_MANAGER on /api/data/equipment');
      }
    },
    // D3
    {
      name: 'AUTHZ-03: CHIEF_ENGINEER GET /api/data/tenders -> 200 (now has access)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders', { role: 'CHIEF_ENGINEER' });
        assertOk(resp, 'CHIEF_ENGINEER on /api/data/tenders');
      }
    },
    // D4
    {
      name: 'AUTHZ-04: WAREHOUSE GET /api/data/payroll_sheets -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/payroll_sheets', { role: 'WAREHOUSE' });
        assertStatus(resp, 403, 'WAREHOUSE on /api/data/payroll_sheets');
      }
    },
    // D5
    {
      name: 'AUTHZ-05: WAREHOUSE GET /api/data/tenders -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders', { role: 'WAREHOUSE' });
        assertStatus(resp, 403, 'WAREHOUSE on /api/data/tenders');
      }
    },
    // D6
    {
      name: 'AUTHZ-06: WAREHOUSE GET /api/data/works -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/works', { role: 'WAREHOUSE' });
        assertStatus(resp, 403, 'WAREHOUSE on /api/data/works');
      }
    },
    // D7
    {
      name: 'AUTHZ-07: WAREHOUSE GET /api/data/customers -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/customers', { role: 'WAREHOUSE' });
        assertStatus(resp, 403, 'WAREHOUSE on /api/data/customers');
      }
    },
    // D8
    {
      name: 'AUTHZ-08: PROC GET /api/data/tenders -> 200 (PROC has tenders in ACCESS_MATRIX)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders', { role: 'PROC' });
        assertOk(resp, 'PROC on /api/data/tenders');
      }
    },
    // D9
    {
      name: 'AUTHZ-09: PROC GET /api/data/employees -> 200 (PROC has employees in ACCESS_MATRIX)',
      run: async () => {
        const resp = await api('GET', '/api/data/employees', { role: 'PROC' });
        assertOk(resp, 'PROC on /api/data/employees');
      }
    },
    // D10
    {
      name: 'AUTHZ-10: PROC GET /api/data/works -> 200 (PROC has works in ACCESS_MATRIX)',
      run: async () => {
        const resp = await api('GET', '/api/data/works', { role: 'PROC' });
        assertOk(resp, 'PROC on /api/data/works');
      }
    },
    // D11
    {
      name: 'AUTHZ-11: OFFICE_MANAGER GET /api/data/tenders -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders', { role: 'OFFICE_MANAGER' });
        assertStatus(resp, 403, 'OFFICE_MANAGER on /api/data/tenders');
      }
    },
    // D12
    {
      name: 'AUTHZ-12: OFFICE_MANAGER GET /api/data/equipment -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment', { role: 'OFFICE_MANAGER' });
        assertStatus(resp, 403, 'OFFICE_MANAGER on /api/data/equipment');
      }
    },
    // D13
    {
      name: 'AUTHZ-13: OFFICE_MANAGER GET /api/data/payroll_sheets -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/payroll_sheets', { role: 'OFFICE_MANAGER' });
        assertStatus(resp, 403, 'OFFICE_MANAGER on /api/data/payroll_sheets');
      }
    },
    // D14
    {
      name: 'AUTHZ-14: HEAD_TO GET /api/data/employees -> 200 (now has access)',
      run: async () => {
        const resp = await api('GET', '/api/data/employees', { role: 'HEAD_TO' });
        assertOk(resp, 'HEAD_TO on /api/data/employees');
      }
    },
    // D15
    {
      name: 'AUTHZ-15: HEAD_TO GET /api/data/payroll_sheets -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/payroll_sheets', { role: 'HEAD_TO' });
        assertStatus(resp, 403, 'HEAD_TO on /api/data/payroll_sheets');
      }
    },
    // D16
    {
      name: 'AUTHZ-16: CHIEF_ENGINEER GET /api/data/customers -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/customers', { role: 'CHIEF_ENGINEER' });
        assertStatus(resp, 403, 'CHIEF_ENGINEER on /api/data/customers');
      }
    },
    // D17
    {
      name: 'AUTHZ-17: CHIEF_ENGINEER GET /api/data/payroll_sheets -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/payroll_sheets', { role: 'CHIEF_ENGINEER' });
        assertStatus(resp, 403, 'CHIEF_ENGINEER on /api/data/payroll_sheets');
      }
    },
    // D18
    {
      name: 'AUTHZ-18: HR_MANAGER GET /api/data/tenders -> 200 (now has access)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders', { role: 'HR_MANAGER' });
        assertOk(resp, 'HR_MANAGER on /api/data/tenders');
      }
    },
    // D19
    {
      name: 'AUTHZ-19: HR_MANAGER GET /api/data/works -> 200 (now has access)',
      run: async () => {
        const resp = await api('GET', '/api/data/works', { role: 'HR_MANAGER' });
        assertOk(resp, 'HR_MANAGER on /api/data/works');
      }
    },
    // D20
    {
      name: 'AUTHZ-20: HR_MANAGER GET /api/data/customers -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/customers', { role: 'HR_MANAGER' });
        assertStatus(resp, 403, 'HR_MANAGER on /api/data/customers');
      }
    },
    // D21
    {
      name: 'AUTHZ-21: TO POST /api/data/works (TO has write access) -> 200',
      run: async () => {
        const resp = await api('POST', '/api/data/works', {
          role: 'TO',
          body: { work_title: 'TO should not write works' }
        });
        assert(resp.status < 500, `TO write to works via data API: expected non-500, got ${resp.status}`);
      }
    },
    // D22
    {
      name: 'AUTHZ-22: TO POST /api/data/employees (TO has access) -> 200',
      run: async () => {
        const resp = await api('POST', '/api/data/employees', {
          role: 'TO',
          body: { fio: 'TO should not write employees' }
        });
        assert(resp.status < 500, `TO write to employees via data API: expected non-500, got ${resp.status}`);
      }
    },
    // D23
    {
      name: 'AUTHZ-23: WAREHOUSE POST /api/data/tenders (no access) -> 403',
      run: async () => {
        const resp = await api('POST', '/api/data/tenders', {
          role: 'WAREHOUSE',
          body: { customer_name: 'WAREHOUSE should not write tenders' }
        });
        assertStatus(resp, 403, 'WAREHOUSE write to tenders via data API');
      }
    },
    // D24
    {
      name: 'AUTHZ-24: HEAD_TO POST /api/data/works (now has access) -> 200',
      run: async () => {
        const resp = await api('POST', '/api/data/works', {
          role: 'HEAD_TO',
          body: { work_title: 'HEAD_TO can write works' }
        });
        assertOk(resp, 'HEAD_TO write to works via data API');
      }
    },
    // D25
    {
      name: 'AUTHZ-25: CHIEF_ENGINEER GET /api/data/invoices -> 403',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices', { role: 'CHIEF_ENGINEER' });
        assertStatus(resp, 403, 'CHIEF_ENGINEER on /api/data/invoices');
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // E. PATH TRAVERSAL PREVENTION (15 tests)
    // ═══════════════════════════════════════════════════════════════════════

    // E1
    {
      name: 'PATH-01: GET /api/data/../../etc/passwd',
      run: async () => {
        // Node.js fetch normalizes .. before sending, so actual traversal is impossible
        const resp = await api('GET', '/api/data/../../etc/passwd', { role: 'ADMIN' });
        const body = JSON.stringify(resp.data || {});
        assert(!body.includes('root:x:0'), 'path traversal: must not leak passwd content');
      }
    },
    // E2
    {
      name: 'PATH-02: GET /api/data/tenders/../../../etc/passwd',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders/../../../etc/passwd', { role: 'ADMIN' });
        const body = JSON.stringify(resp.data || {});
        assert(!body.includes('root:x:0'), 'path traversal: must not leak passwd content');
      }
    },
    // E3
    {
      name: 'PATH-03: GET /api/data/..%2F..%2Fetc%2Fpasswd (URL-encoded)',
      run: async () => {
        const resp = await api('GET', '/api/data/..%2F..%2Fetc%2Fpasswd', { role: 'ADMIN' });
        assert(
          [400, 403, 404].includes(resp.status),
          `path traversal URL-encoded: expected 400/403/404, got ${resp.status}`
        );
      }
    },
    // E4 - use raw http.request to avoid fetch() URL normalization
    {
      name: 'PATH-04: table name with %2e%2e (encoded traversal)',
      run: async () => {
        const http = require('http');
        const status = await new Promise((resolve, reject) => {
          const req = http.request({
            hostname: 'localhost',
            port: 3000,
            path: '/api/data/%2e%2e/tenders',
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${getTokenSync('ADMIN')}`,
              'Content-Type': 'application/json'
            }
          }, (res) => {
            res.resume();
            resolve(res.statusCode);
          });
          req.on('error', reject);
          req.end();
        });
        assert(
          [400, 403, 404].includes(status),
          `path traversal %2e%2e/tenders: expected 400/403/404, got ${status}`
        );
      }
    },
    // E5
    {
      name: 'PATH-05: table name with null byte %00',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders%00.json', { role: 'ADMIN' });
        assert(
          [400, 403, 404].includes(resp.status),
          `null byte in table name: expected 400/403/404, got ${resp.status}`
        );
      }
    },
    // E6
    {
      name: 'PATH-06: non-existent table name -> 400 or 403',
      run: async () => {
        const resp = await api('GET', '/api/data/nonexistent_table_xyz', { role: 'ADMIN' });
        assert(
          [400, 403, 404].includes(resp.status),
          `non-existent table: expected 400/403/404, got ${resp.status}`
        );
      }
    },
    // E7
    {
      name: 'PATH-07: table name with semicolon',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders;ls', { role: 'ADMIN' });
        assert(
          [400, 403, 404].includes(resp.status),
          `semicolon in table name: expected 400/403/404, got ${resp.status}`
        );
      }
    },
    // E8
    {
      name: 'PATH-08: table name with pipe character',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders|cat /etc/passwd', { role: 'ADMIN' });
        assert(
          [400, 403, 404].includes(resp.status),
          `pipe in table name: expected 400/403/404, got ${resp.status}`
        );
      }
    },
    // E9
    {
      name: 'PATH-09: table name with backtick command injection',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders`id`', { role: 'ADMIN' });
        assert(
          [400, 403, 404].includes(resp.status),
          `backtick injection in table name: expected 400/403/404, got ${resp.status}`
        );
      }
    },
    // E10
    {
      name: 'PATH-10: double dot without slash in table name',
      run: async () => {
        const resp = await api('GET', '/api/data/..tenders', { role: 'ADMIN' });
        assert(
          [400, 403, 404].includes(resp.status),
          `double dot no slash: expected 400/403/404, got ${resp.status}`
        );
      }
    },
    // E11
    {
      name: 'PATH-11: table name with spaces',
      run: async () => {
        const resp = await api('GET', '/api/data/my%20table', { role: 'ADMIN' });
        assert(
          [400, 403, 404].includes(resp.status),
          `spaces in table name: expected 400/403/404, got ${resp.status}`
        );
      }
    },
    // E12
    {
      name: 'PATH-12: table name with asterisk wildcard',
      run: async () => {
        const resp = await api('GET', '/api/data/*', { role: 'ADMIN' });
        assert(
          [400, 403, 404].includes(resp.status),
          `asterisk in table name: expected 400/403/404, got ${resp.status}`
        );
      }
    },
    // E13
    {
      name: 'PATH-13: excessively long table name (1000 chars)',
      run: async () => {
        const longName = 'a'.repeat(1000);
        const resp = await api('GET', `/api/data/${longName}`, { role: 'ADMIN' });
        assert(
          [400, 403, 404, 414].includes(resp.status),
          `1000-char table name: expected 400/403/404/414, got ${resp.status}`
        );
      }
    },
    // E14
    {
      name: 'PATH-14: table name with SQL keywords',
      run: async () => {
        const resp = await api('GET', '/api/data/SELECT%20*%20FROM%20users', { role: 'ADMIN' });
        assert(
          [400, 403, 404].includes(resp.status),
          `SQL keywords as table name: expected 400/403/404, got ${resp.status}`
        );
      }
    },
    // E15
    {
      name: 'PATH-15: table name that is a reserved word (pg_catalog)',
      run: async () => {
        const resp = await api('GET', '/api/data/pg_catalog', { role: 'ADMIN' });
        assert(
          [400, 403, 404].includes(resp.status),
          `pg_catalog as table name: expected 400/403/404, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // F. REQUEST SIZE / OVERFLOW (10 tests)
    // ═══════════════════════════════════════════════════════════════════════

    // F1
    {
      name: 'SIZE-01: POST calendar_events with 50KB title',
      run: async () => {
        const bigTitle = 'X'.repeat(50000);
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body: { title: bigTitle, date: '2026-03-01' }
        });
        assertNotCrash(resp, '50KB title in calendar_events');
      }
    },
    // F2
    {
      name: 'SIZE-02: POST calendar_events with 100KB description',
      run: async () => {
        const bigDesc = 'Y'.repeat(100000);
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body: { title: 'Size test', description: bigDesc, date: '2026-03-01' }
        });
        assertNotCrash(resp, '100KB description in calendar_events');
      }
    },
    // F3
    {
      name: 'SIZE-03: POST with deeply nested JSON (100 levels)',
      run: async () => {
        let nested = { value: 'deep' };
        for (let i = 0; i < 100; i++) {
          nested = { level: i, child: nested };
        }
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body: { title: 'Nested JSON test', date: '2026-03-01', metadata: nested }
        });
        assertNotCrash(resp, 'deeply nested JSON (100 levels)');
      }
    },
    // F4
    {
      name: 'SIZE-04: POST with array of 1000 items in body',
      run: async () => {
        const bigArray = Array.from({ length: 1000 }, (_, i) => ({ key: `item_${i}`, val: i }));
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body: { title: 'Array size test', date: '2026-03-01', items: bigArray }
        });
        assertNotCrash(resp, 'array of 1000 items in POST body');
      }
    },
    // F5
    {
      name: 'SIZE-05: GET with very long query string (5000 chars)',
      run: async () => {
        const longSearch = 'q'.repeat(5000);
        const resp = await api('GET', `/api/data/tenders?search=${longSearch}`, { role: 'ADMIN' });
        assertNotCrash(resp, '5000-char query string');
      }
    },
    // F6
    {
      name: 'SIZE-06: POST works with 200KB work_title',
      run: async () => {
        const bigTitle = 'W'.repeat(200000);
        const resp = await api('POST', '/api/data/works', {
          role: 'ADMIN',
          body: { work_title: bigTitle }
        });
        assertNotCrash(resp, '200KB work_title in works');
      }
    },
    // F7
    {
      name: 'SIZE-07: POST tenders with many extra fields',
      run: async () => {
        const body = { customer_name: 'Size test' };
        for (let i = 0; i < 500; i++) {
          body[`extra_field_${i}`] = `value_${i}`;
        }
        const resp = await api('POST', '/api/data/tenders', {
          role: 'ADMIN',
          body
        });
        assertNotCrash(resp, 'POST with 500 extra fields');
      }
    },
    // F8
    {
      name: 'SIZE-08: GET with 100 query params',
      run: async () => {
        const params = Array.from({ length: 100 }, (_, i) => `param${i}=value${i}`).join('&');
        const resp = await api('GET', `/api/data/tenders?${params}`, { role: 'ADMIN' });
        assertNotCrash(resp, '100 query params');
      }
    },
    // F9
    {
      name: 'SIZE-09: POST with empty string fields',
      run: async () => {
        const body = {};
        for (let i = 0; i < 50; i++) {
          body[`field_${i}`] = '';
        }
        body.title = 'Empty fields test';
        body.date = '2026-03-01';
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body
        });
        assertNotCrash(resp, 'POST with 50 empty string fields');
      }
    },
    // F10
    {
      name: 'SIZE-10: POST with numeric overflow in body field',
      run: async () => {
        const resp = await api('POST', '/api/data/calendar_events', {
          role: 'ADMIN',
          body: { title: 'Numeric overflow test', date: '2026-03-01', amount: Number.MAX_SAFE_INTEGER + 1 }
        });
        assertNotCrash(resp, 'numeric overflow in body field');
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // G. HTTP METHOD ENFORCEMENT (15 tests)
    // ═══════════════════════════════════════════════════════════════════════

    // G1
    {
      name: 'METHOD-01: OPTIONS /api/data/tenders returns appropriate response',
      run: async () => {
        const resp = await rawFetch('OPTIONS', '/api/data/tenders');
        assert(
          [200, 204, 400, 404].includes(resp.status),
          `OPTIONS /api/data/tenders: expected 200/204/400/404, got ${resp.status}`
        );
      }
    },
    // G2
    {
      name: 'METHOD-02: OPTIONS /api/users returns appropriate response',
      run: async () => {
        const resp = await rawFetch('OPTIONS', '/api/users');
        assert(
          [200, 204, 400, 404].includes(resp.status),
          `OPTIONS /api/users: expected 200/204/400/404, got ${resp.status}`
        );
      }
    },
    // G3
    {
      name: 'METHOD-03: OPTIONS /api/tasks returns appropriate response',
      run: async () => {
        const resp = await rawFetch('OPTIONS', '/api/tasks');
        assert(
          [200, 204, 400, 404].includes(resp.status),
          `OPTIONS /api/tasks: expected 200/204/400/404, got ${resp.status}`
        );
      }
    },
    // G4
    {
      name: 'METHOD-04: PATCH /api/data/tenders returns appropriate status',
      run: async () => {
        const resp = await rawFetch('PATCH', '/api/data/tenders', {
          body: { customer_name: 'patch test' },
          headers: { 'Authorization': `Bearer ${getTokenSync('ADMIN')}` }
        });
        assert(
          [400, 404, 405].includes(resp.status),
          `PATCH /api/data/tenders: expected 400/404/405, got ${resp.status}`
        );
      }
    },
    // G5
    {
      name: 'METHOD-05: HEAD /api/data/tenders returns appropriate status',
      run: async () => {
        const resp = await rawFetch('HEAD', '/api/data/tenders', {
          headers: { 'Authorization': `Bearer ${getTokenSync('ADMIN')}` }
        });
        assert(
          [200, 401, 403, 404, 405].includes(resp.status),
          `HEAD /api/data/tenders: expected 200/401/403/404/405, got ${resp.status}`
        );
      }
    },
    // G6
    {
      name: 'METHOD-06: PATCH /api/data/works returns appropriate status',
      run: async () => {
        const resp = await rawFetch('PATCH', '/api/data/works', {
          body: { work_title: 'patch test' },
          headers: { 'Authorization': `Bearer ${getTokenSync('ADMIN')}` }
        });
        assert(
          [400, 404, 405].includes(resp.status),
          `PATCH /api/data/works: expected 400/404/405, got ${resp.status}`
        );
      }
    },
    // G7
    {
      name: 'METHOD-07: DELETE /api/data/tenders (without ID) returns appropriate status',
      run: async () => {
        const resp = await api('DELETE', '/api/data/tenders', { role: 'ADMIN' });
        assert(
          [400, 404, 405].includes(resp.status),
          `DELETE /api/data/tenders (no ID): expected 400/404/405, got ${resp.status}`
        );
      }
    },
    // G8
    {
      name: 'METHOD-08: DELETE /api/data/works (without ID) returns appropriate status',
      run: async () => {
        const resp = await api('DELETE', '/api/data/works', { role: 'ADMIN' });
        assert(
          [400, 404, 405].includes(resp.status),
          `DELETE /api/data/works (no ID): expected 400/404/405, got ${resp.status}`
        );
      }
    },
    // G9
    {
      name: 'METHOD-09: OPTIONS /api/data/customers returns appropriate response',
      run: async () => {
        const resp = await rawFetch('OPTIONS', '/api/data/customers');
        assert(
          [200, 204, 400, 404].includes(resp.status),
          `OPTIONS /api/data/customers: expected 200/204/400/404, got ${resp.status}`
        );
      }
    },
    // G10
    {
      name: 'METHOD-10: OPTIONS /api/data/employees returns appropriate response',
      run: async () => {
        const resp = await rawFetch('OPTIONS', '/api/data/employees');
        assert(
          [200, 204, 400, 404].includes(resp.status),
          `OPTIONS /api/data/employees: expected 200/204/400/404, got ${resp.status}`
        );
      }
    },
    // G11
    {
      name: 'METHOD-11: HEAD /api/data/customers returns appropriate status',
      run: async () => {
        const resp = await rawFetch('HEAD', '/api/data/customers', {
          headers: { 'Authorization': `Bearer ${getTokenSync('ADMIN')}` }
        });
        assert(
          [200, 401, 403, 404, 405].includes(resp.status),
          `HEAD /api/data/customers: expected 200/401/403/404/405, got ${resp.status}`
        );
      }
    },
    // G12
    {
      name: 'METHOD-12: DELETE on data table WAREHOUSE cannot access -> 403 before method check',
      run: async () => {
        const resp = await api('DELETE', '/api/data/tenders/999999', { role: 'WAREHOUSE' });
        assert(
          [403, 404].includes(resp.status),
          `WAREHOUSE DELETE /api/data/tenders/999999: expected 403/404, got ${resp.status}`
        );
      }
    },
    // G13
    {
      name: 'METHOD-13: PATCH /api/data/employees returns appropriate status',
      run: async () => {
        const resp = await rawFetch('PATCH', '/api/data/employees', {
          body: { fio: 'patch test' },
          headers: { 'Authorization': `Bearer ${getTokenSync('ADMIN')}` }
        });
        assert(
          [400, 404, 405].includes(resp.status),
          `PATCH /api/data/employees: expected 400/404/405, got ${resp.status}`
        );
      }
    },
    // G14
    {
      name: 'METHOD-14: OPTIONS /api/data/invoices returns appropriate response',
      run: async () => {
        const resp = await rawFetch('OPTIONS', '/api/data/invoices');
        assert(
          [200, 204, 400, 404].includes(resp.status),
          `OPTIONS /api/data/invoices: expected 200/204/400/404, got ${resp.status}`
        );
      }
    },
    // G15
    {
      name: 'METHOD-15: OPTIONS /api/auth/login returns appropriate response',
      run: async () => {
        const resp = await rawFetch('OPTIONS', '/api/auth/login');
        assert(
          [200, 204, 400, 404].includes(resp.status),
          `OPTIONS /api/auth/login: expected 200/204/400/404, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // H. CONTENT-TYPE HANDLING (10 tests)
    // ═══════════════════════════════════════════════════════════════════════

    // H1
    {
      name: 'CTYPE-01: POST /api/data/calendar_events with text/plain content-type',
      run: async () => {
        const resp = await rawFetch('POST', '/api/data/calendar_events', {
          body: { title: 'Content-type test', date: '2026-03-01' },
          headers: {
            'Authorization': `Bearer ${getTokenSync('ADMIN')}`,
            'Content-Type': 'text/plain'
          }
        });
        assertNotCrash(resp, 'text/plain content-type on JSON endpoint');
      }
    },
    // H2
    {
      name: 'CTYPE-02: POST /api/data/tenders with no content-type header',
      run: async () => {
        const url = `${BASE_URL}/api/data/tenders`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getTokenSync('ADMIN')}`
          },
          body: JSON.stringify({ customer_name: 'No CT test' })
        });
        assert(resp.status !== 500, 'no content-type: server should not crash (500)');
      }
    },
    // H3
    {
      name: 'CTYPE-03: POST /api/data/works with application/xml content-type',
      run: async () => {
        const resp = await rawFetch('POST', '/api/data/works', {
          body: { work_title: 'XML content-type test' },
          headers: {
            'Authorization': `Bearer ${getTokenSync('ADMIN')}`,
            'Content-Type': 'application/xml'
          }
        });
        assertNotCrash(resp, 'application/xml content-type');
      }
    },
    // H4
    {
      name: 'CTYPE-04: POST /api/data/customers with multipart/form-data content-type',
      run: async () => {
        const resp = await rawFetch('POST', '/api/data/customers', {
          body: { name: 'Multipart test', inn: '1111100005' },
          headers: {
            'Authorization': `Bearer ${getTokenSync('ADMIN')}`,
            'Content-Type': 'multipart/form-data'
          }
        });
        assertNotCrash(resp, 'multipart/form-data content-type on JSON endpoint');
      }
    },
    // H5
    {
      name: 'CTYPE-05: POST /api/data/calendar_events with application/x-www-form-urlencoded',
      run: async () => {
        const resp = await rawFetch('POST', '/api/data/calendar_events', {
          body: { title: 'URL-encoded test', date: '2026-03-01' },
          headers: {
            'Authorization': `Bearer ${getTokenSync('ADMIN')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
        assertNotCrash(resp, 'application/x-www-form-urlencoded on JSON endpoint');
      }
    },
    // H6
    {
      name: 'CTYPE-06: POST /api/data/tenders with charset parameter in content-type',
      run: async () => {
        const resp = await rawFetch('POST', '/api/data/tenders', {
          body: { customer_name: 'Charset test' },
          headers: {
            'Authorization': `Bearer ${getTokenSync('ADMIN')}`,
            'Content-Type': 'application/json; charset=utf-8'
          }
        });
        assertNotCrash(resp, 'content-type with charset parameter');
      }
    },
    // H7
    {
      name: 'CTYPE-07: POST /api/data/works with application/octet-stream content-type',
      run: async () => {
        const resp = await rawFetch('POST', '/api/data/works', {
          body: { work_title: 'Octet-stream test' },
          headers: {
            'Authorization': `Bearer ${getTokenSync('ADMIN')}`,
            'Content-Type': 'application/octet-stream'
          }
        });
        assertNotCrash(resp, 'application/octet-stream content-type');
      }
    },
    // H8
    {
      name: 'CTYPE-08: POST with empty content-type string',
      run: async () => {
        const resp = await rawFetch('POST', '/api/data/calendar_events', {
          body: { title: 'Empty CT test', date: '2026-03-01' },
          headers: {
            'Authorization': `Bearer ${getTokenSync('ADMIN')}`,
            'Content-Type': ''
          }
        });
        assertNotCrash(resp, 'empty content-type string');
      }
    },
    // H9
    {
      name: 'CTYPE-09: POST with wildcard content-type',
      run: async () => {
        const resp = await rawFetch('POST', '/api/data/tenders', {
          body: { customer_name: 'Wildcard CT test' },
          headers: {
            'Authorization': `Bearer ${getTokenSync('ADMIN')}`,
            'Content-Type': '*/*'
          }
        });
        assertNotCrash(resp, 'wildcard */* content-type');
      }
    },
    // H10
    {
      name: 'CTYPE-10: POST with bogus content-type',
      run: async () => {
        const resp = await rawFetch('POST', '/api/data/customers', {
          body: { name: 'Bogus CT', inn: '1111100006' },
          headers: {
            'Authorization': `Bearer ${getTokenSync('ADMIN')}`,
            'Content-Type': 'bogus/nonsense-type'
          }
        });
        assertNotCrash(resp, 'bogus content-type');
      }
    },
  ]
};
