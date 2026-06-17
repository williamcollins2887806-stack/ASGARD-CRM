/**
 * ContactsPanel — адресная книга (vanilla my_mail.js:338 loadContacts).
 *
 * Реализует:
 *  - список контактов (имя + email) с аватаром-буквой
 *  - поиск по подстроке
 *  - клик → автофильтр писем «от/кому = email» (через onFilter)
 */
import { useMemo, useState } from 'react';
import { hashColor, avatarLetter } from './api';

export function ContactsPanel({ contacts, onPick }) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return contacts.slice(0, 30);
    return contacts.filter((c) =>
      (c.email || '').toLowerCase().includes(term) ||
      (c.name || '').toLowerCase().includes(term)
    ).slice(0, 30);
  }, [contacts, q]);

  return (
    <div className="mm-contacts">
      <div className="mm-sidebar__title">📇 Контакты <span className="mm-sidebar__count">{contacts.length}</span></div>
      <input
        type="search"
        className="mm-contacts__search"
        placeholder="Поиск…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="mm-contacts__list">
        {filtered.length === 0 ? (
          <div className="mm-contacts__empty">Нет совпадений</div>
        ) : filtered.map((c, i) => (
          <button
            key={(c.email || '') + i}
            type="button"
            className="mm-contact"
            onClick={() => onPick?.(c.email)}
            title={c.email}
          >
            <span className="mm-avatar" style={{ background: hashColor(c.email || c.name) }}>
              {avatarLetter(c.name, c.email)}
            </span>
            <span className="mm-contact__txt">
              <span className="mm-contact__name">{c.name || c.email}</span>
              {c.name && <span className="mm-contact__email">{c.email}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
