/**
 * Вкладка «Парсер SMS» — D-48 (Bank SMS).
 *
 * Источник (vanilla): public/assets/js/telegram.js
 *   • BANK_SMS_PATTERNS (строка 47) — массив регулярок банков
 *   • parseBankSMS (строки 162-184) — итерация по паттернам
 *   • UI парсера (строки 262-269, 365-394) — textarea + btnParseSms + btnCreateIncome
 *
 * Поведение:
 *   1. Юзер вставляет SMS в textarea.
 *   2. Нажимает «Распознать» → parseSms(text) → {bank, amount, sender, raw}.
 *   3. Если найдено — карточка с распознанным + кнопка «Создать поступление».
 *   4. «Создать поступление» — POST /api/incomes/from-sms (endpoint TODO,
 *      сейчас тост-предупреждение как в vanilla строке 384-385).
 */
import { useState } from 'react';
import { Field, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';

// Паттерны для парсинга банковских SMS (1:1 из vanilla telegram.js:47)
const BANK_SMS_PATTERNS = [
  // Сбербанк
  {
    bank: 'Сбербанк',
    pattern: /(?:Зачисление|Перевод)\s+(\d[\d\s,.]+)\s*(?:руб|р\.?)\s*(?:от\s+)?(.+?)(?:\s+Баланс|\s*$)/i,
    groups: { amount: 1, sender: 2 }
  },
  // Альфа-Банк
  {
    bank: 'Альфа-Банк',
    pattern: /Пополнение\s+(\d[\d\s,.]+)\s*(?:RUB|руб)\s*(?:от\s+)?(.+)/i,
    groups: { amount: 1, sender: 2 }
  },
  // Тинькофф
  {
    bank: 'Тинькофф',
    pattern: /Пополнение\s+\+(\d[\d\s,.]+)\s*(?:₽|руб|р)\s*(.+)/i,
    groups: { amount: 1, sender: 2 }
  },
  // Универсальный
  {
    bank: 'Универсальный',
    pattern: /(?:зачисл|пополн|перевод)[а-яё]*\s*[:\s]+(\d[\d\s,.]+)\s*(?:руб|р\.?|₽)/i,
    groups: { amount: 1 }
  }
];

// Парсер (1:1 из vanilla telegram.js:162-184)
function parseSms(smsText) {
  if (!smsText || !smsText.trim()) return null;
  for (const pattern of BANK_SMS_PATTERNS) {
    const match = smsText.match(pattern.pattern);
    if (match) {
      const result = { bank: pattern.bank, raw: smsText };
      if (pattern.groups.amount && match[pattern.groups.amount]) {
        result.amount = parseFloat(
          match[pattern.groups.amount].replace(/\s/g, '').replace(',', '.')
        );
      }
      if (pattern.groups.sender && match[pattern.groups.sender]) {
        result.sender = match[pattern.groups.sender].trim();
      }
      return result;
    }
  }
  return null;
}

const EXAMPLES = [
  'Зачисление 50000 руб. от ООО РОМАШКА Баланс: 150000р',
  'Пополнение 25000 RUB от ИП Иванов',
  'Пополнение +12500 ₽ Перевод между счетами',
  'зачислено: 7500 руб'
];

export default function SmsParser() {
  const [sms, setSms] = useState('');
  const [result, setResult] = useState(null);
  const [parsed, setParsed] = useState(false);
  const [creating, setCreating] = useState(false);

  function handleParse() {
    if (!sms.trim()) {
      toast.warn('Вставьте текст SMS');
      return;
    }
    const r = parseSms(sms);
    setResult(r);
    setParsed(true);
    if (!r) {
      toast.warn('Не удалось распознать SMS. Попробуйте другой формат.');
    } else {
      toast.success(`Распознано: ${r.bank}`);
    }
  }

  function handleClear() {
    setSms('');
    setResult(null);
    setParsed(false);
  }

  async function handleCreateIncome() {
    if (!result) return;
    if (!result.amount || result.amount <= 0) {
      toast.warn('Не распознана сумма поступления');
      return;
    }
    setCreating(true);
    try {
      const body = {
        sms_text: sms,
        parsed: {
          amount:  result.amount,
          sender:  result.sender || null,
          comment: `Распознано из SMS (${result.bank})`,
        },
      };
      const r = await api('/api/incomes/from-sms', { method: 'POST', body });
      const id = r?.income?.id;
      toast.success(id ? `Создано поступление #${id}` : 'Поступление создано');
      // После успеха — очищаем форму, чтобы случайно не задвоить.
      setSms('');
      setResult(null);
      setParsed(false);
    } catch (e) {
      // api/client сам кидает toast для 5xx/401/403/429/network.
      // Здесь подстраховка для 400/422 (бизнес-валидация) и прочих кейсов.
      const status = e?.status;
      if (status !== 401 && status !== 403 && status !== 429 && (status < 500 || status >= 600)) {
        toast.error('Ошибка создания: ' + (e?.message || e));
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="col gap-16" style={{ maxWidth: 760 }}>
      <div className="card p-16 col gap-12">
        <div className="t-h3">📱 Парсер банковских SMS</div>
        <div className="c-t3 t-small">
          Поддерживаются: Сбербанк, Альфа-Банк, Тинькофф + универсальный паттерн.
          Распознаются сумма и отправитель.
        </div>

        <Field label="Текст SMS" htmlFor="tg-sms-text">
          <TextareaInput
            id="tg-sms-text"
            value={sms}
            onChange={(v) => { setSms(v); setParsed(false); setResult(null); }}
            minRows={3}
            maxRows={10}
            placeholder="Пример: Зачисление 50000 руб. от ООО РОМАШКА Баланс: 150000р"
          />
        </Field>

        <div className="row gap-8 ai-center" style={{ flexWrap: 'wrap' }}>
          <span className="c-t3 t-small">Примеры:</span>
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              type="button"
              className="btn mini ghost"
              onClick={() => { setSms(ex); setParsed(false); setResult(null); }}
              title={ex}
            >
              SMS #{i + 1}
            </button>
          ))}
        </div>

        <div className="row gap-12">
          <button
            id="btnParseSms"
            className="btn primary"
            onClick={handleParse}
            disabled={!sms.trim()}
          >
            🔍 Распознать
          </button>
          <button
            className="btn ghost"
            onClick={handleClear}
            disabled={!sms && !result}
          >
            🧹 Очистить
          </button>
        </div>

        {parsed && result && (
          <div
            className="card p-12 col gap-6"
            style={{ borderLeft: '4px solid var(--green, #34a853)' }}
          >
            <div>✅ Распознано: <strong>{result.bank}</strong></div>
            {result.amount != null && (
              <div>
                💰 Сумма:{' '}
                <strong>
                  {result.amount.toLocaleString('ru-RU')} ₽
                </strong>
              </div>
            )}
            {result.sender && (
              <div>🏢 Отправитель: <strong>{result.sender}</strong></div>
            )}
            <div className="row gap-8" style={{ marginTop: 8 }}>
              <button
                id="btnCreateIncome"
                className="btn mini primary"
                onClick={handleCreateIncome}
                disabled={creating}
              >
                {creating ? '⏳ Создаём…' : 'Создать поступление →'}
              </button>
            </div>
          </div>
        )}

        {parsed && !result && (
          <div
            className="card p-12"
            style={{ borderLeft: '4px solid var(--red, #ea4335)' }}
          >
            ❌ Не удалось распознать SMS. Проверьте формат или попробуйте другое.
          </div>
        )}
      </div>
    </div>
  );
}
