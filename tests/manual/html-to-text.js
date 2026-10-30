/** Превратить отрендеренный HTML отчёта в читаемый текст — взгляд глазами директора. */
const fs = require('fs');
let html = fs.readFileSync(process.argv[2], 'utf8');

// Вырезать стили и svg
html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
html = html.replace(/<svg[\s\S]*?<\/svg>/gi, '[график]');
// Блочные границы → переводы строк
html = html.replace(/<\/(div|tr|table|h1|h2|p|thead|tbody)>/gi, '\n');
html = html.replace(/<br\s*\/?>/gi, '\n');
html = html.replace(/<\/t[dh]>/gi, ' | ');
// Убрать остальные теги
html = html.replace(/<[^>]+>/g, '');
// Сущности
html = html.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
// Схлопнуть пустые строки
const lines = html.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 0);
console.log(lines.join('\n'));
