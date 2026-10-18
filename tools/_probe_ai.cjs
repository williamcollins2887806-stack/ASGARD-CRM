require('dotenv').config();
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
// ВРЕМЕННО (только в этом процессе) переключаем на прямой routerai.ru
process.env.OPENAI_URL = 'https://routerai.ru/api/v1/chat/completions';
const ai = require('../src/services/ai-provider');
console.log('effective OPENAI_URL=', ai.getConfig().openaiUrl);
(async () => {
  try {
    const r = await ai.complete({ system: 'Ответь одним словом.', messages: [{ role: 'user', content: 'Скажи: ок' }], model: 'google/gemini-3.5-flash', maxTokens: 20, temperature: 0 });
    console.log('OK text=', JSON.stringify(r.text), 'model=', r.model, 'usage=', JSON.stringify(r.usage));
  } catch (e) {
    console.log('FAIL', e.code, e.status, String(e.message).slice(0, 300));
  }
})();
