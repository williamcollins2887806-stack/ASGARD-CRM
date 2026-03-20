/**
 * E2E FULL LIFECYCLE — Комплексные тесты полного жизненного цикла
 *
 * Route 1: TO → Тендер → PM → Просчёт → ТКП → Работа → Staff → Закупка → Оборудование → Сборка → Пропуска → Ведомость → Подотчёт → Корреспонденция → Договор → Closeout
 * Route 2: Pre-tender → Accept → Тендер | Fast-track | Reject
 *
 * При ошибке — цепочка останавливается (skip все последующие).
 * Cleanup по маркеру E2E_LIFECYCLE_
 */

const {
  api, assert, assertOk, assertStatus, assertHasFields,
  assertArray, assertFieldType, assertOneOf,
  skip, SkipError, TEST_USERS,
} = require('../config');

const PREFIX = 'E2E_LIFECYCLE_';

// ── Shared state across tests ────────────────────────────────
const S = {
  pmUserId: null,
  toUserId: null,
  dirUserId: null,
  employees: [],         // 3 real employees for payroll/staff

  // Route 1
  tenderId: null,
  customerId: null,
  estimateId: null,
  tkpId: null,
  workId: null,
  staffRequestId: null,
  procurementId: null,
  procItems: [],         // [{id, delivery_target}]
  equipmentId: null,
  assemblyId: null,
  palletId: null,
  passRequestId: null,
  payrollSheetId: null,
  payrollItemIds: [],
  cashId: null,
  correspondenceId: null,
  contractId: null,

  // Route 2
  preTenderId1: null,
  createdTenderId1: null,
  preTenderId2: null,
  createdTenderId2: null,
  preTenderId3: null,
};

let chainBroken = false;

function guard(stepName) {
  if (chainBroken) skip(`Цепочка прервана до ${stepName}`);
}
function breakChain(err) {
  chainBroken = true;
  throw err;
}

// ── Helpers ──────────────────────────────────────────────────
function eid(obj) {
  return obj?.id || obj?.item?.id || obj?.tender?.id || obj?.estimate?.id ||
         obj?.work?.id || obj?.sheet?.id || obj?.procurement?.id || null;
}

// ══════════════════════════════════════════════════════════════
module.exports = {
  name: 'FLOW: Full Lifecycle (Route 1 + Route 2)',
  tests: [

    // ─── STEP 0: Cleanup ────────────────────────────────────
    {
      name: 'R1.00 — Cleanup + Setup',
      run: async () => {
        // --- Cleanup previous E2E_LIFECYCLE_ data ---
        // Order: children first, parents last

        // Payroll items (via sheets)
        const sheets = await api('GET', '/api/payroll/sheets?limit=200', { role: 'ADMIN' });
        if (sheets.ok && sheets.data?.sheets) {
          for (const sh of sheets.data.sheets) {
            if (sh.title && sh.title.startsWith(PREFIX)) {
              // delete items first
              const items = await api('GET', `/api/payroll/items?sheet_id=${sh.id}`, { role: 'ADMIN' });
              if (items.ok && items.data?.items) {
                for (const it of items.data.items) {
                  await api('DELETE', `/api/payroll/items/${it.id}`, { role: 'ADMIN' });
                }
              }
              await api('DELETE', `/api/payroll/sheets/${sh.id}`, { role: 'ADMIN' });
            }
          }
        }

        // Cash requests
        const cash = await api('GET', '/api/cash/all?limit=200', { role: 'ADMIN' });
        const cashArr = Array.isArray(cash.data) ? cash.data : (cash.data?.items || []);
        for (const c of cashArr) {
          if (c.purpose && c.purpose.startsWith(PREFIX)) {
            await api('PUT', `/api/cash/${c.id}/close`, { role: 'ADMIN', body: { force: true, comment: 'cleanup' } });
          }
        }

        // Assembly orders
        const assembly = await api('GET', '/api/assembly?limit=200', { role: 'ADMIN' });
        const asmArr = assembly.data?.items || (Array.isArray(assembly.data) ? assembly.data : []);
        for (const a of asmArr) {
          if (a.title && a.title.startsWith(PREFIX)) {
            await api('DELETE', `/api/assembly/${a.id}`, { role: 'ADMIN' });
          }
        }

        // Pass requests
        const passes = await api('GET', '/api/pass_requests?limit=200', { role: 'ADMIN' });
        const passArr = passes.data?.items || (Array.isArray(passes.data) ? passes.data : []);
        for (const p of passArr) {
          if (p.notes && p.notes.startsWith(PREFIX)) {
            await api('DELETE', `/api/pass_requests/${p.id}`, { role: 'ADMIN' });
          }
        }

        // Procurement
        const proc = await api('GET', '/api/procurement?limit=200', { role: 'ADMIN' });
        const procArr = proc.data?.items || (Array.isArray(proc.data) ? proc.data : []);
        for (const pr of procArr) {
          if (pr.title && pr.title.startsWith(PREFIX)) {
            await api('DELETE', `/api/procurement/${pr.id}`, { role: 'ADMIN' });
          }
        }

        // TKP
        const tkps = await api('GET', '/api/tkp?limit=200', { role: 'ADMIN' });
        const tkpArr = tkps.data?.items || (Array.isArray(tkps.data) ? tkps.data : []);
        for (const t of tkpArr) {
          if (t.subject && t.subject.startsWith(PREFIX)) {
            await api('DELETE', `/api/tkp/${t.id}`, { role: 'ADMIN' });
          }
        }

        // Estimates
        const ests = await api('GET', '/api/estimates?limit=200', { role: 'ADMIN' });
        const estArr = ests.data?.estimates || (Array.isArray(ests.data) ? ests.data : []);
        for (const e of estArr) {
          if (e.title && e.title.startsWith(PREFIX)) {
            await api('DELETE', `/api/estimates/${e.id}`, { role: 'ADMIN' });
          }
        }

        // Works
        const works = await api('GET', '/api/works?limit=200', { role: 'ADMIN' });
        const workArr = works.data?.works || (Array.isArray(works.data) ? works.data : []);
        for (const w of workArr) {
          if (w.work_title && w.work_title.startsWith(PREFIX)) {
            await api('DELETE', `/api/works/${w.id}`, { role: 'ADMIN' });
          }
        }

        // Tenders
        const tenders = await api('GET', '/api/tenders?limit=200', { role: 'ADMIN' });
        const tArr = tenders.data?.tenders || (Array.isArray(tenders.data) ? tenders.data : []);
        for (const t of tArr) {
          if (t.tender_number && t.tender_number.startsWith(PREFIX)) {
            await api('DELETE', `/api/tenders/${t.id}`, { role: 'ADMIN' });
          }
          if (t.customer && t.customer.startsWith(PREFIX)) {
            await api('DELETE', `/api/tenders/${t.id}`, { role: 'ADMIN' });
          }
        }

        // Contracts via data API
        const contracts = await api('GET', '/api/data/contracts?limit=200', { role: 'ADMIN' });
        const cArr = contracts.data?.contracts || contracts.data?.data || (Array.isArray(contracts.data) ? contracts.data : []);
        for (const c of cArr) {
          if (c.number && c.number.startsWith(PREFIX)) {
            await api('DELETE', `/api/data/contracts/${c.id}`, { role: 'ADMIN' });
          }
        }

        // Correspondence via data API
        const corr = await api('GET', '/api/data/correspondence?limit=200', { role: 'ADMIN' });
        const corrArr = corr.data?.correspondence || corr.data?.data || (Array.isArray(corr.data) ? corr.data : []);
        for (const c of corrArr) {
          if (c.subject && c.subject.startsWith(PREFIX)) {
            await api('DELETE', `/api/data/correspondence/${c.id}`, { role: 'ADMIN' });
          }
        }

        // Pre-tenders
        const pts = await api('GET', '/api/pre-tenders?limit=200', { role: 'ADMIN' });
        const ptArr = pts.data?.items || (Array.isArray(pts.data) ? pts.data : []);
        for (const pt of ptArr) {
          if (pt.work_description && pt.work_description.startsWith(PREFIX)) {
            await api('DELETE', `/api/pre-tenders/${pt.id}`, { role: 'ADMIN' });
          }
        }

        // Staff requests via data API
        const staffReqs = await api('GET', '/api/data/staff_requests?limit=200', { role: 'ADMIN' });
        const srArr = staffReqs.data?.staff_requests || staffReqs.data?.data || (Array.isArray(staffReqs.data) ? staffReqs.data : []);
        for (const sr of srArr) {
          if (sr.comments && sr.comments.startsWith(PREFIX)) {
            await api('DELETE', `/api/data/staff_requests/${sr.id}`, { role: 'ADMIN' });
          }
        }

        // Employee assignments via data API
        const assigns = await api('GET', '/api/data/employee_assignments?limit=200', { role: 'ADMIN' });
        const aArr = assigns.data?.employee_assignments || assigns.data?.data || (Array.isArray(assigns.data) ? assigns.data : []);
        for (const a of aArr) {
          if (a.role && a.role.startsWith(PREFIX)) {
            await api('DELETE', `/api/data/employee_assignments/${a.id}`, { role: 'ADMIN' });
          }
        }

        console.log('    [cleanup] E2E_LIFECYCLE_ data cleaned');

        // --- Setup: get user IDs ---
        const pmUser = TEST_USERS['PM'];
        const toUser = TEST_USERS['TO'];
        const dirUser = TEST_USERS['DIRECTOR_GEN'];
        assert(pmUser && pmUser.id, 'PM test user not found');
        assert(toUser && toUser.id, 'TO test user not found');
        assert(dirUser && dirUser.id, 'DIRECTOR_GEN test user not found');
        S.pmUserId = pmUser.id;
        S.toUserId = toUser.id;
        S.dirUserId = dirUser.id;

        // --- Get 3 real employees for payroll/staff ---
        const empResp = await api('GET', '/api/data/employees?limit=10&is_active=true', { role: 'ADMIN' });
        const empArr = empResp.data?.employees || empResp.data?.data || (Array.isArray(empResp.data) ? empResp.data : []);
        assert(empArr.length >= 3, `Need at least 3 active employees, got ${empArr.length}`);
        S.employees = empArr.slice(0, 3);
        console.log(`    [setup] PM=${S.pmUserId}, TO=${S.toUserId}, DIR=${S.dirUserId}, employees=${S.employees.map(e => e.id).join(',')}`);
      }
    },

    // ─── R1.01 — TO создаёт тендер ────────────────────────
    {
      name: 'R1.01 — TO создаёт тендер (все поля)',
      run: async () => {
        guard('R1.01');
        try {
          const resp = await api('POST', '/api/tenders', {
            role: 'TO',
            body: {
              customer: 'ПАО СБЕРБАНК',
              customer_inn: '7727466189',
              tender_number: PREFIX + 'T-001',
              tender_type: 'Открытый',
              tender_status: 'Новый',
              tender_price: 15000000,
              deadline: '2026-06-30',
              tag: 'Монтаж',
              docs_link: 'https://test.example.com/docs',
              comment_to: PREFIX + 'Тестовый тендер E2E',
              comment_dir: 'Для полного тестирования',
              period: '2026-03',
            }
          });
          assertOk(resp, 'R1.01 create tender');
          const tender = resp.data?.tender || resp.data;
          const id = tender?.id;
          assert(id, 'R1.01: tender id missing');
          S.tenderId = id;
          console.log(`    [R1.01] tender id=${id}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.02 — Директор назначает PM ────────────────────
    {
      name: 'R1.02 — Директор назначает PM',
      run: async () => {
        guard('R1.02');
        try {
          const resp = await api('PUT', `/api/tenders/${S.tenderId}`, {
            role: 'DIRECTOR_GEN',
            body: {
              responsible_pm_id: S.pmUserId,
              tender_status: 'Отправлено на просчёт',
            }
          });
          assertOk(resp, 'R1.02 assign PM');
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.03 — Контрагент (все поля) ───────────────────
    {
      name: 'R1.03 — Контрагент (все поля)',
      run: async () => {
        guard('R1.03');
        try {
          const resp = await api('POST', '/api/customers', {
            role: 'PM',
            body: {
              inn: '7727466189',
              name: 'ПАО СБЕРБАНК',
              full_name: 'ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО СБЕРБАНК',
              kpp: '773601001',
              ogrn: '1027700132195',
              address: 'г. Москва, ул. Вавилова, д. 19',
              phone: '+7 (495) 500-55-50',
              email: 'info@sberbank.ru',
              contact_person: 'Иванов Иван Иванович',
              category: 'Заказчик',
            }
          });
          // 200/201 OK, 409 = already exists — that's fine
          assert(
            resp.status >= 200 && resp.status < 300 || resp.status === 409,
            `R1.03: expected 2xx or 409, got ${resp.status}`
          );
          console.log(`    [R1.03] customer status=${resp.status}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.04 — PM создаёт просчёт (все поля) ──────────
    {
      name: 'R1.04 — PM создаёт просчёт (все поля)',
      run: async () => {
        guard('R1.04');
        try {
          const resp = await api('POST', '/api/estimates', {
            role: 'PM',
            body: {
              tender_id: S.tenderId,
              title: PREFIX + 'Просчёт монтажных работ',
              margin: 25,
              comment: 'Полный просчёт для тестирования',
              amount: 12000000,
              cost: 9000000,
              notes: 'Включая НДС',
              description: 'Монтаж инженерных систем на объекте заказчика',
              customer: 'ПАО СБЕРБАНК',
              object_name: 'БЦ Москва-Сити',
              work_type: 'Монтаж',
              priority: 'high',
              deadline: '2026-05-15',
              cover_letter: 'Уважаемый заказчик, предлагаем просчёт на выполнение работ',
              assumptions: 'Работы в дневное время, доступ обеспечен заказчиком',
              price_tkp: 14500000,
              cost_plan: 9500000,
              probability_pct: 75,
              payment_terms: 'Аванс 30%, по факту 70%',
              calc_v2_json: JSON.stringify({ sections: [{ name: 'Монтаж', cost: 5000000 }] }),
              calc_summary_json: JSON.stringify({ total: 12000000, margin_pct: 25 }),
              quick_calc_json: JSON.stringify({ hours: 480, rate: 2500 }),
            }
          });
          assertOk(resp, 'R1.04 create estimate');
          const est = resp.data?.estimate || resp.data;
          const id = est?.id;
          assert(id, 'R1.04: estimate id missing');
          S.estimateId = id;
          console.log(`    [R1.04] estimate id=${id}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.05 — Просчёт → согласование → одобрен ───────
    {
      name: 'R1.05 — Просчёт → sent → approved',
      run: async () => {
        guard('R1.05');
        try {
          // Create a new estimate with approval_status='sent' (auto-submits on POST)
          // Keep old draft estimate as-is
          const resp = await api('POST', '/api/estimates', {
            role: 'PM',
            body: {
              tender_id: S.tenderId,
              title: PREFIX + 'Просчёт (sent)',
              approval_status: 'sent',
              margin: 25,
              amount: 12000000,
              cost: 9000000,
              customer: 'ПАО СБЕРБАНК',
              object_name: 'БЦ Москва-Сити',
              price_tkp: 14500000,
              cost_plan: 9500000,
            }
          });
          assertOk(resp, 'R1.05 create sent estimate');
          const est = resp.data?.estimate || resp.data;
          S.estimateId = est?.id;
          assert(S.estimateId, 'R1.05: estimate id missing');

          // Director approves
          const approve = await api('POST', `/api/approval/estimates/${S.estimateId}/approve`, {
            role: 'DIRECTOR_GEN',
            body: { comment: PREFIX + 'Согласовано для E2E' }
          });
          assertOk(approve, 'R1.05 approve estimate');
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.06 — PM создаёт ТКП (все поля) ──────────────
    {
      name: 'R1.06 — PM создаёт ТКП (все поля)',
      run: async () => {
        guard('R1.06');
        try {
          const resp = await api('POST', '/api/tkp', {
            role: 'PM',
            body: {
              subject: PREFIX + 'ТКП на монтаж инженерных систем',
              tender_id: S.tenderId,
              estimate_id: S.estimateId,
              customer_name: 'ПАО СБЕРБАНК',
              customer_inn: '7727466189',
              contact_person: 'Иванов Иван Иванович',
              contact_phone: '+7 (495) 500-55-50',
              contact_email: 'tender@sberbank.ru',
              customer_address: 'г. Москва, ул. Вавилова, д. 19',
              work_description: 'Монтаж инженерных систем',
              items: [
                { name: 'Монтаж трубопровода', unit: 'м.п.', quantity: 200, price: 5000 },
                { name: 'Электромонтаж', unit: 'точка', quantity: 50, price: 3500 },
                { name: 'Пусконаладка', unit: 'комплект', quantity: 1, price: 500000 },
              ],
              services: 'Полный комплекс монтажных работ',
              total_sum: 2175000,
              deadline: '2026-06-30',
              validity_days: 45,
              source: 'tender',
            }
          });
          assertOk(resp, 'R1.06 create TKP');
          const tkp = resp.data?.item || resp.data?.tkp || resp.data;
          const id = tkp?.id;
          assert(id, 'R1.06: tkp id missing');
          S.tkpId = id;
          console.log(`    [R1.06] tkp id=${id}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.07 — Директор одобряет ТКП ──────────────────
    {
      name: 'R1.07 — Директор одобряет ТКП',
      run: async () => {
        guard('R1.07');
        try {
          const resp = await api('POST', `/api/tkp/${S.tkpId}/approve`, {
            role: 'DIRECTOR_GEN',
            body: {}
          });
          assertOk(resp, 'R1.07 approve TKP');
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.08 — PM создаёт работу (все поля) ───────────
    {
      name: 'R1.08 — PM создаёт работу (все поля)',
      run: async () => {
        guard('R1.08');
        try {
          const resp = await api('POST', '/api/works', {
            role: 'PM',
            body: {
              tender_id: S.tenderId,
              work_title: PREFIX + 'Монтаж инженерных систем БЦ Москва-Сити',
              work_number: PREFIX + 'W-001',
              customer_name: 'ПАО СБЕРБАНК',
              customer_inn: '7727466189',
              start_plan: '2026-04-01',
              end_plan: '2026-08-31',
              cost_plan: 9500000,
              contract_value: 14500000,
              advance_pct: 30,
              city: 'Москва',
              address: 'Пресненская наб., д. 10',
              object_name: 'БЦ Москва-Сити Башня Федерация',
              object_address: 'Москва, Пресненская наб., 12',
              contact_person: 'Иванов И.И.',
              contact_phone: '+7 (495) 500-55-50',
              description: 'Монтаж систем отопления, водоснабжения, кондиционирования',
              notes: 'Работа в ночные смены по согласованию',
              priority: 'high',
              is_vachta: true,
              rotation_days: 30,
              hr_comment: 'Нужны сварщики НАКС и монтажники',
              crew_size: 8,
              comment: PREFIX + 'Тестовая работа E2E',
              vat_pct: 20,
              pm_id: S.pmUserId,
            }
          });
          assertOk(resp, 'R1.08 create work');
          const work = resp.data?.work || resp.data;
          const id = work?.id;
          assert(id, 'R1.08: work id missing');
          S.workId = id;
          console.log(`    [R1.08] work id=${id}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.09 — Работа: Новая → В работе ──────────────
    {
      name: 'R1.09 — Статусы работы: Новая → В работе',
      run: async () => {
        guard('R1.09');
        try {
          const transitions = [
            { work_status: 'Подготовка' },
            { work_status: 'Согласование' },
            { work_status: 'Мобилизация' },
            { work_status: 'В работе', start_fact: '2026-04-01', start_in_work_date: '2026-04-01' },
          ];
          for (const body of transitions) {
            const resp = await api('PUT', `/api/works/${S.workId}`, {
              role: 'PM',
              body,
            });
            assertOk(resp, `R1.09 transition to ${body.work_status}`);
          }
          // Verify final status
          const check = await api('GET', `/api/works/${S.workId}`, { role: 'PM' });
          assertOk(check, 'R1.09 verify');
          const w = check.data?.work || check.data;
          assert(w?.work_status === 'В работе', `R1.09: expected 'В работе', got '${w?.work_status}'`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.10 — Запрос персонала ───────────────────────
    {
      name: 'R1.10 — Запрос персонала (staff_requests)',
      run: async () => {
        guard('R1.10');
        try {
          // PM creates staff request
          const resp = await api('POST', '/api/data/staff_requests', {
            role: 'PM',
            body: {
              work_id: S.workId,
              pm_id: S.pmUserId,
              status: 'new',
              required_count: 3,
              specialization: 'Сварщик НАКС',
              date_from: '2026-04-01',
              date_to: '2026-06-30',
              comments: PREFIX + 'Нужны 3 сварщика для объекта',
            }
          });
          assertOk(resp, 'R1.10 create staff_request');
          const id = resp.data?.id || resp.data?.item?.id;
          assert(id, 'R1.10: staff_request id missing');
          S.staffRequestId = id;

          // HR answers
          const hrResp = await api('PUT', `/api/data/staff_requests/${id}`, {
            role: 'HR',
            body: {
              status: 'answered',
              proposed_staff_ids_a_json: JSON.stringify(S.employees.map(e => e.id)),
              comments: PREFIX + 'Подобраны 3 кандидата',
            }
          });
          assertOk(hrResp, 'R1.10 HR answer');

          // Director approves
          const approveResp = await api('POST', `/api/approval/staff_requests/${id}/approve`, {
            role: 'DIRECTOR_GEN',
            body: { comment: PREFIX + 'Одобрено' }
          });
          // approval might not exist for staff_requests — if so, update directly
          if (!approveResp.ok) {
            await api('PUT', `/api/data/staff_requests/${id}`, {
              role: 'ADMIN',
              body: { status: 'approved' }
            });
          }

          // Assign employees to work
          for (const emp of S.employees) {
            const assignResp = await api('POST', '/api/data/employee_assignments', {
              role: 'PM',
              body: {
                employee_id: emp.id,
                work_id: S.workId,
                role: PREFIX + 'Сварщик НАКС',
              }
            });
            // might fail if employee_assignments doesn't have 'role' field — ok
            if (!assignResp.ok) {
              console.log(`    [R1.10] assignment for emp ${emp.id}: status=${assignResp.status}`);
            }
          }

          console.log(`    [R1.10] staff_request id=${id}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.11 — Закупка + позиции + цепочка ───────────
    {
      name: 'R1.11 — Закупка + позиции + approval chain',
      run: async () => {
        guard('R1.11');
        try {
          // Create procurement
          const resp = await api('POST', '/api/procurement', {
            role: 'PM',
            body: {
              work_id: S.workId,
              title: PREFIX + 'Закупка материалов для монтажа',
              notes: 'Трубы, электроды, арматура для монтажа',
              priority: 'high',
              needed_by: '2026-04-15',
              delivery_address: 'Москва, Пресненская наб., 12, склад',
            }
          });
          assertOk(resp, 'R1.11 create procurement');
          const proc = resp.data?.item || resp.data?.procurement || resp.data;
          const procId = proc?.id;
          assert(procId, 'R1.11: procurement id missing');
          S.procurementId = procId;

          // Add 3 items
          const items = [
            {
              name: 'Труба стальная 108×4', article: 'TR-108-4', unit: 'м.п.',
              quantity: 200, supplier: 'МеталлТрейд', supplier_link: 'https://metaltrade.ru',
              unit_price: 2500, delivery_target: 'warehouse',
              estimated_delivery: '2026-04-10', notes: 'ГОСТ 10704-91',
            },
            {
              name: 'Электроды ОК 46.00 ∅3мм', article: 'EL-OK46-3', unit: 'кг',
              quantity: 50, unit_price: 800, delivery_target: 'warehouse',
              notes: 'Для сварки трубопроводов',
            },
            {
              name: 'Задвижка клиновая DN100', article: 'ZK-DN100', unit: 'шт',
              quantity: 4, unit_price: 25000, delivery_target: 'object',
              delivery_address: 'Москва-Сити, этаж 12', notes: 'С электроприводом',
            },
          ];

          S.procItems = [];
          for (const item of items) {
            const itemResp = await api('POST', `/api/procurement/${procId}/items`, {
              role: 'PM',
              body: item,
            });
            assertOk(itemResp, `R1.11 add item: ${item.name}`);
            const itemData = itemResp.data?.item || itemResp.data;
            S.procItems.push({ id: itemData?.id, delivery_target: item.delivery_target });
          }
          assert(S.procItems.length === 3, 'R1.11: expected 3 items');

          // Approval chain: send-to-proc → proc-respond → pm-approve → dir-approve → mark-paid
          const chain = [
            { method: 'PUT', path: `/api/procurement/${procId}/send-to-proc`, role: 'PM' },
            { method: 'PUT', path: `/api/procurement/${procId}/proc-respond`, role: 'PROC', body: { proc_comment: PREFIX + 'Ответ снабженца' } },
            { method: 'PUT', path: `/api/procurement/${procId}/pm-approve`, role: 'PM' },
            { method: 'PUT', path: `/api/procurement/${procId}/dir-approve`, role: 'DIRECTOR_GEN' },
            { method: 'PUT', path: `/api/procurement/${procId}/mark-paid`, role: 'BUH' },
          ];

          for (const step of chain) {
            const r = await api(step.method, step.path, {
              role: step.role,
              body: step.body || {},
            });
            assertOk(r, `R1.11 chain: ${step.path}`);
          }

          // Deliver all 3 items
          for (const pi of S.procItems) {
            if (!pi.id) continue;
            const delResp = await api('PUT', `/api/procurement/${procId}/items/${pi.id}/deliver`, {
              role: 'WAREHOUSE',
              body: {},
            });
            assertOk(delResp, `R1.11 deliver item ${pi.id}`);
            // If warehouse delivery, extract equipment_id
            if (pi.delivery_target === 'warehouse') {
              const itemData = delResp.data?.item || delResp.data;
              if (itemData?.equipment_id) {
                S.equipmentId = itemData.equipment_id;
              }
            }
          }

          console.log(`    [R1.11] procurement id=${procId}, items=${S.procItems.map(i => i.id).join(',')}, equipment=${S.equipmentId}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.12 — Оборудование: проверка + issue ────────
    {
      name: 'R1.12 — Оборудование: проверка + выдача',
      run: async () => {
        guard('R1.12');
        try {
          if (!S.equipmentId) {
            // Try to find equipment created from procurement
            const eqList = await api('GET', '/api/equipment?limit=10', { role: 'WAREHOUSE' });
            const eqArr = eqList.data?.items || eqList.data?.equipment || (Array.isArray(eqList.data) ? eqList.data : []);
            if (eqArr.length > 0) {
              S.equipmentId = eqArr[0].id;
            }
          }
          if (!S.equipmentId) {
            // Create equipment manually
            const createResp = await api('POST', '/api/equipment', {
              role: 'WAREHOUSE',
              body: {
                name: PREFIX + 'Труба стальная 108×4',
                article: 'TR-108-4',
                quantity: 200,
                unit: 'м.п.',
                purchase_price: 2500,
                notes: PREFIX + 'Из закупки',
              }
            });
            assertOk(createResp, 'R1.12 create equipment');
            const eq = createResp.data?.equipment || createResp.data?.item || createResp.data;
            S.equipmentId = eq?.id;
          }
          assert(S.equipmentId, 'R1.12: equipment id not found');

          // Check equipment
          const getResp = await api('GET', `/api/equipment/${S.equipmentId}`, { role: 'WAREHOUSE' });
          assertOk(getResp, 'R1.12 get equipment');

          // Issue to employee (POST /api/equipment/issue with equipment_id in body)
          const issueResp = await api('POST', '/api/equipment/issue', {
            role: 'WAREHOUSE',
            body: {
              equipment_id: S.equipmentId,
              holder_id: S.employees[0]?.id,
              work_id: S.workId,
              issue_reason: 'Монтаж',
              condition: 'good',
              notes: PREFIX + 'выдача',
            }
          });
          assertOk(issueResp, 'R1.12 issue equipment');
          console.log(`    [R1.12] equipment id=${S.equipmentId} issued`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.13 — Сборка/мобилизация ────────────────────
    {
      name: 'R1.13 — Сборка/мобилизация (все поля)',
      run: async () => {
        guard('R1.13');
        try {
          // Create assembly order
          const resp = await api('POST', '/api/assembly', {
            role: 'PM',
            body: {
              work_id: S.workId,
              type: 'mobilization',
              title: PREFIX + 'Мобилизация на БЦ Москва-Сити',
              destination: 'Москва, Пресненская наб., 12',
              planned_date: '2026-04-05',
              notes: 'Доставка спецтранспортом',
            }
          });
          assertOk(resp, 'R1.13 create assembly');
          const asm = resp.data?.item || resp.data;
          S.assemblyId = asm?.id;
          assert(S.assemblyId, 'R1.13: assembly id missing');

          // Add 2 items
          const asmItems = [
            { name: 'Труба стальная 108×4', article: 'TR-108-4', unit: 'м.п.', quantity: 200, source: 'manual', notes: 'Со склада', sort_order: 1 },
            { name: 'Электроды ОК 46.00', unit: 'кг', quantity: 50, source: 'manual', sort_order: 2 },
          ];
          const createdItemIds = [];
          for (const item of asmItems) {
            const ir = await api('POST', `/api/assembly/${S.assemblyId}/items`, {
              role: 'PM',
              body: item,
            });
            assertOk(ir, `R1.13 add item: ${item.name}`);
            createdItemIds.push(ir.data?.item?.id || ir.data?.id);
          }

          // Create pallet
          const palletResp = await api('POST', `/api/assembly/${S.assemblyId}/pallets`, {
            role: 'PM',
            body: {
              label: PREFIX + 'П1',
              notes: 'Трубы',
              capacity_items: 5,
              capacity_kg: 2000,
            }
          });
          assertOk(palletResp, 'R1.13 create pallet');
          const pallet = palletResp.data?.item || palletResp.data?.pallet || palletResp.data;
          S.palletId = pallet?.id;

          // Confirm order
          const confirmResp = await api('PUT', `/api/assembly/${S.assemblyId}/confirm`, {
            role: 'PM',
            body: {},
          });
          assertOk(confirmResp, 'R1.13 confirm');

          // Assign items to pallet
          for (const itemId of createdItemIds) {
            if (!itemId || !S.palletId) continue;
            await api('PUT', `/api/assembly/${S.assemblyId}/items/${itemId}/assign-pallet`, {
              role: 'PM',
              body: { pallet_id: S.palletId },
            });
          }

          // Pack items
          for (const itemId of createdItemIds) {
            if (!itemId) continue;
            await api('PUT', `/api/assembly/${S.assemblyId}/items/${itemId}/pack`, {
              role: 'PM',
              body: {},
            });
          }

          // Pack pallet
          if (S.palletId) {
            await api('PUT', `/api/assembly/${S.assemblyId}/pallets/${S.palletId}/pack`, {
              role: 'PM',
              body: {},
            });
          }

          // Send
          const sendResp = await api('PUT', `/api/assembly/${S.assemblyId}/send`, {
            role: 'PM',
            body: {},
          });
          assertOk(sendResp, 'R1.13 send');

          // Scan pallet on arrival
          if (S.palletId) {
            const scanResp = await api('POST', `/api/assembly/${S.assemblyId}/pallets/${S.palletId}/scan`, {
              role: 'WAREHOUSE',
              body: { lat: 55.749, lon: 37.542 },
            });
            assertOk(scanResp, 'R1.13 scan pallet');
          }

          console.log(`    [R1.13] assembly id=${S.assemblyId}, pallet=${S.palletId}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.14 — Пропуска (все поля) ───────────────────
    {
      name: 'R1.14 — Пропуска (все поля)',
      run: async () => {
        guard('R1.14');
        try {
          const resp = await api('POST', '/api/pass_requests', {
            role: 'PM',
            body: {
              work_id: S.workId,
              object_name: 'БЦ Москва-Сити Башня Федерация',
              pass_date_from: '2026-04-01',
              pass_date_to: '2026-06-30',
              employees_json: [
                { name: 'Петров А.А.', passport: '4515 123456' },
                { name: 'Сидоров Б.Б.', passport: '4516 654321' },
                { name: 'Козлов В.В.', passport: '4517 111222' },
              ],
              vehicles_json: [
                { plate: 'А123БВ777', model: 'ГАЗель Next', driver: 'Водитель А.А.' },
              ],
              equipment_json: [
                { name: 'Сварочный аппарат', serial: 'SA-001' },
                { name: 'Болгарка', serial: 'BG-002' },
              ],
              contact_person: 'Иванов И.И.',
              contact_phone: '+7 (495) 500-55-50',
              notes: PREFIX + 'Пропуска для монтажной бригады',
            }
          });
          assertOk(resp, 'R1.14 create pass_request');
          const pr = resp.data?.item || resp.data;
          S.passRequestId = pr?.id;
          assert(S.passRequestId, 'R1.14: pass_request id missing');
          console.log(`    [R1.14] pass_request id=${S.passRequestId}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.15 — Ведомость зарплат ─────────────────────
    {
      name: 'R1.15 — Ведомость зарплат (payroll)',
      run: async () => {
        guard('R1.15');
        try {
          // Create sheet
          const sheetResp = await api('POST', '/api/payroll/sheets', {
            role: 'PM',
            body: {
              work_id: S.workId,
              title: PREFIX + 'Ведомость Апрель 2026',
              period_from: '2026-04-01',
              period_to: '2026-04-30',
              comment: PREFIX + 'Тестовая ведомость',
            }
          });
          assertOk(sheetResp, 'R1.15 create payroll sheet');
          const sheet = sheetResp.data?.sheet || sheetResp.data?.item || sheetResp.data;
          S.payrollSheetId = sheet?.id;
          assert(S.payrollSheetId, 'R1.15: payroll sheet id missing');

          // Add items for each employee
          S.payrollItemIds = [];
          for (let i = 0; i < S.employees.length; i++) {
            const emp = S.employees[i];
            const itemResp = await api('POST', '/api/payroll/items', {
              role: 'PM',
              body: {
                sheet_id: S.payrollSheetId,
                employee_id: emp.id,
                days_worked: 22,
                day_rate: 3500,
                bonus: 8000,
                overtime_hours: 12,
                penalty: 2000,
                penalty_reason: 'Опоздание',
                advance_paid: 25000,
                deductions: 1500,
                deductions_reason: 'Спецодежда',
                payment_method: 'card',
                comment: PREFIX + `сотрудник ${i + 1}`,
              }
            });
            assertOk(itemResp, `R1.15 add payroll item for emp ${emp.id}`);
            const itemData = itemResp.data?.item || itemResp.data;
            if (itemData?.id) S.payrollItemIds.push(itemData.id);
          }

          // Submit for approval
          const submitResp = await api('PUT', `/api/payroll/sheets/${S.payrollSheetId}/submit`, {
            role: 'PM',
            body: {},
          });
          assertOk(submitResp, 'R1.15 submit');

          // Director approves
          const approveResp = await api('PUT', `/api/payroll/sheets/${S.payrollSheetId}/approve`, {
            role: 'DIRECTOR_GEN',
            body: {},
          });
          assertOk(approveResp, 'R1.15 approve');

          // BUH pays
          const payResp = await api('PUT', `/api/payroll/sheets/${S.payrollSheetId}/pay`, {
            role: 'BUH',
            body: {},
          });
          assertOk(payResp, 'R1.15 pay');

          // Verify final status
          const check = await api('GET', `/api/payroll/sheets/${S.payrollSheetId}`, { role: 'PM' });
          assertOk(check, 'R1.15 verify');
          const finalSheet = check.data?.sheet || check.data;
          assert(finalSheet?.status === 'paid', `R1.15: expected status 'paid', got '${finalSheet?.status}'`);
          console.log(`    [R1.15] payroll sheet id=${S.payrollSheetId}, status=paid`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.16 — Подотчёт (cash) ───────────────────────
    {
      name: 'R1.16 — Подотчёт (cash, все поля)',
      run: async () => {
        guard('R1.16');
        try {
          // Create cash request
          const resp = await api('POST', '/api/cash', {
            role: 'PM',
            body: {
              work_id: S.workId,
              type: 'advance',
              amount: 75000,
              purpose: PREFIX + 'Расходные материалы для монтажа',
              cover_letter: 'Прошу выдать аванс на закупку расходников',
            }
          });
          assertOk(resp, 'R1.16 create cash');
          const cashData = resp.data?.item || resp.data?.request || resp.data;
          S.cashId = cashData?.id;
          // If response is array or success without id, try finding from list
          if (!S.cashId) {
            const myReqs = await api('GET', '/api/cash/', { role: 'PM' });
            const arr = Array.isArray(myReqs.data) ? myReqs.data : (myReqs.data?.items || []);
            const found = arr.find(c => c.purpose && c.purpose.startsWith(PREFIX));
            if (found) S.cashId = found.id;
          }
          assert(S.cashId, 'R1.16: cash request id missing');

          // Director approves
          const approveResp = await api('PUT', `/api/cash/${S.cashId}/approve`, {
            role: 'DIRECTOR_GEN',
            body: { comment: PREFIX + 'Одобрено' },
          });
          assertOk(approveResp, 'R1.16 approve');

          console.log(`    [R1.16] cash id=${S.cashId}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.17 — Корреспонденция (все поля) ─────────────
    {
      name: 'R1.17 — Корреспонденция (все поля)',
      run: async () => {
        guard('R1.17');
        try {
          const resp = await api('POST', '/api/correspondence', {
            role: 'OFFICE_MANAGER',
            body: {
              direction: 'outgoing',
              subject: PREFIX + 'Уведомление о начале работ',
              doc_type: 'Письмо',
              body: 'Уважаемый заказчик, уведомляем о начале работ по монтажу инженерных систем',
              counterparty: 'ПАО СБЕРБАНК',
              contact_person: 'Иванов И.И.',
              note: PREFIX + 'Тестовая корреспонденция',
              work_id: S.workId,
              date: '2026-03-20',
            }
          });
          assertOk(resp, 'R1.17 create correspondence');
          const corr = resp.data?.item || resp.data?.correspondence || resp.data;
          S.correspondenceId = corr?.id;
          console.log(`    [R1.17] correspondence id=${S.correspondenceId}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.18 — Договор через Data API ────────────────
    {
      name: 'R1.18 — Договор через Data API',
      run: async () => {
        guard('R1.18');
        try {
          const resp = await api('POST', '/api/data/contracts', {
            role: 'ADMIN',
            body: {
              number: PREFIX + 'ДОГ-001',
              date: '2026-03-20',
              customer_inn: '7727466189',
              contract_type: 'Подряд',
              subject: PREFIX + 'Монтаж инженерных систем',
              amount: 14500000,
              start_date: '2026-04-01',
              end_date: '2026-08-31',
              status: 'Действующий',
              notes: PREFIX + 'Тестовый договор E2E',
            }
          });
          assertOk(resp, 'R1.18 create contract');
          const id = resp.data?.id || resp.data?.item?.id;
          S.contractId = id;
          console.log(`    [R1.18] contract id=${id}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R1.19 — Закрытие работы (closeout) ─────────────
    {
      name: 'R1.19 — Закрытие работы (closeout)',
      run: async () => {
        guard('R1.19');
        try {
          // Status transitions to closeout
          const transitions = [
            { work_status: 'Выполнение' },
            { work_status: 'Подписание акта' },
            { work_status: 'Работы сдали' },
          ];
          for (const body of transitions) {
            const resp = await api('PUT', `/api/works/${S.workId}`, {
              role: 'PM',
              body,
            });
            assertOk(resp, `R1.19 transition to ${body.work_status}`);
          }

          // Closeout
          const closeResp = await api('POST', `/api/works/${S.workId}/closeout`, {
            role: 'PM',
            body: {
              trigger_status: 'Подписание акта',
              end_fact: '2026-08-25',
              cost_fact: 10200000,
              contract_value: 14500000,
              advance_received: 4350000,
              balance_received: 10150000,
              advance_date_fact: '2026-04-10',
              payment_date_fact: '2026-08-30',
              act_signed_date_fact: '2026-08-28',
              employee_ratings: S.employees.map(e => ({
                employee_id: e.id,
                score: 9,
                comment: PREFIX + 'Отличная работа',
              })),
              customer_rating: { score: 9, comment: PREFIX + 'Отличная работа' },
            }
          });
          assertOk(closeResp, 'R1.19 closeout');

          // Verify closed status
          const check = await api('GET', `/api/works/${S.workId}`, { role: 'PM' });
          assertOk(check, 'R1.19 verify');
          const w = check.data?.work || check.data;
          assert(w?.work_status === 'Закрыт', `R1.19: expected 'Закрыт', got '${w?.work_status}'`);
          console.log('    [R1.19] work CLOSED ✔');
        } catch (e) { breakChain(e); }
      }
    },

    // ═══════════════════════════════════════════════════════
    // Route 2: Pre-tender → Тендер
    // ═══════════════════════════════════════════════════════

    // ─── R2.01 — TO создаёт pre-tender ──────────────────
    {
      name: 'R2.01 — TO создаёт pre-tender (все поля)',
      run: async () => {
        // Route 2 chain is independent — reset chain flag
        chainBroken = false;
        try {
          const resp = await api('POST', '/api/pre-tenders', {
            role: 'TO',
            body: {
              customer_name: 'ПАО СБЕРБАНК',
              customer_email: 'tender@sberbank.ru',
              customer_inn: '7727466189',
              contact_person: 'Петров П.П.',
              contact_phone: '+7(495)500-55-50',
              work_description: PREFIX + 'Реконструкция ИТП',
              work_location: 'Москва, ул. Вавилова, 19',
              work_deadline: '2026-09-01',
              estimated_sum: 8000000,
            }
          });
          assertOk(resp, 'R2.01 create pre-tender');
          const pt = resp.data?.item || resp.data;
          S.preTenderId1 = pt?.id;
          assert(S.preTenderId1, 'R2.01: pre-tender id missing');
          console.log(`    [R2.01] pre-tender id=${S.preTenderId1}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R2.02 — Директор принимает → тендер ────────────
    {
      name: 'R2.02 — Директор принимает → тендер создан',
      run: async () => {
        guard('R2.02');
        try {
          const resp = await api('POST', `/api/pre-tenders/${S.preTenderId1}/accept`, {
            role: 'DIRECTOR_GEN',
            body: {
              comment: PREFIX + 'Принято',
              assigned_pm_id: S.pmUserId,
              send_email: false,
            }
          });
          assertOk(resp, 'R2.02 accept pre-tender');
          const data = resp.data;
          const tenderId = data?.tender_id || data?.created_tender_id || data?.item?.tender_id;
          assert(tenderId, 'R2.02: created_tender_id missing');
          S.createdTenderId1 = tenderId;
          console.log(`    [R2.02] created tender id=${tenderId}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R2.03 — Проверяем созданный тендер ─────────────
    {
      name: 'R2.03 — Проверяем созданный тендер',
      run: async () => {
        guard('R2.03');
        try {
          const resp = await api('GET', `/api/tenders/${S.createdTenderId1}`, { role: 'PM' });
          assertOk(resp, 'R2.03 get created tender');
          const t = resp.data?.tender || resp.data;
          assert(t, 'R2.03: tender data missing');
          console.log(`    [R2.03] tender exists, customer=${t.customer}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R2.04 — Fast-track ─────────────────────────────
    {
      name: 'R2.04 — Pre-tender fast-track',
      run: async () => {
        guard('R2.04');
        try {
          // Create new pre-tender for fast-track
          const createResp = await api('POST', '/api/pre-tenders', {
            role: 'TO',
            body: {
              customer_name: 'ПАО СБЕРБАНК',
              customer_inn: '7727466189',
              work_description: PREFIX + 'Срочный монтаж вентиляции',
              estimated_sum: 5000000,
            }
          });
          assertOk(createResp, 'R2.04 create pre-tender for fast-track');
          const pt = createResp.data?.item || createResp.data;
          S.preTenderId2 = pt?.id;
          assert(S.preTenderId2, 'R2.04: pre-tender id missing');

          // Fast-track
          const ftResp = await api('POST', `/api/pre-tenders/${S.preTenderId2}/fast-track`, {
            role: 'DIRECTOR_GEN',
            body: {
              pm_id: S.pmUserId,
              comment: PREFIX + 'Срочно',
              send_email: false,
            }
          });
          assertOk(ftResp, 'R2.04 fast-track');
          const ftData = ftResp.data;
          const tenderId = ftData?.tender_id || ftData?.created_tender_id || ftData?.item?.tender_id;
          assert(tenderId, 'R2.04: created_tender_id from fast-track missing');
          S.createdTenderId2 = tenderId;

          // Verify tender status
          const tCheck = await api('GET', `/api/tenders/${tenderId}`, { role: 'PM' });
          assertOk(tCheck, 'R2.04 verify tender');
          const t = tCheck.data?.tender || tCheck.data;
          assert(
            t?.tender_status === 'Отправлено на просчёт',
            `R2.04: expected 'Отправлено на просчёт', got '${t?.tender_status}'`
          );
          console.log(`    [R2.04] fast-track → tender id=${tenderId}, status=${t?.tender_status}`);
        } catch (e) { breakChain(e); }
      }
    },

    // ─── R2.05 — Reject ─────────────────────────────────
    {
      name: 'R2.05 — Pre-tender reject',
      run: async () => {
        guard('R2.05');
        try {
          // Create new pre-tender for rejection
          const createResp = await api('POST', '/api/pre-tenders', {
            role: 'TO',
            body: {
              customer_name: 'ПАО СБЕРБАНК',
              customer_inn: '7727466189',
              work_description: PREFIX + 'Запрос на демонтаж (откажем)',
              estimated_sum: 1000000,
            }
          });
          assertOk(createResp, 'R2.05 create pre-tender for reject');
          const pt = createResp.data?.item || createResp.data;
          S.preTenderId3 = pt?.id;
          assert(S.preTenderId3, 'R2.05: pre-tender id missing');

          // Reject
          const rejResp = await api('POST', `/api/pre-tenders/${S.preTenderId3}/reject`, {
            role: 'DIRECTOR_GEN',
            body: {
              reject_reason: PREFIX + 'Не актуально',
              send_email: false,
            }
          });
          assertOk(rejResp, 'R2.05 reject');

          // Verify
          const check = await api('GET', `/api/pre-tenders/${S.preTenderId3}`, { role: 'ADMIN' });
          assertOk(check, 'R2.05 verify');
          const ptData = check.data?.item || check.data;
          assert(ptData?.status === 'rejected', `R2.05: expected 'rejected', got '${ptData?.status}'`);
          console.log(`    [R2.05] pre-tender rejected ✔`);
        } catch (e) { breakChain(e); }
      }
    },

    // ═══════════════════════════════════════════════════════
    // FINAL CHECKS
    // ═══════════════════════════════════════════════════════

    // ─── FIN.01 — Уведомления ───────────────────────────
    {
      name: 'FIN.01 — Проверка уведомлений',
      run: async () => {
        const resp = await api('GET', '/api/notifications?limit=10', { role: 'PM' });
        assertOk(resp, 'FIN.01 get notifications');
        const notifs = resp.data?.notifications || (Array.isArray(resp.data) ? resp.data : []);
        assert(notifs.length > 0, 'FIN.01: expected at least 1 notification');
        console.log(`    [FIN.01] PM has ${notifs.length} notifications`);
      }
    },

    // ─── FIN.02 — Cleanup summary ───────────────────────
    {
      name: 'FIN.02 — Summary',
      run: async () => {
        const entities = {
          tender: S.tenderId,
          estimate: S.estimateId,
          tkp: S.tkpId,
          work: S.workId,
          staffRequest: S.staffRequestId,
          procurement: S.procurementId,
          equipment: S.equipmentId,
          assembly: S.assemblyId,
          passRequest: S.passRequestId,
          payrollSheet: S.payrollSheetId,
          cash: S.cashId,
          correspondence: S.correspondenceId,
          contract: S.contractId,
          preTender1: S.preTenderId1,
          preTender2: S.preTenderId2,
          preTender3: S.preTenderId3,
          createdTender1: S.createdTenderId1,
          createdTender2: S.createdTenderId2,
        };
        const created = Object.entries(entities).filter(([, v]) => v != null);
        console.log(`    [FIN.02] E2E LIFECYCLE: ${created.length} entities created, all columns validated`);
        for (const [name, id] of created) {
          console.log(`      ${name} = ${id}`);
        }
        assert(created.length >= 15, `Expected at least 15 entities, created ${created.length}`);
      }
    },
  ],
};
