/**
 * Вкладка «Шаблоны сообщений» — D-49 (Message templates).
 *
 * Источник (vanilla): public/assets/js/telegram.js
 *   • MESSAGE_TEMPLATES (строки 15-44) — карта шаблонов
 *   • Рендер карточек (строки 272-281)
 *
 * Каждый шаблон — карточка: title + текст + кнопка «Скопировать».
 * Копирование — navigator.clipboard.writeText(text) + toast.
 */
import { useState } from 'react';
import { toast } from '@/modals/Notifications';

// Шаблоны сообщений (1:1 из vanilla telegram.js:15-44)
const MESSAGE_TEMPLATES = {
  tender_new: {
    name: 'Новый тендер',
    template: '🆕 *Новый тендер*\n\n📋 {tender_title}\n🏢 {customer_name}\n💰 {tender_price}\n📅 Дедлайн: {docs_deadline}'
  },
  tender_handoff: {
    name: 'Передача на просчёт',
    template: '📤 *Передача на просчёт*\n\n📋 {tender_title}\n🏢 {customer_name}\n👤 РП: {pm_name}'
  },
  bonus_request: {
    name: 'Запрос премии',
    template: '💰 *Запрос на согласование премий*\n\n📋 {work_title}\n👤 РП: {pm_name}\n💵 Сумма: {total_amount}'
  },
  permit_expiring: {
    name: 'Истекает разрешение',
    template: '⚠️ *Истекает разрешение*\n\n👤 {employee_name}\n📜 {permit_type}\n📅 До: {expiry_date}'
  },
  seal_transfer: {
    name: 'Передача печати',
    template: '🔄 *Передача печати*\n\n🔏 {seal_name}\n👤 Кому: {to_name}\n📝 Цель: {purpose}'
  },
  contract_expiring: {
    name: 'Истекает договор',
    template: '📄 *Истекает договор*\n\n📋 {contract_number}\n🏢 {counterparty_name}\n📅 До: {end_date}'
  },
  bank_income: {
    name: 'Поступление на счёт',
    template: '💵 *Поступление*\n\n💰 {amount}\n🏢 {sender}\n📝 {purpose}'
  }
};

async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  // fallback для http/iframe-контекстов
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function Templates() {
  const [copied, setCopied] = useState('');

  async function handleCopy(key, text) {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(key);
      toast.success('Скопировано');
      setTimeout(() => setCopied((cur) => (cur === key ? '' : cur)), 1500);
    } else {
      toast.error('Не удалось скопировать (нет доступа к буферу обмена)');
    }
  }

  const entries = Object.entries(MESSAGE_TEMPLATES);

  return (
    <div className="col gap-16" style={{ maxWidth: 860 }}>
      <div className="card p-16 col gap-8">
        <div className="t-h3">📝 Шаблоны уведомлений</div>
        <div className="c-t3 t-small">
          Готовые шаблоны для рассылок. Плейсхолдеры в фигурных скобках
          (например, <code>{'{tender_title}'}</code>) подставляются на сервере
          при отправке.
        </div>
      </div>

      <div className="col gap-12">
        {entries.map(([key, t]) => (
          <div key={key} className="card p-16 tmpl-card col gap-8">
            <div className="row jc-between ai-center" style={{ gap: 12 }}>
              <div className="t-h4">{t.name}</div>
              <button
                type="button"
                className={`btn mini ${copied === key ? 'success' : 'ghost'}`}
                onClick={() => handleCopy(key, t.template)}
                title="Скопировать в буфер обмена"
              >
                {copied === key ? '✓ Скопировано' : '📋 Скопировать'}
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 12,
                background: 'var(--bg-elevated, rgba(127,127,127,0.08))',
                padding: 10,
                borderRadius: 6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'inherit'
              }}
            >
              {t.template}
            </pre>
            <div className="c-t3 t-small">
              Ключ: <code>{key}</code>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
