/**
 * ASGARD CRM — Mimir Conductor: загрузчик нормативов в RAG-индекс (Сессия 6, Шаг 6.0.1)
 * ═══════════════════════════════════════════════════════════════════════════
 * Разовый сидер. Заполняет mimir_norms_index расценками ГЭСН/ФЕР/СТО.
 *
 * Источник данных (в порядке приоритета):
 *   1. storage/norms/*.jsonl — если есть распарсенные нормативы (одна расценка
 *      на строку): { source, code, name, unit?, full_text, resources?, rate_per_unit? }
 *   2. Встроенный SEED — небольшой курированный набор типовых расценок под
 *      профиль Асгарда (химпромывки, монтаж/демонтаж, гидроиспытания, НК).
 *      Достаточно, чтобы resource_planner на dev возвращал релевантные нормы.
 *
 * Embeddings считаются через ai-provider.embed():
 *   • живой ключ — реальные voyage-3-large векторы (≈30 мин на полный каталог);
 *   • stub-ключ  — детерминированный псевдо-вектор (мгновенно, без баланса).
 *
 * Лежит в tracked-каталоге rag/ (каталог scripts/ в .gitignore). Запуск:
 *   node src/services/mimir-conductor/rag/seed-norms.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { indexNorms } = require('./norms-index');

const NORMS_DIR = path.join(process.cwd(), 'storage', 'norms');

// Курированный стартовый набор (профиль Асгарда). Не претендует на полноту —
// это «затравка», чтобы RAG-поиск давал осмысленные результаты до загрузки
// полного каталога ГЭСН/ФЕР.
const SEED = [
  {
    source: 'GESN', code: 'ГЭСНм 38-04-001', name: 'Химическая промывка трубопроводов и теплообменного оборудования',
    unit: '100 м3 объёма системы',
    full_text: 'Химическая (кислотная/щелочная) промывка внутренних поверхностей трубопроводов, теплообменников, котлов. Включает приготовление реагента, циркуляцию, нейтрализацию, пассивацию, утилизацию отработанного раствора. Затраты труда рабочих среднего разряда, маш-часы насосного оборудования.',
    resources: { labor_man_hours_per_unit: 42, machinery_hours_per_unit: 18, materials: ['ингибированная кислота', 'нейтрализатор', 'пассиватор'] },
    rate_per_unit: 0
  },
  {
    source: 'GESN', code: 'ГЭСНм 38-04-012', name: 'Гидравлическое испытание трубопроводов на прочность и плотность',
    unit: '100 м трубопровода',
    full_text: 'Гидроиспытание трубопровода: наполнение водой, подъём давления, выдержка, осмотр, слив. Учитывает Ду, рабочее давление. Затраты труда монтажников, маш-часы опрессовочного агрегата.',
    resources: { labor_man_hours_per_unit: 12, machinery_hours_per_unit: 6, materials: ['вода', 'манометры'] },
    rate_per_unit: 0
  },
  {
    source: 'GESN', code: 'ГЭСНм 12-01-009', name: 'Демонтаж технологических трубопроводов',
    unit: '100 м трубопровода',
    full_text: 'Демонтаж стальных технологических трубопроводов с резкой, разболчиванием фланцев, опусканием и складированием. Затраты труда монтажников 4-5 разряда, газорезка.',
    resources: { labor_man_hours_per_unit: 55, machinery_hours_per_unit: 8, materials: ['газ ацетилен', 'кислород'] },
    rate_per_unit: 0
  },
  {
    source: 'GESN', code: 'ГЭСНм 12-01-001', name: 'Монтаж технологических трубопроводов из стальных труб',
    unit: '100 м трубопровода',
    full_text: 'Монтаж технологических трубопроводов: установка, сборка, сварка стыков, обвязка арматуры. Затраты труда монтажников и сварщиков НАКС.',
    resources: { labor_man_hours_per_unit: 95, machinery_hours_per_unit: 14, materials: ['электроды', 'трубы', 'фланцы'] },
    rate_per_unit: 0
  },
  {
    source: 'GESN', code: 'ГЭСНм 39-01-005', name: 'Неразрушающий контроль сварных соединений (УЗК/РК)',
    unit: '100 стыков',
    full_text: 'Ультразвуковой и радиографический контроль сварных швов трубопроводов. Аттестованная лаборатория НК. Затраты труда дефектоскопистов, расход плёнки/реактивов.',
    resources: { labor_man_hours_per_unit: 30, machinery_hours_per_unit: 0, materials: ['рентген-плёнка', 'реактивы'] },
    rate_per_unit: 0
  },
  {
    source: 'FER', code: 'ФЕРм 38-04-003', name: 'Очистка оборудования от отложений механическим способом',
    unit: '100 м2 поверхности',
    full_text: 'Механическая очистка теплообменных поверхностей от накипи и отложений: гидродинамическая (АВД) или щёточная. Затраты труда рабочих, маш-часы аппарата высокого давления.',
    resources: { labor_man_hours_per_unit: 28, machinery_hours_per_unit: 22, materials: ['вода'] },
    rate_per_unit: 0
  },
  {
    source: 'STO_GAZPROM', code: 'СТО Газпром 2-3.5-454 п.7', name: 'Производство работ на действующих газопроводах — организационные требования',
    unit: 'комплект',
    full_text: 'Требования к организации работ на действующих объектах ПАО «Газпром»: наряд-допуск, газоопасные работы, согласование останова, инструктажи, контроль загазованности. Влияет на состав ИТР и доплаты за вредность.',
    resources: { labor_man_hours_per_unit: 0, machinery_hours_per_unit: 0, materials: [] },
    rate_per_unit: 0
  },
  {
    source: 'GESN', code: 'ГЭСНм 40-02-001', name: 'Промывка и продувка систем сжатым воздухом',
    unit: '100 м трубопровода',
    full_text: 'Продувка трубопроводов сжатым воздухом для удаления окалины и загрязнений после монтажа. Затраты труда, маш-часы компрессора.',
    resources: { labor_man_hours_per_unit: 9, machinery_hours_per_unit: 10, materials: [] },
    rate_per_unit: 0
  }
];

/** Прочитать все *.jsonl из storage/norms (если есть). */
function readJsonlNorms() {
  if (!fs.existsSync(NORMS_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(NORMS_DIR)) {
    if (!/\.jsonl$/i.test(f)) continue;
    const lines = fs.readFileSync(path.join(NORMS_DIR, f), 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try {
        const obj = JSON.parse(s);
        if (obj.source && obj.code && obj.name) out.push(obj);
      } catch (_) { /* пропускаем битую строку */ }
    }
  }
  return out;
}

async function main() {
  const fromFiles = readJsonlNorms();
  const items = fromFiles.length ? fromFiles : SEED;
  const srcLabel = fromFiles.length ? `${fromFiles.length} из storage/norms/*.jsonl` : `${SEED.length} (встроенный SEED)`;

  console.log(`[seed-norms] Источник: ${srcLabel}`);
  console.log('[seed-norms] Считаю embeddings и индексирую…');

  const BATCH = 50;
  let total = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const { inserted } = await indexNorms(batch);
    total += inserted;
    console.log(`[seed-norms]   проиндексировано ${total}/${items.length}`);
  }

  const cnt = await db.query('SELECT COUNT(*)::int AS n FROM mimir_norms_index');
  console.log(`[seed-norms] ✅ Готово. Всего в индексе: ${cnt.rows[0].n} нормативов.`);
  await db.end();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[seed-norms] ❌ Ошибка:', e.message);
    process.exit(1);
  });
}

module.exports = { SEED, readJsonlNorms };
