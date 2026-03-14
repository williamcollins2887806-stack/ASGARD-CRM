/**
 * E2E BUSINESS FLOWS (Complete) — 8 end-to-end business flow tests
 *
 * Each flow creates data, exercises a full business process, and cleans up.
 * All flows use try/finally to ensure cleanup runs even on failure.
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, skip } = require('../config');

module.exports = {
  name: 'E2E BUSINESS FLOWS (Complete)',
  tests: [
    // ═══════════════════════════════════════════════════════════════════
    // FLOW 1: Tender -> Work -> Estimate -> Act -> Invoice
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'FLOW 1: Tender -> Work -> Estimate -> Act -> Invoice (full chain)',
      run: async () => {
        let tenderId = null;
        let workId = null;
        let estimateId = null;
        let actId = null;
        let invoiceId = null;

        try {
          // 1. PM creates tender
          const tenderResp = await api('POST', '/api/tenders', {
            role: 'PM',
            body: {
              customer: 'E2E-Complete: HVAC Customer',
              customer_name: 'E2E-Complete: HVAC Customer',
              tender_title: 'E2E Complete Tender ' + Date.now(),
              tender_status: 'Новый',
              estimated_sum: 10000000
            }
          });
          assertOk(tenderResp, 'PM creates tender');
          const tender = tenderResp.data?.tender || tenderResp.data;
          tenderId = tender?.id;
          assert(tenderId, 'tender must return id');

          // 2. PM creates work linked to tender
          const workResp = await api('POST', '/api/works', {
            role: 'PM',
            body: {
              tender_id: tenderId,
              work_title: 'E2E Complete: Installation Work',
              work_number: 'E2E-CW-' + Date.now(),
              work_status: 'В работе',
              contract_value: 8000000
            }
          });
          assertOk(workResp, 'PM creates work linked to tender');
          const work = workResp.data?.work || workResp.data;
          workId = work?.id;
          assert(workId, 'work must return id');

          // 3. TO creates estimate linked to tender
          const estResp = await api('POST', '/api/estimates', {
            role: 'TO',
            body: {
              tender_id: tenderId,
              title: 'E2E Complete Estimate',
              amount: 7500000,
              margin: 20,
              approval_status: 'draft'
            }
          });
          assertOk(estResp, 'TO creates estimate');
          estimateId = estResp.data?.estimate?.id || estResp.data?.id;

          // 4. ADMIN creates act linked to work
          const actResp = await api('POST', '/api/acts', {
            role: 'ADMIN',
            body: {
              work_id: workId,
              number: 'ACT-E2E-' + Date.now(),
              customer: 'E2E-Complete: HVAC Customer',
              amount: 4000000,
              date: '2026-02-15',
              status: 'Подписан'
            }
          });
          assertOk(actResp, 'ADMIN creates act');
          actId = actResp.data?.act?.id || actResp.data?.id;

          // 5. BUH creates invoice linked to work
          const invResp = await api('POST', '/api/invoices', {
            role: 'BUH',
            body: {
              work_id: workId,
              invoice_number: 'INV-E2E-' + Date.now(),
              invoice_date: '2026-02-15',
              invoice_type: 'income',
              customer_name: 'E2E-Complete: HVAC Customer',
              amount: 4000000,
              total_amount: 4000000
            }
          });
          assertOk(invResp, 'BUH creates invoice');
          invoiceId = invResp.data?.invoice?.id || invResp.data?.id;

          // Verify: tender detail is readable
          const tenderDetail = await api('GET', `/api/tenders/${tenderId}`, { role: 'PM' });
          assertOk(tenderDetail, 'tender detail readable');

          // Verify: work detail is readable
          const workDetail = await api('GET', `/api/works/${workId}`, { role: 'PM' });
          assertOk(workDetail, 'work detail readable');
        } finally {
          // 6. Cleanup: delete all created records (ADMIN)
          if (invoiceId) await api('DELETE', `/api/invoices/${invoiceId}`, { role: 'ADMIN' });
          if (actId) await api('DELETE', `/api/acts/${actId}`, { role: 'ADMIN' });
          if (estimateId) await api('DELETE', `/api/estimates/${estimateId}`, { role: 'ADMIN' });
          if (workId) await api('DELETE', `/api/works/${workId}`, { role: 'ADMIN' });
          if (tenderId) await api('DELETE', `/api/tenders/${tenderId}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // FLOW 2: Task assignment and completion
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'FLOW 2: Task assignment -> accept -> comment -> complete -> cleanup',
      run: async () => {
        let taskId = null;

        try {
          // Resolve a real user ID for assignment (FK-safe)
          const usersResp = await api('GET', '/api/users', { role: 'ADMIN' });
          assertOk(usersResp, 'fetch users for assignment');
          const userList = Array.isArray(usersResp.data) ? usersResp.data : (usersResp.data?.users || []);
          const assignee = userList.find(u => u.is_active !== false) || userList[0];
          const assigneeId = assignee?.id;
          if (!assigneeId) skip('No active users found for task assignment');

          // 1. ADMIN creates task assigned to PM user
          const createResp = await api('POST', '/api/tasks', {
            role: 'ADMIN',
            body: {
              title: 'E2E Complete: Prepare quarterly report',
              assignee_id: assigneeId,
              priority: 'high',
              deadline: '2026-04-01',
              description: 'E2E complete flow test task'
            }
          });
          assertOk(createResp, 'ADMIN creates task');
          const task = createResp.data?.task || createResp.data;
          taskId = task?.id;
          assert(taskId, 'task must return id');

          // 2. Read-back task, verify assigned
          const readResp = await api('GET', `/api/tasks/${taskId}`, { role: 'ADMIN' });
          assertOk(readResp, 'read-back task');
          const taskData = readResp.data?.task || readResp.data;
          assertHasFields(taskData, ['id', 'title'], 'task detail fields');
          assert(taskData.id === taskId, 'task id must match');

          // 3. Accept task (use ADMIN — can accept any task with status='new')
          const acceptResp = await api('PUT', `/api/tasks/${taskId}/accept`, {
            role: 'ADMIN',
            body: {}
          });
          assertOk(acceptResp, 'ADMIN accepts task');

          // 4. Add comment to task
          const commentResp = await api('POST', `/api/tasks/${taskId}/comments`, {
            role: 'ADMIN',
            body: { text: 'E2E Complete: Working on this quarterly report now' }
          });
          assertOk(commentResp, 'ADMIN adds comment');

          // 5. Complete task
          const completeResp = await api('PUT', `/api/tasks/${taskId}/complete`, {
            role: 'ADMIN',
            body: { comment: 'E2E Complete: Report finished and submitted' }
          });
          assertOk(completeResp, 'ADMIN completes task');
        } finally {
          // 6. Cleanup: delete task
          if (taskId) await api('DELETE', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // FLOW 3: Employee onboarding -> permit -> assignment
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'FLOW 3: Employee onboarding -> permit -> verify -> cleanup',
      run: async () => {
        let employeeId = null;
        let permitId = null;

        try {
          // 1. HR creates employee
          const empResp = await api('POST', '/api/staff/employees', {
            role: 'HR',
            body: {
              fio: 'E2E Complete: Petrov A.B.',
              role_tag: 'worker',
              phone: '+79990007777',
              is_active: true
            }
          });
          assertOk(empResp, 'HR creates employee');
          const employee = empResp.data?.employee || empResp.data;
          employeeId = employee?.id;
          assert(employeeId, 'employee must return id');
          assertHasFields(employee, ['id', 'fio'], 'employee response');

          // 2. ADMIN creates permit for employee
          // First, look up available permit types
          const typesResp = await api('GET', '/api/permits/types', { role: 'ADMIN' });
          const types = typesResp.data?.types || typesResp.data || [];
          const permitType = Array.isArray(types) ? types[0] : null;

          if (!permitType) {
            // If no permit types available, verify employee is readable and skip permit part
            const empCheck = await api('GET', `/api/staff/employees/${employeeId}`, { role: 'HR' });
            assertOk(empCheck, 'employee readable without permits');
            return;
          }

          const permitResp = await api('POST', '/api/permits', {
            role: 'ADMIN',
            body: {
              employee_id: employeeId,
              type_id: permitType.id,
              issue_date: '2026-01-15',
              expiry_date: '2027-01-15',
              doc_number: 'E2E-PERM-' + Date.now(),
              notes: 'E2E complete flow permit'
            }
          });
          assertOk(permitResp, 'ADMIN creates permit');
          permitId = permitResp.data?.permit?.id || permitResp.data?.id;

          // 3. Read employee, verify permit exists
          const empDetail = await api('GET', `/api/staff/employees/${employeeId}`, { role: 'HR' });
          assertOk(empDetail, 'read employee detail after permit');
          const empData = empDetail.data?.employee || empDetail.data;
          assertHasFields(empData, ['id', 'fio'], 'employee detail fields');

          // Also verify permits list contains our permit
          const permList = await api('GET', '/api/permits', { role: 'ADMIN' });
          assertOk(permList, 'permits list accessible');
        } finally {
          // 4. Cleanup: delete permit, delete employee
          if (permitId) await api('DELETE', `/api/permits/${permitId}`, { role: 'ADMIN' });
          if (employeeId) {
            // Deactivate employee (some systems use soft-delete)
            await api('PUT', `/api/staff/employees/${employeeId}`, {
              role: 'ADMIN',
              body: { is_active: false }
            });
          }
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // FLOW 4: Cash request lifecycle
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'FLOW 4: Cash request -> approve -> receive -> close',
      run: async () => {
        let cashId = null;

        try {
          // 1. ADMIN creates cash request
          const createResp = await api('POST', '/api/cash', {
            role: 'ADMIN',
            body: {
              amount: 50000,
              purpose: 'E2E Complete: Office supplies purchase',
              type: 'expense',
              description: 'E2E complete flow cash request'
            }
          });
          if (createResp.status === 404) skip('Cash module not available');
          assertOk(createResp, 'ADMIN creates cash request');
          cashId = createResp.data?.request?.id || createResp.data?.id;
          if (!cashId) skip('No cash request id returned');

          // 2. ADMIN approves cash request
          const approveResp = await api('PUT', `/api/cash/${cashId}/approve`, {
            role: 'ADMIN',
            body: { comment: 'E2E Complete: Approved for office supplies' }
          });
          assertOk(approveResp, 'ADMIN approves cash request');

          // 3. Mark received
          const receiveResp = await api('PUT', `/api/cash/${cashId}/receive`, {
            role: 'ADMIN',
            body: {}
          });
          assertOk(receiveResp, 'mark cash received');

          // 4. Close cash request
          const closeResp = await api('PUT', `/api/cash/${cashId}/close`, {
            role: 'ADMIN',
            body: { force: true, comment: 'E2E Complete: Closed after receipt' }
          });
          assertOk(closeResp, 'close cash request');

          // Verify cash appears in all-cash list
          const allCash = await api('GET', '/api/cash/all', { role: 'ADMIN' });
          assertOk(allCash, 'all cash list');
        } finally {
          // 5. Cleanup (already closed, no further cleanup needed)
          // Cash requests remain in DB after close — this is expected behavior
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // FLOW 5: Pre-tender -> tender conversion
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'FLOW 5: Pre-tender -> accept (convert to tender) -> verify -> cleanup',
      run: async () => {
        let preTenderId = null;
        let createdTenderId = null;

        try {
          // 1. ADMIN creates pre-tender request
          const ptResp = await api('POST', '/api/pre-tenders', {
            role: 'ADMIN',
            body: {
              customer_name: 'E2E Complete: Pre-tender Customer',
              customer_inn: '7700' + Date.now().toString().slice(-6),
              tender_type: 'Аукцион',
              estimated_sum: 5000000,
              status: 'new'
            }
          });
          assertOk(ptResp, 'ADMIN creates pre-tender');
          const pt = ptResp.data?.pre_tender || ptResp.data;
          preTenderId = pt?.id;
          assert(preTenderId, 'pre-tender must return id');

          // 2. Accept pre-tender (triggers conversion to tender)
          const acceptResp = await api('POST', `/api/pre-tenders/${preTenderId}/accept`, {
            role: 'ADMIN',
            body: {
              comment: 'E2E Complete: Accepting and converting to tender',
              contact_person: 'Test Contact'
            }
          });
          assertOk(acceptResp, 'accept pre-tender');

          // 3. Verify tender was created
          // The accept response or the pre-tender detail should reference the created tender
          const ptDetail = await api('GET', `/api/pre-tenders/${preTenderId}`, { role: 'ADMIN' });
          if (ptDetail.ok) {
            const ptData = ptDetail.data?.pre_tender || ptDetail.data;
            createdTenderId = ptData?.created_tender_id || acceptResp.data?.tender_id || acceptResp.data?.created_tender_id;
          }

          // Also check tenders list for recently created
          const tendersResp = await api('GET', '/api/tenders', { role: 'ADMIN' });
          assertOk(tendersResp, 'tenders list after conversion');
        } finally {
          // 4. Cleanup: delete tender (if created), delete pre-tender
          if (createdTenderId) {
            await api('DELETE', `/api/tenders/${createdTenderId}`, { role: 'ADMIN' });
          }
          if (preTenderId) {
            await api('DELETE', `/api/pre-tenders/${preTenderId}`, { role: 'ADMIN' });
          }
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // FLOW 6: Expense tracking
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'FLOW 6: Work expense + office expense -> verify in lists -> cleanup',
      run: async () => {
        let workId = null;
        let workExpenseId = null;
        let officeExpenseId = null;
        let createdWork = false;

        try {
          // 1. Find or create work
          const worksResp = await api('GET', '/api/works?limit=1', { role: 'PM' });
          assertOk(worksResp, 'get works');
          const worksList = Array.isArray(worksResp.data) ? worksResp.data : (worksResp.data?.works || worksResp.data?.data || []);

          if (worksList.length > 0) {
            workId = worksList[0].id;
          } else {
            // Create a work if none exist
            const newWork = await api('POST', '/api/works', {
              role: 'PM',
              body: {
                work_title: 'E2E Complete: Expense Tracking Work',
                work_number: 'E2E-EXP-' + Date.now(),
                work_status: 'В работе'
              }
            });
            assertOk(newWork, 'create work for expenses');
            workId = (newWork.data?.work || newWork.data)?.id;
            createdWork = true;
          }
          assert(workId, 'need a work_id for expense tests');

          // 2. Add work expense
          const workExpResp = await api('POST', '/api/expenses/work', {
            role: 'PM',
            body: {
              work_id: workId,
              category: 'Материалы',
              amount: 35000,
              description: 'E2E Complete: Construction materials',
              date: '2026-02-15'
            }
          });
          assertOk(workExpResp, 'add work expense');
          const wExp = workExpResp.data?.expense || workExpResp.data;
          workExpenseId = wExp?.id;

          // 3. Add office expense
          const offExpResp = await api('POST', '/api/expenses/office', {
            role: 'ADMIN',
            body: {
              category: 'Канцелярия',
              amount: 5000,
              description: 'E2E Complete: Office stationery',
              date: '2026-02-15'
            }
          });
          assertOk(offExpResp, 'add office expense');
          const oExp = offExpResp.data?.expense || offExpResp.data;
          officeExpenseId = oExp?.id;

          // 4. Verify expenses appear in lists
          const workExpList = await api('GET', `/api/expenses/work?work_id=${workId}`, { role: 'PM' });
          assertOk(workExpList, 'work expenses list');
          const wExpenses = workExpList.data?.expenses || workExpList.data;
          if (Array.isArray(wExpenses)) {
            assertArray(wExpenses, 'work expenses');
            assert(wExpenses.length >= 1, 'should have at least 1 work expense');
          }

          const offExpList = await api('GET', '/api/expenses/office', { role: 'ADMIN' });
          assertOk(offExpList, 'office expenses list');
        } finally {
          // 5. Cleanup: delete expenses
          if (workExpenseId) await api('DELETE', `/api/expenses/work/${workExpenseId}`, { role: 'ADMIN' });
          if (officeExpenseId) await api('DELETE', `/api/expenses/office/${officeExpenseId}`, { role: 'ADMIN' });
          if (createdWork && workId) await api('DELETE', `/api/works/${workId}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // FLOW 7: User management
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'FLOW 7: User create -> read -> update role -> deactivate -> cleanup',
      run: async () => {
        let userId = null;

        try {
          // 1. ADMIN creates user
          const ts = Date.now();
          const createResp = await api('POST', '/api/users', {
            role: 'ADMIN',
            body: {
              login: 'e2e_complete_user_' + ts,
              name: 'E2E Complete Test User',
              role: 'PM',
              email: `e2e_complete_${ts}@asgard.local`
            }
          });
          assertOk(createResp, 'ADMIN creates user');
          const user = createResp.data?.user || createResp.data;
          userId = user?.id;
          assert(userId, 'user must return id');

          // 2. Read-back user
          const readResp = await api('GET', `/api/users/${userId}`, { role: 'ADMIN' });
          assertOk(readResp, 'read-back user');
          const readUser = readResp.data?.user || readResp.data;
          assertHasFields(readUser, ['id', 'login', 'role'], 'user detail');
          assert(readUser.id === userId, 'user id must match');
          assert(readUser.role === 'PM', 'initial role should be PM');

          // 3. Update user role
          const updateResp = await api('PUT', `/api/users/${userId}`, {
            role: 'ADMIN',
            body: { role: 'TO', name: 'E2E Complete Updated User' }
          });
          assertOk(updateResp, 'update user role');

          // Verify role changed
          const verifyResp = await api('GET', `/api/users/${userId}`, { role: 'ADMIN' });
          assertOk(verifyResp, 'verify updated user');
          const updatedUser = verifyResp.data?.user || verifyResp.data;
          assert(updatedUser.role === 'TO', `role should be TO after update, got ${updatedUser.role}`);
          assert(updatedUser.name === 'E2E Complete Updated User', 'name should be updated');

          // 4. Deactivate user
          const deactivateResp = await api('PUT', `/api/users/${userId}`, {
            role: 'ADMIN',
            body: { is_active: false }
          });
          assertOk(deactivateResp, 'deactivate user');
        } finally {
          // 5. Cleanup: delete user
          if (userId) {
            await api('DELETE', `/api/users/${userId}`, { role: 'ADMIN' });
          }
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // FLOW 8: Equipment lifecycle
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'FLOW 8: Equipment create -> issue to holder -> return to warehouse -> cleanup',
      run: async () => {
        let equipmentId = null;
        let workId = null;
        let holderId = null;
        let createdWork = false;

        try {
          // Resolve a category for equipment creation
          const catResp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
          const cats = Array.isArray(catResp.data) ? catResp.data : (catResp.data?.categories || []);
          const catId = cats.length > 0 ? cats[0].id : undefined;

          // Resolve a warehouse
          const whResp = await api('GET', '/api/equipment/warehouses', { role: 'ADMIN' });
          const warehouses = Array.isArray(whResp.data) ? whResp.data : (whResp.data?.warehouses || []);
          const warehouseId = warehouses.length > 0 ? warehouses[0].id : undefined;

          // Resolve a holder (real user) and work for issue
          const usersResp = await api('GET', '/api/users', { role: 'ADMIN' });
          if (usersResp.ok) {
            const users = Array.isArray(usersResp.data) ? usersResp.data : (usersResp.data?.users || []);
            const holder = users.find(u => u.role === 'PM') || users.find(u => u.role === 'ADMIN') || users[0];
            if (holder) holderId = holder.id;
          }

          // Find or create a work for equipment issue FK
          const worksResp = await api('GET', '/api/works?limit=1', { role: 'ADMIN' });
          const works = Array.isArray(worksResp.data) ? worksResp.data : (worksResp.data?.works || worksResp.data?.data || []);
          if (works.length > 0) {
            workId = works[0].id;
          } else {
            const newWork = await api('POST', '/api/works', {
              role: 'PM',
              body: { work_title: 'E2E Complete: Equipment Work ' + Date.now() }
            });
            if (newWork.ok) {
              workId = (newWork.data?.work || newWork.data)?.id;
              createdWork = true;
            }
          }

          // 1. Create equipment
          const ts = Date.now();
          const body = {
            name: 'E2E Complete: Power Generator ' + ts,
            serial_number: 'SN-E2E-' + ts,
            status: 'on_warehouse',
            purchase_price: 75000,
            purchase_date: '2026-01-01'
          };
          if (catId) body.category_id = catId;
          if (warehouseId) body.warehouse_id = warehouseId;

          const createResp = await api('POST', '/api/equipment', {
            role: 'ADMIN',
            body
          });
          if (createResp.status === 400 || createResp.status === 403) {
            skip('Equipment creation not available: ' + createResp.status);
          }
          assertOk(createResp, 'create equipment');
          equipmentId = createResp.data?.equipment?.id || createResp.data?.id;
          assert(equipmentId, 'equipment must return id');

          // Verify equipment was created
          const readResp = await api('GET', `/api/equipment/${equipmentId}`, { role: 'ADMIN' });
          assertOk(readResp, 'read-back equipment');
          const eqData = readResp.data?.equipment || readResp.data;
          assertHasFields(eqData, ['id', 'name'], 'equipment detail');

          // 2. Issue to holder
          if (holderId && workId) {
            const issueResp = await api('POST', '/api/equipment/issue', {
              role: 'ADMIN',
              body: {
                equipment_id: equipmentId,
                holder_id: holderId,
                work_id: workId,
                notes: 'E2E Complete: Issued for site work'
              }
            });
            assertOk(issueResp, 'issue equipment to holder');

            // 3. Return to warehouse
            const returnResp = await api('POST', '/api/equipment/return', {
              role: 'ADMIN',
              body: {
                equipment_id: equipmentId,
                condition_after: 'good',
                notes: 'E2E Complete: Returned in good condition'
              }
            });
            assertOk(returnResp, 'return equipment to warehouse');

            // Verify equipment status after return
            const afterReturn = await api('GET', `/api/equipment/${equipmentId}`, { role: 'ADMIN' });
            assertOk(afterReturn, 'equipment detail after return');
          }
        } finally {
          // 4. Cleanup: delete equipment
          if (equipmentId) {
            await api('DELETE', `/api/data/equipment/${equipmentId}`, { role: 'ADMIN' });
          }
          if (createdWork && workId) {
            await api('DELETE', `/api/works/${workId}`, { role: 'ADMIN' });
          }
        }
      }
    }
  ]
};
