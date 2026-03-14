/**
 * Second pass: try to find INN for companies that DaData missed on first attempt
 * Uses cleaned/simplified company names for better matching
 */
const { Pool } = require('pg');
const DADATA_TOKEN = 'eca1ca4b8812489034e251028321fedf5ae39967';
const pool = new Pool({ host:'localhost', port:5432, database:'asgard_crm', user:'asgard', password:'123456789' });

function cleanForSearch(name) {
  let q = name
    .replace(/[Фф]илиал\s*/gi, '')
    .replace(/\s+в\s+(г\.|городе|Истринском|Северске|Волгограде|Зеленограде)\s*\S*/gi, '')
    .replace(/\(.*?\)/g, '')
    .replace(/пос\.\s*\S+/gi, '')
    .replace(/г\.\s*\S+/gi, '')
    .replace(/,\s*[А-Я][а-яё]+(-[А-Яа-яё]+)?$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return q;
}

async function lookup(query) {
  try {
    const res = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Token ' + DADATA_TOKEN },
      body: JSON.stringify({ query, count: 1 })
    });
    const data = await res.json();
    if (data.suggestions && data.suggestions[0]) return data.suggestions[0].data;
  } catch(e) {}
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Non-company entries to skip
const SKIP_PATTERNS = [
  /^(Частное лицо|Денис$|Евгений$|Вадим$|Андрей\s|Саввин\s|ЧЛ\s)/i,
  /^(Атомка|Торнадо|Топаз|Сатурн|СМД|ДНПП|Банк$)$/i,
  /^(пром-котёл|цементный завод|саранск котлы|завод по переработке|энергия раменский)/i,
  /^(Красный Путь|4Сезона|11 зданий|ТЦ Водный|Техносерв$|Адидас$|Микоян$|Транстрес$)$/i,
  /^(Череповец Протравка|Ярославское шоссе|Дом на ленинградке|Башня федерации)$/i,
  /^(г\.|Спецстройсоюз$|Мосавтодор$|Альфа-Лаваль$|ГИП-Инвест$)$/i,
  /^(zimer66@|Без названия)/i
];

(async () => {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT id, name FROM customers WHERE inn IS NULL ORDER BY id');
    console.log('Companies without INN:', res.rows.length);

    let found = 0, notFound = 0, skipped = 0;
    for (const row of res.rows) {
      // Skip obvious non-companies
      if (SKIP_PATTERNS.some(p => p.test(row.name))) {
        skipped++;
        continue;
      }

      const cleaned = cleanForSearch(row.name);
      const data = await lookup(cleaned);
      await sleep(40);

      if (data && data.inn) {
        const exists = await client.query('SELECT id FROM customers WHERE inn = $1', [data.inn]);
        if (exists.rows.length > 0) {
          console.log('  DUPE INN', data.inn, 'for', row.name);
          notFound++;
          continue;
        }
        await client.query(
          'UPDATE customers SET inn = $1, kpp = $2, ogrn = $3, full_name = $4, address = $5 WHERE id = $6',
          [data.inn, data.kpp || null, data.ogrn || null,
           data.name && data.name.full_with_opf ? data.name.full_with_opf : null,
           data.address && data.address.unrestricted_value ? data.address.unrestricted_value : null,
           row.id]
        );
        found++;
        console.log('  FOUND:', row.name, '->', data.inn);
      } else {
        notFound++;
        console.log('  NOT FOUND:', row.name);
      }
    }

    console.log('\nResult: found=' + found + ', not found=' + notFound + ', skipped=' + skipped);

    const cnt = await client.query('SELECT COUNT(*) as total, COUNT(inn) as with_inn FROM customers');
    console.log('Total:', cnt.rows[0].total, ', with INN:', cnt.rows[0].with_inn);
  } finally {
    client.release();
    await pool.end();
  }
})();
