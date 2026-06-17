/**
 * CallReports — константы.
 */
export const TYPE_MAP = {
  daily:   'Ежедневный',
  weekly:  'Еженедельный',
  monthly: 'Ежемесячный'
};

export const TYPE_TONES = {
  daily:   'var(--info)',
  weekly:  'var(--gold)',
  monthly: 'var(--purple)'
};

export const TYPE_OPTIONS = Object.entries(TYPE_MAP).map(([value, label]) => ({ value, label }));
