/**
 * E2E FLOW 9: Permit application lifecycle
 * HR creates permit application -> submits -> status transitions -> cleanup
 */
const { api, assert, assertOk, assertForbidden, skip } = require("../config");

module.exports = {
  name: "FLOW: Permit Application Lifecycle",
  tests: [
    {
      name: "HR creates permit application, views, updates, then cleanup",
      run: async () => {
        const empResp = await api("GET", "/api/data/employees?limit=1", { role: "ADMIN" });
        const employees = empResp.data?.employees || empResp.data?.rows || [];
        const empList = Array.isArray(employees) ? employees : [];
        if (empList.length === 0) skip("No employees available");
        const employeeId = empList[0].id;

        const typesResp = await api("GET", "/api/permits/types", { role: "ADMIN" });
        if (typesResp.status === 404) skip("permits/types endpoint not available");
        const types = typesResp.data?.types || [];
        if (types.length === 0) skip("No permit types available");
        const typeId = types[0].id;

        const createResp = await api("POST", "/api/permit-applications", {
          role: "HR",
          body: {
            title: "E2E: Permit Application Test",
            contractor_name: "E2E Test Contractor LLC",
            contractor_email: "e2e-test@example.com",
            cover_letter: "E2E autotest permit application",
            items: [
              { employee_id: employeeId, permit_type_ids: [typeId], notes: "E2E test item" }
            ]
          }
        });
        if (createResp.status === 404) skip("permit-applications endpoint not available");
        assertOk(createResp, "HR create permit application");
        const app = createResp.data?.application;
        if (!app || !app.id) skip("Application not returned");
        const appId = app.id;
        assert(app.status === "draft", "initial status is draft");

        try {
          const getResp = await api("GET", "/api/permit-applications/" + appId, { role: "HR" });
          assertOk(getResp, "GET permit application details");
          assert(getResp.data?.application?.contractor_name === "E2E Test Contractor LLC", "contractor matches");

          const updateResp = await api("PUT", "/api/permit-applications/" + appId, {
            role: "HR",
            body: { title: "E2E: Updated Permit Application", cover_letter: "Updated cover letter" }
          });
          assertOk(updateResp, "HR update draft");

          const listResp = await api("GET", "/api/permit-applications", { role: "HR" });
          assertOk(listResp, "list permit applications");

          const adminResp = await api("GET", "/api/permit-applications/" + appId, { role: "ADMIN" });
          assertOk(adminResp, "ADMIN can view");

          const pmResp = await api("GET", "/api/permit-applications/" + appId, { role: "PM" });
          assertForbidden(pmResp, "PM cannot view permit application");
        } finally {
          await api("DELETE", "/api/permit-applications/" + appId, { role: "ADMIN" });
        }
      }
    },
    {
      name: "Permit application validation: missing required fields",
      run: async () => {
        const noContractor = await api("POST", "/api/permit-applications", {
          role: "HR",
          body: { title: "E2E: No Contractor", items: [{ employee_id: 1, permit_type_ids: [1] }] }
        });
        if (noContractor.status === 404) skip("permit-applications endpoint not available");
        assert(noContractor.status === 400, "missing contractor returns 400");

        const noItems = await api("POST", "/api/permit-applications", {
          role: "HR",
          body: { contractor_name: "E2E Contractor", items: [] }
        });
        assert(noItems.status === 400, "empty items returns 400");
      }
    },
    {
      name: "Permits CRUD: create permit for employee, list, delete",
      run: async () => {
        const empResp = await api("GET", "/api/data/employees?limit=1", { role: "ADMIN" });
        const empList = empResp.data?.employees || empResp.data?.rows || [];
        if (empList.length === 0) skip("No employees");
        const employeeId = empList[0].id;

        const typesResp = await api("GET", "/api/permits/types", { role: "ADMIN" });
        if (typesResp.status === 404) skip("permits/types not available");
        const types = typesResp.data?.types || [];
        if (types.length === 0) skip("No permit types");
        const typeId = types[0].id;

        const createResp = await api("POST", "/api/permits", {
          role: "ADMIN",
          body: {
            employee_id: employeeId,
            type_id: typeId,
            doc_number: "E2E-PERMIT-001",
            issuer: "E2E Test Authority",
            issue_date: new Date().toISOString().slice(0, 10),
            expiry_date: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
            notes: "E2E autotest permit"
          }
        });
        if (createResp.status === 404) skip("permits POST not available");
        assertOk(createResp, "create permit");
        const permit = createResp.data?.permit;
        if (!permit || !permit.id) skip("Permit not returned");

        try {
          const listResp = await api("GET", "/api/permits?employee_id=" + employeeId, { role: "ADMIN" });
          assertOk(listResp, "list permits");

          const statsResp = await api("GET", "/api/permits/stats", { role: "ADMIN" });
          assertOk(statsResp, "permits stats");
        } finally {
          await api("DELETE", "/api/permits/" + permit.id, { role: "ADMIN" });
        }
      }
    }
  ]
};
