// Проверка изменений бэкенда для D-342/D-343.
const fs = require('fs');

const pt = fs.readFileSync('src/routes/pre_tenders.js', 'utf8');
const pm = fs.readFileSync('src/routes/pm-duty.js', 'utf8');

const checks = [
  ['[pre_tenders] эндпоинт /pm-summary', pt.includes("'/pm-summary'")],
  ['[pre_tenders] фильтр assigned_to', pt.includes('canFilterByPm')],
  ['[pre_tenders] фильтр только директорам', pt.includes('DIRECTOR_LIKE_ROLES.includes(user.role) && Number.isFinite(assignedTo)')],
  ['[pre_tenders] works.work_status (не status)', pt.includes("w.work_status = 'В работе'")],
  // Ищем именно `w.status` как отдельное слово (не `row.status`, не `w.work_status`).
  ['[pre_tenders] нет обращения к works.status', !/(?<![\w.])w\.status(?![_\w])/.test(pt)],
  ['[pre_tenders] статусы тендеров по РП', pt.includes("t.registry_status = 'подались'")],
  ['[pre_tenders] считает выиграли/проиграли/отмена', pt.includes("'проиграли'") && pt.includes("'отмена'")],
  ['[pre_tenders] заявки без РП учтены', pt.includes('totals.unassigned_total')],
  ['[pm-duty] галочка request_director_approval', pm.includes('b.request_director_approval === true')],
  ['[pm-duty] согласование = порог И галочка', pm.includes('aboveThreshold && wantsApproval')],
];

console.log('=== проверки ===');
let fail = 0;
for (const [name, ok] of checks) {
  console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!ok) fail++;
}

// Безопасность: canFilterByPm не должен давать PM смотреть чужие заявки
const badPath = pm.includes('request_director_approval') && /if \(b\.request_director_approval/.test(pm);
console.log('\n=== защита: PM не может подменить assigned_to ===');
const guardOk = pt.includes('} else if (canFilterByPm) {')
  && pt.includes('const canFilterByPm = DIRECTOR_LIKE_ROLES.includes(user.role) && Number.isFinite(assignedTo)');
console.log('  ' + (guardOk ? 'OK  ' : 'FAIL') + ' фильтр ограничен DIRECTOR_LIKE_ROLES');
if (!guardOk) fail++;

console.log('\n' + (fail === 0 ? 'ИТОГ: OK' : 'ИТОГ: FAIL — ' + fail));
process.exit(fail === 0 ? 0 : 1);
