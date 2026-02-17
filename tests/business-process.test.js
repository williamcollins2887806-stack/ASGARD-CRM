/**
 * ASGARD CRM — Business Process E2E Tests
 * Tests: Auth, Tasks CRUD, Chat Groups, Notifications, Data API, TKP/Pass/TMC
 */
const http = require('http');

const BASE = 'http://localhost:3000';
let TOKEN = '';
let adminUser = null;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    if (TOKEN) options.headers['Authorization'] = 'Bearer ' + TOKEN;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    console.log(`  ❌ ${testName}`);
  }
}

async function runTests() {
  console.log('🔷 ASGARD CRM Business Process Tests\n');

  // ============================================
  // 1. Health Check
  // ============================================
  console.log('📋 Test 1: Health Check');
  {
    const r = await request('GET', '/api/health');
    assert(r.status === 200, 'Health returns 200');
    assert(r.data && r.data.status === 'ok', 'Health status is ok');
  }

  // ============================================
  // 2. Auth — Login
  // ============================================
  console.log('\n📋 Test 2: Authentication');
  {
    const r = await request('POST', '/api/auth/login', { login: 'admin', password: 'admin123' });
    assert(r.status === 200, 'Login returns 200');
    assert(r.data.token, 'Token received');
    assert(r.data.user && r.data.user.role === 'ADMIN', 'User role is ADMIN');
    TOKEN = r.data.token;
    adminUser = r.data.user;
  }

  // ============================================
  // 3. Auth — Me endpoint
  // ============================================
  console.log('\n📋 Test 3: Auth Me');
  {
    const r = await request('GET', '/api/auth/me');
    assert(r.status === 200, '/api/auth/me returns 200');
    assert(r.data.user && r.data.user.login === 'admin', 'Returns admin user');
  }

  // ============================================
  // 4. Data API — Users list
  // ============================================
  console.log('\n📋 Test 4: Data API - Users');
  {
    const r = await request('GET', '/api/data/users');
    assert(r.status === 200, 'Users returns 200');
    assert(Array.isArray(r.data.users), 'Users is an array');
    assert(r.data.total >= 1, 'At least 1 user');
  }

  // ============================================
  // 5. Tasks CRUD
  // ============================================
  console.log('\n📋 Test 5: Tasks CRUD');
  let taskId;
  {
    // Create
    const r1 = await request('POST', '/api/tasks', {
      title: 'Тестовая задача бизнес-процесс',
      description: 'Автотест',
      priority: 'high'
    });
    assert(r1.status === 200 && r1.data.success, 'Create task');
    taskId = r1.data.task?.id;
    assert(taskId, 'Task ID received');
    assert(r1.data.task?.status === 'Новая', 'Initial status is Новая');

    // Read
    const r2 = await request('GET', '/api/tasks/' + taskId);
    assert(r2.status === 200 && r2.data.task, 'Get task by ID');

    // Status flow: Новая → В работе
    const r3 = await request('PUT', '/api/tasks/' + taskId + '/status', { status: 'В работе' });
    assert(r3.data.task?.status === 'В работе', 'Status changed to В работе');
    assert(r3.data.task?.accepted_at, 'accepted_at set');

    // Status flow: В работе → Выполнена
    const r4 = await request('PUT', '/api/tasks/' + taskId + '/status', { status: 'Выполнена' });
    assert(r4.data.task?.status === 'Выполнена', 'Status changed to Выполнена');
    assert(r4.data.task?.completed_at, 'completed_at set');

    // Status flow: Выполнена → Закрыта
    const r5 = await request('PUT', '/api/tasks/' + taskId + '/status', { status: 'Закрыта' });
    assert(r5.data.task?.status === 'Закрыта', 'Status changed to Закрыта');

    // List
    const r6 = await request('GET', '/api/tasks');
    assert(r6.data.tasks?.length >= 1, 'Tasks list has items');
  }

  // ============================================
  // 6. Chat Groups
  // ============================================
  console.log('\n📋 Test 6: Chat Groups');
  let groupId;
  {
    // Create group
    const r1 = await request('POST', '/api/chat-groups', {
      name: 'Тестовый чат',
      member_ids: []
    });
    assert(r1.data.success, 'Create group chat');
    groupId = r1.data.group?.id;
    assert(groupId, 'Group ID received');

    // List groups
    const r2 = await request('GET', '/api/chat-groups');
    assert(r2.data.groups?.length >= 1, 'Groups list has items');

    // Send message
    const r3 = await request('POST', '/api/chat-groups/' + groupId + '/messages', {
      text: 'Привет из автотеста!'
    });
    assert(r3.data.success, 'Send message to group');

    // Get messages
    const r4 = await request('GET', '/api/chat-groups/' + groupId + '/messages');
    assert(r4.data.messages?.length >= 1, 'Group has messages');
  }

  // ============================================
  // 7. Notifications
  // ============================================
  console.log('\n📋 Test 7: Notifications');
  {
    // Create notification
    const r1 = await request('POST', '/api/notifications', {
      user_id: adminUser.id,
      title: 'Тест уведомления',
      message: 'Тестовое сообщение',
      type: 'test',
      link_hash: '#/tasks'
    });
    assert(r1.data.notification, 'Create notification');
    assert(r1.data.notification?.link_hash === '#/tasks', 'link_hash saved');

    // List notifications
    const r2 = await request('GET', '/api/notifications');
    assert(r2.data.notifications?.length >= 1, 'Notifications list has items');
    assert(typeof r2.data.unread_count === 'number', 'unread_count is number');
  }

  // ============================================
  // 8. Data API — TKP table
  // ============================================
  console.log('\n📋 Test 8: TKP/Pass/TMC Tables');
  {
    const r1 = await request('GET', '/api/data/tkp');
    assert(r1.status === 200, 'TKP table accessible');

    const r2 = await request('GET', '/api/data/pass_requests');
    assert(r2.status === 200, 'pass_requests table accessible');

    const r3 = await request('GET', '/api/data/tmc_requests');
    assert(r3.status === 200, 'tmc_requests table accessible');
  }

  // ============================================
  // 9. Data API — Core Tables
  // ============================================
  console.log('\n📋 Test 9: Core Data Tables');
  {
    const tables = ['tenders', 'works', 'estimates', 'customers', 'staff', 'equipment', 'invoices', 'acts'];
    for (const table of tables) {
      const r = await request('GET', '/api/data/' + table);
      assert(r.status === 200, `Table ${table} accessible`);
    }
  }

  // ============================================
  // 10. Unauthorized Access
  // ============================================
  console.log('\n📋 Test 10: Security — Unauthorized');
  {
    const oldToken = TOKEN;
    TOKEN = '';
    const r = await request('GET', '/api/data/users');
    assert(r.status === 401, 'Unauthorized returns 401');
    TOKEN = oldToken;

    // Forbidden table
    const r2 = await request('GET', '/api/data/nonexistent_table');
    assert(r2.status === 400, 'Non-allowed table returns 400');
  }

  // ============================================
  // Summary
  // ============================================
  console.log('\n' + '═'.repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(50));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
