'use strict';
/**
 * Тесты численности бригады. Проверяют УНИВЕРСАЛЬНОСТЬ и отсутствие
 * регресса: химпромывка не должна оставаться без химика, АВО — с
 * наблюдающим, правка РП — не перезаписываться.
 */

const path = require('path');
const cp = require(path.join(__dirname, '..', 'src', 'services', 'crew-plan'));

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS ' + name); }
  catch (e) { fail += 1; console.log('FAIL ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ` expected ${b}, got ${a}`);
}
function roleCount(plan, code) {
  const r = plan.roles.find((x) => x.role_code === code);
  return r ? r.count : 0;
}

// ── Область работ ───────────────────────────────────────────────────────────
check('внутри аппарата определяется по названию', () => {
  eq(cp.resolveWorkScope({ name: 'Чистка внутренней поверхности котла' }), 'inside');
});

check('АВО снаружи не путается с «аппаратом»', () => {
  eq(cp.resolveWorkScope({ name: 'Гидроочистка аппарата воздушного охлаждения' }), 'outside');
});

check('неизвестно без признаков', () => {
  eq(cp.resolveWorkScope({ name: 'Мойка' }), 'unknown');
});

check('явное поле работы важнее эвристики', () => {
  eq(cp.resolveWorkScope({ name: 'Чистка котла', work_scope: 'outside' }), 'outside');
});

// ── ОЗП и наблюдающий ───────────────────────────────────────────────────────
check('внутри аппарата: наблюдающий 1:1 к исполнителям', () => {
  const p = cp.planPositionCrew({ position: { name: 'Чистка внутри ёмкости', people: 4 } });
  eq(roleCount(p, 'worker'), 4);
  eq(roleCount(p, 'observer'), 4, 'наблюдающих должно быть 4, а не 1');
});

check('снаружи наблюдающего нет', () => {
  const p = cp.planPositionCrew({ position: { name: 'Наружная мойка градирни', people: 4 } });
  eq(roleCount(p, 'observer'), 0);
});

check('газоопасные добавляют специалиста ОТ', () => {
  const p = cp.planPositionCrew({ position: { name: 'Работы', hazard: ['gas'], people: 2 } });
  if (roleCount(p, 'safety') < 1) throw new Error('нет safety');
});

// ── Химик: регресс-контроль ─────────────────────────────────────────────────
check('химия по реагентам даёт химика', () => {
  const p = cp.planPositionCrew({
    position: { name: 'Химическая промывка котла', tech_equip: 'кислота с ингибитором', people: 3 }
  });
  eq(roleCount(p, 'chemist'), 1);
});

check('промывка водой БЕЗ реагентов не даёт химика', () => {
  const p = cp.planPositionCrew({ position: { name: 'Промывка ёмкости водой', people: 3 } });
  eq(roleCount(p, 'chemist'), 0);
});

check('регресс: пустой hazard, но кислота в tech_equip — химик есть', () => {
  // Именно этот случай ломался при переходе на hazard без фолбэка.
  const p = cp.planPositionCrew({
    position: { name: 'Обработка', tech_equip: 'раствор кислоты', hazard: [], people: 2 }
  });
  eq(roleCount(p, 'chemist'), 1);
  eq(p.hazard_source, 'heuristic');
});

// ── Сварка ──────────────────────────────────────────────────────────────────
check('сварка даёт сварщика и не теряет его', () => {
  const p = cp.planPositionCrew({ position: { name: 'Сварочные работы', hazard: ['fire'], people: 2 } });
  eq(roleCount(p, 'welder'), 1);
});

// ── Приоритет источников ────────────────────────────────────────────────────
check('норма задаёт состав', () => {
  const p = cp.planPositionCrew({
    position: { name: 'Мойка' },
    norm: { crew: { exec: 6, master: 2 } }
  });
  eq(roleCount(p, 'worker'), 6);
  eq(roleCount(p, 'master'), 2);
  eq(p.crew_source, 'norm');
});

check('правка РП не перезаписывается нормой', () => {
  const p = cp.planPositionCrew({
    position: { name: 'Мойка', people: 8, crew_locked: true },
    norm: { crew: { exec: 4, master: 1 } }
  });
  eq(roleCount(p, 'worker'), 8);
  eq(p.crew_source, 'rp');
  eq(p.crew_locked, true);
});

check('без данных — default с явным признаком', () => {
  const p = cp.planPositionCrew({ position: { name: 'Работа' } });
  eq(p.crew_source, 'default');
});

// ── Инвариант ролей ─────────────────────────────────────────────────────────
check('базовая бригада — только master + worker', () => {
  const p = cp.planPositionCrew({ position: { name: 'Чистка внутри котла', people: 3 } });
  const base = p.roles.filter((r) => cp.BASE_ROLES.includes(r.role_code));
  eq(base.every((r) => r.role_code === 'master' || r.role_code === 'worker'), true);
  eq(p.base_people, base.reduce((s, r) => s + r.count, 0));
});

check('спецроли идут сверх базовой бригады', () => {
  const p = cp.planPositionCrew({ position: { name: 'Чистка внутри ёмкости', people: 3 } });
  if (p.special_people <= 0) throw new Error('спецроли не отделены');
  eq(p.people_shift, p.base_people + p.special_people);
});

// ── Роли доезжают до сметы ──────────────────────────────────────────────────
check('все роли имеют подпись для сметы', () => {
  const missing = cp.SPECIAL_ROLES.filter((r) => !cp.ROLE_LABEL[r]);
  if (missing.length) throw new Error('нет подписи: ' + missing.join(', '));
});

// ── Уровень тендера ─────────────────────────────────────────────────────────
check('ИТР один на объект', () => {
  const t = cp.planTenderCrew({ positions: 100, crews: 3 });
  eq(t.find((r) => r.role_code === 'itr').count, 1);
});

check('ПТО появляется на объёмных работах', () => {
  const small = cp.planTenderCrew({ positions: 3, crews: 1 });
  const big = cp.planTenderCrew({ positions: 50, crews: 3 });
  eq(small.some((r) => r.role_code === 'pto'), false);
  eq(big.some((r) => r.role_code === 'pto'), true);
});

// ── Крайние случаи ──────────────────────────────────────────────────────────
check('1 позиция не ломается', () => {
  const s = cp.summarizeCrew({ positions: [{ name: 'Мойка', people: 2 }] });
  if (!(s.people_shift_peak >= 1)) throw new Error('peak=' + s.people_shift_peak);
});

check('500 позиций считается быстро', () => {
  const positions = Array.from({ length: 500 }, (_, i) => ({ name: 'Работа ' + i, people: 3 }));
  const t0 = Date.now();
  const s = cp.summarizeCrew({ positions });
  if (Date.now() - t0 > 500) throw new Error('медленно');
  eq(s.plans.length, 500);
});

check('пик людей — максимум по позициям, а не сумма', () => {
  const s = cp.summarizeCrew({
    positions: [
      { name: 'A', people: 4 },
      { name: 'B', people: 4 }
    ]
  });
  // 2 позиции по 5 человек — одновременно работает одна бригада, пик 5.
  eq(s.people_shift_peak, 5);
});

console.log('\nитог: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
