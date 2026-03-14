/**
 * E2E FLOW 10: Pre-tender to tender conversion
 * TO creates pre-tender -> reviews -> accepts (converts to tender) -> PM picks up tender -> creates estimate
 * Routes: /api/pre-tenders (POST, GET, POST /:id/accept)
 *         /api/tenders (GET, POST, DELETE)
 *         /api/estimates (POST, DELETE)
 */
const { api, assert, assertOk, assertForbidden, skip } = require("../config");

module.exports = {
  name: "FLOW: Pre-Tender to Tender Conversion",
  tests: [
    {
      name: "TO creates pre-tender, accepts it, PM picks up tender, creates estimate, cleanup",
      run: async () => {
        // Get PM user ID for assignment
        const users = await api("GET", "/api/users", { role: "ADMIN" });
        const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        const pmUser = userList.find(u => u.role === "PM" && u.is_active !== false);
        if (!pmUser) skip("Need active PM user");
        const pmId = pmUser.id;

        // 1. TO creates a pre-tender manually
        const createResp = await api("POST", "/api/pre-tenders", {
          role: "TO",
          body: {
            customer_name: "E2E Test Customer Corp",
            customer_email: "e2e-customer@example.com",
            customer_inn: "1234567890",
            contact_person: "John E2E",
            contact_phone: "+7-999-123-4567",
            work_description: "E2E: Installation of electrical systems",
            work_location: "Moscow, Test Street 42",
            work_deadline: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
            estimated_sum: 500000
          }
        });
        if (createResp.status === 404) skip("pre-tenders endpoint not available");
        assertOk(createResp, "TO create pre-tender");
        const preTenderId = createResp.data?.id;
        if (!preTenderId) skip("Pre-tender ID not returned");

        let tenderId = null;

        try {
          // 2. Verify pre-tender in list
          const listResp = await api("GET", "/api/pre-tenders", { role: "TO" });
          assertOk(listResp, "list pre-tenders");
          const items = listResp.data?.items || [];
          const found = items.find(i => i.id === preTenderId);
          assert(found, "pre-tender found in list");
          assert(found.status === "new", "pre-tender status is new");

          // 3. Verify pre-tender details
          const detailResp = await api("GET", "/api/pre-tenders/" + preTenderId, { role: "TO" });
          assertOk(detailResp, "GET pre-tender details");
          assert(detailResp.data?.item?.customer_name === "E2E Test Customer Corp", "customer name matches");

          // 4. TO accepts pre-tender (goes to pending_approval for director)
          const acceptResp = await api("POST", "/api/pre-tenders/" + preTenderId + "/accept", {
            role: "TO",
            body: {
              comment: "E2E: Accepted for processing",
              contact_person: "John E2E",
              contact_phone: "+7-999-123-4567",
              assigned_pm_id: pmId,
              send_email: false
            }
          });
          assertOk(acceptResp, "TO accept pre-tender");
          // TO role triggers pending_approval (needs director approval)
          assert(acceptResp.data?.pending_approval === true || acceptResp.data?.tender_id, "TO accept returns pending_approval or tender_id");

          // 4b. If pending_approval, director approves it
          if (acceptResp.data?.pending_approval) {
            const approveResp = await api("POST", "/api/pre-tenders/" + preTenderId + "/accept", {
              role: "DIRECTOR_GEN",
              body: { comment: "E2E: Director approved" }
            });
            assertOk(approveResp, "DIRECTOR_GEN approve pre-tender");
            tenderId = approveResp.data?.tender_id;
          } else {
            tenderId = acceptResp.data?.tender_id;
          }
          assert(tenderId, "tender_id returned after approval");

          // 5. Verify pre-tender status changed to accepted
          const afterAccept = await api("GET", "/api/pre-tenders/" + preTenderId, { role: "TO" });
          assertOk(afterAccept, "GET pre-tender after accept");
          assert(afterAccept.data?.item?.status === "accepted", "pre-tender status is accepted");

          // 6. Verify tender was created with correct data
          const tenderResp = await api("GET", "/api/tenders/" + tenderId, { role: "PM" });
          assertOk(tenderResp, "PM get tender");
          const tender = tenderResp.data?.tender;
          assert(tender, "tender object returned");
          assert(tender.customer_name === "E2E Test Customer Corp", "tender customer matches");
          assert(tender.responsible_pm_id === pmId, "tender PM assigned");

          // 7. PM creates estimate for the tender
          const estResp = await api("POST", "/api/estimates", {
            role: "PM",
            body: {
              tender_id: tenderId,
              title: "E2E: Initial cost estimate",
              amount: 450000,
              margin: 15,
              notes: "E2E autotest estimate"
            }
          });
          assertOk(estResp, "PM create estimate");
          const estimateId = estResp.data?.estimate?.id;

          // 8. Verify estimate appears in tender details
          if (estimateId) {
            const tenderDetail = await api("GET", "/api/tenders/" + tenderId, { role: "PM" });
            assertOk(tenderDetail, "GET tender with estimates");
            const estimates = tenderDetail.data?.estimates || [];
            assert(estimates.length > 0, "tender has estimates");

            // Cleanup estimate
            await api("DELETE", "/api/estimates/" + estimateId, { role: "ADMIN" });
          }

        } finally {
          // Cleanup: delete tender then pre-tender status already changed
          if (tenderId) {
            await api("DELETE", "/api/tenders/" + tenderId, { role: "ADMIN" });
          }
        }
      }
    },
    {
      name: "Pre-tender reject flow",
      run: async () => {
        const createResp = await api("POST", "/api/pre-tenders", {
          role: "TO",
          body: {
            customer_name: "E2E Reject Test Corp",
            work_description: "E2E: Work to be rejected"
          }
        });
        if (createResp.status === 404) skip("pre-tenders endpoint not available");
        assertOk(createResp, "create pre-tender for reject");
        const ptId = createResp.data?.id;
        if (!ptId) skip("ID not returned");

        const rejectResp = await api("POST", "/api/pre-tenders/" + ptId + "/reject", {
          role: "TO",
          body: { reject_reason: "E2E: Does not match our capabilities", send_email: false }
        });
        assertOk(rejectResp, "reject pre-tender");

        const detailResp = await api("GET", "/api/pre-tenders/" + ptId, { role: "TO" });
        assertOk(detailResp, "GET rejected pre-tender");
        assert(detailResp.data?.item?.status === "rejected", "status is rejected");
      }
    },
    {
      name: "PM cannot access pre-tenders (not in ALLOWED_ROLES)",
      run: async () => {
        const resp = await api("GET", "/api/pre-tenders", { role: "PM" });
        if (resp.status === 404) skip("pre-tenders endpoint not available");
        assertForbidden(resp, "PM cannot list pre-tenders");
      }
    }
  ]
};
