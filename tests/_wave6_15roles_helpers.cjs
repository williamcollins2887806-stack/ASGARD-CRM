/* Wave-6 15-role smoke helpers. Shared across vanilla/v2/mobile runners.
 * Карантин: literal 'asgard_crm_kanban_test' only.
 */
'use strict';

// Allowlist guard — refuse to run if DB_NAME points to prod DB.
function enforceAllowlist() {
  const db = process.env.DB_NAME || '';
  if (db !== 'asgard_crm_kanban_test') {
    console.error(`REFUSE: wrong DB '${db}', expected 'asgard_crm_kanban_test'`);
    process.exit(2);
  }
}

// Все 15 ролей с тест-логином и id.
const ROLES = [
  { role: 'ADMIN',           login: 'test_admin',           id: 4604 },
  { role: 'PM',              login: 'test_pm',              id: 4610 },
  { role: 'TO',              login: 'test_to',              id: 4611 },
  { role: 'HEAD_PM',         login: 'test_head_pm',         id: 4608 },
  { role: 'HEAD_TO',         login: 'test_head_to',         id: 4609 },
  { role: 'HR',              login: 'test_hr',              id: 4612 },
  { role: 'HR_MANAGER',      login: 'test_hr_manager',      id: 4613 },
  { role: 'BUH',             login: 'test_buh',             id: 4614 },
  { role: 'DIRECTOR_GEN',    login: 'test_director_gen',    id: 4605 },
  { role: 'DIRECTOR_COMM',   login: 'test_director_comm',   id: 4606 },
  { role: 'DIRECTOR_DEV',    login: 'test_director_dev',    id: 4607 },
  { role: 'OFFICE_MANAGER',  login: 'test_office_manager',  id: 4615 },
  { role: 'CHIEF_ENGINEER',  login: 'test_chief_engineer',  id: 4618 },
  { role: 'WAREHOUSE',       login: 'test_warehouse',       id: 4616 },
  { role: 'PROC',            login: 'test_proc',            id: 4617 },
];

// Доступ к /personal-kanban (по public/assets/js/app.js:247, 2346)
const PERSONAL_KANBAN_ROLES = ['PM', 'HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

// Доступ к /director-inbox (по public/assets/js/app.js:248, 2347)
const DIRECTOR_INBOX_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM'];

function hasPersonalKanban(role)  { return PERSONAL_KANBAN_ROLES.includes(role); }
function hasDirectorInbox(role)   { return DIRECTOR_INBOX_ROLES.includes(role); }

module.exports = {
  enforceAllowlist,
  ROLES,
  PERSONAL_KANBAN_ROLES,
  DIRECTOR_INBOX_ROLES,
  hasPersonalKanban,
  hasDirectorInbox,
};
