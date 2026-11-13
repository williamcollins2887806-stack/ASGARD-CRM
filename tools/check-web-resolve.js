'use strict';
/**
 * Проверка шага 3: веб-поиск компании → ИНН → DaData.
 * На реальных названиях из звонков.
 */
const ai = require('./../src/services/ai-provider');
const dadata = require('./../src/services/dadata');
const link = require('./../src/services/call-client-link');

async function main() {
  await ai._loadKeysFromDB();

  const cases = [
    { company_name: 'СпецРО', city: null },
    { company_name: 'Интепром Стандарт', city: null },
    { company_name: 'Ямал Дорстрой', city: null },
  ];

  for (const card of cases) {
    console.log(`\n=== «${card.company_name}» ===`);
    const t0 = Date.now();
    const found = await link.findInnViaWeb(card);
    const ms = Date.now() - t0;
    if (found && found.org) {
      console.log(`  НАЙДЕНО за ${ms} мс: ИНН=${found.inn} | ${found.org.name}`);
      console.log(`  адрес: ${String(found.org.address || '').slice(0, 80)}`);
    } else {
      console.log(`  не найдено за ${ms} мс`);
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
