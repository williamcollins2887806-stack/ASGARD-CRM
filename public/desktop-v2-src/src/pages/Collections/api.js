/**
 * Collections — API helpers.
 *
 * Backend: src/routes/employee_collections.js (prefix /api/employee-collections).
 */
import { api } from '@/api/client';

export function loadCollections() {
  return api('/api/employee-collections').then((d) => d?.collections || []);
}

export function loadCollection(id) {
  return api(`/api/employee-collections/${id}`).then((d) => ({
    collection: d?.collection || null,
    employees: d?.employees || []
  }));
}

export function createCollection(body) {
  return api('/api/employee-collections', { method: 'POST', body });
}

export function updateCollection(id, body) {
  return api(`/api/employee-collections/${id}`, { method: 'PUT', body });
}

export function deleteCollection(id) {
  return api(`/api/employee-collections/${id}`, { method: 'DELETE' });
}

export function addEmployees(id, employee_ids) {
  return api(`/api/employee-collections/${id}/employees`, {
    method: 'POST',
    body: { employee_ids }
  });
}

export function removeEmployee(id, empId) {
  return api(`/api/employee-collections/${id}/employees/${empId}`, { method: 'DELETE' });
}

export function loadAllEmployees() {
  return api('/api/staff/employees?limit=2000').then((d) => d?.employees || []);
}
