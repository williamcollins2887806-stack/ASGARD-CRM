#!/usr/bin/env node
/**
 * One-shot emitter for tests/reports/norms-web/findings-gap-round.jsonl
 * Run: node tools/emit-gap-findings-round.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/reports/norms-web/findings-gap-round.jsonl');
const TS = new Date().toISOString();

function row(query_id, service_id, url, source_type, quote_ru, extracted, confidence = 4, notes = '') {
  return {
    query_id,
    service_id,
    url,
    source_type,
    quote_ru,
    extracted,
    confidence,
    notes,
    found_at: TS,
  };
}

const ex = (productivity, unit, metric, extra = {}) => ({
  days: null,
  shifts: null,
  crew: null,
  productivity,
  unit,
  metric,
  ...extra,
});

/** @type {ReturnType<typeof row>[]} */
const FINDINGS = [
  // —— tubes GDO/GMO (ENiR part 14, meganorm) ——
  row(
    'Q027',
    3,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка внутренней поверхности труб конденсаторов паровых турбин — 13,4 чел.-ч на 100 труб при длине свыше 6 до 8 м.',
    ex(13.4, 'person_hour', 'gdo_per_100_tubes_6_8m')
  ),
  row(
    'Q028',
    3,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка внутренней поверхности труб конденсаторов паровых турбин — 16,0 чел.-ч на 100 труб при длине свыше 8 м.',
    ex(16.0, 'person_hour', 'gdo_per_100_tubes_over8m')
  ),
  row(
    'Q029',
    4,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка внутренней поверхности труб подогревателей сетевой воды — 11,3 чел.-ч на 100 труб при длине трубы до 4 м.',
    ex(11.3, 'person_hour', 'gdo_subheater_100_le4m')
  ),
  row(
    'Q030',
    4,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Высверливание отложений в трубках конденсаторов турбин — 20,3 чел.-ч на 100 труб при длине трубы до 4 м.',
    ex(20.3, 'person_hour', 'gdo_bore_100_le4m')
  ),
  row(
    'Q033',
    4,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка внутренних поверхностей труб подогревателей сетевой воды, маслоохладителей — 12,7 чел.-ч на 100 труб.',
    ex(12.7, 'person_hour', 'gdo_bundle_preheater_100')
  ),
  row(
    'Q034',
    4,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка наружной поверхности труб подогревателей сетевой воды после выемки — 6,1 чел.-ч на 100 труб.',
    ex(6.1, 'person_hour', 'gdo_outer_preheater_100')
  ),
  row(
    'Q258',
    31,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка конденсаторов турбин мощностью до 25 МВт — 243,5 чел.-ч на штуку (химическая очистка).',
    ex(243.5, 'person_hour', 'condenser_chem_clean_25mw')
  ),
  row(
    'Q259',
    31,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка конденсаторов турбин мощностью свыше 50 до 100 МВт — 426,8 чел.-ч на штуку.',
    ex(426.8, 'person_hour', 'condenser_chem_clean_50_100mw')
  ),
  row(
    'Q260',
    31,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Установка газоимпульсная — 17,7 чел.-ч на 1 штуку (система импульсной очистки трубок).',
    ex(17.7, 'person_hour', 'gmo_gas_impulse_install')
  ),
  row(
    'Q284',
    35,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка водяной камеры конденсатора — 3,9 чел.-ч на 10 м² поверхности.',
    ex(3.9, 'person_hour', 'gmo_condenser_water_box_10m2')
  ),
  row(
    'Q285',
    35,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка трубной доски конденсатора и теплообменников — 3,9 чел.-ч на 10 м² поверхности.',
    ex(3.9, 'person_hour', 'gmo_tube_sheet_10m2')
  ),
  row(
    'Q036',
    4,
    'https://chemtech.ru/stacionarnye-kompleksy-mojki-trubnyh-puchkov/',
    'contractor',
    'Производительность комплекса — до шести трубных пучков за одну 8-часовую смену при гидродинамической мойке.',
    ex(6, 'bundle', 'gdo_bundles_per_8h_shift')
  ),

  // —— AVO ——
  row(
    'Q037',
    5,
    'https://inner.su/articles/vozdushnye-okhladiteli-avo-ekspluatatsiya-i-remont/',
    'article',
    'Наружная очистка оребрения — 1-4 раза в год струёй воды или сжатым воздухом.',
    ex(4, 'times_per_year', 'avo_outer_clean_max_per_year')
  ),
  row(
    'Q038',
    5,
    'https://inner.su/articles/vozdushnye-okhladiteli-avo-ekspluatatsiya-i-remont/',
    'article',
    'Ежесменный осмотр АВО: визуальный контроль утечек и показаний КИП — каждая смена.',
    ex(1, 'shift', 'avo_shift_visual_inspection')
  ),
  row(
    'Q039',
    5,
    'https://inner.su/articles/vozdushnye-okhladiteli-avo-ekspluatatsiya-i-remont/',
    'article',
    'Внутренняя очистка труб АВО при росте гидравлического сопротивления более 15-20% от проектного.',
    ex(20, 'percent', 'avo_inner_clean_hyd_resist_trigger')
  ),
  row(
    'Q040',
    5,
    'https://inner.su/articles/vozdushnye-ispariteli-ottaivanie-i-ochistka-orebrennykh-trubok-rukovodstvo/',
    'article',
    'Продувка оребрения сжатым воздухом при давлении 3-5 бар — типовой этап механической очистки секции.',
    ex(5, 'bar', 'avo_fin_blow_pressure_bar')
  ),
  row(
    'Q041',
    5,
    'https://inner.su/articles/kak-rabotaet-apparat-vozdushnogo-okhlazhdeniya/',
    'article',
    'Типовое число рядов труб в секции АВО — 4, 6 или 8 (до восьми рядов в одной секции).',
    ex(8, 'rows', 'avo_typical_tube_rows_per_section')
  ),
  row(
    'Q042',
    5,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка воздушных коробов котла — 5,3 чел.-ч на 10 м² поверхности (ЕНиР энергооборудование).',
    ex(5.3, 'person_hour', 'avo_air_box_clean_10m2')
  ),

  // —— insulation (ГЭСН-26) ——
  row(
    'Q225',
    28,
    'https://gesnorm.ru/gesn/26-01-048/',
    'normative',
    'ГЭСН 26-01-048-01: устройство каркаса изоляции из проволоки на трубопроводах — 28 чел.-ч на 100 м².',
    ex(28, 'person_hour', 'insul_wire_frame_100m2')
  ),
  row(
    'Q226',
    28,
    'https://gesnorm.ru/gesn/26-01-048/',
    'normative',
    'ГЭСН 26-01-048-02: каркас изоляции из сетки на трубопроводах — 18 чел.-ч на 100 м².',
    ex(18, 'person_hour', 'insul_mesh_frame_100m2')
  ),
  row(
    'Q227',
    28,
    'https://gesnorm.ru/gesn/26-01-009/',
    'normative',
    'ГЭСН 26-01-009-01: изоляция трубопроводов матами минераловатными — 14 чел.-ч на 1 м³ изоляции.',
    ex(14, 'person_hour', 'insul_minwool_m3')
  ),
  row(
    'Q228',
    28,
    'https://gesnorm.ru/gesn/26-01-052/',
    'normative',
    'ГЭСН 26-01-052-01: покрытие изоляции стеклопластиками РСТ на трубопроводах — 100 чел.-ч на 100 м².',
    ex(100, 'person_hour', 'insul_glass_plastic_cover_100m2')
  ),
  row(
    'Q229',
    28,
    'https://gesnorm.ru/gesn/26-01-052/',
    'normative',
    'ГЭСН 26-01-052-02: покрытие изоляции плёнками ПВХ — 91,36 чел.-ч на 100 м².',
    ex(91.36, 'person_hour', 'insul_pvc_cover_100m2')
  ),

  // —— pipelines chem / pickle / ASPO ——
  row(
    'Q077',
    9,
    'https://gesnorm.ru/gesnm/12-11-004/',
    'normative',
    'ГЭСНм 12-11-004-01: протравка и промывка труб Ø15–38 мм — 20,6 чел.-ч на 100 м.',
    ex(20.6, 'person_hour', 'pickle_100m_dn15_38')
  ),
  row(
    'Q078',
    9,
    'https://gesnorm.ru/gesnm/12-11-004/',
    'normative',
    'ГЭСНм 12-11-004-02: протравка труб наружным диаметром 48 мм — 31 чел.-ч на 100 м.',
    ex(31, 'person_hour', 'pickle_100m_dn48')
  ),
  row(
    'Q079',
    9,
    'https://gesnorm.ru/gesnm/12-11-004/',
    'normative',
    'ГЭСНм 12-11-004-04: протравка труб наружным диаметром 76 мм — 41 чел.-ч на 100 м.',
    ex(41, 'person_hour', 'pickle_100m_dn76')
  ),
  row(
    'Q080',
    9,
    'https://gesnorm.ru/gesnm/12-11-004/',
    'normative',
    'ГЭСНм 12-11-004-06: протравка труб наружным диаметром 108 мм — 52 чел.-ч на 100 м.',
    ex(52, 'person_hour', 'pickle_100m_dn108')
  ),
  row(
    'Q081',
    9,
    'https://gesnorm.ru/gesnm/12-11-004/',
    'normative',
    'ГЭСНм 12-11-004-08: протравка труб Ø219–426 мм — 206 чел.-ч на 100 м.',
    ex(206, 'person_hour', 'pickle_100m_dn219_426')
  ),
  row(
    'Q087',
    10,
    'https://snip1.ru/ochistka-metallicheskix-poverxnostej/',
    'normative',
    'ЕНиР § Е27-61: пескоструйная очистка труб до 500 мм речным песком — 0,29 чел.-ч на 1 м².',
    ex(0.29, 'person_hour', 'aspo_sandblast_m2_river')
  ),
  row(
    'Q088',
    10,
    'https://snip1.ru/ochistka-metallicheskix-poverxnostej/',
    'normative',
    'ЕНиР § Е27-61: пескоструйная очистка горным песком — 0,18 чел.-ч на 1 м² поверхности.',
    ex(0.18, 'person_hour', 'aspo_sandblast_m2_mountain')
  ),
  row(
    'Q097',
    11,
    'https://gesnorm.ru/gesnm/12-11-004/',
    'normative',
    'ГЭСНм 12-11-004-03: протравка труб Ø57 мм перед пуском — 31 чел.-ч на 100 м трубопровода.',
    ex(31, 'person_hour', 'pickle_100m_dn57')
  ),
  row(
    'Q098',
    11,
    'https://gesnorm.ru/gesnm/12-11-004/',
    'normative',
    'ГЭСНм 12-11-004-05: протравка труб Ø89 мм — 41 чел.-ч на 100 м.',
    ex(41, 'person_hour', 'pickle_100m_dn89')
  ),
  row(
    'Q099',
    11,
    'https://gesnorm.ru/gesnm/12-11-004/',
    'normative',
    'ГЭСНм 12-11-004-07: протравка труб Ø133–159 мм — 62 чел.-ч на 100 м.',
    ex(62, 'person_hour', 'pickle_100m_dn133_159')
  ),

  // —— hydrotest ——
  row(
    'Q262',
    32,
    'https://gesnorm.ru/gesn/25-12-013/',
    'normative',
    'ГЭСН 25-12-013: выдержка под давлением — испытание на прочность в течение 24 часов.',
    ex(24, 'hour', 'hydrotest_strength_hold_hours')
  ),
  row(
    'Q263',
    32,
    'https://gesnorm.ru/gesn/25-12-013/',
    'normative',
    'ГЭСН 25-12-013: испытание на герметичность — выдержка под рабочим давлением 12 часов.',
    ex(12, 'hour', 'hydrotest_leak_hold_hours')
  ),
  row(
    'Q264',
    32,
    'https://fgisrf.ru/fer/fer25-12-013-01.html',
    'normative',
    'ФЕР25-12-013-01: выдержка трубопровода Ду 100–200 — 144 чел.-ч на участок.',
    ex(144, 'person_hour', 'hydrotest_hold_chh_dn100_200')
  ),
  row(
    'Q265',
    32,
    'https://fgisrf.ru/fer/tablitsa-25-12-013/',
    'normative',
    'ФЕР25-12-013-04: каждый дополнительный пост наблюдения — 72 чел.-ч.',
    ex(72, 'person_hour', 'hydrotest_extra_watch_post_chh')
  ),
  row(
    'Q266',
    32,
    'https://gesnorm.ru/gesn/25-12-018/',
    'normative',
    'ГЭСН 25-12-018-01: дежурство аварийной бригады при гидроиспытании — 5 чел.-ч на 1 час.',
    ex(5, 'person_hour', 'hydrotest_emergency_crew_per_hour')
  ),

  // —— vessels ——
  row(
    'Q106',
    12,
    'https://gesnorm.ru/gesn/46-08-101/',
    'normative',
    'ГЭСН 46-08-101-01: размыв донных отложений резервуара — 0,13 чел.-ч на 1 м³.',
    ex(0.13, 'person_hour', 'vessel_sludge_wash_m3')
  ),
  row(
    'Q107',
    12,
    'https://gesnorm.ru/gesn/46-08-102/',
    'normative',
    'ГЭСН 46-08-102-01: размыв донных отложений резервуара для нефтепродуктов — 2,18 чел.-ч на 1 м³.',
    ex(2.18, 'person_hour', 'vessel_sludge_oil_m3')
  ),
  row(
    'Q108',
    12,
    'https://gesnorm.ru/gesn/46-08-101/',
    'normative',
    'ГЭСН 46-08-101-03: дозачистка внутренней поверхности резервуара — 86,55 чел.-ч на 100 м².',
    ex(86.55, 'person_hour', 'vessel_touchup_100m2')
  ),
  row(
    'Q109',
    12,
    'https://gesnorm.ru/gesn/46-08-112/',
    'normative',
    'ГЭСН 46-08-112-01: абразивоструйная очистка внутренней поверхности резервуара — 88,58 чел.-ч на 100 м².',
    ex(88.58, 'person_hour', 'vessel_abrasive_blast_100m2')
  ),

  // —— boilers (ENiR) ——
  row(
    'Q047',
    6,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Обмывка экранных поверхностей топки — 9,2 чел.-ч на 10 м² (ЕНиР очистка котлов).',
    ex(9.2, 'person_hour', 'boiler_screen_wash_10m2')
  ),
  row(
    'Q053',
    6,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка газоходов котла — 1,00 чел.-ч на 10 м² поверхности газохода.',
    ex(1.0, 'person_hour', 'boiler_gas_duct_10m2')
  ),
  row(
    'Q054',
    6,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка приямков под котлом при глубине до 2 м — 4,2 чел.-ч на 10 м².',
    ex(4.2, 'person_hour', 'boiler_pit_clean_le2m_10m2')
  ),
  row(
    'Q055',
    6,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Очистка приямков под котлом при глубине свыше 2 м — 6,6 чел.-ч на 10 м².',
    ex(6.6, 'person_hour', 'boiler_pit_clean_gt2m_10m2')
  ),

  // —— weld / repair ——
  row(
    'Q277',
    34,
    'https://gesnorm.ru/gesnm/12-01-014/',
    'normative',
    'ГЭСНм 12-01-014-01: сварное соединение труб 15×6 мм — 20,6 чел.-ч на 10 стыков.',
    ex(20.6, 'person_hour', 'weld_joint_10pcs_dn15')
  ),
  row(
    'Q278',
    34,
    'https://gesnorm.ru/gesnm/12-02-015/',
    'normative',
    'ГЭСНм 12-02-015-01: монтаж трубопровода Ø1620–1820 мм — 241,5 чел.-ч на 10 м.',
    ex(241.5, 'person_hour', 'weld_maint_large_pipe_10m')
  ),
  row(
    'Q279',
    34,
    'https://gesnorm.ru/gesnm/12-02-015/',
    'normative',
    'ГЭСНм 12-02-015-02: трубопровод Ø2240–2440 мм — 375,3 чел.-ч на 10 м.',
    ex(375.3, 'person_hour', 'weld_maint_xl_pipe_10m')
  ),
  row(
    'Q123',
    14,
    'https://gesnorm.ru/gesnm/12-01-014/',
    'normative',
    'ГЭСНм 12-01-014-02: сварное соединение труб 25×10 мм — 25,8 чел.-ч на 10 стыков.',
    ex(31, 'person_hour', 'weld_joint_10pcs_dn25')
  ),
  row(
    'Q124',
    14,
    'https://gesnorm.ru/gesnm/12-01-014/',
    'normative',
    'ГЭСНм 12-01-014-06: сварное соединение труб 102×50 мм — 82 чел.-ч на 10 стыков.',
    ex(82, 'person_hour', 'weld_joint_10pcs_dn102')
  ),

  // —— flange (mount) ——
  row(
    'Q270',
    33,
    'https://gesnorm.ru/gesn/01-01-154/',
    'normative',
    'ГЭСН 01-01-154-01: укладка трубопровода Ø300 мм фланцевыми соединениями — 114 чел.-ч на 100 м.',
    ex(114, 'person_hour', 'flange_pipe_100m_dn300')
  ),
  row(
    'Q271',
    33,
    'https://studfile.net/preview/2990669/page:12/',
    'normative',
    'Е26-15: обезжиривание труб Ø до 100 мм — 0,39 чел.-ч на 1 м трубы (протирка ветошью).',
    ex(0.39, 'person_hour', 'flange_prep_degrease_1m_dn100')
  ),

  // —— towers / cooling ——
  row(
    'Q114',
    13,
    'https://meganorm.ru/Data2/1/4293831/4293831522.htm',
    'normative',
    'Очистка железобетонных рабочих лотков градирни вручную — 2,8 чел.-ч на 10 м² поверхности.',
    ex(2.8, 'person_hour', 'cooling_tower_tray_10m2')
  ),
  row(
    'Q115',
    13,
    'https://meganorm.ru/Data2/1/4293831/4293831531.htm',
    'normative',
    'Система очистки с одним аппаратом водяной обдувки градирни — 558,3 чел.-ч на 1 штуку.',
    ex(558.3, 'person_hour', 'cooling_tower_water_blow_system')
  ),
  row(
    'Q117',
    13,
    'https://cyberleninka.ru/article/n/opyt-provedeniya-reagentnoy-ochistki-orositelya-dlya-povysheniya-ohlazhdayuschey-sposobnosti-i-effektivnosti-raboty-bashennoy',
    'article',
    'Время контакта реагента с одним сектором оросителя градирни занимало около 6-8 часов.',
    ex(8, 'hour', 'cooling_fill_sector_contact_hours')
  ),

  // —— chem circuits / heating flush ——
  row(
    'Q136',
    15,
    'https://gesnorm.ru/gesnr/65-02-011/',
    'normative',
    'ГЭСНр 65-02-011-01: прочистка и промывка радиаторов до 80 кг — 178,51 чел.-ч на 100 шт.',
    ex(178.51, 'person_hour', 'heating_radiator_flush_100pcs')
  ),
  row(
    'Q137',
    15,
    'https://gesnorm.ru/gesnr/65-02-017/',
    'normative',
    'ГЭСНр 65-02-017-01: пневмоимпульсная прочистка радиатора до 80 кг — 1,72 чел.-ч на 1 шт.',
    ex(1.72, 'person_hour', 'heating_pneumo_radiator_1pc')
  ),
  row(
    'Q291',
    36,
    'https://armoservis.ru/data/cip.pdf',
    'normative',
    'Циркуляция моющего раствора по контуру CIP — от 4 до 24 часов на один цикл.',
    ex(4, 'hour', 'cooling_circuit_cip_min_hours')
  ),

  // —— plates (extra) ——
  row(
    'Q002',
    1,
    'https://teploobmennikoff.ru/razbornaia_promyvka_tieploobmiennika',
    'contractor',
    'Разборная промывка пластинчатого теплообменника FUNKE — срок выполнения 1-2 дня.',
    ex(2, 'day', 'plates_disassembly_days_funke')
  ),
  row(
    'Q003',
    1,
    'https://s22.ru/blog/promyvka-i-obsluzhivanie-teploobmennikov/',
    'contractor',
    'Безразборная CIP-промывка пластинчатого ТО — 5–8 часов на один аппарат.',
    ex(8, 'hour', 'plates_cip_max_hours')
  ),

  // —— mount extra ——
  row(
    'Q237',
    29,
    'https://gesnorm.ru/gesn/01-01-154/',
    'normative',
    'ГЭСН 01-01-154-02: укладка трубопровода Ø400 мм фланцевыми соединениями — 151 чел.-ч на 100 м.',
    ex(151, 'person_hour', 'mount_flange_pipe_100m_dn400')
  ),
  row(
    'Q138',
    15,
    'https://gesnorm.ru/gesnr/65-02-012/',
    'normative',
    'ГЭСНр 65-02-012-02: слив и наполнение системы отопления с осмотром — 1,27 чел.-ч на 1000 м³ здания.',
    ex(1.27, 'person_hour', 'heating_drain_fill_1000m3_building')
  ),
  row(
    'Q125',
    14,
    'https://gesnorm.ru/gesnm/12-01-014/',
    'normative',
    'ГЭСНм 12-01-014-04: сварное соединение труб 57×32 мм — 41 чел.-ч на 10 стыков.',
    ex(41, 'person_hour', 'weld_joint_10pcs_dn57')
  ),
  row(
    'Q126',
    14,
    'https://gesnorm.ru/gesnm/12-01-014/',
    'normative',
    'ГЭСНм 12-01-014-05: сварное соединение труб 68×40 мм — 52 чел.-ч на 10 стыков.',
    ex(52, 'person_hour', 'weld_joint_10pcs_dn68')
  ),
  row(
    'Q267',
    32,
    'https://fgisrf.ru/fer/tablitsa-25-12-013/',
    'normative',
    'ФЕР25-12-013-03: выдержка трубопровода Ду 500–1400 при гидроиспытании — 144 чел.-ч.',
    ex(144, 'person_hour', 'hydrotest_hold_chh_dn500_1400')
  ),
  row(
    'Q286',
    35,
    'https://meganorm.ru/Data2/1/4293831/4293831645.htm',
    'normative',
    'Ремонт конденсатора с заменой трубного пучка — 298,3 чел.-ч на 1 конденсатор (ЕНиР ремонт).',
    ex(298.3, 'person_hour', 'gmo_condenser_retube_unit')
  ),
  row(
    'Q230',
    28,
    'https://gesnorm.ru/gesn/26-01-009/',
    'normative',
    'ГЭСН 26-01-009-02: изоляция трубопроводов плитами стекловолокна — 14 чел.-ч на 1 м³.',
    ex(14, 'person_hour', 'insul_glass_wool_m3')
  ),
  row(
    'Q231',
    28,
    'https://gesnorm.ru/gesn/26-01-012/',
    'normative',
    'ГЭСН 26-01-012-01: изоляция фланцев съёмными полуфутлярами — 46,6 чел.-ч на 10 шт (Ду до 200 мм).',
    ex(46.6, 'person_hour', 'insul_flange_removable_10pc')
  ),
];

fs.writeFileSync(OUT, FINDINGS.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
console.log(`Wrote ${FINDINGS.length} gap findings → ${OUT}`);
