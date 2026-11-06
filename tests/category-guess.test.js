'use strict';
/**
 * Подбор категории по названию позиции (детерминированный запасной путь).
 *
 * Зачем: модель нестабильна. Проверено на проде 06.11: на одном и том же
 * тендере #2127 в одном прогоне она поставила категорию всем 11 позициям,
 * в другом — ни одной. Позиция без категории не получает норму и не
 * попадает в смету. Поэтому категория подбирается по тексту, а модель
 * остаётся приоритетным источником.
 */
const assert = require('assert');
const st = require('../src/services/mimir-tender-stages');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const catalog = {
  categories: [
    { code: 'vessels', title: 'Ёмкости', methods_json: [{ code: 'clean', label: 'Зачистка' }] },
    { code: 'boilers', title: 'Котлы', methods_json: [{ code: 'chem', label: 'Химия' }, { code: 'mech', label: 'Механика' }, { code: 'hydro', label: 'Гидро' }] },
    { code: 'tubes', title: 'Трубные пучки', methods_json: [{ code: 'gdo', label: 'ГДО' }, { code: 'gmo', label: 'ГМО' }, { code: 'chem', label: 'Химия' }] },
    { code: 'plates', title: 'Пластинчатые', methods_json: [{ code: 'hydro_dis', label: 'Разборная' }, { code: 'chem_cip', label: 'Безразборная' }] },
    { code: 'towers_hvac', title: 'Градирни', methods_json: [{ code: 'heating', label: 'Обогрев' }, { code: 'tower', label: 'Градирня' }] },
    { code: 'repair_weld', title: 'Сварка', methods_json: [{ code: 'weld', label: 'Сварка' }] },
    { code: 'pipelines', title: 'Трубопроводы', methods_json: [{ code: 'hydro', label: 'Гидро' }] },
    { code: 'vent_sewer', title: 'Вентиляция', methods_json: [{ code: 'sewer', label: 'Канализация' }] },
    { code: 'avo', title: 'АВО', methods_json: [{ code: 'outer', label: 'Наружная' }, { code: 'tubes', label: 'Трубки' }] },
    { code: 'insulation', title: 'Изоляция', methods_json: [{ code: 'pipe', label: 'Трубы' }] }
  ]
};

function cat(name, unit, tech) {
  const dv = st.normalizeDv({ positions: [{ name, volume: 10, unit, tech_equip: tech || '' }] }, catalog);
  const p = dv.positions[0];
  return (p.category_code || '—') + '.' + (p.method_code || '—');
}

check('бункеры и баки → ёмкости', () => {
  assert.strictEqual(cat('Очистка стенок приёмных бункеров багерных насосных', 'м²'), 'vessels.clean');
  assert.strictEqual(cat('Зачистка резервуара РВС-5000 от нефтепродуктов', 'м³'), 'vessels.clean');
});

check('котёл с химией → котлы.химия, механически → механика', () => {
  assert.strictEqual(cat('Химическая промывка котла КВГМ', 'м³', 'кислота'), 'boilers.chem');
  assert.strictEqual(cat('Очистка поверхностей нагрева котла ДКВР', 'м²'), 'boilers.mech');
});

check('трубный пучок: ГДО по умолчанию, ГМО по шарошкам, химия по кислоте', () => {
  assert.strictEqual(cat('Чистка трубного пучка маслоохладителя', 'трубки'), 'tubes.gdo');
  assert.strictEqual(cat('Очистка трубного пучка шарошками', 'трубки', 'ГМО'), 'tubes.gmo');
  assert.strictEqual(cat('Химическая промывка трубного пучка', 'трубки', 'кислота'), 'tubes.chem');
});

check('пластинчатый теплообменник: разборная и безразборная', () => {
  assert.strictEqual(cat('Разборная очистка пластинчатого теплообменника', 'м²'), 'plates.hydro_dis');
  assert.strictEqual(cat('Безразборная промывка пластинчатого теплообменника CIP', 'м³'), 'plates.chem_cip');
});

check('градирня и драйкулер → градирни', () => {
  assert.strictEqual(cat('Очистка градирни от биологических отложений', 'м²'), 'towers_hvac.tower');
});

check('сварка важнее металла: заварка течи на баке — это сварка', () => {
  assert.strictEqual(cat('Заварка течи на резервуаре', 'стык'), 'repair_weld.weld');
});

check('трубопровод по длине → трубопроводы', () => {
  assert.strictEqual(cat('Гидроиспытание трубопровода Ду100', 'м'), 'pipelines.hydro');
});

check('каналы и приямки → вентиляция и канализация', () => {
  assert.strictEqual(cat('Очистка технологических каналов и приямков', 'м'), 'vent_sewer.sewer');
});

check('АВО: наружная по м², трубки по штукам', () => {
  assert.strictEqual(cat('Наружная очистка секций АВО', 'м²'), 'avo.outer');
  assert.strictEqual(cat('Очистка трубок секции АВО', 'трубки'), 'avo.tubes');
});

check('изоляция', () => {
  assert.strictEqual(cat('Теплоизоляция трубопроводов', 'м²'), 'insulation.pipe');
});

check('категория модели приоритетнее подбора', () => {
  const dv = st.normalizeDv({
    positions: [{ name: 'Странная работа', volume: 5, unit: 'м²', category_code: 'boilers', method_code: 'mech' }]
  }, catalog);
  assert.strictEqual(dv.positions[0].category_code, 'boilers', 'подбор перебил категорию модели');
});

check('непонятное название без объёма в м³ — категория не выдумана', () => {
  const r = cat('Нечто непонятное', 'компл');
  assert.strictEqual(r, '—.—', 'категория приписана наугад: ' + r);
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
